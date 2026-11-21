import { execFileSync } from 'node:child_process';
import { createDecipheriv, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { seedProduction } from '../prisma/seed/production';
import { runReencryptCommand } from '../src/cli/reencrypt-envelopes.command';
import { ConfigService, type Env } from '../src/config';
import { TransactionalAuditWriter } from '../src/shared/audit';
import {
  EnvelopeReencryptionService,
  EnvelopeService,
  ReencryptionFailedError,
  ReencryptionLock,
  ReencryptionLockLostError,
  type EnvelopeFormat,
  type HeldLock,
} from '../src/shared/crypto';
import {
  REENCRYPTION_LOCK_CLASS,
  REENCRYPTION_LOCK_OBJECT,
} from '../src/shared/crypto/reencryption.lock';
import { PrismaService } from '../src/shared/database';

/**
 * Regressions for the independent review of `DATA_ENCRYPTION_KEY`
 * rotation, findings F1–F7. Each block reproduces the failure the review
 * demonstrated (P3, P4, P5, P6, P7) and asserts the corrected behaviour.
 *
 * The services are built by hand rather than from an application
 * context: several cases need two configurations at once (two keys, two
 * write formats), and some need a ledger that fails. Everything else is
 * real — PostgreSQL, the advisory lock, the strict audit writer, the
 * command's exit codes — on a database created for this file and dropped
 * after it.
 */

const BACKEND = resolve(__dirname, '..');
const DB_NAME = `medora_rotation_hardening_${String(process.pid)}`;

const K1 = Buffer.alloc(32, 0x11).toString('base64');
const K2 = Buffer.alloc(32, 0x22).toString('base64');
const K3 = Buffer.alloc(32, 0x33).toString('base64');

function databaseUrl(name: string): string {
  const url = new URL(process.env['DATABASE_URL'] ?? '');
  url.pathname = `/${name}`;
  return url.toString();
}
const FRESH_URL = databaseUrl(DB_NAME);
const ADMIN_URL = databaseUrl('postgres');

function configOf(
  current: string,
  previous: readonly string[],
  format: EnvelopeFormat,
): ConfigService {
  return new ConfigService({
    DATABASE_URL: FRESH_URL,
    DATA_ENCRYPTION_KEY: current,
    DATA_ENCRYPTION_KEY_PREVIOUS: [...previous],
    DATA_ENCRYPTION_WRITE_FORMAT: format,
  } as unknown as Env);
}
function envelope(
  current: string,
  previous: readonly string[] = [],
  format: EnvelopeFormat = 'legacy',
) {
  return new EnvelopeService(configOf(current, previous, format));
}

/** The decrypt of a build from before the keyring (`origin/backend` `bbb5377`). */
function preKeyringDecrypt(key: string, payload: Uint8Array): string {
  const buffer = Buffer.from(payload);
  if (buffer.length <= 28) throw new Error('too short');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(key, 'base64'),
    buffer.subarray(0, 12),
  );
  decipher.setAuthTag(buffer.subarray(12, 28));
  return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString('utf8');
}

let prisma: PrismaService;
const ledger = new TransactionalAuditWriter();

type Ledger = Pick<TransactionalAuditWriter, 'recordWithin'>;

/** A re-encryption service as the CLI would build it, with optional seams. */
function service(
  current: string,
  previous: readonly string[],
  options: { format?: EnvelopeFormat; db?: unknown; ledger?: Ledger } = {},
): EnvelopeReencryptionService {
  const format = options.format ?? 'legacy';
  const client =
    options.db === undefined
      ? prisma
      : ({
          db: options.db,
          $transaction: prisma.$transaction.bind(prisma),
        } as unknown as PrismaService);
  return new EnvelopeReencryptionService(
    client,
    envelope(current, previous, format),
    (options.ledger ?? ledger) as TransactionalAuditWriter,
    new ReencryptionLock(configOf(current, previous, format)),
  );
}

interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function cli(target: EnvelopeReencryptionService, ...args: string[]): Promise<CliResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runReencryptCommand(
    args,
    () => Promise.resolve({ service: target, close: () => Promise.resolve() }),
    { log: (line) => stdout.push(line), error: (line) => stderr.push(line) },
  );
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

