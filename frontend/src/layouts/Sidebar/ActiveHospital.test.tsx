import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readActiveHospital } from '@/api/endpoints/session';
import type * as Env from '@/configs/env';
import { envelope, json, stubApi } from '@/test/api-stub';

import { ActiveHospital } from './ActiveHospital';
import { activeHospitalKeys } from './useActiveHospital';

/**
 * WEB-1 — the doctor's active hospital, read from `GET /auth/session` and
 * shown read-only. Driven through the real `ApiClient` with only `fetch`
 * stubbed; the mock/live seam is flipped through `env.enableMocks`.
 */

const mode = vi.hoisted(() => ({ mocks: false }));
const auth = vi.hoisted(
  (): { status: string; user: { id: string; name: string; role: string } | null } => ({
    status: 'authenticated',
    user: null,
  }),
);

vi.mock('@/configs/env', async (importOriginal) => {
  const actual: typeof Env = await importOriginal();
  return {
    ...actual,
    env: {
      ...actual.env,
      get enableMocks() {
        return mode.mocks;
      },
    },
  };
});

vi.mock('@/app/providers', () => ({
  useAuth: () => ({ status: auth.status, user: auth.user }),
}));

afterEach(() => {
  mode.mocks = false;
  auth.status = 'authenticated';
  auth.user = null;
  vi.unstubAllGlobals();
});

const DOCTOR_A = { id: 'doctor-a', name: 'Amelia Chen', role: 'doctor' };
const DOCTOR_B = { id: 'doctor-b', name: 'Omar Haddad', role: 'doctor' };

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderIndicator(client: QueryClient = newClient()) {
  const view = render(
    <QueryClientProvider client={client}>
      <ActiveHospital />
    </QueryClientProvider>,
  );
  return { ...view, client };
}

function sessionBody(activeHospital: unknown, extra: Record<string, unknown> = {}) {
  return envelope({
    id: 'doctor-a',
    name: 'Amelia Chen',
    email: 'amelia@example.test',
    role: 'doctor',
    permissions: [],
    activeHospital,
    adminScope: null,
    ...extra,
  });
}

async function settled(client: QueryClient, userId: string) {
  await waitFor(() => {
    const state = client.getQueryState(activeHospitalKeys.forUser(userId));
    expect(state?.status === 'success' || state?.status === 'error').toBe(true);
  });
}

describe('ActiveHospital (WEB-1)', () => {
  it('shows the active hospital name for a doctor, labelled and direction-neutral', async () => {
    auth.user = DOCTOR_A;
    const api = stubApi({
      'GET /auth/session': () => sessionBody({ id: 'h-1', name: 'مستشفى النور' }),
    });
    renderIndicator();

    const name = await screen.findByText('مستشفى النور');
    expect(name).toHaveAttribute('dir', 'auto');
    expect(name.parentElement).toHaveTextContent('Active hospital: مستشفى النور');
    expect(api.requests.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /auth/session']);
    expect(api.unmatched).toEqual([]);
  });

  it('offers no way to change it — nothing interactive is rendered', async () => {
    auth.user = DOCTOR_A;
    stubApi({ 'GET /auth/session': () => sessionBody({ id: 'h-1', name: 'Al Noor Hospital' }) });
    const { container } = renderIndicator();

    await screen.findByText('Al Noor Hospital');
    for (const role of ['button', 'link', 'combobox', 'listbox', 'menu', 'option']) {
      expect(screen.queryAllByRole(role)).toHaveLength(0);
    }
    expect(container.querySelector('[tabindex], input, select, a, button')).toBeNull();
  });

  it.each([
    ['null', null],
    ['an empty id', { id: '', name: 'Al Noor Hospital' }],
    ['a blank name', { id: 'h-1', name: '   ' }],
    ['a numeric id', { id: 7, name: 'Al Noor Hospital' }],
    ['a missing name', { id: 'h-1' }],
    ['a string', 'Al Noor Hospital'],
    ['an array', [{ id: 'h-1', name: 'Al Noor Hospital' }]],
  ])('renders nothing when activeHospital is %s', async (_label, activeHospital) => {
    auth.user = DOCTOR_A;
    stubApi({ 'GET /auth/session': () => sessionBody(activeHospital) });
    const { container, client } = renderIndicator();

    await settled(client, DOCTOR_A.id);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/Al Noor/)).not.toBeInTheDocument();
  });

  it('never renders the admin scope, even when one is present', async () => {
    auth.user = DOCTOR_A;
    stubApi({
      'GET /auth/session': () =>
        sessionBody(null, {
          adminScope: { type: 'hospital', hospital: { id: 'h-9', name: 'Scope Hospital' } },
        }),
    });
    const { container, client } = renderIndicator();

    await settled(client, DOCTOR_A.id);
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ['a server error', () => json({ code: 'internal' }, 500)],
    ['a forbidden answer', () => json({ code: 'forbidden' }, 403)],
    ['a body without the envelope', () => ({ activeHospital: { id: 'h-1', name: 'X' } })],
  ])('renders nothing on %s', async (_label, answer) => {
    auth.user = DOCTOR_A;
    stubApi({ 'GET /auth/session': answer });
    const { container, client } = renderIndicator();

    await settled(client, DOCTOR_A.id);
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ['reception', 'authenticated'],
    ['pharmacy', 'authenticated'],
    ['admin', 'authenticated'],
    ['doctor', 'booting'],
    ['doctor', 'locked'],
    ['doctor', 'unauthenticated'],
  ])('never asks for a %s session that is %s', async (role, status) => {
    auth.user = { id: `${role}-1`, name: 'Someone', role };
    auth.status = status;
    const api = stubApi({
      'GET /auth/session': () => sessionBody({ id: 'h-1', name: 'Al Noor Hospital' }),
    });
    const { container } = renderIndicator();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.requests).toHaveLength(0);
    expect(container).toBeEmptyDOMElement();
  });

  it('never asks in mock mode, and invents no hospital there', async () => {
    mode.mocks = true;
    auth.user = DOCTOR_A;
    const api = stubApi({
      'GET /auth/session': () => sessionBody({ id: 'h-1', name: 'Al Noor Hospital' }),
    });
    const { container } = renderIndicator();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.requests).toHaveLength(0);
    expect(container).toBeEmptyDOMElement();
  });

  it('keys the answer by user, so a second doctor never sees the first one’s hospital', async () => {
    expect(activeHospitalKeys.forUser('doctor-a')).toContain('doctor-a');

    const client = newClient();
    auth.user = DOCTOR_A;
    const api = stubApi({
      'GET /auth/session': () =>
        auth.user?.id === DOCTOR_A.id
          ? sessionBody({ id: 'h-1', name: 'Al Noor Hospital' })
          : sessionBody(null),
    });
    const first = renderIndicator(client);
    await screen.findByText('Al Noor Hospital');
    first.unmount();

    auth.user = DOCTOR_B;
    const second = renderIndicator(client);
    await settled(client, DOCTOR_B.id);
    expect(second.container).toBeEmptyDOMElement();
    expect(api.requests).toHaveLength(2);
  });
});

describe('readActiveHospital', () => {
  it('reads only a well-formed activeHospital', () => {
    expect(readActiveHospital(sessionBody({ id: 'h-1', name: 'Al Noor' }))).toEqual({
      id: 'h-1',
      name: 'Al Noor',
    });
    expect(readActiveHospital(null)).toBeNull();
    expect(readActiveHospital({ data: null })).toBeNull();
    expect(readActiveHospital(sessionBody(undefined))).toBeNull();
  });
});
