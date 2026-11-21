import { useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Linking, View } from 'react-native';

import { Button, Card, Text } from '@/components';
import { ControlledInput } from '@/components/form/ControlledInput';
import { useFieldChain } from '@/components/form/useFieldChain';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';
import { isApiError } from '@/types/api';
import { logger } from '@/utils/logger';

import type { TwoFactorEnrolment } from '../model/types';
import { isOtpauthUrl } from '../otpauth';
import {
  disableTwoFactorFormSchema,
  enableTwoFactorFormSchema,
  setupTwoFactorFormSchema,
  type DisableTwoFactorForm,
  type EnableTwoFactorForm,
  type SetupTwoFactorForm,
} from '../schemas';
import { authService } from '../service';
import { useAuthError } from '../useAuthErrorMessage';


import { FormBanner } from './FormBanner';
import { TwoFactorReenrol } from './TwoFactorReenrol';

/**
 * Two-factor enrolment — checklist D-16, API §2.9.
 *
 * Built against the three live routes (`POST /me/2fa/setup`, `/enable`,
 * `/disable`), so like P-05 this is a real call to a real server rather
 * than a screen over a fixture.
 *
 * ── Why there is no QR code ──────────────────────────────────────────
 * The obvious rendering of `otpauthUrl` is a QR, and a QR needs
 * `react-native-svg` plus a QR library — two dependencies, one of them
 * native, for a picture that is close to useless in this exact case: a
 * patient cannot scan their own phone's screen. On a phone the better
 * affordance is already in the URL. `otpauth://` is the scheme every
 * authenticator app registers, so **Linking hands the enrolment straight
 * to the app** with the secret and issuer pre-filled, in one tap. The
 * base32 secret is shown underneath for a patient enrolling on a second
 * device or using an app that does not register the scheme.
 *
 * ── The recovery codes ───────────────────────────────────────────────
 * `setup` is the ONLY response that ever carries them; the server keeps
 * them encrypted and never reads them back. So this screen is the one
 * place they exist outside the server, it says so plainly, and it holds
 * them in component state only — never a store, never a log, and gone
 * with the screen (T-03).
 *
 * ── The password comes first (owner decision D2) ─────────────────────
 * Setup takes the CURRENT password, and the server mints no secret and
 * no recovery code until it has accepted it. So "Set up" opens a password
 * step rather than calling the server, and the key and codes appear only
 * after a successful answer. A wrong password is reported on the form; a
 * lockout (429) is the server ending this session, which the app's
 * signed-out handling picks up at the next request.
 *
 * ── What this screen claims, and when ────────────────────────────────
 * **Only what the server said.** `GET /me/2fa` (owner decision R2) reports
 * whether 2FA is on and how many recovery codes are left. Where it answers,
 * the screen shows the state, offers the one action that applies (set up,
 * or replace and turn off), and re-reads after every change. Where the
 * route is absent (`null` — an API older than R2) or the read fails, it
 * asserts nothing and falls back to offering both actions, as before the
 * route existed. Inventing a persisted state — or inferring one from a
 * past `otp_required` — would be a screen asserting something it has not
 * been told.
 */

type Stage = 'idle' | 'verifying' | 'enrolling' | 'enabled';

/** Shared with nothing else: the status is this screen's alone. */
export const twoFactorStatusKey = ['auth', 'two-factor-status'] as const;

/** Running low at two: the server issues new codes only with a new app. */
const LOW_CODES = 2;

