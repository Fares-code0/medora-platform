import { useQuery } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';

import { createKeyFactory } from '@/api/query-keys';
import { Card, Divider, EmptyState, ListItem, Section, Text } from '@/components';
import { SkeletonCard } from '@/components/feedback/Skeleton';
import type { IconName } from '@/components/Icon';
import { useT, type MessageKey, useDateFormat } from '@/i18n';
import { useTheme } from '@/theme';

import type { ActivityKind } from '../model/types';
import { activityService } from '../service';

export const activityKeys = createKeyFactory('activity');

/**
 * Recent activity on Home — checklist F-06.
 *
 * ── The sentence is written here, not on the server ──────────────────
 *
 * The server sends a `kind`; this component looks the words up in the
 * catalogue. `model/types.ts` carries the reasoning, and the practical
 * consequence is in the table below: there is no code path by which a
 * value, a name or a note reaches the app's front screen, because there
 * is no string from the server on it.
 *
 * ── Three outcomes, three different renderings ───────────────────────
 *
 * | Outcome | What renders | Why |
 * |---|---|---|
 * | Events | The list | — |
 * | **Empty** | An empty state | The row asks for it, and "nothing has happened yet" is a real answer to a new account |
 * | **Failed** | Nothing at all | Home's job is the emergency card, the next appointment and the four actions. A section that could not load must not put an error on top of them |
 *
 * The difference between the last two is the whole design. Empty is an
 * answer; failed is an absence, and on a front screen an absence is
 * quieter than a wrong answer. In production today every load fails the
 * same way — `unavailableService` refuses by name (BE-10) — so this
 * section simply is not there, which is the truth about the feature.
 *
 * `AsyncBoundary` is deliberately not used: it renders an `ErrorState`,
 * which is exactly what must not happen here. Its four states are the
 * right default everywhere the section IS the screen's purpose.
 */
const ACTIVITY_ICON: Record<ActivityKind, IconName> = {
  'appointment-booked': 'calendar',
  'appointment-confirmed': 'checkCircle',
  'appointment-cancelled': 'x',
  'appointment-rescheduled': 'clock',
  'record-updated': 'fileText',
  'result-available': 'lab',
  'prescription-updated': 'pill',
  'message-received': 'message',
};

const ACTIVITY_LABEL: Record<ActivityKind, MessageKey> = {
  'appointment-booked': 'home.activity.appointment-booked',
  'appointment-confirmed': 'home.activity.appointment-confirmed',
  'appointment-cancelled': 'home.activity.appointment-cancelled',
  'appointment-rescheduled': 'home.activity.appointment-rescheduled',
  'record-updated': 'home.activity.record-updated',
  'result-available': 'home.activity.result-available',
  'prescription-updated': 'home.activity.prescription-updated',
  'message-received': 'home.activity.message-received',
};

export interface RecentActivityProps {
  /** Opens an appointment. Only events that carry an id are pressable. */
  readonly onOpenAppointment: (appointmentId: string) => void;
}

export function RecentActivity({ onOpenAppointment }: RecentActivityProps) {
  const theme = useTheme();
  const { formatRelative } = useDateFormat();
  const t = useT();

  const activity = useQuery({
    queryKey: activityKeys.lists(),
    queryFn: () => activityService.listRecentActivity(),
  });

  // See the table above: a failure is an absence here, not a message.
  if (activity.isError) return null;

  return (
    <Section title={t('home.activity.title')}>
      {activity.isPending ? (
        <SkeletonCard testID="home-activity-loading" />
      ) : activity.data.length === 0 ? (
        <EmptyState
          testID="home-activity-empty"
          icon="activity"
          title={t('home.activity.empty.title')}
          body={t('home.activity.empty.body')}
        />
      ) : (
        <Card padded={false} testID="home-activity">
          <View style={{ paddingHorizontal: theme.space[4] }}>
            {activity.data.map((event, index) => (
              <View key={event.id}>
                {index === 0 ? null : <Divider />}
                <ListItem
                  testID={`home-activity-${event.id}`}
                  title={t(ACTIVITY_LABEL[event.kind])}
                  subtitle={formatRelative(event.occurredAt)}
                  icon={ACTIVITY_ICON[event.kind]}
                  // An event with nowhere to go is read-only rather than
                  // a row that highlights and does nothing. Only
                  // appointments are linkable — `model/types.ts` says why.
                  {...(event.appointmentId === null
                    ? { readOnly: true }
                    : {
                        accessibilityHint: t('home.activity.hint'),
                        onPress: () => onOpenAppointment(event.appointmentId as string),
                      })}
                />
              </View>
            ))}
          </View>
        </Card>
      )}

      <Text variant="caption" color="textTertiary" style={styles.note}>
        {t('home.activity.note')}
      </Text>
    </Section>
  );
}

const styles = StyleSheet.create({ note: { paddingHorizontal: 4 } });
