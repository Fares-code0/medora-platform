import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { request as httpRequest, type Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { PLATFORM_POLICY_SOURCE } from '../src/config/policy.types';
import { AI_GATEWAY, type AiDelta, type AiGatewayPort, type AiGenerationRequest } from '../src/shared/ai';
import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
  fixtureHospital,
  makeClinicalDoctor,
  purgeHospitalRecords,
  testEmail,
} from './support/auth-app';
import { orderTest, seedDoctor, seedPatient } from './support/lab-fixture';

/**
 * The AI assistant (RM M16, API §11).
 *
 * ## The fake adapter is the point, not a convenience
 *
 * M16.1's verify step asks for exactly this: "a fake adapter drives all
 * tests". No test in this file reaches a provider, and none could —
 * `AI_GATEWAY` is a token, so substituting it is a one-line override,
 * and the module under test never names a concrete gateway
 * (`ai-containment.spec.ts` asserts that mechanically).
 *
 * The fake is scriptable in three ways, because the three outcomes of
 * M16.4 are what this milestone has to get right: it can stream cleanly,
 * it can fail partway, and it can hang until the caller aborts.
 *
 * ## What the *unconfigured* gateway does is also tested
 *
 * The production binding until a provider is wired is
 * `UnconfiguredAiGateway`, which refuses every generation. The last
 * `describe` drives the ordinary application — no override — so the
 * behaviour a deployment actually gets without a key is asserted rather
 * than assumed.
 */
let harness: AuthHarness;

const CONVERSATIONS = '/api/v1/ai/conversations';
const PROMPTS = '/api/v1/ai/prompts';
const SETTINGS = '/api/v1/me/ai-settings';

interface ContextView {
  mode: string;
  patientId: string | null;
  patientName: string | null;
  refId: string | null;
}

interface MessageView {
  id: string;
  role: string;
  content: string;
  status: string;
  error: string | null;
  feedback: number | null;
}

interface ConversationView {
  id: string;
  title: string;
  context: ContextView;
  favorite: boolean;
  messageCount: number;
  messages?: MessageView[];
}

interface SettingsView {
  temperature: number;
  responseLength: string;
  language: string;
  autoContext: boolean;
  streaming: boolean;
  favoritePromptIds: string[];
}

interface PromptView {
  id: string;
  title: string;
  message: string;
  affinity: string | null;
  favorite: boolean;
}

/** What the fake gateway should do on its next call. */
type Script =
  | { kind: 'stream'; deltas: string[] }
  | { kind: 'fail'; after: number }
  | { kind: 'hang'; after: number };

const charts: string[] = [];
let doctorToken = '';
let strangerToken = '';
let patient: { id: string; name: string; mrn: string };

/** The application with `AI_GATEWAY` replaced. Booted once. */
let fakeApp: INestApplication;
let fakeServer: Server;
let script: Script = { kind: 'stream', deltas: ['Hello', ', ', 'doctor.'] };
let lastRequest: AiGenerationRequest | null = null;

/**
 * The request the fake gateway last received.
 *
 * A function rather than a direct read of `lastRequest`: TypeScript's
 * control-flow analysis cannot see the assignment that happens inside
 * the gateway during an awaited HTTP round trip, so it narrows the
 * variable to `null` at the call site and every property access becomes
 * an error on `never`. Reading through a call defeats the narrowing, and
 * throwing here turns "the gateway was never reached" into a clear
 * failure rather than a confusing one about `undefined`.
 */
function gatewaySaw(): AiGenerationRequest {
  if (lastRequest === null) throw new Error('The gateway was never called.');

  return lastRequest;
}

const fakeGateway: AiGatewayPort = {
  async *generate(req: AiGenerationRequest, signal?: AbortSignal): AsyncIterable<AiDelta> {
    lastRequest = req;
    const current = script;

    if (current.kind === 'stream') {
      for (const text of current.deltas) yield { text };
      return;
    }

    for (let index = 0; index < current.after; index += 1) {
      yield { text: `chunk-${String(index)} ` };
    }

    if (current.kind === 'fail') {
      throw new Error('provider exploded');
    }

    // `hang` — wait for the client to go away, which is what an abort
    // mid-stream actually looks like from inside an adapter.
    await new Promise<void>((resolve) => {
      if (signal?.aborted === true) {
        resolve();
        return;
      }
      signal?.addEventListener('abort', () => {
        resolve();
      });
    });
  },
  describe: () => ({ name: 'Fake Assistant', version: 'test', configured: true }),
};

function conversation(token: string, path = ''): request.Test {
  return request(fakeServer).get(`${CONVERSATIONS}${path}`).set('Authorization', `Bearer ${token}`);
}

