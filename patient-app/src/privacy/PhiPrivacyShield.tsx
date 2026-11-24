import { useEffect, useState, type ReactNode } from 'react';

import { AppState, StyleSheet, View, type AppStateStatus } from 'react-native';

import { decorative } from '@/accessibility/a11y';
import { Icon, Text } from '@/components';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';

/**
 * The app-switcher shield — checklist T-09, audit R-8.
 *
 * ── What it defends against ──────────────────────────────────────────
 * Both platforms photograph the app the moment it leaves the foreground
 * and show that photograph in the task switcher. A patient who opens
 * their lab results, switches to answer a message and hands the phone to
 * someone has handed over a thumbnail of their results — no unlock, no
 * app launch, no session required. Nothing in T-01…T-08 touches this:
 * the PHI is not on disk, not in a log and not in the cache by then, it
 * is on the screen, which is exactly what gets photographed.
 *
 * ── How ──────────────────────────────────────────────────────────────
 * The snapshot is taken as the app becomes inactive, so an opaque cover
 * rendered on that transition is what lands in the photograph. It is
 * removed on the way back, and a patient returning to the foreground
 * sees their screen exactly where they left it — this is a privacy
 * cover, not a lock (that is T-11's job, and the two are deliberately
 * separate: a cover costs nothing, a lock costs a password).
 *
 * ── Why it covers the whole app rather than the PHI screens ──────────
 * `clearPhiCache` lists the PHI domains explicitly *and then* clears
 * everything, because the failure nobody catches in review is the new
 * feature that forgot to register. The same reasoning applies harder
 * here: a per-screen opt-in is one forgotten prop away from a records
 * screen in the switcher. So the rule is the coarse one — **while a
 * patient is signed in, the app does not appear in the switcher** —
 * which no future screen can opt out of by accident. Signed out there is
 * nothing to protect, and Welcome and Emergency are public by design.
 *
 * ── Two limits, recorded rather than hidden ──────────────────────────
 * - This covers the *switcher snapshot*. It does not prevent a
 *   deliberate screenshot; that needs `FLAG_SECURE` via
 *   `expo-screen-capture`, a native module that needs a development
 *   build (`ARCHITECTURE.md` §1, "Deliberately absent").
 * - A screen presented as a native modal by `react-native-screens` may
 *   sit above this cover on iOS. The screens T-09 names — records, lab
 *   results, prescriptions, documents, messages — are all stack screens,
 *   not modals; the two modals in this app are Emergency and Booking,
 *   neither of which renders a record.
 */

/** `unknown` is not `active`, and is also not a reason to cover anything. */
function isObscuring(state: AppStateStatus): boolean {
  return state === 'background' || state === 'inactive';
}

function asAppStateStatus(state: string | null | undefined): AppStateStatus {
  switch (state) {
    case 'active':
    case 'background':
    case 'inactive':
    case 'extension':
    case 'unknown':
      return state;
    default:
      return 'unknown';
  }
}

/**
 * True while the OS is showing something other than this app — which is
 * also when it takes the picture.
 */
export function useAppIsObscured(): boolean {
  const [obscured, setObscured] = useState(() =>
    isObscuring(asAppStateStatus(AppState.currentState)),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      setObscured(isObscuring(next));
    });
    return () => subscription.remove();
  }, []);

  return obscured;
}

export interface PhiPrivacyShieldProps {
  /** Whether there is a session, and therefore something to protect. */
  readonly protecting: boolean;
  readonly children: ReactNode;
}

export function PhiPrivacyShield({ protecting, children }: PhiPrivacyShieldProps) {
  const obscured = useAppIsObscured();

  return (
    <View style={styles.fill}>
      {children}
      {protecting && obscured ? <PrivacyCover /> : null}
    </View>
  );
}

/**
 * The cover itself.
 *
 * Opaque rather than blurred: a blur is a native module, and a blurred
 * medication list is still a medication list at the resolutions a
 * switcher renders.
 *
 * It is `decorative`, so VoiceOver and TalkBack ignore it. A patient
 * using a screen reader should not hear this announced every time a
 * notification banner makes the app briefly inactive — and there is
 * nothing here to act on, because by the time it is readable the app is
 * in the foreground again and the cover is gone.
 *
 * Touches are NOT passed through. During the `inactive` window the
 * content underneath is invisible, and a control that can be pressed but
 * not seen is worse than one that cannot be pressed.
 */
function PrivacyCover() {
  const theme = useTheme();
  const t = useT();

  return (
    <View
      testID="phi-privacy-cover"
      {...decorative}
      style={[
        StyleSheet.absoluteFill,
        styles.cover,
        { backgroundColor: theme.colors.background, rowGap: theme.space[3] },
      ]}
    >
      <Icon name="shield" size={40} color="primary" />
      <Text variant="body" color="textSecondary">
        {t('privacy.cover')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 1 },
  fill: { flex: 1 },
});
