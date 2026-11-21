import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CACHE_BACKEND, type CacheBackend, CacheService, REFERENCE_DATA } from '../src/shared/cache';

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
 * The formulary (RM M13.1 — API §7.1, §7.2).
 *
 * The properties worth a round trip:
 *
 * · **The typeahead finds a drug by either name.** A clinician who knows
 *   "Amoxil" and one who knows "amoxicillin" must both land on the same
 *   row, mid-word and case-insensitively — the property the two
 *   `gin_trgm_ops` indexes exist to make fast.
 * · **The filters compose rather than replace each other.** Two chips
 *   narrow; they do not fight.
 * · **`?controlled=false` means false.** The one query-string coercion
 *   that silently inverts if written with `z.coerce.boolean()`.
 * · **A monograph that does not exist is a 404**, not a 200 carrying
 *   eight nulls that would read as a drug with no contraindications.
 * · **The formulary is not public.** It names the controlled substances
 *   this clinic stocks.
 *
 * ## The p95 measurement, and why it loads a bigger formulary
 *
 * RM M13.1's verify step is "typeahead p95 < 100 ms on seeded data". The
 * seed holds five medications, and a percentile over five rows measures
 * the HTTP stack rather than the query — it would pass with a sequential
 * scan and tell us nothing about the indexes.
 *
 * So the timed case runs twice: once against the seeded formulary
 * exactly as the verify step words it, and once with **500 additional
 * medications loaded**, which is the order of magnitude a real hospital
 * formulary reaches. The second is the measurement that can actually
 * fail. Both must come in under the budget, and the extra rows are
 * deleted afterwards so no other spec sees them.
 *
 * ## This spec runs with no cache in front of the formulary
 *
 * Since RM M31.1 `GET /medications` reads through the reference-data
 * cache: one Redis scope shared by every spec file in the run **and by
 * every earlier run**, for an hour, invalidated only by the seed's bump.
 * This spec writes formulary rows directly — the withdrawn medication,
 * the 500-row bulk load — and nothing bumps after those writes, so with
 * the real cache two things went wrong:
 *
 * · **"hides inactive medications" failed on every second run.** The
 *   first run cached `?q=ZZBulk&includeInactive=true` holding *its*
 *   withdrawn row; the next run inserted a new one, asked the same
 *   question within the hour, and was served the old answer.
 * · **The p95 cases measured Redis, not the indexes.** The warm-up
 *   request filled the entry and the fifty timed requests were hits, so
 *   the measurement "that can actually fail" could not.
 *
 * Bumping the version from here would fix the first and break
 * `reference-cache.e2e-spec.ts`, whose "still served from the cache"
 * steps assume nobody else bumps the shared scope mid-case. So the spec
 * gets a store of its own that holds nothing — every read is a miss and
 * reaches PostgreSQL, which is what a spec about the formulary query
 * means to test. The cache's own behaviour is `reference-cache`'s job.
 */
let harness: AuthHarness;

/** Remembers nothing: every `get` misses and loads from PostgreSQL. */
const EMPTY_STORE: CacheBackend = {
  mget: (keys) => Promise.resolve(keys.map(() => null)),
  write: () => Promise.resolve(),
  bump: () => Promise.resolve(),
};

/** The reference-data `hit` counter — zero for as long as this spec runs. */
function referenceHits(): number {
  return (
    harness.app
      .get(CacheService)
      .metrics()
      .find((row) => row.cache === REFERENCE_DATA.name && row.result === 'hit')?.count ?? 0
  );
}

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const MEDICATIONS = '/api/v1/medications';
const PASSWORD = 'Medora123!';

/** Names the bulk rows so cleanup can delete exactly what it made. */
const BULK_TAG = 'ZZBulk';
const BULK_COUNT = 500;

interface SessionPayload {
  accessToken: string;
}

