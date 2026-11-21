import type { NewPatientInput, PatientDirectoryService } from './directory';
import { MOCK_PATIENTS } from './roster';
import type { Patient } from './types';

/**
 * The patient directory over the seeded roster — the mock adapter.
 *
 * A session-lifetime store, so "Add patient" genuinely persists until the
 * tab closes and the list refreshes through invalidation. Behaviour is
 * unchanged from the store `usePatientsQuery` used to hold privately.
 */

const MOCK_LATENCY_MS = 450;

const delay = (ms = MOCK_LATENCY_MS) => new Promise((resolve) => setTimeout(resolve, ms));

/** Session-lifetime store seeded from the canonical roster (newest first). */
const store: Patient[] = [...MOCK_PATIENTS];

/**
 * In mock mode this store is the **one owner** of a patient's identity and
 * allergy list. The prescription safety screen picks its patient — allergies
 * included — from this directory, so the mock patient profile resolves from
 * here too (`mockFindPatient`) and an allergy is recorded here
 * (`mockRecordAllergy`). Before this, the profile read the static seed: a
 * patient registered through "Add patient" opened as "not found", and an
 * allergy recorded on the chart would have been invisible to the screen that
 * guards prescribing against it.
 */
export function mockFindPatient(patientId: string): Patient | undefined {
  return store.find((patient) => patient.id === patientId);
}

export type MockAllergySeverity = 'mild' | 'moderate' | 'severe';

/** What a clinician recorded about an allergy, beyond the allergen's name. */
export interface MockRecordedAllergy {
  readonly allergen: string;
  readonly severity: MockAllergySeverity;
  readonly reaction: string;
  readonly notes: string | null;
  readonly recordedAt: string;
}

const recordedAllergies = new Map<string, MockRecordedAllergy[]>();

/** The allergies recorded this session for one patient, oldest first. */
export function mockRecordedAllergies(patientId: string): readonly MockRecordedAllergy[] {
  return recordedAllergies.get(patientId) ?? [];
}

/**
 * Records an allergy on the directory's patient — the list the safety screen
 * reads — and keeps its detail for the chart. Refuses an allergen already on
 * record (compared without case or surrounding space), as the API does with
 * a 409: two rows for one substance would let the chart say both "severe"
 * and "mild" about it, the worst answer the safety screen could be given.
 *
 * Returns `undefined` for a patient the directory does not hold; the caller
 * owns the not-found contract.
 */
export function mockRecordAllergy(
  patientId: string,
  input: Omit<MockRecordedAllergy, 'recordedAt'>,
): MockRecordedAllergy | undefined {
  const index = store.findIndex((patient) => patient.id === patientId);
  const patient = store[index];
  if (patient === undefined) return undefined;

  const allergen = input.allergen.trim();
  const key = allergen.toLowerCase();
  if (patient.allergies.some((existing) => existing.trim().toLowerCase() === key)) {
    throw Object.assign(new Error('API error: conflict'), {
      kind: 'conflict',
      code: 'conflict',
      detail: 'That allergen is already recorded for this patient',
    });
  }

  const record: MockRecordedAllergy = {
    allergen,
    severity: input.severity,
    reaction: input.reaction.trim(),
    notes: input.notes?.trim() || null,
    recordedAt: new Date().toISOString(),
  };
  store[index] = {
    ...patient,
    allergies: [...patient.allergies, allergen],
    hasSevereAllergy: patient.hasSevereAllergy || record.severity === 'severe',
  };
  recordedAllergies.set(patientId, [...mockRecordedAllergies(patientId), record]);
  return record;
}

function ageFromDob(dateOfBirth: string): number {
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return 0;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) age -= 1;
  return Math.max(0, age);
}

export const mockPatientDirectory: PatientDirectoryService = {
  capabilities: { insurance: true },

  async listPatients(query) {
    await delay();
    const condition = query?.condition ?? null;
    // A copy, never the store itself: handing the query cache the live array
    // means a later write mutates data it already holds, and structural
    // sharing then sees "no change" and renders nothing new.
    return condition === null
      ? [...store]
      : store.filter((patient) => patient.chronicConditions.includes(condition));
  },

  async createPatient(input: NewPatientInput, registeringDoctor: string) {
    await delay();
    const seq = store.length + 1001;
    const now = new Date().toISOString();
    const patient: Patient = {
      id: `PT-${String(seq)}`,
      mrn: `${String(4400 + store.length)}-${String(10 + store.length)}`,
      name: input.name.trim(),
      dateOfBirth: input.dateOfBirth,
      age: ageFromDob(input.dateOfBirth),
      gender: input.gender,
      bloodType: input.bloodType,
      phone: input.phone.trim(),
      photoUrl: null,
      lastVisit: null,
      nextAppointment: null,
      assignedDoctor: registeringDoctor,
      status: 'active',
      riskLevel: 'low',
      chronicConditions: [],
      allergies: [],
      hasSevereAllergy: false,
      registeredAt: now,
      email: input.email.trim() || undefined,
      address: input.address.trim() || undefined,
      insurance: input.insurance.trim() || undefined,
      medicalNotes: input.medicalNotes.trim() || undefined,
    };
    store.unshift(patient);
    return patient;
  },
};
