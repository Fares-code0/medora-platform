import { createCipheriv, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedProduction } from '../prisma/seed/production';
import { AppModule } from '../src/app.module';
import { runReencryptCommand } from '../src/cli/reencrypt-envelopes.command';
import { ConfigService, type Env } from '../src/config';
import { resetEnvForTesting } from '../src/config/env';
import { SecretService } from '../src/modules/auth/services/secret.service';
import {
  openSuccessor,
  sealSuccessor,
  SessionService,
} from '../src/modules/auth/services/session.service';
import { TwoFactorService } from '../src/modules/auth/services/two-factor.service';
import { PrismaService } from '../src/shared/database';
import {
  EnvelopeReencryptionService,
  EnvelopeService,
  sessionRefreshSuccessorAad,
} from '../src/shared/crypto';

/**
 * Rotating `DATA_ENCRYPTION_KEY` end to end (M37; PRODUCTION_SETUP §2).
 *
 * The application is booted the way the CLI boots it — an application
 * context over `AppModule` — with the **new** key current and the **old**
 * one in `DATA_ENCRYPTION_KEY_PREVIOUS`, which is step 1 of a rotation.
 * The fixtures cover every shape a real database holds mid-rotation:
 * legacy (header-less) envelopes from before keyed envelopes existed,
 * keyed envelopes under the old key, envelopes already under the new key,
 * one under a key nobody configured, and a row rewritten by live traffic
 * while the run is in flight.
 *
 * A database of its own, created for this file and dropped after it,
 * because a run walks whole tables: on the shared test database other
 * suites write credentials concurrently, and the counts asserted here
 * would be theirs as much as this file's.
 */

const BACKEND = resolve(__dirname, '..');
const DB_NAME = `medora_key_rotation_${String(process.pid)}`;

const OLD_KEY = Buffer.alloc(32, 0x21).toString('base64');
const NEW_KEY = Buffer.alloc(32, 0x42).toString('base64');
const LOST_KEY = Buffer.alloc(32, 0x63).toString('base64');

function databaseUrl(name: string): string {
  const url = new URL(process.env['DATABASE_URL'] ?? '');
  url.pathname = `/${name}`;
  return url.toString();
}

const FRESH_URL = databaseUrl(DB_NAME);
const ADMIN_URL = databaseUrl('postgres');

function envelopeUnder(key: string, previous: readonly string[] = []): EnvelopeService {
  return new EnvelopeService(
    new ConfigService({
      DATA_ENCRYPTION_KEY: key,
      DATA_ENCRYPTION_KEY_PREVIOUS: [...previous],
      // This file is the phase-2 scenario (keyed writes). The phase-1
      // default and the F1–F7 regressions are in
      // `envelope-key-rotation-hardening.e2e-spec.ts`.
      DATA_ENCRYPTION_WRITE_FORMAT: 'keyed',
    } as unknown as Env),
  );
}

/** The header-less layout every row written before keyed envelopes holds. */
function legacySeal(key: string, plaintext: string): Uint8Array<ArrayBuffer> {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'base64'), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const sealed = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  const out = new Uint8Array(new ArrayBuffer(sealed.length));
  out.set(sealed);
  return out;
}

const oldKey = envelopeUnder(OLD_KEY);
const newKeyOnly = envelopeUnder(NEW_KEY);
const lostKey = envelopeUnder(LOST_KEY);

let app: INestApplicationContext;
let prisma: PrismaService;
let service: EnvelopeReencryptionService;

const users: Record<'u1' | 'u2' | 'u3' | 'u4' | 'u5', string> = {
  u1: '',
  u2: '',
  u3: '',
  u4: '',
  u5: '',
};
let integrationId = '';

