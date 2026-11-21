import { useCallback, useState } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import { optimisticUpdate } from '@/api/optimistic';
import {
  AsyncBoundary,
  Card,
  Divider,
  Input,
  ListItem,
  Screen,
  Section,
  Text,
  useToast,
} from '@/components';
import { Checkbox } from '@/components/form/Checkbox';
import { useT, type MessageKey, type TranslateFn } from '@/i18n';
import { useTheme } from '@/theme';
import type { NotificationCategory } from '@/types/vocabularies';

import { notificationKeys } from '../keys';
import type { NotificationChannel, NotificationPreferences } from '../model/types';
import {
  isCategoryLocked,
  isChannelAvailable,
  PATIENT_CATEGORIES,
  PATIENT_CHANNELS,
  quietHoursIssue,
  setCategory,
  setChannel,
  setQuietHours,
} from '../preferences';
import { notificationService } from '../service';

/**
 * Notification settings — checklist O-06.
 *
 * ── The row is the server's ──────────────────────────────────────────
 *
 * `GET`/`PUT /me/notification-preferences` (M19.4) holds it; every edit
 * is a whole-row `PUT`, applied optimistically and rolled back with a
 * toast when the server refuses. A read that fails renders the error
 * state, never defaults — settings that are not the patient's are worse
 * than none. `preferences.ts` carries the rules; this file is the
 * rendering of them.
 *
 * ── Two controls that are deliberately not controls ──────────────────
 *
 * **Security alerts** render as a read-only row saying *Always on*, not
 * as a switch that snaps back. The server answers 422 and the column
 * carries a CHECK, so a switch would be an offer this app cannot honour
 * — and the patient deserves the reason rather than the bounce.
 *
 * **Push** renders the same way, for the opposite reason: the setting is
 * legal and the delivery does not exist (BE-12). A patient who turns
 * push on and then hears nothing for a week has been told something
 * untrue by a control that worked perfectly.
 *
 * ── Why the writes are optimistic ────────────────────────────────────
 *
 * `optimistic.ts` allows optimism only where this client already knows
 * the server's answer, and forbids it on anything a clinician owns. A
 * preference is the patient's own choice about their own account, which
 * is the same category as a notification's read state — the one example
 * that module names as legitimate. The single rule the server could
 * refuse on is the locked category, and this screen never offers it.
 *
 * A failure rolls the switch back **and says so**: a switch that
 * silently returns to its old position is a patient who believes they
 * have turned off a text message they will keep receiving.
 */

const CHANNEL_LABEL: Record<NotificationChannel, MessageKey> = {
  push: 'notificationPrefs.channel.push',
  inApp: 'notificationPrefs.channel.inApp',
  email: 'notificationPrefs.channel.email',
  sms: 'notificationPrefs.channel.sms',
  // Never rendered — see `preferences.ts`. Present so the record is
  // total and adding a channel is a compile error here rather than a
  // blank row on the screen.
  desktop: 'notificationPrefs.channel.inApp',
};

const CHANNEL_BODY: Record<NotificationChannel, MessageKey> = {
  push: 'notificationPrefs.channel.push.body',
  inApp: 'notificationPrefs.channel.inApp.body',
  email: 'notificationPrefs.channel.email.body',
  sms: 'notificationPrefs.channel.sms.body',
  desktop: 'notificationPrefs.channel.inApp.body',
};

/**
 * Category copy, keyed by the backend's own literal — `medical-records`,
 * not `medicalRecords`. The vocabulary is law (`vocabularies.ts`), and a
 * prettier local spelling here is a mapping table nobody asked for.
 */
const CATEGORY_LABEL: Record<NotificationCategory, MessageKey> = {
  appointments: 'notificationPrefs.category.appointments',
  'medical-records': 'notificationPrefs.category.medical-records',
  laboratory: 'notificationPrefs.category.laboratory',
  pharmacy: 'notificationPrefs.category.pharmacy',
  system: 'notificationPrefs.category.system',
  security: 'notificationPrefs.category.security',
  // Not rendered: a clinician's roster feed, and a feature AD-4 has not
  // approved. Both are preserved through every write.
  patients: 'notificationPrefs.category.system',
  ai: 'notificationPrefs.category.system',
};