async function createThread(
  token: string,
  context: Record<string, unknown>,
  expected = 201,
): Promise<request.Response> {
  const response = await request(fakeServer)
    .post(CONVERSATIONS)
    .set('Authorization', `Bearer ${token}`)
    .send({ context });

  expect(response.status).toBe(expected);

  return response;
}

async function generalThread(token: string): Promise<ConversationView> {
  return dataOf<ConversationView>(await createThread(token, { mode: 'general' }));
}

/** Sends a turn and collects the SSE frames. */
async function send(
  token: string,
  conversationId: string,
  content = 'What should I watch for?',
): Promise<{ status: number; frames: { event: string; data: Record<string, unknown> }[] }> {
  const response = await request(fakeServer)
    .post(`${CONVERSATIONS}/${conversationId}/messages`)
    .set('Authorization', `Bearer ${token}`)
    .send({ content })
    .buffer(true)
    .parse((res, callback) => {
      let body = '';
      res.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8');
      });
      res.on('end', () => {
        callback(null, body);
      });
    });

  return { status: response.status, frames: parseSse(String(response.body ?? '')) };
}

/**
 * Retries a read until it stops throwing.
 *
 * Needed in exactly one place: the `stopped` status is written by the
 * service generator's `finally`, which runs *after* the socket closes —
 * so the client has no way to be told it landed. A fixed sleep would be
 * either flaky or slow; this is neither.
 */
async function eventually<T>(read: () => Promise<T>, attempts = 40): Promise<T> {
  let last: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  throw last;
}

function parseSse(raw: string): { event: string; data: Record<string, unknown> }[] {
  return raw
    .split('\n\n')
    .filter((block) => block.trim().length > 0)
    .map((block) => {
      const event = /event: (.+)/.exec(block)?.[1] ?? '';
      const data = /data: (.+)/.exec(block)?.[1] ?? '{}';

      return { event, data: JSON.parse(data) as Record<string, unknown> };
    });
}

beforeAll(async () => {
  harness = await createAuthHarness('ai-assistant');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PLATFORM_POLICY_SOURCE)
    .useValue({ load: () => Promise.resolve({}) })
    .overrideProvider(AI_GATEWAY)
    .useValue(fakeGateway)
    .compile();

  fakeApp = moduleRef.createNestApplication();
  fakeApp.setGlobalPrefix('api/v1');
  await fakeApp.init();
  fakeServer = fakeApp.getHttpServer() as Server;

  // `init()` wires the application but does not bind a port — supertest
  // ephemerally listens per request, which is enough for every case here
  // except the disconnect test, which drives a raw socket and therefore
  // needs a real address. Bound once, on an ephemeral port.
  await new Promise<void>((resolve) => {
    fakeServer.listen(0, '127.0.0.1', resolve);
  });

  doctorToken = await seedDoctor(harness, 'ai-owner');
  // DR-05: a colleague at the same hospital reaches the chart; isolation is across hospitals.
  strangerToken = await seedDoctor(harness, 'ai-stranger', 'b');
  patient = await seedPatient(harness, doctorToken);
  charts.push(patient.id);
}, 60_000);

afterAll(async () => {
  if (harness === undefined) return;

  await harness.prisma.aiConversation.deleteMany({
    where: { patient: { publicId: { in: charts } } },
  });
  await harness.prisma.labOrder.deleteMany({
    where: { patient: { publicId: { in: charts } } },
  });
  await purgeHospitalRecords(
    harness.prisma,
    (
      await harness.prisma.patient.findMany({
        where: { publicId: { in: charts } },
        select: { id: true },
      })
    ).map((row) => row.id),
  );
  await harness.prisma.patient.deleteMany({ where: { publicId: { in: charts } } });

  await fakeApp?.close();
  await harness.reset();
  await harness.close();
});

