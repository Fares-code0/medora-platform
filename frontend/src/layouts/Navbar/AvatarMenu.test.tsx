import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type * as Providers from '@/app/providers';
import { ThemeProvider } from '@/app/providers/ThemeProvider';

import { AvatarMenu } from './AvatarMenu';

/**
 * The avatar menu holds the account entries only. The light/dark pill
 * (NEW-36) moved to the foot of the sidebar and the sign-in screens as
 * `ThemeSwitch`, whose own suite carries every behaviour asserted here before.
 */

const logout = vi.fn();

vi.mock('@/app/providers', async (importOriginal) => {
  const actual: typeof Providers = await importOriginal();
  return {
    ...actual,
    useAuth: () => ({
      user: { id: 'u-1', name: 'Amelia Chen', email: 'doctor@medora.health', role: 'doctor' },
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
