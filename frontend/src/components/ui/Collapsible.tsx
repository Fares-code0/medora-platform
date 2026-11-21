import { useId } from 'react';
import type { ReactNode } from 'react';

import { ChevronDown } from 'lucide-react';

import { cn } from '@/utils/cn';

/**
 * Collapsible — a titled disclosure section (DS §9.4: "height auto-animate
 * 200ms ease-out with content fade").
 *
 * Controlled, like Tabs: it holds no state and knows nothing about storage,
 * so a caller decides whether the choice persists.
 *
 * A closed section must read as *closed*, never as absent or broken, so the
 * header is an always-visible bordered surface carrying the title, an
 * optional caption naming the contents, and an optional summary advertising
 * how much is inside.
 *
 * Height animates through `grid-template-rows: 0fr -> 1fr` rather than
 * Framer, for a reason: Framer's `reducedMotion: "always"` still runs height
 * animations, while globals.css already collapses every CSS transition for
 * both `prefers-reduced-motion` and the app's own reduce-motion switch.
 *
 * Closed content stays mounted (opening is instant, nothing refires) but is
 * `visibility: hidden`, which takes it out of both the tab order and the
 * accessibility tree. Anything a doctor must not miss therefore belongs
 * outside a Collapsible — see FRONTEND_CHECKLIST §10.6.
 */
export interface CollapsibleProps {
  /** Stable id; the panel derives its DOM id from it. */
  id: string;
  title: string;
  /** Names what is inside. Stays visible when closed. */
  caption?: string | undefined;
  /** How much is inside, e.g. "2 charts". Stays visible when closed. */
  summary?: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Heading element, h2 by default; never skip levels (DS §3.4). */
  headingAs?: 'h2' | 'h3' | 'h4';
  className?: string;
  children: ReactNode;
}

export function Collapsible({
  id,
  title,
  caption,
  summary,
  open,
  onOpenChange,
  headingAs: Heading = 'h2',
  className,
  children,
}: CollapsibleProps) {
  const baseId = useId();
  const panelId = `${baseId}-${id}-panel`;
  const triggerId = `${baseId}-${id}-trigger`;

  return (
    <section className={cn('rounded-surface border border-border bg-surface', className)}>
      <Heading>
        <button
          type="button"
          id={triggerId}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => {
            onOpenChange(!open);
          }}
          className={cn(
            'flex w-full items-center gap-3 rounded-surface px-4 py-3 text-start',
            'transition-colors duration-fast ease-out hover:bg-surface-sunken',
          )}
        >
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'size-5 shrink-0 text-text-secondary',
              'transition-transform duration-popover ease-emphasized',
              open ? 'rotate-0' : '-rotate-90',
            )}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-h5 font-semibold text-text-primary">{title}</span>
            {caption ? (
              <span className="mt-0.5 block text-body-sm text-text-secondary">{caption}</span>
            ) : null}
          </span>
          {summary ? (
            <span className="shrink-0 rounded-pill bg-surface-sunken px-2 py-0.5 text-caption font-medium text-text-secondary tabular-nums">
              {summary}
            </span>
          ) : null}
        </button>
      </Heading>

      <div
        data-collapsible-panel
        data-state={open ? 'open' : 'closed'}
        className={cn(
          'grid transition-[grid-template-rows,opacity,visibility] duration-panel ease-emphasized',
          open ? 'visible grid-rows-[1fr] opacity-100' : 'invisible grid-rows-[0fr] opacity-0',
        )}
      >
        <div id={panelId} role="region" aria-labelledby={triggerId} className="overflow-hidden">
          <div className="px-4 pb-4 pt-1">{children}</div>
        </div>
      </div>
    </section>
  );
}