interface MedicationView {
  id: string;
  name: string;
  genericName: string;
  category: string;
  strengths: string[];
  form: string;
  route: string;
  manufacturer: string;
  isControlled: boolean;
  isHighRisk: boolean;
  interactionNote: string | null;
  allergyClass: string | null;
  frequencies: string[];
  durationsDays: number[];
}

interface MonographView {
  medicationId: string;
  name: string;
  genericName: string;
  indications: string | null;
  contraindications: string | null;
  standardDosing: string | null;
  pregnancyCategory: string | null;
  warnings: string | null;
  sideEffects: string | null;
}

interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

let doctorToken = '';
/** A monograph this spec creates, since the seed populates none. */
let monographMedicationId = '';

async function seedDoctor(local: string): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  return dataOf<SessionPayload>(
    await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;
}

function list(query: string) {
  return request(harness.server)
    .get(`${MEDICATIONS}${query}`)
    .set('Authorization', `Bearer ${doctorToken}`);
}

/** The 95th percentile of `samples`, nearest-rank. */
function p95(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil(0.95 * sorted.length);

  return sorted[Math.max(0, rank - 1)] ?? 0;
}

async function measureTypeahead(term: string, iterations: number): Promise<number[]> {
  const samples: number[] = [];

  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    const response = await list(`?q=${term}`);
    samples.push(performance.now() - started);

    expect(response.status).toBe(200);
  }

  return samples;
}

beforeAll(async () => {
  harness = await createAuthHarness('medications', {
    overrides: [{ token: CACHE_BACKEND, value: EMPTY_STORE }],
  });
  doctorToken = await seedDoctor('formulary');

  // The seed deliberately populates no monographs (ADR-010 group 9 brought
  // the table in for API §7.2; it does not claim every drug has an entry),
  // so this spec creates the one it asserts on and removes it afterwards.
  const amoxil = await harness.prisma.medication.findFirstOrThrow({
    where: { name: 'Amoxil' },
    select: { id: true },
  });
  monographMedicationId = amoxil.id;

  await harness.prisma.medicationMonograph.create({
    data: {
      medicationId: amoxil.id,
      indications: 'Susceptible infections of the respiratory and urinary tracts.',
      contraindications: 'Hypersensitivity to any penicillin.',
      standardDosing: '500 mg every 8 hours for 7 days.',
      pregnancyCategory: 'B',
      warnings: 'Discontinue at the first sign of a hypersensitivity reaction.',
      sideEffects: 'Nausea, diarrhoea, rash.',
    },
  });
}, 60_000);

afterAll(async () => {
  if (harness === undefined) return;

  await harness.prisma.medicationMonograph.deleteMany({
    where: { medicationId: monographMedicationId },
  });
  await harness.prisma.medication.deleteMany({ where: { name: { startsWith: BULK_TAG } } });

  await harness.reset();
  await harness.close();
});

