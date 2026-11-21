import { Stack } from '@/components/layout';
import { Button, Drawer, Input, Select, type SelectOption } from '@/components/ui';

import { isValidDateKey, type MedicalRecordListFilters } from '../model/filters';
import {
  DIAGNOSES,
  RECORD_DEPARTMENTS,
  RECORD_PRIORITIES,
  RECORD_PRIORITY_META,
  RECORD_STATUSES,
  RECORD_STATUS_META,
  RECORD_VISIT_TYPES,
} from '../model/types';

/**
 * Advanced filters drawer (UX P1). Selections apply immediately to the
 * URL state; "Clear filters" resets everything (including the Patient
 * Profile deep-link `patient` filter, whose chip lives in the FilterBar).
 */

const ALL = 'all';

function withAll(allLabel: string, options: readonly SelectOption[]): readonly SelectOption[] {
  return [{ value: ALL, label: allLabel }, ...options];
}

export interface MedicalRecordFiltersDrawerProps {
  open: boolean;
  /** The doctors the loaded rows name — the options, so none is invented. */
  doctors: readonly string[];
  onClose: () => void;
  filters: MedicalRecordListFilters;
  onFilterChange: <K extends keyof MedicalRecordListFilters>(
    key: K,
    value: MedicalRecordListFilters[K] | null,
  ) => void;
  onClear: () => void;
}

export function MedicalRecordFiltersDrawer({
  doctors,
  open,
  onClose,
  filters,
  onFilterChange,
  onClear,
}: MedicalRecordFiltersDrawerProps) {
  const bindSelect = <
    K extends 'status' | 'diagnosis' | 'department' | 'doctor' | 'visitType' | 'priority',
  >(
    key: K,
  ) => ({
    value: filters[key] ?? ALL,
    onChange: (value: string) =>
      onFilterChange(
        key,
        value === ALL ? null : (value as NonNullable<MedicalRecordListFilters[K]>),
      ),
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
      title="Filter medical records"
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
          label="Record status"
          options={withAll(
            'All statuses',
            RECORD_STATUSES.map((status) => ({
              value: status,
              label: RECORD_STATUS_META[status].label,
            })),
          )}
          {...bindSelect('status')}
        />
        <Select
          label="Diagnosis"
          options={withAll(
            'All diagnoses',
            DIAGNOSES.map((diagnosis) => ({
              value: diagnosis.label,
              label: `${diagnosis.label} (${diagnosis.code})`,
            })),
          )}
          {...bindSelect('diagnosis')}
        />
        <Select
          label="Department"
          options={withAll(
            'All departments',
            RECORD_DEPARTMENTS.map((department) => ({ value: department, label: department })),
          )}
          {...bindSelect('department')}
        />
        <Select
          label="Doctor"
          options={withAll(
            'All doctors',
            doctors.map((doctor) => ({ value: doctor, label: doctor })),
          )}
          {...bindSelect('doctor')}
        />
        <Input type="date" label="Visits from" {...bindDate('from')} />
        <Input type="date" label="Visits to" {...bindDate('to')} />
        <Select
          label="Visit type"
          options={withAll(
            'All types',
            RECORD_VISIT_TYPES.map((type) => ({ value: type, label: type })),
          )}
          {...bindSelect('visitType')}
        />
        <Select
          label="Priority"
          options={withAll(
            'All priorities',
            RECORD_PRIORITIES.map((priority) => ({
              value: priority,
              label: RECORD_PRIORITY_META[priority].label,
            })),
          )}
          {...bindSelect('priority')}
        />
      </Stack>
    </Drawer>
  );
}
