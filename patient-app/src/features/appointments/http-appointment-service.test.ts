import { ResponseContractError } from '@/schemas/envelope';
import { isApiError } from '@/types/api';

import { httpAppointmentService } from './http-appointment-service';

/**
 * The live appointment adapter — checklist I-01, I-02, I-06.
 *
 * Everything is live: reads, slots, visit types, booking, cancellation and
 * the reschedule REQUEST workflow. The tests that matter most are about
 * what the adapter does NOT do: it does not manufacture `availableActions`
 * (it passes the server's through), and a retried booking re-sends the
 * Idempotency-Key it was given.
 */

interface FetchCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: unknown;
}

function stubFetch(responses: readonly Response[]): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  let index = 0;
  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    });
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return Promise.resolve((response as Response).clone());
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
  hospital: { id: 'hos-1', name: 'Medora Central' },
  availableActions: ['cancel', 'reschedule'],
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
    pendingRescheduleRequest: null,
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

describe('what the adapter passes through, untouched', () => {
  it('maps the hospital and the server’s availableActions', async () => {
    stubFetch([json(200, DETAIL)]);

    const detail = await httpAppointmentService.getById('APT-3007');

    expect(detail.hospital).toEqual({ id: 'hos-1', name: 'Medora Central' });
    expect(detail.availableActions).toEqual(['cancel', 'reschedule']);
    expect(detail.pendingRescheduleRequest).toBeNull();
  });

  it('passes an empty availableActions through as empty — the server said so', async () => {
    stubFetch([json(200, { data: { ...DETAIL.data, availableActions: [] } })]);

    expect((await httpAppointmentService.getById('APT-3007')).availableActions).toEqual([]);
  });

  it('does not derive an action from the status', async () => {
    stubFetch([
      json(200, { data: { ...DETAIL.data, status: 'completed', availableActions: ['cancel'] } }),
    ]);

    // Whatever the status, what the server offered is what comes out.
    expect((await httpAppointmentService.getById('APT-3007')).availableActions).toEqual(['cancel']);
  });

  it('maps a missing hospital to null rather than inventing one', async () => {
    const withoutHospital: Record<string, unknown> = { ...DETAIL.data };
    delete withoutHospital.hospital;
    stubFetch([json(200, { data: withoutHospital })]);

    expect((await httpAppointmentService.getById('APT-3007')).hospital).toBeNull();
  });

  it('fails loudly when availableActions is absent — an absence is not "nothing allowed"', async () => {
    const without: Record<string, unknown> = { ...DETAIL.data };
    delete without.availableActions;
    stubFetch([json(200, { data: without })]);

    await expect(httpAppointmentService.getById('APT-3007')).rejects.toBeInstanceOf(
      ResponseContractError,
    );
  });

  it('maps the pending reschedule request on the detail', async () => {
    stubFetch([json(200, { data: { ...DETAIL.data, pendingRescheduleRequest: REQUEST } })]);

    const detail = await httpAppointmentService.getById('APT-3007');

    expect(detail.pendingRescheduleRequest?.status).toBe('pending');
    expect(detail.pendingRescheduleRequest?.requestedSlot.id).toBe('slot-2');
  });
});

const REQUEST = {
  id: 'rr-1',
  appointmentId: 'APT-3007',
  status: 'pending',
  requestedSlot: { id: 'slot-2', startsAt: '2026-10-03T09:00:00.000Z', durationMin: 30 },
  note: 'Travelling',
  decisionReason: null,
  createdAt: '2026-09-20T09:00:00.000Z',
  decidedAt: null,
};

