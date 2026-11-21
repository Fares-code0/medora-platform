import { Fact, FactGrid } from '@/components/patterns';
import { formatDate, relativeDayLabel } from '@/utils/dates';

import type { Prescription } from '../../model/types';
import { PrescriptionStatusBadge, RefillStatusBadge } from '../PharmacyCells';

import { PharmacySectionCard } from './PharmacySectionCard';

/** Prescription information — status, refills, and lifecycle dates. */
export function PrescriptionInfoCard({ prescription }: { prescription: Prescription }) {
  return (
    <PharmacySectionCard title="Prescription information">
      <div className="flex flex-wrap items-center gap-2">
        <PrescriptionStatusBadge prescription={prescription} />
        <RefillStatusBadge prescription={prescription} />
      </div>
      <FactGrid>
        <Fact label="Prescription ID">
          <span className="font-mono">{prescription.id}</span>
        </Fact>
        <Fact label="Quantity">
          <span className="tabular-nums">{prescription.quantity}</span>
        </Fact>
        <Fact label="Start date">{formatDate(prescription.startDate)}</Fact>
        <Fact label="End date">
          {formatDate(prescription.endDate)} · {relativeDayLabel(prescription.endDate)}
        </Fact>
        <Fact label="Refills">
          <span className="tabular-nums">
            {prescription.refillsRemaining} of {prescription.refillsAllowed} remaining
          </span>
        </Fact>
        <Fact label="Last updated">
          {formatDate(prescription.updatedAt)} · {relativeDayLabel(prescription.updatedAt)}
        </Fact>
      </FactGrid>
    </PharmacySectionCard>
  );
}
