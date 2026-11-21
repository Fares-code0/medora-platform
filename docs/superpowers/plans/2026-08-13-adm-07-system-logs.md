# ADM-07 System Logs Implementation Plan

> **Historical implementation plan — not a task register** (labelled 2026-10-26). The work this plan describes has landed. Its checkboxes are the plan's steps as written and were never ticked, so they record nothing about what is done or open. Current status of ADM-07: [`frontend/FRONTEND_CHECKLIST.md`](../../../frontend/FRONTEND_CHECKLIST.md) §13.4.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build UX §3.7's System Logs — a paginated investigation table over one aggregated event stream, with structured filters, pivot, saved views, a detail drawer, and CSV/JSON export that logs itself — mounted at `/admin/logs`.

**Architecture:** A new module `frontend/src/features/admin/logs/` in the Phase C shape: a pure rules file (taxonomy, classification, filtering, projection), a mock service that aggregates the trails ADM-02/04/05/10 already keep, query hooks, and one component per region of the page. The log becomes the source of truth and `getAuditEvents()` becomes a filtered projection of it, so ADM-01 and ADM-09 keep working through one store.

**Tech Stack:** React 19 · TypeScript (strict) · TanStack Query v5 · React Router v7 · Tailwind (design-system tokens only) · Vitest + Testing Library.

**Spec of record:** [`docs/superpowers/specs/2026-08-13-adm-07-system-logs-design.md`](../specs/2026-08-13-adm-07-system-logs-design.md)

## Global Constraints

Every task's requirements implicitly include this section.

- **Working directory is `frontend/`.** Every path is relative to the repository root; every command runs from `frontend/`.
- **`backend/` is off-limits.** Frontend-only work.
- **TypeScript strict.** No `any`, no non-null assertions. Domain types `readonly` on every field, `readonly T[]` for arrays.
- **Pure rules take `now: number`.** Nothing in `logs.ts` may call `Date.now()`. This is the house convention in `doctors.ts`, `patients.ts`, `oversight.ts` and `overview.ts`.
- **Deep-import across admin modules — there are no barrels** except `phi/`, which has a real `index.ts`. Import from exact files: `'../doctors/doctors.api'`, `'../patients/patients.types'`, `'../appointments/oversight.types'`. Platform barrels (`@/components/ui`, `@/components/feedback`, `@/utils/export`) are the established convention.
- **No import cycles.** The dependency direction is fixed: `administration.api.ts` → `logs.ts` (pure) and `logs.api.ts` → `administration.api.ts`. `logs.ts` must import only *types* from `administration.types.ts` and nothing from `administration.api.ts`. ADM-01 had to break a cycle mid-implementation; do not create one here.
- **No string-literal routes.** Every href from `routes` in `src/routes/index.ts`.
- **Design tokens only.** Verify any Tailwind class you add actually compiles — `styles/theme-utilities.test.ts` will fail the build if it names a token the config lacks. Three classes have already been caught this way on this project.
- **Timestamps and counts are `tabular-nums`.** Log timestamps are additionally mono.
- **No PHI.** The log's `summary` and `target` fields name records, never patients. `AuditEvent.target`'s docstring states this contract and `administration.api.test.ts` enforces it over the whole corpus.
- **Comments explain *why*.** A file-header block naming the module's responsibility and its UX section, then comments only where a reader would ask "why is it done this way".
- **Quality gates before every commit**, from `frontend/`:
  ```bash
  npm run typecheck && npm run lint && npm run test
  ```
- **Test standard.** Every guarantee a test claims must actually be defended: after writing tests, mutate the implementation and confirm the intended test fails. Four tests on the preceding ADM-01 branch were sent back for passing against a broken implementation.
- **Commit after every task.** Conventional-commit subject, `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` last.

### Fixed values

| Constant | Value | Meaning |
| --- | --- | --- |
| `PAGE_SIZE` | `50` | Rows per page |
| `RETENTION_DAYS` | `365` | Shown in the page caption (§3.7) |
| `SAVED_VIEWS_KEY` | `'medora.admin.logs.views.v1'` | localStorage key |
| `SEED_SPAN_DAYS` | `120` | How far back the seeded System corpus reaches |

---

## File Structure

**Created**

| File | Responsibility |
| --- | --- |
| `frontend/src/features/admin/logs/logs.types.ts` | `LogEvent`, `LogCategory`, `LogEventType`, `LogSeverity`, `LogFilters`, `LogPage`, `SavedView` |
| `frontend/src/features/admin/logs/logs.ts` | Taxonomy map, classification, filtering, pivot, projection, formatters — pure |
| `frontend/src/features/admin/logs/logs.test.ts` | Tests for the above |
| `frontend/src/features/admin/logs/logs.api.ts` | Aggregation, paginated `list`, saved views, export logging |
| `frontend/src/features/admin/logs/logs.api.test.ts` | Tests for the service |
| `frontend/src/features/admin/logs/logs.queries.ts` | `useLogPage`, `useSavedViews`, mutations |
| `frontend/src/features/admin/logs/SystemLogsSection.tsx` | The page |
| `frontend/src/features/admin/logs/SystemLogsSection.test.tsx` | Page tests |
| `frontend/src/features/admin/logs/LogFiltersBar.tsx` | Search + six structured filters + saved views |
| `frontend/src/features/admin/logs/LogTable.tsx` | The investigation table with pivot affordances |
| `frontend/src/features/admin/logs/LogDetailDrawer.tsx` | P3 drawer |
| `frontend/src/features/admin/logs/SavedViewsMenu.tsx` | Apply / create / delete |

**Modified**

| File | Change |
| --- | --- |
| `frontend/src/utils/export.ts` | Add `exportJson` |
| `frontend/src/features/admin/administration.api.ts` | `getAuditEvents()` becomes a projection of the log |
| `frontend/src/routes/index.ts` | `AdminSectionSlug` gains `'logs'` |
| `frontend/src/features/admin/administration.meta.ts` | `SECTION_META.logs` |
| `frontend/src/layouts/navigation.ts` | Sidebar entry under Governance |
| `frontend/src/features/admin/routes.tsx` | Mount `/admin/logs` |
| `frontend/FRONTEND_CHECKLIST.md` | ADM-07 row, §4 intro, roadmap item 12 |

---

### Task 1: Taxonomy and types

The five-category taxonomy, the event-type union, and the single map binding them. Everything later selects on these.

**Files:**
- Create: `frontend/src/features/admin/logs/logs.types.ts`
- Create: `frontend/src/features/admin/logs/logs.ts`
- Test: `frontend/src/features/admin/logs/logs.test.ts`

**Interfaces:**
- Consumes: `ActorRole` from `'../appointments/oversight.types'`.
- Produces: `LogEvent`, `LogCategory`, `LogEventType`, `LogSeverity`, `LogFilters`, `LogPage`, `SavedView`, `TYPE_CATEGORY`, `EVENT_TYPE_LABEL`, `CATEGORY_LABEL`, `SEVERITY_VARIANT`, `ALL_EVENT_TYPES`, `RETENTION_DAYS`, `PAGE_SIZE`.

- [ ] **Step 1: Write `logs.types.ts`**

