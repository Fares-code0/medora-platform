import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MalwareScanService } from '../src/modules/files/services/malware-scan.service';
import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
  testEmail,
} from './support/auth-app';
import { destroyLabFixtures, orderTest, seedDoctor, seedPatient } from './support/lab-fixture';

/**
 * Every file consumer against a **real object store and a real scan
 * engine** — RM M25.3 ("pre-scan download blocked"), M25.4 ("each
 * consumer's round-trip test green against MinIO") and M25's exit gate
 * ("all uploads scanned + signed-URL served").
 *
 * Skipped unless both are named, like `s3-live.e2e-spec.ts`:
 *
 *   S3_LIVE_ENDPOINT, S3_LIVE_BUCKET, S3_LIVE_ACCESS_KEY_ID,
 *   S3_LIVE_SECRET_ACCESS_KEY  — an existing bucket (MinIO or S3)
 *   CLAMAV_LIVE_HOST [, CLAMAV_LIVE_PORT]  — a running clamd
 *
 * With them set, the application under test binds `S3FileStorage` to that
 * bucket and `ClamAvMalwareScanner` to that clamd — nothing is overridden.
 * Each consumer is driven through its own upload and download routes,
 * the real `files.malware-scan` sweep judges the bytes, and the signed URL
 * the API hands out is fetched from the store and compared byte for byte.
 */
const LIVE =
  process.env['S3_LIVE_ENDPOINT'] !== undefined && process.env['CLAMAV_LIVE_HOST'] !== undefined;

if (LIVE) {
  // `setup-env.ts` fills these with `??=`; the live values must win.
  process.env['S3_ENDPOINT'] = process.env['S3_LIVE_ENDPOINT'];
  process.env['S3_BUCKET'] = process.env['S3_LIVE_BUCKET'];
  process.env['S3_ACCESS_KEY_ID'] = process.env['S3_LIVE_ACCESS_KEY_ID'];
  process.env['S3_SECRET_ACCESS_KEY'] = process.env['S3_LIVE_SECRET_ACCESS_KEY'];
  process.env['S3_REGION'] = process.env['S3_LIVE_REGION'] ?? 'us-east-1';
  process.env['S3_FORCE_PATH_STYLE'] = process.env['S3_LIVE_FORCE_PATH_STYLE'] ?? 'true';
  process.env['CLAMAV_HOST'] = process.env['CLAMAV_LIVE_HOST'];
  process.env['CLAMAV_PORT'] = process.env['CLAMAV_LIVE_PORT'] ?? '3310';
}

const FILES = '/api/v1/files';
const NAME_PREFIX = 'M25-LIVE ';
const STAMP = String(Date.now());
const PDF = Buffer.from(`%PDF-1.7\nMedora live round trip ${STAMP}\n%%EOF\n`);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from(`live png ${STAMP}`),
]);
/** The EICAR test file — every engine's agreed "detect me" string. */
const EICAR = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');

let harness: AuthHarness;
let doctor = '';
let colleague = '';
const charts: string[] = [];

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

async function upload(
  token: string,
  kind: string,
  content: Buffer,
  name: string,
  contentType: string,
): Promise<string> {
  const response = await request(harness.server)
    .post(FILES)
    .set(as(token))
    .field('kind', kind)
    .attach('file', content, { filename: `${NAME_PREFIX}${name}`, contentType });

  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return dataOf<{ id: string }>(response).id;
}

/** Runs the real sweep until every named file has a verdict. */
async function scanUntilJudged(fileIds: readonly string[]): Promise<void> {
  const sweep = harness.app.get(MalwareScanService);

  for (let run = 0; run < 40; run += 1) {
    const pending = await harness.prisma.file.count({
      where: { id: { in: [...fileIds] }, scanResult: null },
    });
    if (pending === 0) return;
    await sweep.sweep(new Date());
  }

  throw new Error('the live sweep never judged the uploads');
}

async function scanResultOf(fileId: string): Promise<string | null> {
  return (await harness.prisma.file.findUniqueOrThrow({ where: { id: fileId } })).scanResult;
}

/** The URL the API signed, fetched from the store itself. */
async function fetchSigned(url: string): Promise<Buffer> {
  const response = await fetch(url);
  expect(response.status, url).toBe(200);
  return Buffer.from(await response.arrayBuffer());
}

beforeAll(async () => {
  if (!LIVE) return;

  harness = await createAuthHarness('storage-live');
  doctor = await seedDoctor(harness, 'live-doctor');
  colleague = await seedDoctor(harness, 'live-colleague');
}, 120_000);

