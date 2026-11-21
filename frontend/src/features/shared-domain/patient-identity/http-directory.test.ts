import { afterEach, describe, expect, it, vi } from 'vitest';

import { envelope, json, pageOf, stubApi } from '@/test/api-stub';

import type { NewPatientInput } from './directory';
import { httpPatientDirectory } from './http-directory';

/**
 * The patient directory over HTTP (FE-10.2), against `PatientView` bodies
 * as the backend answers them (captured from `GET /patients` on a seeded
 * database). The real `ApiClient` sends each request; only fetch is stubbed.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function patientView(overrides: Record<string, unknown> = {}) {
  return {
    id: 'PT-1002',
    mrn: '4436-58',
    fullName: 'Mona Adel',
    dateOfBirth: '1997-08-04',
    age: 29,
    gender: 'female',
    bloodType: 'A+',
    phone: '+20 111 830 2245',
    email: null,
    address: null,
    photoUrl: null,
    status: 'active',
    riskLevel: 'low',
    registeredAt: '2026-09-25T15:51:06.441Z',
    lastVisit: null,
    nextAppointment: null,
    assignedDoctor: {
      id: '545e8b20-0997-4fcb-860e-5b37042be266',
      fullName: 'Dr. Amelia Chen',
      specialty: 'Internal Medicine',
    },
    allergies: [
      {
        id: 'a1',
        allergen: 'Penicillin',
        severity: 'severe',
        reaction: 'Anaphylaxis',
        notes: null,
        recordedAt: '2026-10-04T15:51:06.453Z',
        recordedBy: null,
      },
    ],
    hasSevereAllergy: true,
    hasPortalAccount: false,
    ...overrides,
  };
}

const NEW_PATIENT: NewPatientInput = {
  name: '  Sara Test ',
  dateOfBirth: '1990-04-01',
  gender: 'female',
  phone: '+20 100 555 0101',
  email: '',
  address: '1 Test Street',
  bloodType: 'O+',
  insurance: 'TestCare 123',
  medicalNotes: '',
};

describe('httpPatientDirectory.listPatients', () => {
  it('maps the backend projection onto the frontend Patient', async () => {
    stubApi({ 'GET /patients': () => pageOf([patientView()]) });

    const [patient] = await httpPatientDirectory.listPatients();

    expect(patient).toEqual({
      id: 'PT-1002',
      mrn: '4436-58',
      name: 'Mona Adel',
      // A day, read as local midnight so it formats as the 4th everywhere.
      dateOfBirth: '1997-08-04T00:00:00',
      age: 29,
      gender: 'female',
      bloodType: 'A+',
      phone: '+20 111 830 2245',
      photoUrl: null,
      lastVisit: null,
      nextAppointment: null,
      assignedDoctor: 'Dr. Amelia Chen',
      status: 'active',
      riskLevel: 'low',
      chronicConditions: [],
      allergies: ['Penicillin'],
      hasSevereAllergy: true,
      registeredAt: '2026-09-25T15:51:06.441Z',
    });
  });

  it('reads an unassigned registration as "Unassigned", not as an error', async () => {
    stubApi({ 'GET /patients': () => pageOf([patientView({ assignedDoctor: null })]) });

    const [patient] = await httpPatientDirectory.listPatients();

    expect(patient?.assignedDoctor).toBe('Unassigned');
  });

  it('walks every page at the maximum page size', async () => {
    const { requests } = stubApi({
      'GET /patients': ({ query }) =>
        envelope({
          items: [patientView({ id: `PT-${query.get('page') ?? '?'}` })],
          page: Number(query.get('page')),
          pageSize: 100,
          totalItems: 2,
          totalPages: 2,
        }),
    });

    const patients = await httpPatientDirectory.listPatients();

    expect(patients.map((patient) => patient.id)).toEqual(['PT-1', 'PT-2']);
    expect(requests.map((request) => request.query.get('pageSize'))).toEqual(['100', '100']);
  });

  it('passes a condition filter to the server, which is the only side that can apply it', async () => {
    const { requests } = stubApi({ 'GET /patients': () => pageOf([]) });

    await httpPatientDirectory.listPatients({ condition: 'Asthma' });

    expect(requests[0]?.query.get('condition')).toBe('Asthma');
  });

  it('answers an empty caseload with an empty list', async () => {
    stubApi({ 'GET /patients': () => pageOf([]) });

    await expect(httpPatientDirectory.listPatients()).resolves.toEqual([]);
  });

  it('rejects a server failure instead of answering an empty list', async () => {
    stubApi({ 'GET /patients': () => json({ message: 'boom', ref: 'corr-1' }, 500) });

    await expect(httpPatientDirectory.listPatients()).rejects.toMatchObject({
      kind: 'server',
      ref: 'corr-1',
    });
  });

  it('rejects a row outside the status vocabulary as a malformed response', async () => {
    stubApi({ 'GET /patients': () => pageOf([patientView({ status: 'archived' })]) });

    await expect(httpPatientDirectory.listPatients()).rejects.toMatchObject({
      code: 'malformed_response',
      ref: 'patient.status',
    });
  });
});

describe('httpPatientDirectory.createPatient', () => {
  it('sends the registration contract: fullName, no empty optionals, no insurance', async () => {
    const { requests } = stubApi({
      'POST /patients': () => json(envelope(patientView({ fullName: 'Sara Test' })), 201),
    });

    const created = await httpPatientDirectory.createPatient(NEW_PATIENT, 'ignored');

    expect(requests[0]?.body).toEqual({
      fullName: 'Sara Test',
      dateOfBirth: '1990-04-01',
      gender: 'female',
      bloodType: 'O+',
      phone: '+20 100 555 0101',
      address: '1 Test Street',
    });
    expect(created.name).toBe('Sara Test');
  });

  it('declares that it cannot store insurance, so the form does not collect it', () => {
    expect(httpPatientDirectory.capabilities.insurance).toBe(false);
  });

  it('surfaces the server’s field errors as a validation error', async () => {
    stubApi({
      'POST /patients': () =>
        json({ message: 'Invalid', fieldErrors: { phone: ['Enter a valid phone number'] } }, 422),
    });

    await expect(httpPatientDirectory.createPatient(NEW_PATIENT, '')).rejects.toMatchObject({
      kind: 'validation',
      fieldErrors: { phone: ['Enter a valid phone number'] },
    });
  });
});
