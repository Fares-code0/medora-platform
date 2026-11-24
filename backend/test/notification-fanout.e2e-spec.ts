import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { NotificationDispatchService } from '../src/modules/notifications/services/notification-dispatch.service';
import { OUTBOX, type OutboxPort } from '../src/shared/outbox';

import { type AuthHarness, createAuthHarness, dataOf, testEmail } from './support/auth-app';
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
  type LabOrderView,
} from './support/lab-fixture';

/**
 * Event fan-out — RM M19.2.
 *
 * > ✅ Verify: a critical lab result creates a pinned critical
 * > notification.
 *
 * That sentence is driven end to end: a doctor enters a potassium above
 * the seeded critical high, which raises `lab_result.critical` inside
 * the result transaction (M19.1), and the dispatcher turns it into the
 * notification the doctor sees. Nothing is stubbed between the two.
 *
 * Around it, the properties fan-out can get wrong:
 *
 * · **One event, one notification.** The claim is `FOR UPDATE SKIP
 *   LOCKED`, so two instances draining at once must not both page the
 *   same doctor — asserted by draining concurrently.
 * · **An event nobody subscribed to is not an error.** Ten of the
 *   twenty-one published topics deliberately have no rule.
 * · **Preferences gate channels, not the feed row.**
 * · **Security cannot be switched off**, and the guarantee is the
 *   database's.
 *
 * ## Why nothing here asserts a global `claimed` count
 *
 * `drain()` claims **every** pending event in the table, by design — it
 * is the process-wide fan-out, not this suite's. Under a parallel full
 * run another spec's critical result is in that table too, so a
 * `claimed === 1` assertion measures the rest of the suite rather than
 * this code. Every assertion is therefore scoped to **this suite's own
 * recipient**, the way RA-M10.1 taught the appointments spec to own its
 * doctor. The claim's *exclusivity* is still proven — by two concurrent
 * drains producing one notification, which is the property that matters.
 */
let harness: AuthHarness;
let dispatch: NotificationDispatchService;
let outbox: OutboxPort;

const charts: string[] = [];

let doctorToken = '';
let doctorUserId = '';
/** `doctors.id` — what a `doctor`-audience payload names (M30.2). */
let fanoutDoctorId = '';
let patientId = '';

function normalPanel(overrides: Record<string, string> = {}): { analyte: string; value: string }[] {
  const values: Record<string, string> = {
    Sodium: '140',
    Potassium: '4.2',
    Chloride: '102',
    Glucose: '88',
    Creatinine: '0.9',
    BUN: '14',
    ...overrides,
  };

  return Object.entries(values).map(([analyte, value]) => ({ analyte, value }));
}

/** Enters a panel whose potassium is above the seeded critical high of 6.0. */
async function enterCriticalPanel(): Promise<LabOrderView> {
  const order = await orderTest(harness, doctorToken, patientId);
  await toProcessing(harness, doctorToken, order.id);

  const response = await post(harness, doctorToken, `/${order.id}/results`, {
    results: normalPanel({ Potassium: '7.2' }),
  });
  expect(response.status).toBe(200);

  return dataOf<LabOrderView>(response);
}

function notificationsFor(userId: string) {
  return harness.prisma.db.notification.findMany({
    where: { recipientId: userId },
    orderBy: { createdAt: 'desc' },
    include: { deliveries: true },
  });
}

/**
 * Excludes the other notification-pipeline specs for this file's whole
 * run — see `support/delivery-worker-lock.ts`. The release is registered
 * before this file's own `afterAll`, so under Vitest's default `stack`
 * hook order it runs last, after this file's cleanup has deleted its rows.
 */
let pipelineLock: DeliveryWorkerLock | undefined;

beforeAll(async () => {
  pipelineLock = await acquireDeliveryWorkerLock();
}, DELIVERY_WORKER_LOCK_TIMEOUT_MS + 10_000);

afterAll(async () => {
  await pipelineLock?.release();
});

