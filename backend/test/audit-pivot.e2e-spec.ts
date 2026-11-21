import request from 'supertest';
import { Secret, TOTP } from 'otpauth';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AuditRepository } from '../src/modules/audit/repositories/audit.repository';
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
 * The audit pivot across pages (RM M28.3, corrected at M32.3).
 *
 * Until M32.3 the pivot was computed with the keyset cursor applied, so on
 * every page after the first it counted only the rows older than the
 * cursor: the numbers beside the filters shrank as the reader paged. And it
 * was recomputed on every page, two scans of the filtered ledger each time,
 * for numbers that cannot differ between pages of one listing.
 *
 * Now the pivot always counts the filtered set, and it is computed on the
 * first page, or on a cursor page when asked for (`pivot=true`). These
 * cases pin both halves: the counts, and that a cursor page does not run the
 * aggregate it no longer needs.
 *
 * Every row here carries this suite's own `incidentRef`, because the ledger
 * is shared with every other spec in the run.
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const EVENTS = '/api/v1/audit-events';
const PASSWORD = 'Medora123!';
const INCIDENT = 'INC-M32-PIVOT';
const EMPTY_INCIDENT = 'INC-M32-PIVOT-NONE';

let adminToken = '';
let auditorToken = '';
let doctorToken = '';

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

interface Pivot {
  readonly byCategory: Record<string, number>;
  readonly bySeverity: Record<string, number>;
}

interface Page {
  readonly items: { readonly id: string; readonly summary: string; readonly occurredAt: string }[];
  readonly hasMore: boolean;
  readonly nextCursor?: string;
  readonly pivot?: Pivot;
}

/**
 * Nine events. Two pairs share an instant, so page boundaries at size 2
 * land inside ties, which is where a keyset cursor's `id` tiebreak matters.
 */
const SEED: readonly {
  category: 'SECURITY' | 'SYSTEM' | 'USER_ACTION';
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  minute: number;
}[] = [
  { category: 'SECURITY', severity: 'CRITICAL', minute: 0 },
  { category: 'SECURITY', severity: 'WARNING', minute: 1 },
  { category: 'SECURITY', severity: 'INFO', minute: 1 },
  { category: 'SYSTEM', severity: 'INFO', minute: 2 },
  { category: 'SYSTEM', severity: 'INFO', minute: 3 },
  { category: 'SYSTEM', severity: 'CRITICAL', minute: 3 },
  { category: 'SYSTEM', severity: 'INFO', minute: 4 },
  { category: 'USER_ACTION', severity: 'INFO', minute: 5 },
  { category: 'USER_ACTION', severity: 'WARNING', minute: 6 },
];

/** What the pivot over all nine must be. */
const FULL: Pivot = {
  byCategory: { security: 3, system: 4, user_action: 2 },
  bySeverity: { critical: 2, warning: 2, info: 5 },
};

const BASE = new Date('2026-02-10T08:00:00Z');

function currentCode(secret: string): string {
  return new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate();
}

async function signUp(local: string): Promise<{ email: string; token: string }> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  const token = dataOf<{ accessToken: string }>(
    await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;

  return { email, token };
}

/** An administrator, which requires a second factor (M7). */
async function signUpAdmin(local: string): Promise<string> {
  const { email, token: bootstrap } = await signUp(local);

  const secret = dataOf<{ secret: string }>(
    await request(harness.server).post('/api/v1/me/2fa/setup').set(as(bootstrap)).send({ password: PASSWORD }),
  ).secret;
  await request(harness.server)
    .post('/api/v1/me/2fa/enable')
    .set(as(bootstrap))
    .send({ code: currentCode(secret) });

  const adminRole = await harness.prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });
  await harness.prisma.user.update({ where: { email }, data: { roleId: adminRole.id } });

  const otpToken = dataOf<{ otpToken: string }>(
    await request(harness.server).post(LOGIN).send({ email, password: PASSWORD }),
  ).otpToken;

  return dataOf<{ accessToken: string }>(
    await request(harness.server)
      .post('/api/v1/auth/otp/verify')
      .send({ otpToken, code: currentCode(secret) }),
  ).accessToken;
}

/**
 * A doctor granted `logs.view` by a per-user override (M7.4) — a second
 * route to the capability, so the pivot is checked under two scopes.
 * The override is written before the first request, so no permission
 * cache entry predates it.
 */
async function signUpAuditor(local: string): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  const user = await harness.prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  });
  const logsView = await harness.prisma.permission.findUniqueOrThrow({
    where: { code: 'logs.view' },
  });
  await harness.prisma.userPermission.create({
    data: { userId: user.id, permissionId: logsView.id, allowed: true },
  });

  return dataOf<{ accessToken: string }>(
    await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;
}

