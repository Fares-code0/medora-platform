import { Armchair, Building2, Users } from 'lucide-react';

import { EmptyState, ErrorState, Skeleton } from '@/components/feedback';
import { ContentHeader, Grid, PageContainer, PageSections } from '@/components/layout';
import { StatusBadge } from '@/components/patterns';
import { Badge, Card } from '@/components/ui';
import { useQueue, useWaitingRoom } from '@/features/shared-domain/clinic-operations/queries';
import {
  ownedByDoctor,
  visibleToScope,
  type ClinicScope,
} from '@/features/shared-domain/clinic-scope';
import { isolateLtr } from '@/i18n';

import { useClinicScope } from '../useClinicScope';

/**
 * The doctor-scoped clinic board (D-27b).
 *
 * The row was blocked on attribution rather than UI: a queue entry saying
 * only which *patient* is waiting cannot be scoped to a doctor or a clinic.
 * With `clinicId`, `doctorId` and `patientId` on the model, this is the view
 * the row asked for — the doctor's own clinic, and their own patients within
 * it, rather than the administrator's cross-clinic board.
 *
 * **What the scoping here is and is not.** It is a display rule: the
 * frontend never shows another clinic's rows and never offers an action
 * against them, which is what the product policy asks of the client. It is
 * *not* the isolation itself — everything filtered here was still sent to
 * this browser, and a client can unfilter anything it filters. The server
 * must scope every read and write from the session; see
 * `docs/handoff/clinic-isolation.md` for exactly what is owed.
 *
 * Other clinicians' patients are reduced to a **count** rather than hidden
 * entirely. "Three people are waiting, none for you" is operationally useful
 * and carries no patient identity; a silent empty board would read as a bug.
 *
 * **A doctor whose session names no clinic sees an explicit empty state**
 * (AF-17, WEB-5), and the board is not fetched at all: there is no clinic to
 * narrow it to, and the alternative — every clinic's queue — is the
 * fail-open this replaced.
 */
export function MyClinicPage() {
  const scope = useClinicScope();
  if (scope === null) return <NoClinicState />;
  return <ClinicBoard scope={scope} />;
}

function NoClinicState() {
  return (
    <PageContainer width="xl">
      <PageSections>
        <ContentHeader
          title="My clinic"
          caption="Today's queue and waiting room for your own patients."
        />
        <EmptyState
          icon={Building2}
          title="Your session does not name a clinic"
          description="This board shows your own clinic only, so with no clinic on your session it shows nothing rather than every clinic's queue. Your clinic is attached to your account by the server, not chosen here."
        />
      </PageSections>
    </PageContainer>
  );
}

function ClinicBoard({ scope }: { scope: ClinicScope }) {
  const queue = useQueue();
  const waiting = useWaitingRoom();

  if (queue.isPending || waiting.isPending) {
    return (
      <PageContainer width="xl">
        <PageSections>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </PageSections>
      </PageContainer>
    );
  }

  if (queue.isError || waiting.isError) {
    return (
      <PageContainer width="xl">
        <PageSections>
          <ErrorState
            title="The clinic board could not be loaded"
            // The clinic-operations store has no backend: in a live build this
            // reads "Not connected yet" rather than as a fault to retry.
            error={queue.error ?? waiting.error}
            onRetry={() => {
              void queue.refetch();
              void waiting.refetch();
            }}
          />
        </PageSections>
      </PageContainer>
    );
  }

  const myQueue = ownedByDoctor(queue.data ?? [], scope);
  const clinicQueue = visibleToScope(queue.data ?? [], scope);
  const myWaiting = ownedByDoctor(waiting.data ?? [], scope);
  const othersWaiting = clinicQueue.length - myQueue.length;

  return (
    <PageContainer width="xl">
      <PageSections>
        <ContentHeader
          title="My clinic"
          caption="Today's queue and waiting room for your own patients."
        />

        <Grid columns={{ base: 1, lg: 2 }} gap={4}>
          <Card
            padding="compact"
            title="Waiting for you"
            subtitle={`${String(myQueue.length)} in the queue`}
          >
            {myQueue.length === 0 ? (
              <EmptyState
                icon={Users}
                title="Nobody is waiting for you"
                description={
                  othersWaiting <= 0
                    ? 'The clinic queue is empty.'
                    : `${String(othersWaiting)} patient${othersWaiting === 1 ? ' is' : 's are'} waiting for other clinicians in your clinic.`
                }
              />
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {myQueue.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-body-sm font-medium text-text-primary">
                        {entry.ticket} · {entry.patientName}
                      </p>
                      <p className="text-caption text-text-secondary">{entry.reason}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {entry.delayed ? <Badge variant="warning">Delayed</Badge> : null}
                      <StatusBadge
                        status={entry.priority === 'urgent' ? 'critical' : 'pending'}
                        label={isolateLtr(`${String(entry.waitingMinutes)} min`)}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card
            padding="compact"
            title="Checked in"
            subtitle={`${String(myWaiting.length)} in the waiting room`}
          >
            {myWaiting.length === 0 ? (
              <EmptyState
                icon={Armchair}
                title="No one checked in for you yet"
                description="Patients appear here once reception checks them in."
              />
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {myWaiting.map((patient) => (
                  <li
                    key={patient.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-body-sm font-medium text-text-primary">
                        {patient.patientName}
                      </p>
                      <p className="text-caption text-text-secondary">
                        <span dir="ltr">
                          {patient.appointmentTime} · {patient.area}
                        </span>
                      </p>
                    </div>
                    <StatusBadge
                      status={patient.status === 'in-room' ? 'active' : 'pending'}
                      label={
                        patient.status === 'in-room'
                          ? 'In room'
                          : patient.status === 'called'
                            ? 'Called'
                            : 'Waiting'
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </Grid>

        <p className="text-caption text-text-secondary">
          You are seeing your own clinic only. Clinic isolation is enforced by the server; this page
          reflects that policy rather than implementing it.
        </p>
      </PageSections>
    </PageContainer>
  );
}
