import type { LabTest } from '../../model/types';

import { EmptySectionNote, LabSectionCard } from './LabSectionCard';

/** Interpretation — the lab's narrative summary of the released result. */
export function LabInterpretationSection({ test }: { test: LabTest }) {
  return (
    <LabSectionCard title="Interpretation">
      {test.interpretation === null ? (
        <EmptySectionNote>An interpretation is added once the result is released.</EmptySectionNote>
      ) : (
        <p className="text-body-sm text-text-secondary">{test.interpretation}</p>
      )}
    </LabSectionCard>
  );
}
