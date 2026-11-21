import { useCallback, useEffect, useId, useRef } from 'react';

import { AnimatePresence, m } from 'framer-motion';
import { PanelLeft, Search, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useCan } from '@/app/providers';
import { IconButton, Tooltip, TopNavbar } from '@/components/ui';
import { useDisclosure } from '@/hooks/useDisclosure';
import { useOutsideClick } from '@/hooks/useOutsideClick';
import { useT } from '@/i18n';
import { routes } from '@/routes';
import { Logo, MedoraAiLogo } from '@/shared/components/branding';
import { EASE_EMPHASIZED, EASE_IN, motionTokens } from '@/styles/motion';

import { type NavigationConfig } from '../navigation';

import { AppBreadcrumb } from './AppBreadcrumb';
import { AvatarMenu } from './AvatarMenu';
import { GlobalSearch } from './GlobalSearch';
import { NotificationButton } from './NotificationButton';

/**
 * AppNavbar — FRONTEND_ARCHITECTURE.md §4 (layouts/Navbar).
 * Burger (collapse toggle ≥lg, overlay drawer below), breadcrumbs from
 * route handles, then the end cluster: search, AI entry (doctor shell only,
 * gated on `ai.use`), notification bell and the avatar menu.
 *
 * **Search is an icon, at every width.** The field no longer sits in the
 * middle of the bar; the icon beside the bell opens it in a panel that hangs
 * from the bar's end, under the controls rather than over them, and focuses
 * the field. The search itself is unchanged — the same `GlobalSearch`, the
 * same role index, the same keyboard model. Ctrl/⌘+K opens the panel from
 * anywhere. Escape, the icon (now a close button), choosing a result or a
 * click outside closes it; Escape and the close button return focus to the
 * icon.
 */
export interface AppNavbarProps {
  config: NavigationConfig;
  elevated: boolean;
  onMenuToggle: () => void;
}

export function AppNavbar({ config, elevated, onMenuToggle }: AppNavbarProps) {
  const can = useCan();
  const search = useDisclosure();
  const navigate = useNavigate();
  const t = useT();
  const panelId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const toggleWrapperRef = useRef<HTMLSpanElement>(null);

  // The same gate the sidebar and the bottom tab bar apply to the assistant
  // (D-08). It used to read `featureFlags.aiAssistant`, which was false while
  // both of those showed the entry and the route mounted unconditionally —
  // one module, three doors, two different rules, and this was the door that
  // lied about it.
  const showAiEntry = config.role === 'doctor' && can('ai.use');
  // A shell with no search index offers no search: an empty one would answer
  // every query with "No matches" (D-26's defect). The staff shells have none.
  const searchKey = config.searchPlaceholderKey;

  const { open: openSearch, close: closeSearch } = search;
  const dismissSearch = useCallback(() => {
    closeSearch();
    toggleRef.current?.focus();
  }, [closeSearch]);

  // A click anywhere else closes the panel, without moving focus.
  useOutsideClick([panelRef, toggleWrapperRef], closeSearch, search.isOpen);

  // Ctrl/⌘+K opens the panel; the field focuses itself as it mounts.
  useEffect(() => {
    if (searchKey === null) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openSearch();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openSearch, searchKey]);

  return (
    <div className="relative">
      <TopNavbar
        sticky={false}
        elevated={elevated}
        start={
          <>
            <IconButton
              icon={PanelLeft}
              aria-label={t('shell.toggleNavigation')}
              aria-keyshortcuts="Control+B"
              onClick={onMenuToggle}
            />
            {/* Brand mark on mobile, where the sidebar is hidden behind the drawer. */}
            <Logo size="sm" className="md:hidden" />
            <AppBreadcrumb className="hidden md:block" />
          </>
        }
        end={
          <>
            {searchKey !== null ? (
              <span ref={toggleWrapperRef} className="inline-flex">
                <IconButton
                  ref={toggleRef}
                  icon={search.isOpen ? X : Search}
                  aria-label={search.isOpen ? t('ui.close') : t('ui.search')}
                  aria-expanded={search.isOpen}
                  aria-controls={search.isOpen ? panelId : undefined}
                  aria-keyshortcuts="Control+K"
                  className={search.isOpen ? 'bg-surface-sunken text-text-primary' : undefined}
                  onClick={search.isOpen ? dismissSearch : search.open}
                />
              </span>
            ) : null}
            {showAiEntry ? (
              <Tooltip content={t('nav.assistant')}>
                <IconButton
                  icon={MedoraAiLogo}
                  variant="ai"
                  className="border border-ai-launcher-border bg-ai-launcher"
                  aria-label={t('shell.openAssistant')}
                  onClick={() => navigate(routes.doctor.assistant)}
                />
              </Tooltip>
            ) : null}
            <NotificationButton />
            <AvatarMenu />
          </>
        }
      />
      <AnimatePresence>
        {searchKey !== null && search.isOpen ? (
          <m.div
            key="navbar-search"
            ref={panelRef}
            id={panelId}
            data-testid="navbar-search-panel"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{
              opacity: 0,
              y: -4,
              transition: { duration: motionTokens.duration.slow, ease: EASE_IN },
            }}
            transition={{ duration: motionTokens.duration.menu, ease: EASE_EMPHASIZED }}
            // Hangs from the bar's end edge, below it, so the bell and the
            // avatar stay in view and in reach. Never wider than the viewport
            // less its gutters.
            className={
              'absolute end-3 top-[calc(100%+6px)] z-dropdown w-[min(32rem,calc(100vw-1.5rem))] origin-top-right ' +
              'rounded-surface border border-border bg-surface-overlay p-2 shadow-modal md:end-6 rtl:origin-top-left'
            }
          >
            <GlobalSearch
              placeholder={t(searchKey)}
              autoFocus
              // A chosen result navigates, and the route moves focus itself.
              onDismiss={(reason) => (reason === 'escape' ? dismissSearch() : closeSearch())}
            />
          </m.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
