import type { Patient } from '@/features/shared-domain/patient-identity';
import type { ExportDataset } from '@/utils/export';

import { ALLERGY_SEVERITY_META, type AllergyRecord } from './profile-types';

/**
 * Patient export datasets — feed the shared export engine (print / PDF /
 * preview) from the profile header.
 *
 * There was a second export here, `patientDocumentDataset`, behind the
 * Documents tab's View and Download. It is gone (D-04). The summary below
 * is an export the app *composes* out of data it holds, which is what the
 * export engine is for; a stored document is a file the app does not hold,
 * and running its name through the same engine produced a three-field PDF
 * wearing the filename of a referral letter. Opening a stored document now
 * goes through the documents port instead
 * (`model/patient-documents-service.ts`), and the same reasoning removed
 * the Imaging tab's "View report" at D-05.
 */

export function patientSummaryDataset(
  patient: Patient,
  allergies: readonly AllergyRecord[],
): ExportDataset {
  return {
    filename: `medora-patient-${patient.id.toLowerCase()}`,
    title: `Patient summary — ${patient.name} (MRN ${patient.mrn})`,
    columns: ['Field', 'Value'],
    rows: [
      ['Patient', `${patient.name} (${patient.id})`],
      ['MRN', patient.mrn],
      ['Age', `${String(patient.age)} y`],
      ['Gender', patient.gender === 'female' ? 'Female' : 'Male'],
      ['Blood type', patient.bloodType],
      ['Status', patient.status],
      ['Risk level', patient.riskLevel],
      ['Assigned doctor', patient.assignedDoctor],
      ['Chronic conditions', patient.chronicConditions.join('; ') || '—'],
      ...allergies.map(
        (allergy): readonly [string, string] => [
          'Allergy',
          `${allergy.allergen} (${ALLERGY_SEVERITY_META[allergy.severity].label})`,
        ],
      ),
    ],
  };
}
