import { RequestMethod, type Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer, Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { Secret, TOTP } from 'otpauth';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AUTHENTICATED_USER } from '../src/common/auth/authenticated-user';
import {
  AUTHENTICATED_METADATA,
  AuthorizationGuard,
  CAN_METADATA,
  IS_PUBLIC_KEY,
  PERMISSIONS,
  Public,
  ROLES_METADATA,
  SEEDED_MATRIX,
  ADMIN_DENIED_PHI,
  isPlatformRole,
  type Permission,
} from '../src/shared/authz';
import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  grantPlatformAdmin,
  makeClinicalDoctor,
  makeClinicalStaff,
  markVerified,
  patientRegistrationBody,
  registrationBody,
  testEmail,
} from './support/auth-app';

/**
 * RM M34.2 — every **real** route × every role × the permission it needs.
 *
 * `authz-matrix.e2e-spec.ts` closed the M7 gate with fixture routes,
 * because at M7 the application had none worth the name. It says so, and
 * it says that a real guarded route was to be added to its table by hand.
 * Nobody did, and a hand-kept table would only ever be as complete as the
 * last person to remember it. So this suite **discovers** the routes:
 * whatever controller the application mounts is in the matrix, the day it
 * is mounted.
 *
 * ## What is asserted
 *
 * 1. **The discovery is complete.** The routes read off controller
 *    metadata are compared with the routes Express actually serves. A
 *    route mounted some other way would be missing from every check
 *    below, so a difference fails here first.
 * 2. **Every route states a rule.** An unmarked route is denied to all by
 *    the guard (fail-closed, M7.1) — safe, but a route nobody can reach
 *    is a defect, and the forgotten decorator is the mistake this
 *    protects against.
 * 3. **The public surface is exactly the reviewed list.** `@Public()`
 *    is the one decorator that removes authentication. Adding it to a
 *    route must be a change to `PUBLIC_ROUTES` below, which a reviewer
 *    sees, rather than a line inside a controller, which they may not.
 *    The classifier is shown failing on a deliberately public demo
 *    route — the roadmap's "fails on a deliberately unguarded demo route".
 * 4. **Without a token, every non-public route answers 401** — over HTTP,
 *    through the real global guards.
 * 5. **Every role the route's rule refuses is refused with 403** — over
 *    HTTP, so the assertion covers the guard actually being mounted on
 *    that route, not just its decision.
 * 6. **The route × role table is committed** in
 *    `authz-route-matrix.snapshot.txt`, one line per route: its rule and
 *    which roles it admits. Assertions 4, 5 and 7 prove the guard enforces
 *    what each route *declares*; this one makes a change to what a route
 *    declares visible. Loosening `@Can('roles.manage')` to
 *    `@Authenticated()` passes every enforcement check — the guard does
 *    exactly what it was told — and changes a line here, which a reviewer
 *    reads as "pharmacy can now edit the permission matrix".
 * 7. **Every role the rule admits passes the real guard** — the guard
 *    instance the application uses, the route's real handler and class
 *    metadata, a real principal and the real resolver. This half does not
 *    go over HTTP on purpose: an admitted request runs the handler, and a
 *    suite that ran several hundred handlers with placeholder input would
 *    be testing input validation and writing rows nobody asked for.
 *
 * ## Why each account's capabilities are pinned
 *
 * The expected answer is computed from `SEEDED_MATRIX`. The live matrix is
 * a shared table, and `roles-permissions.e2e-spec.ts` edits it — briefly,
 * restoring it afterwards — while other files run. A role-only principal
 * would therefore see an edited bundle now and then and this suite would
 * flake for a reason that has nothing to do with routes.
 *
 * So each test account carries `user_permissions` overrides that grant its
 * seeded bundle and revoke everything else. The resolver still runs in
 * full — role bundle, overrides, locks — and its answer is the seeded one
 * regardless of what another file is doing to the shared matrix.
 */
let harness: AuthHarness;

const PREFIX = '/api/v1';
const PASSWORD = 'Medora123!';

/**
 * Every route reachable without a token. A new entry here is a decision to
 * let the internet call that route; review it as one.
 */
