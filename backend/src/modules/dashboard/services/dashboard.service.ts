/**
 * The doctor Overview composite and its widgets (API §16.2, RM M27.1–M27.2).
 *
 * > ✅ Verify (M27.1): shape matches
 * > `features/doctor/dashboard/model/mock-data.ts`; **KPI values are
 * > final, never eventually-consistent**.
 * > ✅ Verify (M27.2): each widget endpoint returns the same slice the
 * > composite carries; one widget failing does not fail the others.
 *
 * ## The shape matches the mock's *data*, not its props
 *
 * `mock-data.ts` carries `icon: LucideIcon`, `tone: StatisticTone`,
 * `href`, and pre-formatted strings like `time: '20 min ago'`. None of
 * those can or should cross the wire: an icon is a React component, a
 * tone is a design-system token, and a relative time computed on the
 * server freezes at whatever it said when the response was built — the
 * widget re-renders on a timer. So every entry carries its **instant**
 * and the client formats it, which is the rule M15.4's action queue
 * already set for `waitingSince` and the reason it refused to send "3
 * days ago".
 *
 * ## The composite is one answer; the widgets are independent endpoints
 *
 * §16.2 asks for both, and they are different guarantees. The composite
 * is all-or-nothing: a caller that asked for one document and got eight
 * of nine fields cannot tell which. Independence is what the *per-widget
 * routes* are for — the shell loads them separately so one slow or
 * failing widget cannot blank the first screen a doctor sees. Each
 * widget route returns exactly the slice the composite carries, computed
 * by the same method, so the two cannot disagree.
 */

import { Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { PatientScopeService, principalOf, type ClinicalEmployment } from '../../../shared/authz';
import { CacheService, DOCTOR_DASHBOARD, paramsKey } from '../../../shared/cache';
import { DashboardRepository, type ActivityRow } from '../repositories/dashboard.repository';
import { ActionQueueService } from './action-queue.service';

/** UX 2.1 Row 3 — "last 14 days". */
const TREND_DAYS = 14;
const ACTIVITY_LIMIT = 8;

export interface DashboardWindow {
  readonly now: Date;
  readonly dayStart: Date;
  readonly dayEnd: Date;
  readonly weekStart: Date;
  readonly previousWeekStart: Date;
  readonly trendFrom: Date;
  readonly monthStart: Date;
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly dashboard: DashboardRepository,
    private readonly actionQueue: ActionQueueService,
    private readonly cache: CacheService,
    /** S4: the dashboard is the doctor's active hospital's (server-derived). */
    private readonly scope: PatientScopeService,
  ) {}

  /**
   * `GET /dashboard/doctor` with stampede protection (RM M31.1, M27.1).
   *
   * The composite is 36 statements (M32.3) and is polled every 10–15 s by
   * every open Overview. Concurrent requests **for the same authorization
   * scope** share one computation; nothing is stored, so a request that
   * arrives after a computation settles computes afresh and sees every
   * write committed before it. A stored copy would need invalidating by
   * appointments, labs, records, prescriptions, messaging and
   * notifications — more writers than could be kept honest.
   *
   * The flight key is the caller's whole authorization scope — user,
   * role and effective capabilities, hashed — so two callers are only
   * ever coalesced when they would have computed the identical answer.
   */
  overview(user: AuthenticatedUser) {
    const scope = paramsKey('scope', {
      user: user.id,
      role: user.role,
      permissions: [...user.permissions].sort(),
    });

    return this.cache.coalesce(DOCTOR_DASHBOARD, scope, () => this.composite(user));
  }

  /** API §16.2 — the whole Overview in one round trip. */
  async composite(user: AuthenticatedUser, now = new Date()) {
    const doctor = await this.scope.clinicalEmployment(principalOf(user));
    const window = windowFor(now);

    if (doctor === null) return this.emptyComposite(user, window);

    // Fired together. They are independent reads of one instant, and
    // running them in series would make the page cost seven round trips
    // for no isolation benefit — the composite fails as a unit either
    // way.
    const [kpis, schedule, trends, satisfaction, recentActivity, actionQueue] = await Promise.all([
      this.kpis(doctor, window),
      this.schedule(doctor, window),
      this.trends(doctor, window),
      this.satisfaction(doctor, window),
      this.recentActivity(doctor, user.id),
      this.actionQueue.forDoctor(user),
    ]);

    return {
      generatedAt: window.now.toISOString(),
      kpis,
      todaySchedule: schedule,
      actionQueue: actionQueue.items,
      trends,
      satisfaction,
      recentActivity,
      quickActions: QUICK_ACTIONS,
    };
  }

  /* ── The widgets (M27.2), each the composite's own slice ───── */

  async kpisFor(user: AuthenticatedUser, now = new Date()) {
    const doctor = await this.scope.clinicalEmployment(principalOf(user));
    const window = windowFor(now);

    return doctor === null ? emptyKpis(window) : this.kpis(doctor, window);
  }

  async scheduleFor(user: AuthenticatedUser, now = new Date()) {
    const doctor = await this.scope.clinicalEmployment(principalOf(user));

    return doctor === null ? [] : this.schedule(doctor, windowFor(now));
  }

  async trendsFor(user: AuthenticatedUser, now = new Date()) {
    const doctor = await this.scope.clinicalEmployment(principalOf(user));
    const window = windowFor(now);

    return doctor === null ? emptyTrends(window) : this.trends(doctor, window);
  }

  async satisfactionFor(user: AuthenticatedUser, now = new Date()) {
    const doctor = await this.scope.clinicalEmployment(principalOf(user));

    return doctor === null ? emptySatisfaction() : this.satisfaction(doctor, windowFor(now));
  }

  async recentActivityFor(user: AuthenticatedUser) {
    const doctor = await this.scope.clinicalEmployment(principalOf(user));

    return doctor === null ? [] : this.recentActivity(doctor, user.id);
  }

  /* ── The slices ────────────────────────────────────────────── */

  private async kpis(doctor: ClinicalEmployment, window: DashboardWindow) {
    const counts = await this.dashboard.kpis(
      doctor,
      window.now,
      window.dayStart,
      window.dayEnd,
      window.weekStart,
      window.previousWeekStart,
    );

    return {
      todayCount: counts.todayCount,
      todayCompleted: counts.todayCompleted,
      // An instant, not "10:30": the client knows the viewer's zone and
      // the server does not.
      nextAt: counts.nextAt?.toISOString() ?? null,
      pendingRequests: counts.pendingRequests,
      totalPatients: counts.totalPatients,
      completedWeek: counts.completedWeek,
      // The delta the mock's KPI card renders, as a number the client
      // gives a direction and a tone to. Signed, so "2 fewer" is not
      // indistinguishable from "2 more".
      completedWeekDelta: counts.completedWeek - counts.completedPreviousWeek,
    };
  }

  private async schedule(doctor: ClinicalEmployment, window: DashboardWindow) {
    const rows = await this.dashboard.schedule(doctor, window.dayStart, window.dayEnd);

    // The next one still ahead of the request's clock — what the mock
    // marks `isNext`. Computed here because it depends on *now*, and a
    // stored flag would be wrong from the moment it was written.
    const nextIndex = rows.findIndex(
      (row) =>
        row.startsAt.getTime() >= window.now.getTime() &&
        row.status !== 'COMPLETED' &&
        row.status !== 'CANCELLED',
    );

    return rows.map((row, index) => ({
      id: row.publicId,
      at: row.startsAt.toISOString(),
      patientName: row.patient.fullName,
      patientAge: ageOn(row.patient.dateOfBirth, window.now),
      visitType: row.visitType.name,
      status: row.status.toLowerCase().replace(/_/g, '-'),
      isNext: index === nextIndex,
    }));
  }

  private async trends(doctor: ClinicalEmployment, window: DashboardWindow) {
    const rows = await this.dashboard.trends(doctor, window.trendFrom, window.dayEnd);
    const byDay = new Map(rows.map((row) => [row.day, row] as const));

    // Every one of the fourteen days, including the empty ones. A series
    // that skipped quiet days would draw a clinic that closes at random.
    return dayKeys(window.trendFrom, TREND_DAYS).map((day) => ({
      day,
      completed: byDay.get(day)?.completed ?? 0,
      cancelled: byDay.get(day)?.cancelled ?? 0,
    }));
  }

  private async satisfaction(doctor: ClinicalEmployment, window: DashboardWindow) {
    const rows = await this.dashboard.satisfaction(doctor, window.monthStart);
    const counts = new Map(rows.map((row) => [row.rating, row.count] as const));
    const total = rows.reduce((sum, row) => sum + row.count, 0);

    return {
      total,
      // Zero rather than null at a zero denominator, and zero rather than
      // NaN: a doctor with no surveys this month has no average, and the
      // honest rendering of that is `total: 0` with the buckets empty —
      // which the client can distinguish, where `NaN` it cannot.
      average:
        total === 0
          ? 0
          : Math.round(
              (rows.reduce((sum, row) => sum + row.rating * row.count, 0) / total) * 10,
            ) / 10,
      // All five buckets, always. A histogram missing "1 star" because
      // nobody gave one reads as a rating scale that starts at 2.
      buckets: [1, 2, 3, 4, 5].map((rating) => ({ rating, count: counts.get(rating) ?? 0 })),
    };
  }

  private async recentActivity(doctor: ClinicalEmployment, userId: string) {
    return (await this.dashboard.recentActivity(doctor, userId, ACTIVITY_LIMIT)).map(toActivity);
  }

  private emptyComposite(user: AuthenticatedUser, window: DashboardWindow) {
    return {
      generatedAt: window.now.toISOString(),
      kpis: emptyKpis(window),
      todaySchedule: [],
      actionQueue: [],
      trends: emptyTrends(window),
      satisfaction: emptySatisfaction(),
      recentActivity: [],
      quickActions: QUICK_ACTIONS,
      // Stated rather than implied: an account with the role and no
      // `doctors` row has an empty Overview because it has no practice,
      // not because the query failed. A client that could not tell the
      // two apart would render "0 patients today" as a fact.
      practice: null,
      viewer: user.publicId,
    };
  }
}

