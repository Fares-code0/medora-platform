import { useEffect, useState } from 'react';

import { StyleSheet, View } from 'react-native';

import { apiClient } from '@/api/client';
import { Icon, Text } from '@/components';
import { useLocale, useT, type MessageKey, type MessageParams } from '@/i18n';
import { useTheme } from '@/theme';
import { formatLongDate } from '@/utils/datetime';

import {
  decideDeprecation,
  DEPRECATION_HEADER,
  SUNSET_HEADER,
  type DeprecationNotice,
} from './deprecation';

/**
 * The deprecation banner — checklist W-07.
 *
 * A banner and not a gate. W-06 blocks a build the operator has
 * withdrawn; this one only says that the surface this build calls is on
 * its way out, which is a thing to act on rather than a thing to stop
 * for. Locking a patient out of their appointments over a scheduled
 * retirement would be the wrong trade in both directions.
 *
 * It renders beside `OfflineBanner`, above the tabs, for the same reason
 * that one does: it is a standing condition of the whole app rather than
 * of a screen, and a patient needs to be able to keep reading underneath
 * it.
 *
 * ── Not dismissible, deliberately ────────────────────────────────────
 * This paragraph used to rest on the preference store being in memory,
 * so a remembered dismissal would come back on the next cold start — a
 * control that lies. E-02 made the store durable and that argument is
 * gone, so here is the one that was underneath it: a deprecation is a
 * standing fact about this build, not a message. Dismissing it would
 * hide something that is still true, and the patient would next hear
 * about it when the route stopped answering. The banner is one line, it
 * appears only once a server has actually declared the deprecation, and
 * it goes away when the patient updates.
 */

/** Exported for the test: the banner is otherwise a closed box. */
export function useDeprecationNotice(): DeprecationNotice | null {
  const [notice, setNotice] = useState<DeprecationNotice | null>(null);

  useEffect(() => {
    return apiClient.addResponseObserver((headers) => {
      const decision = decideDeprecation(
        headers.get(DEPRECATION_HEADER),
        headers.get(SUNSET_HEADER),
      );
      // A response without the header does not retract one that had it:
      // a call that fell back to a cache, or hit an instance behind a
      // rollout, must not un-say what the server said.
      if (decision !== null) setNotice(decision);
    });
  }, []);

  return notice;
}

/**
 * Exported for the test — the copy is the part worth asserting.
 *
 * Returns a key and its parameters rather than a sentence, so the test
 * can ask "which of the two messages is this?" without a provider, and
 * so both messages exist in every language (C-09).
 *
 * It takes the locale for the same reason: the date inside `params` is
 * the one thing here that is formatted rather than looked up, and
 * `Intl` would otherwise resolve the DEVICE's language for a sentence
 * the rest of which is in the patient's.
 */
export function deprecationMessage(
  notice: DeprecationNotice,
  locale: string,
): {
  key: MessageKey;
  params?: MessageParams;
} {
  if (notice.sunsetAt === null) {
    return { key: 'deprecation.available' };
  }
  // The long form, because it carries the year: a sunset can be months
  // away, and "Sat, Dec 31" does not say which December.
  return {
    key: 'deprecation.sunset',
    params: { date: formatLongDate(notice.sunsetAt.toISOString(), locale) },
  };
}

export function DeprecationBanner() {
  const theme = useTheme();
  const t = useT();
  const { locale } = useLocale();
  const notice = useDeprecationNotice();

  if (notice === null) return null;
  const message = deprecationMessage(notice, locale);

  return (
    <View
      testID="deprecation-banner"
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={[
        styles.banner,
        {
          backgroundColor: theme.colors.infoSubtle,
          borderBottomColor: theme.colors.info,
          paddingHorizontal: theme.screenGutter,
          paddingVertical: theme.space[2],
          columnGap: theme.space[2],
        },
      ]}
    >
      <Icon name="info" size={16} color="info" />
      <Text variant="caption" color="info" style={styles.grow}>
        {t(message.key, message.params)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row' },
  grow: { flex: 1 },
});
