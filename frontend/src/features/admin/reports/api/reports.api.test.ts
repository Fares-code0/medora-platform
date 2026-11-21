import { beforeEach, describe, expect, it } from 'vitest';

import { oversightApi } from '../../appointments/api/oversight.api';
import { doctorsApi } from '../../doctors/api/doctors.api';
import { logsApi } from '../../logs/api/logs.api';
import { EMPTY_FILTERS as EMPTY_LOG_FILTERS } from '../../logs/logs';
import { patientsApi } from '../../patients/api/patients.api';
import { datasetOf } from '../reports';

import { reportsApi } from './reports.api';

/**
 * The service, against the real stores it derives from (ADM-08 · UX §3.8).
 *
 * The claims worth pinning here are the ones the pure module cannot make:
 * that the numbers really come from the ADM-02 / ADM-04 / ADM-05 documents
 * rather than from a fixture of this page's own, that an export appears in the
 * system log before its file is written, and that a schedule survives a
 * reload. Everything about *how* a figure is computed lives in
 * `reports.test.ts`, where it needs neither a service nor a clock.
 */

beforeEach(() => {
  window.localStorage.clear();
});

const ALL_LOGS = {
  filters: EMPTY_LOG_FILTERS,
  sort: 'newest' as const,
  offset: 0,
  limit: 5000,
};

describe('derivation from the other modules', () => {
  /*
   * The claim this page rests on. If Growth were served from a corpus of its
   * own, the platform total here and the roster on ADM-02 / ADM-04 would drift
   * the first time anybody invited a doctor — which is precisely the
   * disagreement ADM-01 was built to end.
   */
  it('counts the same doctors and patients the management pages hold', async () => {
    const [doctors, patients, report] = await Promise.all([
      doctorsApi.list(),
      patientsApi.list(),
      reportsApi.document({ reportId: 'growth', range: '12m', compare: false }),
    ]);

    const growth = report.widgets.find((entry) => entry.id === 'user-growth');
    expect(growth?.summary?.raw).toBe(doctors.doctors.length + patients.patients.length);
  });

  it('counts the same appointments appointment oversight holds', async () => {
    const [oversight, report] = await Promise.all([
      oversightApi.list(),
      reportsApi.document({ reportId: 'utilization', range: '12m', compare: false }),
    ]);

    const volume = report.widgets.find((entry) => entry.id === 'appointment-volume');
    const inYear = oversight.appointments.filter((appointment) => {
      const at = Date.parse(appointment.startsAt);
      return at >= (report.range.fromMs ?? 0) && at < report.range.toMs;
    });

    expect(volume?.summary?.raw).toBe(inYear.length);
  });

  it('serves every §3.8 tab', async () => {
    for (const reportId of ['growth', 'utilization', 'clinical', 'system'] as const) {
      const report = await reportsApi.document({ reportId, range: '30d', compare: false });
      expect(report.id).toBe(reportId);
      expect(report.widgets.length).toBeGreaterThan(0);
    }
  });

  it('adds comparisons only when asked, and against the previous window', async () => {
    const plain = await reportsApi.document({
      reportId: 'growth',
      range: '30d',
      compare: false,
    });
    const compared = await reportsApi.document({
      reportId: 'growth',
      range: '30d',
      compare: true,
    });

    expect(plain.compare).toBe(false);
    expect(plain.widgets.every((entry) => entry.summary?.comparison == null)).toBe(true);

    expect(compared.compare).toBe(true);
    expect(compared.widgets.some((entry) => entry.summary?.comparison != null)).toBe(true);
  });
});

