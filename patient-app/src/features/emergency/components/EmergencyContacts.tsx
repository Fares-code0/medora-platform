import { View } from 'react-native';

import { Card, Section, Text } from '@/components';
import { useOptionalSession } from '@/features/auth/SessionProvider';
import { useEmergencyContacts } from '@/features/health/hooks';
import { useTheme } from '@/theme';

import { EmergencyCallButton } from './EmergencyCallButton';

/**
 * The patient's own emergency contacts — checklist N-08.
 *
 * ── It may add to this screen and it may never take from it ──────────
 *
 * The Emergency screen renders in airplane mode, from the signed-out
 * stack, with no session (N-06, N-01), and `emergency.test.tsx` mounts
 * it with **no providers at all** to prove it. This section is an
 * addition to that screen and inherits the constraint whole:
 *
 * - **No session, no section.** `useOptionalSession` returns `null`
 *   outside a provider and the component returns `null` in turn, so the
 *   signed-out stack and the bare test render exactly what they did
 *   before.
 * - **No request when signed out.** The query is `enabled` only for an
 *   authenticated session, so nothing is attempted from a screen a
 *   patient reached without signing in.
 * - **A failure renders nothing.** Not an error card, not a retry. The
 *   guidance below is the screen; a list of relatives that could not
 *   load must not sit on top of it saying so. In production today the
 *   read refuses by name (BE-09), so the section is simply absent.
 *
 * ── Two-step dial, and read-only ─────────────────────────────────────
 *
 * Every number here goes through `EmergencyCallButton`, the same
 * confirmation sheet the emergency numbers use (N-03) — a contact is a
 * person, and calling the wrong one from a pocket is the same defect.
 *
 * There is no add, edit or delete. The clinic records who to call
 * (`patient_emergency_contacts`), and a patient editing a clinician's
 * record through a screen designed for a crisis is not an improvement.
 * RA-030.2 is the decision that would change that, and it is open.
 */
export function EmergencyContacts() {
  const theme = useTheme();
  const session = useOptionalSession();
  const authenticated = session?.state.status === 'authenticated';
  const contacts = useEmergencyContacts(authenticated);

  if (!authenticated) return null;
  // Pending, failed and empty all render nothing: this section exists
  // only when there is somebody to call.
  if (contacts.data === undefined || contacts.data.length === 0) return null;

  return (
    <Section title="Your emergency contacts" subtitle="Recorded by your clinic">
      <View style={{ rowGap: theme.space[3] }}>
        {contacts.data.map((contact) => (
          <Card key={contact.id} testID={`emergency-contact-${contact.id}`}>
            <Text variant="bodyStrong">{contact.name}</Text>
            <Text variant="bodySm" color="textTertiary">
              {contact.relationship === null
                ? contact.primary
                  ? 'First to call'
                  : 'Emergency contact'
                : contact.primary
                  ? `${contact.relationship} · first to call`
                  : contact.relationship}
            </Text>
            <EmergencyCallButton
              testID={`emergency-call-contact-${contact.id}`}
              label={contact.name}
              number={contact.phone}
            />
          </Card>
        ))}
      </View>
    </Section>
  );
}
