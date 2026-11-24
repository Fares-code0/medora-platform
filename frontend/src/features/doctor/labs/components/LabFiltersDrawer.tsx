import { Stack } from '@/components/layout';
import { Button, Drawer, Input, Select, type SelectOption } from '@/components/ui';
import { useT } from '@/i18n';

import {
  LAB_FLAG_FILTERS,
  LAB_FLAG_FILTER_META,
  LAB_REVIEW_FILTERS,
  LAB_REVIEW_FILTER_META,
  isValidDateKey,
  type LabListFilters,
} from '../model/filters';
import {
  LAB_CATEGORIES,
  LAB_DEPARTMENTS,
  LAB_PRIORITIES,
  LAB_PRIORITY_META,
  LAB_STATUSES,
  LAB_STATUS_META,
} from '../model/types';

/**
 * Advanced filters drawer (UX P1). Selections apply immediately to the
 * URL state; "Clear filters" resets everything (including the deep-link
 * `patient` filter, whose chip lives in the FilterBar).
 *
 * D-10 added the two controls UX §2.6's toolbar names and this drawer never
 * had: **result flag** and **review status**. Flag replaced the old
 * "Critical results only" switch — same idea, one more useful value, and one
 * control instead of a select and a toggle that overlapped.
 */

const ALL = 'all';

function withAll(allLabel: string, options: readonly SelectOption[]): readonly SelectOption[] {
  return [{ value: ALL, label: allLabel }, ...options];
}

export interface LabFiltersDrawerProps {
  open: boolean;
  /** The doctors the loaded orders name — the options, so none is invented. */
  doctors: readonly string[];
  onClose: () => void;
  filters: LabListFilters;
  onFilterChange: <
    K extends
      | 'status'
      | 'category'
      | 'priority'
      | 'department'
      | 'doctor'
      | 'flag'
      | 'review'
      | 'from'
      | 'to',
  >(
    key: K,
    value: LabListFilters[K] | null,
  ) => void;
  onClear: () => void;
}

export function LabFiltersDrawer({
  doctors,
  open,
  onClose,
  filters,
  onFilterChange,
  onClear,
}: LabFiltersDrawerProps) {
  const t = useT();
  const bindSelect = <
    K extends 'status' | 'category' | 'priority' | 'department' | 'doctor' | 'flag' | 'review',
  >(
    key: K,
  ) => ({
    value: filters[key] ?? ALL,
    onChange: (value: string) =>
      onFilterChange(key, value === ALL ? null : (value as NonNullable<LabListFilters[K]>)),
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
      title="Filter laboratory tests"
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
            LAB_STATUSES.map((status) => ({
              value: status,
              label: t(LAB_STATUS_META[status].labelKey),
            })),
          )}
          {...bindSelect('status')}
        />
        <Select
          label="Test category"
          options={withAll(
            'All categories',
            LAB_CATEGORIES.map((category) => ({ value: category, label: category })),
          )}
          {...bindSelect('category')}
        />
        <Select
          label="Priority"
          options={withAll(
            'All priorities',
            LAB_PRIORITIES.map((priority) => ({
              value: priority,
              label: t(LAB_PRIORITY_META[priority].labelKey),
            })),
          )}
          {...bindSelect('priority')}
        />
        <Select
          label="Department"
          options={withAll(
            'All departments',
            LAB_DEPARTMENTS.map((department) => ({ value: department, label: department })),
          )}
          {...bindSelect('department')}
        />
        <Select
          label="Ordered by"
          options={withAll(
            'All doctors',
            doctors.map((doctor) => ({ value: doctor, label: doctor })),
          )}
          {...bindSelect('doctor')}
        />
        <Select
          label="Result flag"
          helperText="Applies to released results; orders still in the lab match none of the three."
          options={withAll(
            'Any flag',
            LAB_FLAG_FILTERS.map((flag) => ({
              value: flag,
              label: LAB_FLAG_FILTER_META[flag].label,
            })),
          )}
          {...bindSelect('flag')}
        />
        <Select
          label="Review status"
          options={withAll(
            'Any review status',
            LAB_REVIEW_FILTERS.map((review) => ({
              value: review,
              label: LAB_REVIEW_FILTER_META[review].label,
            })),
          )}
          {...bindSelect('review')}
        />
        <Input type="date" label="Requested from" {...bindDate('from')} />
        <Input type="date" label="Requested to" {...bindDate('to')} />
      </Stack>
    </Drawer>
  );
}
