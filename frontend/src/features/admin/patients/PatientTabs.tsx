import {
  CalendarPlus,
  CalendarX,
  FileWarning,
  KeyRound,
  LogIn,
  MessageSquare,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  UserRoundCheck,
  UserRoundX,
  type LucideIcon,
} from 'lucide-react';

import { Alert } from '@/components/feedback';
import { Badge } from '@/components/ui';

import { Overline, Panel } from '../components/primitives';
import { MaskedIdentifier } from '../phi';

import {
  EVENT_LABEL,
  FLAG_KIND_LABEL,
  formatDate,
  formatDateTime,
  isAdministrative,
  LOCK_CAUSE_LABEL,
} from './patients';
import type { AccountEventKind, PatientAccount } from './patients.types';

/**
 * The Profile and Activity tabs of the admin patient view (ADM-04 · §3.4).
 *
 * Both are bounded by the same rule: this is account data, not clinical
 * data. The profile shows what support needs to verify a caller — a masked
 * email, a masked phone, a registration date — and stops there. The
 * activity tab shows what the *account* did, with messages as a count and
 * no route to their content; reading a conversation is ADM-06's job, behind
 * its own gate, and duplicating a weaker version of it here would be the
 * easiest way to get around that gate.
 */

/* ── Profile ──────────────────────────────────────────────────── */

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Overline>{label}</Overline>
      <div className="text-body-sm text-text-primary">{children}</div>
    </div>
  );
}

export function PatientProfileTab({ patient }: { patient: PatientAccount }) {
  const subjectLabel = `Patient ${patient.id}`;

  return (
    <div className="flex flex-col gap-4">
      {patient.status === 'locked' && patient.lockCause ? (
        <Alert variant="warning" title="This account is locked">
          {LOCK_CAUSE_LABEL[patient.lockCause]}. The patient cannot sign in until an administrator
          unlocks it or they complete a credential reset.
        </Alert>
      ) : null}

      {patient.status === 'inactive' ? (
        <Alert variant="info" title="This account is deactivated">
          {patient.deactivationReason ?? 'No reason was recorded.'} The medical record is unaffected
          and remains available to whoever holds access.
        </Alert>
      ) : null}

      <Panel
        title="Contact & identity"
        description="Shown for support verification. Identifiers are masked until revealed."
        icon={UserRoundCheck}
        tone="primary"
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label="Name">
            <MaskedIdentifier
              subjectId={patient.id}
              subjectLabel={subjectLabel}
              kind="name"
              value={patient.name}
            />
          </Fact>
          <Fact label="Patient ID">{patient.id}</Fact>
          <Fact label="Medical record number">
            <MaskedIdentifier
              subjectId={patient.id}
              subjectLabel={subjectLabel}
              kind="mrn"
              value={patient.mrn}
            />
          </Fact>
          <Fact label="Email">
            <MaskedIdentifier
              subjectId={patient.id}
              subjectLabel={subjectLabel}
              kind="email"
              value={patient.email}
            />
          </Fact>
          <Fact label="Phone">
            <MaskedIdentifier
              subjectId={patient.id}
              subjectLabel={subjectLabel}
              kind="phone"
              value={patient.phone}
            />
          </Fact>
          <Fact label="Date of birth">
            <MaskedIdentifier
              subjectId={patient.id}
              subjectLabel={subjectLabel}
              kind="dateOfBirth"
              value={patient.dateOfBirth}
            />
          </Fact>
        </div>
      </Panel>

      <Panel
        title="Account"
        description="Lifecycle dates. No clinical information appears on this screen."
        icon={ShieldCheck}
        tone="info"
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label="Registered">{formatDate(patient.registeredAt)}</Fact>
          <Fact label="Last activity">{formatDate(patient.lastActivityAt)}</Fact>
          <Fact label="Doctors with access">
            {patient.assignedDoctors.length === 0 ? (
              <span className="text-text-tertiary">None</span>
            ) : (
              patient.assignedDoctors.join(', ')
            )}
          </Fact>
        </div>
      </Panel>

      <Panel
        title="Open support flags"
        description="Issues raised on this account (§3.4)."
        icon={FileWarning}
        tone={patient.flags.length > 0 ? 'warning' : 'success'}
      >
        {patient.flags.length === 0 ? (
          <p className="text-body-sm text-text-secondary">No open support flags.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {patient.flags.map((flag) => (
              <li
                key={flag.id}
                className="flex flex-col gap-1 rounded-surface border border-border bg-surface-sunken p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="warning">{FLAG_KIND_LABEL[flag.kind]}</Badge>
                  <span className="text-caption text-text-tertiary">
                    Opened {formatDateTime(flag.openedAt)}
                  </span>
                </div>
                <p className="text-body-sm text-text-secondary">{flag.summary}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/* ── Activity ─────────────────────────────────────────────────── */

const EVENT_ICON: Record<AccountEventKind, LucideIcon> = {
  'sign-in': LogIn,
  'sign-in-failed': ShieldAlert,
  'booking-made': CalendarPlus,
  'booking-cancelled': CalendarX,
  'messages-sent': MessageSquare,
  'consent-change': FileWarning,
  'credential-reset': KeyRound,
  'account-locked': ShieldAlert,
  'account-unlocked': ShieldCheck,
  'account-deactivated': UserRoundX,
  'account-reactivated': UserRoundCheck,
  'access-granted': ShieldCheck,
  'access-revoked': ShieldOff,
};

export function PatientActivityTab({ patient }: { patient: PatientAccount }) {
  return (
    <Panel
      title="Account activity"
      description="Sign-ins, bookings, consent changes, and messages as counts — never content."
      icon={LogIn}
      tone="secondary"
    >
      {patient.events.length === 0 ? (
        <p className="text-body-sm text-text-secondary">Nothing has been recorded yet.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {patient.events.map((event) => {
            const Icon = EVENT_ICON[event.kind];
            return (
              <li key={event.id} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-surface bg-surface-sunken text-text-tertiary">
                  <Icon aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-body-sm font-medium text-text-primary">
                      {EVENT_LABEL[event.kind]}
                      {event.count === undefined ? '' : ` · ${String(event.count)}`}
                    </span>
                    <span className="text-caption text-text-tertiary">
                      {formatDateTime(event.at)}
                    </span>
                    {/* Attribution is the difference between "the patient
                        did this" and "we did this to them". */}
                    {isAdministrative(event.kind) && event.actor !== undefined ? (
                      <span className="text-caption text-text-tertiary">by {event.actor}</span>
                    ) : null}
                  </div>
                  <p className="text-body-sm text-text-secondary">{event.detail}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
