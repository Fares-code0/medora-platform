# ADM-01 Admin Overview Implementation Plan

> **Historical implementation plan — not a task register** (labelled 2026-10-26). The work this plan describes has landed. Its checkboxes are the plan's steps as written and were never ticked, so they record nothing about what is done or open. Current status of ADM-01: [`frontend/FRONTEND_CHECKLIST.md`](../../../frontend/FRONTEND_CHECKLIST.md) §13.4.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the admin area's clinic-flavoured home page with the Administrator Overview UX §3.1 specifies — security alerts, four KPIs, a 30-day platform activity chart, an admin action queue, storage/funnel/system-health, and the two activity feeds — deriving every count from the ADM-02/04/05 stores already in the query cache.

**Architecture:** A new module `frontend/src/features/admin/overview/` in the Phase C shape: a pure rules file with no I/O, a thin mock service for what no store holds, TanStack Query hooks, and one component per row of the §3.1 grid. The page reads `useDoctorsDocument()`, `usePatientsDocument()`, `useOversightDocument()`, `useAuditEvents()` and `usePhiAccessLog()` and derives its numbers; only the activity series, service health, storage/licence and the polled active-user count come from a service. It then becomes the `/admin` index, Clinic Overview moves to `/admin/clinic`, and Platform Overview is deleted.

**Tech Stack:** React 19 · TypeScript (strict) · TanStack Query v5 · React Router v7 · Tailwind (design-system tokens only) · Vitest + Testing Library · the in-repo `@/components/charts` SVG chart library (no third-party chart dependency).

**Spec of record:** [`docs/superpowers/specs/2026-08-12-adm-01-admin-overview-design.md`](../specs/2026-08-12-adm-01-admin-overview-design.md)

## Global Constraints

Every task's requirements implicitly include this section.

- **Working directory is `frontend/`.** Every path in this plan is relative to the repository root; every command is run from `frontend/`.
- **`backend/` is off-limits.** This is frontend-only work.
- **TypeScript strict.** No `any`, no non-null assertions. Domain types are `readonly` on every field and `readonly T[]` for arrays — match the existing `*.types.ts` files exactly.
- **Pure rules take `now: number`.** No function in `overview.ts` may call `Date.now()`. `doctors.ts`, `patients.ts` and `oversight.ts` all follow this and it is what makes the window rules testable.
- **No string-literal routes in components.** Every href comes from `routes` in `src/routes/index.ts`.
- **PHI:** any patient name, MRN, phone or email rendered in the admin area goes through `MaskedIdentifier` from `@/features/admin/phi`. Doctor names are not PHI.
- **Design tokens only.** Colours come from `text-text-primary`, `bg-surface`, `border-border`, `text-success` etc. No raw hex, no `text-gray-500`.
- **Numbers are `tabular-nums`.** Every count, percentage and timestamp column.
- **Comments explain *why*.** The house style is a file-header block stating what the module is responsible for and which UX section it implements, then comments only where a reader would otherwise ask "why is it done this way". Do not narrate what the code plainly does.
- **Deep-import across admin modules — there are no barrels.** Only `phi/` has an `index.ts`; `doctors/`, `patients/` and `appointments/` do not, deliberately (see the note in `features/admin/index.ts` about the entry chunk). Import from the exact file: `'../doctors/doctors'`, `'../doctors/doctors.types'`, `'../doctors/doctors.queries'`, `'../patients/patients'`, `'../appointments/oversight'`, `'../appointments/oversight.queries'`. `'../doctors'` will not resolve.
- **Quality gates, run from `frontend/` before every commit:**
  ```bash
  npm run typecheck && npm run lint && npm run test
  ```
- **Commit after every task.** Conventional-commit subject, `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` as the last line.

### Named constants introduced by this plan

Declared in `overview.ts` (Task 1) and imported everywhere else — never re-typed as literals:

| Constant | Value | Meaning |
| --- | --- | --- |
| `FAILED_SIGN_IN_THRESHOLD` | `5` | failed/blocked sign-ins in the alert window that raise an alert |
| `PHI_BURST_THRESHOLD` | `6` | reveals by one actor in the burst window that raise an alert |
| `ALERT_WINDOW_DAYS` | `7` | lookback for sign-in and audit alerts |
| `PHI_BURST_WINDOW_HOURS` | `24` | lookback for the PHI reveal burst rule |
| `LICENCE_EXPIRY_DAYS` | `30` | "licence expiring soon" horizon for the action queue. **Lives in `doctors/doctors.ts`**, beside `isExpiringSoon` — it is a statement about a doctor's credentials, and importing it back from `overview.ts` made the two modules a cycle. |
| `FUNNEL_WINDOW_DAYS` | `7` | funnel window — must equal the window `summarize()` uses |
| `SIGNUP_FEED_LIMIT` | `6` | rows in the Recent Signups feed |

---

## File Structure

**Created**

| File | Responsibility |
| --- | --- |
| `frontend/src/features/admin/overview/overview.types.ts` | Domain types for alerts, queue rows, KPIs, funnel, signups, served signals |
| `frontend/src/features/admin/overview/overview.ts` | Every derivation, pure. No React, no I/O, no clock |
| `frontend/src/features/admin/overview/overview.test.ts` | Tests for the above |
| `frontend/src/features/admin/overview/overview.api.ts` | Mock service: activity series, service health, storage/licence, active users |
| `frontend/src/features/admin/overview/overview.api.test.ts` | Tests for the service |
| `frontend/src/features/admin/overview/overview.queries.ts` | `useOverviewSignals()`, `useActiveUsers()` |
| `frontend/src/features/admin/overview/SecurityAlertsBanner.tsx` | Row 0 |
| `frontend/src/features/admin/overview/OverviewKpiRow.tsx` | Row 1 |
| `frontend/src/features/admin/overview/PlatformActivityChart.tsx` | Row 2 left |
| `frontend/src/features/admin/overview/ActionQueueCard.tsx` | Row 2 right |
| `frontend/src/features/admin/overview/StorageUsageCard.tsx` | Row 3 left |
| `frontend/src/features/admin/overview/AppointmentFunnelCard.tsx` | Row 3 centre |
| `frontend/src/features/admin/overview/SystemHealthCard.tsx` | Row 3 right |
| `frontend/src/features/admin/overview/ActivityFeeds.tsx` | Row 4 — admin activity + signups |
| `frontend/src/features/admin/overview/AdminOverviewSection.tsx` | The page: composes rows, owns the single clock |
| `frontend/src/features/admin/overview/AdminOverviewSection.test.tsx` | Page-level tests |

**Modified**

| File | Change |
| --- | --- |
| `frontend/src/routes/index.ts` | `AdminSectionSlug`: drop `platform`, add `clinic` |
| `frontend/src/features/admin/administration.meta.ts` | `SECTION_META`: relabel `overview`, add `clinic`, drop `platform` |
| `frontend/src/layouts/navigation.ts` | First nav group: Overview → `/admin`, Clinic Overview → `/admin/clinic` |
| `frontend/src/features/admin/routes.tsx` | Index → `AdminOverviewSection`; `clinic` section; `platform` → redirect |
| `frontend/src/features/admin/admin-profile.ts` | `resolveLandingSection()` fallback for retired slugs |
| `frontend/src/features/admin/doctors/doctors.ts` | `DoctorFilters.expiring`, `EMPTY_FILTERS`, `matchesFilters`, `licenceExpiringSoon` |
| `frontend/src/features/admin/doctors/doctors.types.ts` | `DoctorFilters.expiring` |
| `frontend/src/features/admin/doctors/DoctorsSection.tsx` | Seed `tab` and `expiring` from the URL; expiring toolbar toggle |
| `frontend/src/features/admin/patients/patients.ts` | `PatientFilters.openWork`, `EMPTY_FILTERS`, `matchesFilters` |
| `frontend/src/features/admin/patients/patients.types.ts` | `PatientFilters.openWork` |
| `frontend/src/features/admin/patients/PatientsSection.tsx` | Seed `openWork` from `?flag=open`; toolbar toggle |
| `frontend/src/features/admin/appointments/AppointmentOversightSection.tsx` | Seed `flag` from `?flag=` alongside the existing `?doctor=` |
| `frontend/FRONTEND_CHECKLIST.md` | ADM-01 row, §4 intro, Phase C roadmap |

**Deleted**

| File | Why |
| --- | --- |
| `frontend/src/features/admin/sections/PlatformOverviewSection.tsx` | Absorbed — its panels are §3.1 rows 3–4 |

---

### Task 1: Pure derivations

The whole screen's honesty lives here. Everything is a function of documents the other modules already own, so a mutation on ADM-03 or ADM-05 changes these numbers with no refetch.

**Files:**
- Create: `frontend/src/features/admin/overview/overview.types.ts`
- Create: `frontend/src/features/admin/overview/overview.ts`
- Test: `frontend/src/features/admin/overview/overview.test.ts`

**Interfaces:**
- Consumes: `tabCounts`, `failedSignInCount`, `hasImpossibleTravel`, `VERIFICATION_LABEL`, `VERIFICATION_VARIANT`, `ACCOUNT_LABEL` from `../doctors/doctors` and `DoctorRecord` from `../doctors/doctors.types`; `openWorkCount`, `STATUS_LABEL`, `STATUS_VARIANT` from `../patients/patients` and `PatientAccount` from `../patients/patients.types`; `summarize` from `../appointments/oversight` and `OversightAppointment`, `OversightStatus`, `PlatformDoctor` from `../appointments/oversight.types`; `AuditEvent`, `PhiAccessEvent` from `../administration.types`; `routes` from `@/routes`; `NamedSeries` and `BadgeVariant` from the component library.
- Produces:
  - `deriveKpis(doctors, patients, appointments, roster, now): OverviewKpis`
  - `deriveActionQueue(doctors, patients, appointments, now): readonly ActionQueueRow[]`
  - `deriveSecurityAlerts(doctors, phiLog, auditEvents, now): readonly SecurityAlert[]`
  - `deriveFunnel(appointments, now): AppointmentFunnel`
  - `deriveSignups(doctors, patients): readonly SignupEntry[]`
  - `alertDestination(alert): string`
  - (`licenceExpiringSoon(doctor, now)` was moved to `doctors/doctors.ts` during Task 3 to break an import cycle; `overview.ts` imports it from there.)
  - `isFreshDeployment(doctors, patients): boolean`
  - `ALERT_SEVERITY_VARIANT`, `formatCheckedAt`
  - the seven constants in Global Constraints

- [ ] **Step 1: Write `overview.types.ts`**