describe('GET /medications (§7.1) — the typeahead', () => {
  it('serves the seeded formulary with its dispensable strengths', async () => {
    const page = dataOf<Page<MedicationView>>(await list(''));

    expect(page.totalItems).toBeGreaterThanOrEqual(5);

    const amoxil = page.items.find((item) => item.name === 'Amoxil');
    expect(amoxil).toBeDefined();
    // DB §F2's rows, in `position` order — not sorted as strings, which
    // would put "1 g" before "500 mg".
    expect(amoxil?.strengths).toEqual(['250 mg', '500 mg']);
    expect(amoxil?.allergyClass).toBe('Penicillin');
    expect(amoxil?.category).toBe('Antibiotics');
    expect(amoxil?.form).toBe('Capsule');
    expect(amoxil?.route).toBe('Oral');
    expect(amoxil?.id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('matches the brand name mid-word and case-insensitively', async () => {
    const page = dataOf<Page<MedicationView>>(await list('?q=moxi'));

    expect(page.items.map((item) => item.name)).toContain('Amoxil');
  });

  it('matches the generic name through the same parameter', async () => {
    // The clinician who knows the molecule, not the box. DB §8: "typeahead
    // searches brand and generic together".
    const page = dataOf<Page<MedicationView>>(await list('?q=amoxicillin'));

    expect(page.items.map((item) => item.name)).toContain('Amoxil');
  });

  it('returns an empty page rather than an error for no match', async () => {
    const page = dataOf<Page<MedicationView>>(await list('?q=notamedicine'));

    expect(page.items).toEqual([]);
    expect(page.totalItems).toBe(0);
    // `Math.ceil(0 / 20)` — zero pages, not one empty one.
    expect(page.totalPages).toBe(0);
  });

  it('narrows by category, form and route', async () => {
    const byCategory = dataOf<Page<MedicationView>>(await list('?category=Anticoagulants'));
    expect(byCategory.items.map((item) => item.genericName)).toEqual(['Warfarin']);

    const byForm = dataOf<Page<MedicationView>>(await list('?form=Capsule'));
    expect(byForm.items.every((item) => item.form === 'Capsule')).toBe(true);

    const byRoute = dataOf<Page<MedicationView>>(await list('?route=Oral'));
    expect(byRoute.items.every((item) => item.route === 'Oral')).toBe(true);
  });

  it('composes filters instead of letting the last one win', async () => {
    const both = dataOf<Page<MedicationView>>(
      await list('?category=Anticoagulants&form=Tablet'),
    );
    expect(both.items.map((item) => item.genericName)).toEqual(['Warfarin']);

    // The same category with a form nothing in it has must be empty, or
    // the two chips are not both being applied.
    const contradictory = dataOf<Page<MedicationView>>(
      await list('?category=Anticoagulants&form=Inhaler'),
    );
    expect(contradictory.items).toEqual([]);
  });

  it('reads `highRisk=true` and `highRisk=false` as opposites', async () => {
    const high = dataOf<Page<MedicationView>>(await list('?highRisk=true'));
    expect(high.items.map((item) => item.genericName)).toEqual(['Warfarin']);
    expect(high.items.every((item) => item.isHighRisk)).toBe(true);

    // The regression this asserts: `z.coerce.boolean()` maps the string
    // "false" to `true`, which would make this request return the
    // high-risk list — the exact opposite of what was asked.
    const low = dataOf<Page<MedicationView>>(await list('?highRisk=false'));
    expect(low.items.every((item) => item.isHighRisk)).toBe(false);
    expect(low.items.map((item) => item.genericName)).not.toContain('Warfarin');
  });

  it('refuses a filter value outside the vocabulary with a 422', async () => {
    const response = await list('?category=Vitamins');

    expect(response.status).toBe(422);
    expect(errorBody(response).code).toBe('validation_failed');
  });

  it('hides inactive medications unless asked for them', async () => {
    const withdrawn = await harness.prisma.medication.create({
      data: {
        name: `${BULK_TAG} Withdrawn`,
        genericName: `${BULK_TAG.toLowerCase()}-withdrawn`,
        category: 'ANALGESICS',
        form: 'TABLET',
        route: 'ORAL',
        manufacturer: 'Test',
        active: false,
      },
      select: { id: true },
    });

    const hidden = dataOf<Page<MedicationView>>(await list(`?q=${BULK_TAG}`));
    expect(hidden.items.map((item) => item.id)).not.toContain(withdrawn.id);

    // Still reachable, because prescriptions written before the
    // withdrawal still point at the row.
    const shown = dataOf<Page<MedicationView>>(
      await list(`?q=${BULK_TAG}&includeInactive=true`),
    );
    expect(shown.items.map((item) => item.id)).toContain(withdrawn.id);

    await harness.prisma.medication.delete({ where: { id: withdrawn.id } });
  });

  it('paginates', async () => {
    const first = dataOf<Page<MedicationView>>(await list('?pageSize=2&page=1'));
    const second = dataOf<Page<MedicationView>>(await list('?pageSize=2&page=2'));

    expect(first.items).toHaveLength(2);
    expect(first.pageSize).toBe(2);
    // A stable order across pages: no row appears twice and none is skipped.
    expect(second.items.map((item) => item.id)).not.toEqual(
      first.items.map((item) => item.id),
    );
  });

  it('refuses an unauthenticated caller', async () => {
    const response = await request(harness.server).get(MEDICATIONS);

    expect(response.status).toBe(401);
  });
});

describe('GET /medications/{id}/monograph (§7.2)', () => {
  it('serves the prescribing reference', async () => {
    const view = dataOf<MonographView>(
      await request(harness.server)
        .get(`${MEDICATIONS}/${monographMedicationId}/monograph`)
        .set('Authorization', `Bearer ${doctorToken}`),
    );

    expect(view.medicationId).toBe(monographMedicationId);
    expect(view.name).toBe('Amoxil');
    expect(view.genericName).toBe('Amoxicillin');
    expect(view.contraindications).toBe('Hypersensitivity to any penicillin.');
    // A single letter, never prose (DB §F8).
    expect(view.pregnancyCategory).toBe('B');
  });

  it('answers 404 for a medication with no monograph', async () => {
    const glucophage = await harness.prisma.medication.findFirstOrThrow({
      where: { name: 'Glucophage' },
      select: { id: true },
    });

    const response = await request(harness.server)
      .get(`${MEDICATIONS}/${glucophage.id}/monograph`)
      .set('Authorization', `Bearer ${doctorToken}`);

    // Not a 200 of eight nulls: that would render as a drug asserted to
    // have no contraindications, which is a claim nobody made.
    expect(response.status).toBe(404);
    expect(errorBody(response).code).toBe('not_found');
  });

  it('answers 404 for an unknown id, and for a malformed one', async () => {
    const unknown = await request(harness.server)
      .get(`${MEDICATIONS}/${randomUUID()}/monograph`)
      .set('Authorization', `Bearer ${doctorToken}`);
    expect(unknown.status).toBe(404);

    // A malformed uuid must not reach Prisma as a query parameter — that
    // is a 500 dressed up as a client error.
    const malformed = await request(harness.server)
      .get(`${MEDICATIONS}/not-a-uuid/monograph`)
      .set('Authorization', `Bearer ${doctorToken}`);
    expect(malformed.status).toBe(404);
  });
});

describe('RM M13.1 verify — typeahead p95 < 100 ms', () => {
  it('holds on the seeded formulary', async () => {
    // Warm the connection pool and the query plan first; the very first
    // request through a fresh pool measures connection setup, which is
    // not what this budget is about.
    await measureTypeahead('amox', 5);

    const samples = await measureTypeahead('amox', 50);
    const measured = p95(samples);

    console.log(`[M13.1] seeded formulary (5 rows): p95 = ${measured.toFixed(1)} ms`);

    // Every timed request reached PostgreSQL; none was a cache hit.
    expect(referenceHits()).toBe(0);
    expect(measured).toBeLessThan(100);
  }, 60_000);

  it('still holds with a 500-medication formulary loaded', async () => {
    await harness.prisma.medication.createMany({
      data: Array.from({ length: BULK_COUNT }, (_, index) => ({
        name: `${BULK_TAG} Brand ${String(index)}`,
        genericName: `${BULK_TAG.toLowerCase()}generic${String(index)}`,
        category: 'ANALGESICS' as const,
        form: 'TABLET' as const,
        route: 'ORAL' as const,
        manufacturer: 'Test Pharma',
      })),
    });

    const total = await harness.prisma.medication.count();
    expect(total).toBeGreaterThanOrEqual(BULK_COUNT);

    await measureTypeahead('amox', 5);
    const samples = await measureTypeahead('amox', 50);
    const measured = p95(samples);

    console.log(
      `[M13.1] ${String(total)}-row formulary: p95 = ${measured.toFixed(1)} ms ` +
        `(max ${Math.max(...samples).toFixed(1)} ms)`,
    );

    expect(referenceHits()).toBe(0);
    expect(measured).toBeLessThan(100);
  }, 120_000);
});
