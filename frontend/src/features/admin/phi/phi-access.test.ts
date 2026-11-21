import { describe, expect, it } from 'vitest';

import {
  categoryLabel,
  grantFor,
  isLive,
  PHI_ELEVATION_MINUTES,
  PHI_JUSTIFICATION_CATEGORIES,
  PHI_REASON_MIN_LENGTH,
  pruneGrants,
  validateReason,
} from './phi-access';

/**
 * PHI elevation policy (ADM-10 · UX §1.5.1).
 *
 * The interesting property is that a grant lapses on its own — an admin who
 * justified an access fifteen minutes ago has not justified this one.
 */

const NOW = Date.parse('2026-08-11T10:00:00Z');

function grant(subjectId: string, minutes = PHI_ELEVATION_MINUTES) {
  return grantFor(
    subjectId,
    'Queue ticket A-104',
    'clinical-review',
    'Confirming the patient',
    NOW,
    minutes,
  );
}

describe('grantFor', () => {
  it('expires the configured number of minutes out', () => {
    expect(grant('q-1').expiresAt).toBe(NOW + PHI_ELEVATION_MINUTES * 60_000);
  });

  it('trims the reason it records', () => {
    expect(grantFor('q-1', 'x', 'clinical-review', '  a reason  ', NOW).reason).toBe('a reason');
  });
});

describe('isLive', () => {
  it('holds inside the window', () => {
    expect(isLive(grant('q-1'), NOW + 60_000)).toBe(true);
  });

  it('lapses at the boundary rather than one tick later', () => {
    const g = grant('q-1');
    expect(isLive(g, g.expiresAt)).toBe(false);
  });
});

describe('pruneGrants', () => {
  it('drops only what expired', () => {
    const grants = [grant('q-1', 15), grant('q-2', 1)];

    const pruned = pruneGrants(grants, NOW + 5 * 60_000);

    expect(pruned.map((g) => g.subjectId)).toEqual(['q-1']);
  });

  it('returns the same array when nothing expired, so the UI can skip a render', () => {
    const grants = [grant('q-1')];

    expect(pruneGrants(grants, NOW + 1000)).toBe(grants);
  });

  it('empties once everything has lapsed', () => {
    expect(pruneGrants([grant('q-1'), grant('q-2')], NOW + 60 * 60_000)).toEqual([]);
  });
});

describe('validateReason', () => {
  it('rejects an empty reason', () => {
    expect(validateReason('   ')).toMatchObject({ ok: false });
  });

  it('rejects a reason too short to be reviewable', () => {
    const check = validateReason('because');
    expect(check.ok).toBe(false);
    expect(check.message).toContain(String(PHI_REASON_MIN_LENGTH));
  });

  it('accepts a real sentence', () => {
    expect(validateReason('Confirming the patient before reassigning.')).toEqual({ ok: true });
  });

  it('measures the trimmed reason, so padding does not buy length', () => {
    expect(validateReason(`   ${'a'.repeat(PHI_REASON_MIN_LENGTH - 1)}   `).ok).toBe(false);
  });
});

describe('categories', () => {
  it('offers a closed, labelled set', () => {
    expect(PHI_JUSTIFICATION_CATEGORIES.length).toBeGreaterThanOrEqual(4);
    for (const entry of PHI_JUSTIFICATION_CATEGORIES) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  it('labels every category it defines', () => {
    expect(categoryLabel('safety-investigation')).toBe('Safety investigation');
  });
});
