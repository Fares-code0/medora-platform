import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type AuthHarness, createAuthHarness, dataOf, errorBody } from './support/auth-app';
import {
  destroyLabFixtures,
  LAB_ORDERS,
  orderTest,
  post,
  seedDoctor,
  seedPatient,
  toProcessing,
  type LabOrderView,
} from './support/lab-fixture';

/**
 * Attach-to-record and attachments (RM M14.7 — API §8.9, §8.11).
 *
 * The verify step names the **identity-mismatch test**, and it gets its
 * own `describe`. The failure it guards against — a result filed onto
 * the wrong patient's chart — is one of the few in this product that
 * reading the screen again does not undo, so these assert that nothing
 * is written rather than that a message was shown.
 *
 * The frontend's `assessAttachability`
 * (`shared-domain/record-attachments/attachability.ts`) is the rank-1
 * source for the five refusals, and its own spec spells out the one that
 * looks like over-strictness and is not: **a matching name with a
 * differing MRN is refused**, because it means one of the two records is
 * wrong about who this is, which is precisely when a human should stop.
 *
 * ## §8.11 and the M25 dependency, tested in both states
 *
 * Uploading bytes goes through the `FILE_STORAGE` port, which answers
 * 503 until M25 wires MinIO. Both states are proven: against the real
 * unconfigured stub the route answers 503 and writes no `files` row,
 * and against an in-memory implementation — substituted the way RM
 * M13.3's chaos test substitutes `INTERACTION_SOURCE` — the whole flow
 * runs end to end.
 */
let harness: AuthHarness;

const charts: string[] = [];

let doctorToken = '';
let strangerToken = '';
let patient = { id: '', name: '', mrn: '' };
let otherPatient = { id: '', name: '', mrn: '' };

const RECORDS = '/api/v1/medical-records';

interface RecordView {
  id: string;
  attachments: { id: string; name: string; kind: string; sizeKb: number }[];
  timeline: { kind: string; detail: string }[];
}

interface AttachResult {
  recordId: string;
  labOrderId: string;
  attachmentIds: string[];
}

/** A released order for this patient, ready to attach. */
async function releasedOrder(patientId: string): Promise<LabOrderView> {
  const order = await orderTest(harness, doctorToken, patientId);
  await toProcessing(harness, doctorToken, order.id);
  await post(harness, doctorToken, `/${order.id}/results`, {
    results: [{ analyte: 'Potassium', value: '4.2' }],
  }).expect(200);

  return dataOf<LabOrderView>(
    await post(harness, doctorToken, `/${order.id}/transition`, { to: 'completed' }).expect(200),
  );
}

async function createRecord(patientId: string): Promise<string> {
  const response = await request(harness.server)
    .post(RECORDS)
    .set('Authorization', `Bearer ${doctorToken}`)
    .send({
      patientId,
      visitDate: '2026-09-10T09:00:00.000Z',
      visitType: 'Consultation',
      priority: 'normal',
      chiefComplaint: 'Hypertension review',
      historyOfPresentIllness: 'Stable on current therapy.',
      physicalExamination: 'BP 128/78. No oedema.',
    });

  expect(response.status).toBe(201);

  return dataOf<{ id: string }>(response).id;
}

/**
 * Boots a second application with `FILE_STORAGE` bound to an in-memory
 * implementation, so §8.11 can be driven against a port that works.
 *
 * The bytes are kept in a Map rather than written anywhere: what is
 * under test is the module's own behaviour around the port — that the
 * `files` row is created only after `put()` resolves, that the checksum
 * is computed from what was stored, and that attach-to-record reuses the
 * file rather than copying it.
 */
