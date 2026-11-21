import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { LicenseExpiryService, LICENSE_EXPIRING_TOPIC } from '../src/modules/doctors/services/license-expiry.service';
import { type AuthHarness, createAuthHarness } from './support/auth-app';
import { createTestDoctor, destroyTestDoctor, type DoctorRecord } from './support/doctor-fixture';

/**
 * Licence-expiry warnings — RM M30.2.
 *
 * > ✅ Verify: each schedule registered and visible; **license warning
 * > fires in a clock-controlled test**.
 *
 * The clock is the point of this file. `sweep(now)` takes it as an
 * argument — the rule every sweep in this repository already follows —
 * so the bands are asserted by moving the *date* rather than by seeding
 * licences relative to whatever day the suite happens to run on. A test
 * written the other way round passes today and fails on the day someone
 * runs it near a month boundary.
 *
 * ## What is asserted, and why each one is a real failure mode
 *
 * · **A licence is in exactly one band.** Warning twice on one day is
 *   how a recipient learns to ignore the warning.
 * · **The boundaries are closed at the top and open at the bottom**, so
 *   a licence exactly 30 days out is a 30-day warning and not also a
 *   60-day one.
 * · **An expired licence is not warned about.** That is a verification
 *   problem, not a reminder, and a daily "your licence expired 400 days
 *   ago" is noise on a row somebody already has to deal with.
 * · **A second run the same day publishes the same message**, because
 *   the dedupe key names the doctor, the band and the expiry date.
 * ## The fan-out is asserted next door, and deliberately
 *
 * `notifications.event-drain` turns the published event into a feed row,
 * and that assertion lives in `notification-fanout.e2e-spec.ts` with the
 * other eleven topics. It belongs there rather than here for the reason
 * that file's own header gives: `drain()` claims **every** pending event
 * in the table, so a spec that drains has to own its recipient and clean
 * up after itself, and that discipline is already built there. This file
 * asserts what the sweep *publishes*; that file asserts what the drain
 * makes of it.
 */
let harness: AuthHarness;
let sweep: LicenseExpiryService;

