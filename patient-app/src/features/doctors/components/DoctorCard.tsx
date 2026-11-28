import { StyleSheet, View } from 'react-native';

import { isolate } from '@/accessibility/bidi';
import { Avatar, Badge, Card, Icon, Text } from '@/components';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';

import type { PatientSafeDoctor } from '../model/types';

/**
 * A doctor, as a patient sees one.
 *
 * The fields rendered here ARE the allow-list of
 * `docs/PUBLIC_PROJECTIONS.md` — name, title, specialty, department,
 * photo, rating, experience. Nothing else is rendered, whatever the
 * payload contains, which is the client's half of R-3 (the server's half
 * is BE-04's projection and its contract test).
 *
 * The rating carries a numeral as well as a star, because a star alone is
 * a rating a screen-reader user cannot read and a colour-blind user
 * cannot compare.
 */
export function DoctorCard({
  doctor,
  onPress,
  testID,
}: {
  doctor: PatientSafeDoctor;
  onPress: () => void;
  testID?: string;
}) {
  const theme = useTheme();
  const t = useT();
  const displayName =
    doctor.title === null ? doctor.fullName : `${doctor.title} ${doctor.fullName}`;

  const summary =
    doctor.ratingAvg === null
      ? t('doctor.card.a11y', { name: displayName, specialty: doctor.specialty })
      : t('doctor.card.a11yRated', {
          name: displayName,
          specialty: doctor.specialty,
          rating: doctor.ratingAvg,
        });

  return (
    <Card
      testID={testID}
      onPress={onPress}
      accessibilityLabel={
        doctor.hospital === null
          ? summary
          : t('doctor.card.a11yHospital', {
              summary,
              hospital: isolate(doctor.hospital.name),
            })
      }
      accessibilityHint={t('doctor.card.hint')}
    >
      <View style={[styles.row, { columnGap: theme.space[3] }]}>
        <Avatar name={doctor.fullName} photoUrl={doctor.photoUrl} size={52} />

        <View style={[styles.grow, { rowGap: theme.space[1] }]}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {displayName}
          </Text>
          <Text variant="bodySm" color="textSecondary" numberOfLines={1}>
            {doctor.specialty}
          </Text>
          {doctor.departmentName === null ? null : (
            <Text variant="caption" color="textTertiary" numberOfLines={1}>
              {doctor.departmentName}
            </Text>
          )}
          {doctor.hospital === null ? null : (
            <View style={[styles.row, { columnGap: theme.space[1] }]}>
              <Icon name="mapPin" size={12} color="textTertiary" />
              <Text
                variant="caption"
                color="textTertiary"
                numberOfLines={1}
                style={styles.grow}
                testID={testID === undefined ? undefined : `${testID}-hospital`}
              >
                {doctor.hospital.name}
              </Text>
            </View>
          )}

          <View style={[styles.row, { columnGap: theme.space[2], marginTop: theme.space[1] }]}>
            {doctor.ratingAvg === null ? null : (
              <View style={[styles.row, { columnGap: theme.space[1] }]}>
                <Icon name="star" size={12} color="warning" />
                <Text variant="caption" color="textSecondary">
                  {doctor.ratingAvg.toFixed(1)}
                </Text>
              </View>
            )}
            {doctor.yearsOfExperience === null ? null : (
              <Badge
                label={t('doctor.card.years', { count: doctor.yearsOfExperience })}
                tone="neutral"
              />
            )}
          </View>
        </View>

        <Icon name="forward" size={18} color="textTertiary" />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row' },
});
