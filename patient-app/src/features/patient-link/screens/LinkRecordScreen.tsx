import { useEffect, useState } from 'react';

import { StyleSheet, View } from 'react-native';

import { announce, headingA11y } from '@/accessibility/a11y';
import { AsyncBoundary, Button, Card, Icon, Screen, Section, Text } from '@/components';
import { SkeletonCard } from '@/components/feedback/Skeleton';
import { useLocale, useT } from '@/i18n';
import { formatMinutes } from '@/i18n/duration';
import { useTheme } from '@/theme';
import { isApiError } from '@/types/api';

import { formatCountdown, groupCode, secondsUntil, spokenCode } from '../code';
import { isAlreadyLinked, useIssueLinkCode, usePatientLink } from '../hooks';
import type { PatientLinkCode } from '../model/types';

/**
 * Linking the account to a hospital record (ADR-048, staff-mediated).
 *
 * The patient's whole part is here: go to the desk with an identity
 * document, and show a code. Staff check the document and link the
 * account on their side; nothing on this screen links anything.
 *
 * - **Linked** — says so, with the record's name. No code is offered.
 * - **Unlinked** — the three steps, and a button that asks the server for
 *   a code. The code is large, grouped 4-4, selectable, and spelled out
 *   to a screen reader; generating one is announced. A countdown runs to
 *   the server's `expiresAt`; past it the code is shown as expired and the
 *   button offers a new one (which voids the old one, server-side).
 * - **`409 already_linked`** — staff linked the account meanwhile: the
 *   state is read again (`useIssueLinkCode`) and the screen becomes the
 *   linked state, never an error.
 *
 * The code lives in component state only. It is never cached, stored or
 * logged: it goes with the screen.
 */
export function LinkRecordScreen() {
  const t = useT();
  const theme = useTheme();
  const link = usePatientLink();

  return (
    <Screen testID="link-record-screen">
      <AsyncBoundary query={link} testID="link-record-state" loading={<SkeletonCard />}>
        {(state) =>
          state.linked && state.patient !== null ? (
            <Card tone="success" testID="link-record-linked">
              <View style={[styles.row, { columnGap: theme.space[3] }]}>
                <Icon name="checkCircle" size={24} color="success" />
                <View style={[styles.grow, { rowGap: theme.space[1] }]}>
                  <Text variant="h3" {...headingA11y(t('link.linked.title'))}>
                    {t('link.linked.title')}
                  </Text>
                  <Text variant="body" color="textSecondary">
                    {t('link.linked.body', { name: state.patient.fullName })}
                  </Text>
                </View>
              </View>
            </Card>
          ) : (
            <UnlinkedContent />
          )
        }
      </AsyncBoundary>
    </Screen>
  );
}

function UnlinkedContent() {
  const t = useT();
  const theme = useTheme();
  const { locale } = useLocale();
  const issue = useIssueLinkCode();
  const [code, setCode] = useState<PatientLinkCode | null>(null);

  const request = () => {
    issue.mutate(undefined, {
      onSuccess: (issued) => {
        setCode(issued);
        const remainingMs = Math.max(0, Date.parse(issued.expiresAt) - Date.now());
        announce(
          t('link.code.announce', {
            code: spokenCode(issued.code),
            duration: formatMinutes(locale, remainingMs),
          }),
        );
      },
    });
  };

  // `already_linked` is not an error to show: the state is being re-read
  // and this content is about to be replaced by the linked card.
  const failure =
    issue.error === null || isAlreadyLinked(issue.error)
      ? null
      : isApiError(issue.error) && issue.error.kind === 'rate_limited'
        ? t('link.code.rateLimited')
        : t('link.code.error');

  return (
    <View style={{ rowGap: theme.space[4] }}>
      <View style={{ rowGap: theme.space[2] }}>
        <Text variant="h1" {...headingA11y(t('link.title'))}>
          {t('link.title')}
        </Text>
        <Text variant="body" color="textSecondary">
          {t('link.intro')}
        </Text>
      </View>

      <Section title={t('link.steps.heading')}>
        <View style={{ rowGap: theme.space[2] }} testID="link-record-steps">
          {(['link.step.1', 'link.step.2', 'link.step.3'] as const).map((key, index) => (
            <View key={key} style={[styles.row, { columnGap: theme.space[2] }]}>
              <Text variant="bodyStrong" accessibilityElementsHidden importantForAccessibility="no">
                {`${index + 1}.`}
              </Text>
              <Text variant="body" style={styles.grow}>
                {t(key)}
              </Text>
            </View>
          ))}
        </View>
      </Section>

      <Section title={t('link.code.heading')}>
        <View style={{ rowGap: theme.space[3] }}>
          {code === null ? null : <IssuedCode code={code} />}
          {failure === null ? null : (
            <Text
              variant="bodySm"
              color="error"
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              testID="link-code-error"
            >
              {failure}
            </Text>
          )}
          <Button
            label={code === null ? t('link.code.generate') : t('link.code.regenerate')}
            {...(code === null ? {} : { hint: t('link.code.regenerate.hint') })}
            tone={code === null ? 'primary' : 'secondary'}
            size="lg"
            fullWidth
            loading={issue.isPending}
            disabled={issue.isPending}
            testID="link-code-generate"
            onPress={request}
          />
        </View>
      </Section>
    </View>
  );
}

function IssuedCode({ code }: { readonly code: PatientLinkCode }) {
  const t = useT();
  const theme = useTheme();
  const [now, setNow] = useState(() => Date.now());
  const remaining = secondsUntil(code.expiresAt, now);
  const expired = remaining === 0;

  useEffect(() => {
    if (expired) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expired]);

  // Said once, when it happens; the countdown itself is not narrated
  // second by second.
  const expiredMessage = t('link.code.expired');
  useEffect(() => {
    if (expired) announce(expiredMessage);
  }, [expired, expiredMessage]);

  return (
    <Card tone={expired ? 'sunken' : 'primary'} testID="link-code-card">
      <View style={{ alignItems: 'center', rowGap: theme.space[2] }}>
        <Text
          variant="display"
          align="center"
          selectable
          color={expired ? 'textTertiary' : 'textPrimary'}
          accessibilityLabel={t('link.code.label', { code: spokenCode(code.code) })}
          testID="link-code-value"
          style={[styles.code, expired ? styles.expired : {}]}
        >
          {groupCode(code.code)}
        </Text>
        {expired ? (
          <Text variant="bodySm" color="error" align="center" testID="link-code-expired">
            {expiredMessage}
          </Text>
        ) : (
          <>
            <Text
              variant="bodySm"
              color="textSecondary"
              align="center"
              testID="link-code-countdown"
            >
              {t('link.code.expiresIn', { time: formatCountdown(remaining) })}
            </Text>
            <Text variant="bodySm" color="textSecondary" align="center">
              {t('link.code.showStaff')}
            </Text>
          </>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  // Latin glyphs in a fixed order whatever the layout direction: a code
  // read right-to-left is a different code.
  code: { letterSpacing: 4, writingDirection: 'ltr' },
  expired: { textDecorationLine: 'line-through' },
  grow: { flex: 1 },
  row: { alignItems: 'flex-start', flexDirection: 'row' },
});