/** Which key and layout a stored value is in, from outside the service. */
function keyOf(bytes: Uint8Array | null): string {
  if (bytes === null) return 'null';
  for (const [name, key] of [
    ['K1', K1],
    ['K2', K2],
    ['K3', K3],
  ] as const) {
    try {
      const inspection = envelope(key).inspect(bytes);
      if (inspection.keyIndex === 0) return `${name}/${inspection.format}`;
    } catch {
      // not this key
    }
  }
  return 'unreadable';
}

let roleId = '';
async function createUser(): Promise<string> {
  const tag = randomUUID().slice(0, 12);
  const user = await prisma.user.create({
    data: {
      publicId: `usr_hard_${tag}`,
      firstName: 'Hardening',
      lastName: tag,
      displayName: `Hardening ${tag}`,
      email: `${tag}@hardening.test`,
      phone: '+15550000000',
      roleId,
      termsAcceptedAt: new Date(),
      privacyAcceptedAt: new Date(),
    },
  });
  return user.id;
}

async function credentialUnder(sealed: Uint8Array<ArrayBuffer>): Promise<string> {
  const userId = await createUser();
  await prisma.userCredential.create({
    data: { userId, passwordHash: 'not-a-hash', totpSecretEnc: sealed },
  });
  return userId;
}

async function totpOf(userId: string): Promise<Uint8Array | null> {
  return (await prisma.userCredential.findUniqueOrThrow({ where: { userId } })).totpSecretEnc;
}

async function auditRows(): Promise<{ eventType: string; payload: unknown }[]> {
  return prisma.auditEvent.findMany({
    where: { eventType: { startsWith: 'encryption_key.' } },
    orderBy: { occurredAt: 'asc' },
    select: { eventType: true, payload: true },
  });
}

/** The private column list, for injecting a concurrent writer at a precise moment. */
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
function columnsOf(target: EnvelopeReencryptionService): ColumnSeam[] {
  return (target as unknown as { columns: ColumnSeam[] }).columns;
}
function columnOf(target: EnvelopeReencryptionService, name: string): ColumnSeam {
  const found = columnsOf(target).find((column) => column.column === name);
  if (found === undefined) throw new Error(`no column ${name}`);
  return found;
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

  prisma = new PrismaService(configOf(K2, [K1], 'legacy'));
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
  await prisma.platformIntegration.deleteMany({});
  await prisma.auditEvent.deleteMany({ where: { eventType: { startsWith: 'encryption_key.' } } });
});

// ── F1 ──────────────────────────────────────────────────────────────────

