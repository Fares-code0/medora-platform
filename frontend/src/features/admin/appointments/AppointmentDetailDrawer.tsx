import { AlertTriangle, History, Send, Stethoscope } from 'lucide-react';

import { Alert } from '@/components/feedback';
import { StatusBadge } from '@/components/patterns';
import { Badge, Button, Drawer } from '@/components/ui';

import { oversightCapabilities } from './api/useOversightQueries';
import {
  ageInStateMs,
  DELIVERY_LABEL,
  DELIVERY_KIND,
  EVENT_LABEL,
  FLAG_LABEL,
  FLAG_VARIANT,
  flagsFor,
  formatAge,
  formatSlot,
  formatTimestamp,
  isTerminal,
  STATUS_LABEL,
  STATUS_KIND,
} from './oversight';
import type { OversightAppointment } from './oversight.types';
import { PatientIdentity } from './PatientIdentity';

/**
 * Appointment detail (ADM-05 · UX §3.5, the P3 drawer).
 *
 * Three things the table cannot carry: the full transition history with an
 * actor against every line, the linked complaint if one exists, and
 * notification delivery *per party*. The last is deliberately separate from
 * the history — "we sent it" and "it arrived" are different claims, and an
 * administrator chasing a patient who says they were never told needs the
 * second one.
 *
 * Patient identifiers stay behind the ADM-10 gate here exactly as they do in
 * the table; opening a drawer is not a justification.
 */
const PARTY_LABEL: Record<string, string> = {
  patient: 'Patient',
  doctor: 'Doctor',
  'receiving-doctor': 'Receiving doctor',
};

/** The patient's receipt already says "Patient · APT-2401"; don't say it twice. */
function recipient(party: string, recipientLabel: string): string {
  const label = PARTY_LABEL[party] ?? party;
  return recipientLabel.startsWith(label) ? recipientLabel : `${label} · ${recipientLabel}`;
}

const ACTOR_ROLE_LABEL: Record<string, string> = {
  patient: 'Patient',
  doctor: 'Doctor',
  administrator: 'Administrator',
  system: 'System',
};

/**
 * `Doctor · Dr. Khalil`, but just `Patient` when the actor is only known by
 * their role — the patient is never named on an audit line, so repeating the
 * word twice tells the reader nothing.
 */
function attribution(role: string, actor: string): string {
  const label = ACTOR_ROLE_LABEL[role] ?? role;
  return actor === label || actor === '' ? label : `${label} · ${actor}`;
}

