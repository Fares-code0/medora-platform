import { Stack } from '@/components/layout';
import { Button, Drawer, Input, Select, type SelectOption } from '@/components/ui';
import { isolateLtr } from '@/i18n';

import type { AdvancedFilterKey } from '../model/reports-service';
import type { ReportFilters } from '../model/types';
import { reportsService } from '../service';

/**
 * Advanced filters drawer — the analytics slice controls (department, status,
 * medication, lab test, age, gender) plus the custom date range. Patient and
 * Doctor filters are intentionally excluded: a doctor only sees their own
 * analytics. Each change updates the URL-owned filters, so the charts refetch
 * a narrower snapshot immediately.
 */

const STATUS_OPTIONS = ['Completed', 'In progress', 'Pending', 'Critical', 'Cancelled'];
const MEDICATION_OPTIONS = [
  'Antibiotics',
  'Analgesics',
  'Cardiovascular',
  'Antidiabetic',
  'Respiratory',
];
const LAB_TEST_OPTIONS = ['CBC', 'Lipid panel', 'HbA1c', 'Metabolic panel', 'Thyroid'];

const ALL_FILTERS: readonly AdvancedFilterKey[] = [
  'department',
  'status',
  'medication',
  'labTest',
  'age',
  'gender',
];

function options(all: readonly string[], allLabel: string): SelectOption[] {
  return [{ value: 'all', label: allLabel }, ...all.map((value) => ({ value, label: value }))];
}

export interface ReportsFiltersDrawerProps {
  open: boolean;
  onClose: () => void;
  filters: ReportFilters;
  onFilter: (key: keyof ReportFilters, value: string) => void;
  onCustomRange: (from: string | null, to: string | null) => void;
  onClear: () => void;
}

export function ReportsFiltersDrawer({
  open,
  onClose,
  filters,
  onFilter,
  onCustomRange,
  onClear,
}: ReportsFiltersDrawerProps) {
  // Only what the source applies is offered: an unapplied filter would draw
  // an unfiltered chart under a filter the doctor believes is on.
  const supported = reportsService.capabilities.advancedFilters;
  const applies = (key: AdvancedFilterKey) => supported.includes(key);
  const unapplied = ALL_FILTERS.filter((key) => !applies(key));
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Advanced filters"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClear}>
            Clear all
          </Button>
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      <Stack gap={4}>
        {unapplied.length > 0 ? (
          <p className="text-body-sm text-text-secondary">
            The Medora server filters these reports by age band and gender only.
          </p>
        ) : null}
        {filters.range === 'custom' ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              type="date"
              label="From"
              value={filters.customFrom ?? ''}
              onChange={(event) => onCustomRange(event.target.value || null, filters.customTo)}
            />
            <Input
              type="date"
              label="To"
              value={filters.customTo ?? ''}
              onChange={(event) => onCustomRange(filters.customFrom, event.target.value || null)}
            />
          </div>
        ) : null}

        {applies('department') ? (
          <Select
            label="Department"
            value={filters.department}
            onChange={(value) => onFilter('department', value)}
            options={options(reportsService.capabilities.departmentOptions, 'All departments')}
          />
        ) : null}
        {applies('status') ? (
          <Select
            label="Status"
            value={filters.status}
            onChange={(value) => onFilter('status', value)}
            options={options(STATUS_OPTIONS, 'Any status')}
          />
        ) : null}
        {applies('medication') ? (
          <Select
            label="Medication class"
            value={filters.medication}
            onChange={(value) => onFilter('medication', value)}
            options={options(MEDICATION_OPTIONS, 'All medications')}
          />
        ) : null}
        {applies('labTest') ? (
          <Select
            label="Lab test"
            value={filters.labTest}
            onChange={(value) => onFilter('labTest', value)}
            options={options(LAB_TEST_OPTIONS, 'All lab tests')}
          />
        ) : null}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            label="Age band"
            value={filters.age}
            onChange={(value) => onFilter('age', value)}
            options={[
              { value: 'all', label: 'All ages' },
              { value: '0-17', label: '0–17' },
              { value: '18-39', label: '18–39' },
              { value: '40-64', label: '40–64' },
              // "65+" ends in a sign, so an RTL page would show "+65" (NEW-32).
              { value: '65+', label: isolateLtr('65+') },
            ]}
          />
          <Select
            label="Gender"
            value={filters.gender}
            onChange={(value) => onFilter('gender', value)}
            options={[
              { value: 'all', label: 'All' },
              { value: 'female', label: 'Female' },
              { value: 'male', label: 'Male' },
            ]}
          />
        </div>
      </Stack>
    </Drawer>
  );
}
