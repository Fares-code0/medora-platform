/**
 * Admin Overview — pure derivations (ADM-01 · UX §3.1).
 *
 * Every number on the overview that an administrator can act on is computed
 * here from documents ADM-02, ADM-04, ADM-05 and ADM-06B already hold. That
 * is the point: those modules' mutations resolve to a full patched document
 * written straight into the query cache, so completing a verification,
 * cancelling an appointment or resolving a safety flag changes this page
 * with no refetch and no window in which the Home badge and the page it
 * links to disagree.
 *
 * Nothing here reads the clock. `now` is passed in, as it is in
 * `doctors.ts`, `patients.ts` and `oversight.ts`, so the window and
 * threshold rules can be tested at their boundaries.
 */

import type { BadgeVariant } from '@/components/ui';
import { routes } from '@/routes';

import type { AuditEvent, PhiAccessEvent } from '../administration.types';
import { summarize } from '../appointments/oversight';
import type {
  OversightAppointment,
  OversightStatus,
  PlatformDoctor,
} from '../appointments/oversight.types';
import type { SafetyFlag } from '../communications/communications.types';
import {
  ACCOUNT_KIND,
  ACCOUNT_LABEL,
  failedSignInCount,
  hasImpossibleTravel,
  licenceExpiringSoon,
  LICENCE_EXPIRY_DAYS,
  tabCounts,
  VERIFICATION_LABEL,
  VERIFICATION_KIND,
} from '../doctors/doctors';
import type { DoctorRecord } from '../doctors/doctors.types';
import { openWorkCount, STATUS_KIND, STATUS_LABEL } from '../patients/patients';
import type { PatientAccount } from '../patients/patients.types';

import type {
  ActionQueueRow,
  AlertSeverity,
  AppointmentFunnel,
  OverviewKpis,
  SecurityAlert,
  SignupEntry,
} from './overview.types';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export const FAILED_SIGN_IN_THRESHOLD = 5;
export const PHI_BURST_THRESHOLD = 6;
export const ALERT_WINDOW_DAYS = 7;
export const PHI_BURST_WINDOW_HOURS = 24;
/** Open safety flags at or above this count raise a `flagged-communications` alert. */
export const FLAGGED_COMMS_THRESHOLD = 3;
/** Must equal the window `summarize()` uses, or the funnel and its rates disagree. */
export const FUNNEL_WINDOW_DAYS = 7;
export const SIGNUP_FEED_LIMIT = 6;

function within(iso: string, ms: number, now: number): boolean {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return false;
  return at <= now && at >= now - ms;
}

/* ── KPIs ─────────────────────────────────────────────────────── */

export function deriveKpis(
  doctors: readonly DoctorRecord[],
  patients: readonly PatientAccount[],
  appointments: readonly OversightAppointment[],
  roster: readonly PlatformDoctor[],
  now: number,
): OverviewKpis {
  const counts = tabCounts(doctors);
  /*
   * Utilization averages only the doctors who are taking appointments at
   * all. Averaging in a doctor on leave reports a half-idle clinic that is
   * in fact running at capacity.
   */
  const taking = roster.filter((entry) => entry.availability !== 'unavailable');
  const utilization =
    taking.length === 0
      ? 0
      : Math.round(taking.reduce((sum, entry) => sum + (entry.loadPercent ?? 0), 0) / taking.length);

  return {
    verifiedDoctors: doctors.filter((doctor) => doctor.verification === 'verified').length,
    pendingVerifications: counts.pending,
    totalPatients: patients.length,
    activePatients: patients.filter((patient) => patient.status === 'active').length,
    appointmentsToday: summarize(appointments, now).todayTotal,
    utilizationPercent: utilization,
  };
}

/* ── Action queue ─────────────────────────────────────────────── */

/*
 * "Somebody is waiting on this account" is ADM-04's own definition —
 * `openWorkCount`, the number its list column shows and its ordering ranks
 * on. Reused rather than restated: a second predicate here would let this
 * count and the page it links to describe two different sets of accounts,
 * which is the exact failure ADM-04 already fixed once internally.
 */
