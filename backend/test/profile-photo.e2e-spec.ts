import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ConfigService, type Env } from '../src/config';
import {
  DOWNLOAD_TTL_SECONDS,
  FILE_STORAGE,
  type DownloadOptions,
  type FileStoragePort,
  type FileUpload,
  type StoredFile,
} from '../src/shared/files';
import { S3FileStorage } from '../src/shared/files/s3-file-storage';
import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  markVerified,
  patientRegistrationBody,
  registrationBody,
  testEmail,
} from './support/auth-app';
import {
  createTestDoctor,
  destroyTestDoctor,
  employTestDoctor,
  type DoctorRecord,
} from './support/doctor-fixture';
import {
  createPatientRecords,
  destroyPatientRecords,
  type PatientRecord,
} from './support/patient-fixture';

/**
 * A doctor's photo reaches every client as a URL a browser can load, or
 * as `null` — never as the value stored in `doctors.photo_url`.
 *
 * The defect this pins: the upload used to write the object-store key
 * into `doctors.photo_url`, and every view echoed it as `photoUrl` — a
 * `profile_photo/…` path no `<img>` can load. Now the column holds a
 * `files.id`, and `ProfilePhotoUrls` mints a signed URL per read behind
 * the M25.3 scan gate. Four responses carry the photo and all four are
 * exercised here, in every state the stored reference can be in:
 *
 *  · `GET /me/profile` and the `PUT /me/profile/photo` response (the
 *    doctor's own document);
 *  · `GET /patient/doctors` and `GET /patient/doctors/:id`;
 *  · `GET /me/appointments` and `GET /me/appointments/:id` (the doctor
 *    embedded in a patient's appointment).
 *
 * ## The real S3 adapter, against a bucket on a local socket
 *
 * `FILE_STORAGE` is the production `S3FileStorage`, wrapped only so a
 * test can make signing fail. The URL asserted here is exactly the one
 * the adapter produces — path-style, SigV4-presigned, the disposition in
 * the signature. The "bucket" is a small HTTP server that stores what is
 * PUT and serves it back on GET. **It does not verify signatures**, and
 * no real S3-compatible store is reachable from this environment
 * (RA-M25.1, `s3-file-storage.spec.ts`); what this proves is that the
 * returned URL addresses the uploaded object and that fetching it yields
 * the uploaded bytes — not that a real S3 accepts the signature.
 */
let harness: AuthHarness;
let bucket: Server;
let storage: SwitchableStorage;
const objects = new Map<string, { body: Buffer; type: string }>();

const BUCKET = 'medora-photos-test';
const PREFIX = '/api/v1';
const REGISTER = `${PREFIX}/auth/register`;
const LOGIN = `${PREFIX}/auth/login`;
const PROFILE = `${PREFIX}/me/profile`;
const PHOTO = `${PREFIX}/me/profile/photo`;
const DOCTORS = `${PREFIX}/patient/doctors`;
const APPOINTMENTS = `${PREFIX}/me/appointments`;
const PASSWORD = 'Medora123!';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** This file's own practitioner, patient record and appointments. */
const TAG = 'pphoto';
const DIRECTORY_NAME = 'Dr. Photofixture Pphoto';
const APPOINTMENT_PREFIX = 'APT-Tpphoto-';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('a portrait'),
]);

/** The production adapter, with a switch that makes signing fail. */
class SwitchableStorage implements FileStoragePort {
  failSigning = false;

  constructor(private readonly inner: S3FileStorage) {}

  put(upload: FileUpload): Promise<StoredFile> {
    return this.inner.put(upload);
  }

  signedDownloadUrl(key: string, ttlSeconds: number, options?: DownloadOptions): Promise<string> {
    if (this.failSigning) return Promise.reject(new Error('signer unavailable'));
    return this.inner.signedDownloadUrl(key, ttlSeconds, options);
  }

  get(key: string): Promise<Buffer> {
    return this.inner.get(key);
  }

  remove(key: string): Promise<void> {
    return this.inner.remove(key);
  }
}

interface ProfileView {
  doctor: { id: string; photoUrl: string | null } | null;
}

interface DoctorSummary {
  id: string;
  photoUrl: string | null;
}

interface AppointmentView {
  id: string;
  doctor: { id: string; photoUrl: string | null };
}

