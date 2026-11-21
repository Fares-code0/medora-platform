import { Fact, FactGrid } from '@/components/patterns';
import { formatDate, formatTime } from '@/utils/dates';

import type { Prescription } from '../../model/types';

import { PharmacySectionCard } from './PharmacySectionCard';

/** Prescribing doctor — who issued the prescription and from where. */
export function PrescribingDoctorCard({ prescription }: { prescription: Prescription }) {
  return (
    <PharmacySectionCard title="Prescribing doctor">
      <FactGrid>
        <Fact label="Doctor">{prescription.prescribingDoctor}</Fact>
        <Fact label="Department">{prescription.department}</Fact>
        <Fact label="Prescribed">
          {formatDate(prescription.createdAt)} · {formatTime(prescription.createdAt)}
        </Fact>
      </FactGrid>
    </PharmacySectionCard>
  );
}