export function deriveActionQueue(
  doctors: readonly DoctorRecord[],
  patients: readonly PatientAccount[],
  appointments: readonly OversightAppointment[],
  now: number,
  // Trailing and defaulted, not inserted before `now`: every existing call
  // site here and in overview.test.ts passes exactly four arguments, and a
  // required parameter ahead of `now` would break every one of them for a
  // fifth row most callers have nothing to say about.
  flags: readonly SafetyFlag[] = [],
): readonly ActionQueueRow[] {
  return [
    {
      kind: 'verifications',
      label: 'Doctor verifications pending',
      count: tabCounts(doctors).pending,
      to: `${routes.admin.doctors}?tab=pending`,
    },
    {
      kind: 'licence-expiries',
      label: `Licences expiring in < ${String(LICENCE_EXPIRY_DAYS)} days`,
      count: doctors.filter((doctor) => licenceExpiringSoon(doctor, now)).length,
      // A flag, not a horizon: the window is `LICENCE_EXPIRY_DAYS` on both
      // sides, so a number in the URL would promise a control nobody honours.
      to: `${routes.admin.doctors}?expiring=soon`,
    },
    {
      kind: 'patient-flags',
      label: 'Accounts with open issues',
      count: patients.filter((patient) => openWorkCount(patient) > 0).length,
      to: `${routes.admin.patients}?flag=open`,
    },
    {
      kind: 'stuck-appointments',
      label: 'Appointments pending > 24h',
      count: summarize(appointments, now).pendingOverThreshold,
      to: `${routes.admin.appointments}?flag=stuck-pending`,
    },
    {
      kind: 'flagged-communications',
      label: 'Open safety flags in conversations',
      // Conversation-level open work, same rule the Safety Flags queue's own
      // status filter uses — not a second count this row could disagree
      // with.
      count: flags.filter((flag) => flag.status === 'open').length,
      to: `${routes.admin.communications}?tab=flags&status=open`,
    },
  ];
}

/* ── Security alerts ──────────────────────────────────────────── */

function mostRecent(values: readonly string[], fallback: string): string {
  return values.reduce((latest, value) => (value > latest ? value : latest), fallback);
}

/**
 * The namespace a PHI-burst alert's id puts on the actor it is about. Declared
 * once because `alertDestination` reads the name back out of the id to narrow
 * the log to that actor — the string written below and the string parsed there
 * cannot be allowed to drift apart.
 */
const PHI_BURST_ID_PREFIX = 'phi-burst:';

export function deriveSecurityAlerts(
  doctors: readonly DoctorRecord[],
  phiLog: readonly PhiAccessEvent[],
  auditEvents: readonly AuditEvent[],
  now: number,
  // Trailing and defaulted, for the same reason as `deriveActionQueue`'s own
  // `flags` parameter: every existing call site passes four arguments.
  flags: readonly SafetyFlag[] = [],
): readonly SecurityAlert[] {
  const alerts: SecurityAlert[] = [];

  for (const doctor of doctors) {
    const failed = failedSignInCount(doctor, ALERT_WINDOW_DAYS, now);
    if (failed >= FAILED_SIGN_IN_THRESHOLD) {
      alerts.push({
        id: `failed-sign-ins:${doctor.id}`,
        kind: 'failed-sign-ins',
        severity: 'warning',
        summary: `${String(failed)} failed sign-ins for ${doctor.name} in ${String(ALERT_WINDOW_DAYS)} days`,
        at: mostRecent(
          doctor.logins.filter((login) => login.result !== 'success').map((login) => login.at),
          new Date(now).toISOString(),
        ),
        subjectId: doctor.id,
      });
    }
    if (hasImpossibleTravel(doctor)) {
      alerts.push({
        id: `impossible-travel:${doctor.id}`,
        kind: 'impossible-travel',
        severity: 'critical',
        summary: `Geographically impossible sign-in for ${doctor.name}`,
        at: mostRecent(
          doctor.logins.filter((login) => login.impossibleTravel).map((login) => login.at),
          new Date(now).toISOString(),
        ),
        subjectId: doctor.id,
      });
    }
  }

  /*
   * One alert per actor, not one per reveal. Six justified reveals in a
   * morning is a single thing worth asking about; six banner rows is noise
   * that buries the critical alert underneath it.
   */
  const burstWindowMs = PHI_BURST_WINDOW_HOURS * HOUR_MS;
  const byActor = new Map<string, number>();
  for (const event of phiLog) {
    if (!within(event.at, burstWindowMs, now)) continue;
    byActor.set(event.actor, (byActor.get(event.actor) ?? 0) + 1);
  }
  for (const [actor, count] of byActor) {
    if (count < PHI_BURST_THRESHOLD) continue;
    alerts.push({
      id: `${PHI_BURST_ID_PREFIX}${actor}`,
      kind: 'phi-burst',
      severity: 'warning',
      summary: `${actor} revealed ${String(count)} identifiers in ${String(PHI_BURST_WINDOW_HOURS)}h`,
      at: mostRecent(
        phiLog.filter((event) => event.actor === actor).map((event) => event.at),
        new Date(now).toISOString(),
      ),
      subjectId: null,
    });
  }

  const alertWindowMs = ALERT_WINDOW_DAYS * DAY_MS;
  for (const event of auditEvents) {
    if (event.severity !== 'critical') continue;
    if (!within(event.at, alertWindowMs, now)) continue;
    alerts.push({
      id: `critical-audit:${event.id}`,
      kind: 'critical-audit',
      severity: 'critical',
      summary: `${event.action} — ${event.actor} · ${event.target}`,
      at: event.at,
      subjectId: null,
    });
  }

  /*
   * One alert for the whole open queue, not one per flag — the same
   * "one thing worth asking about, not N banner rows" reasoning the PHI-burst
   * rule above uses. `flags` already carries every open/under-review/resolved
   * flag the Safety Flags tab shows; only `open` ones are unactioned work.
   */
  const openFlags = flags.filter((flag) => flag.status === 'open');
  if (openFlags.length >= FLAGGED_COMMS_THRESHOLD) {
    alerts.push({
      id: 'flagged-communications',
      kind: 'flagged-communications',
      severity: 'warning',
      summary: `${String(openFlags.length)} unresolved safety flags across patient conversations`,
      at: mostRecent(
        openFlags.map((flag) => flag.at),
        new Date(now).toISOString(),
      ),
      subjectId: null,
    });
  }

  return [...alerts].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
    return b.at.localeCompare(a.at);
  });
}

