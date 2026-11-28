import { ScrollView, StyleSheet, View } from 'react-native';

import { Chip, Text } from '@/components';
import { useHospitals } from '@/features/hospitals/hooks';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';

/**
 * Filter doctors by hospital — the first page of `GET /patient/hospitals`.
 *
 * Like `DepartmentFilter`, it renders NOTHING when the list cannot be read
 * or has fewer than two hospitals to choose between: a filter is an
 * optional narrowing of a search that already works, and an error card
 * here would break a page that is fine. The one exception is a hospital
 * the patient arrived with (from its own screen): that selection is
 * always shown, by name, so the filter in force is never invisible.
 */
export interface HospitalFilterProps {
  readonly selectedId: string | undefined;
  /** The name that came with a hospital opened from its own screen. */
  readonly selectedName: string | undefined;
  readonly onChange: (hospitalId: string | undefined) => void;
}

export function HospitalFilter({ selectedId, selectedName, onChange }: HospitalFilterProps) {
  const theme = useTheme();
  const t = useT();
  const hospitals = useHospitals();

  const loaded = hospitals.data?.items ?? [];
  const known = loaded.some((hospital) => hospital.id === selectedId);
  const options =
    selectedId !== undefined && !known && selectedName !== undefined
      ? [{ id: selectedId, name: selectedName }, ...loaded]
      : loaded;

  if (options.length < 2 && selectedId === undefined) return null;

  return (
    <View style={{ rowGap: theme.space[1] }} testID="discover-hospital-filter">
      <Text variant="caption" color="textTertiary">
        {t('discover.hospital.label')}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.row, { columnGap: theme.space[2] }]}
      >
        <Chip
          label={t('discover.hospital.all')}
          selected={selectedId === undefined}
          onPress={() => onChange(undefined)}
          testID="discover-hospital-all"
        />
        {options.map((hospital) => (
          <Chip
            key={hospital.id}
            testID={`discover-hospital-${hospital.id}`}
            label={hospital.name}
            selected={selectedId === hospital.id}
            onPress={() => onChange(hospital.id === selectedId ? undefined : hospital.id)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: 4 },
});