export function AppointmentDetailDrawer({
  appointment,
  onClose,
  onNudge,
  canNudgeNow,
}: {
  appointment: OversightAppointment | null;
  onClose: () => void;
  onNudge: (appointment: OversightAppointment) => void;
  canNudgeNow: boolean;
}) {
  const now = Date.now();
  const flags = appointment === null ? [] : flagsFor(appointment, now);

  return (
    <Drawer
      open={appointment !== null}
      onClose={onClose}
      title={appointment === null ? 'Appointment' : appointment.reference}
      size="lg"
      footer={
        appointment === null ? null : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            {canNudgeNow ? (
              <Button leadingIcon={Send} onClick={() => onNudge(appointment)}>
                Nudge doctor
              </Button>
            ) : null}
          </>
        )
      }
    >
      {appointment === null ? null : (
        <div className="flex flex-col gap-6">
          {/* ── Summary ─────────────────────────────────────────── */}
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge
                status={STATUS_KIND[appointment.status]}
                label={STATUS_LABEL[appointment.status]}
              />
              {flags.map((flag) => (
                <Badge key={flag} variant={FLAG_VARIANT[flag]} icon={AlertTriangle}>
                  {FLAG_LABEL[flag]}
                </Badge>
              ))}
            </div>

            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <Fact label="When">
                {formatSlot(appointment.startsAt)} · {String(appointment.durationMin)} min
              </Fact>
              <Fact label="Doctor">{appointment.doctorName}</Fact>
              <Fact label="Type">
                {appointment.visitType} · {appointment.department}
              </Fact>
              <Fact label={isTerminal(appointment.status) ? 'Closed' : 'Age in state'}>
                <span dir="ltr">
                  {formatAge(ageInStateMs(appointment, now))}
                  {isTerminal(appointment.status) ? ' ago' : ''}
                </span>
              </Fact>
              <Fact label="Patient">
                <PatientIdentity
                  subjectId={appointment.id}
                  subjectLabel={appointment.reference}
                  kind="name"
                  value={appointment.patientName}
                />
              </Fact>
              <Fact label="MRN">
                <PatientIdentity
                  subjectId={appointment.id}
                  subjectLabel={appointment.reference}
                  kind="mrn"
                  value={appointment.patientMrn}
                />
              </Fact>
              <Fact label="Reschedules">{String(appointment.rescheduleCount)}</Fact>
              <Fact label="Last nudged">
                {appointment.lastNudgedAt === null
                  ? 'Never'
                  : formatTimestamp(appointment.lastNudgedAt)}
              </Fact>
            </dl>
          </section>

          {/* ── Linked complaint ────────────────────────────────── */}
          {appointment.complaint === null ? null : (
            <Alert variant="warning" title={`Complaint ${appointment.complaint.id}`}>
              <span className="block">{appointment.complaint.summary}</span>
              <span className="mt-1 block text-caption text-text-tertiary">
                {appointment.complaint.category} · opened{' '}
                {formatTimestamp(appointment.complaint.openedAt)} · {appointment.complaint.status}
              </span>
            </Alert>
          )}

          {oversightCapabilities.history ? (
            <>
              {/* ── History ─────────────────────────────────────────── */}
            <section>
              <SubHeading icon={History}>Event history</SubHeading>
              <ol className="mt-3 flex flex-col">
                {appointment.events.map((event) => (
                  <li
                    key={event.id}
                    className="relative flex flex-col gap-0.5 border-s border-border py-2 ps-4 last:pb-0"
                  >
                    <span
                      aria-hidden="true"
                      className="absolute -left-[3px] top-3.5 h-1.5 w-1.5 rounded-pill bg-border-strong"
                    />
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-body-sm font-medium text-text-primary">
                        {EVENT_LABEL[event.kind] ?? event.kind}
                      </span>
                      <span className="text-caption tabular-nums text-text-tertiary">
                        {formatTimestamp(event.at)}
                      </span>
                    </div>
                    <span className="text-caption text-text-secondary">{event.detail}</span>
                    <span className="text-caption text-text-tertiary">
                      {attribution(event.actorRole, event.actor)}
                    </span>
                  </li>
                ))}
              </ol>
            </section>

              {/* ── Notifications ───────────────────────────────────── */}
            <section>
              <SubHeading icon={Stethoscope}>Notification delivery</SubHeading>
              <ul className="mt-3 flex flex-col gap-2">
                {appointment.notifications.map((notification) => (
                  <li
                    key={notification.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-surface border border-border px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="text-body-sm text-text-primary">{notification.subject}</div>
                      <div className="text-caption text-text-tertiary">
                        {recipient(notification.party, notification.recipientLabel)} ·{' '}
                        {notification.channel} · {formatTimestamp(notification.at)}
                      </div>
                    </div>
                    <StatusBadge
                      status={DELIVERY_KIND[notification.status] ?? 'info'}
                      label={DELIVERY_LABEL[notification.status] ?? notification.status}
                    />
                  </li>
                ))}
              </ul>
            </section>
            </>
          ) : (
            <p className="rounded-surface border border-dashed border-border px-4 py-3 text-caption text-text-secondary">
              The server does not send an appointment&apos;s event history or notification receipts
              to this screen yet. Interventions you make here are still recorded on the server.
            </p>
          )}
        </div>
      )}
    </Drawer>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-caption font-semibold uppercase tracking-[0.12em] text-text-tertiary">
        {label}
      </dt>
      <dd className="mt-0.5 text-body-sm text-text-primary">{children}</dd>
    </div>
  );
}

function SubHeading({
  icon: Icon,
  children,
}: {
  icon: typeof History;
  children: React.ReactNode;
}) {
  return (
    <h3 className="flex items-center gap-2 text-body font-semibold text-text-primary">
      <Icon aria-hidden="true" className="h-4 w-4 text-text-tertiary" strokeWidth={2} />
      {children}
    </h3>
  );
}
