import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { NotificationDispatchService } from '../src/modules/notifications/services/notification-dispatch.service';

import {
  type AuthHarness,
  asJob,
  createAuthHarness,
  registrationBody,
  testEmail,
} from './support/auth-app';
import {
  acquireDeliveryWorkerLock,
  DELIVERY_WORKER_LOCK_TIMEOUT_MS,
  type DeliveryWorkerLock,
} from './support/delivery-worker-lock';
import {
  destroyLabFixtures,
  orderTest,
  post,
  seedDoctor,
  seedPatient,
  toProcessing,
} from './support/lab-fixture';

/**
 * ADR-050 — the patient-facing test-status notification.
 *
 * What matters, and what this file proves:
 *
 * · a linked patient is told that a test completed — and only that;
 * · a CRITICAL completion and a NORMAL one produce notifications that are
 *   indistinguishable to the patient (title, category, priority, kind,
 *   pinned), so the notification cannot disclose a critical result before
 *   any release policy exists (ADR-031 is open);
 * · no value reaches the patient's notification row;
 * · an unlinked record notifies nobody, and the doctor's own alerting is
 *   unchanged (a critical result still pages the orderer, once).
 */
let harness: AuthHarness;
let dispatch: NotificationDispatchService;
let lock: DeliveryWorkerLock | undefined;

const REGISTER = '/api/v1/auth/register';
const charts: string[] = [];

let doctorToken = '';
let doctorUserId = '';
let patientUserId = '';
let linkedPatient = '';
let unlinkedPatient = '';

function panel(potassium: string): { analyte: string; value: string }[] {
  return Object.entries({
    Sodium: '140',
    Potassium: potassium,
    Chloride: '102',
    Glucose: '88',
    Creatinine: '0.9',
    BUN: '14',
  }).map(([analyte, value]) => ({ analyte, value }));
}

async function complete(patientId: string, potassium: string): Promise<void> {
  const order = await orderTest(harness, doctorToken, patientId);
  await toProcessing(harness, doctorToken, order.id);
  const response = await post(harness, doctorToken, `/${order.id}/results`, {
    results: panel(potassium),
  });
  expect(response.status).toBe(200);
  // The completion event is published on the transition, not on entry.
  const completed = await post(harness, doctorToken, `/${order.id}/transition`, {
    to: 'completed',
  });
  expect(completed.status).toBe(200);
}

function forUser(userId: string) {
  return harness.prisma.db.notification.findMany({
    where: { recipientId: userId },
    orderBy: { createdAt: 'asc' },
  });
}

async function clearOwnEvents(): Promise<void> {
  // Only this suite's topics, so other files asserting on the outbox
  // keep their rows (see notification-fanout's SPARED_TOPICS note).
  await harness.prisma.domainEvent.deleteMany({
    where: {
      topic: { in: ['lab_order.completed', 'lab_order.critical_released', 'lab_result.critical'] },
    },
  });
}

beforeAll(async () => {
  lock = await acquireDeliveryWorkerLock();
}, DELIVERY_WORKER_LOCK_TIMEOUT_MS + 10_000);

beforeAll(async () => {
  harness = await createAuthHarness('patient-lab-notify');
  dispatch = asJob(harness.app.get(NotificationDispatchService));

  doctorToken = await seedDoctor(harness, 'lab-notify-doctor');
  const doctor = await harness.prisma.db.user.findUniqueOrThrow({
    where: { email: testEmail('lab-notify-doctor') },
    select: { id: true },
  });
  doctorUserId = doctor.id;

  const linked = await seedPatient(harness, doctorToken);
  const unlinked = await seedPatient(harness, doctorToken);
  linkedPatient = linked.id;
  unlinkedPatient = unlinked.id;
  charts.push(linked.id, unlinked.id);

  const email = testEmail('lab-notify-patient');
  await request(harness.server)
    .post(REGISTER)
    .send(registrationBody({ email, role: 'patient' }))
    .expect(201);
  const account = await harness.prisma.db.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  });
  patientUserId = account.id;

  // Test-only link (ADR-048 links through staff in production).
  await harness.prisma.db.patient.update({
    where: { publicId: linkedPatient },
    data: { userId: patientUserId },
  });
}, 120_000);

beforeEach(async () => {
  await harness.prisma.db.notification.deleteMany({
    where: { recipientId: { in: [patientUserId, doctorUserId] } },
  });
  await clearOwnEvents();
});

afterAll(async () => {
  if (harness === undefined) return;
  await clearOwnEvents();
  await harness.prisma.db.patient.updateMany({
    where: { publicId: linkedPatient },
    data: { userId: null },
  });
  await destroyLabFixtures(harness, charts);
  await harness.reset();
  await harness.close();
  await lock?.release();
});

describe('ADR-050 — a linked patient is told a test completed, and nothing more', () => {
  it('notifies the patient of a normal completion with a lock-screen-safe title and no values', async () => {
    await complete(linkedPatient, '4.2');
    await dispatch.drain();

    const mine = await forUser(patientUserId);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      title: 'Update about your test',
      category: 'LABORATORY',
      priority: 'NORMAL',
      kind: 'UPDATE',
      pinned: false,
    });
    expect(mine[0]?.labOrderId).not.toBeNull();
    for (const value of ['4.2', '140', 'Potassium', 'Sodium']) {
      expect(mine[0]?.body ?? '').not.toContain(value);
    }
  });

  it('makes a critical completion indistinguishable from a normal one', async () => {
    await complete(linkedPatient, '4.2');
    await complete(linkedPatient, '7.2');
    await dispatch.drain();

    const mine = await forUser(patientUserId);
    expect(mine).toHaveLength(2);

    const shape = (n: (typeof mine)[number]) => ({
      title: n.title,
      category: n.category,
      priority: n.priority,
      kind: n.kind,
      pinned: n.pinned,
    });
    expect(shape(mine[0]!)).toEqual(shape(mine[1]!));
    expect(mine[1]?.body ?? '').not.toContain('7.2');
    expect(mine[1]?.body ?? '').not.toContain('Potassium');
  });

  it('still pages the ordering doctor once for a critical value', async () => {
    await complete(linkedPatient, '7.2');
    await dispatch.drain();

    const doctors = await forUser(doctorUserId);
    expect(doctors).toHaveLength(1);
    expect(doctors[0]).toMatchObject({ title: 'Critical lab result released' });
  });

  it('notifies nobody for an unlinked record', async () => {
    await complete(unlinkedPatient, '4.2');
    await dispatch.drain();

    expect(await forUser(patientUserId)).toHaveLength(0);
    expect(await forUser(doctorUserId)).toHaveLength(0);
  });
});
