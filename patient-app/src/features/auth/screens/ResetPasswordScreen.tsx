import { useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useForm, useWatch } from 'react-hook-form';
import { View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import { Button, Screen, Text } from '@/components';
import { ControlledInput } from '@/components/form/ControlledInput';
import { useFieldChain } from '@/components/form/useFieldChain';
import { useT } from '@/i18n';
import type { AuthStackParamList } from '@/navigation/routes';
import { useTheme } from '@/theme';

import { FormBanner } from '../components/FormBanner';
import { PasswordRules } from '../components/PasswordRules';
import { extractEmailedToken } from '../emailed-token';
import { resetPasswordFormSchema, type ResetPasswordForm } from '../schemas';
import { authService } from '../service';
import { useAuthError } from '../useAuthErrorMessage';

type Props = NativeStackScreenProps<AuthStackParamList, 'ResetPassword'>;

/**
 * Set a new password.
 *
 * The token is usually **pasted**. The reset email links to
 * `${APP_PUBLIC_URL}/reset-password?token=…` — the web app, over https
 * (`backend/src/modules/auth/services/auth-mail.service.ts`) — and with
 * no universal link / App Link configured for that host, tapping it
 * opens a browser, not this screen. So the field takes the bare token or
 * the whole link, and `extractEmailedToken` finds the token in either.
 *
 * A `medora://reset-password?token=…` link does prefill the field
 * (`linking.ts`, signed out only), but nothing sends one today: a mobile
 * link base for emailed links is a backend/infrastructure blocker
 * (checklist D-17). The prefill is never submitted on the patient's
 * behalf — they still choose the password and press the button.
 *
 * The rule meter is `PasswordRules`, shared with the signed-in change
 * form so one policy has one presentation.
 */
export function ResetPasswordScreen({ navigation, route }: Props) {
  const authError = useAuthError();
  const theme = useTheme();
  const t = useT();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { control, handleSubmit } = useForm<ResetPasswordForm>({
    resolver: zodResolver(resetPasswordFormSchema),
    defaultValues: { token: route.params?.token ?? '', password: '', confirmPassword: '' },
  });

  const password = useWatch({ control, name: 'password' }) ?? '';

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    setSubmitting(true);
    try {
      await authService.resetPassword({
        token: extractEmailedToken(values.token),
        password: values.password,
      });
      setDone(true);
    } catch (caught) {
      setError(authError(caught));
    } finally {
      setSubmitting(false);
    }
  });

  const chain = useFieldChain({ length: 3, onSubmit: () => void onSubmit() });

  if (done) {
    return (
      <Screen edges={['top', 'bottom']} testID="reset-password-done">
        <FormBanner tone="success" message={t('auth.reset.done')} />
        <Button
          label={t('auth.action.signIn')}
          size="lg"
          fullWidth
          onPress={() => navigation.navigate('Login')}
        />
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'bottom']} testID="reset-password-screen">
      <Text variant="h1" {...headingA11y(t('auth.reset.title'))}>
        {t('auth.reset.title')}
      </Text>

      {error === null ? null : <FormBanner testID="reset-error" message={error} />}

      <View style={{ rowGap: theme.space[4] }}>
        <ControlledInput
          {...chain.field(0)}
          control={control}
          name="token"
          label={t('auth.reset.tokenLabel')}
          testID="reset-token"
          autoCapitalize="none"
          hint={t('auth.reset.tokenHint')}
          required
        />
        <ControlledInput
          {...chain.field(1)}
          control={control}
          name="password"
          label={t('auth.reset.newPassword')}
          testID="reset-password"
          secure
          autoCapitalize="none"
          autoComplete="new-password"
          required
        />
        <ControlledInput
          {...chain.field(2)}
          control={control}
          name="confirmPassword"
          label={t('auth.reset.confirmNewPassword')}
          testID="reset-confirm-password"
          secure
          autoCapitalize="none"
          required
        />
      </View>

      <PasswordRules password={password} />

      <Button
        label={t('auth.reset.submit')}
        size="lg"
        fullWidth
        loading={submitting}
        testID="reset-submit"
        onPress={() => void onSubmit()}
      />
    </Screen>
  );
}