const PUBLIC_ROUTES = new Set<string>([
  'GET /api/v1/health',
  'GET /api/v1/ready',
  // M38.1: a scraper holds no session. Guarded by METRICS_TOKEN instead,
  // and 404 while that is unset (`metrics.controller.ts`).
  'GET /api/v1/metrics',
  'POST /api/v1/auth/register',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/otp/verify',
  // Owner decision R1: a recovery code against the same pending challenge.
  'POST /api/v1/auth/otp/recovery',
  'POST /api/v1/auth/otp/resend',
  'POST /api/v1/auth/refresh',
  'POST /api/v1/auth/forgot-password',
  'POST /api/v1/auth/reset-password',
  'POST /api/v1/auth/verify-email',
  'POST /api/v1/auth/verification/resend',
  'POST /api/v1/auth/admin-invitations/accept',
  'POST /api/v1/auth/admin-invitations/activate',
]);

/** The principals the matrix is driven with. `nurse` has no matrix column. */
const ROLES = [
  'admin',
  'doctor',
  'reception',
  'laboratory',
  'pharmacy',
  'patient',
  'nurse',
] as const;
type Role = (typeof ROLES)[number];

/* ── Route discovery ─────────────────────────────────────────────── */

interface Rule {
  readonly isPublic: boolean;
  readonly authenticated: boolean;
  readonly roles: readonly string[];
  readonly capabilities: readonly Permission[];
}

interface DiscoveredRoute {
  /** `GET /api/v1/patients/:patientId` */
  readonly key: string;
  readonly method: string;
  readonly path: string;
  readonly controller: Type;
  readonly handler: (...args: unknown[]) => unknown;
  readonly rule: Rule;
}

const reflector = new Reflector();

function joinPath(...segments: string[]): string {
  const joined = segments
    .flatMap((segment) => segment.split('/'))
    .filter((part) => part.length > 0)
    .join('/');
  return `/${joined}`;
}

function asList(value: unknown): string[] {
  if (value === undefined) return [''];
  return Array.isArray(value) ? (value as string[]) : [value as string];
}

/** The rule the guard will read, resolved exactly as the guard resolves it. */
function ruleOf(handler: (...args: unknown[]) => unknown, controller: Type): Rule {
  const targets = [handler, controller];

  return {
    isPublic: reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets) === true,
    authenticated: reflector.getAllAndOverride<boolean>(AUTHENTICATED_METADATA, targets) === true,
    roles: reflector.getAllAndOverride<readonly string[]>(ROLES_METADATA, targets) ?? [],
    capabilities: reflector.getAllAndOverride<readonly Permission[]>(CAN_METADATA, targets) ?? [],
  };
}

/** Every handler on `controller`, one entry per (verb, path) it serves. */
function routesOf(controller: Type, prefix: string): DiscoveredRoute[] {
  const routes: DiscoveredRoute[] = [];
  const prototype = controller.prototype as Record<string, unknown>;
  const controllerPaths = asList(Reflect.getMetadata(PATH_METADATA, controller));

  for (const name of Object.getOwnPropertyNames(prototype)) {
    if (name === 'constructor') continue;
    const handler = prototype[name];
    if (typeof handler !== 'function') continue;

    const methodPath: unknown = Reflect.getMetadata(PATH_METADATA, handler);
    if (methodPath === undefined) continue;

    const verb = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod];
    const fn = handler as (...args: unknown[]) => unknown;

    for (const base of controllerPaths) {
      for (const own of asList(methodPath)) {
        const path = joinPath(prefix, base, own);
        routes.push({
          key: `${verb} ${path}`,
          method: verb,
          path,
          controller,
          handler: fn,
          rule: ruleOf(fn, controller),
        });
      }
    }
  }

  return routes;
}

function discoverRoutes(): DiscoveredRoute[] {
  const modules = harness.app.get(ModulesContainer);
  const seen = new Set<Type>();
  const routes: DiscoveredRoute[] = [];

  for (const module of modules.values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype as Type | null;
      if (controller === null || seen.has(controller)) continue;
      seen.add(controller);
      routes.push(...routesOf(controller, PREFIX));
    }
  }

  return routes.sort((a, b) => a.key.localeCompare(b.key));
}

interface ExpressLayer {
  readonly route?: { readonly path: string; readonly methods: Record<string, boolean> };
}

/** What Express actually serves, as `VERB /path` keys. */
function mountedRoutes(): Set<string> {
  const express = harness.app.getHttpAdapter().getInstance() as {
    _router: { stack: ExpressLayer[] };
  };
  const keys = new Set<string>();

  for (const layer of express._router.stack) {
    if (layer.route === undefined) continue;
    // `CorrelationMiddleware.forRoutes('*')` (app.module.ts) is mounted by
    // Nest as a route layer for every verb at `/api/v1$` and `/api/v1/*`.
    // It is middleware, not a handler; no controller path contains either
    // character.
    if (/[*$]/.test(layer.route.path)) continue;
    for (const [verb, on] of Object.entries(layer.route.methods)) {
      if (on && verb !== '_all') keys.add(`${verb.toUpperCase()} ${layer.route.path}`);
    }
  }

  return keys;
}

