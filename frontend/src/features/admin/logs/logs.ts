/**
 * System Logs — pure rules (ADM-07 · UX §3.7).
 *
 * Classification, filtering, pivot and the summary-feed projection. No React,
 * no I/O, no clock: `now` is passed in, the convention every other admin
 * domain module follows, which is what makes the window rules testable at
 * their boundaries.
 */

import type { BadgeVariant } from '@/components/ui';

import type { AuditEvent, PhiAccessEvent } from '../administration.types';
import type {
  ActorRole,
  OversightAppointment,
  OversightEventKind,
} from '../appointments/oversight.types';
// `categoryLabel` here is the content-access category labeller (patient
// complaint / safety flag / legal request / quality audit) — a different
// vocabulary from `phi/phi-access`'s own `categoryLabel` below, so it is
// imported under its own name rather than colliding with it.
import { categoryLabel as contentAccessCategoryLabel } from '../communications/communications';
import type { ContentAccessEntry } from '../communications/communications.types';
import type { DoctorRecord, LoginEvent } from '../doctors/doctors.types';
import type { AccountEventKind, PatientAccount } from '../patients/patients.types';
// Deep path rather than the `phi/` barrel: the barrel re-exports
// `PhiAccessProvider`, which reaches `administration.queries` and from there
// `administration.api` — and `administration.api` imports *this* module for
// the summary-feed projection. `phi-access.ts` itself is pure, so the deep
// import gets the label vocabulary without closing that cycle.
import { categoryLabel } from '../phi/phi-access';

import type {
  LogCategory,
  LogEvent,
  LogEventType,
  LogFilters,
  LogSeverity,
  SortOrder,
} from './logs.types';

export const PAGE_SIZE = 50;
export const RETENTION_DAYS = 365;

export const CATEGORY_LABEL: Record<LogCategory, string> = {
  authentication: 'Authentication',
  security: 'Security',
  'user-action': 'User actions',
  'admin-activity': 'Admin activities',
  system: 'System',
};

/**
 * The single source binding types to categories. Declared once so the
 * event-type filter, the category grouping and the summary-feed projection
 * can never disagree about where an event belongs.
 */
export const TYPE_CATEGORY: Record<LogEventType, LogCategory> = {
  'login-succeeded': 'authentication',
  'login-failed': 'authentication',
  'login-blocked': 'authentication',

  'impossible-travel': 'security',
  'phi-revealed': 'security',
  'account-locked': 'security',
  'failed-attempt-burst': 'security',
  'permission-changed': 'security',
  'communication-content-accessed': 'security',

  'appointment-requested': 'user-action',
  'appointment-confirmed': 'user-action',
  'appointment-rescheduled': 'user-action',
  'appointment-cancelled': 'user-action',
  'appointment-completed': 'user-action',
  'appointment-no-show': 'user-action',
  'booking-made': 'user-action',
  'booking-cancelled': 'user-action',
  'messages-sent': 'user-action',
  'consent-change': 'user-action',

  'verification-decided': 'admin-activity',
  'documents-requested': 'admin-activity',
  'doctor-suspended': 'admin-activity',
  'doctor-reactivated': 'admin-activity',
  'credential-reset': 'admin-activity',
  'account-unlocked': 'admin-activity',
  'account-deactivated': 'admin-activity',
  'account-reactivated': 'admin-activity',
  'access-granted': 'admin-activity',
  'access-revoked': 'admin-activity',
  'appointment-nudged': 'admin-activity',
  'appointment-reassigned': 'admin-activity',
  'settings-changed': 'admin-activity',
  'data-export': 'admin-activity',

  'service-degraded': 'system',
  'integration-failed': 'system',
  'job-completed': 'system',
  other: 'system',
};

/**
 * Every `LogEventType`, written out independently of `TYPE_CATEGORY`.
 *
 * Deliberately not `Object.keys(TYPE_CATEGORY)`: deriving it from the map
 * would make the taxonomy tests self-referential — deleting an entry from
 * the map would delete it from this list in the same stroke, and the
 * "every type has a category" test would iterate over nothing it's missing.
 * Written independently, the two are checked against each other instead of
 * against themselves.
 */