```ts
/**
 * System Logs — domain types (ADM-07 · UX §3.7).
 *
 * `LogEvent` is the platform's investigation record: richer than the
 * `AuditEvent` summary the admin home feed renders, and the source that
 * summary is now projected from. One record shape for all five §3.7
 * categories, because an investigator filters across them in one table.
 */

import type { ActorRole } from '../appointments/oversight.types';

export type LogSeverity = 'info' | 'warning' | 'critical';

/** §3.7's five taxonomy groups. */
export type LogCategory =
  | 'authentication'
  | 'security'
  | 'user-action'
  | 'admin-activity'
  | 'system';

/**
 * The specific event within a category. Every member maps to exactly one
 * `LogCategory` through `TYPE_CATEGORY`; `other` exists only because two
 * sources (`AdminAuditEntry.action`, `AuditEvent.action`) are plain strings
 * rather than unions, so classification cannot be total by construction. A
 * test asserts `other` is never actually reached.
 */
export type LogEventType =
  // authentication
  | 'login-succeeded'
  | 'login-failed'
  | 'login-blocked'
  // security
  | 'impossible-travel'
  | 'phi-revealed'
  | 'account-locked'
  | 'failed-attempt-burst'
  | 'permission-changed'
  // user-action
  | 'appointment-requested'
  | 'appointment-confirmed'
  | 'appointment-rescheduled'
  | 'appointment-cancelled'
  | 'appointment-completed'
  | 'appointment-no-show'
  | 'booking-made'
  | 'booking-cancelled'
  | 'messages-sent'
  | 'consent-change'
  // admin-activity
  | 'verification-decided'
  | 'documents-requested'
  | 'doctor-suspended'
  | 'doctor-reactivated'
  | 'credential-reset'
  | 'account-unlocked'
  | 'account-deactivated'
  | 'account-reactivated'
  | 'access-granted'
  | 'access-revoked'
  | 'appointment-nudged'
  | 'appointment-reassigned'
  | 'settings-changed'
  | 'data-export'
  // system
  | 'service-degraded'
  | 'integration-failed'
  | 'job-completed'
  | 'other';

/**
 * One investigable event. `ip` and `device` are nullable because not every
 * source carries them — doctor sign-ins do, patient account events and
 * appointment transitions do not. See `matchesFilters`: a null IP is
 * *excluded* by an IP filter rather than treated as a match.
 */
export interface LogEvent {
  readonly id: string;
  /** ISO 8601 with milliseconds. */
  readonly at: string;
  readonly category: LogCategory;
  readonly type: LogEventType;
  readonly severity: LogSeverity;
  readonly actor: string;
  readonly actorRole: ActorRole;
  /** A record reference — never a patient's name. */
  readonly target: string;
  /**
   * The human-readable action label. For events derived from a source that
   * already had one — `AdminAuditEntry.action`, `AuditEvent.action` — this is
   * that original string, preserved verbatim. Everything else uses
   * `EVENT_TYPE_LABEL[type]`.
   *
   * It exists because the summary-feed projection maps it straight onto
   * `AuditEvent.action`, and ADM-01's feed test asserts on the exact wording
   * of a seeded event. Substituting a generic type label there would rename
   * rows that are already on screen.
   */
  readonly action: string;
  readonly summary: string;
  readonly ip: string | null;
  readonly device: string | null;
  /** Rendered in the drawer's key-value grid and its raw-JSON toggle. */
  readonly payload: Readonly<Record<string, string | number | boolean>>;
}

export type SortOrder = 'newest' | 'oldest';

export interface LogFilters {
  /** Matches actor, event-type label and summary — never a patient name. */
  readonly query: string;
  readonly actorRole: ActorRole | 'all';
  readonly actor: string;
  readonly type: LogEventType | 'all';
  readonly severity: LogSeverity | 'all';
  /** ISO datetime-local strings, or '' for open-ended. */
  readonly from: string;
  readonly to: string;
  readonly ip: string;
}

/** One page of the log. `total` is the post-filter count, never `rows.length`. */
export interface LogPage {
  readonly rows: readonly LogEvent[];
  readonly total: number;
}

/**
 * What the service needs to serve one page. Shaped as a real paginated API
 * would take it, because that is the seam a server eventually sits behind.
 */
export interface LogListRequest {
  readonly filters: LogFilters;
  readonly sort: SortOrder;
  readonly offset: number;
  readonly limit: number;
}

export interface SavedView {
  readonly id: string;
  readonly name: string;
  readonly filters: LogFilters;
}
```

- [ ] **Step 2: Write the failing test**

Create `frontend/src/features/admin/logs/logs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  ALL_EVENT_TYPES,
  CATEGORY_LABEL,
  EVENT_TYPE_LABEL,
  TYPE_CATEGORY,
} from './logs';
import type { LogCategory } from './logs.types';

/**
 * The taxonomy behind ADM-07 (UX §3.7).
 *
 * The invariant worth pinning is that the type→category map is total and
 * single-valued: an unclassified event type would vanish from the
 * event-type filter, and a type in two categories would make the
 * `getAuditEvents()` projection ambiguous.
 */

describe('the taxonomy', () => {
  it('classifies every event type into exactly one category', () => {
    for (const type of ALL_EVENT_TYPES) {
      expect(TYPE_CATEGORY[type]).toBeDefined();
    }
  });

  it('labels every event type', () => {
    for (const type of ALL_EVENT_TYPES) {
      expect(EVENT_TYPE_LABEL[type]).toBeTruthy();
    }
  });

  it('covers all five §3.7 categories', () => {
    const categories = new Set<LogCategory>(ALL_EVENT_TYPES.map((t) => TYPE_CATEGORY[t]));
    expect([...categories].sort()).toEqual([
      'admin-activity',
      'authentication',
      'security',
      'system',
      'user-action',
    ]);
  });

  it('labels every category', () => {
    for (const category of Object.keys(CATEGORY_LABEL) as LogCategory[]) {
      expect(CATEGORY_LABEL[category]).toBeTruthy();
    }
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

```bash
npm run test -- src/features/admin/logs/logs.test.ts
```

Expected: FAIL — `Failed to resolve import "./logs"`.

- [ ] **Step 4: Write the taxonomy half of `logs.ts`**

```ts
/**
 * System Logs — pure rules (ADM-07 · UX §3.7).
 *
 * Classification, filtering, pivot and the summary-feed projection. No React,
 * no I/O, no clock: `now` is passed in, the convention every other admin
 * domain module follows, which is what makes the window rules testable at
 * their boundaries.
 */

import type { BadgeVariant } from '@/components/ui';

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

export const ALL_EVENT_TYPES = Object.keys(TYPE_CATEGORY) as readonly LogEventType[];

