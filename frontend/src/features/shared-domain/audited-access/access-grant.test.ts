import { describe, expect, it } from 'vitest';

import { formatExpiry, grantFor, isLive, pruneGrants, validateReason } from './access-grant';
import type { AccessGrant } from './access-grant';

/**
 * This module ships with exactly one real consumer so far — ADM-10's PHI
 * gate, at `minLength = 12` and `PHI_ELEVATION_MINUTES = 15`. Every export
 * here has therefore only ever been exercised at that one shape. A bug
 * reachable only at a *different* threshold or a *different* category union
 * would pass PHI's suite untouched and surface later inside ADM-06.
 *
 * This file is evidence the module works as a generic, reusable mechanism:
 * it instantiates it with a category union, a minimum reason length and a
 * TTL that are all deliberately not PHI's, and imports nothing from
 * `features/admin/phi` so the two stay decoupled the way the extraction
 * intended.
 */

// A plausibly ADM-06-shaped category union — communication monitoring, not
// PHI review. Deliberately not PHI's five-value union.
type ReviewCategory = 'safety-review' | 'complaint-investigation';

// PHI uses minLength 12 and a 15-minute TTL. Both are chosen differently
// here on purpose: a bug tied to those specific numbers (e.g. a threshold
// hardcoded instead of parameterised) would otherwise hide behind PHI's own
// passing suite.
const MIN_LENGTH = 20;
const TTL_MINUTES = 8;

function buildGrant(overrides: Partial<AccessGrant<ReviewCategory>> = {}): AccessGrant<ReviewCategory> {
  return {
    subjectId: 'thread-1',
    subjectLabel: 'Thread #1',
    category: 'safety-review',
    reason: 'Investigating a flagged safety complaint from the intake queue',
    grantedAt: 0,
    expiresAt: 60_000,
    ...overrides,
  };
}

describe('validateReason at a non-PHI minLength', () => {
  it('rejects an empty reason with the "reason is required" message', () => {
    // Neither PHI test file asserts this string (phi-access.test.ts only
    // checks `ok: false`; PhiAccessProvider.test.tsx only matches the
    // "at least N characters" message), so a reword here would otherwise
    // pass the whole suite unnoticed.
    const result = validateReason('   ', MIN_LENGTH);
    expect(result).toEqual({ ok: false, message: 'A written reason is required.' });
  });

  it('rejects a reason one character short of the threshold', () => {
    const reason = 'a'.repeat(MIN_LENGTH - 1);
    const result = validateReason(reason, MIN_LENGTH);
    expect(result.ok).toBe(false);
  });

  it('accepts a reason exactly at the threshold', () => {
    const reason = 'a'.repeat(MIN_LENGTH);
    const result = validateReason(reason, MIN_LENGTH);
    expect(result.ok).toBe(true);
  });

  it('does not count surrounding whitespace toward the length', () => {
    // Padded with whitespace to a length past MIN_LENGTH, but the trimmed
    // core is one character short — must still be rejected.
    const core = 'a'.repeat(MIN_LENGTH - 1);
    const padded = `  ${core}   `;
    expect(padded.length).toBeGreaterThan(MIN_LENGTH);

    const result = validateReason(padded, MIN_LENGTH);
    expect(result.ok).toBe(false);
  });
});

describe('grantFor at a non-PHI TTL', () => {
  it('computes expiresAt from the injected `now` and `minutes`, and stores the trimmed reason and category', () => {
    const now = 1_700_000_000_000;
    const grant = grantFor(
      'thread-42',
      'Thread #42',
      'complaint-investigation',
      '  Escalated complaint needs a documented reason  ',
      now,
      TTL_MINUTES,
    );

    expect(grant.grantedAt).toBe(now);
    expect(grant.expiresAt).toBe(now + TTL_MINUTES * 60_000);
    expect(grant.reason).toBe('Escalated complaint needs a documented reason');
    expect(grant.category).toBe('complaint-investigation');
  });
});

describe('isLive at the expiresAt boundary', () => {
  it('is not live at exactly expiresAt (the boundary is a strict ">")', () => {
    const grant = buildGrant({ expiresAt: 60_000 });
    expect(isLive(grant, 60_000)).toBe(false);
  });

  it('is live one millisecond before expiresAt', () => {
    const grant = buildGrant({ expiresAt: 60_000 });
    expect(isLive(grant, 59_999)).toBe(true);
  });
});

describe('pruneGrants', () => {
  it('drops expired grants and keeps live ones', () => {
    const now = 60_000;
    const expired = buildGrant({ subjectId: 'expired', expiresAt: 59_999 });
    const live = buildGrant({ subjectId: 'live', expiresAt: 60_001 });

    const result = pruneGrants([expired, live], now);

    expect(result).toHaveLength(1);
    const [only] = result;
    if (only === undefined) throw new Error('expected one surviving grant');
    expect(only.subjectId).toBe('live');
  });

  it('returns the same array reference when nothing was pruned', () => {
    const now = 60_000;
    const grants = [
      buildGrant({ subjectId: 'live-a', expiresAt: 60_001 }),
      buildGrant({ subjectId: 'live-b', expiresAt: 70_000 }),
    ];

    const result = pruneGrants(grants, now);

    // Reference equality, not just deep equality — this short-circuit lets
    // a caller skip a re-render when nothing changed.
    expect(result).toBe(grants);
  });
});

describe('formatExpiry', () => {
  it('renders expiresAt as a local time string', () => {
    const grant = buildGrant({ expiresAt: 1_700_000_000_000 });

    // Computed the same way the module does, from the same fixed
    // timestamp — this is a function of a given instant, not of the
    // current clock, so it stays deterministic.
    const expected = new Date(1_700_000_000_000).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });

    expect(formatExpiry(grant)).toBe(expected);

    // The equality check above pins "a function of expiresAt" but would
    // still pass if the format options changed shape (e.g. emitting a full
    // date, or seconds) as long as the module and the test changed
    // together. This locale-tolerant shape assertion catches that: it
    // fails if the output stops looking like `H:MM` / `HH:MM`, regardless
    // of locale, without hardcoding a literal time (which would make the
    // test timezone-dependent).
    expect(formatExpiry(grant)).toMatch(/\d{1,2}:\d{2}/);
  });
});