export const ALL_EVENT_TYPES: readonly LogEventType[] = [
  'login-succeeded',
  'login-failed',
  'login-blocked',

  'impossible-travel',
  'phi-revealed',
  'account-locked',
  'failed-attempt-burst',
  'permission-changed',
  'communication-content-accessed',

  'appointment-requested',
  'appointment-confirmed',
  'appointment-rescheduled',
  'appointment-cancelled',
  'appointment-completed',
  'appointment-no-show',
  'booking-made',
  'booking-cancelled',
  'messages-sent',
  'consent-change',

  'verification-decided',
  'documents-requested',
  'doctor-suspended',
  'doctor-reactivated',
  'credential-reset',
  'account-unlocked',
  'account-deactivated',
  'account-reactivated',
  'access-granted',
  'access-revoked',
  'appointment-nudged',
  'appointment-reassigned',
  'settings-changed',
  'data-export',

  'service-degraded',
  'integration-failed',
  'job-completed',
  'other',
];

export const EVENT_TYPE_LABEL: Record<LogEventType, string> = {
  'login-succeeded': 'Sign-in succeeded',
  'login-failed': 'Sign-in failed',
  'login-blocked': 'Sign-in blocked',
  'impossible-travel': 'Impossible travel',
  'phi-revealed': 'Identifier revealed',
  'account-locked': 'Account locked',
  'failed-attempt-burst': 'Failed-attempt burst',
  'permission-changed': 'Permission changed',
  'communication-content-accessed': 'Read message content',
  'appointment-requested': 'Appointment requested',
  'appointment-confirmed': 'Appointment confirmed',
  'appointment-rescheduled': 'Appointment rescheduled',
  'appointment-cancelled': 'Appointment cancelled',
  'appointment-completed': 'Appointment completed',
  'appointment-no-show': 'Appointment no-show',
  'booking-made': 'Booking made',
  'booking-cancelled': 'Booking cancelled',
  'messages-sent': 'Messages sent',
  'consent-change': 'Consent changed',
  'verification-decided': 'Verification decided',
  'documents-requested': 'Documents requested',
  'doctor-suspended': 'Doctor suspended',
  'doctor-reactivated': 'Doctor reactivated',
  'credential-reset': 'Credentials reset',
  'account-unlocked': 'Account unlocked',
  'account-deactivated': 'Account deactivated',
  'account-reactivated': 'Account reactivated',
  'access-granted': 'Access granted',
  'access-revoked': 'Access revoked',
  'appointment-nudged': 'Appointment nudged',
  'appointment-reassigned': 'Appointment reassigned',
  'settings-changed': 'Settings changed',
  'data-export': 'Data exported',
  'service-degraded': 'Service degraded',
  'integration-failed': 'Integration failed',
  'job-completed': 'Job completed',
  other: 'Other',
};

export const SEVERITY_VARIANT: Record<LogSeverity, BadgeVariant> = {
  info: 'info',
  warning: 'warning',
  critical: 'error',
};

export const SEVERITY_LABEL: Record<LogSeverity, string> = {
  info: 'Info',
  warning: 'Warning',
  critical: 'Critical',
};

/**
 * Every `LogSeverity` as a value, for the same reason `ALL_EVENT_TYPES` exists:
 * a union is a compile-time thing, and validating a string that arrived from a
 * URL needs something to compare it *against* at run time. Written out rather
 * than derived from `SEVERITY_LABEL`'s keys, so `logs.test.ts` can check the
 * two against each other instead of against themselves.
 */
export const ALL_SEVERITIES: readonly LogSeverity[] = ['info', 'warning', 'critical'];

/**
 * The role chip beside an actor's name. Lives here beside the other label
 * maps so the table, the drawer and the actor-role filter cannot end up
 * spelling the same four roles differently.
 */
export const ACTOR_ROLE_LABEL: Record<ActorRole, string> = {
  patient: 'Patient',
  doctor: 'Doctor',
  administrator: 'Administrator',
  system: 'System',
};

/* ── Classification from existing trails ──────────────────────── */

const LOGIN_TYPE: Record<LoginEvent['result'], LogEventType> = {
  success: 'login-succeeded',
  failed: 'login-failed',
  blocked: 'login-blocked',
};

