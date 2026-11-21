import { afterEach, describe, expect, it, vi } from 'vitest';

import { envelope, json, pageOf, stubApi } from '@/test/api-stub';

import { assessAnnotation } from '../model/annotation';
import { LAB_NOT_FOUND } from '../model/lab-service';
import { assessOrder } from '../model/ordering';
import { assessReviewability } from '../model/review';

import { httpLabService, toLabTest, toTestSpec } from './http-lab-service';

/**
 * The laboratory over HTTP (FE-10.7), against bodies captured from API §8
 * on a seeded database: a CBC ordered, collected, resulted and released for
 * PT-1004 with a critical haemoglobin (`LAB-100000`).
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

const CRITICAL_ID = 'c3727f0f-16cf-4082-a790-83bd0579d14d';

function orderView(overrides: Record<string, unknown> = {}) {
  return {
    id: 'LAB-100000',
    patient: {
      id: 'PT-1004',
      name: 'Omar Farouk',
      mrn: '4472-90',
      age: 60,
      gender: 'male',
      bloodType: 'AB_POSITIVE',
      phone: '+20 101 662 7408',
    },
    testName: 'Complete Blood Count (CBC)',
    testCode: '58410-2',
    category: 'Hematology',
    department: 'Internal Medicine',
    orderedBy: 'Dr. Amelia Chen',
    clinicalIndication: 'Fatigue, rule out anaemia',
    status: 'completed',
    priority: 'urgent',
    requestedDate: '2026-10-04T18:11:25.552Z',
    collectedDate: '2026-10-04T18:11:30.605Z',
    completedDate: '2026-10-04T18:11:35.906Z',
    hasCriticalResult: true,
    resultSummary: { total: 2, abnormal: 1, critical: 1 },
    reviewStatus: 'unreviewed',
    review: null,
    createdAt: '2026-10-04T18:11:25.552Z',
    updatedAt: '2026-10-04T18:11:35.906Z',
    ...overrides,
  };
}

function detailView(overrides: Record<string, unknown> = {}) {
  return {
    ...orderView(),
    specimen: {
      type: 'Whole blood',
      container: 'EDTA (lavender top)',
      collectionSite: 'Left antecubital',
      collectedBy: 'Dr. Amelia Chen',
      collectedAt: '2026-10-04T18:11:30.605Z',
      receivedAt: '2026-10-04T18:11:30.661Z',
      condition: 'Acceptable',
      volume: '3 mL',
    },
    results: [
      {
        id: CRITICAL_ID,
        analyte: 'Hemoglobin',
        value: '6.4',
        numericValue: 6.4,
        unit: 'g/dL',
        referenceRange: { low: 12, high: 17, text: '12.0–17.0' },
        flag: 'critical-low',
        resultedAt: '2026-10-04T18:11:35.826Z',
      },
      {
        id: 'f98c927e-ee99-479a-be83-6eec21c23efc',
        analyte: 'Platelets',
        value: '210',
        numericValue: 210,
        unit: '10³/µL',
        referenceRange: { low: 150, high: 400, text: '150–400' },
        flag: 'normal',
        resultedAt: '2026-10-04T18:11:35.826Z',
      },
    ],
    interpretation: 'Severe anaemia.',
    attachments: [],
    timeline: [
      {
        id: '5439e9c3-10da-4980-b4bb-98794879f282',
        kind: 'verified',
        at: '2026-10-04T18:11:35.906Z',
        actor: 'Dr. Amelia Chen',
        detail: 'Results verified and released',
      },
    ],
    ...overrides,
  };
}

const CBC = {
  id: '7dd86192-304b-4043-84ae-adace437eb07',
  name: 'Complete Blood Count (CBC)',
  code: '58410-2',
  category: 'Hematology',
  specimenType: 'Whole blood',
  container: 'EDTA (lavender top)',
  active: true,
  analytes: [
    {
      id: '55c97804-5804-4432-b0a3-a48fd12b7596',
      analyte: 'Hemoglobin',
      unit: 'g/dL',
      refLow: 12,
      refHigh: 17,
      decimals: 1,
      criticalLow: 7,
      criticalHigh: 20,
      qualitativeOptions: [],
      referenceText: '12.0–17.0',
    },
  ],
};

describe('mapping', () => {
  it('maps the catalogue, keeping absent bounds absent', () => {
    expect(toTestSpec(CBC)).toEqual({
      name: 'Complete Blood Count (CBC)',
      code: '58410-2',
      category: 'Hematology',
      specimen: 'Whole blood',
      container: 'EDTA (lavender top)',
      analytes: [
        {
          analyte: 'Hemoglobin',
          unit: 'g/dL',
          low: 12,
          high: 17,
          decimals: 1,
          criticalLow: 7,
          criticalHigh: 20,
        },
      ],
    });
  });

  it('maps the order with its results, and reports no annotations rather than inventing any', () => {
    const test = toLabTest(detailView());
    expect(test).toMatchObject({
      id: 'LAB-100000',
      patient: { bloodType: 'AB+' },
      status: 'completed',
      hasCriticalResult: true,
      results: [{ id: CRITICAL_ID, flag: 'critical-low' }, { flag: 'normal' }],
      annotations: [],
    });
  });

  it('marks what the server does not serve about a review as unknown, not as empty', () => {
    const test = toLabTest(
      detailView({
        review: { reviewedAt: '2026-10-04T19:00:00.000Z', reviewedBy: 'Dr. Amelia Chen' },
      }),
    );
    expect(test.review).toEqual({
      reviewedAt: '2026-10-04T19:00:00.000Z',
      reviewedBy: 'Dr. Amelia Chen',
      acknowledgedCriticalIds: null,
      note: null,
    });
  });
});

describe('reads', () => {
  it('reads the active catalogue only', async () => {
    stubApi({
      'GET /lab-tests/catalogue': () => pageOf([CBC, { ...CBC, code: '00000-0', active: false }]),
    });
    const catalogue = await httpLabService.listCatalogue();
    expect(catalogue.map((spec) => spec.code)).toEqual(['58410-2']);
  });

  it('loads every order’s document behind the list, so the result rules have results', async () => {
    const { requests } = stubApi({
      'GET /lab-orders': () => pageOf([orderView(), orderView({ id: 'LAB-100001' })]),
      'GET /lab-orders/LAB-100000': () => envelope(detailView()),
      'GET /lab-orders/LAB-100001': () => envelope(detailView({ id: 'LAB-100001' })),
    });

    const tests = await httpLabService.listLabTests();

    expect(tests.map((test) => test.id)).toEqual(['LAB-100000', 'LAB-100001']);
    expect(tests[0]?.results).toHaveLength(2);
    expect(requests[0]?.query.get('sort')).toBe('requestedAt:desc');
  });

  /*
   * MED-SEC-014. The backend lost the care scope when the worklist was
   * searched server-side (`q`), and the CSV export read the same clause. The
   * worklist must therefore never ask for anything but "my orders, a page at
   * a time": no `q`, no patient, doctor or scope parameter the client could
   * widen, and no summary or export read — search, filters and counts are
   * computed from what the server scoped.
   */
  it('asks only for the caller’s own orders — no search, patient, doctor or scope parameter', async () => {
    const { requests } = stubApi({
      'GET /lab-orders': () => pageOf([orderView()]),
      'GET /lab-orders/LAB-100000': () => envelope(detailView()),
    });

    await httpLabService.listLabTests();

    const list = requests.filter((request) => request.path === '/lab-orders');
    expect(list.length).toBeGreaterThan(0);
    for (const request of list) {
      expect([...request.query.keys()].sort()).toEqual(['page', 'pageSize', 'sort']);
    }
    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'GET /lab-orders',
      'GET /lab-orders/LAB-100000',
    ]);
  });

  it('asks for every page with the same caller-scoped parameters, and nothing more', async () => {
    const page = (number: number, id: string) =>
      envelope({ items: [orderView({ id })], page: number, pageSize: 100, totalItems: 2, totalPages: 2 });
    const { requests } = stubApi({
      'GET /lab-orders': (request) =>
        request.query.get('page') === '1' ? page(1, 'LAB-100000') : page(2, 'LAB-100001'),
      'GET /lab-orders/LAB-100000': () => envelope(detailView()),
      'GET /lab-orders/LAB-100001': () => envelope(detailView({ id: 'LAB-100001' })),
    });

    const tests = await httpLabService.listLabTests();

    const list = requests.filter((request) => request.path === '/lab-orders');
    expect(list.map((request) => request.query.get('page'))).toEqual(['1', '2']);
    for (const request of list) {
      expect([...request.query.keys()].sort()).toEqual(['page', 'pageSize', 'sort']);
    }
    expect(tests.map((test) => test.id)).toEqual(['LAB-100000', 'LAB-100001']);
  });

  it('lists exactly the orders the server served, and reads no order it did not list', async () => {
    const { requests } = stubApi({
      'GET /lab-orders': () => pageOf([orderView({ id: 'LAB-100001' })]),
      'GET /lab-orders/LAB-100001': () => envelope(detailView({ id: 'LAB-100001' })),
    });

    const tests = await httpLabService.listLabTests();

    expect(tests.map((test) => test.id)).toEqual(['LAB-100001']);
    expect(requests.filter((request) => request.path.startsWith('/lab-orders/'))).toHaveLength(1);
  });

  it('fails the list when one document cannot be read — never a list missing an order', async () => {
    stubApi({
      'GET /lab-orders': () => pageOf([orderView()]),
      'GET /lab-orders/LAB-100000': () => json({ message: 'Internal' }, 500),
    });
    await expect(httpLabService.listLabTests()).rejects.toMatchObject({ kind: 'server' });
  });

  it('turns a 404 into the port’s not-found contract', async () => {
    stubApi({
      'GET /lab-orders/LAB-1': () =>
        json({ message: 'Lab order not found', code: 'not_found' }, 404),
    });
    await expect(httpLabService.getLabTest('LAB-1')).rejects.toThrow(LAB_NOT_FOUND);
  });
});