```ts
/**
 * Admin Overview — domain types (ADM-01 · UX §3.1).
 *
 * Two families live here and they are deliberately separate. The *derived*
 * types (alerts, queue rows, KPIs, funnel, signups) are computed from
 * documents ADM-02, ADM-04 and ADM-05 already hold, so they are never
 * fetched and can never be stale relative to the pages they link to. The
 * *served* types (`OverviewSignals`) cover only what no store holds:
 * platform telemetry, service health and licence usage.
 */

import type { NamedSeries } from '@/components/charts';
import type { BadgeVariant } from '@/components/ui';

/* ── Security alerts (Row 0) ──────────────────────────────────── */

export type AlertSeverity = 'warning' | 'critical';

/**
 * The alert kinds that have a real source today. §3.1 also names flagged
 * communications; that needs ADM-06 and is deliberately absent rather than
 * seeded — see the spec, "Out of scope".
 */
export type SecurityAlertKind =
  | 'failed-sign-ins'
  | 'impossible-travel'
  | 'phi-burst'
  | 'critical-audit';

export interface SecurityAlert {
  readonly id: string;
  readonly kind: SecurityAlertKind;
  readonly severity: AlertSeverity;
  readonly summary: string;
  readonly at: string;
  /** The doctor this alert is about, when it is about one. */
  readonly subjectId: string | null;
}

/* ── Action queue (Row 2 right) ───────────────────────────────── */

export type ActionQueueKind =
  | 'verifications'
  | 'licence-expiries'
  | 'patient-flags'
  | 'stuck-appointments';

export interface ActionQueueRow {
  readonly kind: ActionQueueKind;
  readonly label: string;
  readonly count: number;
  /** Destination with its filter already applied. */
  readonly to: string;
}

/* ── KPIs (Row 1) ─────────────────────────────────────────────── */

export interface OverviewKpis {
  readonly verifiedDoctors: number;
  /** Only decisions an administrator can act on — `docs-requested` is not one. */
  readonly pendingVerifications: number;
  readonly totalPatients: number;
  readonly activePatients: number;
  readonly appointmentsToday: number;
  /** Mean load across doctors who are taking appointments at all. */
  readonly utilizationPercent: number;
}

/* ── Funnel (Row 3 centre) ────────────────────────────────────── */

export interface FunnelStage {
  readonly label: string;
  readonly value: number;
}

export interface AppointmentFunnel {
  readonly stages: readonly FunnelStage[];
  readonly cancellationRate7d: number;
  readonly noShowRate7d: number;
  /** Denominator behind both rates and behind the funnel's first stage. */
  readonly window7dTotal: number;
}

/* ── Signups (Row 4 right) ────────────────────────────────────── */

export type SignupRole = 'doctor' | 'patient';

export interface SignupEntry {
  readonly id: string;
  readonly name: string;
  readonly role: SignupRole;
  readonly at: string;
  readonly stateLabel: string;
  readonly stateVariant: BadgeVariant;
}

/* ── Served signals ───────────────────────────────────────────── */

export type ServiceStatus = 'operational' | 'degraded' | 'down';

export interface ServiceHealth {
  readonly id: string;
  readonly name: string;
  readonly status: ServiceStatus;
  readonly uptimePercent: number;
  readonly lastCheckedAt: string;
  /** Present when degraded or down; §3.1 links a degraded service to it. */
  readonly incidentNote: string | null;
}

export interface StorageUsage {
  readonly usedGb: number;
  readonly totalGb: number;
  readonly plan: string;
  readonly seatsUsed: number;
  readonly seatsTotal: number;
  readonly renewsOn: string;
}

export type ActivityRange = '7d' | '30d';

export interface OverviewSignals {
  /** Daily active users · appointments booked · messages sent. */
  readonly activity: readonly NamedSeries[];
  readonly services: readonly ServiceHealth[];
  readonly storage: StorageUsage;
}
```

- [ ] **Step 2: Write the failing tests**

Create `frontend/src/features/admin/overview/overview.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { AuditEvent, PhiAccessEvent } from '../administration.types';
import { summarize } from '../appointments/oversight';
import type { OversightAppointment, PlatformDoctor } from '../appointments/oversight.types';
import type { DoctorRecord } from '../doctors/doctors.types';
import { openWorkCount } from '../patients/patients';
import type { PatientAccount } from '../patients/patients.types';

import {
  ALERT_WINDOW_DAYS,
  alertDestination,
  deriveActionQueue,
  deriveFunnel,
  deriveKpis,
  deriveSecurityAlerts,
  deriveSignups,
  FAILED_SIGN_IN_THRESHOLD,
  isFreshDeployment,
  licenceExpiringSoon,
  LICENCE_EXPIRY_DAYS,
  PHI_BURST_THRESHOLD,
  SIGNUP_FEED_LIMIT,
} from './overview';

/**
 * The pure rules behind ADM-01 (UX §3.1).
 *
 * The claims worth pinning down are the ones a later UI change could
 * quietly break: that a queue count equals what its linked page shows for
 * the same filter, that the funnel's first stage and its two rates share one
 * denominator, that every alert kind has somewhere real to go, and that
 * thresholds fire *at* the boundary and not below it.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const NOW = Date.parse('2026-08-12T12:00:00.000Z');

const daysAgo = (days: number): string => new Date(NOW - days * DAY_MS).toISOString();
const hoursAgo = (hours: number): string => new Date(NOW - hours * HOUR_MS).toISOString();
const daysAhead = (days: number): string => new Date(NOW + days * DAY_MS).toISOString();

function doctor(overrides: Partial<DoctorRecord> = {}): DoctorRecord {
  return {
    id: 'dr-chen',
    name: 'Dr. Amelia Chen',
    title: 'Consultant',
    email: 'chen@medora.health',
    phone: '+1 555 0100',
    specialty: 'Cardiology',
    licenseNumber: 'LIC-1',
    languages: ['English'],
    bio: '',
    joinedAt: daysAgo(400),
    lastActiveAt: daysAgo(1),
    verification: 'verified',
    verificationNote: null,
    account: 'active',
    suspensionReason: null,
    administrative: { roleTemplate: 'Doctor', clinic: 'Main' },
    patientsCount: 10,
    appointments30d: 20,
    documents: [],
    logins: [],
    activity: {
      recordsEdited: 0,
      prescriptionsIssued: 0,
      labsReviewed: 0,
      messagesSent: 0,
      windowDays: 30,
    },
    statistics: {
      patientsServed: 0,
      rating: 4.5,
      ratingDistribution: [0, 0, 0, 0, 0],
      avgResponseHours: 2,
      monthlyVolume: [],
    },
    audit: [],
    ...overrides,
  };
}

function patient(overrides: Partial<PatientAccount> = {}): PatientAccount {
  return {
    id: 'pt-1',
    name: 'Sofia Marino',
    mrn: 'MRN-1',
    email: 'sofia@example.com',
    phone: '+1 555 0111',
    dateOfBirth: '1980-01-01',
    status: 'active',
    lockCause: null,
    registeredAt: daysAgo(10),
    lastActivityAt: daysAgo(1),
    assignedDoctors: [],
    deactivationReason: null,
    grants: [],
    accessRequests: [],
    events: [],
    flags: [],
    ...overrides,
  };
}

function appointment(overrides: Partial<OversightAppointment> = {}): OversightAppointment {
  return {
    id: 'ap-1',
    reference: 'APT-1',
    startsAt: daysAgo(1),
    durationMin: 30,
    visitType: 'Follow-up',
    department: 'Cardiology',
    specialty: 'Cardiology',
    doctorId: 'dr-chen',
    doctorName: 'Dr. Amelia Chen',
    patientId: 'pt-1',
    patientName: 'Sofia Marino',
    patientMrn: 'MRN-1',
    status: 'completed',
    stateSince: daysAgo(1),
    rescheduleCount: 0,
    complaint: null,
    lastNudgedAt: null,
    events: [],
    notifications: [],
    ...overrides,
  };
}

const roster: readonly PlatformDoctor[] = [
  {
    id: 'dr-chen',
    name: 'Dr. Amelia Chen',
    specialty: 'Cardiology',
    department: 'Cardiology',
    availability: 'available',
    openSlotsToday: 3,
    loadPercent: 60,
    note: null,
  },
  {
    id: 'dr-okafor',
    name: 'Dr. Ben Okafor',
    specialty: 'Neurology',
    department: 'Neurology',
    availability: 'unavailable',
    openSlotsToday: 0,
    loadPercent: 0,
    note: 'On leave',
  },
];

describe('deriveKpis', () => {
  it('counts verified doctors and quotes only admin-actionable pending ones', () => {
    const doctors = [
      doctor({ id: 'a', verification: 'verified' }),
      doctor({ id: 'b', verification: 'pending' }),
      // Waiting on the doctor, not on an administrator — must not be quoted.
      doctor({ id: 'c', verification: 'docs-requested' }),
    ];

    const kpis = deriveKpis(doctors, [], [], roster, NOW);

    expect(kpis.verifiedDoctors).toBe(1);
    expect(kpis.pendingVerifications).toBe(1);
  });

  it('averages utilization over doctors who are taking appointments at all', () => {
    // dr-okafor is unavailable, so averaging them in would report 30%
    // utilization for a clinic running at 60%.
    const kpis = deriveKpis([], [], [], roster, NOW);

    expect(kpis.utilizationPercent).toBe(60);
  });

  it('reports zero utilization rather than dividing by zero with no roster', () => {
    expect(deriveKpis([], [], [], [], NOW).utilizationPercent).toBe(0);
  });
});

describe('deriveActionQueue', () => {
  it('counts pending verifications and links to the tab that shows them', () => {
    const doctors = [
      doctor({ id: 'a', verification: 'pending' }),
      doctor({ id: 'b', verification: 'docs-requested' }),
    ];

    const row = deriveActionQueue(doctors, [], [], NOW).find((r) => r.kind === 'verifications');

    expect(row?.count).toBe(1);
    expect(row?.to).toBe('/admin/doctors?tab=pending');
  });

  it('counts accounts by ADM-04’s own open-work rule, not a second one', () => {
    const patients = [
      patient({
        id: 'p1',
        flags: [{ id: 'f1', kind: 'data-correction', summary: 'Wrong DOB', openedAt: daysAgo(2) }],
      }),
      patient({ id: 'p2' }),
    ];

    const row = deriveActionQueue([], patients, [], NOW).find((r) => r.kind === 'patient-flags');

    // The guard against the count and its destination drifting apart: both
    // sides must be `openWorkCount(...) > 0` and nothing else.
    expect(row?.count).toBe(patients.filter((p) => openWorkCount(p) > 0).length);
    expect(row?.to).toBe('/admin/patients?flag=open');
  });

  it('agrees with summarize() about how many appointments are stuck', () => {
    const appointments = [
      appointment({ id: 'a', status: 'pending', stateSince: daysAgo(3) }),
      appointment({ id: 'b', status: 'pending', stateSince: hoursAgo(2) }),
    ];

    const row = deriveActionQueue([], [], appointments, NOW).find(
      (r) => r.kind === 'stuck-appointments',
    );

    expect(row?.count).toBe(summarize(appointments, NOW).pendingOverThreshold);
    expect(row?.to).toBe('/admin/appointments?flag=stuck-pending');
  });
});

describe('licenceExpiringSoon', () => {
  const withLicence = (expiresAt: string | null): DoctorRecord =>
    doctor({
      documents: [
        {
          id: 'd1',
          kind: 'medical-license',
          filename: 'licence.pdf',
          uploadedAt: daysAgo(200),
          expiresAt,
          decision: 'approved',
          checklist: { authentic: true, current: true, matchesIdentity: true },
          rejectionReason: null,
          reviewedBy: 'Marcus Reed',
          reviewedAt: daysAgo(199),
          previewLines: [],
        },
      ],
    });

  it('fires inside the horizon and not outside it', () => {
    expect(licenceExpiringSoon(withLicence(daysAhead(LICENCE_EXPIRY_DAYS - 1)), NOW)).toBe(true);
    expect(licenceExpiringSoon(withLicence(daysAhead(LICENCE_EXPIRY_DAYS + 1)), NOW)).toBe(false);
  });

  it('counts an already-expired licence — it is more urgent, not less', () => {
    expect(licenceExpiringSoon(withLicence(daysAgo(1)), NOW)).toBe(true);
  });

  it('ignores documents that do not expire', () => {
    expect(licenceExpiringSoon(withLicence(null), NOW)).toBe(false);
  });
});

describe('deriveSecurityAlerts', () => {
  const failedLogins = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      id: `l${String(index)}`,
      at: daysAgo(1),
      ip: '10.0.0.1',
      device: 'Chrome',
      location: 'Berlin',
      result: 'failed' as const,
      impossibleTravel: false,
    }));

  it('fires at the failed sign-in threshold and not one below it', () => {
    const below = doctor({ logins: failedLogins(FAILED_SIGN_IN_THRESHOLD - 1) });
    const at = doctor({ logins: failedLogins(FAILED_SIGN_IN_THRESHOLD) });

    expect(deriveSecurityAlerts([below], [], [], NOW)).toHaveLength(0);
    expect(deriveSecurityAlerts([at], [], [], NOW)).toHaveLength(1);
  });

  it('treats impossible travel as critical', () => {
    const flagged = doctor({
      logins: [
        {
          id: 'l1',
          at: daysAgo(1),
          ip: '10.0.0.1',
          device: 'Chrome',
          location: 'Tokyo',
          result: 'success',
          impossibleTravel: true,
        },
      ],
    });

    const [alert] = deriveSecurityAlerts([flagged], [], [], NOW);

    expect(alert?.kind).toBe('impossible-travel');
    expect(alert?.severity).toBe('critical');
  });

  it('raises one burst alert per actor, not one per reveal', () => {
    const log: readonly PhiAccessEvent[] = Array.from(
      { length: PHI_BURST_THRESHOLD },
      (_, index) => ({
        id: `e${String(index)}`,
        actor: 'Marcus Reed',
        subjectId: `pt-${String(index)}`,
        subjectLabel: `Patient ${String(index)}`,
        category: 'clinical-review',
        reason: 'Reviewing a complaint thread end to end',
        at: hoursAgo(1),
        durationMinutes: 15,
      }),
    );

    const alerts = deriveSecurityAlerts([], log, [], NOW);

    expect(alerts.filter((a) => a.kind === 'phi-burst')).toHaveLength(1);
  });

  it('ignores audit events older than the alert window', () => {
    const stale: readonly AuditEvent[] = [
      {
        id: 'a1',
        actor: 'Marcus Reed',
        action: 'Permission matrix saved',
        target: 'Roles',
        at: daysAgo(ALERT_WINDOW_DAYS + 1),
        severity: 'critical',
      },
    ];

    expect(deriveSecurityAlerts([], [], stale, NOW)).toHaveLength(0);
  });

  it('orders critical alerts ahead of warnings', () => {
    const doctors = [
      doctor({ id: 'a', logins: failedLogins(FAILED_SIGN_IN_THRESHOLD) }),
      doctor({
        id: 'b',
        logins: [
          {
            id: 'l1',
            at: daysAgo(2),
            ip: '10.0.0.2',
            device: 'Safari',
            location: 'Tokyo',
            result: 'success',
            impossibleTravel: true,
          },
        ],
      }),
    ];

    const alerts = deriveSecurityAlerts(doctors, [], [], NOW);

    expect(alerts[0]?.severity).toBe('critical');
  });
});

describe('alertDestination', () => {
  it('sends a doctor sign-in alert to that doctor’s activity tab', () => {
    const to = alertDestination({
      id: 'x',
      kind: 'impossible-travel',
      severity: 'critical',
      summary: '',
      at: daysAgo(1),
      subjectId: 'dr-chen',
    });

    expect(to).toBe('/admin/doctors/dr-chen?tab=activity');
  });

  it('gives every alert kind a real destination', () => {
    const kinds = [
      'failed-sign-ins',
      'impossible-travel',
      'phi-burst',
      'critical-audit',
    ] as const;

    for (const kind of kinds) {
      const to = alertDestination({
        id: 'x',
        kind,
        severity: 'warning',
        summary: '',
        at: daysAgo(1),
        subjectId: 'dr-chen',
      });
      expect(to.startsWith('/admin/')).toBe(true);
    }
  });

  it('falls back to the doctors list when a doctor alert has no subject', () => {
    const to = alertDestination({
      id: 'x',
      kind: 'failed-sign-ins',
      severity: 'warning',
      summary: '',
      at: daysAgo(1),
      subjectId: null,
    });

    expect(to).toBe('/admin/doctors');
  });
});

describe('deriveFunnel', () => {
  const appointments = [
    appointment({ id: '1', status: 'completed' }),
    appointment({ id: '2', status: 'confirmed' }),
    appointment({ id: '3', status: 'pending' }),
    appointment({ id: '4', status: 'cancelled' }),
    appointment({ id: '5', status: 'no-show' }),
  ];

  it('shares one denominator with the rates quoted beside it', () => {
    const funnel = deriveFunnel(appointments, NOW);
    const summary = summarize(appointments, NOW);

    expect(funnel.stages[0]?.value).toBe(summary.window7dTotal);
    expect(funnel.window7dTotal).toBe(summary.window7dTotal);
    expect(funnel.cancellationRate7d).toBe(summary.cancellationRate7d);
    expect(funnel.noShowRate7d).toBe(summary.noShowRate7d);
  });

  it('narrows monotonically from requested to completed', () => {
    const values = deriveFunnel(appointments, NOW).stages.map((stage) => stage.value);

    expect(values[0]).toBeGreaterThanOrEqual(values[1] ?? 0);
    expect(values[1]).toBeGreaterThanOrEqual(values[2] ?? 0);
  });

  it('reports an empty window rather than three zeros with no explanation', () => {
    const funnel = deriveFunnel([], NOW);

    expect(funnel.window7dTotal).toBe(0);
    expect(funnel.cancellationRate7d).toBe(0);
  });
});

describe('deriveSignups', () => {
  it('merges doctors and patients newest first', () => {
    const entries = deriveSignups(
      [doctor({ id: 'd1', joinedAt: daysAgo(5) })],
      [patient({ id: 'p1', registeredAt: daysAgo(1) })],
    );

    expect(entries.map((entry) => entry.id)).toEqual(['p1', 'd1']);
  });

  it('tags each entry with the role that decides whether it is masked', () => {
    const entries = deriveSignups([doctor({ id: 'd1' })], [patient({ id: 'p1' })]);

    expect(entries.find((entry) => entry.id === 'p1')?.role).toBe('patient');
    expect(entries.find((entry) => entry.id === 'd1')?.role).toBe('doctor');
  });

  it('caps the feed', () => {
    const patients = Array.from({ length: SIGNUP_FEED_LIMIT + 3 }, (_, index) =>
      patient({ id: `p${String(index)}`, registeredAt: daysAgo(index) }),
    );

    expect(deriveSignups([], patients)).toHaveLength(SIGNUP_FEED_LIMIT);
  });
});

describe('isFreshDeployment', () => {
  it('is true only with no doctors and no patients', () => {
    expect(isFreshDeployment([], [])).toBe(true);
    expect(isFreshDeployment([doctor()], [])).toBe(false);
    expect(isFreshDeployment([], [patient()])).toBe(false);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npm run test -- src/features/admin/overview/overview.test.ts
```