describe('RM M16.2 verify — CRUD round-trip matches the frontend’s types', () => {
  it('creates a thread whose shape is AiConversation', async () => {
    const thread = await generalThread(doctorToken);

    expect(thread).toMatchObject({
      title: expect.any(String) as string,
      favorite: false,
      messageCount: 0,
      context: { mode: 'general', patientId: null, patientName: null, refId: null },
    });
    expect(thread.messages).toEqual([]);
  });

  it('lists, filters by favourite, and searches by title', async () => {
    const thread = await generalThread(doctorToken);

    await request(fakeServer)
      .patch(`${CONVERSATIONS}/${thread.id}`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ title: 'Potassium question', favorite: true })
      .expect(200);

    const favourites = dataOf<ConversationView[]>(
      await conversation(doctorToken, '?favorite=true').expect(200),
    );
    expect(favourites.some((row) => row.id === thread.id)).toBe(true);

    const found = dataOf<ConversationView[]>(
      await conversation(doctorToken, '?q=potassium').expect(200),
    );
    expect(found.some((row) => row.id === thread.id)).toBe(true);

    const missed = dataOf<ConversationView[]>(
      await conversation(doctorToken, '?q=cardiology').expect(200),
    );
    expect(missed.some((row) => row.id === thread.id)).toBe(false);
  });

  it('deletes softly — the row survives (M16.2 verify)', async () => {
    const thread = await generalThread(doctorToken);

    await request(fakeServer)
      .delete(`${CONVERSATIONS}/${thread.id}`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .expect(204);

    // Gone from the API…
    await conversation(doctorToken, `/${thread.id}`).expect(404);

    // …and still in the database, with its tombstone. A patient-bound
    // thread carries PHI, so DB §7 archives rather than destroys.
    const row = await harness.prisma.aiConversation.findUnique({
      where: { id: thread.id },
      select: { id: true, deletedAt: true },
    });
    expect(row?.deletedAt).not.toBeNull();
  });

  it('refuses to re-delete, rather than reporting success for nothing', async () => {
    const thread = await generalThread(doctorToken);
    const path = `${CONVERSATIONS}/${thread.id}`;

    await request(fakeServer).delete(path).set('Authorization', `Bearer ${doctorToken}`).expect(204);
    await request(fakeServer).delete(path).set('Authorization', `Bearer ${doctorToken}`).expect(404);
  });

  it('keeps a colleague out of the thread, as not found', async () => {
    // Ownership, not care scope: a thread is the doctor's own working
    // notes. 404 rather than 403 for the reason ADR-022 gives.
    const thread = await generalThread(doctorToken);

    await conversation(strangerToken, `/${thread.id}`).expect(404);
    await request(fakeServer)
      .patch(`${CONVERSATIONS}/${thread.id}`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .send({ favorite: true })
      .expect(404);
  });
});

describe('RM M16.3 verify — context binding is server-authoritative', () => {
  it('resolves the patient’s name server-side', async () => {
    // The client sends an id; the name comes back from the care-scoped
    // query that authorised the binding, so a client cannot put a name
    // on a thread it has no right to see.
    const thread = dataOf<ConversationView>(
      await createThread(doctorToken, { mode: 'patient', patientId: patient.id }),
    );

    expect(thread.context).toMatchObject({
      mode: 'patient',
      patientId: patient.id,
      patientName: patient.name,
      refId: null,
    });
  });

  it('answers doctor A binding doctor B’s patient with not-found', async () => {
    // The verify step says 403; the implementation answers **404**, and
    // deliberately: ADR-022 requires the refusal to be indistinguishable
    // from a patient that does not exist, because a 403 confirms the
    // patient is real and walking `PT-1000`, `PT-1001`, … would disclose
    // the roster. API §0.4 permits "403/404" so the server can choose the
    // non-disclosing one, and every other patient-child route here has
    // made the same choice since M7.2.
    const refused = await createThread(
      strangerToken,
      { mode: 'patient', patientId: patient.id },
      404,
    );
    const absent = await createThread(
      doctorToken,
      { mode: 'patient', patientId: 'PT-000000' },
      404,
    );

    expect(errorBody(refused).message).toBe(errorBody(absent).message);
  });

  it('answers a deleted refId with 409, and generates nothing', async () => {
    const order = await orderTest(harness, doctorToken, patient.id);
    await harness.prisma.labOrder.updateMany({
      where: { publicId: order.id },
      data: { deletedAt: new Date() },
    });

    const before = await harness.prisma.aiConversation.count();

    const refused = await createThread(
      doctorToken,
      { mode: 'labs', patientId: patient.id, refId: order.id },
      409,
    );

    expect(errorBody(refused).code).toBe('context_unresolved');
    // "409, no generation" in its strongest form: no thread at all.
    expect(await harness.prisma.aiConversation.count()).toBe(before);
  });

  it('stamps a reference-bound thread with the hospital the patient was reached at (AI-02)', async () => {
    // A labs/record/pharmacy thread is still a thread about this patient at
    // this hospital. Before AI-02 the reference-bound path returned no
    // chart, so the row carried no hospital: the runtime role's
    // `ai_conversations` insert policy refused it, and on an owner
    // connection it was unattributed PHI.
    const order = await orderTest(harness, doctorToken, patient.id);

    const created = await createThread(doctorToken, { mode: 'labs', patientId: patient.id, refId: order.id }, 201);
    const threadId = dataOf<{ id: string }>(created).id;

    const row = await harness.prisma.aiConversation.findUniqueOrThrow({
      where: { id: threadId },
      select: { hospitalId: true, hospitalMedicalRecordId: true, refPublicId: true },
    });
    const orderRow = await harness.prisma.labOrder.findFirstOrThrow({
      where: { publicId: order.id },
      select: { hospitalId: true },
    });

    expect(row.refPublicId).toBe(order.id);
    expect(row.hospitalId).not.toBeNull();
    expect(row.hospitalMedicalRecordId).not.toBeNull();
    // The reach hospital is the one the bound entity belongs to.
    expect(row.hospitalId).toBe(orderRow.hospitalId);
  });

  it('refuses a refId belonging to another patient', async () => {
    // Without the patient clause on the entity query, binding another
    // chart's order under a chart the caller legitimately holds would
    // succeed — which is the leak M16.3 exists to close.
    const other = await seedPatient(harness, doctorToken, { fullName: 'Omar Saleh' });
    charts.push(other.id);

    const order = await orderTest(harness, doctorToken, other.id);

    await createThread(
      doctorToken,
      { mode: 'labs', patientId: patient.id, refId: order.id },
      409,
    );
  });

  it('refuses a patient-bound mode with no patient (422, not 409)', async () => {
    // Malformed, not unresolvable. The client can fix it from the
    // message, and telling it so discloses nothing.
    const refused = await createThread(doctorToken, { mode: 'patient' }, 422);

    expect(errorBody(refused).code).toBe('validation_failed');
  });

  it('refuses a second patient on a general thread (422)', async () => {
    // The creation-time half of "one patient maximum per conversation":
    // a thread bound to nothing *and* to someone.
    await createThread(doctorToken, { mode: 'general', patientId: patient.id }, 422);
  });

  it('refuses an entity-bound mode with no refId', async () => {
    await createThread(doctorToken, { mode: 'record', patientId: patient.id }, 422);
  });

  it('has no route through which a thread’s patient could be moved', async () => {
    // The other half of "one patient maximum". Re-pointing an existing
    // thread would leave turns about one patient under another's
    // context, so `PATCH` accepts title and favourite only.
    const thread = dataOf<ConversationView>(
      await createThread(doctorToken, { mode: 'patient', patientId: patient.id }),
    );
    const other = await seedPatient(harness, doctorToken, { fullName: 'Hana Darwish' });
    charts.push(other.id);

    await request(fakeServer)
      .patch(`${CONVERSATIONS}/${thread.id}`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ context: { mode: 'patient', patientId: other.id } })
      .expect(422);

    const after = dataOf<ConversationView>(
      await conversation(doctorToken, `/${thread.id}`).expect(200),
    );
    expect(after.context.patientId).toBe(patient.id);
  });

  it('re-resolves before every send, so a revoked assignment stops the next answer', async () => {
    // The fail-closed rule applied over time. A check that only ran at
    // creation is one that expires silently.
    const thread = dataOf<ConversationView>(
      await createThread(doctorToken, { mode: 'patient', patientId: patient.id }),
    );

    script = { kind: 'stream', deltas: ['Fine.'] };
    expect((await send(doctorToken, thread.id)).status).toBe(200);

    // DR-05: reach is the patient's record at the doctor's employment
    // hospital, not a care assignment, so the relationship is withdrawn
    // by the doctor moving to hospital `b` — still in clinical standing,
    // no longer reaching a chart that is only recorded at `a`.
    const owner = { doctor: { is: { user: { is: { email: testEmail('ai-owner') } } } } };
    const atA = await harness.prisma.doctorEmployment.findFirstOrThrow({
      where: { ...owner, endedAt: null },
      select: { id: true },
    });
    await harness.prisma.doctorEmployment.update({
      where: { id: atA.id },
      data: { endedAt: new Date() },
    });
    await makeClinicalDoctor(
      harness.prisma,
      testEmail('ai-owner'),
      await fixtureHospital(harness.prisma, 'b'),
    );

    const refused = await send(doctorToken, thread.id);
    expect(refused.status).toBe(404);

    // Restored, so the rest of the file is unaffected.
    await harness.prisma.doctorEmployment.updateMany({
      where: { ...owner, endedAt: null },
      data: { endedAt: new Date() },
    });
    await harness.prisma.doctorEmployment.update({
      where: { id: atA.id },
      data: { endedAt: null },
    });
    await makeClinicalDoctor(harness.prisma, testEmail('ai-owner'));
  });
});

