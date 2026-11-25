import type { Contact } from '@/features/shared-domain/conversations';

/**
 * New message, step one — the people this doctor can write to, from the
 * messaging port's own contact list (`fetchContacts`), the same list the old
 * New Message dialog picked from. No second directory is fetched.
 *
 * Two kinds of recipient, kept apart because they are addressed differently:
 *
 * - **Patients** — a contact that speaks for a patient record
 *   (`Contact.patientId`, D-24), addressed by that record id (`?patient=`),
 *   the inbox's existing deep link. A patient with no portal messaging has
 *   no contact, so they cannot be offered here.
 * - **Colleagues** — doctors, nurses and pharmacists, addressed by their
 *   contact id (`?contact=`); they have no patient record.
 *
 * Both start a conversation the same way: `openDirectConversation(contact.id)`.
 *
 * Search is client-side because the port answers the whole list at once. It
 * matches a patient's name and record id, and a colleague's name, role and
 * department. A contact carries no MRN, date of birth or sex, so none of
 * those can be shown or searched.
 */

export type PatientRecipient = Contact & { readonly patientId: string };

export type RecipientGroup = 'patients' | 'colleagues';

const byName = (a: Contact, b: Contact) => a.name.localeCompare(b.name);

export function patientRecipients(contacts: readonly Contact[]): readonly PatientRecipient[] {
  return contacts
    .filter(
      (contact): contact is PatientRecipient =>
        contact.role === 'patient' && contact.patientId !== undefined && contact.patientId !== '',
    )
    .slice()
    .sort(byName);
}

export function colleagueRecipients(contacts: readonly Contact[]): readonly Contact[] {
  return contacts
    .filter((contact) => contact.role !== 'patient')
    .slice()
    .sort(byName);
}

export function filterRecipients(
  recipients: readonly PatientRecipient[],
  query: string,
): readonly PatientRecipient[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return recipients;
  return recipients.filter(
    (recipient) =>
      recipient.name.toLowerCase().includes(needle) ||
      recipient.patientId.toLowerCase().includes(needle),
  );
}

/** `roleLabel` is the colleague's role as shown, so a search for "nurse" works in any language. */
export function filterColleagues(
  colleagues: readonly Contact[],
  query: string,
  roleLabel: (contact: Contact) => string,
): readonly Contact[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return colleagues;
  return colleagues.filter(
    (colleague) =>
      colleague.name.toLowerCase().includes(needle) ||
      colleague.department.toLowerCase().includes(needle) ||
      colleague.role.toLowerCase().includes(needle) ||
      roleLabel(colleague).toLowerCase().includes(needle),
  );
}