const list = (query: string, token = adminToken) =>
  request(harness.server).get(`${EVENTS}?incidentRef=${INCIDENT}&${query}`).set(as(token));

async function page(query: string, token = adminToken): Promise<Page> {
  const response = await list(query, token);
  expect(response.status).toBe(200);

  return dataOf<Page>(response);
}

const after = (cursor: string | undefined) => `cursor=${encodeURIComponent(cursor ?? '')}`;

/** Every page of a listing, following `nextCursor`, with `extra` on each cursor request. */
async function walk(pageSize: number, extra = ''): Promise<Page[]> {
  const pages = [await page(`pageSize=${String(pageSize)}`)];

  while (pages.at(-1)?.hasMore === true) {
    const cursor = pages.at(-1)?.nextCursor;
    pages.push(await page(`pageSize=${String(pageSize)}&${after(cursor)}${extra}`));
    expect(pages.length).toBeLessThan(20);
  }

  return pages;
}

beforeAll(async () => {
  harness = await createAuthHarness('audit-pivot-m32');

  adminToken = await signUpAdmin('pivot-admin');
  auditorToken = await signUpAuditor('pivot-auditor');
  doctorToken = (await signUp('pivot-doctor')).token;

  for (const [index, event] of SEED.entries()) {
    await harness.prisma.auditEvent.create({
      data: {
        category: event.category,
        severity: event.severity,
        eventType: 'test.pivot',
        summary: `Pivot ${String(index)}`,
        incidentRef: INCIDENT,
        occurredAt: new Date(BASE.getTime() + event.minute * 60_000),
      },
    });
  }
}, 120_000);

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  if (harness === undefined) return;

  // The test role owns the ledger; this suite's marker scopes the cleanup.
  await harness.prisma.auditEvent.deleteMany({ where: { incidentRef: INCIDENT } });
  await harness.reset();
  await harness.close();
});

describe('the first page', () => {
  it('counts the whole filtered set, not the page', async () => {
    const first = await page('pageSize=2');

    expect(first.items).toHaveLength(2);
    expect(first.pivot).toEqual(FULL);
  });

  it('counts within the filters, whichever filter narrows the set', async () => {
    expect((await page('pageSize=2&severity=info')).pivot).toEqual({
      byCategory: { security: 1, system: 3, user_action: 1 },
      bySeverity: { info: 5 },
    });
    expect((await page('pageSize=2&category=system')).pivot).toEqual({
      byCategory: { system: 4 },
      bySeverity: { info: 3, critical: 1 },
    });
  });

  it('skips the aggregate when asked to (`pivot=false`)', async () => {
    const pivot = vi.spyOn(harness.app.get(AuditRepository), 'pivot');

    const first = await page('pageSize=2&pivot=false');

    expect(first).not.toHaveProperty('pivot');
    expect(first.items).toHaveLength(2);
    expect(pivot).not.toHaveBeenCalled();
  });

  it('treats a mangled cursor as page one, pivot included', async () => {
    const first = await page('pageSize=2&cursor=rubbish');

    expect(first.pivot).toEqual(FULL);
  });
});

describe('the second page', () => {
  it('does not recompute the pivot', async () => {
    const first = await page('pageSize=2');
    const pivot = vi.spyOn(harness.app.get(AuditRepository), 'pivot');

    const second = await page(`pageSize=2&${after(first.nextCursor)}`);

    expect(second).not.toHaveProperty('pivot');
    expect(second.items).toHaveLength(2);
    expect(pivot).not.toHaveBeenCalled();
  });

  it('when asked, returns the same pivot as page one (it counted only older rows before M32.3)', async () => {
    const first = await page('pageSize=2');
    const second = await page(`pageSize=2&${after(first.nextCursor)}&pivot=true`);

    expect(second.pivot).toEqual(first.pivot);
    expect(second.pivot).toEqual(FULL);
  });
});

describe('every subsequent page', () => {
  it('pages through all nine exactly once, with the same pivot on every page that asks', async () => {
    const pages = await walk(2, '&pivot=true');

    expect(pages).toHaveLength(5);
    for (const each of pages) expect(each.pivot).toEqual(FULL);

    const ids = pages.flatMap((each) => each.items.map((item) => item.id));
    expect(ids).toHaveLength(SEED.length);
    expect(new Set(ids).size).toBe(SEED.length);

    // Newest first, ties included.
    const instants = pages.flatMap((each) => each.items.map((item) => Date.parse(item.occurredAt)));
    expect([...instants].sort((a, b) => b - a)).toEqual(instants);
    expect(pages.at(-1)?.hasMore).toBe(false);
    expect(pages.at(-1)).not.toHaveProperty('nextCursor');
  });

  it('carries no pivot on any cursor page by default, and the pages are the same rows', async () => {
    const plain = await walk(2);
    const asked = await walk(2, '&pivot=true');

    expect(plain[0]?.pivot).toEqual(FULL);
    for (const each of plain.slice(1)) expect(each).not.toHaveProperty('pivot');
    expect(plain.map((each) => each.items.map((item) => item.id))).toEqual(
      asked.map((each) => each.items.map((item) => item.id)),
    );
  });
});

