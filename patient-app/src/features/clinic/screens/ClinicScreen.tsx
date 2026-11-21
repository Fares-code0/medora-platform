import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import { createKeyFactory } from '@/api/query-keys';
import {
  AsyncBoundary,
  Button,
  Card,
  Divider,
  ListItem,
  Screen,
  Section,
  Text,
} from '@/components';
import { SkeletonCard } from '@/components/feedback/Skeleton';
import { useDepartments } from '@/features/doctors/hooks';
import { dial, isHttpsUrl, openMap, openWebsite } from '@/features/emergency/dial';
import { useDateFormat, useT, type MessageKey, type TranslateFn } from '@/i18n';
import type { DiscoverStackParamList } from '@/navigation/routes';
import { useTheme } from '@/theme';

import type { Holiday } from '../model/types';
import { clinicService } from '../service';

type Props = NativeStackScreenProps<DiscoverStackParamList, 'Clinic'>;

const clinicKeys = createKeyFactory('clinic');

/**
 * Our Clinic.
 *
 * Contains `tel:` and a maps hand-off, both built from strings the
 * clinic supplied. The maps link takes an ADDRESS, not coordinates —
 * there are no geo columns in the schema — and needs no location
 * permission at all, which is what makes Q-02's "denying location
 * degrades nothing" true by construction rather than by testing.
 *
 * The phone number goes through the same two-step dial as every other
 * number in the app: `dial()` refuses anything that is not a phone
 * number, and the button here is a plain call rather than an emergency
 * one because it reaches a reception desk, not an ambulance.
 *
 * The website is the third hand-off and the newest. H-01 names it — "name,
 * address, phone, website" — and the field was fetched and dropped for as
 * long as this screen has existed. It gets the same treatment as the
 * number: `isHttpsUrl` decides whether the button exists at all, and
 * `openWebsite` checks again at the tap, because operator configuration
 * over the network is untrusted input and `Linking.openURL` opens any
 * scheme it is given.
 *
 * ── Holidays are rendered, never judged (H-04, audit R-12) ────────────
 *
 * `clinicService.getHolidays()` has been in the port since the port
 * existed and no screen called it, so the "& holidays" half of H-04 was
 * missing rather than blocked. What this screen does NOT do is work out
 * whether a holiday has passed, or whether the clinic is "closed today":
 * `datetime.ts` states the rule — the client formats, it never computes —
 * and the clinic's timezone is not in `ClinicProfile` to compute it with.
 * Deciding "closed today" against the device's clock would give a
 * travelling patient a confident wrong answer. That half stays with
 * BE-11, which has to send it.
 *
 * So the list is the clinic's own published dates, soonest first. Sorting
 * is ordering values the server sent; it is not a judgement about them.
 */
