import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { administrationApi } from '../../api/administration.api';

import { overviewApi } from './overview.api';

/**
 * The service exists to supply exactly what no store can. The tests hold it
 * to that: three named series an administrator can read together, a service
 * list where every degraded entry explains itself, check times that move with
 * the clock, and an active-user count that moves.
 *
 * The last group covers what this service deliberately does *not* serve —
 * storage and licence, which belong to the one platform-status record.
 */

describe('overviewApi.signals', () => {
  it('returns the three series §3.1 names', async () => {
    const signals = await overviewApi.signals('30d');

    expect(signals.activity.map((series) => series.name)).toEqual([
      'Daily active users',
      'Appointments booked',
      'Messages sent',
    ]);
  });

  it('returns one point per day of the requested range', async () => {
    const month = await overviewApi.signals('30d');
    const week = await overviewApi.signals('7d');

    expect(month.activity[0]?.points).toHaveLength(30);
    expect(week.activity[0]?.points).toHaveLength(7);
  });

  it('keeps every series on the same x-axis', async () => {
    const signals = await overviewApi.signals('30d');
    const labels = signals.activity.map((series) => series.points.map((point) => point.label));

    expect(labels[1]).toEqual(labels[0]);
    expect(labels[2]).toEqual(labels[0]);
  });

  it('explains every service that is not operational', async () => {
    const signals = await overviewApi.signals('30d');

    for (const service of signals.services) {
      if (service.status === 'operational') continue;
      expect(service.incidentNote).not.toBeNull();
    }
  });

  it('stamps the check times from the clock at call time, not at module import', async () => {
    // A list built once at import pins every check to the moment the bundle
    // loaded: System Health then drifts to "3 h ago" in a long-open session
    // and neither the poll nor Retry can freshen it, which reads as a health
    // check that stopped running.
    const clock = vi.spyOn(Date, 'now');
    const start = Date.parse('2026-08-12T09:00:00.000Z');

    clock.mockReturnValue(start);
    const first = await overviewApi.signals('30d');
    clock.mockReturnValue(start + 3 * 60 * 60 * 1000);
    const second = await overviewApi.signals('30d');

    const checkedAt = (signals: Awaited<ReturnType<typeof overviewApi.signals>>) =>
      signals.services.map((service) => Date.parse(service.lastCheckedAt));

    // Not merely "different": every check must be recent *against the clock
    // the page reads it with*, which is the property the drift breaks.
    for (const at of checkedAt(first)) {
      expect(start - at).toBeLessThanOrEqual(5 * 60_000);
    }
    for (const at of checkedAt(second)) {
      expect(start + 3 * 60 * 60 * 1000 - at).toBeLessThanOrEqual(5 * 60_000);
    }
    expect(checkedAt(second)).not.toEqual(checkedAt(first));
  });
});

/**
 * Storage and licence are not this service's to serve. They live on the one
 * `PlatformStatus` record, which Settings → About renders and the Storage &
 * usage card now reads directly — so the two screens cannot quote different
 * seat counts.
 */
describe('the platform-status record behind Storage & usage', () => {
  it('reports storage and seats inside their own capacity', async () => {
    const { system, license } = await administrationApi.getPlatformStatus();

    expect(system.storageUsedGb).toBeLessThanOrEqual(system.storageTotalGb);
    expect(license.seatsUsed).toBeLessThanOrEqual(license.seatsTotal);
  });

  it('is the only licence record in src/', () => {
    // The regression guard. ADM-01 shipped a second seed here for one review
    // round, and Home said "38 of 50 seats" while Settings → About said "5 of
    // 25" — a disagreement no test caught, because each screen was internally
    // consistent. A second seat literal anywhere in src/ fails this.
    // Vitest's root is `frontend/`, and a wrong root throws here rather than
    // scanning nothing and passing.
    const src = join(process.cwd(), 'src');
    const declarations = sourceFiles(src).filter((file) =>
      /seats(Used|Total):\s*\d/.test(readFileSync(file, 'utf8')),
    );

    expect(declarations.map((file) => relative(src, file).replace(/\\/g, '/'))).toEqual([
      // Moved by D-27b; `features/admin/api/administration.api.ts` re-exports
      // it. The guard is "exactly one declaration", not "in this directory".
      'features/shared-domain/clinic-operations/store.ts',
    ]);
  });
});

/** Every non-test TypeScript source under `dir`, deepest last, sorted. */
function sourceFiles(dir: string): readonly string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [path];
  });
}

describe('overviewApi.activeUsers', () => {
  it('returns a non-negative count', async () => {
    expect(await overviewApi.activeUsers()).toBeGreaterThanOrEqual(0);
  });

  it('moves between polls, so the KPI is worth polling', async () => {
    const samples = await Promise.all([
      overviewApi.activeUsers(),
      overviewApi.activeUsers(),
      overviewApi.activeUsers(),
      overviewApi.activeUsers(),
      overviewApi.activeUsers(),
      overviewApi.activeUsers(),
    ]);

    expect(new Set(samples).size).toBeGreaterThan(1);
  });
});
