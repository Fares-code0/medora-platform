/**
 * Building the analytics snapshot (RM M21.1 — API §12.1).
 *
 * ## Only the category's own charts are computed
 *
 * `CATEGORY_VIEW` in `reports/model/types.ts` names, per category, which
 * charts and which KPIs belong to it — "selecting a category focuses the
 * page on ONLY that domain's analytics (no unrelated charts)". That table
 * is transcribed here and drives the work: asking for `laboratory` runs
 * the lab queries and not the heatmap. The unrequested members come back
 * empty rather than absent, because the frontend's `AnalyticsSnapshot`
 * requires all eleven and an absent member would make every consumer
 * test for undefined on a field its own type says exists.
 *
 * ## Revenue keeps M17.2's alternate
 *
 * ADR-037 §3 fixed what `category=revenue` answers while the flag is off,
 * and M21 "extends rather than replaces" — its own exit-gate note. So the
 * revenue branch is untouched here and still served by
 * `AnalyticsService`; this file answers the other eight.
 *
 * ## Deltas need a second window, and `compare` decides whether to pay
 *
 * Every KPI carries `deltaPercent`. Computing it means running the same
 * counts over the previous period, which doubles the query count — so it
 * runs only when `compare=true`, and the delta is 0 otherwise. A server
 * that always paid for it would make the common case twice as slow for a
 * number the page was not showing.
 */

import { Injectable } from '@nestjs/common';

import type { ClinicalEmployment } from '../../../shared/authz';

import type {
  AnalyticsSnapshotView,
  HeatmapView,
  KpiView,
  NamedSeriesView,
  SliceView,
} from '../dto/analytics.dto';
import type { AnalyticsQuery } from '../dto/analytics.schema';
import {
  SnapshotRepository,
  TIME_BLOCKS,
  WEEKDAYS,
  type Demographics,
  type LabelledCount,
  type Window,
} from '../repositories/snapshot.repository';

import { deltaPercent, resolveRange } from './report-range';

/** `CATEGORY_VIEW`, transcribed — charts and KPI ids per category. */
const CATEGORY_VIEW: Record<string, { charts: readonly string[]; kpiIds: readonly string[] }> = {
  overview: {
    charts: ['trend', 'departments', 'labStatus', 'weekday', 'pharmacy', 'age', 'heatmap'],
    kpiIds: ['patients', 'appointments', 'lab-orders', 'prescriptions', 'growth'],
  },
  patients: { charts: ['departments', 'age', 'trend'], kpiIds: ['patients'] },
  appointments: { charts: ['weekday', 'heatmap', 'trend'], kpiIds: ['appointments'] },
  laboratory: { charts: ['labStatus'], kpiIds: ['lab-orders'] },
  records: { charts: ['records'], kpiIds: [] },
  pharmacy: { charts: ['pharmacy'], kpiIds: ['prescriptions'] },
  messages: { charts: ['messages'], kpiIds: [] },
  ai: { charts: ['ai'], kpiIds: [] },
};

/**
 * `overview`'s KPI list also names `revenue`, and it is **not** here.
 *
 * ADR-039 keeps billing deferred and `isBillingEnabled()` returns false,
 * so a revenue KPI would be a chip reading zero on a practice that
 * bills — indistinguishable from a quiet month. The flag on the payload
 * is how a client knows which of the two it is looking at, exactly as
 * ADR-037 §3 reasoned for the revenue category itself.
 */
const EMPTY_SERIES = (name: string, tone: string): NamedSeriesView => ({
  name,
  tone,
  points: [],
});

const EMPTY_HEATMAP: HeatmapView = { rows: [], columns: [], cells: [], max: 0 };

@Injectable()
export class SnapshotService {
  constructor(private readonly snapshots: SnapshotRepository) {}

  async build(
    userId: string,
    doctor: ClinicalEmployment,
    query: AnalyticsQuery,
    now: Date,
  ): Promise<AnalyticsSnapshotView> {
    const custom =
      query.from === undefined || query.to === undefined
        ? undefined
        : { from: new Date(`${query.from}T00:00:00Z`), to: new Date(`${query.to}T00:00:00Z`) };
    const { current, previous } = resolveRange(query.range, now, custom);

    const demographics: Demographics = { gender: query.gender, ageBand: query.ageBand };
    const view = CATEGORY_VIEW[query.category] ?? { charts: [], kpiIds: [] };
    const wants = (chart: string): boolean => view.charts.includes(chart);

    const [
      kpis,
      trend,
      weekday,
      departments,
      labStatus,
      age,
      heatmap,
      pharmacy,
      messages,
      ai,
      records,
    ] = await Promise.all([
      this.kpis(view.kpiIds, doctor, current, previous, demographics, now, query.compare),
      wants('trend') ? this.trend(query.category, doctor, current, demographics, now) : [],
      wants('weekday')
        ? this.snapshots.appointmentsByWeekday(doctor, current, demographics, now)
        : null,
      wants('departments')
        ? this.snapshots.patientsByDepartment(doctor, current, demographics, now)
        : [],
      wants('labStatus') ? this.snapshots.labStatusSplit(doctor, current, demographics, now) : [],
      wants('age') ? this.snapshots.ageDistribution(doctor, current, demographics, now) : [],
      wants('heatmap') ? this.snapshots.activityHeatmap(doctor, current, demographics, now) : null,
      wants('pharmacy') ? this.snapshots.prescriptionsByMedication(doctor, current, 8) : [],
      wants('messages') ? this.snapshots.messagesByWeekday(userId, current) : null,
      wants('ai') ? this.snapshots.aiUsageByMode(userId, current) : [],
      wants('records') ? this.snapshots.recordsByType(doctor, current) : [],
    ]);

    return {
      category: query.category,
      // Present rather than implied, for the reason ADR-037 §3 gives: a
      // client inferring the flag from missing figures would render an
      // empty chart on a deployment whose billing is on but quiet.
      billingEnabled: false,
      range: { from: current.from.toISOString(), to: current.to.toISOString() },
      comparison: query.compare
        ? { from: previous.from.toISOString(), to: previous.to.toISOString() }
        : null,
      kpis,
      trend,
      weekday:
        weekday === null
          ? EMPTY_SERIES('Appointments', 'primary')
          : { name: 'Appointments', tone: 'primary', points: weekdayPoints(weekday) },
      departments: toSlices(departments),
      labStatus: toSlices(labStatus),
      ageDistribution:
        age.length === 0
          ? EMPTY_SERIES('Patients', 'info')
          : { name: 'Patients', tone: 'info', points: [...age] },
      heatmap:
        heatmap === null
          ? EMPTY_HEATMAP
          : {
              rows: [...WEEKDAYS],
              columns: [...TIME_BLOCKS],
              cells: heatmap.cells,
              max: heatmap.max,
            },
      pharmacy:
        pharmacy.length === 0
          ? EMPTY_SERIES('Prescriptions', 'warning')
          : { name: 'Prescriptions', tone: 'warning', points: [...pharmacy] },
      messages:
        messages === null
          ? EMPTY_SERIES('Messages', 'info')
          : { name: 'Messages', tone: 'info', points: weekdayPoints(messages) },
      aiUsage:
        ai.length === 0
          ? EMPTY_SERIES('AI threads', 'accent')
          : { name: 'AI threads', tone: 'accent', points: [...ai] },
      records:
        records.length === 0
          ? EMPTY_SERIES('Records', 'secondary')
          : { name: 'Records', tone: 'secondary', points: [...records] },
    };
  }