describe('F1 — exit 0 only after a complete verification pass', () => {
  it('P3: a stale writer between read and write no longer yields exit 0 or "can be emptied"', async () => {
    const userId = await credentialUnder(envelope(K1).encrypt('OLD'));
    const target = service(K2, [K1]);
    const totp = columnOf(target, 'totp_secret_enc');
    const original = totp.swap;
    let injected = false;
    totp.swap = async (held, id, from, to) => {
      if (!injected) {
        injected = true; // an instance still on K1 writes, once
        await prisma.userCredential.update({
          where: { userId: id },
          data: { totpSecretEnc: envelope(K1).encrypt('STALE-WRITER') },
        });
      }
      return original(held, id, from, to);
    };

    const result = await cli(target, '--confirm');

    // Before the fix: exit 0, "can be emptied", row left under K1.
    expect(result.code).toBe(1);
    expect(result.stdout).not.toContain('can be emptied');
    expect(result.stdout).toContain('1 stale concurrent write(s)');
    expect(result.stdout).toContain('an instance is still running an old configuration');
    // The retry re-sealed the stale writer's value, so the row itself is safe.
    expect(keyOf(await totpOf(userId))).toBe('K2/legacy');
    expect(envelope(K2).decrypt((await totpOf(userId)) ?? new Uint8Array())).toBe('STALE-WRITER');

    const outcome = (await auditRows()).find(
      (row) => row.eventType === 'encryption_key.reencrypted',
    );
    expect(outcome?.payload).toMatchObject({ status: 'incomplete', staleWrites: 1, resealed: 1 });
  });

  it('a writer that keeps writing the old key ends unresolved, named, and not conforming', async () => {
    const userId = await credentialUnder(envelope(K1).encrypt('OLD'));
    const target = service(K2, [K1]);
    const totp = columnOf(target, 'totp_secret_enc');
    const original = totp.swap;
    totp.swap = async (held, id, from, to) => {
      await prisma.userCredential.update({
        where: { userId: id },
        data: { totpSecretEnc: envelope(K1).encrypt('STALE-AGAIN') },
      });
      return original(held, id, from, to);
    };

    const result = await cli(target, '--confirm');

    expect(result.code).toBe(1);
    expect(result.stdout).toContain('3 stale concurrent write(s) · 0 unreadable · 1 unresolved');
    expect(result.stdout).toContain(`unresolved rows: ${userId}`);
    expect(result.stdout).toContain(
      'user_credentials.totp_secret_enc: 1 scanned · 0 conforming · 1 not conforming · 0 unreadable',
    );
    expect(keyOf(await totpOf(userId))).toBe('K1/legacy');
  });

  it('a row rewritten behind the cursor is caught by the verification pass', async () => {
    const userId = await credentialUnder(envelope(K1).encrypt('OLD'));
    const target = service(K2, [K1]);
    // After the TOTP column has been re-sealed, while the next column is
    // being walked, a stale instance writes the TOTP row again.
    const recovery = columnOf(target, 'recovery_codes_enc');
    const original = recovery.page;
    let injected = false;
    recovery.page = async (after, take) => {
      if (!injected) {
        injected = true;
        await prisma.userCredential.update({
          where: { userId },
          data: { totpSecretEnc: envelope(K1).encrypt('BEHIND-THE-CURSOR') },
        });
      }
      return original(after, take);
    };

    const result = await cli(target, '--confirm');

    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      'user_credentials.totp_secret_enc: 1 scanned · 0 already current · 1 re-sealed',
    );
    expect(result.stdout).toContain(
      'user_credentials.totp_secret_enc: 1 scanned · 0 conforming · 1 not conforming · 0 unreadable',
    );
    expect(result.stdout).toContain(`not conforming: ${userId}`);
    expect(result.stdout).not.toContain('can be emptied');
  });

  it('a lost compare-and-set on a row that was cleared is classified, and a clean run may exit 0', async () => {
    const userId = await credentialUnder(envelope(K1).encrypt('OLD'));
    const kept = await credentialUnder(envelope(K1).encrypt('KEPT'));
    const target = service(K2, [K1]);
    const totp = columnOf(target, 'totp_secret_enc');
    const original = totp.swap;
    totp.swap = async (held, id, from, to) => {
      if (id === userId) {
        // The user disables two-factor sign-in mid-run.
        await prisma.userCredential.update({
          where: { userId: id },
          data: { totpSecretEnc: null },
        });
      }
      return original(held, id, from, to);
    };

    const result = await cli(target, '--confirm');

    expect(result.stdout).toContain(
      '1 re-sealed · 0 rewritten concurrently (current) · 1 removed concurrently',
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      'Verification passed: every envelope conformed when the verification pass read it',
    );
    expect(keyOf(await totpOf(kept))).toBe('K2/legacy');
  });

  it('R1: a clean --confirm run states a point-in-time result and the preconditions, never a bare go-ahead', async () => {
    await credentialUnder(envelope(K1).encrypt('OLD'));
    const done = await cli(service(K2, [K1]), '--confirm');
    expect(done.code).toBe(0);
    expect(done.stdout).toContain('This is a point-in-time result');
    expect(done.stdout).toContain('does not prevent future stale writes');
    expect(done.stdout).toMatch(
      /DATA_ENCRYPTION_KEY_PREVIOUS may be retired only if, before this run started \(\d{4}-\d{2}-\d{2}T[^)]+\), every envelope-writing process/,
    );
    for (const writer of [
      'API replicas',
      'background workers and scheduled jobs',
      'autoscaling and launch templates',
      'old task definitions',
      'any other process that writes envelopes',
    ]) {
      expect(done.stdout).toContain(writer);
    }
    expect(done.stdout).toContain('every old instance had drained');
    expect(done.stdout).not.toContain('can be emptied');

    const audit = await auditRows();
    expect(audit.map((row) => row.eventType)).toEqual([
      'encryption_key.reencrypt_started',
      'encryption_key.reencrypted',
    ]);
    expect(audit[1]?.payload).toMatchObject({
      status: 'complete',
      resealed: 1,
      verifiedScanned: 1,
      verifiedNonConforming: 0,
      remaining: 0,
    });
  });
});