Expected: FAIL — `Failed to resolve import "./overview"`.

- [ ] **Step 4: Write `overview.ts`**

```ts
/**
 * Admin Overview — pure derivations (ADM-01 · UX §3.1).
 *
 * Every number on the overview that an administrator can act on is computed
 * here from documents ADM-02, ADM-04 and ADM-05 already hold. That is the
 * point: those modules' mutations resolve to a full patched document written
 * straight into the query cache, so completing a verification or cancelling
 * an appointment changes this page with no refetch and no window in which
 * the Home badge and the page it links to disagree.
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
import {
  ACCOUNT_LABEL,
  failedSignInCount,
  hasImpossibleTravel,
  tabCounts,
  VERIFICATION_LABEL,
  VERIFICATION_VARIANT,
} from '../doctors/doctors';
import type { DoctorRecord } from '../doctors/doctors.types';
import { openWorkCount, STATUS_LABEL, STATUS_VARIANT } from '../patients/patients';
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
export const LICENCE_EXPIRY_DAYS = 30;
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
      : Math.round(taking.reduce((sum, entry) => sum + entry.loadPercent, 0) / taking.length);

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

/**
 * A doctor whose medical licence expires inside the horizon — or already
 * has. An expired licence counts: it is the more urgent case, not the one
 * that has fallen off the end of a window.
 *
 * Deliberately narrower than `isExpiringSoon` from ADM-02, which warns at 60
 * days across every document kind. This row is about practising credentials.
 */
export function licenceExpiringSoon(doctor: DoctorRecord, now: number): boolean {
  return doctor.documents.some((document) => {
    if (document.kind !== 'medical-license') return false;
    if (document.expiresAt === null) return false;
    const expires = new Date(document.expiresAt).getTime();
    if (Number.isNaN(expires)) return false;
    return expires <= now + LICENCE_EXPIRY_DAYS * DAY_MS;
  });
}

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
  ];
}

/* ── Security alerts ──────────────────────────────────────────── */

function mostRecent(values: readonly string[], fallback: string): string {
  return values.reduce((latest, value) => (value > latest ? value : latest), fallback);
}

export function deriveSecurityAlerts(
  doctors: readonly DoctorRecord[],
  phiLog: readonly PhiAccessEvent[],
  auditEvents: readonly AuditEvent[],
  now: number,
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
      id: `phi-burst:${actor}`,
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

  return [...alerts].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
    return b.at.localeCompare(a.at);
  });
}

/**
 * Where an alert can actually be investigated *today*. ADM-07 System Logs is
 * not built, so pointing "Investigate" at `/admin/logs` would be a dead
 * click on the admin's home page. Each kind goes to the screen that already
 * holds its evidence; when ADM-07 lands, this map is the single thing that
 * changes.
 */
export function alertDestination(alert: SecurityAlert): string {
  switch (alert.kind) {
    case 'failed-sign-ins':
    case 'impossible-travel':
      return alert.subjectId === null
        ? routes.admin.doctors
        : `${routes.admin.doctor(alert.subjectId)}?tab=activity`;
    case 'phi-burst':
    case 'critical-audit':
      return routes.admin.settings('audit');
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
    stateLabel:
      doctor.account === 'active'
        ? VERIFICATION_LABEL[doctor.verification]
        : ACCOUNT_LABEL[doctor.account],
    stateVariant: VERIFICATION_VARIANT[doctor.verification],
  }));

  const fromPatients: SignupEntry[] = patients.map((patient) => ({
    id: patient.id,
    name: patient.name,
    role: 'patient',
    at: patient.registeredAt,
    stateLabel: STATUS_LABEL[patient.status],
    stateVariant: STATUS_VARIANT[patient.status],
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
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm run test -- src/features/admin/overview/overview.test.ts
```

Expected: PASS, all suites.

If any lint rule fires, fix the code it points at — never silence the rule.

- [ ] **Step 6: Run the gates**

```bash
npm run typecheck && npm run lint && npm run test
```

Expected: no errors; the full suite passes.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/admin/overview
git commit -m "feat(adm-01): derive overview KPIs, action queue and security alerts"
```

---

### Task 2: The thin service and its query hooks

Only what no store holds: platform telemetry, service health, licence/storage, and the polled active-user count.

**Files:**
- Create: `frontend/src/features/admin/overview/overview.api.ts`
- Create: `frontend/src/features/admin/overview/overview.queries.ts`
- Test: `frontend/src/features/admin/overview/overview.api.test.ts`

**Interfaces:**
- Consumes: `OverviewSignals`, `ServiceHealth`, `StorageUsage`, `ActivityRange` from `./overview.types`.
- Produces: `overviewApi.signals(range: ActivityRange): Promise<OverviewSignals>`, `overviewApi.activeUsers(): Promise<number>`, `useOverviewSignals(range)`, `useActiveUsers()`, `overviewKeys`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/features/admin/overview/overview.api.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { overviewApi } from './overview.api';

/**
 * The service exists to supply exactly what no store can. The tests hold it
 * to that: three named series an administrator can read together, a service
 * list where every degraded entry explains itself, and an active-user count
 * that moves.
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

  it('reports storage inside its own capacity', async () => {
    const { storage } = await overviewApi.signals('30d');

    expect(storage.usedGb).toBeLessThanOrEqual(storage.totalGb);
    expect(storage.seatsUsed).toBeLessThanOrEqual(storage.seatsTotal);
  });
});

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
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npm run test -- src/features/admin/overview/overview.api.test.ts
```

Expected: FAIL — `Failed to resolve import "./overview.api"`.

- [ ] **Step 3: Write `overview.api.ts`**

