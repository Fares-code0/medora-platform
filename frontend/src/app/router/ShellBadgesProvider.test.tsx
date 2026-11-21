import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useShellBadges } from '@/layouts';

import { ShellBadgesProvider } from './ShellBadgesProvider';

/**
 * The admin "pending requests" badge (FE-10.10): the doctors service's count
 * of verifications waiting on an administrator — never a constant, never
 * asked for outside the admin shell, and nothing at all when the count
 * cannot be read.
 */

const session = { role: 'admin' as 'admin' | 'doctor' };
const pendingVerifications = vi.fn<() => Promise<number>>();

vi.mock('@/app/providers', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Marcus Reed', role: session.role } }),
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/features/admin/doctors/api/service', () => ({
  doctorsService: { pendingVerifications: () => pendingVerifications() },
}));

beforeEach(() => {
  pendingVerifications.mockReset();
  session.role = 'admin';
});

function Count() {
  const { counts } = useShellBadges();
  return <p>pending: {counts.pendingRequests}</p>;
}

function renderBadge() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <ShellBadgesProvider>
        <Count />
      </ShellBadgesProvider>
    </QueryClientProvider>,
  );
}

describe('the pending-requests badge', () => {
  it('shows the service’s count for an administrator', async () => {
    pendingVerifications.mockResolvedValue(3);
    renderBadge();
    expect(screen.getByText('pending: 0')).toBeInTheDocument();
    expect(await screen.findByText('pending: 3')).toBeInTheDocument();
  });

  it('is not asked for in a doctor’s shell', async () => {
    session.role = 'doctor';
    pendingVerifications.mockResolvedValue(3);
    renderBadge();
    await waitFor(() => expect(screen.getByText('pending: 0')).toBeInTheDocument());
    expect(pendingVerifications).not.toHaveBeenCalled();
  });

  it('shows nothing, not a stand-in number, when the count cannot be read', async () => {
    pendingVerifications.mockRejectedValue(new Error('down'));
    renderBadge();
    await waitFor(() => expect(pendingVerifications).toHaveBeenCalled());
    expect(screen.getByText('pending: 0')).toBeInTheDocument();
  });
});
