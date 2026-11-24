import { useEffect, useRef } from 'react';

import { EyeOff } from 'lucide-react';

import { useT } from '@/i18n';

import { Reveal } from '../Reveal';

import type { DashboardWidgetDefinition, DashboardWidgetSize } from './types';

/**
 * Lays out whatever the user selected — one widget or the whole catalogue,
 * in any mix of sizes — without a hole, an overlap or a predetermined
 * arrangement. Shared by the Doctor and Admin Overviews; each binds it to its
 * own catalogue and hands its widgets their data through `widgetProps`.
 *
 * ── Why flex-wrap, not a column grid ────────────────────────────────
 * A column grid places items into cells, and a cell nobody fills is a hole:
 * remove one card from a 3-up row and the gap stays. Packing around that
 * needs either `grid-flow-dense`, which reorders cards away from the order
 * the user chose (and from DOM order, which is what a screen reader and the
 * Tab key follow), or a layout engine. Flex-wrap needs neither. Each widget
 * asks for a preferred width (`basis`) and a share of the leftover space
 * (`grow`); a row takes widgets until the next would not fit, then the row's
 * widgets split its remaining width between them. Every row therefore ends
 * flush at the right edge by construction, whatever is in it, and order is
 * always the user's.
 *
 *   one widget       → the full width
 *   two              → side by side, split by weight, or stacked if they
 *                      cannot both reach their preferred width
 *   any more         → as many per row as fit, the rest wrapping below
 *
 * The bases are in rem, so the layout reflows with the interface's text-scale
 * setting the way the rest of the product does.
 *
 * ── Breakpoints ─────────────────────────────────────────────────────
 * Below `md` every widget takes its own row: a phone gets one column, never a
 * desktop row shrunk. From `md` the bases decide. Measured against the shell
 * (no sidebar below `lg`, a 224px one from `lg`, PageContainer's gutters):
 * at a 768px tablet three metrics or two standard widgets share a row; at a
 * 1280px laptop four metrics, three standard widgets, or a wide widget beside
 * a standard one.
 *
 * Widgets in one row share its height (flex stretch) and the card fills it,
 * so neighbours line up along the bottom as well as the top.
 */
const SIZE_CLASSES: Record<DashboardWidgetSize, string> = {
  compact: 'md:basis-56 md:grow',
  standard: 'md:basis-80 md:grow-[2]',
  wide: 'md:basis-[32rem] md:grow-[3]',
};

export interface DashboardWidgetGridProps<TId extends string, TProps extends object> {
  readonly activeIds: readonly TId[];
  /** The catalogue lookup — total over the ids the selection can hold. */
  readonly getWidget: (id: TId) => DashboardWidgetDefinition<TId, string, TProps>;
  readonly onRemove: (id: TId) => void;
  /** The dashboard's data, handed to every widget alongside its menu. */
  readonly widgetProps: TProps;
}

export function DashboardWidgetGrid<TId extends string, TProps extends object>({
  activeIds,
  getWidget,
  onRemove,
  widgetProps,
}: DashboardWidgetGridProps<TId, TProps>) {
  const t = useT();
  /*
   * Widgets on screen at first paint enter as one staggered sequence; a widget
   * added later — including one removed and put back — enters on its own, at
   * once, instead of waiting out a delay computed from its position at the end
   * of the list. Emptied after the first commit; a Reveal reads its delay only
   * when it mounts, so the widgets already on screen are unaffected.
   */
  const firstPaint = useRef<ReadonlySet<TId>>(new Set(activeIds));
  useEffect(() => {
    firstPaint.current = new Set();
  }, []);

  return (
    <ul aria-label={t('dashboard.widgets')} className="flex flex-wrap gap-4">
      {activeIds.map((id, position) => {
        const widget = getWidget(id);
        const Widget = widget.component;
        return (
          <li
            key={id}
            data-widget-id={id}
            data-widget-size={widget.size}
            className={`flex min-w-0 shrink basis-full grow ${SIZE_CLASSES[widget.size]}`}
          >
            <Reveal
              index={firstPaint.current.has(id) ? position : 0}
              className="flex w-full min-w-0"
            >
              <Widget
                {...widgetProps}
                className="w-full"
                menu={[
                  {
                    id: 'remove',
                    label: 'Remove from dashboard',
                    icon: EyeOff,
                    onSelect: () => {
                      onRemove(id);
                    },
                  },
                ]}
              />
            </Reveal>
          </li>
        );
      })}
    </ul>
  );
}
