import { useState } from 'react';

import { Linking, View } from 'react-native';

import { Button, Card, Input, Text } from '@/components';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';
import { isApiError } from '@/types/api';
import { logger } from '@/utils/logger';

import type { TwoFactorReenrollment } from '../model/types';
import { isOtpauthUrl } from '../otpauth';
import { authService } from '../service';
import { useSession } from '../SessionProvider';
import { useAuthError } from '../useAuthErrorMessage';


import { FormBanner } from './FormBanner';

type Step = 'verify' | 'new-app' | 'codes';

const SIX_DIGITS = /^\d{6}$/;

export interface TwoFactorReenrolProps {
  /** Closes the flow without changing anything (before the confirm step). */
  readonly onCancel: () => void;
  /** The factor and the codes were replaced; the caller re-reads the status. */
  readonly onReplaced: () => void;
}

/**
 * Replacing the authenticator app (owner decision Q7 / R4) —
 * `POST /me/2fa/reenroll`, then `/reenroll/confirm`. Served on `main`
 * since Q7 / R4; `TwoFactorSetup` offers this only when
 * `GET /me/2fa`, which shipped with it, reported the factor on.
 *
 * Nothing changes on the server until step 2 succeeds. The old app and the
 * old recovery codes keep working until then, so leaving part-way leaves
 * the account as it was.
 *
 *  1. The password and a code from the CURRENT app. A session alone may
 *     not replace a live secret — the defect Q7 closed.
 *  2. The new key (handed to the authenticator app by `otpauth://`, as at
 *     enrolment) and a code from the NEW app.
 *  3. The new recovery codes, shown once and held in component state only
 *     (T-03), exactly as enrolment holds the first set.
 *
 * Step 1 spends from the sign-in guess budget. The guess that reaches the
 * lockout makes the server revoke this session (429), so the screen says
 * so and the only way on is to sign in again.
 *
 * A patient who has lost the current app AND the recovery codes is not
 * served here: no recovery process for that case is approved (owner
 * clarification C-1), and none is offered or implied.
 */
