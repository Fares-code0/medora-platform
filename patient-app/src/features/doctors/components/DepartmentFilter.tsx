import { ScrollView, StyleSheet, View } from 'react-native';

import { Chip, Text } from '@/components';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';

import { useDepartments } from '../hooks';

/**
 * Filter by department — checklist G-07.
 *
 * ── Half of this row has been live all along ─────────────────────────
 *
 * `GET /patient/doctors?departmentId=…` works today: the server accepts
 * the parameter and `http-doctor-service.ts` has sent it since BE-04.
 * What has never existed is the list to choose FROM —
 * `GET /patient/departments` is contract §3.4 P3.4 and is not built,
 * because `departments` belongs to the administration module (ADR-004,
 * M23) and reading it from the doctors module would misplace ownership.
 *
 * So this component is finished and the endpoint behind it is not, which
 * is the ordinary 🟨 shape. The day M23 lands, one refusal in
 * `http-doctor-service.ts` becomes a call and nothing here moves.
 *
 * ── Absent, not broken ───────────────────────────────────────────────
 *
 * When the list cannot be read the filter renders **nothing at all**.
 * Not an error card, not a disabled row, not "departments unavailable".
 *
 * That is a deliberate departure from how every other absent endpoint in
 * this app behaves, and the difference is what the surface is for: an
 * `AsyncBoundary` explains a failure on a screen whose PURPOSE has
 * failed — a records list with no records is worth a sentence. A
 * department filter is an *optional narrowing* of a search that is
 * already working. Turning it into an error would break a page that is
 * fine, to report the absence of a convenience, on a browse screen a
 * patient reaches by accident as often as on purpose.
 *
 * The rule that keeps this honest is that it degrades in exactly one
 * direction: search keeps working, unfiltered, and nothing on screen
 * claims a filter was applied.
 *
 * ── Why both chip rows are now labelled ──────────────────────────────
 *
 * Specialty chips (G-06) sat unlabelled while they were the only row —
 * "Cardiology, Dermatology…" under a search field reads as one thing.
 * Two unlabelled rows do not: a patient sees two lines of chips with
 * overlapping words (`Cardiology` is both a specialty and a department
 * here) and no way to tell what either one narrows. A label on each is
 * the smallest fix, and it is also what a screen reader needed before
 * there were two.
 */
export interface DepartmentFilterProps {
  readonly selectedId: string | undefined;
  readonly onChange: (departmentId: string | undefined) => void;
}

export function DepartmentFilter({ selectedId, onChange }: DepartmentFilterProps) {
  const theme = useTheme();
  const t = useT();
  const departments = useDepartments();

  // `data === undefined` covers pending AND error, which is the whole
  // policy: neither is worth a spinner or a sentence for a control that
  // is optional. An empty list is the same — a clinic with no
  // departments has nothing to filter by.
  if (departments.data === undefined || departments.data.length === 0) return null;

  return (
    <View style={{ rowGap: theme.space[1] }} testID="discover-department-filter">
      <Text variant="caption" color="textTertiary">
        {t('discover.department.label')}
      </Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.row, { columnGap: theme.space[2] }]}
      >
        <Chip
          label={t('discover.department.all')}
          selected={selectedId === undefined}
          onPress={() => onChange(undefined)}
          testID="discover-department-all"
        />
        {departments.data.map((department) => (
          <Chip
            key={department.id}
            testID={`discover-department-${department.id}`}
            label={department.name}
            selected={selectedId === department.id}
            // Tapping the selected chip clears it, the way the specialty
            // row does. A filter you can only change and never remove is
            // a filter a patient escapes by leaving the screen.
            onPress={() => onChange(department.id === selectedId ? undefined : department.id)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: 4 },
});