describe('RM M16.4 verify — the answer streams, and ends in one of three states', () => {
  it('sends deltas then done, and persists the answer complete', async () => {
    const thread = await generalThread(doctorToken);
    script = { kind: 'stream', deltas: ['Potassium ', 'is ', 'high.'] };

    const { status, frames } = await send(doctorToken, thread.id, 'Interpret this result');

    expect(status).toBe(200);

    const deltas = frames.filter((frame) => frame.event === 'delta');
    const done = frames.find((frame) => frame.event === 'done');

    // Deltas, not a cumulative string: three chunks in, three out.
    expect(deltas.map((frame) => frame.data.text)).toEqual(['Potassium ', 'is ', 'high.']);
    expect(done?.data.status).toBe('complete');
    expect(frames.at(-1)?.event).toBe('done');

    const detail = dataOf<ConversationView>(
      await conversation(doctorToken, `/${thread.id}`).expect(200),
    );
    const answer = detail.messages?.find((message) => message.role === 'assistant');

    expect(answer?.content).toBe('Potassium is high.');
    expect(answer?.status).toBe('complete');
    expect(answer?.error).toBeNull();
  });

  it('persists the question before anything is generated', async () => {
    const thread = await generalThread(doctorToken);
    script = { kind: 'fail', after: 0 };

    await send(doctorToken, thread.id, 'Does this interact with warfarin?');

    const detail = dataOf<ConversationView>(
      await conversation(doctorToken, `/${thread.id}`).expect(200),
    );
    const question = detail.messages?.find((message) => message.role === 'user');

    // A question that reached the server is a question that was asked,
    // whatever the provider then did.
    expect(question?.content).toBe('Does this interact with warfarin?');
    expect(question?.status).toBe('complete');
  });

  it('persists error, with the partial text, when the provider fails', async () => {
    const thread = await generalThread(doctorToken);
    script = { kind: 'fail', after: 2 };

    const { frames } = await send(doctorToken, thread.id);
    expect(frames.find((frame) => frame.event === 'done')?.data.status).toBe('error');

    const detail = dataOf<ConversationView>(
      await conversation(doctorToken, `/${thread.id}`).expect(200),
    );
    const answer = detail.messages?.find((message) => message.role === 'assistant');

    expect(answer?.status).toBe('error');
    expect(answer?.error).not.toBeNull();
    // The partial answer is kept: an empty thread after a failed send is
    // indistinguishable from a send that never happened.
    expect(answer?.content).toContain('chunk-0');
  });

  it('names the thread after its first question', async () => {
    const thread = await generalThread(doctorToken);
    expect(thread.title).toBe('New conversation');

    script = { kind: 'stream', deltas: ['Yes.'] };
    await send(doctorToken, thread.id, 'Is metformin safe at eGFR 40?');

    const detail = dataOf<ConversationView>(
      await conversation(doctorToken, `/${thread.id}`).expect(200),
    );
    expect(detail.title).toBe('Is metformin safe at eGFR 40?');
  });

  it('does not overwrite a title the doctor set', async () => {
    const thread = await generalThread(doctorToken);

    await request(fakeServer)
      .patch(`${CONVERSATIONS}/${thread.id}`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ title: 'Renal dosing' })
      .expect(200);

    script = { kind: 'stream', deltas: ['Yes.'] };
    await send(doctorToken, thread.id, 'Is metformin safe at eGFR 40?');

    const detail = dataOf<ConversationView>(
      await conversation(doctorToken, `/${thread.id}`).expect(200),
    );
    expect(detail.title).toBe('Renal dosing');
  });

  it('streams rather than buffering, which is why the 30 s timeout is never hit', async () => {
    // The header that makes it true through a proxy. Without
    // `X-Accel-Buffering: no`, a deployment behind nginx streams
    // perfectly in development and arrives all at once in production.
    const thread = await generalThread(doctorToken);
    script = { kind: 'stream', deltas: ['a', 'b'] };

    const response = await request(fakeServer)
      .post(`${CONVERSATIONS}/${thread.id}/messages`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ content: 'Hello' });

    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.headers['cache-control']).toContain('no-transform');
    expect(response.headers['x-accel-buffering']).toBe('no');
  });

  it('persists stopped when the client disconnects mid-stream', async () => {
    // M16.4's verify step, and the outcome that is easiest to get wrong:
    // the only notification of a disconnect is Express's `close` event,
    // and if it does not reach the service generator the row stays as it
    // was created — an empty answer that reads as `complete`.
    //
    // Driven with a raw request rather than supertest, because what is
    // under test is destroying the socket mid-response, which supertest
    // has no way to express.
    const thread = await generalThread(doctorToken);
    script = { kind: 'hang', after: 2 };

    const address = fakeServer.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;

    await new Promise<void>((resolve, reject) => {
      const payload = JSON.stringify({ content: 'A long question' });
      let streamed = false;
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port,
          method: 'POST',
          path: `${CONVERSATIONS}/${thread.id}/messages`,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            Authorization: `Bearer ${doctorToken}`,
          },
        },
        (res) => {
          res.on('data', () => {
            // The first chunk proves the stream is open. Hanging up now
            // is exactly what a doctor pressing Stop does.
            streamed = true;
            req.destroy();
            resolve();
          });
        },
      );

      // `destroy()` surfaces as an error on the request, and that one is
      // expected. A failure *before* the first chunk is not — it would
      // otherwise resolve this promise and leave the assertion below
      // reporting a missing message rather than a connection that never
      // landed, which is exactly how this test failed on its first run.
      req.on('error', (cause) => {
        if (streamed) resolve();
        else reject(cause);
      });
      req.setTimeout(5_000, () => {
        req.destroy();
        reject(new Error('the stream never produced a chunk'));
      });
      req.write(payload);
      req.end();
    });

    // The `finally` in the service runs after the socket closes, so the
    // read is retried briefly rather than assumed to have landed.
    const answer = await eventually(async () => {
      const detail = dataOf<ConversationView>(
        await conversation(doctorToken, `/${thread.id}`).expect(200),
      );
      const message = detail.messages?.find((entry) => entry.role === 'assistant');

      // Both turns are there — the question and the interrupted answer.
      expect(detail.messages).toHaveLength(2);
      expect(message?.status).toBe('stopped');

      return message;
    });

    // The partial answer is kept: a doctor who stopped a long answer
    // having read enough should find what they read still there.
    expect(answer?.content).toContain('chunk-0');
  });

  it('refuses a send on someone else’s thread before opening a stream', async () => {
    // The refusal is an ordinary 404 with the error envelope, not a 200
    // carrying an error event — which is the whole reason the route
    // writes its own headers rather than using Nest's `@Sse()`.
    const thread = await generalThread(doctorToken);

    const response = await request(fakeServer)
      .post(`${CONVERSATIONS}/${thread.id}/messages`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .send({ content: 'Hello' });

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toContain('application/json');
  });

  it('refuses an empty question', async () => {
    const thread = await generalThread(doctorToken);

    await request(fakeServer)
      .post(`${CONVERSATIONS}/${thread.id}/messages`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ content: '   ' })
      .expect(422);
  });
});

