import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Drawer } from '@/components/ui/Drawer';

import type { DashboardWidgetDefinition, DashboardWidgetGroupDefinition } from './types';

/**
 * Customize dashboard — the catalogue, one checkbox per widget. Shared by the Doctor
 * and Admin Overviews; each passes its own catalogue and groups.
 *
 * The drawer edits a draft, not the dashboard (`useDashboardEditor`): ticking
 * a widget changes what is checked here and nothing behind the scrim. Done is
 * the only control that applies the selection; Cancel, the close button,
 * Escape and a click on the scrim all discard it. That is why these are
 * Checkboxes rather than Switches — DS §8.7: a switch applies immediately,
 * and a checkbox is the control when a save action follows.
 *
 * A Drawer rather than a Modal because the page should stay in view while the
 * user decides (DS §8.15) — it shows what is saved until they choose Done.
 *
 * One list, not an "Available" list and an "Active" list. Each widget appears
 * exactly once, and its checkbox is the whole of its state. Two lists would
 * move a row out from under the keyboard focus on every toggle, sending a
 * user adding five widgets back up the drawer five times.
 */

/** What the drawer reads of a catalogue entry — never the component itself. */
export type DashboardWidgetOption<TId extends string, TGroup extends string> = Pick<
  DashboardWidgetDefinition<TId, TGroup>,
  'id' | 'title' | 'description' | 'icon' | 'group' | 'source'
>;

export interface CustomizeDashboardDrawerProps<TId extends string, TGroup extends string> {
  readonly open: boolean;
  /** Cancel, the close button, Escape, the scrim: discard the draft. */
  readonly onClose: () => void;
  /** Done: apply the draft to the dashboard. The only control that does. */
  readonly onDone: () => void;
  /** Every widget the role may place, in catalogue order. */
  readonly widgets: readonly DashboardWidgetOption<TId, TGroup>[];
  /** Drawer sections, in the order they are shown. */
  readonly groups: readonly DashboardWidgetGroupDefinition<TGroup>[];
  /** Whether a widget is checked in the draft. */
  readonly isActive: (id: TId) => boolean;
  /** Widgets checked in the draft. */
  readonly activeCount: number;
  /** A checkbox changed — edits the draft. */
  readonly onToggle: (id: TId, active: boolean) => void;
  /** "Remove all" — unchecks everything in the draft. */
  readonly onClear: () => void;
}

function WidgetOption<TId extends string, TGroup extends string>({
  widget,
  tone,
  active,
  onToggle,
}: {
  widget: DashboardWidgetOption<TId, TGroup>;
  tone: string;
  active: boolean;
  onToggle: (id: TId, active: boolean) => void;
}) {
  const Icon = widget.icon;
  const controlId = `dashboard-widget-${widget.id}`;

  return (
    <li className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-surface ${tone}`}
      >
        <Icon className="h-4 w-4" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <label
          htmlFor={controlId}
          className="block cursor-pointer text-body-sm font-medium text-text-primary"
        >
          {widget.title}
        </label>
        <p className="mt-0.5 text-caption text-text-secondary">{widget.description}</p>
        {widget.source === 'sample' ? (
          <Badge variant="neutral" className="mt-1.5">
            Sample data
          </Badge>
        ) : widget.source === 'unavailable' ? (
          <Badge variant="neutral" className="mt-1.5">
            Not available yet
          </Badge>
        ) : null}
      </div>
      {/* Named by the title label above (htmlFor), so it has no label of its own. */}
      <Checkbox
        id={controlId}
        checked={active}
        onChange={(event) => {
          onToggle(widget.id, event.currentTarget.checked);
        }}
        containerClassName="mt-1"
      />
    </li>
  );
}

export function CustomizeDashboardDrawer<TId extends string, TGroup extends string>({
  open,
  onClose,
  onDone,
  widgets,
  groups,
  isActive,
  activeCount,
  onToggle,
  onClear,
}: CustomizeDashboardDrawerProps<TId, TGroup>) {
  const total = widgets.length;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Customize dashboard"
      // Floats clear of the viewport edges on a glass surface and fades in
      // place (150ms, no slide): it configures the page behind it, which
      // stays in view.
      variant="floating"
      footer={
        <>
          <Button variant="ghost" onClick={onClear} disabled={activeCount === 0}>
            Remove all
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onDone}>Done</Button>
        </>
      }
    >
      <p className="text-body-sm text-text-secondary">
        Choose what appears on your Overview. Your dashboard updates when you select Done, and the
        layout rearranges itself around whatever you pick.
      </p>
      {/* Announced as the count changes, so a screen reader hears each toggle land. */}
      <p aria-live="polite" className="mt-3 text-caption font-medium text-text-secondary">
        {`${String(activeCount)} of ${String(total)} widgets selected`}
      </p>

      <div className="mt-6 flex flex-col gap-6">
        {groups.map((group) => {
          const members = widgets.filter((widget) => widget.group === group.id);
          const headingId = `dashboard-widget-group-${group.id}`;
          return (
            <section key={group.id} aria-labelledby={headingId}>
              <h3
                id={headingId}
                className="mb-3 text-caption font-semibold uppercase tracking-wider text-text-secondary"
              >
                {group.label}
              </h3>
              <ul className="flex flex-col divide-y divide-border">
                {members.map((widget) => (
                  <WidgetOption
                    key={widget.id}
                    widget={widget}
                    tone={group.tone}
                    active={isActive(widget.id)}
                    onToggle={onToggle}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </Drawer>
  );
}
