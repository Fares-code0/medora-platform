import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as Providers from '@/app/providers';
import { ThemeProvider } from '@/app/providers/ThemeProvider';

import { AvatarMenu } from './AvatarMenu';

/**
 * The avatar menu holds the account entries only. The light/dark pill
 * (NEW-36) moved to the foot of the sidebar and the sign-in screens as
 * `ThemeSwitch`, whose own suite carries every behaviour asserted here before.
 */

const logout = vi.fn();
const account = vi.hoisted(() => ({ name: 'Amelia Chen', role: 'doctor' }));

vi.mock('@/app/providers', async (importOriginal) => {
  const actual: typeof Providers = await importOriginal();
  return {
    ...actual,
    useAuth: () => ({
      user: { id: 'u-1', name: account.name, email: 'doctor@medora.health', role: account.role },
      logout,
    }),
    useDoctorProfile: () => ({ profile: { fullName: 'Dr. Amelia Chen', photo: null } }),
  };
});

function renderMenu() {
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <AvatarMenu />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

async function openMenu() {
  await userEvent.click(screen.getByRole('button', { name: /Dr\. Amelia Chen/ }));
}

describe('the avatar menu', () => {
  it('lists the profile, settings and sign-out entries, and no theme switch', async () => {
    renderMenu();
    await openMenu();

    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'My Profile',
      'Settings',
      'Sign out',
    ]);
    expect(screen.queryByRole('group', { name: 'Theme' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitemradio')).not.toBeInTheDocument();
  });
});

/**
 * My Profile is reached from the avatar menu, never the sidebar (see the
 * adminNavigation comment and navigation.test.ts): both roles that have a
 * profile page must keep the entry here, and it must open their own page.
 */
describe('the avatar menu — My Profile', () => {
  afterEach(() => {
    account.name = 'Amelia Chen';
    account.role = 'doctor';
  });

  function PathProbe() {
    return <output data-testid="path">{useLocation().pathname}</output>;
  }

  it.each([
    ['doctor', 'Amelia Chen', /Dr\. Amelia Chen/, '/doctor/settings/profile'],
    ['admin', 'Platform Admin', /Platform Admin/, '/admin/profile'],
  ] as const)('offers My Profile to the %s', async (role, name, button, path) => {
    account.name = name;
    account.role = role;
    render(
      <ThemeProvider>
        <MemoryRouter>
          <AvatarMenu />
          <PathProbe />
        </MemoryRouter>
      </ThemeProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: button }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'My Profile' }));
    expect(screen.getByTestId('path')).toHaveTextContent(path);
  });

  // The administrator's avatar Settings is personal preferences; Platform
  // Settings is the sidebar's (AppSidebar.test.tsx). They must not converge.
  it('sends the admin avatar Settings to personal preferences, not Platform Settings', async () => {
    account.name = 'Platform Admin';
    account.role = 'admin';
    render(
      <ThemeProvider>
        <MemoryRouter>
          <AvatarMenu />
          <PathProbe />
        </MemoryRouter>
      </ThemeProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Platform Admin/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Settings' }));
    expect(screen.getByTestId('path')).toHaveTextContent('/admin/preferences');
    expect(screen.getByTestId('path')).not.toHaveTextContent('/admin/settings');
  });
});
