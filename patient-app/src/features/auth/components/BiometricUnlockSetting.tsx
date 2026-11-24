import { useCallback, useEffect, useState } from 'react';

import { Card, Text } from '@/components';
import { Checkbox } from '@/components/form/Checkbox';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';

import {
  expoBiometricGate,
  isBiometricUnlockEnabled,
  setBiometricUnlockEnabled,
  type BiometricAvailability,
  type BiometricGate,
} from '../biometrics';

/**
 * The D-15 opt-in, on the Security screen.
 *
 * ── Hidden, not disabled, when the device cannot do it ───────────────
 * A device with no sensor, or with nothing enrolled, shows nothing at
 * all. A greyed-out control with "your phone does not support this" is
 * an answer to a question the patient never asked, on the one screen
 * where every line should be about something they can act on.
 *
 * ── The copy claims exactly what the feature does ────────────────────
 * "Stops someone using your unlocked phone from reading your records."
 * Not "protects", not "encrypts", not "secures" — the refresh token is
 * in the keychain either way, and a control whose description implies
 * more than it delivers is worse than no control, because a patient
 * makes decisions on the description. `features/auth/biometrics.ts`
 * carries the full reasoning.
 */
export interface BiometricUnlockSettingProps {
  /** Test seam. Production uses the Expo adapter. */
  readonly gate?: BiometricGate;
}

export function BiometricUnlockSetting({ gate = expoBiometricGate }: BiometricUnlockSettingProps) {
  const theme = useTheme();
  const t = useT();
  const [availability, setAvailability] = useState<BiometricAvailability | null>(null);
  const [enabled, setEnabled] = useState(isBiometricUnlockEnabled);

  useEffect(() => {
    let active = true;
    void gate.check().then((result) => {
      if (active) setAvailability(result);
    });
    return () => {
      active = false;
    };
  }, [gate]);

  const change = useCallback((next: boolean) => {
    setBiometricUnlockEnabled(next);
    setEnabled(next);
  }, []);

  // `null` is "still checking", `usable: false` is "this phone cannot".
  // Both render nothing: a control that appears a moment after the
  // screen does is a control the patient's thumb lands on by accident.
  if (availability === null || !availability.usable) return null;

  // "Face ID" is Apple's product name and stays as written. "Fingerprint"
  // and the generic fallback are this app's words (`labelFor` in
  // `biometrics.ts` chooses them), so they are catalogue keys.
  const label =
    availability.label === 'Face ID'
      ? availability.label
      : availability.label === 'Fingerprint'
        ? t('biometric.method.fingerprint')
        : t('biometric.setting.fallbackName');

  return (
    <Card tone="sunken">
      <Checkbox
        label={t('biometric.setting.toggle', { method: label })}
        checked={enabled}
        onChange={change}
        testID="biometric-unlock-toggle"
      />
      <Text variant="bodySm" color="textSecondary" style={{ marginTop: theme.space[2] }}>
        {t('biometric.setting.body', { method: label })}
      </Text>
      <Text variant="bodySm" color="textTertiary" style={{ marginTop: theme.space[2] }}>
        {t('biometric.setting.password')}
      </Text>
    </Card>
  );
}
