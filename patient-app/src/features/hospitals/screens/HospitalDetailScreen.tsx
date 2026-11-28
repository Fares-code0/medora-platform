import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet, View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import { AsyncBoundary, Badge, Button, Card, Divider, Screen, Section, Text } from '@/components';
import { SkeletonCard } from '@/components/feedback/Skeleton';
import { dial, isDialable, openMap } from '@/features/emergency/dial';
import { useT } from '@/i18n';
import type { DiscoverStackParamList } from '@/navigation/routes';
import { useTheme } from '@/theme';

import { useHospital } from '../hooks';

type Props = NativeStackScreenProps<DiscoverStackParamList, 'Hospital'>;

/**
 * One hospital (`GET /patient/hospitals/{id}`).
 *
 * Every section renders only when the server sent something for it. The
 * phone button follows the Clinic screen's rule — it exists only for a
 * dialable number — and "Find doctors here" opens Discover filtered by
 * this hospital, which is the route into booking.
 */
export function HospitalDetailScreen({ navigation, route }: Props) {
  const theme = useTheme();
  const t = useT();
  const hospital = useHospital(route.params.hospitalId);

  const heading = hospital.data?.name ?? route.params.hospitalName ?? t('nav.title.hospital');

  return (
    <Screen
      testID="hospital-screen"
      onRefresh={() => void hospital.refetch()}
      refreshing={hospital.isRefetching}
    >
      <Text variant="h1" {...headingA11y(heading)}>
        {heading}
      </Text>

      <AsyncBoundary query={hospital} testID="hospital-detail" loading={<SkeletonCard />}>
        {(data) => (
          <View style={{ rowGap: theme.space[5] }}>
            {data.description === null ? null : (
              <Text variant="body" color="textSecondary">
                {data.description}
              </Text>
            )}

            <View style={{ rowGap: theme.space[2] }}>
              <Button
                label={t('hospital.findDoctors')}
                size="lg"
                fullWidth
                icon="search"
                testID="hospital-find-doctors"
                onPress={() =>
                  navigation.navigate('DiscoverRoot', {
                    hospitalId: data.id,
                    hospitalName: data.name,
                  })
                }
              />
              {data.phone === null || !isDialable(data.phone) ? null : (
                <Button
                  label={t('hospital.call', { phone: data.phone })}
                  tone="secondary"
                  icon="phone"
                  fullWidth
                  testID="hospital-call"
                  onPress={() => {
                    if (data.phone !== null) void dial(data.phone);
                  }}
                />
              )}
            </View>

            {data.locations.length === 0 ? null : (
              <Section title={t('hospital.locations')}>
                <Card padded={false} testID="hospital-locations">
                  {data.locations.map((location, index) => {
                    const address = [location.addressLine, location.city]
                      .filter((part): part is string => part !== null)
                      .join(', ');
                    return (
                      <View key={location.id}>
                        {index === 0 ? null : <Divider />}
                        <View style={{ padding: theme.space[4], rowGap: theme.space[2] }}>
                          <Text variant="bodyStrong">{location.name}</Text>
                          {address === '' ? null : (
                            <Text variant="bodySm" color="textSecondary">
                              {address}
                            </Text>
                          )}
                          {address === '' ? null : (
                            <Button
                              label={t('hospital.openMap')}
                              tone="secondary"
                              size="sm"
                              icon="mapPin"
                              testID={`hospital-map-${location.id}`}
                              onPress={() => void openMap(address)}
                            />
                          )}
                        </View>
                      </View>
                    );
                  })}
                </Card>
              </Section>
            )}

            {data.clinics.length === 0 ? null : (
              <Section title={t('hospital.clinics')}>
                <View style={[styles.wrap, { columnGap: theme.space[2], rowGap: theme.space[2] }]}>
                  {data.clinics.map((clinic) => (
                    <Badge key={clinic.id} label={clinic.name} />
                  ))}
                </View>
              </Section>
            )}

            {data.departments.length === 0 ? null : (
              <Section title={t('hospital.departments')}>
                <View style={[styles.wrap, { columnGap: theme.space[2], rowGap: theme.space[2] }]}>
                  {data.departments.map((department) => (
                    <Badge key={department.id} label={department.name} tone="primary" />
                  ))}
                </View>
              </Section>
            )}

            {data.specialties.length === 0 ? null : (
              <Section title={t('hospital.specialties')}>
                <View style={[styles.wrap, { columnGap: theme.space[2], rowGap: theme.space[2] }]}>
                  {data.specialties.map((specialty) => (
                    <Badge key={specialty.id} label={specialty.name} tone="info" />
                  ))}
                </View>
              </Section>
            )}
          </View>
        )}
      </AsyncBoundary>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
});
