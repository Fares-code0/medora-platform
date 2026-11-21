import { EmptyState } from '@/components/feedback';
import { StatusBadge } from '@/components/patterns';
import { DataTable, type DataTableColumn } from '@/components/ui';
import { formatDate } from '@/utils/dates';

import { MEDICATION_STATUS_META, type MedicationRecord } from '../../model/profile-types';

/**
 * Medications tab — read-only medication list (prescribing flows are the
 * Phase 7 pharmacy feature). Columns per the Phase 4 spec.
 */

const COLUMNS: ReadonlyArray<DataTableColumn<MedicationRecord>> = [
  {
    id: 'name',
    header: 'Medication',
    cell: (medication) => <span className="font-medium">{medication.name}</span>,
  },
  {
    id: 'dosage',
    header: 'Dosage',
    cell: (medication) => <span dir="ltr">{medication.dosage}</span>,
  },
  { id: 'frequency', header: 'Frequency', cell: (medication) => medication.frequency },
  {
    id: 'start',
    header: 'Start date',
    cell: (medication) => (
      <span className="whitespace-nowrap tabular-nums">{formatDate(medication.startDate)}</span>
    ),
  },
  {
    id: 'end',
    header: 'End date',
    cell: (medication) =>
      medication.endDate === null ? (
        <span className="text-text-tertiary">Ongoing</span>
      ) : (
        <span className="whitespace-nowrap tabular-nums">{formatDate(medication.endDate)}</span>
      ),
  },
  {
    id: 'prescriber',
    header: 'Prescribed by',
    cell: (medication) => (
      <span className="whitespace-nowrap text-text-secondary">{medication.prescribedBy}</span>
    ),
  },
  {
    id: 'status',
    header: 'Status',
    cell: (medication) => {
      const meta = MEDICATION_STATUS_META[medication.status];
      return <StatusBadge status={meta.kind} label={meta.label} />;
    },
  },
];

export function MedicationsTab({ medications }: { medications: readonly MedicationRecord[] }) {
  return (
    <DataTable
      caption="Patient medications with dosage, schedule, prescriber, and status"
      columns={COLUMNS}
      rows={medications}
      getRowId={(medication) => medication.id}
      emptyState={
        <EmptyState
          title="No medications on record"
          description="Prescriptions issued to this patient will appear here."
        />
      }
    />
  );
}
