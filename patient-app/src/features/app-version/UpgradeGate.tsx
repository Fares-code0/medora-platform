import { useEffect, useState, type ReactNode } from 'react';

import { Linking, StyleSheet, View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import { apiClient } from '@/api/client';
import { Button, Icon, Text } from '@/components';
import { env } from '@/configs/env';
import { useT } from '@/i18n';
import { track } from '@/utils/analytics';
import { logger } from '@/utils/logger';

import {
  CURRENT_APP_VERSION,
  decideUpgrade,
  MINIMUM_VERSION_HEADER,
  type UpgradeState,
} from './version';

/**
 * The forced-upgrade gate (checklist W-06).
 *
 * ── Where it sits, and why so high ───────────────────────────────────
 * It wraps the navigator, above the auth stack. An app the operator has
 * withdrawn must not sign anyone in either: the reason a build gets
 * withdrawn is usually that something about its handling of a session or
 * of clinical data is wrong, and letting it authenticate first is letting
 * it do the thing it was withdrawn for.
 *
 * It sits BELOW `ThemeProvider` so the blocking screen is themed — the
 * same reason `ErrorBoundary` does — and below `SessionProvider` so that
 * a gate tripping mid-session does not tear the session context out from
 * under the screens still mounted beneath it.
 *
 * ── Not dismissible, and not a toast ─────────────────────────────────
 * There is no "later". A forced upgrade with a skip button is a
 * suggestion, and the operator reaches for this only when a suggestion
 * is not enough. `Emergency` is deliberately NOT exempted: this screen
 * carries the same "call your local emergency number" line the crash
 * fallback does, because the honest advice from a build we have just
 * declared unfit is to use the phone's own dialler, not to trust a
 * screen this app is rendering.
 *
 * ── One-way ──────────────────────────────────────────────────────────
 * Once tripped it stays tripped for the life of the process. A later
 * response without the header would otherwise unlock the app — a request
 * that fell back to a cache, or hit a stale instance behind a rollout,
 * would silently reopen a build the operator has closed.
 */

/** Exported for the test: the provider is otherwise a closed box. */
export function useUpgradeState(currentVersion: string = CURRENT_APP_VERSION): UpgradeState {
  const [state, setState] = useState<UpgradeState>('unknown');

  useEffect(() => {
    return apiClient.addResponseObserver((headers) => {
      const decision = decideUpgrade(currentVersion, headers.get(MINIMUM_VERSION_HEADER));
      // Never downgrade out of `upgrade-required` — see the header note.
      if (decision === 'upgrade-required') setState('upgrade-required');
      else setState((previous) => (previous === 'upgrade-required' ? previous : decision));
    });
  }, [currentVersion]);

  return state;
}

async function openStore(url: string): Promise<void> {
  try {
    await Linking.openURL(url);
  } catch {
    // A device with no store app, or a malformed configuration. The
    // screen already tells the patient what to do without the button.
    logger.warn('Could not open the app store listing');
  }
}

/**
 * The blocking screen.
 *
 * The store link is shown only when the operator has configured one
 * (`EXPO_PUBLIC_APP_STORE_URL`). An unconfigured build says what to do in
 * words rather than offering a button that goes nowhere — the same rule
 * N-04 applies to emergency numbers: never guess a plausible value. There
 * is no real listing URL to hardcode here, because there is no published
 * listing yet (W-01, W-03).
 */
export function UpgradeRequiredScreen({
  storeUrl = env.appStoreUrl,
}: {
  storeUrl?: string | null;
}) {
  const t = useT();

  return (
    <View style={styles.container} testID="upgrade-required-screen">
      <Icon name="alert" size={40} color="warning" />

      <Text variant="h2" align="center" {...headingA11y(t('upgrade.title'))}>
        {t('upgrade.title')}
      </Text>

      <Text variant="bodySm" color="textTertiary" align="center">
        {t('upgrade.body')}
      </Text>

      {storeUrl == null || storeUrl.length === 0 ? (
        <Text variant="bodySm" color="textTertiary" align="center" testID="upgrade-no-store-link">
          {t('upgrade.noStoreLink')}
        </Text>
      ) : (
        <Button
          label={t('upgrade.action')}
          testID="upgrade-open-store"
          onPress={() => void openStore(storeUrl)}
        />
      )}

      <Text variant="caption" color="textTertiary" align="center">
        If you need urgent help, call your local emergency number from your phone&apos;s dialler.
      </Text>
    </View>
  );
}

export function UpgradeGate({ children }: { children: ReactNode }) {
  const state = useUpgradeState();
  const gated = state === 'upgrade-required';

  // Counted once per transition, not once per render (W-05). The number
  // that matters is how many installs a floor actually stopped — a gate
  // that fires on more builds than the operator intended is the failure
  // this mechanism can cause, and it is invisible from the server side,
  // which never learns that the client stopped calling.
  useEffect(() => {
    if (gated) track('upgrade.gate_shown');
  }, [gated]);

  if (gated) return <UpgradeRequiredScreen />;
  return <>{children}</>;
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    rowGap: 16,
  },
});
