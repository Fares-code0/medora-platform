import { Fact, FactGrid } from '@/components/patterns';

import type { Prescription } from '../../model/types';

import { PharmacySectionCard } from './PharmacySectionCard';

/** Dosage & administration — dose, frequency, route, duration, and sig. */
export function DosageSection({ prescription }: { prescription: Prescription }) {
  return (
    <PharmacySectionCard title="Dosage & administration">
      <FactGrid>
        <Fact label="Dosage">
          <span dir="ltr">{prescription.dosage}</span>
        </Fact>
        <Fact label="Frequency">{prescription.frequency}</Fact>
        <Fact label="Route">{prescription.route}</Fact>
        <Fact label="Duration">
          <span dir="ltr">{prescription.duration}</span>
        </Fact>
      </FactGrid>
      <div className="mt-4 rounded-surface border border-border bg-surface-sunken p-3">
        <p className="text-caption font-semibold uppercase tracking-wider text-text-tertiary">
          Instructions
        </p>
        <p className="mt-1 text-body-sm text-text-primary">{prescription.instructions}</p>
      </div>
    </PharmacySectionCard>
  );
}
