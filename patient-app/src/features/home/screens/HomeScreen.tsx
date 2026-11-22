import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { StyleSheet, View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import {
  AsyncBoundary,
  Avatar,
  Button,
  Card,
  Icon,
  Screen,
  Section,
  StatusBadge,
  Text,
} from '@/components';
import { SkeletonCard } from '@/components/feedback/Skeleton';
import type { IconName } from '@/components/Icon';
import { AiCapabilityCard } from '@/features/ai/components/AiCapabilityCard';
import { useAppointments } from '@/features/appointments/hooks';
import { useIdentity } from '@/features/auth/SessionProvider';
import { useUnlinkedEmptyState } from '@/features/profile/useRecordLink';
import { useT, type MessageKey, useDateFormat } from '@/i18n';
import type { RootStackParamList } from '@/navigation/routes';
import { useTheme } from '@/theme';

import { Announcements } from '../components/Announcements';
import { RecentActivity } from '../components/RecentActivity';

/**
 * Home.
 *
 * ── The Emergency card is above the fold, and it never dials ─────────
 * One tap opens the Emergency screen (checklist F-02). It does not place
 * a call, it does not long-press to call, and it is not a swipe. Every
 * dial in this app is behind the confirmation in `EmergencyCallButton`,
 * and Home — the screen a phone is most likely to be showing in a
 * pocket — is the last place to make an exception (audit R-6).
 *
 * ── Every backend-dependent section has three states ─────────────────
 * The next-appointment card is a real query with a skeleton, an empty and
 * an error state. Its status and its actions come from the server; this
 * screen computes neither.
 *
 * ── The AI entry point, and the rule it is held to ───────────────────
 * This docblock used to say there was **no** entry point at all — "not a
 * disabled one, not a 'coming soon' one" — because F-05 gates the
 * assistant on AD-4 and a patient-facing symptom bot built on the
 * doctor-side canned-response generator is the single most dangerous
 * thing this project could ship (audit R-5).
 *
 * The reasoning was right about the danger and wrong about where the
 * danger lives. It is not in the entry point; it is in what happens
 * after the tap. So there is now a card — plainly marked *not connected
 * yet*, which is what it says on its face before anybody taps it — and
 * it opens `features/ai/`, a designed interface every screen of which
 * states that no assistant is connected to this copy of Medora.
 *
 * Nothing behind it generates, requests, stores or scripts a word, and
 * `ai-honesty.test.ts` is the assertion rather than this paragraph. F-05
 * itself — an assistant a patient can actually use — remains gated on
 * AD-4 and BE-14, unchanged.
 *
 * The card sits BELOW the emergency card and below the next appointment.
 * A capability that does not work yet does not outrank the two things on
 * this screen that do.
 */
interface QuickAction {
  readonly id: string;
  readonly labelKey: MessageKey;
  readonly icon: IconName;
  readonly onPress: () => void;
}

export function HomeScreen() {
  const theme = useTheme();
  const { formatDateTime, formatRelative } = useDateFormat();
  const t = useT();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const identity = useIdentity();
  const upcoming = useAppointments('upcoming');
  // F-09: an account with no clinical record gets an explanation, not
  // "Nothing booked" — `useRecordLink.ts` carries why.
  const unlinked = useUnlinkedEmptyState();

  // Two keys rather than a name defaulting to "there": the English
  // sentence needs a word in the slot and the Arabic one does not, and a
  // greeting is the first thing a patient reads.
  const firstName = identity?.displayName.split(' ')[0];
  const greeting =
    firstName === undefined || firstName === ''
      ? t('home.greetingAnonymous')
      : t('home.greeting', { name: firstName });

  const quickActions: readonly QuickAction[] = [
    {
      id: 'book',
      labelKey: 'home.action.book',
      icon: 'calendar',
      onPress: () => navigation.navigate('Booking', {}),
    },
    {
      id: 'find',
      labelKey: 'home.action.find',
      icon: 'search',
      onPress: () =>
        navigation.navigate('Tabs', { screen: 'DiscoverTab', params: { screen: 'DiscoverRoot' } }),
    },
    {
      id: 'messages',
      labelKey: 'home.action.messages',
      icon: 'message',
      onPress: () =>
        navigation.navigate('Tabs', { screen: 'MessagesTab', params: { screen: 'MessagesRoot' } }),
    },
    {
      id: 'records',
      labelKey: 'home.action.records',
      icon: 'heart',
      onPress: () =>
        navigation.navigate('Tabs', {
          screen: 'ProfileTab',
          params: { screen: 'HealthRecords' },
        }),
    },
  ];

  return (
    <Screen
      testID="home-screen"
      onRefresh={() => void upcoming.refetch()}
      refreshing={upcoming.isRefetching}
    >
      <View>
        <Text variant="h1" {...headingA11y(greeting)}>
          {greeting}
        </Text>
        <Text variant="bodySm" color="textTertiary">
          {t('home.subtitle')}
        </Text>
      </View>

      {/* Above the fold, visually distinct, and it navigates. */}
      <Card
        tone="error"
        testID="home-emergency-card"
        onPress={() => navigation.navigate('Emergency')}
        accessibilityLabel="Emergency help"
        accessibilityHint="Opens emergency guidance. It does not place a call."
      >
        <View style={[styles.row, { columnGap: theme.space[3] }]}>
          <Icon name="alert" size={24} color="error" />
          <View style={styles.grow}>
            <Text variant="h3" color="error">
              Emergency help
            </Text>
            <Text variant="bodySm" color="textSecondary">
              What to do, and who to call. Works offline.
            </Text>
          </View>
          <Icon name="forward" size={20} color="error" />
        </View>
      </Card>

      <Section
        title={t('home.nextAppointment')}
        action={{
          label: t('home.seeAll'),
          onPress: () =>
            navigation.navigate('Tabs', {
              screen: 'AppointmentsTab',
              params: { screen: 'AppointmentsRoot' },
            }),
        }}
      >
        <AsyncBoundary
          testID="home-next-appointment"
          query={upcoming}
          loading={<SkeletonCard />}
          isEmpty={(data) => data.items.length === 0}
          empty={
            unlinked ?? {
              icon: 'calendar',
              title: t('home.empty.title'),
              body: t('home.empty.body'),
              action: {
                label: t('home.empty.action'),
                onPress: () => navigation.navigate('Booking', {}),
              },
            }
          }
        >
          {(data) => {
            // Home wants the first upcoming appointment and nothing
            // else, so it reads page one and never calls `loadMore` --
            // which is exactly what `PagedQuery` keeping the
            // single-page shape is for.
            const next = data.items[0];
            if (next === undefined) return null;
            const doctorName =
              next.doctor.title === null
                ? next.doctor.fullName
                : `${next.doctor.title} ${next.doctor.fullName}`;
            return (
              <Card
                testID="home-next-appointment-card"
                onPress={() =>
                  navigation.navigate('Tabs', {
                    screen: 'AppointmentsTab',
                    params: { screen: 'AppointmentDetail', params: { appointmentId: next.id } },
                  })
                }
                accessibilityLabel={t('home.nextAppointment.a11y', {
                  when: formatDateTime(next.startsAt, next.clinicTimezone),
                  doctor: doctorName,
                })}
                accessibilityHint={t('home.nextAppointment.hint')}
              >
                <View style={[styles.row, { columnGap: theme.space[3] }]}>
                  <Avatar name={next.doctor.fullName} photoUrl={next.doctor.photoUrl} size={48} />
                  <View style={[styles.grow, { rowGap: theme.space[1] }]}>
                    <Text variant="bodyStrong">
                      {formatDateTime(next.startsAt, next.clinicTimezone)}
                    </Text>
                    <Text variant="bodySm" color="textSecondary">
                      {doctorName} · {next.doctor.specialty}
                    </Text>
                    <Text variant="caption" color="textTertiary">
                      {formatRelative(next.startsAt, { timeZone: next.clinicTimezone })}
                    </Text>
                  </View>
                </View>
                {/* The server's status, rendered verbatim. */}
                <StatusBadge status={next.status} testID="home-next-appointment-status" />
              </Card>
            );
          }}
        </AsyncBoundary>
      </Section>

      {/*
        Below the next appointment and above the quick actions: what
        happened is context for what to do next, and neither outranks the
        one appointment a patient came to check. It renders nothing at
        all when its feed cannot be read (BE-10, i.e. always in
        production today) — `RecentActivity` carries why an absence beats
        an error card here.
      */}
      <RecentActivity
        onOpenAppointment={(appointmentId) =>
          navigation.navigate('Tabs', {
            screen: 'AppointmentsTab',
            params: { screen: 'AppointmentDetail', params: { appointmentId } },
          })
        }
      />

      {/*
        Below the patient's own two sections and above the actions: an
        announcement is the clinic talking to everybody, which never
        outranks this patient's next appointment or what has just
        happened to them. Like `RecentActivity` it renders nothing at all
        when it cannot be read (BE-11, i.e. always in production today),
        and unlike it, nothing when the clinic has posted nothing —
        `Announcements` carries why those two silences are different.
      */}
      <Announcements />

      {/*
        Last of the cards, and below the announcement for the same reason
        the announcement is below the appointment: a capability that is
        not connected to anything does not outrank one that is.

        Marked on its face, so the answer arrives before the tap rather
        than after it. `AiCapabilityCard` carries why a navigating card
        beats an inert one here.
      */}
      <AiCapabilityCard
        testID="home-assistant-card"
        icon="cpu"
        title={t('ai.home.title')}
        body={t('ai.home.entry')}
        onPress={() =>
          navigation.navigate('Tabs', { screen: 'HomeTab', params: { screen: 'AiHome' } })
        }
      />

      <Section title={t('home.quickActions')}>
        <View style={[styles.actions, { columnGap: theme.space[3], rowGap: theme.space[3] }]}>
          {quickActions.map((action) => (
            <Button
              key={action.id}
              testID={`home-action-${action.id}`}
              label={t(action.labelKey)}
              icon={action.icon}
              tone="secondary"
              onPress={action.onPress}
              style={styles.action}
            />
          ))}
        </View>
      </Section>

      <Card tone="sunken">
        <Text variant="bodySm" color="textTertiary">
          {t('home.disclaimer')}
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  action: { flexBasis: '45%', flexGrow: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap' },
  grow: { flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row' },
});
