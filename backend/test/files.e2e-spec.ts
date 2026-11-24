import { createHash } from 'node:crypto';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { OrphanSweepService } from '../src/modules/files/services/orphan-sweep.service';
// A job runs under `system` scope (JobRunnerService); called directly, so does the sweep here.
import { runAsSystem } from '../src/shared/database';
import {
  FILE_STORAGE,
  type FileStoragePort,
  type FileUpload,
  type StoredFile,
} from '../src/shared/files';
import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
  markVerified,
  registrationBody,
  testEmail,
  fixtureHospital,
  makeClinicalDoctor,
  recordPatientAt,
  soleRecordOf,
} from './support/auth-app';
import { createPatientRecords, destroyPatientRecords } from './support/patient-fixture';

/**
 * Files — API §17, RM M25.
 *
 * > ✅ Verify (M25.1): wrong MIME for kind → 422; checksum stored.
 * > ✅ Verify (M25.3): pre-scan download blocked.
 * > ✅ Verify (M25.5): soft-deleted file's object removed by the job.
 *
 * ## `FILE_STORAGE` is an in-memory double here, and that is the design
 *
 * The adapter's own contract — key layout, path-style addressing,
 * presigned expiry, error mapping — is asserted against real SDK
 * requests on a real socket in `s3-file-storage.spec.ts`. What this file
 * is about is everything the *platform* does around the bytes: the
 * per-kind rules, the checksum, the scan gate, the scope decision and
 * the sweep. Pointing it at a store would make all of that a test of the
 * store's availability, which is the pattern `lab-attachments` already
 * set ("the e2e spec binds FILE_STORAGE to an in-memory implementation
 * … and proves the flow end to end against a port that works").
 *
 * The roadmap's "green against MinIO" is **not** runnable in this
 * environment — no Docker daemon, and the MinIO download is refused by
 * egress policy. Recorded as RA-M25.1 rather than skipped quietly.
 */
class InMemoryStorage implements FileStoragePort {
  readonly objects = new Map<string, Buffer>();
  readonly removed: string[] = [];
  failRemoval = false;

  put(upload: FileUpload): Promise<StoredFile> {
    const key = `${upload.kind}/${String(this.objects.size)}-${upload.name}`;
    this.objects.set(key, upload.content);

    return Promise.resolve({
      id: key,
      key,
      name: upload.name,
      mimeType: upload.mimeType,
      sizeBytes: upload.content.byteLength,
      scanStatus: 'pending',
    });
  }

  signedDownloadUrl(key: string, ttlSeconds: number): Promise<string> {
    return Promise.resolve(`https://objects.test/${key}?ttl=${String(ttlSeconds)}`);
  }

  /** M30.2's scanner reads the bytes back; an absent key is an error. */
  get(key: string): Promise<Buffer> {
    const object = this.objects.get(key);

    return object === undefined
      ? Promise.reject(new Error(`no object at ${key}`))
      : Promise.resolve(object);
  }

  remove(key: string): Promise<void> {
    if (this.failRemoval) return Promise.reject(new Error('store refused'));

    this.removed.push(key);
    this.objects.delete(key);
    return Promise.resolve();
  }
}

let harness: AuthHarness;
const storage = new InMemoryStorage();

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const FILES = '/api/v1/files';
const PASSWORD = 'Medora123!';

let ownerToken = '';
let ownerId = '';
let strangerToken = '';
let carerToken = '';
let carerDoctorId = '';
let patientId = '';

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

const PDF = Buffer.from('%PDF-1.7 a referral letter');
// The full eight-byte signature. `Buffer.from('\x89PNG …')` UTF-8-encodes
// `\x89` as two bytes, so the string form was never a PNG header.
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('a portrait'),
]);

function upload(token: string, kind: string, name: string, type: string, body: Buffer) {
  return request(harness.server)
    .post(FILES)
    .set(as(token))
    .field('kind', kind)
    .attach('file', body, { filename: name, contentType: type });
}

interface FileView {
  readonly id: string;
  readonly name: string;
  readonly sizeKb: number;
  readonly checksumSha256: string;
  readonly scanStatus: string;
  readonly kind: string;
}

async function signUpDoctor(local: string): Promise<{ token: string; userId: string }> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  const token = dataOf<{ accessToken: string }>(
    await request(harness.server).post(LOGIN).send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;

  const user = await harness.prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  });

  return { token, userId: user.id };
}

