import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
  makeClinicalDoctor,
  markVerified,
  purgeHospitalRecords,
  registrationBody,
  testEmail,
  soleRecordOf,
} from './support/auth-app';

/**
 * The prescription lifecycle (RM M13.4 — API §7.3, §7.8, §7.9, §7.10).
 *
 * The verify step names two things, and each has its own `describe`:
 * **refill bounds enforced**, and **renew copies the source Rx
 * correctly**. Around them, the properties a lifecycle can get wrong:
 *
 * · **A renewal is a new draft, not a resurrection.** ADR-002 §3 makes
 *   `completed`, `discontinued` and `expired` terminal, so renewing must
 *   produce a second prescription — and that one must go through the
 *   safety screen again, because the patient may have changed since.
 * · **`/cancel` and `/discontinue` write the same status** (ADR-002 §4)
 *   and are told apart by the audit event and the timeline detail, which
 *   is the only place the distinction can live.
 * · **The reason is not optional at any layer**, and stopping therapy
 *   updates the patient's medication list in the same transaction.
 * · **Refill bounds are enforced in three places** — the schema, the
 *   service's controlled-substance rule, and the CHECK constraint — and
 *   the third is asserted directly, because a constraint nobody tests is
 *   a constraint that gets dropped in a later migration.
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const PATIENTS = '/api/v1/patients';
const PRESCRIPTIONS = '/api/v1/prescriptions';
const PASSWORD = 'Medora123!';

interface SessionPayload {
  accessToken: string;
}

interface PrescriptionView {
  id: string;
  status: string;
  signedAt: string | null;
  dosage: string;
  frequency: string;
  route: string;
  duration: string;
  durationDays: number;
  quantity: number;
  instructions: string;
  refillsAllowed: number;
  refillsRemaining: number;
  refillStatus: string;
  startDate: string;
  endDate: string;
  discontinuedReason: string | null;
  medication: { id: string; name: string; genericName: string; strength: string };
  patient: { id: string };
  warnings: { id: string; kind: string }[];
  notes: { id: string; author: string; body: string }[];
  timeline: { kind: string; actor: string; detail: string }[];
  history: unknown[];
}

interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

const createdCharts: string[] = [];

let amoxilId = '';
let eltroxinId = '';

async function seedDoctor(local: string): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  // Clinical standing at the fixture hospital (§2.6, DR-05).
  await makeClinicalDoctor(harness.prisma, email);

  return dataOf<SessionPayload>(
    await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;
}

async function seedPatient(token: string): Promise<string> {
  const response = await request(harness.server)
    .post(PATIENTS)
    .set('Authorization', `Bearer ${token}`)
    .send({
      fullName: 'Layla Morsi',
      dateOfBirth: '1988-04-12',
      gender: 'female',
      bloodType: 'A+',
      phone: '+20 100 777 1234',
      allergies: [],
      chronicConditions: [],
    });

  expect(response.status).toBe(201);
  const id = dataOf<{ id: string }>(response).id;
  createdCharts.push(id);

  return id;
}

function draftBody(patientId: string, medicationId: string, overrides: Record<string, unknown> = {}) {
  return {
    patientId,
    medicationId,
    strength: '500 mg',
    dosage: '1 capsule',
    frequency: 'Three times daily',
    durationDays: 7,
    quantity: 21,
    refillsAllowed: 0,
    instructions: 'Take with food. Complete the course.',
    startDate: '2026-09-14T00:00:00.000Z',
    ...overrides,
  };
}

async function createDraft(
  token: string,
  patientId: string,
  medicationId = amoxilId,
  overrides: Record<string, unknown> = {},
): Promise<PrescriptionView> {
  const response = await request(harness.server)
    .post(PRESCRIPTIONS)
    .set('Authorization', `Bearer ${token}`)
    .send(draftBody(patientId, medicationId, overrides));

  expect(response.status).toBe(201);

  return dataOf<PrescriptionView>(response);
}

async function createSigned(
  token: string,
  patientId: string,
  overrides: Record<string, unknown> = {},
): Promise<PrescriptionView> {
  const draft = await createDraft(token, patientId, amoxilId, overrides);
  const response = await request(harness.server)
    .post(`${PRESCRIPTIONS}/${draft.id}/sign`)
    .set('Authorization', `Bearer ${token}`)
    .send({});

  expect(response.status).toBe(200);

  return dataOf<PrescriptionView>(response);
}

function post(token: string, path: string, body: Record<string, unknown> = {}) {
  return request(harness.server)
    .post(`${PRESCRIPTIONS}/${path}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

function detail(token: string, reference: string) {
  return request(harness.server)
    .get(`${PRESCRIPTIONS}/${reference}`)
    .set('Authorization', `Bearer ${token}`);
}

beforeAll(async () => {
  harness = await createAuthHarness('rx-lifecycle');

  const byName = async (name: string): Promise<string> =>
    (await harness.prisma.medication.findFirstOrThrow({ where: { name }, select: { id: true } }))
      .id;

  amoxilId = await byName('Amoxil');
  eltroxinId = await byName('Eltroxin');
}, 60_000);

afterAll(async () => {
  if (harness === undefined) return;

  if (createdCharts.length > 0) {
    await harness.prisma.patientMedication.deleteMany({
      where: { patient: { publicId: { in: createdCharts } } },
    });
    await harness.prisma.prescription.deleteMany({
      where: { patient: { publicId: { in: createdCharts } } },
    });
    const rows = await harness.prisma.patient.findMany({
      where: { publicId: { in: createdCharts } },
      select: { id: true },
    });
    await purgeHospitalRecords(
      harness.prisma,
      rows.map((row) => row.id),
    );
    await harness.prisma.patient.deleteMany({ where: { publicId: { in: createdCharts } } });
  }

  await harness.reset();
  await harness.close();
});

describe('RM M13.4 verify — refill bounds enforced', () => {
  it('refuses more refills than the coded maximum of 11', async () => {
    // `authoring.ts:159` codes `MAX_REFILLS = 11`. A server that accepted
    // 12 would write prescriptions the stepper could never have produced,
    // and the server is the surface that dispenses.
    const token = await seedDoctor('refill-max');
    const patientId = await seedPatient(token);

    const response = await request(harness.server)
      .post(PRESCRIPTIONS)
      .set('Authorization', `Bearer ${token}`)
      .send(draftBody(patientId, amoxilId, { refillsAllowed: 12 }));

    expect(response.status).toBe(422);
    expect(errorBody(response).code).toBe('validation_failed');
  });

  it('accepts the boundary of 11, so the range is not over-tight', async () => {
    const token = await seedDoctor('refill-boundary');
    const patientId = await seedPatient(token);

    const view = await createDraft(token, patientId, amoxilId, { refillsAllowed: 11 });

    expect(view.refillsAllowed).toBe(11);
  });

  it('refuses a negative refill count', async () => {
    const token = await seedDoctor('refill-negative');
    const patientId = await seedPatient(token);

    const response = await request(harness.server)
      .post(PRESCRIPTIONS)
      .set('Authorization', `Bearer ${token}`)
      .send(draftBody(patientId, amoxilId, { refillsAllowed: -1 }));

    expect(response.status).toBe(422);
  });

  it('refuses refills on a controlled medication', async () => {
    // `authoring.ts:213`, verbatim: "A controlled medication cannot carry
    // refills." A refillable controlled substance is a real prescribing
    // hazard, not a form-validation nicety.
    const token = await seedDoctor('refill-controlled');
    const patientId = await seedPatient(token);

    await harness.prisma.medication.update({
      where: { id: eltroxinId },
      data: { isControlled: true },
    });

    try {
      const response = await request(harness.server)
        .post(PRESCRIPTIONS)
        .set('Authorization', `Bearer ${token}`)
        .send(draftBody(patientId, eltroxinId, { strength: '50 mcg', refillsAllowed: 3 }));

      expect(response.status).toBe(422);
      expect(errorBody(response).fieldErrors?.refillsAllowed?.[0]).toContain('controlled');
    } finally {
      await harness.prisma.medication.update({
        where: { id: eltroxinId },
        data: { isControlled: false },
      });
    }
  });

  it('holds the remaining count at zero until the prescription is signed', async () => {
    const token = await seedDoctor('refill-draft');
    const patientId = await seedPatient(token);

    const draft = await createDraft(token, patientId, amoxilId, { refillsAllowed: 3 });

    // A draft has authorised nothing, so it cannot be refillable.
    expect(draft.refillsAllowed).toBe(3);
    expect(draft.refillsRemaining).toBe(0);
    expect(draft.refillStatus).toBe('none');

    const signed = dataOf<PrescriptionView>(await post(token, `${draft.id}/sign`));

    expect(signed.refillsRemaining).toBe(3);
    expect(signed.refillStatus).toBe('available');
  });

  it('refuses a remaining count above the allowance at the database', async () => {
    // `prescriptions_refills_remaining_within_allowed` — the constraint
    // M5.8's verify step names. Asserted directly because a constraint
    // nobody tests is one a later migration quietly drops, and a
    // remaining count above the allowance dispenses medication nobody
    // authorized.
    const token = await seedDoctor('refill-check');
    const patientId = await seedPatient(token);
    const signed = await createSigned(token, patientId, { refillsAllowed: 2 });

    await expect(
      harness.prisma.prescription.update({
        where: { publicId: signed.id },
        data: { refillsRemaining: 3 },
      }),
    ).rejects.toThrowError();

    // And a negative one, which would compare below every threshold so
    // M13.5's refill sweep would never surface it again.
    await expect(
      harness.prisma.prescription.update({
        where: { publicId: signed.id },
        data: { refillsRemaining: -1 },
      }),
    ).rejects.toThrowError();
  });

  it('clears the refill count when therapy stops', async () => {
    const token = await seedDoctor('refill-stop');
    const patientId = await seedPatient(token);
    const signed = await createSigned(token, patientId, { refillsAllowed: 3 });

    const view = dataOf<PrescriptionView>(
      await post(token, `${signed.id}/discontinue`, { reason: 'Rash developed on day two.' }),
    );

    // Nothing is refillable once the therapy has been stopped.
    expect(view.refillsRemaining).toBe(0);
    expect(view.refillStatus).toBe('none');
  });
});

describe('RM M13.4 verify — renew copies the source Rx correctly', () => {
  it('copies the therapy and starts a fresh draft', async () => {
    const token = await seedDoctor('renew-copy');
    const patientId = await seedPatient(token);
    const source = await createSigned(token, patientId, { refillsAllowed: 1 });

    const response = await post(token, `${source.id}/renew`);

    expect(response.status).toBe(201);

    const renewed = dataOf<PrescriptionView>(response);

    // A different prescription — not the same row moved backwards.
    expect(renewed.id).not.toBe(source.id);

    // The therapy, copied verbatim.
    expect(renewed.medication.id).toBe(source.medication.id);
    expect(renewed.medication.strength).toBe(source.medication.strength);
    expect(renewed.dosage).toBe(source.dosage);
    expect(renewed.frequency).toBe(source.frequency);
    expect(renewed.route).toBe(source.route);
    expect(renewed.patient.id).toBe(source.patient.id);

    // The course, copied when not overridden.
    expect(renewed.durationDays).toBe(source.durationDays);
    expect(renewed.quantity).toBe(source.quantity);
    expect(renewed.refillsAllowed).toBe(source.refillsAllowed);
    expect(renewed.instructions).toBe(source.instructions);

    // And it is a draft: prescribed by nobody, and it must go through
    // `/sign` so the screen re-runs against the patient as they are now.
    expect(renewed.status).toBe('draft');
    expect(renewed.signedAt).toBeNull();
    expect(renewed.refillsRemaining).toBe(0);
    expect(renewed.timeline).toEqual([]);
  });

  it('leaves the source untouched and records the renewal on its timeline', async () => {
    const token = await seedDoctor('renew-source');
    const patientId = await seedPatient(token);
    const source = await createSigned(token, patientId);

    const renewed = dataOf<PrescriptionView>(await post(token, `${source.id}/renew`));
    const after = dataOf<PrescriptionView>(await detail(token, source.id));

    expect(after.status).toBe('active');

    // The `renewed` event goes on the source: that is where a reader
    // looking at the finished course asks "what happened next".
    const renewal = after.timeline.find((event) => event.kind === 'renewed');
    expect(renewal).toBeDefined();
    expect(renewal?.detail).toBe(`Renewed as ${renewed.id}`);
  });

  it('accepts overrides for the course without touching the therapy', async () => {
    const token = await seedDoctor('renew-override');
    const patientId = await seedPatient(token);
    const source = await createSigned(token, patientId);

    const renewed = dataOf<PrescriptionView>(
      await post(token, `${source.id}/renew`, {
        durationDays: 14,
        quantity: 42,
        instructions: 'Twice daily with meals.',
        startDate: '2026-10-01T00:00:00.000Z',
      }),
    );

    expect(renewed.durationDays).toBe(14);
    expect(renewed.quantity).toBe(42);
    expect(renewed.instructions).toBe('Twice daily with meals.');
    expect(renewed.startDate).toBe('2026-10-01');
    // Derived from the new start and the new duration, never copied.
    expect(renewed.endDate).toBe('2026-10-15');
    // The therapy is still the source's.
    expect(renewed.medication.id).toBe(source.medication.id);
    expect(renewed.dosage).toBe(source.dosage);
  });

  it('renews a course that has already ended', async () => {
    // The point of a renewal: `completed`, `discontinued` and `expired`
    // are terminal (ADR-002 §3), so a second course cannot be a status
    // change on the first.
    const token = await seedDoctor('renew-terminal');
    const patientId = await seedPatient(token);
    const source = await createSigned(token, patientId);

    await post(token, `${source.id}/discontinue`, { reason: 'Course completed early.' });

    const response = await post(token, `${source.id}/renew`);

    expect(response.status).toBe(201);
    expect(dataOf<PrescriptionView>(response).status).toBe('draft');
  });

  it('refuses to renew a draft — it was never prescribed', async () => {
    const token = await seedDoctor('renew-draft');
    const patientId = await seedPatient(token);
    const draft = await createDraft(token, patientId);

    const response = await post(token, `${draft.id}/renew`);

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('invalid_status_transition');
  });

  it('re-screens the renewal rather than inheriting the source’s verdict', async () => {
    // The easiest way to re-prescribe a drug a patient has since become
    // allergic to would be a renewal that skipped the screen.
    const token = await seedDoctor('renew-rescreen');
    const patientId = await seedPatient(token);
    const source = await createSigned(token, patientId);

    const patient = await harness.prisma.patient.findFirstOrThrow({
      where: { publicId: patientId },
      select: { id: true },
    });
    await harness.prisma.patientAllergy.create({
      data: {
        ...(await soleRecordOf(harness.prisma, patient.id)),
        patientId: patient.id,
        allergen: 'Penicillin',
        severity: 'SEVERE',
        reaction: 'Anaphylaxis',
      },
    });

    const renewed = dataOf<PrescriptionView>(await post(token, `${source.id}/renew`));
    const response = await post(token, `${renewed.id}/sign`);

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('allergy_conflict');
  });

  it('refuses to renew a controlled medication with refills', async () => {
    const token = await seedDoctor('renew-controlled');
    const patientId = await seedPatient(token);
    const source = await createSigned(token, patientId);

    await harness.prisma.medication.update({
      where: { id: amoxilId },
      data: { isControlled: true },
    });

    try {
      const response = await post(token, `${source.id}/renew`, { refillsAllowed: 2 });

      expect(response.status).toBe(422);
    } finally {
      await harness.prisma.medication.update({
        where: { id: amoxilId },
        data: { isControlled: false },
      });
    }
  });
});

describe('POST /prescriptions/{id}/discontinue and /cancel (§7.9)', () => {
  it('writes `discontinued` for both routes, told apart by the record', async () => {
    // ADR-002 §4: neither the coded enum nor the timeline vocabulary has
    // a `cancelled` value, so the distinction lives in the audit event
    // and the timeline detail, not in the status column.
    const token = await seedDoctor('stop-both');
    // Two patients, not two prescriptions for one: a second Amoxil for
    // the same patient is duplicate therapy and needs acknowledgment,
    // which is the screen doing its job rather than a setup detail.
    const onePatient = await seedPatient(token);
    const twoPatient = await seedPatient(token);

    const one = await createSigned(token, onePatient);
    const two = await createSigned(token, twoPatient);

    const discontinued = dataOf<PrescriptionView>(
      await post(token, `${one.id}/discontinue`, { reason: 'Adverse reaction reported.' }),
    );
    const cancelled = dataOf<PrescriptionView>(
      await post(token, `${two.id}/cancel`, { reason: 'Issued to the wrong patient.' }),
    );

    expect(discontinued.status).toBe('discontinued');
    expect(cancelled.status).toBe('discontinued');

    expect(discontinued.timeline[0]?.detail).toBe(
      'discontinue: Adverse reaction reported.',
    );
    expect(cancelled.timeline[0]?.detail).toBe('cancel: Issued to the wrong patient.');
  });

  it('stores the P4 reason on the prescription', async () => {
    const token = await seedDoctor('stop-reason');
    const patientId = await seedPatient(token);
    const signed = await createSigned(token, patientId);

    const view = dataOf<PrescriptionView>(
      await post(token, `${signed.id}/discontinue`, { reason: 'Patient reported dizziness.' }),
    );

    expect(view.discontinuedReason).toBe('Patient reported dizziness.');
  });

  it('refuses a stop with no reason', async () => {
    const token = await seedDoctor('stop-noreason');
    const patientId = await seedPatient(token);
    const signed = await createSigned(token, patientId);

    for (const body of [{}, { reason: '   ' }]) {
      const response = await post(token, `${signed.id}/discontinue`, body);

      expect(response.status).toBe(422);
    }
  });

  it('refuses to cancel an unsent draft, and says why (D-13.1)', async () => {
    // ADR-002 §3 lists `draft → discontinued` and the M5.10 trigger
    // permits it — but `prescriptions_signed_at_matches_status` requires
    // a signature on every status past `draft`, and a withdrawn draft
    // was signed by nobody. The two artefacts contradict each other on
    // exactly this transition.
    //
    // Refused with a named 409 rather than resolved by inventing:
    // stamping `signed_at` would record that a clinician signed a
    // prescription they explicitly withdrew, and relaxing the CHECK is a
    // schema decision. An abandoned draft may simply be left — it
    // dispenses nothing and never reaches the medication list.
    const token = await seedDoctor('stop-draft');
    const patientId = await seedPatient(token);
    const draft = await createDraft(token, patientId);

    const response = await post(token, `${draft.id}/cancel`, { reason: 'Entered in error.' });

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('draft_not_discontinuable');
    expect(errorBody(response).detail).toContain('D-13.1');

    // And it really is still a draft — not half-cancelled.
    const after = dataOf<PrescriptionView>(await detail(token, draft.id));
    expect(after.status).toBe('draft');
  });

  it('refuses to stop a prescription that has already ended', async () => {
    const token = await seedDoctor('stop-twice');
    const patientId = await seedPatient(token);
    const signed = await createSigned(token, patientId);

    await post(token, `${signed.id}/discontinue`, { reason: 'First stop.' });
    const second = await post(token, `${signed.id}/discontinue`, { reason: 'Second stop.' });

    expect(second.status).toBe(409);
    expect(errorBody(second).code).toBe('invalid_status_transition');
  });
});

/**
 * BR-DEC-002 (DEC-002), ADR-044 — discarding an unsigned draft.
 *
 * `/cancel` and `/discontinue` refuse a draft (D-13.1), so an abandoned
 * draft could only be left. The discard is a soft delete: gone from every
 * read, kept as a row the audit event names.
 */
