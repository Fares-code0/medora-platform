import type { ReactNode } from 'react';

import { Activity, BellPlus } from 'lucide-react';

import { Alert } from '@/components/feedback';
import { Grid, Stack } from '@/components/layout';
import { StatusBadge, Fact, FactGrid } from '@/components/patterns';
import { Badge, Button, Card } from '@/components/ui';
import { formatDate, formatTime, relativeDayLabel } from '@/utils/dates';

import {
  APPOINTMENT_STATUS_META,
  type ClinicalAlert,
  type EmergencyContact,
  type PatientProfileBundle,
} from '../../model/profile-types';

import {
  AllergiesCard,
  CurrentMedicationsCard,
  EmergencyContactsCard,
  InsuranceCard,
  UpcomingAppointmentCard,
} from './ProfileSummaryCards';

/**
 * Overview tab (UX 2.3) — the at-a-glance clinical picture: alerts
 * first (fail-loud, never hidden), then summary, vitals, conditions,
 * and the shared summary cards.
 *
 * It opens by saying whose record this is (WEB-8): one patient has one
 * Medical Record per hospital (DR-03), and a summary that read as the
 * patient's complete history would invite a decision on missing data.
 */
export function OverviewTab({
  bundle,
  onViewMedications,
  onRecordVitals,
  onRaiseAlert,
  onAddContact,
  onEditContact,
  onRemoveContact,
  onResolveAlert,
}: {
  bundle: PatientProfileBundle;
  onViewMedications: () => void;
  /** Opens the record-vitals dialog; the action is absent without it. */
  onRecordVitals?: (() => void) | undefined;
  /** Opens the raise-alert dialog; the action is absent without it. */
  onRaiseAlert?: (() => void) | undefined;
  /** Opens the contact dialog to add; the action is absent without it. */
  onAddContact?: (() => void) | undefined;
  /** Opens the contact dialog on one contact; the action is absent without it. */
  onEditContact?: ((contact: EmergencyContact) => void) | undefined;
  /** Opens the remove-contact confirmation; the action is absent without it. */
  onRemoveContact?: ((contact: EmergencyContact) => void) | undefined;
  /** Opens the resolve-alert confirmation; the action is absent without it. */
  onResolveAlert?: ((alert: ClinicalAlert) => void) | undefined;
}) {
  const { patient, profile } = bundle;
  const recordVitals =
    onRecordVitals === undefined ? undefined : (
      <Button variant="ghost" size="sm" leadingIcon={Activity} onClick={onRecordVitals}>
        Record vitals
      </Button>
    );
  const recentVisits = profile.appointments
    .filter((appointment) => appointment.status === 'completed')
    .slice(0, 3);

  return (
    <Stack gap={4}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-caption text-text-secondary">
          This hospital&apos;s record of the patient: what this hospital has recorded, not their
          history at other providers.
        </p>
        {onRaiseAlert !== undefined ? (
          <Button variant="secondary" size="sm" leadingIcon={BellPlus} onClick={onRaiseAlert}>
            Raise alert
          </Button>
        ) : null}
      </div>
      {profile.alerts.map((alert) => (
        <Alert
          key={alert.id}
          variant={alert.severity === 'critical' ? 'error' : 'warning'}
          critical={alert.severity === 'critical'}
          title={alert.message}
          actions={
            onResolveAlert === undefined ? undefined : (
              <Button
                variant="ghost"
                size="sm"
                // Several banners can share the page; the name says which one.
                aria-label={`Resolve alert: ${alert.message}`}
                onClick={() => onResolveAlert(alert)}
              >
                Resolve
              </Button>
            )
          }
        />
      ))}

      {profile.summary === '' ? null : (
        <Card padding="compact" title="Patient summary">
          <p className="text-body-sm leading-relaxed text-text-secondary">{profile.summary}</p>
        </Card>
      )}

      <Grid columns={{ base: 1, md: 2 }} gap={4}>
        {profile.vitals === null ? (
          <Card padding="compact" title="Vital signs" headerAction={recordVitals}>
            <p className="text-body-sm text-text-secondary">No vital signs recorded yet.</p>
          </Card>
        ) : (
          <Card
            padding="compact"
            title="Vital signs"
            subtitle={`Recorded ${formatDate(profile.vitals.recordedAt)}`}
            headerAction={recordVitals}
          >
            <FactGrid>
              <Fact label="Blood pressure">
                <VitalValue>{profile.vitals.bloodPressure}</VitalValue>
              </Fact>
              <Fact label="Heart rate">
                <VitalValue>{profile.vitals.heartRateBpm} bpm</VitalValue>
              </Fact>
              <Fact label="Temperature">
                <VitalValue>{profile.vitals.temperatureC} °C</VitalValue>
              </Fact>
              <Fact label="Respiratory rate">
                <VitalValue>{profile.vitals.respiratoryRate} /min</VitalValue>
              </Fact>
              <Fact label="SpO₂">
                <VitalValue>{profile.vitals.oxygenSaturation}%</VitalValue>
              </Fact>
              <Fact label="BMI">
                <VitalValue>{profile.vitals.bmi ?? '—'}</VitalValue>
              </Fact>
              <Fact label="Weight">
                <VitalValue>{profile.vitals.weightKg} kg</VitalValue>
              </Fact>
              <Fact label="Height">
                <VitalValue>{profile.vitals.heightCm} cm</VitalValue>
              </Fact>
            </FactGrid>
          </Card>
        )}

        <Card
          padding="compact"
          title="Chronic diseases"
          subtitle={`${String(patient.chronicConditions.length)} documented`}
        >
          {patient.chronicConditions.length === 0 ? (
            <p className="text-body-sm text-text-secondary">No documented chronic conditions.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {patient.chronicConditions.map((condition) => (
                <Badge key={condition} variant="info" dot>
                  {condition}
                </Badge>
              ))}
            </div>
          )}
        </Card>

        <AllergiesCard allergies={profile.allergies} />
        <CurrentMedicationsCard medications={profile.medications} onViewAll={onViewMedications} />
        <EmergencyContactsCard
          contacts={profile.emergencyContacts}
          onAdd={onAddContact}
          onEdit={onEditContact}
          onRemove={onRemoveContact}
        />
        <InsuranceCard insurance={profile.insurance} />

        <Card
          padding="compact"
          title="Recent visits"
          subtitle={recentVisits.length === 0 ? undefined : 'Latest completed appointments'}
        >
          {recentVisits.length === 0 ? (
            <p className="text-body-sm text-text-secondary">No completed visits yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {recentVisits.map((visit) => {
                const meta = APPOINTMENT_STATUS_META[visit.status];
                return (
                  <li
                    key={visit.id}
                    className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="text-body-sm font-medium text-text-primary">
                        {visit.type} · {visit.department}
                      </p>
                      <p className="text-caption text-text-tertiary">
                        {formatDate(visit.dateTime)} {formatTime(visit.dateTime)} ·{' '}
                        {relativeDayLabel(visit.dateTime)}
                      </p>
                    </div>
                    <StatusBadge status={meta.kind} label={meta.label} />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <UpcomingAppointmentCard appointments={profile.appointments} />
      </Grid>
    </Stack>
  );
}

/**
 * A measurement and its unit, pinned left-to-right. The run is Latin-only and
 * starts with a digit, so on an RTL page the bidi algorithm would put the
 * unit first ("bpm 68", "min/ 13"); `docs/handoff/i18n.md` §5.
 */
function VitalValue({ children }: { children: ReactNode }) {
  return (
    <span className="tabular-nums" dir="ltr">
      {children}
    </span>
  );
}