describe('slots and visit types', () => {
  it('reads published slots for one doctor in a window', async () => {
    const { calls } = stubFetch([
      json(200, {
        data: [
          {
            id: 'slot-1',
            startsAt: '2026-10-02T09:00:00.000Z',
            durationMin: 30,
            hospital: { id: 'hos-1', name: 'Medora Central' },
          },
        ],
      }),
    ]);

    const slots = await httpAppointmentService.listSlots(
      'doc 1',
      '2026-10-02T00:00:00.000Z',
      '2026-10-03T00:00:00.000Z',
    );

    const url = new URL(calls[0]?.url ?? '');
    expect(url.pathname).toMatch(/\/patient\/doctors\/doc%201\/slots$/);
    expect(url.searchParams.get('from')).toBe('2026-10-02T00:00:00.000Z');
    expect(url.searchParams.get('to')).toBe('2026-10-03T00:00:00.000Z');
    expect(slots[0]?.hospital.name).toBe('Medora Central');
  });

  it('reads the visit types', async () => {
    const { calls } = stubFetch([
      json(200, { data: [{ id: 'vt-1', name: 'New patient', durationMin: 30 }] }),
    ]);

    const types = await httpAppointmentService.listVisitTypes();

    expect(new URL(calls[0]?.url ?? '').pathname).toMatch(/\/patient\/visit-types$/);
    expect(types).toEqual([{ id: 'vt-1', name: 'New patient', durationMin: 30 }]);
  });
});

describe('booking', () => {
  const REQUEST_BODY = {
    doctorId: 'doc-1',
    slotId: 'slot-1',
    startsAt: '2026-10-02T09:00:00.000Z',
    reason: 'Chest tightness',
  };

  it('POSTs the slot and reason with the Idempotency-Key it was given', async () => {
    const { calls } = stubFetch([json(201, DETAIL)]);

    const created = await httpAppointmentService.book(
      { ...REQUEST_BODY, visitTypeId: 'vt-1', notes: 'Bring the diary' },
      'key-1',
    );

    expect(calls[0]?.method).toBe('POST');
    expect(new URL(calls[0]?.url ?? '').pathname).toMatch(/\/me\/appointments$/);
    expect(calls[0]?.headers.get('Idempotency-Key')).toBe('key-1');
    // `doctorId` and `startsAt` are the fixture's — the server derives both from the slot.
    expect(calls[0]?.body).toEqual({
      slotId: 'slot-1',
      reason: 'Chest tightness',
      visitTypeId: 'vt-1',
      notes: 'Bring the diary',
    });
    expect(created.id).toBe('APT-3007');
  });

  it('omits visitTypeId and notes when the patient chose none', async () => {
    const { calls } = stubFetch([json(201, DETAIL)]);

    await httpAppointmentService.book(REQUEST_BODY, 'key-2');

    expect(calls[0]?.body).toEqual({ slotId: 'slot-1', reason: 'Chest tightness' });
  });

  it('re-sends the SAME key when a retry is given the same key', async () => {
    const { calls } = stubFetch([json(201, DETAIL)]);

    await httpAppointmentService.book(REQUEST_BODY, 'key-3');
    await httpAppointmentService.book(REQUEST_BODY, 'key-3');

    expect(calls.map((call) => call.headers.get('Idempotency-Key'))).toEqual(['key-3', 'key-3']);
  });

  it('keeps the envelope code on a taken slot so the screen can recover', async () => {
    stubFetch([json(409, { code: 'slot_taken', message: 'taken' })]);

    const error: unknown = await httpAppointmentService
      .book(REQUEST_BODY, 'key-4')
      .catch((e: unknown) => e);

    expect(isApiError(error) && error.kind).toBe('conflict');
    expect(isApiError(error) && error.code).toBe('slot_taken');
  });

  it('keeps the detail on 422 insurance_not_covered', async () => {
    stubFetch([
      json(422, {
        code: 'insurance_not_covered',
        message: 'not covered',
        detail: 'Plan X is not accepted here.',
      }),
    ]);

    const error: unknown = await httpAppointmentService
      .book(REQUEST_BODY, 'key-5')
      .catch((e: unknown) => e);

    expect(isApiError(error) && error.kind).toBe('validation');
    expect(isApiError(error) && 'detail' in error && error.detail).toBe(
      'Plan X is not accepted here.',
    );
    expect(isApiError(error) && error.code).toBe('insurance_not_covered');
  });
});

