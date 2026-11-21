import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetMockCustomRoles } from '../../access/mock-access-service';

import { RolesSection } from './RolesSection';

/**
 * The roles list and custom-role creation in the demo build (UX §3.9,
 * DEC-013), through the real demo adapter.
 */

const toasts: { variant?: string; title: string; description?: string }[] = [];

vi.mock('@/app/providers', () => ({
  useToast: () => ({
    toast: (entry: { variant?: string; title: string; description?: string }) => {
      toasts.push(entry);
    },
  }),
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
  toasts.length = 0;
  __resetMockCustomRoles();
});
afterEach(() => __resetMockCustomRoles());

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  function Tree({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(
    <Tree>
      <RolesSection />
    </Tree>,
  );
}

async function openDialog() {
  const user = userEvent.setup();
  // Enabled once the role list has answered — it needs the codes in use.
  await screen.findByText('Administrator');
  await user.click(screen.getByRole('button', { name: 'New custom role' }));
  return { user, dialog: within(screen.getByRole('dialog')) };
}

describe('RolesSection', () => {
  it('lists the five platform roles and says there are no custom ones', async () => {
    renderSection();
    for (const label of ['Administrator', 'Doctor', 'Reception', 'Laboratory', 'Pharmacy']) {
      expect(await screen.findByText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByText('Platform')).toHaveLength(5);
    expect(screen.getByText('No custom roles yet.')).toBeInTheDocument();
  });

  it('refuses an empty role before anything is written, with no base role pre-chosen', async () => {
    renderSection();
    const { user, dialog } = await openDialog();

    expect(dialog.getByRole('combobox', { name: 'Base role' })).toHaveTextContent(
      'Choose a base role',
    );
    await user.click(dialog.getByRole('button', { name: 'Create role' }));

    expect(dialog.getByText('Name the role')).toBeInTheDocument();
    expect(dialog.getByText('Use at least 2 characters')).toBeInTheDocument();
    // The placeholder and the error read alike; the field's state tells them apart.
    expect(dialog.getAllByText('Choose a base role')).toHaveLength(2);
    expect(dialog.getByRole('combobox', { name: 'Base role' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(toasts).toEqual([]);
  });

  it('refuses a code that is already a role', async () => {
    renderSection();
    const { user, dialog } = await openDialog();
    await user.type(dialog.getByLabelText('Name'), 'Another doctor');
    await user.type(dialog.getByLabelText('Code'), 'Doctor');
    await user.click(dialog.getByRole('combobox', { name: 'Base role' }));
    await user.click(screen.getByRole('option', { name: 'Doctor' }));
    await user.click(dialog.getByRole('button', { name: 'Create role' }));

    expect(dialog.getByText('A role with the code "doctor" already exists')).toBeInTheDocument();
    expect(toasts).toEqual([]);
  });

  it('creates a custom role, lists it with its base, and says what it cannot do yet', async () => {
    renderSection();
    const { user, dialog } = await openDialog();
    expect(dialog.getByText(/cannot sign in to this web app/)).toBeInTheDocument();
    await user.type(dialog.getByLabelText('Name'), 'Ward clerk');
    await user.type(dialog.getByLabelText('Code'), 'ward-clerk');
    await user.click(dialog.getByRole('combobox', { name: 'Base role' }));
    await user.click(screen.getByRole('option', { name: 'Reception' }));
    await user.click(dialog.getByRole('button', { name: 'Create role' }));

    const item = (await screen.findByText('Ward clerk')).closest('li') as HTMLElement;
    expect(within(item).getByText('Custom')).toBeInTheDocument();
    expect(within(item).getByText('ward-clerk')).toBeInTheDocument();
    expect(within(item).getByText(/Based on Reception/)).toBeInTheDocument();
    expect(within(item).getByText(/No web workspace yet/)).toBeInTheDocument();
    expect(screen.queryByText('No custom roles yet.')).not.toBeInTheDocument();
    expect(toasts.at(-1)).toMatchObject({ variant: 'success', title: 'Role created' });
  });
});