describe('review', () => {
  it('sends the acknowledged critical values and the note', async () => {
    const test = toLabTest(detailView());
    const { reviewable } = assessReviewability({
      test,
      reviewedBy: 'Dr. Amelia Chen',
      acknowledgedCriticalIds: [CRITICAL_ID],
      note: 'Patient called; transfusion arranged.',
    });
    if (reviewable === null) throw new Error('fixture is not reviewable');
    const { requests } = stubApi({
      'POST /lab-orders/LAB-100000/review': () =>
        envelope(
          detailView({
            review: { reviewedAt: '2026-10-04T19:00:00.000Z', reviewedBy: 'Dr. Amelia Chen' },
          }),
        ),
    });

    const reviewed = await httpLabService.markReviewed(reviewable);

    expect(requests[0]?.body).toEqual({
      acknowledgedResultIds: [CRITICAL_ID],
      note: 'Patient called; transfusion arranged.',
    });
    expect(reviewed.review?.reviewedBy).toBe('Dr. Amelia Chen');
  });

  it('reports the server’s refusal as it gave it', async () => {
    const test = toLabTest(detailView());
    const { reviewable } = assessReviewability({
      test,
      reviewedBy: 'Dr. Amelia Chen',
      acknowledgedCriticalIds: [CRITICAL_ID],
      note: 'Called.',
    });
    if (reviewable === null) throw new Error('fixture is not reviewable');
    stubApi({
      'POST /lab-orders/LAB-100000/review': () =>
        json(
          {
            message: 'Conflict',
            code: 'already_reviewed',
            detail: 'This result was reviewed by Dr. Hassan Fouad',
          },
          409,
        ),
    });
    await expect(httpLabService.markReviewed(reviewable)).rejects.toMatchObject({
      kind: 'conflict',
      detail: 'This result was reviewed by Dr. Hassan Fouad',
    });
  });

  it('bulk-reviews by id and returns the full documents of what was reviewed', async () => {
    const normal = toLabTest(
      detailView({
        id: 'LAB-100001',
        hasCriticalResult: false,
        results: [detailView().results[1]],
      }),
    );
    const { reviewable } = assessReviewability({
      test: normal,
      reviewedBy: 'Dr. Amelia Chen',
      acknowledgedCriticalIds: [],
      note: '',
    });
    if (reviewable === null) throw new Error('fixture is not reviewable');
    const { requests } = stubApi({
      'POST /lab-orders/review': () => envelope({ reviewed: [orderView({ id: 'LAB-100001' })] }),
      'GET /lab-orders/LAB-100001': () => envelope(detailView({ id: 'LAB-100001' })),
    });

    const reviewed = await httpLabService.markManyReviewed([reviewable]);

    expect(requests[0]?.body).toEqual({ ids: ['LAB-100001'], bulk: true });
    expect(reviewed.map((test) => test.id)).toEqual(['LAB-100001']);
  });
});

