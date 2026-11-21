import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '@/app/providers';

import type { TimeOffCreated } from '../model/time-off-service';
import { timeOffService } from '../service';

import { BlockTimeOffDialog } from './BlockTimeOffDialog';

/**
 * Block time off (FE-10.4, UX §2.4). The properties under test: nothing is
 * sent to patients until the doctor has seen every affected appointment and
 * chosen what happens; the count they saw is what is confirmed; and the
 * outcome reports what was skipped, not only what succeeded.
 */

const LOAD = { timeout: 5000 };

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
});

const CREATED: TimeOffCreated = {
  block: {
    id: 'toff-1',
    startsAt: '2026-10-05T08:00:00.000Z',
    endsAt: '2026-10-05T18:00:00.000Z',
    kind: 'emergency-block',
  },
  impacted: [
    {
      id: 'APT-1',
      scheduledAt: '2026-10-05T09:00:00.000Z',
      durationMin: 30,
      status: 'pending',
      patientId: 'PT-1001',
    },
    {
      id: 'APT-2',
      scheduledAt: '2026-10-05T11:00:00.000Z',
      durationMin: 30,
      status: 'scheduled',
      patientId: 'PT-1002',
    },
  ],
};

function renderDialog() {
  return render(
    <MemoryRouter>
      <AppProviders>
        <BlockTimeOffDialog open onClose={vi.fn()} />
      </AppProviders>
    </MemoryRouter>,
  );
}

describe('BlockTimeOffDialog', () => {
  it('shows the blast radius before anything is sent, then confirms the count it showed', async () => {
    vi.spyOn(timeOffService, 'createBlock').mockResolvedValue(CREATED);
    const resolve = vi.spyOn(timeOffService, 'resolve').mockResolvedValue({
      resolved: ['APT-1'],
      skipped: [{ id: 'APT-2', reason: 'scheduled → awaiting-patient is not allowed' }],
      notified: 1,
    });
    renderDialog();

    await userEvent.click(screen.getByRole('button', { name: 'Block time' }));

    expect(
      await screen.findByText('2 appointments fall inside this time', undefined, LOAD),
    ).toBeInTheDocument();
    expect(resolve).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('radio', { name: /Cancel with an apology/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Notify 2 patients' }));

    await waitFor(() => {
      expect(resolve).toHaveBeenCalledWith('toff-1', {
        action: 'cancel-apology',
        confirmedCount: 2,
      });
    });
    expect(await screen.findByText('1 handled · 1 notified', undefined, LOAD)).toBeInTheDocument();
    expect(screen.getByText('1 skipped — still need a decision')).toBeInTheDocument();
    expect(screen.getByText(/scheduled → awaiting-patient is not allowed/)).toBeInTheDocument();
  });

  it('sends nothing when the doctor leaves the appointments for now', async () => {
    vi.spyOn(timeOffService, 'createBlock').mockResolvedValue({ ...CREATED });
    const resolve = vi.spyOn(timeOffService, 'resolve');
    renderDialog();

    await userEvent.click(screen.getByRole('button', { name: 'Block time' }));
    await userEvent.click(await screen.findByRole('radio', { name: /Leave them for now/ }, LOAD));
    await userEvent.click(screen.getByRole('button', { name: 'Leave them for now' }));

    expect(
      await screen.findByText('2 appointments left as they are', undefined, LOAD),
    ).toBeInTheDocument();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('says so when nothing falls inside the window', async () => {
    vi.spyOn(timeOffService, 'createBlock').mockResolvedValue({ ...CREATED, impacted: [] });
    renderDialog();

    await userEvent.click(screen.getByRole('button', { name: 'Block time' }));

    expect(
      await screen.findByText('No appointments fall inside this time.', undefined, LOAD),
    ).toBeInTheDocument();
  });

  it('reports a changed blast radius in the server’s words, without claiming success', async () => {
    vi.spyOn(timeOffService, 'createBlock').mockResolvedValue(CREATED);
    vi.spyOn(timeOffService, 'resolve').mockRejectedValue(
      Object.assign(new Error('API error: conflict'), {
        kind: 'conflict',
        code: 'blast_radius_changed',
        detail: 'The appointments in this window changed since you reviewed them',
      }),
    );
    renderDialog();

    await userEvent.click(screen.getByRole('button', { name: 'Block time' }));
    await userEvent.click(await screen.findByRole('radio', { name: /Offer a colleague/ }, LOAD));
    await userEvent.click(screen.getByRole('button', { name: 'Notify 2 patients' }));

    expect(
      await screen.findByText(
        'The appointments in this window changed since you reviewed them',
        undefined,
        LOAD,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/handled/)).not.toBeInTheDocument();
  });
});