export const EVENT_TYPE_LABEL: Record<LogEventType, string> = {
  'login-succeeded': 'Sign-in succeeded',
  'login-failed': 'Sign-in failed',
  'login-blocked': 'Sign-in blocked',
  'impossible-travel': 'Impossible travel',
  'phi-revealed': 'Identifier revealed',
  'account-locked': 'Account locked',
  'failed-attempt-burst': 'Failed-attempt burst',
  'permission-changed': 'Permission changed',
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
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm run test -- src/features/admin/logs/logs.test.ts
```

Expected: PASS.

- [ ] **Step 6: Gates and commit**

```bash
npm run typecheck && npm run lint && npm run test
git add frontend/src/features/admin/logs
git commit -m "feat(adm-07): system-log taxonomy and domain types"
```

---

### Task 2: Classification from the five sources

Turns the trails ADM-02/04/05/10 already keep into `LogEvent`s. This is what makes the page an investigation tool rather than a fixture.

**Files:**
- Modify: `frontend/src/features/admin/logs/logs.ts`
- Test: `frontend/src/features/admin/logs/logs.test.ts` (append)

**Interfaces:**
- Consumes: `DoctorRecord`, `LoginEvent`, `AdminAuditEntry` from `'../doctors/doctors.types'`; `PatientAccount`, `AccountEvent` from `'../patients/patients.types'`; `OversightAppointment`, `OversightEvent` from `'../appointments/oversight.types'`; `AuditEvent`, `PhiAccessEvent` from `'../administration.types'` (**types only — never `administration.api`**).
- Produces: `fromDoctorLogins`, `fromDoctorAudit`, `fromPatientEvents`, `fromAppointmentEvents`, `fromPhiAccess`, `fromLegacyAudit`, `classifyAuditAction`.

- [ ] **Step 1: Write the failing test**

Append to `logs.test.ts`:

```ts
describe('classification', () => {
  it('maps a failed doctor sign-in to authentication, carrying its IP', () => {
    const [event] = fromDoctorLogins(doctorWithLogins);

    expect(event?.category).toBe('authentication');
    expect(event?.type).toBe('login-failed');
    expect(event?.ip).toBe('10.0.0.1');
    expect(event?.device).toBe('Chrome');
  });

  it('raises impossible travel to security and critical, not authentication', () => {
    // A geographically impossible sign-in is not a sign-in record; it is the
    // finding about one, and §3.7 files those under Security.
    const events = fromDoctorLogins(doctorWithImpossibleTravel);
    const flagged = events.find((e) => e.type === 'impossible-travel');

    expect(flagged?.category).toBe('security');
    expect(flagged?.severity).toBe('critical');
  });

  it('gives appointment transitions no IP rather than inventing one', () => {
    const [event] = fromAppointmentEvents(appointmentWithEvents);

    expect(event?.ip).toBeNull();
    expect(event?.device).toBeNull();
  });

  it('classifies a PHI reveal as security and keeps the record label, not a name', () => {
    const [event] = fromPhiAccess([phiEvent]);

    expect(event?.type).toBe('phi-revealed');
    expect(event?.category).toBe('security');
    expect(event?.target).toBe('Queue ticket A-104');
    expect(event?.summary).not.toContain('Ahmed');
  });

  it('never reaches the `other` fallback for any action string the app writes', () => {
    // AdminAuditEntry.action and AuditEvent.action are plain strings, so the
    // classifier cannot be total by construction. This is the guard: a new
    // call site with a new string fails here rather than silently landing in
    // "other" and disappearing from the event-type filter.
    const written = [
      'Application received',
      'Verification completed',
      'Account suspended',
      'Account reactivated',
      'Document approved',
      'Document rejected',
      'Documents requested',
      'Application rejected',
      'Returned to review',
      'Access reset sent',
      'Administrative fields changed',
      'Updated security policy',
      'Automatic backup completed',
      'Deactivated user',
      'Exported patient summary',
      'Failed login attempts',
    ];

    for (const action of written) {
      expect(classifyAuditAction(action)).not.toBe('other');
    }
  });
});
```

Add these fixtures above the `describe`, beside the file's existing helpers:

```ts
const NOW = Date.parse('2026-08-13T12:00:00.000Z');
const DAY_MS = 86_400_000;
const daysAgo = (d: number): string => new Date(NOW - d * DAY_MS).toISOString();

const login = (overrides: Partial<LoginEvent> = {}): LoginEvent => ({
  id: 'l1',
  at: daysAgo(1),
  ip: '10.0.0.1',
  device: 'Chrome',
  location: 'Berlin',
  result: 'failed',
  impossibleTravel: false,
  ...overrides,
});

const doctorWith = (logins: readonly LoginEvent[]): DoctorRecord =>
  ({ ...BASE_DOCTOR, logins }) as DoctorRecord;
```

Build `BASE_DOCTOR`, `appointmentWithEvents` and `phiEvent` from the real types — read `doctors.types.ts`, `oversight.types.ts` and `administration.types.ts` and set every required field. `doctorWithLogins` is `doctorWith([login()])`; `doctorWithImpossibleTravel` is `doctorWith([login({ result: 'success', impossibleTravel: true })])`.

Import the new functions and the types at the top of the file.

- [ ] **Step 2: Run it to verify it fails**

```bash
npm run test -- src/features/admin/logs/logs.test.ts
```

Expected: FAIL — `fromDoctorLogins is not a function`.

- [ ] **Step 3: Write the classifiers in `logs.ts`**

```ts
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
 * unions — eleven values in practice with nothing at the type level saying
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
```

Write `fromPatientEvents`, `fromAppointmentEvents`, `fromPhiAccess` and `fromLegacyAudit` in the same shape:

- **`fromPatientEvents(patient)`** — map `AccountEventKind` exhaustively onto `LogEventType` with a `Record<AccountEventKind, LogEventType>` so TypeScript enforces coverage. `sign-in` → `login-succeeded`, `sign-in-failed` → `login-failed`, `account-locked` → `account-locked`, and the administrative kinds onto their matching admin types. `target` is `patient.mrn` — **never `patient.name`**. `actor` is `event.actor ?? 'System'` (the field is optional; system-caused events have none), `actorRole` is `'administrator'` when `event.actor` is set and `'system'` otherwise. `ip` and `device` are `null`.
- **`fromAppointmentEvents(appointment)`** — map `OversightEventKind` exhaustively with a `Record`. `actor`/`actorRole` come straight from the event. `target` is `appointment.reference`. `ip`/`device` `null`.
- **`fromPhiAccess(log)`** — one `phi-revealed` event per entry. `target` is `event.subjectLabel`, `summary` names the category and duration, `severity: 'warning'`. **Never put `subjectId` in the summary.**
- **`fromLegacyAudit(events)`** — the seeded `AuditEvent`s, through `classifyAuditAction`. Preserve `severity` **and `action`** exactly as given: these are the rows ADM-01's feed and ADM-09's panel already render, and Task 5 projects `action` straight back out, so any rewording renames a row that is on screen today.

Every classifier must set `action`. Use the source's own string where it has one (`AdminAuditEntry.action`, `AuditEvent.action`); otherwise `EVENT_TYPE_LABEL[type]`.

Add the imports at the top of `logs.ts`:

```ts
import type { OversightAppointment, OversightEventKind } from '../appointments/oversight.types';
import type { AuditEvent, PhiAccessEvent } from '../administration.types';
import type { DoctorRecord, LoginEvent } from '../doctors/doctors.types';
import type { AccountEventKind, PatientAccount } from '../patients/patients.types';
```

All type-only — `logs.ts` must not import `administration.api.ts` (Global Constraints).

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm run test -- src/features/admin/logs/logs.test.ts
```

Expected: PASS.

- [ ] **Step 5: Prove the fallback guard works**

Temporarily add `['Verification completed', 'verification-decided']` removal — delete that entry from `AUDIT_ACTION_TYPES`, re-run, and confirm the "never reaches the `other` fallback" test FAILS. Restore and re-run.

- [ ] **Step 6: Gates and commit**

```bash
npm run typecheck && npm run lint && npm run test
git add frontend/src/features/admin/logs
git commit -m "feat(adm-07): classify existing admin trails into log events"
```

---

### Task 3: Filtering, search and pivot

**Files:**
- Modify: `frontend/src/features/admin/logs/logs.ts`
- Test: `frontend/src/features/admin/logs/logs.test.ts` (append)

**Interfaces:**
- Produces: `EMPTY_FILTERS`, `matchesFilters(event, filters, now)`, `filterEvents(events, filters, sort, now)`, `pivotOn(filters, field, value)`, `formatTimestamp(iso)`, `activeFilterCount(filters)`.

- [ ] **Step 1: Write the failing test**

Append to `logs.test.ts`:

```ts
describe('filtering', () => {
  const withIp = event({ id: 'a', ip: '10.0.0.1' });
  const withoutIp = event({ id: 'b', ip: null });

  it('excludes rows that carry no IP when filtering by IP', () => {
    // An investigator filtering by IP is asking which events came from that
    // address. A row that cannot answer is not an answer, so it is excluded
    // rather than silently matching.
    const kept = filterEvents([withIp, withoutIp], { ...EMPTY_FILTERS, ip: '10.0.0.1' }, 'newest');

    expect(kept.map((e) => e.id)).toEqual(['a']);
  });

  it('keeps both when no IP filter is set', () => {
    const kept = filterEvents([withIp, withoutIp], EMPTY_FILTERS, 'newest');

    expect(kept).toHaveLength(2);
  });

  it('searches actor, event-type label and summary but never a patient name', () => {
    const target = event({ id: 'c', summary: 'Identifier revealed for Queue ticket A-104' });

    expect(filterEvents([target], { ...EMPTY_FILTERS, query: 'queue ticket' }, 'newest')).toHaveLength(1);
    expect(filterEvents([target], { ...EMPTY_FILTERS, query: 'nothing' }, 'newest')).toHaveLength(0);
  });

  it('honours both ends of the date range', () => {
    const old = event({ id: 'old', at: daysAgo(30) });
    const recent = event({ id: 'recent', at: daysAgo(1) });
    const from = new Date(NOW - 7 * DAY_MS).toISOString();

    const kept = filterEvents([old, recent], { ...EMPTY_FILTERS, from }, 'newest');

    expect(kept.map((e) => e.id)).toEqual(['recent']);
  });

  it('sorts newest or oldest first and nothing else', () => {
    const a = event({ id: 'a', at: daysAgo(1) });
    const b = event({ id: 'b', at: daysAgo(5) });

    expect(filterEvents([b, a], EMPTY_FILTERS, 'newest').map((e) => e.id)).toEqual(['a', 'b']);
    expect(filterEvents([b, a], EMPTY_FILTERS, 'oldest').map((e) => e.id)).toEqual(['b', 'a']);
  });
});

describe('pivot', () => {
  it('produces a filter that selects the row pivoted from', () => {
    const row = event({ id: 'x', ip: '10.0.0.9' });
    const pivoted = pivotOn(EMPTY_FILTERS, 'ip', '10.0.0.9');

    expect(filterEvents([row], pivoted, 'newest').map((e) => e.id)).toEqual(['x']);
  });

  it('replaces rather than accumulates on the same field', () => {
    const once = pivotOn(EMPTY_FILTERS, 'ip', '10.0.0.1');
    const twice = pivotOn(once, 'ip', '10.0.0.2');

    expect(twice.ip).toBe('10.0.0.2');
  });
});
```

Add an `event()` factory beside the other fixtures returning a complete `LogEvent` with sensible defaults and `...overrides`.

- [ ] **Step 2: Run it to verify it fails**

```bash
npm run test -- src/features/admin/logs/logs.test.ts
```

Expected: FAIL — `EMPTY_FILTERS is not defined`.

- [ ] **Step 3: Implement**

```ts
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

/** Millisecond precision — §3.7 asks for it, and an investigation needs it. */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${date.toISOString().slice(0, 19).replace('T', ' ')}.${ms}`;
}
```

- [ ] **Step 4–6: Verify, prove, commit**

```bash
npm run test -- src/features/admin/logs/logs.test.ts
```
Expected: PASS.

Prove the IP rule: change `if (event.ip === null) return false;` to `return true;`, confirm the exclusion test fails, restore.

```bash
npm run typecheck && npm run lint && npm run test
git add frontend/src/features/admin/logs
git commit -m "feat(adm-07): log filtering, search, date range and pivot"
```

---

### Task 4: The service — aggregation, pagination, saved views, export

**Files:**
- Create: `frontend/src/features/admin/logs/logs.api.ts`
- Create: `frontend/src/features/admin/logs/logs.queries.ts`
- Modify: `frontend/src/utils/export.ts`
- Test: `frontend/src/features/admin/logs/logs.api.test.ts`

**Interfaces:**
- Consumes: `doctorsApi.list()`, `patientsApi.list()`, `oversightApi.list()`, `administrationApi.getAuditEvents`/`phiAccess` — read the real signatures before wiring.
- Produces: `logsApi.list(request)`, `logsApi.savedViews()`, `logsApi.createView(name, filters)`, `logsApi.deleteView(id)`, `logsApi.exportEvents(format, filters, actor)`, `useLogPage`, `useSavedViews`, `useLogMutations`, `logsKeys`, and `exportJson` in `utils/export.ts`.

- [ ] **Step 1: Write the failing test**

Create `logs.api.test.ts`:

```ts
import { describe, expect, it, beforeEach } from 'vitest';