beforeAll(async () => {
  harness = await createAuthHarness('notify-fanout', { clinicalDoctors: true });
  dispatch = harness.app.get(NotificationDispatchService);
  outbox = harness.app.get<OutboxPort>(OUTBOX);

  doctorToken = await seedDoctor(harness, 'fanout-doctor');
  const patient = await seedPatient(harness, doctorToken);
  patientId = patient.id;
  charts.push(patient.id);

  // The account behind the token, found through the address the fixture
  // registered — the doctor row's `user_id` is what `recipient_id` is.
  const user = await harness.prisma.db.user.findUniqueOrThrow({
    where: { email: testEmail('fanout-doctor') },
    select: { id: true },
  });
  doctorUserId = user.id;

  const doctor = await harness.prisma.db.doctor.findFirstOrThrow({
    where: { userId: doctorUserId },
    select: { id: true },
  });
  fanoutDoctorId = doctor.id;
}, 60_000);

/**
 * Empties the outbox before each test — except the rows other suites
 * assert on.
 *
 * `drain()` claims the 100 **oldest** pending events (`claim`, `LIMIT`).
 * Nothing else in the run drains the outbox, so every suite that writes
 * clinical data leaves pending events behind, and a backlog over 100 puts
 * this suite's fresh event past the first claim: the critical-result test
 * then sees no notification. That is why this suite has always cleared
 * the queue, and why it still does.
 *
 * What it must not clear is a row another file is asserting on while it
 * runs. Two files read `domain_events`: `outbox-transactional` (topics
 * under `test.`) and `license-expiry` (`doctor.license_expiring`). A
 * table-wide delete removed their rows mid-test; those two topics are
 * spared. This suite's own licence-expiry rows carry its dedupe-key
 * prefix and are cleared by it. A new suite that asserts on
 * `domain_events` belongs in the spared list — `record-issue-queue`
 * (`medical_record.issue_reported`) is the third.
 */
const SPARED_TOPICS = { startsWith: 'test.' } as const;
const LICENSE_TOPIC = 'doctor.license_expiring';
const RECORD_ISSUE_TOPIC = 'medical_record.issue_reported';

function clearOutbox() {
  return harness.prisma.domainEvent.deleteMany({
    where: {
      OR: [
        {
          NOT: {
            OR: [{ topic: SPARED_TOPICS }, { topic: LICENSE_TOPIC }, { topic: RECORD_ISSUE_TOPIC }],
          },
        },
        { dedupeKey: { startsWith: 'license-expiry:fanout:' } },
      ],
    },
  });
}

afterAll(async () => {
  if (harness === undefined) return;

  await clearOutbox();
  await destroyLabFixtures(harness, charts);
  await harness.reset();
  await harness.close();
});

beforeEach(async () => {
  await harness.prisma.db.notification.deleteMany({ where: { recipientId: doctorUserId } });
  await clearOutbox();
  await harness.prisma.db.notificationPreference.deleteMany({ where: { userId: doctorUserId } });
});

describe('RM M19.2 verify — a critical lab result creates a pinned critical notification', () => {
  it('pins it, marks it critical, and files it under laboratory', async () => {
    await enterCriticalPanel();

    await dispatch.drain();

    const mine = await notificationsFor(doctorUserId);
    expect(mine).toHaveLength(1);

    const [notification] = mine;

    expect(notification).toMatchObject({
      title: 'Critical lab result released',
      category: 'LABORATORY',
      priority: 'CRITICAL',
      kind: 'ALERT',
      // UX 2.9 — critical alerts stay pinned until acted on.
      pinned: true,
      readAt: null,
      archived: false,
    });
  });

  it('deep-links the order and the patient by row id, and carries no values', async () => {
    const order = await enterCriticalPanel();
    await dispatch.drain();

    const [notification] = await notificationsFor(doctorUserId);

    expect(notification?.labOrderId).not.toBeNull();
    expect(notification?.patientId).not.toBeNull();
    // The body names the analyte and the order, never the number: a
    // notification is a pointer, not a result.
    expect(notification?.body).toContain(order.id);
    expect(notification?.body).toContain('Potassium');
    expect(notification?.body).not.toContain('7.2');
  });

  it('addresses the ordering doctor, taken from the order rather than the payload', async () => {
    const order = await enterCriticalPanel();
    await dispatch.drain();

    // Scoped by this suite's own order, not by category: another spec's
    // critical result is a different order for a different doctor, and
    // sweeping the category would measure it instead of this.
    const row = await harness.prisma.db.labOrder.findUniqueOrThrow({
      where: { publicId: order.id },
      select: { id: true },
    });
    const raised = await harness.prisma.db.notification.findMany({
      where: { labOrderId: row.id },
      select: { recipientId: true },
    });

    expect(raised.map((notification) => notification.recipientId)).toEqual([doctorUserId]);
  });

  it('raises nothing when no value is critical', async () => {
    const order = await orderTest(harness, doctorToken, patientId);
    await toProcessing(harness, doctorToken, order.id);
    await post(harness, doctorToken, `/${order.id}/results`, { results: normalPanel() });

    await dispatch.drain();

    expect(await notificationsFor(doctorUserId)).toHaveLength(0);
  });
});

