/**
 * Masking parity with the frontend (RM M7.3).
 *
 * The roadmap requires that "masking output matches
 * `frontend/src/utils/phi-mask.ts`… the two must agree character-for-
 * character". A table of expected strings written here would prove that
 * this file agrees with itself, so the frontend module is loaded and its
 * output compared directly.
 *
 * The import is runtime-resolved for the reason given at length in
 * `shared/authz/permission-catalogue.spec.ts`: a static one fails `tsc`
 * with TS6059 because the frontend is outside the backend's `rootDir`.
 */

import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  PHI_FIELD_KINDS,
  PHI_FIELD_LABEL,
  maskDateOfBirth,
  maskEmail,
  maskMrn,
  maskName,
  maskPhi,
  maskPhone,
  type PhiFieldKind,
} from './phi-mask';

const FRONTEND_MASKERS = resolve(__dirname, '../../../../frontend/src/utils/phi-mask.ts');

type Masker = (value: string) => string;

interface FrontendMaskers {
  readonly maskName: Masker;
  readonly maskMrn: Masker;
  readonly maskEmail: Masker;
  readonly maskPhone: Masker;
  readonly maskDateOfBirth: Masker;
  readonly maskPhi: (kind: string, value: string) => string;
  readonly PHI_FIELD_LABEL: Readonly<Record<string, string>>;
}

async function loadFrontendMaskers(): Promise<FrontendMaskers> {
  return (await import(FRONTEND_MASKERS)) as FrontendMaskers;
}

/**
 * The corpus both sides are compared over. It carries the frontend
 * header's own worked examples plus every edge its comments call out —
 * a word shorter than the kept prefix, an MRN of exactly four
 * characters, an email with no local part, a phone below four digits,
 * a date with no year — and the empty and whitespace cases that the
 * "blank is indistinguishable from withheld" rule turns on.
 */
const CORPUS: Readonly<Record<PhiFieldKind, readonly string[]>> = {
  name: [
    'Ahmed Mansour',
    'Omar',
    'A B',
    'Jo',
    'Mary Jane Watson',
    '  Layla   Haddad  ',
    'X',
    '',
    '   ',
    'Ægir Þórsson',
    "O'Neill McDonald",
  ],
  mrn: ['PT-1004', 'MRN-000123', '1004', '104', 'ABCD', 'ABCDE', '', '   ', 'PT-1004  '],
  email: [
    'omar.farouk@example.test',
    'a@b.co',
    'first.last+tag@sub.domain.example',
    '@nolocal.test',
    'nodomain',
    '',
    '   ',
    'two@at@signs.test',
  ],
  phone: [
    '+1 (555) 018-4402',
    '5550184402',
    '018-4402',
    '4402',
    '440',
    '',
    '   ',
    'no digits here',
    '+20 100 123 4567',
  ],
  dateOfBirth: [
    '1984-03-11',
    '11/03/1984',
    'March 1984',
    '1984',
    'no year at all',
    '',
    '   ',
    '2026-08-26T09:00:00Z',
  ],
};

describe('masker parity with the frontend', () => {
  it('agrees on every case in the corpus, for every field kind', async () => {
    const frontend = await loadFrontendMaskers();
    const backend: Record<PhiFieldKind, Masker> = {
      name: maskName,
      mrn: maskMrn,
      email: maskEmail,
      phone: maskPhone,
      dateOfBirth: maskDateOfBirth,
    };
    const theirs: Record<PhiFieldKind, Masker> = {
      name: frontend.maskName,
      mrn: frontend.maskMrn,
      email: frontend.maskEmail,
      phone: frontend.maskPhone,
      dateOfBirth: frontend.maskDateOfBirth,
    };

    for (const kind of PHI_FIELD_KINDS) {
      for (const value of CORPUS[kind]) {
        expect(backend[kind](value), `${kind}(${JSON.stringify(value)})`).toBe(theirs[kind](value));
      }
    }
  });

  it('agrees through the maskPhi dispatcher too', async () => {
    const frontend = await loadFrontendMaskers();

    for (const kind of PHI_FIELD_KINDS) {
      for (const value of CORPUS[kind]) {
        expect(maskPhi(kind, value), `maskPhi(${kind})`).toBe(frontend.maskPhi(kind, value));
      }
    }
  });

  it('carries the same field labels', async () => {
    const frontend = await loadFrontendMaskers();

    for (const kind of PHI_FIELD_KINDS) {
      expect(PHI_FIELD_LABEL[kind]).toBe(frontend.PHI_FIELD_LABEL[kind]);
    }
  });
});