function startBucket(): Promise<Server> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const path = decodeURIComponent((req.url ?? '').split('?')[0] ?? '');

      if (req.method === 'PUT') {
        objects.set(path, {
          body: Buffer.concat(chunks),
          type: String(req.headers['content-type'] ?? 'application/octet-stream'),
        });
        res.writeHead(200).end();
        return;
      }

      const object = objects.get(path);
      if (req.method === 'GET' && object !== undefined) {
        res.writeHead(200, { 'Content-Type': object.type }).end(object.body);
        return;
      }

      res.writeHead(404).end();
    });
  });

  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function adapterOn(port: number): S3FileStorage {
  return new S3FileStorage(
    new ConfigService({
      S3_ENDPOINT: `http://127.0.0.1:${String(port)}`,
      S3_REGION: 'us-east-1',
      S3_BUCKET: BUCKET,
      S3_ACCESS_KEY_ID: 'test-access-key',
      S3_SECRET_ACCESS_KEY: 'test-secret-key',
      S3_FORCE_PATH_STYLE: true,
    } as unknown as Env),
  );
}

async function login(email: string): Promise<string> {
  const response = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD, rememberMe: false });

  return dataOf<{ accessToken: string }>(response).accessToken;
}

async function seedDoctor(local: string): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  return login(email);
}

function uploadPhoto(token: string): request.Test {
  return request(harness.server)
    .put(PHOTO)
    .set('Authorization', `Bearer ${token}`)
    .attach('photo', PNG, { filename: 'portrait.png', contentType: 'image/png' });
}

async function get<T>(token: string, path: string): Promise<T> {
  const response = await request(harness.server)
    .get(path)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  return dataOf<T>(response);
}

async function readProfile(token: string): Promise<ProfileView> {
  return get<ProfileView>(token, PROFILE);
}

/** What M30.2's scanner writes once the engine has judged the object. */
async function markScanned(fileId: string, result: 'clean' | 'infected'): Promise<void> {
  await harness.prisma.file.update({
    where: { id: fileId },
    data: { scannedAt: new Date(), scanResult: result },
  });
}

async function storedPhotoId(doctorId: string): Promise<string> {
  const row = await harness.prisma.doctor.findUniqueOrThrow({
    where: { id: doctorId },
    select: { photoUrl: true },
  });

  return row.photoUrl ?? '';
}

/**
 * The adapter's presigned shape, and the object behind it.
 *
 * Path-style, SigV4, the platform's one download TTL, rendered inline —
 * and fetching it yields the bytes that were stored, as the stored type.
 */
async function expectLoadablePhoto(photoUrl: string | null, storageKey: string): Promise<void> {
  expect(photoUrl).not.toBeNull();
  const url = new URL(photoUrl ?? '');

  expect(decodeURIComponent(url.pathname)).toBe(`/${BUCKET}/${storageKey}`);
  expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
  expect(url.searchParams.get('X-Amz-Expires')).toBe(String(DOWNLOAD_TTL_SECONDS));
  expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  expect(url.searchParams.get('response-content-disposition')).toMatch(/^inline/);

  const fetched = await fetch(url);
  expect(fetched.status).toBe(200);
  expect(fetched.headers.get('content-type')).toBe('image/png');
  expect(Buffer.from(await fetched.arrayBuffer()).equals(PNG)).toBe(true);
}

beforeAll(async () => {
  bucket = await startBucket();
  storage = new SwitchableStorage(adapterOn((bucket.address() as AddressInfo).port));
  harness = await createAuthHarness('profile-photo', {
    overrides: [{ token: FILE_STORAGE, value: storage }],
  });
}, 60_000);

afterAll(async () => {
  await harness.reset();
  await harness.close();
  await new Promise<void>((resolve, reject) => {
    bucket.close((error) => (error === undefined ? resolve() : reject(error)));
  });
});

beforeEach(() => {
  storage.failSigning = false;
});

