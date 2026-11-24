import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

import { AnimatePresence, m } from 'framer-motion';
import { Bell, CheckCheck } from 'lucide-react';
import { useLocation } from 'react-router-dom';

import { EmptyState, Skeleton } from '@/components/feedback';
import { Button, CountBadge, IconButton, LinkButton } from '@/components/ui';
import { useOutsideClick } from '@/hooks/useOutsideClick';
import { useIsRtl, useT } from '@/i18n';
import { cn } from '@/utils/cn';

import { useShellBadges, type ShellFeedItem } from '../badge-context';

import { PANEL_EDGE, computeAnchoredPanel, type AnchoredPanelPosition } from './anchored-panel';

/**
 * Notification bell — UX §1.2 navbar.
 * Bell + live unread badge opening the recent feed. Count and feed come
 * from the domain-free ShellBadgesContext, provided by the app layer from
 * the notifications feature (one shared query cache — reading anywhere
 * updates the badge here too). Tapping a row marks it read, the header
 * action marks everything read, and the role-aware footer links to the full
 * Notifications page where one exists.
 *
 * ── A popover, not a drawer ───────────────────────────────────────────
 * The feed used to open in the full-height right Drawer, a screen-tall
 * slab with a scrim that had no visual relationship to the bell that
 * opened it. It is now a compact panel that hangs from the bell itself:
 * aligned to it, with a caret pointing back at it, and dropping 6px into
 * place as it fades in (and lifting back out as it fades away). Geometry is
 * `computeAnchoredPanel`, which keeps it inside the viewport at every width.
 *
 * Non-modal, like the avatar menu beside it: the page stays interactive,
 * and a click outside, Escape, or tabbing away closes it. Escape returns
 * focus to the bell.
 */

/** Enter: a short ease-out drop. Exit: quicker, accelerating away. */
const PANEL_MOTION = {
  initial: { opacity: 0, y: -6 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.18, ease: [0.16, 1, 0.3, 1] } },
  exit: { opacity: 0, y: -4, transition: { duration: 0.12, ease: [0.4, 0, 1, 1] } },
} as const;

function FeedRow({ item, onSelect }: { item: ShellFeedItem; onSelect: (id: string) => void }) {
  const t = useT();
  const Icon = item.icon;
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(item.id)}
        aria-label={item.unread ? t('shell.notificationUnread', { title: item.title }) : item.title}
        className="flex w-full items-start gap-3 rounded-surface px-1 py-3 text-start transition-colors duration-fast hover:bg-surface-sunken"
      >
        <span
          aria-hidden="true"
          className={cn(
            'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-pill',
            item.iconClass,
          )}
        >
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-body-sm font-medium text-text-primary">{item.title}</p>
          <p className="truncate text-body-sm text-text-secondary">{item.detail}</p>
          <p className="mt-0.5 text-caption text-text-tertiary">{item.timeLabel}</p>
        </div>
        {item.unread ? (
          <span className="mt-2 flex h-2 w-2 shrink-0 rounded-pill bg-primary">
            <span className="sr-only">{t('shell.unread')}</span>
          </span>
        ) : null}
      </button>
    </li>
  );
}