// ── F2 ──────────────────────────────────────────────────────────────────

describe('F2 — nothing an older build cannot read, unless keyed writes are switched on', () => {
  it('a rotation in the default (legacy) phase leaves every value readable by a pre-keyring build given the new key', async () => {
    const users = [
      await credentialUnder(envelope(K1).encrypt('A')),
      await credentialUnder(envelope(K1, [], 'keyed').encrypt('B')),
    ];
    const result = await cli(service(K2, [K1]), '--confirm');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('writing the legacy format');

    expect(
      await Promise.all(
        users.map(async (id) => preKeyringDecrypt(K2, (await totpOf(id)) ?? new Uint8Array())),
      ),
    ).toEqual(['A', 'B']);
  });

  it('going back from phase 2: a legacy run rewrites keyed values so an older build can be deployed', async () => {
    const userId = await credentialUnder(envelope(K2, [], 'keyed').encrypt('KEYED'));
    // What phase 2 wrote is exactly what an older build cannot open.
    const keyed = (await totpOf(userId)) ?? new Uint8Array();
    expect(() => preKeyringDecrypt(K2, keyed)).toThrow();

    const dry = await cli(service(K2, []), '--dry-run');
    expect(dry.code).toBe(1);
    expect(dry.stdout).toContain('1 to re-seal');

    const result = await cli(service(K2, []), '--confirm');
    expect(result.code).toBe(0);
    expect(preKeyringDecrypt(K2, (await totpOf(userId)) ?? new Uint8Array())).toBe('KEYED');
  });
});

// ── F5 ──────────────────────────────────────────────────────────────────

