import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet, View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import {
  AsyncBoundary,
  Avatar,
  Card,
  Divider,
  Icon,
  Screen,
  Section,
  statusPresentation,
  StatusBadge,
  Text,
} from '@/components';
import { SkeletonCard } from '@/components/feedback/Skeleton';
import { useDateFormat, useT } from '@/i18n';
import type { AppointmentsStackParamList } from '@/navigation/routes';
import { useTheme } from '@/theme';
import { isDeviceTimeZone } from '@/utils/datetime';

import { AppointmentActions } from '../components/AppointmentActions';
import { useAppointment } from '../hooks';

type Props = NativeStackScreenProps<AppointmentsStackParamList, 'AppointmentDetail'>;

/**
 * One appointment, in full.
 *
 * The history is `appointment_events` rendered as a timeline with actor
 * and reason — the same rows the doctor app shows, from the patient's
 * side. It exists because "why did this change?" is the question a
 * patient asks about a rescheduled or cancelled appointment, and a status
 * badge alone does not answer it.
 */
export function AppointmentDetailScreen({ route }: Props) {
  const theme = useTheme();
  const { formatDateTime, formatLongDate, formatRelative, formatTime } = useDateFormat();
  const t = useT();
  const appointment = useAppointment(route.params.appointmentId);

  /**
   * The heading is outside the boundary — `A11Y_AUDIT` F-7.
   *
   * It used to be the appointment's date and nothing else, rendered
   * inside `AsyncBoundary`'s success branch. So while the query ran,
   * after it failed, and on a 404, this screen had **no heading at all**
   * and a screen reader's rotor had nothing to land on — F-3's defect,
   * in the state a patient on a slow connection meets first. The source
   * scan in `a11y-audit.test.ts` could not see it: the file mentions
   * `headingA11y`, just not on every path. `screen-headings.test.tsx`
   * asserts the first commit, and was watched to fail on this screen.
   *
   * The date is still the heading once there is one. The fallback is the
   * screen's own name, which is what the navigator's title says anyway.
   */
  const heading =
    appointment.data === undefined
      ? t('nav.title.appointment')
      : formatLongDate(appointment.data.startsAt, appointment.data.clinicTimezone);

  return (
    <Screen
      testID="appointment-detail-screen"
      onRefresh={() => void appointment.refetch()}
      refreshing={appointment.isRefetching}
    >
      <Text variant="h1" {...headingA11y(heading)}>
        {heading}
      </Text>

      <AsyncBoundary
        query={appointment}
        testID="appointment-detail"
        loading={<SkeletonCard />}
        keepDataOnRefreshError
      >
        {(data) => {
          const doctorName =
            data.doctor.title === null
              ? data.doctor.fullName
              : `${data.doctor.title} ${data.doctor.fullName}`;
          return (
            <View style={{ rowGap: theme.space[5] }}>
              <View style={{ rowGap: theme.space[2] }}>
                <Text variant="h2" color="textSecondary">
                  {formatTime(data.startsAt, data.clinicTimezone)} ·{' '}
                  {t('appointment.duration', { minutes: data.durationMin })}
                </Text>
                <Text variant="bodySm" color="textTertiary">
                  {formatRelative(data.startsAt, { timeZone: data.clinicTimezone })}
                </Text>
                {/*
                  Only when the phone is somewhere else. Every time on
                  this screen is the clinic's, always; saying so when the
                  two agree is noise, and not saying so when they do not
                  is how a patient arrives three hours early.
                */}
                {isDeviceTimeZone(data.clinicTimezone) ? null : (
                  <Text variant="caption" color="textTertiary" testID="appointment-clinic-time">
                    {t('appointment.clinicTime')}
                  </Text>
                )}
                <StatusBadge status={data.status} testID="appointment-detail-status" />
              </View>

              <Card>
                <View style={[styles.row, { columnGap: theme.space[3] }]}>
                  <Avatar name={data.doctor.fullName} photoUrl={data.doctor.photoUrl} size={52} />
                  <View style={styles.grow}>
                    <Text variant="bodyStrong">{doctorName}</Text>
                    <Text variant="bodySm" color="textSecondary">
                      {data.doctor.specialty}
                    </Text>
                    {data.departmentName === null ? null : (
                      <Text variant="caption" color="textTertiary">
                        {data.departmentName}
                      </Text>
                    )}
                  </View>
                </View>
              </Card>

              <Section title={t('appointment.details')}>
                <Card>
                  <Text variant="label" color="textTertiary">
                    {t('appointment.visitType')}
                  </Text>
                  {/* The server's own vocabulary, rendered verbatim. */}
                  <Text variant="body">{data.visitType}</Text>
                  <Divider />
                  <Text variant="label" color="textTertiary">
                    {t('appointment.reason')}
                  </Text>
                  <Text variant="body">{data.reason}</Text>
                  {data.notes === null ? null : (
                    <>
                      <Divider />
                      <Text variant="label" color="textTertiary">
                        {t('appointment.notes')}
                      </Text>
                      <Text variant="body">{data.notes}</Text>
                    </>
                  )}
                  {data.cancelledReason === null ? null : (
                    <>
                      <Divider />
                      <Text variant="label" color="error">
                        {t('appointment.cancelledBecause')}
                      </Text>
                      <Text variant="body">{data.cancelledReason}</Text>
                    </>
                  )}
                </Card>
              </Section>

              <AppointmentActions appointment={data} />

              <Section title={t('appointment.history')}>
                <Card padded={false}>
                  {data.events.map((event, index) => (
                    <View key={event.id}>
                      {index === 0 ? null : <Divider />}
                      <View
                        accessible
                        accessibilityLabel={
                          event.toStatus === null
                            ? t('appointment.event.a11y', {
                                actor: event.actor,
                                when: formatDateTime(event.at, data.clinicTimezone),
                              })
                            : t('appointment.event.a11yStatus', {
                                actor: event.actor,
                                /*
                                  The patient-facing word, not the
                                  database literal. This passed
                                  `event.toStatus` straight through, so a
                                  screen reader said "awaiting-patient"
                                  where the badge beside it reads "Needs
                                  your response" — exactly what
                                  `StatusBadge`'s docblock says must never
                                  happen, on the one row where the badge
                                  cannot be seen. `statusPresentation` is
                                  exported for this.
                                */
                                status: t(statusPresentation(event.toStatus).labelKey),
                                when: formatDateTime(event.at, data.clinicTimezone),
                              })
                        }
                        style={{ padding: theme.space[4], rowGap: theme.space[1] }}
                      >
                        <View style={[styles.row, { columnGap: theme.space[2] }]}>
                          <Icon name="clock" size={14} color="textTertiary" />
                          <Text variant="bodySm" style={styles.grow}>
                            {event.actor}
                          </Text>
                          {/* Null for an event that changed no status. The row
                              still renders — dropping it would edit a clinical
                              history to suit a component. */}
                          {event.toStatus === null ? null : <StatusBadge status={event.toStatus} />}
                        </View>
                        <Text variant="caption" color="textTertiary">
                          {formatDateTime(event.at, data.clinicTimezone)}
                        </Text>
                        {event.reason === null ? null : (
                          <Text variant="caption" color="textSecondary">
                            {event.reason}
                          </Text>
                        )}
                      </View>
                    </View>
                  ))}
                </Card>
              </Section>
            </View>
          );
        }}
      </AsyncBoundary>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row' },
});
