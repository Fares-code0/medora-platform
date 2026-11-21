import { EndpointNotImplementedError } from '@/api/seam';
import { ResponseContractError } from '@/schemas/envelope';
import { isApiError } from '@/types/api';

import { httpDoctorService } from './http-doctor-service';
import { FORBIDDEN_DOCTOR_FIELDS } from './model/types';

/**
 * The live doctor-discovery adapter — checklist G-01…G-05, G-08, V-10.
 *
 * These tests stub `fetch` and drive the real `ApiClient`, so what they
 * assert is what actually goes on the wire and what actually comes back
 * off it — the same approach `api/client.test.ts` takes. A test that
 * mocked `doctorEndpoints` would prove the mapper maps and nothing about
 * the request.
 */

interface FetchCall {
  readonly url: string;
}

function stubFetch(responses: readonly Response[]): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  let index = 0;
  global.fetch = jest.fn((input: RequestInfo | URL) => {
    calls.push({ url: String(input) });
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return Promise.resolve(response as Response);
  });
  return { calls };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const SUMMARY = {
  id: '3f1c0000-0000-4000-8000-000000000001',
  fullName: 'Amelia Chen',
  title: 'Dr.',
  specialty: 'Cardiology',
  departmentName: 'Cardiology',
  photoUrl: 'https://example.invalid/a.png',
  yearsOfExperience: 12,
  languages: ['en', 'ar'],
  ratingAvg: 4.7,
};

function page(items: unknown[], overrides: Record<string, number> = {}) {
  return {
    data: {
      items,
      page: 1,
      pageSize: 20,
      totalItems: items.length,
      totalPages: 1,
      ...overrides,
    },
  };
}

describe('search', () => {
  it('calls the patient projection, never the admin roster', async () => {
    const { calls } = stubFetch([json(200, page([SUMMARY]))]);

    await httpDoctorService.search({});

    expect(calls[0]?.url).toContain('/patient/doctors');
    // `GET /doctors` is `can:doctors.manage` and carries the licence
    // number. Reaching it from here would be the disclosure R-3 names.
    expect(calls[0]?.url).not.toMatch(/\/v1\/doctors(\?|$)/);
  });

  it('sends only the filters the patient chose', async () => {
    const { calls } = stubFetch([json(200, page([]))]);

    await httpDoctorService.search({ q: 'chen', specialtyId: 'spec-1', page: 2 });

    const url = new URL(calls[0]?.url ?? '');
    expect(url.searchParams.get('q')).toBe('chen');
    expect(url.searchParams.get('specialtyId')).toBe('spec-1');
    expect(url.searchParams.get('page')).toBe('2');
    // Absent filters must not become empty ones — `?departmentId=` is a
    // filter, not the absence of a filter.
    expect(url.searchParams.has('departmentId')).toBe(false);
    // Out-of-range values are rejected rather than clamped (contract
    // §3.1), and this client has no UI for either, so it sends neither.
    expect(url.searchParams.has('pageSize')).toBe(false);
    expect(url.searchParams.has('sort')).toBe(false);
  });

  it('never offers to turn the verified-and-active default off', async () => {
    const { calls } = stubFetch([json(200, page([]))]);

    await httpDoctorService.search({});

    const url = new URL(calls[0]?.url ?? '');
    expect(url.searchParams.has('verified')).toBe(false);
    expect(url.searchParams.has('verificationStatus')).toBe(false);
  });

  it('derives hasMore from the server pagination, not from the page length', async () => {
    stubFetch([json(200, page([SUMMARY], { page: 1, totalPages: 3, totalItems: 43 }))]);

    const result = await httpDoctorService.search({});

    expect(result.hasMore).toBe(true);
    expect(result.totalItems).toBe(43);
  });

  it('reports no more pages on the last one, however full it is', async () => {
    stubFetch([json(200, page([SUMMARY], { page: 3, totalPages: 3, totalItems: 43 }))]);

    await expect(httpDoctorService.search({ page: 3 })).resolves.toMatchObject({ hasMore: false });
  });

  it('treats a page past the end as an empty page, not an error', async () => {
    stubFetch([json(200, page([], { page: 9, totalPages: 3, totalItems: 43 }))]);

    const result = await httpDoctorService.search({ page: 9 });

    expect(result.items).toEqual([]);
    expect(result.hasMore).toBe(false);
  });

  it('fails at the seam when a field the client reads disappears', async () => {
    const withoutName: Record<string, unknown> = { ...SUMMARY };
    delete withoutName['fullName'];
    stubFetch([json(200, page([withoutName]))]);

    await expect(httpDoctorService.search({})).rejects.toBeInstanceOf(ResponseContractError);
  });
});