/** A route's violation of the two structural rules, or `null`. */
function violationOf(route: Pick<DiscoveredRoute, 'key' | 'rule'>): string | null {
  const { rule } = route;

  if (rule.isPublic) {
    return PUBLIC_ROUTES.has(route.key) ? null : `${route.key} is @Public() but not reviewed`;
  }

  if (!rule.authenticated && rule.roles.length === 0 && rule.capabilities.length === 0) {
    return `${route.key} states no rule, so the guard denies it to everyone`;
  }

  return null;
}

/* ── The expected answer ─────────────────────────────────────────── */

/** The seeded effective set — what each pinned account resolves to. */
function heldBy(role: Role): ReadonlySet<Permission> {
  // The seeded bundle as the server policy overlay leaves it: an
  // administrator holds no standing PHI capability (multi-hospital §2.1).
  const seeded = isPlatformRole(role) ? SEEDED_MATRIX[role] : [];
  return new Set(
    seeded.filter((capability) => role !== 'admin' || !ADMIN_DENIED_PHI.includes(capability)),
  );
}

/** The guard's decision, restated from the rule — see `authorization.guard.ts`. */
function admits(rule: Rule, role: Role): boolean {
  if (rule.isPublic) return true;
  if (!rule.authenticated && rule.roles.length === 0 && rule.capabilities.length === 0) {
    return false;
  }
  if (rule.roles.length > 0 && !rule.roles.includes(role)) return false;

  const held = heldBy(role);
  return rule.capabilities.every((capability) => held.has(capability));
}

/** `:patientId` → a placeholder. Nothing past the guard ever reads it. */
function concrete(path: string): string {
  return path.replace(/:[A-Za-z0-9_]+/g, 'x');
}

const ROLE_LETTER: Record<Role, string> = {
  admin: 'A',
  doctor: 'D',
  reception: 'R',
  laboratory: 'L',
  pharmacy: 'P',
  patient: 'T',
  nurse: 'N',
};

function describeRule(rule: Rule): string {
  if (rule.isPublic) return 'public';
  const parts: string[] = [];
  if (rule.roles.length > 0) parts.push(`roles:${rule.roles.join(',')}`);
  if (rule.capabilities.length > 0) parts.push(`can:${rule.capabilities.join(',')}`);
  if (parts.length === 0 && rule.authenticated) parts.push('authenticated');
  return parts.length === 0 ? 'NONE' : parts.join(' ');
}

/** The committed route × role table — see assertion 6 in the header. */
function renderTable(all: readonly DiscoveredRoute[]): string {
  const legend = ROLES.map((role) => `${ROLE_LETTER[role]}=${role}`).join(' ');
  const width = Math.max(...all.map((route) => route.key.length));
  const rows = all.map((route) => {
    const who = ROLES.map((role) => (admits(route.rule, role) ? ROLE_LETTER[role] : '.')).join('');
    return `${route.key.padEnd(width)}  ${who}  ${describeRule(route.rule)}`;
  });

  return [
    '# Route × role authorization table — generated by authz-route-matrix.e2e-spec.ts (RM M34.2).',
    '# A change to this file is a change to who can reach what. Review it as one.',
    `# Roles: ${legend} (a role letter means admitted; "." means refused).`,
    '# Public routes admit everyone, including callers with no token.',
    '',
    ...rows,
    '',
  ].join('\n');
}

/* ── Accounts ────────────────────────────────────────────────────── */

interface Account {
  readonly role: Role;
  readonly token: string;
  readonly userId: string;
  readonly publicId: string;
  readonly sessionId: string;
}

const accounts = new Map<Role, Account>();

function currentCode(secret: string): string {
  return new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate();
}

async function login(email: string): Promise<{ accessToken?: string; otpToken?: string }> {
  return dataOf(
    await request(harness.server)
      .post(`${PREFIX}/auth/login`)
      .send({ email, password: PASSWORD, rememberMe: false }),
  );
}

/**
 * Grants the seeded bundle and revokes the rest, as `user_permissions`
 * rows — see "Why each account's capabilities are pinned" above.
 */
