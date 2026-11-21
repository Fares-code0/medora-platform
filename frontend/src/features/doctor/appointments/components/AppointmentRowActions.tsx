import { EllipsisVertical, Eye, MessageSquare, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Dropdown, IconButton, Tooltip, type MenuEntry, type MenuItem } from '@/components/ui';
import { routes } from '@/routes';

import {
  APPOINTMENT_ACTION_META,
  availableActions,
  type Appointment,
  type AppointmentAction,
} from '../model/types';

/**
 * Per-appointment actions — the ⋯ menu derives from the status machine
 * (availableActions), so an illegal transition can never render. The
 * inline eye opens the details drawer; everything else lives in the
 * menu (View patient, Send message, then contextual transitions with
 * destructive ones last, per DS §8.13).
 */

export interface AppointmentRowActionsProps {
  appointment: Appointment;
  onOpenDetails: (appointment: Appointment) => void;
  onAction: (action: AppointmentAction, appointment: Appointment) => void;
}

export function AppointmentRowActions({
  appointment,
  onOpenDetails,
  onAction,
}: AppointmentRowActionsProps) {
  const navigate = useNavigate();
  const actions = availableActions(appointment);

  const transitionEntries: MenuItem[] = actions.map((action) => ({
    id: action,
    label: APPOINTMENT_ACTION_META[action].label,
    icon: APPOINTMENT_ACTION_META[action].icon,
    destructive: APPOINTMENT_ACTION_META[action].destructive,
    onSelect: () => onAction(action, appointment),
  }));
  // Destructive entries render last, after a separator (DS §8.13).
  transitionEntries.sort((a, b) => Number(a.destructive ?? false) - Number(b.destructive ?? false));
  const firstDestructive = transitionEntries.findIndex((entry) => entry.destructive === true);

  const entries: MenuEntry[] = [
    {
      id: 'view-patient',
      label: 'View patient',
      icon: UserRound,
      onSelect: () => navigate(routes.doctor.patient(appointment.patient.id)),
    },
    {
      id: 'message',
      label: 'Send message',
      icon: MessageSquare,
      // The patient's thread, not the bare inbox (D-24's contract, as NEW-07).
      onSelect: () => navigate(routes.doctor.composeMessage({ patientId: appointment.patient.id })),
    },
    ...(transitionEntries.length > 0
      ? [{ type: 'separator', id: 'sep-transitions' } as const]
      : []),
    ...transitionEntries.slice(0, firstDestructive === -1 ? undefined : firstDestructive),
    ...(firstDestructive > -1
      ? [
          { type: 'separator', id: 'sep-destructive' } as const,
          ...transitionEntries.slice(firstDestructive),
        ]
      : []),
  ];

  return (
    <div
      /*
       * `leading-none` because the buttons inside are inline-level: they sit
       * on the cell's text baseline, and the half-leading the cell's 18px
       * line-height adds beneath them was setting the height of every row
       * in the table — taller than the buttons themselves.
       */
      className="flex items-center justify-end gap-1 leading-none"
      onClick={(event) => event.stopPropagation()}
    >
      <Tooltip content="View details">
        <IconButton
          icon={Eye}
          size="sm"
          aria-label={`View details of ${appointment.id}`}
          onClick={() => onOpenDetails(appointment)}
        />
      </Tooltip>
      <Dropdown
        align="end"
        menuLabel={`Actions for ${appointment.id}`}
        entries={entries}
        trigger={
          <IconButton
            icon={EllipsisVertical}
            size="sm"
            aria-label={`More actions for ${appointment.id}`}
          />
        }
      />
    </div>
  );
}
