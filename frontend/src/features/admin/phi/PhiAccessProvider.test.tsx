import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Permission } from '@/types/auth';

import { administrationApi } from '../api/administration.api';

import { MaskedIdentifier } from './MaskedIdentifier';
import { PhiAccessProvider } from './PhiAccessProvider';

/**
 * The PHI gate end to end (ADM-10 · UX §1.5.1, §1.5.6).
 *
 * The claim being tested is not "a mask renders" — it is that a patient
 * identifier cannot reach the screen without a capability, a justification,
 * AND a successful audit write, and that it re-masks itself afterwards. The
 * real service is used so the audit write is a real write.
 */

const granted: Permission[] = ['patients.revealIdentity'];
const toasts: { title: string }[] = [];

vi.mock('@/app/providers', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Marcus Reed', email: 'admin@medora.health' } }),
  useCan: () => (permission: Permission) => granted.includes(permission),
  useToast: () => ({
    toast: (entry: { title: string }) => {
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
  granted.splice(0, granted.length, 'patients.revealIdentity');
});

function renderGate() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  function Tree({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(
    <Tree>
      <PhiAccessProvider>
        <MaskedIdentifier
          subjectId="q-1"
          subjectLabel="Queue ticket A-104"
          kind="name"
          value="Ahmed Mansour"
        />
        <MaskedIdentifier
          subjectId="q-1"
          subjectLabel="Queue ticket A-104"
          kind="phone"
          value="+1 (555) 018-4402"
        />
        <MaskedIdentifier
          subjectId="q-2"
          subjectLabel="Queue ticket A-105"
          kind="name"
          value="Sara Okafor"
        />
      </PhiAccessProvider>
    </Tree>,
  );
}

async function justify(
  user: ReturnType<typeof userEvent.setup>,
  reason = 'Confirming before reassignment',
) {
  await user.click(
    screen.getByRole('button', { name: /Reveal patient name for Queue ticket A-104/ }),
  );
  const dialog = await screen.findByRole('alertdialog');
  await user.click(within(dialog).getByRole('radio', { name: /Safety investigation/ }));
  await user.type(within(dialog).getByRole('textbox'), reason);
  await user.click(within(dialog).getByRole('button', { name: /Reveal and log/ }));
}

describe('masked by default', () => {
  it('shows the mask, never the value, on first render', () => {
    renderGate();

    expect(screen.getByText('Ah••• M•••')).toBeInTheDocument();
    expect(screen.queryByText('Ahmed Mansour')).not.toBeInTheDocument();
    expect(screen.getByText('••• ••• 4402')).toBeInTheDocument();
  });

  it('announces the masked state rather than leaving bullets to a screen reader', () => {
    renderGate();

    // Both name fields on screen carry the state in text, not only in bullets.
    expect(screen.getAllByText(/Patient name, masked/)).toHaveLength(2);
  });
});

describe('without the capability', () => {
  it('offers no reveal control at all', () => {
    granted.length = 0;
    renderGate();

    expect(screen.queryByRole('button', { name: /Reveal/ })).not.toBeInTheDocument();
    expect(screen.getAllByText(/Revealing is not permitted for your role/).length).toBe(3);
  });
});

describe('the justification gate', () => {
  it('does not reveal anything just by opening the prompt', async () => {
    const user = userEvent.setup();
    renderGate();

    await user.click(
      screen.getByRole('button', { name: /Reveal patient name for Queue ticket A-104/ }),
    );

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.queryByText('Ahmed Mansour')).not.toBeInTheDocument();
  });

  it('refuses a reason too short to be reviewable', async () => {
    const user = userEvent.setup();
    renderGate();

    await justify(user, 'because');

    expect(await screen.findByText(/at least 12 characters/)).toBeInTheDocument();
    expect(screen.queryByText('Ahmed Mansour')).not.toBeInTheDocument();
  });

  it('keeps the value masked when the prompt is dismissed', async () => {
    const user = userEvent.setup();
    renderGate();

    await user.click(
      screen.getByRole('button', { name: /Reveal patient name for Queue ticket A-104/ }),
    );
    await user.click(await screen.findByRole('button', { name: 'Keep masked' }));

    expect(screen.getByText('Ah••• M•••')).toBeInTheDocument();
    expect(screen.queryByText('Ahmed Mansour')).not.toBeInTheDocument();
  });

  it('starts every prompt clean rather than carrying the last reason over', async () => {
    const user = userEvent.setup();
    renderGate();

    await user.click(
      screen.getByRole('button', { name: /Reveal patient name for Queue ticket A-104/ }),
    );
    await user.type(await screen.findByRole('textbox'), 'a reason for this one');
    await user.click(screen.getByRole('button', { name: 'Keep masked' }));

    await user.click(
      screen.getByRole('button', { name: /Reveal patient name for Queue ticket A-105/ }),
    );

    expect(await screen.findByRole('textbox')).toHaveValue('');
  });
});

describe('a justified reveal', () => {
  it('unmasks the record and writes the access to the log', async () => {
    const user = userEvent.setup();
    renderGate();

    await justify(user);

    expect(await screen.findByText('Ahmed Mansour')).toBeInTheDocument();

    const log = await administrationApi.phiAccess.list();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      actor: 'Marcus Reed',
      subjectId: 'q-1',
      subjectLabel: 'Queue ticket A-104',
      category: 'safety-investigation',
      reason: 'Confirming before reassignment',
    });
  });

  it('unmasks every field of that record, not only the one clicked', async () => {
    const user = userEvent.setup();
    renderGate();

    await justify(user);

    expect(await screen.findByText('Ahmed Mansour')).toBeInTheDocument();
    expect(screen.getByText('+1 (555) 018-4402')).toBeInTheDocument();
  });

  it('leaves other records masked — one justification is not a blanket one', async () => {
    const user = userEvent.setup();
    renderGate();

    await justify(user);
    await screen.findByText('Ahmed Mansour');

    expect(screen.getByText('Sa••• O•••')).toBeInTheDocument();
    expect(screen.queryByText('Sara Okafor')).not.toBeInTheDocument();
  });

  it('can be re-masked immediately, and the log entry stands', async () => {
    const user = userEvent.setup();
    renderGate();

    await justify(user);
    await screen.findByText('Ahmed Mansour');

    await user.click(
      screen.getByRole('button', { name: /Hide patient name for Queue ticket A-104/ }),
    );

    expect(screen.getByText('Ah••• M•••')).toBeInTheDocument();
    await expect(administrationApi.phiAccess.list()).resolves.toHaveLength(1);
  });

  it('surfaces in the audit feed alongside the seeded platform events', async () => {
    const user = userEvent.setup();
    renderGate();

    await justify(user);
    await screen.findByText('Ahmed Mansour');

    const events = await administrationApi.getAuditEvents();
    const reveal = events.find((event) => event.action === 'Revealed patient identifiers');

    expect(reveal).toBeDefined();
    expect(reveal?.actor).toBe('Marcus Reed');
    expect(reveal?.severity).toBe('warning');
    expect(reveal?.target).toContain('Queue ticket A-104');
    expect(reveal?.target).toContain('Safety investigation');
    // The log entry names the record, never the patient.
    expect(reveal?.target).not.toContain('Ahmed');
  });

  it('survives a reload as a log entry — while the elevation itself does not', async () => {
    const user = userEvent.setup();
    const { unmount } = renderGate();

    await justify(user);
    await screen.findByText('Ahmed Mansour');

    unmount();
    renderGate();

    // Re-masked: an elevation is never restored from storage.
    expect(screen.getByText('Ah••• M•••')).toBeInTheDocument();
    expect(screen.queryByText('Ahmed Mansour')).not.toBeInTheDocument();
    // But the access is still on the record.
    await expect(administrationApi.phiAccess.list()).resolves.toHaveLength(1);
  });
});

describe('when the audit write fails', () => {
  it('reveals nothing and says so', async () => {
    const user = userEvent.setup();
    vi.spyOn(administrationApi.phiAccess, 'record').mockRejectedValueOnce(new Error('offline'));
    renderGate();

    await justify(user);

    expect(
      await screen.findByText(/could not be logged, so nothing was revealed/),
    ).toBeInTheDocument();
    expect(screen.queryByText('Ahmed Mansour')).not.toBeInTheDocument();
    expect(screen.getByText('Ah••• M•••')).toBeInTheDocument();
  });
});

describe('elevation lifetime', () => {
  it('re-masks on its own once the window closes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    try {
      renderGate();
      await justify(user);
      await screen.findByText('Ahmed Mansour');

      await vi.advanceTimersByTimeAsync(16 * 60_000);

      await waitFor(() => {
        expect(screen.getByText('Ah••• M•••')).toBeInTheDocument();
      });
      expect(screen.queryByText('Ahmed Mansour')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
