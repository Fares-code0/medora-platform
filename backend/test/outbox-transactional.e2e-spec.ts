import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { OUTBOX, type OutboxPort } from '../src/shared/outbox';

import { type AuthHarness, createAuthHarness } from './support/auth-app';

/**
 * The transactional outbox — RM M19.1.
 *
 * > ✅ Verify: event rows commit with the domain transaction; rollback
 * > test shows no orphan events.
 *
 * Both halves of that sentence are properties of the *mechanism*, so
 * they are driven against the port itself rather than inferred from an
 * endpoint that happens to publish. The rollback case is the one that
 * matters: it is the failure the outbox pattern exists to prevent, and
 * the M2 stub — which logged and discarded — would have "passed" every
 * other assertion here while failing this one silently.
 *
 * `domain_events` has no owning user and therefore no cascade, so this
 * suite deletes its own rows by topic prefix. Every topic it publishes
 * starts with `test.` for exactly that reason, and no production
 * publisher uses that prefix.
 */
let harness: AuthHarness;
let outbox: OutboxPort;

const TOPIC = 'test.outbox';

beforeAll(async () => {
  harness = await createAuthHarness('outbox.m19');
  outbox = harness.app.get<OutboxPort>(OUTBOX);
});

afterAll(async () => {
  await harness.prisma.domainEvent.deleteMany({ where: { topic: { startsWith: 'test.' } } });
  await harness.close();
});

beforeEach(async () => {
  await harness.prisma.domainEvent.deleteMany({ where: { topic: { startsWith: 'test.' } } });
});

function rows(topic: string) {
  return harness.prisma.domainEvent.findMany({ where: { topic }, orderBy: { createdAt: 'asc' } });
}

describe('publishWithin — the event commits with the domain transaction', () => {
  it('records the event when the transaction commits', async () => {
    await harness.prisma.$transaction(async (tx) => {
      await outbox.publishWithin(tx, {
        topic: TOPIC,
        payload: { appointmentId: 'apt-1' },
        dedupeKey: 'commit-1',
        correlationId: 'corr-1',
      });
    });

    const found = await rows(TOPIC);

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      topic: TOPIC,
      dedupeKey: 'commit-1',
      correlationId: 'corr-1',
      status: 'pending',
      attempts: 0,
      deliveredAt: null,
      lastError: null,
    });
    expect(found[0]?.payload).toEqual({ appointmentId: 'apt-1' });
  });

  /**
   * The orphan test the verify step names.
   *
   * A publisher that wrote to a broker — or to its own transaction —
   * would leave this event behind after the rollback, and a consumer
   * would then act on a fact that never happened.
   */
  it('leaves no event behind when the transaction rolls back', async () => {
    await expect(
      harness.prisma.$transaction(async (tx) => {
        await outbox.publishWithin(tx, {
          topic: TOPIC,
          payload: { appointmentId: 'apt-2' },
          dedupeKey: 'rollback-1',
        });

        throw new Error('the domain write failed');
      }),
    ).rejects.toThrow('the domain write failed');

    expect(await rows(TOPIC)).toHaveLength(0);
  });

  /**
   * The rollback must take the event even when the *domain* write is
   * what fails afterwards — the realistic ordering, since a service
   * publishes before its last statement as often as after it.
   */
  it('leaves no event behind when a later statement in the same transaction fails', async () => {
    await expect(
      harness.prisma.$transaction(async (tx) => {
        await outbox.publishWithin(tx, {
          topic: TOPIC,
          payload: { n: 1 },
          dedupeKey: 'rollback-2',
        });

        // A foreign key that cannot resolve: the row is rejected by the
        // database rather than by application code, so the rollback is
        // the real one and not a thrown Error standing in for it.
        await tx.notification.create({
          data: {
            recipientId: '00000000-0000-4000-8000-000000000000',
            title: 'orphan',
            body: 'orphan',
            category: 'SYSTEM',
            kind: 'ALERT',
            sender: 'test',
          },
        });
      }),
    ).rejects.toThrow();

    expect(await rows(TOPIC)).toHaveLength(0);
  });

  it('propagates its failure rather than swallowing it, so the caller rolls back', async () => {
    await expect(
      harness.prisma.$transaction(async (tx) => {
        await outbox.publishWithin(tx, {
          topic: TOPIC,
          payload: { n: 1 },
          // varchar(200); 201 characters is rejected by the column.
          dedupeKey: 'x'.repeat(201),
        });
      }),
    ).rejects.toThrow();

    expect(await rows(TOPIC)).toHaveLength(0);
  });
});