import { EMPTY_FILTERS, PAGE_SIZE } from './logs';
import { logsApi } from './logs.api';

/**
 * The service exists to make one stream out of trails four other modules
 * keep. The claims worth pinning: the aggregate really does span all five
 * §3.7 categories, `total` is a post-filter count rather than the page
 * length, an export writes its own event, and nothing here can change an
 * event.
 */

beforeEach(() => {
  window.localStorage.clear();
});

const ALL = { filters: EMPTY_FILTERS, sort: 'newest' as const, offset: 0, limit: PAGE_SIZE };

describe('aggregation', () => {
  it('covers all five §3.7 categories', async () => {
    const page = await logsApi.list({ ...ALL, limit: 5000 });
    const categories = new Set(page.rows.map((r) => r.category));

    expect([...categories].sort()).toEqual([
      'admin-activity',
      'authentication',
      'security',
      'system',
      'user-action',
    ]);
  });

  it('carries a real IP on doctor sign-ins and none on appointment transitions', async () => {
    const page = await logsApi.list({ ...ALL, limit: 5000 });

    expect(page.rows.some((r) => r.category === 'authentication' && r.ip !== null)).toBe(true);
    expect(page.rows.every((r) => r.category !== 'user-action' || r.ip === null)).toBe(true);
  });

  it('never puts a patient name in a target or summary', async () => {
    const page = await logsApi.list({ ...ALL, limit: 5000 });
    const names = MOCK_PATIENTS.map((p) => p.name);

    for (const row of page.rows) {
      for (const name of names) {
        expect(row.target).not.toContain(name);
        expect(row.summary).not.toContain(name);
      }
    }
  });
});

describe('pagination', () => {
  it('reports the post-filter total independently of the page size', async () => {
    const first = await logsApi.list({ ...ALL, limit: 10 });
    const second = await logsApi.list({ ...ALL, limit: 25 });

    expect(first.rows).toHaveLength(10);
    expect(second.rows).toHaveLength(25);
    expect(first.total).toBe(second.total);
    expect(first.total).toBeGreaterThan(25);
  });

  it('pages without repeating or skipping a row', async () => {
    const a = await logsApi.list({ ...ALL, offset: 0, limit: 10 });
    const b = await logsApi.list({ ...ALL, offset: 10, limit: 10 });
    const ids = new Set([...a.rows, ...b.rows].map((r) => r.id));

    expect(ids.size).toBe(20);
  });

  it('narrows total when a filter is applied', async () => {
    const all = await logsApi.list(ALL);
    const critical = await logsApi.list({
      ...ALL,
      filters: { ...EMPTY_FILTERS, severity: 'critical' },
    });

    expect(critical.total).toBeLessThan(all.total);
    expect(critical.rows.every((r) => r.severity === 'critical')).toBe(true);
  });
});

