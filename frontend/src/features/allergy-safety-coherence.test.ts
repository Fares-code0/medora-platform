import { describe, expect, it } from 'vitest';

import { mockProfileService } from './doctor/patients/mock/mock-profile-service';
import { toPrescriptionPatient } from './doctor/pharmacy/model/authoring';
import { MEDICATION_CATALOGUE } from './doctor/pharmacy/model/catalogue';
import { screenPrescription, type SafetyCheckSubject } from './doctor/pharmacy/model/safety-check';
import { MOCK_PATIENTS, type Patient } from './shared-domain/patient-identity';
import { mockPatientDirectory } from './shared-domain/patient-identity/mock-directory';

/**
 * An allergy recorded on the chart must reach the prescription safety screen.
 *
 * Before this, the mock chart read the static seed while the prescribing flow
 * picked its patient from the directory's session store — two copies of the
 * same patient. An allergy written to one would have been invisible to the
 * screen that blocks prescribing against it, and a patient registered this
 * session had no chart at all. These tests drive the path end to end across
 * the three modules involved, which is why they sit above the features.
 */

const amoxicillin = MEDICATION_CATALOGUE.find((spec) => spec.allergyClass === 'Penicillin');
if (amoxicillin === undefined) throw new Error('demo formulary has no Penicillin-class drug');

function subjectFor(patient: Patient): SafetyCheckSubject {
  const snapshot = toPrescriptionPatient(patient);
  return {
    patientId: snapshot.id,
    medicationId: amoxicillin!.id,
    patientName: snapshot.name,
    allergies: snapshot.allergies,
    hasSevereAllergy: snapshot.hasSevereAllergy,
    genericName: amoxicillin!.genericName,
    brandName: amoxicillin!.name,
    category: amoxicillin!.category,
    strength: amoxicillin!.strengths[0] ?? '',
    frequency: amoxicillin!.frequencies[0] ?? '',
    durationDays: 7,
    quantity: 21,
    isHighRisk: amoxicillin!.isHighRisk,
    interactionNote: null,
    allergyClass: amoxicillin!.allergyClass,
    currentMedications: [],
  };
}

async function directoryPatient(id: string): Promise<Patient> {
  const found = (await mockPatientDirectory.listPatients()).find((patient) => patient.id === id);
  if (found === undefined) throw new Error(`directory lost ${id}`);
  return found;
}

describe('allergies recorded on the chart reach the prescription safety screen', () => {
  it('blocks a Penicillin-class drug once Penicillin is recorded — whatever its case', async () => {
    const seed = MOCK_PATIENTS.find(
      (patient) => patient.allergies.length > 0 && !patient.allergies.includes('Penicillin'),
    );
    if (seed === undefined) throw new Error('no seeded patient without a Penicillin allergy');

    const before = await mockProfileService.getProfile(seed.id);
    expect(screenPrescription(subjectFor(await directoryPatient(seed.id)))).toHaveLength(0);

    const record = await mockProfileService.addAllergy(seed.id, {
      allergen: '  penicillin ',
      severity: 'severe',
      reaction: 'Anaphylaxis',
      notes: '',
    });
    expect(record).toMatchObject({ allergen: 'penicillin', severity: 'severe', notes: null });

    // The safety screen, fed from the directory as the prescribing flow is.
    const [warning] = screenPrescription(subjectFor(await directoryPatient(seed.id)));
    expect(warning).toMatchObject({ kind: 'allergy', blocking: true, severity: 'critical' });

    // The chart shows what was recorded, and the seeded allergies are unchanged —
    // the generator was not fed the new allergy, so nothing was relabelled.
    const after = await mockProfileService.getProfile(seed.id);
    expect(after.profile.allergies.slice(0, before.profile.allergies.length)).toEqual(
      before.profile.allergies,
    );
    expect(after.profile.allergies.at(-1)).toMatchObject({
      allergen: 'penicillin',
      severity: 'severe',
      reaction: 'Anaphylaxis',
    });
    expect(after.profile.vitals).toEqual(before.profile.vitals);
    expect(after.profile.medications).toEqual(before.profile.medications);
  });

  it('refuses an allergen already on record, as the API does', async () => {
    const seed = MOCK_PATIENTS.find((patient) => patient.allergies.length > 0);
    const [existing] = seed?.allergies ?? [];
    if (seed === undefined || existing === undefined) throw new Error('no seeded allergy');

    await expect(
      mockProfileService.addAllergy(seed.id, {
        allergen: existing.toUpperCase(),
        severity: 'mild',
        reaction: 'Rash',
        notes: '',
      }),
    ).rejects.toMatchObject({ kind: 'conflict' });
  });

  it('gives a patient registered this session a chart', async () => {
    const created = await mockPatientDirectory.createPatient(
      {
        name: 'Coherence Check',
        dateOfBirth: '1990-01-01',
        gender: 'female',
        bloodType: 'O+',
        phone: '+20 100 000 0000',
        email: '',
        address: '',
        insurance: '',
        medicalNotes: '',
      },
      'Dr. Amelia Chen',
    );

    await expect(mockProfileService.getProfile(created.id)).resolves.toMatchObject({
      patient: { id: created.id, name: 'Coherence Check' },
    });
  });
});
