import { EndpointNotImplementedError } from '@/api/seam';
import { ResponseContractError } from '@/schemas/envelope';
import { isApiError } from '@/types/api';

import { httpAppointmentService } from './http-appointment-service';

/**
 * The live appointment adapter — checklist I-01, I-02, I-06.
 *
 * Reads are live; every write refuses with ADR-033 named. The tests that
 * matter most are the ones about what this adapter does NOT do: it does
 * not send a path for a route that does not exist, and it does not
 * manufacture `availableActions`.
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
  id: 'APT-3007',
  startsAt: '2026-10-01T09:00:00.000Z',
  durationMin: 30,
  status: 'confirmed',
  priority: 'normal',
  reason: 'Follow-up on blood pressure',
  isNewPatient: false,
  isFollowUp: true,
  visitType: 'Follow-up',
  departmentName: 'Cardiology',
  doctor: {
    id: '3f1c0000-0000-4000-8000-000000000001',
    fullName: 'Dr. Amelia Chen',
    title: null,
    specialty: 'Cardiology',
    photoUrl: null,
  },
};

function listBody(items: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    data: {
      items,
      page: 1,
      pageSize: 20,
      totalItems: items.length,
      totalPages: 1,
      clinicTimezone: 'Asia/Amman',
      ...overrides,
    },
  };
}

const DETAIL = {
  data: {
    ...SUMMARY,
    notes: 'Bring the blood pressure diary.',
    cancelledReason: null,
    clinicTimezone: 'Asia/Amman',
    events: [
      {
        action: 'approve',
        fromStatus: 'pending',
        toStatus: 'confirmed',
        occurredAt: '2026-09-01T12:00:00.000Z',
        actor: 'clinic',
        reason: 'Approved',
      },
    ],
  },
};

describe('list', () => {
  it('asks the SERVER what "upcoming" means', async () => {
    const { calls } = stubFetch([json(200, listBody([SUMMARY]))]);

    await httpAppointmentService.list('upcoming');

    const url = new URL(calls[0]?.url ?? '');
    expect(url.pathname).toContain('/me/appointments');
    // `upcoming=true` resolves against the clinic's clock. A device with
    // a wrong clock cannot shift the boundary.
    expect(url.searchParams.get('upcoming')).toBe('true');
    expect(url.searchParams.get('sort')).toBe('startsAt:asc');
    expect(url.searchParams.has('from')).toBe(false);
  });

  it('uses the contract `to` parameter for past, because there is no server shorthand', async () => {
    const { calls } = stubFetch([json(200, listBody([]))]);

    await httpAppointmentService.list('past');

    const url = new URL(calls[0]?.url ?? '');
    // `upcoming=false` is accepted by the query schema and acted on by
    // nothing, so "before now" has to be expressed as `to`.
    expect(url.searchParams.has('upcoming')).toBe(false);
    expect(url.searchParams.get('sort')).toBe('startsAt:desc');
    expect(Date.parse(url.searchParams.get('to') ?? '')).not.toBeNaN();
  });

  it('sends the page it was asked for, on both segments', async () => {
    const { calls } = stubFetch([
      json(200, listBody([SUMMARY], { page: 3 })),
      json(200, listBody([SUMMARY], { page: 3 })),
    ]);

    await httpAppointmentService.list('upcoming', 3);
    await httpAppointmentService.list('past', 3);

    expect(new URL(calls[0]?.url ?? '').searchParams.get('page')).toBe('3');
    expect(new URL(calls[1]?.url ?? '').searchParams.get('page')).toBe('3');
  });

  it("takes hasMore from the server's page count, not from the length of the page", async () => {
    // A FULL page that is also the last one. Deriving `hasMore` from
    // `items.length === pageSize` would claim a page 2 that answers
    // empty; `page < totalPages` is the server's own arithmetic.
    stubFetch([json(200, listBody([SUMMARY], { page: 2, pageSize: 1, totalPages: 2 }))]);

    await expect(httpAppointmentService.list('past', 2)).resolves.toMatchObject({
      hasMore: false,
    });

    stubFetch([
      json(200, listBody([SUMMARY], { page: 1, pageSize: 1, totalItems: 9, totalPages: 9 })),
    ]);

    await expect(httpAppointmentService.list('past')).resolves.toMatchObject({
      hasMore: true,
      totalItems: 9,
    });
  });

  it('never sends a patientId — the subject is the token', async () => {
    const { calls } = stubFetch([json(200, listBody([SUMMARY]))]);

    await httpAppointmentService.list('upcoming');

    const url = new URL(calls[0]?.url ?? '');
    expect(url.searchParams.has('patientId')).toBe(false);
    expect(url.pathname).not.toContain('patients/');
  });

  it('reads an unlinked account as an empty list, not an error', async () => {
    // ADR-030 §4 leaves a freshly registered account linked to no
    // clinical record. The server answers with an empty page.
    stubFetch([json(200, listBody([], { totalItems: 0, totalPages: 0 }))]);

    await expect(httpAppointmentService.list('upcoming')).resolves.toEqual({
      items: [],
      totalItems: 0,
      hasMore: false,
    });
  });

  it('rejects a status the vocabulary does not contain', async () => {
    // `no_show` is the Prisma spelling; `no-show` is the wire value.
    stubFetch([json(200, listBody([{ ...SUMMARY, status: 'no_show' }]))]);

    await expect(httpAppointmentService.list('upcoming')).rejects.toBeInstanceOf(
      ResponseContractError,
    );
  });

  it('accepts every status in the vocabulary, including the awkward two', async () => {
    for (const status of ['no-show', 'awaiting-patient'] as const) {
      stubFetch([json(200, listBody([{ ...SUMMARY, status }]))]);
      const { items } = await httpAppointmentService.list('past');
      const [appointment] = items;
      expect(appointment?.status).toBe(status);
    }
  });
});

describe('what the adapter refuses to invent', () => {
  it('leaves availableActions undefined rather than empty', async () => {
    stubFetch([json(200, DETAIL)]);

    const detail = await httpAppointmentService.getById('APT-3007');

    // `[]` would assert "no action is available" — a claim about policy
    // that ADR-033 has not answered. `undefined` says the server has not
    // said, which is true.
    expect(detail.availableActions).toBeUndefined();
    expect(detail.proposedSlots).toBeUndefined();
  });

  it('does not derive an action from the status', async () => {
    stubFetch([json(200, { data: { ...DETAIL.data, status: 'confirmed' } })]);

    const detail = await httpAppointmentService.getById('APT-3007');

    expect(detail.availableActions).toBeUndefined();
  });
});

describe('getById', () => {
  it('maps the detail-only fields and the event history', async () => {
    stubFetch([json(200, DETAIL)]);

    const detail = await httpAppointmentService.getById('APT-3007');

    expect(detail.notes).toBe('Bring the blood pressure diary.');
    expect(detail.events).toHaveLength(1);
    expect(detail.events[0]?.at).toBe('2026-09-01T12:00:00.000Z');
    expect(detail.events[0]?.toStatus).toBe('confirmed');
    expect(detail.events[0]?.fromStatus).toBe('pending');
  });

  it('keeps the actor coarse — never a staff name', async () => {
    stubFetch([
      json(200, {
        data: {
          ...DETAIL.data,
          events: [
            {
              ...DETAIL.data.events[0],
              actor: 'Dr Layla Haddad',
            },
          ],
        },
      }),
    ]);

    // `actor` is `patient | clinic | system` by contract. A staff name in
    // that field is a projection regression, and this client refuses it
    // rather than rendering the clinic's staff directory into a timeline.
    await expect(httpAppointmentService.getById('APT-3007')).rejects.toBeInstanceOf(
      ResponseContractError,
    );
  });

  it('keeps an event that changed no status', async () => {
    stubFetch([
      json(200, {
        data: {
          ...DETAIL.data,
          events: [
            {
              action: 'note',
              fromStatus: null,
              toStatus: null,
              occurredAt: '2026-09-02T08:00:00.000Z',
              actor: 'system',
              reason: null,
            },
          ],
        },
      }),
    ]);

    const detail = await httpAppointmentService.getById('APT-3007');

    expect(detail.events).toHaveLength(1);
    expect(detail.events[0]?.toStatus).toBeNull();
  });

  it('gives every event a distinct render key', async () => {
    const at = '2026-09-01T12:00:00.000Z';
    stubFetch([
      json(200, {
        data: {
          ...DETAIL.data,
          events: [
            { ...DETAIL.data.events[0], occurredAt: at },
            { ...DETAIL.data.events[0], occurredAt: at },
          ],
        },
      }),
    ]);

    const detail = await httpAppointmentService.getById('APT-3007');
    const keys = detail.events.map((event) => event.id);

    // Two events at the same instant are possible; two identical React
    // keys are a rendering defect.
    expect(new Set(keys).size).toBe(2);
  });

  it('surfaces someone else’s appointment as 404, like an unknown one', async () => {
    stubFetch([json(404, { message: 'Appointment not found', code: 'not_found' })]);

    const error: unknown = await httpAppointmentService
      .getById('APT-9999')
      .catch((e: unknown) => e);

    expect(isApiError(error)).toBe(true);
    expect(isApiError(error) && error.kind).toBe('not_found');
    // Never 403 — a 403 confirms the appointment exists.
    expect(isApiError(error) && error.kind).not.toBe('forbidden');
  });
});

describe('the write routes', () => {
  it.each([
    ['listSlots', () => httpAppointmentService.listSlots('doc-1', 'a', 'b')],
    ['book', () => httpAppointmentService.book({} as never, 'key')],
    ['cancel', () => httpAppointmentService.cancel('APT-1', 'reason')],
    ['requestReschedule', () => httpAppointmentService.requestReschedule('APT-1', 'reason')],
    ['acceptProposal', () => httpAppointmentService.acceptProposal('APT-1', 'slot-1')],
  ])('%s refuses with ADR-033 named, and touches no network', async (_name, call) => {
    const { calls } = stubFetch([json(200, { data: {} })]);

    const error: unknown = await call().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(EndpointNotImplementedError);
    expect((error as EndpointNotImplementedError).dependency).toBe('ADR-033');
    expect(calls).toHaveLength(0);
  });
});