/** `/admin/logs` with the filters `filtersFromSearch` seeds the page from. */
function logsFilteredBy(params: Record<string, string>): string {
  // `URLSearchParams` rather than template-literal assembly: an actor is a
  // person's name, and one with a space or an ampersand in it has to survive
  // the trip or the log opens filtered to somebody who does not exist. Empty
  // values are dropped rather than written as `?actor=`, which is a filter
  // the page would have to decide how to ignore.
  const search = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== ''));
  return `${routes.admin.logs}?${search.toString()}`;
}

/**
 * The actor a `phi-burst` alert is about, read back off its own id — the burst
 * rule groups by actor and `subjectId` carries only doctors, so the id is
 * where the name is. An id from anywhere else yields '', which
 * `logsFilteredBy` drops: the log then opens on every reveal rather than on an
 * actor nobody is called.
 */
function phiBurstActor(alertId: string): string {
  return alertId.startsWith(PHI_BURST_ID_PREFIX) ? alertId.slice(PHI_BURST_ID_PREFIX.length) : '';
}

/**
 * Where an alert is investigated — UX §3.1's "Investigate" into §3.7.
 *
 * Now that ADM-07 has landed, three of the five kinds go to the log narrowed
 * to the events that *are* their evidence: the aggregate holds every trail at
 * once, with the IP and actor pivots that turn one alert into a trail. The
 * filter names come from `logs.ts`'s own taxonomy, and `SystemLogsSection`
 * seeds itself from them once on arrival.
 *
 * `failed-sign-ins` is the exception, and only while it names a doctor. The
 * question it raises is whether *this one account* is under attack, and the
 * alert carries a doctor id — while the log keys actors by name, so it cannot
 * be narrowed to a doctor from here. ADM-03's Activity tab lists exactly that
 * doctor's attempts with their IP, device and location, which no filter
 * reachable from this id would reproduce. With no subject there is nothing to
 * scope to, and the log's failed sign-ins are the better answer.
 *
 * `flagged-communications` is the second exception, and not to the log at
 * all: the question it raises is "which conversations need triage", and the
 * Safety Flags queue — not a filtered log slice — is where that work happens,
 * the same reasoning that sends `patient-flags` to the Patients page rather
 * than to `/admin/logs`.
 */
