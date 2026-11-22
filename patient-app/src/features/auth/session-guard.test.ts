import type { SessionLockPolicy } from './lock-policy';
import {
  decideOnColdStart,
  decodeSessionGuard,
  encodeSessionGuard,
  FUTURE_SKEW_TOLERANCE_MS,
  type ColdStartInput,
  type SessionGuardRecord,
} from './session-guard';

/**
 * The session guard's codec and the cold-start decision, without a
 * provider. The integration through the real `SessionProvider` is in
 * `cold-start-lock.test.tsx`.
 */

const POLICY: SessionLockPolicy = {
  phiSweepAfterMs: 5 * 60_000,
  reauthenticateAfterMs: 15 * 60_000,
};
const NOW = 1_800_000_000_000;
const MIN = 60_000;

const record = (r: SessionGuardRecord): ColdStartInput => ({ kind: 'record', record: r });
const bg = (awayMs: number, lock = false, b = false): ColdStartInput =>
  record({ v: 1, s: 'bg', at: NOW - awayMs, lock, b });

describe('decideOnColdStart', () => {
  it('restores after a foreground record or a short absence (normal cold start)', () => {
    expect(decideOnColdStart(record({ v: 1, s: 'fg', lock: false }), NOW, POLICY, true)).toBe(
      'restore',
    );
    expect(decideOnColdStart(bg(2 * MIN), NOW, POLICY, true)).toBe('restore');
  });

  it.each([true, false])('restores locked when the lock was up (opt-in %s)', (optIn) => {
    expect(decideOnColdStart(record({ v: 1, s: 'fg', lock: true }), NOW, POLICY, optIn)).toBe(
      'restore-locked',
    );
    expect(decideOnColdStart(bg(MIN, true), NOW, POLICY, optIn)).toBe('restore-locked');
  });

  it('locks in the sweep window only for an opted-in patient, at the exact boundaries', () => {
    expect(decideOnColdStart(bg(POLICY.phiSweepAfterMs - 1), NOW, POLICY, true)).toBe('restore');
    expect(decideOnColdStart(bg(POLICY.phiSweepAfterMs), NOW, POLICY, true)).toBe('restore-locked');
    expect(decideOnColdStart(bg(8 * MIN), NOW, POLICY, false)).toBe('restore');
    expect(decideOnColdStart(bg(POLICY.reauthenticateAfterMs - 1), NOW, POLICY, true)).toBe(
      'restore-locked',
    );
    expect(decideOnColdStart(bg(POLICY.reauthenticateAfterMs), NOW, POLICY, true)).toBe(
      'reauthenticate',
    );
  });

  it('honours the opt-in recorded at background time when the preference is lost (M2)', () => {
    expect(decideOnColdStart(bg(8 * MIN, false, true), NOW, POLICY, false)).toBe('restore-locked');
  });

  it.each([
    [true, false],
    [false, false],
    [true, true],
  ])('ends the session past the re-auth threshold (opt-in %s, lock %s)', (optIn, lock) => {
    expect(decideOnColdStart(bg(2 * 60 * MIN, lock, optIn), NOW, POLICY, optIn)).toBe(
      'reauthenticate',
    );
  });

  it('restores when the guard is missing (first launch after the update)', () => {
    expect(decideOnColdStart({ kind: 'missing' }, NOW, POLICY, true)).toBe('restore');
  });

  it('refuses a corrupt guard', () => {
    expect(decideOnColdStart({ kind: 'corrupt' }, NOW, POLICY, false)).toBe('invalid');
  });

  it('holds when the guard cannot be read', () => {
    expect(decideOnColdStart({ kind: 'unreadable' }, NOW, POLICY, true)).toBe('hold');
  });

  it('discards a session whose teardown left a tombstone', () => {
    expect(decideOnColdStart(record({ v: 1, s: 'ended' }), NOW, POLICY, true)).toBe('discard');
  });

  it('refuses a timestamp more than the tolerance in the future, and reads a small one as zero', () => {
    expect(decideOnColdStart(bg(-(FUTURE_SKEW_TOLERANCE_MS + 1_000)), NOW, POLICY, true)).toBe(
      'invalid',
    );
    expect(decideOnColdStart(bg(-30_000), NOW, POLICY, true)).toBe('restore');
    expect(decideOnColdStart(bg(-30_000, true), NOW, POLICY, true)).toBe('restore-locked');
  });
});

describe('the codec', () => {
  it.each<SessionGuardRecord>([
    { v: 1, s: 'fg', lock: false },
    { v: 1, s: 'fg', lock: true },
    { v: 1, s: 'bg', at: NOW, lock: true, b: false },
    { v: 1, s: 'ended' },
  ])('round-trips %j', (r) => {
    expect(decodeSessionGuard(encodeSessionGuard(r))).toEqual({ kind: 'record', record: r });
  });

  it('writes only the documented keys, so nothing identifying can ride along', () => {
    const smuggled = {
      v: 1,
      s: 'bg',
      at: NOW,
      lock: false,
      b: true,
      user: 'sara@example.com',
    } as unknown as SessionGuardRecord;
    const encoded = encodeSessionGuard(smuggled);
    expect(Object.keys(JSON.parse(encoded) as object).sort()).toEqual([
      'at',
      'b',
      'lock',
      's',
      'v',
    ]);
    expect(encoded).not.toContain('sara');
    expect(
      Object.keys(JSON.parse(encodeSessionGuard({ v: 1, s: 'fg', lock: true })) as object),
    ).toEqual(['v', 's', 'lock']);
    expect(Object.keys(JSON.parse(encodeSessionGuard({ v: 1, s: 'ended' })) as object)).toEqual([
      'v',
      's',
    ]);
  });

  it('reads an absent entry as missing', () => {
    expect(decodeSessionGuard(null)).toEqual({ kind: 'missing' });
  });

  it.each([
    ['not JSON', '{nope'],
    ['an array', '[1]'],
    ['a version 2', '{"v":2,"s":"fg","lock":false}'],
    ['an unknown state', '{"v":1,"s":"zz","lock":false}'],
    ['an extra key', '{"v":1,"s":"fg","lock":false,"user":"x"}'],
    ['a missing key', '{"v":1,"s":"bg","at":5,"lock":false}'],
    ['at zero', '{"v":1,"s":"bg","at":0,"lock":false,"b":false}'],
    ['a fractional at', '{"v":1,"s":"bg","at":1.5,"lock":false,"b":false}'],
    ['a string at', '{"v":1,"s":"bg","at":"x","lock":false,"b":false}'],
    ['a string lock', '{"v":1,"s":"fg","lock":"true"}'],
    ['over-length', `{"v":1,"s":"fg","lock":false${' '.repeat(100)}}`],
  ])('reads %s as corrupt', (_label, raw) => {
    expect(decodeSessionGuard(raw)).toEqual({ kind: 'corrupt' });
  });
});