/** Marks a file clean, the way M30.2's scanner will. */
async function markClean(fileId: string, result = 'clean'): Promise<void> {
  await harness.prisma.file.update({
    where: { id: fileId },
    data: { scannedAt: new Date(), scanResult: result },
  });
}

beforeAll(async () => {
  harness = await createAuthHarness('files-m25', {
    overrides: [{ token: FILE_STORAGE, value: storage }],
  });

  const owner = await signUpDoctor('files-owner');
  ownerToken = owner.token;
  ownerId = owner.userId;

  strangerToken = (await signUpDoctor('files-stranger')).token;

  const carer = await signUpDoctor('files-carer');
  carerToken = carer.token;
  carerDoctorId = (
    await harness.prisma.doctor.findFirstOrThrow({
      where: { userId: carer.userId },
      select: { id: true },
    })
  ).id;

  const [record] = await createPatientRecords(harness.prisma, 'f25', 1);
  patientId = record?.id ?? '';

  // DR-05: reach is a record at the doctor's hospital. The carer (and the
  // owner) work at hospital A, where the patient is recorded; the stranger
  // works at hospital B — a colleague at A would reach the chart.
  const hospitalA = await fixtureHospital(harness.prisma, 'a');
  await makeClinicalDoctor(harness.prisma, testEmail('files-owner'), hospitalA);
  await makeClinicalDoctor(harness.prisma, testEmail('files-carer'), hospitalA);
  await makeClinicalDoctor(
    harness.prisma,
    testEmail('files-stranger'),
    await fixtureHospital(harness.prisma, 'b'),
  );
  await recordPatientAt(harness.prisma, patientId, hospitalA);

  await harness.prisma.patientDoctorAssignment.create({
    data: { patientId, doctorId: carerDoctorId, role: 'primary' },
  });
}, 90_000);

afterAll(async () => {
  if (harness === undefined) return;

  await harness.prisma.patientDocument.deleteMany({ where: { patientId } });
  await harness.prisma.patientDoctorAssignment.deleteMany({ where: { patientId } });
  await destroyPatientRecords(harness.prisma, 'f25');
  await harness.prisma.file.deleteMany({ where: { originalName: { startsWith: 'M25 ' } } });

  await harness.reset();
  await harness.close();
});

describe('M25.1 — upload validates per kind and stores a checksum', () => {
  it('stores the file and the hash of the bytes that arrived', async () => {
    const response = await upload(ownerToken, 'patient_document', 'M25 referral.pdf', 'application/pdf', PDF);

    expect(response.status, JSON.stringify(response.body)).toBe(201);

    const view = dataOf<FileView>(response);

    // Computed server-side over the received buffer. A checksum the
    // client asserts proves nothing about what was stored.
    expect(view.checksumSha256).toBe(createHash('sha256').update(PDF).digest('hex'));
    expect(view.scanStatus).toBe('pending');
    expect(view.sizeKb).toBe(1);

    const row = await harness.prisma.file.findUniqueOrThrow({ where: { id: view.id } });
    expect(row.checksumSha256).toBe(view.checksumSha256);
    expect(Number(row.sizeBytes)).toBe(PDF.byteLength);
    // The row is written *after* the object, so the two cannot disagree.
    expect(storage.objects.has(row.storageKey)).toBe(true);
  });

  it('refuses a MIME type the kind does not allow, and stores nothing', async () => {
    const before = storage.objects.size;
    const response = await upload(ownerToken, 'branding_asset', 'M25 logo.pdf', 'application/pdf', PDF);

    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors?.['file']?.[0]).toContain('image/png');
    // The check runs before the port, so a refused type never reaches
    // the store — and never leaves an object with no row behind it.
    expect(storage.objects.size).toBe(before);
  });

  it('refuses content that is not the type it was declared as, and stores nothing', async () => {
    const before = storage.objects.size;
    // An SVG with a script, declared as the PNG the branding allowlist
    // accepts — the stored-XSS path the SVG exclusion is meant to close.
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>');
    const response = await upload(ownerToken, 'branding_asset', 'M25 logo.png', 'image/png', svg);

    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors?.['file']).toEqual(["The file's content is not image/png"]);
    expect(storage.objects.size).toBe(before);
  });

  it('refuses an empty file', async () => {
    const response = await upload(
      ownerToken,
      'patient_document',
      'M25 empty.pdf',
      'application/pdf',
      Buffer.alloc(0),
    );

    expect(response.status).toBe(422);
  });

  it('refuses an unknown kind', async () => {
    const response = await upload(ownerToken, 'backup_artifact', 'M25 dump.pdf', 'application/pdf', PDF);

    // `backup_artifact` is in the `files_kind_check` constraint but not
    // in API §17.1's seven — no client may mint one.
    expect(response.status).toBe(422);
  });

  it('refuses a request with no file part', async () => {
    const response = await request(harness.server)
      .post(FILES)
      .set(as(ownerToken))
      .field('kind', 'patient_document');

    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors?.['file']).toBeDefined();
  });

  it('requires authentication', async () => {
    await request(harness.server).post(FILES).field('kind', 'patient_document').expect(401);
  });
});