const LOGIN_SEVERITY: Record<LoginEvent['result'], LogSeverity> = {
  success: 'info',
  failed: 'warning',
  blocked: 'warning',
};

/**
 * Doctor sign-ins are the only source carrying an IP and a device, which is
 * what gives the IP filter and the pivot something real to work on.
 *
 * An impossible-travel sign-in emits a *second* event rather than relabelling
 * the first: the sign-in happened and is a fact; the impossibility is a
 * finding about it, and §3.7 files findings under Security. Collapsing them
 * would lose one or the other from its own category filter.
 */
export function fromDoctorLogins(doctor: DoctorRecord): readonly LogEvent[] {
  return doctor.logins.flatMap((entry) => {
    const base: LogEvent = {
      id: `login:${doctor.id}:${entry.id}`,
      at: entry.at,
      category: 'authentication',
      type: LOGIN_TYPE[entry.result],
      severity: LOGIN_SEVERITY[entry.result],
      actor: doctor.name,
      actorRole: 'doctor',
      target: doctor.licenseNumber,
      action: EVENT_TYPE_LABEL[LOGIN_TYPE[entry.result]],
      summary: `${EVENT_TYPE_LABEL[LOGIN_TYPE[entry.result]]} from ${entry.location}`,
      ip: entry.ip,
      device: entry.device,
      payload: {
        result: entry.result,
        location: entry.location,
        ip: entry.ip,
        device: entry.device,
      },
    };
    if (!entry.impossibleTravel) return [base];
    return [
      base,
      {
        ...base,
        id: `travel:${doctor.id}:${entry.id}`,
        category: 'security',
        type: 'impossible-travel',
        severity: 'critical',
        action: EVENT_TYPE_LABEL['impossible-travel'],
        summary: `Geographically impossible sign-in from ${entry.location}`,
      },
    ];
  });
}

/**
 * `AdminAuditEntry.action` and `AuditEvent.action` are plain strings, not
 * unions — seventeen values in practice with nothing at the type level saying
 * so. This map is therefore matched on prefix and falls back to `other`; the
 * fallback exists because the type system cannot rule the case out, and
 * `logs.test.ts` asserts it is never actually reached.
 */
const AUDIT_ACTION_TYPES: readonly (readonly [string, LogEventType])[] = [
  ['Application received', 'verification-decided'],
  ['Application rejected', 'verification-decided'],
  ['Verification completed', 'verification-decided'],
  ['Returned to review', 'verification-decided'],
  ['Document approved', 'verification-decided'],
  ['Document rejected', 'verification-decided'],
  ['Documents requested', 'documents-requested'],
  ['Account suspended', 'doctor-suspended'],
  ['Account reactivated', 'doctor-reactivated'],
  ['Access reset sent', 'credential-reset'],
  ['Administrative fields changed', 'settings-changed'],
  ['Updated security policy', 'settings-changed'],
  ['Automatic backup completed', 'job-completed'],
  ['Deactivated user', 'account-deactivated'],
  ['Exported patient summary', 'data-export'],
  ['Failed login attempts', 'failed-attempt-burst'],
  // Not in the brief's list: `administration.api` folds every PHI reveal into
  // the audit feed under this wording, so the same event that `fromPhiAccess`
  // classifies also arrives here as a legacy `AuditEvent`. Without this row
  // it would land in `other` and drop out of the event-type filter.
  ['Revealed patient identifiers', 'phi-revealed'],
];

export function classifyAuditAction(action: string): LogEventType {
  const match = AUDIT_ACTION_TYPES.find(([prefix]) => action.startsWith(prefix));
  return match?.[1] ?? 'other';
}

export function fromDoctorAudit(doctor: DoctorRecord): readonly LogEvent[] {
  return doctor.audit.map((entry) => {
    const type = classifyAuditAction(entry.action);
    return {
      id: `audit:${doctor.id}:${entry.id}`,
      at: entry.at,
      category: TYPE_CATEGORY[type],
      type,
      severity: type === 'doctor-suspended' ? 'warning' : 'info',
      actor: entry.actor,
      actorRole: 'administrator',
      target: doctor.licenseNumber,
      // The source's own wording, preserved — see `LogEvent.action`.
      action: entry.action,
      summary: `${entry.action} — ${entry.detail}`,
      ip: null,
      device: null,
      payload: { action: entry.action, detail: entry.detail, doctorId: doctor.id },
    } satisfies LogEvent;
  });
}