describe('the worked examples from the specification', () => {
  // UX §1.5.6 and the frontend header name these five by hand.
  it('masks each identifier as the spec writes it', () => {
    expect(maskName('Ahmed Mansour')).toBe('Ah••• M•••');
    expect(maskMrn('PT-1004')).toBe('••••1004');
    expect(maskEmail('omar.farouk@example.test')).toBe('o•••@example.test');
    expect(maskPhone('+1 (555) 018-4402')).toBe('••• ••• 4402');
    expect(maskDateOfBirth('1984-03-11')).toBe('••/••/1984');
  });
});

describe('invariant: the mask is a fixed width', () => {
  // A mask whose length tracked the hidden value would leak it — three
  // bullets for "Li" and eleven for "Bartholomew" tells you which is
  // which without unmasking either.
  const bulletsIn = (masked: string): number => (masked.match(/•/g) ?? []).length;

  it('does not grow with the length of a name', () => {
    expect(bulletsIn(maskName('Ali'))).toBe(bulletsIn(maskName('Konstantinopoulos')));
  });

  it('does not grow with the length of an email local part', () => {
    expect(bulletsIn(maskEmail('a@x.test'))).toBe(
      bulletsIn(maskEmail('an.extremely.long.local.part@x.test')),
    );
  });

  it('does not grow with the length of an MRN', () => {
    expect(bulletsIn(maskMrn('PT-1004'))).toBe(bulletsIn(maskMrn('PT-000000000000001004')));
  });

  it('does not grow with the length of a phone number', () => {
    expect(bulletsIn(maskPhone('5550184402'))).toBe(
      bulletsIn(maskPhone('+1 (555) 018-4402 ext 99')),
    );
  });
});

describe('invariant: blank is indistinguishable from withheld', () => {
  // If an empty field masked differently from an unparseable one, an
  // admin table would quietly disclose which patients have no phone on
  // file — a fact about the record, revealed by the mask.
  it('masks empty, whitespace and unparseable input identically', () => {
    for (const kind of PHI_FIELD_KINDS) {
      const blank = maskPhi(kind, '');
      expect(maskPhi(kind, '   '), `${kind} whitespace`).toBe(blank);
    }

    expect(maskName('')).toBe(maskName('   '));
    expect(maskEmail('')).toBe(maskEmail('nodomain'));
    expect(maskPhone('')).toBe(maskPhone('no digits here'));
    expect(maskDateOfBirth('')).toBe(maskDateOfBirth('no year at all'));
  });
});

describe('no masker can be talked into returning the clear value', () => {
  // The frontend header's central claim, asserted rather than assumed.
  it('never echoes the input back unchanged for a real identifier', () => {
    const identifiers: Readonly<Record<PhiFieldKind, string>> = {
      name: 'Ahmed Mansour',
      mrn: 'PT-1004',
      email: 'omar.farouk@example.test',
      phone: '+1 (555) 018-4402',
      dateOfBirth: '1984-03-11',
    };

    for (const kind of PHI_FIELD_KINDS) {
      const value = identifiers[kind];
      const masked = maskPhi(kind, value);

      expect(masked, kind).not.toBe(value);
      expect(masked, kind).toContain('•');
    }
  });

  it('takes no argument that could disable masking', () => {
    // Every masker has arity 1. A second parameter is where an
    // `unmask: true` would eventually be added.
    for (const masker of [maskName, maskMrn, maskEmail, maskPhone, maskDateOfBirth]) {
      expect(masker.length).toBe(1);
    }
  });
});
