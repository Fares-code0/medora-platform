/**
 * The Row-0 critical banner — API §16.3, RM M27.3.
 *
 * > ✅ Verify: with the source query forced to fail the endpoint returns
 * > 5xx, never 200 with `[]` (this is a safety surface).
 *
 * ## Nothing here catches anything, and that is the whole design
 *
 * Every other read surface in this codebase degrades gracefully. This one
 * must not. The banner's job is to say "there is an unreviewed critical
 * potassium on a patient you are seeing today", and an empty banner is
 * **indistinguishable from a safe one** — a doctor who sees no alert
 * concludes there is none. So a failure propagates: no try/catch here,
 * none in the repository, and the exception filter turns it into a 500
 * the shell must render as an error rather than as silence.
 *
 * That is the opposite of the composite's other widgets, and deliberately
 * so. `GET /dashboard/doctor` failing costs a page; this failing silently
 * costs a patient.
 */

import { Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CriticalAlertsRepository } from '../repositories/critical-alerts.repository';
import { DashboardRepository } from '../repositories/dashboard.repository';

/** The three sources §16.3 names, as the banner spells them. */
export type CriticalAlertKind = 'unreviewed-critical-lab' | 'allergy-conflict' | 'urgent-reschedule';

export interface CriticalAlertView {
  readonly id: string;
  readonly kind: CriticalAlertKind;
  readonly patientName: string;
  readonly message: string;
  /** The instant the banner sorts and ages by. Never a formatted string. */
  readonly since: string;
  readonly path: string;
}

@Injectable()
export class CriticalAlertsService {
  constructor(
    private readonly alerts: CriticalAlertsRepository,
    private readonly dashboard: DashboardRepository,
  ) {}

  async forDoctor(user: AuthenticatedUser, now = new Date()): Promise<{
    readonly alerts: readonly CriticalAlertView[];
    readonly generatedAt: string;
  }> {
    const doctorId = await this.dashboard.doctorIdFor(user.id);

    // No practice, no alerts — and this is the one empty answer that is
    // honest, because there is nothing to be alerted about rather than a
    // query that did not run.
    if (doctorId === null) return { alerts: [], generatedAt: now.toISOString() };

    const dayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    // `Promise.all`, and a rejection in any one of the three rejects the
    // whole thing. `allSettled` here would be the defect: it would
    // return the two that worked and say nothing about the third.
    const [labs, conflicts, reschedules] = await Promise.all([
      this.alerts.unreviewedCriticalLabs(doctorId),
      this.alerts.todaysCriticalAlerts(doctorId, dayStart, dayEnd),
      this.alerts.urgentReschedules(doctorId, now),
    ]);

    const alerts: CriticalAlertView[] = [
      ...labs.map((lab) => ({
        id: `lab-${lab.publicId}`,
        kind: 'unreviewed-critical-lab' as const,
        patientName: lab.patient.fullName,
        message: `${lab.test.name} — critical value awaiting review`,
        since: lab.requestedAt.toISOString(),
        path: `/doctor/labs/${lab.publicId}`,
      })),
      ...conflicts.map((alert) => ({
        id: `alert-${alert.id}`,
        kind: 'allergy-conflict' as const,
        patientName: alert.patient.fullName,
        message: alert.message,
        since: now.toISOString(),
        path: '/doctor/appointments',
      })),
      ...reschedules.map((appointment) => ({
        id: `apt-${appointment.publicId}`,
        kind: 'urgent-reschedule' as const,
        patientName: appointment.patient.fullName,
        message: 'Urgent appointment was rescheduled',
        since: appointment.startsAt.toISOString(),
        path: `/doctor/appointments/${appointment.publicId}`,
      })),
    ];

    return { alerts, generatedAt: now.toISOString() };
  }
}
