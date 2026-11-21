import { describe, expect, it } from 'vitest';

import {
  maskPatientIdentities,
  maskPatientIdentity,
  type PatientIdentity,
} from './masked-identity';

const FULL: PatientIdentity = {
  patientId: 'PT-1004',
  fullName: 'Ahmed Mansour',
  mrn: 'MRN-000123',
  email: 'omar.farouk@example.test',
  phone: '+1 (555) 018-4402',
  dateOfBirth: '1984-03-11',
};

const MINIMAL: PatientIdentity = {
  patientId: 'PT-1005',
  fullName: 'Layla Haddad',
  mrn: 'MRN-000124',
};

describe('maskPatientIdentity', () => {
  it('masks every identifier it carries', () => {
    expect(maskPatientIdentity(FULL)).toEqual({
      patientId: 'PT-1004',
      name: 'Ah••• M•••',
      mrn: '••••0123',
      email: 'o•••@example.test',
      phone: '••• ••• 4402',
      dateOfBirth: '••/••/1984',
      revealed: false,
    });
  });

  it('leaves the opaque patient handle alone', () => {
    // Masking it would make the row unusable — every subsequent request
    // is keyed by it — and it says nothing about the person.
    expect(maskPatientIdentity(FULL).patientId).toBe('PT-1004');
  });

  it('omits an absent optional field rather than masking it', () => {
    // A mask asserts "there is a value here you may not see", which
    // would be false for a patient who registered without an email.
    const masked = maskPatientIdentity(MINIMAL);

    expect(masked).not.toHaveProperty('email');
    expect(masked).not.toHaveProperty('phone');
    expect(masked).not.toHaveProperty('dateOfBirth');
  });

  it('marks the projection unrevealed', () => {
    // Carried explicitly: the client decides whether to offer the reveal
    // affordance from this, and an absent field would be ambiguous.
    expect(maskPatientIdentity(FULL).revealed).toBe(false);
  });

  it('lets no clear value survive anywhere in the output', () => {
    // The assertion that matters. Serialising and searching catches a
    // field added later that somebody forgot to mask, which per-field
    // assertions above would not.
    const serialized = JSON.stringify(maskPatientIdentity(FULL));

    for (const clear of [
      FULL.fullName,
      'Ahmed',
      'Mansour',
      FULL.mrn,
      FULL.email,
      FULL.phone,
      FULL.dateOfBirth,
      '5550184402',
      '03-11',
    ]) {
      expect(serialized, `leaked ${String(clear)}`).not.toContain(clear);
    }
  });

  it('does not mutate its input', () => {
    const before = { ...FULL };
    maskPatientIdentity(FULL);

    expect(FULL).toEqual(before);
  });
});

describe('maskPatientIdentities', () => {
  it('masks a whole list', () => {
    const masked = maskPatientIdentities([FULL, MINIMAL]);

    expect(masked).toHaveLength(2);
    expect(masked.every((row) => row.revealed === false)).toBe(true);
    expect(masked.map((row) => row.name)).toEqual(['Ah••• M•••', 'La••• H•••']);
  });

  it('returns an empty list unchanged', () => {
    expect(maskPatientIdentities([])).toEqual([]);
  });
});
