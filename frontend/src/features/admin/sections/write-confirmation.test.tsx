import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '@/app/providers';
import type * as Providers from '@/app/providers';
import { DEFAULT_PERMISSION_MATRIX } from '@/features/admin/permissions';
import { PhiAccessProvider } from '@/features/admin/phi';
import { clinicOperationsApi } from '@/features/shared-domain/clinic-operations/store';
import type { SessionUser } from '@/types/auth';

import { DepartmentsSection } from './DepartmentsSection';
import { QueueSection } from './QueueSection';

/**
 * The clinic sections said a write had happened before it had: each called
 * `mutate()` and raised its success toast on the next line, so a failed
 * delete still announced "deleted" and the confirmation closed over it.
 * Now the toast follows the write, a failure says so, and a confirmation
 * stays open until the write answers.
 */

const LOAD = { timeout: 10_000 };

// The queue's write controls are shown to an administrator only, so the
// section is rendered as one; the rest of the providers are the real ones.
function adminUser(): SessionUser {
  return {
    id: 'usr_admin_test',
    name: 'Test Administrator',
    email: 'admin@medora.health',
    role: 'admin',
    permissions: DEFAULT_PERMISSION_MATRIX.admin,
  };
}

vi.mock('@/app/providers', async (importOriginal) => {
  const actual: typeof Providers = await importOriginal();
  return {
    ...actual,
    useAuth: () => ({ ...actual.useAuth(), user: adminUser() }),
  };
});

beforeAll(() => {
  const proto = window.HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto['showModal'] = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  proto['close'] = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function renderAt(path: string, element: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppProviders>
        <Routes>
          <Route path={path} element={element} />
        </Routes>
      </AppProviders>
    </MemoryRouter>,
  );
}

async function openFirstDelete() {
  const [button] = await screen.findAllByRole('button', { name: /^Delete / }, LOAD);
  if (button === undefined) throw new Error('no department to delete');
  const name = (button.getAttribute('aria-label') ?? '').replace(/^Delete /, '');
  await userEvent.click(button);
  const dialog = await screen.findByRole('alertdialog', { name: `Delete ${name}?` });
  return { name, dialog };
}

describe('clinic writes are confirmed by the write, not by the click', () => {
  it('a failed delete reports the failure, claims nothing, and keeps the dialog open', async () => {
    vi.spyOn(clinicOperationsApi.departments, 'remove').mockRejectedValue(new Error('down'));
    renderAt('/admin/departments', <DepartmentsSection />);

    const { name, dialog } = await openFirstDelete();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete department' }));

    expect(await screen.findByText(`Couldn't delete ${name}`, undefined, LOAD)).toBeInTheDocument();
    expect(screen.queryByText(`${name} deleted`)).not.toBeInTheDocument();
    expect(screen.getByRole('alertdialog', { name: `Delete ${name}?` })).toBeInTheDocument();
  });

  it('a delete that lands is announced only after it lands', async () => {
    let resolve: () => void = () => {};
    const real = clinicOperationsApi.departments.remove.bind(clinicOperationsApi.departments);
    vi.spyOn(clinicOperationsApi.departments, 'remove').mockImplementation(
      (id: string) =>
        new Promise((done) => {
          resolve = () => void real(id).then(done);
        }),
    );
    renderAt('/admin/departments', <DepartmentsSection />);

    const { name, dialog } = await openFirstDelete();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete department' }));

    expect(screen.queryByText(`${name} deleted`)).not.toBeInTheDocument();
    resolve();
    expect(await screen.findByText(`${name} deleted`, undefined, LOAD)).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByRole('alertdialog', { name: `Delete ${name}?` }),
      ).not.toBeInTheDocument(),
    );
  });

  it('calling the next patient announces nothing when the write fails', async () => {
    vi.spyOn(clinicOperationsApi.queue, 'remove').mockRejectedValue(new Error('down'));
    renderAt(
      '/admin/queue',
      <PhiAccessProvider>
        <QueueSection />
      </PhiAccessProvider>,
    );

    const call = await screen.findByRole('button', { name: 'Call next patient' }, LOAD);
    await waitFor(() => expect(call).toBeEnabled());
    await userEvent.click(call);

    expect(await screen.findByText(/^Couldn't call /, undefined, LOAD)).toBeInTheDocument();
    expect(screen.queryByText(/^Called /)).not.toBeInTheDocument();
  });
});
