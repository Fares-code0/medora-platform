import { type LucideIcon } from 'lucide-react';

import { Skeleton } from '@/components/feedback/Skeleton';
import { cn } from '@/utils/cn';

import { type StatisticTone } from './StatisticCard';

/**
 * MetricStrip — a single horizontal summary band (one bordered surface,
 * hairline-divided cells) as a compact alternative to a grid of KPI
 * cards. Used by registry-style pages (Patients, Appointments,
 * Notifications) where the table or calendar is the hero and metrics are
 * supporting context.
 */
export interface MetricStripItem {
  readonly id: string;
  readonly label: string;
  /** Pre-formatted value — formatting is the caller's job. */
  readonly value: string;
  readonly icon?: LucideIcon | undefined;
  readonly tone?: StatisticTone | undefined;
}

const TONE_TEXT: Record<StatisticTone, string> = {
  primary: 'text-primary',
  secondary: 'text-secondary',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
  info: 'text-info',
  ai: 'text-accent',
  neutral: 'text-text-tertiary',
};

export interface MetricStripProps {
  items: readonly MetricStripItem[];
  loading?: boolean;
  className?: string | undefined;
}

export function MetricStrip({ items, loading = false, className }: MetricStripProps) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-px overflow-hidden rounded-surface border border-border bg-border md:grid-cols-3',
        items.length >= 6 ? 'xl:grid-cols-6' : items.length === 5 ? 'xl:grid-cols-5' : null,
        className,
      )}
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div key={item.id} className="flex items-center gap-2.5 bg-surface px-3.5 py-2.5">
            {Icon ? (
              <Icon
                aria-hidden="true"
                className={cn('h-4 w-4 shrink-0', TONE_TEXT[item.tone ?? 'neutral'])}
                strokeWidth={1.75}
              />
            ) : null}
            <div className="min-w-0">
              <p className="truncate text-caption font-medium text-text-tertiary">{item.label}</p>
              {loading ? (
                <Skeleton className="mt-1 h-4 w-10" />
              ) : (
                <p className="text-h4 font-bold text-text-primary tabular-nums">{item.value}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