describe('PUT /me/profile/photo → GET /me/profile (§3.3, §17.2)', () => {
  it('stores a files id, never a key or a URL, and withholds the photo until scanned', async () => {
    const token = await seedDoctor('photo-pending');

    const uploaded = await uploadPhoto(token);
    expect(uploaded.status).toBe(200);

    // Freshly uploaded means unscanned, and unscanned is not served —
    // not even in the upload's own response.
    const view = dataOf<ProfileView>(uploaded);
    expect(view.doctor?.photoUrl).toBeNull();

    const stored = await storedPhotoId(view.doctor?.id ?? '');
    expect(stored).toMatch(UUID);

    const file = await harness.prisma.file.findUniqueOrThrow({
      where: { id: stored },
      select: { kind: true, storageKey: true, scanResult: true, mimeType: true },
    });
    expect(file.kind).toBe('profile_photo');
    expect(file.scanResult).toBeNull();
    expect(file.mimeType).toBe('image/png');
    expect(file.storageKey).toMatch(/^profile_photo\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/);

    expect((await readProfile(token)).doctor?.photoUrl).toBeNull();
  });

  it('serves a clean photo as a signed URL a browser can fetch', async () => {
    const token = await seedDoctor('photo-clean');

    const view = dataOf<ProfileView>(await uploadPhoto(token));
    const fileId = await storedPhotoId(view.doctor?.id ?? '');
    await markScanned(fileId, 'clean');

    const { storageKey } = await harness.prisma.file.findUniqueOrThrow({
      where: { id: fileId },
      select: { storageKey: true },
    });

    await expectLoadablePhoto((await readProfile(token)).doctor?.photoUrl ?? null, storageKey);
  });

  it('mints a fresh URL per read rather than storing one', async () => {
    const token = await seedDoctor('photo-fresh');

    const view = dataOf<ProfileView>(await uploadPhoto(token));
    const fileId = await storedPhotoId(view.doctor?.id ?? '');
    await markScanned(fileId, 'clean');

    await readProfile(token);
    expect(await storedPhotoId(view.doctor?.id ?? '')).toBe(fileId);
  });

  it('does not serve a photo the scanner rejected', async () => {
    const token = await seedDoctor('photo-infected');

    const view = dataOf<ProfileView>(await uploadPhoto(token));
    await markScanned(await storedPhotoId(view.doctor?.id ?? ''), 'infected');

    expect((await readProfile(token)).doctor?.photoUrl).toBeNull();
  });

  it('answers the profile with no photo, not a 503, when signing fails', async () => {
    const token = await seedDoctor('photo-signfail');

    const view = dataOf<ProfileView>(await uploadPhoto(token));
    await markScanned(await storedPhotoId(view.doctor?.id ?? ''), 'clean');

    storage.failSigning = true;
    expect((await readProfile(token)).doctor?.photoUrl).toBeNull();
  });

  it('retires the replaced photo so the orphan sweep collects its object', async () => {
    const token = await seedDoctor('photo-replace');

    const first = dataOf<ProfileView>(await uploadPhoto(token));
    const firstId = await storedPhotoId(first.doctor?.id ?? '');

    await uploadPhoto(token);
    const secondId = await storedPhotoId(first.doctor?.id ?? '');

    expect(secondId).not.toBe(firstId);

    const retired = await harness.prisma.file.findUniqueOrThrow({
      where: { id: firstId },
      select: { deletedAt: true },
    });
    expect(retired.deletedAt).not.toBeNull();

    const current = await harness.prisma.file.findUniqueOrThrow({
      where: { id: secondId },
      select: { deletedAt: true },
    });
    expect(current.deletedAt).toBeNull();
  });
});

/**
 * The patient surfaces. One patient-visible doctor of this file's own,
 * one linked patient, one appointment between them; each case puts the
 * doctor's stored photo reference into a different state and reads it
 * back through all four patient responses.
 */
