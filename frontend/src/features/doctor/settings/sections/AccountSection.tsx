import { useEffect, useRef, useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { AtSign, CheckCircle2, KeyRound, Mail, Phone, UserRoundCog } from 'lucide-react';
import { useForm } from 'react-hook-form';

import { useAuth, useToast } from '@/app/providers';
import { Grid } from '@/components/layout';
import { PasswordStrengthMeter } from '@/components/patterns';
import { Button, Input, PasswordInput } from '@/components/ui';

import { useChangePasswordMutation, useSaveAccountMutation } from '../api/useSettingsQueries';
import { SettingsCard } from '../components/SettingsCard';
import { StickySaveBar } from '../components/StickySaveBar';
import { isPasswordLockout } from '../model/password-lockout';
import { CurrentPasswordError } from '../model/settings-service';
import type { SettingsDocument } from '../model/types';
import {
  accountSchema,
  passwordSchema,
  type AccountFormValues,
  type PasswordFormValues,
} from '../schemas';
import { settingsService } from '../service';

/**
 * Account section — sign-in identity (email, username, phone) behind the
 * sticky save bar, plus a self-contained change-password form with a live
 * strength meter, show/hide toggles, full validation, and a success state.
 * The mock verifies the current password and surfaces a field-level error
 * when it is wrong.
 */
export function AccountSection({ document }: { document: SettingsDocument }) {
  return (
    <div className="flex flex-col gap-5">
      <AccountDetails document={document} />
      <PasswordChange />
    </div>
  );
}

function AccountDetails({ document }: { document: SettingsDocument }) {
  const { toast } = useToast();
  const saveAccount = useSaveAccountMutation();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<AccountFormValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: {
      email: document.account.email,
      username: document.account.username,
      phone: document.account.phone,
    },
  });

  // Re-sync to the persisted account after a save (StrictMode-safe reset — see
  // ProfileSection). Guarded so it only fires when the saved data changes.
  const savedKey = JSON.stringify({
    email: document.account.email,
    username: document.account.username,
    phone: document.account.phone,
  });
  const lastSavedKey = useRef(savedKey);
  useEffect(() => {
    if (lastSavedKey.current !== savedKey) {
      lastSavedKey.current = savedKey;
      reset({
        email: document.account.email,
        username: document.account.username,
        phone: document.account.phone,
      });
    }
  }, [savedKey, document.account, reset]);

  const onSubmit = handleSubmit((values) => {
    saveAccount.mutate(values, {
      onSuccess: () => toast({ variant: 'success', title: 'Account updated' }),
      onError: () =>
        toast({
          variant: 'error',
          title: 'Could not update account',
          description: 'Please try again.',
        }),
    });
  });

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate>
      <SettingsCard
        title="Account details"
        description="Your sign-in email, username, and contact number."
        icon={UserRoundCog}
      >
        <Grid columns={{ base: 1, md: 2 }} gap={4}>
          <Input
            label="Email address"
            type="email"
            leadingIcon={Mail}
            required
            readOnly={!settingsService.capabilities.emailEditable}
            helperText={
              settingsService.capabilities.emailEditable
                ? undefined
                : 'Your sign-in email is changed by an administrator.'
            }
            error={errors.email?.message}
            {...register('email')}
          />
          <Input
            label="Username"
            leadingIcon={AtSign}
            required
            error={errors.username?.message}
            {...register('username')}
          />
          <Input
            label="Phone number"
            leadingIcon={Phone}
            required
            error={errors.phone?.message}
            {...register('phone')}
          />
        </Grid>
      </SettingsCard>
      <StickySaveBar
        visible={isDirty}
        saving={saveAccount.isPending}
        onSave={() => void onSubmit()}
        onCancel={() => reset()}
      />
    </form>
  );
}

/** What the server's 429 on `/me/password` means for the person at the screen. */
const SESSION_ENDED_BY_LOCKOUT = {
  title: 'Too many incorrect passwords',
  description:
    'Your account is temporarily locked and you have been signed out. Sign in again once the lock has passed.',
} as const;

function PasswordChange() {
  const { toast } = useToast();
  const { logout } = useAuth();
  const changePassword = useChangePasswordMutation();
  const [succeeded, setSucceeded] = useState(false);
  // Set once the server has ended the session: nothing more is sent from
  // this form, and the session is ended here exactly once.
  const signingOut = useRef(false);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { current: '', next: '', confirm: '' },
  });

  const nextPassword = watch('next');

  const onSubmit = handleSubmit(async (values) => {
    if (signingOut.current) return;
    setSucceeded(false);
    try {
      await changePassword.mutateAsync({ current: values.current, next: values.next });
      reset({ current: '', next: '', confirm: '' });
      setSucceeded(true);
      toast({ variant: 'success', title: 'Password changed' });
    } catch (error) {
      if (error instanceof CurrentPasswordError) {
        setError('current', { message: 'Current password is incorrect' });
      } else if (isPasswordLockout(error)) {
        // The guess that reached the sign-in lockout, or any attempt while
        // the account is locked: the server has locked the account and ended
        // this session (owner decision D1). Say so, then sign out here too —
        // as after turning 2FA off — rather than "try again" on a session
        // that no longer exists.
        signingOut.current = true;
        reset({ current: '', next: '', confirm: '' });
        toast({ variant: 'error', ...SESSION_ENDED_BY_LOCKOUT });
        await logout();
      } else {
        toast({
          variant: 'error',
          title: 'Could not change password',
          description: 'Please try again.',
        });
      }
    }
  });

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate>
      <SettingsCard
        title="Password"
        description="Choose a strong password you don't use elsewhere."
        icon={KeyRound}
      >
        {succeeded ? (
          <div className="mb-4 flex items-center gap-2 rounded-surface border border-success-subtle bg-success-subtle px-3 py-2 text-body-sm text-success">
            <CheckCircle2 className="h-4 w-4 shrink-0" strokeWidth={1.75} />
            Your password was updated.
          </div>
        ) : null}
        <div className="grid max-w-md gap-4">
          <PasswordInput
            label="Current password"
            autoComplete="current-password"
            error={errors.current?.message}
            {...register('current')}
          />
          <div>
            <PasswordInput
              label="New password"
              autoComplete="new-password"
              error={errors.next?.message}
              {...register('next')}
            />
            <PasswordStrengthMeter password={nextPassword} />
          </div>
          <PasswordInput
            label="Confirm new password"
            autoComplete="new-password"
            error={errors.confirm?.message}
            {...register('confirm')}
          />
          <div>
            <Button type="submit" loading={isSubmitting}>
              Update password
            </Button>
          </div>
        </div>
      </SettingsCard>
    </form>
  );
}