async function withWorkingStorage<T>(
  run: (server: Parameters<typeof request>[0]) => Promise<T>,
): Promise<T> {
  const { Test } = await import('@nestjs/testing');
  const { AppModule } = await import('../src/app.module');
  const { FILE_STORAGE } = await import('../src/shared/files');
  const { PLATFORM_POLICY_SOURCE } = await import('../src/config/policy.types');

  const stored = new Map<string, Buffer>();
  let sequence = 0;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PLATFORM_POLICY_SOURCE)
    .useValue({ load: () => Promise.resolve({}) })
    .overrideProvider(FILE_STORAGE)
    .useValue({
      put: (upload: { name: string; mimeType: string; content: Buffer }) => {
        sequence += 1;
        const key = `lab_attachment/${String(sequence)}-${upload.name}`;
        stored.set(key, upload.content);

        return Promise.resolve({
          id: key,
          key,
          name: upload.name,
          mimeType: upload.mimeType,
          sizeBytes: upload.content.byteLength,
          scanStatus: 'clean',
        });
      },
      signedDownloadUrl: (key: string) => Promise.resolve(`https://example.test/${key}`),
      remove: (key: string) => {
        stored.delete(key);
        return Promise.resolve();
      },
    })
    .compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  await app.init();

  try {
    return await run(app.getHttpServer() as Parameters<typeof request>[0]);
  } finally {
    await app.close();
  }
}

/** A tiny, genuinely base64 payload. */
const REPORT_BYTES = Buffer.from('%PDF-1.4 a lab report').toString('base64');

function uploadBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Basic Metabolic Panel.pdf',
    kind: 'report',
    mimeType: 'application/pdf',
    content: REPORT_BYTES,
    ...overrides,
  };
}

beforeAll(async () => {
  harness = await createAuthHarness('lab-attachments');

  doctorToken = await seedDoctor(harness, 'attach-doctor');
  strangerToken = await seedDoctor(harness, 'attach-stranger');

  patient = await seedPatient(harness, doctorToken);
  charts.push(patient.id);

  otherPatient = await seedPatient(harness, doctorToken, { fullName: 'Omar Farouk' });
  charts.push(otherPatient.id);
}, 60_000);

afterAll(async () => {
  if (harness === undefined) return;

  await destroyLabFixtures(harness, charts);
  await harness.reset();
  await harness.close();
});

describe('RM M14.7 verify — the identity-mismatch test', () => {
  it('refuses a confirmed name that is not this result patient', async () => {
    await withWorkingStorage(async (server) => {
      const order = await releasedOrder(patient.id);
      const recordId = await createRecord(patient.id);
      await uploadReport(server, order.id);

      const response = await request(server)
        .post(`${LAB_ORDERS}/${order.id}/attach-to-record`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          recordId,
          confirmedPatient: { name: 'Someone Else', mrn: patient.mrn },
        });

      expect(response.status).toBe(422);
      expect(errorBody(response).code).toBe('patient_identity_mismatch');
      expect(errorBody(response).fieldErrors?.['confirmedPatient.name']).toBeDefined();
      // The correct name is deliberately **not** echoed: a mismatch
      // response that said "this is actually Layla Morsi" would turn the
      // identity check into a lookup.
      expect(JSON.stringify(errorBody(response))).not.toContain(patient.name);

      await expectNothingAttached(recordId);
    });
  });

  it('refuses a matching name with a differing MRN', async () => {
    // Not a near miss to be waved through: it means one of the two
    // records is wrong about who this is.
    await withWorkingStorage(async (server) => {
      const order = await releasedOrder(patient.id);
      const recordId = await createRecord(patient.id);
      await uploadReport(server, order.id);

      const response = await request(server)
        .post(`${LAB_ORDERS}/${order.id}/attach-to-record`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          recordId,
          confirmedPatient: { name: patient.name, mrn: '9999-99' },
        });

      expect(response.status).toBe(422);
      expect(errorBody(response).fieldErrors?.['confirmedPatient.mrn']).toBeDefined();
      // The two fields are compared **independently**, so a right name
      // does not carry a wrong MRN through.
      expect(errorBody(response).fieldErrors?.['confirmedPatient.name']).toBeUndefined();

      await expectNothingAttached(recordId);
    });
  });

  it('names both fields when both are wrong', async () => {
    await withWorkingStorage(async (server) => {
      const order = await releasedOrder(patient.id);
      const recordId = await createRecord(patient.id);
      await uploadReport(server, order.id);

      const response = await request(server)
        .post(`${LAB_ORDERS}/${order.id}/attach-to-record`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ recordId, confirmedPatient: { name: 'Someone Else', mrn: '9999-99' } });

      expect(Object.keys(errorBody(response).fieldErrors ?? {}).sort()).toEqual([
        'confirmedPatient.mrn',
        'confirmedPatient.name',
      ]);
    });
  });

  it('accepts the confirmed identity trimmed and however it is cased', async () => {
    // A clinician typing a confirmation should not be defeated by a
    // capital; the check is about identity, not about keystrokes.
    await withWorkingStorage(async (server) => {
      const order = await releasedOrder(patient.id);
      const recordId = await createRecord(patient.id);
      await uploadReport(server, order.id);

      const response = await request(server)
        .post(`${LAB_ORDERS}/${order.id}/attach-to-record`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          recordId,
          confirmedPatient: { name: `  ${patient.name.toUpperCase()} `, mrn: patient.mrn },
        });

      expect(response.status).toBe(201);
    });
  });

  it('refuses a record that belongs to another patient, as unknown', async () => {
    // Confirming that `MR-…` exists but belongs to someone else is a
    // disclosure about a chart the caller has no relationship with.
    await withWorkingStorage(async (server) => {
      const order = await releasedOrder(patient.id);
      const foreignRecord = await createRecord(otherPatient.id);
      await uploadReport(server, order.id);

      const response = await request(server)
        .post(`${LAB_ORDERS}/${order.id}/attach-to-record`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          recordId: foreignRecord,
          confirmedPatient: { name: patient.name, mrn: patient.mrn },
        });

      expect(response.status).toBe(422);
      expect(errorBody(response).fieldErrors?.['recordId']?.[0]).toBe(
        'No such record for this patient.',
      );

      await expectNothingAttached(foreignRecord);
    });
  });

  it('answers a record that does not exist the same way', async () => {
    await withWorkingStorage(async (server) => {
      const order = await releasedOrder(patient.id);
      await uploadReport(server, order.id);

      const response = await request(server)
        .post(`${LAB_ORDERS}/${order.id}/attach-to-record`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          recordId: 'MR-999999',
          confirmedPatient: { name: patient.name, mrn: patient.mrn },
        });

      // Byte-identical to the refusal above.
      expect(response.status).toBe(422);
      expect(errorBody(response).fieldErrors?.['recordId']?.[0]).toBe(
        'No such record for this patient.',
      );
    });
  });
});

