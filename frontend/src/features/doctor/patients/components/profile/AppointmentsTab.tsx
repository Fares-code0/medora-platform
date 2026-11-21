import { EmptyState } from '@/components/feedback';
import { Section, Stack } from '@/components/layout';
import { StatusBadge } from '@/components/patterns';
import { DataTable, type DataTableColumn } from '@/components/ui';
import { dayDiffFromToday, formatDate, formatTime } from '@/utils/dates';

import { APPOINTMENT_STATUS_META, type AppointmentRecord } from '../../model/profile-types';

/**
 * Appointments tab — upcoming and previous appointments for this
 * patient. Scheduling flows live in the Phase 7 appointments feature;
 * this view is read-only history and outlook.
 */

const COLUMNS: ReadonlyArray<DataTableColumn<AppointmentRecord>> = [
  {
    id: 'dateTime',
    header: 'Date & time',
    cell: (appointment) => (
      <span className="whitespace-nowrap tabular-nums">
        {formatDate(appointment.dateTime)} · {formatTime(appointment.dateTime)}
      </span>
    ),
  },
  { id: 'type', header: 'Type', cell: (appointment) => appointment.type },
  {
    id: 'doctor',
    header: 'Doctor',
    cell: (appointment) => (
      <span className="whitespace-nowrap text-text-secondary">{appointment.doctor}</span>
    ),
  },
  {
    id: 'department',
    header: 'Department',
    cell: (appointment) => appointment.department ?? '—',
  },
  {
    id: 'status',
    header: 'Status',
    cell: (appointment) => {
      const meta = APPOINTMENT_STATUS_META[appointment.status];
      return <StatusBadge status={meta.kind} label={meta.label} />;
    },
  },
];

export function AppointmentsTab({ appointments }: { appointments: readonly AppointmentRecord[] }) {
  const upcoming = appointments.filter(
    (appointment) => dayDiffFromToday(appointment.dateTime) >= 0,
  );
  const previous = appointments.filter((appointment) => dayDiffFromToday(appointment.dateTime) < 0);

  return (
    <Stack gap={8}>
      <Section title="Upcoming" headingAs="h3" caption={`${String(upcoming.length)} scheduled`}>
        <DataTable
          caption="Upcoming appointments for this patient"
          columns={COLUMNS}
          rows={upcoming}
          getRowId={(appointment) => appointment.id}
          emptyState={
            <EmptyState
              title="Nothing scheduled"
              description="Upcoming appointments with this patient will appear here."
              className="py-8"
            />
          }
        />
      </Section>
      <Section title="Previous" headingAs="h3" caption={`${String(previous.length)} past`}>
        <DataTable
          caption="Previous appointments for this patient"
          columns={COLUMNS}
          rows={previous}
          getRowId={(appointment) => appointment.id}
          emptyState={
            <EmptyState
              title="No past appointments"
              description="Completed and cancelled visits will appear here."
              className="py-8"
            />
          }
        />
      </Section>
    </Stack>
  );
}