function Feed({
  items,
  onSelect,
}: {
  items: readonly ShellFeedItem[] | null;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  if (items === null) {
    return (
      <div aria-busy="true" className="flex flex-col gap-3">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-14 w-full rounded-surface" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        headingLevel="h3"
        className="py-8"
        title={t('shell.allCaughtUp')}
        description={t('shell.allCaughtUpBody')}
      />
    );
  }

  return (
    <ul className="-my-2 divide-y divide-border">
      {items.map((item) => (
        <FeedRow key={item.id} item={item} onSelect={onSelect} />
      ))}
    </ul>
  );
}

export function NotificationButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<AnchoredPanelPosition | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { counts, feed, markRead, markAllRead, clearRead, viewAllHref } = useShellBadges();
  const { pathname } = useLocation();
  const rtl = useIsRtl();
  const t = useT();
  const panelId = useId();
  const titleId = useId();
  const unreadCount = counts.notifications;
  const hasItems = (feed?.length ?? 0) > 0;

  const close = useCallback(() => setIsOpen(false), []);
  const closeAndRefocus = useCallback(() => {
    setIsOpen(false);
    triggerRef.current?.focus();
  }, []);

  useOutsideClick([wrapperRef], close, isOpen);

  // Measure before paint, so the first frame is already in place.
  useLayoutEffect(() => {
    if (!isOpen) return;
    const place = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      setPosition(computeAnchoredPanel(trigger.getBoundingClientRect(), window.innerWidth, rtl));
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [isOpen, rtl]);

  useEffect(() => {
    if (isOpen) panelRef.current?.focus();
  }, [isOpen]);

  // A navigation (the footer link, a search result, the back button) is the
  // user leaving; the panel should not follow them to the next page.
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  const onMarkAllRead = () => {
    markAllRead();
    // The button removes itself once nothing is unread; keep focus in the panel.
    panelRef.current?.focus();
  };

  return (
    <div
      ref={wrapperRef}
      className="relative inline-flex"
      onKeyDown={(event) => {
        if (isOpen && event.key === 'Escape') {
          event.stopPropagation();
          closeAndRefocus();
        }
      }}
      onBlur={(event) => {
        // Tabbing out of the panel closes it. A null `relatedTarget` (a click
        // on nothing focusable) is the outside-click handler's to decide.
        const next = event.relatedTarget;
        if (isOpen && next instanceof Node && !wrapperRef.current?.contains(next)) close();
      }}
    >
      <IconButton
        ref={triggerRef}
        icon={Bell}
        aria-label={
          unreadCount > 0
            ? t('shell.notificationsUnread', { count: unreadCount })
            : t('shell.notifications')
        }
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? panelId : undefined}
        className={cn(isOpen && 'bg-surface-sunken text-text-primary')}
        onClick={() => setIsOpen((open) => !open)}
      />
      {unreadCount > 0 ? (
        <CountBadge
          count={unreadCount}
          aria-label={t('shell.unreadNotificationsBadge', { count: unreadCount })}
          className="pointer-events-none absolute -end-0.5 -top-0.5"
        />
      ) : null}

      <AnimatePresence>
        {isOpen && position !== null ? (
          <m.div
            key="notifications-panel"
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-labelledby={titleId}
            tabIndex={-1}
            {...PANEL_MOTION}
            style={{
              top: position.top,
              left: position.left,
              width: position.width,
              maxHeight: `min(520px, calc(100dvh - ${String(position.top + PANEL_EDGE)}px))`,
              transformOrigin: `${String(position.caretX)}px 0`,
            }}
            className="fixed z-dropdown flex animate-menu-in flex-col rounded-surface border border-border bg-surface shadow-popover focus:outline-none"
          >
            {/* The caret: the panel's visible link back to the bell. Its base
                overlaps the panel's top border by a pixel so the two read as
                one outline. */}
            <svg
              aria-hidden="true"
              viewBox="0 0 14 8"
              className="pointer-events-none absolute -top-[7px] h-2 w-3.5 overflow-visible"
              style={{ left: position.caretX - 7 }}
            >
              <path d="M0 8 L7 1 L14 8" className="fill-surface stroke-border" strokeWidth={1} />
            </svg>

            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <h2 id={titleId} className="text-body font-semibold text-text-primary">
                  {t('shell.notifications')}
                </h2>
                {unreadCount > 0 ? (
                  <span className="rounded-pill bg-primary-subtle px-2 py-0.5 text-caption font-medium text-primary">
                    {t('shell.unreadCount', { count: unreadCount })}
                  </span>
                ) : null}
              </div>
              {unreadCount > 0 ? (
                <Button variant="ghost" size="sm" onClick={onMarkAllRead}>
                  <CheckCheck aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
                  {t('shell.markAllRead')}
                </Button>
              ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
              <Feed items={feed} onSelect={markRead} />
            </div>

            {(hasItems && clearRead !== null) || viewAllHref ? (
              <div className="flex items-center justify-between gap-2 border-t border-border px-2 py-1.5">
                {hasItems && clearRead !== null ? (
                  <Button variant="ghost" size="sm" onClick={clearRead}>
                    {t('shell.clearRead')}
                  </Button>
                ) : (
                  <span />
                )}
                {viewAllHref ? (
                  <LinkButton href={viewAllHref} variant="ghost" size="sm" onClick={close}>
                    {t('shell.viewAllNotifications')}
                  </LinkButton>
                ) : null}
              </div>
            ) : null}
          </m.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
