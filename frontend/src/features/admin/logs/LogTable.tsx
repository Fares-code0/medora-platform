import { useCallback, useEffect, useRef, useState } from 'react';

import { MoreHorizontal, ScrollText } from 'lucide-react';

import { Skeleton } from '@/components/feedback';
import { Badge, IconButton } from '@/components/ui';
import { cn } from '@/utils/cn';

import { AsyncSection, Overline, Panel } from '../components/primitives';

import {
  ACTOR_ROLE_LABEL,
  EVENT_TYPE_LABEL,
  SEVERITY_LABEL,
  SEVERITY_VARIANT,
  formatTimestamp,
  type PivotField,
} from './logs';
import type { LogEvent } from './logs.types';

/**
 * The investigation table (ADM-07 · UX §3.7).
 *
 * A plain `<table>` rather than the shared `DataTable`: a critical row is
 * tinted as a whole row, and three of its cells host pivot buttons — neither
 * of which a per-cell `cell(row)` contract can express. (It said `DataGrid`
 * until Wave 2c-b consolidated the two engines; the reasoning is unchanged,
 * because `DataTable` has no row-level styling hook either. Giving it one is
 * tracked as the `rowTone` proposal, deliberately out of 2c-b's scope.)
 *
 * The async envelope sits *inside* the panel, the shape every ADM-01 widget
 * settled on, so the table keeps its heading and frame while it loads or
 * fails instead of vanishing from the page.
 *
 * Nothing here writes. §3.7 makes the log read-only for everyone including
 * administrators, so the only per-row control is the one that opens the
 * detail drawer — and `logsApi` exposes no mutation on an event to wire an
 * edit to even if someone added the button.
 */

export interface LogTableProps {
  rows: readonly LogEvent[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  /** Sets one filter from a value in a row — see `pivotOn`. */
  onPivot: (field: PivotField, value: string) => void;
  onOpen: (event: LogEvent) => void;
}

/** §3.7's columns, in order. The `⋯` column is labelled separately below. */
const COLUMNS: readonly string[] = [
  'Timestamp',
  'Severity',
  'Actor',
  'Event',
  'Summary',
  'IP / device',
];

/** Rendered wherever a source carries no value — never a blank cell. */
const NONE = '—';

/**
 * A value in a row that the investigator can follow. Clicking it narrows the
 * table to that actor / event type / address, which is the difference between
 * a table you read and one you investigate with.
 */
function PivotButton({
  field,
  value,
  label,
  children,
  onPivot,
  className,
}: {
  field: PivotField;
  value: string;
  label: string;
  children: string;
  onPivot: (field: PivotField, value: string) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => onPivot(field, value)}
      className={cn(
        'max-w-full truncate rounded text-start underline decoration-border-strong decoration-dotted underline-offset-2',
        'transition-colors duration-fast hover:text-primary hover:decoration-primary',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
        className,
      )}
    >
      {children}
    </button>
  );
}

/** A run of rows rather than the primitive's blocks — this panel is a table. */
function TableSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 8 }, (_, index) => (
        <Skeleton key={index} className="h-9 w-full rounded-surface" />
      ))}
    </div>
  );
}

/** Names the scroller while it is a keyboard-operable region. */
const SCROLL_REGION_LABEL = 'System log events, scrolls horizontally';

