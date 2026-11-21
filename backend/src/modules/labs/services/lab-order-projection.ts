/**
 * Row → DTO for the lab order (API §8.2, §8.3).
 *
 * Pure, with no Prisma import beyond the row type, so the shape a client
 * receives can be asserted without a database — the same split
 * `prescription-projection.ts` and `record-projection.ts` use.
 */

import {
  labAttachmentKindToWire,
  labCategoryToWire,
  labPriorityToWire,
  labResultFlagToWire,
  labSpecimenConditionToWire,
  labSpecimenTypeToWire,
  labStatusToWire,
  labTimelineKindToWire,
} from '../dto/labs-enums';
import type {
  LabAttachmentView,
  LabOrderDetailView,
  LabOrderView,
  LabResultItemView,
  LabResultSummaryView,
  LabSpecimenView,
  LabTimelineEventView,
} from '../dto/lab-order.dto';
import type { DetailRow } from '../repositories/lab-order.repository';

import { reviewStateOf } from './lab-review';
import { isAbnormalFlag, isCriticalFlag } from './result-grading';

/**
 * Whole years, in UTC.
 *
 * The same computation `patient.service.ts` and
 * `prescription-projection.ts` do, and deliberately the same: a patient
 * whose age differs between the chart and a lab report reads as two
 * different people, which is precisely the confusion §8.9's identity
 * check exists to catch.
 */
function ageFrom(dateOfBirth: Date, now: Date): number {
  let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - dateOfBirth.getUTCMonth();

  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < dateOfBirth.getUTCDate())) {
    age -= 1;
  }

  return Math.max(0, age);
}

function toResultItemView(row: DetailRow['results'][number]): LabResultItemView {
  return {
    id: row.id,
    analyte: row.analyte,
    value: row.valueText,
    // Null for a qualitative result, which is what the trend endpoint
    // filters on: a series of "Negative" is not a line chart.
    numericValue: row.valueNumeric === null ? null : row.valueNumeric.toNumber(),
    unit: row.unit,
    referenceRange: {
      // The range **as snapshotted onto this row** (DB §E5), never the
      // catalogue's current one. A reference interval revised next year
      // must not retroactively change whether this result was abnormal.
      low: row.refLow === null ? null : row.refLow.toNumber(),
      high: row.refHigh === null ? null : row.refHigh.toNumber(),
      text: row.refText,
    },
    flag: labResultFlagToWire(row.flag),
    resultedAt: row.resultedAt.toISOString(),
  };
}

function toSpecimenView(row: NonNullable<DetailRow['specimen']>): LabSpecimenView {
  return {
    type: labSpecimenTypeToWire(row.type),
    container: row.container,
    collectionSite: row.collectionSite,
    // The **name snapshot**, not a join through `collected_by_id`
    // (ADR-003 §4): a collector whose account was removed still has to
    // be readable, or the chain of custody breaks when someone leaves.
    collectedBy: row.collectedBy,
    collectedAt: row.collectedAt.toISOString(),
    receivedAt: row.receivedAt?.toISOString() ?? null,
    condition: labSpecimenConditionToWire(row.condition),
    volume: row.volume,
  };
}

function toAttachmentView(row: DetailRow['attachments'][number]): LabAttachmentView {
  return {
    id: row.id,
    name: row.name,
    kind: labAttachmentKindToWire(row.kind),
    sizeKb: row.sizeKb,
    // SET NULL on the uploader (DB §9) — the file outlives the account.
    uploadedBy: row.uploader?.displayName ?? 'Unknown',
    uploadedAt: row.uploadedAt.toISOString(),
  };
}

function toTimelineView(row: DetailRow['timeline'][number]): LabTimelineEventView {
  return {
    id: row.id,
    kind: labTimelineKindToWire(row.kind),
    at: row.occurredAt.toISOString(),
    // `actor` is NOT NULL here, unlike the record and prescription
    // timelines: DB §E7 types it that way because a lab step with no
    // attributed actor breaks the chain of custody the specimen record
    // exists to keep. So there is no "System" fallback to write.
    actor: row.actor,
    detail: row.detail ?? '',
  };
}

export function resultSummaryOf(row: DetailRow): LabResultSummaryView {
  return {
    total: row.results.length,
    abnormal: row.results.filter((result) => isAbnormalFlag(result.flag)).length,
    critical: row.results.filter((result) => isCriticalFlag(result.flag)).length,
  };
}

export function toLabOrderView(row: DetailRow, now: Date): LabOrderView {
  return {
    id: row.publicId,
    patient: {
      id: row.patient.publicId,
      name: row.patient.fullName,
      mrn: row.patient.mrn,
      age: ageFrom(row.patient.dateOfBirth, now),
      gender: row.patient.gender.toLowerCase(),
      bloodType: row.patient.bloodType,
      phone: row.patient.phone,
    },
    testName: row.test.name,
    testCode: row.test.code,
    category: labCategoryToWire(row.test.category),
    department: row.department?.name ?? null,
    orderedBy: row.orderer.fullName,
    clinicalIndication: row.clinicalIndication,
    status: labStatusToWire(row.status),
    priority: labPriorityToWire(row.priority),
    requestedDate: row.requestedAt.toISOString(),
    collectedDate: row.collectedAt?.toISOString() ?? null,
    completedDate: row.completedAt?.toISOString() ?? null,
    // Read, never written: the M5.10 trigger recomputes it from the
    // results on every change, which is what keeps a stored derivation
    // honest.
    hasCriticalResult: row.hasCriticalResult,
    resultSummary: resultSummaryOf(row),
    reviewStatus: reviewStateOf({
      reference: row.publicId,
      reviewedAt: row.reviewedAt,
      results: row.results,
    }),
    review:
      row.reviewedAt === null
        ? null
        : {
            reviewedAt: row.reviewedAt.toISOString(),
            // SET NULL on the reviewer, so a departed doctor's review
            // stays a review rather than becoming an empty claim.
            reviewedBy: row.reviewer?.displayName ?? 'Unknown',
          },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toLabOrderDetailView(row: DetailRow, now: Date): LabOrderDetailView {
  return {
    ...toLabOrderView(row, now),
    specimen: row.specimen === null ? null : toSpecimenView(row.specimen),
    results: row.results.map(toResultItemView),
    interpretation: row.interpretation,
    attachments: row.attachments.map(toAttachmentView),
    timeline: row.timeline.map(toTimelineView),
  };
}
