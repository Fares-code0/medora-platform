import type { ReactNode } from 'react';

import { ErrorState, Skeleton } from '@/components/feedback';
import { Fact, FactGrid } from '@/components/patterns';
import { Card } from '@/components/ui';
import { formatDate, formatTime } from '@/utils/dates';

import type { Appointment, AppointmentAction } from '../model/types';

import {
  AppointmentPatientCell,
  AppointmentPriorityBadge,
  AppointmentStatusBadge,
} from './AppointmentCells';
import { AppointmentRowActions } from './AppointmentRowActions';

/**
 * <md rendering of the appointments list — UX §5.2 stacked key-value
 * cards mirroring the DataTable contract (loading / error / empty /
 * actions) so no functionality is lost on mobile.
 */

export interface AppointmentCardListProps {
  appointments: readonly Appointment[];
  onOpenDetails: (appointment: Appointment) => void;
  onAction: (action: AppointmentAction, appointment: Appointment) => void;
  loading: boolean;
  error?: { readonly title?: string; readonly onRetry?: () => void } | undefined;
  emptyState: ReactNode;
}

export function AppointmentCardList({
  appointments,
  onOpenDetails,
  onAction,
  loading,
  error,
  emptyState,
}: AppointmentCardListProps) {
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
      <ErrorState title={error.title ?? "Couldn't load appointments"} onRetry={error.onRetry} />
    );
  }

  if (appointments.length === 0) {
    return <>{emptyState}</>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {appointments.map((appointment) => (
        <li key={appointment.id}>
          <Card padding="compact">
            <div className="flex items-start justify-between gap-3">
              <AppointmentPatientCell appointment={appointment} />
              <AppointmentRowActions
                appointment={appointment}
                onOpenDetails={onOpenDetails}
                onAction={onAction}
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <AppointmentStatusBadge appointment={appointment} />
              <AppointmentPriorityBadge appointment={appointment} />
            </div>
            <FactGrid className="mt-3">
              <Fact label="Appointment">
                <span className="font-mono">{appointment.id}</span>
              </Fact>
              <Fact label="MRN">
                <span className="font-mono">{appointment.patient.mrn}</span>
              </Fact>
              <Fact label="When">
                {formatDate(appointment.dateTime)} · {formatTime(appointment.dateTime)}
              </Fact>
              <Fact label="Duration">
                <span dir="ltr">{appointment.durationMin} min</span>
              </Fact>
              <Fact label="Type">{appointment.visitType}</Fact>
              <Fact label="Department">{appointment.department}</Fact>
            </FactGrid>
          </Card>
        </li>
      ))}
    </ul>
  );
}
