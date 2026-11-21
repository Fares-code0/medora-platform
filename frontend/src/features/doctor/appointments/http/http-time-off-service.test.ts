import { afterEach, describe, expect, it, vi } from 'vitest';

import { envelope, json, stubApi } from '@/test/api-stub';

import { httpTimeOffService } from './http-time-off-service';

/** Time off over HTTP (FE-10.4) — API §3.9 create, §5.9 resolve. */

afterEach(() => {
  vi.unstubAllGlobals();
});

const BLOCK = {
  id: 'toff-1',
  startsAt: '2026-10-05T08:00:00.000Z',
  endsAt: '2026-10-05T18:00:00.000Z',
  kind: 'emergency-block',
  autoBehavior: 'reschedule-existing',
  createdAt: '2026-10-04T10:00:00.000Z',
};

describe('httpTimeOffService.createBlock', () => {
  it('books the block and returns the impact as a preview', async () => {
    const { requests } = stubApi({
      'POST /me/time-off': () =>
        json(
          envelope({
            timeOff: BLOCK,
            impacted: [
              {
                id: 'APT-3001',
                scheduledAt: '2026-10-05T10:30:00.000Z',
                durationMin: 30,
                status: 'scheduled',
                patientId: 'PT-1004',
              },
            ],
          }),
          201,
        ),
    });

    const created = await httpTimeOffService.createBlock({
      from: BLOCK.startsAt,
      to: BLOCK.endsAt,
      kind: 'emergency-block',
    });

    expect(requests[0]?.body).toEqual({
      from: BLOCK.startsAt,
      to: BLOCK.endsAt,
      kind: 'emergency-block',
      mode: 'reschedule-existing',
    });
    expect(created.block).toEqual({
      id: 'toff-1',
      startsAt: BLOCK.startsAt,
      endsAt: BLOCK.endsAt,
      kind: 'emergency-block',
    });
    expect(created.impacted[0]).toMatchObject({ id: 'APT-3001', patientId: 'PT-1004' });
  });

  it('pre-selects nothing for planned time off', async () => {
    const { requests } = stubApi({
      'POST /me/time-off': () =>
        json(envelope({ timeOff: { ...BLOCK, kind: 'vacation' }, impacted: [] }), 201),
    });

    await httpTimeOffService.createBlock({
      from: BLOCK.startsAt,
      to: BLOCK.endsAt,
      kind: 'vacation',
    });

    expect(requests[0]?.body).toMatchObject({ kind: 'vacation', mode: 'block-new' });
  });
});

describe('httpTimeOffService.resolve', () => {
  it('sends the count the doctor was shown, and reports resolved and skipped apart', async () => {
    const { requests } = stubApi({
      'POST /me/time-off/toff-1/resolve': () =>
        envelope({
          action: 'reschedule-proposal',
          resolved: ['APT-1'],
          skipped: [{ id: 'APT-2', reason: 'scheduled → awaiting-patient is not allowed' }],
          notified: 1,
        }),
    });

    const outcome = await httpTimeOffService.resolve('toff-1', {
      action: 'reschedule-proposal',
      confirmedCount: 2,
      reason: '  ',
    });

    expect(requests[0]?.body).toEqual({ action: 'reschedule-proposal', confirmedCount: 2 });
    expect(outcome).toEqual({
      resolved: ['APT-1'],
      skipped: [{ id: 'APT-2', reason: 'scheduled → awaiting-patient is not allowed' }],
      notified: 1,
    });
  });

  it('surfaces a changed blast radius as the server’s refusal — nothing was sent', async () => {
    stubApi({
      'POST /me/time-off/toff-1/resolve': () =>
        json(
          {
            message: 'Conflict',
            code: 'blast_radius_changed',
            detail: 'The appointments in this window changed since you reviewed them',
          },
          409,
        ),
    });

    await expect(
      httpTimeOffService.resolve('toff-1', { action: 'cancel-apology', confirmedCount: 3 }),
    ).rejects.toMatchObject({ kind: 'conflict', code: 'blast_radius_changed' });
  });
});

describe('httpTimeOffService — the upcoming list', () => {
  it('lists the caller’s upcoming blocks', async () => {
    stubApi({ 'GET /me/time-off': () => envelope([BLOCK]) });

    await expect(httpTimeOffService.listBlocks()).resolves.toEqual([
      {
        id: 'toff-1',
        startsAt: '2026-10-05T08:00:00.000Z',
        endsAt: '2026-10-05T18:00:00.000Z',
        kind: 'emergency-block',
      },
    ]);
  });

  it('treats a body that is not a list as malformed, not as "no time off"', async () => {
    stubApi({ 'GET /me/time-off': () => envelope({ items: [] }) });
    await expect(httpTimeOffService.listBlocks()).rejects.toThrow();
  });

  it('cancels one block by id', async () => {
    const { requests } = stubApi({
      'DELETE /me/time-off/toff-1': () => new Response(null, { status: 204 }),
    });

    await httpTimeOffService.removeBlock('toff-1');

    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'DELETE /me/time-off/toff-1',
    ]);
  });
});
