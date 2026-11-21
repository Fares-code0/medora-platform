import { StyleSheet, View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import { Card, Chip, Screen, Section, Text } from '@/components';
import { LOCALES, useLocale, useT, type MessageKey } from '@/i18n';
import { useTheme, useThemeContext, type ThemeMode } from '@/theme';

/**
 * Appearance.
 *
 * Three modes, and **System is the default** — a distinct stored value,
 * not "whichever palette we saw first". An app that stops following the
 * OS the moment someone opens Preferences is an app that ignores a
 * setting the patient already made once.
 *
 * The preference is stored in the non-sensitive `PreferenceStore` (never
 * PHI, never a token) and applied immediately.
 *
 * ── Language, and the one thing it cannot do immediately ─────────────
 * The locale switcher is here rather than on its own screen: it is the
 * same kind of setting as the palette, and a patient looking for one
 * looks where they found the other.
 *
 * Changing it takes effect at once for *text* and cannot for *layout*.
 * `I18nManager.forceRTL` is read by the native view hierarchy at
 * startup, which is a React Native constraint rather than a shortcoming
 * of `LocaleProvider` — so choosing Arabic re-renders every string and
 * leaves the screen laid out left to right until the app is reopened.
 * The alternative to saying so is a patient concluding the setting did
 * not work, so `restartRequired` renders a note the moment the two
 * disagree, and stops rendering it once they agree again.
 *
 * The chip's visible label is the **endonym** — "العربية", not "Arabic" —
 * because that is what a speaker scans a language list for. The English
 * name rides along in the accessibility label, for a screen reader
 * running in English.
 */
const MODES: readonly { mode: ThemeMode; labelKey: MessageKey }[] = [
  { mode: 'system', labelKey: 'preferences.theme.system' },
  { mode: 'light', labelKey: 'preferences.theme.light' },
  { mode: 'dark', labelKey: 'preferences.theme.dark' },
];

export function PreferencesScreen() {
  const theme = useTheme();
  const t = useT();
  const { mode, setMode } = useThemeContext();
  const { locale, setLocale, restartRequired } = useLocale();

  return (
    <Screen testID="preferences-screen">
      <Text variant="h1" {...headingA11y(t('preferences.appearance.title'))}>
        {t('preferences.appearance.title')}
      </Text>

      <Section title={t('preferences.theme.title')}>
        <View style={[styles.row, { columnGap: theme.space[2] }]}>
          {MODES.map((entry) => (
            <Chip
              key={entry.mode}
              testID={`preferences-theme-${entry.mode}`}
              label={t(entry.labelKey)}
              selected={mode === entry.mode}
              onPress={() => setMode(entry.mode)}
            />
          ))}
        </View>
      </Section>

      <Section title={t('preferences.textSize.title')}>
        <Card tone="sunken">
          <Text variant="bodySm" color="textSecondary">
            {t('preferences.textSize.body')}
          </Text>
        </Card>
      </Section>

      <Section title={t('language.title')}>
        <View style={[styles.row, { columnGap: theme.space[2] }]}>
          {LOCALES.map((entry) => (
            <Chip
              key={entry.code}
              testID={`preferences-locale-${entry.code}`}
              label={entry.label}
              accessibilityLabel={entry.englishName}
              selected={locale === entry.code}
              onPress={() => setLocale(entry.code)}
            />
          ))}
        </View>

        {restartRequired ? (
          <Card tone="warning" testID="preferences-locale-restart">
            <Text variant="bodySm" color="warning">
              {t('language.restartRequired')}
            </Text>
          </Card>
        ) : null}

        {/*
          `messages/ar.ts` records that no native speaker has read those
          strings. A caveat only developers can see is not a caveat, and
          the patient who just chose Arabic is exactly the person who can
          tell us a sentence is wrong.
        */}
        {locale === 'ar' ? (
          <Card tone="sunken" testID="preferences-locale-review">
            <Text variant="bodySm" color="textSecondary">
              {t('language.reviewPending')}
            </Text>
          </Card>
        ) : null}
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap' },
});
