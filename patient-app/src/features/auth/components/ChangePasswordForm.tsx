import { useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { View } from 'react-native';

import { Button, Text } from '@/components';
import { ControlledInput } from '@/components/form/ControlledInput';
import { useFieldChain } from '@/components/form/useFieldChain';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';

import {
  changePasswordFormSchema,
  type ChangePasswordForm as ChangePasswordFormValues,
} from '../schemas';
import { authService } from '../service';
import {
  changePasswordErrors,
  resolveAuthMessage,
  type AuthErrorMessage,
} from '../useAuthErrorMessage';

import { FormBanner } from './FormBanner';
import { PasswordRules } from './PasswordRules';

/**
 * Change password — checklist P-05, `POST /me/password`.
 *
 * ── Why this is a component and not a screen ─────────────────────────
 * The checklist puts the row on `SecurityScreen`, where a patient looking
 * for it will look. Keeping the form here rather than there is a layering
 * choice: the password lifecycle is the auth feature's — the schema
 * mirroring `changePasswordSchema`, the policy meter, and the reading of
 * `invalid_credentials` that must not become a logout all live in this
 * folder — and the profile feature should not grow a second copy of any
 * of them. `SecurityScreen` renders it and owns nothing about it.
 *
 * ── What the server does, and this does not ──────────────────────────
 * A successful change signs out every OTHER device and leaves this one
 * signed in (API §2 business rules; `password-recovery.service.ts`). The
 * form therefore does not clear the session, does not navigate away, and
 * does not prune a device list it has no authority over — it says what
 * happened and asks the screen to re-read. `onChanged` is that ask.
 *
 * ── The failure that matters ─────────────────────────────────────────
 * A wrong current password is `401 invalid_credentials`. It is not an
 * expired session: `ApiClient` will not refresh on it, and
 * `changePasswordErrors` puts it on the field rather than in a banner.
 * The patient stays on the form with one thing to fix. That is the whole
 * of checklist D-02 applied to this screen.
 *
 * Nothing here is logged. Neither password ever reaches a console, a
 * query cache, or any store — they live in form state for the length of
 * one submit and are cleared on success.
 */
export function ChangePasswordForm({ onChanged }: { onChanged?: () => void }) {
  const t = useT();
  // A field message is either a catalogue entry this client chose or a
  // sentence the SERVER wrote — `422 weak_password` arrives with the
  // backend's own wording, which is deliberately identical to this
  // form's policy checklist so the two read as one rule rather than two
  // spellings of it. A server sentence passes through untouched; a key
  // is translated.
  const translate = (message: AuthErrorMessage | string): string =>
    typeof message === 'string' ? message : resolveAuthMessage(t, message);
  const theme = useTheme();
  const [banner, setBanner] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const { control, handleSubmit, setError, reset } = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(changePasswordFormSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmNewPassword: '' },
  });

  const newPassword = useWatch({ control, name: 'newPassword' }) ?? '';

  const onSubmit = handleSubmit(async (values) => {
    setBanner(null);
    setChanged(false);
    setSubmitting(true);
    try {
      await authService.changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      // The plaintext leaves memory here rather than at the next render.
      reset({ currentPassword: '', newPassword: '', confirmNewPassword: '' });
      setChanged(true);
      onChanged?.();
    } catch (caught) {
      const mapped = changePasswordErrors(caught);
      setBanner(mapped.banner === null ? null : translate(mapped.banner));
      if (mapped.fields.currentPassword !== undefined) {
        setError('currentPassword', { message: translate(mapped.fields.currentPassword) });
      }
      if (mapped.fields.newPassword !== undefined) {
        setError('newPassword', { message: translate(mapped.fields.newPassword) });
      }
    } finally {
      setSubmitting(false);
    }
  });

  const chain = useFieldChain({ length: 3, onSubmit: () => void onSubmit() });

  return (
    <View style={{ rowGap: theme.space[4] }} testID="change-password-form">
      {changed ? (
        <FormBanner
          testID="change-password-success"
          tone="success"
          message={t('security.changePassword.success')}
        />
      ) : null}

      {banner === null ? null : <FormBanner testID="change-password-error" message={banner} />}

      <View style={{ rowGap: theme.space[4] }}>
        <ControlledInput
          {...chain.field(0)}
          control={control}
          name="currentPassword"
          label={t('security.changePassword.current')}
          testID="change-password-current"
          secure
          autoCapitalize="none"
          autoComplete="current-password"
          required
        />
        <ControlledInput
          {...chain.field(1)}
          control={control}
          name="newPassword"
          label={t('security.changePassword.new')}
          testID="change-password-new"
          secure
          autoCapitalize="none"
          autoComplete="new-password"
          required
        />
        <ControlledInput
          {...chain.field(2)}
          control={control}
          name="confirmNewPassword"
          label={t('security.changePassword.confirm')}
          testID="change-password-confirm"
          secure
          autoCapitalize="none"
          autoComplete="new-password"
          required
        />
      </View>

      <PasswordRules password={newPassword} testID="change-password-rules" />

      <Text variant="caption" color="textTertiary">
        {t('security.changePassword.notice')}
      </Text>

      <Button
        label={t('security.changePassword.submit')}
        size="lg"
        fullWidth
        loading={submitting}
        testID="change-password-submit"
        onPress={() => void onSubmit()}
      />
    </View>
  );
}
