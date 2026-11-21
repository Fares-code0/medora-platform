import type { ReactNode } from 'react';

import { ErrorState, Skeleton } from '@/components/feedback';
import { StatusBadge, Fact, FactGrid } from '@/components/patterns';
import { Card, Checkbox } from '@/components/ui';
import {
  PATIENT_STATUS_META,
  RISK_LEVEL_META,
  type Patient,
} from '@/features/shared-domain/patient-identity';
import { formatDate, formatTime, dayDiffFromToday } from '@/utils/dates';

import { PatientNameCell } from './PatientNameCell';
import { PatientRowActions } from './PatientRowActions';

/**
 * <md rendering of the patient list — UX §5.2: P1 tables with >4 columns
 * collapse to stacked key-value cards, primary fact as the card title.
 * Mirrors the DataTable contract (loading / error / empty / selection /
 * actions) so no functionality is lost on mobile.
 */

function PatientCard({
  patient,
  selected,
  onToggleSelect,
}: {
  patient: Patient;
  selected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const next = patient.nextAppointment;
  return (
    <Card padding="compact" className={selected ? 'border-primary' : undefined}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Checkbox
            aria-label={`Select ${patient.name}`}
            checked={selected}
            onChange={() => onToggleSelect(patient.id)}
          />
          <div className="min-w-0">
            <PatientNameCell patient={patient} />
            <p className="mt-1 font-mono text-caption text-text-primary">
              MRN {patient.mrn} · {patient.id}
            </p>
          </div>
        </div>
        <PatientRowActions patient={patient} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StatusBadge
          status={PATIENT_STATUS_META[patient.status].kind}
          label={PATIENT_STATUS_META[patient.status].label}
        />
        <StatusBadge
          status={RISK_LEVEL_META[patient.riskLevel].kind}
          label={`Risk: ${RISK_LEVEL_META[patient.riskLevel].label}`}
        />
      </div>

      <FactGrid className="mt-3">
        <Fact label="Age / gender">
          <span dir="ltr">
            {patient.age} · {patient.gender === 'female' ? 'Female' : 'Male'}
          </span>
        </Fact>
        <Fact label="Blood type">
          <span dir="ltr">{patient.bloodType}</span>
        </Fact>
        <Fact label="Phone" truncate={false}>
          <span dir="ltr">{patient.phone}</span>
        </Fact>
        <Fact label="Last visit">
          {patient.lastVisit === null ? '—' : formatDate(patient.lastVisit)}
        </Fact>
        <Fact label="Next appointment">
          {next === null
            ? '—'
            : dayDiffFromToday(next) === 0
              ? `Today ${formatTime(next)}`
              : formatDate(next)}
        </Fact>
      </FactGrid>
    </Card>
  );
}

export interface PatientCardListProps {
  patients: readonly Patient[];
  selectedIds: readonly string[];
  onToggleSelect: (id: string) => void;
  loading: boolean;
  error?: { readonly title?: string; readonly onRetry?: () => void } | undefined;
  emptyState: ReactNode;
}

export function PatientCardList({
  patients,
  selectedIds,
  onToggleSelect,
  loading,
  error,
  emptyState,
}: PatientCardListProps) {
  if (loading) {
    return (
      <div aria-busy="true" className="flex flex-col gap-3">
        {Array.from({ length: 4 }, (_, index) => (
          <Card key={index} padding="compact">
            <div className="flex flex-col gap-3">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-16 w-full rounded-surface" />
            </div>
          </Card>
        ))}
      </div>
    );
  }

  if (error) {
    return <ErrorState title={error.title ?? "Couldn't load patients"} onRetry={error.onRetry} />;
  }

  if (patients.length === 0) {
    return <>{emptyState}</>;
  }

  const selectedSet = new Set(selectedIds);
  return (
    <ul className="flex flex-col gap-3">
      {patients.map((patient) => (
        <li key={patient.id}>
          <PatientCard
            patient={patient}
            selected={selectedSet.has(patient.id)}
            onToggleSelect={onToggleSelect}
          />
        </li>
      ))}
    </ul>
  );
}
