import { Stack } from '@/components/layout';
import { Button, Drawer, Input, Select, Switch, type SelectOption } from '@/components/ui';
import { useT } from '@/i18n';

import { isValidDateKey, type PharmacyListFilters } from '../model/filters';
import {
  MEDICATION_CATEGORIES,
  PRESCRIPTION_STATUSES,
  PRESCRIPTION_STATUS_META,
  REFILL_STATUSES,
  REFILL_STATUS_META,
} from '../model/types';

/**
 * Advanced filters drawer (UX P1). Selections apply immediately to the
 * URL state; "Clear filters" resets everything (including the deep-link
 * `patient` filter and the two boolean toggles, whose chips live in the
 * FilterBar).
 */

const ALL = 'all';

function withAll(allLabel: string, options: readonly SelectOption[]): readonly SelectOption[] {
  return [{ value: ALL, label: allLabel }, ...options];
}

export interface PharmacyFiltersDrawerProps {
  open: boolean;
  /** The doctors the loaded rows name — the options, so none is invented. */
  doctors: readonly string[];
  onClose: () => void;
  filters: PharmacyListFilters;
  onFilterChange: <K extends 'status' | 'category' | 'doctor' | 'refillStatus' | 'from' | 'to'>(
    key: K,
    value: PharmacyListFilters[K] | null,
  ) => void;
  onBooleanChange: (key: 'highRisk' | 'controlled', value: boolean) => void;
  onClear: () => void;
}

export function PharmacyFiltersDrawer({
  doctors,
  open,
  onClose,
  filters,
  onFilterChange,
  onBooleanChange,
  onClear,
}: PharmacyFiltersDrawerProps) {
  const t = useT();
  const bindSelect = <K extends 'status' | 'category' | 'doctor' | 'refillStatus'>(key: K) => ({
    value: filters[key] ?? ALL,
    onChange: (value: string) =>
      onFilterChange(key, value === ALL ? null : (value as NonNullable<PharmacyListFilters[K]>)),
  });

  const bindDate = (key: 'from' | 'to') => ({
    value: filters[key] ?? '',
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      const raw = event.target.value;
      onFilterChange(key, raw !== '' && isValidDateKey(raw) ? raw : null);
    },
  });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Filter prescriptions"
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
          label="Prescription status"
          options={withAll(
            'All statuses',
            PRESCRIPTION_STATUSES.map((status) => ({
              value: status,
              label: t(PRESCRIPTION_STATUS_META[status].labelKey),
            })),
          )}
          {...bindSelect('status')}
        />
        <Select
          label="Medication category"
          options={withAll(
            'All categories',
            MEDICATION_CATEGORIES.map((category) => ({ value: category, label: category })),
          )}
          {...bindSelect('category')}
        />
        <Select
          label="Prescribing doctor"
          options={withAll(
            'All doctors',
            doctors.map((doctor) => ({ value: doctor, label: doctor })),
          )}
          {...bindSelect('doctor')}
        />
        <Select
          label="Refill status"
          options={withAll(
            'All refill states',
            REFILL_STATUSES.map((status) => ({
              value: status,
              label: t(REFILL_STATUS_META[status].labelKey),
            })),
          )}
          {...bindSelect('refillStatus')}
        />
        <Input type="date" label="Start date from" {...bindDate('from')} />
        <Input type="date" label="Start date to" {...bindDate('to')} />
        <Switch
          label="High-risk medications only"
          description="Show only high-alert medications (anticoagulants, insulin, opioids)."
          checked={filters.highRisk}
          onCheckedChange={(value) => onBooleanChange('highRisk', value)}
        />
        <Switch
          label="Controlled medications only"
          description="Show only controlled substances."
          checked={filters.controlled}
          onCheckedChange={(value) => onBooleanChange('controlled', value)}
        />
      </Stack>
    </Drawer>
  );
}
