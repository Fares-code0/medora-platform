import { useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { useAuth } from '@/app/providers';
import { Alert } from '@/components/feedback';
import { Button, PasswordInput } from '@/components/ui';
import { translateIfKey, useT } from '@/i18n';
import { routes } from '@/routes';

import { AuthCard, AuthFormError, PasswordStrengthMeter } from '../components';
import { authErrorKey } from '../error-message';
import { PASSWORD_MIN_LENGTH } from '../schemas/password';
import { resetSchema, type ResetValues } from '../schemas/reset';

export default function ResetPasswordPage() {
  const t = useT();
  const { resetPassword } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const {
    register,
    watch,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  const password = watch('password');

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await resetPassword(params.get('token') ?? '', values.password);
      setDone(true);
    } catch (error) {
      setFormError(
        t(authErrorKey(error, { token_invalid: 'reset.error.token' }, 'reset.error.generic')),
      );
    }
  });

  if (done) {
    return (
      <AuthCard title={t('reset.successTitle')}>
        <Alert variant="success" title={t('reset.successTitle')}>
          {t('reset.successBody')}
        </Alert>
        <div className="mt-6">
          <Button type="button" fullWidth onClick={() => navigate(routes.login)}>
            {t('reset.successCta')}
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('reset.title')} subtitle={t('reset.subtitle')}>
      <AuthFormError message={formError} />
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-4">
        <div>
          <PasswordInput
            label={t('reset.newPassword')}
            autoComplete="new-password"
            autoFocus
            error={translateIfKey(t, errors.password?.message, { count: PASSWORD_MIN_LENGTH })}
            {...register('password')}
          />
          <PasswordStrengthMeter password={password} />
        </div>
        <PasswordInput
          label={t('common.confirmPassword')}
          autoComplete="new-password"
          error={translateIfKey(t, errors.confirmPassword?.message)}
          {...register('confirmPassword')}
        />
        <Button type="submit" fullWidth loading={isSubmitting}>
          {t('reset.submit')}
        </Button>
      </form>
    </AuthCard>
  );
}