async function createUser(label: string): Promise<string> {
  const role = await prisma.role.findUniqueOrThrow({ where: { code: 'doctor' } });
  const user = await prisma.user.create({
    data: {
      publicId: `usr_rot_${label}_${randomUUID().slice(0, 8)}`,
      firstName: 'Rotation',
      lastName: label,
      displayName: `Rotation ${label}`,
      email: `${label}-${randomUUID().slice(0, 8)}@rotation.test`,
      phone: '+15550000000',
      roleId: role.id,
      emailVerifiedAt: new Date(),
      twoFactorEnabled: true,
      termsAcceptedAt: new Date(),
      privacyAcceptedAt: new Date(),
    },
  });
  return user.id;
}

async function credential(userId: string) {
  return prisma.userCredential.findUniqueOrThrow({
    where: { userId },
    select: { totpSecretEnc: true, recoveryCodesEnc: true },
  });
}

/** Every stored envelope, as hex, for "nothing was written" assertions. */
async function snapshot(): Promise<string> {
  const [credentials, platform, personal] = await Promise.all([
    prisma.userCredential.findMany({ orderBy: { userId: 'asc' } }),
    prisma.platformIntegration.findMany({ orderBy: { id: 'asc' } }),
    prisma.userIntegration.findMany({ orderBy: [{ userId: 'asc' }, { integration: 'asc' }] }),
  ]);
  const hex = (value: Uint8Array | null): string | null =>
    value === null ? null : Buffer.from(value).toString('hex');
  return JSON.stringify([
    credentials.map((row) => [row.userId, hex(row.totpSecretEnc), hex(row.recoveryCodesEnc)]),
    platform.map((row) => [row.id, hex(row.configEnc)]),
    personal.map((row) => [row.userId, row.integration, hex(row.oauthTokensEnc)]),
  ]);
}

interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function reencryptCli(...args: string[]): Promise<CliResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runReencryptCommand(
    args,
    () => Promise.resolve({ service, close: () => Promise.resolve() }),
    { log: (line) => stdout.push(line), error: (line) => stderr.push(line) },
  );
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
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

  // Step 1 of a rotation: the new key current, the old one previous.
  // `loadEnv()` is memoised, so the variables are set, read once by the
  // boot, and restored — the next spec file in this worker must not
  // inherit them.
  const saved = {
    DATABASE_URL: process.env['DATABASE_URL'],
    DATA_ENCRYPTION_KEY: process.env['DATA_ENCRYPTION_KEY'],
    DATA_ENCRYPTION_KEY_PREVIOUS: process.env['DATA_ENCRYPTION_KEY_PREVIOUS'],
    DATA_ENCRYPTION_WRITE_FORMAT: process.env['DATA_ENCRYPTION_WRITE_FORMAT'],
  };
  process.env['DATABASE_URL'] = FRESH_URL;
  process.env['DATA_ENCRYPTION_KEY'] = NEW_KEY;
  process.env['DATA_ENCRYPTION_KEY_PREVIOUS'] = OLD_KEY;
  process.env['DATA_ENCRYPTION_WRITE_FORMAT'] = 'keyed';
  resetEnvForTesting();
  try {
    app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetEnvForTesting();
  }

  prisma = app.get(PrismaService);
  service = app.get(EnvelopeReencryptionService);
  await seedProduction(prisma);

  for (const label of Object.keys(users) as (keyof typeof users)[]) {
    users[label] = await createUser(label);
  }

  const row = (
    userId: string,
    totp: Uint8Array<ArrayBuffer>,
    recovery: Uint8Array<ArrayBuffer> | null,
  ) =>
    prisma.userCredential.create({
      data: {
        userId,
        passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$not-a-real-hash$not-a-real-hash',
        totpSecretEnc: totp,
        recoveryCodesEnc: recovery,
      },
    });

  // u1 — written before keyed envelopes existed, under the old key.
  await row(users.u1, legacySeal(OLD_KEY, 'SECRET-U1'), oldKey.encrypt('{"v":2,"h":["u1"]}'));
  // u2 — already enrolled under the new key: nothing to do.
  await row(users.u2, newKeyOnly.encrypt('SECRET-U2'), null);
  // u3 — the current key, but the legacy layout: re-sealed into the keyed one.
  await row(users.u3, legacySeal(NEW_KEY, 'SECRET-U3'), null);
  // u4 — sealed under a key nobody configured: must never be overwritten.
  await row(users.u4, lostKey.encrypt('SECRET-U4'), oldKey.encrypt('{"v":2,"h":["u4"]}'));
  // u5 — under the old key; live traffic rewrites it mid-run.
  await row(users.u5, oldKey.encrypt('SECRET-U5'), null);

  const integration = await prisma.platformIntegration.create({
    data: { name: 'Rotation lab feed', configEnc: oldKey.encrypt('{"apiKey":"x"}') },
  });
  integrationId = integration.id;

  await prisma.userIntegration.create({
    data: {
      userId: users.u1,
      integration: 'GOOGLE_CALENDAR',
      oauthTokensEnc: oldKey.encrypt('{"refresh":"a"}'),
    },
  });
  await prisma.userIntegration.create({
    data: {
      userId: users.u2,
      integration: 'GOOGLE_CALENDAR',
      oauthTokensEnc: legacySeal(OLD_KEY, '{"refresh":"b"}'),
    },
  });
}, 180_000);

