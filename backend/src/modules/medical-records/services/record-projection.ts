/**
 * Row → wire, for the clinical document (API §6.1, §6.2, §6.8).
 *
 * One place where a column becomes a field, so the list and the detail
 * cannot disagree about a record's status or its primary diagnosis.
 */

import {
  allergySeverityToWire,
  attachmentKindToWire,
  bloodTypeToWire,
  genderToWire,
  medicationStatusToWire,
  recordPriorityToWire,
  recordStatusToWire,
  timelineKindToWire,
} from '../dto/record-enums';
import {
  ageOn,
  type MedicalRecordDetailView,
  type MedicalRecordView,
  type RecordVersionView,
  type RecordVitalsView,
} from '../dto/record.dto';
import type { AttachmentKindWire } from '../dto/record.schema';
import type { DetailRow, ListRow } from '../repositories/record.repository';

export function toView(row: ListRow, now: Date): MedicalRecordView {
  return {
    id: row.publicId,
    patient: {
      id: row.patient.publicId,
      name: row.patient.fullName,
      mrn: row.patient.mrn,
      age: ageOn(row.patient.dateOfBirth, now),
      gender: genderToWire(row.patient.gender),
      bloodType: bloodTypeToWire(row.patient.bloodType),
      phone: row.patient.phone,
    },
    visitDate: row.visitDate.toISOString(),
    visitType: row.visitType,
    department: row.department?.name ?? null,
    doctorId: row.doctor.id,
    doctor: row.doctor.fullName,
    status: recordStatusToWire(row.status),
    priority: recordPriorityToWire(row.priority),
    diagnoses: row.diagnoses.map((diagnosis) => ({
      code: diagnosis.icdCode.code,
      label: diagnosis.icdCode.label,
      isPrimary: diagnosis.isPrimary,
    })),
    chiefComplaint: row.chiefComplaint,
    // `@db.Date` — a calendar day, so the date half only. Serializing
    // the midnight instant would put a timezone on a day that has none,
    // and a client east of UTC would render the day before.
    followUpDate: row.followUpDate === null ? null : toDateOnly(row.followUpDate),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toDetailView(row: DetailRow, now: Date): MedicalRecordDetailView {
  return {
    ...toView(row, now),
    historyOfPresentIllness: row.historyOfPresentIllness,
    physicalExamination: row.physicalExamination,
    vitals: toVitals(row.vitalSigns[0]),
    treatmentPlan: row.treatmentPlan.map((item) => item.text),
    medications: row.medications.map((medication) => ({
      id: medication.id,
      name: medication.name,
      dosage: medication.dosage,
      frequency: medication.frequency,
      instructions: medication.instructions,
      status: medicationStatusToWire(medication.status),
      prescriptionId: medication.prescription?.publicId ?? null,
    })),
    allergies: row.allergies.map((allergy) => ({
      id: allergy.id,
      allergen: allergy.allergen,
      severity: allergySeverityToWire(allergy.severity),
      reaction: allergy.reaction,
    })),
    notes: row.notes.map((note) => ({
      id: note.id,
      author: note.author.displayName,
      authoredAt: note.authoredAt.toISOString(),
      title: note.title,
      body: note.body,
      signed: note.signed,
      signedAt: note.signedAt?.toISOString() ?? null,
      aiAssisted: note.aiAssisted,
    })),
    attachments: row.attachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      kind: attachmentKindToWire(attachment.kind) as AttachmentKindWire,
      sizeKb: attachment.sizeKb,
      uploadedBy: attachment.uploader?.displayName ?? 'System',
      uploadedAt: attachment.uploadedAt.toISOString(),
    })),
    timeline: row.timeline.map((event) => ({
      id: event.id,
      kind: timelineKindToWire(event.kind),
      at: event.occurredAt.toISOString(),
      // `System` rather than blank: an actor-less row is a scheduled
      // job, which is a fact worth stating.
      actor: event.actorName ?? 'System',
      detail: event.detail ?? '',
    })),
  };
}

export function toVersionView(row: {
  version: number;
  changedAt: Date;
  actorName: string | null;
  summary: string | null;
  reason: string | null;
  changes: unknown;
}): RecordVersionView {
  return {
    version: row.version,
    changedAt: row.changedAt.toISOString(),
    actor: row.actorName ?? 'System',
    summary: row.summary,
    reason: row.reason,
    changes: isRecord(row.changes) ? row.changes : {},
  };
}

/**
 * The latest vitals, or `null`.
 *
 * `null` rather than a zeroed object: a draft written before the nurse
 * has taken observations genuinely has none, and `0/0 mmHg` with a BMI
 * of 0 is a clinical falsehood rather than a missing value.
 */
function toVitals(row: DetailRow['vitalSigns'][number] | undefined): RecordVitalsView | null {
  if (row === undefined) return null;

  return {
    recordedAt: row.recordedAt.toISOString(),
    // The frontend renders `bloodPressure` as one string; the schema
    // stores the two numbers, which is what a trend query needs. The
    // join belongs here, at the serialization boundary.
    bloodPressure: `${String(row.bloodPressureSystolic)}/${String(row.bloodPressureDiastolic)}`,
    heartRateBpm: row.heartRateBpm,
    temperatureC: Number(row.temperatureC),
    respiratoryRate: row.respiratoryRate,
    oxygenSaturation: row.oxygenSaturation,
    weightKg: Number(row.weightKg),
    heightCm: Number(row.heightCm),
    // Generated by Postgres from the two above, so it cannot be stale.
    // `null` only when the height is zero, where 0 is the one value that
    // cannot be mistaken for a reading.
    bmi: row.bmi === null ? 0 : Number(row.bmi),
  };
}

/** `YYYY-MM-DD` from a `@db.Date`, which Prisma returns as UTC midnight. */
function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