afterAll(async () => {
  if (harness === undefined) return;

  await harness.prisma.patientDocument.deleteMany({
    where: { patient: { publicId: { in: charts } } },
  });
  await harness.prisma.conversation.deleteMany({
    where: { messages: { some: { attachments: { some: { name: { startsWith: NAME_PREFIX } } } } } },
  });
  await destroyLabFixtures(harness, charts);
  await harness.prisma.file.deleteMany({ where: { originalName: { startsWith: NAME_PREFIX } } });
  await harness.reset();
  await harness.close();
});

describe.skipIf(!LIVE)('file consumers against a live store and a live scan engine', () => {
  it('binds the real engine, not the unconfigured one', async () => {
    // The sweep reports which engine answered (the jobs screen reads it).
    expect((await harness.app.get(MalwareScanService).sweep(new Date(), 1)).engine).toBe('clamav');
  });

  it('holds a download until the real engine judges it, then serves the stored bytes', async () => {
    const fileId = await upload(
      doctor,
      'verification_document',
      PDF,
      'licence.pdf',
      'application/pdf',
    );

    const before = await request(harness.server).get(`${FILES}/${fileId}/download`).set(as(doctor));
    expect(before.status).toBe(403);
    expect(errorBody(before).code).toBe('scan_pending');

    await scanUntilJudged([fileId]);
    expect(await scanResultOf(fileId)).toBe('clean');

    const after = await request(harness.server).get(`${FILES}/${fileId}/download`).set(as(doctor));
    expect(after.status).toBe(200);
    expect((await fetchSigned(dataOf<{ url: string }>(after).url)).equals(PDF)).toBe(true);
  }, 60_000);

  it('rejects EICAR with the real engine and keeps the gate shut', async () => {
    const thread = dataOf<{ id: string }>(
      await request(harness.server)
        .post('/api/v1/conversations')
        .set(as(doctor))
        .send({ participantIds: [await userIdFor('live-colleague')], topic: 'Live scan' })
        .expect(201),
    ).id;
    const fileId = await upload(doctor, 'message_attachment', EICAR, 'eicar.txt', 'text/plain');
    const sent = await request(harness.server)
      .post(`/api/v1/conversations/${thread}/messages`)
      .set(as(doctor))
      .send({ body: 'test file', attachmentIds: [fileId] });
    expect(sent.status).toBe(201);
    const attachmentId = dataOf<{ attachments: { id: string }[] }>(sent).attachments[0]?.id ?? '';

    await scanUntilJudged([fileId]);
    expect(await scanResultOf(fileId)).toBe('infected');

    const download = await request(harness.server)
      .get(`/api/v1/attachments/${attachmentId}/download`)
      .set(as(colleague));
    expect(download.status).toBe(403);
    expect(errorBody(download).code).toBe('scan_pending');
  }, 60_000);

  it('round-trips every consumer through MinIO behind the real scan', async () => {
    const patient = await seedPatient(harness, doctor, { fullName: 'Live Roundtrip' });
    charts.push(patient.id);

    // ── patient documents (§4.7) ─────────────────────────────────────
    const documentFile = await upload(
      doctor,
      'patient_document',
      PDF,
      'consent.pdf',
      'application/pdf',
    );
    const document = await request(harness.server)
      .post(`/api/v1/patients/${patient.id}/documents`)
      .set(as(doctor))
      .send({ fileId: documentFile, category: 'consent' });
    expect(document.status, JSON.stringify(document.body)).toBe(201);
    const documentId = dataOf<{ id: string }>(document).id;

    // ── record attachments (§6.7) ────────────────────────────────────
    const record = await request(harness.server)
      .post('/api/v1/medical-records')
      .set(as(doctor))
      .send({
        patientId: patient.id,
        visitDate: '2026-09-10T09:00:00.000Z',
        visitType: 'Consultation',
        priority: 'normal',
        chiefComplaint: 'Live storage check',
        historyOfPresentIllness: 'None.',
        physicalExamination: 'Normal.',
      });
    expect(record.status).toBe(201);
    const recordId = dataOf<{ id: string }>(record).id;
    const recordFile = await upload(
      doctor,
      'record_attachment',
      PDF,
      'referral.pdf',
      'application/pdf',
    );
    const attached = await request(harness.server)
      .post(`/api/v1/medical-records/${recordId}/attachments`)
      .set(as(doctor))
      .send({ fileId: recordFile, kind: 'referral' });
    expect(attached.status, JSON.stringify(attached.body)).toBe(201);
    const recordAttachmentId =
      dataOf<{ attachments: { id: string }[] }>(attached).attachments[0]?.id ?? '';

    // ── lab attachments (§8.11, inline upload) ───────────────────────
    const order = await orderTest(harness, doctor, patient.id);
    const lab = await request(harness.server)
      .post(`/api/v1/lab-orders/${order.id}/attachments`)
      .set(as(doctor))
      .send({
        name: `${NAME_PREFIX}panel.pdf`,
        kind: 'report',
        mimeType: 'application/pdf',
        content: PDF.toString('base64'),
      });
    expect(lab.status, JSON.stringify(lab.body)).toBe(201);
    const labFile = (
      await harness.prisma.labAttachment.findFirstOrThrow({
        where: { order: { publicId: order.id } },
        select: { fileId: true },
      })
    ).fileId;

    // ── message attachments (§9.4, §9.10) ────────────────────────────
    const thread = dataOf<{ id: string }>(
      await request(harness.server)
        .post('/api/v1/conversations')
        .set(as(doctor))
        .send({ participantIds: [await userIdFor('live-colleague')], topic: 'Live round trip' })
        .expect(201),
    ).id;
    const messageFile = await upload(
      doctor,
      'message_attachment',
      PDF,
      'result.pdf',
      'application/pdf',
    );
    const sent = await request(harness.server)
      .post(`/api/v1/conversations/${thread}/messages`)
      .set(as(doctor))
      .send({ body: 'attached', attachmentIds: [messageFile] });
    expect(sent.status).toBe(201);
    const messageAttachmentId =
      dataOf<{ attachments: { id: string }[] }>(sent).attachments[0]?.id ?? '';

    // ── branding asset (chrome, readable by any signed-in user) ──────
    const brandingFile = await upload(doctor, 'branding_asset', PNG, 'logo.png', 'image/png');

    // ── profile photo (§3.3) ─────────────────────────────────────────
    const photo = await request(harness.server)
      .put('/api/v1/me/profile/photo')
      .set(as(doctor))
      .attach('photo', PNG, { filename: `${NAME_PREFIX}me.png`, contentType: 'image/png' });
    expect(photo.status, JSON.stringify(photo.body)).toBe(200);
    const photoFile = (
      await harness.prisma.file.findFirstOrThrow({
        where: { kind: 'profile_photo', originalName: `${NAME_PREFIX}me.png` },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      })
    ).id;

    await scanUntilJudged([
      documentFile,
      recordFile,
      labFile,
      messageFile,
      brandingFile,
      photoFile,
    ]);
    for (const id of [documentFile, recordFile, labFile, messageFile, brandingFile, photoFile]) {
      expect(await scanResultOf(id)).toBe('clean');
    }

    const urls: { consumer: string; url: string; bytes: Buffer }[] = [];
    const signed = async (consumer: string, path: string, token: string, bytes: Buffer) => {
      const response = await request(harness.server).get(path).set(as(token));
      expect(response.status, `${consumer}: ${JSON.stringify(response.body)}`).toBe(200);
      urls.push({ consumer, url: dataOf<{ url: string }>(response).url, bytes });
    };

    await signed(
      'patient document',
      `/api/v1/patients/${patient.id}/documents/${documentId}/download`,
      doctor,
      PDF,
    );
    await signed(
      'record attachment',
      `/api/v1/medical-records/${recordId}/attachments/${recordAttachmentId}/download`,
      doctor,
      PDF,
    );
    await signed('lab attachment', `${FILES}/${labFile}/download`, doctor, PDF);
    await signed(
      'message attachment',
      `/api/v1/attachments/${messageAttachmentId}/download`,
      colleague,
      PDF,
    );
    await signed('branding asset', `${FILES}/${brandingFile}/download`, colleague, PNG);

    const profile = await request(harness.server).get('/api/v1/me/profile').set(as(doctor));
    // The practitioner's photo, on the composed profile's `doctor` part.
    const photoUrl = dataOf<{ doctor: { photoUrl: string | null } | null }>(profile).doctor
      ?.photoUrl;
    expect(photoUrl, 'profile photo').toMatch(/^https?:\/\//);
    urls.push({ consumer: 'profile photo', url: photoUrl ?? '', bytes: PNG });

    for (const { consumer, url, bytes } of urls) {
      expect(url, `${consumer} signed no URL`).toMatch(/^https?:\/\//);
      expect((await fetchSigned(url)).equals(bytes), consumer).toBe(true);
    }
  }, 120_000);
});

async function userIdFor(local: string): Promise<string> {
  return (await harness.prisma.user.findUniqueOrThrow({ where: { email: testEmail(local) } })).id;
}
