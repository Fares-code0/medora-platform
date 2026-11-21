import { useCallback, useEffect, useState } from 'react';

import { m } from 'framer-motion';
import { Outlet, useLocation } from 'react-router-dom';

import { useAuth } from '@/app/providers';
import { useDisclosure } from '@/hooks/useDisclosure';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useInternalLinkNavigation } from '@/hooks/useInternalLinkNavigation';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { getPreference, setPreference } from '@/services/preferences';

import { BottomTabBar } from './BottomTabBar';
import { FeatureErrorBoundary } from './FeatureErrorBoundary';
import { MobileNavDrawer } from './MobileNavDrawer';
import { AppNavbar } from './Navbar/AppNavbar';
import { type NavigationConfig } from './navigation';
import { routeTransitionKey } from './route-transition-key';
import { RouteAnnouncer } from './RouteAnnouncer';
import { AppSidebar } from './Sidebar/AppSidebar';
import { MAIN_CONTENT_ID, SkipToContent } from './SkipToContent';
import { useRouteTitle } from './useRouteTitle';

/**
 * AppShell — FRONTEND_ARCHITECTURE.md §4 / UX §1.2 + §5.1.
 * One shell instance per role tree; route transitions swap only the
 * outlet (the chrome never re-animates). Responsive switching lives here
 * exclusively:  xl+ expanded sidebar (user-collapsible, persisted) ·
 * lg icon rail · md overlay drawer · <md bottom tab bar.
 */
export function AppShell({ config }: { config: NavigationConfig }) {
  useInternalLinkNavigation();
  /*
   * One read of the route's name, used twice: it names the browser tab and
   * history entry (WCAG 2.4.2), and it is what `RouteAnnouncer` reads aloud
   * after a client-side navigation. Deriving it twice would be two things to
   * keep in sync for no gain — and the failure would be silent, because a
   * disagreement between the tab label and the announcement is invisible to
   * whoever can see the tab.
   */
  const routeTitle = useRouteTitle();
  useDocumentTitle(routeTitle);

  const { user } = useAuth();
  const { pathname } = useLocation();
  const isLg = useMediaQuery('(min-width: 1024px)');
  const isXl = useMediaQuery('(min-width: 1280px)');
  const isMd = useMediaQuery('(min-width: 768px)');

  const mobileNav = useDisclosure();
  const [elevated, setElevated] = useState(false);
  const [collapsedPref, setCollapsedPref] = useState<boolean | null>(() =>
    getPreference('sidebarCollapsed', user?.id),
  );

  // lg defaults to the icon rail; xl+ defaults to expanded (UX §5.1).
  const collapsed = collapsedPref ?? !isXl;

  const toggleSidebar = useCallback(() => {
    if (isLg) {
      setCollapsedPref((prev) => {
        const next = !(prev ?? !isXl);
        setPreference('sidebarCollapsed', next, user?.id);
        return next;
      });
    } else {
      mobileNav.open();
    }
  }, [isLg, isXl, mobileNav, user?.id]);

  // Ctrl/⌘+B mirrors the navbar burger (declared via aria-keyshortcuts).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleSidebar]);

  // Close the overlay drawer if the viewport grows past md.
  useEffect(() => {
    if (isLg && mobileNav.isOpen) mobileNav.close();
  }, [isLg, mobileNav]);

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <SkipToContent />
      <RouteAnnouncer title={routeTitle} />
      {isLg ? <AppSidebar config={config} collapsed={collapsed} /> : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <AppNavbar config={config} elevated={elevated} onMenuToggle={toggleSidebar} />

        {/* `relative` is load-bearing, not cosmetic: it makes this scroller
            the containing block for `position: absolute` descendants
            (`sr-only` labels, badge and icon overlays). Without it they anchor
            to the initial containing block, escape this element's overflow
            clip, and stretch the document's scroll height past the viewport —
            which unpins the h-dvh chrome and opens a band of empty background
            below the bottom tab bar. */}
        <main
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className="relative flex-1 overflow-y-auto focus:outline-none"
          onScroll={(event) => setElevated(event.currentTarget.scrollTop > 0)}
        >
          {/* Route transition per UX §4.1: incoming content fades + rises
              8px over 200ms; MotionProvider disables it under reduced
              motion. The shell around this never re-animates, and neither
              does a settings center when only its category changes
              (`routeTransitionKey`). */}
          <m.div
            key={routeTransitionKey(pathname)}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: [0, 0, 0.2, 1] }}
          >
            {/*
              Inside the shell, so a feature that throws does not take the
              navigation with it — the router's own `errorElement` sits above
              everything and would. Keyed on the pathname so a latched error
              clears when the user goes somewhere else.
            */}
            <FeatureErrorBoundary resetKey={pathname}>
              <Outlet />
            </FeatureErrorBoundary>
          </m.div>
        </main>

        {!isMd ? <BottomTabBar config={config} onMore={mobileNav.open} /> : null}
      </div>

      {!isLg ? (
        <MobileNavDrawer open={mobileNav.isOpen} onClose={mobileNav.close} config={config} />
      ) : null}
    </div>
  );
}
