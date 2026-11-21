import { type DataTableColumn } from '@/components/ui';
import { formatDate, relativeDayLabel } from '@/utils/dates';

import { type MedicalRecordSummary } from '../model/types';

import {
  RecordDiagnosisCell,
  RecordPatientCell,
  RecordPriorityBadge,
  RecordStatusBadge,
} from './MedicalRecordCells';
import { MedicalRecordRowActions } from './MedicalRecordRowActions';

/**
 * Column set for the medical-records DataTable. Configuration only —
 * cell components live in MedicalRecordCells / MedicalRecordRowActions.
 * Built via a factory because the actions column needs the page's
 * navigation callback.
 *
 * There is no Doctor column. These are the signed-in doctor's records, so
 * naming the doctor on every row spent width the clinical columns needed on
 * what the context already says. The author is still on the record itself,
 * and the Filters drawer still narrows by doctor.
 *
 * Status and priority follow the visit and its diagnosis rather than the
 * department, so the clinical read of a row is on screen beside the summary
 * rail instead of behind the horizontal scroll.
 *
 * Identifiers never wrap — an MRN broken at its hyphen reads as two values.
 */
export function buildMedicalRecordColumns(callbacks: {
  onOpenRecord: (record: MedicalRecordSummary) => void;
}): ReadonlyArray<DataTableColumn<MedicalRecordSummary>> {
  return [
    {
      id: 'id',
      header: 'Record ID',
      sortable: true,
      mono: true,
      cell: (r) => <span className="whitespace-nowrap">{r.id}</span>,
    },
    {
      id: 'patient',
      header: 'Patient',
      sortable: true,
      width: '220px',
      // A floor on the content as well as the column: the name truncates, so
      // without it an overflowing table squeezed the column to the avatar.
      cell: (r) => (
        <div className="min-w-[12rem]">
          <RecordPatientCell record={r} />
        </div>
      ),
      /*
       * The row's identity for assistive tech: a screen reader reading any
       * other cell in this row announces the patient with it. Without it a
       * 13-column worklist reads "Completed" with no way to hear whose result
       * that is (DS §8.19 / DataTable's `rowHeader`, built in wave 2c-a and
       * until now used by nothing).
       */
      rowHeader: true,
    },
    {
      id: 'mrn',
      header: 'MRN',
      sortable: true,
      mono: true,
      cell: (r) => <span className="whitespace-nowrap">{r.patient.mrn}</span>,
    },
    {
      id: 'visitDate',
      header: 'Visit date',
      sortable: true,
      cell: (r) => (
        <div className="min-w-0">
          <p className="whitespace-nowrap text-body-sm tabular-nums">{formatDate(r.visitDate)}</p>
          <p className="text-caption text-text-tertiary">{relativeDayLabel(r.visitDate)}</p>
        </div>
      ),
    },
    {
      id: 'diagnosis',
      header: 'Diagnosis',
      sortable: true,
      width: '220px',
      cell: (r) => <RecordDiagnosisCell record={r} />,
    },
    {
      id: 'status',
      header: 'Status',
      sortable: true,
      cell: (r) => <RecordStatusBadge record={r} />,
    },
    {
      id: 'priority',
      header: 'Priority',
      sortable: true,
      cell: (r) => <RecordPriorityBadge record={r} />,
    },
    {
      id: 'department',
      header: 'Department',
      sortable: true,
      cell: (r) => <span className="whitespace-nowrap">{r.department}</span>,
    },
    {
      id: 'updatedAt',
      header: 'Last updated',
      sortable: true,
      cell: (r) => (
        <div className="min-w-0">
          <p className="whitespace-nowrap text-body-sm tabular-nums">{formatDate(r.updatedAt)}</p>
          <p className="text-caption text-text-tertiary">{relativeDayLabel(r.updatedAt)}</p>
        </div>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'right',
      width: '110px',
      cell: (r) => <MedicalRecordRowActions record={r} onOpenRecord={callbacks.onOpenRecord} />,
    },
  ];
}
