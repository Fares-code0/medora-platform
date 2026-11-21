import { apiClient } from '@/api/client';
import {
  asRecord,
  fetchAllPages,
  readArray,
  readBoolean,
  readData,
  readDay,
  readEnum,
  readNumber,
  readOptionalString,
  readString,
} from '@/api/http';

import type { NewPatientInput, PatientDirectoryService } from './directory';
import type { BloodType, Gender, Patient, PatientStatus, RiskLevel } from './types';

/**
 * The patient directory over HTTP (FE-10.2) — `backend/src/modules/patients`.
 *
 * `GET /patients` (API §4.1) and `POST /patients` (API §4.2). The list is
 * care-scoped by the server: a doctor receives their own patients and no
 * one else's, so the client never filters for scope — it could not make
 * that guarantee and must not look as though it does.
 *
 * ## `PatientView` → `Patient`
 *
 * | Backend                        | Frontend                          |
 * | ------------------------------ | --------------------------------- |
 * | `fullName`                     | `name`                            |
 * | `assignedDoctor: {fullName}`   | `assignedDoctor: string`          |
 * | `allergies: PatientAllergyView[]` | `allergies: string[]` (allergens) |
 * | — (list carries none)          | `chronicConditions: []`           |
 *
 * The enum vocabularies are identical on both sides (backend
 * `patient-enums.ts`), and are read strictly: a value outside the union is
 * a malformed response, not a row rendered with an unknown badge.
 */

const STATUSES: readonly PatientStatus[] = [
  'active',
  'under-treatment',
  'critical',
  'follow-up',
  'discharged',
];
const RISKS: readonly RiskLevel[] = ['low', 'medium', 'high', 'critical'];
const GENDERS: readonly Gender[] = ['female', 'male'];
const BLOOD_TYPES: readonly BloodType[] = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

/** No assignment is a real state (an unassigned registration), not an error. */
const UNASSIGNED = 'Unassigned';

/**
 * One `PatientView`. Exported for the profile adapter, which receives the
 * same projection inside its bundle (API §4.4).
 */
export function toPatient(value: unknown, chronicConditions: readonly string[] = []): Patient {
  const what = 'patient';
  const dto = asRecord(value, what);
  const assigned = dto.assignedDoctor;
  const allergies = readArray(dto, 'allergies', what).map((entry) =>
    readString(asRecord(entry, `${what}.allergies`), 'allergen', `${what}.allergies`),
  );
  const email = readOptionalString(dto, 'email', what);
  const address = readOptionalString(dto, 'address', what);
  return {
    id: readString(dto, 'id', what),
    mrn: readString(dto, 'mrn', what),
    name: readString(dto, 'fullName', what),
    // A day, read as local midnight so it formats as that day everywhere.
    dateOfBirth: readDay(dto, 'dateOfBirth', what),
    age: readNumber(dto, 'age', what),
    gender: readEnum(dto, 'gender', GENDERS, what),
    bloodType: readEnum(dto, 'bloodType', BLOOD_TYPES, what),
    phone: readString(dto, 'phone', what),
    photoUrl: readOptionalString(dto, 'photoUrl', what),
    lastVisit: readOptionalString(dto, 'lastVisit', what),
    nextAppointment: readOptionalString(dto, 'nextAppointment', what),
    assignedDoctor:
      assigned === null || assigned === undefined
        ? UNASSIGNED
        : readString(asRecord(assigned, `${what}.assignedDoctor`), 'fullName', what),
    status: readEnum(dto, 'status', STATUSES, what),
    riskLevel: readEnum(dto, 'riskLevel', RISKS, what),
    chronicConditions,
    allergies,
    hasSevereAllergy: readBoolean(dto, 'hasSevereAllergy', what),
    registeredAt: readString(dto, 'registeredAt', what),
    ...(email === null ? {} : { email }),
    ...(address === null ? {} : { address }),
  };
}

/** Empty optional fields are omitted: the API refuses `email: ""`. */
function optional(key: string, value: string): Record<string, string> {
  const trimmed = value.trim();
  return trimmed === '' ? {} : { [key]: trimmed };
}

export const httpPatientDirectory: PatientDirectoryService = {
  capabilities: { insurance: false },

  async listPatients(query) {
    const condition = query?.condition ?? null;
    const items = await fetchAllPages(
      (page, pageSize) =>
        apiClient.get('/patients', {
          page,
          pageSize,
          ...(condition === null ? {} : { condition }),
        }),
      'patients',
    );
    return items.map((item) => toPatient(item));
  },

  async createPatient(input: NewPatientInput) {
    const body = await apiClient.post('/patients', {
      fullName: input.name.trim(),
      dateOfBirth: input.dateOfBirth,
      gender: input.gender,
      bloodType: input.bloodType,
      phone: input.phone.trim(),
      ...optional('email', input.email),
      ...optional('address', input.address),
      ...optional('medicalNotes', input.medicalNotes),
    });
    return toPatient(readData(body, 'patient'));
  },
};

/**
 * Prisma's member names for the blood-type enum. The pharmacy and labs
 * projections serve these (`AB_POSITIVE`) where every other module serves
 * the wire value (`AB+`) — a backend defect recorded in the FE-10 report,
 * read here so one mis-mapped display field does not take a whole list
 * down. A value in neither spelling is still refused.
 */
const BLOOD_TYPE_MEMBERS: Readonly<Record<string, BloodType>> = {
  A_POSITIVE: 'A+',
  A_NEGATIVE: 'A-',
  B_POSITIVE: 'B+',
  B_NEGATIVE: 'B-',
  AB_POSITIVE: 'AB+',
  AB_NEGATIVE: 'AB-',
  O_POSITIVE: 'O+',
  O_NEGATIVE: 'O-',
};

/** A patient snapshot's `bloodType`, in either spelling the API currently serves. */
export function readPatientBloodType(dto: Record<string, unknown>, what: string): BloodType {
  const member = BLOOD_TYPE_MEMBERS[readString(dto, 'bloodType', what)];
  return member ?? readEnum(dto, 'bloodType', BLOOD_TYPES, what);
}
