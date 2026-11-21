import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
  markVerified,
  registrationBody,
  testEmail,
} from './support/auth-app';

/**
 * Messaging — API §9, RM M20.1–M20.3, M20.5.
 *
 * ## The two authorization questions
 *
 * `can:messages.send` decides whether messaging exists for a role; the
 * `conversation_participants` join decides which threads. Both are
 * asserted, because neither substitutes for the other: a doctor holding
 * the capability still gets **404** on a colleague's thread, and the 404
 * rather than 403 is itself the property — a 403 confirms the thread
 * exists, and these threads are between named people about named
 * patients.
 *
 * ## The properties under test
 *
 * · **Folder semantics**, transcribed from `messaging/model/selectors.ts`
 *   — one test per folder, as the verify step asks.
 * · **Delivery progression** sent → delivered → read, and that a read
 *   receipt is never given for your own message.
 * · **Unread counts increment atomically** and are *recomputed* on read,
 *   so reading up to the middle of a thread leaves the rest unread.
 * · **The edit window** closes at five minutes, with 409 rather than 403.
 * · **Delete is 405**, not 404 and not 403.
 * · **Search never crosses a thread boundary.**
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const CONV = '/api/v1/conversations';
const SEARCH = '/api/v1/messages/search';
const PASSWORD = 'Medora123!';

interface Session {
  readonly token: string;
  readonly userId: string;
}

let alice: Session;
let bob: Session;
let carol: Session;

async function signUp(local: string): Promise<Session> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  const token = dataOf<{ accessToken: string }>(
    await request(harness.server).post(LOGIN).send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;

  const row = await harness.prisma.db.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  });

  return { token, userId: row.id };
}

const as = (session: Session) => ({ Authorization: `Bearer ${session.token}` });

async function newThread(author: Session, others: Session[], topic = 'Case review'): Promise<string> {
  const response = await request(harness.server)
    .post(CONV)
    .set(as(author))
    .send({ participantIds: others.map((s) => s.userId), topic })
    .expect(201);

  return dataOf<{ id: string }>(response).id;
}

async function send(author: Session, conversationId: string, body: string): Promise<string> {
  const response = await request(harness.server)
    .post(`${CONV}/${conversationId}/messages`)
    .set(as(author))
    .send({ body })
    .expect(201);

  return dataOf<{ id: string }>(response).id;
}

function listFolder(session: Session, folder: string) {
  return request(harness.server).get(`${CONV}?folder=${folder}`).set(as(session)).expect(200);
}

beforeAll(async () => {
  harness = await createAuthHarness('messaging');
  alice = await signUp('msg-alice');
  bob = await signUp('msg-bob');
  carol = await signUp('msg-carol');
}, 60_000);

afterAll(async () => {
  if (harness === undefined) return;
  await harness.reset();
  await harness.close();
});

beforeEach(async () => {
  // This suite's threads only. `conversations` is shared by every file in
  // the run, and a table-wide delete here removed threads other suites
  // (messaging-oversight, messaging-staff-roles) were in the middle of
  // using.
  await harness.prisma.db.conversation.deleteMany({
    where: {
      participants: { some: { userId: { in: [alice.userId, bob.userId, carol.userId] } } },
    },
  });
});

describe('creating a thread — API §9.2', () => {
  it('adds the author without being asked to', async () => {
    const id = await newThread(alice, [bob]);

    const participants = await harness.prisma.db.conversationParticipant.findMany({
      where: { conversationId: id },
      select: { userId: true },
    });

    expect(new Set(participants.map((p) => p.userId))).toEqual(
      new Set([alice.userId, bob.userId]),
    );
  });

  it('derives the kind rather than taking it from the client', async () => {
    const direct = await newThread(alice, [bob]);
    const group = await newThread(alice, [bob, carol]);

    const rows = await harness.prisma.db.conversation.findMany({
      where: { id: { in: [direct, group] } },
      select: { id: true, kind: true },
    });
    const byId = new Map(rows.map((row) => [row.id, row.kind]));

    expect(byId.get(direct)).toBe('DIRECT');
    expect(byId.get(group)).toBe('GROUP');
  });

  it('tolerates the caller naming itself', async () => {
    const response = await request(harness.server)
      .post(CONV)
      .set(as(alice))
      .send({ participantIds: [alice.userId, bob.userId] })
      .expect(201);

    const participants = await harness.prisma.db.conversationParticipant.count({
      where: { conversationId: dataOf<{ id: string }>(response).id },
    });
    expect(participants).toBe(2);
  });

  it('refuses a thread with nobody else in it', async () => {
    await request(harness.server)
      .post(CONV)
      .set(as(alice))
      .send({ participantIds: [alice.userId] })
      .expect(422);
  });

  it('refuses an unknown participant without saying which', async () => {
    const response = await request(harness.server)
      .post(CONV)
      .set(as(alice))
      .send({ participantIds: [bob.userId, '00000000-0000-4000-8000-000000000000'] })
      .expect(422);

    expect(JSON.stringify(response.body)).not.toContain('00000000-0000-4000-8000-000000000000');
  });

  it('requires authentication', async () => {
    await request(harness.server).post(CONV).send({ participantIds: [bob.userId] }).expect(401);
  });
});

describe('folder semantics — one test per folder (M20.1 verify)', () => {
  it('inbox holds everything not archived', async () => {
    const id = await newThread(alice, [bob]);
    await send(alice, id, 'hello');

    expect(dataOf<{ totalItems: number }>(await listFolder(alice, 'inbox')).totalItems).toBe(1);

    await request(harness.server)
      .patch(`${CONV}/${id}`)
      .set(as(alice))
      .send({ archived: true })
      .expect(204);

    expect(dataOf<{ totalItems: number }>(await listFolder(alice, 'inbox')).totalItems).toBe(0);
  });

  it('unread holds threads with an unread count, for the recipient only', async () => {
    const id = await newThread(alice, [bob]);
    await send(alice, id, 'hello');

    expect(dataOf<{ totalItems: number }>(await listFolder(bob, 'unread')).totalItems).toBe(1);
    // The sender's own message never makes their own thread unread.
    expect(dataOf<{ totalItems: number }>(await listFolder(alice, 'unread')).totalItems).toBe(0);
  });

  it('starred holds starred, unarchived threads', async () => {
    const id = await newThread(alice, [bob]);
    await request(harness.server)
      .patch(`${CONV}/${id}`)
      .set(as(alice))
      .send({ starred: true })
      .expect(204);

    expect(dataOf<{ totalItems: number }>(await listFolder(alice, 'starred')).totalItems).toBe(1);
    // Per-viewer: Bob starred nothing.
    expect(dataOf<{ totalItems: number }>(await listFolder(bob, 'starred')).totalItems).toBe(0);
  });

  it('sent holds threads whose last message is the caller’s', async () => {
    const id = await newThread(alice, [bob]);
    await send(alice, id, 'from alice');

    expect(dataOf<{ totalItems: number }>(await listFolder(alice, 'sent')).totalItems).toBe(1);
    expect(dataOf<{ totalItems: number }>(await listFolder(bob, 'sent')).totalItems).toBe(0);

    // "Last", not "any": Bob replying takes it out of Alice's Sent.
    await send(bob, id, 'from bob');

    expect(dataOf<{ totalItems: number }>(await listFolder(alice, 'sent')).totalItems).toBe(0);
    expect(dataOf<{ totalItems: number }>(await listFolder(bob, 'sent')).totalItems).toBe(1);
  });

  it('drafts holds threads with a non-empty draft, per viewer', async () => {
    const id = await newThread(alice, [bob]);
    await request(harness.server)
      .patch(`${CONV}/${id}`)
      .set(as(alice))
      .send({ draft: 'half a thought' })
      .expect(204);

    expect(dataOf<{ totalItems: number }>(await listFolder(alice, 'drafts')).totalItems).toBe(1);
    // A draft on the thread row would be visible to everyone in it.
    expect(dataOf<{ totalItems: number }>(await listFolder(bob, 'drafts')).totalItems).toBe(0);
  });

  it('archived holds exactly the archived ones', async () => {
    const id = await newThread(alice, [bob]);
    await request(harness.server)
      .patch(`${CONV}/${id}`)
      .set(as(alice))
      .send({ archived: true })
      .expect(204);

    expect(dataOf<{ totalItems: number }>(await listFolder(alice, 'archived')).totalItems).toBe(1);
    expect(dataOf<{ totalItems: number }>(await listFolder(bob, 'archived')).totalItems).toBe(0);
  });

  it('refuses an empty patch rather than silently doing nothing', async () => {
    const id = await newThread(alice, [bob]);

    await request(harness.server).patch(`${CONV}/${id}`).set(as(alice)).send({}).expect(422);
  });
});

describe('delivery-state progression — M20.2', () => {
  it('moves sent → delivered when the recipient opens the thread', async () => {
    const id = await newThread(alice, [bob]);
    const messageId = await send(alice, id, 'hello');

    const before = await harness.prisma.db.message.findUniqueOrThrow({ where: { id: messageId } });
    expect(before.status).toBe('SENT');

    await request(harness.server).get(`${CONV}/${id}/messages`).set(as(bob)).expect(200);

    const after = await harness.prisma.db.message.findUniqueOrThrow({ where: { id: messageId } });
    expect(after.status).toBe('DELIVERED');
  });

  it('moves delivered → read and clears the badge', async () => {
    const id = await newThread(alice, [bob]);
    const messageId = await send(alice, id, 'hello');

    const response = await request(harness.server)
      .post(`${CONV}/${id}/read`)
      .set(as(bob))
      .send({ messageId })
      .expect(200);

    expect(dataOf<{ receipted: number }>(response).receipted).toBe(1);

    const message = await harness.prisma.db.message.findUniqueOrThrow({ where: { id: messageId } });
    expect(message.status).toBe('READ');

    const participant = await harness.prisma.db.conversationParticipant.findUniqueOrThrow({
      where: { conversationId_userId: { conversationId: id, userId: bob.userId } },
    });
    expect(participant.unreadCount).toBe(0);
  });

  it('leaves newer messages unread when reading up to the middle', async () => {
    const id = await newThread(alice, [bob]);
    const first = await send(alice, id, 'one');
    await send(alice, id, 'two');
    await send(alice, id, 'three');

    await request(harness.server)
      .post(`${CONV}/${id}/read`)
      .set(as(bob))
      .send({ messageId: first })
      .expect(200);

    const participant = await harness.prisma.db.conversationParticipant.findUniqueOrThrow({
      where: { conversationId_userId: { conversationId: id, userId: bob.userId } },
    });
    // Recomputed, not zeroed: a blanket zero would mark the newer two seen.
    expect(participant.unreadCount).toBe(2);
  });

  it('never gives a read receipt for the reader’s own message', async () => {
    const id = await newThread(alice, [bob]);
    const mine = await send(alice, id, 'mine');

    const response = await request(harness.server)
      .post(`${CONV}/${id}/read`)
      .set(as(alice))
      .send({ messageId: mine })
      .expect(200);

    expect(dataOf<{ receipted: number }>(response).receipted).toBe(0);
    const message = await harness.prisma.db.message.findUniqueOrThrow({ where: { id: mine } });
    expect(message.status).toBe('SENT');
  });

  it('increments each recipient’s badge exactly once per message', async () => {
    const id = await newThread(alice, [bob, carol]);
    await send(alice, id, 'one');
    await send(alice, id, 'two');

    const rows = await harness.prisma.db.conversationParticipant.findMany({
      where: { conversationId: id },
      select: { userId: true, unreadCount: true },
    });
    const byUser = new Map(rows.map((row) => [row.userId, row.unreadCount]));

    expect(byUser.get(bob.userId)).toBe(2);
    expect(byUser.get(carol.userId)).toBe(2);
    expect(byUser.get(alice.userId)).toBe(0);
  });

  it('counts correctly when two people answer at once', async () => {
    const id = await newThread(alice, [bob, carol]);

    // `{ increment: 1 }` is one atomic UPDATE; a read-modify-write here
    // would lose one of these and the badge would be quietly one low.
    await Promise.all([send(alice, id, 'a'), send(carol, id, 'b')]);

    const bobRow = await harness.prisma.db.conversationParticipant.findUniqueOrThrow({
      where: { conversationId_userId: { conversationId: id, userId: bob.userId } },
    });
    expect(bobRow.unreadCount).toBe(2);
  });

  it('bumps lastActivityAt so the thread sorts to the top', async () => {
    const id = await newThread(alice, [bob]);
    const before = await harness.prisma.db.conversation.findUniqueOrThrow({ where: { id } });

    await send(alice, id, 'hello');

    const after = await harness.prisma.db.conversation.findUniqueOrThrow({ where: { id } });
    expect(after.lastActivityAt.getTime()).toBeGreaterThanOrEqual(before.lastActivityAt.getTime());
  });
});

describe('thread access is membership — API §9.3', () => {
  it('answers 404 for a thread the caller is not in', async () => {
    const id = await newThread(alice, [bob]);

    await request(harness.server).get(`${CONV}/${id}/messages`).set(as(carol)).expect(404);
    await request(harness.server)
      .post(`${CONV}/${id}/messages`)
      .set(as(carol))
      .send({ body: 'intruding' })
      .expect(404);
    await request(harness.server)
      .patch(`${CONV}/${id}`)
      .set(as(carol))
      .send({ starred: true })
      .expect(404);
  });

  it('answers 404 for a thread that does not exist, the same way', async () => {
    await request(harness.server)
      .get(`${CONV}/00000000-0000-4000-8000-000000000000/messages`)
      .set(as(alice))
      .expect(404);
  });

  it('never lists another caller’s thread', async () => {
    await newThread(alice, [bob]);

    expect(dataOf<{ totalItems: number }>(await listFolder(carol, 'inbox')).totalItems).toBe(0);
  });

  it('paginates the thread by cursor', async () => {
    const id = await newThread(alice, [bob]);
    for (let index = 0; index < 5; index += 1) await send(alice, id, `message ${index}`);

    const first = await request(harness.server)
      .get(`${CONV}/${id}/messages?pageSize=2`)
      .set(as(alice))
      .expect(200);
    const page = dataOf<{ items: { id: string }[]; nextCursor: string | null }>(first);

    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();

    const second = await request(harness.server)
      .get(`${CONV}/${id}/messages?pageSize=2&before=${page.nextCursor}`)
      .set(as(alice))
      .expect(200);
    const nextIds = dataOf<{ items: { id: string }[] }>(second).items.map((m) => m.id);

    // No overlap — a cursor that re-served its own anchor would show the
    // reader one message twice.
    expect(nextIds.some((id) => page.items.some((item) => item.id === id))).toBe(false);
  });

  it('stops offering a cursor at the end', async () => {
    const id = await newThread(alice, [bob]);
    await send(alice, id, 'only one');

    const response = await request(harness.server)
      .get(`${CONV}/${id}/messages?pageSize=10`)
      .set(as(alice))
      .expect(200);

    expect(dataOf<{ nextCursor: string | null }>(response).nextCursor).toBeNull();
  });
});

describe('the edit window and the delete refusal — M20.3', () => {
  it('edits within five minutes and marks it edited', async () => {
    const id = await newThread(alice, [bob]);
    const messageId = await send(alice, id, 'orignal');

    const response = await request(harness.server)
      .patch(`${CONV}/${id}/messages/${messageId}`)
      .set(as(alice))
      .send({ body: 'original' })
      .expect(200);

    const view = dataOf<{ body: string; editedAt: string | null }>(response);
    expect(view.body).toBe('original');
    expect(view.editedAt).not.toBeNull();
  });

  it('refuses at minute six with 409, not 403', async () => {
    const id = await newThread(alice, [bob]);
    const messageId = await send(alice, id, 'too late');

    // Six minutes ago. The window is policy read at edit time, not a
    // CHECK — a constraint would make old messages illegal the moment an
    // administrator widened it.
    await harness.prisma.db.message.update({
      where: { id: messageId },
      data: { sentAt: new Date(Date.now() - 6 * 60 * 1000) },
    });

    await request(harness.server)
      .patch(`${CONV}/${id}/messages/${messageId}`)
      .set(as(alice))
      .send({ body: 'nope' })
      .expect(409);
  });

  it('lets only the author edit', async () => {
    const id = await newThread(alice, [bob]);
    const messageId = await send(alice, id, 'mine');

    await request(harness.server)
      .patch(`${CONV}/${id}/messages/${messageId}`)
      .set(as(bob))
      .send({ body: 'not yours' })
      .expect(403);
  });

  it('refuses a message id from another thread as 404', async () => {
    const mine = await newThread(alice, [bob]);
    const other = await newThread(alice, [carol]);
    const messageId = await send(alice, other, 'elsewhere');

    await request(harness.server)
      .patch(`${CONV}/${mine}/messages/${messageId}`)
      .set(as(alice))
      .send({ body: 'wrong thread' })
      .expect(404);
  });

  it('answers 405 on delete, and the history survives', async () => {
    const id = await newThread(alice, [bob]);
    const messageId = await send(alice, id, 'permanent');

    await request(harness.server)
      .delete(`${CONV}/${id}/messages/${messageId}`)
      .set(as(alice))
      .expect(405);

    const still = await harness.prisma.db.message.findUnique({ where: { id: messageId } });
    expect(still).not.toBeNull();
    expect(still?.deletedAt).toBeNull();
  });

  it('answers 404 rather than 405 for a thread the caller is not in', async () => {
    const id = await newThread(alice, [bob]);
    const messageId = await send(alice, id, 'permanent');

    // Membership is checked first: 405 would confirm the thread exists.
    await request(harness.server)
      .delete(`${CONV}/${id}/messages/${messageId}`)
      .set(as(carol))
      .expect(404);
  });

  it('rejects an empty body', async () => {
    const id = await newThread(alice, [bob]);

    await request(harness.server)
      .post(`${CONV}/${id}/messages`)
      .set(as(alice))
      .send({ body: '   ' })
      .expect(422);
  });

  it('rejects a body beyond the cap', async () => {
    const id = await newThread(alice, [bob]);

    await request(harness.server)
      .post(`${CONV}/${id}/messages`)
      .set(as(alice))
      .send({ body: 'x'.repeat(16_001) })
      .expect(422);
  });

  it('refuses to send to a read-only thread', async () => {
    const id = await newThread(alice, [bob]);
    await harness.prisma.db.conversation.update({ where: { id }, data: { readOnly: true } });

    await request(harness.server)
      .post(`${CONV}/${id}/messages`)
      .set(as(alice))
      .send({ body: 'announcement reply' })
      .expect(409);
  });
});

describe('own-thread search — M20.5', () => {
  it('finds the caller’s own messages', async () => {
    const id = await newThread(alice, [bob]);
    await send(alice, id, 'the biopsy result is ready');

    const response = await request(harness.server)
      .get(`${SEARCH}?q=biopsy`)
      .set(as(alice))
      .expect(200);

    expect(dataOf<{ totalItems: number }>(response).totalItems).toBe(1);
  });

  it('never returns a message from a thread the caller is not in', async () => {
    const theirs = await newThread(bob, [carol]);
    await send(bob, theirs, 'the biopsy result is ready');

    const response = await request(harness.server)
      .get(`${SEARCH}?q=biopsy`)
      .set(as(alice))
      .expect(200);

    expect(dataOf<{ totalItems: number }>(response).totalItems).toBe(0);
  });

  it('matches case-insensitively', async () => {
    const id = await newThread(alice, [bob]);
    await send(alice, id, 'Potassium is critical');

    const response = await request(harness.server)
      .get(`${SEARCH}?q=POTASSIUM`)
      .set(as(alice))
      .expect(200);

    expect(dataOf<{ totalItems: number }>(response).totalItems).toBe(1);
  });

  it('rejects a one-character query rather than scanning for it', async () => {
    await request(harness.server).get(`${SEARCH}?q=a`).set(as(alice)).expect(422);
  });

  it('requires authentication', async () => {
    await request(harness.server).get(`${SEARCH}?q=biopsy`).expect(401);
  });
});

describe('the attachment scan gate — M20.4', () => {
  /**
   * A message with an attachment, whose scan state the test controls.
   *
   * The state is written to **`files`**, not only to
   * `message_attachments.scanned_at`. M25.3 moved the gate onto
   * `files.scan_result`, which is where DB §11 puts it and where the
   * distinction the next two tests turn on actually lives: `scanned_at`
   * records that a scan ran, and a gate on it opens for a file the
   * scanner marked **infected**. `scannedAt` is still written to the
   * attachment row so the two stay consistent.
   */
  async function attachTo(
    conversationId: string,
    author: Session,
    scannedAt: Date | null,
  ): Promise<string> {
    const messageId = await send(author, conversationId, 'see attached');

    const file = await harness.prisma.db.file.create({
      data: {
        kind: 'message_attachment',
        originalName: 'result.pdf',
        mimeType: 'application/pdf',
        sizeBytes: BigInt(1024),
        checksumSha256: '0'.repeat(64),
        storageKey: `test/${messageId}`,
        uploadedBy: author.userId,
        ...(scannedAt === null ? {} : { scannedAt, scanResult: 'clean' }),
      },
      select: { id: true },
    });

    const attachment = await harness.prisma.db.messageAttachment.create({
      data: {
        messageId,
        fileId: file.id,
        kind: 'FILE',
        name: 'result.pdf',
        sizeBytes: BigInt(1024),
        ...(scannedAt === null ? {} : { scannedAt }),
      },
      select: { id: true },
    });

    return attachment.id;
  }

  const DOWNLOAD = (id: string) => `/api/v1/attachments/${id}/download`;

  it('refuses an unscanned attachment with 403 scan_pending', async () => {
    const id = await newThread(alice, [bob]);
    const attachmentId = await attachTo(id, alice, null);

    const response = await request(harness.server)
      .get(DOWNLOAD(attachmentId))
      .set(as(bob))
      .expect(403);

    expect(errorBody(response).code).toBe('scan_pending');
  });

  /**
   * Null means *not yet scanned*, which the download path must not read
   * as clean — the column's own comment says so, and this is the case
   * that separates an explicit null check from a truthiness test.
   */
  it('does not treat "not yet scanned" as clean', async () => {
    const id = await newThread(alice, [bob]);
    const attachmentId = await attachTo(id, alice, null);

    const row = await harness.prisma.db.messageAttachment.findUniqueOrThrow({
      where: { id: attachmentId },
    });
    expect(row.scannedAt).toBeNull();

    await request(harness.server).get(DOWNLOAD(attachmentId)).set(as(alice)).expect(403);
  });

  it('answers 404 for a non-participant, not the gate’s 403', async () => {
    const id = await newThread(alice, [bob]);
    const attachmentId = await attachTo(id, alice, null);

    // A 403 `scan_pending` would confirm the attachment exists in a
    // thread Carol cannot read.
    await request(harness.server).get(DOWNLOAD(attachmentId)).set(as(carol)).expect(404);
  });

  it('answers 404 for an attachment that does not exist', async () => {
    await request(harness.server)
      .get(DOWNLOAD('00000000-0000-4000-8000-000000000000'))
      .set(as(alice))
      .expect(404);
  });

  /**
   * Past the gate, the request reaches `FILE_STORAGE` and gets a signed
   * URL — a **200**, where this expected 503 before M25.2.
   *
   * The change is the point rather than an adjustment. Presigning is
   * local arithmetic over the key and the credentials; it never touches
   * the object store, which is exactly why API §17.2 hands out a URL
   * instead of streaming bytes through the API. So the route answers
   * even in an environment with no bucket, and the client's own fetch is
   * what would fail. The old 503 was `UnconfiguredFileStorage`
   * rejecting every call, which was the honest answer while nothing
   * could sign — not a statement about the contract.
   *
   * It is still the proof the gate opened: an unclean attachment never
   * gets this far, which the three cases above and the one below assert.
   */
  it('hands a clean attachment a signed URL for its own object', async () => {
    const id = await newThread(alice, [bob]);
    const attachmentId = await attachTo(id, alice, new Date());

    const response = await request(harness.server)
      .get(DOWNLOAD(attachmentId))
      .set(as(bob))
      .expect(200);

    const url = new URL(dataOf<{ url: string }>(response).url);
    const file = await harness.prisma.db.file.findFirstOrThrow({
      where: { messageAttachments: { some: { id: attachmentId } } },
      select: { storageKey: true, originalName: true },
    });

    // The **storage key**, not the file id. This route passed
    // `message_attachments.file_id` to the port until M25.4 — a database
    // key that addresses no object — and the stub's 503 hid it.
    expect(url.pathname).toContain(file.storageKey);
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    // Short-TTL, and the filename is baked into the signature.
    expect(url.searchParams.get('X-Amz-Expires')).toBe('60');
    expect(url.searchParams.get('response-content-disposition')).toContain(file.originalName);
  });

  /**
   * The case the old gate got wrong, and the reason M25.3 moved it.
   *
   * A scan that ran and found malware sets `scanned_at` *and*
   * `scan_result = 'infected'`. A gate on the timestamp reports success
   * on the one file it exists to stop.
   */
  it('refuses an attachment the scanner rejected', async () => {
    const id = await newThread(alice, [bob]);
    const attachmentId = await attachTo(id, alice, new Date());

    await harness.prisma.db.file.updateMany({
      where: { messageAttachments: { some: { id: attachmentId } } },
      data: { scanResult: 'infected' },
    });

    const response = await request(harness.server)
      .get(DOWNLOAD(attachmentId))
      .set(as(bob))
      .expect(403);

    expect(errorBody(response).code).toBe('scan_pending');
    expect(errorBody(response).message).toContain('rejected');
  });

  it('requires authentication', async () => {
    await request(harness.server)
      .get(DOWNLOAD('00000000-0000-4000-8000-000000000000'))
      .expect(401);
  });
});