describe('M25.3 — download is gated on the scan', () => {
  it('refuses an unscanned file with 403 scan_pending', async () => {
    const file = dataOf<FileView>(
      await upload(ownerToken, 'patient_document', 'M25 unscanned.pdf', 'application/pdf', PDF),
    );

    const response = await request(harness.server)
      .get(`${FILES}/${file.id}/download`)
      .set(as(ownerToken));

    expect(response.status).toBe(403);
    expect(errorBody(response).code).toBe('scan_pending');
  });

  it('refuses an infected file, and says so', async () => {
    const file = dataOf<FileView>(
      await upload(ownerToken, 'patient_document', 'M25 infected.pdf', 'application/pdf', PDF),
    );
    await markClean(file.id, 'infected');

    const response = await request(harness.server)
      .get(`${FILES}/${file.id}/download`)
      .set(as(ownerToken));

    // The gate turns on `scan_result = 'clean'`, not on `scanned_at`.
    // A gate on the timestamp would open for exactly this file.
    expect(response.status).toBe(403);
    expect(errorBody(response).message).toContain('rejected');
  });

  it('issues a short-TTL URL once the file is clean', async () => {
    const file = dataOf<FileView>(
      await upload(ownerToken, 'patient_document', 'M25 clean.pdf', 'application/pdf', PDF),
    );
    await markClean(file.id);

    const response = await request(harness.server)
      .get(`${FILES}/${file.id}/download`)
      .set(as(ownerToken));

    expect(response.status).toBe(200);
    expect(dataOf<{ url: string; expiresInSeconds: number }>(response).expiresInSeconds).toBe(60);
  });

  it('refuses before it reveals — an unscoped caller gets 404, not 403', async () => {
    const file = dataOf<FileView>(
      await upload(ownerToken, 'patient_document', 'M25 private.pdf', 'application/pdf', PDF),
    );

    // Unscanned *and* out of scope. The scope check must run first: a
    // 403 `scan_pending` here would confirm the file exists to anyone
    // walking ids.
    const response = await request(harness.server)
      .get(`${FILES}/${file.id}/download`)
      .set(as(strangerToken));

    expect(response.status).toBe(404);
  });
});

