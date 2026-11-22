import { StyleSheet, View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import { Button, Card, Divider, Icon, Screen, Section, Text } from '@/components';
import { useTheme } from '@/theme';

import { EmergencyCallButton } from '../components/EmergencyCallButton';
import { EmergencyContacts } from '../components/EmergencyContacts';
import { EmergencyDisclaimer } from '../components/EmergencyDisclaimer';
import { RED_FLAGS, WHEN_TO_CALL_VS_BOOK } from '../content/guidance';
import { openMap } from '../dial';
import { useEmergencyConfiguration } from '../hooks/useEmergencyConfiguration';

/**
 * The Emergency screen.
 *
 * ── The five guarantees, and where each is kept ──────────────────────
 *
 * 1. **Works signed out** — it is a route in the AuthStack as well as a
 *    modal over the tabs (`navigation/RootNavigator.tsx`). It reads no
 *    session and calls nothing that requires one.
 * 2. **Works offline** — every word below `EmergencyDisclaimer` comes
 *    from `content/guidance.ts`, which is bundled. `useEmergencyConfiguration`
 *    adds operator numbers when they exist and is silent when they do not.
 * 3. **No API dependency** — nothing here can fail. There is no loading
 *    state, no error state and no retry, because there is nothing to
 *    retry.
 * 4. **Never dials on one tap** — every dial goes through
 *    `EmergencyCallButton`'s confirmation sheet, which names the number.
 * 5. **Never invents a number** — when the operator has configured none,
 *    the screen says so, in the place a number would have been, and tells
 *    the patient to call their local emergency number.
 *
 * The unconfigured branch is not a placeholder to be replaced later. It is
 * the correct behaviour for a deployment whose operator has not supplied
 * numbers, and it must survive BE-11 landing.
 */
export function EmergencyScreen({ onBook }: { onBook?: () => void }) {
  const theme = useTheme();
  const configuration = useEmergencyConfiguration();

  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.background }]}>
      {/* Outside the ScrollView, so it cannot be scrolled away (N-02). */}
      <View style={{ padding: theme.screenGutter, paddingBottom: 0 }}>
        <EmergencyDisclaimer />
      </View>

      <Screen testID="emergency-screen">
        <Text critical variant="h1" {...headingA11y('Emergency help')}>
          Emergency help
        </Text>

        {configuration.numbers.length > 0 ? (
          <Section title="Call for help" subtitle="Numbers provided by your clinic for this region">
            <View style={{ rowGap: theme.space[4] }}>
              {configuration.numbers.map((entry) => (
                <EmergencyCallButton
                  key={entry.id}
                  testID={`emergency-call-${entry.id}`}
                  label={entry.label}
                  number={entry.number}
                  {...(entry.whenToUse === undefined ? {} : { whenToUse: entry.whenToUse })}
                />
              ))}
            </View>
          </Section>
        ) : (
          /* The unconfigured state. Honest, and still actionable —
             the instruction is correct in every country. */
          <Card tone="warning" testID="emergency-numbers-unconfigured">
            <View style={[styles.row, { columnGap: theme.space[2] }]}>
              <Icon name="phone" size={20} color="warning" />
              <Text critical variant="h3" color="warning" style={styles.grow}>
                Call your local emergency number
              </Text>
            </View>
            <Text critical variant="bodySm" color="textSecondary">
              This copy of Medora has not been given emergency numbers for your region, so it will
              not show one. Use the emergency number for the country you are in — it is usually on
              the back of your phone&apos;s SIM card, and every mobile phone can dial it even when
              locked or out of credit.
            </Text>
          </Card>
        )}

        <Section title="Call immediately if you see any of these">
          <Card padded={false}>
            {RED_FLAGS.map((flag, index) => (
              <View key={flag.id}>
                {index === 0 ? null : <Divider />}
                <View
                  accessible
                  accessibilityLabel={`${flag.title}. ${flag.detail}`}
                  style={{ padding: theme.space[4], rowGap: theme.space[1] }}
                >
                  <View style={[styles.row, { columnGap: theme.space[2] }]}>
                    <Icon name="alertCircle" size={16} color="error" />
                    <Text critical variant="bodyStrong" style={styles.grow}>
                      {flag.title}
                    </Text>
                  </View>
                  <Text critical variant="bodySm" color="textTertiary">
                    {flag.detail}
                  </Text>
                </View>
              </View>
            ))}
          </Card>
        </Section>

        {/*
          Below the red flags and above the clinic: the order on this
          screen is who to call first. An emergency number outranks a
          relative, a relative outranks a reception desk, and none of
          them outranks knowing whether to call at all.

          It renders nothing when there is no session, no contacts, or no
          endpoint — which is every production build today (BE-09). The
          component carries why an absence is right here.
        */}
        <EmergencyContacts />

        {configuration.clinic === null ? null : (
          <Section title="Your clinic" subtitle="For urgent problems that are not emergencies">
            <Card>
              <Text critical variant="bodyStrong">{configuration.clinic.name}</Text>
              <Text critical variant="bodySm" color="textTertiary">
                {configuration.clinic.addressLine}
              </Text>
              <View style={{ rowGap: theme.space[2] }}>
                <EmergencyCallButton
                  testID="emergency-call-clinic"
                  label="the clinic"
                  number={configuration.clinic.phone}
                />
                <Button
                  label="Open in maps"
                  tone="secondary"
                  icon="mapPin"
                  fullWidth
                  onPress={() => {
                    if (configuration.clinic !== null)
                      void openMap(configuration.clinic.addressLine);
                  }}
                />
              </View>
            </Card>
          </Section>
        )}

        <Section title="When to call, and when to book">
          <Card tone="sunken">
            <Text critical variant="label" color="error">
              Call the emergency number
            </Text>
            <Text critical variant="bodySm" color="textSecondary">
              {WHEN_TO_CALL_VS_BOOK.callNow}
            </Text>
            <Divider />
            <Text critical variant="label" color="warning">
              Call the clinic
            </Text>
            <Text critical variant="bodySm" color="textSecondary">
              {WHEN_TO_CALL_VS_BOOK.callClinic}
            </Text>
            <Divider />
            <Text critical variant="label" color="primary">
              Book an appointment
            </Text>
            <Text critical variant="bodySm" color="textSecondary">
              {WHEN_TO_CALL_VS_BOOK.bookAppointment}
            </Text>
            {onBook === undefined ? null : (
              <Button
                label="Book an appointment"
                tone="secondary"
                testID="emergency-book"
                onPress={onBook}
              />
            )}
            <Divider />
            <Text critical variant="bodySm" color="textTertiary">
              {WHEN_TO_CALL_VS_BOOK.neverMessage}
            </Text>
          </Card>
        </Section>

        {/* Provenance, so nobody has to guess where a number came from. */}
        <Text critical variant="caption" color="textDisabled" align="center">
          {configuration.source === 'unconfigured'
            ? 'No emergency numbers are configured for this deployment.'
            : 'Emergency numbers are supplied by your clinic.'}
        </Text>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  grow: { flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row' },
});
