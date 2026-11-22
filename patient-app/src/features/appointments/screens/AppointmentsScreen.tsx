import { useState } from 'react';

import { useNavigation, type NavigationProp } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet, View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import { Button, Chip, PagedList, Text } from '@/components';
import { useUnlinkedEmptyState } from '@/features/profile/useRecordLink';
import { useT } from '@/i18n';
import type { AppointmentsStackParamList, RootStackParamList } from '@/navigation/routes';
import { useTheme } from '@/theme';

import { AppointmentCard } from '../components/AppointmentCard';
import { useAppointments } from '../hooks';

type Props = NativeStackScreenProps<AppointmentsStackParamList, 'AppointmentsRoot'>;

type Scope = 'upcoming' | 'past';

/**
 * The appointments tab.
 *
 * Two segments rather than one merged list: "what is coming" and "what
 * happened" are different questions and a patient asks one at a time.
 * Pull-to-refresh is wired because an appointment's status changes at the
 * clinic, not on the phone, and a patient checking whether a request was
 * approved will pull before they will hunt for a refresh control.
 *
 * ── Paging ──────────────────────────────────────────────────────────
 *
 * `GET /me/appointments` is paginated and this screen used to render
 * page one and stop. It said nothing about the rest, which is the worst
 * of the three options: a patient looking for last spring's appointment
 * concluded it was not there. "Show more" follows the three rules
 * `DoctorResults` wrote down for G-02, and `PagedList` now carries them
 * for all three growing lists —
 *
 * 1. **A button, not an infinite scroll.** Loading a patient's clinical
 *    history because their thumb moved is not something to do without
 *    asking.
 * 2. **The loading state for the next page lives BELOW the list**, so
 *    the rows a patient is reading are not replaced by a skeleton.
 * 3. **"That is all of them" is said once, at the end, and only after
 *    paging** — on a single-page list it is noise.
 *
 * The screen is a `PagedList` rather than a `Screen` because paging made
 * this list unbounded: a patient with two years of history could mount
 * every card at once inside a `ScrollView`. The header — title, segments
 * and Book — scrolls with the rows as the list's header, so nothing about
 * the layout moved (`docs/PERF.md` §3).
 */
export function AppointmentsScreen({ navigation }: Props) {
  const theme = useTheme();
  const t = useT();
  const rootNavigation = useNavigation<NavigationProp<RootStackParamList>>();
  const [scope, setScope] = useState<Scope>('upcoming');
  const appointments = useAppointments(scope);
  // F-09: with no clinical record both segments are empty by construction;
  // say why instead of "Nothing booked" (`useRecordLink.ts`).
  const unlinked = useUnlinkedEmptyState();

  return (
    <PagedList
      testID="appointments-screen"
      statesTestID="appointments-list"
      query={appointments}
      onRefresh={() => void appointments.refetch()}
      renderItem={(appointment) => (
        <AppointmentCard
          testID={`appointment-card-${appointment.id}`}
          appointment={appointment}
          onPress={() =>
            navigation.navigate('AppointmentDetail', { appointmentId: appointment.id })
          }
        />
      )}
      paging={{
        testIDPrefix: 'appointments',
        loadMoreLabel: t(
          scope === 'upcoming' ? 'appointments.loadMore.upcoming' : 'appointments.loadMore',
        ),
        loadMoreHint: t('appointments.loadMore.hint', {
          shown: appointments.data?.items.length ?? 0,
          total: appointments.data?.totalItems ?? 0,
        }),
        endLabel: t('appointments.end', { total: appointments.data?.totalItems ?? 0 }),
      }}
      empty={
        unlinked ??
        (scope === 'upcoming'
          ? {
              icon: 'calendar',
              title: t('appointments.empty.upcoming.title'),
              body: t('appointments.empty.upcoming.body'),
              action: {
                label: t('appointments.book'),
                onPress: () => rootNavigation.navigate('Booking', {}),
              },
            }
          : {
              icon: 'clock',
              title: t('appointments.empty.past.title'),
              body: t('appointments.empty.past.body'),
            })
      }
      header={
        <>
          <Text variant="h1" {...headingA11y(t('appointments.title'))}>
            {t('appointments.title')}
          </Text>

          <View style={[styles.row, { columnGap: theme.space[2] }]}>
            <Chip
              label={t('appointments.scope.upcoming')}
              testID="appointments-scope-upcoming"
              selected={scope === 'upcoming'}
              onPress={() => setScope('upcoming')}
            />
            <Chip
              label={t('appointments.scope.past')}
              testID="appointments-scope-past"
              selected={scope === 'past'}
              onPress={() => setScope('past')}
            />
          </View>

          <Button
            label={t('appointments.book')}
            icon="plus"
            fullWidth
            testID="appointments-book"
            onPress={() => rootNavigation.navigate('Booking', {})}
          />
        </>
      }
    />
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row' },
});
