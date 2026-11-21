import { formatDate, formatDateTime } from '@/i18n';
import type { ExportDataset } from '@/utils/export';

import type { MedicalRecord, RecordAttachment } from './types';

/**
 * Per-record export datasets — feed the shared export engine (print / PDF)
 * from the record quick actions and row menus, so every document action on
 * a medical record produces a real file of that visit's clinical summary.
 */

export function recordSummaryDataset(record: MedicalRecord): ExportDataset {
  return {
    filename: `medora-record-${record.id.toLowerCase()}`,
    title: `${record.visitType} — ${record.patient.name}, ${formatDate(record.visitDate)}`,
    columns: ['Field', 'Value'],
    rows: [
      ['Record', record.id],
      ['Patient', `${record.patient.name} (${record.patient.mrn})`],
      ['Visit', `${record.visitType} · ${record.department}`],
      ['Doctor', record.doctor],
      ['Status', record.status],
      ['Chief complaint', record.chiefComplaint],
      ...record.diagnoses.map(
        (diagnosis, index): readonly [string, string] => [
          `Diagnosis ${String(index + 1)}`,
          `${diagnosis.code} — ${diagnosis.label}`,
        ],
      ),
      ...record.treatmentPlan.map(
        (step, index): readonly [string, string] => [`Plan ${String(index + 1)}`, step],
      ),
      ...record.medications.map(
        (medication): readonly [string, string] => [
          'Medication',
          `${medication.name} ${medication.dosage} · ${medication.frequency}`,
        ],
      ),
    ],
  };
}

export function recordAttachmentDataset(
  record: MedicalRecord,
  attachment: RecordAttachment,
): ExportDataset {
  return {
    filename: attachment.name.replace(/\.[^.]+$/, ''),
    title: `${attachment.name} — ${record.visitType}, ${record.patient.name}`,
    columns: ['Field', 'Value'],
    rows: [
      ['Attachment', attachment.name],
      ['Kind', attachment.kind],
      ['Size', `${String(attachment.sizeKb)} KB`],
      ['Uploaded by', attachment.uploadedBy],
      ['Uploaded', formatDateTime(attachment.uploadedAt)],
      ['Record', `${record.id} · ${record.visitType}`],
      ['Patient', record.patient.name],
    ],
  };
}
