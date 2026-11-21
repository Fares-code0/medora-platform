import { MessageSquare, Paperclip, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Fact, FactGrid } from '@/components/patterns';
import { Avatar, Badge, Button, Divider, Drawer, LinkButton } from '@/components/ui';
import { routes } from '@/routes';
import { formatDate, formatTime, relativeDayLabel } from '@/utils/dates';

import {
  APPOINTMENT_ACTION_META,
  availableActions,
  type Appointment,
  type AppointmentAction,
} from '../model/types';

import { AppointmentPriorityBadge, AppointmentStatusBadge } from './AppointmentCells';

/**
 * Appointment details — P3 record drawer (UX 2.4): patient identity
 * block, appointment facts, visit reason, notes, attachments
 * placeholder, and the contextual action footer derived from the
 * status machine.
 */
export interface AppointmentDetailsDrawerProps {
  appointment: Appointment | null;
  open: boolean;
  onClose: () => void;
  onAction: (action: AppointmentAction, appointment: Appointment) => void;
  actionPending: boolean;
}

export function AppointmentDetailsDrawer({
  appointment,
  open,
  onClose,
  onAction,
  actionPending,
}: AppointmentDetailsDrawerProps) {
  const navigate = useNavigate();
  if (!appointment) return null;

  const actions = availableActions(appointment);
  const primary = actions.filter((action) => !APPOINTMENT_ACTION_META[action].destructive);
  const destructive = actions.filter((action) => APPOINTMENT_ACTION_META[action].destructive);

  return (
    <Drawer open={open} onClose={onClose} title={`Appointment ${appointment.id}`} size="md">
      <div className="flex flex-col gap-6">
        {/* Patient summary */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={appointment.patient.name} size="md" decorative />
            <div className="min-w-0">
              <p className="truncate text-body font-semibold text-text-primary">
                {appointment.patient.name}
              </p>
              <p className="font-mono text-caption text-text-primary">
                MRN {appointment.patient.mrn} · {appointment.patient.id}
              </p>
              <p className="text-caption text-text-secondary">
                {/* One Latin-only run, pinned whole (`docs/handoff/i18n.md` §5). */}
                <span dir="ltr">
                  {appointment.patient.age} ·{' '}
                  {appointment.patient.gender === 'female' ? 'Female' : 'Male'} ·{' '}
                  <span className="font-mono">{appointment.patient.phone}</span>
                </span>
              </p>
            </div>
          </div>
          <LinkButton
            href={routes.doctor.patient(appointment.patient.id)}
            variant="ghost"
            size="sm"
            leadingIcon={UserRound}
          >
            View patient
          </LinkButton>
        </div>

        <Divider />

        {/* Appointment information */}
        <div className="flex flex-wrap items-center gap-2">
          <AppointmentStatusBadge appointment={appointment} />
          <AppointmentPriorityBadge appointment={appointment} />
          {appointment.isNewPatient ? <Badge variant="info">New patient</Badge> : null}
          {appointment.isFollowUp ? <Badge variant="neutral">Follow-up</Badge> : null}
        </div>

        <FactGrid>
          <Fact label="Date">
            {formatDate(appointment.dateTime)} · {relativeDayLabel(appointment.dateTime)}
          </Fact>
          <Fact label="Time">
            {formatTime(appointment.dateTime)} ·{' '}
            <span dir="ltr">{appointment.durationMin} min</span>
          </Fact>
          <Fact label="Visit type">{appointment.visitType}</Fact>
          <Fact label="Department">{appointment.department}</Fact>
          <Fact label="Doctor">{appointment.doctor}</Fact>
          <Fact label="Appointment ID">
            <span className="font-mono">{appointment.id}</span>
          </Fact>
        </FactGrid>

        <div>
          <h3 className="text-body-sm font-semibold text-text-primary">Visit reason</h3>
          <p className="mt-1 text-body-sm leading-relaxed text-text-secondary">
            {appointment.reason}
          </p>
        </div>

        <div>
          <h3 className="text-body-sm font-semibold text-text-primary">Notes</h3>
          <p className="mt-1 text-body-sm leading-relaxed text-text-secondary">
            {appointment.notes ?? 'No notes for this appointment.'}
          </p>
        </div>

        <div>
          <h3 className="flex items-center gap-2 text-body-sm font-semibold text-text-primary">
            <Paperclip aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
            Attachments
          </h3>
          <p className="mt-1 text-body-sm text-text-secondary">
            No attachments — file uploads arrive with the backend files service.
          </p>
        </div>

        <Divider />

        {/* Contextual actions from the status machine */}
        <div className="flex flex-wrap items-center gap-2">
          {primary.map((action, index) => (
            <Button
              key={action}
              variant={index === 0 ? 'primary' : 'secondary'}
              leadingIcon={APPOINTMENT_ACTION_META[action].icon}
              loading={actionPending}
              onClick={() => onAction(action, appointment)}
            >
              {APPOINTMENT_ACTION_META[action].label}
            </Button>
          ))}
          {destructive.slice(0, 1).map((action) => (
            <Button
              key={action}
              variant="destructive-secondary"
              leadingIcon={APPOINTMENT_ACTION_META[action].icon}
              loading={actionPending}
              onClick={() => onAction(action, appointment)}
            >
              {APPOINTMENT_ACTION_META[action].label}
            </Button>
          ))}
          <Button
            variant="ghost"
            leadingIcon={MessageSquare}
            onClick={() =>
              navigate(routes.doctor.composeMessage({ patientId: appointment.patient.id }))
            }
          >
            Send message
          </Button>
        </div>
        {destructive.length > 1 ? (
          <div className="flex flex-wrap items-center gap-2">
            {destructive.slice(1).map((action) => (
              <Button
                key={action}
                variant="destructive-secondary"
                leadingIcon={APPOINTMENT_ACTION_META[action].icon}
                loading={actionPending}
                onClick={() => onAction(action, appointment)}
              >
                {APPOINTMENT_ACTION_META[action].label}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}
