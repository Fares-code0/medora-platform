import type { ApiError } from '@/types/api';

import type { PatientLinkService, PatientLinkState } from '../model/types';

/**
 * The development stand-in.
 *
 * Linked, as the profile fixture is (`linkedToClinicalRecord: true`, "Sara
 * Ahmed"), so the two never disagree on one screen. Issuing a code while
 * linked answers `409 already_linked`, as the real route does; there is no
 * development path that links an account, because linking is a staff
 * action at the hospital desk and the patient app never performs it.
 */

const LINKED: PatientLinkState = {
  linked: true,
  patient: { id: 'PT-000123', fullName: 'Sara Ahmed' },
};

/** Without the ambiguous characters (0/O, 1/I/L), like the server's. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const TTL_MS = 15 * 60_000;

function fail(error: ApiError): never {
  throw Object.assign(new Error(`API error: ${error.kind}`), error);
}

export const fixturePatientLinkService: PatientLinkService = {
  async getState() {
    return LINKED;
  },

  async issueCode() {
    if (LINKED.linked) {
      fail({ kind: 'conflict', code: 'already_linked', detail: 'Account is already linked.' });
    }
    let code = '';
    for (let i = 0; i < 8; i += 1) {
      code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)] ?? 'A';
    }
    return { code, expiresAt: new Date(Date.now() + TTL_MS).toISOString() };
  },
};
