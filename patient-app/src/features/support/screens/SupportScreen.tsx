import { Linking, Platform, View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import { Button, Card, Screen, Text } from '@/components';
import { env } from '@/configs/env';
import { CURRENT_APP_VERSION } from '@/features/app-version/version';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';
import { logger } from '@/utils/logger';

/**
 * Support and feedback — checklist W-11.
 *
 * ── This is not a clinical channel, and says so first ────────────────
 * The most important thing on this screen is the sentence telling a
 * patient NOT to describe how they are feeling here. A support inbox is read by
 * whoever staffs it, on whatever schedule they staff it — it is not
 * triaged, not clinically supervised, and not covered by the record.
 * A patient who mistakes it for a way to reach a clinician is a patient
 * waiting for an answer that is not coming, which is why the emergency
 * line comes before the contact button rather than after it.
 *
 * Messages (Phase M) is the clinical channel. Emergency (Phase N) is the
 * urgent one. This is for the app.
 *
 * ── Why `mailto:` and not a form ─────────────────────────────────────
 * A form needs an endpoint, and there is none — inventing one is
 * forbidden (§4 of `ARCHITECTURE.md`). `mailto:` reaches a real channel
 * with no route at all: the patient's own mail app opens with the
 * message ready, they see exactly what is being sent, and the reply
 * lands somewhere they already read. It also degrades honestly — an
 * address the operator has not configured means no button rather than a
 * button that fails silently.
 *
 * ── What the message carries, and what it must never ─────────────────
 * The prefilled body has the app version and the platform, because a
 * support request without them costs a round trip. It carries **no PHI,
 * no account identifier and no token** — the patient's own address comes
 * from their mail app, which is their choice to send, and nothing this
 * screen writes identifies a patient or their care (T-04).
 */

/** Exported for the test: the body is the part that must stay boring. */
export function supportMessageBody(): string {
  return [
    '',
    '',
    '--- Please keep the lines below, they help us answer you ---',
    `App version: ${CURRENT_APP_VERSION}`,
    `Platform: ${Platform.OS} ${String(Platform.Version)}`,
    'Please do not include medical details in this message.',
  ].join('\n');
}

/** Exported for the test. `mailto:` with the subject and body escaped. */
export function supportMailtoUrl(address: string): string {
  const subject = encodeURIComponent('Medora app support');
  const body = encodeURIComponent(supportMessageBody());
  return `mailto:${address}?subject=${subject}&body=${body}`;
}

/**
 * `address` follows `ConsentScreen`'s pattern, and for the same reason.
 *
 * Production reads the operator's configuration; a test hands one in.
 * `env` is parsed once at module load, so without this the branch a test
 * exercises is whichever one the *build* happens to be in — and the
 * test that lived here did exactly that: it read the button, and if the
 * button was absent it asserted the no-address card and returned. One
 * of W-11's two states was covered per run, and which one was not up to
 * the test.
 */
export interface SupportScreenProps {
  /** `null` is "the operator configured none", which is a real state. */
  readonly address?: string | null;
}

export function SupportScreen({ address = env.supportEmail }: SupportScreenProps = {}) {
  const theme = useTheme();
  const t = useT();

  const contact = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      // No mail app configured on the device. The address is already on
      // screen, so the patient can still use it.
      logger.warn('No mail app answered the support link');
    }
  };

  return (
    <Screen testID="support-screen">
      <Text variant="h1" {...headingA11y(t('support.title'))}>
        {t('support.title')}
      </Text>

      {/* First, above everything, because getting this wrong costs more
          than every other thing on this screen put together.

          It tells a patient what to do in a medical emergency, which is
          inside the W-10 review. It was the one card here with no
          catalogue key until the owner approved translating emergency
          copy (2026-11-23); the Arabic is an engineering draft awaiting
          the named clinical reviewer (`docs/SIGNOFF.md`). */}
      <Card tone="sunken" testID="support-urgent-notice">
        <Text variant="bodyStrong">{t('support.urgent.title')}</Text>
        <Text variant="bodySm" color="textSecondary">
          {t('support.urgent.body')}
        </Text>
      </Card>

      <View style={{ rowGap: theme.space[2] }}>
        <Text variant="h2" {...headingA11y(t('support.care.title'))}>
          {t('support.care.title')}
        </Text>
        <Text variant="body" color="textSecondary">
          {t('support.care.body')}
        </Text>
      </View>

      <View style={{ rowGap: theme.space[2] }}>
        <Text variant="h2" {...headingA11y(t('support.app.title'))}>
          {t('support.app.title')}
        </Text>
        {address === null ? (
          <Card tone="sunken" testID="support-no-address">
            <Text variant="bodySm" color="textSecondary">
              {t('support.app.noAddress')}
            </Text>
          </Card>
        ) : (
          <>
            <Text variant="body" color="textSecondary">
              {t('support.app.body', { address })}
            </Text>
            <Button
              label={t('support.app.contact')}
              size="lg"
              fullWidth
              testID="support-contact"
              onPress={() => void contact(supportMailtoUrl(address))}
            />
          </>
        )}
      </View>

      <Card tone="sunken">
        <Text variant="label" color="textTertiary">
          {t('support.build.title')}
        </Text>
        <Text variant="bodySm" color="textSecondary" testID="support-app-version">
          Medora {CURRENT_APP_VERSION} · {Platform.OS}
        </Text>
      </Card>
    </Screen>
  );
}