describe('cancelling', () => {
  it('POSTs the reason code and note to the appointment', async () => {
    const { calls } = stubFetch([
      json(200, { data: { ...DETAIL.data, status: 'cancelled', availableActions: [] } }),
    ]);

    const cancelled = await httpAppointmentService.cancel('APT-3007', {
      reasonCode: 'transport',
      note: 'No lift',
    });

    expect(calls[0]?.method).toBe('POST');
    expect(new URL(calls[0]?.url ?? '').pathname).toMatch(/\/me\/appointments\/APT-3007\/cancel$/);
    expect(calls[0]?.body).toEqual({ reasonCode: 'transport', note: 'No lift' });
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.availableActions).toEqual([]);
  });

  it('omits the note when there is none', async () => {
    const { calls } = stubFetch([json(200, DETAIL)]);

    await httpAppointmentService.cancel('APT-3007', { reasonCode: 'cost' });

    expect(calls[0]?.body).toEqual({ reasonCode: 'cost' });
  });
});

describe('reschedule requests', () => {
  it('POSTs the slot with an Idempotency-Key, and returns the request', async () => {
    const { calls } = stubFetch([json(201, { data: REQUEST })]);

    const request = await httpAppointmentService.requestReschedule(
      'APT-3007',
      { slotId: 'slot-2', note: 'Travelling' },
      'key-rr',
    );

    expect(calls[0]?.method).toBe('POST');
    expect(new URL(calls[0]?.url ?? '').pathname).toMatch(
      /\/me\/appointments\/APT-3007\/reschedule-requests$/,
    );
    expect(calls[0]?.headers.get('Idempotency-Key')).toBe('key-rr');
    expect(calls[0]?.body).toEqual({ slotId: 'slot-2', note: 'Travelling' });
    expect(request.status).toBe('pending');
  });

  it('keeps the code on 409 reschedule_request_pending', async () => {
    stubFetch([json(409, { code: 'reschedule_request_pending', message: 'pending' })]);

    const error: unknown = await httpAppointmentService
      .requestReschedule('APT-3007', { slotId: 'slot-2' }, 'k')
      .catch((e: unknown) => e);

    expect(isApiError(error) && error.code).toBe('reschedule_request_pending');
  });

  it('lists the history, newest first as the server sent it', async () => {
    const { calls } = stubFetch([
      json(200, {
        data: [REQUEST, { ...REQUEST, id: 'rr-0', status: 'rejected', decisionReason: 'Full' }],
      }),
    ]);

    const list = await httpAppointmentService.listRescheduleRequests('APT-3007');

    expect(calls[0]?.method).toBe('GET');
    expect(new URL(calls[0]?.url ?? '').pathname).toMatch(
      /\/me\/appointments\/APT-3007\/reschedule-requests$/,
    );
    expect(list.map((item) => item.id)).toEqual(['rr-1', 'rr-0']);
    expect(list[1]?.decisionReason).toBe('Full');
  });

  it('withdraws by request id', async () => {
    const { calls } = stubFetch([json(200, { data: { ...REQUEST, status: 'withdrawn' } })]);

    const withdrawn = await httpAppointmentService.withdrawRescheduleRequest('rr-1');

    expect(calls[0]?.method).toBe('POST');
    expect(new URL(calls[0]?.url ?? '').pathname).toMatch(
      /\/me\/reschedule-requests\/rr-1\/withdraw$/,
    );
    expect(withdrawn.status).toBe('withdrawn');
  });

  it('rejects a status outside the five the server defines', async () => {
    stubFetch([json(200, { data: { ...REQUEST, status: 'moved' } })]);

    await expect(httpAppointmentService.withdrawRescheduleRequest('rr-1')).rejects.toBeInstanceOf(
      ResponseContractError,
    );
  });
});
