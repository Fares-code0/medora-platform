import { describe, expect, it } from 'vitest';

import { buildAppointmentColumns } from './appointments/components/appointment-table-columns';
import { buildMedicalRecordColumns } from './medical-records/components/medical-record-table-columns';
import { isRecordSortColumn } from './medical-records/model/selectors';
import { PATIENT_COLUMNS } from './patients/components/patient-table-columns';

/**
 * The doctor's own worklists do not name the doctor.
 *
 * Appointments, Patients and Medical Records are all scoped to the signed-in
 * doctor, so a column repeating that doctor's name on every row says nothing
 * the context does not already say, and costs the width the patient's name
 * needs. These pin the removal so a column cannot quietly come back.
 *
 * Labs ("Ordered by") and Pharmacy ("Prescribed by") are deliberately not
 * here: those name who performed an action, which varies between colleagues,
 * rather than restating whose workspace this is.
 */

const noop = () => undefined;

const TABLES = {
  appointments: buildAppointmentColumns({ onOpenDetails: noop, onAction: noop }),
  patients: PATIENT_COLUMNS,
  'medical records': buildMedicalRecordColumns({ onOpenRecord: noop }),
} as const;

describe.each(Object.entries(TABLES))('the %s table', (_name, columns) => {
  it('has no doctor column', () => {
    expect(columns.map((column) => column.id)).not.toContain('doctor');
    expect(columns.map((column) => column.id)).not.toContain('assignedDoctor');
    expect(columns.map((column) => column.header)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/doctor/i)]),
    );
  });

  it('still leads with the patient', () => {
    const patientColumn = columns.find((column) => column.rowHeader === true);
    expect(patientColumn?.header).toBe('Patient');
  });
});

describe('the medical records sort', () => {
  it('no longer sorts by a doctor column that is not on screen', () => {
    expect(isRecordSortColumn('doctor')).toBe(false);
    expect(isRecordSortColumn('patient')).toBe(true);
  });
});