describe('the claim is the duplicate suppression', () => {
  it('creates one notification when two drains run concurrently', async () => {
    await enterCriticalPanel();

    await Promise.all([dispatch.drain(), dispatch.drain()]);

    // Whichever transaction locks the row first claims it; the other
    // walks past rather than blocking, which is what SKIP LOCKED buys.
    // One notification, not two, is that property.
    expect(await notificationsFor(doctorUserId)).toHaveLength(1);
  });

  it('does not re-deliver an event a previous drain already claimed', async () => {
    await enterCriticalPanel();

    await dispatch.drain();
    await dispatch.drain();

    // A second notification would mean the event was claimed twice.
    // Counted on this suite's recipient, so a concurrent spec's event
    // being claimed by the same drain changes nothing here.
    expect(await notificationsFor(doctorUserId)).toHaveLength(1);
  });

  it('collapses a republished event through the outbox dedupe key', async () => {
    const message = {
      topic: 'lab_result.critical',
      payload: { labOrderId: 'LAB-000001' },
      dedupeKey: 'republished',
    };

    await harness.prisma.$transaction((tx) => outbox.publishWithin(tx, message));
    await harness.prisma.$transaction((tx) => outbox.publishWithin(tx, message));

    expect(await harness.prisma.domainEvent.count({ where: { dedupeKey: 'republished' } })).toBe(1);
  });
});

describe('the licence-expiry warning (M30.2)', () => {
  it('reaches the practitioner, and carries the date rather than the generic body', async () => {
    // The twelfth topic. What is new is not the mechanism — that is what
    // the eleven above prove — but the rule: that `doctor.license_expiring`
    // has one at all, who it names, and that `expiresOn` reaches the body.
    // Without that last part this would be the one notification whose
    // entire content is *when*, rendered as "Open Medora for details."
    await harness.prisma.$transaction((tx) =>
      outbox.publishWithin(tx, {
        topic: 'doctor.license_expiring',
        payload: { doctorId: fanoutDoctorId, expiresOn: '2026-11-20', withinDays: 60 },
        dedupeKey: 'license-expiry:fanout:60:2026-11-20',
      }),
    );

    await dispatch.drain();

    const mine = await notificationsFor(doctorUserId);
    const warning = mine.find((row) => row.title === 'Practising licence expires soon');

    expect(warning).toBeDefined();
    expect(warning?.body).toBe('Expires on 2026-11-20');
    expect(warning?.category).toBe('SYSTEM');
    expect(warning?.kind).toBe('REMINDER');
    // Pinning follows from `critical`, and nothing has gone wrong yet.
    expect(warning?.priority).toBe('NORMAL');
    expect(warning?.pinned).toBe(false);
  });
});