describe('dedupeKey — at-least-once delivery means retries must collapse', () => {
  it('records one row for a message published twice with the same key', async () => {
    const message = { topic: TOPIC, payload: { n: 1 }, dedupeKey: 'same-key' };

    await harness.prisma.$transaction((tx) => outbox.publishWithin(tx, message));
    await harness.prisma.$transaction((tx) => outbox.publishWithin(tx, message));

    expect(await rows(TOPIC)).toHaveLength(1);
  });

  /**
   * The retry must not poison the transaction it is in. `skipDuplicates`
   * is what makes the second publish a no-op rather than a constraint
   * violation that would roll back a perfectly good domain write.
   */
  it('lets the enclosing transaction commit when a duplicate is republished', async () => {
    await harness.prisma.$transaction((tx) =>
      outbox.publishWithin(tx, { topic: TOPIC, payload: { n: 1 }, dedupeKey: 'commit-through' }),
    );

    await harness.prisma.$transaction(async (tx) => {
      await outbox.publishWithin(tx, {
        topic: TOPIC,
        payload: { n: 2 },
        dedupeKey: 'commit-through',
      });
      await outbox.publishWithin(tx, { topic: `${TOPIC}.other`, payload: { n: 3 } });
    });

    expect(await rows(TOPIC)).toHaveLength(1);
    expect(await rows(`${TOPIC}.other`)).toHaveLength(1);
  });

  /**
   * A message that declines to name a key is never deduplicated — which
   * is the documented behaviour of a UNIQUE index over a nullable
   * column, and the reason the column is nullable rather than required.
   */
  it('records every copy of a message that names no key', async () => {
    const message = { topic: TOPIC, payload: { n: 1 } };

    await harness.prisma.$transaction((tx) => outbox.publishWithin(tx, message));
    await harness.prisma.$transaction((tx) => outbox.publishWithin(tx, message));

    expect(await rows(TOPIC)).toHaveLength(2);
  });
});

describe('publish — the non-transactional form', () => {
  it('records the event', async () => {
    await outbox.publish({ topic: TOPIC, payload: { n: 1 }, dedupeKey: 'plain-1' });

    expect(await rows(TOPIC)).toHaveLength(1);
  });

  /**
   * Its call sites publish *after* their own write already committed, so
   * throwing here would turn a completed mutation into a 500 the client
   * retries — the same reasoning `PrismaActivityRecorder` records. The
   * event is lost and logged; the clinician's write is not undone.
   */
  it('does not throw when the row cannot be written', async () => {
    await expect(
      outbox.publish({ topic: TOPIC, payload: { n: 1 }, dedupeKey: 'y'.repeat(201) }),
    ).resolves.toBeUndefined();

    expect(await rows(TOPIC)).toHaveLength(0);
  });
});

describe('the stored row is what a drain can work from', () => {
  it('starts pending with no attempts, which is what M30.1 claims', async () => {
    await harness.prisma.$transaction((tx) =>
      outbox.publishWithin(tx, { topic: TOPIC, payload: { patientId: 'p-1', count: 2 } }),
    );

    const [row] = await rows(TOPIC);

    expect(row?.status).toBe('pending');
    expect(row?.attempts).toBe(0);
    expect(row?.deliveredAt).toBeNull();
    // Scalars survive the JSONB round trip with their types intact — a
    // drain that re-read a number as a string would build the wrong
    // notification.
    expect(row?.payload).toEqual({ patientId: 'p-1', count: 2 });
  });

  it('refuses a status outside the closed vocabulary', async () => {
    await harness.prisma.$transaction((tx) =>
      outbox.publishWithin(tx, { topic: TOPIC, payload: { n: 1 }, dedupeKey: 'check-1' }),
    );

    // The CHECK is the database's, not the client's: a worker or a
    // fix-up script writing a fourth status would be skipped by the
    // drain forever, so the vocabulary is closed where every writer
    // meets it.
    await expect(
      harness.prisma.$executeRaw`UPDATE domain_events SET status = 'queued' WHERE dedupe_key = 'check-1'`,
    ).rejects.toThrow();
  });
});
