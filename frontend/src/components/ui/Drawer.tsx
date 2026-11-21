import { useId } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import { AnimatePresence, m } from 'framer-motion';
import { X } from 'lucide-react';

import { useIsRtl, useT } from '@/i18n';
import { EASE_EMPHASIZED, motionTokens } from '@/styles/motion';
import { cn } from '@/utils/cn';

import { useModalDialog } from './internal/useModalDialog';

/**
 * Drawer — DS §8.15.
 * Right-side panel for context-preserving detail (record drawers, filters,
 * notifications). Widths 400/480/640; full-width below sm. Built on native
 * <dialog> for focus trapping and inert background. Use a drawer when the
 * page context must stay visible; a modal when the task is self-contained.
 *
 * Two variants:
 * - `edge` (default) is attached to the viewport's end edge and slides over
 *   600ms (`--duration-panel`).
 * - `floating` stands off the viewport by 12px (16px from sm) on the end,
 *   top and bottom, with every corner rounded, on a translucent blurred
 *   surface drawn from the theme's own overlay colour. It slides and fades
 *   over 700ms (`--duration-expand`). For a panel that configures the page
 *   behind it — the dashboard's Customize — so the page reads as still
 *   there.
 *
 * Both play their exit before the dialog closes (`useModalDialog`), so
 * closing is as smooth as opening.
 */
const SIZES = { sm: 'sm:max-w-[400px]', md: 'sm:max-w-[480px]', lg: 'sm:max-w-[640px]' } as const;
/** The floating panel keeps its width; the dialog grows by its 16px gutters. */
const FLOATING_SIZES = {
  sm: 'sm:max-w-[432px]',
  md: 'sm:max-w-[512px]',
  lg: 'sm:max-w-[672px]',
} as const;

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  size?: keyof typeof SIZES;
  variant?: 'edge' | 'floating';
  footer?: ReactNode;
  children: ReactNode;
}

export function Drawer({
  open,
  onClose,
  title,
  size = 'md',
  variant = 'edge',
  footer,
  children,
}: DrawerProps) {
  const t = useT();
  const rtl = useIsRtl();
  const titleId = useId();
  const { dialogRef, closing, onExitComplete } = useModalDialog(open, onClose);
  const floating = variant === 'floating';
  const duration = floating ? motionTokens.duration.expand : motionTokens.duration.panel;
  // `x` is a physical transform, which `dir` does not mirror: the panel
  // enters from whichever side the end edge is on.
  const offstage = floating
    ? rtl
      ? 'calc(-100% - 24px)'
      : 'calc(100% + 24px)'
    : rtl
      ? '-100%'
      : '100%';
  const transition = { duration, ease: EASE_EMPHASIZED };

  return (
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-labelledby={titleId}
      data-motion=""
      data-closing={closing ? '' : undefined}
      style={{ '--dialog-motion': `${String(duration * 1000)}ms` } as CSSProperties}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
      className={cn(
        // overflow-hidden: the panel slides past the dialog's edge on its way
        // in and out, which would otherwise draw a scrollbar for the trip.
        'fixed m-0 h-dvh max-h-dvh w-full max-w-full overflow-hidden bg-transparent backdrop:bg-scrim',
        // Pinned to the end edge.
        'start-auto end-0',
        floating ? cn('p-3 sm:p-4', FLOATING_SIZES[size]) : cn('p-0', SIZES[size]),
      )}
    >
      <AnimatePresence onExitComplete={onExitComplete}>
        {open ? (
          <m.div
            key="drawer-panel"
            initial={{ x: offstage, opacity: floating ? 0 : 1 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: offstage, opacity: floating ? 0 : 1 }}
            transition={transition}
            data-drawer-variant={variant}
            className={cn(
              'flex h-full flex-col',
              floating
                ? cn(
                    'overflow-hidden rounded-surface border border-border shadow-modal',
                    // A dark glass in the dark theme, a frosted one in the
                    // light: the theme's own overlay colour, kept mostly
                    // opaque so the text never fights the page beneath.
                    'bg-[color-mix(in_srgb,var(--color-surface-overlay)_88%,transparent)] backdrop-blur-xl',
                  )
                : // The attached edge keeps radius 0.
                  'rounded-s-surface bg-surface-overlay shadow-modal',
            )}
          >
            <div className="flex items-start justify-between gap-4 border-b border-border p-6">
              <h2 id={titleId} className="text-h4 font-semibold text-text-primary">
                {title}
              </h2>
              <button
                type="button"
                aria-label={t('ui.closePanel')}
                onClick={onClose}
                className="touch-target rounded-surface p-1 text-text-tertiary transition-colors duration-base [--touch-x:8px] [--touch-y:8px] hover:text-text-primary"
              >
                <X aria-hidden="true" className="h-5 w-5" strokeWidth={1.75} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">{children}</div>
            {footer ? (
              <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
                {footer}
              </div>
            ) : null}
          </m.div>
        ) : null}
      </AnimatePresence>
    </dialog>
  );
}
