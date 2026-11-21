import { TriangleAlert } from 'lucide-react';

import { Fact, FactGrid } from '@/components/patterns';
import { Badge } from '@/components/ui';

import type { Prescription } from '../../model/types';

import { PharmacySectionCard } from './PharmacySectionCard';

/** Medication details — the formulary facts for the prescribed drug. */
export function MedicationDetailsSection({ prescription }: { prescription: Prescription }) {
  const { medication } = prescription;
  return (
    <PharmacySectionCard title="Medication details">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="neutral">{medication.category}</Badge>
        {medication.isHighRisk ? (
          <Badge variant="warning" emphasis="outline" icon={TriangleAlert}>
            High-risk
          </Badge>
        ) : null}
        {medication.isControlled ? <Badge variant="neutral">Controlled</Badge> : null}
      </div>
      <FactGrid>
        <Fact label="Medication name">{medication.name}</Fact>
        <Fact label="Generic name">{medication.genericName}</Fact>
        <Fact label="Category">{medication.category}</Fact>
        <Fact label="Strength">
          <span dir="ltr">{medication.strength}</span>
        </Fact>
        <Fact label="Form">{medication.form}</Fact>
        <Fact label="Manufacturer">{medication.manufacturer}</Fact>
      </FactGrid>
    </PharmacySectionCard>
  );
}
