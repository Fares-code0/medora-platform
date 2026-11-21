import { ResponseContractError } from '@/schemas/envelope';
import { isApiError } from '@/types/api';

import { httpNotificationService } from './http-notification-service';

/**
 * The live notification adapter — checklist O-01, O-02.
 *
 * Two of these tests are about restraint rather than behaviour: the
 * adapter must not build a deep link to a screen the patient may not be
 * permitted to see, and it must not re-sort a feed the server ordered.
 */

interface FetchCall {
  readonly url: string;
  readonly method: string;
  readonly body?: unknown;
}

function stubFetch(responses: readonly Response[]): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  let index = 0;
  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      ...(typeof init?.body === 'string' ? { body: JSON.parse(init.body) as unknown } : {}),
    });
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return Promise.resolve(response as Response);
  });
  return { calls };
}

function json(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: status === 204 ? {} : { 'Content-Type': 'application/json' },
  });
}

const RELATED = {
  patientId: null,
  recordId: null,
  labOrderId: null,
  prescriptionId: null,
  appointmentId: null,
};

const NOTIFICATION = {
  id: '9f2e0000-0000-4000-8000-000000000001',
  title: 'Appointment confirmed',
  body: 'Your appointment has been confirmed.',
  category: 'appointments',
  priority: 'normal',
  kind: 'update',
  sender: 'Medora Clinic',
  readAt: null,
  archived: false,
  favorite: false,
  pinned: false,
  createdAt: '2026-09-02T08:00:00.000Z',
  related: { ...RELATED, appointmentId: 'APT-3007' },
};