const CATEGORY_BODY: Record<NotificationCategory, MessageKey> = {
  appointments: 'notificationPrefs.category.appointments.body',
  'medical-records': 'notificationPrefs.category.medical-records.body',
  laboratory: 'notificationPrefs.category.laboratory.body',
  pharmacy: 'notificationPrefs.category.pharmacy.body',
  system: 'notificationPrefs.category.system.body',
  security: 'notificationPrefs.category.security.body',
  patients: 'notificationPrefs.category.system.body',
  ai: 'notificationPrefs.category.system.body',
};

/**
 * One switch, with its explanation underneath.
 *
 * The description is outside `Checkbox`'s label rather than appended to
 * it: a screen reader reads the label on focus and the body when the
 * user asks for it, and a two-sentence accessibility label is a
 * two-sentence announcement on every pass through the list.
 */
function ToggleRow({
  label,
  body,
  checked,
  onChange,
  testID,
}: {
  readonly label: string;
  readonly body: string;
  readonly checked: boolean;
  readonly onChange: (next: boolean) => void;
  readonly testID: string;
}) {
  const theme = useTheme();
  return (
    <View style={{ rowGap: theme.space[1] }}>
      <Checkbox label={label} checked={checked} onChange={onChange} testID={testID} />
      <Text variant="caption" color="textTertiary">
        {body}
      </Text>
    </View>
  );
}

/** A row that states a fact instead of offering a choice. See the docblock. */
function FixedRow({
  label,
  body,
  value,
  testID,
}: {
  readonly label: string;
  readonly body: string;
  readonly value: string;
  readonly testID: string;
}) {
  const theme = useTheme();
  return (
    <View style={{ rowGap: theme.space[1] }}>
      <ListItem title={label} value={value} readOnly testID={testID} />
      <Text variant="caption" color="textTertiary">
        {body}
      </Text>
    </View>
  );
}

/**
 * The quiet window.
 *
 * Two plain text fields rather than a native time picker: a picker is a
 * permissionless native module this tree does not have, and `HH:MM` on a
 * numeric keypad is two taps for a patient who knows what they want.
 * Validation is inline and immediate — the field says what a valid time
 * looks like *before* it is wrong, through `hint`, and what is wrong
 * after.
 *
 * The draft lives here and commits on a valid pair. A `22:0` halfway
 * through typing `22:05` is not an edit worth sending, and a screen that
 * wrote it would show the patient an error they were already fixing.
 */
function QuietHoursFields({
  preferences,
  onCommit,
  t,
}: {
  readonly preferences: NotificationPreferences;
  readonly onCommit: (next: NotificationPreferences) => void;
  readonly t: TranslateFn;
}) {
  const theme = useTheme();
  const [draft, setDraft] = useState({
    from: preferences.quietHours.from,
    to: preferences.quietHours.to,
  });

  const issue = quietHoursIssue(draft.from, draft.to);

  const edit = useCallback(
    (field: 'from' | 'to', value: string) => {
      const next = { ...draft, [field]: value };
      setDraft(next);
      if (quietHoursIssue(next.from, next.to) === null) {
        onCommit(setQuietHours(preferences, next));
      }
    },
    [draft, onCommit, preferences],
  );

  return (
    <View style={{ rowGap: theme.space[3] }}>
      <View style={[styles.row, { columnGap: theme.space[3] }]}>
        <View style={styles.grow}>
          <Input
            label={t('notificationPrefs.quietHours.from')}
            value={draft.from}
            onChangeText={(value) => edit('from', value)}
            keyboardType="numbers-and-punctuation"
            hint={t('notificationPrefs.quietHours.hint')}
            testID="quiet-hours-from"
          />
        </View>
        <View style={styles.grow}>
          <Input
            label={t('notificationPrefs.quietHours.to')}
            value={draft.to}
            onChangeText={(value) => edit('to', value)}
            keyboardType="numbers-and-punctuation"
            hint={t('notificationPrefs.quietHours.hint')}
            testID="quiet-hours-to"
          />
        </View>
      </View>

      {issue === null ? (
        <Text variant="caption" color="textTertiary" testID="quiet-hours-window">
          {t('notificationPrefs.quietHours.window', { from: draft.from, to: draft.to })}
        </Text>
      ) : (
        <Text
          variant="caption"
          color="error"
          accessibilityLiveRegion="polite"
          testID="quiet-hours-error"
        >
          {t(issue)}
        </Text>
      )}
    </View>
  );
}