```ts
/**
 * Admin Overview — mock service (ADM-01 · UX §3.1).
 *
 * Deliberately small. Everything an administrator can *act* on is derived in
 * `overview.ts` from the ADM-02/04/05 documents; this file covers only the
 * four things no store holds — platform telemetry, service health, licence
 * and storage usage, and the live active-user count.
 *
 * The series are generated rather than hand-listed so the range switch has
 * something real to switch, and every series shares one x-axis: three lines
 * on different day labels would be three charts stacked on top of each other.
 */

import type { NamedSeries, SeriesPoint } from '@/components/charts';

import type { ActivityRange, OverviewSignals, ServiceHealth, StorageUsage } from './overview.types';

const LATENCY_MS = 260;
const DAY_MS = 86_400_000;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

const RANGE_DAYS: Record<ActivityRange, number> = { '7d': 7, '30d': 30 };

function dayLabels(days: number, now: number): readonly string[] {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(now - (days - 1 - index) * DAY_MS);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  });
}

/**
 * A smooth weekly-seasonal series — weekday peaks, weekend troughs — so the
 * chart reads like platform traffic instead of noise. Deterministic in the
 * index, so a re-render never reshuffles the line under the reader.
 */
function seasonal(labels: readonly string[], base: number, amplitude: number): readonly SeriesPoint[] {
  return labels.map((label, index) => {
    const weekly = Math.sin((index / 7) * Math.PI * 2);
    const drift = index * (amplitude / 40);
    return { label, value: Math.max(0, Math.round(base + weekly * amplitude + drift)) };
  });
}

const SERVICES: readonly ServiceHealth[] = [
  {
    id: 'api',
    name: 'API',
    status: 'operational',
    uptimePercent: 99.98,
    lastCheckedAt: new Date(Date.now() - 60_000).toISOString(),
    incidentNote: null,
  },
  {
    id: 'notifications',
    name: 'Notifications',
    status: 'degraded',
    uptimePercent: 99.2,
    lastCheckedAt: new Date(Date.now() - 120_000).toISOString(),
    incidentNote: 'SMS provider retries elevated since 09:40. Email unaffected.',
  },
  {
    id: 'ai',
    name: 'AI service',
    status: 'operational',
    uptimePercent: 99.7,
    lastCheckedAt: new Date(Date.now() - 90_000).toISOString(),
    incidentNote: null,
  },
  {
    id: 'storage',
    name: 'Storage',
    status: 'operational',
    uptimePercent: 100,
    lastCheckedAt: new Date(Date.now() - 45_000).toISOString(),
    incidentNote: null,
  },
];

const STORAGE: StorageUsage = {
  usedGb: 412,
  totalGb: 1024,
  plan: 'Enterprise',
  seatsUsed: 38,
  seatsTotal: 50,
  renewsOn: '2027-03-01',
};

export const overviewApi = {
  signals(range: ActivityRange): Promise<OverviewSignals> {
    const labels = dayLabels(RANGE_DAYS[range], Date.now());
    const activity: readonly NamedSeries[] = [
      { name: 'Daily active users', tone: 'primary', points: seasonal(labels, 180, 45) },
      { name: 'Appointments booked', tone: 'success', points: seasonal(labels, 64, 22) },
      { name: 'Messages sent', tone: 'info', points: seasonal(labels, 120, 36) },
    ];
    return delay({ activity, services: SERVICES, storage: STORAGE });
  },

  /**
   * The one polled value on the page. Jitters around a base so the KPI has
   * something to fade between; §3.1 forbids animating it as a count-up.
   */
  activeUsers(): Promise<number> {
    const base = 46;
    const jitter = Math.floor(Math.random() * 13) - 6;
    return delay(Math.max(0, base + jitter));
  },
} as const;
```

- [ ] **Step 4: Write `overview.queries.ts`**

```ts
/**
 * Admin Overview — TanStack Query hooks (ADM-01).
 *
 * Two queries, and only two: the page's actionable numbers come from the
 * ADM-02/04/05 documents already in the cache, not from here. The active-user
 * count is the single polled value on the page — it is the only figure §3.1
 * calls live.
 */

import { useQuery } from '@tanstack/react-query';

import { overviewApi } from './overview.api';
import type { ActivityRange } from './overview.types';

const STALE_MS = 30_000;
export const ACTIVE_USERS_POLL_MS = 15_000;

export const overviewKeys = {
  all: ['admin', 'overview'] as const,
  signals: (range: ActivityRange) => [...overviewKeys.all, 'signals', range] as const,
  activeUsers: () => [...overviewKeys.all, 'active-users'] as const,
} as const;

export function useOverviewSignals(range: ActivityRange) {
  return useQuery({
    queryKey: overviewKeys.signals(range),
    queryFn: () => overviewApi.signals(range),
    staleTime: STALE_MS,
  });
}

export function useActiveUsers() {
  return useQuery({
    queryKey: overviewKeys.activeUsers(),
    queryFn: overviewApi.activeUsers,
    refetchInterval: ACTIVE_USERS_POLL_MS,
    staleTime: 0,
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm run test -- src/features/admin/overview/overview.api.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run the gates and commit**

```bash
npm run typecheck && npm run lint && npm run test
git add frontend/src/features/admin/overview
git commit -m "feat(adm-01): overview signals service and query hooks"
```

---

### Task 3: Make the queue's destinations honour its links

The action queue promises that clicking a count shows exactly those rows. Two of the four destinations have no matching filter yet, and none of the three read the URL. This task makes the promise true before anything links to it.

**Files:**
- Modify: `frontend/src/features/admin/doctors/doctors.types.ts`
- Modify: `frontend/src/features/admin/doctors/doctors.ts`
- Modify: `frontend/src/features/admin/doctors/DoctorsSection.tsx`
- Modify: `frontend/src/features/admin/patients/patients.types.ts`
- Modify: `frontend/src/features/admin/patients/patients.ts`
- Modify: `frontend/src/features/admin/patients/PatientsSection.tsx`
- Modify: `frontend/src/features/admin/appointments/AppointmentOversightSection.tsx`
- Test: `frontend/src/features/admin/doctors/doctors.test.ts`, `frontend/src/features/admin/patients/patients.test.ts` (append)

**Interfaces:**
- Consumes: `licenceExpiringSoon` from `../overview/overview` (Task 1).
- Produces: `DoctorFilters.expiring: boolean`, `PatientFilters.openWork: boolean`, and URL seeding for `?tab=`, `?expiring=soon`, `?flag=open`, `?flag=stuck-pending`.

- [ ] **Step 1: Write the failing filter tests**

Append to `frontend/src/features/admin/doctors/doctors.test.ts`:

```ts
describe('the expiring-licence filter', () => {
  it('is off by default, so the list still shows everyone', () => {
    expect(EMPTY_FILTERS.expiring).toBe(false);
  });

  it('keeps only doctors whose licence expires inside the horizon', () => {
    const soon = doctor({
      id: 'soon',
      documents: [licence(new Date(NOW + 10 * DAY_MS).toISOString())],
    });
    const later = doctor({
      id: 'later',
      documents: [licence(new Date(NOW + 300 * DAY_MS).toISOString())],
    });

    const kept = filterDoctors([soon, later], 'all', { ...EMPTY_FILTERS, expiring: true }, NOW);

    expect(kept.map((d) => d.id)).toEqual(['soon']);
  });
});
```

Add the `licence` helper next to the file's existing factories:

```ts
function licence(expiresAt: string | null): CredentialDocument {
  return {
    id: 'lic',
    kind: 'medical-license',
    filename: 'licence.pdf',
    uploadedAt: new Date(NOW - 200 * DAY_MS).toISOString(),
    expiresAt,
    decision: 'approved',
    checklist: { authentic: true, current: true, matchesIdentity: true },
    rejectionReason: null,
    reviewedBy: 'Marcus Reed',
    reviewedAt: new Date(NOW - 199 * DAY_MS).toISOString(),
    previewLines: [],
  };
}
```

Import `CredentialDocument` as a type from `./doctors.types` and `filterDoctors`, `EMPTY_FILTERS` from `./doctors` if the file does not already import them.

Append to `frontend/src/features/admin/patients/patients.test.ts`:

```ts
describe('the open-issues filter', () => {
  it('is off by default', () => {
    expect(EMPTY_FILTERS.openWork).toBe(false);
  });

  it('keeps exactly the accounts the overview queue counts', () => {
    const waiting = patient({
      id: 'waiting',
      flags: [{ id: 'f1', kind: 'data-correction', summary: 'Wrong DOB', openedAt: daysAgo(1) }],
    });
    const settled = patient({ id: 'settled' });

    const kept = filterPatients([waiting, settled], { ...EMPTY_FILTERS, openWork: true }, NOW);

    expect(kept.map((p) => p.id)).toEqual(['waiting']);
  });
});
```

Use whatever `patient(...)` / `daysAgo(...)` factories the file already defines; do not add duplicates.

- [ ] **Step 2: Run them to verify they fail**

```bash
npm run test -- src/features/admin/doctors/doctors.test.ts src/features/admin/patients/patients.test.ts
```

Expected: FAIL — `Property 'expiring' does not exist on type 'DoctorFilters'` and the same for `openWork`.

- [ ] **Step 3: Add the two filter fields**

In `frontend/src/features/admin/doctors/doctors.types.ts`, add to `DoctorFilters`:

```ts
  /**
   * Narrows to doctors whose medical licence expires inside the overview's
   * 30-day horizon. Seeded from the URL by the ADM-01 action queue, so the
   * count on the overview and the rows here are the same set.
   */
  readonly expiring: boolean;
```

In `frontend/src/features/admin/doctors/doctors.ts`, add `expiring: false` to `EMPTY_FILTERS` and this clause to `matchesFilters`, immediately before its final `return true`:

```ts
  if (filters.expiring && !licenceExpiringSoon(doctor, now)) return false;
```

with the import:

```ts
import { licenceExpiringSoon } from '../overview/overview';
```

In `frontend/src/features/admin/patients/patients.types.ts`, add to `PatientFilters`:

```ts
  /** Narrows to accounts somebody is waiting on — the ADM-01 queue's set. */
  readonly openWork: boolean;
```

In `frontend/src/features/admin/patients/patients.ts`, add `openWork: false` to `EMPTY_FILTERS` and this clause to `matchesFilters`, before its final `return true`:

```ts
  if (filters.openWork && openWorkCount(patient) === 0) return false;
```

If `matchesFilters` in `patients.ts` does not already take `now`, leave its signature alone — this clause does not need it.

- [ ] **Step 4: Run the filter tests to verify they pass**

```bash
npm run test -- src/features/admin/doctors/doctors.test.ts src/features/admin/patients/patients.test.ts
```

Expected: PASS.

- [ ] **Step 5: Seed the three lists from the URL**

In `frontend/src/features/admin/doctors/DoctorsSection.tsx`, replace the `tab` and `filters` state declarations (currently around lines 105–106) with:

```tsx
  /*
   * `?tab=` and `?expiring=` arrive from the ADM-01 action queue, so a count
   * clicked on the overview lands on exactly the rows it promised. Read once,
   * as the initial state: the URL seeds the view, it does not own it — the
   * same contract `?doctor=` has on appointment oversight.
   */
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<DoctorTab>(() => {
    const requested = searchParams.get('tab');
    return requested === 'pending' || requested === 'active' || requested === 'suspended'
      ? requested
      : 'all';
  });
  const [filters, setFilters] = useState<DoctorFilters>(() =>
    searchParams.get('expiring') === null ? EMPTY_FILTERS : { ...EMPTY_FILTERS, expiring: true },
  );
```

Add `useSearchParams` to the existing `react-router-dom` import.

Add a toolbar control so the filter can be cleared, beside the existing selects:

```tsx
  <Checkbox
    label="Licence expiring < 30 days"
    checked={filters.expiring}
    onChange={(event) => setFilters({ ...filters, expiring: event.target.checked })}
  />
```

Use whatever checkbox/toggle primitive the toolbar's siblings already use — check the imports at the top of the file and match them rather than introducing a new control.

In `frontend/src/features/admin/patients/PatientsSection.tsx`, replace the `filters` state declaration (around line 110) with:

```tsx
  /* `?flag=open` arrives from the ADM-01 action queue — see DoctorsSection. */
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState<PatientFilters>(() =>
    searchParams.get('flag') === 'open' ? { ...EMPTY_FILTERS, openWork: true } : EMPTY_FILTERS,
  );
