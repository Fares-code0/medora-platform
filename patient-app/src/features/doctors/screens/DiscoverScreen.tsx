import { useCallback, useEffect, useState } from 'react';

import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScrollView, StyleSheet, View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import { Card, Chip, Divider, Icon, Input, ListItem, Section, Text } from '@/components';
import { useT } from '@/i18n';
import type { DiscoverStackParamList } from '@/navigation/routes';
import { useTheme } from '@/theme';

import { DepartmentFilter } from '../components/DepartmentFilter';
import { DoctorResults } from '../components/DoctorResults';
import { HospitalFilter } from '../components/HospitalFilter';
import { useDoctorSearch, useSpecialties } from '../hooks';
import { listRecentDoctors, type RecentDoctor } from '../recent';

type Props = NativeStackScreenProps<DiscoverStackParamList, 'DiscoverRoot'>;

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Find a doctor.
 *
 * Search is **debounced and server-side**. The alternative — pull the
 * roster, filter in JS — is what a fixture makes tempting and is both a
 * performance problem and a disclosure: it puts every practitioner in the
 * clinic on the phone (checklist G-05).
 *
 * The specialty chips come from `useSpecialties()`, i.e. from the
 * `specialties` table, never from a hardcoded array (checklist G-06). A
 * hardcoded list is a list that goes stale the first time the clinic
 * hires into a new specialty.
 *
 * The department row below them (G-07) follows the same rule and adds
 * one of its own: it renders NOTHING when its list cannot be read, so a
 * search that works keeps working. `DepartmentFilter` carries why. The
 * two filters combine on the server — both parameters go on the same
 * request — because narrowing twice in JS is the client-side filtering
 * G-05 exists to refuse.
 *
 * There is no "verified only" toggle. Verified-and-active is the server's
 * default and not a client preference (checklist G-08).
 *
 * "Recently viewed" (G-10) appears only while the patient is browsing —
 * not while they are searching or filtering, where it would compete with
 * the answer they just asked for. It is read on focus because the list
 * is memory-only and grows on the profile screen; see `recent.ts` for
 * why it is not written to a store.
 */
export function DiscoverScreen({ navigation, route }: Props) {
  const theme = useTheme();
  const t = useT();
  const [rawQuery, setRawQuery] = useState('');
  const [query, setQuery] = useState('');
  const [specialtyId, setSpecialtyId] = useState<string | undefined>(undefined);
  const [departmentId, setDepartmentId] = useState<string | undefined>(undefined);
  // A hospital's own screen opens Discover already narrowed to it. A
  // hosted test screen may mount without a route, so both reads are guarded.
  const routeParams = (route as Props['route'] | undefined)?.params;
  const [hospitalId, setHospitalId] = useState<string | undefined>(routeParams?.hospitalId);
  const hospitalName = routeParams?.hospitalName;

  // The same screen instance is re-used when a hospital screen navigates
  // back here with a different hospital; follow the parameter.
  const arrivedHospitalId = routeParams?.hospitalId;
  useEffect(() => {
    if (arrivedHospitalId !== undefined) setHospitalId(arrivedHospitalId);
  }, [arrivedHospitalId]);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(rawQuery), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [rawQuery]);

  const [recent, setRecent] = useState<readonly RecentDoctor[]>([]);
  useFocusEffect(
    useCallback(() => {
      setRecent(listRecentDoctors());
    }, []),
  );

  const specialties = useSpecialties();
  const doctors = useDoctorSearch({
    ...(query.trim() === '' ? {} : { q: query.trim() }),
    ...(specialtyId === undefined ? {} : { specialtyId }),
    ...(departmentId === undefined ? {} : { departmentId }),
    ...(hospitalId === undefined ? {} : { hospitalId }),
  });

  /**
   * "Browsing" is the state Recently viewed belongs to: no question has
   * been asked yet. A department filter is a question, so it hides the
   * list for the same reason a search term does.
   */
  const isBrowsing =
    query.trim() === '' &&
    specialtyId === undefined &&
    departmentId === undefined &&
    hospitalId === undefined;

  return (
    <DoctorResults
      query={doctors}
      screenTestID="discover-screen"
      testIDPrefix="discover"
      onOpen={(doctorId) => navigation.navigate('DoctorProfile', { doctorId })}
      emptyTitleKey="discover.empty.title"
      emptyBodyKey="discover.empty.body"
      header={
        <>
          <Text variant="h1" {...headingA11y(t('discover.title'))}>
            {t('discover.title')}
          </Text>

          <Input
            label={t('discover.search.label')}
            testID="discover-search"
            value={rawQuery}
            onChangeText={setRawQuery}
            placeholder={t('discover.search.placeholder')}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            hint={t('discover.search.hint')}
          />

          {specialties.data === undefined ? null : (
            <View style={{ rowGap: theme.space[1] }}>
              <Text variant="caption" color="textTertiary">
                {t('discover.specialty.label')}
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{
                  columnGap: theme.space[2],
                  paddingVertical: theme.space[1],
                }}
              >
                <Chip
                  label={t('discover.specialty.all')}
                  selected={specialtyId === undefined}
                  onPress={() => setSpecialtyId(undefined)}
                  testID="discover-specialty-all"
                />
                {specialties.data.map((specialty) => (
                  <Chip
                    key={specialty.id}
                    testID={`discover-specialty-${specialty.id}`}
                    label={specialty.name}
                    selected={specialtyId === specialty.id}
                    onPress={() =>
                      setSpecialtyId(specialty.id === specialtyId ? undefined : specialty.id)
                    }
                  />
                ))}
              </ScrollView>
            </View>
          )}

          <DepartmentFilter selectedId={departmentId} onChange={setDepartmentId} />

          <HospitalFilter
            selectedId={hospitalId}
            selectedName={hospitalName}
            onChange={setHospitalId}
          />

          <Card
            tone="sunken"
            testID="discover-hospitals-card"
            onPress={() => navigation.navigate('Hospitals')}
            accessibilityLabel={t('discover.hospitalsCard.title')}
            accessibilityHint={t('discover.hospitalsCard.hint')}
          >
            <View style={[styles.row, { columnGap: theme.space[3] }]}>
              <Icon name="mapPin" size={20} color="primary" />
              <View style={styles.grow}>
                <Text variant="bodyStrong">{t('discover.hospitalsCard.title')}</Text>
                <Text variant="caption" color="textTertiary">
                  {t('discover.hospitalsCard.subtitle')}
                </Text>
              </View>
              <Icon name="forward" size={18} color="textTertiary" />
            </View>
          </Card>

          {recent.length === 0 || !isBrowsing ? null : (
            <Section title={t('discover.recent')}>
              <Card padded={false} testID="discover-recent">
                <View style={{ paddingHorizontal: theme.space[4] }}>
                  {recent.map((doctor, index) => (
                    <View key={doctor.id}>
                      {index === 0 ? null : <Divider />}
                      <ListItem
                        title={
                          doctor.title === null
                            ? doctor.fullName
                            : `${doctor.title} ${doctor.fullName}`
                        }
                        subtitle={doctor.specialty}
                        icon="user"
                        testID={`discover-recent-${doctor.id}`}
                        onPress={() =>
                          navigation.navigate('DoctorProfile', { doctorId: doctor.id })
                        }
                      />
                    </View>
                  ))}
                </View>
              </Card>
            </Section>
          )}

          <Section
            title={t('discover.doctors')}
            subtitle={
              doctors.data === undefined
                ? undefined
                : t('discover.doctors.count', { count: doctors.data.totalItems })
            }
          >
            {null}
          </Section>
        </>
      }
    />
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row' },
});
