import {
  ArrowRight,
  CalendarX,
  CheckCircle2,
  ClipboardList,
  DoorOpen,
  FileText,
  Gauge,
  ListOrdered,
  Megaphone,
  Timer,
  UserRound,
  Users,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { CircularProgress } from '@/components/feedback';
import { ContentHeader, PageContainer, PageSections } from '@/components/layout';
import { StatisticCard } from '@/components/patterns';
import { Badge, Button } from '@/components/ui';
import { routes } from '@/routes';
import { cn } from '@/utils/cn';

import {
  ANNOUNCEMENT_PRIORITY_LABEL,
  ANNOUNCEMENT_PRIORITY_VARIANT,
  QUEUE_PRIORITY_LABEL,
  QUEUE_PRIORITY_VARIANT,
  SECTION_META,
  formatMinutes,
} from '../administration.meta';
import type { AdminSectionSlug } from '../administration.types';
import { useAnnouncements, useOverview, useQueue } from '../api/useAdministrationQueries';
import { AsyncSection, Overline, Panel } from '../components/primitives';
import { MaskedIdentifier } from '../phi';

/**
 * ClinicOverviewSection — today's clinic at a glance (Phase 17; narrowed to
 * clinic operations in Phase B / AC-18, and moved off the area index to
 * `/admin/clinic` by ADM-01).
 *
 * Hospital-wide and system health left this page in AC-18 and now live on the
 * Administrator Overview at `/admin`. Stacking both on one page asked two
 * unrelated questions at once and ran to 4.7 screens on a phone; this page
 * answers only "how is the clinic running right now?".
 */
const BAR_HEIGHTS = ['h-3', 'h-5', 'h-7', 'h-10', 'h-14', 'h-16', 'h-20', 'h-24'] as const;

export function ClinicOverviewSection() {
  const overview = useOverview();
  const queue = useQueue();
  const announcements = useAnnouncements();
  const navigate = useNavigate();

  const go = (section: AdminSectionSlug) => navigate(routes.admin.section(section));

  const activity = overview.data?.hourlyActivity ?? [];
  const maxActivity = activity.reduce((max, point) => Math.max(max, point.count), 1);

  const nextUp = (queue.data ?? []).slice(0, 3);
  const latestAnnouncements = (announcements.data ?? [])
    .filter((a) => !a.archived)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned))
    .slice(0, 3);

  return (
    /* The page frame every other admin section gets from SectionShell. This
       page cannot use SectionShell itself — its title is the clinic's NAME,
       which only arrives with the query — so it composes the same two
       primitives directly. It used to compose neither, which is why it was
       the one page in the area rendering flush to the viewport edges. The
       envelope is inside the container so the loading and error states are
       framed too. */
    <PageContainer width="2xl">
      <AsyncSection
        isLoading={overview.isLoading}
        isError={overview.isError}
        onRetry={() => void overview.refetch()}
      >
        {overview.data ? (
          <PageSections>
            {/*
              The same page header every other screen in both areas uses. It
              was a hand-rolled hero — an overline over a `text-h3 font-bold`
              h1, with no icon tile — which made this the one page whose title
              was a different size AND started 44px to the left of every
              other, because the missing tile took its indent with it.

              The clinic's NAME stays the title; `SECTION_META.clinic` supplies
              the identity chip and the description, so the section still names
              itself without an overline doing it.
            */}
            <ContentHeader
              title={overview.data.clinicName}
              caption={SECTION_META.clinic.description}
              icon={SECTION_META.clinic.icon}
            />

            {/* Headline metrics */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
              <StatisticCard
                layout="stacked"
                size="lg"
                labelVoice="overline"
                label="Today’s patients"
                value={overview.data.todaysPatients}
                icon={UserRound}
                tone="primary"
              />
              <StatisticCard
                layout="stacked"
                size="lg"
                labelVoice="overline"
                label="Appointments"
                value={overview.data.todaysAppointments}
                icon={ClipboardList}
                tone="info"
              />
              <StatisticCard
                layout="stacked"
                size="lg"
                labelVoice="overline"
                label="Waiting now"
                value={overview.data.waitingPatients}
                icon={Timer}
                tone="warning"
                hint="patients in the waiting room"
              />
              <StatisticCard
                layout="stacked"
                size="lg"
                labelVoice="overline"
                label="Completed"
                value={overview.data.completedVisits}
                icon={CheckCircle2}
                tone="success"
              />
              <StatisticCard
                layout="stacked"
                size="lg"
                labelVoice="overline"
                label="Cancelled"
                value={overview.data.cancelledAppointments}
                icon={CalendarX}
                tone="error"
              />
            </div>

            {/* Pulse + quick actions */}
            <div className="grid gap-4 lg:grid-cols-3">
              <Panel title="Clinic pulse" icon={Gauge} tone="primary" className="lg:col-span-2">
                <div className="flex flex-col gap-6">
                  <div className="grid gap-6 sm:grid-cols-3">
                    <GaugeStat label="Doctor utilization" value={overview.data.doctorUtilization} />
                    <GaugeStat label="Clinic occupancy" value={overview.data.clinicOccupancy} />
                    <div className="flex flex-col items-center justify-center gap-1 text-center">
                      <Overline>Avg. waiting</Overline>
                      <span className="text-h2 font-bold text-text-primary tabular-nums">
                        {overview.data.averageWaitingMinutes}
                      </span>
                      <span className="text-caption text-text-tertiary">minutes</span>
                    </div>
                  </div>

                  <div>
                    <Overline>Completed visits by hour</Overline>
                    <div className="mt-3 flex items-end justify-between gap-2">
                      {activity.map((point) => {
                        const ratio = point.count / maxActivity;
                        const height =
                          BAR_HEIGHTS[
                            Math.min(
                              BAR_HEIGHTS.length - 1,
                              Math.round(ratio * (BAR_HEIGHTS.length - 1)),
                            )
                          ];
                        return (
                          <div
                            key={point.hour}
                            className="flex flex-1 flex-col items-center gap-1.5"
                          >
                            <div
                              className={cn('w-full rounded-t-control bg-primary', height)}
                              aria-hidden="true"
                            />
                            <span className="text-caption text-text-tertiary tabular-nums">
                              {point.hour}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </Panel>

              <Panel title="Quick actions" icon={ArrowRight} tone="accent">
                <div className="flex flex-col gap-2">
                  <QuickAction icon={Users} label="Manage staff" onClick={() => go('staff')} />
                  <QuickAction icon={ListOrdered} label="Open queue" onClick={() => go('queue')} />
                  <QuickAction
                    icon={Megaphone}
                    label="Post announcement"
                    onClick={() => go('announcements')}
                  />
                  <QuickAction icon={DoorOpen} label="Room status" onClick={() => go('rooms')} />
                  <QuickAction
                    icon={FileText}
                    label="Document templates"
                    onClick={() => go('templates')}
                  />
                </div>
              </Panel>
            </div>

            {/* Peeks */}
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel
                title="Up next in queue"
                icon={ListOrdered}
                tone="info"
                action={
                  <Button
                    variant="ghost"
                    size="sm"
                    trailingIcon={ArrowRight}
                    onClick={() => go('queue')}
                  >
                    View
                  </Button>
                }
              >
                <ul className="flex flex-col divide-y divide-border">
                  {nextUp.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                    >
                      <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-surface bg-surface-sunken px-1.5 text-caption font-semibold text-text-secondary tabular-nums">
                        {entry.ticket}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body-sm font-medium text-text-primary">
                          <MaskedIdentifier
                            subjectId={entry.id}
                            subjectLabel={`Queue ticket ${entry.ticket}`}
                            kind="name"
                            value={entry.patientName}
                          />
                        </span>
                        <span className="block truncate text-caption text-text-tertiary">
                          waiting {formatMinutes(entry.waitingMinutes)}
                        </span>
                      </span>
                      <Badge variant={QUEUE_PRIORITY_VARIANT[entry.priority]} dot>
                        {QUEUE_PRIORITY_LABEL[entry.priority]}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </Panel>

              <Panel
                title="Latest announcements"
                icon={Megaphone}
                tone="warning"
                action={
                  <Button
                    variant="ghost"
                    size="sm"
                    trailingIcon={ArrowRight}
                    onClick={() => go('announcements')}
                  >
                    View
                  </Button>
                }
              >
                <ul className="flex flex-col divide-y divide-border">
                  {latestAnnouncements.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body-sm font-medium text-text-primary">
                          {item.title}
                        </span>
                        <span className="block truncate text-caption text-text-tertiary">
                          {item.author}
                        </span>
                      </span>
                      <Badge variant={ANNOUNCEMENT_PRIORITY_VARIANT[item.priority]}>
                        {ANNOUNCEMENT_PRIORITY_LABEL[item.priority]}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </Panel>
            </div>
          </PageSections>
        ) : null}
      </AsyncSection>
    </PageContainer>
  );
}

function GaugeStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <Overline>{label}</Overline>
      <div className="relative inline-flex items-center justify-center">
        <CircularProgress value={value} size={48} aria-label={`${label} ${value}%`} />
        <span className="absolute text-caption font-bold text-text-primary tabular-nums">
          {value}%
        </span>
      </div>
    </div>
  );
}

function QuickAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Users;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-surface border border-border bg-surface px-3 py-2.5 text-start text-body-sm font-medium text-text-primary transition-colors duration-fast hover:border-border-strong hover:bg-surface-sunken"
    >
      <Icon
        aria-hidden="true"
        className="h-[18px] w-[18px] shrink-0 text-primary"
        strokeWidth={1.75}
      />
      <span className="flex-1">{label}</span>
      <ArrowRight
        aria-hidden="true"
        className="h-4 w-4 shrink-0 text-text-disabled"
        strokeWidth={1.75}
      />
    </button>
  );
}
