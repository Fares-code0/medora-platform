/**
 * Appointment oversight — the pure half (ADM-05 · UX §3.5).
 *
 * Age-in-state, flag derivation, the KPI strip, filtering, the utilization
 * heatmap and the action machine all live here, free of React and of the
 * store, so the rules an administrator acts on can be tested directly rather
 * than inferred from a rendered table. `now` is always a parameter: a clock
 * read inside a predicate is a test you cannot write twice.
 *
 * Persistence lives in `oversight.api.ts`; presentation in the section.
 */

import type { StatusKind } from '@/components/patterns';
import type { BadgeVariant } from '@/components/ui';
import { formatDateWith } from '@/i18n';

import type {
  CancelCategory,
  DateRangeKey,
  OversightAction,
  OversightAppointment,
  OversightFilters,
  OversightFlag,
  OversightStatus,
  OversightSummary,
  PlatformDoctor,
} from './oversight.types';

/* ── Thresholds ───────────────────────────────────────────────── */

/**
 * How long a request may sit Pending before the platform calls it stuck.
 * §3.5 names the KPI "Pending > 24h", so the KPI and the `stuck-pending`
 * flag are the same threshold rather than two numbers that can drift.
 */
export const STUCK_PENDING_HOURS = 24;

/** Reschedules that make a booking worth a second look. */
export const REPEATED_RESCHEDULE_THRESHOLD = 3;

/**
 * A doctor may be nudged about the same request once an hour. Reminders that
 * arrive faster than anyone can act on them stop being reminders.
 */
export const NUDGE_COOLDOWN_MINUTES = 60;

/** Free-text floor for a reassign or cancellation reason. */
export const REASON_MIN_LENGTH = 12;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/* ── Age in state ─────────────────────────────────────────────── */

export function ageInStateMs(appointment: OversightAppointment, now: number): number {
  const since = new Date(appointment.stateSince).getTime();
  if (Number.isNaN(since)) return 0;
  return Math.max(0, now - since);
}

/** `2 d 4 h` · `26 h` · `45 min` — compact enough for a table cell. */
export function formatAge(ms: number): string {
  if (ms < 60_000) return 'just now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    const rest = minutes % 60;
    return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0 ? `${String(days)} d` : `${String(days)} d ${String(restHours)} h`;
}

/**
 * Age-in-state only means something while the appointment can still move.
 * A completed visit has been "in state" since the day it happened, which is
 * noise in a column whose whole job is to surface intervention candidates.
 */
export function isTerminal(status: OversightStatus): boolean {
  return status === 'completed' || status === 'cancelled' || status === 'no-show';
}

/* ── Flags ────────────────────────────────────────────────────── */

export function isStuckPending(appointment: OversightAppointment, now: number): boolean {
  return (
    appointment.status === 'pending' &&
    ageInStateMs(appointment, now) >= STUCK_PENDING_HOURS * HOUR_MS
  );
}

export function flagsFor(
  appointment: OversightAppointment,
  now: number,
): readonly OversightFlag[] {
  const flags: OversightFlag[] = [];
  if (isStuckPending(appointment, now)) flags.push('stuck-pending');
  if (appointment.rescheduleCount >= REPEATED_RESCHEDULE_THRESHOLD) {
    flags.push('repeated-reschedules');
  }
  if (appointment.complaint !== null) flags.push('complaint-attached');
  return flags;
}

/* ── KPI strip ────────────────────────────────────────────────── */

function isSameDay(iso: string, now: number): boolean {
  const date = new Date(iso);
  const today = new Date(now);
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
}

function withinLastDays(iso: string, days: number, now: number): boolean {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return false;
  return at <= now && at >= now - days * DAY_MS;
}

/**
 * The four headline numbers. Rates are shares of the *same* 7-day
 * denominator, so "cancellation 12% · no-show 6%" can be read together; when
 * there is nothing in the window both are 0 and `window7dTotal` says why.
 */