describe('API §17.2 — who may read a file', () => {
  it('lets the uploader read their own', async () => {
    const file = dataOf<FileView>(
      await upload(ownerToken, 'patient_document', 'M25 mine.pdf', 'application/pdf', PDF),
    );

    expect((await request(harness.server).get(`${FILES}/${file.id}`).set(as(ownerToken))).status).toBe(
      200,
    );
  });

  it('hides an unlinked file from everyone else', async () => {
    const file = dataOf<FileView>(
      await upload(ownerToken, 'patient_document', 'M25 unlinked.pdf', 'application/pdf', PDF),
    );

    expect(
      (await request(harness.server).get(`${FILES}/${file.id}`).set(as(strangerToken))).status,
    ).toBe(404);
  });

  it('opens a linked document to a doctor in care scope, and to nobody else', async () => {
    const file = dataOf<FileView>(
      await upload(ownerToken, 'patient_document', 'M25 linked.pdf', 'application/pdf', PDF),
    );

    // Linked as the application links it: the file joins the chart's
    // hospital and the document is stamped with it (F-06, F-14).
    const stamp = await soleRecordOf(harness.prisma, patientId);
    await harness.prisma.file.update({ where: { id: file.id }, data: { hospitalId: stamp.hospitalId } });
    await harness.prisma.patientDocument.create({
      data: {
        ...stamp,
        patientId,
        name: 'Referral',
        category: 'REFERRAL',
        sizeKb: 1,
        fileId: file.id,
        uploadedBy: ownerId,
      },
    });

    // The care relationship is the authority — `PatientScopeService`,
    // the same one every clinical read goes through.
    expect((await request(harness.server).get(`${FILES}/${file.id}`).set(as(carerToken))).status).toBe(
      200,
    );
    // A doctor with no assignment to this patient is refused, and the
    // refusal does not confirm the file exists.
    expect(
      (await request(harness.server).get(`${FILES}/${file.id}`).set(as(strangerToken))).status,
    ).toBe(404);
  });

  it('keeps a file to its hospital, and the checksum to its uploader (F-14)', async () => {
    const file = dataOf<FileView>(
      await upload(ownerToken, 'patient_document', 'M25 scoped.pdf', 'application/pdf', PDF),
    );
    const stamp = await soleRecordOf(harness.prisma, patientId);
    await harness.prisma.file.update({ where: { id: file.id }, data: { hospitalId: stamp.hospitalId } });
    await harness.prisma.patientDocument.create({
      data: { ...stamp, patientId, name: 'Scoped', category: 'REFERRAL', sizeKb: 1, fileId: file.id },
    });

    const asOwner = await request(harness.server).get(`${FILES}/${file.id}`).set(as(ownerToken));
    expect(asOwner.status).toBe(200);
    expect(dataOf<Record<string, unknown>>(asOwner)).toHaveProperty('checksumSha256');
    const asCarer = await request(harness.server).get(`${FILES}/${file.id}`).set(as(carerToken));
    expect(asCarer.status).toBe(200);
    expect(dataOf<Record<string, unknown>>(asCarer)).not.toHaveProperty('checksumSha256');

    // The stranger now reaches the patient too — through a record at their
    // own hospital B — and still cannot open hospital A's file.
    const hospitalB = await fixtureHospital(harness.prisma, 'b');
    const recordB = await recordPatientAt(harness.prisma, patientId, hospitalB);
    try {
      for (const path of [`${FILES}/${file.id}`, `${FILES}/${file.id}/download`]) {
        expect((await request(harness.server).get(path).set(as(strangerToken))).status, path).toBe(404);
      }
    } finally {
      await harness.prisma.hospitalMedicalRecord.delete({ where: { id: recordB } });
    }
  });

  it('lets any signed-in user read a profile photo', async () => {
    const file = dataOf<FileView>(
      await upload(ownerToken, 'profile_photo', 'M25 portrait.png', 'image/png', PNG),
    );

    // An avatar is rendered beside a name in every list in the product;
    // scoping it would mean a broken image wherever the viewer is not
    // the subject. It carries no PHI.
    expect(
      (await request(harness.server).get(`${FILES}/${file.id}`).set(as(strangerToken))).status,
    ).toBe(200);
  });

  it('answers 404 for an id that is not a file, and for one that is not a uuid', async () => {
    expect(
      (
        await request(harness.server)
          .get(`${FILES}/00000000-0000-4000-8000-000000000000`)
          .set(as(ownerToken))
      ).status,
    ).toBe(404);
    expect(
      (await request(harness.server).get(`${FILES}/not-a-uuid`).set(as(ownerToken))).status,
    ).toBe(404);
  });
});

