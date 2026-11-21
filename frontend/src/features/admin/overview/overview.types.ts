/**
 * Admin Overview — domain types (ADM-01 · UX §3.1).
 *
 * Two families live here and they are deliberately separate. The *derived*
 * types (alerts, queue rows, KPIs, funnel, signups) are computed from
 * documents ADM-02, ADM-04, ADM-05 and ADM-06B already hold, so they are
 * never fetched and can never be stale relative to the pages they link to.
 * The *served* types (`OverviewSignals`) cover only what no store holds:
 * platform telemetry and service health.
 */

import type { NamedSeries } from '@/components/charts';
import type { StatusKind } from '@/components/patterns';
import type { MenuEntry } from '@/components/ui';

/* ── Dashboard widget surface ─────────────────────────────────── */

/**
 * What every Overview card accepts so it can stand on the customizable
 * dashboard: the ⋯ menu that removes it, and the class the layout sizes it
 * with. Both optional, so a card still renders on its own (its tests do).
 */
export interface OverviewWidgetSurface {
  menu?: readonly MenuEntry[] | undefined;
  className?: string | undefined;
}

/* ── Security alerts (Row 0) ──────────────────────────────────── */

export type AlertSeverity = 'warning' | 'critical';

/**
 * The alert kinds that have a real source today. §3.1's fifth, flagged
 * communications, is now `flagged-communications` — ADM-06B landed and
 * `deriveSecurityAlerts` derives it from the communications document already
 * in the query cache, the same way the other four derive from ADM-02/04/05.
 */
export type SecurityAlertKind =
  | 'failed-sign-ins'
  | 'impossible-travel'
  | 'phi-burst'
  | 'critical-audit'
  | 'flagged-communications';

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
  | 'stuck-appointments'
  | 'flagged-communications';

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
  readonly stateKind: StatusKind;
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

export type ActivityRange = '7d' | '30d';

/**
 * Storage and licence are deliberately absent here. Both live on the
 * `PlatformStatus` record `usePlatformStatus()` already serves — the record
 * Settings → About renders — and the Storage & usage card reads that record
 * directly (spec §4.5). A copy in this envelope would be a second source for
 * a number two screens print, which is the disagreement this page exists to
 * end.
 */
export interface OverviewSignals {
  /** Daily active users · appointments booked · messages sent. */
  readonly activity: readonly NamedSeries[];
  readonly services: readonly ServiceHealth[];
}
