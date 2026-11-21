import { type DataTableColumn } from '@/components/ui';
import { formatDate, formatTime, relativeDayLabel } from '@/utils/dates';

import { type Appointment, type AppointmentAction } from '../model/types';

import {
  AppointmentPatientCell,
  AppointmentPriorityBadge,
  AppointmentStatusBadge,
} from './AppointmentCells';
import { AppointmentRowActions } from './AppointmentRowActions';

/**
 * Column set for the appointments DataTable (UX 2.4 list view).
 * Configuration only — cell components live in AppointmentCells /
 * AppointmentRowActions. Built via a factory because the actions column
 * needs the page's drawer/action callbacks.
 *
 * There is no Doctor column. This is the signed-in doctor's own schedule, so
 * a column naming them on every row said nothing and cost the width the
 * patient name was being truncated to make room for. The doctor is still on
 * the details drawer, where it is read once rather than scanned.
 *
 * Status and priority follow the schedule (date · time · duration) rather
 * than trailing the descriptive columns, so the decision a doctor scans for
 * is on screen at a laptop width instead of behind the horizontal scroll.
 *
 * Identifiers never wrap: `APT-3024` and an MRN broken at the hyphen read as
 * two values, and a two-line ID set the height of every row beside it.
 */
export function buildAppointmentColumns(callbacks: {
  onOpenDetails: (appointment: Appointment) => void;
  onAction: (action: AppointmentAction, appointment: Appointment) => void;
}): ReadonlyArray<DataTableColumn<Appointment>> {
  return [
    {
      id: 'id',
      header: 'ID',
      sortable: true,
      mono: true,
      cell: (a) => <span className="whitespace-nowrap">{a.id}</span>,
    },
    {
      id: 'patient',
      header: 'Patient',
      sortable: true,
      width: '240px',
      // The floor is on the content, not only the column: the name truncates
      // inside a flex row, so without it the cell's min-content was the
      // avatar alone and an overflowing table squeezed names to "Omar Far…".
      cell: (a) => (
        <div className="min-w-[14rem]">
          <AppointmentPatientCell appointment={a} />
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
      mono: true,
      cell: (a) => <span className="whitespace-nowrap">{a.patient.mrn}</span>,
    },
    {
      id: 'date',
      header: 'Date',
      sortable: true,
      // Single line for the same reason as the patient cell: the date is
      // the datum, the relative label ("Today") is metadata riding beside
      // it rather than below it.
      cell: (a) => (
        <span className="flex min-w-0 items-baseline gap-1.5 whitespace-nowrap">
          <span className="text-body-sm tabular-nums">{formatDate(a.dateTime)}</span>
          <span className="text-caption text-text-tertiary">{relativeDayLabel(a.dateTime)}</span>
        </span>
      ),
    },
    {
      id: 'time',
      header: 'Time',
      cell: (a) => <span className="whitespace-nowrap tabular-nums">{formatTime(a.dateTime)}</span>,
    },
    {
      id: 'duration',
      header: 'Duration',
      sortable: true,
      numeric: true,
      cell: (a) => (
        <span className="whitespace-nowrap" dir="ltr">
          {`${String(a.durationMin)} min`}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (a) => <AppointmentStatusBadge appointment={a} />,
    },
    {
      id: 'priority',
      header: 'Priority',
      sortable: true,
      cell: (a) => <AppointmentPriorityBadge appointment={a} />,
    },
    {
      id: 'visitType',
      // Without this the two longest values ("Medication review", "Annual
      // check-up") wrap, and a single wrapped cell sets the height of
      // every row in the worklist.
      header: 'Visit type',
      cell: (a) => <span className="whitespace-nowrap">{a.visitType}</span>,
    },
    {
      id: 'department',
      header: 'Department',
      cell: (a) => <span className="whitespace-nowrap">{a.department}</span>,
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'right',
      width: '110px',
      cell: (a) => (
        <AppointmentRowActions
          appointment={a}
          onOpenDetails={callbacks.onOpenDetails}
          onAction={callbacks.onAction}
        />
      ),
    },
  ];
}
