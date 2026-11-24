import { useCallback, useState } from 'react';

import { StyleSheet, View } from 'react-native';

import { announce } from '@/accessibility/a11y';
import { Button, ConfirmSheet, Text } from '@/components';
import { useT } from '@/i18n';
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
 *
 * ── Language (W-10 translation approval, 2026-11-23) ─────────────────
 * Every sentence here is an `emergency.call.*` catalogue key. `label`
 * and `number` are interpolated, never translated: a contact's name and
 * an operator's dial string are data. The Arabic templates isolate both
 * (FSI/LRI … PDI) so a Latin label or a "+966 …" number is not reordered
 * inside a right-to-left sentence.
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
  const t = useT();
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
        announce(t('emergency.call.failedAnnouncement', { number }));
      }
    });
  }, [number, t]);

  return (
    <View style={{ rowGap: theme.space[2] }}>
      <Button
        testID={testID}
        label={t('emergency.call.label', { label })}
        tone="emergency"
        size="lg"
        icon="phoneCall"
        fullWidth
        // The hint is what stops a screen-reader user believing the tap
        // has already placed the call.
        hint={t('emergency.call.hint', { number })}
        onPress={() => setConfirming(true)}
      />

      {whenToUse === undefined ? null : (
        <Text critical variant="caption" color="textTertiary">
          {whenToUse}
        </Text>
      )}

      {failed ? (
        <View
          accessible
          accessibilityLiveRegion="assertive"
          accessibilityLabel={t('emergency.call.failedA11y', { number })}
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
          <Text critical variant="bodySm" color="warning">
            {t('emergency.call.failedText')}
          </Text>
          {/*
            Left-to-right whatever the layout. A bare "+966 11 234 5678"
            has no strong character, so in an Arabic (RTL) paragraph the
            bidi algorithm can lay its digit groups out in reverse — a
            misread emergency number. `writingDirection` fixes the
            paragraph direction without changing the text a screen reader
            or a copy-paste receives.
          */}
          <Text
            critical
            variant="metric"
            color="textPrimary"
            selectable
            testID={testID === undefined ? undefined : `${testID}-fallback-number`}
            style={styles.number}
          >
            {number}
          </Text>
        </View>
      ) : null}

      <ConfirmSheet
        testID={testID === undefined ? undefined : `${testID}-confirm-sheet`}
        visible={confirming}
        title={t('emergency.call.confirmTitle', { label })}
        // Naming the number IS the confirmation. "Are you sure?" is not.
        detail={t('emergency.call.confirmDetail', { number })}
        confirmLabel={t('emergency.call.confirmAction', { number })}
        tone="emergency"
        cancelLabel={t('emergency.call.notNow')}
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
  number: { writingDirection: 'ltr' },
});
