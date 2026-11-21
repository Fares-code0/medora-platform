import type { Contact } from './types';

/**
 * Resolving a patient record to the contact who speaks for them (D-24).
 *
 * The doctor's "Send message" lives on the patient profile, so the thing in
 * hand is a patient id; the messaging domain is keyed by contact id. This is
 * the only sanctioned bridge between the two, and it is a lookup rather than
 * a transformation on purpose — see the note on `Contact.patientId`.
 *
 * Returns `undefined` rather than guessing when no contact speaks for the
 * patient: not every patient has portal messaging, and inventing a thread
 * with someone who cannot receive it is the false-success this codebase
 * keeps filing defects about.
 */
export function findContactForPatient(
  contacts: readonly Contact[],
  patientId: string,
): Contact | undefined {
  if (patientId === '') return undefined;
  return contacts.find((contact) => contact.patientId === patientId);
}
