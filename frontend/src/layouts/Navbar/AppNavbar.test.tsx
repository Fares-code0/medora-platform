import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { doctorNavigation } from '../navigation';

import { AppNavbar } from './AppNavbar';

/**
 * D-08 / F-12. `featureFlags.aiAssistant` was `false` while the assistant's
 * route mounted unconditionally and both the sidebar and the bottom tab bar
 * showed its entry — one module, three doors, and this was the only one
 * asserting it did not exist.
 *
 * What is asserted is not that the button came back, but that the three
 * doors now answer to the same rule: `ai.use`, the permission the other two
 * already filter `requiredPermission` on. A flag would have had to be kept
 * in sync with a permission for ever; this cannot drift.
 *
 * The rest of the navbar (breadcrumb, avatar, bell, search) pulls in a data
 * router and four providers and is stubbed out, the way `AppShell.test.tsx`
 * stubs its own furniture.
 */

const can = vi.fn();

vi.mock('@/app/providers', () => ({ useCan: () => can }));
vi.mock('./AppBreadcrumb', () => ({ AppBreadcrumb: () => <nav>breadcrumb</nav> }));
vi.mock('./AvatarMenu', () => ({ AvatarMenu: () => <div>avatar</div> }));
vi.mock('./NotificationButton', () => ({ NotificationButton: () => <div>bell</div> }));
vi.mock('./GlobalSearch', () => ({ GlobalSearch: () => <div>search</div> }));

function renderNavbar(role: 'doctor' | 'admin' = 'doctor') {
  return render(
    <MemoryRouter>
      <AppNavbar
        config={{ ...doctorNavigation, role }}
        elevated={false}
        onMenuToggle={() => undefined}
      />
    </MemoryRouter>,
  );
}

describe('the navbar AI entry', () => {
  it('is offered to a doctor who holds ai.use', () => {
    can.mockImplementation((permission: string) => permission === 'ai.use');
    renderNavbar();

    expect(screen.getByRole('button', { name: 'Open Medora AI' })).toBeInTheDocument();
  });

  it('draws its icon in the launcher icon colour, not the ai variant’s inverse text', () => {
    // The tile is white in both themes; text-inverse is white in light mode,
    // which rendered the Sparkles icon invisible (seen in a real browser).
    can.mockImplementation((permission: string) => permission === 'ai.use');
    renderNavbar();

    const launcher = screen.getByRole('button', { name: 'Open Medora AI' });
    expect(launcher).toHaveClass('bg-ai-launcher', 'border-ai-launcher-border', 'text-ai-launcher-icon');
    expect(launcher.querySelector('svg[data-brand="medora-ai"]')).not.toBeNull();
  });

  it('is withheld from a doctor who does not, matching the sidebar', () => {
    can.mockImplementation(() => false);
    renderNavbar();

    expect(screen.queryByRole('button', { name: 'Open Medora AI' })).not.toBeInTheDocument();
  });

  it('stays a doctor affordance — the admin shell never shows it', () => {
    can.mockImplementation(() => true);
    renderNavbar('admin');

    expect(screen.queryByRole('button', { name: 'Open Medora AI' })).not.toBeInTheDocument();
  });
});
