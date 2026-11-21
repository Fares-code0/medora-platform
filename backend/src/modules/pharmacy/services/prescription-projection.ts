/**
 * Row → DTO for the prescription document (API §7.3, §7.4).
 *
 * Pure, with no Prisma import beyond the row type, so the shape a client
 * receives can be asserted without a database — the split
 * `record-projection.ts` and `appointment-projection.ts` both use.
 */

import {
  medicationCategoryToWire,
  medicationFormToWire,
  medicationRouteToWire,
  prescriptionStatusToWire,
  refillStatusToWire,
  timelineKindToWire,
  warningKindToWire,
  warningSeverityToWire,
} from '../dto/pharmacy-enums';
import type {
  PrescriptionDetailView,
  PrescriptionView,
  PrescriptionWarningView,
} from '../dto/prescription.dto';
import type { DetailRow } from '../repositories/prescription.repository';

/**
 * Whole years, in UTC.
 *
 * The same computation `patient.service.ts` does, and deliberately the
 * same: a patient whose age differs between the chart and the
 * prescription reads as two different people.
 */
function ageFrom(dateOfBirth: Date, now: Date): number {
  let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - dateOfBirth.getUTCMonth();

  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < dateOfBirth.getUTCDate())) {
    age -= 1;
  }

  return Math.max(0, age);
}

/** `start_date` and `end_date` are `DATE` columns — no time to carry. */
function toDateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function toWarningView(row: DetailRow['safetyWarnings'][number]): PrescriptionWarningView {
  return {
    id: row.id,
    kind: warningKindToWire(row.kind),
    severity: warningSeverityToWire(row.severity),
    title: row.title,
    detail: row.detail,
    acknowledgedReason: row.acknowledgedReason,
    acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
  };
}

export function toPrescriptionView(row: DetailRow, now: Date): PrescriptionView {
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
      allergies: row.patient.allergies.map((allergy) => allergy.allergen),
      // Computed the same way `patient.service.ts:665` computes it, so
      // one patient cannot be flagged severe on the chart and not on the
      // prescription.
      hasSevereAllergy: row.patient.allergies.some((allergy) => allergy.severity === 'SEVERE'),
    },
    medication: {
      id: row.medication.id,
      name: row.medication.name,
      genericName: row.medication.genericName,
      category: medicationCategoryToWire(row.medication.category),
      // The prescription's own column, not the catalogue's list: the
      // strength chosen when this was written, which must not change if
      // the formulary later drops it.
      strength: row.strength,
      form: medicationFormToWire(row.medication.form),
      route: medicationRouteToWire(row.route),
      manufacturer: row.medication.manufacturer,
      isControlled: row.medication.isControlled,
      isHighRisk: row.medication.isHighRisk,
      interactionNote: row.medication.interactionNote,
      allergyClass: row.medication.allergyClass,
    },
    dosage: row.dosage,
    frequency: row.frequency,
    route: medicationRouteToWire(row.route),
    duration: `${String(row.durationDays)} day${row.durationDays === 1 ? '' : 's'}`,
    durationDays: row.durationDays,
    quantity: row.quantity,
    instructions: row.instructions,
    prescribingDoctor: row.prescriber.fullName,
    department: row.department?.name ?? null,
    status: prescriptionStatusToWire(row.status),
    startDate: toDateString(row.startDate),
    endDate: toDateString(row.endDate),
    refillsAllowed: row.refillsAllowed,
    refillsRemaining: row.refillsRemaining,
    refillStatus: refillStatusToWire(row.refillStatus),
    warnings: row.safetyWarnings.map(toWarningView),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    signedAt: row.signedAt?.toISOString() ?? null,
    discontinuedReason: row.discontinuedReason,
    recordId: row.record?.publicId ?? null,
  };
}

export function toPrescriptionDetailView(row: DetailRow, now: Date): PrescriptionDetailView {
  return {
    ...toPrescriptionView(row, now),
    notes: row.notes.map((note) => ({
      id: note.id,
      author: note.author.displayName,
      authoredAt: note.authoredAt.toISOString(),
      body: note.body,
    })),
    history: row.historyEntries.map((entry) => ({
      id: entry.id,
      date: toDateString(entry.occurredOn),
      event: entry.event,
      detail: entry.detail ?? '',
    })),
    timeline: row.timeline.map((event) => ({
      id: event.id,
      kind: timelineKindToWire(event.kind),
      at: event.occurredAt.toISOString(),
      // `actor_name` is the snapshot ADR-003 §4 prescribes: the display
      // name as it was, so a departed prescriber's history stays
      // readable rather than becoming blank.
      actor: event.actorName ?? 'System',
      detail: event.detail ?? '',
    })),
  };
}