/**
 * Written as an exhaustive `Record` rather than a lookup with a fallback so
 * that adding a kind to `AccountEventKind` is a compile error here. A patient
 * account event that quietly failed to classify would be an account action
 * missing from an investigation, which is the one thing this screen exists
 * to prevent.
 */
const ACCOUNT_EVENT_TYPE: Record<AccountEventKind, LogEventType> = {
  'sign-in': 'login-succeeded',
  'sign-in-failed': 'login-failed',
  'booking-made': 'booking-made',
  'booking-cancelled': 'booking-cancelled',
  'messages-sent': 'messages-sent',
  'consent-change': 'consent-change',
  'credential-reset': 'credential-reset',
  'account-locked': 'account-locked',
  'account-unlocked': 'account-unlocked',
  'account-deactivated': 'account-deactivated',
  'account-reactivated': 'account-reactivated',
  'access-granted': 'access-granted',
  'access-revoked': 'access-revoked',
};

const ACCOUNT_EVENT_SEVERITY: Record<AccountEventKind, LogSeverity> = {
  'sign-in': 'info',
  'sign-in-failed': 'warning',
  'booking-made': 'info',
  'booking-cancelled': 'info',
  'messages-sent': 'info',
  'consent-change': 'info',
  'credential-reset': 'info',
  'account-locked': 'warning',
  'account-unlocked': 'info',
  'account-deactivated': 'warning',
  'account-reactivated': 'info',
  'access-granted': 'info',
  'access-revoked': 'warning',
};

/**
 * Patient account events (ADM-04 §3.4). `target` is the MRN and never
 * `patient.name`: both `target` and `summary` are rendered verbatim in the
 * table and the drawer, with none of the masking the patients grid applies,
 * so the only thing keeping a name out of the log is what goes in here.
 */
export function fromPatientEvents(patient: PatientAccount): readonly LogEvent[] {
  return patient.events.map((event) => {
    const type = ACCOUNT_EVENT_TYPE[event.kind];
    return {
      id: `patient:${patient.id}:${event.id}`,
      at: event.at,
      category: TYPE_CATEGORY[type],
      type,
      severity: ACCOUNT_EVENT_SEVERITY[event.kind],
      // `actor` is optional on the source because the platform causes some of
      // these itself — a lockout after failed sign-ins has nobody behind it.
      actor: event.actor ?? 'System',
      actorRole: event.actor === undefined ? 'system' : 'administrator',
      target: patient.mrn,
      action: EVENT_TYPE_LABEL[type],
      summary: `${EVENT_TYPE_LABEL[type]} — ${event.detail}`,
      // The account timeline records no IP or device. Null rather than a
      // placeholder: an IP filter excludes nulls, so an invented value would
      // make these rows answer for an address they never had.
      ip: null,
      device: null,
      payload: {
        kind: event.kind,
        detail: event.detail,
        patientId: patient.id,
        ...(event.count === undefined ? {} : { count: event.count }),
      },
    } satisfies LogEvent;
  });
}

/**
 * Both cancellation kinds land on `appointment-cancelled`: the log's question
 * is what happened to the appointment, and `actorRole` already says whether
 * an administrator or the patient did it.
 */
const OVERSIGHT_EVENT_TYPE: Record<OversightEventKind, LogEventType> = {
  requested: 'appointment-requested',
  confirmed: 'appointment-confirmed',
  rescheduled: 'appointment-rescheduled',
  nudged: 'appointment-nudged',
  reassigned: 'appointment-reassigned',
  cancelled: 'appointment-cancelled',
  'cancelled-administratively': 'appointment-cancelled',
  completed: 'appointment-completed',
  'no-show': 'appointment-no-show',
};

const OVERSIGHT_EVENT_SEVERITY: Record<OversightEventKind, LogSeverity> = {
  requested: 'info',
  confirmed: 'info',
  rescheduled: 'info',
  nudged: 'info',
  reassigned: 'info',
  cancelled: 'info',
  'cancelled-administratively': 'warning',
  completed: 'info',
  'no-show': 'warning',
};