describe('F5 — start, outcome and failure are on record, or the command says they are not', () => {
  it('P5: a run that stops part-way records reencrypt_failed with partial counts, and a rerun completes', async () => {
    const ids: string[] = [];
    for (let index = 0; index < 5; index++)
      ids.push(await credentialUnder(envelope(K1).encrypt(`S${String(index)}`)));
    const target = service(K2, [K1]);
    const totp = columnOf(target, 'totp_secret_enc');
    const original = totp.swap;
    let calls = 0;
    totp.swap = async (held, id, from, to) => {
      calls++;
      if (calls === 3) throw new Error('connection terminated');
      return original(held, id, from, to);
    };

    const failed = await cli(target, '--confirm');
    totp.swap = original;

    expect(failed.code).toBe(1);
    // The injected error is a transport-like failure, so its write counts
    // as one of unknown outcome and the totals as lower bounds (R6).
    expect(failed.stderr).toContain('failed after at least 2 value(s) were re-sealed');
    expect(failed.stderr).toContain(
      'Recorded in the audit ledger as encryption_key.reencrypt_failed',
    );
    expect(failed.stderr).toContain('Do not remove a previous key');

    const afterFailure = await auditRows();
    expect(afterFailure.map((row) => row.eventType)).toEqual([
      'encryption_key.reencrypt_started',
      'encryption_key.reencrypt_failed',
    ]);
    expect(afterFailure[1]?.payload).toMatchObject({
      status: 'failed',
      resealed: 2,
      uncertainWrites: 1,
      countsAreLowerBounds: true,
      errorType: 'Error',
    });

    // Every value is still readable with the rotation configuration.
    for (const id of ids) expect(['K1/legacy', 'K2/legacy']).toContain(keyOf(await totpOf(id)));

    const rerun = await cli(target, '--confirm');
    expect(rerun.code).toBe(0);
    expect(rerun.stdout).toContain('5 scanned · 2 already current · 3 re-sealed');
    for (const id of ids) expect(keyOf(await totpOf(id))).toBe('K2/legacy');
  });

  it('refuses to start, and writes nothing, when the start cannot be recorded', async () => {
    const userId = await credentialUnder(envelope(K1).encrypt('OLD'));
    const before = Buffer.from((await totpOf(userId)) ?? []).toString('hex');
    const broken: Ledger = { recordWithin: () => Promise.reject(new Error('ledger down')) };

    const result = await cli(service(K2, [K1], { ledger: broken }), '--confirm');

    expect(result.code).toBe(4);
    expect(result.stderr).toContain('could not be recorded');
    expect(Buffer.from((await totpOf(userId)) ?? []).toString('hex')).toBe(before);
  });

  it('does not claim the outcome was recorded when that write failed', async () => {
    await credentialUnder(envelope(K1).encrypt('OLD'));
    let calls = 0;
    const flaky: Ledger = {
      recordWithin: (tx, event) => {
        calls++;
        return calls === 1
          ? ledger.recordWithin(tx, event)
          : Promise.reject(new Error('ledger down'));
      },
    };

    const result = await cli(service(K2, [K1], { ledger: flaky }), '--confirm');

    expect(result.code).toBe(4);
    expect(result.stdout).toContain('The outcome could NOT be recorded');
    expect(result.stdout).not.toContain('can be emptied');
    expect((await auditRows()).map((row) => row.eventType)).toEqual([
      'encryption_key.reencrypt_started',
    ]);
  });

  it('says so when even the failure could not be recorded', async () => {
    await credentialUnder(envelope(K1).encrypt('OLD'));
    let calls = 0;
    const flaky: Ledger = {
      recordWithin: (tx, event) => {
        calls++;
        return calls === 1
          ? ledger.recordWithin(tx, event)
          : Promise.reject(new Error('ledger down'));
      },
    };
    const target = service(K2, [K1], { ledger: flaky });
    columnOf(target, 'totp_secret_enc').swap = () =>
      Promise.reject(new Error('connection terminated'));

    const result = await cli(target, '--confirm');

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('The failure could NOT be recorded in the audit ledger');
  });
});

// ── F6 ──────────────────────────────────────────────────────────────────