describe('RM M16.5 verify — settings round-trip; out-of-range temperature → 422', () => {
  it('answers the documented defaults for a user who has never saved', async () => {
    const token = await seedDoctor(harness, 'ai-defaults');
    const settings = dataOf<SettingsView>(
      await request(fakeServer).get(SETTINGS).set('Authorization', `Bearer ${token}`).expect(200),
    );

    // `DEFAULT_AI_SETTINGS`, verbatim.
    expect(settings).toMatchObject({
      temperature: 0.3,
      responseLength: 'balanced',
      language: 'en',
      autoContext: true,
      streaming: true,
    });
    // The two defaults the frontend names as slugs, resolved to the
    // deployment's own template ids.
    expect(settings.favoritePromptIds).toHaveLength(2);
  });

  it('round-trips a saved document', async () => {
    const token = await seedDoctor(harness, 'ai-roundtrip');
    const prompts = dataOf<PromptView[]>(
      await request(fakeServer).get(PROMPTS).set('Authorization', `Bearer ${token}`).expect(200),
    );

    const body = {
      temperature: 0.7,
      responseLength: 'detailed',
      language: 'ar',
      autoContext: false,
      streaming: false,
      favoritePromptIds: [prompts[0]?.id ?? ''],
    };

    const saved = dataOf<SettingsView>(
      await request(fakeServer)
        .put(SETTINGS)
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .expect(200),
    );
    expect(saved).toMatchObject(body);

    const reread = dataOf<SettingsView>(
      await request(fakeServer).get(SETTINGS).set('Authorization', `Bearer ${token}`).expect(200),
    );
    expect(reread).toMatchObject(body);
  });

  it('refuses a temperature outside 0–1 with 422', async () => {
    const token = await seedDoctor(harness, 'ai-temp-range');

    for (const temperature of [-0.1, 1.1, 2]) {
      await request(fakeServer)
        .put(SETTINGS)
        .set('Authorization', `Bearer ${token}`)
        .send({
          temperature,
          responseLength: 'balanced',
          language: 'en',
          autoContext: true,
          streaming: true,
          favoritePromptIds: [],
        })
        .expect(422);
    }
  });

  it('refuses a temperature off the 0.1 step', async () => {
    // `AI_TEMPERATURES` is an eleven-element array on the frontend; an
    // API accepting 0.37 would silently contradict its own slider.
    const token = await seedDoctor(harness, 'ai-temp-step');

    await request(fakeServer)
      .put(SETTINGS)
      .set('Authorization', `Bearer ${token}`)
      .send({
        temperature: 0.37,
        responseLength: 'balanced',
        language: 'en',
        autoContext: true,
        streaming: true,
        favoritePromptIds: [],
      })
      .expect(422);
  });

  it('accepts every step the frontend’s slider can produce', async () => {
    // The step check must not over-reach: 0.3 * 10 is 2.9999999999999996
    // in IEEE 754, so an exact modulo test would reject a value the
    // slider emits.
    const token = await seedDoctor(harness, 'ai-temp-steps');

    for (const temperature of [0, 0.1, 0.2, 0.3, 0.7, 0.9, 1]) {
      await request(fakeServer)
        .put(SETTINGS)
        .set('Authorization', `Bearer ${token}`)
        .send({
          temperature,
          responseLength: 'balanced',
          language: 'en',
          autoContext: true,
          streaming: true,
          favoritePromptIds: [],
        })
        .expect(200);
    }
  });

  it('refuses a favourite naming a template that does not exist', async () => {
    const token = await seedDoctor(harness, 'ai-fav-unknown');

    await request(fakeServer)
      .put(SETTINGS)
      .set('Authorization', `Bearer ${token}`)
      .send({
        temperature: 0.3,
        responseLength: 'balanced',
        language: 'en',
        autoContext: true,
        streaming: true,
        favoritePromptIds: ['00000000-0000-4000-8000-000000000000'],
      })
      .expect(422);
  });

  it('serves the prompt library, marked with the caller’s favourites', async () => {
    const prompts = dataOf<PromptView[]>(
      await request(fakeServer)
        .get(PROMPTS)
        .set('Authorization', `Bearer ${doctorToken}`)
        .expect(200),
    );

    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts[0]).toMatchObject({
      id: expect.any(String) as string,
      title: expect.any(String) as string,
      message: expect.any(String) as string,
    });
    // Affinity is ranking only — nullable rather than defaulted, because
    // a prompt with no affinity is general-purpose, not mis-tagged.
    expect(prompts.every((prompt) => typeof prompt.favorite === 'boolean')).toBe(true);
  });
});

