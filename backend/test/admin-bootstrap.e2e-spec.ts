import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { Secret, TOTP } from 'otpauth';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedProduction } from '../prisma/seed/production';
import { runBootstrapCommand } from '../src/cli/bootstrap-admin.command';
import { AdminBootstrapService } from '../src/modules/auth/services/admin-bootstrap.service';
import { UserStatus } from '../src/generated/prisma/enums';
import { type AuthHarness, createAuthHarness, dataOf, tokenFromLink } from './support/auth-app';
import { body as mailBody } from './support/smtp-sink';

/**
 * The first administrator of a deployment, end to end (RM M38.4).
 *
 * Runs against a database of its own, created empty for this file and
 * dropped after it, because the property under test is "a deployment with
 * **no** administrator" — and the shared test database always has some.
 * The order below is the production order:
 *
 *   migrate → (bootstrap refuses: no roles) → db:seed:production →
 *   admin:bootstrap → accept (password) → activate (TOTP) → sign in
 *
 * The command's argument handling, exit codes and refusals are what is
 * asserted (`bootstrapCli` below), not a service called around them.
 */

const BACKEND = resolve(__dirname, '..');
const DB_NAME = `medora_bootstrap_${String(process.pid)}`;
const PASSWORD = 'Bootstrap123!';
const ACCEPT = '/api/v1/auth/admin-invitations/accept';
const ACTIVATE = '/api/v1/auth/admin-invitations/activate';
const LOGIN = '/api/v1/auth/login';
const OTP_VERIFY = '/api/v1/auth/otp/verify';

function databaseUrl(name: string): string {
  const url = new URL(process.env['DATABASE_URL'] ?? '');
  url.pathname = `/${name}`;
  return url.toString();
}

const FRESH_URL = databaseUrl(DB_NAME);
const ADMIN_URL = databaseUrl('postgres');

let harness: AuthHarness;

interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * The command as the operator runs it, minus the process: the same
 * argument handling, output and exit codes (`bootstrap-admin.command.ts`),
 * against the application this file booted on the fresh database. The
 * process wrapper itself runs from the build, which tests do not have —
 * see the header of `src/cli/bootstrap-admin.ts`.
 */
async function bootstrapCli(...args: string[]): Promise<CliResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runBootstrapCommand(
    args,
    () =>
      Promise.resolve({
        service: harness.app.get(AdminBootstrapService),
        close: () => Promise.resolve(),
      }),
    { log: (line) => stdout.push(line), error: (line) => stderr.push(line) },
  );
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

function currentCode(secret: string): string {
  return new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate();
}

async function accept(token: string): Promise<string> {
  const accepted = await request(harness.server).post(ACCEPT).send({ token, password: PASSWORD });
  expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
  return dataOf<{ secret: string }>(accepted).secret;
}

async function adminCount(): Promise<number> {
  return harness.prisma.user.count({ where: { role: { code: 'admin' } } });
}

beforeAll(async () => {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${DB_NAME}"`);
  await admin.end();

  // `migrate deploy`, as production runs it: committed migrations only.
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: BACKEND,
    env: { ...process.env, DATABASE_URL: FRESH_URL },
    stdio: 'pipe',
  });

  // `loadEnv()` is memoised on first read, so the application booted here
  // binds to the fresh database. Restored at once: the variable belongs to
  // the worker process, and the next spec file in it must not inherit it.
  const shared = process.env['DATABASE_URL'];
  process.env['DATABASE_URL'] = FRESH_URL;
  try {
    harness = await createAuthHarness('bootstrap-m384');
  } finally {
    process.env['DATABASE_URL'] = shared;
  }
}, 180_000);

afterAll(async () => {
  await harness?.close();
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
  await admin.end();
});