export function NotificationPrefsScreen() {
  const theme = useTheme();
  const t = useT();
  const queryClient = useQueryClient();
  const toast = useToast();

  const preferences = useQuery({
    queryKey: notificationKeys.preferences(),
    queryFn: () => notificationService.getPreferences(),
  });

  const save = useMutation({
    mutationFn: (next: NotificationPreferences) => notificationService.updatePreferences(next),
    ...optimisticUpdate<NotificationPreferences, NotificationPreferences>({
      queryClient,
      queryKey: notificationKeys.preferences(),
      // The variables ARE the next state: every edit is built from the
      // current preferences by a pure function in `preferences.ts`, so
      // there is nothing left to merge here.
      apply: (_current, next) => next,
      onRollback: () => toast.show(t('notificationPrefs.saveFailed'), 'error'),
    }),
  });

  const commit = useCallback((next: NotificationPreferences) => save.mutate(next), [save]);

  return (
    <Screen testID="notification-prefs-screen">
      <Text variant="h1" {...headingA11y(t('notificationPrefs.title'))}>
        {t('notificationPrefs.title')}
      </Text>
      <Text variant="bodySm" color="textSecondary">
        {t('notificationPrefs.intro')}
      </Text>

      <AsyncBoundary testID="notification-prefs" query={preferences}>
        {(data) => (
          <View style={{ rowGap: theme.space[5] }}>
            <Section title={t('notificationPrefs.section.channels')}>
              <Card>
                <View style={{ rowGap: theme.space[3] }}>
                  {PATIENT_CHANNELS.map((channel, index) => (
                    <View key={channel} style={{ rowGap: theme.space[3] }}>
                      {index === 0 ? null : <Divider />}
                      {isChannelAvailable(channel) ? (
                        <ToggleRow
                          label={t(CHANNEL_LABEL[channel])}
                          body={t(CHANNEL_BODY[channel])}
                          checked={data.channels[channel]}
                          onChange={(next) => commit(setChannel(data, channel, next))}
                          testID={`channel-${channel}`}
                        />
                      ) : (
                        <FixedRow
                          label={t(CHANNEL_LABEL[channel])}
                          body={t('notificationPrefs.channel.push.unavailable')}
                          value={t('notificationPrefs.channel.unavailable')}
                          testID={`channel-${channel}`}
                        />
                      )}
                    </View>
                  ))}
                </View>
              </Card>
            </Section>

            <Section title={t('notificationPrefs.section.categories')}>
              <Card>
                <View style={{ rowGap: theme.space[3] }}>
                  {PATIENT_CATEGORIES.map((category, index) => (
                    <View key={category} style={{ rowGap: theme.space[3] }}>
                      {index === 0 ? null : <Divider />}
                      {isCategoryLocked(category) ? (
                        <FixedRow
                          label={t(CATEGORY_LABEL[category])}
                          body={t(CATEGORY_BODY[category])}
                          value={t('notificationPrefs.category.alwaysOn')}
                          testID={`category-${category}`}
                        />
                      ) : (
                        <ToggleRow
                          label={t(CATEGORY_LABEL[category])}
                          body={t(CATEGORY_BODY[category])}
                          checked={data.categories[category]}
                          onChange={(next) => commit(setCategory(data, category, next))}
                          testID={`category-${category}`}
                        />
                      )}
                    </View>
                  ))}
                </View>
              </Card>
            </Section>

            <Section title={t('notificationPrefs.section.quietHours')}>
              <Card>
                <View style={{ rowGap: theme.space[3] }}>
                  <Checkbox
                    label={t('notificationPrefs.quietHours.toggle')}
                    checked={data.quietHours.enabled}
                    onChange={(next) => commit(setQuietHours(data, { enabled: next }))}
                    testID="quiet-hours-toggle"
                  />

                  {data.quietHours.enabled ? (
                    <QuietHoursFields preferences={data} onCommit={commit} t={t} />
                  ) : null}
                </View>
              </Card>

              {/*
                Outside the card and always visible, enabled or not. It is
                the one sentence on this screen that is a safety claim
                rather than a setting, and a patient deciding whether to
                silence their phone overnight needs it before they decide,
                not after.
              */}
              <Card tone="sunken" testID="quiet-hours-urgent-note">
                <Text variant="bodySm" color="textSecondary">
                  {t('notificationPrefs.quietHours.urgent')}
                </Text>
              </Card>
            </Section>
          </View>
        )}
      </AsyncBoundary>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  row: { alignItems: 'flex-start', flexDirection: 'row' },
});
