import { useMemo, useState } from 'react';

import { ErrorState, Skeleton } from '@/components/feedback';
import { Stack } from '@/components/layout';
import { Radio, RadioGroup, SearchInput } from '@/components/ui';
import { usePatientDirectoryQuery, type Patient } from '@/features/shared-domain/patient-identity';
import { isolateLtr } from '@/i18n';

import { toRecordPatientSnapshot } from '../../model/authoring';
import type { RecordPatientSnapshot } from '../../model/types';

/**
 * Step 1 — Patient. A cold start lands here; a deep link carrying `?patient=`
 * lands on step 2 with this one already answered and still revisitable.
 *
 * Radio group rather than a combobox, for the reason the pharmacy's picker
 * gives: the choice is single-select, and a native radio group is arrow-key
 * operable with no custom keyboard handling to get wrong. The roster is the
 * patient directory — the doctor's own caseload when live (FE-10.5).
 */
export interface RecordPatientStepProps {
  selectedPatientId: string | null;
  onSelect: (patient: RecordPatientSnapshot) => void;
  showIssues: boolean;
}

const NO_PATIENTS: readonly Patient[] = [];

export function RecordPatientStep({
  selectedPatientId,
  onSelect,
  showIssues,
}: RecordPatientStepProps) {
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

      <RadioGroup
        label="Patient"
        name="record-patient"
        required
        value={selectedPatientId}
        onChange={(value) => {
          const patient = patients.find((candidate) => candidate.id === value);
          if (patient !== undefined) onSelect(toRecordPatientSnapshot(patient));
        }}
        error={
          showIssues && selectedPatientId === null
            ? 'Choose the patient this encounter is for.'
            : undefined
        }
      >
        {matches.map((patient) => (
          <Radio
            key={patient.id}
            value={patient.id}
            label={`${patient.name} — MRN ${patient.mrn}`}
            description={isolateLtr(
              `${String(patient.age)} · ${patient.gender === 'female' ? 'F' : 'M'} · ${
                patient.allergies.length === 0
                  ? 'No recorded allergies'
                  : `Allergies: ${patient.allergies.join(', ')}`
              }`,
            )}
          />
        ))}
      </RadioGroup>
    </Stack>
  );
}
