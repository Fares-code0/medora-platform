import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { PRACTITIONER_SETTINGS_SECTIONS, STAFF_SETTINGS_SECTIONS } from '@/routes';
import { envelope, json, pageOf, stubApi } from '@/test/api-stub';

import { SETTINGS_SECTIONS, type SettingsSection } from './model/types';
import { SettingsPage } from './pages/SettingsPage';

/**
 * Settings → Security over the API for every workspace that renders it
 * (NEW-38). The Security section is one component, and the administrator's
 * My Settings (`/admin/preferences/:section`) and the staff workspaces
 * (DEC-006a) mount the same `SettingsPage`, so the recovery-code count and
 * authenticator re-enrolment reach every role that has a second factor —
 * administrators above all, for whom it is required (ADR-035 §7).
 *
 * The adapter is the real HTTP one over recorded `/me/*` shapes: these are
 * mocked-response tests, not a live run.
 */

vi.mock('./service', async () => {
  const { httpSettingsService } = await import('./http/http-settings-service');
  return { settingsService: httpSettingsService };
});

const auth = vi.hoisted(() => ({
  user: { id: 'u-1', name: 'Amelia Chen', email: 'admin@medora.health', role: 'admin' },
}));

vi.mock('@/app/providers', () => ({
  useAuth: () => ({ user: auth.user, logout: vi.fn() }),
  useDoctorProfile: () => ({ profile: { fullName: 'Amelia Chen' } }),
  useToast: () => ({ toast: vi.fn() }),
}));

beforeAll(() => {
  const proto = window.HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto['showModal'] = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  proto['close'] = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function accountRoutes(twoFactorEnabled: boolean) {
  return {
    'GET /me/account': () =>
      envelope({
        email: auth.user.email,
        username: null,
        phone: '+20 100 000 0000',
        passwordUpdatedAt: '2026-10-04T15:52:32.384Z',
        twoFactorEnabled,
        emailVerified: true,
      }),
    'GET /me/sessions': () => envelope([]),
    'GET /me/devices': () => envelope([]),
    'GET /me/login-history': () => pageOf([]),
    'GET /me/activity': () => pageOf([]),
    'GET /me/settings': () => json({ message: 'Cannot GET', code: 'not_found' }, 404),
  };
}

const ALL = SETTINGS_SECTIONS.map((meta) => meta.id);

/** The three ways the app mounts the page, as `app/router/index.tsx` does. */
const WORKSPACES: readonly {
  name: string;
  role: string;
  base: string;
  sections: readonly SettingsSection[] | undefined;
}[] = [
  { name: 'doctor Settings', role: 'doctor', base: '/doctor/settings', sections: undefined },
  {
    name: 'administrator My Settings',
    role: 'admin',
    base: '/admin/preferences',
    sections: ALL.filter((id) => !PRACTITIONER_SETTINGS_SECTIONS.includes(id)),
  },
  {
    name: 'reception Settings',
    role: 'reception',
    base: '/reception/settings',
    sections: STAFF_SETTINGS_SECTIONS,
  },
];

function renderSecurity(base: string, sections: readonly SettingsSection[] | undefined) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrap = (ui: ReactNode) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`${base}/security`]}>
        <Routes>
          <Route path={`${base}/:section`} element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  render(
    wrap(
      <SettingsPage
        buildSectionPath={(section) => `${base}/${section}`}
        {...(sections === undefined ? {} : { sections: [...sections] })}
      />,
    ),
  );
}

describe.each(WORKSPACES)('Security in the $name', ({ role, base, sections }) => {
  beforeEach(() => {
    auth.user = { ...auth.user, role };
  });

  it('shows the recovery codes the server says are left, and offers re-enrolment', async () => {
    stubApi({
      ...accountRoutes(true),
      'GET /me/2fa': () => envelope({ enabled: true, recoveryCodesRemaining: 7 }),
    });
    renderSecurity(base, sections);

    expect(await screen.findByText('Recovery codes')).toBeInTheDocument();
    expect(screen.getByText('7 left')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replace…' })).toBeInTheDocument();
  });

  it('warns when the codes run low, and says how to get a new set', async () => {
    stubApi({
      ...accountRoutes(true),
      'GET /me/2fa': () => envelope({ enabled: true, recoveryCodesRemaining: 0 }),
    });
    renderSecurity(base, sections);

    expect(await screen.findByText('0 left')).toBeInTheDocument();
    expect(
      screen.getByText(/None left\. .*Replace the app to get a new set\./),
    ).toBeInTheDocument();
  });

  it('offers neither against an API that does not serve the count', async () => {
    stubApi({
      ...accountRoutes(true),
      'GET /me/2fa': () => json({ message: 'Cannot GET', code: 'not_found' }, 404),
    });
    renderSecurity(base, sections);

    expect(await screen.findByText('Authenticator app')).toBeInTheDocument();
    expect(screen.queryByText('Recovery codes')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Replace…' })).not.toBeInTheDocument();
  });

  it('offers neither when two-factor is off', async () => {
    stubApi({
      ...accountRoutes(false),
      'GET /me/2fa': () => envelope({ enabled: false, recoveryCodesRemaining: 0 }),
    });
    renderSecurity(base, sections);

    expect(await screen.findByText('Authenticator app')).toBeInTheDocument();
    expect(screen.queryByText('Recovery codes')).not.toBeInTheDocument();
  });
});

describe('re-enrolment from the administrator My Settings', () => {
  beforeEach(() => {
    auth.user = { ...auth.user, role: 'admin' };
  });

  it('replaces the factor over the two routes and re-reads the count', async () => {
    let remaining = 1;
    const { requests } = stubApi({
      ...accountRoutes(true),
      'GET /me/2fa': () => envelope({ enabled: true, recoveryCodesRemaining: remaining }),
      'POST /me/2fa/reenroll': () =>
        envelope({
          otpauthUrl: 'otpauth://totp/Medora:admin?secret=NEWSECRETNEWSECR',
          secret: 'NEWSECRETNEWSECR',
          enrolmentToken: 'enrol.jwt.token',
        }),
      'POST /me/2fa/reenroll/confirm': () => {
        remaining = 10;
        return envelope({ recoveryCodes: ['0a1b2-c3d4e', '5f6a7-b8c9d'] });
      },
    });
    const user = userEvent.setup();
    const admin = WORKSPACES[1];
    if (admin === undefined) throw new Error('admin workspace missing');
    renderSecurity(admin.base, admin.sections);

    expect(await screen.findByText('1 left')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Replace…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Replace your authenticator app' });
    await user.type(within(dialog).getByLabelText('Your password'), 'Medora123!');
    await user.type(within(dialog).getByLabelText(/Code from your current app/), '111111');
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));

    await user.type(await within(dialog).findByLabelText(/Code from the new app/), '222222');
    await user.click(within(dialog).getByRole('button', { name: 'Replace authenticator' }));

    expect(await within(dialog).findByText('0a1b2-c3d4e')).toBeInTheDocument();
    expect(await screen.findByText('10 left')).toBeInTheDocument();
    expect(
      requests
        .filter((request) => request.method === 'POST')
        .map((request) => [request.path, request.body]),
    ).toEqual([
      ['/me/2fa/reenroll', { password: 'Medora123!', code: '111111' }],
      ['/me/2fa/reenroll/confirm', { enrolmentToken: 'enrol.jwt.token', code: '222222' }],
    ]);
  });
});
