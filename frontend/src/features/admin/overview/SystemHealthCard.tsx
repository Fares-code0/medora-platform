import { HeartPulse } from 'lucide-react';

import { Skeleton } from '@/components/feedback';
import { Badge } from '@/components/ui';
import { cn } from '@/utils/cn';

import { AsyncSection, Panel } from '../components/primitives';

import { formatCheckedAt } from './overview';
import type { OverviewWidgetSurface, ServiceHealth, ServiceStatus } from './overview.types';

const STATUS_DOT: Record<ServiceStatus, string> = {
  operational: 'bg-success',
  degraded: 'bg-warning',
  down: 'bg-error',
};

const STATUS_LABEL: Record<ServiceStatus, string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  down: 'Down',
};

/** Wording deliberately distinct from the per-service labels: this is a verdict over all of them. */
const VERDICT_LABEL: Record<ServiceStatus, string> = {
  operational: 'All operational',
  degraded: 'Service degraded',
  down: 'Service down',
};

const VERDICT_VARIANT: Record<ServiceStatus, 'success' | 'warning' | 'error'> = {
  operational: 'success',
  degraded: 'warning',
  down: 'error',
};

/**
 * Row 3 right (§3.1 · spec §4.7) — one line per platform service with its
 * uptime and when it was last checked.
 *
 * A degraded service prints its incident note underneath. §3.1 asks for status
 * dots, but a coloured dot tells an administrator that something is wrong and
 * not what is wrong — and this card is often the first place they will see it,
 * so the note is the point rather than a detail. The dot also carries a
 * screen-reader label: status is never colour alone (DS §1.3).
 */
export interface SystemHealthCardProps extends OverviewWidgetSurface {
  services: readonly ServiceHealth[];
  /** The page's single clock, so every relative time on the page agrees. */
  now: number;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

export function SystemHealthCard({
  services,
  now,
  isLoading,
  isError,
  onRetry,
  menu,
  className,
}: SystemHealthCardProps) {
  /*
   * No services, no verdict. The worst status of an empty list is
   * "operational", so a badge computed before the list lands would report the
   * platform healthy on the strength of knowing nothing about it.
   */
  const verdict = services.length === 0 ? null : worstStatus(services);

  return (
    <Panel
      title="System health"
      menu={menu}
      className={className}
      description="Platform services"
      icon={HeartPulse}
      tone={verdict === null || verdict === 'operational' ? 'success' : 'warning'}
      action={
        verdict === null ? null : (
          <Badge variant={VERDICT_VARIANT[verdict]} dot>
            {VERDICT_LABEL[verdict]}
          </Badge>
        )
      }
      /* The rows are full-bleed and carry their own padding; the skeleton and
         the error notice are ordinary block content and need the inset back. */
      bodyClassName={isLoading || isError ? undefined : 'p-0'}
    >
      <AsyncSection
        isLoading={isLoading}
        isError={isError}
        onRetry={onRetry}
        skeleton={<ServicesSkeleton />}
      >
        <ul className="flex flex-col divide-y divide-border">
          {services.map((service) => (
            <li key={service.id} className="flex flex-col gap-1 px-5 py-3">
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className={cn('h-2 w-2 shrink-0 rounded-pill', STATUS_DOT[service.status])}
                />
                <span className="min-w-0 flex-1 truncate text-body-sm text-text-primary">
                  {service.name}
                  <span className="sr-only"> — {STATUS_LABEL[service.status]}</span>
                </span>
                <span className="shrink-0 text-caption text-text-tertiary tabular-nums">
                  {service.uptimePercent}% · {formatCheckedAt(service.lastCheckedAt, now)}
                </span>
              </div>
              {service.incidentNote === null ? null : (
                <p
                  className={cn(
                    'ps-5 text-caption',
                    service.status === 'down' ? 'text-error' : 'text-warning',
                  )}
                >
                  {service.incidentNote}
                </p>
              )}
            </li>
          ))}
        </ul>
      </AsyncSection>
    </Panel>
  );
}

function worstStatus(services: readonly ServiceHealth[]): ServiceStatus {
  if (services.some((service) => service.status === 'down')) return 'down';
  if (services.some((service) => service.status === 'degraded')) return 'degraded';
  return 'operational';
}

/** Four rows, the number the platform actually reports, so nothing shifts. */
function ServicesSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {['api', 'notifications', 'ai', 'storage'].map((service) => (
        <Skeleton key={service} className="h-6 w-full rounded-surface" />
      ))}
    </div>
  );
}
