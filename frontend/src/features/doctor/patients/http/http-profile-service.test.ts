import { afterEach, describe, expect, it, vi } from 'vitest';

import { envelope, json, pageOf, stubApi } from '@/test/api-stub';

import { NOT_NOTE_AUTHOR, PATIENT_NOT_FOUND } from '../model/profile-service';
import { primaryEmergencyContact } from '../model/profile-types';

import { httpProfileService } from './http-profile-service';

/**
 * The patient profile over HTTP (FE-10.2). Bodies are the backend's own,
 * captured from a seeded database after charting a patient through the
 * API (history, vitals, a note, an emergency contact, an alert).
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

const PATIENT = {
  id: 'PT-1001',
  mrn: '4411-27',
  fullName: 'Khaled Nassar',
  dateOfBirth: '1974-03-18',
  age: 52,
  gender: 'male',
  bloodType: 'O+',
  phone: '+20 100 214 3387',
  email: null,
  address: null,
  photoUrl: null,
  status: 'follow-up',
  riskLevel: 'medium',
  registeredAt: '2024-10-04T15:51:06.418Z',
  lastVisit: null,
  nextAppointment: null,
  assignedDoctor: { id: 'd1', fullName: 'Dr. Amelia Chen', specialty: 'Internal Medicine' },
  allergies: [],
  hasSevereAllergy: false,
  hasPortalAccount: false,
};

const VITALS = {
  recordedAt: '2026-10-04T16:11:44.337Z',
  systolic: 138,
  diastolic: 86,
  heartRate: 76,
  temperatureC: 36.8,
  respiratoryRate: 16,
  oxygenSaturation: 97,
  weightKg: 88,
  heightCm: 176,
  bmi: 28.4,
};

function bundle(overrides: Record<string, unknown> = {}) {
  return envelope({
    patient: PATIENT,
    latestVitals: VITALS,
    medications: [],
    chronicConditions: ['Hypertension', 'Type 2 diabetes'],
    emergencyContacts: [
      { id: 'c2', name: 'Omar Nassar', relationship: 'Brother', phone: '+20 1', isPrimary: false },
      { id: 'c1', name: 'Rania Nassar', relationship: 'Spouse', phone: '+20 2', isPrimary: true },
    ],
    clinicalAlerts: [
      { id: 'al1', severity: 'warning', message: 'BP above target', active: true, createdAt: 'x' },
    ],
    ...overrides,
  });
}

function routes(overrides: Record<string, () => unknown> = {}) {
  return {
    'GET /patients/PT-1001/profile': () => bundle(),
    'GET /patients/PT-1001/history': () =>
      pageOf([
        {
          id: 'h1',
          kind: 'diagnosis',
          title: 'Type 2 diabetes mellitus',
          occurredOn: '2019-05-14',
          detail: null,
          facility: 'Medora Clinic',
          recordedBy: 'usr_demo_1',
        },
      ]),
    'GET /patients/PT-1001/medications': () =>
      pageOf([
        {
          id: 'm1',
          name: 'Metformin',
          dosage: '500 mg',
          frequency: 'Twice daily',
          status: 'active',
          startDate: '2019-05-14',
          endDate: null,
          prescriptionId: 'RX-2001',
        },
        {
          id: 'm2',
          name: 'Vitamin D',
          dosage: '1000 IU',
          frequency: 'Daily',
          status: 'active',
          startDate: '2024-01-01',
          endDate: null,
          prescriptionId: null,
        },
      ]),
    'GET /patients/PT-1001/notes': () =>
      pageOf([
        {
          id: 'n1',
          title: 'Follow-up',
          body: 'BP borderline; continue metformin.',
          authoredAt: '2026-10-04T16:11:44.372Z',
          author: 'usr_demo_1',
          signed: false,
          signedAt: null,
          aiAssisted: false,
        },
      ]),
    'GET /patients/PT-1001/documents': () => pageOf([]),
    'GET /patients/PT-1001/appointments': () =>
      pageOf([
        {
          id: 'APT-1',
          scheduledAt: '2026-10-10T09:00:00.000Z',
          durationMin: 30,
          status: 'scheduled',
          priority: 'normal',
          reason: 'Review',
          visitType: 'Follow-up',
          doctor: { id: 'd1', fullName: 'Dr. Amelia Chen', specialty: 'Internal Medicine' },
        },
      ]),
    'GET /patients/PT-1001/studies': () =>
      envelope([
        {
          category: 'chemistry',
          studies: [
            {
              id: 's1',
              modality: 'lab',
              categoryLabel: 'Chemistry',
              name: 'HbA1c',
              performedOn: '2026-09-01',
              status: 'completed',
            },
            {
              id: 's2',
              modality: 'imaging',
              categoryLabel: 'Chest',
              name: 'Chest X-ray',
              performedOn: '2026-09-02',
              status: 'pending',
            },
          ],
        },
      ]),
    ...overrides,
  };
}

describe('httpProfileService.getProfile — what a chart shows on opening', () => {
  it('reads the bundle and the appointments the summary column shows', async () => {
    const { unmatched } = stubApi(routes());

    const { patient, profile } = await httpProfileService.getProfile('PT-1001');

    expect(unmatched).toEqual([]);
    expect(patient).toMatchObject({
      name: 'Khaled Nassar',
      chronicConditions: ['Hypertension', 'Type 2 diabetes'],
    });
    expect(profile.vitals).toMatchObject({ bloodPressure: '138/86', heartRateBpm: 76, bmi: 28.4 });
    expect(profile.appointments[0]).toMatchObject({
      dateTime: '2026-10-10T09:00:00.000Z',
      type: 'Follow-up',
      doctor: 'Dr. Amelia Chen',
      department: null,
      status: 'scheduled',
    });
    expect(profile.alerts).toEqual([
      { id: 'al1', severity: 'warning', message: 'BP above target' },
    ]);
  });

  it('reads no tab it does not show — each tab read is an audited view server-side', async () => {
    const { requests } = stubApi(routes());

    await httpProfileService.getProfile('PT-1001');

    expect(requests.map((request) => request.path).sort()).toEqual([
      '/patients/PT-1001/appointments',
      '/patients/PT-1001/profile',
    ]);
  });

  it('chooses the primary emergency contact, not the first listed', async () => {
    stubApi(routes());

    const { profile } = await httpProfileService.getProfile('PT-1001');

    expect(primaryEmergencyContact(profile.emergencyContacts)).toMatchObject({
      name: 'Rania Nassar',
      relationship: 'Spouse',
      phone: '+20 2',
      isPrimary: true,
    });
  });

  it('invents nothing the API does not hold: no summary, no insurance, no vitals, no contact', async () => {
    stubApi(
      routes({
        'GET /patients/PT-1001/profile': () =>
          bundle({ latestVitals: null, emergencyContacts: [], clinicalAlerts: [] }),
      }),
    );

    const { profile } = await httpProfileService.getProfile('PT-1001');

    expect(profile.summary).toBe('');
    expect(profile.insurance).toBeNull();
    expect(profile.vitals).toBeNull();
    expect(profile.emergencyContacts).toEqual([]);
    expect(profile.alerts).toEqual([]);
  });

  it('reports a chart outside the care scope (404) as not found', async () => {
    stubApi(
      routes({
        'GET /patients/PT-1001/profile': () =>
          json({ message: 'Not found', code: 'not_found' }, 404),
      }),
    );

    await expect(httpProfileService.getProfile('PT-1001')).rejects.toThrow(PATIENT_NOT_FOUND);
  });

  it('lets any other failure through to the error state', async () => {
    stubApi(
      routes({
        'GET /patients/PT-1001/appointments': () => json({ message: 'boom', ref: 'r1' }, 500),
      }),
    );

    await expect(httpProfileService.getProfile('PT-1001')).rejects.toMatchObject({
      kind: 'server',
    });
  });
});

describe('httpProfileService.getTab — one tab, one read', () => {
  it('reads exactly the opened tab’s endpoint', async () => {
    const { requests } = stubApi(routes());

    const history = await httpProfileService.getTab('PT-1001', 'history');

    expect(requests.map((request) => request.path)).toEqual(['/patients/PT-1001/history']);
    expect(history[0]).toMatchObject({ date: '2019-05-14', detail: '' });
  });

  it('maps notes with the author handle the API sends', async () => {
    stubApi(routes());

    const notes = await httpProfileService.getTab('PT-1001', 'notes');

    expect(notes[0]).toMatchObject({ author: 'usr_demo_1', signed: false });
  });

  it('shows where a medication came from rather than an invented prescriber', async () => {
    stubApi(routes());

    const medications = await httpProfileService.getTab('PT-1001', 'medications');

    expect(medications.map((medication) => medication.prescribedBy)).toEqual([
      'Prescription RX-2001',
      'Patient-reported',
    ]);
  });

  it('keeps only imaging studies for the Imaging tab', async () => {
    stubApi(routes());

    const imaging = await httpProfileService.getTab('PT-1001', 'imaging');

    expect(imaging).toEqual([
      {
        id: 'chemistry-imaging',
        label: 'Chest',
        studies: [{ id: 's2', name: 'Chest X-ray', date: '2026-09-02', status: 'pending' }],
      },
    ]);
  });

  it('reports a tab failure as an error, not as an empty tab', async () => {
    stubApi(routes({ 'GET /patients/PT-1001/notes': () => json({ message: 'boom' }, 500) }));

    await expect(httpProfileService.getTab('PT-1001', 'notes')).rejects.toMatchObject({
      kind: 'server',
    });
  });
});

describe('httpProfileService.addAllergy — API §4.6', () => {
  const allergyView = {
    id: 'alg-1',
    allergen: 'Penicillin',
    severity: 'severe',
    reaction: 'Anaphylaxis',
    notes: null,
    recordedAt: '2026-10-21T09:00:00.000Z',
    recordedBy: null,
  };

  it('posts the trimmed allergy, omitting empty notes, and reads the record back', async () => {
    const { requests } = stubApi({
      'POST /patients/PT-1001/allergies': () => json(envelope(allergyView), 201),
    });

    const record = await httpProfileService.addAllergy('PT-1001', {
      allergen: ' Penicillin ',
      severity: 'severe',
      reaction: ' Anaphylaxis ',
      notes: '   ',
    });

    expect(requests[0]?.body).toEqual({
      allergen: 'Penicillin',
      severity: 'severe',
      reaction: 'Anaphylaxis',
    });
    expect(record).toMatchObject({ id: 'alg-1', allergen: 'Penicillin', severity: 'severe' });
  });

  it('passes a duplicate allergen (409) through as a conflict', async () => {
    stubApi({
      'POST /patients/PT-1001/allergies': () =>
        json(
          {
            message: 'Conflict',
            code: 'conflict',
            detail: 'That allergen is already recorded for this patient',
          },
          409,
        ),
    });

    await expect(
      httpProfileService.addAllergy('PT-1001', {
        allergen: 'Penicillin',
        severity: 'mild',
        reaction: 'Rash',
        notes: '',
      }),
    ).rejects.toMatchObject({ kind: 'conflict' });
  });

  it('reports a chart outside the care scope (404) as not found', async () => {
    stubApi({
      'POST /patients/PT-9999/allergies': () => json({ message: 'Not found' }, 404),
    });

    await expect(
      httpProfileService.addAllergy('PT-9999', {
        allergen: 'Latex',
        severity: 'mild',
        reaction: 'Rash',
        notes: '',
      }),
    ).rejects.toThrow(PATIENT_NOT_FOUND);
  });
});

describe('httpProfileService.recordVitals — API §4.6', () => {
  const body = {
    systolic: 128,
    diastolic: 82,
    heartRate: 74,
    temperatureC: 36.8,
    respiratoryRate: 16,
    oxygenSaturation: 97,
    weightKg: 81.5,
    heightCm: 176,
  };

  it('posts the reading and reads back the server’s BMI rather than computing one', async () => {
    const { requests } = stubApi({
      'POST /patients/PT-1001/vitals': () =>
        json(
          envelope({
            id: 'vit-1',
            recordedAt: '2026-10-21T09:00:00.000Z',
            ...body,
            bmi: 26.3,
            recordedBy: null,
          }),
          201,
        ),
    });

    const vitals = await httpProfileService.recordVitals('PT-1001', body);

    expect(requests[0]?.body).toEqual(body);
    expect(vitals).toMatchObject({ bloodPressure: '128/82', heartRateBpm: 74, bmi: 26.3 });
  });

  it('reports a chart outside the care scope (404) as not found', async () => {
    stubApi({ 'POST /patients/PT-9999/vitals': () => json({ message: 'Not found' }, 404) });
    await expect(httpProfileService.recordVitals('PT-9999', body)).rejects.toThrow(
      PATIENT_NOT_FOUND,
    );
  });
});

describe('httpProfileService.addAlert — API §4.5', () => {
  it('posts the severity and the trimmed message, and maps the server’s alert', async () => {
    const { requests } = stubApi({
      'POST /patients/PT-1001/alerts': () =>
        json(
          envelope({
            id: 'alr-1',
            severity: 'critical',
            message: 'On warfarin — check INR before any procedure.',
            active: true,
            createdAt: '2026-10-21T10:00:00.000Z',
          }),
          201,
        ),
    });

    const alert = await httpProfileService.addAlert('PT-1001', {
      severity: 'critical',
      message: '  On warfarin — check INR before any procedure.  ',
    });

    expect(requests[0]?.method).toBe('POST');
    expect(requests[0]?.body).toEqual({
      severity: 'critical',
      message: 'On warfarin — check INR before any procedure.',
    });
    expect(alert).toEqual({
      id: 'alr-1',
      severity: 'critical',
      message: 'On warfarin — check INR before any procedure.',
    });
  });

  it('reads a 404 as a chart outside the doctor’s scope', async () => {
    stubApi({
      'POST /patients/PT-9999/alerts': () => json({ message: 'Patient not found' }, 404),
    });
    await expect(
      httpProfileService.addAlert('PT-9999', { severity: 'warning', message: 'Falls risk.' }),
    ).rejects.toThrow(PATIENT_NOT_FOUND);
  });
});

describe('httpProfileService.addHistoryEvent — API §4.6', () => {
  const created = {
    id: 'hst-1',
    kind: 'surgery',
    title: 'Laparoscopic cholecystectomy',
    occurredOn: '2019-05-14',
    detail: null,
    facility: 'City Hospital',
  };

  it('posts the event, omitting optional fields left empty', async () => {
    const { requests } = stubApi({
      'POST /patients/PT-1001/history': () => json(envelope(created), 201),
    });

    const event = await httpProfileService.addHistoryEvent('PT-1001', {
      kind: 'surgery',
      title: ' Laparoscopic cholecystectomy ',
      occurredOn: '2019-05-14',
      detail: '   ',
      facility: 'City Hospital',
    });

    expect(requests[0]?.body).toEqual({
      kind: 'surgery',
      title: 'Laparoscopic cholecystectomy',
      occurredOn: '2019-05-14',
      facility: 'City Hospital',
    });
    expect(event).toEqual({
      id: 'hst-1',
      kind: 'surgery',
      title: 'Laparoscopic cholecystectomy',
      date: '2019-05-14',
      detail: '',
      facility: 'City Hospital',
    });
  });

  it('passes the server’s refusal of a future date through untouched', async () => {
    stubApi({
      'POST /patients/PT-1001/history': () =>
        json(
          {
            message: 'Validation failed',
            code: 'validation_failed',
            errors: [{ field: 'occurredOn', message: 'A history event cannot be in the future' }],
          },
          422,
        ),
    });
    await expect(
      httpProfileService.addHistoryEvent('PT-1001', {
        kind: 'diagnosis',
        title: 'Hypertension',
        occurredOn: '2999-01-01',
        detail: '',
        facility: '',
      }),
    ).rejects.toMatchObject({ kind: 'validation' });
  });
});

describe('httpProfileService emergency contacts — API §4.6', () => {
  const view = {
    id: 'ec-9',
    name: 'Omar Nassar',
    relationship: 'Brother',
    phone: '+20 100 123 4567',
    isPrimary: true,
  };
  const input = {
    name: ' Omar Nassar ',
    relationship: 'Brother',
    phone: ' +20 100 123 4567 ',
    isPrimary: true,
  };

  it('adds through POST with the trimmed fields', async () => {
    const { requests } = stubApi({
      'POST /patients/PT-1001/emergency-contacts': () => json(envelope(view), 201),
    });

    const saved = await httpProfileService.addEmergencyContact('PT-1001', input);

    expect(requests[0]?.body).toEqual({
      name: 'Omar Nassar',
      relationship: 'Brother',
      phone: '+20 100 123 4567',
      isPrimary: true,
    });
    expect(saved).toEqual(view);
  });

  it('corrects one contact through PATCH on its own path', async () => {
    const { requests } = stubApi({
      'PATCH /patients/PT-1001/emergency-contacts/ec-9': () => json(envelope(view)),
    });

    await httpProfileService.updateEmergencyContact('PT-1001', 'ec-9', input);

    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'PATCH /patients/PT-1001/emergency-contacts/ec-9',
    ]);
  });
});

describe('httpProfileService retractions — DEC-003, BR-DEC-003', () => {
  it('resolves an alert by setting active: false, never by deleting it', async () => {
    const { requests } = stubApi({
      'PATCH /patients/PT-1001/alerts/alr-1': () =>
        json(envelope({ id: 'alr-1', severity: 'critical', message: 'x', active: false })),
    });

    await httpProfileService.resolveAlert('PT-1001', 'alr-1', '');

    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'PATCH /patients/PT-1001/alerts/alr-1',
    ]);
    // No reason given → none sent, rather than an empty one the schema refuses.
    expect(requests[0]?.body).toEqual({ active: false });
  });

  it('sends an alert’s resolution reason, trimmed, beside active: false', async () => {
    const { requests } = stubApi({
      'PATCH /patients/PT-1001/alerts/alr-1': () =>
        json(
          envelope({
            id: 'alr-1',
            severity: 'critical',
            message: 'x',
            active: false,
            resolutionReason: 'Anticoagulation stopped',
          }),
        ),
    });

    await httpProfileService.resolveAlert('PT-1001', 'alr-1', '  Anticoagulation stopped  ');

    expect(requests[0]?.body).toEqual({ active: false, reason: 'Anticoagulation stopped' });
  });

  it('removes a contact through DELETE on its own path, carrying the reason', async () => {
    const { requests } = stubApi({
      'DELETE /patients/PT-1001/emergency-contacts/ec-9': () => new Response(null, { status: 204 }),
    });

    await httpProfileService.removeEmergencyContact('PT-1001', 'ec-9', ' Patient asked ');

    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'DELETE /patients/PT-1001/emergency-contacts/ec-9',
    ]);
    expect(requests[0]?.body).toEqual({ reason: 'Patient asked' });
  });

  it('removes a history event through DELETE with its reason in the body', async () => {
    const { requests } = stubApi({
      'DELETE /patients/PT-1001/history/ev-3': () => new Response(null, { status: 204 }),
    });

    await httpProfileService.removeHistoryEvent('PT-1001', 'ev-3', 'Entered on the wrong chart ');

    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'DELETE /patients/PT-1001/history/ev-3',
    ]);
    expect(requests[0]?.body).toEqual({ reason: 'Entered on the wrong chart' });
  });

  it('passes the server’s 422 for a history removal without a reason through', async () => {
    stubApi({
      'DELETE /patients/PT-1001/history/ev-3': () =>
        json(
          {
            message: 'Validation failed',
            code: 'validation_failed',
            fieldErrors: { reason: ['A reason is required to remove a history event'] },
          },
          422,
        ),
    });
    await expect(
      httpProfileService.removeHistoryEvent('PT-1001', 'ev-3', ''),
    ).rejects.toMatchObject({ kind: 'validation' });
  });

  it('passes a refusal through rather than reporting success', async () => {
    stubApi({
      'PATCH /patients/PT-1001/alerts/alr-404': () => json({ message: 'Alert not found' }, 404),
    });
    await expect(httpProfileService.resolveAlert('PT-1001', 'alr-404', '')).rejects.toThrow(
      PATIENT_NOT_FOUND,
    );
  });
});

describe('httpProfileService chart notes — DEC-001', () => {
  /** Ignored over HTTP — the server takes the caller from the session. */
  const ME = { id: 'usr_doctor_amelia', name: 'Dr. Amelia' };
  const view = {
    id: 'note-1',
    title: 'Telephone encounter',
    body: 'Reviewed results by phone.',
    authoredAt: '2026-10-21T10:00:00.000Z',
    author: 'usr_doctor_amelia',
    signed: false,
    signedAt: null,
    aiAssisted: false,
  };

  it('writes through POST and reads the author as the account id the session carries', async () => {
    const { requests } = stubApi({
      'POST /patients/PT-1001/notes': () => json(envelope(view), 201),
    });

    const saved = await httpProfileService.addNote(
      'PT-1001',
      { title: ' Telephone encounter ', body: ' Reviewed results by phone. ' },
      { id: 'ignored-by-the-server', name: 'ignored' },
    );

    // The server stamps the author from the session; the client sends none.
    expect(requests[0]?.body).toEqual({
      title: 'Telephone encounter',
      body: 'Reviewed results by phone.',
    });
    expect(saved).toMatchObject({ authorId: 'usr_doctor_amelia', signed: false });
  });

  it('corrects through PATCH and signs through …/sign', async () => {
    const { requests } = stubApi({
      'PATCH /patients/PT-1001/notes/note-1': () => json(envelope(view)),
      'POST /patients/PT-1001/notes/note-1/sign': () =>
        json(envelope({ ...view, signed: true, signedAt: '2026-10-21T11:00:00.000Z' })),
    });

    await httpProfileService.updateNote('PT-1001', 'note-1', { title: 'T', body: 'B' }, ME);
    const signed = await httpProfileService.signNote('PT-1001', 'note-1', ME);

    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'PATCH /patients/PT-1001/notes/note-1',
      'POST /patients/PT-1001/notes/note-1/sign',
    ]);
    expect(signed.signed).toBe(true);
  });

  it('passes the server’s 409 on a signed note through untouched', async () => {
    stubApi({
      'PATCH /patients/PT-1001/notes/note-1': () =>
        json(
          {
            message: 'A signed note cannot be edited',
            code: 'invalid_status_transition',
            detail: 'A signed note cannot be edited',
          },
          409,
        ),
    });
    await expect(
      httpProfileService.updateNote('PT-1001', 'note-1', { title: 'T', body: 'B' }, ME),
    ).rejects.toMatchObject({ kind: 'conflict' });
  });

  it('passes the server’s 403 not_note_author through with its code (BR-DEC-001)', async () => {
    stubApi({
      'POST /patients/PT-1001/notes/note-1/sign': () =>
        json({ message: 'Only the note’s author may sign it', code: 'not_note_author' }, 403),
    });
    await expect(httpProfileService.signNote('PT-1001', 'note-1', ME)).rejects.toMatchObject({
      kind: 'forbidden',
      code: NOT_NOTE_AUTHOR,
    });
  });
});
