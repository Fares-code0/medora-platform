import { useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useForm } from 'react-hook-form';

import { headingA11y } from '@/accessibility/a11y';
import { Button, Screen, Text } from '@/components';
import { ControlledInput } from '@/components/form/ControlledInput';
import { useFieldChain } from '@/components/form/useFieldChain';
import { useT } from '@/i18n';
import type { AuthStackParamList } from '@/navigation/routes';

import { FormBanner } from '../components/FormBanner';
import { forgotPasswordFormSchema, type ForgotPasswordForm } from '../schemas';
import { authService } from '../service';
import { useAuthError } from '../useAuthErrorMessage';

type Props = NativeStackScreenProps<AuthStackParamList, 'ForgotPassword'>;

/**
 * Request a reset link.
 *
 * The backend answers 202 whether or not the address exists, and this
 * screen must not undo that: the success message is identical in both
 * cases, deliberately worded as "if there is an account" rather than
 * "we've sent you an email". A confirmation that only appears for real
 * addresses is an account-enumeration oracle with a friendly tone.
 */
export function ForgotPasswordScreen({ navigation }: Props) {
  const authError = useAuthError();
  const t = useT();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { control, handleSubmit } = useForm<ForgotPasswordForm>({
    resolver: zodResolver(forgotPasswordFormSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    setSubmitting(true);
    try {
      await authService.forgotPassword(values.email.trim());
      setSent(true);
    } catch (caught) {
      setError(authError(caught));
    } finally {
      setSubmitting(false);
    }
  });

  const chain = useFieldChain({ length: 1, onSubmit: () => void onSubmit() });

  return (
    <Screen edges={['top', 'bottom']} testID="forgot-password-screen">
      <Text variant="h1" {...headingA11y(t('auth.forgot.title'))}>
        {t('auth.forgot.title')}
      </Text>
      <Text variant="body" color="textSecondary">
        {t('auth.forgot.body')}
      </Text>

      {error === null ? null : <FormBanner testID="forgot-error" message={error} />}
      {sent ? (
        <FormBanner tone="success" testID="forgot-sent" message={t('auth.forgot.sent')} />
      ) : null}

      <ControlledInput
        {...chain.field(0)}
        control={control}
        name="email"
        label={t('auth.field.email')}
        testID="forgot-email"
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        required
      />

      <Button
        label={t('auth.forgot.submit')}
        size="lg"
        fullWidth
        loading={submitting}
        testID="forgot-submit"
        onPress={() => void onSubmit()}
      />
      <Button
        label={t('auth.forgot.haveCode')}
        tone="ghost"
        onPress={() => navigation.navigate('ResetPassword', {})}
      />
      <Button
        label={t('auth.action.backToSignIn')}
        tone="ghost"
        onPress={() => navigation.navigate('Login')}
      />
    </Screen>
  );
}
