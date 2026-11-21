import { type DataTableColumn } from '@/components/ui';
import { formatDate } from '@/utils/dates';

import { type PrescriptionSummary } from '../model/types';

import { MedicationCell, PrescriptionPatientCell, PrescriptionStatusBadge } from './PharmacyCells';
import { PrescriptionRowActions } from './PrescriptionRowActions';

/**
 * Column set for the pharmacy DataTable. Configuration only — cell
 * components live in PharmacyCells / PrescriptionRowActions. Built via a
 * factory because the actions column needs the page's navigation
 * callback.
 */
export function buildPrescriptionColumns(callbacks: {
  onOpen: (prescription: PrescriptionSummary) => void;
  onRenew?: ((prescription: PrescriptionSummary) => void) | undefined;
  onEnd?: ((prescription: PrescriptionSummary) => void) | undefined;
}): ReadonlyArray<DataTableColumn<PrescriptionSummary>> {
  return [
    { id: 'id', header: 'Rx ID', sortable: true, mono: true, cell: (p) => p.id },
    {
      id: 'patient',
      header: 'Patient',
      sortable: true,
      width: '200px',
      cell: (p) => <PrescriptionPatientCell prescription={p} />,
      /*
       * The row's identity for assistive tech: a screen reader reading any
       * other cell in this row announces the patient with it. Without it a
       * 13-column worklist reads "Completed" with no way to hear whose result
       * that is (DS §8.19 / DataTable's `rowHeader`, built in wave 2c-a and
       * until now used by nothing).
       */
      rowHeader: true,
    },
    { id: 'mrn', header: 'MRN', sortable: true, mono: true, cell: (p) => p.patient.mrn },
    {
      id: 'medication',
      header: 'Medication',
      sortable: true,
      width: '200px',
      cell: (p) => <MedicationCell prescription={p} />,
    },
    {
      id: 'dosage',
      header: 'Dosage',
      cell: (p) => (
        <span className="whitespace-nowrap tabular-nums" dir="ltr">
          {p.dosage}
        </span>
      ),
    },
    {
      id: 'frequency',
      header: 'Frequency',
      cell: (p) => <span className="whitespace-nowrap">{p.frequency}</span>,
    },
    {
      id: 'duration',
      header: 'Duration',
      cell: (p) => (
        <span className="whitespace-nowrap tabular-nums" dir="ltr">
          {p.duration}
        </span>
      ),
    },
    {
      id: 'doctor',
      header: 'Prescribed by',
      sortable: true,
      cell: (p) => (
        <span className="whitespace-nowrap text-text-secondary">{p.prescribingDoctor}</span>
      ),
    },
    {
      id: 'startDate',
      header: 'Start',
      sortable: true,
      cell: (p) => (
        <span className="whitespace-nowrap text-body-sm tabular-nums">
          {formatDate(p.startDate)}
        </span>
      ),
    },
    {
      id: 'endDate',
      header: 'End',
      sortable: true,
      cell: (p) => (
        <span className="whitespace-nowrap text-body-sm tabular-nums">{formatDate(p.endDate)}</span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      sortable: true,
      cell: (p) => <PrescriptionStatusBadge prescription={p} />,
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'right',
      width: '110px',
      cell: (p) => (
        <PrescriptionRowActions
          prescription={p}
          onOpen={callbacks.onOpen}
          onRenew={callbacks.onRenew}
          onEnd={callbacks.onEnd}
        />
      ),
    },
  ];
}
