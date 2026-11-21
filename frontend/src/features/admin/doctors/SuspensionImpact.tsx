import { CalendarClock } from 'lucide-react';
import { Link } from 'react-router-dom';


import { Alert } from '@/components/feedback';
import { routes } from '@/routes';

import { useOversightDocument } from '../appointments/api/useOversightQueries';
import { formatSlot, isTerminal } from '../appointments/oversight';

/**
 * What suspending this doctor would strand (ADM-02 · UX §3.2).
 *
 * §3.2 asks for the consequence line — "their appointments will require
 * reassignment — 14 upcoming appointments affected" — and for it to link
 * into the affected list *first*. Both halves matter: the number makes the
 * decision informed, and the link makes acting on it possible without
 * having to remember which doctor it was.
 *
 * The count is read from the ADM-05 oversight store rather than kept as a
 * field on the doctor, so it cannot drift from the appointments an
 * administrator would actually see.
 */
export function SuspensionImpact({
  doctorId,
  doctorName,
}: {
  doctorId: string;
  doctorName: string;
}) {
  const document = useOversightDocument();
  const now = Date.now();

  const affected = (document.data?.appointments ?? [])
    .filter(
      (appointment) =>
        appointment.doctorId === doctorId &&
        !isTerminal(appointment.status) &&
        new Date(appointment.startsAt).getTime() >= now,
    )
    .slice()
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  if (document.isLoading) {
    return (
      <Alert variant="info" title="Checking their diary…">
        Counting the appointments this would affect.
      </Alert>
    );
  }

  if (affected.length === 0) {
    return (
      <Alert variant="info" title="Nothing in their diary">
        {doctorName} has no upcoming appointments, so no patient needs rebooking.
      </Alert>
    );
  }

  const shown = affected.slice(0, 4);

  return (
    <Alert variant="warning" title="Their appointments will require reassignment">
      <span className="block">
        {affected.length} upcoming appointment{affected.length === 1 ? '' : 's'} affected. Suspending{' '}
        {doctorName} does not move them — each one still needs a doctor.
      </span>

      <ul className="mt-2 flex flex-col gap-0.5">
        {shown.map((appointment) => (
          <li key={appointment.id} className="text-caption text-text-secondary">
            <span className="font-medium">{appointment.reference}</span> ·{' '}
            {formatSlot(appointment.startsAt)} · {appointment.visitType}
          </li>
        ))}
        {affected.length > shown.length ? (
          <li className="text-caption text-text-tertiary">
            and {affected.length - shown.length} more
          </li>
        ) : null}
      </ul>

      <Link
        to={`${routes.admin.appointments}?doctor=${doctorId}`}
        className="mt-2 inline-flex items-center gap-1.5 text-caption font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <CalendarClock aria-hidden="true" className="h-3.5 w-3.5" />
        Reassign them first
      </Link>
    </Alert>
  );
}
