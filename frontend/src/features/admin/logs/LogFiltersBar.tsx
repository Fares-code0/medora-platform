import { useMemo } from 'react';
import type { ReactNode } from 'react';

import { Button, Input, SearchInput, Select, type SelectOption } from '@/components/ui';

import type { ActorRole } from '../appointments/oversight.types';

import {
  ACTOR_ROLE_LABEL,
  ALL_EVENT_TYPES,
  CATEGORY_LABEL,
  EMPTY_FILTERS,
  EVENT_TYPE_LABEL,
  SEVERITY_LABEL,
  TYPE_CATEGORY,
  activeFilterCount,
} from './logs';
import type { LogEventType, LogFilters, LogSeverity } from './logs.types';

/**
 * The filters bar (ADM-07 · UX §3.7).
 *
 * §3.7's six structured filters — date range, severity, event type, actor
 * role, actor, IP — over one `LogFilters` object, plus the free-text search.
 *
 * The bar holds no state of its own: every control writes the whole filter
 * object back through `onChange`, and the page decides what a filter change
 * means for the page number. That is what lets a pivot clicked in a table
 * cell and a change made here land in exactly the same place — and it is why
 * a pivoted filter is clearable from here rather than only by reloading.
 */

export interface LogFiltersBarProps {
  filters: LogFilters;
  /** Receives the whole next object; the page resets its page number on it. */
  onChange: (next: LogFilters) => void;
  /**
   * Every actor name in the log, not only those on the page in front of the
   * reader — `matchesFilters` compares the actor exactly, so the options have
   * to span the whole aggregate or the filter silently hides people.
   */
  actors: readonly string[];
  /**
   * Controls that act on the whole filter set rather than one field — saved
   * views and the export. They sit in this row because both are about *these*
   * filters: a view is one someone kept, and an export is the rows they
   * select. Passed in rather than rendered here so this bar stays a pure
   * function of `filters` and the page keeps the one wire to the service.
   */
  actions?: ReactNode;
}

interface TypedOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly group?: string;
}

/**
 * Narrows the raw string a `Select` hands back to the union its options were
 * declared with.
 *
 * The alternative is `value as LogSeverity | 'all'`, which typechecks against
 * whatever the options array happens to hold: a typo there would reach
 * `LogFilters` as a severity no event can carry, and the table would go empty
 * with nothing to explain it. Here the array's own type rejects the typo, and
 * the lookup keeps the value coming back out inside the union.
 */
export function chooseOption<T extends string>(
  options: readonly TypedOption<T>[],
  raw: string,
  fallback: T,
): T {
  return options.find((option) => option.value === raw)?.value ?? fallback;
}

const ROLE_OPTIONS: readonly TypedOption<ActorRole | 'all'>[] = [
  { value: 'all', label: 'All roles' },
  { value: 'patient', label: ACTOR_ROLE_LABEL.patient },
  { value: 'doctor', label: ACTOR_ROLE_LABEL.doctor },
  { value: 'administrator', label: ACTOR_ROLE_LABEL.administrator },
  { value: 'system', label: ACTOR_ROLE_LABEL.system },
];

const SEVERITY_OPTIONS: readonly TypedOption<LogSeverity | 'all'>[] = [
  { value: 'all', label: 'All severities' },
  { value: 'info', label: SEVERITY_LABEL.info },
  { value: 'warning', label: SEVERITY_LABEL.warning },
  { value: 'critical', label: SEVERITY_LABEL.critical },
];

/**
 * Grouped under §3.7's five category headings — `ALL_EVENT_TYPES` is already
 * written in category order, which is what the `Select`'s grouping needs.
 * Thirty-six flat entries is a list an investigator scrolls past rather than
 * reads.
 */
const TYPE_OPTIONS: readonly TypedOption<LogEventType | 'all'>[] = [
  { value: 'all', label: 'All event types' },
  ...ALL_EVENT_TYPES.map((type) => ({
    value: type,
    label: EVENT_TYPE_LABEL[type],
    group: CATEGORY_LABEL[TYPE_CATEGORY[type]],
  })),
];

export function LogFiltersBar({ filters, onChange, actors, actions }: LogFiltersBarProps) {
  const active = activeFilterCount(filters);
  const set = (patch: Partial<LogFilters>) => onChange({ ...filters, ...patch });

  const actorOptions = useMemo<readonly SelectOption[]>(() => {
    /*
     * A pivot can set an actor before the name list has arrived — and it is
     * the fastest way into this filter. The selected name is unioned in so
     * the trigger always states who is being filtered to, rather than falling
     * back to the placeholder and reading as no filter at all.
     */
    const names =
      filters.actor === 'all' || actors.includes(filters.actor)
        ? actors
        : [...actors, filters.actor].sort((a, b) => a.localeCompare(b));
    return [
      { value: 'all', label: 'All actors' },
      ...names.map((name) => ({ value: name, label: name })),
    ];
  }, [actors, filters.actor]);

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="sm:flex-1">
          <SearchInput
            value={filters.query}
            onChange={(event) => set({ query: event.target.value })}
            onClear={() => set({ query: '' })}
            placeholder="Search actor, event or summary"
            aria-label="Search log events"
          />
        </div>
        {/*
         * Every filter has to be removable from here, including one that
         * arrived from a table cell: an investigator who pivoted into a dead
         * end and cannot get out has lost the whole log, not one filter.
         */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Button variant="ghost" onClick={() => onChange(EMPTY_FILTERS)} disabled={active === 0}>
            {active === 0 ? 'Clear filters' : `Clear filters (${String(active)})`}
          </Button>
          {actions}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Select
          label="Actor role"
          options={ROLE_OPTIONS}
          value={filters.actorRole}
          onChange={(value) => set({ actorRole: chooseOption(ROLE_OPTIONS, value, 'all') })}
        />
        {/* Free-form names, so nothing to narrow — `LogFilters.actor` is a string. */}
        <Select
          label="Actor"
          options={actorOptions}
          value={filters.actor}
          onChange={(value) => set({ actor: value })}
        />
        <Select
          label="Event type"
          options={TYPE_OPTIONS}
          value={filters.type}
          onChange={(value) => set({ type: chooseOption(TYPE_OPTIONS, value, 'all') })}
        />
        <Select
          label="Severity"
          options={SEVERITY_OPTIONS}
          value={filters.severity}
          onChange={(value) => set({ severity: chooseOption(SEVERITY_OPTIONS, value, 'all') })}
        />
        <Input
          type="datetime-local"
          label="From"
          value={filters.from}
          onChange={(event) => set({ from: event.target.value })}
        />
        <Input
          type="datetime-local"
          label="To"
          value={filters.to}
          onChange={(event) => set({ to: event.target.value })}
        />
        <Input
          label="IP address"
          value={filters.ip}
          onChange={(event) => set({ ip: event.target.value })}
          // Matched as a substring, so a prefix narrows to a subnet.
          placeholder="203.0.113"
          inputMode="numeric"
        />
      </div>
    </div>
  );
}
