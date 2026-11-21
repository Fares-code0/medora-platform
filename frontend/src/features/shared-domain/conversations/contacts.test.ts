import { describe, expect, it } from 'vitest';

import { findContactForPatient } from './contacts';
import { SEED_CONTACTS } from './seed';
import type { Contact } from './types';

/**
 * The patient → contact bridge behind D-24's "Send message" on a patient
 * profile. It is a lookup on a stated field, never a transformation of the
 * contact id, and these pin that distinction.
 */

describe('findContactForPatient', () => {
  it('resolves a seeded patient to their contact', () => {
    const contact = findContactForPatient(SEED_CONTACTS, 'PT-1002');
    expect(contact?.id).toBe('ct-pt-1002');
    expect(contact?.role).toBe('patient');
  });

  it('returns undefined for a patient with no messaging contact', () => {
    // PT-1001 is in the roster but has no portal contact in the seed.
    expect(findContactForPatient(SEED_CONTACTS, 'PT-1001')).toBeUndefined();
  });

  it('returns undefined for an empty id rather than matching a contact without one', () => {
    // Every non-patient contact has no patientId; `''` must not match them.
    expect(findContactForPatient(SEED_CONTACTS, '')).toBeUndefined();
  });

  it('never matches by reconstructing the contact id from the patient id', () => {
    /*
     * The seed's ids happen to encode the record id (`ct-pt-1002`), and a
     * tempting implementation is `contacts.find(c => c.id === 'ct-' + ...)`.
     * That would make the PHI-safe naming convention load-bearing for
     * navigation. A contact whose id follows the convention but whose
     * `patientId` says otherwise must not match.
     */
    const misleading: readonly Contact[] = [
      {
        id: 'ct-pt-9999',
        name: 'Someone Else',
        role: 'patient',
        department: 'Patient portal',
        presence: 'offline',
        lastActiveAt: new Date().toISOString(),
        favorite: false,
        patientId: 'PT-0001',
      },
    ];
    expect(findContactForPatient(misleading, 'PT-9999')).toBeUndefined();
    expect(findContactForPatient(misleading, 'PT-0001')?.id).toBe('ct-pt-9999');
  });

  it('keeps every seeded patient contact resolvable', () => {
    const patients = SEED_CONTACTS.filter((contact) => contact.role === 'patient');
    expect(patients.length).toBeGreaterThan(0);
    for (const contact of patients) {
      expect(contact.patientId).toBeDefined();
      expect(findContactForPatient(SEED_CONTACTS, contact.patientId ?? '')).toBe(contact);
    }
  });
});
