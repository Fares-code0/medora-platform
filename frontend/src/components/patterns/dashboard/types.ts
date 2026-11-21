import type { ComponentType } from 'react';

import type { LucideIcon } from 'lucide-react';

import type { MenuEntry } from '@/components/ui/Dropdown';

/**
 * The customizable-dashboard contract, shared by every role's Overview.
 *
 * A dashboard is a catalogue of widgets (what *could* be shown) and a
 * selection (what this user chose to show, in their order). The two are
 * separate concepts: a widget is available exactly when its id is not in the
 * selection. The layout, the customize drawer and the empty state are all
 * driven from these types, so a role's dashboard supplies its catalogue and
 * its widgets' data and nothing else.
 *
 * The Doctor Overview established the pattern (PR #35); these are its types,
 * lifted out of the doctor feature when the Admin Overview adopted it, since
 * one feature may not import another (FRONTEND_ARCHITECTURE §3.4).
 */

/**
 * How much room a widget wants. Not a column count: the layout treats it as a
 * preferred width plus a share of whatever space a row has left over, so a
 * row always fills edge to edge whatever mix of sizes lands in it.
 *
 *   compact  — a single figure (a metric)
 *   standard — a short list, a small chart, a panel of actions
 *   wide     — a timeline or a chart that needs horizontal room
 */
export type DashboardWidgetSize = 'compact' | 'standard' | 'wide';

/**
 * Where a widget's content comes from in this build — the drawer renders its
 * "Sample data" and "Not available yet" markers from it, so neither can sit
 * beside a real figure. A catalogue that makes no such claim omits it.
 *
 *   sample      — seeded figures (a demo build's mock adapter)
 *   server      — figures the API returned
 *   unavailable — the API has no source for it yet
 *   none        — no data at all, only links into real flows
 */
export type DashboardWidgetSource = 'sample' | 'server' | 'unavailable' | 'none';

/** What the dashboard hands every widget, on top of the widget's own data. */
export interface DashboardWidgetChrome {
  /** The widget's ⋯ menu — at minimum "Remove from dashboard". */
  readonly menu: readonly MenuEntry[];
  readonly className?: string | undefined;
}

/** A drawer section. `tone` tints the icon chip of every widget in it. */
export interface DashboardWidgetGroupDefinition<TGroup extends string = string> {
  readonly id: TGroup;
  readonly label: string;
  /** Icon-chip classes, e.g. `bg-primary-subtle text-primary`. */
  readonly tone: string;
}

export interface DashboardWidgetDefinition<
  TId extends string = string,
  TGroup extends string = string,
  TProps extends object = object,
> {
  readonly id: TId;
  /** Must match the title the widget renders (and its ⋯ menu's label). */
  readonly title: string;
  /** One line for the customize drawer. */
  readonly description: string;
  readonly icon: LucideIcon;
  readonly size: DashboardWidgetSize;
  readonly group: TGroup;
  readonly source?: DashboardWidgetSource | undefined;
  readonly component: ComponentType<TProps & DashboardWidgetChrome>;
}