/** A fixed instant, so every offset below is arithmetic on a known day. */
const NOW = new Date('2026-09-21T09:15:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

/** `NOW` plus `days`, as the SQL `date` the column holds. */
function expiryIn(days: number): Date {
  const at = new Date(NOW.getTime() + days * DAY_MS);

  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

const TAGS = ['lx20', 'lx30', 'lx45', 'lx60', 'lx61', 'lx90', 'lxpast'] as const;
const doctors = new Map<string, DoctorRecord>();

/** `Map.get` is `T | undefined`; a missing fixture is a bug, not a case. */
function fixture(tag: (typeof TAGS)[number]): DoctorRecord {
  const record = doctors.get(tag);

  if (record === undefined) throw new Error(`Fixture ${tag} was not created`);

  return record;
}

async function eventsFor(doctorId: string) {
  return harness.prisma.db.domainEvent.findMany({
    where: { topic: LICENSE_EXPIRING_TOPIC },
    orderBy: { createdAt: 'asc' },
  }).then((rows) => rows.filter((row) => (row.payload as { doctorId?: string }).doctorId === doctorId));
}

beforeAll(async () => {
  harness = await createAuthHarness('license-m30');
  sweep = harness.app.get(LicenseExpiryService);

  for (const tag of TAGS) {
    doctors.set(tag, await createTestDoctor(harness.prisma, tag));
  }

  const expiries: Readonly<Record<(typeof TAGS)[number], number>> = {
    lx20: 20,
    lx30: 30,
    lx45: 45,
    lx60: 60,
    lx61: 61,
    lx90: 90,
    lxpast: -400,
  };

  for (const tag of TAGS) {
    await harness.prisma.doctor.update({
      where: { id: fixture(tag).id },
      data: { licenseExpiresOn: expiryIn(expiries[tag]) },
    });
  }
}, 60_000);

afterAll(async () => {
  await clearWarnings();
  for (const tag of TAGS) await destroyTestDoctor(harness.prisma, tag);
  await harness.close();
});

/**
 * Clears this topic's events, and only this topic's.
 *
 * Run **after** every test as well as before, and the "after" is the
 * important half: `NotificationDispatchService.drain()` claims *every*
 * pending event in the table, so a warning this file left behind would
 * be turned into notifications — and pending delivery rows — by whichever
 * other spec happens to drain next. That is what a shared outbox means,
 * and cleaning up is this file's side of it.
 */
async function clearWarnings(): Promise<void> {
  await harness.prisma.db.domainEvent.deleteMany({ where: { topic: LICENSE_EXPIRING_TOPIC } });
}

beforeEach(clearWarnings);
afterEach(clearWarnings);

describe('the bands (M30.2)', () => {
  it('warns 30 days out, in the 30-day band only', async () => {
    await sweep.sweep(NOW);

    const events = await eventsFor(fixture('lx20').id);
    expect(events).toHaveLength(1);
    expect((events[0]?.payload as { withinDays: number }).withinDays).toBe(30);
  });

  it('warns 45 days out, in the 60-day band only', async () => {
    await sweep.sweep(NOW);

    const events = await eventsFor(fixture('lx45').id);
    expect(events).toHaveLength(1);
    expect((events[0]?.payload as { withinDays: number }).withinDays).toBe(60);
  });

  it('puts a licence exactly 30 days out in the narrower band, not both', async () => {
    // The boundary rule: the 30-day band is closed at the top, and the
    // 60-day band starts strictly above it.
    await sweep.sweep(NOW);

    const events = await eventsFor(fixture('lx30').id);
    expect(events).toHaveLength(1);
    expect((events[0]?.payload as { withinDays: number }).withinDays).toBe(30);
  });

  it('includes a licence exactly 60 days out and excludes one at 61', async () => {
    await sweep.sweep(NOW);

    expect(await eventsFor(fixture('lx60').id)).toHaveLength(1);
    expect(await eventsFor(fixture('lx61').id)).toHaveLength(0);
    expect(await eventsFor(fixture('lx90').id)).toHaveLength(0);
  });

  it('says nothing about a licence that already expired', async () => {
    await sweep.sweep(NOW);

    expect(await eventsFor(fixture('lxpast').id)).toHaveLength(0);
  });

  it('counts each band in its result', async () => {
    const result = await sweep.sweep(NOW);

    // Other suites' fixtures may hold licences too, so the assertion is
    // that *these* are counted rather than that the totals are exactly
    // four — a spec that asserted the global total would fail whenever
    // another file added a doctor with an expiry date.
    expect(result.warned['30']).toBeGreaterThanOrEqual(2);
    expect(result.warned['60']).toBeGreaterThanOrEqual(2);
    expect(result.total).toBe((result.warned['30'] ?? 0) + (result.warned['60'] ?? 0));
  });

  it('moves a licence between bands as the clock advances', async () => {
    // The same licence, three different days. This is the assertion the
    // clock parameter exists for: nothing about the data changes.
    const lx45 = fixture('lx45').id;

    await sweep.sweep(new Date(NOW.getTime() - 30 * DAY_MS));
    expect(await eventsFor(lx45)).toHaveLength(0);

    await sweep.sweep(NOW);
    expect((await eventsFor(lx45)).map((row) => (row.payload as { withinDays: number }).withinDays)).toEqual([60]);

    await sweep.sweep(new Date(NOW.getTime() + 20 * DAY_MS));
    expect((await eventsFor(lx45)).map((row) => (row.payload as { withinDays: number }).withinDays)).toEqual([60, 30]);
  });
});

describe('re-running the sweep (M30.2)', () => {
  it('writes one warning however many times it runs in a day', async () => {
    // The dedupe key names the doctor, the band and the expiry date, and
    // `PrismaOutbox` inserts with `skipDuplicates` — so the second write
    // is collapsed by the unique index rather than by a read-then-write
    // that two replicas could race through. A manual trigger, a second
    // replica and a retry all resolve to the same single warning.
    await sweep.sweep(NOW);
    await sweep.sweep(NOW);
    await sweep.sweep(new Date(NOW.getTime() + 6 * 60 * 60 * 1000));

    const events = await eventsFor(fixture('lx20').id);
    expect(events).toHaveLength(1);
    expect(events[0]?.dedupeKey).toMatch(/^license-expiry:[0-9a-f-]+:30:\d{4}-\d{2}-\d{2}$/);
  });
});