describe('an event with no rule', () => {
  it('is claimed, counted and dropped rather than failing the drain', async () => {
    await harness.prisma.$transaction((tx) =>
      outbox.publishWithin(tx, {
        topic: 'medical_record.note_added',
        payload: { recordId: 'REC-1' },
        dedupeKey: 'no-rule-note',
      }),
    );

    const drained = await dispatch.drain();

    // At least this suite's event was claimed and dropped; other specs
    // contribute to the same drain under a parallel run, so only the
    // lower bound and this suite's own row are asserted.
    expect(drained.skippedNoRule).toBeGreaterThanOrEqual(1);
    expect(
      await harness.prisma.domainEvent.count({
        where: { dedupeKey: 'no-rule-note', status: 'pending' },
      }),
    ).toBe(0);
  });

  it('is marked delivered so the next drain does not reconsider it', async () => {
    await harness.prisma.$transaction((tx) =>
      outbox.publishWithin(tx, {
        topic: 'prescription.prescribed',
        payload: { id: 'RX-1' },
        dedupeKey: 'no-rule-prescribed',
      }),
    );

    await dispatch.drain();

    // This suite's row, by its key: the prescriptions suites publish the
    // same topic under a parallel run, after this drain has finished.
    expect(
      await harness.prisma.domainEvent.findUniqueOrThrow({
        where: { dedupeKey: 'no-rule-prescribed' },
        select: { status: true },
      }),
    ).toEqual({ status: 'delivered' });
  });

  /**
   * A rule whose entity has since been deleted resolves to nobody. That
   * is silence, not a failure: the event is still a true statement about
   * something that happened.
   */
  it('creates nothing when the referenced order no longer exists', async () => {
    await harness.prisma.$transaction((tx) =>
      outbox.publishWithin(tx, {
        topic: 'lab_result.critical',
        payload: { labOrderId: 'LAB-999999' },
        dedupeKey: 'missing-order',
      }),
    );

    await dispatch.drain();

    // The order is gone, so the audience resolves to nobody — silence
    // rather than a failure, because the event is still a true statement
    // about something that happened. `delivered` rather than `failed` is
    // that distinction, read from this suite's own row.
    expect(
      await harness.prisma.domainEvent.count({
        where: { dedupeKey: 'missing-order', status: 'delivered' },
      }),
    ).toBe(1);
    expect(await notificationsFor(doctorUserId)).toHaveLength(0);
  });
});

describe('M19 exit gate — approving an appointment notifies, and only after commit', () => {
  /**
   * The gate's first half, end to end.
   *
   * `appointment.confirmed` is published by the approve path and the
   * rule addresses the **patient** — API §5.4's own words, "patient
   * notified after commit". The patient must have an account for the
   * audience to resolve, which ADR-030's `patients.user_id` link
   * provides; a record with no account is silence, asserted below.
   */
  it('produces a notification for the patient when an appointment is approved', async () => {
    const patientUser = await harness.prisma.db.user.findUniqueOrThrow({
      where: { email: testEmail('fanout-doctor') },
      select: { id: true },
    });

    // The appointment fixture is the event's payload, not a real booking:
    // what the gate tests is that the confirmed event reaches the patient,
    // and the approve route's own transitions are covered by M11's suite.
    const patient = await harness.prisma.db.patient.findUniqueOrThrow({
      where: { publicId: charts[0]! },
      select: { publicId: true },
    });
    await harness.prisma.db.patient.update({
      where: { publicId: patient.publicId },
      data: { userId: patientUser.id },
    });

    await harness.prisma.$transaction((tx) =>
      outbox.publishWithin(tx, {
        topic: 'appointment.confirmed',
        payload: { patientId: patient.publicId, status: 'confirmed' },
        dedupeKey: 'gate-confirmed',
      }),
    );

    await dispatch.drain();

    const received = await notificationsFor(patientUser.id);
    expect(received).toHaveLength(1);
    const [notification] = received;
    expect(notification).toMatchObject({
      title: 'Appointment confirmed',
      category: 'APPOINTMENTS',
      priority: 'NORMAL',
      pinned: false,
    });

    await harness.prisma.db.patient.update({
      where: { publicId: patient.publicId },
      data: { userId: null },
    });
  });

  /**
   * The gate's second half. A rolled-back approval leaves no event, so
   * there is nothing for the dispatcher to claim and no notification can
   * be produced — "only after commit" holds because the event itself is
   * transactional (M19.1), not because the sender checks a flag.
   */
  it('produces nothing when the approving transaction rolls back', async () => {
    await expect(
      harness.prisma.$transaction(async (tx) => {
        await outbox.publishWithin(tx, {
          topic: 'appointment.confirmed',
          payload: { patientId: charts[0]!, status: 'confirmed' },
          dedupeKey: 'gate-rolled-back',
        });

        throw new Error('the approval failed after the event was recorded');
      }),
    ).rejects.toThrow();

    await dispatch.drain();

    // Nothing was recorded, so nothing could be claimed — asserted on
    // the dedupe key this test wrote rather than on a global count.
    expect(
      await harness.prisma.domainEvent.count({ where: { dedupeKey: 'gate-rolled-back' } }),
    ).toBe(0);
  });

  it('stays silent for a patient record with no account', async () => {
    await harness.prisma.$transaction((tx) =>
      outbox.publishWithin(tx, {
        topic: 'appointment.confirmed',
        payload: { patientId: charts[0]!, status: 'confirmed' },
        dedupeKey: 'gate-unlinked',
      }),
    );

    await dispatch.drain();

    // ADR-030 links a record to an account where one exists; it does not
    // require one, so this is an ordinary outcome and not a failure.
    //
    // Asserted on this suite's own event rather than on `drain()`'s
    // counters: the drain claims every pending row by design, so under a
    // parallel full run `failed` counts other specs' events too — the
    // same contention that RA-M10.1 taught the appointments spec about.
    expect(
      await harness.prisma.domainEvent.count({
        where: { dedupeKey: 'gate-unlinked', status: 'delivered' },
      }),
    ).toBe(1);

    // And nothing was raised about that patient. `charts[0]` is a
    // `PT-…` public id, so the row id is resolved first — the feed's
    // `patient_id` is the internal key.
    const patientRow = await harness.prisma.db.patient.findUniqueOrThrow({
      where: { publicId: charts[0]! },
      select: { id: true },
    });
    expect(
      await harness.prisma.db.notification.count({ where: { patientId: patientRow.id } }),
    ).toBe(0);
  });
});

