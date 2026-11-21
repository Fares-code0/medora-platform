import { useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { BadgeCheck, Mail, Phone, Stethoscope, User } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';

import { useAuth } from '@/app/providers';
import { Button, Checkbox, Input, PasswordInput, Select } from '@/components/ui';
import { useT, type TranslateFn } from '@/i18n';
import { routes } from '@/routes';

import { AuthCard, AuthFormError, PasswordStrengthMeter } from '../components';
import { authErrorKey } from '../error-message';
import {
  PROFESSIONAL_CATEGORIES,
  PROFESSIONAL_CATEGORY_LABELS,
  signupSchema,
  type SignupValues,
} from '../schemas/signup';

/**
 * Clinician signup (ADR-035 §§4–5).
 *
 * ## The account-type radio is gone
 *
 * It offered "Doctor" and "Administrator", and the backend honoured
 * both — so an administrator account, which holds `roles.manage` and
 * `settings.manageSystem`, was two clicks and an email confirmation away
 * for anyone who found this page. Administrators are now invited by
 * someone who already holds `roles.manage`.
 *
 * With one role left there is nothing to choose, so the control is
 * removed rather than reduced to a single disabled option. `role` is sent
 * as the constant `'doctor'`.
 *
 * ## The professional block
 *
 * Three required fields where there was one optional "Licence number".
 * They are what lets the server create the `doctors` row — `specialty` is
 * NOT NULL on it — and creating that row is what puts a new clinician in
 * the verification queue at all.
 *
 * The copy under the block says the number will be verified, not that it
 * has been. No register is integrated: the account is created
 * `PENDING`, and only an administrator holding `doctors.verify` moves it
 * off that. Telling a doctor their credentials were "verified" at signup
 * would be a claim the platform cannot support.
 */
export default function SignupPage() {
  const t = useT();
  const { register: registerUser } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    control,
    watch,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      password: '',
      confirmPassword: '',
      role: 'doctor',
      professionalRegistrationNumber: '',
      professionalCategory: 'physician',
      specialty: '',
      registrationExpiresOn: '',
      acceptTerms: false,
      acceptPrivacy: false,
    },
  });

  const password = watch('password');

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await registerUser({
        firstName: values.firstName,
        lastName: values.lastName,
        email: values.email,
        phone: values.phone,
        password: values.password,
        // Constant, not a form value. The SPA registers clinicians; there
        // is no control that could make this anything else, and ADR-035 §5
        // is why there is not.
        role: 'doctor',
        professionalRegistrationNumber: values.professionalRegistrationNumber,
        professionalCategory: values.professionalCategory,
        specialty: values.specialty,
        registrationExpiresOn: values.registrationExpiresOn || undefined,
        // Required by the API (`z.literal(true)`): `users.terms_accepted_at`
        // is NOT NULL, so a registration that omits them cannot be stored.
        // The form already refuses to submit unless both are checked.
        acceptTerms: true,
        acceptPrivacy: true,
      });
      navigate(routes.verifyEmail);
    } catch (error) {
      setFormError(signupErrorMessage(error, t));
    }
  });

  return (
    <AuthCard
      title={t('signup.title')}
      subtitle={t('signup.subtitle')}
      footer={
        <p className="text-center text-body-sm text-text-secondary">
          {t('signup.haveAccount')}{' '}
          <Link to={routes.login} className="font-semibold text-primary hover:underline">
            {t('signup.loginLink')}
          </Link>
        </p>
      }
    >
      <AuthFormError message={formError} />

      <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label={t('signup.firstName')}
            autoComplete="given-name"
            autoFocus
            leadingIcon={User}
            error={errors.firstName?.message}
            {...register('firstName')}
          />
          <Input
            label={t('signup.lastName')}
            autoComplete="family-name"
            error={errors.lastName?.message}
            {...register('lastName')}
          />
        </div>

        <Input
          label={t('common.email')}
          type="email"
          autoComplete="email"
          leadingIcon={Mail}
          placeholder={t('common.emailPlaceholder')}
          error={errors.email?.message}
          {...register('email')}
        />
        <Input
          label={t('signup.phone')}
          type="tel"
          autoComplete="tel"
          leadingIcon={Phone}
          error={errors.phone?.message}
          {...register('phone')}
        />

        <div>
          <PasswordInput
            label={t('common.password')}
            autoComplete="new-password"
            error={errors.password?.message}
            {...register('password')}
          />
          <PasswordStrengthMeter password={password} />
        </div>
        <PasswordInput
          label={t('common.confirmPassword')}
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />

        <fieldset className="flex flex-col gap-4 border-t border-border pt-4">
          <legend className="sr-only">{t('signup.professionalSection')}</legend>
          <p className="text-body-sm font-semibold text-text-primary">
            {t('signup.professionalSection')}
          </p>

          <Input
            label={t('signup.professionalNumber')}
            helperText={t('signup.professionalNumberHelp')}
            leadingIcon={BadgeCheck}
            error={errors.professionalRegistrationNumber?.message}
            {...register('professionalRegistrationNumber')}
          />

          <Controller
            control={control}
            name="professionalCategory"
            render={({ field }) => (
              <Select
                label={t('signup.professionalCategory')}
                name={field.name}
                value={field.value}
                onChange={field.onChange}
                error={errors.professionalCategory?.message}
                options={PROFESSIONAL_CATEGORIES.map((category) => ({
                  value: category,
                  label: PROFESSIONAL_CATEGORY_LABELS[category],
                }))}
              />
            )}
          />

          <Input
            label={t('signup.specialty')}
            leadingIcon={Stethoscope}
            error={errors.specialty?.message}
            {...register('specialty')}
          />

          <Input
            label={t('signup.registrationExpiry')}
            type="date"
            helperText={t('signup.registrationExpiryHelp')}
            error={errors.registrationExpiresOn?.message}
            {...register('registrationExpiresOn')}
          />

          {/* Says what will happen, not what has. Nothing checks this
              number against a register — the account is created PENDING
              and an administrator with `doctors.verify` decides. */}
          <p className="text-caption text-text-secondary">{t('signup.verificationNotice')}</p>
        </fieldset>

        <div className="flex flex-col gap-3">
          <Checkbox
            label={t('signup.terms')}
            error={errors.acceptTerms?.message}
            {...register('acceptTerms')}
          />
          <Checkbox
            label={t('signup.privacy')}
            error={errors.acceptPrivacy?.message}
            {...register('acceptPrivacy')}
          />
        </div>

        <Button type="submit" fullWidth loading={isSubmitting}>
          {t('signup.submit')}
        </Button>
      </form>
    </AuthCard>
  );
}

/**
 * Which failure the form shows.
 *
 * `professional_number_taken` gets its own message (ADR-035 §4): a
 * clinician who mistypes their registration number and is told "something
 * went wrong" has no way to find the field that is wrong, and the generic
 * message is what they would otherwise get.
 *
 * Neither branch names an account. "This number belongs to dr.chen@…"
 * would turn the signup form into a way of resolving a registration
 * number to a person's address.
 */
function signupErrorMessage(error: unknown, t: TranslateFn): string {
  return t(
    authErrorKey(
      error,
      {
        email_taken: 'signup.error.taken',
        professional_number_taken: 'signup.error.professionalNumberTaken',
      },
      'signup.error.generic',
    ),
  );
}
