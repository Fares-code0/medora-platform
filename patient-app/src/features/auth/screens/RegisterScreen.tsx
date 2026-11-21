import { useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import { Button, Card, Screen, Text } from '@/components';
import { Checkbox } from '@/components/form/Checkbox';
import { ControlledInput } from '@/components/form/ControlledInput';
import { useFieldChain } from '@/components/form/useFieldChain';
import { useT } from '@/i18n';
import type { AuthStackParamList } from '@/navigation/routes';
import { useTheme } from '@/theme';

import { FormBanner } from '../components/FormBanner';
import { registerFormSchema, type RegisterForm } from '../schemas';
import { authService } from '../service';
import { useAuthError } from '../useAuthErrorMessage';

type Props = NativeStackScreenProps<AuthStackParamList, 'Register'>;

/**
 * Create an account. **Live as of ADR-035 §4.**
 *
 * ── How it got here ──────────────────────────────────────────────────
 * This screen was built as complete UI over a decision that had not been
 * made: ADR-018 §3 said patients are records rather than users, and a
 * backend test failed if a patient role appeared. Building it anyway was
 * the alternative to the two wrong options — sending `role: 'patient'`
 * at a route that would reject it, or blocking the whole phase on one
 * decision.
 *
 * **ADR-030 made the decision** in this screen's favour, and **ADR-035
 * §4 wired it**: the endpoint adapter now supplies `role: 'patient'` as a
 * constant, which was the one missing piece. The submit reaches a real
 * route.
 *
 * What a completed registration yields is deliberately little: an
 * account linked to no clinical record, seeing no clinical data, until
 * the claim flow is decided (RA-030.1). Registration is not
 * record-claiming.
 *
 * The form collects account fields only. `role` is absent because the
 * adapter owns it — a form field would let a modified app ask for a
 * clinician account — and the professional block is absent because it has
 * no business on a patient form. Both consent booleans are
 * `literal(true)`, because `users.terms_accepted_at` is NOT NULL by
 * design.
 */
export function RegisterScreen({ navigation }: Props) {
  const authError = useAuthError();
  const theme = useTheme();
  const t = useT();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { control, handleSubmit } = useForm<RegisterForm>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      password: '',
      confirmPassword: '',
      // Unticked, and that is the whole point of `literal(true)`.
      //
      // A pre-ticked consent box is not consent: the patient has done
      // nothing, and `users.terms_accepted_at` would record the moment
      // at which they did nothing. It also makes the schema's own
      // "You must accept…" message unreachable, so the validation that
      // exists to force the act could never fire.
      acceptTerms: false,
      acceptPrivacy: false,
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const result = await authService.register({
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        email: values.email.trim(),
        phone: values.phone.trim(),
        password: values.password,
        acceptTerms: true,
        acceptPrivacy: true,
      });
      // Always the verify screen. Registration never returns a session
      // (ADR-035 §4) — the account exists but `LoginService` refuses it
      // with `email_unverified` until the address is confirmed, so there
      // is nothing to adopt and no branch to take.
      navigation.navigate('VerifyEmail', { email: result.email });
    } catch (error) {
      setSubmitError(authError(error));
    } finally {
      setSubmitting(false);
    }
  });

  // Six fields, then the consent checkboxes — so Done on the last field
  // submits rather than jumping past two things the patient must tick.
  const chain = useFieldChain({ length: 6, onSubmit: () => void onSubmit() });

  return (
    <Screen edges={['top', 'bottom']} testID="register-screen">
      <Text variant="h1" {...headingA11y(t('auth.register.title'))}>
        {t('auth.register.title')}
      </Text>

      {submitError === null ? null : <FormBanner testID="register-error" message={submitError} />}

      <View style={{ rowGap: theme.space[4] }}>
        <ControlledInput
          {...chain.field(0)}
          control={control}
          name="firstName"
          label={t('auth.field.firstName')}
          testID="register-first-name"
          autoComplete="given-name"
          required
        />
        <ControlledInput
          {...chain.field(1)}
          control={control}
          name="lastName"
          label={t('auth.field.lastName')}
          testID="register-last-name"
          autoComplete="family-name"
          required
        />
        <ControlledInput
          {...chain.field(2)}
          control={control}
          name="email"
          label={t('auth.field.email')}
          testID="register-email"
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          required
        />
        <ControlledInput
          {...chain.field(3)}
          control={control}
          name="phone"
          label={t('auth.field.phone')}
          testID="register-phone"
          keyboardType="phone-pad"
          autoComplete="tel"
          required
        />
        <ControlledInput
          {...chain.field(4)}
          control={control}
          name="password"
          label={t('auth.field.password')}
          testID="register-password"
          secure
          autoCapitalize="none"
          autoComplete="new-password"
          hint={t('auth.register.passwordHint')}
          required
        />
        <ControlledInput
          {...chain.field(5)}
          control={control}
          name="confirmPassword"
          label={t('auth.field.confirmPassword')}
          testID="register-confirm-password"
          secure
          autoCapitalize="none"
          required
        />
      </View>

      <View style={{ rowGap: theme.space[2] }}>
        {/*
          The way to READ what is being ticked (E-05). It sits above the
          boxes rather than inside their labels: a link inside a checkbox
          label competes with the checkbox for the same tap, and the tap
          that loses is the one that ticks a consent by accident.
        */}
        <Button
          label={t('consent.reviewLink')}
          tone="ghost"
          size="sm"
          testID="register-read-consent"
          onPress={() => navigation.navigate('Consent')}
        />

        <Controller
          control={control}
          name="acceptTerms"
          render={({ field, fieldState }) => (
            <Checkbox
              testID="register-accept-terms"
              label={t('auth.register.acceptTerms')}
              checked={field.value === true}
              onChange={field.onChange}
              {...(fieldState.error?.message === undefined
                ? {}
                : { error: fieldState.error.message })}
            />
          )}
        />
        <Controller
          control={control}
          name="acceptPrivacy"
          render={({ field, fieldState }) => (
            <Checkbox
              testID="register-accept-privacy"
              label={t('auth.register.acceptPrivacy')}
              checked={field.value === true}
              onChange={field.onChange}
              {...(fieldState.error?.message === undefined
                ? {}
                : { error: fieldState.error.message })}
            />
          )}
        />
      </View>

      <Button
        label={t('auth.register.submit')}
        size="lg"
        fullWidth
        loading={submitting}
        testID="register-submit"
        onPress={() => void onSubmit()}
      />

      <Card tone="sunken">
        <Text variant="bodySm" color="textTertiary">
          {t('auth.register.recordsNotice')}
        </Text>
      </Card>

      <Button
        label={t('auth.register.haveAccount')}
        tone="ghost"
        onPress={() => navigation.navigate('Login')}
      />
    </Screen>
  );
}