describe('export', () => {
  it('appends its own event, so the export appears in the log it came from', async () => {
    const before = await logsApi.list({ ...ALL, filters: { ...EMPTY_FILTERS, type: 'data-export' } });

    await logsApi.exportEvents('csv', EMPTY_FILTERS, 'Marcus Reed');

    const after = await logsApi.list({ ...ALL, filters: { ...EMPTY_FILTERS, type: 'data-export' } });
    expect(after.total).toBe(before.total + 1);
  });
});

describe('saved views', () => {
  it('persists across a reload', async () => {
    await logsApi.createView('Critical 7d', { ...EMPTY_FILTERS, severity: 'critical' });

    const views = await logsApi.savedViews();
    expect(views.map((v) => v.name)).toContain('Critical 7d');
  });

  it('ships §3.7’s two seeded views', async () => {
    const views = await logsApi.savedViews();

    expect(views.map((v) => v.name)).toEqual(
      expect.arrayContaining(['Failed logins 7d', 'Admin PHI access']),
    );
  });
});

describe('read-only', () => {
  it('exposes no way to change or remove an event', () => {
    // §3.7: logs are read-only for everyone including admins. Making that a
    // type error rather than a policy is the point — there is nothing to call.
    const surface = Object.keys(logsApi);

    expect(surface).not.toContain('update');
    expect(surface).not.toContain('remove');
    expect(surface).not.toContain('delete');
    expect(surface.filter((k) => /event/i.test(k) && k !== 'exportEvents')).toEqual([]);
  });
});
```

Import `MOCK_PATIENTS` from `'@/features/shared-domain/patient-identity'` — the canonical roster `administration.api.test.ts` already uses for the same check.

- [ ] **Step 2: Run it to verify it fails**

```bash
npm run test -- src/features/admin/logs/logs.api.test.ts
```

Expected: FAIL — cannot resolve `./logs.api`.

- [ ] **Step 3: Write `logs.api.ts`**

Structure it as:

```ts
/**
 * System Logs — mock service (ADM-07 · UX §3.7).
 *
 * This service *aggregates* rather than stores. Its rows come from the trails
 * ADM-02, ADM-04, ADM-05 and ADM-10 already keep, so a suspension performed on
 * the Doctors page is in the log the moment it happens — which is what makes
 * this an investigation tool instead of a fixture. Only the System category is
 * seeded, because nothing in a frontend can observe a service degrading.
 *
 * There is no operation here that changes an event. §3.7 makes logs read-only
 * for everyone including administrators, and a service with no mutation is a
 * stronger guarantee than a UI with no button. The only writes are saved views
 * and the export record — and the export writes an event *about itself*.
 */
```

Then:

- `const LATENCY_MS = 260;` and the `delay<T>` helper, matching `patients.api.ts`.
- **Seeded System corpus**: generate `service-degraded`, `integration-failed` and `job-completed` events across `SEED_SPAN_DAYS`, deterministically (index-driven, no `Math.random()` — a re-render must not reshuffle the log). Give them `actorRole: 'system'` and `ip: null`.
- **Extra `data-export` events** appended to a module-level array by `exportEvents`.
- `async function aggregate(): Promise<readonly LogEvent[]>` — awaits `doctorsApi.list()`, `patientsApi.list()`, `oversightApi.list()` and `administrationApi.getAuditEvents()` plus the PHI log, maps each through the Task 2 classifiers, concatenates with the seeded System corpus and the export records.

  **Read the real signatures first.** `administrationApi.getAuditEvents()` currently folds the PHI log in itself — check whether you need the PHI log separately to avoid double-counting reveals, and if so read it from `administrationApi.phiAccess`.

- `list(request: { filters, sort, offset, limit }): Promise<LogPage>`:

```ts
  list: async (request: LogListRequest): Promise<LogPage> => {
    const all = await aggregate();
    // Filter and count on this side of the seam — a real API would, and the
    // page must never hold more than one page.
    const matched = filterEvents(all, request.filters, request.sort);
    const rows = matched.slice(request.offset, request.offset + request.limit);
    return delay({ rows, total: matched.length });
  },
```

- `savedViews`, `createView`, `deleteView` — `localStorage` under `SAVED_VIEWS_KEY`, seeded on first read with the two §3.7 views:
  - **"Failed logins 7d"** — `{ ...EMPTY_FILTERS, type: 'login-failed', from: <7 days ago ISO> }`
  - **"Admin PHI access"** — `{ ...EMPTY_FILTERS, type: 'phi-revealed' }`
- `exportEvents(format: 'csv' | 'json', filters: LogFilters, actor: string)`:

```ts
  exportEvents: async (format: 'csv' | 'json', filters: LogFilters, actor: string) => {
    const all = await aggregate();
    const rows = filterEvents(all, filters, 'newest');
    /*
     * The export event is appended BEFORE the file is written, the same order
     * ADM-10 uses for PHI reveals: an access that failed to log is an access
     * that did not happen. §3.7 requires the export itself be logged.
     */
    exportRecords.push(buildExportEvent(format, filters, actor, rows.length));
    if (format === 'csv') exportCsv(toDataset(rows));
    else exportJson(toDataset(rows));
    return delay(rows.length);
  },
```

`toDataset(rows)` builds an `ExportDataset` — `filename: 'medora-system-logs'`, `title: 'System logs'`, columns matching the table, and one row array per event.

- [ ] **Step 4: Add `exportJson` to `frontend/src/utils/export.ts`**

Beside `exportCsv`, following its shape:

```ts
export function toJson(data: ExportDataset): string {
  const objects = data.rows.map((row) =>
    Object.fromEntries(data.columns.map((column, index) => [column, row[index] ?? null])),
  );
  return JSON.stringify(objects, null, 2);
}

export function exportJson(data: ExportDataset): void {
  const blob = new Blob([toJson(data)], { type: 'application/json;charset=utf-8' });
  download(blob, `${data.filename}.json`);
}
```

- [ ] **Step 5: Write `logs.queries.ts`**

```ts
/**
 * System Logs — TanStack Query hooks (ADM-07).
 *
 * The page query is keyed on the filters, the sort and the page, because the
 * service pages server-side: a new page is a new request, not a slice of
 * something already in the cache. `placeholderData: keepPreviousData` keeps
 * the previous page on screen while the next loads, so paging through an
 * investigation does not blank the table on every click.
 */

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { logsApi } from './logs.api';
import type { LogFilters, SortOrder } from './logs.types';

const STALE_MS = 30_000;

export const logsKeys = {
  all: ['admin', 'logs'] as const,
  page: (filters: LogFilters, sort: SortOrder, offset: number, limit: number) =>
    [...logsKeys.all, 'page', filters, sort, offset, limit] as const,
  views: () => [...logsKeys.all, 'views'] as const,
} as const;

export function useLogPage(filters: LogFilters, sort: SortOrder, offset: number, limit: number) {
  return useQuery({
    queryKey: logsKeys.page(filters, sort, offset, limit),
    queryFn: () => logsApi.list({ filters, sort, offset, limit }),
    staleTime: STALE_MS,
    placeholderData: keepPreviousData,
  });
}

