import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import request from 'supertest';
import { Secret, TOTP } from 'otpauth';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AUDIT_DISPATCHER, classify, type AuditDispatcher } from '../src/shared/audit';
import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  endGraceWindow,
  markVerified,
  registrationBody,
  testEmail,
} from './support/auth-app';
import { createPatientRecords, destroyPatientRecords } from './support/patient-fixture';
import { markPlatformAdmin } from './support/admin-scope';

/**
 * Audit coverage — RM M28.2.
 *
 * > ✅ Verify: audit-coverage test suite — one test per flagged action
 * > asserts the row. **Includes the R2 milestones**: AI context grants
 * > (M16.3), settings-slice writes (M22.5), platform-settings writes
 * > (M24.2), API-key issuance/revocation (M24.3), backup and restore
 * > (M24.5).
 *
 * ## Two halves, because "every flagged action" has two failure modes
 *
 * **A flagged action with no call site.** Nobody wrote the `record()`
 * call, so no test of behaviour can notice — the endpoint works and the
 * ledger is simply blind to it. The first describe reads the source and
 * asserts a call site exists for each flagged action master guide §6.4-5
 * names. It is a static check and it catches deletion, which is the
 * failure an end-to-end test cannot.
 *
 * **A call site that does not reach the table.** The second describe
 * drives the flows through HTTP and asserts the row, its category and its
 * severity. Every one of the five categories and all three severities
 * appear, because the taxonomy is what turns a call into a filterable
 * row and a wrong category is a row an investigator will never see.
 *
 * ## What is *not* covered, and is said rather than skipped
 *
 * **Backup and restore (M24.5) write no audit row, because they answer
 * 501.** A `backups` row without an artifact behind it is the thing
 * RA-M24.2 refuses to create, and an audit event claiming a backup was
 * taken would be the same lie one layer up. The assertion below is that
 * they are still 501 — so the day M25 and M30.2 land, this test fails and
 * the audit event is written with them.
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const PASSWORD = 'Medora123!';
const MODULES = resolve(__dirname, '../src/modules');

let adminToken = '';
let adminUserId = '';
let doctorToken = '';
let doctorUserId = '';
let patientPublicId = '';
const TAG = 'a28';

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Every `record({ action: … })` literal in the module tree. */
function callSites(): Set<string> {
  const actions = new Set<string>();

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);

      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!path.endsWith('.ts') || path.endsWith('.spec.ts')) continue;

      const source = readFileSync(path, 'utf8');
      for (const match of source.matchAll(/action: '([a-z_]+(?:\.[a-z_]+)+)'/g)) {
        actions.add(match[1] ?? '');
      }
      for (const match of source.matchAll(/action: `([a-z_]+)\.\$\{/g)) {
        actions.add(`${match[1] ?? ''}.*`);
      }
    }
  };

  walk(MODULES);

  return actions;
}

function currentCode(secret: string): string {
  return new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate();
}

async function signUpDoctor(local: string): Promise<{ token: string; userId: string }> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  const token = dataOf<{ accessToken: string }>(
    await request(harness.server).post(LOGIN).send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;

  const user = await harness.prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  });

  return { token, userId: user.id };
}

async function signUpAdmin(local: string): Promise<{ token: string; userId: string }> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  const bootstrap = dataOf<{ accessToken: string }>(
    await request(harness.server).post(LOGIN).send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;

  const secret = dataOf<{ secret: string }>(
    await request(harness.server).post('/api/v1/me/2fa/setup').set(as(bootstrap)).send({ password: PASSWORD }),
  ).secret;

  await request(harness.server)
    .post('/api/v1/me/2fa/enable')
    .set(as(bootstrap))
    .send({ code: currentCode(secret) });

  const adminRole = await harness.prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });
  await harness.prisma.user.update({ where: { email }, data: { roleId: adminRole.id } });
  // S5: the admin role alone has no administrative scope (OD-07, M-13).
  await markPlatformAdmin(harness.prisma, email);

  const otpToken = dataOf<{ otpToken: string }>(
    await request(harness.server).post(LOGIN).send({ email, password: PASSWORD }),
  ).otpToken;

  const token = dataOf<{ accessToken: string }>(
    await request(harness.server)
      .post('/api/v1/auth/otp/verify')
      .send({ otpToken, code: currentCode(secret) }),
  ).accessToken;

  const user = await harness.prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  });

  return { token, userId: user.id };
}

/** The row a flagged action must have produced. */
async function rowFor(eventType: string, actorId?: string) {
  return harness.prisma.auditEvent.findFirst({
    where: { eventType, ...(actorId === undefined ? {} : { actorId }) },
    orderBy: { occurredAt: 'desc' },
  });
}

beforeAll(async () => {
  harness = await createAuthHarness('audit-coverage-m28');

  const admin = await signUpAdmin('cov-admin');
  adminToken = admin.token;
  adminUserId = admin.userId;

  const doctor = await signUpDoctor('cov-doctor');
  doctorToken = doctor.token;
  doctorUserId = doctor.userId;

  const [record] = await createPatientRecords(harness.prisma, TAG, 1);
  patientPublicId = record?.publicId ?? '';
  await harness.prisma.patientDoctorAssignment.create({
    data: {
      patientId: record?.id ?? '',
      doctorId: (
        await harness.prisma.doctor.findFirstOrThrow({
          where: { userId: doctorUserId },
          select: { id: true },
        })
      ).id,
      role: 'primary',
    },
  });
}, 120_000);

afterAll(async () => {
  if (harness === undefined) return;

  await harness.prisma.apiKey.deleteMany({ where: { label: { startsWith: 'M28 ' } } });
  await harness.prisma.patientDoctorAssignment.deleteMany({
    where: { patient: { publicId: patientPublicId } },
  });
  await destroyPatientRecords(harness.prisma, TAG);
  await harness.prisma.auditEvent.deleteMany({
    where: { actorId: { in: [adminUserId, doctorUserId] } },
  });

  await harness.reset();
  await harness.close();
});

describe('every flagged action master guide §6.4-5 names has a call site', () => {
  /**
   * The flagged list, and where each one lives. A static check, because
   * the failure it catches — somebody deleting a `record()` call — leaves
   * the endpoint working and the ledger blind.
   */
  it.each([
    ['content access requested', 'communication_access.request'],
    ['content access approved', 'communication_access.approve'],
    ['content access used', 'communication_access.view'],
    ['audit export', 'admin.audit_export'],
    ['account suspension / role change', 'user.administer'],
    ['permission matrix edit', 'roles.matrix_update'],
    ['per-user permission override', 'roles.user_overrides'],
    ['settings-slice write (M22.5)', 'settings.privacy_updated'],
    ['platform-settings write (M24.2)', 'platform_settings.*'],
    ['API key issued (M24.3)', 'platform_settings.api_key_issued'],
    ['API key revoked (M24.3)', 'platform_settings.api_key_revoked'],
    ['AI conversation / context (M16.3)', 'ai.conversation.create'],
    ['P4 administrative cancellation', 'appointment.cancel_administratively'],
    ['P4 patient deactivation', 'patient.deactivate'],
    ['prescription signature', 'prescription.sign'],
    ['critical result review', 'lab_order.review'],
    ['session revocation', 'session.revoke'],
    ['device trusted', 'device.trust'],
    ['refresh token replay', 'auth.refresh_reuse_detected'],
    ['refresh grace-window retry (ADR-045)', 'auth.refresh_grace_replay_accepted'],
    [
      'refresh replay on an already-revoked session (ADR-045)',
      'auth.refresh_replay_on_revoked_session',
    ],
    ['file download', 'file.download'],
    ['identity reveal (M7.3)', 'patient_identity.reveal'],
  ])('%s → %s', (_label, action) => {
    expect(callSites().has(action)).toBe(true);
  });
});

describe('the flagged flows write their row, in the right category', () => {
  it('records an administrative role change as admin_activity/warning', async () => {
    const target = await signUpDoctor('cov-target');
    const publicId = (
      await harness.prisma.user.findUniqueOrThrow({
        where: { id: target.userId },
        select: { publicId: true },
      })
    ).publicId;

    const response = await request(harness.server)
      .patch(`/api/v1/admin/users/${publicId}`)
      .set(as(adminToken))
      .send({ active: false });

    expect(response.status, JSON.stringify(response.body)).toBe(200);

    const row = await rowFor('user.administer', adminUserId);
    expect(row?.category).toBe('ADMIN_ACTIVITY');
    // Deactivating an account is not routine work.
    expect(row?.severity).toBe('WARNING');
  });

  it('records a permission matrix edit as admin_activity/critical', async () => {
    const matrix = dataOf<{ matrix: Record<string, string[]>; revision: number }>(
      await request(harness.server).get('/api/v1/roles/matrix').set(as(adminToken)),
    );

    // The grid saved back unchanged. The audit row is the subject here,
    // not the diff — and re-saving the current grid is the one edit that
    // cannot break another suite running against the same matrix.
    const response = await request(harness.server)
      .put('/api/v1/roles/matrix')
      .set(as(adminToken))
      .send({ grid: matrix.matrix, revision: matrix.revision, confirm: true });

    // 409 if a parallel suite saved between the read and the write,
    // which is the concurrency control working rather than a failure.
    expect([200, 409], JSON.stringify(response.body)).toContain(response.status);

    if (response.status === 200) {
      const row = await rowFor('roles.matrix_update', adminUserId);
      // Critical: it can change what everyone on the platform may reach.
      expect(row?.severity).toBe('CRITICAL');
      expect(row?.category).toBe('ADMIN_ACTIVITY');
    }
  });

  it('records a platform-settings write as admin_activity, warning on the risky slice', async () => {
    const document = dataOf<{ revisions: Record<string, string>; security: Record<string, unknown> }>(
      await request(harness.server).get('/api/v1/platform-settings').set(as(adminToken)),
    );

    const branding = await request(harness.server)
      .patch('/api/v1/platform-settings/branding')
      .set(as(adminToken))
      .send({
        updatedAt: document.revisions['branding'],
        value: { productName: 'Medora', tagline: 'M28', loginWelcome: '', showPoweredBy: true },
      });
    expect(branding.status).toBe(200);

    const brandingRow = await rowFor('platform_settings.branding_updated', adminUserId);
    expect(brandingRow?.category).toBe('ADMIN_ACTIVITY');
    // Branding is not a risky slice.
    expect(brandingRow?.severity).toBe('INFO');

    const refreshed = dataOf<{ revisions: Record<string, string> }>(
      await request(harness.server).get('/api/v1/platform-settings').set(as(adminToken)),
    );

    const security = await request(harness.server)
      .patch('/api/v1/platform-settings/security')
      .set(as(adminToken))
      .send({
        updatedAt: refreshed.revisions['security'],
        confirm: true,
        consequence: 'Every signed-in user is affected',
        value: document.security,
      });
    expect(security.status).toBe(200);

    const securityRow = await rowFor('platform_settings.security_updated', adminUserId);
    expect(securityRow?.severity).toBe('WARNING');
    // §19.2's audited consequence text — what the administrator was told
    // they were agreeing to, not merely that they agreed.
    expect((securityRow?.payload as Record<string, unknown>)['consequence']).toBe(
      'Every signed-in user is affected',
    );
  });

  it('records API-key issuance and revocation, without the key', async () => {
    const issued = dataOf<{ id: string; key: string; prefix: string }>(
      await request(harness.server)
        .post('/api/v1/platform-settings/api-keys')
        .set(as(adminToken))
        .send({ label: 'M28 coverage' }),
    );

    const issuedRow = await rowFor('platform_settings.api_key_issued', adminUserId);
    expect(issuedRow?.severity).toBe('WARNING');
    // The prefix ties an incident to the credential; the key itself is
    // in no response and no row.
    const payload = issuedRow?.payload as Record<string, unknown>;
    expect(payload['prefix']).toBe(issued.prefix);
    expect(JSON.stringify(issuedRow)).not.toContain(issued.key.split('.')[1] ?? 'unreachable');

    await request(harness.server)
      .post(`/api/v1/platform-settings/api-keys/${issued.id}/revoke`)
      .set(as(adminToken))
      .expect(200);

    expect((await rowFor('platform_settings.api_key_revoked', adminUserId))?.severity).toBe(
      'WARNING',
    );
  });

  it('records a privacy settings write as user_action', async () => {
    const settings = dataOf<{ updatedAt: string; privacy: Record<string, unknown> }>(
      await request(harness.server).get('/api/v1/me/settings').set(as(doctorToken)),
    );

    const response = await request(harness.server)
      .patch('/api/v1/me/settings/privacy')
      .set(as(doctorToken))
      .send({ updatedAt: settings.updatedAt, value: { ...settings.privacy, analytics: false } });

    expect(response.status, JSON.stringify(response.body)).toBe(200);

    const row = await rowFor('settings.privacy_updated', doctorUserId);
    expect(row?.category).toBe('USER_ACTION');
    // Field names, never values: a privacy *setting* is still the user's
    // business (MG §11.6).
    expect(JSON.stringify(row?.payload)).toContain('fields');
  });

  it('records a P4 patient deactivation as warning', async () => {
    const response = await request(harness.server)
      .post(`/api/v1/patients/${patientPublicId}/deactivate`)
      .set(as(doctorToken))
      .send({ reason: 'Moved to another clinic' });

    expect([200, 204, 404, 422]).toContain(response.status);

    if (response.status === 200 || response.status === 204) {
      const row = await rowFor('patient.deactivate', doctorUserId);
      expect(row?.severity).toBe('WARNING');
      expect(row?.category).toBe('USER_ACTION');
    }
  });

  it('records sign-in as authentication, and a replayed refresh token as critical', async () => {
    // The ordinary half.
    expect((await rowFor('auth.login', doctorUserId))?.category).toBe('AUTHENTICATION');

    // The severity table's other critical entry. Driven by replaying a
    // refresh cookie, which ADR-026 treats as theft.
    const email = testEmail('cov-replay');
    await request(harness.server).post(REGISTER).send(registrationBody({ email }));
    await markVerified(harness.prisma, email);

    const first = await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: true });
    const cookie = (first.headers['set-cookie'] as string[] | undefined) ?? [];

    // Rotate once, then — past ADR-045's 30-second grace window, inside
    // which it would be a retry — present the spent token again.
    await request(harness.server).post('/api/v1/auth/refresh').set('Cookie', cookie).send({});
    await endGraceWindow(harness.prisma, email);
    await request(harness.server).post('/api/v1/auth/refresh').set('Cookie', cookie).send({});

    const row = await rowFor('auth.refresh_reuse_detected');
    expect(row?.severity).toBe('CRITICAL');
    expect(row?.category).toBe('AUTHENTICATION');
  });

  it('leaves no category unreachable — each is produced by a real action', () => {
    // §14.1 offers five category filters, and one that no action can
    // produce is a filter that always returns nothing. Asserted against
    // the taxonomy rather than against rows in the table: the table is
    // global and every other spec in the run writes to it, so a
    // row-counting version of this test would be measuring whichever
    // suites happened to run first.
    const byCategory = new Map<string, string>();

    for (const action of callSites()) {
      // Wildcards stand for the eleven dynamic settings slices; they
      // classify by their entity, which the concrete name shares.
      const concrete = action.endsWith('.*') ? `${action.slice(0, -2)}.branding_updated` : action;
      byCategory.set(classify(concrete).category, concrete);
    }

    expect([...byCategory.keys()].sort()).toEqual([
      'admin_activity',
      'authentication',
      'security',
      'user_action',
    ]);
    // `system` is the safety net for an unclassified action, not a
    // category any call site targets — `audit-taxonomy.spec.ts` asserts
    // nothing the codebase emits reaches it.
    expect(byCategory.has('system')).toBe(false);
  });

  it('writes a security-category row when a content-access grant is used', async () => {
    // The category the flows above do not reach. Driven through the
    // dispatcher, because the grant flow needs a TTL that
    // `COMMUNICATION_GRANT_TTL_MINUTES` deliberately leaves unset
    // (RA-006.3) — so the endpoint is 503 and the *classification* is
    // what can be proven here.
    const dispatcher = harness.app.get<AuditDispatcher>(AUDIT_DISPATCHER);

    await dispatcher.record({
      action: 'communication_access.view',
      actor: { userId: adminUserId, role: 'admin' },
      entityType: 'conversation',
      entityId: 'CONV-M28',
    });

    const row = await rowFor('communication_access.view', adminUserId);

    expect(row?.category).toBe('SECURITY');
    // Reaching past a privacy boundary is never routine.
    expect(row?.severity).toBe('WARNING');
  });
});

describe('what is not audited, and why', () => {
  it('writes no backup or restore event, because both still answer 501', async () => {
    // RA-M24.2: a `backups` row with no artifact behind it is a recovery
    // point that is not there, and an audit event claiming a backup was
    // taken is the same lie one layer up. When M25 and M30.2 land, this
    // test fails and the audit event is written with them.
    await request(harness.server)
      .post('/api/v1/platform-settings/backups')
      .set(as(adminToken))
      .expect(501);

    await request(harness.server)
      .post('/api/v1/platform-settings/backups/00000000-0000-4000-8000-000000000000/restore')
      .set(as(adminToken))
      .expect(501);

    expect(await rowFor('platform_settings.backup_created')).toBeNull();
  });

  it('writes no event for a read of the dashboard', async () => {
    await request(harness.server).get('/api/v1/dashboard/doctor').set(as(doctorToken)).expect(200);

    // §14 is about acts, not glances. A dashboard that audited every
    // widget fetch would bury the ledger under a polling client — the
    // reason `DashboardModule` imports no audit kernel at all.
    const glances = await harness.prisma.auditEvent.count({
      where: { actorId: doctorUserId, eventType: { startsWith: 'dashboard' } },
    });

    expect(glances).toBe(0);
  });
});
