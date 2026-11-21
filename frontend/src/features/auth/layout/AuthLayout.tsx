import { Outlet } from 'react-router-dom';

import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { RouteAnnouncer, ThemeSwitch, useTranslatedRouteTitle } from '@/layouts';

import { AuthFooter } from '../components/AuthFooter';
import { LanguageSelector } from '../components/LanguageSelector';

import { BrandPanel } from './BrandPanel';

/**
 * AuthLayout — the shell for every guest auth page.
 * Two-column split on lg+ (brand panel + content); a single centered column
 * below lg with the brand panel hidden. Theme + language controls live in the
 * shared header so individual pages never duplicate them. Pages render their
 * own AuthCard into the <Outlet/>.
 *
 * It also does what `AppShell` does for the signed-in areas, and for the same
 * reasons: names the browser tab per route (WCAG 2.4.2) and announces the page
 * a client-side navigation landed on. Every public page shared the bare title
 * "Medora" before this — ten pages, one title, and two open tabs
 * indistinguishable. The name comes from `handle.titleKey`, which is the key
 * each page already renders as its own `h1`, so the tab, the heading and the
 * announcement are one string in five languages rather than three.
 */
export function AuthLayout() {
  const title = useTranslatedRouteTitle();
  useDocumentTitle(title);

  return (
    <div className="min-h-dvh bg-background lg:grid lg:grid-cols-2">
      <RouteAnnouncer title={title} />
      <BrandPanel className="hidden lg:flex" />

      <div className="flex min-h-dvh flex-col">
        <header className="flex items-center justify-end gap-2 px-4 py-4 sm:px-6">
          <div className="w-40">
            <LanguageSelector />
          </div>
          <ThemeSwitch />
        </header>

        <main className="flex flex-1 items-center justify-center px-4 pb-12 sm:px-6">
          <div className="w-full max-w-md">
            <Outlet />
            <AuthFooter />
          </div>
        </main>
      </div>
    </div>
  );
}
