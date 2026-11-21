import { parseEnv } from '@/configs/env';

import { decideOnForeground, type SessionLockPolicy } from './lock-policy';

/**
 * The background-timeout policy — checklist T-11.
 *
 * The decision is a pure function precisely so its boundaries can be
 * asserted here rather than inferred from an `AppState` transition and a
 * fake clock. `session.test.tsx` covers the wiring; this covers the rule.
 */

const POLICY: SessionLockPolicy = {
  phiSweepAfterMs: 5 * 60_000,
  reauthenticateAfterMs: 15 * 60_000,
};

describe('decideOnForeground', () => {
  it('does nothing for a short absence', () => {
    expect(decideOnForeground(0, POLICY)).toBe('none');
    expect(decideOnForeground(4 * 60_000, POLICY)).toBe('none');
  });

  it('sweeps the PHI cache from the sweep threshold onwards', () => {
    // Exactly at the threshold counts: "5 minutes" must not mean "5
    // minutes and one tick".
    expect(decideOnForeground(POLICY.phiSweepAfterMs, POLICY)).toBe('sweep-phi');
    expect(decideOnForeground(POLICY.phiSweepAfterMs + 1, POLICY)).toBe('sweep-phi');
  });

  it('leaves the session standing just below the re-auth threshold', () => {
    expect(decideOnForeground(POLICY.reauthenticateAfterMs - 1, POLICY)).toBe('sweep-phi');
  });

  it('requires re-authentication from the re-auth threshold onwards', () => {
    expect(decideOnForeground(POLICY.reauthenticateAfterMs, POLICY)).toBe('reauthenticate');
    expect(decideOnForeground(24 * 60 * 60_000, POLICY)).toBe('reauthenticate');
  });

  it('degrades to a single threshold when both are configured the same', () => {
    const single: SessionLockPolicy = { phiSweepAfterMs: 60_000, reauthenticateAfterMs: 60_000 };
    expect(decideOnForeground(59_999, single)).toBe('none');
    expect(decideOnForeground(60_000, single)).toBe('reauthenticate');
  });
});

describe('the policy is configurable (T-11)', () => {
  it('defaults to a 5-minute sweep and a 15-minute re-authentication', () => {
    const env = parseEnv({});
    expect(env.phiSweepAfterMs).toBe(5 * 60_000);
    expect(env.reauthenticateAfterMs).toBe(15 * 60_000);
  });

  it('reads whole minutes from the environment', () => {
    const env = parseEnv({
      EXPO_PUBLIC_PHI_SWEEP_MINUTES: '2',
      EXPO_PUBLIC_REAUTH_MINUTES: '30',
    });
    expect(env.phiSweepAfterMs).toBe(2 * 60_000);
    expect(env.reauthenticateAfterMs).toBe(30 * 60_000);
  });

  it('refuses a re-auth window shorter than the sweep, which would hide the sweep', () => {
    expect(() =>
      parseEnv({ EXPO_PUBLIC_PHI_SWEEP_MINUTES: '10', EXPO_PUBLIC_REAUTH_MINUTES: '5' }),
    ).toThrow(/Invalid environment configuration/);
  });

  it('refuses a zero or negative timeout rather than disabling the gate silently', () => {
    expect(() => parseEnv({ EXPO_PUBLIC_PHI_SWEEP_MINUTES: '0' })).toThrow(
      /Invalid environment configuration/,
    );
    expect(() => parseEnv({ EXPO_PUBLIC_REAUTH_MINUTES: '-1' })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it('refuses a value that is not a number', () => {
    expect(() => parseEnv({ EXPO_PUBLIC_REAUTH_MINUTES: 'never' })).toThrow(
      /Invalid environment configuration/,
    );
  });
});

// `describeMinutes` moved to `i18n/duration.ts` as `formatMinutes` when
// the timeout notice had to exist in two languages; both of the cases
// asserted here — the singular, and never saying "0 minutes" — moved with
// it into `duration.test.ts`, alongside the four Arabic forms English
// does not have.
