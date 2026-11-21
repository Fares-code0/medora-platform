import { describe, expect, it } from 'vitest';

import {
  UNSCOPED,
  isInScope,
  ownedByDoctor,
  visibleToScope,
  type ClinicScope,
  type DoctorScoped,
} from './index';

/**
 * D-27b's scoping rules.
 *
 * These pin what the *frontend* guarantees: a doctor is never shown another
 * clinic's rows. They are deliberately not a security test, because this is
 * not a security boundary — everything a client filters, a client can
 * unfilter. The server enforces the isolation; these keep the display honest.
 */

const row = (id: string, clinicId: string, doctorId: string): DoctorScoped & { id: string } => ({
  id,
  clinicId,
  doctorId,
});

const ROWS = [
  row('a', 'clinic-1', 'dr-1'),
  row('b', 'clinic-1', 'dr-2'),
  row('c', 'clinic-2', 'dr-3'),
  row('d', 'clinic-2', 'dr-1'), // same doctor id, different clinic
];

const doctorOne: ClinicScope = { clinicId: 'clinic-1', doctorId: 'dr-1' };

describe('visibleToScope', () => {
  it('shows an unscoped account (an admin) everything', () => {
    expect(visibleToScope(ROWS, UNSCOPED)).toHaveLength(4);
  });

  it('shows a clinic-scoped account only its own clinic', () => {
    expect(visibleToScope(ROWS, doctorOne).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('excludes an unattributed row rather than including it', () => {
    /*
     * A row with no clinic is one nobody can prove belongs here. Defaulting
     * it visible is what a leak looks like in a demo, so the filter fails
     * closed.
     */
    const withOrphan = [...ROWS, { id: 'orphan', clinicId: '', doctorId: 'dr-1' }];
    expect(visibleToScope(withOrphan, doctorOne).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('never lets a clinic named "" collapse into unscoped', () => {
    // `null` means "spans every clinic"; `''` means "a clinic named nothing".
    const emptyClinic: ClinicScope = { clinicId: '', doctorId: 'dr-1' };
    expect(visibleToScope(ROWS, emptyClinic)).toHaveLength(0);
    expect(visibleToScope(ROWS, UNSCOPED)).toHaveLength(4);
  });
});

describe('ownedByDoctor', () => {
  it('narrows to the doctor’s own rows within their clinic', () => {
    expect(ownedByDoctor(ROWS, doctorOne).map((r) => r.id)).toEqual(['a']);
  });

  it('refuses a row carrying this doctor’s id but another clinic', () => {
    // Row 'd' is dr-1's, but in clinic-2. Clinic membership is checked first.
    expect(ownedByDoctor(ROWS, doctorOne).map((r) => r.id)).not.toContain('d');
  });

  it('falls back to clinic scope when there is no doctor id', () => {
    const clinicOnly: ClinicScope = { clinicId: 'clinic-1', doctorId: null };
    expect(ownedByDoctor(ROWS, clinicOnly).map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('isInScope', () => {
  it('guards a single row the same way the list filter does', () => {
    expect(isInScope(ROWS[0]!, doctorOne)).toBe(true);
    expect(isInScope(ROWS[2]!, doctorOne)).toBe(false);
    expect(isInScope(ROWS[2]!, UNSCOPED)).toBe(true);
  });
});
