import { StatusBadge } from '@/components/patterns';
import { Avatar } from '@/components/ui';

import {
  RECORD_PRIORITY_META,
  RECORD_STATUS_META,
  primaryDiagnosis,
  type MedicalRecordSummary,
} from '../model/types';

/**
 * Small presentational cells shared by the table, the mobile cards, and
 * the detail page — one implementation per visual.
 */

export function RecordPatientCell({ record }: { record: MedicalRecordSummary }) {
  return (
    <div className="flex items-center gap-3">
      <Avatar name={record.patient.name} size="sm" decorative />
      <div className="min-w-0">
        <p className="truncate text-body-sm font-medium text-text-primary">{record.patient.name}</p>
        <p className="text-caption text-text-tertiary">
          <span dir="ltr">
            {record.patient.age} · {record.patient.gender === 'female' ? 'F' : 'M'}
          </span>
        </p>
      </div>
    </div>
  );
}

export function RecordDiagnosisCell({ record }: { record: MedicalRecordSummary }) {
  const primary = primaryDiagnosis(record);
  if (primary === null) {
    return <span className="text-text-tertiary">—</span>;
  }
  const extra = record.diagnoses.length - 1;
  return (
    <div className="min-w-0">
      <p className="truncate text-body-sm text-text-primary">{primary.label}</p>
      <p className="text-caption text-text-primary">
        <span className="font-mono">{primary.code}</span>
        {extra > 0 ? ` · +${String(extra)} more` : ''}
      </p>
    </div>
  );
}

export function RecordStatusBadge({ record }: { record: MedicalRecordSummary }) {
  const meta = RECORD_STATUS_META[record.status];
  return <StatusBadge status={meta.kind} label={meta.label} />;
}

export function RecordPriorityBadge({ record }: { record: MedicalRecordSummary }) {
  const meta = RECORD_PRIORITY_META[record.priority];
  return <StatusBadge status={meta.kind} label={meta.label} />;
}