describe('RM M16.7 — the thumbs (API §11.7)', () => {
  it('records a rating on an assistant turn', async () => {
    const thread = await generalThread(doctorToken);
    script = { kind: 'stream', deltas: ['Yes.'] };
    const { frames } = await send(doctorToken, thread.id);

    const messageId = String(frames.find((frame) => frame.event === 'done')?.data.messageId);

    const rated = dataOf<MessageView>(
      await request(fakeServer)
        .post(`/api/v1/ai/messages/${messageId}/feedback`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ rating: 'down' })
        .expect(200),
    );

    expect(rated.feedback).toBe(-1);

    // Readable afterwards, so a refresh does not show the thumb
    // un-pressed and invite the doctor to rate the same answer twice.
    const detail = dataOf<ConversationView>(
      await conversation(doctorToken, `/${thread.id}`).expect(200),
    );
    expect(detail.messages?.find((message) => message.id === messageId)?.feedback).toBe(-1);
  });

  it('refuses a rating on a colleague’s message, as not found', async () => {
    const thread = await generalThread(doctorToken);
    script = { kind: 'stream', deltas: ['Yes.'] };
    const { frames } = await send(doctorToken, thread.id);
    const messageId = String(frames.find((frame) => frame.event === 'done')?.data.messageId);

    await request(fakeServer)
      .post(`/api/v1/ai/messages/${messageId}/feedback`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .send({ rating: 'up' })
      .expect(404);
  });

  it('refuses a rating on the doctor’s own question', async () => {
    // A thumb on your own question is a rating of yourself.
    const thread = await generalThread(doctorToken);
    script = { kind: 'stream', deltas: ['Yes.'] };
    await send(doctorToken, thread.id);

    const detail = dataOf<ConversationView>(
      await conversation(doctorToken, `/${thread.id}`).expect(200),
    );
    const question = detail.messages?.find((message) => message.role === 'user');

    await request(fakeServer)
      .post(`/api/v1/ai/messages/${question?.id ?? ''}/feedback`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ rating: 'up' })
      .expect(404);
  });
});

