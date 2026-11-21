import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { StyleSheet, View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import { Button, Icon, Text } from '@/components';
import { useT } from '@/i18n';
import { logger } from '@/utils/logger';

import { expoBiometricGate, type BiometricGate, type BiometricOutcome } from '../biometrics';
import { useSession } from '../SessionProvider';

/**
 * The biometric lock screen (checklist D-15).
 *
 * ── Where it sits, and why it replaces rather than overlays ──────────
 * It renders **instead of** the navigator while the lock is up, not on
 * top of it. An overlay leaves the records screen mounted underneath,
 * and the OS photographs whatever is mounted when the app moves to the
 * task switcher — which is the same reason `PhiPrivacyShield` exists
 * (T-09). A cover that can be got behind is not a cover.
 *
 * It sits inside `SessionProvider` because the lock is a property of a
 * live session, and below `UpgradeGate` because a withdrawn build should
 * not be asking anybody for a fingerprint.
 *
 * ── This screen names nobody ─────────────────────────────────────────
 * No name, no email, no avatar, no "welcome back". A lock screen that
 * greets the patient by name is a patient identifier readable by whoever
 * is holding the phone — which is the person this screen exists to stop.
 * `features/auth/storage.ts` refuses to store such a field for exactly
 * this reason, and the screen would be undoing that.
 *
 * ── The way out is always a password ─────────────────────────────────
 * "Use your password instead" ends the session and returns to Login. It
 * is not a bypass: it is the same `logout()` the profile screen calls,
 * so it clears the keychain, the access token and the cache on the way.
 * A patient with a cut finger, a wet hand or a failed sensor must never
 * be one broken sensor away from an uninstall.
 */
export interface BiometricLockGateProps {
  readonly children: ReactNode;
  /** Test seam. Production uses the Expo adapter. */
  readonly gate?: BiometricGate;
}

const PROMPT = 'Unlock Medora';

export function BiometricLockGate({ children, gate = expoBiometricGate }: BiometricLockGateProps) {
  const { locked } = useSession();
  if (!locked) return <>{children}</>;
  return <LockScreen gate={gate} />;
}

function LockScreen({ gate }: { readonly gate: BiometricGate }) {
  const t = useT();
  const { unlock, logout } = useSession();
  const [outcome, setOutcome] = useState<BiometricOutcome | null>(null);
  const [busy, setBusy] = useState(false);

  const attempt = useCallback(async () => {
    setBusy(true);
    try {
      const result = await gate.authenticate(PROMPT);
      setOutcome(result);
      if (result === 'success') {
        unlock();
        return;
      }
      // `unavailable` is the case worth naming: the patient enrolled a
      // fingerprint, turned the setting on, and then removed it in the
      // OS. Leaving them at a prompt that cannot succeed would be the
      // lock-out this feature must not create, so the copy points at
      // the password path instead.
      logger.info('Biometric unlock did not succeed', { biometricOutcome: result });
    } finally {
      setBusy(false);
    }
  }, [gate, unlock]);

  // Prompt once on mount. A patient returning to a locked app expects
  // the sensor, not a button that then summons it.
  useEffect(() => {
    void attempt();
  }, [attempt]);

  const message = t(
    outcome === null || outcome === 'success'
      ? 'biometric.locked.default'
      : outcome === 'cancelled'
        ? 'biometric.locked.cancelled'
        : outcome === 'failed'
          ? 'biometric.locked.failed'
          : 'biometric.locked.unavailable',
  );

  return (
    <View style={styles.container} testID="biometric-lock-screen">
      <View
        accessible
        accessibilityLiveRegion="polite"
        accessibilityLabel={t('biometric.locked.a11y', { message })}
        style={styles.message}
      >
        <Icon name="lock" size={40} color="textSecondary" />
        <Text variant="h2" align="center" {...headingA11y(t('biometric.locked.title'))}>
          {t('biometric.locked.title')}
        </Text>
        <Text variant="bodySm" color="textTertiary" align="center">
          {message}
        </Text>
      </View>

      {outcome === 'unavailable' ? null : (
        <Button
          label={t('biometric.unlock')}
          icon="lock"
          loading={busy}
          onPress={() => void attempt()}
          testID="biometric-unlock"
        />
      )}

      <Button
        label={t('biometric.usePassword')}
        tone="secondary"
        onPress={() => void logout()}
        testID="biometric-use-password"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    rowGap: 16,
  },
  message: { alignItems: 'center', rowGap: 16 },
});
