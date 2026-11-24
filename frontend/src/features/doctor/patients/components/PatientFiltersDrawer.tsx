import { Stack } from '@/components/layout';
import { Button, Drawer, Select, type SelectOption } from '@/components/ui';
import {
  BLOOD_TYPES,
  CHRONIC_CONDITIONS,
  PATIENT_STATUSES,
  PATIENT_STATUS_META,
} from '@/features/shared-domain/patient-identity';
import { useT } from '@/i18n';

import {
  AGE_RANGE_LABELS,
  ALLERGY_LABELS,
  LAST_VISIT_LABELS,
  UPCOMING_LABELS,
  type PatientListFilters,
} from '../model/filters';

/**
 * Advanced filters drawer (UX P1: the filter button opens a filter
 * drawer). Selections apply immediately to the URL state, so the list
 * updates live behind the drawer; "Clear filters" resets everything.
 */

const ALL = 'all';

/** Prepend the "All …" reset option to a value list. */
function withAll(allLabel: string, options: readonly SelectOption[]): readonly SelectOption[] {
  return [{ value: ALL, label: allLabel }, ...options];
}

function fromRecord(labels: Record<string, string>): readonly SelectOption[] {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}

export interface PatientFiltersDrawerProps {
  open: boolean;
  onClose: () => void;
  filters: PatientListFilters;
  onFilterChange: <K extends keyof PatientListFilters>(
    key: K,
    value: PatientListFilters[K] | null,
  ) => void;
  onClear: () => void;
}

export function PatientFiltersDrawer({
  open,
  onClose,
  filters,
  onFilterChange,
  onClear,
}: PatientFiltersDrawerProps) {
  const t = useT();
  const bind = <K extends keyof PatientListFilters>(key: K) => ({
    value: filters[key] ?? ALL,
    onChange: (value: string) =>
      onFilterChange(key, value === ALL ? null : (value as NonNullable<PatientListFilters[K]>)),
  });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Filter patients"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClear}>
            Clear filters
          </Button>
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      <Stack gap={5}>
        <Select
          label="Gender"
          options={withAll('All genders', [
            { value: 'female', label: 'Female' },
            { value: 'male', label: 'Male' },
          ])}
          {...bind('gender')}
        />
        <Select
          label="Age range"
          options={withAll('All ages', fromRecord(AGE_RANGE_LABELS))}
          {...bind('ageRange')}
        />
        <Select
          label="Blood type"
          options={withAll(
            'All blood types',
            BLOOD_TYPES.map((type) => ({ value: type, label: type })),
          )}
          {...bind('bloodType')}
        />
        <Select
          label="Patient status"
          options={withAll(
            'All statuses',
            PATIENT_STATUSES.map((status) => ({
              value: status,
              label: t(PATIENT_STATUS_META[status].labelKey),
            })),
          )}
          {...bind('status')}
        />
        <Select
          label="Last visit"
          options={withAll('Any time', fromRecord(LAST_VISIT_LABELS))}
          {...bind('lastVisit')}
        />
        <Select
          label="Upcoming appointment"
          options={withAll('Any', fromRecord(UPCOMING_LABELS))}
          {...bind('upcoming')}
        />
        <Select
          label="Chronic disease"
          options={withAll(
            'All conditions',
            CHRONIC_CONDITIONS.map((condition) => ({ value: condition, label: condition })),
          )}
          {...bind('condition')}
        />
        <Select
          label="Allergies"
          options={withAll('Any', fromRecord(ALLERGY_LABELS))}
          {...bind('allergy')}
        />
      </Stack>
    </Drawer>
  );
}
