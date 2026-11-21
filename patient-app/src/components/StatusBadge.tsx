import { useT, type MessageKey } from '@/i18n';
import type { AppointmentStatus } from '@/types/vocabularies';

import { Badge, type BadgeTone } from './Badge';
import type { IconName } from './Icon';

/**
 * The appointment status badge.
 *
 * The map is **exhaustive over the union**, which is the point: adding a
 * ninth status to `AppointmentStatus` is a compile error here rather than
 * a badge that silently renders grey in production (checklist C-08).
 *
 * The labels are patient-facing text for the server's kebab-case
 * literals. The literal is never rendered — `awaiting-patient` is a
 * database value, "Needs your response" is what a patient needs to read —
 * but the literal is what the client sends and compares, verbatim.
 *
 * Since C-09 the map holds a catalogue KEY rather than a sentence, so
 * `statusPresentation` stays a pure function a test can call without a
 * provider, and so a status cannot be worded into ambiguity in one
 * language and not the other.
 *
 * Nothing here decides what a patient may DO in a status. Actions come
 * from the server (audit §6); this maps a status to a colour and a word.
 */
interface StatusPresentation {
  readonly labelKey: MessageKey;
  readonly tone: BadgeTone;
  readonly icon: IconName;
}

const PRESENTATION: Record<AppointmentStatus, StatusPresentation> = {
  scheduled: { labelKey: 'appointment.status.scheduled', tone: 'info', icon: 'calendar' },
  confirmed: { labelKey: 'appointment.status.confirmed', tone: 'success', icon: 'checkCircle' },
  // A patient-initiated booking lands here and waits for the clinic.
  // "Pending" alone reads as an app problem; this says who is acting.
  pending: { labelKey: 'appointment.status.pending', tone: 'warning', icon: 'clock' },
  completed: { labelKey: 'appointment.status.completed', tone: 'neutral', icon: 'check' },
  cancelled: { labelKey: 'appointment.status.cancelled', tone: 'neutral', icon: 'x' },
  rescheduled: { labelKey: 'appointment.status.rescheduled', tone: 'info', icon: 'refresh' },
  'no-show': { labelKey: 'appointment.status.noShow', tone: 'error', icon: 'alertCircle' },
  // The one status that is a call to action rather than a report.
  'awaiting-patient': {
    labelKey: 'appointment.status.awaitingPatient',
    tone: 'warning',
    icon: 'alert',
  },
};

export function statusPresentation(status: AppointmentStatus): StatusPresentation {
  return PRESENTATION[status];
}

export function StatusBadge({ status, testID }: { status: AppointmentStatus; testID?: string }) {
  const t = useT();
  const presentation = PRESENTATION[status];
  return (
    <Badge
      label={t(presentation.labelKey)}
      tone={presentation.tone}
      icon={presentation.icon}
      {...(testID === undefined ? {} : { testID })}
    />
  );
}
