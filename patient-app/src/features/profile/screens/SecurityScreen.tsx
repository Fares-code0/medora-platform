import { useState } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import {
  AsyncBoundary,
  Card,
  ConfirmSheet,
  Divider,
  ListItem,
  Screen,
  Section,
  Text,
  useToast,
} from '@/components';
import { BiometricUnlockSetting } from '@/features/auth/components/BiometricUnlockSetting';
import { ChangePasswordForm } from '@/features/auth/components/ChangePasswordForm';
import { TwoFactorSetup } from '@/features/auth/components/TwoFactorSetup';
import { useT, useDateFormat } from '@/i18n';
import { useTheme } from '@/theme';

import { profileKeys } from '../keys';
import type { ActiveSession } from '../model/types';
import { profileService } from '../service';

/**
 * Security.
 *
 * ── What is real here, and what is not ───────────────────────────────
 * Changing a password is **built** (checklist P-05) against the live
 * `POST /me/password` route — one of the sixteen the backend serves
 * today — so it is a working control rather than a screen over a fixture.
 * The device list beneath it is BE-10 and is not.
 *
 * ── Signing another device out (P-06) ────────────────────────────────
 *
 * `revokeSession` had been on the port and in the fixture since the
 * profile feature was written, and nothing called it: the list rendered
 * every session `readOnly`, so a patient who saw a device they did not
 * recognise could read about it and do nothing. It is now an action, on
 * three terms:
 *
 * - **Never on the current session.** A row that signed this phone out
 *   would be Sign out wearing a device's name, without the sweep
 *   `logout()` performs — the keychain, the query cache and the PHI that
 *   T-03 clears. Sign out is on the profile screen and is the only way
 *   out of this phone.
 * - **Behind a `ConfirmSheet`** (R-06), because it is outward-facing:
 *   something on another device stops working. The sheet names the
 *   device and says the phone in the patient's hand is not affected,
 *   which is the question a confirmation for this action has to answer.
 * - **Not optimistic.** Which sessions survive is the server's answer,
 *   and the list is re-read rather than edited here — the same rule the
 *   password form follows two sections above.
 *
 * Since M8 the list is **live** — `GET /me/sessions` and
 * `DELETE /me/sessions/{id}`. Nothing on this screen changed when it
 * swapped, which is the seam working: the only visible consequence is
 * that `deviceLabel` can now be `null`, because the server's `device`
 * and `browser` columns both are, and a session with neither is named
 * here in the patient's language rather than by the transport layer in
 * English (C-09).
 *
 * The form is `features/auth/components/ChangePasswordForm`: the password
 * lifecycle, its policy and its error reading belong to the auth feature,
 * and this screen is where a patient goes looking for them.
 *
 * Two-factor enrolment (D-16) is built too, against the three live
 * `POST /me/2fa/*` routes. Like the password form it lives in the auth
 * feature — the enrolment, its schemas and its error reading are the
 * password lifecycle's neighbours, not the profile's.
 *
 * Everything else here shows state or offers a server-side operation.
 * There is still no "app PIN" that a reinstall clears.
 *
 * Biometric app-unlock (D-15) is the one client-side control, and it is
 * here on terms this screen used to argue against — the note that stood
 * here said a biometric gate would be a *fake control* because the
 * refresh token stays readable whatever the screen shows. That was right
 * about the mechanism and wrong about the threat. It protects the
 * screen, not the token: the phone handed over to look at a photo, with
 * Medora already open and signed in. The toggle's own copy says exactly
 * that and claims nothing more, which is what keeps it honest under
 * T-07. `features/auth/biometrics.ts` carries the full reasoning.
 */
export function SecurityScreen() {
  const theme = useTheme();
  const { formatRelative } = useDateFormat();
  const t = useT();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [pendingRevoke, setPendingRevoke] = useState<ActiveSession | null>(null);
  const sessionsKey = profileKeys.sessions();
  const sessions = useQuery({
    queryKey: sessionsKey,
    queryFn: () => profileService.listSessions(),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => profileService.revokeSession(id),
    onSuccess: () => {
      toast.show(t('security.devices.signedOut'), 'success');
      void queryClient.invalidateQueries({ queryKey: sessionsKey });
    },
    onError: () => toast.show(t('security.devices.failed'), 'error'),
  });

  return (
    <Screen testID="security-screen">
      <Text variant="h1" {...headingA11y(t('security.title'))}>
        {t('security.title')}
      </Text>

      <Section title={t('security.section.password')}>
        <Card tone="sunken">
          <Text variant="bodySm" color="textSecondary">
            {t('security.password.notice')}
          </Text>
        </Card>

        <ChangePasswordForm
          onChanged={() => {
            // The server has just ended every other session. Re-read the
            // list rather than editing it here: which sessions survived is
            // the server's answer, not this screen's guess.
            void queryClient.invalidateQueries({ queryKey: sessionsKey });
          }}
        />
      </Section>

      <Section title={t('security.section.unlock')}>
        <BiometricUnlockSetting />
      </Section>

      <Section title={t('security.section.twoFactor')}>
        <Card tone="sunken">
          <Text variant="bodySm" color="textSecondary">
            {t('security.twoFactor.blurb')}
          </Text>
        </Card>

        <TwoFactorSetup />
      </Section>

      <Section title={t('security.section.devices')}>
        <Card tone="sunken">
          <Text variant="bodySm" color="textSecondary">
            {t('security.devices.notice')}
          </Text>
        </Card>

        <AsyncBoundary
          testID="security-sessions"
          query={sessions}
          isEmpty={(data) => data.length === 0}
          empty={{ icon: 'smartphone', title: t('security.devices.empty') }}
        >
          {(data) => (
            <Card padded={false}>
              <View style={{ paddingHorizontal: theme.space[4] }}>
                {data.map((session, index) => (
                  <View key={session.id}>
                    {index === 0 ? null : <Divider />}
                    <ListItem
                      testID={`session-${session.id}`}
                      title={session.deviceLabel ?? t('security.devices.unnamed')}
                      subtitle={t('security.devices.lastUsed', {
                        when: formatRelative(session.lastSeenAt),
                      })}
                      value={
                        session.current
                          ? t('security.devices.thisDevice')
                          : t('security.devices.signOut')
                      }
                      icon="smartphone"
                      readOnly={session.current}
                      {...(session.current
                        ? {}
                        : {
                            destructive: true,
                            accessibilityHint: t('security.devices.hint'),
                            onPress: () => setPendingRevoke(session),
                          })}
                    />
                  </View>
                ))}
              </View>
            </Card>
          )}
        </AsyncBoundary>
      </Section>

      <Section title={t('security.section.protection')}>
        <Card tone="sunken">
          <Text variant="bodySm" color="textSecondary">
            {t('security.protection.body')}
          </Text>
        </Card>
      </Section>

      <ConfirmSheet
        visible={pendingRevoke !== null}
        testID="session-revoke-confirm"
        title={t('security.devices.confirmTitle', {
          // The sheet names the device, so the same fallback the row
          // uses has to reach it — an empty interpolation would read as
          // "Sign out ?" on exactly the session a patient is least able
          // to identify and most likely to want ended.
          device: pendingRevoke?.deviceLabel ?? t('security.devices.unnamed'),
        })}
        detail={t('security.devices.confirmDetail')}
        confirmLabel={t('security.devices.signOut')}
        tone="destructive"
        onConfirm={() => {
          const session = pendingRevoke;
          setPendingRevoke(null);
          if (session !== null) revoke.mutate(session.id);
        }}
        onCancel={() => setPendingRevoke(null)}
      />
    </Screen>
  );
}