```

and add the matching toolbar control:

```tsx
  <Checkbox
    label="Open issues only"
    checked={filters.openWork}
    onChange={(event) => setFilters({ ...filters, openWork: event.target.checked })}
  />
```

In `frontend/src/features/admin/appointments/AppointmentOversightSection.tsx`, extend the existing initialiser so `?flag=` is read alongside `?doctor=`:

```tsx
  const [filters, setFilters] = useState<OversightFilters>(() => {
    const doctorId = searchParams.get('doctor');
    const flag = searchParams.get('flag');
    const seeded =
      flag === 'stuck-pending' || flag === 'repeated-reschedules' || flag === 'complaint-attached'
        ? { ...EMPTY_FILTERS, flag, range: 'all' as const }
        : EMPTY_FILTERS;
    return doctorId === null ? seeded : { ...seeded, doctorId, range: 'all' as const };
  });
```

- [ ] **Step 6: Run the full suite**

```bash
npm run typecheck && npm run lint && npm run test
```

Expected: PASS. Existing `PatientsSection.test.tsx` / `DoctorsSection.test.tsx` renders mount at a path with no query string, so their behaviour is unchanged; if either fails, the seeding is reading the URL on every render instead of once — fix that rather than the test.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/admin/doctors frontend/src/features/admin/patients frontend/src/features/admin/appointments
git commit -m "feat(adm-01): filter-seeding deep links for the admin action queue"
```

---

### Task 4: Page shell, KPI row and security banner

**Files:**
- Create: `frontend/src/features/admin/overview/OverviewKpiRow.tsx`
- Create: `frontend/src/features/admin/overview/SecurityAlertsBanner.tsx`
- Create: `frontend/src/features/admin/overview/AdminOverviewSection.tsx`
- Test: `frontend/src/features/admin/overview/AdminOverviewSection.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1 and 2; `SectionShell` from `../components/SectionShell`; `MetricTile`, `Panel`, `AsyncSection` from `../components/primitives`; `Alert` from `@/components/feedback`.
- Produces: `AdminOverviewSection` (named export), `OverviewKpiRow({ kpis, activeUsers })`, `SecurityAlertsBanner({ alerts, isError, onRetry })`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/features/admin/overview/AdminOverviewSection.test.tsx`:

```tsx
import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PhiAccessProvider } from '../phi';

import { AdminOverviewSection } from './AdminOverviewSection';

/**
 * The Administrator Overview at the surface (ADM-01 · UX §3.1).
 *
 * Three claims matter here. The four KPIs are present and readable. The
 * security banner is never *silently* absent — a failure says so. And the
 * page keeps ADM-10's bargain: a patient name in the signups feed arrives
 * masked, like everywhere else in the admin area.
 */

const capabilities = { current: true };

vi.mock('@/app/providers', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Marcus Reed', email: 'admin@medora.health' } }),
  useCan: () => () => capabilities.current,
  useToast: () => ({ toast: () => undefined }),
}));

beforeEach(() => {
  window.localStorage.clear();
  capabilities.current = true;
});

function renderOverview() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  function Tree({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/admin']}>
          <PhiAccessProvider>{children}</PhiAccessProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(
    <Tree>
      <AdminOverviewSection />
    </Tree>,
  );
}

describe('the KPI row', () => {
  it('shows the four headline figures §3.1 names', async () => {
    renderOverview();

    expect(await screen.findByText('Total doctors')).toBeInTheDocument();
    expect(screen.getByText('Total patients')).toBeInTheDocument();
    expect(screen.getByText('Appointments today')).toBeInTheDocument();
    expect(screen.getByText('Active users now')).toBeInTheDocument();
  });

  it('captions the doctors KPI with the pending count an admin can act on', async () => {
    renderOverview();

    await waitFor(() => {
      expect(screen.getByText(/pending verification/i)).toBeInTheDocument();
    });
  });
});

describe('the security banner', () => {
  it('says so when the security status cannot be read, rather than vanishing', async () => {
    render(
      <MemoryRouter>
        <SecurityAlertsBannerHarness />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/security status unavailable/i)).toBeInTheDocument();
  });
});

function SecurityAlertsBannerHarness() {
  return <SecurityAlertsBanner alerts={[]} isError onRetry={() => undefined} />;
}
```

Add the import for the harness at the top of the file:

```tsx
import { SecurityAlertsBanner } from './SecurityAlertsBanner';
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npm run test -- src/features/admin/overview/AdminOverviewSection.test.tsx
```

Expected: FAIL — cannot resolve `./AdminOverviewSection`.

- [ ] **Step 3: Write `SecurityAlertsBanner.tsx`**

```tsx
import { ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Alert } from '@/components/feedback';
import { Badge, Button } from '@/components/ui';

import { alertDestination, ALERT_SEVERITY_VARIANT } from './overview';
import type { SecurityAlert } from './overview.types';

/**
 * Row 0 (§3.1) — unresolved security alerts, error-toned and undismissable.
 *
 * The failure branch is the point of this component. §3.1 is explicit that a
 * failed security fetch shows a warning rather than an empty slot: an absent
 * banner reads as "nothing is wrong", which is exactly the wrong thing to
 * tell an administrator when the truth is "we could not check".
 */
export interface SecurityAlertsBannerProps {
  alerts: readonly SecurityAlert[];
  isError: boolean;
  onRetry: () => void;
}

export function SecurityAlertsBanner({ alerts, isError, onRetry }: SecurityAlertsBannerProps) {
  if (isError) {
    return (
      <Alert
        variant="warning"
        title="Security status unavailable"
        actions={
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Retry
          </Button>
        }
      >
        The platform could not be checked for unresolved security events. This is not a report that
        there are none.
      </Alert>
    );
  }

  if (alerts.length === 0) return null;

  return (
    <Alert
      variant="error"
      critical
      title={`${String(alerts.length)} unresolved security ${alerts.length === 1 ? 'alert' : 'alerts'}`}
    >
      <ul className="mt-1 flex flex-col divide-y divide-border/60">
        {alerts.map((alert) => (
          <li key={alert.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
            <ShieldAlert aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={1.75} />
            <Badge variant={ALERT_SEVERITY_VARIANT[alert.severity]}>
              {alert.severity === 'critical' ? 'Critical' : 'Warning'}
            </Badge>
            <span className="min-w-0 flex-1 truncate text-body-sm">{alert.summary}</span>
            <Button variant="ghost" size="sm" asChild>
              <Link to={alertDestination(alert)}>Investigate</Link>
            </Button>
          </li>
        ))}
      </ul>
    </Alert>
  );
}
```

If `Button` has no `asChild`, render a `<Link>` styled as a ghost button instead — check `src/components/ui/Button.tsx` and match how the other admin sections link out of a row.

- [ ] **Step 4: Write `OverviewKpiRow.tsx`**

```tsx
import { CalendarClock, Radio, Stethoscope, UsersRound } from 'lucide-react';

import { MetricTile } from '../components/primitives';

import type { OverviewKpis } from './overview.types';

/**
 * Row 1 (§3.1) — the four headline figures.
 *
 * Active users is the only live value on the page. §3.1 asks for a fade on
 * change and explicitly forbids a count-up, so the transition is a CSS
 * opacity change keyed on the value and nothing animates the number itself.
 * `motion-reduce:transition-none` honours the OS setting.
 */
export interface OverviewKpiRowProps {
  kpis: OverviewKpis;
  activeUsers: number | undefined;
}

export function OverviewKpiRow({ kpis, activeUsers }: OverviewKpiRowProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricTile
        label="Total doctors"
        value={kpis.verifiedDoctors}
        icon={Stethoscope}
        tone="primary"
        hint={`${String(kpis.pendingVerifications)} pending verification`}
      />
      <MetricTile
        label="Total patients"
        value={kpis.totalPatients}
        icon={UsersRound}
        tone="info"
        hint={`${String(kpis.activePatients)} active`}
      />
      <MetricTile
        label="Appointments today"
        value={kpis.appointmentsToday}
        icon={CalendarClock}
        tone="success"
        hint={`${String(kpis.utilizationPercent)}% utilization`}
      />
      <div
        key={activeUsers ?? 'pending'}
        className="transition-opacity duration-500 motion-reduce:transition-none"
      >
        <MetricTile
          label="Active users now"
          value={activeUsers ?? '—'}
          icon={Radio}
          tone="accent"
          hint="Live · updates every 15s"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Write `AdminOverviewSection.tsx`**

Rows 2–4 are added in Tasks 5–7; this is the shell that owns the clock and the documents.

```tsx
import { useMemo, useState } from 'react';

import { useCan } from '@/app/providers';

import { useAuditEvents, usePhiAccessLog } from '../administration.queries';
import { useOversightDocument } from '../appointments/oversight.queries';
import { SectionShell } from '../components/SectionShell';
import { useDoctorsDocument } from '../doctors/doctors.queries';
import { usePatientsDocument } from '../patients/patients.queries';

import { deriveKpis, deriveSecurityAlerts } from './overview';
import { OverviewKpiRow } from './OverviewKpiRow';
import { useActiveUsers, useOverviewSignals } from './overview.queries';
import type { ActivityRange } from './overview.types';
import { SecurityAlertsBanner } from './SecurityAlertsBanner';

/**
 * Administrator Overview (ADM-01 · UX §3.1) — the admin's home.
 *
 * Every figure an administrator can act on is derived here from the three
 * documents ADM-02, ADM-04 and ADM-05 already hold in the query cache, so
 * approving a verification or cancelling an appointment changes this page
 * with no refetch and no window in which a badge disagrees with the screen it
 * links to. Only telemetry, service health, storage and the live user count
 * are fetched.
 */
export function AdminOverviewSection() {
  const can = useCan();
  const doctors = useDoctorsDocument();
  const patients = usePatientsDocument();
  const oversight = useOversightDocument();
  const audit = useAuditEvents();
  const phiLog = usePhiAccessLog();
  const activeUsers = useActiveUsers();

  // One clock per render, shared by every derived value — otherwise the KPI
  // row and the action queue can disagree about what "today" means.
  const now = Date.now();

  const doctorRecords = useMemo(() => doctors.data?.doctors ?? [], [doctors.data]);
  const patientRecords = useMemo(() => patients.data?.patients ?? [], [patients.data]);
  const appointments = useMemo(() => oversight.data?.appointments ?? [], [oversight.data]);
  const roster = useMemo(() => oversight.data?.doctors ?? [], [oversight.data]);

  const kpis = useMemo(
    () => deriveKpis(doctorRecords, patientRecords, appointments, roster, now),
    [doctorRecords, patientRecords, appointments, roster, now],
  );

  /*
   * An administrator who cannot read the logs has no security-triage job, so
   * the banner is gated on the same capability ADM-07 will use. That is a
   * permission decision, not the "silently absent" case §3.1 forbids — the
   * absent-because-broken case is the banner's own error branch.
   */
  const mayTriage = can('logs.view');
  const alerts = useMemo(
    () =>
      mayTriage
        ? deriveSecurityAlerts(doctorRecords, phiLog.data ?? [], audit.data ?? [], now)
        : [],
    [mayTriage, doctorRecords, phiLog.data, audit.data, now],
  );
  const alertsFailed = mayTriage && (doctors.isError || audit.isError || phiLog.isError);

  return (
    <SectionShell slug="overview">
      <div className="flex flex-col gap-5">
        {mayTriage ? (
          <SecurityAlertsBanner
            alerts={alerts}
            isError={alertsFailed}
            onRetry={() => {
              void doctors.refetch();
              void audit.refetch();
              void phiLog.refetch();
            }}
          />
        ) : null}

        <OverviewKpiRow kpis={kpis} activeUsers={activeUsers.data} />

        {/* Rows 2–4 arrive in Tasks 5–7. */}
      </div>
    </SectionShell>
  );
}
```

Do **not** import `useOverviewSignals` or `ActivityRange` yet — Row 2 is the first thing that needs them, and Task 5 adds both. This task ships a page that mounts and renders rows 0 and 1 with no dead state.

- [ ] **Step 6: Point `SECTION_META.overview` at the new page**

`SectionShell` reads its title from `SECTION_META`. In `frontend/src/features/admin/administration.meta.ts`, change the `overview` entry to:

```ts
  overview: {
    label: 'Overview',
    description: 'Platform health, security alerts and the work waiting on you.',
    icon: LayoutDashboard,
  },