describe('API §17.3 — delete is the owner’s, and is a soft delete', () => {
  it('soft-deletes and leaves the row', async () => {
    const file = dataOf<FileView>(
      await upload(ownerToken, 'patient_document', 'M25 doomed.pdf', 'application/pdf', PDF),
    );

    await request(harness.server).delete(`${FILES}/${file.id}`).set(as(ownerToken)).expect(204);

    // The row survives: a clinical audit needs to know a file existed
    // and was deleted long after the bytes are gone.
    const row = await harness.prisma.file.findUniqueOrThrow({ where: { id: file.id } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.storageKey).not.toBe('');
  });

  it('refuses a second delete', async () => {
    const file = dataOf<FileView>(
      await upload(ownerToken, 'patient_document', 'M25 twice.pdf', 'application/pdf', PDF),
    );

    await request(harness.server).delete(`${FILES}/${file.id}`).set(as(ownerToken)).expect(204);
    // Not a second 204: the sweep must see one deletion, and a client
    // must not be told it removed something twice.
    await request(harness.server).delete(`${FILES}/${file.id}`).set(as(ownerToken)).expect(404);
  });

  it('refuses a reader who is not the owner, even one who may read it', async () => {
    const file = dataOf<FileView>(
      await upload(ownerToken, 'patient_document', 'M25 notyours.pdf', 'application/pdf', PDF),
    );

    const stamp = await soleRecordOf(harness.prisma, patientId);
    await harness.prisma.file.update({ where: { id: file.id }, data: { hospitalId: stamp.hospitalId } });
    await harness.prisma.patientDocument.create({
      data: { ...stamp, patientId, name: 'Scan', category: 'REPORT', sizeKb: 1, fileId: file.id },
    });

    // The carer can read this file — asserted above for its sibling —
    // and still cannot delete it. §17.3 says owner, and removing an
    // attachment from a clinical record is a different act from reading
    // it.
    expect(
      (await request(harness.server).get(`${FILES}/${file.id}`).set(as(carerToken))).status,
    ).toBe(200);
    await request(harness.server).delete(`${FILES}/${file.id}`).set(as(carerToken)).expect(404);
  });
});

describe('M25.5 — the orphan sweep collects the objects', () => {
  it('removes a soft-deleted file’s object and marks the row swept', async () => {
    const file = dataOf<FileView>(
      await upload(ownerToken, 'patient_document', 'M25 sweepme.pdf', 'application/pdf', PDF),
    );
    const before = await harness.prisma.file.findUniqueOrThrow({ where: { id: file.id } });

    await request(harness.server).delete(`${FILES}/${file.id}`).set(as(ownerToken)).expect(204);

    const sweep = harness.app.get(OrphanSweepService);
    const result = await runAsSystem(() => sweep.sweep());

    expect(result.removed).toBeGreaterThanOrEqual(1);
    expect(storage.removed).toContain(before.storageKey);
    expect(storage.objects.has(before.storageKey)).toBe(false);

    // The key is emptied, which is what distinguishes "deleted, object
    // still there" from "deleted, object collected".
    const after = await harness.prisma.file.findUniqueOrThrow({ where: { id: file.id } });
    expect(after.storageKey).toBe('');
  });

  it('is safe to run twice', async () => {
    const sweep = harness.app.get(OrphanSweepService);

    // Nothing left to collect, and no failure from trying: a swept row
    // is not offered again, which is what makes the sweep resumable
    // after a crash halfway through a batch.
    expect((await runAsSystem(() => sweep.sweep())).failed).toBe(0);
  });

  it('keeps a row queued when the store refuses, and does not stop the batch', async () => {
    const file = dataOf<FileView>(
      await upload(ownerToken, 'patient_document', 'M25 stubborn.pdf', 'application/pdf', PDF),
    );
    await request(harness.server).delete(`${FILES}/${file.id}`).set(as(ownerToken)).expect(204);

    storage.failRemoval = true;
    const failing = await runAsSystem(() => harness.app.get(OrphanSweepService).sweep());
    storage.failRemoval = false;

    // At least this file's row, not exactly it: the sweep reads the whole
    // `files` table, and another suite running in parallel may have
    // soft-deleted a row of its own (`profile-photo` retires a replaced
    // photo, which is exactly what the sweep exists for). The first case
    // above counts with `>= 1` for the same reason; the row-level checks
    // below are what pin this file's own behaviour.
    expect(failing.failed).toBeGreaterThanOrEqual(1);
    expect(failing.removed).toBe(0);

    // The key is still there, so the next run tries again. A row marked
    // swept after a failed delete would leave bytes nothing collects.
    const row = await harness.prisma.file.findUniqueOrThrow({ where: { id: file.id } });
    expect(row.storageKey).not.toBe('');

    expect((await runAsSystem(() => harness.app.get(OrphanSweepService).sweep())).removed).toBeGreaterThanOrEqual(1);
    const swept = await harness.prisma.file.findUniqueOrThrow({ where: { id: file.id } });
    expect(swept.storageKey).toBe('');
  });
});