function feed(items: unknown[], overrides: Record<string, unknown> = {}) {
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

describe('the feed', () => {
  it('sends the page it was asked for', async () => {
    const { calls } = stubFetch([json(200, feed([NOTIFICATION], { page: 4 }))]);

    await httpNotificationService.list(4);

    expect(new URL(calls[0]?.url ?? '').searchParams.get('page')).toBe('4');
  });

  it("takes hasMore from the server's page count, not from a full page", async () => {
    // Twenty rows on page three of three is a FULL last page. Deriving
    // `hasMore` from `items.length === pageSize` would offer a fourth
    // page that answers empty.
    const full = Array.from({ length: 20 }, (_, index) => ({
      ...NOTIFICATION,
      id: `NT-${index}`,
    }));
    stubFetch([json(200, feed(full, { page: 3, totalItems: 60, totalPages: 3 }))]);

    await expect(httpNotificationService.list(3)).resolves.toMatchObject({
      hasMore: false,
      totalItems: 60,
    });
  });

  it('reads /notifications, not /me/notifications', async () => {
    const { calls } = stubFetch([json(200, feed([NOTIFICATION]))]);

    await httpNotificationService.list();

    // API §10 defines this surface for any authenticated user: the feed
    // is scoped by `recipient_id` and is self-scoped by construction. A
    // patient-specific route over the same table would be a second place
    // to get the ownership predicate right.
    expect(new URL(calls[0]?.url ?? '').pathname).toMatch(/\/notifications$/);
    expect(calls[0]?.url).not.toContain('me/notifications');
  });

  it('preserves the server ordering rather than sorting by date', async () => {
    const older = {
      ...NOTIFICATION,
      id: 'pinned',
      pinned: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const newer = { ...NOTIFICATION, id: 'recent', createdAt: '2026-09-05T00:00:00.000Z' };
    stubFetch([json(200, feed([older, newer]))]);

    const { items } = await httpNotificationService.list();

    // Pinned first, then newest (UX 2.9) — a client that re-sorted by
    // `createdAt` would quietly unpin a critical alert.
    expect(items.map((item) => item.id)).toEqual(['pinned', 'recent']);
  });

  it('rejects the database spelling of a category', async () => {
    stubFetch([json(200, feed([{ ...NOTIFICATION, category: 'medical_records' }]))]);

    // `medical-records` is the wire value; `medical_records` is 422 on
    // the way in and would be a projection regression on the way out.
    await expect(httpNotificationService.list()).rejects.toBeInstanceOf(ResponseContractError);
  });

  it('accepts the hyphenated one', async () => {
    stubFetch([json(200, feed([{ ...NOTIFICATION, category: 'medical-records' }]))]);

    const [item] = (await httpNotificationService.list()).items;

    expect(item?.category).toBe('medical-records');
  });
});

describe('the deep link', () => {
  it('links an appointment notification to the appointment', async () => {
    stubFetch([json(200, feed([NOTIFICATION]))]);

    const [item] = (await httpNotificationService.list()).items;

    expect(item?.deepLink).toBe('medora://appointments/APT-3007');
  });

  it.each([
    ['recordId', 'REC-1'],
    ['labOrderId', 'LAB-1'],
    ['prescriptionId', 'RX-1'],
  ])('does NOT link a %s — those routes are blocked by ADR-031', async (field, id) => {
    stubFetch([json(200, feed([{ ...NOTIFICATION, related: { ...RELATED, [field]: id } }]))]);

    const [item] = (await httpNotificationService.list()).items;

    // "The patient was notified" must never be read as "the patient may
    // see it". A link to a screen that can only refuse would imply a
    // disclosure decision nobody has made.
    expect(item?.deepLink).toBeNull();
  });

  it('carries an id and never content', async () => {
    stubFetch([json(200, feed([NOTIFICATION]))]);

    const [item] = (await httpNotificationService.list()).items;

    // The link reaches the OS notification history and a lock-screen
    // preview. An id is not PHI; a name or a reason would be.
    expect(item?.deepLink).not.toContain('Chen');
    expect(item?.deepLink).toMatch(/^medora:\/\/appointments\/[\w-]+$/);
  });
});

describe('read state', () => {
  it('POSTs to the notification, never to a user id', async () => {
    const { calls } = stubFetch([json(204, null)]);

    await httpNotificationService.markRead('9f2e-1');

    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toContain('/notifications/9f2e-1/read');
    expect(calls[0]?.url).not.toContain('userId');
  });

  it('escapes the id rather than pasting it into the path', async () => {
    const { calls } = stubFetch([json(204, null)]);

    await httpNotificationService.markRead('a b/../admin');

    expect(calls[0]?.url).toContain('a%20b%2F..%2Fadmin');
  });

  it('treats marking an already-read notification as success', async () => {
    // Idempotent by contract, which is what makes the optimistic update
    // safe to retry: a retry cannot roll back a correct state.
    stubFetch([json(204, null)]);

    await expect(httpNotificationService.markRead('9f2e-1')).resolves.toBeUndefined();
  });

  it('surfaces someone else’s notification as 404', async () => {
    stubFetch([json(404, { message: 'Not found', code: 'not_found' })]);

    const error: unknown = await httpNotificationService.markRead('other').catch((e: unknown) => e);

    expect(isApiError(error)).toBe(true);
    expect(isApiError(error) && error.kind).toBe('not_found');
  });

  it('marks all read through the scoped route', async () => {
    const { calls } = stubFetch([json(200, { data: { updated: 4 } })]);

    await httpNotificationService.markAllRead();

    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toContain('/notifications/read-all');
  });
});

describe('the badge count', () => {
  it('reads the badge endpoint rather than counting the feed', async () => {
    const { calls } = stubFetch([json(200, { data: { notifications: 3, messages: 0 } })]);

    await expect(httpNotificationService.unreadCount()).resolves.toBe(3);
    // Counting one page of twenty would under-report as soon as a
    // patient had more than a page of notifications.
    expect(calls[0]?.url).toContain('/notifications/badge-counts');
    expect(calls).toHaveLength(1);
  });

  it('fails at the seam if the count is not a count', async () => {
    stubFetch([json(200, { data: { notifications: '3', messages: 0 } })]);

    await expect(httpNotificationService.unreadCount()).rejects.toBeInstanceOf(
      ResponseContractError,
    );
  });
});

describe('putting a notification back to unread (O-01)', () => {
  it('POSTs to the notification’s own unread route', async () => {
    // The half that had no test. `markUnread` existed on the adapter
    // before the port named it — unreachable code — and it matters more
    // now that a tap can navigate: opening an appointment from a
    // notification marks it read as a side effect, and this is the way
    // back for a patient who wanted to keep it flagged.
    const { calls } = stubFetch([json(204, null)]);

    await httpNotificationService.markUnread('9f2e-1');

    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toContain('/notifications/9f2e-1/unread');
  });

  it('escapes the id here too', async () => {
    const { calls } = stubFetch([json(204, null)]);

    await httpNotificationService.markUnread('a b/../admin');

    expect(calls[0]?.url).toContain('a%20b%2F..%2Fadmin');
  });
});

describe('the preferences (O-06)', () => {
  /**
   * `GET`/`PUT /me/notification-preferences` (M19.4). The row below is the
   * backend's `NotificationPreferencesView`: five channels, the quiet
   * window as `HH:MM`, and all eight categories with `security` locked on.
   */
  const ROW = {
    channels: { email: true, sms: false, push: true, desktop: true, inApp: true },
    quietHours: { enabled: true, from: '22:00', to: '07:00' },
    categories: {
      appointments: true,
      'medical-records': true,
      laboratory: false,
      pharmacy: true,
      patients: false,
      ai: true,
      system: true,
      security: true,
    },
  };

  it('reads the server’s row from the patient’s own route', async () => {
    const { calls } = stubFetch([json(200, { data: ROW })]);

    await expect(httpNotificationService.getPreferences()).resolves.toEqual(ROW);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url).toMatch(/\/me\/notification-preferences$/);
  });

  it('writes the whole row, keeping the fields the screen does not render', async () => {
    // `desktop`, `patients` and `ai` have no control on a phone. A PUT
    // replaces the row, so leaving them out would flip them for the same
    // account on another client.
    const next = { ...ROW, channels: { ...ROW.channels, email: false } };
    const { calls } = stubFetch([json(200, { data: next })]);

    await expect(httpNotificationService.updatePreferences(next)).resolves.toEqual(next);
    expect(calls[0]?.method).toBe('PUT');
    expect(calls[0]?.url).toMatch(/\/me\/notification-preferences$/);
    expect(calls[0]?.body).toEqual(next);
  });

  it('answers the row as the server stored it, not as it was sent', async () => {
    const sent = { ...ROW, quietHours: { enabled: false, from: '22:00', to: '07:00' } };
    stubFetch([json(200, { data: ROW })]);

    await expect(httpNotificationService.updatePreferences(sent)).resolves.toEqual(ROW);
  });

  it('refuses a row with a category this client does not know', async () => {
    // A new category is a contract change. Dropping it here would also
    // drop it from the next whole-row PUT.
    stubFetch([json(200, { data: { ...ROW, categories: { ...ROW.categories, billing: true } } })]);

    await expect(httpNotificationService.getPreferences()).rejects.toBeInstanceOf(
      ResponseContractError,
    );
  });

  it('refuses a quiet window that is not HH:MM', async () => {
    stubFetch([json(200, { data: { ...ROW, quietHours: { ...ROW.quietHours, from: '10pm' } } })]);

    await expect(httpNotificationService.getPreferences()).rejects.toBeInstanceOf(
      ResponseContractError,
    );
  });

  it('surfaces the server’s 422 as a validation error the screen can roll back on', async () => {
    stubFetch([
      json(422, {
        message: 'Validation failed',
        code: 'validation_failed',
        fieldErrors: { 'categories.security': ['Invalid literal value, expected true'] },
      }),
    ]);

    const error: unknown = await httpNotificationService
      .updatePreferences({ ...ROW, categories: { ...ROW.categories, security: true } })
      .catch((e: unknown) => e);

    expect(isApiError(error)).toBe(true);
    expect(error).toMatchObject({ kind: 'validation' });
  });
});

