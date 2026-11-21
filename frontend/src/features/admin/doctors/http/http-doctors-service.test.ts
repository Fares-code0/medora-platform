import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { envelope, json, pageOf, stubApi } from '@/test/api-stub';

import {
  __resetHttpDoctorTicks,
  httpDoctorsService,
  toDoctorDetail,
  toDoctorSummary,
} from './http-doctors-service';

/** Doctors management over HTTP (FE-10.10) — API §3.4–3.7. */

beforeEach(() => {
  __resetHttpDoctorTicks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const DOCTOR_ID = '6f1c1c5e-0000-4000-8000-000000000001';

function summaryView(overrides: Record<string, unknown> = {}) {
  return {
    id: DOCTOR_ID,
    fullName: 'Dr. Youssef Nabil',
    title: 'Cardiology Registrar',
    specialty: 'Cardiology',
    departmentName: 'Cardiology',
    licenseNumber: 'CA-211-6620',
    licenseExpiresOn: '2027-03-01',
    professionalCategory: null,
    verificationStatus: 'pending',
    practiceStatus: 'active',
    ratingAvg: null,
    lastActiveAt: null,
    joinedAt: '2026-09-10T08:00:00.000Z',
    patientsCount: 4,
    appointments30d: 11,
    ...overrides,
  };
}

function documentView(overrides: Record<string, unknown> = {}) {
  return {
    id: 'vdoc-1',
    kind: 'degree_certificate',
    fileId: 'file-1',
    uploadedAt: '2026-09-11T08:00:00.000Z',
    expiresOn: null,
    decision: 'pending',
    decidedAt: null,
    rejectReason: null,
    checks: { authentic: false, current: false, identityMatch: false },
    ...overrides,
  };
}

function detailView(overrides: Record<string, unknown> = {}) {
  return {
    ...summaryView(),
    contactEmail: 'youssef.nabil@medora.health',
    contactPhone: '+20 100 000 0000',
    officeLocation: null,
    officeHours: null,
    biography: null,
    yearsOfExperience: 4,
    languages: ['Arabic', 'English'],
    education: [],
    certifications: [],
    skills: [],
    employeeId: null,
    verifiedAt: null,
    documents: [documentView()],
    affectedAppointments: 3,
    verifiable: false,
    ...overrides,
  };
}

function problem(status: number, body: Record<string, unknown> = {}) {
  return json({ message: 'Refused', code: 'refused', ...body }, status);
}

describe('toDoctorSummary', () => {
  it('maps the roster columns and leaves unserved history empty, never zero', () => {
    const doctor = toDoctorSummary(summaryView({ verificationStatus: 'docs_requested' }));
    expect(doctor).toMatchObject({
      id: DOCTOR_ID,
      name: 'Dr. Youssef Nabil',
      verification: 'docs-requested',
      account: 'active',
      rating: null,
      lastActiveAt: null,
      licenseExpiresAt: '2027-03-01T00:00:00',
      documents: [],
      activity: null,
      statistics: null,
      administrative: null,
    });
  });

  it('refuses a verification status it does not know', () => {
    expect(() => toDoctorSummary(summaryView({ verificationStatus: 'maybe' }))).toThrow();
  });
});

describe('toDoctorDetail', () => {
  it('maps contact details and documents in the platform vocabulary', () => {
    const doctor = toDoctorDetail(
      detailView({
        documents: [
          documentView(),
          documentView({
            id: 'vdoc-2',
            kind: 'medical_license',
            decision: 'approved',
            expiresOn: '2027-03-01',
            decidedAt: '2026-09-12T08:00:00.000Z',
            checks: { authentic: true, current: true, identityMatch: true },
          }),
        ],
      }),
    );
    expect(doctor.email).toBe('youssef.nabil@medora.health');
    expect(doctor.languages).toEqual(['Arabic', 'English']);
    expect(doctor.bio).toBe('');
    expect(doctor.documents).toEqual([
      expect.objectContaining({
        id: 'vdoc-1',
        kind: 'degree',
        filename: null,
        decision: 'pending',
        checklist: { authentic: false, current: false, matchesIdentity: false },
        previewLines: [],
      }),
      expect.objectContaining({
        id: 'vdoc-2',
        kind: 'medical-license',
        expiresAt: '2027-03-01T00:00:00',
        reviewedAt: '2026-09-12T08:00:00.000Z',
        checklist: { authentic: true, current: true, matchesIdentity: true },
      }),
    ]);
  });
});

describe('httpDoctorsService — reads', () => {
  it('reads every roster page and lists no invitations', async () => {
    const { requests } = stubApi({ 'GET /doctors': () => pageOf([summaryView()]) });
    const document = await httpDoctorsService.list();
    expect(document.doctors).toHaveLength(1);
    expect(document.invites).toEqual([]);
    expect(requests[0]?.query.get('pageSize')).toBe('100');
  });

  it('answers null for a doctor the server does not know', async () => {
    stubApi({ [`GET /doctors/${DOCTOR_ID}`]: () => problem(404, { code: 'not_found' }) });
    await expect(httpDoctorsService.detail(DOCTOR_ID)).resolves.toBeNull();
  });

  it('surfaces a refused permission instead of an empty profile', async () => {
    stubApi({ [`GET /doctors/${DOCTOR_ID}`]: () => problem(403, { code: 'forbidden' }) });
    await expect(httpDoctorsService.detail(DOCTOR_ID)).rejects.toMatchObject({
      kind: 'forbidden',
    });
  });

  it('treats a malformed body as an error, never as an empty roster', async () => {
    stubApi({ 'GET /doctors': () => envelope({ items: 'nope' }) });
    await expect(httpDoctorsService.list()).rejects.toMatchObject({
      code: 'malformed_response',
    });
  });

  it('reads the pending badge from the server total, not a page of rows', async () => {
    const { requests } = stubApi({
      'GET /doctors': () =>
        envelope({ items: [summaryView()], page: 1, pageSize: 1, totalItems: 7, totalPages: 7 }),
    });
    await expect(httpDoctorsService.pendingVerifications()).resolves.toBe(7);
    expect(requests[0]?.query.get('verification')).toBe('pending');
    expect(requests[0]?.query.get('pageSize')).toBe('1');
  });

  it('reports a server failure on the badge read', async () => {
    stubApi({ 'GET /doctors': () => problem(500, { ref: 'ERR-1' }) });
    await expect(httpDoctorsService.pendingVerifications()).rejects.toMatchObject({
      kind: 'server',
    });
  });
});

describe('httpDoctorsService — the checklist and document decisions', () => {
  it('keeps unsubmitted ticks in memory and lays them over the pending document', async () => {
    stubApi({ [`GET /doctors/${DOCTOR_ID}`]: () => envelope(detailView()) });
    await httpDoctorsService.setCheck({
      doctorId: DOCTOR_ID,
      documentId: 'vdoc-1',
      field: 'authentic',
      value: true,
    });
    const doctor = await httpDoctorsService.detail(DOCTOR_ID);
    expect(doctor?.documents[0]?.checklist).toEqual({
      authentic: true,
      current: false,
      matchesIdentity: false,
    });
  });

  it('approves with the three attestations as the body, then forgets the ticks', async () => {
    const { requests } = stubApi({
      [`POST /doctors/${DOCTOR_ID}/documents/vdoc-1/approve`]: () => envelope(detailView()),
      [`GET /doctors/${DOCTOR_ID}`]: () => envelope(detailView()),
    });
    await httpDoctorsService.setCheck({
      doctorId: DOCTOR_ID,
      documentId: 'vdoc-1',
      field: 'current',
      value: true,
    });
    await expect(
      httpDoctorsService.approveDocument({ doctorId: DOCTOR_ID, documentId: 'vdoc-1', actor: 'A' }),
    ).resolves.toBeNull();
    expect(requests[0]?.body).toEqual({ authentic: true, current: true, identityMatch: true });

    const doctor = await httpDoctorsService.detail(DOCTOR_ID);
    expect(doctor?.documents[0]?.checklist.current).toBe(false);
  });

  it('rejects a document with the trimmed reason', async () => {
    const { requests } = stubApi({
      [`POST /doctors/${DOCTOR_ID}/documents/vdoc-1/reject`]: () => envelope(detailView()),
    });
    await httpDoctorsService.rejectDocument({
      doctorId: DOCTOR_ID,
      documentId: 'vdoc-1',
      actor: 'A',
      reason: '  The scan is cropped.  ',
    });
    expect(requests[0]?.body).toEqual({ reason: 'The scan is cropped.' });
  });

  it('passes a validation refusal through with its field message', async () => {
    stubApi({
      [`POST /doctors/${DOCTOR_ID}/documents/vdoc-1/reject`]: () =>
        problem(422, { fieldErrors: { reason: ['Say why'] } }),
    });
    await expect(
      httpDoctorsService.rejectDocument({
        doctorId: DOCTOR_ID,
        documentId: 'vdoc-1',
        actor: 'A',
        reason: 'x',
      }),
    ).rejects.toMatchObject({ kind: 'validation', fieldErrors: { reason: ['Say why'] } });
  });
});

describe('httpDoctorsService — verification and practice decisions', () => {
  it('completes verification, and passes the gate refusal through', async () => {
    stubApi({
      [`POST /doctors/${DOCTOR_ID}/verify`]: () =>
        problem(409, { detail: 'Outstanding documents: national_id' }),
    });
    await expect(
      httpDoctorsService.completeVerification({ doctorId: DOCTOR_ID, actor: 'A' }),
    ).rejects.toMatchObject({ kind: 'conflict', detail: 'Outstanding documents: national_id' });
  });

  it('requests documents by the API’s kinds', async () => {
    const { requests } = stubApi({
      [`POST /doctors/${DOCTOR_ID}/request-documents`]: () =>
        envelope({ doctorId: DOCTOR_ID, verificationStatus: 'docs_requested', verifiedAt: null }),
    });
    await expect(
      httpDoctorsService.requestDocuments({
        doctorId: DOCTOR_ID,
        actor: 'A',
        reason: 'A clear scan of both pages, please.',
        kinds: ['degree', 'identity', 'other'],
      }),
    ).resolves.toBeNull();
    expect(requests[0]?.body).toEqual({
      kinds: ['degree_certificate', 'national_id', 'other'],
      reason: 'A clear scan of both pages, please.',
    });
  });

  it('rejects the application, suspends and reactivates on their own routes', async () => {
    const { requests } = stubApi({
      [`POST /doctors/${DOCTOR_ID}/reject`]: () => envelope({}),
      [`POST /doctors/${DOCTOR_ID}/suspend`]: () =>
        envelope({ doctorId: DOCTOR_ID, practiceStatus: 'suspended', affectedAppointments: 3 }),
      [`POST /doctors/${DOCTOR_ID}/reactivate`]: () =>
        envelope({ doctorId: DOCTOR_ID, practiceStatus: 'active', affectedAppointments: 0 }),
    });
    await httpDoctorsService.rejectApplication({
      doctorId: DOCTOR_ID,
      actor: 'A',
      reason: 'Licence number does not match the register.',
    });
    await httpDoctorsService.suspend({
      doctorId: DOCTOR_ID,
      actor: 'A',
      reason: 'Prescribing audit opened.',
    });
    await httpDoctorsService.reactivate({ doctorId: DOCTOR_ID, actor: 'A' });
    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      `POST /doctors/${DOCTOR_ID}/reject`,
      `POST /doctors/${DOCTOR_ID}/suspend`,
      `POST /doctors/${DOCTOR_ID}/reactivate`,
    ]);
    expect(requests[1]?.body).toEqual({ reason: 'Prescribing audit opened.' });
  });

  it('reports a dropped session as an auth failure', async () => {
    stubApi({ [`POST /doctors/${DOCTOR_ID}/reactivate`]: () => problem(401) });
    await expect(
      httpDoctorsService.reactivate({ doctorId: DOCTOR_ID, actor: 'A' }),
    ).rejects.toMatchObject({ kind: 'auth' });
  });
});

describe('httpDoctorsService — what the platform does not serve', () => {
  it('says so, rather than pretending, and makes no request', async () => {
    const { requests } = stubApi({});
    const refusals = [
      httpDoctorsService.invite({
        email: 'a@b.co',
        specialty: 'Cardiology',
        roleTemplate: 'Consultant',
        actor: 'A',
      }),
      httpDoctorsService.resetAccess({ doctorId: DOCTOR_ID, actor: 'A' }),
      httpDoctorsService.returnToReview({ doctorId: DOCTOR_ID, actor: 'A' }),
      httpDoctorsService.updateAdministrative({
        doctorId: DOCTOR_ID,
        actor: 'A',
        fields: { roleTemplate: 'Consultant', clinic: 'Medora Central' },
      }),
    ];
    for (const refusal of refusals) {
      await expect(refusal).rejects.toMatchObject({ code: 'not_connected' });
    }
    expect(requests).toEqual([]);
    expect(httpDoctorsService.capabilities).toEqual({
      invite: false,
      resetAccess: false,
      returnToReview: false,
      administrativeFields: false,
    });
  });
});
