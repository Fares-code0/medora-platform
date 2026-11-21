import { Fact, FactGrid } from '@/components/patterns';
import { Badge } from '@/components/ui';
import { formatDate, formatTime } from '@/utils/dates';

import type { LabTest } from '../../model/types';

import { EmptySectionNote, LabSectionCard } from './LabSectionCard';

/** Specimen information — collection and receipt details for the sample. */
export function LabSpecimenSection({ test }: { test: LabTest }) {
  const { specimen } = test;
  const conditionAbnormal = specimen !== null && specimen.condition !== 'Acceptable';

  return (
    <LabSectionCard title="Specimen information">
      {specimen === null ? (
        <EmptySectionNote>No specimen has been collected for this order yet.</EmptySectionNote>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="neutral">{specimen.type}</Badge>
            <Badge variant={conditionAbnormal ? 'warning' : 'success'}>{specimen.condition}</Badge>
          </div>
          <FactGrid>
            <Fact label="Container">{specimen.container}</Fact>
            <Fact label="Volume">
              <span dir="ltr">{specimen.volume}</span>
            </Fact>
            <Fact label="Collection site">{specimen.collectionSite}</Fact>
            <Fact label="Collected by">{specimen.collectedBy}</Fact>
            <Fact label="Collected at">
              {formatDate(specimen.collectedAt)} · {formatTime(specimen.collectedAt)}
            </Fact>
            <Fact label="Received at">
              {specimen.receivedAt
                ? `${formatDate(specimen.receivedAt)} · ${formatTime(specimen.receivedAt)}`
                : 'Awaiting receipt'}
            </Fact>
          </FactGrid>
        </>
      )}
    </LabSectionCard>
  );
}
