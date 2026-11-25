/**
 * The patient profile's Lab results tab (RM M15.3 — API §4.5).
 *
 * ## Why this is a list query and not the order list reused
 *
 * `GET /lab-orders` answers "what is in my lab queue", paginated and
 * filtered across the caller's whole scope. This answers "what has this
 * patient ever had", which is a different question with a different
 * shape: no pagination, because a chart tab is read whole, and grouped
 * by category rather than sorted by urgency.
 *
 * It also selects far less. The profile tab **lists; it does not read** —
 * `PatientLabStudiesTab`'s own header says so, and every row links into
 * the labs feature's detail route rather than rendering values. So the
 * results are counted here, never projected: a chart tab that shipped
 * every analyte of every order a patient has had would send the whole
 * laboratory history to render nine words per row, and would put PHI on
 * a surface that never displays it.
 *
 * ## Every order, not only the completed ones
 *
 * A pending order is exactly what a clinician opens this tab to find —
 * "did anyone send the potassium?" — and `LabTestStatus` carries the
 * in-flight states for that reason. This is the opposite of the trend
 * query's rule (completed only), and deliberately so: a trend plots
 * released values, a history lists orders.
 *
 * ## Care scope, as a clause
 *
 * The patient is asserted through `PatientScopeService` before this
 * runs, and the `patientId` here is the resolved uuid — so this query
 * cannot be reached with a handle that was never scoped.
 */

import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/database';

const STUDY_SELECT = {
  publicId: true,
  status: true,
  requestedAt: true,
  collectedAt: true,
  completedAt: true,
  reviewedAt: true,
  hasCriticalResult: true,
  test: { select: { name: true, code: true, category: true } },
  // Flags only. The counts the tab shows are derived from these, and a
  // flag is not a clinical value — it is the judgement already made
  // about one (M14.4), so counting them here discloses nothing the row
  // does not already say.
  results: { where: { deletedAt: null }, select: { flag: true } },
} satisfies Prisma.LabOrderSelect;

export type PatientStudyRow = Prisma.LabOrderGetPayload<{ select: typeof STUDY_SELECT }>;

@Injectable()
export class PatientLabRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Every lab order this patient has, newest first. */
  /** At the reader's hospital only (DR-05 at resource level, F-01). */
  studiesFor(patientId: string, hospitalId: string): Promise<readonly PatientStudyRow[]> {
    return this.prisma.db.labOrder.findMany({
      where: { patientId, hospitalId, deletedAt: null },
      select: STUDY_SELECT,
      // Newest first, and by `requested_at` rather than by the resolved
      // display date: the display date falls back through three columns
      // (see `toPatientStudyView`), which is not an ordering the
      // database can index. Requested order is stable, is what the
      // `(patient_id, requested_at)` index of DB §8 already produces,
      // and is the order the rows were created in — so two studies
      // resulted on the same day keep the sequence they were ordered in
      // rather than an arbitrary one.
      orderBy: { requestedAt: 'desc' },
      // A chart tab is read whole, so there is no page — but a patient
      // with a decade of daily bloods is still not something to stream
      // unbounded into a browser. 500 orders is far past what anyone
      // scrolls and far short of what would hurt; the cap is reported
      // on the response rather than hidden, so a truncated history says
      // it is truncated.
      take: 501,
    });
  }
}
