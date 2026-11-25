import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { apiClient } from '@/api/client';
import { AppProviders } from '@/app/providers';
import { findUser, MOCK_PASSWORD } from '@/features/auth/mock/users';
import { routes } from '@/routes';
import type { Permission } from '@/types/auth';

import { appRoutes } from './index';

/**
 * The staff workspaces end to end (DEC-006a), through the real route tree and
 * the demo auth service: a Reception, Laboratory or Pharmacy account signs in
 * — where it used to be told "Incorrect email or password" — lands on its own
 * home, sees only its own navigation, and is refused every other role's area.
 *
 * The refusal tested here is the client's guard, which only chooses what is
 * drawn. The server refuses the data independently; that is not this test.
 */

const LAZY_ROUTE_MS = 10_000;
vi.setConfig({ testTimeout: LAZY_ROUTE_MS + 10_000 });

beforeAll(() => {
  // Data-router navigations build a Request; jsdom's AbortSignal and Node's
  // Request disagree across realms. The same stub `features/admin/routes.test.tsx` uses.
  vi.stubGlobal(
    'Request',
    class {
      readonly url: string;
      readonly signal: AbortSignal | undefined;
      constructor(url: string, init?: { signal?: AbortSignal }) {
        this.url = url;
        this.signal = init?.signal;
      }
    },
  );
  const proto = window.HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto['showModal'] = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  proto['close'] = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

async function signInAs(email: string) {
  const router = createMemoryRouter([...appRoutes], { initialEntries: [routes.login] });
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  const user = userEvent.setup();
  await user.type(
    await screen.findByLabelText('Email address', undefined, { timeout: LAZY_ROUTE_MS }),
    email,
  );
  await user.type(screen.getByLabelText('Password', { selector: 'input' }), MOCK_PASSWORD);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  return router;
}

function primaryNav() {
  return within(screen.getAllByRole('navigation', { name: /primary|main/i })[0] ?? document.body);
}

describe.each([
  {
    email: 'reception@medora.health',
    home: routes.reception.root,
    title: 'Reception',
    navItems: ['Appointments', 'Patients'],
    unavailable: 'Booking, rescheduling and cancelling for a doctor',
    elsewhere: routes.laboratory.catalogue,
  },
  {
    email: 'lab@medora.health',
    home: routes.laboratory.root,
    title: 'Laboratory',
    navItems: ['Test catalogue', 'Patients'],
    unavailable: 'Lab orders, result entry and order progress',
    elsewhere: routes.reception.appointments,
  },
  {
    email: 'pharmacy@medora.health',
    home: routes.pharmacy.root,
    title: 'Pharmacy',
    navItems: ['Patients'],
    unavailable: 'Viewing and dispensing prescriptions',
    elsewhere: routes.reception.appointments,
  },
])('$title account', ({ email, home, title, navItems, unavailable, elsewhere }) => {
  it('signs in and lands on its own workspace home', async () => {
    const router = await signInAs(email);

    expect(
      await screen.findByRole('heading', { level: 1, name: title }, { timeout: LAZY_ROUTE_MS }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(home);
    expect(screen.queryByText(/Incorrect email or password/)).not.toBeInTheDocument();
    // What is not available is said, not offered.
    expect(screen.getByText(unavailable)).toBeInTheDocument();
  });

  it('shows only its own navigation', async () => {
    await signInAs(email);
    await screen.findByRole('heading', { level: 1, name: title }, { timeout: LAZY_ROUTE_MS });

    const nav = primaryNav();
    for (const item of navItems) {
      expect(nav.getAllByRole('link', { name: item }).length).toBeGreaterThan(0);
    }
    for (const foreign of ['Medical records', 'Labs', 'Pharmacy', 'Doctors', 'System logs']) {
      expect(nav.queryByRole('link', { name: foreign })).not.toBeInTheDocument();
    }
  });

  it('is refused the doctor area, the admin area and another staff workspace', async () => {
    const router = await signInAs(email);
    await screen.findByRole('heading', { level: 1, name: title }, { timeout: LAZY_ROUTE_MS });

    for (const path of [routes.doctor.overview, routes.admin.root, elsewhere]) {
      await router.navigate(path);
      expect(
        await screen.findByText("You don't have access to this page", undefined, {
          timeout: LAZY_ROUTE_MS,
        }),
      ).toBeInTheDocument();
    }
  });
});

describe('Staff settings', () => {
  it('offers only the non-practitioner sections and redirects the rest to Account', async () => {
    const router = await signInAs('pharmacy@medora.health');
    await screen.findByRole('heading', { level: 1, name: 'Pharmacy' }, { timeout: LAZY_ROUTE_MS });

    await router.navigate(routes.pharmacy.settings('profile'));

    await waitFor(
      () => {
        expect(router.state.location.pathname).toBe(routes.pharmacy.settings('account'));
      },
      { timeout: LAZY_ROUTE_MS },
    );
    const settingsNav = await screen.findByRole(
      'navigation',
      { name: /settings/i },
      { timeout: LAZY_ROUTE_MS },
    );
    expect(within(settingsNav).queryByRole('link', { name: /profile/i })).not.toBeInTheDocument();
    expect(within(settingsNav).getAllByRole('link', { name: /security/i }).length).toBeGreaterThan(0);
  });
});

describe('Availability settings (DEC-005)', () => {
  it('is offered to a doctor', async () => {
    const router = await signInAs('doctor@medora.health');
    await waitFor(
      () => {
        expect(router.state.location.pathname.startsWith('/doctor')).toBe(true);
      },
      { timeout: LAZY_ROUTE_MS },
    );

    await router.navigate(routes.doctor.settings('availability'));

    expect(
      await screen.findByRole('heading', { name: 'Weekly hours' }, { timeout: LAZY_ROUTE_MS }),
    ).toBeInTheDocument();
  });

  it('is not offered to an administrator, who has no practitioner record', async () => {
    const router = await signInAs('admin@medora.health');
    await waitFor(
      () => {
        expect(router.state.location.pathname.startsWith(routes.admin.root)).toBe(true);
      },
      { timeout: LAZY_ROUTE_MS },
    );

    await router.navigate(`${routes.admin.section('preferences')}/availability`);

    await waitFor(
      () => {
        expect(router.state.location.pathname).toBe(
          `${routes.admin.section('preferences')}/account`,
        );
      },
      { timeout: LAZY_ROUTE_MS },
    );
    expect(screen.queryByRole('heading', { name: 'Weekly hours' })).not.toBeInTheDocument();
  });
});

describe('Professional profile settings (DEC-007)', () => {
  const preferences = routes.admin.section('preferences');

  it('sends an administrator who opens the profile by URL to Account, and does not list it', async () => {
    const router = await signInAs('admin@medora.health');
    await waitFor(
      () => {
        expect(router.state.location.pathname.startsWith(routes.admin.root)).toBe(true);
      },
      { timeout: LAZY_ROUTE_MS },
    );

    await router.navigate(`${preferences}/profile`);

    await waitFor(
      () => {
        expect(router.state.location.pathname).toBe(`${preferences}/account`);
      },
      { timeout: LAZY_ROUTE_MS },
    );
    const settingsNav = await screen.findByRole(
      'navigation',
      { name: /settings/i },
      { timeout: LAZY_ROUTE_MS },
    );
    expect(within(settingsNav).queryByRole('link', { name: /^profile/i })).not.toBeInTheDocument();
    expect(within(settingsNav).getAllByRole('link', { name: /account/i }).length).toBeGreaterThan(0);
  });

  it('opens an administrator’s My Settings on Account', async () => {
    const router = await signInAs('admin@medora.health');
    await waitFor(
      () => {
        expect(router.state.location.pathname.startsWith(routes.admin.root)).toBe(true);
      },
      { timeout: LAZY_ROUTE_MS },
    );

    await router.navigate(preferences);

    await waitFor(
      () => {
        expect(router.state.location.pathname).toBe(`${preferences}/account`);
      },
      { timeout: LAZY_ROUTE_MS },
    );
  });

  it('titles the administrator’s personal page as preferences, distinct from Platform Settings', async () => {
    const router = await signInAs('admin@medora.health');
    await waitFor(
      () => {
        expect(router.state.location.pathname.startsWith(routes.admin.root)).toBe(true);
      },
      { timeout: LAZY_ROUTE_MS },
    );

    await router.navigate(`${preferences}/account`);

    expect(
      await screen.findByRole('heading', { name: 'My Preferences' }, { timeout: LAZY_ROUTE_MS }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument();
    // The caption names where the other destination lives, so neither page
    // reads as the only "Settings".
    expect(screen.getByText(/Platform-wide configuration is under Settings/)).toBeInTheDocument();
  });

  it('still gives a doctor the professional profile', async () => {
    const router = await signInAs('doctor@medora.health');
    await waitFor(
      () => {
        expect(router.state.location.pathname.startsWith('/doctor')).toBe(true);
      },
      { timeout: LAZY_ROUTE_MS },
    );

    await router.navigate(routes.doctor.settings('profile'));

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Profile' }, { timeout: LAZY_ROUTE_MS }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(routes.doctor.settings('profile'));
  });
});

describe('Reception appointment oversight', () => {
  it('offers reminders and reassignment but no administrative cancel', async () => {
    const router = await signInAs('reception@medora.health');
    await screen.findByRole('heading', { level: 1, name: 'Reception' }, { timeout: LAZY_ROUTE_MS });

    await router.navigate(routes.reception.appointments);

    await waitFor(
      () => {
        expect(screen.getAllByRole('button', { name: /actions for/i }).length).toBeGreaterThan(0);
      },
      { timeout: LAZY_ROUTE_MS },
    );
    // A terminal appointment offers only "View detail"; the check has to be
    // made on one that is still open — the first whose menu offers Reassign.
    const user = userEvent.setup();
    let found = false;
    for (const menu of screen.getAllByRole('button', { name: /actions for/i })) {
      await user.click(menu);
      if (screen.queryByRole('menuitem', { name: 'Reassign' }) !== null) {
        found = true;
        break;
      }
      await user.keyboard('{Escape}');
    }
    expect(found).toBe(true);
    expect(screen.queryByRole('menuitem', { name: /cancel/i })).not.toBeInTheDocument();
  });
});

/**
 * Queue and Waiting Room belong to the reception sidebar (they left the admin
 * one). Reception opens them at its own paths, rendered by the admin area's
 * existing screens through the same demo/live loader — the seeded demo here,
 * "Not connected yet" in a live build (`features/admin/live-posture.test.tsx`).
 * Every other role is refused both paths by the reception workspace's role
 * guard, the existing 403. An administrator keeps the admin pages by URL.
 *
 * jsdom has no viewport, so the shell draws its phone layout: the bottom bar,
 * whose "More" opens the full sidebar in a drawer — which is where these two
 * live on a phone (the desktop sidebar is `AppSidebar.test.tsx`'s).
 */
describe('Reception Queue and Waiting Room', () => {
  /** Opens the phone drawer and returns its sidebar. */
  async function drawerNav() {
    await userEvent.setup().click(screen.getByRole('button', { name: 'More' }));
    const dialog = await screen.findByRole('dialog', { name: 'Navigation' });
    return within(within(dialog).getByRole('navigation', { name: 'Main' }));
  }

  it.each([
    { path: routes.reception.queue, heading: 'Queue Management', item: 'Queue' },
    { path: routes.reception.waitingRoom, heading: 'Waiting Room', item: 'Waiting Room' },
  ])('opens $path, lit as the current page in the sidebar', async ({ path, heading, item }) => {
    const router = await signInAs('reception@medora.health');
    await screen.findByRole('heading', { level: 1, name: 'Reception' }, { timeout: LAZY_ROUTE_MS });

    await router.navigate(path);

    expect(
      await screen.findByRole('heading', { level: 1, name: heading }, { timeout: LAZY_ROUTE_MS }),
    ).toBeInTheDocument();
    expect(screen.queryByText("You don't have access to this page")).not.toBeInTheDocument();
    const nav = await drawerNav();
    expect(nav.getByRole('link', { name: item })).toHaveAttribute('href', path);
    expect(nav.getByRole('link', { name: item })).toHaveAttribute('aria-current', 'page');
  });

  it('lists both in the reception sidebar, after Appointments, with the rest unchanged', async () => {
    await signInAs('reception@medora.health');
    await screen.findByRole('heading', { level: 1, name: 'Reception' }, { timeout: LAZY_ROUTE_MS });

    const nav = await drawerNav();
    expect(nav.getAllByRole('link').map((link) => link.textContent?.trim())).toEqual([
      'Overview',
      'Appointments',
      'Queue',
      'Waiting Room',
      'Patients',
      'Settings',
    ]);
  });

  it('follows back and forward between the two', async () => {
    const router = await signInAs('reception@medora.health');
    await screen.findByRole('heading', { level: 1, name: 'Reception' }, { timeout: LAZY_ROUTE_MS });

    await router.navigate(routes.reception.queue);
    await screen.findByRole(
      'heading',
      { level: 1, name: 'Queue Management' },
      { timeout: LAZY_ROUTE_MS },
    );
    await router.navigate(routes.reception.waitingRoom);
    await screen.findByRole(
      'heading',
      { level: 1, name: 'Waiting Room' },
      { timeout: LAZY_ROUTE_MS },
    );

    await router.navigate(-1);
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: 'Queue Management' },
        { timeout: LAZY_ROUTE_MS },
      ),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(routes.reception.queue);

    await router.navigate(1);
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: 'Waiting Room' },
        { timeout: LAZY_ROUTE_MS },
      ),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(routes.reception.waitingRoom);
  });

  it.each([
    'lab@medora.health',
    'pharmacy@medora.health',
    'doctor@medora.health',
    'admin@medora.health',
  ])('refuses %s both reception paths with the existing 403', async (email) => {
    const router = await signInAs(email);
    await waitFor(
      () => {
        expect(router.state.location.pathname).not.toBe(routes.login);
      },
      { timeout: LAZY_ROUTE_MS },
    );

    for (const path of [routes.reception.queue, routes.reception.waitingRoom]) {
      await router.navigate(path);
      expect(
        await screen.findByText("You don't have access to this page", undefined, {
          timeout: LAZY_ROUTE_MS,
        }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('heading', { level: 1, name: 'Queue Management' })).toBeNull();
    }
  });

  it('drops both from the admin sidebar, and leaves the admin pages reachable by URL', async () => {
    const router = await signInAs('admin@medora.health');
    await waitFor(
      () => {
        expect(router.state.location.pathname.startsWith(routes.admin.root)).toBe(true);
      },
      { timeout: LAZY_ROUTE_MS },
    );
    await screen.findByRole('button', { name: 'More' }, { timeout: LAZY_ROUTE_MS });
    const nav = await drawerNav();
    expect(nav.queryByRole('link', { name: 'Queue' })).not.toBeInTheDocument();
    expect(nav.queryByRole('link', { name: 'Waiting Room' })).not.toBeInTheDocument();
    for (const kept of [
      'Overview',
      'Clinic Overview',
      'Doctors',
      'Appointments',
      'Staff',
      'Rooms',
    ]) {
      expect(nav.getByRole('link', { name: kept })).toBeInTheDocument();
    }

    await router.navigate(routes.admin.section('queue'));
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: 'Queue Management' },
        { timeout: LAZY_ROUTE_MS },
      ),
    ).toBeInTheDocument();
    await router.navigate(routes.admin.section('waiting-room'));
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: 'Waiting Room' },
        { timeout: LAZY_ROUTE_MS },
      ),
    ).toBeInTheDocument();
  });
});