describe('ordering', () => {
  const patient = {
    id: 'PT-1004',
    mrn: '4472-90',
    name: 'Omar Farouk',
    dateOfBirth: '1966-01-01T00:00:00',
    age: 60,
    gender: 'male' as const,
    bloodType: 'AB+' as const,
    phone: '+20 101 662 7408',
    photoUrl: null,
    lastVisit: null,
    nextAppointment: null,
    assignedDoctor: 'Dr. Amelia Chen',
    status: 'active' as const,
    riskLevel: 'low' as const,
    chronicConditions: [],
    allergies: [],
    hasSevereAllergy: false,
    registeredAt: '2025-10-04T15:51:06.455Z',
  };

  function orderable(codes: readonly string[]) {
    const catalogue = [
      toTestSpec(CBC),
      toTestSpec({ ...CBC, code: '57698-3', name: 'Lipid Panel' }),
    ];
    const { orderable: request } = assessOrder({
      draft: {
        patient,
        testCodes: codes,
        priority: 'urgent',
        department: 'Cardiology',
        clinicalIndication: 'Fatigue, rule out anaemia',
      },
      orderedBy: 'Dr. Amelia Chen',
      catalogue,
    });
    if (request === null) throw new Error('fixture is not orderable');
    return request;
  }

  it('places one order per test', async () => {
    const { requests } = stubApi({
      'POST /lab-orders': () => json(envelope(detailView({ status: 'ordered', results: [] })), 201),
    });

    const created = await httpLabService.orderLabs(orderable(['58410-2', '57698-3']));

    expect(created).toHaveLength(2);
    expect(requests.map((request) => request.body)).toEqual([
      {
        patientId: 'PT-1004',
        testCode: '58410-2',
        priority: 'urgent',
        clinicalIndication: 'Fatigue, rule out anaemia',
        department: 'Cardiology',
      },
      {
        patientId: 'PT-1004',
        testCode: '57698-3',
        priority: 'urgent',
        clinicalIndication: 'Fatigue, rule out anaemia',
        department: 'Cardiology',
      },
    ]);
  });

  it('names what was placed when a later test fails, rather than claiming nothing was', async () => {
    let calls = 0;
    stubApi({
      'POST /lab-orders': () => {
        calls += 1;
        return calls === 1
          ? json(envelope(detailView({ status: 'ordered', results: [] })), 201)
          : json({ message: 'Internal' }, 500);
      },
    });

    await expect(httpLabService.orderLabs(orderable(['58410-2', '57698-3']))).rejects.toThrow(
      /LAB-100000 placed; Lipid Panel and any later tests were not/,
    );
  });
});

