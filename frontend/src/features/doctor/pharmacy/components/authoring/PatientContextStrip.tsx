import { CircleAlert, Pill } from 'lucide-react';

import { StatusBadge } from '@/components/patterns';
import { Button, Card } from '@/components/ui';

import type { MedicationOnRecord } from '../../model/prescription-service';
import type { PrescriptionPatientSnapshot } from '../../model/types';

/**
 * The pinned patient context (UX §2.7 step 1): "the selected patient's
 * allergy strip and current-medication list render immediately and stay
 * pinned for the rest of the flow."
 *
 * **No masking here.** `MaskedIdentifier` and the ADM-10 elevation gate
 * govern the admin area, where clinical content is someone else's. This is
 * the doctor's own prescribing surface: they are meant to see the patient
 * they are prescribing for, and an MRN they cannot read is a safety hazard,
 * not a privacy control.
 *
 * **Current medications are the patient's, not the prescriber's.** They come
 * from the patient's record — every prescriber, plus what the patient
 * reported — because the doctor's own prescription list would read "none"
 * for a patient on someone else's anticoagulant. And a list that failed to
 * load says so: "nothing on record" is a clinical statement, and an error
 * is not evidence for it.
 */

export type CurrentMedicationsState =
  | { readonly status: 'pending' }
  | { readonly status: 'error'; readonly retry: () => void }
  | { readonly status: 'success'; readonly medications: readonly MedicationOnRecord[] };

export interface PatientContextStripProps {
  patient: PrescriptionPatientSnapshot;
  currentMedications: CurrentMedicationsState;
}

export function PatientContextStrip({ patient, currentMedications }: PatientContextStripProps) {
  const hasAllergies = patient.allergies.length > 0;

  return (
    <Card
      /* A string, so `Card` emits a real h3 — see the note in SafetyScreen. */
      title={patient.name}
      headingAs="h3"
      subtitle={`MRN ${patient.mrn} · ${String(patient.age)} yrs · ${patient.gender} · ${patient.bloodType}`}
      // No coloured card edge (Medora uses none, by design): a severe allergy
      // is carried by the allergies themselves, as critical badges below.
      padding="compact"
    >
      <div className="flex flex-col gap-3">
        <section aria-label="Recorded allergies">
          <p className="flex items-center gap-1.5 text-caption font-medium uppercase tracking-wide text-text-secondary">
            <CircleAlert aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
            Allergies
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {hasAllergies ? (
              patient.allergies.map((allergy) => (
                <StatusBadge
                  key={allergy}
                  status={patient.hasSevereAllergy ? 'critical' : 'expiring'}
                  label={allergy}
                />
              ))
            ) : (
              <StatusBadge status="normal" label="No known allergies" />
            )}
          </div>
        </section>

        <section aria-label="Current medications">
          <p className="flex items-center gap-1.5 text-caption font-medium uppercase tracking-wide text-text-secondary">
            <Pill aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
            Current medications
          </p>
          <CurrentMedicationsList state={currentMedications} />
        </section>
      </div>
    </Card>
  );
}

function CurrentMedicationsList({ state }: { state: CurrentMedicationsState }) {
  if (state.status === 'pending') {
    return <p className="mt-1.5 text-body-sm text-text-secondary">Loading…</p>;
  }
  if (state.status === 'error') {
    return (
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <p role="alert" className="text-body-sm text-error">
          Couldn&rsquo;t load current medications.
        </p>
        <Button size="sm" variant="secondary" onClick={state.retry}>
          Retry
        </Button>
      </div>
    );
  }
  if (state.medications.length === 0) {
    return (
      <p className="mt-1.5 text-body-sm text-text-secondary">No active medications on record.</p>
    );
  }
  return (
    <ul className="mt-1.5 flex flex-col gap-1">
      {state.medications.map((medication) => (
        <li
          key={medication.id}
          className="flex flex-wrap items-center gap-2 text-body-sm text-text-primary"
        >
          <span className="font-medium">{medication.name}</span>
          <span className="text-text-secondary">
            {[medication.dosage, medication.frequency].filter((part) => part !== '').join(' · ')}
            {' · '}
            {medication.prescriptionId === null
              ? 'Patient-reported'
              : `Prescription ${medication.prescriptionId}`}
          </span>
          {medication.isHighRisk === true ? (
            <StatusBadge status="critical" label="High-alert" />
          ) : null}
        </li>
      ))}
    </ul>
  );
}