describe('attach-to-record, when the identity agrees (§8.9)', () => {
  it('files the report onto the record as kind lab-result', async () => {
    await withWorkingStorage(async (server) => {
      const order = await releasedOrder(patient.id);
      const recordId = await createRecord(patient.id);
      await uploadReport(server, order.id);

      const response = await request(server)
        .post(`${LAB_ORDERS}/${order.id}/attach-to-record`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ recordId, confirmedPatient: { name: patient.name, mrn: patient.mrn } });

      expect(response.status).toBe(201);
      const result = dataOf<AttachResult>(response);
      expect(result).toMatchObject({ recordId, labOrderId: order.id });
      expect(result.attachmentIds).toHaveLength(1);

      const record = dataOf<RecordView>(
        await request(server)
          .get(`${RECORDS}/${recordId}`)
          .set('Authorization', `Bearer ${doctorToken}`)
          .expect(200),
      );

      // RM M15.1's verify step, put in place here: "attached report
      // appears in the record's attachments (kind `lab-result`)".
      expect(record.attachments).toHaveLength(1);
      expect(record.attachments[0]?.kind).toBe('lab-result');
      expect(record.attachments[0]?.name).toBe('Basic Metabolic Panel.pdf');
    });
  });

  it('writes an attachment-added event on the record own timeline', async () => {
    // An attachment a reader cannot see arriving is a document that
    // appeared in a chart with nobody attached to it.
    await withWorkingStorage(async (server) => {
      const order = await releasedOrder(patient.id);
      const recordId = await createRecord(patient.id);
      await uploadReport(server, order.id);

      await request(server)
        .post(`${LAB_ORDERS}/${order.id}/attach-to-record`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ recordId, confirmedPatient: { name: patient.name, mrn: patient.mrn } })
        .expect(201);

      const record = dataOf<RecordView>(
        await request(server)
          .get(`${RECORDS}/${recordId}`)
          .set('Authorization', `Bearer ${doctorToken}`)
          .expect(200),
      );

      const event = record.timeline.find((entry) => entry.kind === 'attachment-added');
      expect(event?.detail).toContain(order.id);
    });
  });

  it('reuses the same file rather than copying the bytes', async () => {
    // One set of bytes, two references. A copy would double the storage
    // and, worse, create a second object a later correction would not
    // reach — a record showing a superseded result it believes is
    // current.
    await withWorkingStorage(async (server) => {
      const order = await releasedOrder(patient.id);
      const recordId = await createRecord(patient.id);
      await uploadReport(server, order.id);

      await request(server)
        .post(`${LAB_ORDERS}/${order.id}/attach-to-record`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ recordId, confirmedPatient: { name: patient.name, mrn: patient.mrn } })
        .expect(201);

      const labFile = await harness.prisma.labAttachment.findFirstOrThrow({
        where: { order: { publicId: order.id } },
        select: { fileId: true },
      });
      const recordFile = await harness.prisma.recordAttachment.findFirstOrThrow({
        where: { record: { publicId: recordId } },
        select: { fileId: true },
      });

      expect(recordFile.fileId).toBe(labFile.fileId);
    });
  });

  it('refuses a second attachment of the same report rather than doubling it', async () => {
    // Two copies of one report on one encounter is a reader wondering
    // which is current.
    await withWorkingStorage(async (server) => {
      const order = await releasedOrder(patient.id);
      const recordId = await createRecord(patient.id);
      await uploadReport(server, order.id);

      const attach = () =>
        request(server)
          .post(`${LAB_ORDERS}/${order.id}/attach-to-record`)
          .set('Authorization', `Bearer ${doctorToken}`)
          .send({ recordId, confirmedPatient: { name: patient.name, mrn: patient.mrn } });

      await attach().expect(201);
      const second = await attach();

      expect(second.status).toBe(422);
      expect(errorBody(second).fieldErrors?.['recordId']?.[0]).toContain('already attached');

      const record = dataOf<RecordView>(
        await request(server)
          .get(`${RECORDS}/${recordId}`)
          .set('Authorization', `Bearer ${doctorToken}`)
          .expect(200),
      );
      expect(record.attachments).toHaveLength(1);
    });
  });

  it('refuses an order with nothing released', async () => {
    // Filing an empty report onto a chart puts a document there that
    // says nothing and looks like it says something.
    await withWorkingStorage(async (server) => {
      const order = await orderTest(harness, doctorToken, patient.id);
      const recordId = await createRecord(patient.id);

      const response = await request(server)
        .post(`${LAB_ORDERS}/${order.id}/attach-to-record`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ recordId, confirmedPatient: { name: patient.name, mrn: patient.mrn } });

      expect(response.status).toBe(422);
      expect(errorBody(response).fieldErrors?.['labOrderId']?.[0]).toContain(
        'no released results',
      );
    });
  });

  it('refuses an order that carries no report document yet', async () => {
    await withWorkingStorage(async (server) => {
      const order = await releasedOrder(patient.id);
      const recordId = await createRecord(patient.id);

      const response = await request(server)
        .post(`${LAB_ORDERS}/${order.id}/attach-to-record`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ recordId, confirmedPatient: { name: patient.name, mrn: patient.mrn } });

      expect(response.status).toBe(422);
      expect(errorBody(response).fieldErrors?.['labOrderId']?.[0]).toContain('Upload the report');
    });
  });

  it('is care-scoped like every other write', async () => {
    await withWorkingStorage(async (server) => {
      const order = await releasedOrder(patient.id);
      const recordId = await createRecord(patient.id);
      await uploadReport(server, order.id);

      const response = await request(server)
        .post(`${LAB_ORDERS}/${order.id}/attach-to-record`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .send({ recordId, confirmedPatient: { name: patient.name, mrn: patient.mrn } });

      expect(response.status).toBe(404);
    });
  });
});

