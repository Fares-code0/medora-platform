import { useMemo, useState } from 'react';

import { ErrorState, Skeleton } from '@/components/feedback';
import { Stack } from '@/components/layout';
import { Radio, RadioGroup, SearchInput } from '@/components/ui';
import { usePatientDirectoryQuery, type Patient } from '@/features/shared-domain/patient-identity';
import { isolateLtr } from '@/i18n';

import { toPrescriptionPatient, type StepValidation } from '../../model/authoring';
import type { PrescriptionPatientSnapshot } from '../../model/types';

/**
 * Step 1 — Patient. A cold start lands here with the picker; a deep link
 * from a patient context lands on step 2 with the patient already chosen and
 * this step still revisitable.
 *
 * Radio group rather than a combobox: the choice is single-select, and a
 * native radio group is operable by arrow keys with no custom keyboard
 * handling to get wrong. The roster is the patient directory — the doctor's
 * own caseload when live (FE-10.6).
 */

export interface PatientStepProps {
  selectedPatientId: string | null;
  onSelect: (patient: PrescriptionPatientSnapshot) => void;
  validation: StepValidation;
  showIssues: boolean;
}

const NO_PATIENTS: readonly Patient[] = [];

export function PatientStep({
  selectedPatientId,
  onSelect,
  validation,
  showIssues,
}: PatientStepProps) {
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

  const issue = showIssues
    ? validation.issues.find((entry) => entry.field === 'patient')
    : undefined;

  if (directory.isPending) {
    return (
      <Stack gap={3} aria-busy="true" aria-label="Loading patients">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </Stack>
    );
  }

  if (directory.isError) {
    return (
      <ErrorState
        title="Couldn't load your patients"
        error={directory.error}
        onRetry={() => void directory.refetch()}
      />
    );
  }

  return (
    <Stack gap={4}>
      <SearchInput
        label="Find a patient"
        placeholder="Search by name or MRN…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onClear={() => setQuery('')}
        helperText={`${String(matches.length)} of ${String(patients.length)} patients`}
      />

      {matches.length === 0 ? (
        <p className="text-body-sm text-text-secondary">No patient matches “{query}”.</p>
      ) : (
        <RadioGroup
          label="Patient"
          name="prescription-patient"
          required
          value={selectedPatientId}
          error={issue?.message}
          onChange={(value) => {
            const patient = patients.find((candidate) => candidate.id === value);
            if (patient) onSelect(toPrescriptionPatient(patient));
          }}
        >
          {matches.map((patient) => (
            <Radio
              key={patient.id}
              value={patient.id}
              label={`${patient.name} · MRN ${patient.mrn}`}
              description={isolateLtr(
                `${String(patient.age)} yrs · ${patient.gender} · ${patient.bloodType} · ${
                  patient.allergies.length > 0
                    ? `Allergies: ${patient.allergies.join(', ')}`
                    : 'No known allergies'
                }`,
              )}
            />
          ))}
        </RadioGroup>
      )}
    </Stack>
  );
}