/**
 * Routes are capability-guarded to match the sidebar: an administrator who
 * revokes a permission from a staff role closes the deep link and removes the
 * home card, not only the nav item. The revocation is simulated the way the
 * session would carry it — the permissions on the signed-in user.
 */
describe('Capability-gated staff routes', () => {
  const DENIED = "You don't have access to this page";

  // The sign-in resolves after the click returns, so the seeded record is
  // restored once the test is over, not straight after `signInAs`.
  const restore: (() => void)[] = [];
  afterEach(() => {
    while (restore.length > 0) restore.pop()?.();
  });

  async function signInWithout(email: string, revoked: Permission) {
    const record = findUser(email);
    if (record === undefined) throw new Error('unknown seeded user ' + email);
    const original = record.permissions;
    const mutable = record as { permissions: readonly Permission[] };
    mutable.permissions = original.filter((p) => p !== revoked);
    restore.push(() => {
      mutable.permissions = original;
    });
    return signInAs(email);
  }

  const CASES = [
    {
      email: 'reception@medora.health',
      title: 'Reception',
      path: routes.reception.appointments,
      permission: 'appointments.reassign' as const,
      heading: 'Appointments',
      card: 'Appointment oversight',
    },
    {
      email: 'reception@medora.health',
      title: 'Reception',
      path: routes.reception.patients,
      permission: 'patients.view' as const,
      heading: 'Patient directory',
      card: 'Patient directory',
    },
    {
      email: 'lab@medora.health',
      title: 'Laboratory',
      path: routes.laboratory.catalogue,
      permission: 'labs.review' as const,
      heading: 'Test catalogue',
      card: 'Test catalogue',
    },
    {
      email: 'lab@medora.health',
      title: 'Laboratory',
      path: routes.laboratory.patients,
      permission: 'patients.view' as const,
      heading: 'Patient directory',
      card: 'Patient directory',
    },
    {
      email: 'pharmacy@medora.health',
      title: 'Pharmacy',
      path: routes.pharmacy.patients,
      permission: 'patients.view' as const,
      heading: 'Patient directory',
      card: 'Patient directory',
    },
  ];

  describe.each(CASES)('$title $path', ({ email, title, path, permission, heading, card }) => {
    it(`renders while ${permission} is held`, async () => {
      const router = await signInAs(email);
      await screen.findByRole('heading', { level: 1, name: title }, { timeout: LAZY_ROUTE_MS });
      expect(screen.getByRole('heading', { level: 3, name: card })).toBeInTheDocument();

      await router.navigate(path);

      expect(
        await screen.findByRole('heading', { name: heading }, { timeout: LAZY_ROUTE_MS }),
      ).toBeInTheDocument();
      expect(screen.queryByText(DENIED)).not.toBeInTheDocument();
    });

    it(`is denied, and its home card is gone, once ${permission} is revoked`, async () => {
      const router = await signInWithout(email, permission);
      await screen.findByRole('heading', { level: 1, name: title }, { timeout: LAZY_ROUTE_MS });
      expect(screen.queryByRole('heading', { level: 3, name: card })).not.toBeInTheDocument();

      await router.navigate(path);

      expect(
        await screen.findByText(DENIED, undefined, { timeout: LAZY_ROUTE_MS }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: heading })).not.toBeInTheDocument();
    });
  });

  it('flips an open gated page to the 403 when a session refresh returns fewer permissions', async () => {
    const router = await signInAs('lab@medora.health');
    await screen.findByRole('heading', { level: 1, name: 'Laboratory' }, { timeout: LAZY_ROUTE_MS });
    await router.navigate(routes.laboratory.catalogue);
    await screen.findByRole('heading', { name: 'Test catalogue' }, { timeout: LAZY_ROUTE_MS });
    expect(screen.queryByText(DENIED)).not.toBeInTheDocument();

    // The administrator revokes `labs.review`; the server's next refresh
    // answers with the reduced set. The mock's refresh reads its persisted
    // snapshot, so that is what is rewritten — the provider is not touched.
    for (const storage of [window.localStorage, window.sessionStorage]) {
      const raw = storage.getItem('medora.session');
      if (raw === null) continue;
      const snapshot = JSON.parse(raw) as { user: { permissions: string[] } };
      snapshot.user.permissions = snapshot.user.permissions.filter((p) => p !== 'labs.review');
      storage.setItem('medora.session', JSON.stringify(snapshot));
    }
    // Then the app's own path: a 401 on any API call runs the registered
    // refresh handler, which re-reads the session and sets the user.
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(new Response('{}', { status: 401 })),
    );
    await apiClient.get('/me/ping').catch(() => undefined);

    expect(
      await screen.findByText(DENIED, undefined, { timeout: LAZY_ROUTE_MS }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Test catalogue' })).not.toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('keeps the reception home truthful about the queue and waiting room', async () => {
    await signInAs('reception@medora.health');
    await screen.findByRole('heading', { level: 1, name: 'Reception' }, { timeout: LAZY_ROUTE_MS });

    expect(
      screen.getByText(/not connected to live data yet; where they are shown they are read-only/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/no check-in or waiting-room service/)).not.toBeInTheDocument();
  });
});

