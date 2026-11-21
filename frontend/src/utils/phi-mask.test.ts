import { describe, expect, it } from 'vitest';

import { maskDateOfBirth, maskEmail, maskMrn, maskName, maskPhi, maskPhone } from './phi-mask';

/**
 * PHI masking (UX §1.5.6).
 *
 * Two properties matter more than the exact glyphs: a mask must never leak
 * the hidden length, and it must never fall back to the clear value for an
 * awkward input. Both are pinned below alongside the shapes §1.5 specifies.
 */

describe('maskName', () => {
  it('produces the shape §1.5 specifies', () => {
    expect(maskName('Ahmed Mansour')).toBe('Ah••• M•••');
  });

  it('does not leak how long the hidden part is', () => {
    expect(maskName('Ahmed Mansour')).toBe(maskName('Ahmed Mansourbergsteinovich'));
  });

  it('handles a single name', () => {
    expect(maskName('Cher')).toBe('Ch•••');
  });

  it('fully masks a word that would have nothing left to hide', () => {
    // "Li" is exactly the two letters the first word would keep, so it is
    // masked whole; "Wu" keeps one of two, the same fraction as any surname.
    expect(maskName('Li Wu')).toBe('••• W•••');
    expect(maskName('Li')).toBe('•••');
  });

  it('normalises stray whitespace instead of emitting empty segments', () => {
    expect(maskName('  Ahmed   Mansour  ')).toBe('Ah••• M•••');
  });

  it('never returns the clear value for an empty input', () => {
    expect(maskName('')).toBe('•••');
    expect(maskName('   ')).toBe('•••');
  });
});

describe('maskMrn', () => {
  it('keeps the last four characters', () => {
    expect(maskMrn('PT-1004')).toBe('••••1004');
  });

  it('reveals nothing when the identifier is four characters or shorter', () => {
    expect(maskMrn('1004')).toBe('••••');
    expect(maskMrn('7')).toBe('••••');
  });

  it('falls back to the placeholder when there is nothing to mask', () => {
    expect(maskMrn('')).toBe('•••');
  });
});

describe('maskEmail', () => {
  it('keeps the first letter and the whole domain', () => {
    expect(maskEmail('omar.farouk@example.test')).toBe('o•••@example.test');
  });

  it('refuses to pass through something that is not an address', () => {
    expect(maskEmail('not-an-email')).toBe('•••');
    expect(maskEmail('@nolocalpart.test')).toBe('•••');
  });
});

describe('maskPhone', () => {
  it('keeps the last four digits regardless of formatting', () => {
    expect(maskPhone('+1 (555) 018-4402')).toBe('••• ••• 4402');
    expect(maskPhone('15550184402')).toBe('••• ••• 4402');
  });

  it('masks entirely when there are too few digits', () => {
    expect(maskPhone('12')).toBe('•••');
  });
});

describe('maskDateOfBirth', () => {
  it('keeps only the year', () => {
    expect(maskDateOfBirth('1984-03-11')).toBe('••/••/1984');
  });

  it('masks entirely when no year can be found', () => {
    expect(maskDateOfBirth('unknown')).toBe('•••');
  });
});

describe('maskPhi', () => {
  it('dispatches on the field kind', () => {
    expect(maskPhi('name', 'Ahmed Mansour')).toBe('Ah••• M•••');
    expect(maskPhi('mrn', 'PT-1004')).toBe('••••1004');
  });

  it('never returns its input unchanged for a non-empty value', () => {
    const samples = [
      ['name', 'Ahmed Mansour'],
      ['mrn', 'PT-1004'],
      ['email', 'omar@example.test'],
      ['phone', '+1 (555) 018-4402'],
      ['dateOfBirth', '1984-03-11'],
    ] as const;

    for (const [kind, value] of samples) {
      expect(maskPhi(kind, value)).not.toBe(value);
      expect(maskPhi(kind, value)).toContain('•');
    }
  });
});
