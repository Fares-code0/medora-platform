import { Stack } from '@/components/layout';
import { Fact, FactGrid } from '@/components/patterns';
import { Avatar, Card } from '@/components/ui';
import { formatDate } from '@/utils/dates';

import { primaryEmergencyContact, type PatientProfileBundle } from '../../model/profile-types';

import {
  AllergiesCard,
  CurrentMedicationsCard,
  EmergencyContactCard,
  UpcomingAppointmentCard,
} from './ProfileSummaryCards';

/**
 * Persistent patient summary — the P2 left column (sticky on lg+,
 * stacked below the tabs on smaller screens). Photo, contact identity,
 * blood group, allergies, current medications, emergency contact, and
 * the next appointment.
 */
export function PatientSummarySidebar({
  bundle,
  onViewMedications,
}: {
  bundle: PatientProfileBundle;
  onViewMedications: () => void;
}) {
  const { patient, profile } = bundle;

  return (
    <Stack gap={4}>
      <Card padding="compact">
        <div className="flex flex-col items-center gap-3 text-center">
          <Avatar name={patient.name} size="xl" />
          <div>
            <p className="text-body font-semibold text-text-primary">{patient.name}</p>
            <p className="font-mono text-caption text-text-primary">
              MRN {patient.mrn} · {patient.id}
            </p>
          </div>
        </div>
        <FactGrid className="mt-4">
          <Fact label="Phone" truncate={false}>
            <span className="font-mono" dir="ltr">
              {patient.phone}
            </span>
          </Fact>
          <Fact label="Date of birth">{formatDate(patient.dateOfBirth)}</Fact>
          <Fact label="Blood group">
            <span dir="ltr">{patient.bloodType}</span>
          </Fact>
          <Fact label="Registered">{formatDate(patient.registeredAt)}</Fact>
        </FactGrid>
      </Card>

      <AllergiesCard allergies={profile.allergies} />
      <CurrentMedicationsCard medications={profile.medications} onViewAll={onViewMedications} />
      <UpcomingAppointmentCard appointments={profile.appointments} />
      <EmergencyContactCard contact={primaryEmergencyContact(profile.emergencyContacts)} />
    </Stack>
  );
}