export function TwoFactorReenrol({ onCancel, onReplaced }: TwoFactorReenrolProps) {
  const t = useT();
  const theme = useTheme();
  const authError = useAuthError();
  const { logout } = useSession();
  const [step, setStep] = useState<Step>('verify');
  const [password, setPassword] = useState('');
  const [currentCode, setCurrentCode] = useState('');
  const [newCode, setNewCode] = useState('');
  const [started, setStarted] = useState<TwoFactorReenrollment | null>(null);
  const [codes, setCodes] = useState<readonly string[] | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [lockedOut, setLockedOut] = useState(false);
  const [busy, setBusy] = useState(false);

  const verify = async () => {
    setBanner(null);
    setBusy(true);
    try {
      setStarted(await authService.startTwoFactorReenrollment({ password, code: currentCode }));
      setStep('new-app');
    } catch (error) {
      setCurrentCode('');
      if (isApiError(error) && error.kind === 'rate_limited') {
        setPassword('');
        setLockedOut(true);
        setBanner(t('security.twoFactor.lockedOut'));
      } else if (isApiError(error) && error.code === 'otp_invalid') {
        setBanner(t('security.twoFactor.currentCodeInvalid'));
      } else {
        setBanner(authError(error));
      }
    } finally {
      setBusy(false);
    }
  };

  const replace = async () => {
    if (started === null) return;
    setBanner(null);
    setBusy(true);
    try {
      const next = await authService.confirmTwoFactorReenrollment({
        enrolmentToken: started.enrolmentToken,
        code: newCode,
      });
      setStarted(null);
      setCodes(next);
      setStep('codes');
      onReplaced();
    } catch (error) {
      setNewCode('');
      if (isApiError(error) && error.code === 'token_invalid') {
        // Expired (it lives as long as a sign-in challenge) or bound to
        // another session: start again from step 1.
        setStarted(null);
        setPassword('');
        setCurrentCode('');
        setStep('verify');
        setBanner(t('security.twoFactor.replaceExpired'));
      } else {
        setBanner(authError(error));
      }
    } finally {
      setBusy(false);
    }
  };

  const openAuthenticator = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      logger.warn('No authenticator app answered the otpauth link');
    }
  };

  return (
    <View style={{ rowGap: theme.space[4] }} testID="two-factor-reenrol">
      {banner === null ? null : <FormBanner testID="two-factor-reenrol-error" message={banner} />}

      {lockedOut ? (
        <Button
          label={t('security.twoFactor.signInAgain')}
          fullWidth
          testID="two-factor-reenrol-sign-in"
          onPress={() => void logout()}
        />
      ) : null}

      {!lockedOut && step === 'verify' ? (
        <View style={{ rowGap: theme.space[3] }}>
          <Text variant="body" color="textSecondary">
            {t('security.twoFactor.replaceIntro')}
          </Text>
          <Input
            label={t('auth.field.password')}
            testID="two-factor-reenrol-password"
            value={password}
            onChangeText={setPassword}
            secure
            autoCapitalize="none"
            autoComplete="current-password"
            required
          />
          <Input
            label={t('security.twoFactor.currentCodeLabel')}
            testID="two-factor-reenrol-current-code"
            value={currentCode}
            onChangeText={(value) => setCurrentCode(value.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={6}
            required
          />
          <Button
            label={t('security.twoFactor.continue')}
            size="lg"
            fullWidth
            loading={busy}
            disabled={password === '' || !SIX_DIGITS.test(currentCode)}
            testID="two-factor-reenrol-continue"
            onPress={() => void verify()}
          />
          <Button
            label={t('action.cancel')}
            tone="ghost"
            disabled={busy}
            testID="two-factor-reenrol-cancel"
            onPress={onCancel}
          />
        </View>
      ) : null}

      {step === 'new-app' && started !== null ? (
        <View style={{ rowGap: theme.space[3] }}>
          {isOtpauthUrl(started.otpauthUrl) ? (
            <Button
              label={t('security.twoFactor.openApp')}
              fullWidth
              testID="two-factor-reenrol-open-app"
              onPress={() => void openAuthenticator(started.otpauthUrl)}
            />
          ) : null}
          <Card tone="sunken">
            <Text variant="label" color="textSecondary">
              {t('security.twoFactor.manualKey')}
            </Text>
            <Text variant="bodyStrong" testID="two-factor-reenrol-secret" selectable>
              {started.secret}
            </Text>
          </Card>
          <Input
            label={t('security.twoFactor.newCodeLabel')}
            testID="two-factor-reenrol-new-code"
            value={newCode}
            onChangeText={(value) => setNewCode(value.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={6}
            required
          />
          <Button
            label={t('security.twoFactor.replaceConfirm')}
            size="lg"
            fullWidth
            loading={busy}
            disabled={!SIX_DIGITS.test(newCode)}
            testID="two-factor-reenrol-confirm"
            onPress={() => void replace()}
          />
          <Button
            label={t('action.cancel')}
            tone="ghost"
            disabled={busy}
            testID="two-factor-reenrol-cancel"
            onPress={onCancel}
          />
        </View>
      ) : null}

      {step === 'codes' && codes !== null ? (
        <View style={{ rowGap: theme.space[3] }}>
          <FormBanner tone="success" message={t('security.twoFactor.replaced')} />
          <Card tone="sunken" testID="two-factor-reenrol-codes">
            <Text variant="label" color="textSecondary">
              {t('security.twoFactor.newCodesTitle')}
            </Text>
            <Text variant="bodySm" color="textSecondary">
              {t('security.twoFactor.recoveryBody')}
            </Text>
            {codes.map((code) => (
              <Text key={code} variant="bodyStrong" selectable>
                {code}
              </Text>
            ))}
          </Card>
          <Button
            label={t('security.twoFactor.done')}
            fullWidth
            testID="two-factor-reenrol-done"
            onPress={onCancel}
          />
        </View>
      ) : null}
    </View>
  );
}
