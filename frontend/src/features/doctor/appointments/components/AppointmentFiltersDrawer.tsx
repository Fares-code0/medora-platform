import { Stack } from '@/components/layout';
import { Button, Checkbox, Drawer, Input, Select, type SelectOption } from '@/components/ui';

import { isValidDateKey } from '../model/calendar';
import type { AppointmentListFilters } from '../model/filters';
import {
  APPOINTMENT_PRIORITIES,
  APPOINTMENT_PRIORITY_META,
  APPOINTMENT_STATUSES,
  APPOINTMENT_STATUS_META,
  DEPARTMENTS,
  VISIT_TYPES,
} from '../model/types';

/**
 * Advanced filters drawer (UX P1). Selections apply immediately to the
 * URL state; "Clear filters" resets everything.
 */

const ALL = 'all';

function withAll(allLabel: string, options: readonly SelectOption[]): readonly SelectOption[] {
  return [{ value: ALL, label: allLabel }, ...options];
}

export interface AppointmentFiltersDrawerProps {
  open: boolean;
  /** The doctors the loaded rows name — the options, so none is invented. */
  doctors: readonly string[];
  onClose: () => void;
  filters: AppointmentListFilters;
  onFilterChange: <K extends keyof AppointmentListFilters>(
    key: K,
    value: AppointmentListFilters[K] | null,
  ) => void;
  onClear: () => void;
}

export function AppointmentFiltersDrawer({
  doctors,
  open,
  onClose,
  filters,
  onFilterChange,
  onClear,
}: AppointmentFiltersDrawerProps) {
  const bindSelect = <K extends 'status' | 'doctor' | 'department' | 'visitType' | 'priority'>(
    key: K,
  ) => ({
    value: filters[key] ?? ALL,
    onChange: (value: string) =>
      onFilterChange(key, value === ALL ? null : (value as NonNullable<AppointmentListFilters[K]>)),
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
      title="Filter appointments"
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
          label="Status"
          options={withAll(
            'All statuses',
            APPOINTMENT_STATUSES.map((status) => ({
              value: status,
              label: APPOINTMENT_STATUS_META[status].label,
            })),
          )}
          {...bindSelect('status')}
        />
        <Select
          label="Doctor"
          options={withAll(
            'All doctors',
            doctors.map((doctor) => ({ value: doctor, label: doctor })),
          )}
          {...bindSelect('doctor')}
        />
        <Select
          label="Department"
          options={withAll(
            'All departments',
            DEPARTMENTS.map((department) => ({ value: department, label: department })),
          )}
          {...bindSelect('department')}
        />
        <Input type="date" label="From date" {...bindDate('from')} />
        <Input type="date" label="To date" {...bindDate('to')} />
        <Select
          label="Visit type"
          options={withAll(
            'All types',
            VISIT_TYPES.map((type) => ({ value: type, label: type })),
          )}
          {...bindSelect('visitType')}
        />
        <Select
          label="Priority"
          options={withAll(
            'All priorities',
            APPOINTMENT_PRIORITIES.map((priority) => ({
              value: priority,
              label: APPOINTMENT_PRIORITY_META[priority].label,
            })),
          )}
          {...bindSelect('priority')}
        />
        <Checkbox
          label="New patients only"
          checked={filters.newPatient}
          onChange={(event) => onFilterChange('newPatient', event.target.checked ? true : null)}
        />
        <Checkbox
          label="Follow-ups only"
          checked={filters.followUp}
          onChange={(event) => onFilterChange('followUp', event.target.checked ? true : null)}
        />
      </Stack>
    </Drawer>
  );
}
