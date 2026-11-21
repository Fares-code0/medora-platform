import type { ReactNode } from 'react';

import { ErrorState, Skeleton } from '@/components/feedback';
import { Fact, FactGrid } from '@/components/patterns';
import { Card } from '@/components/ui';
import { formatDate, relativeDayLabel } from '@/utils/dates';

import { primaryDiagnosis, type MedicalRecordSummary } from '../model/types';

import { RecordPatientCell, RecordPriorityBadge, RecordStatusBadge } from './MedicalRecordCells';
import { MedicalRecordRowActions } from './MedicalRecordRowActions';

/**
 * <md rendering of the records list — UX §5.2 stacked key-value cards
 * mirroring the DataTable contract (loading / error / empty / actions)
 * so no functionality is lost on mobile.
 */

export interface MedicalRecordCardListProps {
  records: readonly MedicalRecordSummary[];
  onOpenRecord: (record: MedicalRecordSummary) => void;
  loading: boolean;
  error?: { readonly title?: string; readonly onRetry?: () => void } | undefined;
  emptyState: ReactNode;
}

export function MedicalRecordCardList({
  records,
  onOpenRecord,
  loading,
  error,
  emptyState,
}: MedicalRecordCardListProps) {
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
    return (
      <ErrorState title={error.title ?? "Couldn't load medical records"} onRetry={error.onRetry} />
    );
  }

  if (records.length === 0) {
    return <>{emptyState}</>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {records.map((record) => (
        <li key={record.id}>
          <Card padding="compact">
            <div className="flex items-start justify-between gap-3">
              <RecordPatientCell record={record} />
              <MedicalRecordRowActions
                record={record}
                onOpenRecord={onOpenRecord}
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <RecordStatusBadge record={record} />
              <RecordPriorityBadge record={record} />
            </div>
            <FactGrid className="mt-3">
              <Fact label="Record">
                <span className="font-mono">{record.id}</span>
              </Fact>
              <Fact label="MRN">
                <span className="font-mono">{record.patient.mrn}</span>
              </Fact>
              <Fact label="Visit">
                {formatDate(record.visitDate)} · {relativeDayLabel(record.visitDate)}
              </Fact>
              <Fact label="Diagnosis">{primaryDiagnosis(record)?.label ?? '—'}</Fact>
              <Fact label="Department">{record.department}</Fact>
            </FactGrid>
          </Card>
        </li>
      ))}
    </ul>
  );
}
