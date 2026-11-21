import type { ExportDataset } from '@/utils/export';

import type { PrescriptionSummary } from './types';

/**
 * Per-prescription export dataset — feeds the shared export engine
 * (print / PDF) from the pharmacy quick actions and row menus, so every
 * document action on a prescription produces a real file.
 */
export function prescriptionDataset(prescription: PrescriptionSummary): ExportDataset {
  return {
    filename: `medora-prescription-${prescription.id.toLowerCase()}`,
    title: `${prescription.medication.name} ${prescription.medication.strength} — ${prescription.patient.name}`,
    columns: ['Field', 'Value'],
    rows: [
      ['Prescription', prescription.id],
      ['Patient', `${prescription.patient.name} (${prescription.patient.mrn})`],
      [
        'Medication',
        `${prescription.medication.name} (${prescription.medication.genericName}) ${prescription.medication.strength}`,
      ],
      ['Dosage', `${prescription.dosage} · ${prescription.frequency} · ${prescription.route}`],
      ['Duration', `${prescription.duration} (${prescription.startDate} → ${prescription.endDate})`],
      ['Quantity', String(prescription.quantity)],
      ['Instructions', prescription.instructions],
      ['Refills', `${String(prescription.refillsRemaining)} of ${String(prescription.refillsAllowed)} remaining`],
      ['Prescriber', `${prescription.prescribingDoctor} · ${prescription.department}`],
      ['Status', prescription.status],
    ],
  };
}
