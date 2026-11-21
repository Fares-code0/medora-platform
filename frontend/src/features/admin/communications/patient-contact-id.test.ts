import { describe, expect, it } from 'vitest';

import { SEED_CONTACTS } from '@/features/shared-domain/conversations';

/**
 * Pins the defect this feature found in its own seed: `ConversationRow`
 * carries a patient's *contact id* (not their name) into
 * `MaskedIdentifier`, and `PhiAccessProvider` writes that id verbatim into
 * the PHI access log as `subjectId` when an admin reveals the identity
 * (ConversationLogsTab.tsx → PhiAccessProvider.tsx). A contact id built
 * from the patient's own name — `ct-mona-adel` was the original sin —
 * defeats the whole point of a non-identifying audit reference. ADM-04
 * fixed the same defect class in patient record ids by naming patients by
 * record id, never by name; this pins the same rule for conversation
 * contacts, derived from the seed so a future patient contact is covered
 * without editing this test.
 *
 * It lives here rather than beside the seed for the same reason as
 * `seed-coverage.test.ts`: shared-domain may not import a role feature
 * (FRONTEND_ARCHITECTURE §3.3, enforced by ESLint), and this is an admin
 * feature's concern about its own audit path.
 */

describe('seeded patient contact ids', () => {
  it('never contain a word of the contact’s own name', () => {
    const patientContacts = SEED_CONTACTS.filter((contact) => contact.role === 'patient');

    // Guard against the assertion below vacuously passing if the seed ever
    // loses its one patient contact.
    expect(patientContacts.length).toBeGreaterThan(0);

    for (const contact of patientContacts) {
      const nameWords = contact.name.toLowerCase().split(/\s+/).filter(Boolean);
      const idLower = contact.id.toLowerCase();

      for (const word of nameWords) {
        expect(idLower.includes(word)).toBe(false);
      }
    }
  });
});