/**
 * Appointment transitions (ADM-05 §3.5). `actor`/`actorRole` come straight
 * off the event because the oversight trail already records who caused each
 * transition — and already guarantees the actor is never a patient's name.
 */
export function fromAppointmentEvents(appointment: OversightAppointment): readonly LogEvent[] {
  return appointment.events.map((event) => {
    const type = OVERSIGHT_EVENT_TYPE[event.kind];
    return {
      id: `appointment:${appointment.id}:${event.id}`,
      at: event.at,
      category: TYPE_CATEGORY[type],
      type,
      severity: OVERSIGHT_EVENT_SEVERITY[event.kind],
      actor: event.actor,
      actorRole: event.actorRole,
      // The reference is the handle §3.5 exists to let people talk about a
      // case by — never `patientName` or `patientMrn`.
      target: appointment.reference,
      action: EVENT_TYPE_LABEL[type],
      summary: `${EVENT_TYPE_LABEL[type]} — ${event.detail}`,
      ip: null,
      device: null,
      payload: {
        kind: event.kind,
        detail: event.detail,
        appointmentId: appointment.id,
        status: appointment.status,
      },
    } satisfies LogEvent;
  });
}

/**
 * Justified PHI reveals (ADM-10 §1.5.1). One `phi-revealed` event per entry,
 * always `warning`: an unmasking is legitimate but never routine, and the
 * severity filter is how a reviewer finds a week's worth of them.
 *
 * Neither `subjectId` nor `reason` reaches the event. `subjectId` is the
 * identifier the reveal was *about* — putting it in a log that shows
 * `subjectLabel` precisely so nobody has to name the record would undo the
 * masking. `reason` is administrator free text typed at reveal time, so it is
 * the one field on this source that can contain a patient's name.
 */
export function fromPhiAccess(log: readonly PhiAccessEvent[]): readonly LogEvent[] {
  return log.map(
    (event) =>
      ({
        id: `phi:${event.id}`,
        at: event.at,
        category: TYPE_CATEGORY['phi-revealed'],
        type: 'phi-revealed',
        severity: 'warning',
        actor: event.actor,
        actorRole: 'administrator',
        target: event.subjectLabel,
        // Not `EVENT_TYPE_LABEL['phi-revealed']` ('Identifier revealed'). This
        // is exactly the case `LogEvent.action` exists for: the source's own
        // wording, preserved so a projection can't rename a row already on
        // screen. `administration.api.ts:812` (`asAuditEvent`) already writes
        // these rows with `action: 'Revealed patient identifiers'`, and
        // `PhiAccessProvider.test.tsx` finds the row by that exact string —
        // so this literal has to match it verbatim. Kept as a literal rather
        // than a constant shared between the two modules: the only import
        // path that could carry one here is `administration.api.ts` itself,
        // and importing it into `logs.ts` would close the dependency cycle
        // documented on the `phi-access` import above.
        action: 'Revealed patient identifiers',
        summary: `${categoryLabel(event.category)} · ${String(event.durationMinutes)}-minute elevation`,
        ip: null,
        device: null,
        payload: {
          category: event.category,
          durationMinutes: event.durationMinutes,
          subjectLabel: event.subjectLabel,
        },
      }) satisfies LogEvent,
  );
}

/**
 * Gated conversation reads (ADM-06B · UX §3.6). One `communication-content-
 * accessed` event per access-log entry, always `warning`: reading a private
 * thread is the most sensitive action this admin area has, on the same
 * footing as a PHI reveal.
 *
 * `id` is carried through unchanged — not namespaced the way `fromPhiAccess`
 * prefixes `phi:` — because `ContentAccessEntry.id` is already the "ref #"
 * the viewer banner shows an administrator. Keeping the two identical, not
 * merely mappable, is what lets that banner reference be typed straight into
 * the log's own search and land on this row.
 *
 * Neither `reason` nor `conversationId`'s participants reach the summary or
 * payload: `reason` is administrator free text typed at request time, the
 * same field `fromPhiAccess` excludes for the same risk — it is the one
 * field on this source that can contain a patient's name.
 */
