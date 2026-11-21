import { describe, expect, it } from 'vitest';

import { MOCK_APPOINTMENTS } from '../model/mock-data';

import { mockTimeOffService } from './mock-time-off-service';

/**
 * The mock time off mirrors the server's rules (API §5.9): a proposal
 * reaches only pending requests and reports the rest as skipped, and a
 * count that no longer matches the window is refused.
 */

function windowAround(dateTime: string): { from: string; to: string } {
  const start = new Date(dateTime).getTime();
  return {
    from: new Date(start - 60_000).toISOString(),
    to: new Date(start + 60_000).toISOString(),
  };
}

describe('mockTimeOffService', () => {
  it('previews the impact without moving anything', async () => {
    const target = MOCK_APPOINTMENTS.find((appointment) => appointment.status === 'scheduled');
    if (target === undefined) throw new Error('no scheduled appointment seeded');

    const created = await mockTimeOffService.createBlock({
      ...windowAround(target.dateTime),
      kind: 'vacation',
    });

    expect(created.impacted.map((appointment) => appointment.id)).toContain(target.id);
    expect(created.impacted.find((appointment) => appointment.id === target.id)?.status).toBe(
      'scheduled',
    );
  });

  it('skips a booked appointment on a proposal, naming why', async () => {
    const target = MOCK_APPOINTMENTS.find((appointment) => appointment.status === 'confirmed');
    if (target === undefined) throw new Error('no confirmed appointment seeded');
    const created = await mockTimeOffService.createBlock({
      ...windowAround(target.dateTime),
      kind: 'emergency-block',
    });

    const outcome = await mockTimeOffService.resolve(created.block.id, {
      action: 'reschedule-proposal',
      confirmedCount: created.impacted.length,
    });

    expect(outcome.skipped.map((entry) => entry.id)).toContain(target.id);
    expect(outcome.resolved).not.toContain(target.id);
  });

  it('refuses a count that no longer matches the window', async () => {
    const target = MOCK_APPOINTMENTS.find((appointment) => appointment.status === 'pending');
    if (target === undefined) throw new Error('no pending appointment seeded');
    const created = await mockTimeOffService.createBlock({
      ...windowAround(target.dateTime),
      kind: 'vacation',
    });

    await expect(
      mockTimeOffService.resolve(created.block.id, {
        action: 'cancel-apology',
        confirmedCount: created.impacted.length + 1,
      }),
    ).rejects.toMatchObject({ kind: 'conflict', code: 'blast_radius_changed' });
  });

  it('lists a block until it is cancelled, and refuses one it does not hold', async () => {
    const from = new Date(Date.now() + 86_400_000).toISOString();
    const to = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const { block } = await mockTimeOffService.createBlock({ from, to, kind: 'vacation' });

    expect((await mockTimeOffService.listBlocks()).map((b) => b.id)).toContain(block.id);

    await mockTimeOffService.removeBlock(block.id);

    expect((await mockTimeOffService.listBlocks()).map((b) => b.id)).not.toContain(block.id);
    await expect(mockTimeOffService.removeBlock(block.id)).rejects.toThrow(/not found/);
  });
});