export function ClinicScreen({ navigation }: Props) {
  const theme = useTheme();
  const t = useT();
  // Locale-aware, per A-08's date work: a closure date reads in the
  // language the patient chose, not the one the phone is set to.
  const { formatLongDate } = useDateFormat();

  const profile = useQuery({
    queryKey: [...clinicKeys.all, 'profile'],
    queryFn: () => clinicService.getProfile(),
    staleTime: 60 * 60_000,
  });
  const hours = useQuery({
    queryKey: [...clinicKeys.all, 'hours'],
    queryFn: () => clinicService.getOpeningHours(),
    staleTime: 60 * 60_000,
  });
  const holidays = useQuery({
    queryKey: [...clinicKeys.all, 'holidays'],
    queryFn: () => clinicService.getHolidays(),
    staleTime: 60 * 60_000,
    select: soonestFirst,
  });
  const departments = useDepartments();

  return (
    <Screen testID="clinic-screen">
      <AsyncBoundary query={profile} testID="clinic-profile" loading={<SkeletonCard />}>
        {(clinic) => (
          <View style={{ rowGap: theme.space[4] }}>
            <Text variant="h1" {...headingA11y(clinic.name)}>
              {clinic.name}
            </Text>

            <Card>
              <Text variant="body" color="textSecondary">
                {[clinic.addressLine, clinic.city, clinic.country].filter(Boolean).join(', ')}
              </Text>
              <View style={{ rowGap: theme.space[2], marginTop: theme.space[2] }}>
                {clinic.phone === null ? null : (
                  <Button
                    label={t('clinic.call', { phone: clinic.phone })}
                    tone="secondary"
                    icon="phone"
                    fullWidth
                    testID="clinic-call"
                    onPress={() => {
                      if (clinic.phone !== null) void dial(clinic.phone);
                    }}
                  />
                )}
                <Button
                  label={t('clinic.openMap')}
                  tone="secondary"
                  icon="mapPin"
                  fullWidth
                  testID="clinic-map"
                  onPress={() => void openMap(clinic.addressLine)}
                />
                {/*
                  No button at all for a clinic that published no website,
                  or published something that is not an https URL — the
                  same rule the Call button follows. A dead button is
                  worse than an absent one.
                */}
                {clinic.website === null || !isHttpsUrl(clinic.website) ? null : (
                  <Button
                    label={t('clinic.openWebsite')}
                    tone="secondary"
                    icon="globe"
                    fullWidth
                    testID="clinic-website"
                    onPress={() => {
                      if (clinic.website !== null) void openWebsite(clinic.website);
                    }}
                  />
                )}
              </View>
            </Card>
          </View>
        )}
      </AsyncBoundary>

      <Section title={t('clinic.hours')}>
        <AsyncBoundary
          query={hours}
          testID="clinic-hours"
          loading={<SkeletonCard testID="clinic-hours-loading" />}
          // Found by U-06's table: this boundary had no `isEmpty`, so a
          // clinic that has not published its hours rendered an empty
          // card — a box with nothing in it, which reads as a bug rather
          // than as an answer. R-02 asks every list for an empty state.
          isEmpty={(days) => days.length === 0}
          empty={{
            icon: 'clock',
            title: t('clinic.hours.empty.title'),
            body: t('clinic.hours.empty.body'),
          }}
        >
          {(days) => (
            <Card padded={false}>
              {days.map((day, index) => (
                <View key={day.weekday}>
                  {index === 0 ? null : <Divider />}
                  <View style={{ paddingHorizontal: theme.space[4] }}>
                    <ListItem
                      title={weekdayName(t, day.weekday)}
                      value={
                        day.closed || day.opensAt === null || day.closesAt === null
                          ? t('clinic.closed')
                          : `${day.opensAt} – ${day.closesAt}`
                      }
                      readOnly={day.closed}
                    />
                  </View>
                </View>
              ))}
            </Card>
          )}
        </AsyncBoundary>
      </Section>

      <Section title={t('clinic.holidays')} subtitle={t('clinic.holidays.subtitle')}>
        <AsyncBoundary
          query={holidays}
          testID="clinic-holidays"
          loading={<SkeletonCard testID="clinic-holidays-loading" />}
          isEmpty={(days) => days.length === 0}
          empty={{
            icon: 'calendar',
            title: t('clinic.holidays.empty.title'),
            body: t('clinic.holidays.empty.body'),
          }}
        >
          {(days) => (
            <Card padded={false}>
              {days.map((holiday, index) => (
                <View key={holiday.id}>
                  {index === 0 ? null : <Divider />}
                  <View style={{ paddingHorizontal: theme.space[4] }}>
                    {/*
                      `readOnly` because a closure is not something a
                      patient can act on here, and the row is not a link:
                      there is nothing behind it to open.
                    */}
                    <ListItem
                      title={holiday.name}
                      testID={`clinic-holiday-${holiday.id}`}
                      value={formatLongDate(holiday.date)}
                      readOnly
                    />
                  </View>
                </View>
              ))}
            </Card>
          )}
        </AsyncBoundary>
      </Section>

      <Section title={t('clinic.departments')}>
        <AsyncBoundary
          query={departments}
          testID="clinic-departments"
          isEmpty={(data) => data.length === 0}
          empty={{ title: t('clinic.departments.empty') }}
        >
          {(data) => (
            <Card padded={false}>
              {data.map((department, index) => (
                <View key={department.id}>
                  {index === 0 ? null : <Divider />}
                  <View style={{ paddingHorizontal: theme.space[4] }}>
                    {/*
                      Each department opens its doctors (H-05). The row
                      was inert until then, which made a list of names
                      look like a table of contents with no chapters.
                    */}
                    <ListItem
                      title={department.name}
                      testID={`clinic-department-${department.id}`}
                      {...(department.description === null
                        ? {}
                        : { subtitle: department.description })}
                      accessibilityHint={t('clinic.department.hint')}
                      onPress={() =>
                        navigation.navigate('Department', {
                          departmentId: department.id,
                          departmentName: department.name,
                          description: department.description,
                        })
                      }
                    />
                  </View>
                </View>
              ))}
            </Card>
          )}
        </AsyncBoundary>
      </Section>

      <Text variant="caption" color="textTertiary" align="center" style={styles.note}>
        {t('clinic.singleClinicNote')}
      </Text>
    </Screen>
  );
}

/**
 * Published holidays, soonest first.
 *
 * Ordering, not judgement — see the screen's docblock. The comparison is
 * on the date string the server sent, and a value that cannot be parsed
 * sorts last rather than returning `NaN` from the comparator, which would
 * leave `sort` free to emit any permutation at all.
 *
 * It is a module-level `select` so react-query memoises it against the
 * cached list instead of re-sorting on every unrelated re-render.
 */
function soonestFirst(days: readonly Holiday[]): readonly Holiday[] {
  return [...days].sort((a, b) => {
    const left = Date.parse(a.date);
    const right = Date.parse(b.date);
    return (
      (Number.isNaN(left) ? Number.POSITIVE_INFINITY : left) -
      (Number.isNaN(right) ? Number.POSITIVE_INFINITY : right)
    );
  });
}

/**
 * The backend's `Weekday` literal, named in the patient's language.
 *
 * `OpeningDay.weekday` is typed `string` because it is the backend's own
 * enum value and this client does not redeclare it. So an unrecognised
 * value falls back to the server's string, capitalised — the behaviour
 * this screen had for every day before C-09, and the right answer for a
 * value nobody here has a translation for. It is never a guess and never
 * blank.
 */
const WEEKDAY_KEYS: Readonly<Record<string, MessageKey>> = {
  sunday: 'weekday.sunday',
  monday: 'weekday.monday',
  tuesday: 'weekday.tuesday',
  wednesday: 'weekday.wednesday',
  thursday: 'weekday.thursday',
  friday: 'weekday.friday',
  saturday: 'weekday.saturday',
};

function weekdayName(t: TranslateFn, weekday: string): string {
  const key = WEEKDAY_KEYS[weekday.toLowerCase()];
  return key === undefined ? weekday.charAt(0).toUpperCase() + weekday.slice(1) : t(key);
}

const styles = StyleSheet.create({ note: { paddingHorizontal: 8 } });
