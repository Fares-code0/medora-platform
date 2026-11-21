import { Fact, FactGrid } from '@/components/patterns';
import { Avatar, LinkButton } from '@/components/ui';
import { routes } from '@/routes';

import type { Prescription } from '../../model/types';

import { PharmacySectionCard } from './PharmacySectionCard';

/**
 * Patient summary — the identity context for the prescription. Links to
 * the full Patient Profile (UX: prescriptions are always traceable to the
 * person).
 */
export function PrescriptionPatientSummaryCard({ prescription }: { prescription: Prescription }) {
  const { patient } = prescription;
  return (
    <PharmacySectionCard
      title="Patient summary"
      actions={
        <LinkButton href={routes.doctor.patient(patient.id)} variant="ghost" size="sm">
          View profile
        </LinkButton>
      }
    >
      <div className="flex items-center gap-3">
        <Avatar name={patient.name} size="md" decorative />
        <div className="min-w-0">
          <p className="truncate text-body font-semibold text-text-primary">{patient.name}</p>
          <p className="text-caption text-text-primary">
            <span className="font-mono">MRN {patient.mrn}</span> ·{' '}
            <span className="font-mono">{patient.id}</span>
          </p>
        </div>
      </div>
      <FactGrid>
        <Fact label="Age">
          <span dir="ltr">{patient.age} years</span>
        </Fact>
        <Fact label="Gender">{patient.gender === 'female' ? 'Female' : 'Male'}</Fact>
        <Fact label="Blood type">
          <span dir="ltr">{patient.bloodType}</span>
        </Fact>
        <Fact label="Allergies">
          {patient.allergies.length > 0 ? patient.allergies.join(', ') : 'None recorded'}
        </Fact>
      </FactGrid>
    </PharmacySectionCard>
  );
}