export function useSavedViews() {
  return useQuery({ queryKey: logsKeys.views(), queryFn: logsApi.savedViews, staleTime: STALE_MS });
}

export function useLogMutations() {
  const queryClient = useQueryClient();
  const invalidateViews = () => {
    void queryClient.invalidateQueries({ queryKey: logsKeys.views() });
  };

  const createView = useMutation({
    mutationFn: (input: { name: string; filters: LogFilters }) =>
      logsApi.createView(input.name, input.filters),
    onSuccess: invalidateViews,
  });

  const deleteView = useMutation({
    mutationFn: (id: string) => logsApi.deleteView(id),
    onSuccess: invalidateViews,
  });

  const exportEvents = useMutation({
    mutationFn: (input: { format: 'csv' | 'json'; filters: LogFilters; actor: string }) =>
      logsApi.exportEvents(input.format, input.filters, input.actor),
    // The export writes an event, so the page it came from is now stale.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: logsKeys.all });
    },
  });

  return { createView, deleteView, exportEvents };
}
```

- [ ] **Step 6: Verify, prove, commit**

```bash
npm run test -- src/features/admin/logs/logs.api.test.ts
```
Expected: PASS.

Prove the export self-logging: comment out the `exportRecords.push(...)` line, confirm the export test fails, restore.

```bash
npm run typecheck && npm run lint && npm run test
git add frontend/src/features/admin/logs frontend/src/utils/export.ts
git commit -m "feat(adm-07): aggregate the log, page it, and log its own exports"
```

---

### Task 5: `getAuditEvents()` becomes a projection

The riskiest task: it changes what three existing consumers read. Do it with the allowlist, and pin both directions.

**Files:**
- Modify: `frontend/src/features/admin/logs/logs.ts` (add `AUDIT_FEED_TYPES`, `toAuditEvent`)
- Modify: `frontend/src/features/admin/administration.api.ts`
- Test: `frontend/src/features/admin/logs/logs.test.ts`, `frontend/src/features/admin/administration.api.test.ts`

**Interfaces:**
- Produces: `AUDIT_FEED_TYPES: ReadonlySet<LogEventType>`, `toAuditEvent(event: LogEvent): AuditEvent`, `projectAuditFeed(events: readonly LogEvent[]): readonly AuditEvent[]`.

- [ ] **Step 1: Write the failing test**

Append to `logs.test.ts`:

```ts
describe('the summary-feed projection', () => {
  it('keeps every event the admin feed shows today', () => {
    // Selecting by category was the first design and it dropped two of these:
    // the backup is a job result (system) and the doctor's export is a user
    // action. Both are rows ADM-01's feed and ADM-09's panel render today.
    const legacy = [
      event({ id: 'aud-1', type: 'settings-changed' }),
      event({ id: 'aud-2', type: 'job-completed' }),
      event({ id: 'aud-3', type: 'account-deactivated' }),
      event({ id: 'aud-4', type: 'data-export' }),
      event({ id: 'aud-5', type: 'failed-attempt-burst' }),
    ];

    const projected = projectAuditFeed(legacy);

    expect(projected.map((e) => e.id)).toEqual(['aud-1', 'aud-2', 'aud-3', 'aud-4', 'aud-5']);
  });

  it('keeps sign-ins and routine appointment transitions out', () => {
    // These are the high-volume sources. A six-row "recent admin activity"
    // widget filled with sign-ins is not a summary of anything.
    const noisy = [
      event({ id: 'l', type: 'login-succeeded' }),
      event({ id: 't', type: 'appointment-confirmed' }),
    ];

    expect(projectAuditFeed(noisy)).toEqual([]);
  });

  it('preserves actor, target, timestamp and severity', () => {
    const source = event({
      id: 'x',
      type: 'doctor-suspended',
      actor: 'Marcus Reed',
      target: 'LIC-1',
      severity: 'warning',
    });

    const [projected] = projectAuditFeed([source]);

    expect(projected).toMatchObject({
      actor: 'Marcus Reed',
      target: 'LIC-1',
      severity: 'warning',
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npm run test -- src/features/admin/logs/logs.test.ts
```
Expected: FAIL — `projectAuditFeed is not a function`.

- [ ] **Step 3: Implement the projection in `logs.ts`**

```ts
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

export function toAuditEvent(event: LogEvent): AuditEvent {
  return {
    id: event.id,
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
```

- [ ] **Step 4: Rewire `getAuditEvents()`**

In `administration.api.ts`, replace the body so it projects from the log instead of concatenating its own two sources. **Read the current implementation first** (around line 831) — it merges `load().phiAccessLog.map(asAuditEvent)` with `auditEvents`, newest first.

The constraint that decides the shape: `administration.api.ts` may import `logs.ts` (pure) but **must not** import `logs.api.ts`, which imports `administration.api.ts` back. So `getAuditEvents()` keeps assembling its own inputs — the seeded `auditEvents` plus the PHI log — and passes them through `projectAuditFeed` after classifying them with the Task 2 helpers.

Preserve: newest-first ordering, and the `asAuditEvent` behaviour for PHI reveals that `PhiAccessProvider.test.tsx` pins (the target names the record, never the patient).

- [ ] **Step 5: Strengthen the PHI read-path test**

`administration.api.test.ts`'s "never lets a seeded target carry a patient name" asserts only `events.length > 0`, so a narrowing projection would weaken it invisibly. Add an assertion that the five legacy events are all still present by id, so the projection cannot silently shrink:

```ts
    const ids = events.map((event) => event.id);
    expect(ids).toEqual(expect.arrayContaining(['aud-1', 'aud-2', 'aud-3', 'aud-4', 'aud-5']));
```

- [ ] **Step 6: Verify the existing consumers still pass**

```bash
npm run test -- src/features/admin/overview src/features/admin/administration.api.test.ts src/features/admin/phi
```

Expected: PASS, unchanged. If ADM-01's feed test (`'Updated security policy'`) or `PhiAccessProvider.test.tsx` fails, the projection changed what those surfaces show — fix the allowlist, not the test.

- [ ] **Step 7: Gates and commit**

```bash
npm run typecheck && npm run lint && npm run test
git add frontend/src/features/admin
git commit -m "feat(adm-07): project the audit feed from the log"
```

---

### Task 6: The page shell and the table

**Files:**
- Create: `frontend/src/features/admin/logs/SystemLogsSection.tsx`, `LogTable.tsx`
- Test: `frontend/src/features/admin/logs/SystemLogsSection.test.tsx`

**Interfaces:**
- Produces: `SystemLogsSection` (named export), `LogTable({ rows, isLoading, isError, onRetry, onPivot, onOpen })`.

- [ ] **Step 1: Write the failing test**

```tsx
describe('the log table', () => {
  it('renders the §3.7 columns', async () => {
    renderLogs();

    const table = await screen.findByRole('table', { name: /system log/i });
    for (const header of ['Timestamp', 'Severity', 'Actor', 'Event', 'Summary', 'IP / device']) {
      expect(within(table).getByRole('columnheader', { name: header })).toBeInTheDocument();
    }
  });

  it('shows an em dash where a source carries no IP, rather than implying one', async () => {
    renderLogs();
    const table = await screen.findByRole('table', { name: /system log/i });

    expect(within(table).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('offers no way to edit or delete an event', async () => {
    // §3.7: read-only for everyone including admins.
    renderLogs();
    await screen.findByRole('table', { name: /system log/i });

    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
  });

  it('states the retention policy', async () => {
    renderLogs();

    expect(await screen.findByText(/retained for 365 days/i)).toBeInTheDocument();
  });
});
```

Build `renderLogs()` on the harness in `frontend/src/features/admin/overview/AdminOverviewSection.test.tsx` — the `vi.mock('@/app/providers', …)` block, `QueryClientProvider` with `retry: false`, and `MemoryRouter`. This page renders no patient identifiers, so `PhiAccessProvider` is not required; do not add it.

- [ ] **Step 2–6:** Run to see it fail; write `LogTable.tsx` (columns per §3.7, `bg-error-subtle` tint on critical rows, mono `tabular-nums` timestamps, `—` for null IP/device, actor/IP/event-type rendered as pivot buttons, `⋯` opening the drawer) and `SystemLogsSection.tsx` (owns `filters`, `sort`, `page` state; calls `useLogPage`; renders `SectionShell slug="logs"`, the retention caption, the table and `Pagination`); run to green; gates; commit.

The async envelope goes **inside** the table's panel, matching the pattern every ADM-01 widget uses, so the page keeps its heading while loading or failing.

```bash
git commit -m "feat(adm-07): the system-log investigation table"
```

---

### Task 7: Filters bar and pivot wiring

**Files:**
- Create: `frontend/src/features/admin/logs/LogFiltersBar.tsx`
- Modify: `SystemLogsSection.tsx`
- Test: `SystemLogsSection.test.tsx` (append)

- [ ] **Step 1: Write the failing test**

```tsx
describe('filtering and pivot', () => {
  it('narrows the table by severity', async () => {
    const user = userEvent.setup();
    renderLogs();
    await screen.findByRole('table', { name: /system log/i });

    // The design-system Select is a button + listbox, not a native <select>:
    // `user.selectOptions` throws "Value not found in options" against it.
    await user.click(screen.getByRole('combobox', { name: /severity/i }));
    await user.click(await screen.findByRole('option', { name: /critical/i }));

    await waitFor(() => {
      const rows = within(screen.getByRole('table', { name: /system log/i })).getAllByRole('row');
      expect(rows.length).toBeGreaterThan(1);
    });
    expect(screen.getAllByText('Critical').length).toBeGreaterThan(0);
  });

  it('pivots on an IP, filtering to it', async () => {
    const user = userEvent.setup();
    renderLogs();
    const table = await screen.findByRole('table', { name: /system log/i });

    const pivot = within(table).getAllByRole('button', { name: /filter by IP/i })[0];
    const ip = pivot?.textContent ?? '';
    if (pivot) await user.click(pivot);

    await waitFor(() => {
      expect(screen.getByLabelText(/IP address/i)).toHaveValue(ip);
    });
  });

  it('tells an over-filtered investigator how to widen it', async () => {
    const user = userEvent.setup();
    renderLogs();
    await screen.findByRole('table', { name: /system log/i });

    await user.type(screen.getByRole('searchbox', { name: /search/i }), 'zzzz-no-such-event');

    expect(await screen.findByText(/no events match — widen the time range/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2–5:** Fail; implement the six structured filters (`Select` for actor role / actor / event type / severity, `Input type="datetime-local"` for from/to, `Input` for IP, `SearchInput` for the query) plus a Reset that returns to `EMPTY_FILTERS`; wire `onPivot` from the table through `pivotOn`; **reset `page` to 1 on any filter change** — `page` is 1-based to match `Pagination`, so 0 is not a valid first page. Leaving an investigator on page 7 of a 2-page result is an empty table that looks like no matches; run to green; gates; commit.

Prove the page reset: remove it, confirm a test fails. If none does, add one.

```bash
git commit -m "feat(adm-07): structured log filters and pivot"
```

---

### Task 8: Detail drawer

**Files:**
- Create: `frontend/src/features/admin/logs/LogDetailDrawer.tsx`
- Modify: `SystemLogsSection.tsx`
- Test: `SystemLogsSection.test.tsx` (append)

- [ ] **Step 1: Write the failing test**

```tsx
describe('the detail drawer', () => {
  it('shows the payload as a key-value grid and as raw JSON on request', async () => {
    const user = userEvent.setup();
    renderLogs();
    const table = await screen.findByRole('table', { name: /system log/i });

    const [firstDetail] = within(table).getAllByRole('button', { name: /view detail/i });
    if (firstDetail) await user.click(firstDetail);

    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText(/event id/i)).toBeInTheDocument();

    await user.click(within(drawer).getByRole('button', { name: /raw json/i }));
    expect(within(drawer).getByText(/^\{/)).toBeInTheDocument();
  });

  it('offers a copyable incident reference', async () => {
    const user = userEvent.setup();
    renderLogs();
    const table = await screen.findByRole('table', { name: /system log/i });

    const [firstDetail] = within(table).getAllByRole('button', { name: /view detail/i });
    if (firstDetail) await user.click(firstDetail);
    const drawer = await screen.findByRole('dialog');

    expect(within(drawer).getByRole('button', { name: /copy incident reference/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2–5:** Fail; implement on `Drawer` from `@/components/ui` (`open`, `onClose`, `title`); key-value grid of id, timestamp, category, type, severity, actor + role, target, IP, device, then payload entries; a toggle swapping the grid for `JSON.stringify(event, null, 2)` in a `<pre>`; **Copy incident reference** writing `${event.id} @ ${event.at}` via `navigator.clipboard.writeText`, guarded because jsdom has no clipboard by default — mock it in the test rather than skipping the assertion; run to green; gates; commit.

```bash
git commit -m "feat(adm-07): log detail drawer with payload and incident reference"
```

---

### Task 9: Saved views and export

**Files:**
- Create: `frontend/src/features/admin/logs/SavedViewsMenu.tsx`
- Modify: `LogFiltersBar.tsx`, `SystemLogsSection.tsx`
- Test: `SystemLogsSection.test.tsx` (append)

- [ ] **Step 1: Write the failing test**

```tsx
describe('saved views and export', () => {
  it('applies a seeded view to the filters', async () => {
    const user = userEvent.setup();
    renderLogs();
    await screen.findByRole('table', { name: /system log/i });

    await user.click(screen.getByRole('button', { name: /saved views/i }));
    await user.click(await screen.findByRole('button', { name: /admin phi access/i }));

    await waitFor(() => {
      // The DS Select is a button whose label reflects the selection, so read
      // its text rather than a form value.
      expect(screen.getByRole('combobox', { name: /event type/i })).toHaveTextContent(
        /identifier revealed/i,
      );
    });
  });

  it('saves the current filters as a new view', async () => {
    const user = userEvent.setup();
    renderLogs();
    await screen.findByRole('table', { name: /system log/i });

    // The design-system Select is a button + listbox, not a native <select>:
    // `user.selectOptions` throws "Value not found in options" against it.
    await user.click(screen.getByRole('combobox', { name: /severity/i }));
    await user.click(await screen.findByRole('option', { name: /critical/i }));
    await user.click(screen.getByRole('button', { name: /saved views/i }));
    await user.click(screen.getByRole('button', { name: /save current filters/i }));
    await user.type(screen.getByRole('textbox', { name: /view name/i }), 'Criticals');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByRole('button', { name: /criticals/i })).toBeInTheDocument();
  });

  it('logs its own export, so it shows up in the log it came from', async () => {
    const user = userEvent.setup();
    renderLogs();
    await screen.findByRole('table', { name: /system log/i });

    await user.click(screen.getByRole('button', { name: /export/i }));
    await user.click(screen.getByRole('button', { name: /csv/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/data exported/i).length).toBeGreaterThan(0);
    });
  });
});
```

Stub the download in the harness — jsdom has no `URL.createObjectURL`:

```tsx
beforeAll(() => {
  Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:stub', writable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: () => undefined, writable: true });
});
```

- [ ] **Step 2–5:** Fail; implement `SavedViewsMenu` (list, apply, save-current, delete) and an export menu offering CSV and JSON, both passing the **current filters** so the file matches the table; run to green; gates; commit.

Prove the filter-respecting export: change `exportEvents` to pass `EMPTY_FILTERS`, confirm a test fails. If none does, add one asserting the exported row count equals the filtered `total`.

```bash
git commit -m "feat(adm-07): saved views and filter-respecting CSV/JSON export"
```

---

### Task 10: Mount at `/admin/logs`

**Files:**
- Modify: `frontend/src/routes/index.ts`, `administration.meta.ts`, `layouts/navigation.ts`, `features/admin/routes.tsx`
- Test: `frontend/src/features/admin/routes.test.tsx` (append)

**Interfaces:**
- Consumes: `SystemLogsSection` from Tasks 6–9.

- [ ] **Step 1: Write the failing test**

Append to the existing `routes.test.tsx`, matching its established style:

```tsx
it('serves the System Logs page at /admin/logs', async () => {
  await renderAt('/admin/logs');

  expect(await screen.findByRole('heading', { name: 'System Logs', level: 1 })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npm run test -- src/features/admin/routes.test.tsx
```
Expected: FAIL — no route declared for `/admin/logs`.

- [x] **Step 3: Add the slug — ALREADY DONE IN TASK 6**

`SectionShell`'s `slug` prop is typed `AdminSectionSlug`, so Task 6 could not compile without it. Steps 3 and 4 were pulled forward there. Verify they are present rather than redoing them:
`grep -n "'logs'" frontend/src/routes/index.ts frontend/src/features/admin/administration.meta.ts`

- [x] **Step 4: Add the metadata — ALREADY DONE IN TASK 6** (verify only)

In `administration.meta.ts`:

```ts
  logs: {
    label: 'System Logs',
    description: 'Every authentication, security, and administrative event on the platform.',
    icon: ScrollText,
  },
```

`SECTION_META` is a `Record` over the union, so the compiler names every site that must follow. Import the icon if it is not already imported; `ScrollText` is already used by Clinic Policies, so pick a distinct one — `FileSearch` — and import it.

- [ ] **Step 5: Add the sidebar entry**

In `layouts/navigation.ts`, add to the **Governance** group, above Announcements:

```ts
        {
          id: 'logs',
          label: 'System Logs',
          icon: FileSearch,
          path: routes.admin.logs,
        },
```

- [ ] **Step 6: Mount the route**

In `features/admin/routes.tsx`, beside the other `section(...)` calls:

```tsx
  section('logs', 'System Logs', async () => {
    const { SystemLogsSection } = await import('./logs/SystemLogsSection');
    return { Component: SystemLogsSection };
  }),
```

`administration.meta.test.ts` asserts every inlined crumb equals its `SECTION_META` label — the crumb string here must be exactly `'System Logs'`.

- [ ] **Step 7: Verify and commit**

```bash
npm run typecheck && npm run lint && npm run test
git add frontend/src
git commit -m "feat(adm-07): mount System Logs at /admin/logs"
```

---

### Task 11: Browser verification, docs and final gates

**Files:**
- Modify: `frontend/FRONTEND_CHECKLIST.md`

- [ ] **Step 1: Start the dev server**

Use `preview_start` with the `medora-dev` entry in `.claude/launch.json`. If port 5173 is held by another session, add a second entry on a free port with `runtimeArgs: ["--prefix", "frontend", "run", "dev", "--", "--port", "<port>"]` — Vite hardcodes 5173 in `vite.config.ts`, so `autoPort` alone will not move it.

- [ ] **Step 2: Verify against the claims that matter**

Sign in as `admin@medora.health` / `Medora123!` and check with `read_page` and `read_console_messages`:

1. `/admin/logs` renders; the sidebar shows System Logs under Governance.
2. **Filter by severity `critical`** — every visible row is critical, and the pager's total drops.
3. **Pivot on an IP** — the IP filter fills with that value and every visible row carries it.
4. **Rows with no IP show `—`**, and applying an IP filter removes them.
5. **Export CSV, then clear filters and search "Data exported"** — the export's own event is in the log.
6. Open the drawer; toggle raw JSON; the payload matches the row.
7. No edit or delete control exists anywhere on the page.

Then `resize_window` to mobile **and reload**, confirming no horizontal scroll. Console must be clean.

- [ ] **Step 3: Screenshot** at desktop for the record.

- [ ] **Step 4: Update the checklist**

In `frontend/FRONTEND_CHECKLIST.md`, matching the density and voice of the ADM-04 and ADM-05 rows:

- **ADM-07 row** → `✅ **DONE (Phase C)**`, describing: the aggregated stream over ADM-02/04/05/10's existing trails with only System seeded; the paginated service interface with post-filter totals; the six structured filters, search and pivot; saved views; CSV/JSON export that logs itself; the drawer; and that `getAuditEvents()` is now a projection of the log through an explicit allowlist.
- **Not done, plainly:** correlated events, before/after diffs and incident bookmarks (cut by scope); virtual scrolling (the paginated interface makes it unnecessary at this corpus size); the log records only what this client can observe, so a real server's log would be larger; and the `other` classification fallback exists because two source fields are plain strings rather than unions.
- **§4 intro** — add ADM-07 to the live screens; `communications` and `reports` remain declared-but-unmounted.
- **Phase C roadmap item 12** → `✅` with a one-line summary in the style of items 8–11.

- [ ] **Step 5: Final gates**

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add frontend/FRONTEND_CHECKLIST.md
git commit -m "docs(adm-07): mark System Logs done and record what is not"
```

---

## Notes for the implementer

**Where this can go wrong quietly.**

1. **The projection silently shrinking.** Task 5 changes what ADM-01's home feed and ADM-09's audit panel show. The PHI regression test iterates whatever `getAuditEvents()` returns and asserts only `length > 0`, so a narrower projection weakens it without failing. Task 5 Step 5 adds the id assertion that closes this; do not skip it.
2. **A patient name reaching a `summary` or `target`.** Every classifier must use a record reference — `licenseNumber`, `mrn`, `reference`, `subjectLabel` — never `name`. `logs.api.test.ts` checks the whole corpus against the canonical roster, which is the durable guard.
3. **An import cycle.** `logs.ts` imports *types only* from `administration.types.ts`; `administration.api.ts` imports `logs.ts`; `logs.api.ts` imports `administration.api.ts`. Adding a value import from `administration.api.ts` into `logs.ts` closes the loop. ADM-01 had to break exactly this kind of cycle mid-implementation.
4. **A non-deterministic seed.** The System corpus must be index-driven, not `Math.random()`. A log that reshuffles on re-render is not a log.

**One §3.7 detail deliberately not delivered:** virtual scrolling. The paginated interface holds one page of 50, so windowing would optimise a list that is already short. It becomes relevant when a real server serves real volume, and the service interface is already shaped for that.
