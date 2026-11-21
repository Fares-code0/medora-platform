/**
 * The patient profile's Lab results tab (RM M15.3 — API §4.5).
 *
 * > ✅ Verify: profile Labs/Prescriptions tabs show M13/M14 data.
 *
 * The Prescriptions half of that verify step was closed at M13.6 —
 * `GET /patients/{id}/medications` has served the live, Rx-linked list
 * since signing began materialising it. The Labs half had no source at
 * all: `PatientLabStudiesTab` reads `features/shared-domain/lab-studies`,
 * a frontend store, and the M14 orders it needs had no patient-scoped
 * read anywhere on the API. This service is that read.
 *
 * ## Three rules, all of them the frontend's
 *
 * **The display date falls back.** `completedDate ?? collectedDate ??
 * requestedDate` — `toPatientStudy`'s own resolution, transcribed. An
 * order still in the lab has no result date, and dating it by when it
 * was ordered under a "Completed" heading would misdate the result.
 *
 * **`reviewed` is `review !== null`**, which on this side is
 * `reviewedAt !== null`. Not `reviewStatus === 'reviewed'`: that state
 * is `not-required` for an order with no results, and an order nobody
 * has looked at because there is nothing to look at has not been
 * reviewed. The tab renders the two differently.
 *
 * **Grouping is by the test's category**, and the groups come back in a
 * fixed order rather than the order the patient's history happens to
 * produce. A tab whose sections reshuffled between two visits to the
 * same chart is a tab a reader has to re-scan every time.
 *
 * ## Care scope
 *
 * A patient's laboratory history is patient-child data: same gate and
 * the same non-disclosing refusal as every other chart read (RM M7.2,
 * ADR-022). The scope check runs before a single order is read.
 */

import { Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import { PatientScopeService, principalOf } from '../../../shared/authz';
import { LAB_CATEGORY_VALUES, labCategoryToWire, labStatusToWire } from '../dto/labs-enums';
import type {
  PatientLabStudiesView,
  PatientLabStudyCategoryView,
  PatientLabStudyView,
} from '../dto/patient-lab.dto';
import { LabOrderRepository } from '../repositories/lab-order.repository';
import {
  PatientLabRepository,
  type PatientStudyRow,
} from '../repositories/patient-lab.repository';
import { isAbnormalFlag } from './result-grading';

/** The repository asks for one more than the cap, to detect the overflow. */
const MAX_STUDIES = 500;

@Injectable()
export class PatientLabService {
  constructor(
    private readonly studies: PatientLabRepository,
    private readonly orders: LabOrderRepository,
    private readonly scope: PatientScopeService,
  ) {}

  /** API §4.5 — `GET /patients/{patientId}/labs`. */
  async forPatient(
    user: AuthenticatedUser,
    patientPublicId: string,
  ): Promise<PatientLabStudiesView> {
    await this.scope.assertCanReach(principalOf(user), patientPublicId);

    const patient = await this.orders.patientByPublicId(patientPublicId);
    if (patient === null) throw AppException.notFound('Patient not found');

    const rows = await this.studies.studiesFor(patient.id);
    const truncated = rows.length > MAX_STUDIES;
    const kept = truncated ? rows.slice(0, MAX_STUDIES) : rows;

    return {
      patientId: patient.publicId,
      categories: groupByCategory(kept.map(toPatientStudyView)),
      totalStudies: kept.length,
      truncated,
    };
  }
}

function toPatientStudyView(row: PatientStudyRow): PatientLabStudyView {
  return {
    labId: row.publicId,
    testName: row.test.name,
    testCode: row.test.code,
    category: labCategoryToWire(row.test.category),
    status: labStatusToWire(row.status),
    // The frontend's `toPatientStudy`, verbatim — see the file header.
    date: (row.completedAt ?? row.collectedAt ?? row.requestedAt).toISOString(),
    resultCount: row.results.length,
    abnormalCount: row.results.filter((result) => isAbnormalFlag(result.flag)).length,
    // Read, never written: the M5.10 trigger recomputes it from the
    // results on every change, so a corrected value clears it.
    hasCriticalResult: row.hasCriticalResult,
    reviewed: row.reviewedAt !== null,
  };
}

/**
 * Groups into the catalogue's category order, dropping the empty ones.
 *
 * Iterating the vocabulary rather than the patient's rows is what makes
 * the order stable: a chart whose sections appear in the order the
 * patient happened to be tested in reshuffles every time a new study
 * lands.
 */
function groupByCategory(
  studies: readonly PatientLabStudyView[],
): readonly PatientLabStudyCategoryView[] {
  const groups: PatientLabStudyCategoryView[] = [];

  for (const category of LAB_CATEGORY_VALUES) {
    const matching = studies.filter((study) => study.category === category);
    if (matching.length === 0) continue;

    // `id` and `label` are the same string, which is the frontend's own
    // shape (`PatientLabStudyCategory` types both as `LabTestCategory`):
    // the category vocabulary is already display text, so there is no
    // second label to look up and inventing one would put a name on the
    // wire that no client asked for.
    groups.push({ id: category, label: category, studies: matching });
  }

  return groups;
}
