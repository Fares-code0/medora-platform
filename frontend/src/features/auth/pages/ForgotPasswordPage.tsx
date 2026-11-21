import { useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Mail } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';

import { useAuth } from '@/app/providers';
import { Alert } from '@/components/feedback';
import { Button, Input } from '@/components/ui';
import { useT } from '@/i18n';
import { routes } from '@/routes';

import { AuthCard, AuthFormError } from '../components';
import { authErrorKey } from '../error-message';
import { forgotSchema, type ForgotValues } from '../schemas/forgot';

export default function ForgotPasswordPage() {
  const t = useT();
  const { forgotPassword } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotValues>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await forgotPassword(values.email);
      setSent(true);
    } catch (error) {
      setFormError(t(authErrorKey(error, {}, 'forgot.error.generic')));
    }
  });

  const backLink = (
    <Link
      to={routes.login}
      className="inline-flex items-center gap-1.5 text-body-sm font-medium text-primary hover:underline"
    >
      <ArrowLeft aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
      {t('common.back')}
    </Link>
  );

  if (sent) {
    return (
      <AuthCard title={t('forgot.successTitle')} footer={backLink}>
        <Alert variant="success" title={t('forgot.successTitle')}>
          {t('forgot.successBody')}
        </Alert>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('forgot.title')} subtitle={t('forgot.subtitle')} footer={backLink}>
      <AuthFormError message={formError} />
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-4">
        <Input
          label={t('common.email')}
          type="email"
          autoComplete="email"
          autoFocus
          leadingIcon={Mail}
          placeholder={t('common.emailPlaceholder')}
          error={errors.email?.message}
          {...register('email')}
        />
        <Button type="submit" fullWidth loading={isSubmitting}>
          {t('forgot.submit')}
        </Button>
      </form>
    </AuthCard>
  );
}