describe('the forbidden fields', () => {
  /**
   * The real control is the server's contract test against the
   * serialized body. This is the client's half: even a response that
   * regressed and carried a licence number has it stripped at the seam,
   * so it can reach neither a screen nor the query cache.
   */
  it('strips them from a list response that should never have carried them', async () => {
    stubFetch([
      json(
        200,
        page([
          {
            ...SUMMARY,
            licenseNumber: 'JO-12345',
            contactPhone: '+962 79 000 0000',
            employeeId: 'EMP-9',
            emergencyContactPhone: '+962 79 111 1111',
          },
        ]),
      ),
    ]);

    const result = await httpDoctorService.search({});
    const keys = Object.keys(result.items[0] ?? {});

    for (const forbidden of FORBIDDEN_DOCTOR_FIELDS) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('strips them from a detail response too', async () => {
    stubFetch([
      json(200, {
        data: {
          ...SUMMARY,
          biography: 'Interventional cardiologist.',
          education: ['MBBS'],
          certifications: [],
          skills: [],
          officeLocation: 'Level 3',
          officeHours: 'Sun-Thu',
          specialties: [{ id: 'spec-1', name: 'Cardiology' }],
          licenseNumber: 'JO-12345',
          linkedinUrl: 'https://example.invalid/in/a',
        },
      }),
    ]);

    const doctor = await httpDoctorService.getById(SUMMARY.id);
    const keys = Object.keys(doctor);

    for (const forbidden of FORBIDDEN_DOCTOR_FIELDS) {
      expect(keys).not.toContain(forbidden);
    }
    expect(JSON.stringify(doctor)).not.toContain('JO-12345');
  });

  it('maps onto the A-05 allow-list and nothing else', async () => {
    stubFetch([json(200, page([SUMMARY]))]);

    const result = await httpDoctorService.search({});

    expect(Object.keys(result.items[0] ?? {}).sort()).toEqual(
      [
        'biography',
        'departmentName',
        'education',
        'fullName',
        'hospital',
        'id',
        'languages',
        'officeLocation',
        'photoUrl',
        'ratingAvg',
        'specialty',
        'title',
        'yearsOfExperience',
      ].sort(),
    );
  });
});

describe('getById', () => {
  it('carries the detail-only fields the list projection does not have', async () => {
    stubFetch([
      json(200, {
        data: {
          ...SUMMARY,
          biography: 'Interventional cardiologist.',
          education: ['MBBS', 'FRCP'],
          certifications: ['Board certified'],
          skills: ['Echocardiography'],
          officeLocation: 'Level 3, Room 12',
          officeHours: 'Sun-Thu 09:00-15:00',
          specialties: [{ id: 'spec-1', name: 'Cardiology' }],
        },
      }),
    ]);

    const doctor = await httpDoctorService.getById(SUMMARY.id);

    expect(doctor.biography).toBe('Interventional cardiologist.');
    expect(doctor.education).toEqual(['MBBS', 'FRCP']);
    expect(doctor.officeLocation).toBe('Level 3, Room 12');
  });

  it('leaves a search result honest about what the list projection omits', async () => {
    stubFetch([json(200, page([SUMMARY]))]);

    const [doctor] = (await httpDoctorService.search({})).items;

    expect(doctor?.biography).toBeNull();
    expect(doctor?.education).toEqual([]);
    // No patient-facing projection carries `hospital`. Deriving one from
    // `departmentName` would print a hospital name no source states.
    expect(doctor?.hospital).toBeNull();
  });

  it('surfaces an unknown or unverified doctor as not_found, not as a crash', async () => {
    stubFetch([json(404, { message: 'Not found', code: 'not_found' })]);

    const error: unknown = await httpDoctorService.getById('missing').catch((e: unknown) => e);
    expect(isApiError(error)).toBe(true);
    expect(isApiError(error) && error.kind).toBe('not_found');
  });

  it('escapes the id rather than pasting it into the path', async () => {
    const { calls } = stubFetch([
      json(200, {
        data: {
          ...SUMMARY,
          biography: null,
          education: [],
          certifications: [],
          skills: [],
          officeLocation: null,
          officeHours: null,
          specialties: [],
        },
      }),
    ]);

    await httpDoctorService.getById('a b/../admin');

    expect(calls[0]?.url).toContain('a%20b%2F..%2Fadmin');
  });
});

describe('listSpecialties', () => {
  it('reads the flat array the contract specifies', async () => {
    stubFetch([
      json(200, {
        data: [
          { id: 'spec-1', name: 'Cardiology', parentId: null },
          { id: 'spec-2', name: 'Paediatrics', parentId: null },
        ],
      }),
    ]);

    await expect(httpDoctorService.listSpecialties()).resolves.toEqual([
      { id: 'spec-1', name: 'Cardiology' },
      { id: 'spec-2', name: 'Paediatrics' },
    ]);
  });
});

describe('listDepartments', () => {
  it('refuses by name — GET /patient/departments is not built (M23)', async () => {
    const error: unknown = await httpDoctorService.listDepartments().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(EndpointNotImplementedError);
    expect((error as EndpointNotImplementedError).dependency).toBe('BE-11 / M23');
  });

  it('does not reach the network at all', async () => {
    const { calls } = stubFetch([json(200, { data: [] })]);

    await httpDoctorService.listDepartments().catch(() => undefined);

    expect(calls).toHaveLength(0);
  });
});
