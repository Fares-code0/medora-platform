import { StyleSheet, View } from 'react-native';

import { isolate } from '@/accessibility/bidi';
import { Avatar, Card, Icon, StatusBadge, Text } from '@/components';
import { useT, useDateFormat } from '@/i18n';
import { useTheme } from '@/theme';

import type { Appointment } from '../model/types';

/**
 * One appointment, in a list.
 *
 * The status comes from `StatusBadge`, whose map is exhaustive over all
 * eight statuses — including `awaiting-patient` and `no-show`, the two a
 * naive implementation forgets (checklist I-02).
 *
 * The absolute date and time is always rendered; the relative hint
 * ("tomorrow") sits beside it and never replaces it, because the relative
 * form is computed against the DEVICE clock.
 */
export function AppointmentCard({
  appointment,
  onPress,
  testID,
}: {
  appointment: Appointment;
  onPress: () => void;
  testID?: string;
}) {
  const theme = useTheme();
  const { formatDateTime, formatRelative } = useDateFormat();
  const t = useT();
  const doctorName =
    appointment.doctor.title === null
      ? appointment.doctor.fullName
      : `${appointment.doctor.title} ${appointment.doctor.fullName}`;

  return (
    <Card
      testID={testID}
      onPress={onPress}
      accessibilityLabel={
        appointment.hospital === null
          ? t('appointments.card.a11y', {
              when: formatDateTime(appointment.startsAt, appointment.clinicTimezone),
              doctor: doctorName,
              specialty: appointment.doctor.specialty,
            })
          : t('appointments.card.a11yHospital', {
              when: formatDateTime(appointment.startsAt, appointment.clinicTimezone),
              doctor: doctorName,
              specialty: appointment.doctor.specialty,
              hospital: isolate(appointment.hospital.name),
            })
      }
      accessibilityHint={t('appointments.card.hint')}
    >
      <View style={[styles.row, { columnGap: theme.space[3] }]}>
        <Avatar name={appointment.doctor.fullName} photoUrl={appointment.doctor.photoUrl} />

        <View style={[styles.grow, { rowGap: theme.space[1] }]}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {doctorName}
          </Text>
          <Text variant="bodySm" color="textSecondary" numberOfLines={1}>
            {appointment.doctor.specialty}
            {appointment.departmentName === null ? '' : ` · ${appointment.departmentName}`}
          </Text>
          {appointment.hospital === null ? null : (
            <Text variant="caption" color="textTertiary" numberOfLines={1}>
              {appointment.hospital.name}
            </Text>
          )}
        </View>

        <Icon name="forward" size={18} color="textTertiary" />
      </View>

      <View style={[styles.row, { columnGap: theme.space[2] }]}>
        <Icon name="calendar" size={14} color="textTertiary" />
        <Text variant="bodySm" color="textSecondary">
          {formatDateTime(appointment.startsAt, appointment.clinicTimezone)}
        </Text>
        <Text variant="caption" color="textTertiary">
          {formatRelative(appointment.startsAt, { timeZone: appointment.clinicTimezone })}
        </Text>
      </View>

      <StatusBadge status={appointment.status} testID={`${testID ?? 'appointment'}-status`} />
    </Card>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row' },
});