describe('admin:bootstrap on a new deployment', () => {
  it('does nothing without --confirm, and says so', async () => {
    const result = await bootstrapCli('--email', 'first@bootstrap.test');

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Nothing was done');
  }, 90_000);

  it('refuses before the reference data exists — there is no admin role to confer', async () => {
    const result = await bootstrapCli(
      '--email',
      'first@bootstrap.test',
      '--confirm',
      '--print-link',
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('roles_not_seeded');
    expect(await harness.prisma.adminInvitation.count()).toBe(0);
  }, 90_000);

  it('db:seed:production creates the roles and catalogues and no account at all', async () => {
    await seedProduction(harness.prisma);

    expect(await harness.prisma.role.count({ where: { code: 'admin' } })).toBe(1);
    expect(await harness.prisma.labTestCatalogue.count()).toBeGreaterThan(0);
    expect(await harness.prisma.user.count()).toBe(0);
    expect(await harness.prisma.userCredential.count()).toBe(0);
  });

  it('leaves rows that exist alone when run again', async () => {
    // What an administrator might do after go-live.
    await harness.prisma.role.update({
      where: { code: 'reception' },
      data: { label: 'Front desk' },
    });

    await seedProduction(harness.prisma);

    const role = await harness.prisma.role.findUniqueOrThrow({ where: { code: 'reception' } });
    expect(role.label).toBe('Front desk');
  });

  it('mails an invitation that creates nothing until it is accepted', async () => {
    harness.sink.clear();

    await harness.app
      .get(AdminBootstrapService)
      .issue({ email: 'abandoned@bootstrap.test', delivery: 'email' });

    const invitation = await harness.prisma.adminInvitation.findFirstOrThrow({
      where: { email: 'abandoned@bootstrap.test' },
    });
    expect(invitation.invitedBy).toBeNull();
    expect(await adminCount()).toBe(0);

    const audit = await harness.prisma.auditEvent.findFirstOrThrow({
      where: { eventType: 'admin.invitation_created', target: `admin_invitation:${invitation.id}` },
    });
    expect(audit.actorId).toBeNull();
    expect(audit.payload).toMatchObject({ bootstrap: true, delivery: 'email' });

    const mail = harness.sink.messages.at(-1);
    expect(mail).toBeDefined();
    // Accepted and then abandoned: a password set, no second factor.
    await accept(tokenFromLink(mailBody(mail!)));

    const placeholder = await harness.prisma.user.findFirstOrThrow({
      where: { email: 'abandoned@bootstrap.test' },
    });
    expect(placeholder.status).toBe(UserStatus.INACTIVE);
  }, 60_000);

  it('refuses while that INACTIVE account exists, and --reissue clears only it', async () => {
    const refused = await bootstrapCli(
      '--email',
      'first@bootstrap.test',
      '--confirm',
      '--print-link',
    );
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain('administrator_exists');

    const reissued = await bootstrapCli(
      '--email',
      'first@bootstrap.test',
      '--confirm',
      '--print-link',
      '--reissue',
    );
    expect(reissued.code, reissued.stderr).toBe(0);
    expect(reissued.stdout).toContain('Removed 1 abandoned bootstrap account');
    expect(await harness.prisma.user.count({ where: { email: 'abandoned@bootstrap.test' } })).toBe(
      0,
    );

    // The printed link completes through the ordinary two phases.
    const token = tokenFromLink(reissued.stdout);
    const secret = await accept(token);

    // Phase 1 alone is not an administrator anyone can use.
    const early = await request(harness.server)
      .post(LOGIN)
      .send({ email: 'first@bootstrap.test', password: PASSWORD, rememberMe: false });
    expect(early.status).not.toBe(200);

    const activated = await request(harness.server)
      .post(ACTIVATE)
      .send({ token, code: currentCode(secret) });
    expect(activated.status, JSON.stringify(activated.body)).toBe(200);

    const login = await request(harness.server)
      .post(LOGIN)
      .send({ email: 'first@bootstrap.test', password: PASSWORD, rememberMe: false });
    const otpToken = dataOf<{ otpToken: string }>(login).otpToken;
    const session = await request(harness.server)
      .post(OTP_VERIFY)
      .send({ otpToken, code: currentCode(secret) });

    expect(session.status).toBe(200);
    const user = dataOf<{ user: { role: string; permissions: string[] } }>(session).user;
    expect(user.role).toBe('admin');
    expect(user.permissions).toContain('roles.manage');
  }, 180_000);

  it('refuses for good once an administrator exists, --reissue included', async () => {
    for (const extra of [[], ['--reissue']]) {
      const result = await bootstrapCli('--email', 'second@bootstrap.test', '--confirm', ...extra);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('administrator_exists');
    }

    expect(await adminCount()).toBe(1);
  }, 180_000);
});