async function pinCapabilities(userId: string, role: Role): Promise<void> {
  const held = heldBy(role);
  const catalogue = await harness.prisma.permission.findMany({
    where: { code: { in: [...PERMISSIONS] } },
    select: { id: true, code: true },
  });

  await harness.prisma.userPermission.createMany({
    data: catalogue.map((permission) => ({
      userId,
      permissionId: permission.id,
      allowed: held.has(permission.code as Permission),
    })),
  });
}

async function createAccount(role: Role): Promise<Account> {
  const email = testEmail(`route-matrix-${role}`);

  if (role === 'patient') {
    await request(harness.server)
      .post(`${PREFIX}/auth/register`)
      .send(patientRegistrationBody({ email }));
  } else {
    await request(harness.server).post(`${PREFIX}/auth/register`).send(registrationBody({ email }));
  }
  await markVerified(harness.prisma, email);

  const user = await harness.prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true, publicId: true },
  });
  await pinCapabilities(user.id, role);

  let token: string;

  if (role === 'admin') {
    // ADR-035: an administrator signs in with a second factor, so enrol
    // one while still a doctor, then promote and sign in through OTP.
    const bootstrap = (await login(email)).accessToken ?? '';
    const secret = dataOf<{ secret: string }>(
      await request(harness.server)
        .post(`${PREFIX}/me/2fa/setup`)
        .set('Authorization', `Bearer ${bootstrap}`)
        .send({ password: PASSWORD }),
    ).secret;
    await request(harness.server)
      .post(`${PREFIX}/me/2fa/enable`)
      .set('Authorization', `Bearer ${bootstrap}`)
      .send({ code: currentCode(secret) });
    await setRole(user.id, role);
    // Admin tiering: the admin routes need an explicit Platform Admin grant.
    await grantPlatformAdmin(harness.prisma, email);

    const { otpToken } = await login(email);
    token = dataOf<{ accessToken: string }>(
      await request(harness.server)
        .post(`${PREFIX}/auth/otp/verify`)
        .send({ otpToken, code: currentCode(secret) }),
    ).accessToken;
  } else {
    if (role !== 'doctor' && role !== 'patient') await setRole(user.id, role);
    // Clinical standing (§2.6): a doctor needs a verified, active
    // employment, a staff role an active affiliation, or it holds nothing.
    if (role === 'doctor') await makeClinicalDoctor(harness.prisma, email);
    if (role === 'reception' || role === 'laboratory' || role === 'pharmacy' || role === 'nurse') {
      await makeClinicalStaff(harness.prisma, email);
    }
    token = (await login(email)).accessToken ?? '';
  }

  expect(token, `no access token for ${role}`).not.toBe('');

  const session = await harness.prisma.session.findFirstOrThrow({
    where: { userId: user.id, revokedAt: null },
    orderBy: { startedAt: 'desc' },
    select: { id: true },
  });

  return { role, token, userId: user.id, publicId: user.publicId, sessionId: session.id };
}

async function setRole(userId: string, code: string): Promise<void> {
  const role = await harness.prisma.role.findUniqueOrThrow({ where: { code } });
  await harness.prisma.user.update({ where: { id: userId }, data: { roleId: role.id } });
}

/**
 * `staff_members` outlives its user (SET NULL) and keeps the unique email,
 * so the clinical-staff rows this suite creates go by address once their
 * users (and so their affiliations) are gone.
 */
async function removeStaffRows(): Promise<void> {
  await harness.prisma.staffMember.deleteMany({
    where: { email: { endsWith: `@${harness.domain}` }, userId: null },
  });
}

function account(role: Role): Account {
  const found = accounts.get(role);
  if (found === undefined) throw new Error(`no ${role} account`);
  return found;
}

/** Runs `work` over `items`, `width` at a time. */
async function inBatches<T>(items: readonly T[], width: number, work: (item: T) => Promise<void>) {
  for (let start = 0; start < items.length; start += width) {
    await Promise.all(items.slice(start, start + width).map(work));
  }
}

function send(route: DiscoveredRoute, token?: string): request.Test {
  const verb = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
  const call = request(harness.server)[verb](concrete(route.path));
  return token === undefined ? call : call.set('Authorization', `Bearer ${token}`);
}

/* ── Suite ───────────────────────────────────────────────────────── */

let routes: DiscoveredRoute[] = [];
let guarded: DiscoveredRoute[] = [];

beforeAll(async () => {
  harness = await createAuthHarness('authz-route-matrix');
  await removeStaffRows();

  for (const role of ROLES) accounts.set(role, await createAccount(role));

  routes = discoverRoutes();
  guarded = routes.filter((route) => !route.rule.isPublic);
}, 120_000);

