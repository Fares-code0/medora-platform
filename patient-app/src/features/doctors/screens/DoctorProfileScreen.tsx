import { useEffect } from 'react';

import { useNavigation, type NavigationProp } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet, View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import {
  AsyncBoundary,
  Avatar,
  Badge,
  Button,
  Card,
  Icon,
  Screen,
  Section,
  Text,
} from '@/components';
import { SkeletonCard } from '@/components/feedback/Skeleton';
import { useT } from '@/i18n';
import type { DiscoverStackParamList, RootStackParamList } from '@/navigation/routes';
import { useTheme } from '@/theme';

import { AvailabilityPreview } from '../components/AvailabilityPreview';
import { useDoctor } from '../hooks';
import { recordDoctorView } from '../recent';

type Props = NativeStackScreenProps<DiscoverStackParamList, 'DoctorProfile'>;

/**
 * A doctor's profile.
 *
 * Renders the A-05 allow-list and nothing else. There is no "contact"
 * section and there will not be one: `contact_phone` and `contact_email`
 * are the doctor's own details, and a patient reaches a clinician through
 * the clinic or through a message thread, never by dialling them directly.
 *
 * The Book button opens the booking flow pre-filled and is deliberately
 * ABOVE the availability preview rather than inside it: asking for an
 * appointment is always allowed, whether or not this client can see a
 * calendar. `AvailabilityPreview` (G-09) adds the next few times when the
 * server offers them — it renders them, it never computes them, and it
 * renders nothing at all when the read fails, which is every production
 * build while `GET /patient/doctors/:id/slots` (doctor-published slots,
 * DR-10; it superseded `/public/*` and BE-06) is not built. Guessing at availability client-side is what audit §6 forbids.
 *
 * Opening this screen records the visit for the Discover screen's recency
 * list (G-10). That list is memory-only and dies with the session — see
 * `recent.ts` for why a list of specialists a patient looked at is not
 * something to leave on a phone.
 */
export function DoctorProfileScreen({ route }: Props) {
  const theme = useTheme();
  const t = useT();
  const rootNavigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { doctorId } = route.params;
  const doctor = useDoctor(doctorId);

  const viewed = doctor.data;
  useEffect(() => {
    // Recorded once the profile has actually loaded: a doctor whose
    // fetch failed was never viewed.
    if (viewed !== undefined) recordDoctorView(viewed);
  }, [viewed]);

  return (
    <Screen testID="doctor-profile-screen">
      {/*
        A heading on every path — `A11Y_AUDIT` F-7.

        The doctor's name is the heading once there is one, and it sits
        under the avatar where the design wants it. While the query runs,
        and if it fails, there was nothing: no heading in the tree at
        all, so a screen reader's rotor had nowhere to land — F-3's
        defect, in the state a patient on a slow connection meets first.
        `a11y-audit.test.ts` scans the source and this file has always
        mentioned `headingA11y`, so only a render could see it;
        `screen-headings.test.tsx` does, and was watched to fail here.

        A separate element rather than a hoisted one, because the loaded
        heading belongs to the avatar block and moving it out would
        change the screen a patient actually sees.
      */}
      {doctor.data === undefined ? (
        <Text variant="h1" align="center" {...headingA11y(t('nav.title.doctor'))}>
          {t('nav.title.doctor')}
        </Text>
      ) : null}

      <AsyncBoundary query={doctor} testID="doctor-profile" loading={<SkeletonCard />}>
        {(data) => {
          const displayName =
            data.title === null ? data.fullName : `${data.title} ${data.fullName}`;
          return (
            <View style={{ rowGap: theme.space[5] }}>
              <View style={[styles.header, { rowGap: theme.space[2] }]}>
                <Avatar name={data.fullName} photoUrl={data.photoUrl} size={88} />
                <Text variant="h1" align="center" {...headingA11y(displayName)}>
                  {displayName}
                </Text>
                <Text variant="body" color="textSecondary" align="center">
                  {data.specialty}
                </Text>

                <View
                  style={[
                    styles.wrap,
                    styles.center,
                    { columnGap: theme.space[2], rowGap: theme.space[2] },
                  ]}
                >
                  {data.hospital === null ? null : (
                    <Badge
                      label={data.hospital.name}
                      tone="info"
                      icon="mapPin"
                      testID="doctor-profile-hospital"
                    />
                  )}
                  {data.departmentName === null ? null : (
                    <Badge label={data.departmentName} tone="primary" />
                  )}
                  {data.ratingAvg === null ? null : (
                    <Badge
                      label={t('doctor.rating', { rating: data.ratingAvg.toFixed(1) })}
                      tone="warning"
                      icon="star"
                    />
                  )}
                  {data.yearsOfExperience === null ? null : (
                    <Badge label={t('doctor.years', { count: data.yearsOfExperience })} />
                  )}
                </View>
              </View>

              <Button
                label={t('doctor.book')}
                size="lg"
                fullWidth
                icon="calendar"
                testID="doctor-profile-book"
                onPress={() => rootNavigation.navigate('Booking', { doctorId: data.id })}
              />

              <AvailabilityPreview
                doctorId={data.id}
                onPick={(startsAt) =>
                  rootNavigation.navigate('Booking', {
                    doctorId: data.id,
                    ...(startsAt === undefined ? {} : { startsAt }),
                  })
                }
              />

              {data.biography === null ? null : (
                <Section title={t('doctor.about')}>
                  <Card>
                    <Text variant="body" color="textSecondary">
                      {data.biography}
                    </Text>
                  </Card>
                </Section>
              )}

              {data.languages.length === 0 ? null : (
                <Section title={t('doctor.languages')}>
                  <View
                    style={[styles.wrap, { columnGap: theme.space[2], rowGap: theme.space[2] }]}
                  >
                    {data.languages.map((language) => (
                      <Badge key={language} label={language} icon="globe" />
                    ))}
                  </View>
                </Section>
              )}

              {data.education.length === 0 ? null : (
                <Section title={t('doctor.education')}>
                  <Card>
                    {data.education.map((entry) => (
                      <View key={entry} style={[styles.row, { columnGap: theme.space[2] }]}>
                        <Icon name="briefcase" size={14} color="textTertiary" />
                        <Text variant="bodySm" color="textSecondary" style={styles.grow}>
                          {entry}
                        </Text>
                      </View>
                    ))}
                  </Card>
                </Section>
              )}

              {data.officeLocation === null && data.hospital === null ? null : (
                <Section title={t('doctor.where')}>
                  <Card>
                    {data.hospital === null ? null : (
                      <Text variant="bodyStrong">{data.hospital.name}</Text>
                    )}
                    {data.officeLocation === null ? null : (
                      <Text variant="bodySm" color="textSecondary">
                        {data.officeLocation}
                      </Text>
                    )}
                  </Card>
                </Section>
              )}
            </View>
          );
        }}
      </AsyncBoundary>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  center: { justifyContent: 'center' },
  header: { alignItems: 'center' },
  row: { alignItems: 'center', flexDirection: 'row' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
});
