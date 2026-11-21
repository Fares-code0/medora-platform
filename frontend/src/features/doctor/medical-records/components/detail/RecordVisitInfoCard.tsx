import { Fact, FactGrid } from '@/components/patterns';
import { formatDate, relativeDayLabel } from '@/utils/dates';

import type { MedicalRecord } from '../../model/types';
import { RecordPriorityBadge, RecordStatusBadge } from '../MedicalRecordCells';

import { RecordSectionCard } from './RecordSectionCard';

/** Visit information — encounter metadata plus record lifecycle dates. */
export function RecordVisitInfoCard({ record }: { record: MedicalRecord }) {
  return (
    <RecordSectionCard title="Visit information">
      <div className="flex flex-wrap items-center gap-2">
        <RecordStatusBadge record={record} />
        <RecordPriorityBadge record={record} />
      </div>
      <FactGrid>
        {/* A day, not an instant — the records service stores no visit time. */}
        <Fact label="Visit date">{formatDate(record.visitDate)}</Fact>
        <Fact label="Visit type">{record.visitType}</Fact>
        <Fact label="Department">{record.department}</Fact>
        <Fact label="Doctor">{record.doctor}</Fact>
        <Fact label="Follow-up">
          {record.followUpDate ? formatDate(record.followUpDate) : 'Not scheduled'}
        </Fact>
        <Fact label="Created">{formatDate(record.createdAt)}</Fact>
        <Fact label="Last updated">
          {formatDate(record.updatedAt)} · {relativeDayLabel(record.updatedAt)}
        </Fact>
      </FactGrid>
    </RecordSectionCard>
  );
}
