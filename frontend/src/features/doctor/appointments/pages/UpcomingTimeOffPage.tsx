import { useEffect, useMemo, useState } from 'react';

import { ArrowLeft, CalendarCheck, CalendarOff, Eye, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useAuth, useToast } from '@/app/providers';
import { Alert, EmptyState, ErrorState, Skeleton } from '@/components/feedback';
import { ContentHeader, PageContainer, PageSections, Stack } from '@/components/layout';
import { Badge, Breadcrumb, Button, Card, ConfirmationDialog, Drawer } from '@/components/ui';
import { formatDate, formatTime, useT, type TranslateFn } from '@/i18n';
import { routes } from '@/routes';

import {
  usePreviewImpactFetcher,
  useRemoveTimeOffMutation,
  useUpcomingTimeOffQuery,
} from '../api/useAppointmentsQuery';
import { TimeOffImpactStep } from '../components/TimeOffImpactStep';
import { timeOffSpan } from '../model/time-off-copy';
import {
  clearBlock,
  readFollowUps,
  reconcile,
  writeFollowUps,
  type FollowUpRecord,
} from '../model/time-off-follow-up';
import type { ImpactedAppointment, TimeOffBlock } from '../model/time-off-service';

/**
 * Upcoming Time Off (API §3.9) — the doctor's own blocks that have not ended,
 * soonest first, as the server lists them (`GET /me/time-off`).
 *
 * A block carries an id, a start, an end and a kind — nothing else: no
 * reason, no recurrence, no approval status. Everything shown is that or
 * derived from it (the duration; whether the block is under way now).
 *
 * It is also where an interrupted Block Time Off is finished. A block booked
 * while the doctor left the page (or reloaded, or lost the connection) is
 * flagged "Follow-up needed", and "Handle appointments" re-reads the
 * appointments inside it from the server and offers the same decision the
 * Block Time Off page would have — see `model/time-off-follow-up.ts`.
 *
 * Cancelling frees the time for bookings and nothing else. Appointments a
 * resolution already cancelled or moved stay that way, and the confirmation
 * says so.
 */

