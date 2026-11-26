import { useEffect, useState } from 'react';

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet, View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import { isolate } from '@/accessibility/bidi';
import { Card, Icon, Input, PagedList, Text } from '@/components';
import { useT } from '@/i18n';
import type { DiscoverStackParamList } from '@/navigation/routes';
import { useTheme } from '@/theme';

import { useHospitals } from '../hooks';

type Props = NativeStackScreenProps<DiscoverStackParamList, 'Hospitals'>;

const SEARCH_DEBOUNCE_MS = 300;

/**
 * The hospitals a patient can book at (`GET /patient/hospitals`).
 *
 * Search is server-side and debounced, like doctor search, and "Show
 * more" is a button rather than infinite scroll for the same reasons
 * (`DoctorResults`). A hospital with no address or no phone simply
 * shows less — nothing here fills a gap the server left.
 */
export function HospitalsScreen({ navigation }: Props) {
  const theme = useTheme();
  const t = useT();
  const [rawQuery, setRawQuery] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setQuery(rawQuery), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [rawQuery]);

  const hospitals = useHospitals(query);

  return (
    <PagedList
      testID="hospitals-screen"
      statesTestID="hospitals-list"
      query={hospitals}
      header={
        <>
          <Text variant="h1" {...headingA11y(t('hospitals.title'))}>
            {t('hospitals.title')}
          </Text>
          <Input
            label={t('hospitals.search.label')}
            testID="hospitals-search"
            value={rawQuery}
            onChangeText={setRawQuery}
            placeholder={t('hospitals.search.placeholder')}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
        </>
      }
      renderItem={(hospital) => {
        const counts = t('hospitals.card.counts', {
          clinics: hospital.clinicCount,
          departments: hospital.departmentCount,
        });
        return (
          <Card
            testID={`hospital-card-${hospital.id}`}
            onPress={() =>
              navigation.navigate('Hospital', {
                hospitalId: hospital.id,
                hospitalName: hospital.name,
              })
            }
            accessibilityLabel={
              hospital.city === null
                ? t('hospitals.card.a11y', { name: isolate(hospital.name), counts })
                : t('hospitals.card.a11yCity', {
                    name: isolate(hospital.name),
                    city: isolate(hospital.city),
                    counts,
                  })
            }
            accessibilityHint={t('hospitals.card.hint')}
          >
            <View style={[styles.row, { columnGap: theme.space[3] }]}>
              <Icon name="mapPin" size={20} color="primary" />
              <View style={[styles.grow, { rowGap: theme.space[1] }]}>
                <Text variant="bodyStrong">{hospital.name}</Text>
                {hospital.city === null ? null : (
                  <Text variant="bodySm" color="textSecondary">
                    {hospital.city}
                  </Text>
                )}
                <Text variant="caption" color="textTertiary">
                  {counts}
                </Text>
              </View>
              <Icon name="forward" size={18} color="textTertiary" />
            </View>
          </Card>
        );
      }}
      empty={{ icon: 'search', title: t('hospitals.empty.title'), body: t('hospitals.empty.body') }}
      paging={{
        testIDPrefix: 'hospitals',
        statusTestIDPrefix: 'hospitals-list',
        loadMoreLabel: t('hospitals.loadMore'),
        loadMoreHint: t('hospitals.loadMore.hint', {
          shown: hospitals.data?.items.length ?? 0,
          total: hospitals.data?.totalItems ?? 0,
        }),
        endLabel: t('hospitals.end', { total: hospitals.data?.totalItems ?? 0 }),
      }}
    />
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row' },
});