describe('RM M16.1 — the gateway sees a prompt, never a chart', () => {
  it('sends the model the grounding line and the turns, and no MRN', async () => {
    const thread = dataOf<ConversationView>(
      await createThread(doctorToken, { mode: 'patient', patientId: patient.id }),
    );

    script = { kind: 'stream', deltas: ['Noted.'] };
    lastRequest = null;
    await send(doctorToken, thread.id, 'Summarise the risks');

    const sent = gatewaySaw();

    expect(sent.system).toContain(patient.name);
    expect(sent.system).toContain(patient.id);
    // The identifier that crosses systems stays home.
    expect(sent.system).not.toContain(patient.mrn);
    // The doctor's question is the last turn.
    expect(sent.turns.at(-1)).toMatchObject({
      role: 'user',
      content: 'Summarise the risks',
    });
  });

  it('applies the caller’s temperature and length to the request', async () => {
    const token = await seedDoctor(harness, 'ai-applies');
    await request(fakeServer)
      .put(SETTINGS)
      .set('Authorization', `Bearer ${token}`)
      .send({
        temperature: 0.9,
        responseLength: 'concise',
        language: 'en',
        autoContext: true,
        streaming: true,
        favoritePromptIds: [],
      })
      .expect(200);

    const thread = await generalThread(token);
    script = { kind: 'stream', deltas: ['Short.'] };
    lastRequest = null;
    await send(token, thread.id);

    const sent = gatewaySaw();

    expect(sent.temperature).toBe(0.9);
    expect(sent.maxOutputTokens).toBe(400);
    expect(sent.system).toContain('few sentences');
  });
});

