import { useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Alert } from '@/components/feedback';
import { Button, PasswordInput } from '@/components/ui';
import { useT, type TranslateFn } from '@/i18n';
import { routes } from '@/routes';
import type { InvitationEnrolment } from '@/types/auth';

import { AuthCard, AuthFormError, OtpInput, PasswordStrengthMeter } from '../components';
import { authErrorKey } from '../error-message';
import { invitationService } from '../invitation-service';
import {
  acceptInvitationSchema,
  type AcceptInvitationValues,
} from '../schemas/invitation';

/**
 * Accepting an administrator invitation (ADR-035 §5).
 *
 * The landing page for the link `AuthMailService.sendAdminInvitation`
 * sends. Without it that mail points at a 404, which is why this page
 * exists rather than being left to a later milestone: the server-side
 * flow is complete and tested, and a flow no invitee can complete is not
 * a flow.
 *
 * ## Why it is two steps and cannot be one
 *
 * The server creates the account **INACTIVE** at `accept` and makes it
 * ACTIVE at `activate`, after verifying a code from the secret `accept`
 * issued. The second call needs a code the user can only produce once
 * they have scanned or typed the secret the first call returned — so the
 * round trip is real, not a wizard drawn over a single submission.
 *
 * That structure is what makes an administrator's second factor
 * mandatory rather than merely recommended: there is no code path that
 * activates the account without it, so an invitee who closes the tab
 * after step 1 has an INACTIVE account that `LoginService` refuses.
 *
 * ## No QR image
 *
 * The `otpauthUrl` is rendered as text alongside the base32 secret, which
 * every authenticator accepts as manual entry. Drawing the QR would mean
 * adding a QR library to the auth bundle for one screen that a handful of
 * people see once; the secret is the thing the authenticator needs, and
 * it is displayed. A QR is a convenience worth adding when someone asks
 * for it.
 *
 * ## What is deliberately not here
 *
 * No session, at either step. The invitee finishes by signing in through
 * `/login` like every other principal, so one code path mints sessions
 * rather than two that have to agree on rotation, lockout and audit.
 */
export default function AcceptInvitationPage() {
  const t = useT();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [enrolment, setEnrolment] = useState<InvitationEnrolment | null>(null);
  const [done, setDone] = useState(false);

  if (done) return <ActivatedPanel t={t} onContinue={() => navigate(routes.login)} />;
  if (enrolment !== null) {
    return <EnrolStep t={t} token={token} enrolment={enrolment} onActivated={() => setDone(true)} />;
  }
  return <PasswordStep t={t} token={token} onAccepted={setEnrolment} />;
}

/** Step 1 — set a password. */
function PasswordStep({
  t,
  token,
  onAccepted,
}: {
  t: TranslateFn;
  token: string;
  onAccepted: (enrolment: InvitationEnrolment) => void;
}) {
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    watch,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AcceptInvitationValues>({
    resolver: zodResolver(acceptInvitationSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  const password = watch('password');

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      onAccepted(await invitationService.accept(token, values.password));
    } catch (error) {
      setFormError(invitationErrorMessage(error, t));
    }
  });

  return (
    <AuthCard title={t('invitation.title')} subtitle={t('invitation.subtitle')}>
      <AuthFormError message={formError} />

      <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-4">
        <div>
          <PasswordInput
            label={t('common.password')}
            autoComplete="new-password"
            autoFocus
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

        {/* Said before they commit, because it is a requirement rather
            than a suggestion and finding out at step 2 would be a
            surprise. */}
        <p className="text-caption text-text-secondary">{t('invitation.mfaNotice')}</p>

        <Button type="submit" fullWidth loading={isSubmitting}>
          {t('invitation.submitPassword')}
        </Button>
      </form>
    </AuthCard>
  );
}

/** Step 2 — enrol an authenticator and prove a code from it. */
function EnrolStep({
  t,
  token,
  enrolment,
  onActivated,
}: {
  t: TranslateFn;
  token: string;
  enrolment: InvitationEnrolment;
  onActivated: () => void;
}) {
  const [code, setCode] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(value: string): Promise<void> {
    setFormError(null);
    setSubmitting(true);
    try {
      await invitationService.activate(token, value);
      onActivated();
    } catch (error) {
      setFormError(invitationErrorMessage(error, t));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard title={t('invitation.mfaTitle')} subtitle={t('invitation.mfaSubtitle')}>
      <AuthFormError message={formError} />

      <div className="flex flex-col gap-4">
        <div className="rounded-surface border border-border bg-surface-sunken p-4">
          <p className="text-caption font-semibold text-text-primary">
            {t('invitation.secretLabel')}
          </p>
          {/* `break-all` because a base32 secret has no spaces to wrap on
              and would otherwise force the card to scroll sideways. */}
          <p className="mt-1 select-all break-all font-mono text-body-sm text-text-primary">
            {enrolment.secret}
          </p>
          <p className="mt-3 text-caption text-text-secondary">{t('invitation.secretHelp')}</p>
        </div>

        <div className="rounded-surface border border-border p-4">
          <p className="text-caption font-semibold text-text-primary">
            {t('invitation.recoveryLabel')}
          </p>
          <p className="mt-1 text-caption text-text-secondary">{t('invitation.recoveryHelp')}</p>
          <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-caption text-text-primary">
            {enrolment.recoveryCodes.map((recoveryCode) => (
              <li key={recoveryCode} className="select-all">
                {recoveryCode}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="mb-2 text-body-sm text-text-secondary">{t('invitation.codeLabel')}</p>
          <OtpInput
            value={code}
            onChange={setCode}
            onComplete={(value) => void submit(value)}
            disabled={submitting}
            invalid={formError !== null}
            aria-label={t('invitation.codeLabel')}
          />
        </div>

        <Button
          type="button"
          fullWidth
          loading={submitting}
          disabled={code.length !== 6}
          onClick={() => void submit(code)}
        >
          {t('invitation.submitCode')}
        </Button>
      </div>
    </AuthCard>
  );
}

/** Step 3 — done. Sign in normally; this flow issues no session. */
function ActivatedPanel({ t, onContinue }: { t: TranslateFn; onContinue: () => void }) {
  return (
    <AuthCard title={t('invitation.successTitle')}>
      <Alert variant="success" title={t('invitation.successTitle')}>
        {t('invitation.successBody')}
      </Alert>
      <div className="mt-6">
        <Button type="button" fullWidth onClick={onContinue}>
          {t('invitation.successCta')}
        </Button>
      </div>
    </AuthCard>
  );
}

/**
 * Which failure the page shows.
 *
 * `token_invalid` covers unknown, expired, revoked and already-used, and
 * gets one message saying the link is no longer usable and to ask for
 * another — the page cannot tell those apart and neither should it, since
 * distinguishing them for a caller holding a stolen link is exactly what
 * the server declines to do.
 */
function invitationErrorMessage(error: unknown, t: TranslateFn): string {
  return t(
    authErrorKey(
      error,
      {
        token_invalid: 'invitation.error.token',
        otp_invalid: 'invitation.error.code',
        email_taken: 'invitation.error.taken',
        weak_password: 'invitation.error.weakPassword',
      },
      'invitation.error.generic',
    ),
  );
}
