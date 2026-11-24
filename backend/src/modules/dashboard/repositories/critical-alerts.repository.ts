/**
 * The Row-0 banner's three sources (API §16.3, RM M27.3).
 *
 * ## Its own class, and that is what makes "fail loud" testable
 *
 * M27.3's verify step is: *with the source query forced to fail the
 * endpoint returns 5xx, never 200 with `[]`*. Forcing a query to fail
 * needs a seam, and a seam a test can reach is a provider it can
 * substitute. Splitting these three queries out of `DashboardRepository`
 * is that seam — the spec binds this class to one that throws and
 * asserts the route does not answer 200.
 *
 * Nothing here catches anything. A rejection propagates to the service,
 * which also does not catch it, and reaches the exception filter as a
 * 500. That chain is the feature: this is a safety surface, and an empty
 * banner is indistinguishable from a safe one.
 */

import { Injectable } from '@nestjs/common';

import type { ClinicalEmployment } from '../../../shared/authz';

import { PrismaService } from '../../../shared/database';

export interface CriticalLabRow {
  readonly publicId: string;
  readonly requestedAt: Date;
  readonly patient: { readonly fullName: string };
  readonly test: { readonly name: string };
}

export interface AlertRow {
  readonly id: string;
  readonly message: string;
  readonly patient: { readonly fullName: string };
}

export interface RescheduleRow {
  readonly publicId: string;
  readonly startsAt: Date;
  readonly patient: { readonly fullName: string };
}

@Injectable()
export class CriticalAlertsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Released, flagged critical, and nobody has looked at it yet. */
  unreviewedCriticalLabs(doctor: ClinicalEmployment): Promise<CriticalLabRow[]> {
    return this.prisma.db.labOrder.findMany({
      where: {
        orderedBy: doctor.doctorId,
        hospitalId: doctor.hospitalId,
        hasCriticalResult: true,
        reviewedAt: null,
      },
      select: {
        publicId: true,
        requestedAt: true,
        patient: { select: { fullName: true } },
        test: { select: { name: true } },
      },
      orderBy: { requestedAt: 'asc' },
    });
  }

  /**
   * Active critical alerts on the patients this doctor sees **today**.
   *
   * `patient_clinical_alerts` is DB §B12's "fixed, non-dismissible
   * banner content" — the row a conflict is recorded on. The banner does
   * not re-run a safety screen: the screen runs where prescribing
   * happens (M13.3), in a module this one may not import, and re-deriving
   * a conflict here would be a second implementation of a
   * patient-safety rule.
   */
  todaysCriticalAlerts(
    doctor: ClinicalEmployment,
    dayStart: Date,
    dayEnd: Date,
  ): Promise<AlertRow[]> {
    return this.prisma.db.patientClinicalAlert.findMany({
      where: {
        active: true,
        severity: 'CRITICAL',
        // The active hospital's alerts, about today's bookings there (S3/S4).
        hospitalId: doctor.hospitalId,
        patient: {
          appointments: {
            some: {
              doctorId: doctor.doctorId,
              hospitalId: doctor.hospitalId,
              deletedAt: null,
              startsAt: { gte: dayStart, lt: dayEnd },
            },
          },
        },
      },
      select: { id: true, message: true, patient: { select: { fullName: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Urgent appointments that were moved and are still ahead. */
  urgentReschedules(doctor: ClinicalEmployment, from: Date): Promise<RescheduleRow[]> {
    return this.prisma.db.appointment.findMany({
      where: {
        doctorId: doctor.doctorId,
        hospitalId: doctor.hospitalId,
        priority: 'URGENT',
        status: 'RESCHEDULED',
        startsAt: { gte: from },
      },
      select: { publicId: true, startsAt: true, patient: { select: { fullName: true } } },
      orderBy: { startsAt: 'asc' },
    });
  }
}
