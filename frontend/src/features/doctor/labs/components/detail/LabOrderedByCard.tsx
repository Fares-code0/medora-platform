import { Fact, FactGrid } from '@/components/patterns';
import { formatDate, formatTime } from '@/utils/dates';

import type { LabTest } from '../../model/types';

import { LabSectionCard } from './LabSectionCard';

/** Ordered by — who requested the test, from where, and why. */
export function LabOrderedByCard({ test }: { test: LabTest }) {
  return (
    <LabSectionCard title="Ordered by">
      <FactGrid>
        <Fact label="Ordering doctor">{test.orderedBy}</Fact>
        <Fact label="Department">{test.department}</Fact>
        <Fact label="Order placed">
          {formatDate(test.requestedDate)} · {formatTime(test.requestedDate)}
        </Fact>
        <Fact label="Clinical indication">{test.clinicalIndication}</Fact>
      </FactGrid>
    </LabSectionCard>
  );
}