export function fromContentAccess(entries: readonly ContentAccessEntry[]): readonly LogEvent[] {
  return entries.map(
    (entry) =>
      ({
        id: entry.id,
        at: entry.openedAt,
        category: TYPE_CATEGORY['communication-content-accessed'],
        type: 'communication-content-accessed',
        severity: 'warning',
        actor: entry.actor,
        actorRole: 'administrator',
        // A record reference — the conversation, never the patient it
        // belongs to. See `LogEvent.target`'s own docstring.
        target: entry.conversationId,
        action: EVENT_TYPE_LABEL['communication-content-accessed'],
        summary:
          entry.outcome === null
            ? `${contentAccessCategoryLabel(entry.category)} — access in progress`
            : `${contentAccessCategoryLabel(entry.category)} — access ${entry.outcome}`,
        ip: null,
        device: null,
        payload: {
          category: entry.category,
          outcome: entry.outcome ?? 'open',
        },
      }) satisfies LogEvent,
  );
}

/**
 * The namespace `fromLegacyAudit` puts on ids so a seeded `AuditEvent` cannot
 * collide with a row from another trail inside the aggregate. `toAuditEvent`
 * takes it back off — see the note there.
 */
const LEGACY_ID_PREFIX = 'legacy:';

/**
 * The seeded platform `AuditEvent`s, widened into log events.
 *
 * `severity` and `action` are carried over exactly as given rather than
 * re-derived: these are the rows ADM-01's home feed and ADM-09's security
 * panel render today, and the summary-feed projection maps `action` straight
 * back onto `AuditEvent.action`. Substituting `EVENT_TYPE_LABEL` here would
 * rename rows that are already on screen, and re-deriving severity would
 * demote a seeded `critical` to whatever its type happens to imply.
 */
export function fromLegacyAudit(events: readonly AuditEvent[]): readonly LogEvent[] {
  return events.map((event) => {
    const type = classifyAuditAction(event.action);
    return {
      id: `${LEGACY_ID_PREFIX}${event.id}`,
      at: event.at,
      category: TYPE_CATEGORY[type],
      type,
      severity: event.severity,
      actor: event.actor,
      // The source has no role field. `System` is the platform's own literal
      // for unattended writes (backups, failed-attempt bursts); everything
      // else on this feed is an administrator acting in the admin panel.
      actorRole: event.actor === 'System' ? 'system' : 'administrator',
      // Already a record reference by contract — see `AuditEvent.target`.
      target: event.target,
      action: event.action,
      summary: `${event.action} — ${event.target}`,
      ip: null,
      device: null,
      payload: { action: event.action, target: event.target },
    } satisfies LogEvent;
  });
}

/* ── Summary-feed projection ──────────────────────────────────── */

/**
 * The event types the `AuditEvent` summary feed surfaces — ADM-01's home
 * widget and ADM-09's audit panel.
 *
 * An explicit allowlist rather than a category filter, because the two do not
 * agree: `admin-activity + security` would drop the seeded backup (a job
 * result, so `system`) and the doctor's patient-summary export (a user
 * action). Both are rows those surfaces render today, and one of them is the
 * event `administration.api.test.ts` watches for a leaked patient name — a
 * test that iterates whatever the projection returns and so would quietly
 * stop covering it.
 *
 * Sign-ins and routine appointment transitions stay out: they are the
 * high-volume sources, and a six-row summary made of them summarises nothing.
 */
export const AUDIT_FEED_TYPES: ReadonlySet<LogEventType> = new Set([
  'verification-decided',
  'documents-requested',
  'doctor-suspended',
  'doctor-reactivated',
  'credential-reset',
  'account-unlocked',
  'account-deactivated',
  'account-reactivated',
  'access-granted',
  'access-revoked',
  'appointment-reassigned',
  'settings-changed',
  'data-export',
  'permission-changed',
  'phi-revealed',
  'failed-attempt-burst',
  'account-locked',
  'impossible-travel',
  'service-degraded',
  'integration-failed',
  'job-completed',
]);

