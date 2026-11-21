import {
  CalendarPlus,
  EllipsisVertical,
  FileText,
  FlaskConical,
  MessageSquare,
  Pill,
  UserRound,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Dropdown, IconButton, Tooltip, type MenuEntry } from '@/components/ui';
import type { Patient } from '@/features/shared-domain/patient-identity';
import { routes } from '@/routes';

/**
 * Per-patient actions — DS §8.19 row-action convention: always visible,
 * never hover-only. Two inline shortcuts (message, schedule) plus the ⋯
 * menu with the full action set.
 *
 * Every destination carries this patient, through the same contract the
 * profile header uses, so a row action and its header twin cannot land in
 * different places: records, labs and prescriptions filter on `?patient=`
 * (each list's own deep-link param), "Send message" opens the patient's
 * thread (D-24) and "Schedule appointment" opens booking with the patient
 * chosen (NEW-06). Before NEW-06/07 the last two went to the bare inbox and
 * book, labs used a `?patientId=` nothing reads, and prescriptions carried
 * no patient at all.
 */
export function PatientRowActions({ patient }: { patient: Patient }) {
  const navigate = useNavigate();
  const sendMessage = () => navigate(routes.doctor.composeMessage({ patientId: patient.id }));
  const schedule = () => navigate(routes.doctor.bookAppointment({ patientId: patient.id }));

  const entries: readonly MenuEntry[] = [
    {
      id: 'profile',
      label: 'View profile',
      icon: UserRound,
      onSelect: () => navigate(routes.doctor.patient(patient.id)),
    },
    {
      id: 'record',
      label: 'Open medical record',
      icon: FileText,
      onSelect: () => navigate(`${routes.doctor.medicalRecords}?patient=${patient.id}`),
    },
    {
      id: 'labs',
      label: 'View lab results',
      icon: FlaskConical,
      onSelect: () => navigate(`${routes.doctor.labs}?patient=${patient.id}`),
    },
    {
      id: 'prescriptions',
      label: 'View prescriptions',
      icon: Pill,
      onSelect: () => navigate(`${routes.doctor.pharmacy}?patient=${patient.id}`),
    },
    { type: 'separator', id: 'sep-contact' },
    {
      id: 'message',
      label: 'Send message',
      icon: MessageSquare,
      onSelect: sendMessage,
    },
    {
      id: 'schedule',
      label: 'Schedule appointment',
      icon: CalendarPlus,
      onSelect: schedule,
    },
  ];

  return (
    // Row click opens the profile; action clicks must not bubble into it.
    <div
      className="flex items-center justify-end gap-1"
      onClick={(event) => event.stopPropagation()}
    >
      <Tooltip content="Send message">
        <IconButton
          icon={MessageSquare}
          size="sm"
          aria-label={`Send message to ${patient.name}`}
          onClick={sendMessage}
        />
      </Tooltip>
      <Tooltip content="Schedule appointment">
        <IconButton
          icon={CalendarPlus}
          size="sm"
          aria-label={`Schedule appointment for ${patient.name}`}
          onClick={schedule}
        />
      </Tooltip>
      <Dropdown
        align="end"
        menuLabel={`Actions for ${patient.name}`}
        entries={entries}
        trigger={
          <IconButton
            icon={EllipsisVertical}
            size="sm"
            aria-label={`More actions for ${patient.name}`}
          />
        }
      />
    </div>
  );
}
