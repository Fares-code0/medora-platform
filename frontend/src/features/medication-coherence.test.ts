import { afterEach, describe, expect, it } from 'vitest';

import { mockProfileService } from './doctor/patients/mock/mock-profile-service';
import {
  __putMockPrescription,
  __resetPharmacyStore,
  mockPrescriptionService,
} from './doctor/pharmacy/mock/mock-prescription-service';
import { MOCK_PRESCRIPTIONS } from './doctor/pharmacy/model/mock-data';
import { MOCK_PATIENTS } from './shared-domain/patient-identity';

/**
 * NEW-05 — the chart and the prescribing strip show one regimen.
 *
 * Live, both read `GET /patients/:id/medications`. In the demo they used to
 * read two stores: the chart a regimen generated per patient, the prescribing
 * flow's strip (and its safety screen) the pharmacy's prescriptions — so
 * Khaled's chart listed Lisinopril, Amlodipine and Metformin while the screen
 * that checks interactions saw Metformin alone. The prescriptions now live in
 * `shared-domain/prescriptions`, and the chart projects the patient's from
 * there the way the API materialises them. Demo-only: a live build never
 * reaches either mock.
 */

afterEach(() => __resetPharmacyStore());

async function chartMedications(patientId: string) {
  return (await mockProfileService.getProfile(patientId)).profile.medications;
}

describe('one regimen, chart and prescribing strip', () => {
  it.each(MOCK_PATIENTS.map((patient) => [patient.name, patient.id] as const))(
    '%s: the chart’s active medications are exactly what the strip lists',
    async (_name, patientId) => {
      const chart = await chartMedications(patientId);
      const strip = await mockPrescriptionService.listCurrentMedications(patientId);

      expect(
        chart
          .filter((medication) => medication.status === 'active')
          .map((medication) => medication.id)
          .sort(),
      ).toEqual(strip.map((medication) => medication.id).sort());
    },
  );

  it('no longer shows a course the safety screen never saw', async () => {
    const khaled = MOCK_PATIENTS[0];
    if (khaled === undefined) throw new Error('no seeded patient');
    const chart = await chartMedications(khaled.id);
    const seeded = MOCK_PRESCRIPTIONS.filter((rx) => rx.patient.id === khaled.id);

    expect(chart.map((medication) => medication.id).sort()).toEqual(
      seeded.map((rx) => rx.id).sort(),
    );
    // Named the way the live adapter names a prescription-backed entry.
    for (const medication of chart) {
      expect(medication.prescribedBy).toBe(`Prescription ${medication.id}`);
    }
  });

  it('reflects a discontinuation made in the pharmacy, on both sides', async () => {
    const running = MOCK_PRESCRIPTIONS.find((rx) => rx.status === 'active');
    if (running === undefined) throw new Error('no active seeded prescription');

    await mockPrescriptionService.discontinue({
      prescriptionId: running.id,
      reason: 'Adverse reaction',
      details: '',
      actor: 'Dr. Amelia Chen',
    });

    const chart = await chartMedications(running.patient.id);
    expect(chart.find((medication) => medication.id === running.id)?.status).toBe('discontinued');
    const strip = await mockPrescriptionService.listCurrentMedications(running.patient.id);
    expect(strip.some((medication) => medication.id === running.id)).toBe(false);
  });

  it('shows a prescription issued this session, and counts it in the summary', async () => {
    const layla = MOCK_PATIENTS[4];
    const template = MOCK_PRESCRIPTIONS[0];
    if (layla === undefined || template === undefined) throw new Error('missing seed');
    __putMockPrescription({
      ...template,
      id: 'RX-299999',
      status: 'active',
      patient: { ...template.patient, id: layla.id, name: layla.name },
    });

    const { profile } = await mockProfileService.getProfile(layla.id);
    expect(profile.medications.map((medication) => medication.id)).toContain('RX-299999');
    const active = profile.medications.filter((medication) => medication.status === 'active');
    expect(profile.summary).toContain(
      `${String(active.length)} active medication${active.length === 1 ? '' : 's'}`,
    );
  });
});