afterAll(async () => {
  if (harness === undefined) return;
  await harness.reset();
  await removeStaffRows();
  await harness.close();
});

describe('M34.2 — the route inventory', () => {
  it('discovers every route Express serves, and nothing it does not', () => {
    const discovered = new Set(routes.map((route) => route.key));
    const mounted = mountedRoutes();

    expect([...mounted].filter((key) => !discovered.has(key))).toEqual([]);
    expect([...discovered].filter((key) => !mounted.has(key))).toEqual([]);
    // A floor, so a discovery that silently found nothing cannot pass.
    expect(routes.length).toBeGreaterThan(200);
  });

  it('gives every route a rule, and makes public only the reviewed ones', () => {
    expect(routes.map(violationOf).filter((violation) => violation !== null)).toEqual([]);
  });

  it('keeps no stale entry in the reviewed public list', () => {
    const publicKeys = new Set(routes.filter((r) => r.rule.isPublic).map((r) => r.key));
    expect([...PUBLIC_ROUTES].filter((key) => !publicKeys.has(key))).toEqual([]);
  });

  it('matches the committed route × role table', async () => {
    await expect(renderTable(routes)).toMatchFileSnapshot('./authz-route-matrix.snapshot.txt');
  });

  it('names only capabilities the catalogue defines', () => {
    const known = new Set<string>(PERMISSIONS);
    const unknown = routes.flatMap((route) =>
      route.rule.capabilities.filter((capability) => !known.has(capability)),
    );
    expect(unknown).toEqual([]);
  });

  it('flags a deliberately unguarded demo route', () => {
    // The roadmap's own verification: the check must fail on a route that
    // was made public without review, and on one that states no rule.
    class DemoController {
      @Public()
      openDoor(): void {}

      forgotten(): void {}
    }
    const proto = DemoController.prototype as unknown as Record<string, () => void>;
    const demo = (name: string) => ({
      key: `GET /api/v1/demo/${name}`,
      rule: ruleOf(proto[name] as (...args: unknown[]) => unknown, DemoController),
    });

    expect(violationOf(demo('openDoor'))).toMatch(/is @Public\(\) but not reviewed/);
    expect(violationOf(demo('forgotten'))).toMatch(/states no rule/);
  });
});

describe('M34.2 — route × role over HTTP', () => {
  it('answers 401 to every non-public route without a token', async () => {
    const wrong: string[] = [];

    await inBatches(guarded, 25, async (route) => {
      const response = await send(route);
      if (response.status !== 401) wrong.push(`${route.key} → ${response.status}`);
    });

    expect(wrong).toEqual([]);
  });

  it.each(ROLES)(
    'refuses %s with 403 on every route its capabilities do not reach',
    async (role) => {
      const { token } = account(role);
      const refused = guarded.filter((route) => !admits(route.rule, role));
      const wrong: string[] = [];

      await inBatches(refused, 25, async (route) => {
        const response = await send(route, token);
        if (response.status !== 403) wrong.push(`${route.key} → ${response.status}`);
      });

      expect(wrong).toEqual([]);
    },
  );
});

describe('M34.2 — route × role through the real guard', () => {
  it.each(ROLES)('admits %s to every route its capabilities reach', async (role) => {
    const guard = harness.app.get(AuthorizationGuard);
    const principal = account(role);
    const admitted = guarded.filter((route) => admits(route.rule, role));
    const wrong: string[] = [];

    for (const route of admitted) {
      const req = {
        [AUTHENTICATED_USER]: {
          id: principal.userId,
          publicId: principal.publicId,
          role,
          permissions: [],
          sessionId: principal.sessionId,
        },
      };
      const context = new ExecutionContextHost(
        [req, {}, () => undefined],
        route.controller,
        route.handler,
      );

      const decision = await guard.canActivate(context).catch((error: unknown) => error);
      if (decision !== true) wrong.push(route.key);
    }

    expect(wrong).toEqual([]);
  });

  it('leaves no role without a route and no guarded route without a role', () => {
    // A rule no role satisfies is a route nobody can call; a role that
    // reaches nothing is a seeded account that can only sign in.
    const unreachable = guarded
      .filter((route) => ROLES.every((role) => !admits(route.rule, role)))
      .map((route) => route.key);
    expect(unreachable).toEqual([]);

    for (const role of ROLES) {
      expect(
        guarded.some((route) => admits(route.rule, role)),
        role,
      ).toBe(true);
    }
  });
});
