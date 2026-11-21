import { Fact, FactGrid } from '@/components/patterns';
import { formatDate, formatTime } from '@/utils/dates';

import type { LabTest } from '../../model/types';
import { LabPriorityBadge, LabStatusBadge } from '../LabCells';

import { LabSectionCard } from './LabSectionCard';

const HOUR_MS = 3_600_000;

/** Turnaround from request to release, in a coarse "1 d 4 h" phrasing. */
function turnaround(requested: string, completed: string): string {
  const hours = Math.max(
    0,
    Math.round((new Date(completed).getTime() - new Date(requested).getTime()) / HOUR_MS),
  );
  if (hours < 24) return `${String(hours)} h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours === 0 ? `${String(days)} d` : `${String(days)} d ${String(remHours)} h`;
}

/** Test information — the order identity, lifecycle dates, and turnaround. */
export function LabTestInfoCard({ test }: { test: LabTest }) {
  return (
    <LabSectionCard title="Test information">
      <div className="flex flex-wrap items-center gap-2">
        <LabStatusBadge test={test} />
        <LabPriorityBadge test={test} />
      </div>
      <FactGrid>
        <Fact label="Test name">{test.testName}</Fact>
        <Fact label="Test code">
          <span className="font-mono">{test.testCode}</span>
        </Fact>
        <Fact label="Category">{test.category}</Fact>
        <Fact label="Requested">
          {formatDate(test.requestedDate)} · {formatTime(test.requestedDate)}
        </Fact>
        <Fact label="Collected">
          {test.collectedDate
            ? `${formatDate(test.collectedDate)} · ${formatTime(test.collectedDate)}`
            : 'Not collected'}
        </Fact>
        <Fact label="Completed">
          {test.completedDate
            ? `${formatDate(test.completedDate)} · ${formatTime(test.completedDate)}`
            : 'Pending'}
        </Fact>
        <Fact label="Turnaround">
          {test.completedDate ? (
            <span dir="ltr">{turnaround(test.requestedDate, test.completedDate)}</span>
          ) : (
            '—'
          )}
        </Fact>
      </FactGrid>
    </LabSectionCard>
  );
}
