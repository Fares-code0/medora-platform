import { type DataTableColumn } from '@/components/ui';
import { type Patient } from '@/features/shared-domain/patient-identity';

import { DateCell, NextAppointmentCell } from './PatientDateCells';
import { PatientNameCell } from './PatientNameCell';
import { PatientRowActions } from './PatientRowActions';
import { PatientRiskCell, PatientStatusCell } from './PatientStatusCells';

/**
 * Column set for the patients DataTable (UX 2.2). Cell components live in
 * their own files (PatientNameCell, PatientDateCells, PatientStatusCells) so
 * this module exports configuration only.
 *
 * There is no "Assigned doctor" column. The list is the signed-in doctor's
 * own patients, so the column repeated their name on every row, in width
 * the clinical columns needed. The assignment is still on the patient's
 * record header, where it is read once.
 *
 * Status and risk sit beside the patient's identifiers rather than at the
 * far end of the demographics, so the clinical read of a row is on screen at
 * a laptop width instead of behind the horizontal scroll.
 *
 * Identifiers never wrap — an MRN broken at its hyphen reads as two values.
 */

export const PATIENT_COLUMNS: ReadonlyArray<DataTableColumn<Patient>> = [
  {
    id: 'name',
    header: 'Patient',
    sortable: true,
    width: '220px',
    // The floor is on the content: the name truncates inside a flex row, so
    // without it an overflowing table squeezed the column to the avatar.
    cell: (patient) => (
      <div className="min-w-[12rem]">
        <PatientNameCell patient={patient} />
      </div>
    ),
    /*
     * The row's identity for assistive tech: a screen reader reading any
     * other cell in this row announces the patient with it. Without it a
     * 14-column worklist reads "High risk" with no way to hear whose row that
     * is (DS §8.19 / DataTable's `rowHeader`, built in wave 2c-a and until now
     * used by nothing).
     */
    rowHeader: true,
  },
  {
    id: 'mrn',
    header: 'MRN',
    sortable: true,
    mono: true,
    cell: (patient) => <span className="whitespace-nowrap">{patient.mrn}</span>,
  },
  {
    id: 'id',
    header: 'Patient ID',
    mono: true,
    cell: (patient) => <span className="whitespace-nowrap">{patient.id}</span>,
  },
  {
    id: 'status',
    header: 'Status',
    cell: (patient) => <PatientStatusCell status={patient.status} />,
  },
  {
    id: 'riskLevel',
    header: 'Risk',
    sortable: true,
    cell: (patient) => <PatientRiskCell level={patient.riskLevel} />,
  },
  { id: 'age', header: 'Age', sortable: true, numeric: true, cell: (patient) => patient.age },
  {
    id: 'gender',
    header: 'Gender',
    cell: (patient) => (patient.gender === 'female' ? 'Female' : 'Male'),
  },
  {
    id: 'bloodType',
    header: 'Blood',
    cell: (patient) => <span dir="ltr">{patient.bloodType}</span>,
  },
  {
    id: 'phone',
    header: 'Phone',
    mono: true,
    cell: (patient) => (
      <span className="whitespace-nowrap" dir="ltr">
        {patient.phone}
      </span>
    ),
  },
  {
    id: 'lastVisit',
    header: 'Last visit',
    sortable: true,
    cell: (patient) => <DateCell iso={patient.lastVisit} />,
  },
  {
    id: 'nextAppointment',
    header: 'Next appointment',
    sortable: true,
    cell: (patient) => <NextAppointmentCell iso={patient.nextAppointment} />,
  },
  {
    id: 'actions',
    header: 'Actions',
    align: 'right',
    width: '140px',
    cell: (patient) => <PatientRowActions patient={patient} />,
  },
];
