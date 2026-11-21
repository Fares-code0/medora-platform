import { useEffect, useRef, useState } from 'react';

import { Alert } from '@/components/feedback';
import { Stack } from '@/components/layout';
import { Button, Input, Modal } from '@/components/ui';
import { isApiError } from '@/types/api';
import { isOtpauthUrl } from '@/utils/otpauth';

import {
  useBeginTwoFactorReenrollMutation,
  useBeginTwoFactorSetupMutation,
  useConfirmTwoFactorReenrollMutation,
  useDisableTwoFactorMutation,
  useEnableTwoFactorMutation,
} from '../api/useSettingsQueries';
import { isPasswordLockout } from '../model/password-lockout';

/**
 * Two-factor enrolment and removal against the server's flow (FE-10.9,
 * API §2.9).
 *
 * **On** is four steps, and nothing is switched on until the last: the
 * current password (owner decision D2), then the server mints a secret, the
 * doctor adds it to an authenticator app, and a code from that app proves
 * it works. **Off** takes the account password —
 * a code would let whoever holds the phone remove the phone. The server
 * then revokes every session, this one included (`revokeAllFor`, though the
 * route documents "every other session"), so the caller signs out at once
 * rather than letting the next token refresh bounce the doctor unexplained.
 *
 * The secret is shown as text and as an `otpauth://` link (which an
 * authenticator app on the same device opens); no QR library is bundled,
 * and drawing one by hand is not a thing to get subtly wrong.
 */

const CODE_PATTERN = /^\d{6}$/;

function refusal(error: unknown, fallback: string): string {
  if (isApiError(error)) {
    if (error.code === 'otp_invalid')
      return 'That code did not match. Use the newest code from the app.';
    if (error.code === 'invalid_credentials') return 'That password is not correct.';
    if (error.kind === 'conflict') return error.detail;
    if (error.kind === 'forbidden')
      return 'Two-factor authentication cannot be turned off for this account.';
    if (error.kind === 'validation') return Object.values(error.fieldErrors)[0]?.[0] ?? fallback;
  }
  return fallback;
}

/** Groups a base32 secret in fours, so it can be read and typed. */
function grouped(secret: string): string {
  return secret
    .replace(/\s+/g, '')
    .replace(/(.{4})/g, '$1 ')
    .trim();
}

/**
 * Turning two-factor on, first time (owner decision D2): the current
 * password, then the new key, then a code from the app.
 *
 * The password step comes before any call that mints a secret, so nothing
 * secret exists — on the server or on this screen — until the server has
 * accepted the password. A wrong one is said in words; the guess that
 * reaches the sign-in lockout makes the server end this session (429), so
 * the dialog says so and `onSignedOut` ends it here too, exactly as the
 * re-enrolment dialog does.
 */