describe('DELETE /prescriptions/{id} — discard a draft (BR-DEC-002)', () => {
  it('discards the prescriber’s own draft: gone from reads, kept as a row, audited', async () => {
    const token = await seedDoctor('discard-own');
    const patientId = await seedPatient(token);
    const draft = await createDraft(token, patientId);

    const response = await request(harness.server)
      .delete(`${PRESCRIPTIONS}/${draft.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status, JSON.stringify(response.body)).toBe(204);
    expect((await detail(token, draft.id)).status).toBe(404);

    const list = await request(harness.server)
      .get(PRESCRIPTIONS)
      .set('Authorization', `Bearer ${token}`);
    expect(JSON.stringify(list.body)).not.toContain(draft.id);

    // The row survives, so the audit event below still names something.
    const row = await harness.prisma.prescription.findUniqueOrThrow({
      where: { publicId: draft.id },
      select: { status: true, deletedAt: true, signedAt: true },
    });
    expect(row.status).toBe('DRAFT');
    expect(row.signedAt).toBeNull();
    expect(row.deletedAt).not.toBeNull();

    const audit = await harness.prisma.auditEvent.findFirst({
      where: { eventType: 'prescription.discard', target: `prescription:${draft.id}` },
    });
    expect(audit?.summary).toBe('Prescription discarded');
  });

  it('refuses a signed prescription with 409 and leaves it in force', async () => {
    const token = await seedDoctor('discard-signed');
    const patientId = await seedPatient(token);
    const signed = await createSigned(token, patientId);

    const response = await request(harness.server)
      .delete(`${PRESCRIPTIONS}/${signed.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('prescription_not_draft');

    const after = await detail(token, signed.id);
    expect(after.status).toBe(200);
    expect(dataOf<PrescriptionView>(after).status).toBe(signed.status);
  });

  it('gives another doctor the 404 a missing prescription gets, and keeps the draft', async () => {
    const prescriber = await seedDoctor('discard-prescriber');
    const other = await seedDoctor('discard-other');
    const patientId = await seedPatient(prescriber);
    const draft = await createDraft(prescriber, patientId);

    const response = await request(harness.server)
      .delete(`${PRESCRIPTIONS}/${draft.id}`)
      .set('Authorization', `Bearer ${other}`);
    const missing = await request(harness.server)
      .delete(`${PRESCRIPTIONS}/RX-999999999`)
      .set('Authorization', `Bearer ${other}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual(missing.body);
    expect((await detail(prescriber, draft.id)).status).toBe(200);
  });

  it('answers 404 to a second discard rather than succeeding twice', async () => {
    const token = await seedDoctor('discard-twice');
    const patientId = await seedPatient(token);
    const draft = await createDraft(token, patientId);

    const first = await request(harness.server)
      .delete(`${PRESCRIPTIONS}/${draft.id}`)
      .set('Authorization', `Bearer ${token}`);
    const second = await request(harness.server)
      .delete(`${PRESCRIPTIONS}/${draft.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(first.status).toBe(204);
    expect(second.status).toBe(404);
  });
});

describe('POST /prescriptions/{id}/notes (§7.10)', () => {
  it('adds a note and announces it on the timeline', async () => {
    const token = await seedDoctor('note-add');
    const patientId = await seedPatient(token);
    const signed = await createSigned(token, patientId);

    const response = await post(token, `${signed.id}/notes`, {
      body: 'Patient counselled on completing the full course.',
    });

    expect(response.status).toBe(201);

    const view = dataOf<PrescriptionView>(response);

    expect(view.notes).toHaveLength(1);
    expect(view.notes[0]?.body).toBe('Patient counselled on completing the full course.');

    const event = view.timeline.find((entry) => entry.kind === 'note-added');
    expect(event).toBeDefined();
    // The note's text is not copied onto the timeline: it can be 4 000
    // characters and the timeline is a list of headlines.
    expect(event?.detail).toBe('Note added');
  });

  it('refuses an empty note', async () => {
    const token = await seedDoctor('note-empty');
    const patientId = await seedPatient(token);
    const signed = await createSigned(token, patientId);

    const response = await post(token, `${signed.id}/notes`, { body: '   ' });

    expect(response.status).toBe(422);
  });
});

describe('GET /prescriptions (§7.3)', () => {
  it('serves the prescriber’s own list and nobody else’s', async () => {
    const mine = await seedDoctor('list-mine');
    const theirs = await seedDoctor('list-theirs');
    const minePatient = await seedPatient(mine);
    const theirPatient = await seedPatient(theirs);

    const own = await createSigned(mine, minePatient);
    await createSigned(theirs, theirPatient);

    const page = dataOf<Page<PrescriptionView>>(
      await request(harness.server)
        .get(`${PRESCRIPTIONS}?pageSize=100`)
        .set('Authorization', `Bearer ${mine}`),
    );

    expect(page.items.map((item) => item.id)).toContain(own.id);
    // Scoped by `prescribing_doctor_id` in the WHERE clause, not
    // filtered afterwards.
    expect(page.items.every((item) => item.patient.id === minePatient)).toBe(true);
  });

  it('filters by status and by refill status', async () => {
    const token = await seedDoctor('list-filter');
    const patientId = await seedPatient(token);
    const draft = await createDraft(token, patientId);
    const signed = await createSigned(token, patientId, { refillsAllowed: 2 });

    const drafts = dataOf<Page<PrescriptionView>>(
      await request(harness.server)
        .get(`${PRESCRIPTIONS}?status=draft&pageSize=100`)
        .set('Authorization', `Bearer ${token}`),
    );
    expect(drafts.items.map((item) => item.id)).toContain(draft.id);
    expect(drafts.items.map((item) => item.id)).not.toContain(signed.id);

    const refillable = dataOf<Page<PrescriptionView>>(
      await request(harness.server)
        .get(`${PRESCRIPTIONS}?refillStatus=available&pageSize=100`)
        .set('Authorization', `Bearer ${token}`),
    );
    expect(refillable.items.map((item) => item.id)).toContain(signed.id);
    expect(refillable.items.map((item) => item.id)).not.toContain(draft.id);
  });

  it('filters by medication name and by patient', async () => {
    const token = await seedDoctor('list-med');
    const patientId = await seedPatient(token);
    const signed = await createSigned(token, patientId);

    const byGeneric = dataOf<Page<PrescriptionView>>(
      await request(harness.server)
        .get(`${PRESCRIPTIONS}?medication=amoxicillin&pageSize=100`)
        .set('Authorization', `Bearer ${token}`),
    );
    expect(byGeneric.items.map((item) => item.id)).toContain(signed.id);

    const byPatient = dataOf<Page<PrescriptionView>>(
      await request(harness.server)
        .get(`${PRESCRIPTIONS}?patientId=${patientId}&pageSize=100`)
        .set('Authorization', `Bearer ${token}`),
    );
    expect(byPatient.items.map((item) => item.id)).toContain(signed.id);
  });

  it('refuses a status outside the vocabulary', async () => {
    const token = await seedDoctor('list-badstatus');

    const response = await request(harness.server)
      .get(`${PRESCRIPTIONS}?status=cancelled`)
      .set('Authorization', `Bearer ${token}`);

    // `cancelled` is a UX badge label, not an enum value (ADR-002 §5).
    expect(response.status).toBe(422);
  });
});

describe('the timeline vocabulary', () => {
  it('reaches five of the eight kinds from the routes API §7 defines', async () => {
    const token = await seedDoctor('timeline-kinds');
    const patientId = await seedPatient(token);

    const source = await createSigned(token, patientId);
    await post(token, `${source.id}/notes`, { body: 'Counselled.' });
    const renewed = dataOf<PrescriptionView>(await post(token, `${source.id}/renew`));
    await post(token, `${source.id}/discontinue`, { reason: 'Replaced by the renewal.' });

    const view = dataOf<PrescriptionView>(await detail(token, source.id));
    const kinds = view.timeline.map((event) => event.kind);

    expect(kinds).toContain('prescribed');
    expect(kinds).toContain('note-added');
    expect(kinds).toContain('renewed');
    expect(kinds).toContain('discontinued');
    expect(renewed.status).toBe('draft');

    // `expired` is the sweep's (M13.5). `dispensed`, `refill-requested`
    // and `refill-approved` have **no route in API §7** — see the M13.4
    // note in the roadmap. Asserting their absence keeps that a recorded
    // gap rather than one that closes by accident.
    expect(kinds).not.toContain('dispensed');
    expect(kinds).not.toContain('refill-requested');
    expect(kinds).not.toContain('refill-approved');
  });

  it('is ordered newest first', async () => {
    const token = await seedDoctor('timeline-order');
    const patientId = await seedPatient(token);
    const signed = await createSigned(token, patientId);

    await post(token, `${signed.id}/notes`, { body: 'Second thing that happened.' });

    const view = dataOf<PrescriptionView>(await detail(token, signed.id));

    expect(view.timeline[0]?.kind).toBe('note-added');
    expect(view.timeline[1]?.kind).toBe('prescribed');
  });
});
