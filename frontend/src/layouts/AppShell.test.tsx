import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AppShell } from './AppShell';
import type { NavigationConfig } from './navigation';

/**
 * The shell's `<main>` is the app's ONLY scroll container — everything below
 * the navbar scrolls inside it while `h-dvh overflow-hidden` pins the chrome.
 *
 * That makes `relative` load-bearing, not cosmetic. Tailwind's `sr-only`
 * (and badge/icon overlays) use `position: absolute` with no offsets. Without
 * a positioned ancestor their containing block resolves to the initial
 * containing block, so they escape `<main>`'s overflow clip and get laid out
 * at their static position — which, deep inside a long list, sits far below
 * the viewport. That extends the *document's* scrollable height, producing a
 * second outer scrollbar and a band of empty background under the bottom tab
 * bar. Regression guard for that bug.
 */

// The chrome pulls in auth, query and badge context; this suite is about the
// shell's own box model, so the surrounding furniture is stubbed out.
vi.mock('./Navbar/AppNavbar', () => ({ AppNavbar: () => <header>navbar</header> }));
vi.mock('./Sidebar/AppSidebar', () => ({ AppSidebar: () => <aside>sidebar</aside> }));
vi.mock('./BottomTabBar', () => ({ BottomTabBar: () => <nav>tabs</nav> }));
vi.mock('./MobileNavDrawer', () => ({ MobileNavDrawer: () => null }));
vi.mock('@/app/providers', () => ({ useAuth: () => ({ user: { id: 'doctor-1' } }) }));
vi.mock('@/hooks/useInternalLinkNavigation', () => ({ useInternalLinkNavigation: () => {} }));
vi.mock('@/hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }));
vi.mock('./useRouteTitle', () => ({ useRouteTitle: () => 'Labs' }));

const config: NavigationConfig = { items: [] } as unknown as NavigationConfig;

function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/doctor/labs']}>
      <AppShell config={config} />
    </MemoryRouter>,
  );
}

describe('AppShell scroll container', () => {
  it('establishes a containing block so absolute children cannot escape the clip', () => {
    renderShell();

    const main = screen.getByRole('main');

    expect(main.className).toContain('overflow-y-auto');
    // Without this, `position: absolute` descendants anchor to the ICB and
    // stretch the document scroller past the viewport.
    expect(main.className).toContain('relative');
  });

  it('keeps the outer frame pinned to the viewport', () => {
    const { container } = renderShell();

    const frame = container.firstElementChild as HTMLElement;

    expect(frame.className).toContain('h-dvh');
    expect(frame.className).toContain('overflow-hidden');
  });
});