  /** The trend series the category asks for, by name. */
  private async trend(
    category: string,
    doctor: ClinicalEmployment,
    window: Window,
    demographics: Demographics,
    now: Date,
  ): Promise<readonly NamedSeriesView[]> {
    if (category === 'patients') {
      return [
        {
          name: 'Patients',
          tone: 'primary',
          points: [...(await this.snapshots.patientTrend(doctor, window, demographics, now))],
        },
      ];
    }

    if (category === 'appointments') {
      return [
        {
          name: 'Appointments',
          tone: 'info',
          points: [...(await this.snapshots.appointmentTrend(doctor, window, demographics, now))],
        },
      ];
    }

    // `overview` takes every series (`trendSeries: null`), minus revenue
    // while billing is off.
    const [patients, appointments] = await Promise.all([
      this.snapshots.patientTrend(doctor, window, demographics, now),
      this.snapshots.appointmentTrend(doctor, window, demographics, now),
    ]);

    return [
      { name: 'Patients', tone: 'primary', points: [...patients] },
      { name: 'Appointments', tone: 'info', points: [...appointments] },
    ];
  }

  private async kpis(
    ids: readonly string[],
    doctor: ClinicalEmployment,
    current: Window,
    previous: Window,
    demographics: Demographics,
    now: Date,
    compare: boolean,
  ): Promise<readonly KpiView[]> {
    if (ids.length === 0) return [];

    const wanted = new Set(ids);
    const out: KpiView[] = [];

    const measure = async (
      id: string,
      label: string,
      tone: string,
      count: (window: Window) => Promise<number>,
    ): Promise<void> => {
      if (!wanted.has(id)) return;

      const value = await count(current);
      const before = compare ? await count(previous) : value;

      out.push({
        id,
        label,
        value,
        format: 'number',
        deltaPercent: compare ? deltaPercent(value, before) : 0,
        tone,
        // The sparkline is the KPI's own short series; it is left empty
        // rather than fabricated from the single figure above, because a
        // flat line drawn from one number would read as "no movement".
        spark: [],
      });
    };

    await measure('patients', 'Patients', 'primary', (window) =>
      this.snapshots.patientCount(doctor, window, demographics, now),
    );
    await measure('appointments', 'Appointments', 'info', (window) =>
      this.snapshots.appointmentCount(doctor, window, demographics, now),
    );
    await measure('lab-orders', 'Lab orders', 'error', (window) =>
      this.snapshots.labOrderCount(doctor, window, demographics, now),
    );
    await measure('prescriptions', 'Prescriptions', 'warning', (window) =>
      this.snapshots.prescriptionCount(doctor, window, demographics, now),
    );

    if (wanted.has('growth')) {
      // Growth is the patient count's own movement, so it is a percent
      // rather than a count — and it needs the comparison window by
      // definition, which is why it reads zero without `compare`.
      const value = await this.snapshots.patientCount(doctor, current, demographics, now);
      const before = compare
        ? await this.snapshots.patientCount(doctor, previous, demographics, now)
        : value;

      out.push({
        id: 'growth',
        label: 'Growth',
        value: deltaPercent(value, before),
        format: 'percent',
        deltaPercent: compare ? deltaPercent(value, before) : 0,
        tone: 'success',
        spark: [],
      });
    }

    return out;
  }
}

function weekdayPoints(counts: readonly number[]): readonly { label: string; value: number }[] {
  return WEEKDAYS.map((label, index) => ({ label, value: counts[index] ?? 0 }));
}

/**
 * Slices carry a tone, and it comes from position in the categorical
 * ramp rather than from the label — a palette keyed by department name
 * would recolour every chart the day a department is renamed.
 */
const RAMP = ['primary', 'info', 'success', 'warning', 'error', 'accent', 'secondary'] as const;

function toSlices(counts: readonly LabelledCount[]): readonly SliceView[] {
  return counts.map((count, index) => ({
    label: count.label,
    value: count.value,
    tone: RAMP[index % RAMP.length] ?? 'primary',
  }));
}
