import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import { resolve } from 'node:path';

import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { seedProduction } from '../prisma/seed/production';
import { runReencryptCommand } from '../src/cli/reencrypt-envelopes.command';
import { ConfigService, type Env } from '../src/config';
import { TransactionalAuditWriter } from '../src/shared/audit';
import {
  DEFAULT_LOCK_TIMEOUTS,
  EnvelopeReencryptionService,
  EnvelopeService,
  INTEGRATION_DB_LABEL,
  ReencryptionLock,
  type HeldLock,
  type LockSessionClient,
  type LockTimeouts,
} from '../src/shared/crypto';
import {
  REENCRYPTION_LOCK_CLASS,
  REENCRYPTION_LOCK_OBJECT,
} from '../src/shared/crypto/reencryption.lock';
import { PrismaService } from '../src/shared/database';

/**
 * Regressions for the final security review of `DATA_ENCRYPTION_KEY`
 * rotation, findings R2, R3, R5, R6 and R8 (R1 and R4 — the wording — are
 * asserted in `envelope-key-rotation-hardening.e2e-spec.ts` and
 * `envelope-key-rotation.e2e-spec.ts`).
 *
 * Real PostgreSQL throughout, on a database created for this file. The two
 * transaction-pooling behaviours a session lock cannot survive are
 * reproduced with real connections behind the lock's client seam:
 * statements routed to different backends, and one server backend handed
 * to several clients. No PgBouncer is installed in this environment.
 */

const BACKEND = resolve(__dirname, '..');
const DB_NAME = `medora_rotation_safety_${String(process.pid)}`;
const K1 = Buffer.alloc(32, 0x51).toString('base64');
const K2 = Buffer.alloc(32, 0x52).toString('base64');
const LOCK_KEY = [REENCRYPTION_LOCK_CLASS, REENCRYPTION_LOCK_OBJECT];

function databaseUrl(name: string): string {
  const url = new URL(process.env['DATABASE_URL'] ?? '');
  url.pathname = `/${name}`;
  return url.toString();
}
const FRESH_URL = databaseUrl(DB_NAME);
const ADMIN_URL = databaseUrl('postgres');

function configOf(current: string, previous: readonly string[], url = FRESH_URL): ConfigService {
  return new ConfigService({
    DATABASE_URL: url,
    DATA_ENCRYPTION_KEY: current,
    DATA_ENCRYPTION_KEY_PREVIOUS: [...previous],
    DATA_ENCRYPTION_WRITE_FORMAT: 'legacy',
  } as unknown as Env);
}
const envelope = (current: string, previous: readonly string[] = []) =>
  new EnvelopeService(configOf(current, previous));

let prisma: PrismaService;
const ledger = new TransactionalAuditWriter();

function service(lock: ReencryptionLock = new ReencryptionLock(configOf(K2, [K1]))) {
  return new EnvelopeReencryptionService(prisma, envelope(K2, [K1]), ledger, lock);
}

interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}
async function cli(
  target: EnvelopeReencryptionService,
  args: string[],
  signal?: AbortSignal,
): Promise<CliResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runReencryptCommand(
    args,
    () => Promise.resolve({ service: target, close: () => Promise.resolve() }),
    { log: (line) => stdout.push(line), error: (line) => stderr.push(line) },
    signal === undefined ? {} : { signal },
  );
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

function keyOf(bytes: Uint8Array | null): string {
  if (bytes === null) return 'null';
  for (const [name, key] of [
    ['K1', K1],
    ['K2', K2],
  ] as const) {
    try {
      if (envelope(key).inspect(bytes).keyIndex === 0) return name;
    } catch {
      // not this key
    }
  }
  return 'unreadable';
}

let roleId = '';
async function credentialsUnderK1(count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < count; index++) {
    const tag = randomUUID().slice(0, 12);
    const user = await prisma.user.create({
      data: {
        publicId: `usr_safe_${tag}`,
        firstName: 'Safety',
        lastName: tag,
        displayName: `Safety ${tag}`,
        email: `${tag}@safety.test`,
        phone: '+15550000000',
        roleId,
        termsAcceptedAt: new Date(),
        privacyAcceptedAt: new Date(),
      },
    });
    await prisma.userCredential.create({
      data: { userId: user.id, passwordHash: 'x', totpSecretEnc: envelope(K1).encrypt('S') },
    });
    ids.push(user.id);
  }
  return ids.sort();
}

