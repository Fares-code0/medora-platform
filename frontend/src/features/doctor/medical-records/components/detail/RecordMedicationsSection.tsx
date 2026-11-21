import { StatusBadge } from '@/components/patterns';

import { RECORD_MEDICATION_STATUS_META, type MedicalRecord } from '../../model/types';

import { EmptySectionNote, RecordSectionCard } from './RecordSectionCard';

/** Medications prescribed or reviewed during this encounter. */
export function RecordMedicationsSection({ record }: { record: MedicalRecord }) {
  return (
    <RecordSectionCard title="Medications">
      {record.medications.length === 0 ? (
        <EmptySectionNote>No medications were prescribed at this visit.</EmptySectionNote>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {record.medications.map((medication) => {
            const meta = RECORD_MEDICATION_STATUS_META[medication.status];
            return (
              <li
                key={medication.id}
                className="flex flex-wrap items-start justify-between gap-2 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="text-body-sm font-medium text-text-primary">
                    {medication.name} · {medication.dosage}
                  </p>
                  <p className="text-caption text-text-tertiary">
                    {medication.frequency}
                    {medication.instructions ? ` · ${medication.instructions}` : ''}
                  </p>
                </div>
                <StatusBadge status={meta.kind} label={meta.label} />
              </li>
            );
          })}
        </ul>
      )}
    </RecordSectionCard>
  );
}