export function summarize(
  appointments: readonly OversightAppointment[],
  now: number,
): OversightSummary {
  const todayTotal = appointments.filter((a) => isSameDay(a.startsAt, now)).length;
  const pendingOverThreshold = appointments.filter((a) => isStuckPending(a, now)).length;

  const window7d = appointments.filter((a) => withinLastDays(a.startsAt, 7, now));
  const total = window7d.length;
  const share = (predicate: (a: OversightAppointment) => boolean): number => {
    if (total === 0) return 0;
    return Math.round((window7d.filter(predicate).length / total) * 1000) / 10;
  };

  return {
    todayTotal,
    pendingOverThreshold,
    cancellationRate7d: share((a) => a.status === 'cancelled'),
    noShowRate7d: share((a) => a.status === 'no-show'),
    window7dTotal: total,
  };
}

/* ── Filtering ────────────────────────────────────────────────── */

export const DATE_RANGE_LABEL: Record<DateRangeKey, string> = {
  today: 'Today',
  '7d': 'Next & last 7 days',
  '30d': 'Next & last 30 days',
  all: 'All dates',
};

/** Ranges are symmetric around now: oversight looks both ways. */
function inRange(iso: string, range: DateRangeKey, now: number): boolean {
  if (range === 'all') return true;
  if (range === 'today') return isSameDay(iso, now);
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return false;
  const span = (range === '7d' ? 7 : 30) * DAY_MS;
  return Math.abs(at - now) <= span;
}

export const EMPTY_FILTERS: OversightFilters = {
  query: '',
  status: 'all',
  doctorId: 'all',
  department: 'all',
  range: '7d',
  flag: 'all',
};