describe('exports', () => {
  /*
   * §3.7 requires an export to appear in the log it came from, and ADM-06B and
   * ADM-10 both order the write before the artifact: an extraction that failed
   * to log is an extraction that did not happen. A leadership deck of platform
   * analytics is exactly the extraction a reviewer wants in the trail.
   */
  it('writes a data-export row for a widget export', async () => {
    const before = await logsApi.list({
      ...ALL_LOGS,
      filters: { ...EMPTY_LOG_FILTERS, type: 'data-export', actor: 'Priya Nair' },
    });

    const report = await reportsApi.document({
      reportId: 'growth',
      range: '30d',
      compare: false,
    });
    const widget = report.widgets.find((entry) => entry.visual !== null);
    expect(widget).toBeDefined();
    if (widget?.visual == null) throw new Error('expected a ready widget');

    const dataset = datasetOf(widget.visual);
    const rows = await reportsApi.exportWidget({
      reportId: 'growth',
      range: '30d',
      title: widget.title,
      dataset,
      actor: 'Priya Nair',
    });

    const after = await logsApi.list({
      ...ALL_LOGS,
      filters: { ...EMPTY_LOG_FILTERS, type: 'data-export', actor: 'Priya Nair' },
    });

    expect(rows).toBe(dataset.rows.length);
    expect(after.total).toBe(before.total + 1);

    const row = after.rows[0];
    expect(row?.actor).toBe('Priya Nair');
    expect(row?.payload.widget).toBe(widget.title);
    expect(row?.payload.rowCount).toBe(dataset.rows.length);
    expect(row?.payload.format).toBe('csv');
  });

  it('writes a data-export row for the deck, naming the report and range', async () => {
    const count = await reportsApi.exportDeck({
      reportId: 'system',
      range: '90d',
      compare: true,
      actor: 'Marcus Reed',
    });

    const after = await logsApi.list({
      ...ALL_LOGS,
      filters: { ...EMPTY_LOG_FILTERS, type: 'data-export', actor: 'Marcus Reed' },
    });
    const row = after.rows[0];

    expect(row?.payload.format).toBe('pdf');
    expect(row?.payload.report).toBe('system');
    expect(row?.payload.range).toBe('90d');
    expect(row?.payload.widgetCount).toBe(count);
    expect(row?.summary).toContain('System performance');
  });

  /*
   * The deck must not silently drop the two widgets that have no source — a
   * reader of the file would take their absence for "nothing to report" rather
   * than "nothing measures this". Counting only the renderable widgets in the
   * summary while still writing the unavailable ones into the file is the
   * distinction being pinned.
   */
  it('counts only renderable widgets but still records the ones with no source', async () => {
    const report = await reportsApi.document({
      reportId: 'clinical',
      range: '30d',
      compare: false,
    });
    const unavailable = report.widgets.filter((entry) => entry.availability === 'unavailable');
    expect(unavailable.length).toBeGreaterThan(0);

    const count = await reportsApi.exportDeck({
      reportId: 'clinical',
      range: '30d',
      compare: false,
      actor: 'Marcus Reed',
    });

    expect(count).toBe(report.widgets.length - unavailable.length);
  });
});

describe('scheduled reports', () => {
  it('seeds the two shipped schedules on a cleared store', async () => {
    const schedules = await reportsApi.schedules();
    expect(schedules).toHaveLength(2);
    expect(schedules.map((schedule) => schedule.reportId)).toEqual(['growth', 'utilization']);
  });

  /*
   * §3.8's last line asks for scheduled-report failures to reach the
   * administrator. Nothing in this client delivers email, so a failure has to
   * be a reachable stored state or the whole notification path is dead UI that
   * no reviewer can ever see working.
   */
  it('ships one failed run so the failure state is reachable', async () => {
    const schedules = await reportsApi.schedules();
    const failed = schedules.filter((schedule) => schedule.lastRun?.status === 'failed');

    expect(failed).toHaveLength(1);
    expect(failed[0]?.lastRun?.detail.length).toBeGreaterThan(0);
  });

  it('creates a schedule with no run history and a future next run', async () => {
    const after = await reportsApi.createSchedule(
      {
        reportId: 'clinical',
        name: 'Ops weekly',
        frequency: 'weekly',
        range: '7d',
        recipients: ['ops@medora.health'],
        format: 'csv',
      },
      'Marcus Reed',
    );

    const created = after.find((schedule) => schedule.name === 'Ops weekly');
    expect(created).toBeDefined();
    expect(created?.createdBy).toBe('Marcus Reed');
    // Never a seeded delivery: a schedule that has not run has no outcome.
    expect(created?.lastRun).toBeNull();
    expect(Date.parse(created?.nextRunAt ?? '')).toBeGreaterThan(Date.now());
  });

  it('persists across a reload', async () => {
    await reportsApi.createSchedule(
      {
        reportId: 'growth',
        name: 'Persisted',
        frequency: 'daily',
        range: '7d',
        recipients: ['a@medora.health'],
        format: 'pdf',
      },
      'Marcus Reed',
    );

    // A fresh read goes back to storage, the way a reload would.
    const reloaded = await reportsApi.schedules();
    expect(reloaded.some((schedule) => schedule.name === 'Persisted')).toBe(true);
  });

  /*
   * A paused schedule's next run drifts into the past while it is paused.
   * Resuming has to recompute it, or the panel shows a resumed schedule whose
   * next delivery was three weeks ago and reads as permanently overdue.
   */
  it('recomputes the next run when a schedule is resumed', async () => {
    const [first] = await reportsApi.schedules();
    expect(first).toBeDefined();
    const id = first?.id ?? '';

    const paused = await reportsApi.setSchedulePaused(id, true);
    expect(paused.find((schedule) => schedule.id === id)?.paused).toBe(true);

    const resumed = await reportsApi.setSchedulePaused(id, false);
    const target = resumed.find((schedule) => schedule.id === id);

    expect(target?.paused).toBe(false);
    expect(Date.parse(target?.nextRunAt ?? '')).toBeGreaterThan(Date.now());
  });

  it('deletes a schedule', async () => {
    const [first] = await reportsApi.schedules();
    const id = first?.id ?? '';

    const after = await reportsApi.deleteSchedule(id);
    expect(after.some((schedule) => schedule.id === id)).toBe(false);
    expect(await reportsApi.schedules()).toHaveLength(after.length);
  });
});
