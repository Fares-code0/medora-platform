import { StatusBadge } from '@/components/patterns';

import { RECORD_ALLERGY_SEVERITY_META, type MedicalRecord } from '../../model/types';

import { EmptySectionNote, RecordSectionCard } from './RecordSectionCard';

/**
 * Allergies on file for the patient at this encounter. The severe-allergy
 * strip in the page header (UX 1.5 rule 4) is never the only surface —
 * this section carries the reactions in full.
 */
export function RecordAllergiesSection({ record }: { record: MedicalRecord }) {
  return (
    <RecordSectionCard title="Allergies">
      {record.allergies.length === 0 ? (
        <EmptySectionNote>No known allergies documented.</EmptySectionNote>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {record.allergies.map((allergy) => {
            const meta = RECORD_ALLERGY_SEVERITY_META[allergy.severity];
            return (
              <li
                key={allergy.id}
                className="flex flex-wrap items-start justify-between gap-2 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="text-body-sm font-medium text-text-primary">{allergy.allergen}</p>
                  <p className="text-caption text-text-tertiary">{allergy.reaction}</p>
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