export function matchesFilters(
  appointment: OversightAppointment,
  filters: OversightFilters,
  now: number,
): boolean {
  if (filters.status !== 'all' && appointment.status !== filters.status) return false;
  if (filters.doctorId !== 'all' && appointment.doctorId !== filters.doctorId) return false;
  if (filters.department !== 'all' && appointment.department !== filters.department) return false;
  if (!inRange(appointment.startsAt, filters.range, now)) return false;
  if (filters.flag !== 'all' && !flagsFor(appointment, now).includes(filters.flag)) return false;

  const query = filters.query.trim().toLowerCase();
  if (query.length > 0) {
    // Patient name and MRN are deliberately absent — see OversightFilters.
    const haystack = [
      appointment.reference,
      appointment.doctorName,
      appointment.department,
      appointment.specialty,
      appointment.visitType,
    ]
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  return true;
}

/** Filtered and ordered: soonest first, so the actionable end is on top. */
export function filterAppointments(
  appointments: readonly OversightAppointment[],
  filters: OversightFilters,
  now: number,
): readonly OversightAppointment[] {
  return appointments
    .filter((appointment) => matchesFilters(appointment, filters, now))
    .slice()
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/* ── The action machine ───────────────────────────────────────── */

export interface ActionPermissions {
  readonly canReassign: boolean;
  readonly canCancel: boolean;
}

/**
 * Whether a nudge is worth sending. Only a Pending request can be nudged —
 * that is the only state where a doctor is the thing being waited on — and
 * not again inside the cooldown.
 */
export function canNudge(appointment: OversightAppointment, now: number): boolean {
  if (appointment.status !== 'pending') return false;
  if (appointment.lastNudgedAt === null) return true;
  const last = new Date(appointment.lastNudgedAt).getTime();
  if (Number.isNaN(last)) return true;
  return now - last >= NUDGE_COOLDOWN_MINUTES * 60_000;
}

/**
 * Which of the four row actions are legal, given status, clock and
 * capability. An illegal action never renders as an enabled control
 * (FRONTEND_ARCHITECTURE §9.2) — the menu is generated from this, so an
 * unreachable transition cannot be clicked into existence.
 */
export function availableActions(
  appointment: OversightAppointment,
  permissions: ActionPermissions,
  now: number,
): readonly OversightAction[] {
  const actions: OversightAction[] = ['view'];
  if (isTerminal(appointment.status)) return actions;
  if (canNudge(appointment, now)) actions.push('nudge');
  if (permissions.canReassign) actions.push('reassign');
  if (permissions.canCancel) actions.push('cancel');
  return actions;
}

/**
 * Doctors an appointment may be moved to: same specialty, not the doctor who
 * already holds it, and with capacity. §3.5 requires the picker to show live
 * availability, which means it must also be able to show nobody.
 */
export function eligibleReassignTargets(
  doctors: readonly PlatformDoctor[],
  appointment: OversightAppointment,
): readonly PlatformDoctor[] {
  return doctors.filter(
    (doctor) =>
      doctor.id !== appointment.doctorId &&
      doctor.specialty === appointment.specialty &&
      doctor.availability !== 'unavailable' &&
      // Unknown capacity is offered, not hidden: the server checks it when
      // the move is submitted, and its refusal is shown (FE-10.10).
      (doctor.openSlotsToday === null || doctor.openSlotsToday > 0),
  );
}

export interface ReasonValidation {
  readonly ok: boolean;
  readonly message?: string;
}

export function validateReason(reason: string): ReasonValidation {
  const trimmed = reason.trim();
  if (trimmed.length === 0) return { ok: false, message: 'A written reason is required.' };
  if (trimmed.length < REASON_MIN_LENGTH) {
    return {
      ok: false,
      message: `Give at least ${String(REASON_MIN_LENGTH)} characters — this is read by whoever reviews the intervention.`,
    };
  }
  return { ok: true };
}

/**
 * The nudge body. Templated on purpose: a reminder about a specific request
 * that carries no patient identifier, identical every time so it reads as
 * process rather than as one administrator's opinion.
 */
export function nudgeMessage(appointment: OversightAppointment, now: number): string {
  const age = formatAge(ageInStateMs(appointment, now));
  return (
    `${appointment.reference} (${appointment.visitType}) has been awaiting your response for ${age}. ` +
    `Please confirm, propose another time, or decline so the patient can be rebooked.`
  );
}

/* ── Utilization heatmap ──────────────────────────────────────── */

/** Clinic hours the heatmap covers, 08:00–19:00 inclusive of the last slot. */
export const HEATMAP_HOURS: readonly number[] = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];

export const HEATMAP_WEEKDAYS: readonly string[] = [
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
  'Sun',
];

export interface HeatmapCell {
  readonly weekday: number;
  readonly hour: number;
  readonly count: number;
  /** 0–1, relative to the busiest cell in the same matrix. */
  readonly intensity: number;
}

export interface Heatmap {
  readonly cells: readonly HeatmapCell[];
  readonly peak: number;
  readonly total: number;
}

/**
 * Hour × weekday counts over whatever is currently filtered, normalised
 * against the busiest cell so the matrix reads as *relative* pressure. It
 * counts appointments that occupied the slot — cancellations never took the
 * capacity, so including them would overstate utilization.
 */
export function buildHeatmap(appointments: readonly OversightAppointment[]): Heatmap {
  const counts = new Map<string, number>();
  let total = 0;

  for (const appointment of appointments) {
    if (appointment.status === 'cancelled') continue;
    const date = new Date(appointment.startsAt);
    if (Number.isNaN(date.getTime())) continue;
    const hour = date.getHours();
    if (!HEATMAP_HOURS.includes(hour)) continue;
    // JS weeks start on Sunday; the matrix starts on Monday.
    const weekday = (date.getDay() + 6) % 7;
    const key = `${String(weekday)}:${String(hour)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    total += 1;
  }

  const peak = Math.max(0, ...counts.values());
  const cells: HeatmapCell[] = [];
  for (let weekday = 0; weekday < HEATMAP_WEEKDAYS.length; weekday += 1) {
    for (const hour of HEATMAP_HOURS) {
      const count = counts.get(`${String(weekday)}:${String(hour)}`) ?? 0;
      cells.push({ weekday, hour, count, intensity: peak === 0 ? 0 : count / peak });
    }
  }
  return { cells, peak, total };
}

/** Below this the matrix is noise, and §3.5 says to say so instead. */
export const HEATMAP_MIN_APPOINTMENTS = 4;

/* ── Labels & badge variants ──────────────────────────────────── */

export const STATUS_LABEL: Record<OversightStatus, string> = {
  pending: 'Pending',
  scheduled: 'Scheduled',
  confirmed: 'Confirmed',
  rescheduled: 'Rescheduled',
  completed: 'Completed',
  cancelled: 'Cancelled',
  'no-show': 'No-show',
  'awaiting-patient': 'Awaiting patient',
};

/**
 * The platform status vocabulary, keyed by oversight status (ADR-0001 §12).
 *
 * Two defects closed here. `rescheduled` was `ai` — the provenance violet on
 * an appointment status, which made this the THIRD colour the same status
 * wore (blue in the doctor worklist, amber in the shared map, violet here).
 * It now resolves through `StatusKind` like every other status, so there is
 * one mapping to change rather than three. And `cancelled` / `no-show` were
 * both bare `error`: same hue, same column, no way to tell a clinic decision
 * from a patient who never arrived. `StatusBadge` now separates them by glyph.
 */
export const STATUS_KIND: Record<OversightStatus, StatusKind> = {
  pending: 'pending',
  scheduled: 'scheduled',
  confirmed: 'confirmed',
  rescheduled: 'scheduled',
  completed: 'completed',
  cancelled: 'cancelled',
  'no-show': 'rejected',
  'awaiting-patient': 'awaiting',
};

export const FLAG_LABEL: Record<OversightFlag, string> = {
  'stuck-pending': 'Stuck pending',
  'repeated-reschedules': 'Repeated reschedules',
  'complaint-attached': 'Complaint attached',
};

/*
 * `complaint-attached` was `ai`. A patient complaint is the opposite of
 * machine-generated content, and all three flags render side by side on the
 * same row, so violet read as a third severity tier rather than provenance.
 * Flags are an attribute/severity marker, not a lifecycle status, so they
 * stay on `BadgeVariant` — the complaint is the most serious of the three
 * and takes the alarm hue, with `stuck-pending` demoted to warning.
 */
export const FLAG_VARIANT: Record<OversightFlag, BadgeVariant> = {
  'stuck-pending': 'warning',
  'repeated-reschedules': 'neutral',
  'complaint-attached': 'error',
};

export const DELIVERY_LABEL: Record<string, string> = {
  delivered: 'Delivered',
  sent: 'Sent',
  pending: 'Pending',
  failed: 'Failed',
};

/**
 * Notification delivery is a lifecycle: queued → in flight → landed, or not.
 *
 * `sent` is `active` — in flight, the same reading the lab gives `processing`
 * — and `delivered` is `completed`, whose CheckCheck glyph is the delivery
 * receipt every messaging client already uses. `failed` is `critical` rather
 * than a terminal kind on purpose: a notification that did not arrive is
 * work, not history, and the administrator can resend it.
 */
export const DELIVERY_KIND: Record<string, StatusKind> = {
  delivered: 'completed',
  sent: 'active',
  pending: 'pending',
  failed: 'critical',
};

export const EVENT_LABEL: Record<string, string> = {
  requested: 'Requested',
  confirmed: 'Confirmed',
  rescheduled: 'Rescheduled',
  nudged: 'Doctor nudged',
  reassigned: 'Reassigned',
  cancelled: 'Cancelled',
  'cancelled-administratively': 'Cancelled administratively',
  completed: 'Completed',
  'no-show': 'Marked no-show',
};

export interface CancelCategoryMeta {
  readonly id: CancelCategory;
  readonly label: string;
  readonly description: string;
}

export const CANCEL_CATEGORIES: readonly CancelCategoryMeta[] = [
  {
    id: 'doctor-unavailable',
    label: 'Doctor unavailable',
    description: 'Illness, emergency, or leave with no colleague able to take the slot.',
  },
  {
    id: 'clinic-closure',
    label: 'Clinic closure',
    description: 'Holiday, facility issue, or an unplanned closure of the department.',
  },
  {
    id: 'duplicate-booking',
    label: 'Duplicate booking',
    description: 'The same visit exists twice; the surviving booking stays.',
  },
  {
    id: 'policy-breach',
    label: 'Policy breach',
    description: 'The booking breaks a scheduling or eligibility policy.',
  },
  {
    id: 'patient-safety',
    label: 'Patient safety',
    description: 'Cancelled on clinical or safety grounds, with follow-up arranged.',
  },
];

export function cancelCategoryLabel(id: CancelCategory): string {
  return CANCEL_CATEGORIES.find((entry) => entry.id === id)?.label ?? id;
}

/** `Tue 12 Aug · 14:30` — one cell, both facts. */
export function formatSlot(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const day = formatDateWith(date, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const time = formatDateWith(date, { hour: '2-digit', minute: '2-digit' });
  return `${day} · ${time}`;
}

export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return formatDateWith(date, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