/**
 * Narrows a log event back to the `AuditEvent` summary the feed renders.
 *
 * `action` is carried through rather than replaced by `EVENT_TYPE_LABEL`: it
 * is the source's own wording, and both surfaces already show it (ADM-01's
 * feed test asserts 'Updated security policy' verbatim, and
 * `PhiAccessProvider.test.tsx` finds the reveal row by
 * 'Revealed patient identifiers').
 *
 * The `legacy:` namespace comes back off. It exists only to keep a seeded
 * `AuditEvent` distinct from the other trails *inside* the aggregate; on the
 * way back out, the feed is the store those ids belong to, and renaming
 * `aud-5` to `legacy:aud-5` would change the identity three shipped surfaces
 * already key off — ADM-01's security alerts build `critical-audit:${id}` out
 * of it. Events with no earlier identity (a `phi:…` reveal, a `system:…` row)
 * keep the id the log gave them.
 */
export function toAuditEvent(event: LogEvent): AuditEvent {
  return {
    id: event.id.startsWith(LEGACY_ID_PREFIX) ? event.id.slice(LEGACY_ID_PREFIX.length) : event.id,
    actor: event.actor,
    action: event.action,
    target: event.target,
    at: event.at,
    severity: event.severity,
  };
}

export function projectAuditFeed(events: readonly LogEvent[]): readonly AuditEvent[] {
  return events.filter((event) => AUDIT_FEED_TYPES.has(event.type)).map(toAuditEvent);
}

/* ── Filtering ────────────────────────────────────────────────── */

export const EMPTY_FILTERS: LogFilters = {
  query: '',
  actorRole: 'all',
  actor: 'all',
  type: 'all',
  severity: 'all',
  from: '',
  to: '',
  ip: '',
};

/**
 * The filters a deep link asks for — `?type=`, `?severity=`, `?actor=` — over
 * `EMPTY_FILTERS`. ADM-01's "Investigate" is the producer: an alert links to
 * the log already narrowed to the events that are its evidence, which is what
 * UX §3.1 means by investigating an alert rather than being shown the log.
 *
 * **Seeds, does not own.** The page reads this once, as its initial state, the
 * contract `?doctor=` on appointment oversight and `?tab=` on doctors already
 * set: the toolbar is authoritative the moment an administrator touches it, so
 * a filter that arrived in the URL is clearable like any other.
 *
 * Unknown values are dropped rather than cast. `?type=nonsense` cast into
 * `LogFilters` would match no event and empty the table with nothing on screen
 * explaining why; ignored, the reader lands on the whole log — visibly
 * unfiltered, which is the honest failure. Only the three fields that name a
 * closed set or an exact actor are read; free text and the date bounds are
 * not, because nothing links to them.
 */
export function filtersFromSearch(params: URLSearchParams): LogFilters {
  const type = ALL_EVENT_TYPES.find((candidate) => candidate === params.get('type'));
  const severity = ALL_SEVERITIES.find((candidate) => candidate === params.get('severity'));
  // Compared exactly by `matchesFilters`, so a name that is only whitespace
  // is no more a filter than an absent one.
  const actor = params.get('actor')?.trim();
  return {
    ...EMPTY_FILTERS,
    ...(type === undefined ? {} : { type }),
    ...(severity === undefined ? {} : { severity }),
    ...(actor === undefined || actor === '' ? {} : { actor }),
  };
}

/**
 * `at` is an ISO instant; `from`/`to` are local wall clock, the shape
 * `toDateTimeLocalValue` writes and a `datetime-local` input produces. `Date`
 * resolves each in its own zone, which is exactly what makes them comparable
 * — provided the timestamp column is rendered in the same local clock the
 * bounds were typed in. `formatTimestamp` is what holds up that end.
 */
function withinRange(at: string, from: string, to: string): boolean {
  const t = new Date(at).getTime();
  if (Number.isNaN(t)) return false;
  if (from !== '') {
    const start = new Date(from).getTime();
    if (!Number.isNaN(start) && t < start) return false;
  }
  if (to !== '') {
    const end = new Date(to).getTime();
    if (!Number.isNaN(end) && t > end) return false;
  }
  return true;
}

/*
 * Takes no clock. Every other admin domain module's `matchesFilters` takes
 * `now` because it has a relative window to resolve; this one's date range is
 * two absolute bounds, so there is nothing for a clock to decide.
 */