describe('uploading an attachment (§8.11)', () => {
  it('stores the bytes and lists the attachment on the order', async () => {
    await withWorkingStorage(async (server) => {
      const order = await releasedOrder(patient.id);

      const response = await request(server)
        .post(`${LAB_ORDERS}/${order.id}/attachments`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send(uploadBody());

      expect(response.status).toBe(201);
      const detail = dataOf<LabOrderView>(response);

      expect(detail.attachments).toHaveLength(1);
      expect(detail.attachments[0]).toMatchObject({
        name: 'Basic Metabolic Panel.pdf',
        kind: 'report',
      });
      // `lab_attachments_size_positive` is `> 0`, so a small file rounds
      // up to 1 rather than to zero and being refused.
      expect(detail.attachments[0]?.sizeKb).toBe(1);
    });
  });

  it('computes the checksum from the bytes that were stored', async () => {
    // A checksum a caller asserts proves nothing about what arrived.
    await withWorkingStorage(async (server) => {
      const order = await releasedOrder(patient.id);
      await request(server)
        .post(`${LAB_ORDERS}/${order.id}/attachments`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send(uploadBody())
        .expect(201);

      const { createHash } = await import('node:crypto');
      const expected = createHash('sha256')
        .update(Buffer.from(REPORT_BYTES, 'base64'))
        .digest('hex');

      const file = await harness.prisma.labAttachment.findFirstOrThrow({
        where: { order: { publicId: order.id } },
        select: { file: { select: { checksumSha256: true, kind: true } } },
      });

      expect(file.file.checksumSha256).toBe(expected);
      expect(file.file.kind).toBe('lab_attachment');
    });
  });

  it('accepts each of the four attachment kinds', async () => {
    await withWorkingStorage(async (server) => {
      const order = await releasedOrder(patient.id);

      for (const kind of ['report', 'addendum', 'external', 'raw-data']) {
        const response = await request(server)
          .post(`${LAB_ORDERS}/${order.id}/attachments`)
          .set('Authorization', `Bearer ${doctorToken}`)
          .send(uploadBody({ kind, name: `${kind}.pdf` }));

        expect(response.status, kind).toBe(201);
      }
    });
  });

  it('refuses a kind outside the vocabulary', async () => {
    await withWorkingStorage(async (server) => {
      const order = await releasedOrder(patient.id);
      const response = await request(server)
        .post(`${LAB_ORDERS}/${order.id}/attachments`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send(uploadBody({ kind: 'scan' }));

      expect(response.status).toBe(422);
    });
  });

  it('refuses content that is not base64, rather than storing garbage', async () => {
    // `Buffer.from(value, 'base64')` skips characters it does not
    // recognise instead of failing, so a corrupted upload decodes to
    // *something* and gets stored as a file nobody can open.
    await withWorkingStorage(async (server) => {
      const order = await releasedOrder(patient.id);
      const response = await request(server)
        .post(`${LAB_ORDERS}/${order.id}/attachments`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send(uploadBody({ content: 'not base64 !!!' }));

      expect(response.status).toBe(422);
      expect(errorBody(response).fieldErrors?.['content']?.[0]).toContain('base64');
    });
  });

  it('is care-scoped', async () => {
    await withWorkingStorage(async (server) => {
      const order = await releasedOrder(patient.id);
      const response = await request(server)
        .post(`${LAB_ORDERS}/${order.id}/attachments`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .send(uploadBody());

      expect(response.status).toBe(404);
    });
  });
});

describe('§8.11 against the real, unconfigured storage port', () => {
  it('answers 503 and writes no files row', async () => {
    // `UnconfiguredFileStorage` fails loudly rather than resolving
    // quietly, and the `files` row is created only after `put()`
    // resolves — so no row ever claims bytes that do not exist. This is
    // the state the platform is in until M25 wires MinIO, and it is the
    // same answer `/api/v1/health` already gives for storage.
    const order = await releasedOrder(patient.id);

    const response = await post(harness, doctorToken, `/${order.id}/attachments`, uploadBody());

    expect(response.status).toBe(503);
    expect(errorBody(response).code).toBe('service_unavailable');

    const attachments = await harness.prisma.labAttachment.count({
      where: { order: { publicId: order.id } },
    });
    expect(attachments).toBe(0);
  });
});

/** Uploads a report through a server whose storage port works. */
async function uploadReport(
  server: Parameters<typeof request>[0],
  reference: string,
): Promise<void> {
  await request(server)
    .post(`${LAB_ORDERS}/${reference}/attachments`)
    .set('Authorization', `Bearer ${doctorToken}`)
    .send(uploadBody())
    .expect(201);
}

/** A refused attach must leave the record exactly as it was. */
async function expectNothingAttached(recordId: string): Promise<void> {
  const count = await harness.prisma.recordAttachment.count({
    where: { record: { publicId: recordId } },
  });

  expect(count).toBe(0);
}
