import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Radio, type LucideIcon } from 'lucide-react';

import { Skeleton } from '@/components/feedback';
import { StatisticCard, WidgetMenu, type StatisticTone } from '@/components/patterns';
import { cn } from '@/utils/cn';

import { AsyncSection } from '../components/primitives';

import type { OverviewWidgetSurface } from './overview.types';

/**
 * §3.1's four headline figures as four dashboard widgets, so an administrator
 * keeps the figures they use and drops the rest. They were one fixed KPI row.
 *
 * Each tile owns its own loading and error state, because the row's envelope
 * no longer exists to own them. Doctors, patients and appointments are read
 * off the ADM-02/04/05 documents and stand down together — each to its own
 * skeleton, never to a zero, since "0 doctors, 0 patients" is exactly the
 * fresh-deployment picture and reads as "the platform is idle" when it is
 * merely slow. The live count comes from its own poll and has its own
 * placeholder, so a doctors outage cannot take it down (§3.1: these widgets do
 * not wait on each other).
 *
 * While a tile loads or has failed it keeps its label and its ⋯ menu, as every
 * Panel on this page keeps its heading: a widget that lost its frame mid-load
 * would leave a failure notice nobody could attribute, and one that lost its
 * menu could not be removed until its data arrived.
 */

interface MetricWidgetProps extends OverviewWidgetSurface {
  label: string;
  icon: LucideIcon;
  tone: StatisticTone;
}

interface DocumentMetricProps extends MetricWidgetProps {
  value: number;
  hint: string;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

/*
 * Fill the card, top to bottom — the treatment the Doctor Overview's metric
 * widgets use. The layout gives every widget in a row the row's height, and a
 * tile often shares a row with a list three times its natural height; left
 * top-aligned, the figure sat over an empty card. Growing the card's body and
 * pushing the hint to its bottom edge keeps the label and figure at the top
 * and settles the hint at the bottom, so a tall tile reads as a tile, not a
 * gap. At its natural height the two simply meet.
 */
const FILL_ROW =
  'flex flex-col [&>div]:flex-1 [&>div>div]:h-full [&>div>div>:last-child]:mt-auto';

function menuFor(label: string, menu: OverviewWidgetSurface['menu']): ReactNode {
  return menu ? <WidgetMenu title={label} entries={menu} /> : undefined;
}

/** A document-derived tile: Total doctors, Total patients, Appointments today. */
export function DocumentMetric({
  label,
  icon,
  tone,
  value,
  hint,
  isLoading,
  isError,
  onRetry,
  menu,
  className,
}: DocumentMetricProps) {
  /*
   * One card for every state. The shell, its label row and the ⋯ menu stay at
   * the same place in the tree, so the menu's open state survives data landing;
   * only the body underneath swaps between skeleton, error and figure.
   */
  const pending = isLoading || isError;
  return (
    <StatisticCard
      layout="stacked"
      size="lg"
      labelVoice="overline"
      label={label}
      value={value}
      icon={pending ? undefined : icon}
      tone={tone}
      hint={hint}
      action={menuFor(label, menu)}
      busy={isLoading}
      body={
        pending ? (
          <AsyncSection
            isLoading={isLoading}
            isError={isError}
            onRetry={onRetry}
            skeleton={<FigureSkeleton />}
          >
            {null}
          </AsyncSection>
        ) : undefined
      }
      className={cn(FILL_ROW, className)}
    />
  );
}

/** A figure's worth of placeholder, in the rhythm the loaded tile uses. */
function FigureSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-8 w-24 rounded-surface" />
      <Skeleton className="h-4 w-36 rounded-surface" />
    </div>
  );
}

/**
 * One half of the crossfade, matched to the `duration-slow` token below.
 * Exported so the covering test waits exactly one fade instead of guessing.
 */
export const ACTIVE_USERS_FADE_MS = 250;

/**
 * Holds the displayed count one fade behind the polled one, so the value on
 * screen is only ever swapped while the element is transparent.
 */
function useFadedValue(value: number | undefined): { shown: number | undefined; visible: boolean } {
  const [shown, setShown] = useState(value);
  const [visible, setVisible] = useState(true);
  // The value the fade is heading towards — not `shown`, which lags it, and
  // not a dependency, which would restart the fade on every render.
  const target = useRef(value);

  useEffect(() => {
    if (value === target.current) return undefined;
    target.current = value;
    setVisible(false);
    const timer = setTimeout(() => {
      setShown(value);
      setVisible(true);
    }, ACTIVE_USERS_FADE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [value]);

  return { shown, visible };
}

/**
 * Active users is the only live value on the page. §3.1 asks for a fade on
 * change and explicitly forbids a count-up, so a poll that returns a new
 * number fades the old one out, swaps it while it is invisible, and fades the
 * new one in — the digits never tick. The faded element is deliberately
 * *stable* across the swap: keying it on the value would remount it, and a
 * fresh node starts opaque, so there would be nothing to transition from.
 *
 * Only the figure fades, not the card: the tile's ⋯ menu sits in the same
 * card, and a control that blinks out every fifteen seconds — possibly with
 * its menu open — is not one anybody can use.
 *
 * Reduced motion needs no `motion-reduce:` variant here. `styles/globals.css`
 * collapses every transition to 0.01ms both for `prefers-reduced-motion` and
 * for the app's own `html[data-reduce-motion='on']` switch — and the Tailwind
 * variant only ever knew about the first of those two.
 */
export function ActiveUsersMetric({
  activeUsers,
  menu,
  className,
}: { activeUsers: number | undefined } & OverviewWidgetSurface) {
  const { shown, visible } = useFadedValue(activeUsers);
  const label = 'Active users now';

  return (
    <StatisticCard
      layout="stacked"
      size="lg"
      labelVoice="overline"
      label={label}
      value={
        <span
          className={cn(
            'transition-opacity duration-slow ease-in-out',
            visible ? 'opacity-100' : 'opacity-0',
          )}
        >
          {/* A dash, not a zero: an unarrived count must not read as "nobody is here". */}
          {shown ?? '—'}
        </span>
      }
      icon={Radio}
      tone="ai"
      hint="Live · updates every 15s"
      action={menuFor(label, menu)}
      className={cn(FILL_ROW, className)}
    />
  );
}
