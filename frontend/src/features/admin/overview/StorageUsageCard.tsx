import { ArrowRight, HardDrive } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Progress, Skeleton } from '@/components/feedback';
import { routes } from '@/routes';

import { formatDate } from '../administration.meta';
import type { PlatformStatus } from '../administration.types';
import { AsyncSection, Panel } from '../components/primitives';

import type { OverviewWidgetSurface } from './overview.types';

/**
 * Row 3 left (§3.1 · spec §4.5) — how much headroom the deployment has left.
 *
 * §3.1 renders Revenue in this slot only when billing is enabled for the
 * deployment, and names Storage & Usage as the slot's documented fallback
 * otherwise. No billing flag exists anywhere in this app, so the fallback is
 * what ships — carrying the licence plan, renewal and seats bar absorbed from
 * the Platform Overview page ADM-01 retires, since seats are the other thing
 * that quietly runs out.
 *
 * "Absorbed" is meant literally: this card renders the same `PlatformStatus`
 * record Settings → About prints, read through the same `usePlatformStatus()`
 * query and therefore the same cache entry. Seeding a second storage/licence
 * record for this page would put two different seat counts on two admin
 * screens, which is precisely the cross-screen disagreement this page exists
 * to end.
 *
 * The loading and error branches live *inside* the Panel, as they do on every
 * other widget in this page: outside it they would strip the card of its frame
 * and heading mid-load and leave a failure notice floating unattributed
 * beside the widgets that did load.
 */
export interface StorageUsageCardProps extends OverviewWidgetSurface {
  /** Undefined until the platform-status query lands; the envelope covers that. */
  platform: PlatformStatus | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

export function StorageUsageCard({
  platform,
  isLoading,
  isError,
  onRetry,
  menu,
  className,
}: StorageUsageCardProps) {
  return (
    <Panel
      title="Storage & usage"
      menu={menu}
      className={className}
      description={
        platform
          ? `${platform.license.plan} plan · renews ${formatDate(platform.license.renewsOn)}`
          : 'Storage and licence headroom.'
      }
      icon={HardDrive}
      tone="info"
      action={
        <Link
          to={routes.admin.settings('integrations')}
          className="inline-flex shrink-0 items-center gap-1 rounded-control text-caption font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          Manage
          <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.75} />
        </Link>
      }
    >
      <AsyncSection
        isLoading={isLoading}
        isError={isError}
        onRetry={onRetry}
        skeleton={<GaugesSkeleton />}
      >
        {platform ? <Gauges platform={platform} /> : null}
      </AsyncSection>
    </Panel>
  );
}

/**
 * Zero capacity has nothing to fill: read it as 0% rather than let the
 * division produce `NaN` and leak into `aria-valuenow` / `style="width"`.
 */
function safePercent(used: number, total: number): number {
  return total > 0 ? Math.round((used / total) * 100) : 0;
}

function Gauges({ platform }: { platform: PlatformStatus }) {
  const { system, license } = platform;
  const storagePercent = safePercent(system.storageUsedGb, system.storageTotalGb);
  const seatsPercent = safePercent(license.seatsUsed, license.seatsTotal);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Progress value={storagePercent} label="Storage" showValue />
        {/* The percentage alone cannot be planned against: 60% of 1 TB and 60%
            of 10 GB are different problems. */}
        <p className="mt-1 text-caption text-text-tertiary tabular-nums">
          {system.storageUsedGb} GB of {system.storageTotalGb} GB used
        </p>
      </div>
      <div>
        <Progress value={seatsPercent} label="Seats" showValue />
        <p className="mt-1 text-caption text-text-tertiary tabular-nums">
          {license.seatsUsed} of {license.seatsTotal} licensed seats
        </p>
      </div>
    </div>
  );
}

/** Two gauges in the rhythm the real ones use, so the body does not resize. */
function GaugesSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {['storage', 'seats'].map((gauge) => (
        <div key={gauge}>
          <Skeleton className="mb-1.5 h-5 w-full rounded-surface" />
          <Skeleton className="h-2 w-full rounded-pill" />
          <Skeleton className="mt-1 h-4 w-32 rounded-surface" />
        </div>
      ))}
    </div>
  );
}