export function TwoFactorEnrolDialog({
  open,
  onClose,
  onEnabled,
  onSignedOut,
}: {
  open: boolean;
  onClose: () => void;
  onEnabled: () => void;
  onSignedOut?: () => void;
}) {
  const setup = useBeginTwoFactorSetupMutation();
  const enable = useEnableTwoFactorMutation();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lockedOut, setLockedOut] = useState(false);

  const setupReset = setup.reset;
  useEffect(() => {
    if (!open) return;
    setPassword('');
    setCode('');
    setError(null);
    setLockedOut(false);
    setupReset();
  }, [open, setupReset]);

  const enrolment = setup.data;
  const valid = CODE_PATTERN.test(code);
  const pending = setup.isPending || enable.isPending;

  const verify = () => {
    setError(null);
    setup.mutate(password, {
      // The password leaves memory as soon as the server has answered.
      onSettled: () => setPassword(''),
      onError: (failure) => {
        if (isApiError(failure) && failure.kind === 'rate_limited') {
          setLockedOut(true);
          setError('Too many failed attempts. For your security this session has been signed out.');
          return;
        }
        setError(refusal(failure, 'Two-factor setup could not start.'));
      },
    });
  };

  const confirm = () => {
    setError(null);
    enable.mutate(code, {
      onSuccess: () => {
        onEnabled();
        onClose();
      },
      onError: (failure) =>
        setError(refusal(failure, 'Two-factor authentication was not turned on.')),
    });
  };

  const close = () => {
    if (lockedOut) onSignedOut?.();
    onClose();
  };

  const footer = lockedOut ? (
    <Button onClick={close}>Sign in again</Button>
  ) : (
    <>
      <Button variant="secondary" onClick={close} disabled={pending}>
        Cancel
      </Button>
      {enrolment === undefined ? (
        <Button onClick={verify} loading={setup.isPending} disabled={password === ''}>
          Continue
        </Button>
      ) : (
        <Button onClick={confirm} loading={enable.isPending} disabled={!valid}>
          Turn on
        </Button>
      )}
    </>
  );

  return (
    <Modal
      open={open}
      onClose={close}
      dismissible={!pending}
      title="Turn on two-factor authentication"
      description={
        enrolment === undefined
          ? 'Confirm it is you with your password. Nothing changes until a code from your authenticator app checks out.'
          : 'Nothing changes until a code from your authenticator app checks out.'
      }
      size="md"
      footer={footer}
    >
      <Stack gap={4}>
        {enrolment === undefined && !lockedOut ? (
          <Input
            label="Your password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        ) : null}
        {enrolment !== undefined ? (
          <>
            <div>
              <p className="text-body-sm text-text-primary">
                1. Add Medora to your authenticator app with this key:
              </p>
              <p className="mt-1 break-all rounded-control bg-surface-sunken px-3 py-2 font-mono text-body-sm text-text-primary">
                {grouped(enrolment.secret)}
              </p>
              {isOtpauthUrl(enrolment.otpauthUrl) ? (
                <a
                  href={enrolment.otpauthUrl}
                  className="mt-1 inline-block text-body-sm text-primary underline"
                >
                  Open in an authenticator app on this device
                </a>
              ) : null}
            </div>
            {enrolment.recoveryCodes.length > 0 ? (
              <div>
                <p className="text-body-sm text-text-primary">
                  2. Keep these recovery codes somewhere safe. Each signs you in once if you lose
                  your phone; they are not shown again.
                </p>
                <ul className="mt-1 grid grid-cols-2 gap-1 font-mono text-body-sm text-text-primary">
                  {enrolment.recoveryCodes.map((recovery) => (
                    <li key={recovery}>{recovery}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <Input
              label="Code from the app"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
              helperText="The six digits the app shows for Medora."
            />
          </>
        ) : null}
        {error === null ? null : <Alert variant="error" title={error} />}
      </Stack>
    </Modal>
  );
}

/**
 * Turning two-factor off. The password spends from the sign-in guess budget
 * (owner decision D1): the guess that reaches the lockout, or any attempt
 * while the account is locked, makes the server end this session (429). The
 * dialog then says so and offers only "Sign in again", which ends it here
 * too — the same handling as the enrolment and re-enrolment dialogs.
 */
export function TwoFactorDisableDialog({
  open,
  onClose,
  onDisabled,
  onSignedOut,
}: {
  open: boolean;
  onClose: () => void;
  onDisabled: () => void;
  onSignedOut?: () => void;
}) {
  const disable = useDisableTwoFactorMutation();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lockedOut, setLockedOut] = useState(false);
  // "Sign in again", Esc and the scrim all close the dialog; the session is
  // ended once, however many of them arrive before it unmounts.
  const signedOut = useRef(false);

  useEffect(() => {
    if (open) {
      setPassword('');
      setError(null);
      setLockedOut(false);
      signedOut.current = false;
    }
  }, [open]);

  const confirm = () => {
    setError(null);
    disable.mutate(password, {
      onSuccess: () => {
        onDisabled();
        onClose();
      },
      onError: (failure) => {
        if (isPasswordLockout(failure)) {
          setPassword('');
          setLockedOut(true);
          setError(
            'Too many incorrect passwords. Your account is temporarily locked and this session has been signed out.',
          );
          return;
        }
        setError(refusal(failure, 'Two-factor authentication is still on.'));
      },
    });
  };

  const close = () => {
    if (lockedOut && !signedOut.current) {
      signedOut.current = true;
      onSignedOut?.();
    }
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      dismissible={!disable.isPending}
      title="Turn off two-factor authentication?"
      description="Your account will be less protected. The server then signs you out everywhere, on this device too, and you sign in again."
      size="sm"
      footer={
        lockedOut ? (
          <Button onClick={close}>Sign in again</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close} disabled={disable.isPending}>
              Keep it on
            </Button>
            <Button
              variant="destructive"
              onClick={confirm}
              loading={disable.isPending}
              disabled={password === ''}
            >
              Turn off
            </Button>
          </>
        )
      }
    >
      <Stack gap={4}>
        {lockedOut ? null : (
          <Input
            label="Your password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        )}
        {error === null ? null : <Alert variant="error" title={error} />}
      </Stack>
    </Modal>
  );
}

type ReenrollStep = 'verify' | 'new-app' | 'codes';

/**
 * Replacing the authenticator (owner decision Q7 / R4) — `POST /me/2fa/reenroll`
 * then `/reenroll/confirm`, served only by an API built from `backend`.
 *
 * Three steps, and nothing changes on the server until the second ends:
 *
 *  1. **Prove the current factor.** The password and a code from the app in
 *     use now. A session alone may not replace a live secret: that is the
 *     defect the owner's Q7 decision closed (`/setup` answers 409 for an
 *     enrolled account since).
 *  2. **Prove the new app.** The server mints a new secret; a code from the
 *     new app replaces the factor and the recovery codes in one step. The
 *     old app and the old codes work until then, so cancelling here leaves
 *     the account exactly as it was.
 *  3. **The new recovery codes**, shown once. The old ones no longer work.
 *
 * Step 1 spends from the sign-in guess budget. The guess that reaches the
 * lockout makes the server revoke this session (429), so the dialog says so
 * and `onSignedOut` ends it here too, rather than letting the next refresh
 * bounce the doctor to the sign-in page unexplained.
 *
 * A lost current authenticator is not handled here: the owner has not
 * approved a recovery process for it (clarification C-1), and none is
 * offered or implied.
 */
export function TwoFactorReenrollDialog({
  open,
  onClose,
  onReplaced,
  onSignedOut,
}: {
  open: boolean;
  onClose: () => void;
  onReplaced: () => void;
  onSignedOut: () => void;
}) {
  const begin = useBeginTwoFactorReenrollMutation();
  const confirm = useConfirmTwoFactorReenrollMutation();
  const [step, setStep] = useState<ReenrollStep>('verify');
  const [password, setPassword] = useState('');
  const [currentCode, setCurrentCode] = useState('');
  const [newCode, setNewCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lockedOut, setLockedOut] = useState(false);

  const beginReset = begin.reset;
  const confirmReset = confirm.reset;
  useEffect(() => {
    if (!open) return;
    setStep('verify');
    setPassword('');
    setCurrentCode('');
    setNewCode('');
    setError(null);
    setLockedOut(false);
    beginReset();
    confirmReset();
  }, [open, beginReset, confirmReset]);

  const pending = begin.isPending || confirm.isPending;
  const started = begin.data;
  const recoveryCodes = confirm.data;

  const verify = () => {
    setError(null);
    begin.mutate(
      { password, code: currentCode },
      {
        onSuccess: () => setStep('new-app'),
        onError: (failure) => {
          setCurrentCode('');
          if (isApiError(failure) && failure.kind === 'rate_limited') {
            setLockedOut(true);
            setError(
              'Too many failed attempts. For your security this session has been signed out.',
            );
            return;
          }
          if (isApiError(failure) && failure.code === 'otp_invalid') {
            setError('That code did not match your current authenticator app.');
            return;
          }
          setError(refusal(failure, 'Your authenticator could not be verified.'));
        },
      },
    );
  };

  const replace = () => {
    if (started === undefined) return;
    setError(null);
    confirm.mutate(
      { enrolmentToken: started.enrolmentToken, code: newCode },
      {
        onSuccess: () => {
          setStep('codes');
          onReplaced();
        },
        onError: (failure) => {
          setNewCode('');
          if (isApiError(failure) && failure.code === 'token_invalid') {
            // The enrolment expired (it lives as long as a sign-in challenge)
            // or belongs to another session: start again from step 1.
            begin.reset();
            setPassword('');
            setCurrentCode('');
            setStep('verify');
            setError('This replacement expired before it was confirmed. Start again.');
            return;
          }
          if (isApiError(failure) && failure.code === 'otp_invalid') {
            setError('That code did not match. Use the newest code from the new app.');
            return;
          }
          setError(refusal(failure, 'Your authenticator was not replaced.'));
        },
      },
    );
  };

  const close = () => {
    if (lockedOut) onSignedOut();
    onClose();
  };

  const footer =
    step === 'codes' ? (
      <Button onClick={close}>Done</Button>
    ) : lockedOut ? (
      <Button onClick={close}>Sign in again</Button>
    ) : (
      <>
        <Button variant="secondary" onClick={close} disabled={pending}>
          Cancel
        </Button>
        {step === 'verify' ? (
          <Button
            onClick={verify}
            loading={begin.isPending}
            disabled={password === '' || !CODE_PATTERN.test(currentCode)}
          >
            Continue
          </Button>
        ) : (
          <Button
            onClick={replace}
            loading={confirm.isPending}
            disabled={!CODE_PATTERN.test(newCode)}
          >
            Replace authenticator
          </Button>
        )}
      </>
    );

  return (
    <Modal
      open={open}
      onClose={close}
      // The new recovery codes are shown once: closing by accident would lose them.
      dismissible={!pending && step !== 'codes'}
      title="Replace your authenticator app"
      description={
        step === 'codes'
          ? 'Your new authenticator app is in use. The old app and the old recovery codes no longer work.'
          : 'Your current app and recovery codes keep working until the new app is confirmed.'
      }
      size="md"
      footer={footer}
    >
      <Stack gap={4}>
        {step === 'verify' && !lockedOut ? (
          <>
            <Input
              label="Your password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <Input
              label="Code from your current app"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={currentCode}
              onChange={(event) => setCurrentCode(event.target.value.replace(/\D/g, ''))}
              helperText="The six digits the app you use now shows for Medora."
            />
          </>
        ) : null}
        {step === 'new-app' && started !== undefined ? (
          <>
            <div>
              <p className="text-body-sm text-text-primary">
                1. Add Medora to your new authenticator app with this key:
              </p>
              <p className="mt-1 break-all rounded-control bg-surface-sunken px-3 py-2 font-mono text-body-sm text-text-primary">
                {grouped(started.secret)}
              </p>
              {isOtpauthUrl(started.otpauthUrl) ? (
                <a
                  href={started.otpauthUrl}
                  className="mt-1 inline-block text-body-sm text-primary underline"
                >
                  Open in an authenticator app on this device
                </a>
              ) : null}
            </div>
            <Input
              label="Code from the new app"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={newCode}
              onChange={(event) => setNewCode(event.target.value.replace(/\D/g, ''))}
              helperText="2. Enter the six digits the new app shows for Medora."
            />
          </>
        ) : null}
        {step === 'codes' && recoveryCodes !== undefined ? (
          <div>
            <p className="text-body-sm text-text-primary">
              Keep these new recovery codes somewhere safe. Each signs you in once if you lose your
              phone; they are not shown again.
            </p>
            <ul className="mt-1 grid grid-cols-2 gap-1 font-mono text-body-sm text-text-primary">
              {recoveryCodes.map((recovery) => (
                <li key={recovery} dir="ltr">
                  {recovery}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {error === null ? null : <Alert variant="error" title={error} />}
      </Stack>
    </Modal>
  );
}
