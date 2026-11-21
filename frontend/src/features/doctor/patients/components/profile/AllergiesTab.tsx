import { Plus } from 'lucide-react';

import { Alert, EmptyState } from '@/components/feedback';
import { Stack } from '@/components/layout';
import { StatusBadge } from '@/components/patterns';
import { Button, DataTable, type DataTableColumn } from '@/components/ui';
import { formatDate } from '@/utils/dates';

import { ALLERGY_SEVERITY_META, type AllergyRecord } from '../../model/profile-types';

/**
 * Allergies tab. Critical (severe) allergies additionally render as a
 * non-dismissible error alert above the table — combined with the fixed
 * header strip, severe allergies are visible from every tab (UX 1.5).
 */

const COLUMNS: ReadonlyArray<DataTableColumn<AllergyRecord>> = [
  {
    id: 'allergen',
    header: 'Allergy',
    cell: (allergy) => <span className="font-medium">{allergy.allergen}</span>,
  },
  {
    id: 'severity',
    header: 'Severity',
    cell: (allergy) => {
      const meta = ALLERGY_SEVERITY_META[allergy.severity];
      return <StatusBadge status={meta.kind} label={meta.label} />;
    },
  },
  { id: 'reaction', header: 'Reaction', cell: (allergy) => allergy.reaction },
  {
    id: 'notes',
    header: 'Notes',
    cell: (allergy) =>
      allergy.notes === null ? <span className="text-text-tertiary">—</span> : allergy.notes,
  },
  {
    id: 'recorded',
    header: 'Recorded',
    cell: (allergy) => (
      <span className="whitespace-nowrap tabular-nums">{formatDate(allergy.recordedAt)}</span>
    ),
  },
];

export interface AllergiesTabProps {
  allergies: readonly AllergyRecord[];
  /** Opens the record-allergy dialog; the button is absent without it. */
  onRecord?: (() => void) | undefined;
}

export function AllergiesTab({ allergies, onRecord }: AllergiesTabProps) {
  const severe = allergies.filter((allergy) => allergy.severity === 'severe');

  return (
    <Stack gap={4}>
      {onRecord !== undefined ? (
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" leadingIcon={Plus} onClick={onRecord}>
            Record allergy
          </Button>
        </div>
      ) : null}
      {severe.length > 0 ? (
        <Alert
          variant="error"
          critical
          title={`Severe: ${severe.map((allergy) => allergy.allergen).join(', ')}`}
        >
          Verify against every prescription and procedure. This alert cannot be dismissed.
        </Alert>
      ) : null}
      <DataTable
        caption="Documented allergies with severity, reaction, and notes"
        columns={COLUMNS}
        rows={allergies}
        getRowId={(allergy) => allergy.id}
        emptyState={
          <EmptyState
            title="No known allergies"
            description="Documented allergies and reactions will appear here."
          />
        }
      />
    </Stack>
  );
}