describe('F6 — one re-encryption at a time', () => {
  /** A run paused inside its first page until `release()` is called. */
  function pausedRun(target: EnvelopeReencryptionService) {
    let release: () => void = () => undefined;
    let entered: () => void = () => undefined;
    const gate = new Promise<void>((resolveGate) => (release = resolveGate));
    const inside = new Promise<void>((resolveInside) => (entered = resolveInside));
    const totp = columnOf(target, 'totp_secret_enc');
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

  it('P6/P7: a second run — same configuration or another key — is refused with exit 3 while one is active', async () => {
    for (let index = 0; index < 10; index++)
      await credentialUnder(envelope(K1).encrypt(`S${String(index)}`));
    const first = service(K2, [K1]);
    const paused = pausedRun(first);
    const running = cli(first, '--confirm');
    await paused.inside;

    const sameConfig = await cli(service(K2, [K1]), '--confirm');
    const otherKey = await cli(service(K3, [K2, K1]), '--confirm');
    const dryRun = await cli(service(K2, [K1]), '--dry-run');

    for (const refused of [sameConfig, otherKey, dryRun]) {
      expect(refused.code).toBe(3);
      expect(refused.stderr).toContain('Another re-encryption is running');
    }

    paused.release();
    const finished = await running;
    expect(finished.code).toBe(0);

    // One key throughout (P7 ended with two runs both "done" under different keys).
    const rows = await prisma.userCredential.findMany();
    expect(new Set(rows.map((row) => keyOf(row.totpSecretEnc)))).toEqual(new Set(['K2/legacy']));

    // The refused runs left no audit rows; the lock is free again afterwards.
    expect((await auditRows()).map((row) => row.eventType)).toEqual([
      'encryption_key.reencrypt_started',
      'encryption_key.reencrypted',
    ]);
    expect((await cli(service(K2, [K1]), '--dry-run')).code).toBe(0);
  });

  it('is refused while another database session — another machine — holds the lock', async () => {
    const other = new Client({ connectionString: FRESH_URL });
    await other.connect();
    await other.query('SELECT pg_advisory_lock($1::int4, $2::int4)', [
      REENCRYPTION_LOCK_CLASS,
      REENCRYPTION_LOCK_OBJECT,
    ]);
    try {
      const refused = await cli(service(K2, [K1]), '--dry-run');
      expect(refused.code).toBe(3);
    } finally {
      await other.end();
    }
    // Ending that session released the lock, with no unlock call.
    expect((await cli(service(K2, [K1]), '--dry-run')).code).toBe(0);
  });

  it('a run whose lock session was killed fails closed and records the lost lock', async () => {
    for (let index = 0; index < 3; index++)
      await credentialUnder(envelope(K1).encrypt(`S${String(index)}`));
    const target = service(K2, [K1]);
    const paused = pausedRun(target);
    const running = cli(target, '--confirm', '--batch-size', '1');
    await paused.inside;

    const admin = new Client({ connectionString: FRESH_URL });
    await admin.connect();
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_locks
       WHERE locktype = 'advisory' AND classid = $1::int4::oid AND objid = $2::int4::oid
       AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
      [REENCRYPTION_LOCK_CLASS, REENCRYPTION_LOCK_OBJECT],
    );
    await admin.end();
    paused.release();

    const result = await running;
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('failed after 0 value(s) were re-sealed');
    const failure = (await auditRows()).find(
      (row) => row.eventType === 'encryption_key.reencrypt_failed',
    );
    // Known unwritten: the session had already failed, so the write was
    // never sent and nothing is uncertain.
    expect(failure?.payload).toMatchObject({
      errorType: 'ReencryptionLockLostError',
      resealed: 0,
      uncertainWrites: 0,
    });
  });

  it('assertHeld reports a lost lock', async () => {
    const lock = new ReencryptionLock(configOf(K2, [], 'legacy'));
    const held = await lock.acquire();
    expect(held).not.toBeNull();
    if (held === null) return;
    await held.assertHeld();

    const admin = new Client({ connectionString: FRESH_URL });
    await admin.connect();
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_locks
       WHERE locktype = 'advisory' AND classid = $1::int4::oid AND objid = $2::int4::oid
       AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
      [REENCRYPTION_LOCK_CLASS, REENCRYPTION_LOCK_OBJECT],
    );
    await admin.end();

    await expect(held.assertHeld()).rejects.toBeInstanceOf(ReencryptionLockLostError);
    await held.release();
    const again = await lock.acquire();
    expect(again).not.toBeNull();
    await again?.release();
  });
});

// ── F7 ──────────────────────────────────────────────────────────────────