describe('Queue and Waiting Room controls follow the role the server admits for writes', () => {
  it('shows reception the boards but no mutation control', async () => {
    const router = await signInAs('reception@medora.health');
    await screen.findByRole('heading', { level: 1, name: 'Reception' }, { timeout: LAZY_ROUTE_MS });

    await router.navigate(routes.reception.queue);
    await screen.findByRole('heading', { level: 1, name: 'Queue Management' }, { timeout: LAZY_ROUTE_MS });
    expect(await screen.findAllByText(/^Est\. wait$/, undefined, { timeout: LAZY_ROUTE_MS })).not.toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Call next patient' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Move ticket/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /from the queue$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /^Priority for ticket/ })).not.toBeInTheDocument();

    await router.navigate(routes.reception.waitingRoom);
    await screen.findByRole('heading', { level: 1, name: 'Waiting Room' }, { timeout: LAZY_ROUTE_MS });
    await screen.findByText('Checked in', undefined, { timeout: LAZY_ROUTE_MS });
    expect(screen.queryByRole('button', { name: 'Check in patient' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Check out/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(Call|Seat in room)$/ })).not.toBeInTheDocument();
  });

  it('still gives an administrator every control', async () => {
    const router = await signInAs('admin@medora.health');
    await waitFor(
      () => {
        expect(router.state.location.pathname.startsWith(routes.admin.root)).toBe(true);
      },
      { timeout: LAZY_ROUTE_MS },
    );

    await router.navigate(routes.admin.section('queue'));
    expect(
      await screen.findByRole('button', { name: 'Call next patient' }, { timeout: LAZY_ROUTE_MS }),
    ).toBeInTheDocument();
    expect((await screen.findAllByRole('button', { name: /^Move ticket/ })).length).toBeGreaterThan(0);

    await router.navigate(routes.admin.section('waiting-room'));
    expect(
      await screen.findByRole('button', { name: 'Check in patient' }, { timeout: LAZY_ROUTE_MS }),
    ).toBeInTheDocument();
    expect((await screen.findAllByRole('button', { name: /^Check out/ })).length).toBeGreaterThan(0);
  });
});
