import { type DataTableColumn } from '@/components/ui';
import { formatDate, relativeDayLabel } from '@/utils/dates';

import { type LabTest } from '../model/types';

import {
  LabCategoryCell,
  LabFlagCell,
  LabPatientCell,
  LabPriorityBadge,
  LabReviewCell,
  LabStatusBadge,
  LabTestNameCell,
} from './LabCells';
import { LabRowActions, type LabRowActionsProps } from './LabRowActions';

/**
 * Column set for the laboratory DataTable. Configuration only — cell
 * components live in LabCells / LabRowActions. Built via a factory
 * because the actions column needs the page's navigation callback.
 *
 * **Column order follows UX §2.6**: "flag badge · patient · test/panel name ·
 * result summary · collected date · received date · review status · ⋯". Flag
 * leads because the first question a doctor asks a worklist is "is anything
 * wrong here", and the result summary ("3 of 24 abnormal") rides inside the
 * flag cell rather than taking a column of its own.
 *
 * The Category, Ordered-by and Priority columns the Phase-7 table carried are
 * kept — they are filterable and were already load-bearing — but flag and
 * review now sit at the two ends where they are scanned.
 */
export function buildLabColumns(callbacks: {
  onOpenTest: (test: LabTest) => void;
  /** Per-row review affordances; omitted, the ⋯ menu is navigation only. */
  rowReview?: ((test: LabTest) => LabRowActionsProps['review']) | undefined;
}): ReadonlyArray<DataTableColumn<LabTest>> {
  return [
    { id: 'flag', header: 'Flag', width: '150px', cell: (t) => <LabFlagCell test={t} /> },
    { id: 'id', header: 'Lab ID', sortable: true, mono: true, cell: (t) => t.id },
    {
      id: 'patient',
      header: 'Patient',
      sortable: true,
      width: '200px',
      cell: (t) => <LabPatientCell test={t} />,
      /*
       * The row's identity for assistive tech: a screen reader reading any
       * other cell in this row announces the patient with it. Without it a
       * 13-column worklist reads "Completed" with no way to hear whose result
       * that is (DS §8.19 / DataTable's `rowHeader`, built in wave 2c-a and
       * until now used by nothing).
       */
      rowHeader: true,
    },
    { id: 'mrn', header: 'MRN', sortable: true, mono: true, cell: (t) => t.patient.mrn },
    {
      id: 'testName',
      header: 'Test name',
      sortable: true,
      width: '220px',
      cell: (t) => <LabTestNameCell test={t} />,
    },
    {
      id: 'category',
      header: 'Category',
      sortable: true,
      cell: (t) => <LabCategoryCell test={t} />,
    },
    {
      id: 'orderedBy',
      header: 'Ordered by',
      sortable: true,
      cell: (t) => <span className="whitespace-nowrap text-text-secondary">{t.orderedBy}</span>,
    },
    {
      id: 'requestedDate',
      header: 'Requested',
      sortable: true,
      cell: (t) => (
        <div className="min-w-0">
          <p className="whitespace-nowrap text-body-sm tabular-nums">
            {formatDate(t.requestedDate)}
          </p>
          <p className="text-caption text-text-tertiary">{relativeDayLabel(t.requestedDate)}</p>
        </div>
      ),
    },
    {
      id: 'completedDate',
      header: 'Completed',
      sortable: true,
      cell: (t) =>
        t.completedDate ? (
          <div className="min-w-0">
            <p className="whitespace-nowrap text-body-sm tabular-nums">
              {formatDate(t.completedDate)}
            </p>
            <p className="text-caption text-text-tertiary">{relativeDayLabel(t.completedDate)}</p>
          </div>
        ) : (
          <span className="text-text-tertiary">—</span>
        ),
    },
    { id: 'status', header: 'Status', sortable: true, cell: (t) => <LabStatusBadge test={t} /> },
    {
      id: 'priority',
      header: 'Priority',
      sortable: true,
      cell: (t) => <LabPriorityBadge test={t} />,
    },
    {
      id: 'review',
      header: 'Review',
      width: '160px',
      cell: (t) => <LabReviewCell test={t} />,
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'right',
      width: '190px',
      cell: (t) => (
        <LabRowActions
          test={t}
          onOpenTest={callbacks.onOpenTest}
          review={callbacks.rowReview?.(t)}
        />
      ),
    },
  ];
}
