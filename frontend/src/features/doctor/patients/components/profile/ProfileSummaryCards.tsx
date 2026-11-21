import { Pencil, Plus, Trash2 } from 'lucide-react';

import { StatusBadge, Fact, FactGrid } from '@/components/patterns';
import { Badge, Button, Card, Divider, IconButton } from '@/components/ui';
import { formatDate, formatTime, relativeDayLabel } from '@/utils/dates';

import {
  ALLERGY_SEVERITY_META,
  type AllergyRecord,
  type AppointmentRecord,
  type EmergencyContact,
  type InsuranceInfo,
  LIVE_APPOINTMENT_STATUSES,
  type MedicationRecord,
} from '../../model/profile-types';

/**
 * Shared profile summary cards — rendered by the persistent sidebar and
 * (per the Phase 4 spec) again inside the Overview tab. One
 * implementation, two placements; no duplicated UI code.
 */

export function AllergiesCard({ allergies }: { allergies: readonly AllergyRecord[] }) {
  return (
    <Card padding="compact" title="Allergies" subtitle={`${String(allergies.length)} on record`}>
      {allergies.length === 0 ? (
        <p className="text-body-sm text-text-tertiary">No known allergies.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {allergies.map((allergy) => {
            const meta = ALLERGY_SEVERITY_META[allergy.severity];
            return (
              <li key={allergy.id} className="flex items-center justify-between gap-2">
                <span className="truncate text-body-sm font-medium text-text-primary">
                  {allergy.allergen}
                </span>
                <StatusBadge status={meta.kind} label={meta.label} />
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function CurrentMedicationsCard({
  medications,
  onViewAll,
}: {
  medications: readonly MedicationRecord[];
  onViewAll?: (() => void) | undefined;
}) {
  const active = medications.filter((medication) => medication.status === 'active');
  const shown = active.slice(0, 5);
  return (
    <Card
      padding="compact"
      title="Current medications"
      subtitle={`${String(active.length)} active`}
      headerAction={
        onViewAll && active.length > 0 ? (
          <Button variant="ghost" size="sm" onClick={onViewAll}>
            View all
          </Button>
        ) : undefined
      }
    >
      {shown.length === 0 ? (
        <p className="text-body-sm text-text-tertiary">No active medications.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {shown.map((medication) => (
            <li key={medication.id} className="py-2 first:pt-0 last:pb-0">
              <p className="text-body-sm font-medium text-text-primary">
                {medication.name}{' '}
                <span className="font-normal text-text-secondary">{medication.dosage}</span>
              </p>
              <p className="text-caption text-text-tertiary">{medication.frequency}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function EmergencyContactCard({ contact }: { contact: EmergencyContact | null }) {
  if (contact === null) {
    return (
      <Card padding="compact" title="Emergency contact">
        <p className="text-body-sm text-text-secondary">No emergency contact on file.</p>
      </Card>
    );
  }
  return (
    <Card padding="compact" title="Emergency contact">
      <FactGrid columns={1}>
        <Fact label="Name">{contact.name}</Fact>
        <Fact label="Relationship">{contact.relationship}</Fact>
        <Fact label="Phone" truncate={false}>
          <span className="font-mono" dir="ltr">
            {contact.phone}
          </span>
        </Fact>
      </FactGrid>
    </Card>
  );
}

/**
 * Every emergency contact on file, primary first, with add and edit. The
 * sidebar keeps the one-contact summary (`EmergencyContactCard`); this is the
 * Overview's managing view. Removing a contact waits on DEC-003.
 */
export function EmergencyContactsCard({
  contacts,
  onAdd,
  onEdit,
  onRemove,
}: {
  contacts: readonly EmergencyContact[];
  onAdd?: (() => void) | undefined;
  onEdit?: ((contact: EmergencyContact) => void) | undefined;
  onRemove?: ((contact: EmergencyContact) => void) | undefined;
}) {
  const ordered = [...contacts].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
  const add =
    onAdd === undefined ? undefined : (
      <Button variant="ghost" size="sm" leadingIcon={Plus} onClick={onAdd}>
        Add
      </Button>
    );
  return (
    <Card padding="compact" title="Emergency contacts" headerAction={add}>
      {ordered.length === 0 ? (
        <p className="text-body-sm text-text-secondary">No emergency contact on file.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {ordered.map((contact) => (
            <li
              key={contact.id}
              className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-body-sm font-medium text-text-primary">
                  {contact.name}
                  {contact.isPrimary ? <Badge variant="info">Primary</Badge> : null}
                </p>
                <p className="text-caption text-text-secondary">
                  {contact.relationship} ·{' '}
                  <span className="font-mono" dir="ltr">
                    {contact.phone}
                  </span>
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {onEdit === undefined ? null : (
                  <IconButton
                    icon={Pencil}
                    size="sm"
                    aria-label={`Edit ${contact.name}`}
                    onClick={() => onEdit(contact)}
                  />
                )}
                {onRemove === undefined ? null : (
                  <IconButton
                    icon={Trash2}
                    size="sm"
                    aria-label={`Remove ${contact.name}`}
                    onClick={() => onRemove(contact)}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function InsuranceCard({ insurance }: { insurance: InsuranceInfo | null }) {
  if (insurance === null) {
    return (
      <Card padding="compact" title="Insurance">
        <p className="text-body-sm text-text-secondary">No insurance details on file.</p>
      </Card>
    );
  }
  return (
    <Card padding="compact" title="Insurance">
      <FactGrid>
        <Fact label="Provider">{insurance.provider}</Fact>
        <Fact label="Plan">{insurance.plan}</Fact>
        <Fact label="Policy no.">
          <span className="font-mono">{insurance.policyNumber}</span>
        </Fact>
        <Fact label="Valid until">{formatDate(insurance.validUntil)}</Fact>
      </FactGrid>
    </Card>
  );
}

export function UpcomingAppointmentCard({
  appointments,
}: {
  appointments: readonly AppointmentRecord[];
}) {
  // The soonest appointment still ahead and still going to happen. Sorted
  // here rather than trusted from the source's order, which is not ours.
  const now = Date.now();
  const next = appointments
    .filter(
      (appointment) =>
        LIVE_APPOINTMENT_STATUSES.has(appointment.status) &&
        new Date(appointment.dateTime).getTime() >= now,
    )
    .sort((a, b) => a.dateTime.localeCompare(b.dateTime))[0];
  return (
    <Card padding="compact" title="Upcoming appointment">
      {next === undefined ? (
        <p className="text-body-sm text-text-tertiary">Nothing scheduled.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-body font-semibold text-text-primary tabular-nums">
            {formatDate(next.dateTime)} · {formatTime(next.dateTime)}
          </p>
          <p className="text-body-sm text-text-secondary">
            {next.department === null ? next.type : `${next.type} · ${next.department}`}
          </p>
          <Divider />
          <p className="text-caption text-text-tertiary">
            {relativeDayLabel(next.dateTime)} with {next.doctor}
          </p>
        </div>
      )}
    </Card>
  );
}
