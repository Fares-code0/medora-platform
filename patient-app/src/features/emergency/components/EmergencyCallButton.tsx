import { useCallback, useState } from 'react';

import { StyleSheet, View } from 'react-native';

import { announce } from '@/accessibility/a11y';
import { Button, ConfirmSheet, Text } from '@/components';
import { useTheme } from '@/theme';
import { track } from '@/utils/analytics';

import { dial } from '../dial';

/**
 * The two-step dial.
 *
 * ── The requirement, and why it is not negotiable ────────────────────
 * Emergency has to be prominent AND must never dial by accident (audit
 * R-6, checklist N-03). A phone lives in a pocket next to a thumb; a
 * single tap that connects to an ambulance service is a design defect,
 * not a convenience. So:
 *
 * 1. Tap the call button — nothing dials. A sheet opens.
 * 2. The sheet **names the number** and what it reaches.
 * 3. Only the sheet's confirm button dials.
 *
 * There is deliberately **no swipe-to-call and no long-press-to-call**.
 * Both are single gestures, and a long press is the gesture a phone
 * performs on its own inside a bag.
 *
 * ── Failure is visible, not silent ───────────────────────────────────
 * On a device with no dialler the number is shown as text so it can be
 * read aloud to somebody who does have a phone. A dead button on this
 * screen is worse than no button.
 */
export interface EmergencyCallButtonProps {
  readonly label: string;
  readonly number: string;
  readonly whenToUse?: string;
  readonly testID?: string;
}

export function EmergencyCallButton({
  label,
  number,
  whenToUse,
  testID,
}: EmergencyCallButtonProps) {
  const theme = useTheme();
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);

  const confirm = useCallback(() => {
    setConfirming(false);
    // Counted without the number (W-05): whether the second step gets
    // completed is a question about this screen's design, while which
    // number was dialled is a fact about the patient's situation.
    track('emergency.call_confirmed');
    void dial(number).then((ok) => {
      if (!ok) {
        setFailed(true);
        announce(`Could not open the dialler. The number is ${number}.`);
      }
    });
  }, [number]);

  return (
    <View style={{ rowGap: theme.space[2] }}>
      <Button
        testID={testID}
        label={`Call ${label}`}
        tone="emergency"
        size="lg"
        icon="phoneCall"
        fullWidth
        // The hint is what stops a screen-reader user believing the tap
        // has already placed the call.
        hint={`Opens a confirmation before calling ${number}`}
        onPress={() => setConfirming(true)}
      />

      {whenToUse === undefined ? null : (
        <Text variant="caption" color="textTertiary">
          {whenToUse}
        </Text>
      )}

      {failed ? (
        <View
          accessible
          accessibilityLiveRegion="assertive"
          accessibilityLabel={`This device cannot place calls. Dial ${number} from another phone.`}
          style={[
            styles.fallback,
            {
              backgroundColor: theme.colors.warningSubtle,
              borderColor: theme.colors.warning,
              borderRadius: theme.radius.control,
              padding: theme.space[3],
            },
          ]}
        >
          <Text variant="bodySm" color="warning">
            This device cannot place calls. Dial this number from another phone:
          </Text>
          <Text variant="metric" color="textPrimary" selectable>
            {number}
          </Text>
        </View>
      ) : null}

      <ConfirmSheet
        testID={testID === undefined ? undefined : `${testID}-confirm-sheet`}
        visible={confirming}
        title={`Call ${label}?`}
        // Naming the number IS the confirmation. "Are you sure?" is not.
        detail={`Medora will open your phone's dialler with ${number}. Only continue if you need emergency help now.`}
        confirmLabel={`Call ${number}`}
        tone="emergency"
        cancelLabel="Not now"
        onConfirm={confirm}
        onCancel={() => {
          track('emergency.call_dismissed');
          setConfirming(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { borderWidth: 1, rowGap: 4 },
});
