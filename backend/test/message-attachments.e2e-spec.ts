import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
  makeClinicalDoctor,
  markVerified,
  registrationBody,
  testEmail,
} from './support/auth-app';

/**
 * Message attachments end to end — API §9.4 `attachmentIds`, §9.10, RM
 * M20.4 (RA-M20.1 closed now that M25 stores and scans).
 *
 * Upload through `POST /files` (kind `message_attachment`) → send with the
 * **file id** in `attachmentIds` → the attachment on the message → the
 * recipient's download, held at `403 scan_pending` until the scanner marks
 * the file clean, then a signed URL for the file's own storage key.
 *
 * The refusals carry the weight, and the first is a regression: the send
 * used to move `message_attachments` rows by id alone, so a participant
 * holding another thread's attachment id could pull it into their own
 * thread and download it there. Every refusal is the same 422 on
 * `attachmentIds`, and every one is asserted to have sent nothing.
 */
class InMemoryStorage implements FileStoragePort {
  readonly objects = new Map<string, Buffer>();

  put(upload: FileUpload): Promise<StoredFile> {
    const key = `${upload.kind}/${String(this.objects.size)}`;
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

  get(key: string): Promise<Buffer> {
    const object = this.objects.get(key);
    return object === undefined
      ? Promise.reject(new Error(`no object at ${key}`))
      : Promise.resolve(object);
  }

  remove(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }
}

interface Session {
  readonly token: string;
  readonly userId: string;
}

interface MessageView {
  id: string;
  attachments: { id: string; name: string; kind: string; sizeBytes: number }[];
}

let harness: AuthHarness;
const storage = new InMemoryStorage();

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const FILES = '/api/v1/files';
const CONV = '/api/v1/conversations';
const PASSWORD = 'Medora123!';
const NAME_PREFIX = 'M20.4 ';
const PDF = Buffer.from('%PDF-1.7\nmessage attachment\n');

let alice: Session;
let bob: Session;
let carol: Session;

const as = (session: Session) => ({ Authorization: `Bearer ${session.token}` });

async function signUp(local: string): Promise<Session> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  // Clinical standing at the fixture hospital (§2.6).
  await makeClinicalDoctor(harness.prisma, email);