afterAll(async () => {
  await app?.close();
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
  await admin.end();
});

describe('DATA_ENCRYPTION_KEY rotation', () => {
  it('covers every bytea column the schema has', async () => {
    const result = await prisma.$queryRaw<{ name: string }[]>`
      SELECT table_name || '.' || column_name AS name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND data_type = 'bytea'
      ORDER BY 1`;

    expect([...service.coveredColumns].sort()).toEqual(result.map((row) => row.name));
  });

  it('has no lockout window: sign-in reads a secret still under the old key', async () => {
    // What `StepUpService` and `/auth/otp/verify` call. Before keyrings,
    // changing the key made this `null` for every enrolled account.
    const twoFactor = app.get(TwoFactorService, { strict: false });
    expect(await twoFactor.secretFor(users.u1)).toBe('SECRET-U1');
    expect(await twoFactor.secretFor(users.u5)).toBe('SECRET-U5');
    expect(await twoFactor.secretFor(users.u4)).toBeNull();
  });

  it('a dry run reports the work, writes nothing and audits nothing', async () => {
    const before = await snapshot();
    const result = await reencryptCli('--dry-run', '--batch-size', '2');

    expect(result.code).toBe(1);
    expect(result.stdout).toContain('Dry run — nothing was written.');
    expect(result.stdout).toContain(
      'user_credentials.totp_secret_enc: 5 scanned · 1 already current · 3 to re-seal · 0 rewritten concurrently (current) · 0 removed concurrently · 0 stale concurrent write(s) · 1 unreadable · 0 unresolved',
    );
    expect(result.stdout).toContain(`unreadable rows: ${users.u4}`);
    expect(result.stdout).toContain(
      'user_credentials.recovery_codes_enc: 2 scanned · 0 already current · 2 to re-seal',
    );
    expect(result.stdout).toContain(
      'platform_integrations.config_enc: 1 scanned · 0 already current · 1 to re-seal',
    );
    expect(result.stdout).toContain(
      'user_integrations.oauth_tokens_enc: 2 scanned · 0 already current · 2 to re-seal',
    );

    expect(await snapshot()).toBe(before);
    expect(
      await prisma.auditEvent.count({ where: { eventType: { startsWith: 'encryption_key.' } } }),
    ).toBe(0);
  });

  it('re-seals under the new key, keeps a concurrent rewrite, and never touches the unreadable', async () => {
    const u4Before = await credential(users.u4);

    // Live traffic: u5 re-enrols on an up-to-date instance between this
    // run's read and its write. The lost compare-and-set is re-read, found
    // conforming, and left alone — the run must not put the old secret back.
    const columns = (
      service as unknown as {
        columns: { table: string; column: string; swap: (...args: never[]) => Promise<boolean> }[];
      }
    ).columns;
    const totp = columns.find((column) => column.column === 'totp_secret_enc');
    if (totp === undefined) throw new Error('totp column missing');
    const original = totp.swap;
    totp.swap = async (...args: never[]) => {
      // `swap(held, id, from, to)`: the lock session comes first (R2).
      const [, id] = args as unknown as [unknown, string];
      if (id === users.u5) {
        await prisma.userCredential.update({
          where: { userId: users.u5 },
          data: { totpSecretEnc: newKeyOnly.encrypt('SECRET-U5-REENROLLED') },
        });
      }
      return original(...args);
    };

    let result: CliResult;
    try {
      result = await reencryptCli('--confirm', '--batch-size', '2');
    } finally {
      totp.swap = original;
    }

    // u4 still cannot be read, so the previous key must not be dropped yet.
    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      'user_credentials.totp_secret_enc: 5 scanned · 1 already current · 2 re-sealed · 1 rewritten concurrently (current) · 0 removed concurrently · 0 stale concurrent write(s) · 1 unreadable · 0 unresolved',
    );
    // The verification pass, after every write, finds the same unreadable row.
    expect(result.stdout).toContain(
      'user_credentials.totp_secret_enc: 5 scanned · 4 conforming · 0 not conforming · 1 unreadable',
    );
    expect(result.stdout).not.toContain('can be emptied');
    expect(result.stdout).toContain('open under no configured key and were left untouched');

    // The old key alone no longer opens anything that was re-sealed; the
    // new key alone opens all of it.
    const u1 = await credential(users.u1);
    expect(newKeyOnly.decrypt(u1.totpSecretEnc ?? new Uint8Array())).toBe('SECRET-U1');
    expect(newKeyOnly.decrypt(u1.recoveryCodesEnc ?? new Uint8Array())).toBe('{"v":2,"h":["u1"]}');
    expect(() => oldKey.decrypt(u1.totpSecretEnc ?? new Uint8Array())).toThrow();

    const u3 = await credential(users.u3);
    expect(newKeyOnly.inspect(u3.totpSecretEnc ?? new Uint8Array())).toEqual({
      current: true,
      keyIndex: 0,
      format: 'keyed',
    });

    // The concurrent re-enrolment won.
    const u5 = await credential(users.u5);
    expect(newKeyOnly.decrypt(u5.totpSecretEnc ?? new Uint8Array())).toBe('SECRET-U5-REENROLLED');

    // Unreadable: byte for byte as it was. Its readable sibling column moved.
    const u4 = await credential(users.u4);
    expect(
      Buffer.from(u4.totpSecretEnc ?? []).equals(Buffer.from(u4Before.totpSecretEnc ?? [])),
    ).toBe(true);
    expect(newKeyOnly.decrypt(u4.recoveryCodesEnc ?? new Uint8Array())).toBe('{"v":2,"h":["u4"]}');

    const integration = await prisma.platformIntegration.findUniqueOrThrow({
      where: { id: integrationId },
    });
    expect(newKeyOnly.decrypt(integration.configEnc ?? new Uint8Array())).toBe('{"apiKey":"x"}');

    const personal = await prisma.userIntegration.findMany({ orderBy: { userId: 'asc' } });
    expect(
      personal.map((row) => newKeyOnly.decrypt(row.oauthTokensEnc ?? new Uint8Array())).sort(),
    ).toEqual(['{"refresh":"a"}', '{"refresh":"b"}']);

    const started = await prisma.auditEvent.count({
      where: { eventType: 'encryption_key.reencrypt_started' },
    });
    expect(started).toBe(1);
    const audit = await prisma.auditEvent.findMany({
      where: { eventType: 'encryption_key.reencrypted' },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorId).toBeNull();
    expect(audit[0]?.category).toBe('SECURITY');
    expect(audit[0]?.severity).toBe('WARNING');
    expect(audit[0]?.payload).toMatchObject({
      status: 'incomplete',
      writeFormat: 'keyed',
      previousKeys: 1,
      scanned: 10,
      resealed: 7,
      alreadyCurrent: 1,
      concurrentCurrent: 1,
      vanished: 0,
      staleWrites: 0,
      unreadable: 1,
      unresolved: 0,
      verifiedScanned: 10,
      verifiedNonConforming: 0,
      verifiedUnreadable: 1,
      remaining: 1,
    });
  });

  it('is idempotent: a second run writes nothing', async () => {
    const before = await snapshot();
    const result = await reencryptCli('--confirm');

    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      'user_credentials.totp_secret_enc: 5 scanned · 4 already current · 0 re-sealed · 0 rewritten concurrently (current) · 0 removed concurrently · 0 stale concurrent write(s) · 1 unreadable · 0 unresolved',
    );
    expect(await snapshot()).toBe(before);
  });

  it('once nothing remains: a dry run points to --confirm, and only --confirm states the retirement preconditions', async () => {
    // The operator resolves the unreadable factor, e.g. by resetting it.
    await prisma.userCredential.update({
      where: { userId: users.u4 },
      data: { totpSecretEnc: null },
    });

    // R4: a dry run never authorizes retiring a key.
    const dry = await reencryptCli('--dry-run');
    expect(dry.code).toBe(0);
    expect(dry.stdout).toContain('A dry run is not evidence for retiring a key');
    expect(dry.stdout).toContain('run --confirm');
    expect(dry.stdout).not.toMatch(/can be emptied|may be retired/);

    const confirmed = await reencryptCli('--confirm');
    expect(confirmed.code).toBe(0);
    expect(confirmed.stdout).toContain('DATA_ENCRYPTION_KEY_PREVIOUS may be retired only if');
    expect(confirmed.stdout).toContain('point-in-time');
  });

  it('refuses to run without --dry-run or --confirm, before touching anything', async () => {
    const before = await snapshot();
    const result = await reencryptCli();
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Nothing was done');
    expect(await snapshot()).toBe(before);
  });
  /**
   * ADR-045: `sessions.successor_token_ct` is sealed with a per-row AAD
   * (`sessionRefreshSuccessorAad`). The run re-seals it with that same
   * AAD, so an in-window retry still opens it under the new key alone —
   * the old key can be retired without turning that retry into a reuse.
   * Last in the file: it adds a row the totals asserted above exclude.
   */
  it('re-seals a refresh successor with its per-row AAD, so a grace retry survives retirement', async () => {
    const secrets = new SecretService();
    const first = secrets.randomToken();
    const second = secrets.randomToken();
    const session = await prisma.session.create({
      data: {
        userId: users.u1,
        refreshTokenHash: secrets.hash(second),
        previousTokenHash: secrets.hash(first),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    const sealed = sealSuccessor(oldKey, {
      v: 1,
      sid: session.id,
      prev: secrets.hash(first),
      token: second,
    });
    await prisma.$executeRaw`
      UPDATE sessions SET successor_token_ct = ${sealed}, rotated_at = clock_timestamp()
       WHERE id = ${session.id}::uuid`;

    const result = await reencryptCli('--confirm');

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      'sessions.successor_token_ct: 1 scanned · 0 already current · 1 re-sealed',
    );
    expect(result.stdout).toContain(
      'sessions.successor_token_ct: 1 scanned · 1 conforming · 0 not conforming · 0 unreadable',
    );

    const row = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    const resealed = row.successorTokenCt ?? new Uint8Array();
    expect(newKeyOnly.inspect(resealed, sessionRefreshSuccessorAad(session.id)).current).toBe(true);
    // Bound to its row: it does not open without the AAD, even under the right key.
    expect(() => newKeyOnly.decrypt(resealed)).toThrow();
    expect(openSuccessor(newKeyOnly, resealed, session.id)?.token).toBe(second);

    // And the running application answers the retry with it.
    const outcome = await app.get(SessionService).refresh(first);
    expect(outcome.kind).toBe('grace');
    expect(outcome.kind === 'grace' ? outcome.refreshToken : '').toBe(second);
  });
});