export function alertDestination(alert: SecurityAlert): string {
  switch (alert.kind) {
    case 'failed-sign-ins':
      return alert.subjectId === null
        ? logsFilteredBy({ type: 'login-failed' })
        : `${routes.admin.doctor(alert.subjectId)}?tab=activity`;
    case 'impossible-travel':
      // Filed under Security in the log as its own event, one row per
      // offending sign-in — a finding about a sign-in rather than a badge on
      // it, and the row an investigator pivots off by IP.
      return logsFilteredBy({ type: 'impossible-travel' });
    case 'phi-burst':
      // Scoped to the actor the burst rule grouped on: `type=phi-revealed`
      // alone is every reveal by everybody, which is the corpus this alert
      // was raised *out of* rather than the evidence for it.
      return logsFilteredBy({ type: 'phi-revealed', actor: phiBurstActor(alert.id) });
    case 'critical-audit':
      return logsFilteredBy({ severity: 'critical' });
    case 'flagged-communications':
      // Same destination and same filter the queue row uses (`deriveActionQueue`)
      // — one place either link could disagree, and this is it.
      return `${routes.admin.communications}?tab=flags&status=open`;
  }
}

export const ALERT_SEVERITY_VARIANT: Record<AlertSeverity, BadgeVariant> = {
  warning: 'warning',
  critical: 'error',
};

/* ── Funnel ───────────────────────────────────────────────────── */

/** Statuses that prove an appointment got past confirmation, whatever happened after. */
const CONFIRMED_OR_LATER: readonly OversightStatus[] = [
  'confirmed',
  'rescheduled',
  'completed',
  'no-show',
];

export function deriveFunnel(
  appointments: readonly OversightAppointment[],
  now: number,
): AppointmentFunnel {
  const windowMs = FUNNEL_WINDOW_DAYS * DAY_MS;
  const inWindow = appointments.filter((appointment) =>
    within(appointment.startsAt, windowMs, now),
  );
  const summary = summarize(appointments, now);

  return {
    stages: [
      { label: 'Requested', value: inWindow.length },
      {
        label: 'Confirmed',
        value: inWindow.filter((a) => CONFIRMED_OR_LATER.includes(a.status)).length,
      },
      { label: 'Completed', value: inWindow.filter((a) => a.status === 'completed').length },
    ],
    cancellationRate7d: summary.cancellationRate7d,
    noShowRate7d: summary.noShowRate7d,
    window7dTotal: summary.window7dTotal,
  };
}

/* ── Signups ──────────────────────────────────────────────────── */

/**
 * Takes no clock: a signup feed is a sort, not a window. Every other
 * derivation here takes `now` because it has a rule that depends on one.
 */
export function deriveSignups(
  doctors: readonly DoctorRecord[],
  patients: readonly PatientAccount[],
): readonly SignupEntry[] {
  const fromDoctors: SignupEntry[] = doctors.map((doctor) => ({
    id: doctor.id,
    name: doctor.name,
    role: 'doctor',
    at: doctor.joinedAt,
    /*
     * Label and kind must read the SAME field. They did not: the label fell
     * back to the account when it was not active while the colour always came
     * from verification, so a suspended doctor read "Suspended" in the
     * verification hue.
     */
    ...(doctor.account === 'active'
      ? {
          stateLabel: VERIFICATION_LABEL[doctor.verification],
          stateKind: VERIFICATION_KIND[doctor.verification],
        }
      : {
          stateLabel: ACCOUNT_LABEL[doctor.account],
          stateKind: ACCOUNT_KIND[doctor.account],
        }),
  }));

  const fromPatients: SignupEntry[] = patients.map((patient) => ({
    id: patient.id,
    name: patient.name,
    role: 'patient',
    at: patient.registeredAt,
    stateLabel: STATUS_LABEL[patient.status],
    stateKind: STATUS_KIND[patient.status],
  }));

  return [...fromDoctors, ...fromPatients]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, SIGNUP_FEED_LIMIT);
}

/* ── States ───────────────────────────────────────────────────── */

export function isFreshDeployment(
  doctors: readonly DoctorRecord[],
  patients: readonly PatientAccount[],
): boolean {
  return doctors.length === 0 && patients.length === 0;
}

export function formatCheckedAt(iso: string, now: number): string {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return 'unknown';
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${String(minutes)} min ago`;
  return `${String(Math.round(minutes / 60))} h ago`;
}