export function TwoFactorSetup() {
  const authError = useAuthError();
  const theme = useTheme();
  const t = useT();
  const [stage, setStage] = useState<Stage>('idle');
  const [enrolment, setEnrolment] = useState<TwoFactorEnrolment | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const queryClient = useQueryClient();
  const statusQuery = useQuery({
    queryKey: twoFactorStatusKey,
    queryFn: () => authService.twoFactorStatus(),
    retry: false,
  });
  // `undefined` while loading or after a failed read, `null` when the
  // server does not serve the route: both mean "not known".
  const status = statusQuery.data ?? null;
  const refreshStatus = () => queryClient.invalidateQueries({ queryKey: twoFactorStatusKey });
  const codesMessage = (remaining: number): string => {
    const count =
      remaining === 1
        ? t('security.twoFactor.codesLeftOne')
        : t('security.twoFactor.codesLeftMany', { count: remaining });
    if (remaining === 0) return `${count} ${t('security.twoFactor.codesNone')}`;
    if (remaining <= LOW_CODES) return `${count} ${t('security.twoFactor.codesLow')}`;
    return count;
  };

  const setupForm = useForm<SetupTwoFactorForm>({
    resolver: zodResolver(setupTwoFactorFormSchema),
    defaultValues: { password: '' },
  });
  const enableForm = useForm<EnableTwoFactorForm>({
    resolver: zodResolver(enableTwoFactorFormSchema),
    defaultValues: { code: '' },
  });
  const disableForm = useForm<DisableTwoFactorForm>({
    resolver: zodResolver(disableTwoFactorFormSchema),
    defaultValues: { password: '' },
  });

  const askForPassword = () => {
    setBanner(null);
    setNotice(null);
    setupForm.reset({ password: '' });
    setStage('verifying');
  };

  const cancelSetup = () => {
    setBanner(null);
    setupForm.reset({ password: '' });
    setStage('idle');
  };

  const submitSetup = setupForm.handleSubmit(async (values) => {
    setBanner(null);
    setBusy(true);
    try {
      const next = await authService.setupTwoFactor(values.password);
      setEnrolment(next);
      setStage('enrolling');
    } catch (error) {
      setBanner(authError(error));
      // Locked out: the server has ended this session, so there is no
      // second try to offer here.
      if (isApiError(error) && error.kind === 'rate_limited') setStage('idle');
    } finally {
      // The password leaves the form whatever the answer was.
      setupForm.reset({ password: '' });
      setBusy(false);
    }
  });

  const submitCode = enableForm.handleSubmit(async (values) => {
    setBanner(null);
    setBusy(true);
    try {
      await authService.enableTwoFactor(values.code);
      // The plaintext enrolment leaves memory here rather than at the
      // next render: the codes have been written down or they have not.
      setEnrolment(null);
      enableForm.reset({ code: '' });
      setStage('enabled');
      setNotice(t('security.twoFactor.enabled'));
      void refreshStatus();
    } catch (error) {
      setBanner(authError(error));
    } finally {
      setBusy(false);
    }
  });

  const submitDisable = disableForm.handleSubmit(async (values) => {
    setBanner(null);
    setDisabling(true);
    try {
      await authService.disableTwoFactor(values.password);
      disableForm.reset({ password: '' });
      setStage('idle');
      setNotice(t('security.twoFactor.disabled'));
      void refreshStatus();
    } catch (error) {
      setBanner(authError(error));
    } finally {
      setDisabling(false);
    }
  });

  const setupChain = useFieldChain({ length: 1, onSubmit: () => void submitSetup() });
  const codeChain = useFieldChain({ length: 1, onSubmit: () => void submitCode() });
  const passwordChain = useFieldChain({ length: 1, onSubmit: () => void submitDisable() });

  const openAuthenticator = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      // No app registered for `otpauth://`. The secret below is the
      // fallback and is already on screen, so there is nothing to say.
      logger.warn('No authenticator app answered the otpauth link');
    }
  };

  return (
    <View style={{ rowGap: theme.space[4] }} testID="two-factor-setup">
      {notice === null ? null : (
        <FormBanner tone="success" testID="two-factor-notice" message={notice} />
      )}
      {banner === null ? null : <FormBanner testID="two-factor-error" message={banner} />}

      {status === null || stage === 'enrolling' ? null : (
        <View style={{ rowGap: theme.space[1] }} testID="two-factor-status">
          <Text variant="bodyStrong">
            {status.enabled ? t('security.twoFactor.statusOn') : t('security.twoFactor.statusOff')}
          </Text>
          {status.enabled ? (
            <Text
              variant="bodySm"
              color={status.recoveryCodesRemaining <= LOW_CODES ? 'textPrimary' : 'textSecondary'}
              testID="two-factor-codes-left"
            >
              {codesMessage(status.recoveryCodesRemaining)}
            </Text>
          ) : null}
        </View>
      )}

      {replacing ? (
        <TwoFactorReenrol
          onCancel={() => setReplacing(false)}
          onReplaced={() => void refreshStatus()}
        />
      ) : null}

      {stage === 'enrolling' && enrolment !== null ? (
        <View style={{ rowGap: theme.space[4] }}>
          <Text variant="body" color="textSecondary">
            {t('security.twoFactor.intro')}
          </Text>

          {isOtpauthUrl(enrolment.otpauthUrl) ? (
            <Button
              label={t('security.twoFactor.openApp')}
              testID="two-factor-open-app"
              fullWidth
              onPress={() => void openAuthenticator(enrolment.otpauthUrl)}
            />
          ) : null}

          <Card tone="sunken">
            <Text variant="label" color="textSecondary">
              {t('security.twoFactor.manualKey')}
            </Text>
            <Text variant="bodyStrong" testID="two-factor-secret" selectable>
              {enrolment.secret}
            </Text>
          </Card>

          <Card tone="sunken" testID="two-factor-recovery-codes">
            <Text variant="label" color="textSecondary">
              {t('security.twoFactor.recoveryTitle')}
            </Text>
            <Text variant="bodySm" color="textSecondary">
              {t('security.twoFactor.recoveryBody')}
            </Text>
            {enrolment.recoveryCodes.map((code) => (
              <Text key={code} variant="bodyStrong" selectable>
                {code}
              </Text>
            ))}
          </Card>

          <ControlledInput
            {...codeChain.field(0)}
            control={enableForm.control}
            name="code"
            label={t('security.twoFactor.codeLabel')}
            testID="two-factor-code"
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={6}
            required
          />

          <Button
            label={t('security.twoFactor.confirm')}
            size="lg"
            fullWidth
            loading={busy}
            testID="two-factor-confirm"
            onPress={() => void submitCode()}
          />
        </View>
      ) : stage === 'verifying' ? (
        <View style={{ rowGap: theme.space[3] }} testID="two-factor-verify">
          <Text variant="body" color="textSecondary">
            {t('security.twoFactor.passwordIntro')}
          </Text>
          <ControlledInput
            {...setupChain.field(0)}
            control={setupForm.control}
            name="password"
            label={t('auth.field.password')}
            testID="two-factor-setup-password"
            secure
            autoCapitalize="none"
            autoComplete="current-password"
            required
          />
          <Button
            label={t('security.twoFactor.continue')}
            size="lg"
            fullWidth
            loading={busy}
            testID="two-factor-setup-continue"
            onPress={() => void submitSetup()}
          />
          <Button
            label={t('security.twoFactor.cancel')}
            tone="secondary"
            fullWidth
            disabled={busy}
            testID="two-factor-setup-cancel"
            onPress={cancelSetup}
          />
        </View>
      ) : replacing ? null : status?.enabled === true ? (
        <Button
          label={t('security.twoFactor.replace')}
          tone="secondary"
          fullWidth
          testID="two-factor-replace"
          onPress={() => {
            setBanner(null);
            setNotice(null);
            setReplacing(true);
          }}
        />
      ) : (
        <Button
          label={t('security.twoFactor.start')}
          tone="secondary"
          fullWidth
          testID="two-factor-start"
          onPress={askForPassword}
        />
      )}

      {stage === 'enrolling' ||
      stage === 'verifying' ||
      replacing ||
      status?.enabled === false ? null : (
        <View style={{ rowGap: theme.space[2] }}>
          <Text variant="caption" color="textTertiary">
            {t('security.twoFactor.disableIntro')}
          </Text>
          <ControlledInput
            {...passwordChain.field(0)}
            control={disableForm.control}
            name="password"
            label={t('auth.field.password')}
            testID="two-factor-password"
            secure
            autoCapitalize="none"
            autoComplete="current-password"
          />
          <Button
            label={t('security.twoFactor.disable')}
            tone="secondary"
            fullWidth
            loading={disabling}
            testID="two-factor-disable"
            onPress={() => void submitDisable()}
          />
        </View>
      )}
    </View>
  );
}