describe('F7 — user_integrations pagination stops only on an empty page', () => {
  async function threeUsersWithZoom(): Promise<string[]> {
    const users: string[] = [];
    for (let index = 0; index < 3; index++) {
      const userId = await createUser();
      users.push(userId);
      await prisma.userIntegration.create({
        data: {
          userId,
          integration: 'ZOOM',
          oauthTokensEnc: envelope(K1).encrypt(`t${String(index)}`),
        },
      });
    }
    return users.sort();
  }

  /** `prisma.db`, with a hook run after the page's first (driving) query. */
  function dbWithHook(afterDrivingQuery: () => Promise<void>): unknown {
    const real = prisma.db as unknown as Record<string, unknown> & {
      userIntegration: {
        groupBy: (args: unknown) => Promise<unknown>;
        findMany: (args: unknown) => Promise<unknown>;
        findUnique: (args: unknown) => Promise<unknown>;
        updateMany: (args: unknown) => Promise<unknown>;
      };
    };
    let fired = false;
    return new Proxy(real, {
      get(target, property) {
        if (property !== 'userIntegration') return target[property as string];
        return {
          groupBy: async (args: unknown) => {
            const result = await target.userIntegration.groupBy(args);
            if (!fired) {
              fired = true;
              await afterDrivingQuery();
            }
            return result;
          },
          findMany: (args: unknown) => target.userIntegration.findMany(args),
          findUnique: (args: unknown) => target.userIntegration.findUnique(args),
          updateMany: (args: unknown) => target.userIntegration.updateMany(args),
        };
      },
    });
  }

  async function zoomOf(userId: string): Promise<Uint8Array | null> {
    return (
      await prisma.userIntegration.findUniqueOrThrow({
        where: { userId_integration: { userId, integration: 'ZOOM' } },
      })
    ).oauthTokensEnc;
  }

  it("P4: a row cleared between the page's two queries no longer ends the walk early", async () => {
    const users = await threeUsersWithZoom();
    const db = dbWithHook(async () => {
      await prisma.userIntegration.update({
        where: { userId_integration: { userId: users[1] ?? '', integration: 'ZOOM' } },
        data: { oauthTokensEnc: null },
      });
    });

    const result = await cli(service(K2, [K1], { db }), '--confirm', '--batch-size', '2');

    // Before the fix: exit 0 with the third user's row still under K1.
    expect(keyOf(await zoomOf(users[2] ?? ''))).toBe('K2/legacy');
    expect(keyOf(await zoomOf(users[0] ?? ''))).toBe('K2/legacy');
    expect(result.stdout).toContain('user_integrations.oauth_tokens_enc: 2 scanned');
    expect(result.code).toBe(0);
  });

  it('a page whose every row was cleared between its two queries is not the end either', async () => {
    const users = await threeUsersWithZoom();
    const db = dbWithHook(async () => {
      for (const userId of users.slice(0, 2)) {
        await prisma.userIntegration.update({
          where: { userId_integration: { userId, integration: 'ZOOM' } },
          data: { oauthTokensEnc: null },
        });
      }
    });

    const result = await cli(service(K2, [K1], { db }), '--confirm', '--batch-size', '2');

    expect(keyOf(await zoomOf(users[2] ?? ''))).toBe('K2/legacy');
    expect(result.code).toBe(0);
  });

  it('pages several rows per user without losing any, and limits the driving query in SQL (F8)', async () => {
    const statements: string[] = [];
    const proto = Client.prototype as unknown as { query: (...args: unknown[]) => unknown };
    const originalQuery = proto.query;
    for (let index = 0; index < 3; index++) {
      const userId = await createUser();
      for (const integration of ['GOOGLE_CALENDAR', 'ZOOM', 'TEAMS'] as const) {
        await prisma.userIntegration.create({
          data: { userId, integration, oauthTokensEnc: envelope(K1).encrypt(integration) },
        });
      }
    }

    proto.query = function (this: unknown, ...args: unknown[]) {
      const first = args[0] as string | { text?: string } | undefined;
      const text = typeof first === 'string' ? first : first?.text;
      if (typeof text === 'string' && text.includes('GROUP BY')) statements.push(text);
      return originalQuery.apply(this, args);
    };
    let result: CliResult;
    try {
      result = await cli(service(K2, [K1]), '--confirm', '--batch-size', '2');
    } finally {
      proto.query = originalQuery;
    }

    expect(result.stdout).toContain(
      'user_integrations.oauth_tokens_enc: 9 scanned · 0 already current · 9 re-sealed',
    );
    expect(result.code).toBe(0);
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) expect(statement).toMatch(/LIMIT/);
  });
});

// ── Coverage of the failure path itself ─────────────────────────────────

describe('a failed dry run', () => {
  it('reports the failure without auditing — a dry run writes nothing', async () => {
    await credentialUnder(envelope(K1).encrypt('OLD'));
    const target = service(K2, [K1]);
    columnOf(target, 'totp_secret_enc').page = () => Promise.reject(new Error('read failed'));

    await expect(target.run({ dryRun: true })).rejects.toBeInstanceOf(ReencryptionFailedError);
    expect(await auditRows()).toEqual([]);
  });
});