```

Leave `platform` and the rest alone — Task 8 finishes the slug work.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
npm run test -- src/features/admin/overview/AdminOverviewSection.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Run the gates and commit**

```bash
npm run typecheck && npm run lint && npm run test
git add frontend/src/features/admin/overview frontend/src/features/admin/administration.meta.ts
git commit -m "feat(adm-01): overview shell, KPI row and security alerts banner"
```

---

### Task 5: Row 2 — platform activity chart and action queue

**Files:**
- Create: `frontend/src/features/admin/overview/PlatformActivityChart.tsx`
- Create: `frontend/src/features/admin/overview/ActionQueueCard.tsx`
- Modify: `frontend/src/features/admin/overview/AdminOverviewSection.tsx`
- Test: `frontend/src/features/admin/overview/AdminOverviewSection.test.tsx` (append)

**Interfaces:**
- Consumes: `deriveActionQueue` (Task 1), `useOverviewSignals` (Task 2), `LineAreaChart` from `@/components/charts`.
- Produces: `PlatformActivityChart({ series, range, onRangeChange, isLoading, isError, onRetry })`, `ActionQueueCard({ rows })`.

- [ ] **Step 1: Write the failing test**

Append to `AdminOverviewSection.test.tsx`:

```tsx
describe('the action queue', () => {
  it('links each count to the destination already filtered to it', async () => {
    renderOverview();

    const verifications = await screen.findByRole('link', {
      name: /doctor verifications pending/i,
    });
    expect(verifications).toHaveAttribute('href', '/admin/doctors?tab=pending');

    expect(screen.getByRole('link', { name: /appointments pending > 24h/i })).toHaveAttribute(
      'href',
      '/admin/appointments?flag=stuck-pending',
    );
  });

  it('offers open, not approve — ADM-03 refuses a verification until its checks are ticked', async () => {
    renderOverview();

    await screen.findByRole('link', { name: /doctor verifications pending/i });
    expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument();
  });
});

