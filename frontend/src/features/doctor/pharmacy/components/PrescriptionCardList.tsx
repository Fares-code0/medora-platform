import type { ReactNode } from 'react';

import { ErrorState, Skeleton } from '@/components/feedback';
import { Fact, FactGrid } from '@/components/patterns';
import { Card } from '@/components/ui';
import { formatDate } from '@/utils/dates';

import { type PrescriptionSummary } from '../model/types';

import {
  MedicationFlags,
  PrescriptionPatientCell,
  PrescriptionStatusBadge,
  RefillStatusBadge,
} from './PharmacyCells';
import { PrescriptionRowActions } from './PrescriptionRowActions';

/**
 * <md rendering of the pharmacy list — UX §5.2 stacked key-value cards
 * mirroring the DataTable contract (loading / error / empty / actions) so
 * no functionality is lost on mobile.
 */

export interface PrescriptionCardListProps {
  prescriptions: readonly PrescriptionSummary[];
  onOpen: (prescription: PrescriptionSummary) => void;
  onRenew?: ((prescription: PrescriptionSummary) => void) | undefined;
  onEnd?: ((prescription: PrescriptionSummary) => void) | undefined;
  loading: boolean;
  error?: { readonly title?: string; readonly onRetry?: () => void } | undefined;
  emptyState: ReactNode;
}

export function PrescriptionCardList({
  prescriptions,
  onOpen,
  onRenew,
  onEnd,
  loading,
  error,
  emptyState,
}: PrescriptionCardListProps) {
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
    return <ErrorState title={error.title ?? "Couldn't load prescriptions"} onRetry={error.onRetry} />;
  }

  if (prescriptions.length === 0) {
    return <>{emptyState}</>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {prescriptions.map((prescription) => (
        <li key={prescription.id}>
          <Card padding="compact">
            <div className="flex items-start justify-between gap-3">
              <PrescriptionPatientCell prescription={prescription} />
              <PrescriptionRowActions
                prescription={prescription}
                onOpen={onOpen}
                onRenew={onRenew}
                onEnd={onEnd}
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <PrescriptionStatusBadge prescription={prescription} />
              <RefillStatusBadge prescription={prescription} />
              <MedicationFlags prescription={prescription} />
            </div>
            <FactGrid className="mt-3">
              <Fact label="Rx ID">
                <span className="font-mono">{prescription.id}</span>
              </Fact>
              <Fact label="MRN">
                <span className="font-mono">{prescription.patient.mrn}</span>
              </Fact>
              <Fact label="Medication">
                {prescription.medication.name} · {prescription.dosage}
              </Fact>
              <Fact label="Frequency">{prescription.frequency}</Fact>
              <Fact label="Start">{formatDate(prescription.startDate)}</Fact>
              <Fact label="Prescribed by">{prescription.prescribingDoctor}</Fact>
            </FactGrid>
          </Card>
        </li>
      ))}
    </ul>
  );
}