describe('the doctor photo on the patient surfaces (§3, §4)', () => {
  let doctor: DoctorRecord;
  let records: PatientRecord[];
  let patientToken = '';
  let appointmentId = '';
  let photoKey = '';
  const createdFiles: string[] = [];

  /** The four photo values a patient sees for this file's doctor. */
  async function patientSees(): Promise<(string | null)[]> {
    const list = await get<{ items: DoctorSummary[] }>(
      patientToken,
      `${DOCTORS}?q=${encodeURIComponent(DIRECTORY_NAME)}`,
    );
    const listed = list.items.find((item) => item.id === doctor.id);
    expect(listed).toBeDefined();

    const detail = await get<DoctorSummary>(patientToken, `${DOCTORS}/${doctor.id}`);

    const appointments = await get<{ items: AppointmentView[] }>(patientToken, APPOINTMENTS);
    const booked = appointments.items.find((item) => item.id === appointmentId);
    expect(booked?.doctor.id).toBe(doctor.id);

    const appointment = await get<AppointmentView>(
      patientToken,
      `${APPOINTMENTS}/${appointmentId}`,
    );

    return [
      listed?.photoUrl ?? null,
      detail.photoUrl,
      booked?.doctor.photoUrl ?? null,
      appointment.doctor.photoUrl,
    ];
  }

  /** A `profile_photo` row over the stored object, as the upload writes it. */
  async function photoRow(scanResult: 'clean' | 'infected' | null): Promise<string> {
    const file = await harness.prisma.file.create({
      data: {
        storageKey: photoKey,
        originalName: 'portrait.png',
        mimeType: 'image/png',
        sizeBytes: BigInt(PNG.byteLength),
        checksumSha256: '0'.repeat(64),
        kind: 'profile_photo',
        scanResult,
        scannedAt: scanResult === null ? null : new Date(),
      },
      select: { id: true },
    });
    createdFiles.push(file.id);

    return file.id;
  }

  async function storePhoto(value: string | null): Promise<void> {
    await harness.prisma.doctor.update({ where: { id: doctor.id }, data: { photoUrl: value } });
  }

  beforeAll(async () => {
    doctor = await createTestDoctor(harness.prisma, TAG);
    await harness.prisma.doctor.update({
      where: { id: doctor.id },
      data: {
        fullName: DIRECTORY_NAME,
        verificationStatus: 'VERIFIED',
        practiceStatus: 'ACTIVE',
      },
    });
    // And employed (L6): the patient directory offers only employed doctors.
    await employTestDoctor(harness.prisma, doctor.id);

    records = await createPatientRecords(harness.prisma, TAG, 1);
    const record = records[0]!;

    const email = testEmail('photo-patient');
    await request(harness.server).post(REGISTER).send(patientRegistrationBody({ email }));
    await markVerified(harness.prisma, email);
    const user = await harness.prisma.user.findUniqueOrThrow({ where: { email } });
    await harness.prisma.db.patient.update({ where: { id: record.id }, data: { userId: user.id } });
    patientToken = await login(email);

    const visitType = await harness.prisma.db.visitType.findFirstOrThrow();
    appointmentId = `${APPOINTMENT_PREFIX}1`;
    await harness.prisma.appointment.deleteMany({
      where: { publicId: { startsWith: APPOINTMENT_PREFIX } },
    });
    await harness.prisma.db.appointment.create({
      data: {
        publicId: appointmentId,
        patientId: record.id,
        doctorId: doctor.id,
        visitTypeId: visitType.id,
        startsAt: new Date(Date.now() + 7 * 86_400_000),
        durationMin: 30,
        status: 'CONFIRMED',
        reason: 'Photo regression check',
      },
    });

    // The object, through the real adapter — the same `put` the upload makes.
    photoKey = (
      await storage.put({
        kind: 'profile_photo',
        name: 'portrait.png',
        mimeType: 'image/png',
        content: PNG,
      })
    ).key;
  });

  afterAll(async () => {
    await harness.prisma.appointment.deleteMany({
      where: { publicId: { startsWith: APPOINTMENT_PREFIX } },
    });
    await harness.prisma.file.deleteMany({ where: { id: { in: createdFiles } } });
    await destroyPatientRecords(harness.prisma, TAG);
    await destroyTestDoctor(harness.prisma, TAG);
  });

  it('serves a clean photo as the same loadable signed URL on every surface', async () => {
    await storePhoto(await photoRow('clean'));

    const seen = await patientSees();
    for (const photoUrl of seen) await expectLoadablePhoto(photoUrl, photoKey);
  });

  it('serves null, never the stored id, for an unscanned photo', async () => {
    const id = await photoRow(null);
    await storePhoto(id);

    const seen = await patientSees();
    expect(seen).toEqual([null, null, null, null]);
    expect(JSON.stringify(seen)).not.toContain(id);
  });

  it('serves null for a photo the scanner marked infected', async () => {
    await storePhoto(await photoRow('infected'));

    expect(await patientSees()).toEqual([null, null, null, null]);
  });

  it('serves null for an id that names no file', async () => {
    await storePhoto('77777777-7777-4777-8777-777777777777');

    expect(await patientSees()).toEqual([null, null, null, null]);
  });

  it('serves null for a photo whose file was deleted', async () => {
    const id = await photoRow('clean');
    await harness.prisma.file.update({ where: { id }, data: { deletedAt: new Date() } });
    await storePhoto(id);

    expect(await patientSees()).toEqual([null, null, null, null]);
  });

  it('never echoes a legacy bare storage key', async () => {
    await storePhoto(photoKey);

    const seen = await patientSees();
    expect(seen).toEqual([null, null, null, null]);
    expect(JSON.stringify(seen)).not.toContain(photoKey);
  });

  it('passes a legacy absolute https URL through unchanged', async () => {
    await storePhoto('https://cdn.example.test/portrait.png');

    expect(await patientSees()).toEqual(Array(4).fill('https://cdn.example.test/portrait.png'));
  });

  it('serves null for a doctor with no photo', async () => {
    await storePhoto(null);

    expect(await patientSees()).toEqual([null, null, null, null]);
  });

  it('answers 200 with null photos, not a 503, when signing fails', async () => {
    await storePhoto(await photoRow('clean'));
    storage.failSigning = true;

    expect(await patientSees()).toEqual([null, null, null, null]);
  });
});