describe('the platform activity chart', () => {
  it('renders the three series on one axis', async () => {
    renderOverview();

    expect(await screen.findByLabelText(/platform activity/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npm run test -- src/features/admin/overview/AdminOverviewSection.test.tsx
```

Expected: FAIL — no link named "Doctor verifications pending".

- [ ] **Step 3: Write `ActionQueueCard.tsx`**

```tsx
import { ArrowRight, ClipboardList } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui';

import { Panel } from '../components/primitives';

import type { ActionQueueRow } from './overview.types';

/**
 * Row 2 right (§3.1) — what is waiting on an administrator, each row a count
 * that opens the queue it came from with its filter already applied.
 *
 * Every row is a link and none is an action. §3.1 permits approving a
 * verification straight from here, but ADM-03 refuses one until all three
 * per-document checks are ticked; a one-click approve on the home page would
 * either bypass that rule or fail for reasons this card cannot explain.
 */
export interface ActionQueueCardProps {
  rows: readonly ActionQueueRow[];
}

export function ActionQueueCard({ rows }: ActionQueueCardProps) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);

  return (
    <Panel
      title="Admin action queue"
      description={total === 0 ? 'Nothing is waiting on you.' : 'Open items, newest queues first.'}
      icon={ClipboardList}
      tone="warning"
      bodyClassName="p-0"
    >
      <ul className="flex flex-col divide-y divide-border">
        {rows.map((row) => (
          <li key={row.kind}>
            <Link
              to={row.to}
              className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none"
            >
              <Badge variant={row.count === 0 ? 'neutral' : 'warning'}>
                <span className="tabular-nums">{row.count}</span>
              </Badge>
              <span className="min-w-0 flex-1 truncate text-body-sm text-text-primary">
                {row.label}
              </span>
              <ArrowRight
                aria-hidden="true"
                className="h-4 w-4 shrink-0 text-text-tertiary"
                strokeWidth={1.75}
              />
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
```

If `hover:bg-surface-hover` is not a token in this design system, use whatever hover surface the ADM-05 table rows use — check `AppointmentOversightSection.tsx`.

- [ ] **Step 4: Write `PlatformActivityChart.tsx`**

```tsx
import { Activity } from 'lucide-react';

import { LineAreaChart, type NamedSeries } from '@/components/charts';
import { Button } from '@/components/ui';

import { AsyncSection, Panel } from '../components/primitives';

import type { ActivityRange } from './overview.types';

/**
 * Row 2 left (§3.1) — 30-day platform activity.
 *
 * `LineAreaChart` owns per-series legend toggling, so §3.1's "legend toggles
 * per series" needs nothing here; this component owns only the range switch
 * and the panel's own loading and error branches.
 */
export interface PlatformActivityChartProps {
  series: readonly NamedSeries[];
  range: ActivityRange;
  onRangeChange: (range: ActivityRange) => void;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

const RANGES: readonly { readonly key: ActivityRange; readonly label: string }[] = [
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
];

export function PlatformActivityChart({
  series,
  range,
  onRangeChange,
  isLoading,
  isError,
  onRetry,
}: PlatformActivityChartProps) {
  return (
    <Panel
      title="Platform activity"
      description="Daily active users, appointments booked and messages sent."
      icon={Activity}
      tone="primary"
      action={
        <div className="flex items-center gap-1">
          {RANGES.map((option) => (
            <Button
              key={option.key}
              variant={option.key === range ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => onRangeChange(option.key)}
              aria-pressed={option.key === range}
            >
              {option.label}
            </Button>
          ))}
        </div>
      }
    >
      <AsyncSection isLoading={isLoading} isError={isError} onRetry={onRetry}>
        <LineAreaChart series={series} ariaLabel="Platform activity over time" />
      </AsyncSection>
    </Panel>
  );
}
```

- [ ] **Step 5: Compose Row 2 into the page**

In `AdminOverviewSection.tsx`, add the range state and the signals query that Task 4 deliberately left out:

```tsx
  const [range, setRange] = useState<ActivityRange>('30d');
  const signals = useOverviewSignals(range);
```

with `useState` from `react`, `useOverviewSignals` from `./overview.queries` and `ActivityRange` from `./overview.types`. Then add the queue derivation beside the KPI one:

```tsx
  const queue = useMemo(
    () => deriveActionQueue(doctorRecords, patientRecords, appointments, now),
    [doctorRecords, patientRecords, appointments, now],
  );
```

and render Row 2 under the KPI row:

```tsx
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <PlatformActivityChart
              series={signals.data?.activity ?? []}
              range={range}
              onRangeChange={setRange}
              isLoading={signals.isLoading}
              isError={signals.isError}
              onRetry={() => void signals.refetch()}
            />
          </div>
          <ActionQueueCard rows={queue} />
        </div>
```


- [ ] **Step 6: Run the tests to verify they pass**

```bash
npm run test -- src/features/admin/overview/AdminOverviewSection.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Run the gates and commit**

```bash
npm run typecheck && npm run lint && npm run test
git add frontend/src/features/admin/overview
git commit -m "feat(adm-01): platform activity chart and admin action queue"
```

---

### Task 6: Row 3 — storage, funnel, system health

**Files:**
- Create: `frontend/src/features/admin/overview/StorageUsageCard.tsx`
- Create: `frontend/src/features/admin/overview/AppointmentFunnelCard.tsx`
- Create: `frontend/src/features/admin/overview/SystemHealthCard.tsx`
- Modify: `frontend/src/features/admin/overview/AdminOverviewSection.tsx`
- Test: `frontend/src/features/admin/overview/AdminOverviewSection.test.tsx` (append)

**Interfaces:**
- Consumes: `deriveFunnel`, `formatCheckedAt` (Task 1); `OverviewSignals` (Task 2); `Progress` from `@/components/feedback`.
- Produces: `StorageUsageCard({ storage })`, `AppointmentFunnelCard({ funnel })`, `SystemHealthCard({ services, now })`.

- [ ] **Step 1: Write the failing test**

Append to `AdminOverviewSection.test.tsx`:

```tsx
describe('row 3', () => {
  it('shows Storage & Usage where §3.1 puts Revenue, because billing is not enabled', async () => {
    renderOverview();

    expect(await screen.findByText('Storage & usage')).toBeInTheDocument();
    expect(screen.queryByText(/revenue/i)).not.toBeInTheDocument();
  });

  it('quotes both appointment rates against the denominator behind them', async () => {
    renderOverview();

    expect(await screen.findByText(/of \d+ appointments/i)).toBeInTheDocument();
  });

  it('explains a degraded service instead of only colouring it', async () => {
    renderOverview();

    expect(await screen.findByText(/SMS provider retries elevated/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npm run test -- src/features/admin/overview/AdminOverviewSection.test.tsx
```

Expected: FAIL — "Storage & usage" not found.

- [ ] **Step 3: Write `StorageUsageCard.tsx`**

```tsx
import { ArrowRight, HardDrive } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Progress } from '@/components/feedback';
import { routes } from '@/routes';

import { formatDate } from '../administration.meta';
import { Panel } from '../components/primitives';

import type { StorageUsage } from './overview.types';

/**
 * Row 3 left (§3.1). §3.1 renders Revenue here only when billing is enabled
 * for the deployment and names Storage & Usage as the slot's fallback
 * otherwise. No billing flag exists anywhere in this app, so the fallback is
 * what ships — with the licence seats absorbed from the retired Platform
 * Overview, since seats are the other thing that runs out.
 */
export interface StorageUsageCardProps {
  storage: StorageUsage;
}

export function StorageUsageCard({ storage }: StorageUsageCardProps) {
  const storagePercent = Math.round((storage.usedGb / storage.totalGb) * 100);
  const seatsPercent = Math.round((storage.seatsUsed / storage.seatsTotal) * 100);

  return (
    <Panel
      title="Storage & usage"
      description={`${storage.plan} plan · renews ${formatDate(storage.renewsOn)}`}
      icon={HardDrive}
      tone="info"
      action={
        <Link
          to={routes.admin.settings('integrations')}
          className="inline-flex items-center gap-1 text-caption text-text-secondary hover:text-text-primary"
        >
          Manage
          <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.75} />
        </Link>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <Progress
            value={storagePercent}
            label="Storage"
            showValue
            aria-label={`Storage ${String(storagePercent)}%`}
          />
          <p className="mt-1 text-caption text-text-tertiary tabular-nums">
            {storage.usedGb} GB of {storage.totalGb} GB used
          </p>
        </div>
        <div>
          <Progress
            value={seatsPercent}
            label="Seats"
            showValue
            aria-label={`Seats ${String(seatsPercent)}%`}
          />
          <p className="mt-1 text-caption text-text-tertiary tabular-nums">
            {storage.seatsUsed} of {storage.seatsTotal} licensed seats
          </p>
        </div>
      </div>
    </Panel>
  );
}
```

- [ ] **Step 4: Write `AppointmentFunnelCard.tsx`**

```tsx
import { Filter } from 'lucide-react';

import { Panel } from '../components/primitives';

import type { AppointmentFunnel } from './overview.types';

/**
 * Row 3 centre (§3.1) — requested → confirmed → completed, with the two
 * rates beside it.
 *
 * The denominator is printed. Both rates and the funnel's first stage come
 * from one 7-day window, so "12% cancelled · 6% no-show" can be read
 * together — and when the window is empty the card says that rather than
 * showing two confident zeros.
 */
export interface AppointmentFunnelCardProps {
  funnel: AppointmentFunnel;
}

export function AppointmentFunnelCard({ funnel }: AppointmentFunnelCardProps) {
  const top = funnel.stages[0]?.value ?? 0;

  return (
    <Panel
      title="Appointment funnel"
      description="Last 7 days"
      icon={Filter}
      tone="success"
    >
      {funnel.window7dTotal === 0 ? (
        <p className="text-body-sm text-text-secondary">
          No appointments in the last 7 days — no basis to quote a rate.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <ul className="flex flex-col gap-2">
            {funnel.stages.map((stage) => (
              <li key={stage.label} className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-caption text-text-tertiary">{stage.label}</span>
                <span
                  aria-hidden="true"
                  className="h-2 rounded-full bg-success/70"
                  style={{ width: `${String(top === 0 ? 0 : (stage.value / top) * 100)}%` }}
                />
                <span className="ml-auto text-body-sm font-medium text-text-primary tabular-nums">
                  {stage.value}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-caption text-text-tertiary tabular-nums">
            {funnel.cancellationRate7d}% cancelled · {funnel.noShowRate7d}% no-show, of{' '}
            {funnel.window7dTotal} appointments
          </p>
        </div>
      )}
    </Panel>
  );
}
```

- [ ] **Step 5: Write `SystemHealthCard.tsx`**

```tsx
import { HeartPulse } from 'lucide-react';

import { Badge } from '@/components/ui';
import { cn } from '@/utils/cn';

import { Panel } from '../components/primitives';

import { formatCheckedAt } from './overview';
import type { ServiceHealth, ServiceStatus } from './overview.types';

const STATUS_DOT: Record<ServiceStatus, string> = {
  operational: 'bg-success',
  degraded: 'bg-warning',
  down: 'bg-error',
};

const STATUS_LABEL: Record<ServiceStatus, string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  down: 'Down',
};

/**
 * Row 3 right (§3.1) — one line per service with its uptime and when it was
 * last checked. A degraded service prints its incident note underneath: a
 * coloured dot tells an administrator that something is wrong but not what,
 * and this card is often the first place they will see it.
 */
export interface SystemHealthCardProps {
  services: readonly ServiceHealth[];
  now: number;
}

export function SystemHealthCard({ services, now }: SystemHealthCardProps) {
  const worst = services.some((service) => service.status === 'down')
    ? 'down'
    : services.some((service) => service.status === 'degraded')
      ? 'degraded'
      : 'operational';

  return (
    <Panel
      title="System health"
      description="Platform services"
      icon={HeartPulse}
      tone={worst === 'operational' ? 'success' : 'warning'}
      action={
        <Badge variant={worst === 'operational' ? 'success' : 'warning'} dot>
          {STATUS_LABEL[worst]}
        </Badge>
      }
      bodyClassName="p-0"
    >
      <ul className="flex flex-col divide-y divide-border">
        {services.map((service) => (
          <li key={service.id} className="flex flex-col gap-1 px-5 py-3">
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className={cn('h-2 w-2 shrink-0 rounded-full', STATUS_DOT[service.status])}
              />
              <span className="min-w-0 flex-1 truncate text-body-sm text-text-primary">
                {service.name}
              </span>
              <span className="shrink-0 text-caption text-text-tertiary tabular-nums">
                {service.uptimePercent}% · {formatCheckedAt(service.lastCheckedAt, now)}
              </span>
            </div>
            {service.incidentNote === null ? null : (
              <p className="pl-5 text-caption text-warning">{service.incidentNote}</p>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
```

- [ ] **Step 6: Compose Row 3 into the page**

Add to `AdminOverviewSection.tsx`:

```tsx
  const funnel = useMemo(() => deriveFunnel(appointments, now), [appointments, now]);
```

and render under Row 2:

```tsx
        <AsyncSection
          isLoading={signals.isLoading}
          isError={signals.isError}
          onRetry={() => void signals.refetch()}
        >
          {signals.data ? (
            <div className="grid gap-4 lg:grid-cols-3">
              <StorageUsageCard storage={signals.data.storage} />
              <AppointmentFunnelCard funnel={funnel} />
              <SystemHealthCard services={signals.data.services} now={now} />
            </div>
          ) : null}
        </AsyncSection>
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
npm run test -- src/features/admin/overview/AdminOverviewSection.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Run the gates and commit**

```bash
npm run typecheck && npm run lint && npm run test
git add frontend/src/features/admin/overview
git commit -m "feat(adm-01): storage, appointment funnel and system health"
```

---

### Task 7: Row 4 — the two activity feeds

**Files:**
- Create: `frontend/src/features/admin/overview/ActivityFeeds.tsx`
- Modify: `frontend/src/features/admin/overview/AdminOverviewSection.tsx`
- Test: `frontend/src/features/admin/overview/AdminOverviewSection.test.tsx` (append)

**Interfaces:**
- Consumes: `deriveSignups` (Task 1); `useAuditEvents` from `../administration.queries`; `MaskedIdentifier` from `../phi`.
- Produces: `AdminActivityFeed({ events })`, `SignupsFeed({ entries })`, both exported from `ActivityFeeds.tsx`.

- [ ] **Step 1: Write the failing test**

Append to `AdminOverviewSection.test.tsx`:

```tsx
describe('the signups feed', () => {
  it('masks a patient name, like every other admin surface', async () => {
    renderOverview();

    const feed = await screen.findByRole('region', { name: /recent signups/i });

    // ADM-10's masker leaves initials and dots; a full name here would mean
    // the home page is the one screen that opts out of the PHI gate.
    await waitFor(() => {
      expect(within(feed).getByText(/•/)).toBeInTheDocument();
    });
  });

  it('does not mask doctor names — they are not PHI', async () => {
    renderOverview();

    const feed = await screen.findByRole('region', { name: /recent signups/i });

    await waitFor(() => {
      expect(within(feed).getByText(/^Dr\./)).toBeInTheDocument();
    });
  });
});

describe('the admin activity feed', () => {
  it('names an actor on every line', async () => {
    renderOverview();

    const feed = await screen.findByRole('region', { name: /recent admin activity/i });

    await waitFor(() => {
      expect(within(feed).getAllByRole('listitem').length).toBeGreaterThan(0);
    });
  });
});
```

Add `within` to the `@testing-library/react` import.

If ADM-10's mask character is not `•`, read `frontend/src/utils/phi-mask.ts` and assert on the character it actually produces. Do not change the masker to suit the test.

- [ ] **Step 2: Run it to verify it fails**

```bash
npm run test -- src/features/admin/overview/AdminOverviewSection.test.tsx
```

Expected: FAIL — no region named "Recent signups".

- [ ] **Step 3: Write `ActivityFeeds.tsx`**

```tsx
import { ArrowRight, FileClock, UserRoundPlus } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui';
import { routes } from '@/routes';
import { cn } from '@/utils/cn';

import type { AuditEvent } from '../administration.types';
import { formatDate } from '../administration.meta';
import { Panel } from '../components/primitives';
import { MaskedIdentifier } from '../phi';

import type { SignupEntry } from './overview.types';

/**
 * Row 4 (§3.1) — who did what, and who just arrived.
 *
 * The signups feed is the reason this file is careful: it is the one place on
 * the overview where a patient's name would otherwise be printed. It goes
 * through `MaskedIdentifier`, the only sanctioned way to render a patient
 * identifier in the admin area (ADM-10). Doctor names are not PHI and render
 * plainly, which is also what makes the masked rows legible as a choice
 * rather than an accident.
 */

export interface AdminActivityFeedProps {
  events: readonly AuditEvent[];
}

export function AdminActivityFeed({ events }: AdminActivityFeedProps) {
  return (
    <Panel
      title="Recent admin activity"
      description="From the audit log."
      icon={FileClock}
      tone="warning"
      action={
        <Link
          to={routes.admin.settings('audit')}
          className="inline-flex items-center gap-1 text-caption text-text-secondary hover:text-text-primary"
        >
          View all
          <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.75} />
        </Link>
      }
      bodyClassName="p-0"
    >
      <ul className="flex flex-col divide-y divide-border">
        {events.slice(0, 6).map((event) => (
          <li key={event.id} className="flex items-center gap-3 px-5 py-3">
            <span
              aria-hidden="true"
              className={cn(
                'h-2 w-2 shrink-0 rounded-full',
                event.severity === 'critical'
                  ? 'bg-error'
                  : event.severity === 'warning'
                    ? 'bg-warning'
                    : 'bg-info',
              )}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body-sm font-medium text-text-primary">
                {event.action}
              </span>
              <span className="block truncate text-caption text-text-tertiary">
                {event.actor} · {event.target}
              </span>
            </span>
            <time className="shrink-0 text-caption text-text-tertiary tabular-nums">
              {formatDate(event.at)}
            </time>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export interface SignupsFeedProps {
  entries: readonly SignupEntry[];
}

export function SignupsFeed({ entries }: SignupsFeedProps) {
  return (
    <Panel
      title="Recent signups"
      description="Newest doctor and patient accounts."
      icon={UserRoundPlus}
      tone="accent"
      bodyClassName="p-0"
    >
      <ul className="flex flex-col divide-y divide-border">
        {entries.map((entry) => (
          <li key={`${entry.role}:${entry.id}`} className="flex items-center gap-3 px-5 py-3">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body-sm font-medium text-text-primary">
                {entry.role === 'patient' ? (
                  <MaskedIdentifier
                    subjectId={entry.id}
                    subjectLabel={`New registration ${entry.id}`}
                    kind="name"
                    value={entry.name}
                  />
                ) : (
                  entry.name
                )}
              </span>
              <span className="block text-caption text-text-tertiary capitalize">{entry.role}</span>
            </span>
            <Badge variant={entry.stateVariant}>{entry.stateLabel}</Badge>
            <time className="shrink-0 text-caption text-text-tertiary tabular-nums">
              {formatDate(entry.at)}
            </time>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
```

`Panel` must render its title as the accessible name of a `<section>` for `getByRole('region', { name })` to find it. Check `primitives.tsx`: if the `<section>` has no `aria-labelledby`, wire the heading's id to it there — that is a real accessibility fix, not a test accommodation, and it benefits every panel in the admin area.

`kind="name"` must be a member of `PhiFieldKind`. Read `frontend/src/utils/phi-mask.ts` and use the member that means "person's name".

- [ ] **Step 4: Compose Row 4 into the page**

```tsx
  const signups = useMemo(
    () => deriveSignups(doctorRecords, patientRecords),
    [doctorRecords, patientRecords],
  );
```

```tsx
        <div className="grid gap-4 lg:grid-cols-2">
          <AdminActivityFeed events={audit.data ?? []} />
          <SignupsFeed entries={signups} />
        </div>
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm run test -- src/features/admin/overview/AdminOverviewSection.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Run the gates and commit**

```bash
npm run typecheck && npm run lint && npm run test
git add frontend/src/features/admin/overview frontend/src/features/admin/components/primitives.tsx
git commit -m "feat(adm-01): admin activity and signups feeds with masked identifiers"
```

---

### Task 8: Mount it — routes, navigation, and retiring Platform Overview

**Files:**
- Modify: `frontend/src/routes/index.ts`
- Modify: `frontend/src/features/admin/administration.meta.ts`
- Modify: `frontend/src/layouts/navigation.ts`
- Modify: `frontend/src/features/admin/routes.tsx`
- Modify: `frontend/src/features/admin/admin-profile.ts`
- Delete: `frontend/src/features/admin/sections/PlatformOverviewSection.tsx`
- Test: `frontend/src/features/admin/overview/AdminOverviewSection.test.tsx` (append)

**Interfaces:**
- Consumes: `AdminOverviewSection` (Tasks 4–7).
- Produces: `resolveLandingSection(stored: string): AdminSectionSlug` in `admin-profile.ts`.

- [ ] **Step 1: Write the failing test**

Append to `AdminOverviewSection.test.tsx`:

```tsx
describe('the landing-section preference', () => {
  it('falls back to the overview when the stored slug no longer exists', () => {
    // `platform` was a real section until ADM-01 absorbed it. A preference
    // saved before then must not strand an administrator on a dead route.
    expect(resolveLandingSection('platform')).toBe('overview');
    expect(resolveLandingSection('nonsense')).toBe('overview');
    expect(resolveLandingSection('doctors')).toBe('doctors');
  });
});
```

Add the import:

```tsx
import { resolveLandingSection } from '../admin-profile';
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npm run test -- src/features/admin/overview/AdminOverviewSection.test.tsx
```

Expected: FAIL — `resolveLandingSection` is not exported.

- [ ] **Step 3: Update the slug union**

In `frontend/src/routes/index.ts`, in `AdminSectionSlug`, replace `| 'platform'` with `| 'clinic'`. Add to the `routes.admin` object, beside `appointments`:

```ts
    /**
     * Clinic operations (the Administration Center's own overview). It was
     * the area index until ADM-01 put the Administrator Overview there.
     */
    clinic: '/admin/clinic',
```

- [ ] **Step 4: Update the section metadata**

In `frontend/src/features/admin/administration.meta.ts`, delete the `platform` entry and add:

```ts
  clinic: {
    label: 'Clinic Overview',
    description: 'Live snapshot of today’s clinic activity and utilization.',
    icon: Activity,
  },
```

`overview` was already relabelled in Task 4. Remove the `Activity` import only if it becomes unused.

- [ ] **Step 5: Update the navigation**

In `frontend/src/layouts/navigation.ts`, replace the first group's two items with:

```ts
        {
          id: 'overview',
          label: 'Overview',
          icon: LayoutDashboard,
          path: routes.admin.root,
          end: true,
        },
        {
          id: 'clinic',
          label: 'Clinic Overview',
          icon: Activity,
          path: routes.admin.clinic,
        },
```

Update the stale comment above `adminNavigation` — the Administrator Dashboard is no longer "not built yet".

- [ ] **Step 6: Update the routes**

In `frontend/src/features/admin/routes.tsx`, replace the index route and the `platform` section with:

```tsx
  {
    index: true,
    handle: { crumb: 'Overview' } satisfies RouteHandle,
    lazy: async () => {
      const { AdminOverviewSection } = await import('./overview/AdminOverviewSection');
      return { Component: AdminOverviewSection };
    },
  },
  section('clinic', 'Clinic Overview', async () => {
    const { ClinicOverviewSection } = await import('./sections/ClinicOverviewSection');
    return { Component: ClinicOverviewSection };
  }),
  /*
   * `/admin/platform` was Platform Overview until ADM-01 absorbed its
   * panels — they are §3.1 rows 3 and 4. The path stays as a redirect
   * because it is in browser histories and in saved landing preferences.
   */
  {
    path: 'platform',
    element: <Navigate to={routes.admin.root} replace />,
  },
```

Add `import { Navigate } from 'react-router-dom';` and `import { routes } from '@/routes';` (the file currently imports `routes` as a type only — change it to a value import).

- [ ] **Step 7: Add the landing fallback**

In `frontend/src/features/admin/admin-profile.ts`, export:

```ts
/**
 * Resolves a stored landing-section preference against the slugs that exist
 * today. `platform` was a real section until ADM-01 absorbed it; a
 * preference saved before then must land somewhere, and the overview is the
 * honest default.
 */
export function resolveLandingSection(stored: string): AdminSectionSlug {
  return stored in SECTION_META ? (stored as AdminSectionSlug) : 'overview';
}
```

Import `SECTION_META` from `./administration.meta`. If that creates an import cycle (`administration.meta` imports from `admin-profile`), move the guard to a local list of slugs derived from `adminNavigation` instead — check before writing.

Call it at every point that reads `landingSection`: `AdminProfileSection.tsx` (around line 93) and `GeneralPanels.tsx` (around line 68).

- [ ] **Step 8: Delete Platform Overview**

```bash
git rm frontend/src/features/admin/sections/PlatformOverviewSection.tsx
```

Then search for stragglers:

```bash
grep -rn "PlatformOverviewSection\|section('platform')\|'platform'" frontend/src
```

Expected: only the redirect route path. Fix anything else it finds.

- [ ] **Step 9: Run everything**

```bash
npm run typecheck && npm run lint && npm run test
```

Expected: PASS. `usePlatformStatus` may now be unused — if the linter says so, leave the query hook in place (other sections may use it) and confirm with `grep -rn "usePlatformStatus" frontend/src` before deleting anything.

- [ ] **Step 10: Commit**

```bash
git add -A frontend/src
git commit -m "feat(adm-01): mount the admin overview at /admin and retire Platform Overview"
```

---

### Task 9: Empty and error states

§3.1 names three states explicitly, and the "never silently absent" rule is the one most likely to be broken by a later refactor.

**Files:**
- Modify: `frontend/src/features/admin/overview/AdminOverviewSection.tsx`
- Test: `frontend/src/features/admin/overview/AdminOverviewSection.test.tsx` (append)

**Interfaces:**
- Consumes: `isFreshDeployment` (Task 1).
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Append to `AdminOverviewSection.test.tsx`:

```tsx
describe('states', () => {
  it('offers an onboarding step on a fresh deployment instead of a wall of zeros', async () => {
    vi.spyOn(doctorsApi, 'list').mockResolvedValue({ doctors: [], invites: [] });
    vi.spyOn(patientsApi, 'list').mockResolvedValue({ patients: [] });

    renderOverview();

    expect(await screen.findByText(/invite your first doctor/i)).toBeInTheDocument();
  });

  it('retries the widget that failed, not the whole page', async () => {
    vi.spyOn(overviewApi, 'signals').mockRejectedValue(new Error('down'));

    renderOverview();

    // The KPI row is derived, so it survives a signals failure.
    expect(await screen.findByText('Total doctors')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});
```

Add the imports:

```tsx
import { doctorsApi } from '../doctors/doctors.api';
import { patientsApi } from '../patients/patients.api';
import { overviewApi } from './overview.api';
```

and `afterEach(() => { vi.restoreAllMocks(); });`.

- [ ] **Step 2: Run it to verify it fails**

```bash
npm run test -- src/features/admin/overview/AdminOverviewSection.test.tsx
```

Expected: FAIL — "Invite your first doctor" not found.

- [ ] **Step 3: Add the fresh-deployment branch**

In `AdminOverviewSection.tsx`, after the derivations:

```tsx
  const fresh =
    !doctors.isLoading &&
    !patients.isLoading &&
    isFreshDeployment(doctorRecords, patientRecords);
```

and render it in place of rows 2–4 (the KPI row stays — §3.1 asks for KPIs at zero):

```tsx
        {fresh ? (
          <Panel
            title="Get the platform started"
            description="Nothing has happened here yet."
            icon={Rocket}
            tone="primary"
          >
            <ul className="flex flex-col gap-2 text-body-sm text-text-secondary">
              <li>
                <Link to={routes.admin.doctors} className="text-primary hover:underline">
                  Invite your first doctor
                </Link>{' '}
                — verification, scheduling and oversight all start there.
              </li>
              <li>
                <Link
                  to={routes.admin.settings('roles')}
                  className="text-primary hover:underline"
                >
                  Review the permission matrix
                </Link>{' '}
                before anyone signs in.
              </li>
            </ul>
          </Panel>
        ) : (
          <>{/* rows 2–4 as composed in Tasks 5–7 */}</>
        )}
```

Move the Row 2, Row 3 and Row 4 blocks written in Tasks 5–7 inside that fragment verbatim. Import `Rocket` from `lucide-react`, `Link` from `react-router-dom`, `routes` from `@/routes` and `Panel` from `../components/primitives` if not already imported.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm run test -- src/features/admin/overview/AdminOverviewSection.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Run the gates and commit**

```bash
npm run typecheck && npm run lint && npm run test
git add frontend/src/features/admin/overview
git commit -m "feat(adm-01): fresh-deployment and per-widget failure states"
```

---

### Task 10: Browser verification and the checklist

Every prior ADM row was verified in a real browser, and on ADM-04 that pass is what caught a column disagreeing with its own ordering. Derived counts that must equal what another page shows are exactly that class of bug.

**Files:**
- Modify: `frontend/FRONTEND_CHECKLIST.md`

- [ ] **Step 1: Start the dev server**

Use the preview tooling (never `npm run dev` through a shell): `preview_start` with the `frontend` entry in `.claude/launch.json`. If no entry exists, add one — `runtimeExecutable: "npm"`, `runtimeArgs: ["run", "dev"]`, the port Vite reports.

- [ ] **Step 2: Verify the page against the four claims**

Sign in as the admin and check, using `read_page` and `read_console_messages`:

1. `/admin` renders the Administrator Overview; the sidebar's first item is "Overview" and the second is "Clinic Overview".
2. **The queue counts match their destinations.** For each of the four rows: note the count, click it, count the rows on the destination page. They must be equal. This is the check that earns the task.
3. `/admin/platform` redirects to `/admin`.
4. A patient name in Recent Signups is masked; a doctor name is not.

Then `resize_window` to the mobile preset **and reload** — the preset only re-runs device gates on load — and confirm the grid stacks without horizontal scroll.

Console must be clean. Fix anything found in the source, then re-check.

- [ ] **Step 3: Capture a screenshot for the record**

`computer` → `screenshot` at the desktop preset, with the page scrolled to show rows 0–2.

- [ ] **Step 4: Update the checklist**

In `frontend/FRONTEND_CHECKLIST.md`:

- ADM-01 row status → `✅ **DONE (Phase C)**` describing what shipped: the derived KPIs and action queue, the security banner and its `alertDestination` map, the absorbed Platform Overview, the Storage & Usage slot standing in for Revenue, and the masked signups feed. State plainly what is **not** done: flagged conversations (ADM-06), Revenue (no billing flag), Investigate pointing at real destinations rather than `/admin/logs` until ADM-07, and mock-served telemetry.
- §4 intro: add ADM-01 to the list of live screens; `communications`, `logs` and `reports` remain declared-but-unmounted.
- Phase C roadmap: split item 13 so ADM-01 is `✅` and ADM-06 / ADM-08 remain open. Leave item 12 (ADM-07) untouched — it is still open, and this row was taken out of order.
- Known gaps: note that the overview's telemetry, service health and storage are mock-served with no telemetry backend.

- [ ] **Step 5: Final gates**

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

Expected: all pass, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add frontend/FRONTEND_CHECKLIST.md frontend/.claude/launch.json
git commit -m "docs(adm-01): mark the Admin Overview done and record what is not"
```

- [ ] **Step 7: Push and update the PR**

```bash
git push
```

The branch already has PR #7 open. Add a comment describing the implementation; do not open a second PR.

---

## Notes for the implementer

**Where this can go wrong quietly.** Three failure modes are worth watching for, because none of them breaks a build:

1. **A count that disagrees with its destination.** The queue's whole value is that clicking a number shows those rows. Task 3 exists to make that true and Task 10 step 2 is the check. If a count and a page disagree, fix the *shared* helper — do not adjust one side to match the other.
2. **`Date.now()` creeping into `overview.ts`.** The moment a derivation reads the clock, its boundary tests become flaky and the KPI row can disagree with the action queue about what "today" means. The page takes one `now` per render and passes it down.
3. **A patient name rendered raw.** `MaskedIdentifier` refuses to render outside `PhiAccessProvider`, so a missing provider fails loudly — but a name interpolated directly into JSX fails silently. The signups feed is the only place on this page where that is possible.

**If a spec detail and this plan disagree,** the spec wins on *what* and this plan wins on *how*. Three known deltas, all deliberate and all now reflected in the spec:

1. The licence-expiry rule is `licenceExpiringSoon` (30 days, medical licences only) rather than ADM-02's `isExpiringSoon` (60 days, every document kind).
2. The patient-flags queue row counts `openWorkCount(patient) > 0` — ADM-04's own "open issues" definition — rather than narrowing to `data-correction` and `complaint` flag kinds as the spec first described. Narrowing would have given the count and its destination two different predicates, which is precisely the disagreement this row exists to avoid.
3. The alert thresholds are named constants; the spec lists their values.

**One §3.1 detail this plan does not deliver:** §3.1 asks for "P5 KPI cards (with deltas)". `MetricTile` has no delta affordance and there is no historical series behind three of the four KPIs to compute one from. The captions carry the secondary figure instead (pending verifications, active patients, utilization %). Record this in the checklist's "Not done" list in Task 10 — do not fake a delta.