export function matchesFilters(event: LogEvent, filters: LogFilters): boolean {
  if (filters.actorRole !== 'all' && event.actorRole !== filters.actorRole) return false;
  if (filters.actor !== 'all' && event.actor !== filters.actor) return false;
  if (filters.type !== 'all' && event.type !== filters.type) return false;
  if (filters.severity !== 'all' && event.severity !== filters.severity) return false;
  if (!withinRange(event.at, filters.from, filters.to)) return false;

  /*
   * A null IP is excluded, not matched. Rows from sources that carry no IP
   * — patient account events, appointment transitions — cannot answer "which
   * events came from this address", and treating them as matches would make
   * the filter look more authoritative than the data behind it.
   */
  if (filters.ip.trim() !== '') {
    if (event.ip === null) return false;
    if (!event.ip.includes(filters.ip.trim())) return false;
  }

  const query = filters.query.trim().toLowerCase();
  if (query !== '') {
    const haystack = [event.actor, EVENT_TYPE_LABEL[event.type], event.summary, event.target]
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  return true;
}

export function filterEvents(
  events: readonly LogEvent[],
  filters: LogFilters,
  sort: SortOrder,
): readonly LogEvent[] {
  return events
    .filter((event) => matchesFilters(event, filters))
    .slice()
    .sort((a, b) => (sort === 'newest' ? b.at.localeCompare(a.at) : a.at.localeCompare(b.at)));
}

/** The three fields §3.7 allows pivoting on. */
export type PivotField = 'ip' | 'actor' | 'type';

/**
 * Sets one filter from a value in a row. Replaces rather than accumulates:
 * clicking a second IP means "now show me that one", not "show me neither".
 */
export function pivotOn(filters: LogFilters, field: PivotField, value: string): LogFilters {
  if (field === 'type') return { ...filters, type: value as LogEventType };
  return { ...filters, [field]: value };
}

export function activeFilterCount(filters: LogFilters): number {
  let count = 0;
  if (filters.query.trim() !== '') count += 1;
  if (filters.actorRole !== 'all') count += 1;
  if (filters.actor !== 'all') count += 1;
  if (filters.type !== 'all') count += 1;
  if (filters.severity !== 'all') count += 1;
  if (filters.from !== '') count += 1;
  if (filters.to !== '') count += 1;
  if (filters.ip.trim() !== '') count += 1;
  return count;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * An instant as `YYYY-MM-DDTHH:mm` in the reader's own zone — the value shape
 * a `datetime-local` input holds, and the only shape `LogFilters.from`/`.to`
 * may ever carry.
 *
 * A `datetime-local` input speaks local wall clock and nothing else: the HTML
 * value-sanitisation algorithm blanks anything it cannot read as one (an ISO
 * instant ending in `Z` among them), and `new Date('2026-08-10T03:05')` —
 * which is what `withinRange` parses — resolves in local time. So every
 * producer of a filter bound has to write local wall clock, or the window
 * drifts by the reader's UTC offset with nothing on screen saying so. The
 * saved-view seeds in `logs.api.ts` are the other producer.
 */
export function toDateTimeLocalValue(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  return `${year}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/**
 * Millisecond precision — §3.7 asks for it, and an investigation needs it —
 * in the reader's own zone.
 *
 * Local rather than UTC because the From/To filters are `datetime-local`
 * inputs, which can only speak local wall clock (see `toDateTimeLocalValue`).
 * Rendered in UTC, this column and those two fields were on different clocks:
 * an investigator who read `03:05` off a row and typed it into From got a
 * window shifted by their whole UTC offset, silently excluding hours of
 * events. `oversight.ts` already renders its timestamps locally, so this is
 * also the clock the rest of the admin area speaks.
 *
 * Built on `toDateTimeLocalValue` rather than beside it, so the prefix a
 * reader copies out of this column is by construction the value the filter
 * parses back — the two cannot drift apart again.
 *
 * The unshifted instant stays on the page either way: `LogTable` puts the ISO
 * string in `<time dateTime>`, and the drawer's incident reference quotes it
 * verbatim for anyone matching this event against another system's log.
 */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${toDateTimeLocalValue(date).replace('T', ' ')}:${pad2(date.getSeconds())}.${ms}`;
}
