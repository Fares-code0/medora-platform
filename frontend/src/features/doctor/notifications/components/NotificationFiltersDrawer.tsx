import { Stack } from '@/components/layout';
import { Button, Drawer, Input, Select, type SelectOption } from '@/components/ui';

import { isValidDateKey, type NotificationListFilters } from '../model/filters';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_META,
  NOTIFICATION_KINDS,
  NOTIFICATION_KIND_META,
  NOTIFICATION_PRIORITIES,
  NOTIFICATION_PRIORITY_META,
  NOTIFICATION_STATUS_FILTERS,
  NOTIFICATION_STATUS_LABELS,
} from '../model/types';

/**
 * Advanced filters drawer (UX P1). Selections apply immediately to the
 * URL state; "Clear filters" resets everything. Status defaults to the
 * inbox view (unarchived).
 */

const ALL = 'all';

function withAll(allLabel: string, options: readonly SelectOption[]): readonly SelectOption[] {
  return [{ value: ALL, label: allLabel }, ...options];
}

export interface NotificationFiltersDrawerProps {
  open: boolean;
  onClose: () => void;
  filters: NotificationListFilters;
  onFilterChange: <K extends keyof NotificationListFilters>(
    key: K,
    value: NotificationListFilters[K] | null,
  ) => void;
  onClear: () => void;
}

export function NotificationFiltersDrawer({
  open,
  onClose,
  filters,
  onFilterChange,
  onClear,
}: NotificationFiltersDrawerProps) {
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
      title="Filter notifications"
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
          options={NOTIFICATION_STATUS_FILTERS.map((status) => ({
            value: status,
            label: NOTIFICATION_STATUS_LABELS[status],
          }))}
          value={filters.status}
          onChange={(value) => onFilterChange('status', value as NotificationListFilters['status'])}
        />
        <Select
          label="Category"
          options={withAll(
            'All categories',
            NOTIFICATION_CATEGORIES.map((category) => ({
              value: category,
              label: NOTIFICATION_CATEGORY_META[category].label,
            })),
          )}
          value={filters.category ?? ALL}
          onChange={(value) =>
            onFilterChange(
              'category',
              value === ALL ? null : (value as NotificationListFilters['category']),
            )
          }
        />
        <Select
          label="Priority"
          options={withAll(
            'All priorities',
            NOTIFICATION_PRIORITIES.map((priority) => ({
              value: priority,
              label: NOTIFICATION_PRIORITY_META[priority].label,
            })),
          )}
          value={filters.priority ?? ALL}
          onChange={(value) =>
            onFilterChange(
              'priority',
              value === ALL ? null : (value as NotificationListFilters['priority']),
            )
          }
        />
        <Select
          label="Type"
          options={withAll(
            'All types',
            NOTIFICATION_KINDS.map((kind) => ({
              value: kind,
              label: NOTIFICATION_KIND_META[kind].label,
            })),
          )}
          value={filters.kind ?? ALL}
          onChange={(value) =>
            onFilterChange(
              'kind',
              value === ALL ? null : (value as NotificationListFilters['kind']),
            )
          }
        />
        <Input type="date" label="Received from" {...bindDate('from')} />
        <Input type="date" label="Received to" {...bindDate('to')} />
      </Stack>
    </Drawer>
  );
}
