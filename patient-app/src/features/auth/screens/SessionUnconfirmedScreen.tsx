import { useCallback, useEffect, useRef, useState } from 'react';

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import { Button, ConfirmSheet, Icon, Screen, Text } from '@/components';
import { useT } from '@/i18n';
import type { SessionCheckStackParamList } from '@/navigation/routes';
import { useNetworkStatus } from '@/network/NetworkProvider';
import { useTheme } from '@/theme';

import { FormBanner } from '../components/FormBanner';
import { useSession } from '../SessionProvider';

type Props = NativeStackScreenProps<SessionCheckStackParamList, 'SessionCheck'>;

/**
 * "We couldn't confirm you're signed in" — the `unconfirmed` session state.
 *
 * Shown when a refresh token is in the keychain and the server could not
 * be reached to exchange it (`refresh-outcome.ts`). Before this screen
 * existed that case deleted the token and showed the sign-in form with
 * "your session ended", which was untrue and permanent.
 *
 * What it offers, and why each one:
 *
 * - **Try again** — the same exchange, single-flight in the provider.
 * - **An automatic retry when the phone comes back online.** A patient who
 *   opened the app in a lift should not have to notice the signal return.
 *   Only on a real offline → online transition, never on mount, so this
 *   screen never hammers a server that answered with a 5xx.
 * - **Sign out of this phone** — behind a confirmation (R-06) that says
 *   what it does: with no access token, the server cannot be told
 *   (`/auth/logout` revokes the session an access token names), so the
 *   sign-out is this phone's only. It is never described as more.
 * - **Emergency** — in the header, from the stack this screen lives in
 *   (`RootNavigator`). Every state of this app reaches it in one tap.
 *
 * ── Never moving the patient off Emergency (audit M4) ───────────────
 * This screen stays mounted beneath Emergency, and a retry's outcome
 * replaces the whole navigator — signed in, or sent to sign in. So no
 * outcome is allowed to land while the patient is elsewhere: a reconnect
 * while Emergency is open is remembered and retried on return, and a
 * retry already in flight holds its outcome (`until`) until this screen
 * is focused again. The provider stores a rotated token at once either
 * way; only what the patient sees waits.
 *
 * No clinical data is shown: there is no access token and no identity.
 */
export function SessionUnconfirmedScreen({ navigation }: Props) {
  const t = useT();
  const theme = useTheme();
  const { retryRestore, logout } = useSession();
  const { isOnline, isUnknown } = useNetworkStatus();
  const [retrying, setRetrying] = useState(false);
  const [stillUnreachable, setStillUnreachable] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const mounted = useRef(true);

  // Focus, read from the navigator rather than assumed: Emergency is a
  // route on top of this one, and while it is open this screen is mounted
  // but not what the patient is looking at.
  const focused = useRef(navigation.isFocused());
  const focusWaiters = useRef<(() => void)[]>([]);
  const reconnectWhileAway = useRef(false);

  const releaseFocusWaiters = useCallback(() => {
    for (const resolve of focusWaiters.current.splice(0)) resolve();
  }, []);

  const untilFocused = useCallback(
    () =>
      focused.current
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            focusWaiters.current.push(resolve);
          }),
    [],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // A held outcome must not wait for a screen that is gone: release it,
      // and the provider decides (a sign-out since then discards it).
      releaseFocusWaiters();
    };
  }, [releaseFocusWaiters]);

  // A reconnect can fire while a tapped retry is still in flight. The
  // provider would ignore the second call anyway; ignoring it here too is
  // what stops it clearing the spinner while the first is still waiting.
  const inFlight = useRef(false);

  const retry = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRetrying(true);
    setStillUnreachable(false);
    try {
      const outcome = await retryRestore({ until: untilFocused });
      // Only "the server did not answer again" earns the banner. A retry
      // that did nothing says nothing; one that settled replaced this screen.
      if (mounted.current && outcome === 'no-answer') setStillUnreachable(true);
    } finally {
      inFlight.current = false;
      if (mounted.current) setRetrying(false);
    }
  }, [retryRestore, untilFocused]);

  useEffect(() => {
    const offFocus = navigation.addListener('focus', () => {
      focused.current = true;
      releaseFocusWaiters();
      if (reconnectWhileAway.current) {
        reconnectWhileAway.current = false;
        void retry();
      }
    });
    const offBlur = navigation.addListener('blur', () => {
      focused.current = false;
    });
    return () => {
      offFocus();
      offBlur();
    };
  }, [navigation, releaseFocusWaiters, retry]);

  // Retry once on each offline → online transition — now, or on return if
  // the patient is in Emergency. `isUnknown` is the probe that has not
  // answered yet, which is not a transition.
  const wasOnline = useRef(isOnline);
  useEffect(() => {
    if (isUnknown) return;
    const cameBack = !wasOnline.current && isOnline;
    wasOnline.current = isOnline;
    if (!cameBack) return;
    if (focused.current) void retry();
    else reconnectWhileAway.current = true;
  }, [isOnline, isUnknown, retry]);

  const offline = !isUnknown && !isOnline;

  return (
    <Screen edges={['bottom']} testID="session-unconfirmed-screen">
      <View
        style={{ alignItems: 'center', rowGap: theme.space[3], paddingVertical: theme.space[6] }}
      >
        <Icon name="wifiOff" size={44} color="primary" />
        <Text variant="h1" align="center" {...headingA11y(t('session.unconfirmed.title'))}>
          {t('session.unconfirmed.title')}
        </Text>
        <Text variant="body" color="textSecondary" align="center">
          {t('session.unconfirmed.body')}
        </Text>
        <Text variant="bodySm" color="textSecondary" align="center">
          {offline ? t('session.unconfirmed.offline') : t('session.unconfirmed.online')}
        </Text>
      </View>

      {stillUnreachable ? (
        <FormBanner testID="session-unconfirmed-still" message={t('session.unconfirmed.still')} />
      ) : null}

      <Button
        label={t('session.unconfirmed.retry')}
        size="lg"
        fullWidth
        loading={retrying}
        disabled={retrying}
        testID="session-unconfirmed-retry"
        onPress={() => void retry()}
      />
      <Button
        label={t('session.unconfirmed.signOut')}
        tone="ghost"
        testID="session-unconfirmed-sign-out"
        onPress={() => setConfirmSignOut(true)}
      />

      <ConfirmSheet
        visible={confirmSignOut}
        testID="session-unconfirmed-sign-out-confirm"
        title={t('session.unconfirmed.signOut.confirmTitle')}
        detail={t('session.unconfirmed.signOut.confirmDetail')}
        confirmLabel={t('session.unconfirmed.signOut')}
        tone="destructive"
        onConfirm={() => {
          setConfirmSignOut(false);
          // The provider moves the epoch on, so a retry still in flight
          // cannot sign the patient back in when it lands (audit M5).
          void logout();
        }}
        onCancel={() => setConfirmSignOut(false)}
      />
    </Screen>
  );
}
