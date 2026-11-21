import { useState } from 'react';

import { View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import { Button, Card, Screen, Section, Text } from '@/components';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';

import {
  consentDocuments,
  CONSENT_VERSION,
  openConsentDocument,
  type ConsentDocument,
  type ConsentDocumentId,
} from '../consent';

/**
 * What you are agreeing to — checklist E-05.
 *
 * ── Why a screen and not a link on the checkbox ──────────────────────
 *
 * Registration already collects both consents and sends them (the two
 * checkboxes are `literal(true)` and `POST /auth/register` is live). What
 * a patient could not do was **read** what they were ticking, and a
 * consent nobody can read is a consent in name only. This screen is that
 * reading, and it is reachable from the register form before the box is
 * ticked as well as from Profile afterwards — the second matters more
 * than it looks: people agree in a hurry and want to check later.
 *
 * ── It hosts nothing and invents nothing ─────────────────────────────
 *
 * The documents are URLs the operator publishes (`consent.ts` says why a
 * developer must not write them into the bundle). Unset, this screen
 * says the documents are not published yet and points at the clinic,
 * rather than opening a browser on a page that does not exist.
 *
 * The version is shown because a patient who reads a policy should be
 * able to tell which one they read. It is not sent anywhere — the
 * register payload has no field for it (BE-01), and `consent.ts` carries
 * the argument against inventing one.
 */
const TITLE_KEY: Record<ConsentDocumentId, 'consent.terms.title' | 'consent.privacy.title'> = {
  terms: 'consent.terms.title',
  privacy: 'consent.privacy.title',
};

const BODY_KEY: Record<ConsentDocumentId, 'consent.terms.body' | 'consent.privacy.body'> = {
  terms: 'consent.terms.body',
  privacy: 'consent.privacy.body',
};

/**
 * `documents` is a test seam, the way `BiometricUnlockSetting` takes its
 * `gate`. Production reads the operator's configuration; a test hands in
 * a published pair without re-importing the module graph to get at
 * `env`, which is read once at load.
 */
export interface ConsentScreenProps {
  readonly documents?: readonly ConsentDocument[];
}

export function ConsentScreen({ documents = consentDocuments() }: ConsentScreenProps) {
  const theme = useTheme();
  const t = useT();
  const [failed, setFailed] = useState(false);

  return (
    <Screen testID="consent-screen">
      <Text variant="h1" {...headingA11y(t('consent.title'))}>
        {t('consent.title')}
      </Text>
      <Text variant="bodySm" color="textSecondary">
        {t('consent.intro')}
      </Text>

      <View style={{ rowGap: theme.space[4] }}>
        {documents.map((document) => (
          <Section key={document.id} title={t(TITLE_KEY[document.id])}>
            <Card testID={`consent-${document.id}`}>
              <Text variant="bodySm" color="textSecondary">
                {t(BODY_KEY[document.id])}
              </Text>

              {document.url === null ? (
                /*
                  Unpublished is a state, not an error: a deployment whose
                  operator has not put the documents online yet is
                  ordinary, and a dead button would be worse than a
                  sentence.
                */
                <Text
                  variant="caption"
                  color="textTertiary"
                  testID={`consent-${document.id}-unpublished`}
                >
                  {t('consent.unpublished')}
                </Text>
              ) : (
                <Button
                  label={t('consent.read')}
                  tone="secondary"
                  fullWidth
                  icon="fileText"
                  testID={`consent-${document.id}-open`}
                  onPress={() => {
                    setFailed(false);
                    void openConsentDocument(document.url as string).then((opened) => {
                      if (!opened) setFailed(true);
                    });
                  }}
                />
              )}
            </Card>
          </Section>
        ))}
      </View>

      {failed ? (
        <Card tone="warning" testID="consent-open-failed">
          <Text variant="bodySm" color="warning" accessibilityLiveRegion="polite">
            {t('consent.openFailed')}
          </Text>
        </Card>
      ) : null}

      <Card tone="sunken">
        <Text variant="caption" color="textTertiary">
          {t('consent.version', { version: CONSENT_VERSION })}
        </Text>
      </Card>
    </Screen>
  );
}