describe('annotations', () => {
  it('refuses as not connected — the API has no annotation route', async () => {
    const { requests } = stubApi({});
    const { annotatable } = assessAnnotation({
      test: toLabTest(detailView()),
      text: 'Chased with the ward.',
      author: 'Dr. Amelia Chen',
      resultId: null,
    });
    if (annotatable === null) throw new Error('fixture is not annotatable');

    await expect(httpLabService.annotate(annotatable)).rejects.toMatchObject({
      code: 'not_connected',
    });
    expect(requests).toHaveLength(0);
    expect(httpLabService.capabilities.annotations).toBe(false);
  });
});

describe('trends (API §8.8)', () => {
  const trendsView = (overrides: Record<string, unknown> = {}) => ({
    patientId: 'PT-1004',
    series: [
      {
        analyte: 'Potassium',
        unit: 'mmol/L',
        referenceLow: 3.5,
        referenceHigh: 5.1,
        referenceText: '3.5–5.1',
        points: [
          { labId: 'LAB-100010', at: '2026-09-01T08:00:00.000Z', value: 4.9, flag: 'normal' },
          {
            labId: 'LAB-100020',
            at: '2026-10-01T08:00:00.000Z',
            value: 6.6,
            flag: 'critical-high',
          },
        ],
      },
    ],
    empty: ['Sodium'],
    ...overrides,
  });

  it('asks for the patient’s history by analyte, in the order selected', async () => {
    const { requests } = stubApi({
      'GET /patients/PT-1004/lab-trends': () => envelope(trendsView()),
    });

    const trends = await httpLabService.getTrends('PT-1004', ['Potassium', 'Sodium']);

    expect(requests[0]?.query.get('analytes')).toBe('Potassium,Sodium');
    expect(trends.empty).toEqual(['Sodium']);
    expect(trends.series[0]).toMatchObject({
      analyte: 'Potassium',
      referenceLow: 3.5,
      referenceHigh: 5.1,
      points: [
        { labId: 'LAB-100010', value: 4.9, flag: 'normal' },
        { labId: 'LAB-100020', value: 6.6, flag: 'critical-high' },
      ],
    });
  });

  it('keeps a series with no numeric range as having none, not as zero', async () => {
    stubApi({
      'GET /patients/PT-1004/lab-trends': () =>
        envelope(
          trendsView({
            series: [{ ...trendsView().series[0], referenceLow: null, referenceHigh: null }],
          }),
        ),
    });
    const trends = await httpLabService.getTrends('PT-1004', ['Potassium']);
    expect(trends.series[0]).toMatchObject({ referenceLow: null, referenceHigh: null });
  });

  it('refuses an answer about another patient rather than plotting it', async () => {
    stubApi({
      'GET /patients/PT-1004/lab-trends': () => envelope(trendsView({ patientId: 'PT-2000' })),
    });
    await expect(httpLabService.getTrends('PT-1004', ['Potassium'])).rejects.toMatchObject({
      code: 'malformed_response',
    });
  });

  it('refuses a flag outside the result vocabulary', async () => {
    const series = trendsView().series[0]!;
    stubApi({
      'GET /patients/PT-1004/lab-trends': () =>
        envelope(
          trendsView({
            series: [{ ...series, points: [{ ...series.points[0], flag: 'borderline' }] }],
          }),
        ),
    });
    await expect(httpLabService.getTrends('PT-1004', ['Potassium'])).rejects.toMatchObject({
      code: 'malformed_response',
    });
  });

  it('passes a server failure through for the drawer to report', async () => {
    stubApi({
      'GET /patients/PT-1004/lab-trends': () => json({ message: 'Internal' }, 500),
    });
    await expect(httpLabService.getTrends('PT-1004', ['Potassium'])).rejects.toMatchObject({
      kind: 'server',
    });
  });
});