describe('cursor boundaries', () => {
  it('a page exactly the size of the set has no next page', async () => {
    const only = await page(`pageSize=${String(SEED.length)}`);

    expect(only.items).toHaveLength(SEED.length);
    expect(only.hasMore).toBe(false);
    expect(only).not.toHaveProperty('nextCursor');
    expect(only.pivot).toEqual(FULL);
  });

  it('a cursor past the last row is an empty page, and its pivot is still the set', async () => {
    const all = await page(`pageSize=${String(SEED.length)}`);
    const last = all.items.at(-1);
    expect(last).toBeDefined();
    const beyond = `${new Date(last?.occurredAt ?? 0).toISOString()}|${last?.id ?? ''}`;

    const empty = await page(`pageSize=2&cursor=${encodeURIComponent(beyond)}`);
    expect(empty.items).toEqual([]);
    expect(empty.hasMore).toBe(false);
    expect(empty).not.toHaveProperty('pivot');

    const asked = await page(`pageSize=2&cursor=${encodeURIComponent(beyond)}&pivot=true`);
    expect(asked.pivot).toEqual(FULL);
  });

  it('a boundary inside a tie neither drops nor repeats a row, and does not move the pivot', async () => {
    // minute 1 and minute 3 each hold two events; size 1 puts a boundary
    // between the two halves of each tie.
    const pages = await walk(1, '&pivot=true');

    expect(pages).toHaveLength(SEED.length);
    expect(new Set(pages.flatMap((each) => each.items.map((item) => item.id))).size).toBe(
      SEED.length,
    );
    for (const each of pages) expect(each.pivot).toEqual(FULL);
  });
});

describe('an empty result set', () => {
  it('is an empty page with an empty pivot, not an error', async () => {
    const response = await request(harness.server)
      .get(`${EVENTS}?incidentRef=${EMPTY_INCIDENT}&pageSize=2`)
      .set(as(adminToken));

    expect(response.status).toBe(200);
    const empty = dataOf<Page>(response);
    expect(empty.items).toEqual([]);
    expect(empty.hasMore).toBe(false);
    expect(empty).not.toHaveProperty('nextCursor');
    expect(empty.pivot).toEqual({ byCategory: {}, bySeverity: {} });
  });
});

describe('authorization scopes', () => {
  it('refuses a caller without `logs.view`, on page one and on a cursor page asking for the pivot', async () => {
    const first = await page('pageSize=2');

    expect((await list('pageSize=2', doctorToken)).status).toBe(403);
    expect(
      (await list(`pageSize=2&${after(first.nextCursor)}&pivot=true`, doctorToken)).status,
    ).toBe(403);
  });

  it('gives a `logs.view` override the same pivot as an administrator', async () => {
    // The ledger is platform-wide by design (API §14): the capability is
    // the scope, so two holders of it see the same counts.
    const admin = await page('pageSize=2');
    const auditor = await page('pageSize=2', auditorToken);

    expect(auditor.pivot).toEqual(admin.pivot);
    expect(auditor.items.map((item) => item.id)).toEqual(admin.items.map((item) => item.id));

    const auditorSecond = await page(
      `pageSize=2&${after(auditor.nextCursor)}&pivot=true`,
      auditorToken,
    );
    expect(auditorSecond.pivot).toEqual(FULL);
  });
});

describe('concurrent requests', () => {
  it('pages one to three requested at once agree on the pivot', async () => {
    const pages = await walk(2);
    const cursors = pages.slice(0, 3).map((each) => each.nextCursor);

    const results = await Promise.all(
      Array.from({ length: 4 }, () => [
        page('pageSize=2'),
        page(`pageSize=2&${after(cursors[0])}&pivot=true`),
        page(`pageSize=2&${after(cursors[1])}&pivot=true`),
      ]).flat(),
    );

    for (const each of results) expect(each.pivot).toEqual(FULL);
  });
});

describe('validation', () => {
  it('refuses a `pivot` that is not true or false', async () => {
    const response = await list('pageSize=2&pivot=yes');

    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors?.['pivot']).toBeDefined();
  });
});