async function underK2(): Promise<number> {
  const rows = await prisma.userCredential.findMany({ select: { totpSecretEnc: true } });
  return rows.filter((row) => keyOf(row.totpSecretEnc) === 'K2').length;
}

async function auditRows(): Promise<{ eventType: string; payload: Record<string, unknown> }[]> {
  const rows = await prisma.auditEvent.findMany({
    where: { eventType: { startsWith: 'encryption_key.' } },
    orderBy: { occurredAt: 'asc' },
    select: { eventType: true, payload: true },
  });
  return rows.map((row) => ({
    eventType: row.eventType,
    payload: (row.payload ?? {}) as Record<string, unknown>,
  }));
}

interface ColumnSeam {
  column: string;
  swap: (
    held: HeldLock,
    id: string,
    from: Uint8Array<ArrayBuffer>,
    to: Uint8Array<ArrayBuffer>,
  ) => Promise<boolean>;
  page: (after: string | null, take: number) => Promise<unknown>;
}
function totpColumn(target: EnvelopeReencryptionService): ColumnSeam {
  const columns = (target as unknown as { columns: ColumnSeam[] }).columns;
  const found = columns.find((column) => column.column === 'totp_secret_enc');
  if (found === undefined) throw new Error('no totp column');
  return found;
}

/** Pauses a run inside its first TOTP page — after it took the lock and checked it. */
function pauseInFirstPage(target: EnvelopeReencryptionService) {
  let release: () => void = () => undefined;
  let entered: () => void = () => undefined;
  const gate = new Promise<void>((resolveGate) => (release = resolveGate));
  const inside = new Promise<void>((resolveInside) => (entered = resolveInside));
  const totp = totpColumn(target);
  const original = totp.page;
  let first = true;
  totp.page = async (after, take) => {
    if (first) {
      first = false;
      entered();
      await gate;
    }
    return original(after, take);
  };
  return { inside, release };
}

async function terminateLockHolder(): Promise<void> {
  const admin = new Client({ connectionString: FRESH_URL });
  await admin.connect();
  await admin.query(
    `SELECT pg_terminate_backend(pid) FROM pg_locks
     WHERE locktype = 'advisory' AND classid = $1::int4::oid AND objid = $2::int4::oid
       AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
    LOCK_KEY,
  );
  await admin.end();
}

async function lockHeldAnywhere(): Promise<boolean> {
  return new ReencryptionLock(configOf(K2, [K1])).isHeldAnywhere();
}

/** Wraps a real client so a test can act just before a given statement. */
function wrapped(
  real: LockSessionClient,
  before: (text: string) => Promise<void>,
): LockSessionClient {
  return {
    connect: () => real.connect(),
    end: () => real.end(),
    on: (event, listener) => real.on(event, listener),
    query: async <R extends object>(text: string, values?: readonly unknown[]) => {
      await before(text);
      return real.query<R>(text, values);
    },
  };
}

beforeAll(async () => {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${DB_NAME}"`);
  await admin.end();
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: BACKEND,
    env: { ...process.env, DATABASE_URL: FRESH_URL },
    stdio: 'pipe',
  });
  prisma = new PrismaService(configOf(K2, [K1]));
  await prisma.$connect();
  await seedProduction(prisma);
  roleId = (await prisma.role.findUniqueOrThrow({ where: { code: 'doctor' } })).id;
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
  await admin.end();
});

beforeEach(async () => {
  await prisma.userIntegration.deleteMany({});
  await prisma.userCredential.deleteMany({});
  await prisma.auditEvent.deleteMany({ where: { eventType: { startsWith: 'encryption_key.' } } });
});

// ── R2 ──────────────────────────────────────────────────────────────────

