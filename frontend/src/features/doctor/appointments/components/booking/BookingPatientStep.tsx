import { useMemo, useState } from 'react';

import { Stethoscope } from 'lucide-react';

import { ErrorState, Skeleton } from '@/components/feedback';
import { Stack } from '@/components/layout';
import { Radio, RadioGroup, SearchInput, Select } from '@/components/ui';
import { usePatientDirectoryQuery, type Patient } from '@/features/shared-domain/patient-identity';
import { isolateLtr } from '@/i18n';

import { toAppointmentPatient, type BookingIssues } from '../../model/booking';
import { DEPARTMENTS, type AppointmentPatientSnapshot } from '../../model/types';

/**
 * Step 1 — Patient & doctor.
 *
 * The patient is a radio group over the directory (the doctor's own caseload
 * when live), searchable by name, MRN or id — the record flow's picker, for
 * its reason: single choice, arrow-key operable, no custom keyboard code.
 *
 * The doctor is shown, not chosen. `POST /appointments` books into the
 * *caller's* schedule and the API has no way to read or book another
 * doctor's, so a doctor picker here would offer choices the server cannot
 * honour.
 */
export interface BookingPatientStepProps {
  readonly selectedPatientId: string | null;
  readonly onSelectPatient: (patient: AppointmentPatientSnapshot) => void;
  readonly department: string;
  readonly onDepartmentChange: (department: string) => void;
  readonly doctorName: string;
  readonly doctorSpecialty: string;
  readonly issues: BookingIssues;
}

const NO_PATIENTS: readonly Patient[] = [];

export function BookingPatientStep({
  selectedPatientId,
  onSelectPatient,
  department,
  onDepartmentChange,
  doctorName,
  doctorSpecialty,
  issues,
}: BookingPatientStepProps) {
  const [query, setQuery] = useState('');
  const directory = usePatientDirectoryQuery();
  const patients = directory.data ?? NO_PATIENTS;

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return patients;
    return patients.filter(
      (patient) =>
        patient.name.toLowerCase().includes(needle) ||
        patient.mrn.toLowerCase().includes(needle) ||
        patient.id.toLowerCase().includes(needle),
    );
  }, [patients, query]);

  const departments = DEPARTMENTS.includes(department) ? DEPARTMENTS : [department, ...DEPARTMENTS];

  return (
    <Stack gap={6}>
      <section aria-labelledby="booking-patient-heading">
        <h3 id="booking-patient-heading" className="text-body font-semibold text-text-primary">
          Patient
        </h3>
        <div className="mt-3">
          {directory.isPending ? (
            <Stack gap={3} aria-busy="true" aria-label="Loading patients">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </Stack>
          ) : directory.isError ? (
            <ErrorState
              title="Couldn't load your patients"
              error={directory.error}
              onRetry={() => void directory.refetch()}
            />
          ) : patients.length === 0 ? (
            <p className="text-body-sm text-text-secondary">
              You have no patients to book for yet. Patients appear here once they are in your care.
            </p>
          ) : (
            <Stack gap={4}>
              <SearchInput
                label="Find a patient"
                placeholder="Search by name, MRN or ID…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onClear={() => setQuery('')}
                helperText={`${String(matches.length)} of ${String(patients.length)} patients`}
              />
              {matches.length === 0 ? (
                <p className="text-body-sm text-text-secondary" role="status">
                  No patient matches “{query.trim()}”.
                </p>
              ) : null}
              <RadioGroup
                label="Patient"
                name="booking-patient"
                required
                value={selectedPatientId}
                onChange={(value) => {
                  const patient = patients.find((candidate) => candidate.id === value);
                  if (patient !== undefined) onSelectPatient(toAppointmentPatient(patient));
                }}
                error={issues.patient}
              >
                <div className="max-h-[22rem] overflow-y-auto pe-1">
                  {matches.map((patient) => (
                    <Radio
                      key={patient.id}
                      value={patient.id}
                      label={`${patient.name} — MRN ${patient.mrn}`}
                      description={isolateLtr(
                        `${patient.id} · ${String(patient.age)} · ${
                          patient.gender === 'female' ? 'F' : 'M'
                        }${patient.phone === '' ? '' : ` · ${patient.phone}`}`,
                      )}
                    />
                  ))}
                </div>
              </RadioGroup>
            </Stack>
          )}
        </div>
      </section>

      <section aria-labelledby="booking-doctor-heading">
        <h3 id="booking-doctor-heading" className="text-body font-semibold text-text-primary">
          Doctor
        </h3>
        <div className="mt-3 flex items-start gap-3 rounded-surface border border-border bg-surface-sunken p-4">
          <Stethoscope aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="text-body-sm font-medium text-text-primary">{doctorName}</p>
            <p className="text-caption text-text-secondary">
              {doctorSpecialty === '' ? 'Your schedule' : `${doctorSpecialty} · your schedule`}
            </p>
            <p className="mt-1 text-caption text-text-secondary">
              Appointments are booked into your own schedule — the server does not offer booking for
              another doctor.
            </p>
          </div>
        </div>
      </section>

      <Select
        label="Department"
        required
        value={department}
        onChange={onDepartmentChange}
        options={departments.map((value) => ({ value, label: value }))}
        error={issues.department}
        containerClassName="max-w-md"
      />
    </Stack>
  );
}