describe('the unconfigured gateway is what a deployment without a key gets', () => {
  it('answers the assistant’s own routes normally', async () => {
    // Everything except generation is this module's own data. A
    // deployment without a provider still gets threads, settings and
    // prompts — which is why the stub refuses only `generate`.
    const thread = dataOf<ConversationView>(
      await (async () => {
        const response = await request(harness.server)
          .post(CONVERSATIONS)
          .set('Authorization', `Bearer ${doctorToken}`)
          .send({ context: { mode: 'general' } });

        expect(response.status).toBe(201);

        return response;
      })(),
    );

    expect(thread.id).toBeTruthy();
    await request(harness.server)
      .get(PROMPTS)
      .set('Authorization', `Bearer ${doctorToken}`)
      .expect(200);
  });

  it('reports itself as unconfigured rather than claiming a model', async () => {
    const model = dataOf<{ name: string; configured: boolean }>(
      await request(harness.server)
        .get('/api/v1/ai/model')
        .set('Authorization', `Bearer ${doctorToken}`)
        .expect(200),
    );

    expect(model.configured).toBe(false);
  });

  it('fails a generation loudly instead of returning canned prose', async () => {
    // A stub that answered in a clinical assistant's voice would be
    // worse than a failure: a clinician reading "no interaction found"
    // would have no way to know nothing had looked.
    //
    // The failure surfaces as a message with status `error` rather than
    // as a 503, and that is M16.4's contract rather than a compromise:
    // "errors → status `error`". It also makes an unconfigured
    // deployment behave exactly like one whose provider is down, which
    // is the behaviour a client only has to handle once. The 503 the
    // gateway raises is not lost — it becomes the message's `error`
    // line, which is what the chat renders.
    const thread = dataOf<ConversationView>(
      await (async () => {
        const response = await request(harness.server)
          .post(CONVERSATIONS)
          .set('Authorization', `Bearer ${doctorToken}`)
          .send({ context: { mode: 'general' } });
        expect(response.status).toBe(201);
        return response;
      })(),
    );

    const response = await request(harness.server)
      .post(`${CONVERSATIONS}/${thread.id}/messages`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ content: 'Anything?' })
      .buffer(true)
      .parse((res, callback) => {
        let body = '';
        res.on('data', (chunk: Buffer) => {
          body += chunk.toString('utf8');
        });
        res.on('end', () => {
          callback(null, body);
        });
      });

    const done = parseSse(String(response.body ?? '')).find((frame) => frame.event === 'done');
    expect(done?.data.status).toBe('error');

    const detail = dataOf<ConversationView>(
      await request(harness.server)
        .get(`${CONVERSATIONS}/${thread.id}`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .expect(200),
    );
    const answer = detail.messages?.find((message) => message.role === 'assistant');

    expect(answer?.status).toBe('error');
    // The stub's own words, not an invented apology — and emphatically
    // not an answer.
    expect(answer?.error).toContain('not configured');
    expect(answer?.content).toBe('');
  });
});