describe('preferences gate the channels, and the row records which rule did it', () => {
  it('writes one delivery row per channel', async () => {
    await enterCriticalPanel();
    await dispatch.drain();

    const [notification] = await notificationsFor(doctorUserId);

    expect(notification?.deliveries).toHaveLength(5);
    expect(new Set(notification?.deliveries.map((delivery) => delivery.channel))).toEqual(
      new Set(['EMAIL', 'SMS', 'PUSH', 'DESKTOP', 'IN_APP']),
    );
  });

  it('uses the column defaults for a user who never saved preferences', async () => {
    await enterCriticalPanel();
    await dispatch.drain();

    const [notification] = await notificationsFor(doctorUserId);
    const byChannel = new Map(
      notification?.deliveries.map((delivery) => [delivery.channel, delivery.status]),
    );

    // `channel_sms` and `channel_desktop` default to false.
    expect(byChannel.get('EMAIL')).toBe('pending');
    expect(byChannel.get('SMS')).toBe('skipped');
    expect(byChannel.get('DESKTOP')).toBe('skipped');
    expect(byChannel.get('IN_APP')).toBe('pending');
  });

  it('skips every channel when the category is off, but still files the feed row', async () => {
    await harness.prisma.db.notificationPreference.create({
      data: { userId: doctorUserId, catLaboratory: false },
    });

    await enterCriticalPanel();
    await dispatch.drain();

    const [notification] = await notificationsFor(doctorUserId);

    // The feed row exists — the contract's feed has no preference
    // filter, and a doctor can still archive what they do not want.
    expect(notification).toBeDefined();
    expect(notification?.deliveries.every((delivery) => delivery.status === 'skipped')).toBe(true);
  });

  it('delivers a critical alert during quiet hours', async () => {
    // A window covering the whole day, so the test does not depend on
    // when it runs: 00:00–23:59 is quiet, and the alert goes out anyway.
    await harness.prisma.db.notificationPreference.create({
      data: {
        userId: doctorUserId,
        quietHoursEnabled: true,
        quietFrom: new Date(Date.UTC(1970, 0, 1, 0, 0, 0)),
        quietTo: new Date(Date.UTC(1970, 0, 1, 23, 59, 0)),
      },
    });

    await enterCriticalPanel();
    await dispatch.drain();

    const [notification] = await notificationsFor(doctorUserId);
    const email = notification?.deliveries.find((delivery) => delivery.channel === 'EMAIL');

    expect(email?.status).toBe('pending');
  });

  /**
   * DB §G7 puts the guarantee in the database because a UI-only one is
   * one API client away from a user who never learns their password was
   * changed.
   */
  it('refuses to switch the security category off, at the database', async () => {
    await harness.prisma.db.notificationPreference.create({ data: { userId: doctorUserId } });

    await expect(
      harness.prisma.db.notificationPreference.update({
        where: { userId: doctorUserId },
        data: { catSecurity: false },
      }),
    ).rejects.toThrow();
  });
});
