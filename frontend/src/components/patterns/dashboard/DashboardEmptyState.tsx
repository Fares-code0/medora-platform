import type { ReactNode, Ref } from 'react';

import { LayoutDashboard } from 'lucide-react';

import { EmptyState } from '@/components/feedback/EmptyState';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils/cn';

import { DashboardWidgetAddIcon } from './DashboardWidgetAddIcon';

/**
 * What a customizable dashboard shows while nothing is selected: an
 * invitation to compose it, never a default set of widgets chosen on the
 * user's behalf. The copy is the role's; the frame and the customize control
 * are shared, so the Doctor and Admin Overviews open the same way.
 *
 * `customizeRef` reaches the button so the page can return focus to it after
 * the last widget is removed or the drawer closes (`useDashboardEditor`).
 */
export interface DashboardEmptyStateProps {
  title: string;
  description: string;
  onCustomize: () => void;
  customizeRef?: Ref<HTMLButtonElement> | undefined;
  /** A way straight to work beside the customize control, if the role has one. */
  secondaryAction?: ReactNode;
}

/*
 * The customize control's look follows the dashboard's CONTENT, never the
 * act of editing it: with no widgets on the dashboard it reads "Customize"
 * beside its icon; once at least one widget has been added (the saved
 * selection, not the drawer's draft) it is a square, icon-only button. Opening
 * the drawer, checking widgets in it, or closing it again changes nothing.
 *
 * The empty state only exists while nothing has been added, so its button is
 * always labelled — the controls beside it (Open appointments) never move.
 */

export function DashboardEmptyState({
  title,
  description,
  onCustomize,
  customizeRef,
  secondaryAction,
}: DashboardEmptyStateProps) {
  return (
    <section
      aria-label="Dashboard"
      // A card like every other on the page — a solid hairline and a soft
      // shadow — not a dashed placeholder outline.
      className="rounded-surface border border-border bg-surface shadow-popover"
    >
      <EmptyState
        icon={LayoutDashboard}
        tone="primary"
        title={title}
        description={description}
        className="max-w-[480px] py-16"
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button ref={customizeRef} leadingIcon={DashboardWidgetAddIcon} onClick={onCustomize}>
              Customize
            </Button>
            {secondaryAction}
          </div>
        }
      />
    </section>
  );
}

/**
 * The header's customize control, shown once the dashboard has widgets.
 *
 * `widgetCount` is how many widgets are on the dashboard — the saved
 * selection. At one or more the button is a square icon (the md control's
 * 32 × 32; on a coarse pointer it keeps that box and takes the icon button's
 * 44px touch gutter instead of widening); the word stays in it as
 * screen-reader text, so its accessible name is "Customize" either way. At
 * zero it reads "Customize" in full.
 */
export function CustomizeDashboardButton({
  onClick,
  buttonRef,
  widgetCount,
}: {
  onClick: () => void;
  buttonRef?: Ref<HTMLButtonElement> | undefined;
  widgetCount: number;
}) {
  const iconOnly = widgetCount > 0;
  return (
    <Button
      ref={buttonRef}
      variant="secondary"
      leadingIcon={DashboardWidgetAddIcon}
      onClick={onClick}
      className={cn(iconOnly && 'w-8 px-0 [--touch-x:6px] touch:min-w-0')}
    >
      <span className={cn(iconOnly && 'sr-only')}>Customize</span>
    </Button>
  );
}
