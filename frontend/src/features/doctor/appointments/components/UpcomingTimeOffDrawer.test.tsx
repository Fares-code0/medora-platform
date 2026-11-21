import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '@/app/providers';

import type { TimeOffBlock } from '../model/time-off-service';
import { timeOffService } from '../service';

import { UpcomingTimeOffDrawer } from './UpcomingTimeOffDrawer';

/**
 * Upcoming time off (API §3.9): a booked block can be seen and taken back.
 * The list is the server's; a cancel leaves it only once the server agrees.
 */

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

const BLOCK: TimeOffBlock = {
  id: 'toff-1',
  startsAt: '2099-10-05T08:00:00.000Z',
  endsAt: '2099-10-05T18:00:00.000Z',
  kind: 'vacation',
};

function renderDrawer() {
  return render(
    <MemoryRouter>
      <AppProviders>
        <UpcomingTimeOffDrawer open onClose={vi.fn()} />
      </AppProviders>
    </MemoryRouter>,
  );
}

describe('UpcomingTimeOffDrawer', () => {
  it('says there is none when the server lists none', async () => {
    vi.spyOn(timeOffService, 'listBlocks').mockResolvedValue([]);
    renderDrawer();
    expect(await screen.findByText('No upcoming time off')).toBeInTheDocument();
  });

  it('reports a failed load as a failure, never as "no time off"', async () => {
    vi.spyOn(timeOffService, 'listBlocks').mockRejectedValue(
      Object.assign(new Error('API error: server'), { kind: 'server' }),
    );
    renderDrawer();
    expect(await screen.findByText("Couldn't load your time off")).toBeInTheDocument();
    expect(screen.queryByText('No upcoming time off')).not.toBeInTheDocument();
  });

  it('cancels a block through a confirmation, and announces it only once it is gone', async () => {
    const list = vi
      .spyOn(timeOffService, 'listBlocks')
      .mockResolvedValueOnce([BLOCK])
      .mockResolvedValue([]);
    const remove = vi.spyOn(timeOffService, 'removeBlock').mockResolvedValue();
    renderDrawer();

    await userEvent.click(await screen.findByRole('button', { name: /^Cancel time off / }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Cancel this time off?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel time off' }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith('toff-1'));
    expect(await screen.findByText('Time off cancelled')).toBeInTheDocument();
    expect(await screen.findByText('No upcoming time off')).toBeInTheDocument();
    expect(list.mock.calls.length).toBeGreaterThan(1);
  });

  it('keeps the block and says so when the server refuses the cancel', async () => {
    vi.spyOn(timeOffService, 'listBlocks').mockResolvedValue([BLOCK]);
    vi.spyOn(timeOffService, 'removeBlock').mockRejectedValue(new Error('down'));
    renderDrawer();

    await userEvent.click(await screen.findByRole('button', { name: /^Cancel time off / }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Cancel this time off?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel time off' }));

    expect(await screen.findByText("Couldn't cancel the time off")).toBeInTheDocument();
    expect(screen.queryByText('Time off cancelled')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Cancel time off / })).toBeInTheDocument();
  });
});