/**
 * The Row-1 shortcuts. Static metadata, and the server's only because
 * §16.2 lists `quickActions meta` in the composite — a client that built
 * them locally would still need the server to say which are available.
 */
const QUICK_ACTIONS = [
  { id: 'new-appointment', label: 'Book appointment', path: '/doctor/appointments' },
  { id: 'new-record', label: 'New record', path: '/doctor/medical-records' },
  { id: 'new-prescription', label: 'New prescription', path: '/doctor/pharmacy/new' },
  { id: 'new-lab-order', label: 'Order labs', path: '/doctor/labs/new' },
] as const;

function emptyKpis(window: DashboardWindow) {
  return {
    todayCount: 0,
    todayCompleted: 0,
    nextAt: null,
    pendingRequests: 0,
    totalPatients: 0,
    completedWeek: 0,
    completedWeekDelta: 0,
    generatedAt: window.now.toISOString(),
  };
}

function emptyTrends(window: DashboardWindow) {
  return dayKeys(window.trendFrom, TREND_DAYS).map((day) => ({ day, completed: 0, cancelled: 0 }));
}

function emptySatisfaction() {
  return {
    total: 0,
    average: 0,
    buckets: [1, 2, 3, 4, 5].map((rating) => ({ rating, count: 0 })),
  };
}

function toActivity(row: ActivityRow) {
  return {
    id: row.id,
    kind: row.kind,
    at: row.at.toISOString(),
    text: `${row.detail} — ${row.patientName}`,
  };
}

/**
 * The instants every figure is measured against, derived once.
 *
 * Derived once per request rather than per query, so the KPI block, the
 * schedule and the trend series describe **one** day. Two calls to
 * `new Date()` either side of midnight would put the schedule on one day
 * and the counts on another.
 *
 * UTC, and that is a limitation worth naming rather than hiding: "today"
 * is the server's day. The clinic's own timezone lives in the
 * `localization` platform-settings slice (M24), and applying it here
 * would mean deciding whether a doctor's dashboard follows the clinic or
 * the viewer — a product question no source answers.
 */
function windowFor(now: Date): DashboardWindow {
  const dayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
  );
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  // The ISO week's Monday. `getUTCDay()` is 0 on Sunday, which is the
  // end of the week rather than its start.
  const weekday = (now.getUTCDay() + 6) % 7;
  const weekStart = new Date(dayStart.getTime() - weekday * 24 * 60 * 60 * 1000);

  return {
    now,
    dayStart,
    dayEnd,
    weekStart,
    previousWeekStart: new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000),
    trendFrom: new Date(dayEnd.getTime() - TREND_DAYS * 24 * 60 * 60 * 1000),
    monthStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
  };
}

function dayKeys(from: Date, days: number): string[] {
  return Array.from({ length: days }, (_, index) =>
    new Date(from.getTime() + index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  );
}

/** Whole years, decremented when the birthday has not come round yet. */
function ageOn(dateOfBirth: Date, now: Date): number {
  let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const month = now.getUTCMonth() - dateOfBirth.getUTCMonth();

  if (month < 0 || (month === 0 && now.getUTCDate() < dateOfBirth.getUTCDate())) age -= 1;

  return age;
}
