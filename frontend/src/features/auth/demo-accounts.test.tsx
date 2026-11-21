import type { ReactNode } from 'react';

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { AuthProvider } from '@/app/providers/AuthProvider';
import { QueryProvider } from '@/app/providers/QueryProvider';
import { LocaleProvider } from '@/i18n';

import { demoAccounts, seededUsers } from './mock/users';
import LoginPage from './pages/LoginPage';

/**
 * The login-page demo hint (Option B — discoverability only).
 *
 * `unverified@` and `secure@` were seeded, working and unlisted: each
 * suspends its sign-in to reach a screen — `/verify-email` and
 * `/verify-otp` — that nothing else in a demo can reach. Nothing on
 * screen said so, so both looked like dead fixtures.
 *
 * These tests hold the fix in place and, just as importantly, hold the
 * line it must not cross: listing an account is **not** the same as
 * giving it a one-click button.
 */

function renderLogin() {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryProvider>
        <AuthProvider>
          <LocaleProvider>
            <MemoryRouter>{children}</MemoryRouter>
          </LocaleProvider>
        </AuthProvider>
      </QueryProvider>
    );
  }

  return render(<LoginPage />, { wrapper: Wrapper });
}

describe('the demoAccounts roster', () => {
  it('lists every seeded account', () => {
    // A seeded account missing from the hint is one nobody can discover,
    // which is the bug this change fixes. Derived from `seededUsers` so
    // adding a fifth account fails here rather than being forgotten.
    expect(demoAccounts.map((account) => account.email).sort()).toEqual(
      seededUsers.map((user) => user.email).sort(),
    );
  });

  it('carries a note on exactly the two accounts that suspend sign-in', () => {
    const withNote = demoAccounts.filter((account) => account.note !== undefined);

    expect(withNote.map((account) => account.email)).toEqual([
      'unverified@medora.health',
      'secure@medora.health',
    ]);
  });

  it('says what each of those two demonstrates', () => {
    const noteFor = (email: string) =>
      demoAccounts.find((account) => account.email === email)?.note;

    expect(noteFor('unverified@medora.health')).toBe(
      'Email unverified — see the verification screen',
    );
    expect(noteFor('secure@medora.health')).toBe('2FA enabled — see the OTP step-up');
  });

  it('leaves the two straight-in accounts without a note', () => {
    // They need no explanation, and adding one would have changed rows
    // this task was asked not to touch.
    const noteFor = (email: string) =>
      demoAccounts.find((account) => account.email === email)?.note;

    expect(noteFor('doctor@medora.health')).toBeUndefined();
    expect(noteFor('admin@medora.health')).toBeUndefined();
  });
});

describe('the hint as rendered', () => {
  it('shows all four addresses and the shared password', () => {
    renderLogin();

    for (const account of demoAccounts) {
      expect(screen.getByText(new RegExp(account.email))).toBeInTheDocument();
    }
    expect(screen.getByText(/Medora123!/)).toBeInTheDocument();
  });

  it('renders both notes', () => {
    renderLogin();

    expect(
      screen.getByText('Email unverified — see the verification screen'),
    ).toBeInTheDocument();
    expect(screen.getByText('2FA enabled — see the OTP step-up')).toBeInTheDocument();
  });

  it('adds no button for the newly listed accounts', () => {
    renderLogin();

    // The line this change must not cross. The one-click buttons read
    // `DEMO_DOCTOR_ACCOUNT` in `dev/DemoAccessPanel.tsx`, never `demoAccounts`, so a
    // row here cannot become a button — this asserts that stays true.
    const buttonText = screen
      .getAllByRole('button')
      .map((button) => button.textContent ?? '')
      .join(' ');

    expect(buttonText).not.toMatch(/unverified|secure|2FA|OTP/i);
  });
});
