import { Badge } from '@/components/ui';

import type { MedicalRecord } from '../../model/types';

import { EmptySectionNote, RecordSectionCard } from './RecordSectionCard';

/** Diagnoses — ICD-10 code + label; the primary diagnosis is flagged. */
export function RecordDiagnosesSection({ record }: { record: MedicalRecord }) {
  return (
    <RecordSectionCard title="Diagnoses">
      {record.diagnoses.length === 0 ? (
        <EmptySectionNote>No diagnoses recorded for this encounter.</EmptySectionNote>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {record.diagnoses.map((diagnosis) => (
            <li
              key={diagnosis.code}
              className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="text-body-sm font-medium text-text-primary">{diagnosis.label}</p>
                <p className="text-caption text-text-primary">
                  ICD-10 <span className="font-mono">{diagnosis.code}</span>
                </p>
              </div>
              {diagnosis.isPrimary ? <Badge variant="info">Primary</Badge> : null}
            </li>
          ))}
        </ul>
      )}
    </RecordSectionCard>
  );
}