export function LogTable({ rows, isLoading, isError, onRetry, onPivot, onOpen }: LogTableProps) {
  /*
   * Does the scroller actually scroll? Mirrors `DataTable`: re-measured when
   * the container or the table resizes, with 1px of slack for sub-pixel
   * rounding.
   */
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [scrollable, setScrollable] = useState(false);

  const measure = useCallback(() => {
    const node = scrollerRef.current;
    if (node === null) return;
    setScrollable(node.scrollWidth > node.clientWidth + 1);
  }, []);

  useEffect(() => {
    const node = scrollerRef.current;
    if (node === null) return;
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    const table = node.querySelector('table');
    if (table !== null) observer.observe(table);
    return () => observer.disconnect();
  });

  return (
    <Panel title="Event stream" icon={ScrollText} tone="primary">
      <AsyncSection
        isLoading={isLoading}
        isError={isError}
        onRetry={onRetry}
        skeleton={<TableSkeleton />}
      >
        {rows.length === 0 ? (
          <p className="py-10 text-center text-body-sm text-text-secondary">
            No events match — widen the time range or clear a filter.
          </p>
        ) : (
          <div
            ref={scrollerRef}
            /*
             * The shared `DataTable` contract: a focusable, named region only
             * while the columns actually overflow, so a wide screen gains no
             * tab stop that scrolls nothing.
             */
            {...(scrollable
              ? { tabIndex: 0, role: 'region' as const, 'aria-label': SCROLL_REGION_LABEL }
              : {})}
            className={cn(
              /*
               * `relative` is the fix, not decoration. The Detail header's
               * `sr-only` label is `position: absolute`, and an overflow
               * container only clips absolute descendants it is the
               * containing block for. Without it the label resolved against
               * the shell's `<main>`, sat at the table's far edge, and
               * widened the page to ~991px on phones and tablets while the
               * table itself was scrolling correctly.
               */
              'relative overflow-x-auto',
              scrollable && 'focus-visible:outline-none focus-visible:shadow-focus',
            )}
          >
            <table className="w-full border-collapse text-body-sm" aria-label="System log events">
              <thead>
                <tr className="border-b border-border">
                  {COLUMNS.map((column) => (
                    <th key={column} scope="col" className="px-3 py-2.5 text-start align-middle">
                      <Overline>{column}</Overline>
                    </th>
                  ))}
                  <th scope="col" className="w-12 px-3 py-2.5">
                    <span className="sr-only">Detail</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((event) => (
                  <tr
                    key={event.id}
                    className={cn(
                      'border-b border-border align-top last:border-b-0',
                      // A critical row is the one an investigator is scanning
                      // for; the severity badge alone puts it at the same
                      // visual weight as everything around it.
                      event.severity === 'critical' && 'bg-error-subtle',
                    )}
                  >
                    <td className="px-3 py-3">
                      <time
                        dateTime={event.at}
                        className="whitespace-nowrap font-mono text-caption tabular-nums text-text-secondary"
                      >
                        {formatTimestamp(event.at)}
                      </time>
                    </td>
                    <td className="px-3 py-3">
                      <Badge variant={SEVERITY_VARIANT[event.severity]} dot>
                        {SEVERITY_LABEL[event.severity]}
                      </Badge>
                    </td>
                    <td className="px-3 py-3">
                      <PivotButton
                        field="actor"
                        value={event.actor}
                        label={`Filter by actor ${event.actor}`}
                        onPivot={onPivot}
                        className="font-medium text-text-primary"
                      >
                        {event.actor}
                      </PivotButton>
                      <div className="mt-1">
                        <Badge>{ACTOR_ROLE_LABEL[event.actorRole]}</Badge>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <PivotButton
                        field="type"
                        // The taxonomy id, not the label: this value goes
                        // straight into `LogFilters.type`.
                        value={event.type}
                        label={`Filter by event type ${EVENT_TYPE_LABEL[event.type]}`}
                        onPivot={onPivot}
                        className="text-text-primary"
                      >
                        {EVENT_TYPE_LABEL[event.type]}
                      </PivotButton>
                      <div className="mt-0.5 text-caption text-text-primary">{event.target}</div>
                    </td>
                    <td className="min-w-[16rem] px-3 py-3 text-text-secondary">{event.summary}</td>
                    <td className="px-3 py-3">
                      {/*
                       * Two lines, each independently `—`. Only doctor
                       * sign-ins carry an address; the rest genuinely have
                       * none, and a blank cell there would read as a value
                       * that failed to load rather than one that never existed.
                       */}
                      {event.ip === null ? (
                        <span className="font-mono text-caption text-text-tertiary">{NONE}</span>
                      ) : (
                        <PivotButton
                          field="ip"
                          value={event.ip}
                          label={`Filter by IP ${event.ip}`}
                          onPivot={onPivot}
                          className="font-mono text-caption tabular-nums text-text-primary"
                        >
                          {event.ip}
                        </PivotButton>
                      )}
                      <div className="mt-0.5 text-caption text-text-tertiary">
                        <span>{event.device ?? NONE}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-end">
                      <IconButton
                        icon={MoreHorizontal}
                        variant="ghost"
                        size="sm"
                        aria-label={`View detail for ${EVENT_TYPE_LABEL[event.type]} at ${formatTimestamp(event.at)}`}
                        onClick={() => onOpen(event)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AsyncSection>
    </Panel>
  );
}