describe('R2 — no write after the lock is lost', () => {
  it('after its lock session is killed, a run writes nothing more — even while a successor holds the lock', async () => {
    await credentialsUnderK1(40);
    const target = service();
    const paused = pauseInFirstPage(target);
    const running = cli(target, ['--confirm', '--batch-size', '200']);
    await paused.inside;

    await terminateLockHolder();
    // A successor takes the lock while the first run still has a full page
    // of 40 rows to visit (the review's probe B: before the fix, all 40
    // were written under the successor's lock).
    const successor = await new ReencryptionLock(configOf(K2, [K1])).acquire();
    expect(successor).not.toBeNull();

    paused.release();
    const result = await running;

    expect(result.code).toBe(1);
    expect(await underK2()).toBe(0);
    const failure = (await auditRows()).find(
      (row) => row.eventType === 'encryption_key.reencrypt_failed',
    );
    expect(failure?.payload).toMatchObject({
      errorType: 'ReencryptionLockLostError',
      resealed: 0,
      uncertainWrites: 0,
    });
    await successor?.release();
  });

  it('a write that finds the lock released on a live session is refused in-statement, and nothing is written', async () => {
    const [userId] = await credentialsUnderK1(1);
    class UnlocksBeforeFirstWrite extends ReencryptionLock {
      protected override createClient(): LockSessionClient {
        const real = super.createClient();
        let done = false;
        return wrapped(real, async (text) => {
          if (!done && text.includes('WITH guard')) {
            done = true;
            await real.query('SELECT pg_advisory_unlock($1::int4, $2::int4)', LOCK_KEY);
          }
        });
      }
    }

    const result = await cli(service(new UnlocksBeforeFirstWrite(configOf(K2, [K1]))), [
      '--confirm',
    ]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('a write found the lock not held; nothing was written');
    const row = await prisma.userCredential.findUniqueOrThrow({ where: { userId: userId ?? '' } });
    expect(keyOf(row.totpSecretEnc)).toBe('K1');
    const failure = (await auditRows()).find(
      (entry) => entry.eventType === 'encryption_key.reencrypt_failed',
    );
    expect(failure?.payload).toMatchObject({ resealed: 0, uncertainWrites: 0 });
  });

  it('writes the integration key the database stores, not Prisma’s enum name', async () => {
    const labels = await prisma.$queryRaw<{ label: string }[]>`
      SELECT unnest(enum_range(NULL::integration_id))::text AS label`;
    expect(Object.values(INTEGRATION_DB_LABEL).sort()).toEqual(
      labels.map((row) => row.label).sort(),
    );

    const [userId] = await credentialsUnderK1(1);
    await prisma.userIntegration.create({
      data: {
        userId: userId ?? '',
        integration: 'GOOGLE_CALENDAR',
        oauthTokensEnc: envelope(K1).encrypt('t'),
      },
    });
    const result = await cli(service(), ['--confirm']);
    expect(result.code).toBe(0);
    const row = await prisma.userIntegration.findUniqueOrThrow({
      where: { userId_integration: { userId: userId ?? '', integration: 'GOOGLE_CALENDAR' } },
    });
    expect(keyOf(row.oauthTokensEnc)).toBe('K2');
  });
});

// ── R3 ──────────────────────────────────────────────────────────────────

describe('R3 — a transaction-mode pooler is detected and refused', () => {
  it('statements routed to different server backends: refused with exit 6, nothing done', async () => {
    await credentialsUnderK1(2);
    /** What a transaction-mode pooler does: each statement on whichever backend is free. */
    class RoundRobinLock extends ReencryptionLock {
      protected override createClient(): LockSessionClient {
        const backends = [super.createClient(), super.createClient()];
        let next = 0;
        return {
          connect: async () => {
            for (const backend of backends) await backend.connect();
          },
          end: async () => {
            for (const backend of backends) await backend.end();
          },
          on: (event, listener) => {
            for (const backend of backends) backend.on(event, listener);
          },
          query: <R extends object>(text: string, values?: readonly unknown[]) => {
            const backend = backends[next % backends.length];
            next++;
            if (backend === undefined) throw new Error('no backend');
            return backend.query<R>(text, values);
          },
        };
      }
    }

    const result = await cli(service(new RoundRobinLock(configOf(K2, [K1]))), ['--confirm']);

    expect(result.code).toBe(6);
    expect(result.stderr).toContain('transaction-mode pooler');
    expect(result.stderr).toContain('different server backends');
    expect(await underK2()).toBe(0);
    expect(await auditRows()).toEqual([]);
    expect(await lockHeldAnywhere()).toBe(false);
  });

  describe('one server backend shared between clients', () => {
    let shared: Client;
    beforeEach(async () => {
      shared = new Client({ connectionString: FRESH_URL });
      await shared.connect();
    });

    /** Every "connection" is the same server backend, as a pooler hands out an idle one. */
    class SharedBackendLock extends ReencryptionLock {
      protected override createClient(): LockSessionClient {
        return {
          connect: () => Promise.resolve(),
          end: () => Promise.resolve(),
          on: () => undefined,
          query: <R extends object>(text: string, values?: readonly unknown[]) =>
            shared.query<R>(text, values === undefined ? undefined : [...values]),
        };
      }
    }

    it('the backend another client already locked on is refused — the review’s re-entrant double ownership', async () => {
      await shared.query('SELECT pg_advisory_lock($1::int4, $2::int4)', LOCK_KEY);
      try {
        const result = await cli(service(new SharedBackendLock(configOf(K2, [K1]))), ['--confirm']);
        expect(result.code).toBe(6);
        expect(result.stderr).toContain('already holds the advisory lock');
        expect(await auditRows()).toEqual([]);
      } finally {
        await shared.end();
      }
    });

    it('a second connection given the lock holder’s backend is refused, and the lock it took is undone', async () => {
      try {
        const result = await cli(service(new SharedBackendLock(configOf(K2, [K1]))), ['--confirm']);
        expect(result.code).toBe(6);
        expect(result.stderr).toContain('second connection was given the lock holder');
        const after = await shared.query<{ held: boolean }>(
          `SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()
             AND classid = $1::int4::oid AND objid = $2::int4::oid) AS held`,
          LOCK_KEY,
        );
        expect(after.rows[0]?.held).toBe(false);
      } finally {
        await shared.end();
      }
    });
  });

  it('a direct connection passes every check (the supported configuration)', async () => {
    await credentialsUnderK1(2);
    const result = await cli(service(), ['--confirm']);
    expect(result.code).toBe(0);
    expect(await underK2()).toBe(2);
  });
});

// ── R5 ──────────────────────────────────────────────────────────────────

describe('R5 — interrupts are recorded, and runs without an outcome are listed', () => {
  it('SIGTERM mid-run stops before the next write, records "interrupted" with counts, exits 5, and a rerun completes', async () => {
    await credentialsUnderK1(6);
    const target = service();
    const totp = totpColumn(target);
    const original = totp.swap;
    const interrupt = new AbortController();
    let writes = 0;
    totp.swap = async (held, id, from, to) => {
      const ok = await original(held, id, from, to);
      writes++;
      if (writes === 2) interrupt.abort('SIGTERM');
      return ok;
    };

    const result = await cli(target, ['--confirm'], interrupt.signal);
    totp.swap = original;

    expect(result.code).toBe(5);
    expect(result.stderr).toContain('was interrupted after 2 value(s) were re-sealed');
    expect(result.stderr).toContain('reencrypt_failed (interrupted');
    expect(await underK2()).toBe(2);
    const rows = await auditRows();
    expect(rows.map((row) => row.eventType)).toEqual([
      'encryption_key.reencrypt_started',
      'encryption_key.reencrypt_failed',
    ]);
    expect(rows[1]?.payload).toMatchObject({
      status: 'interrupted',
      errorType: 'ReencryptionInterruptedError',
      resealed: 2,
      uncertainWrites: 0,
      countsAreLowerBounds: false,
    });
    expect(await lockHeldAnywhere()).toBe(false);

    expect((await cli(service(), ['--confirm'])).code).toBe(0);
  });

  it('a signal before the run starts does nothing at all', async () => {
    await credentialsUnderK1(1);
    const interrupt = new AbortController();
    interrupt.abort('SIGINT');
    const result = await cli(service(), ['--confirm'], interrupt.signal);
    expect(result.code).toBe(5);
    expect(result.stderr).toContain('nothing was done');
    expect(await auditRows()).toEqual([]);
    expect(await underK2()).toBe(0);
  });

  it('--status lists a started run with no outcome (a SIGKILL), and tells it from the run holding the lock now', async () => {
    await credentialsUnderK1(2);
    // A run killed outright: its `started` row, and nothing after.
    const killedRunId = randomUUID();
    await prisma.$transaction((tx) =>
      ledger.recordWithin(tx, {
        action: 'encryption_key.reencrypt_started',
        actor: { userId: null, role: null },
        entityType: 'encryption_key',
        entityId: 'probe',
        metadata: { runId: killedRunId },
        occurredAt: new Date(Date.now() - 60_000),
      }),
    );

    const afterKill = await cli(service(), ['--status']);
    expect(afterKill.code).toBe(1);
    expect(afterKill.stdout).toContain('No re-encryption holds the advisory lock right now.');
    expect(afterKill.stdout).toContain(`run ${killedRunId}  NO OUTCOME — ended without one`);
    expect(afterKill.stdout).toContain('1 run(s) started but never recorded an outcome');

    // A run in progress: lock held, started, no outcome yet — not "unmatched".
    const target = service();
    const paused = pauseInFirstPage(target);
    const running = cli(target, ['--confirm']);
    await paused.inside;
    const during = await cli(service(), ['--status']);
    expect(during.stdout).toMatch(
      /A confirm run \(run [0-9a-f-]{36}\) holds the advisory lock right now\./,
    );
    expect(during.stdout).toContain('no outcome yet — running now (it holds the lock)');
    expect(during.stdout).toContain('1 run(s) started but never recorded an outcome');
    paused.release();
    expect((await running).code).toBe(0);

    // The killed run stays listed (append-only evidence), but a later
    // complete run has re-verified every value, so it no longer fails --status.
    const after = await cli(service(), ['--status']);
    expect(after.stdout).toMatch(/run [0-9a-f-]{36} {2}complete at /);
    expect(after.stdout).toContain(
      `run ${killedRunId}  NO OUTCOME — ended without one (SIGKILL, power loss or machine failure); superseded by a later complete run`,
    );
    expect(after.code).toBe(0);
  });
});

// ── S4 ──────────────────────────────────────────────────────────────────

describe('S4 — --status identifies the lock holder by its run id, never by the newest started row', () => {
  async function recordKilledRun(): Promise<string> {
    const killedRunId = randomUUID();
    await prisma.$transaction((tx) =>
      ledger.recordWithin(tx, {
        action: 'encryption_key.reencrypt_started',
        actor: { userId: null, role: null },
        entityType: 'encryption_key',
        entityId: 'probe',
        metadata: { runId: killedRunId },
        occurredAt: new Date(Date.now() - 60_000),
      }),
    );
    return killedRunId;
  }

  it('a killed run stays unresolved — exit 1 — while a dry run holds the lock', async () => {
    await credentialsUnderK1(2);
    const killedRunId = await recordKilledRun();

    const dry = service();
    const paused = pauseInFirstPage(dry);
    const running = cli(dry, ['--dry-run']);
    await paused.inside;
    const during = await cli(service(), ['--status']);
    paused.release();
    await running;

    // Before the fix: the killed run was taken for the lock holder, and exit was 0.
    expect(during.code).toBe(1);
    expect(during.stdout).toMatch(
      /A dry run \(run [0-9a-f-]{36}\) holds the advisory lock right now\./,
    );
    expect(during.stdout).toContain(`run ${killedRunId}  NO OUTCOME — ended without one`);
    expect(during.stdout).toContain('1 run(s) started but never recorded an outcome');
  });

  it('a killed run stays unresolved while a confirm run holds the lock but has not written its started row', async () => {
    await credentialsUnderK1(2);
    const killedRunId = await recordKilledRun();

    let release: () => void = () => undefined;
    let entered: () => void = () => undefined;
    const gate = new Promise<void>((resolveGate) => (release = resolveGate));
    const inside = new Promise<void>((resolveInside) => (entered = resolveInside));
    const slowStart: Pick<TransactionalAuditWriter, 'recordWithin'> = {
      recordWithin: async (tx, event) => {
        if (event.action === 'encryption_key.reencrypt_started') {
          entered();
          await gate;
        }
        return ledger.recordWithin(tx, event);
      },
    };
    const confirm = new EnvelopeReencryptionService(
      prisma,
      envelope(K2, [K1]),
      slowStart as TransactionalAuditWriter,
      new ReencryptionLock(configOf(K2, [K1])),
    );
    const running = cli(confirm, ['--confirm']);
    await inside;
    const during = await cli(service(), ['--status']);
    release();
    expect((await running).code).toBe(0);

    expect(during.code).toBe(1);
    expect(during.stdout).toContain('its started record is not written yet');
    expect(during.stdout).toContain(`run ${killedRunId}  NO OUTCOME — ended without one`);
    expect(during.stdout).not.toContain('running now');
  });
});

// ── R6 ──────────────────────────────────────────────────────────────────

describe('R6 — failure summaries carry every counter, as lower bounds when a write was in flight', () => {
  it('a write that commits but whose acknowledgement is lost is reported as uncertain, never as unwritten', async () => {
    await credentialsUnderK1(5);
    const target = service();
    const totp = totpColumn(target);
    const original = totp.swap;
    let calls = 0;
    totp.swap = async (held, id, from, to) => {
      const ok = await original(held, id, from, to); // committed…
      calls++;
      if (calls === 3) throw new Error('Connection terminated unexpectedly'); // …acknowledgement lost
      return ok;
    };

    const result = await cli(target, ['--confirm']);
    totp.swap = original;

    expect(result.code).toBe(1);
    expect(await underK2()).toBe(3); // what actually happened
    expect(result.stderr).toContain('failed after at least 2 value(s) were re-sealed');
    expect(result.stderr).toContain('lower bounds');
    const failure = (await auditRows()).find(
      (row) => row.eventType === 'encryption_key.reencrypt_failed',
    );
    expect(failure?.payload).toMatchObject({
      status: 'failed',
      scanned: 3,
      alreadyCurrent: 0,
      resealed: 2,
      concurrentCurrent: 0,
      vanished: 0,
      staleWrites: 0,
      unreadable: 0,
      unresolved: 0,
      uncertainWrites: 1,
      countsAreLowerBounds: true,
    });

    const rerun = await cli(service(), ['--confirm']);
    expect(rerun.code).toBe(0);
    expect(rerun.stdout).toContain('5 scanned · 3 already current · 2 re-sealed');
  });
});

// ── R8 ──────────────────────────────────────────────────────────────────

describe('R8 — the lock connection has bounded waits and fails closed', () => {
  it('is configured with a connect timeout, a query timeout and TCP keepalive', () => {
    class Peek extends ReencryptionLock {
      client(): LockSessionClient {
        return this.createClient();
      }
    }
    const client = new Peek(configOf(K2, [K1])).client() as unknown as {
      connectionParameters: Record<string, unknown>;
      _connectionTimeoutMillis: number;
    };
    expect(client._connectionTimeoutMillis).toBe(DEFAULT_LOCK_TIMEOUTS.connectMs);
    expect(client.connectionParameters['query_timeout']).toBe(DEFAULT_LOCK_TIMEOUTS.queryMs);
    expect(client.connectionParameters['keepalives']).toBe(1);
    expect(client.connectionParameters['keepalives_idle']).toBe(
      DEFAULT_LOCK_TIMEOUTS.keepAliveInitialDelayMs / 1000,
    );
  });

  it('sets the server-side statement and row-lock timeouts on the lock session', async () => {
    let captured: LockSessionClient | null = null;
    class Capture extends ReencryptionLock {
      protected override createClient(): LockSessionClient {
        const client = super.createClient();
        captured ??= client;
        return client;
      }
    }
    const held = await new Capture(configOf(K2, [K1])).acquire();
    expect(held).not.toBeNull();
    const session = captured as LockSessionClient | null;
    if (session === null) throw new Error('no client captured');
    const statement = await session.query<{ statement_timeout: string }>('SHOW statement_timeout');
    const rowLock = await session.query<{ lock_timeout: string }>('SHOW lock_timeout');
    expect(statement.rows[0]?.statement_timeout).toBe(DEFAULT_LOCK_TIMEOUTS.statement);
    expect(rowLock.rows[0]?.lock_timeout).toBe(DEFAULT_LOCK_TIMEOUTS.rowLock);
    await held?.release();
  });

  it('a server that accepts but never answers times out the connect, and the socket is closed', async () => {
    const sockets = new Set<Socket>();
    const silent: Server = createServer((socket) => {
      // Read, so this end sees the client's close (an unread socket stays paused).
      socket.resume();
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    await new Promise<void>((done) => silent.listen(0, '127.0.0.1', done));
    const address = silent.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;

    class QuickConnect extends ReencryptionLock {
      protected override timeouts(): LockTimeouts {
        return { ...DEFAULT_LOCK_TIMEOUTS, connectMs: 300 };
      }
    }
    const started = Date.now();
    const lock = new QuickConnect(
      configOf(K2, [K1], `postgresql://medora:medora@127.0.0.1:${String(port)}/x`),
    );
    await expect(lock.acquire()).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(5_000);

    await new Promise((done) => setTimeout(done, 100));
    expect(sockets.size).toBe(0);
    await new Promise<void>((done) => silent.close(() => done()));
  });

  describe('a write waiting on a row that live traffic holds', () => {
    let blocker: Client;
    let userId = '';
    beforeEach(async () => {
      [userId = ''] = await credentialsUnderK1(1);
      blocker = new Client({ connectionString: FRESH_URL });
      await blocker.connect();
      await blocker.query('BEGIN');
      await blocker.query('SELECT 1 FROM user_credentials WHERE user_id = $1::uuid FOR UPDATE', [
        userId,
      ]);
    });

    it('server lock_timeout: the statement is rolled back — known unwritten — and the lock is freed', async () => {
      class ShortRowLock extends ReencryptionLock {
        protected override timeouts(): LockTimeouts {
          return { ...DEFAULT_LOCK_TIMEOUTS, rowLock: '200ms' };
        }
      }
      const result = await cli(service(new ShortRowLock(configOf(K2, [K1]))), ['--confirm']);
      await blocker.query('ROLLBACK');
      await blocker.end();

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('a statement on the lock session failed');
      expect(result.stderr).toContain('failed after 0 value(s) were re-sealed');
      const failure = (await auditRows()).find(
        (row) => row.eventType === 'encryption_key.reencrypt_failed',
      );
      expect(failure?.payload).toMatchObject({ uncertainWrites: 0, countsAreLowerBounds: false });
      expect(await underK2()).toBe(0);
      expect(await lockHeldAnywhere()).toBe(false);
    });

    it('client query timeout: the outcome is unknown, reported as a lower bound — and the write can indeed land later', async () => {
      class ShortQuery extends ReencryptionLock {
        protected override timeouts(): LockTimeouts {
          return { ...DEFAULT_LOCK_TIMEOUTS, queryMs: 300, rowLock: '20s', statement: '20s' };
        }
      }
      const result = await cli(service(new ShortQuery(configOf(K2, [K1]))), ['--confirm']);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('lower bounds');
      const failure = (await auditRows()).find(
        (row) => row.eventType === 'encryption_key.reencrypt_failed',
      );
      expect(failure?.payload).toMatchObject({ uncertainWrites: 1, countsAreLowerBounds: true });

      // The server was still waiting on the row: once live traffic lets go,
      // the abandoned statement commits. This is why it was "unknown".
      await blocker.query('ROLLBACK');
      await blocker.end();
      for (let attempt = 0; attempt < 50 && (await lockHeldAnywhere()); attempt++) {
        await new Promise((done) => setTimeout(done, 100));
      }
      expect(await lockHeldAnywhere()).toBe(false);
      const row = await prisma.userCredential.findUniqueOrThrow({ where: { userId } });
      expect(keyOf(row.totpSecretEnc)).toBe('K2');
    });
  });
});
