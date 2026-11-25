import { afterEach, describe, expect, it } from 'vitest';

import {
  SAVING_GRACE_MS,
  clearBlock,
  readFollowUps,
  reconcile,
  sameWindow,
  settleRefused,
  settleSaved,
  startSaving,
  type FollowUpRecord,
} from './time-off-follow-up';
import type { TimeOffBlock } from './time-off-service';

const USER = 'u-1';
const BLOCK: TimeOffBlock = {
  id: 'toff-9',
  startsAt: '2099-01-02T08:00:00.000Z',
  endsAt: '2099-01-02T12:00:00.000Z',
  kind: 'vacation',
};
const WINDOW = { from: BLOCK.startsAt, to: BLOCK.endsAt, kind: BLOCK.kind } as const;

afterEach(() => window.localStorage.clear());

describe('time-off follow-up records', () => {
  it('keeps a save as "saving" until the server answers, per user', () => {
    const id = startSaving(USER, WINDOW);
    expect(readFollowUps(USER)).toEqual([expect.objectContaining({ id, state: 'saving' })]);
    expect(readFollowUps('someone-else')).toEqual([]);
  });

  it('a confirmed block with appointments inside becomes a follow-up; with none it is done', () => {
    const withImpact = startSaving(USER, WINDOW);
    settleSaved(USER, withImpact, BLOCK, 2);
    expect(readFollowUps(USER)).toEqual([
      expect.objectContaining({ state: 'follow-up', blockId: 'toff-9' }),
    ]);
    clearBlock(USER, 'toff-9');
    expect(readFollowUps(USER)).toEqual([]);

    const clean = startSaving(USER, WINDOW);
    settleSaved(USER, clean, BLOCK, 0);
    expect(readFollowUps(USER)).toEqual([]);
  });

  it('a refusal removes the record', () => {
    const id = startSaving(USER, WINDOW);
    settleRefused(USER, id);
    expect(readFollowUps(USER)).toEqual([]);
  });

  it('matches a window to a block by instant, not by spelling', () => {
    expect(sameWindow({ ...WINDOW, from: '2099-01-02T10:00:00+02:00' }, BLOCK)).toBe(true);
    expect(sameWindow({ ...WINDOW, kind: 'emergency-block' }, BLOCK)).toBe(false);
  });

  it('reconciles against the server list: promotes, waits, reports, and drops', () => {
    const now = Date.parse('2099-01-01T00:00:00.000Z');
    const records: FollowUpRecord[] = [
      { state: 'saving', id: 'matched', ...WINDOW, at: now - SAVING_GRACE_MS * 10 },
      {
        state: 'saving',
        id: 'young',
        from: '2099-03-01T08:00:00.000Z',
        to: '2099-03-01T09:00:00.000Z',
        kind: 'vacation',
        at: now - 1000,
      },
      {
        state: 'saving',
        id: 'lost',
        from: '2099-04-01T08:00:00.000Z',
        to: '2099-04-01T09:00:00.000Z',
        kind: 'vacation',
        at: now - SAVING_GRACE_MS - 1,
      },
      { state: 'follow-up', id: 'gone', blockId: 'toff-cancelled', ...WINDOW, at: now },
    ];

    const result = reconcile(records, [BLOCK], now);

    expect([...result.followUps.keys()]).toEqual(['toff-9']);
    expect(result.stillSaving.map((record) => record.id)).toEqual(['young']);
    expect(result.notFound.map((record) => record.id)).toEqual(['lost']);
    expect(result.records.map((record) => record.id)).toEqual(['matched', 'young']);
  });

  it('survives unreadable storage', () => {
    window.localStorage.setItem(`medora.timeOff.followUp.v1:${USER}`, '{not json');
    expect(readFollowUps(USER)).toEqual([]);
  });
});