/** "2 d 4 h", "8 h", "45 min" — from the block's own start and end. */
function formatTimeOffDuration(t: TranslateFn, block: TimeOffBlock): string {
  const minutes = Math.max(
    0,
    Math.round((new Date(block.endsAt).getTime() - new Date(block.startsAt).getTime()) / 60_000),
  );
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const parts = [
    days > 0 ? t('timeOff.duration.days', { count: days }) : null,
    hours > 0 ? t('timeOff.duration.hours', { count: hours }) : null,
    mins > 0 ? t('timeOff.duration.minutes', { count: mins }) : null,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? t('timeOff.duration.minutes', { count: 0 }) : parts.join(' ');
}

const isUnderWay = (block: TimeOffBlock, now = Date.now()) =>
  new Date(block.startsAt).getTime() <= now && now < new Date(block.endsAt).getTime();

function StatusBadges({ block, followUp }: { block: TimeOffBlock; followUp: boolean }) {
  const t = useT();
  return (
    <span className="flex flex-wrap gap-1">
      <Badge variant={block.kind === 'emergency-block' ? 'warning' : 'info'}>
        {block.kind === 'emergency-block'
          ? t('timeOff.badge.emergency')
          : t('timeOff.badge.vacation')}
      </Badge>
      {isUnderWay(block) ? <Badge variant="success">{t('timeOff.badge.inProgress')}</Badge> : null}
      {followUp ? <Badge variant="warning">{t('timeOff.badge.followUp')}</Badge> : null}
    </span>
  );
}

type FollowUpView =
  | { readonly kind: 'closed' }
  | { readonly kind: 'loading'; readonly block: TimeOffBlock }
  | { readonly kind: 'error'; readonly block: TimeOffBlock }
  | {
      readonly kind: 'ready';
      readonly block: TimeOffBlock;
      readonly impacted: readonly ImpactedAppointment[];
    };

export function UpcomingTimeOffPage() {
  const t = useT();
  const navigate = useNavigate();
  const { toast } = useToast();
  const userId = useAuth().user?.id ?? null;
  const query = useUpcomingTimeOffQuery();
  const remove = useRemoveTimeOffMutation();
  const previewImpact = usePreviewImpactFetcher();
  const [reviewing, setReviewing] = useState<TimeOffBlock | null>(null);
  const [pending, setPending] = useState<TimeOffBlock | null>(null);
  const [records, setRecords] = useState<readonly FollowUpRecord[]>(() =>
    userId === null ? [] : readFollowUps(userId),
  );
  const [notFound, setNotFound] = useState<readonly FollowUpRecord[]>([]);
  const [followUp, setFollowUp] = useState<FollowUpView>({ kind: 'closed' });
  const [resolving, setResolving] = useState(false);

  /*
   * Reconcile the local records with what the server lists: a save whose
   * block now exists becomes a follow-up, a save that matches nothing after
   * the grace period is reported and dropped, and a follow-up whose block is
   * gone is dropped. Absence only means something in a list read *now*, so
   * this waits for a fetch made after the page mounted and not still running
   * — a cached list from before the create landed would wrongly drop the
   * follow-up it was booked with.
   */
  const fresh = query.isFetchedAfterMount && !query.isFetching ? query.data : undefined;
  useEffect(() => {
    if (userId === null || fresh === undefined) return;
    const result = reconcile(readFollowUps(userId), fresh);
    writeFollowUps(userId, result.records);
    setRecords(result.records);
    if (result.notFound.length > 0) {
      setNotFound((current) => [...current, ...result.notFound]);
    }
  }, [userId, fresh]);

  const blocks = fresh;
  const { followUps, stillSaving } = useMemo(
    () => reconcile(records, blocks ?? [], Date.now()),
    [records, blocks],
  );

  const openFollowUp = (block: TimeOffBlock) => {
    setFollowUp({ kind: 'loading', block });
    previewImpact(block).then(
      (impacted) => setFollowUp({ kind: 'ready', block, impacted }),
      () => setFollowUp({ kind: 'error', block }),
    );
  };

  const finishFollowUp = (block: TimeOffBlock) => {
    if (userId === null) return;
    clearBlock(userId, block.id);
    setRecords(readFollowUps(userId));
  };

  const blockTimeOff = (
    <Button
      variant="secondary"
      leadingIcon={CalendarOff}
      onClick={() => navigate(routes.doctor.blockTimeOff)}
    >
      {t('route.blockTimeOff')}
    </Button>
  );

  const followUpBlock = followUp.kind === 'closed' ? null : followUp.block;

  return (
    <PageContainer width="lg">
      <PageSections>
        <ContentHeader
          title={t('route.upcomingTimeOff')}
          icon={CalendarCheck}
          tone="warning"
          breadcrumb={
            <Breadcrumb
              items={[
                { label: t('nav.overview'), href: routes.doctor.overview },
                { label: t('nav.appointments'), href: routes.doctor.appointments },
                { label: t('route.upcomingTimeOff') },
              ]}
            />
          }
          actions={
            <>
              <Button
                variant="ghost"
                leadingIcon={ArrowLeft}
                onClick={() => navigate(routes.doctor.appointments)}
              >
                {t('timeOff.back')}
              </Button>
              {blockTimeOff}
            </>
          }
        />

        {followUps.size > 0 ? (
          <Alert variant="warning" title={t('timeOff.recovery.title')}>
            {t('timeOff.recovery.body', { count: followUps.size })}
          </Alert>
        ) : null}
        {stillSaving.length > 0 ? (
          <Alert variant="info" title={t('timeOff.recovery.stillSaving')}>
            <Button
              variant="secondary"
              size="sm"
              className="mt-2"
              onClick={() => void query.refetch()}
            >
              {t('timeOff.recovery.refresh')}
            </Button>
          </Alert>
        ) : null}
        {notFound.map((record) => (
          <Alert
            key={record.id}
            variant="info"
            title={t('timeOff.recovery.notFound', {
              span: t('timeOff.span', {
                start: `${formatDate(record.from)} ${formatTime(record.from)}`,
                end: `${formatDate(record.to)} ${formatTime(record.to)}`,
              }),
            })}
          >
            <Button
              variant="secondary"
              size="sm"
              className="mt-2"
              onClick={() =>
                setNotFound((current) => current.filter((entry) => entry.id !== record.id))
              }
            >
              {t('timeOff.recovery.dismiss')}
            </Button>
          </Alert>
        ))}

        <Card>
          {query.isPending ? (
            <Stack gap={3} aria-busy="true" aria-label={t('timeOff.list.loading')}>
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </Stack>
          ) : query.isError ? (
            <ErrorState
              title={t('timeOff.list.error')}
              error={query.error}
              onRetry={() => void query.refetch()}
              headingLevel="h2"
            />
          ) : query.data.length === 0 ? (
            <EmptyState
              icon={CalendarOff}
              title={t('timeOff.list.empty')}
              description={t('timeOff.list.emptyHint')}
              headingLevel="h2"
              action={blockTimeOff}
            />
          ) : (
            <ul
              className="flex flex-col divide-y divide-border"
              aria-label={t('route.upcomingTimeOff')}
            >
              {query.data.map((block) => {
                const span = timeOffSpan(t, block);
                const needsFollowUp = followUps.has(block.id);
                return (
                  <li
                    key={block.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="text-body-sm font-medium text-text-primary tabular-nums">
                        {span}
                      </p>
                      <p className="mt-0.5 text-caption text-text-secondary tabular-nums">
                        {formatTimeOffDuration(t, block)}
                      </p>
                      <div className="mt-1">
                        <StatusBadges block={block} followUp={needsFollowUp} />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {needsFollowUp ? (
                        <Button
                          variant="primary"
                          size="sm"
                          leadingIcon={CalendarCheck}
                          onClick={() => openFollowUp(block)}
                          aria-label={t('timeOff.handleLabel', { span })}
                        >
                          {t('timeOff.handle')}
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        leadingIcon={Eye}
                        onClick={() => setReviewing(block)}
                        aria-label={t('timeOff.reviewLabel', { span })}
                      >
                        {t('timeOff.review')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        leadingIcon={Trash2}
                        onClick={() => setPending(block)}
                        aria-label={t('timeOff.cancelLabel', { span })}
                      >
                        {t('timeOff.cancel')}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </PageSections>

      <Drawer
        open={reviewing !== null}
        onClose={() => setReviewing(null)}
        title={t('timeOff.drawer.title')}
        footer={
          reviewing === null ? undefined : (
            <Button variant="secondary" leadingIcon={Trash2} onClick={() => setPending(reviewing)}>
              {t('timeOff.drawer.cancel')}
            </Button>
          )
        }
      >
        {reviewing === null ? null : (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-body-sm">
            <dt className="text-text-secondary">{t('timeOff.field.starts')}</dt>
            <dd className="tabular-nums text-text-primary">
              {formatDate(reviewing.startsAt)} {formatTime(reviewing.startsAt)}
            </dd>
            <dt className="text-text-secondary">{t('timeOff.field.ends')}</dt>
            <dd className="tabular-nums text-text-primary">
              {formatDate(reviewing.endsAt)} {formatTime(reviewing.endsAt)}
            </dd>
            <dt className="text-text-secondary">{t('timeOff.field.duration')}</dt>
            <dd className="tabular-nums text-text-primary">
              {formatTimeOffDuration(t, reviewing)}
            </dd>
            <dt className="text-text-secondary">{t('timeOff.field.kind')}</dt>
            <dd>
              <StatusBadges block={reviewing} followUp={followUps.has(reviewing.id)} />
            </dd>
            <dt className="text-text-secondary">{t('timeOff.field.reference')}</dt>
            <dd className="font-mono text-text-primary">{reviewing.id}</dd>
          </dl>
        )}
      </Drawer>

      <Drawer
        open={followUpBlock !== null}
        onClose={() => {
          if (!resolving) setFollowUp({ kind: 'closed' });
        }}
        title={t('timeOff.followUp.title')}
        size="lg"
      >
        {followUp.kind === 'loading' ? (
          <Stack gap={3} aria-busy="true" aria-label={t('timeOff.followUp.loading')}>
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </Stack>
        ) : followUp.kind === 'error' ? (
          <ErrorState
            title={t('timeOff.followUp.error')}
            onRetry={() => openFollowUp(followUp.block)}
            headingLevel="h3"
          />
        ) : followUp.kind === 'ready' && followUp.impacted.length === 0 ? (
          <EmptyState
            icon={CalendarCheck}
            title={t('timeOff.followUp.none')}
            description={t('timeOff.followUp.noneHint')}
            headingLevel="h3"
            action={
              <Button
                onClick={() => {
                  finishFollowUp(followUp.block);
                  setFollowUp({ kind: 'closed' });
                }}
              >
                {t('timeOff.followUp.done')}
              </Button>
            }
          />
        ) : followUp.kind === 'ready' ? (
          <TimeOffImpactStep
            key={followUp.impacted.map((appointment) => appointment.id).join(',')}
            block={followUp.block}
            impacted={followUp.impacted}
            onReload={() => openFollowUp(followUp.block)}
            onClose={() => setFollowUp({ kind: 'closed' })}
            onPendingChange={setResolving}
            onDecided={() => finishFollowUp(followUp.block)}
            onDone={(options) => {
              setFollowUp({ kind: 'closed' });
              if (options !== null) toast(options);
            }}
          />
        ) : null}
      </Drawer>

      <ConfirmationDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={() => {
          const block = pending;
          if (block === null || remove.isPending) return;
          remove.mutate(block.id, {
            onSuccess: () => {
              setPending(null);
              setReviewing((current) => (current?.id === block.id ? null : current));
              if (userId !== null) {
                clearBlock(userId, block.id);
                setRecords(readFollowUps(userId));
              }
              toast({ variant: 'success', title: t('timeOff.toast.cancelled') });
            },
            onError: () => toast({ variant: 'error', title: t('timeOff.toast.cancelFailed') }),
          });
        }}
        title={t('timeOff.confirmCancel.title')}
        description={
          pending === null
            ? undefined
            : t('timeOff.confirmCancel.body', { span: timeOffSpan(t, pending) })
        }
        confirmLabel={t('timeOff.drawer.cancel')}
        cancelLabel={t('timeOff.confirmCancel.keep')}
        tone="destructive"
        loading={remove.isPending}
      />
    </PageContainer>
  );
}