  const token = dataOf<{ accessToken: string }>(
    await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;
  const user = await harness.prisma.user.findUniqueOrThrow({ where: { email } });

  return { token, userId: user.id };
}

async function newThread(author: Session, others: Session[]): Promise<string> {
  const response = await request(harness.server)
    .post(CONV)
    .set(as(author))
    .send({ participantIds: others.map((s) => s.userId), topic: 'Attachments' })
    .expect(201);

  return dataOf<{ id: string }>(response).id;
}

async function upload(session: Session, kind = 'message_attachment', name = 'result.pdf') {
  const response = await request(harness.server)
    .post(FILES)
    .set(as(session))
    .field('kind', kind)
    .attach('file', PDF, { filename: `${NAME_PREFIX}${name}`, contentType: 'application/pdf' });

  expect(response.status, JSON.stringify(response.body)).toBe(201);

  return dataOf<{ id: string }>(response).id;
}

function send(session: Session, conversationId: string, attachmentIds: string[]) {
  return request(harness.server)
    .post(`${CONV}/${conversationId}/messages`)
    .set(as(session))
    .send({ body: 'see attached', attachmentIds });
}

function messageCount(conversationId: string): Promise<number> {
  return harness.prisma.message.count({ where: { conversationId } });
}

beforeAll(async () => {
  harness = await createAuthHarness('message-attachments-m204', {
    overrides: [{ token: FILE_STORAGE, value: storage }],
  });

  alice = await signUp('att-alice');
  bob = await signUp('att-bob');
  carol = await signUp('att-carol');
}, 60_000);

afterAll(async () => {
  if (harness === undefined) return;

  // Messages cascade their attachments; the files are RESTRICT from them,
  // so the threads go first.
  await harness.prisma.conversation.deleteMany({
    where: { participants: { some: { userId: { in: [alice.userId, bob.userId, carol.userId] } } } },
  });
  await harness.prisma.file.deleteMany({ where: { originalName: { startsWith: NAME_PREFIX } } });
  await harness.reset();
  await harness.close();
});

describe('sending an upload (§9.4, §9.10)', () => {
  it('attaches the sender’s own upload by file id and gates the download on the scan', async () => {
    const thread = await newThread(alice, [bob]);
    const fileId = await upload(alice);

    const sent = await send(alice, thread, [fileId]);

    expect(sent.status).toBe(201);
    const [attachment] = dataOf<MessageView>(sent).attachments;
    expect(attachment).toMatchObject({ name: `${NAME_PREFIX}result.pdf`, kind: 'file' });
    expect(attachment?.sizeBytes).toBe(PDF.byteLength);

    const download = () =>
      request(harness.server)
        .get(`/api/v1/attachments/${attachment?.id ?? ''}/download`)
        .set(as(bob));

    const pending = await download();
    expect(pending.status).toBe(403);
    expect(errorBody(pending).code).toBe('scan_pending');

    await harness.prisma.file.update({
      where: { id: fileId },
      data: { scanResult: 'clean', scannedAt: new Date() },
    });

    const clean = await download();
    expect(clean.status).toBe(200);
    const { storageKey } = await harness.prisma.file.findUniqueOrThrow({ where: { id: fileId } });
    expect(dataOf<{ url: string }>(clean).url).toContain(storageKey);
  });

  it('refuses another account’s upload and sends nothing', async () => {
    const thread = await newThread(alice, [bob]);
    const bobs = await upload(bob);

    const response = await send(alice, thread, [bobs]);

    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors).toHaveProperty('attachmentIds');
    expect(await messageCount(thread)).toBe(0);
  });

  it('refuses an upload of another kind', async () => {
    const thread = await newThread(alice, [bob]);
    const document = await upload(alice, 'patient_document');

    expect((await send(alice, thread, [document])).status).toBe(422);
    expect(await messageCount(thread)).toBe(0);
  });

  it('refuses an upload already sent, so one file lives in one thread', async () => {
    const first = await newThread(alice, [bob]);
    const second = await newThread(alice, [carol]);
    const fileId = await upload(alice);

    expect((await send(alice, first, [fileId])).status).toBe(201);
    expect((await send(alice, second, [fileId])).status).toBe(422);
    expect(await messageCount(second)).toBe(0);
  });

  it('cannot pull another thread’s attachment into this one by its attachment id', async () => {
    // Alice ↔ Bob share a file; Bob also talks to Carol.
    const private_ = await newThread(alice, [bob]);
    const fileId = await upload(alice);
    const sent = dataOf<MessageView>(await send(alice, private_, [fileId]));
    const attachmentId = sent.attachments[0]?.id ?? '';

    const other = await newThread(bob, [carol]);
    const attempt = await send(bob, other, [attachmentId]);

    expect(attempt.status).toBe(422);
    const row = await harness.prisma.messageAttachment.findUniqueOrThrow({
      where: { id: attachmentId },
    });
    expect(row.messageId).toBe(sent.id);

    // Carol, outside the first thread, still cannot reach it.
    const carolsDownload = await request(harness.server)
      .get(`/api/v1/attachments/${attachmentId}/download`)
      .set(as(carol));
    expect(carolsDownload.status).toBe(404);
  });

  it('refuses a repeated id, an unknown id and a malformed one', async () => {
    const thread = await newThread(alice, [bob]);
    const fileId = await upload(alice);

    expect((await send(alice, thread, [fileId, fileId])).status).toBe(422);
    expect((await send(alice, thread, ['00000000-0000-4000-8000-000000000000'])).status).toBe(422);
    expect((await send(alice, thread, ['not-a-uuid'])).status).toBe(422);
    expect(await messageCount(thread)).toBe(0);
  });

  it('lets exactly one of two concurrent sends attach the same upload', async () => {
    const thread = await newThread(alice, [bob]);
    const fileId = await upload(alice);

    const statuses = (
      await Promise.all([send(alice, thread, [fileId]), send(alice, thread, [fileId])])
    )
      .map((response) => response.status)
      .sort();

    expect(statuses).toEqual([201, 422]);
    expect(await harness.prisma.messageAttachment.count({ where: { fileId } })).toBe(1);
  });
});
