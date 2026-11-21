import { afterEach, describe, expect, it, vi } from 'vitest';

import { envelope, json, pageOf, stubApi } from '@/test/api-stub';

import { httpNotificationService, toNotification } from './http-notification-service';

/** Notifications over HTTP (FE-10.8) — API §10. */

afterEach(() => {
  vi.unstubAllGlobals();
});

function notificationView(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ntf-1',
    title: 'Critical result: Hemoglobin',
    body: 'LAB-100000 was released with a critical value.',
    category: 'laboratory',
    priority: 'critical',
    kind: 'alert',
    sender: 'Laboratory',
    readAt: null,
    archived: false,
    favorite: false,
    pinned: false,
    createdAt: '2026-10-04T18:11:36.000Z',
    related: {
      patientId: 'PT-1004',
      recordId: null,
      labOrderId: 'LAB-100000',
      prescriptionId: null,
      appointmentId: null,
    },
    ...overrides,
  };
}

function preferencesView(overrides: Record<string, unknown> = {}) {
  return {
    channels: { email: true, sms: false, push: true, desktop: false, inApp: true },
    quietHours: { enabled: false, from: '22:00', to: '07:00' },
    categories: {
      appointments: true,
      'medical-records': true,
      laboratory: true,
      pharmacy: true,
      patients: true,
      ai: true,
      system: true,
      security: true,
    },
    ...overrides,
  };
}

describe('toNotification', () => {
  it('reads read state from readAt, and leaves the unserved patient name unknown', () => {
    expect(toNotification(notificationView())).toMatchObject({
      id: 'ntf-1',
      category: 'laboratory',
      read: false,
      related: { patientId: 'PT-1004', patientName: null, labId: 'LAB-100000' },
    });
    expect(toNotification(notificationView({ readAt: '2026-10-04T19:00:00.000Z' })).read).toBe(
      true,
    );
  });
});

describe('httpNotificationService', () => {
  it('reads the inbox and the archive', async () => {
    const { requests } = stubApi({
      'GET /notifications': (request) =>
        pageOf(
          request.query.get('status') === 'archived'
            ? [notificationView({ id: 'ntf-2', archived: true })]
            : [notificationView()],
        ),
    });

    const notifications = await httpNotificationService.fetchNotifications();

    expect(notifications.map((notification) => notification.id).sort()).toEqual(['ntf-1', 'ntf-2']);
    expect(requests.map((request) => request.query.get('status')).sort()).toEqual([
      'active',
      'archived',
    ]);
  });

  it('is an error, never an empty inbox, when the server fails', async () => {
    stubApi({ 'GET /notifications': () => json({ message: 'Internal' }, 500) });
    await expect(httpNotificationService.fetchNotifications()).rejects.toMatchObject({
      kind: 'server',
    });
  });

  it('marks read and unread one notification at a time', async () => {
    const { requests } = stubApi({
      'POST /notifications/ntf-1/read': () => envelope(notificationView()),
      'POST /notifications/ntf-2/read': () => envelope(notificationView()),
      'POST /notifications/ntf-3/unread': () => envelope(notificationView()),
    });

    await httpNotificationService.updateNotifications(['ntf-1', 'ntf-2'], { read: true });
    await httpNotificationService.updateNotifications(['ntf-3'], { read: false });

    expect(requests.map((request) => request.path).sort()).toEqual([
      '/notifications/ntf-1/read',
      '/notifications/ntf-2/read',
      '/notifications/ntf-3/unread',
    ]);
  });

  it('marks everything read in one request and answers the server’s count', async () => {
    const { requests } = stubApi({
      'POST /notifications/read-all': () => envelope({ updated: 4 }),
    });

    await expect(httpNotificationService.markAllRead()).resolves.toBe(4);
    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'POST /notifications/read-all',
    ]);
  });

  it('treats a read-all body without a count as malformed, not as zero', async () => {
    stubApi({ 'POST /notifications/read-all': () => envelope({}) });
    await expect(httpNotificationService.markAllRead()).rejects.toThrow();
  });

  it('refuses what has no route on any branch, sending nothing, rather than pretending it worked', async () => {
    const { requests } = stubApi({});

    await expect(httpNotificationService.deleteNotifications(['ntf-1'])).rejects.toMatchObject({
      code: 'not_connected',
    });
    await expect(httpNotificationService.fetchConversations()).rejects.toMatchObject({
      code: 'not_connected',
    });
    expect(requests).toHaveLength(0);
    expect(httpNotificationService.capabilities).toEqual({
      organize: true,
      remove: false,
      clearRead: true,
      messaging: false,
      preferences: true,
    });
  });

  it('sets archive, favourite and pin explicitly, with the value, never as a toggle', async () => {
    const { requests } = stubApi({
      'POST /notifications/ntf-1/archive': () => new Response(null, { status: 204 }),
      'POST /notifications/ntf-2/archive': () => new Response(null, { status: 204 }),
      'POST /notifications/ntf-1/favorite': () => new Response(null, { status: 204 }),
      'POST /notifications/ntf-1/pin': () => new Response(null, { status: 204 }),
    });

    await httpNotificationService.updateNotifications(['ntf-1', 'ntf-2'], { archived: true });
    await httpNotificationService.updateNotifications(['ntf-1'], { favorite: false });
    await httpNotificationService.updateNotifications(['ntf-1'], { pinned: true });

    expect(
      requests.map(
        (request) => `${request.method} ${request.path} ${JSON.stringify(request.body)}`,
      ),
    ).toEqual([
      'POST /notifications/ntf-1/archive {"value":true}',
      'POST /notifications/ntf-2/archive {"value":true}',
      'POST /notifications/ntf-1/favorite {"value":false}',
      'POST /notifications/ntf-1/pin {"value":true}',
    ]);
  });

  it('sends nothing for a patch that names no flag', async () => {
    const { requests } = stubApi({});
    await httpNotificationService.updateNotifications(['ntf-1'], {});
    expect(requests).toHaveLength(0);
  });

  it('surfaces a refused flag write — the 404 an API built from main answers — as a failure', async () => {
    stubApi({
      'POST /notifications/ntf-1/archive': () =>
        json({ message: 'Cannot POST', code: 'not_found' }, 404),
    });
    await expect(
      httpNotificationService.updateNotifications(['ntf-1'], { archived: true }),
    ).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('clears read notifications in one write and answers the server’s count', async () => {
    const { requests } = stubApi({
      'POST /notifications/clear-read': () => envelope({ archived: 3 }),
    });

    await expect(httpNotificationService.archiveAllRead()).resolves.toBe(3);
    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'POST /notifications/clear-read',
    ]);
  });

  it('treats a clear-read body without a count as malformed, not as zero', async () => {
    stubApi({ 'POST /notifications/clear-read': () => envelope({}) });
    await expect(httpNotificationService.archiveAllRead()).rejects.toThrow();
  });

  it('reads the preferences document', async () => {
    stubApi({ 'GET /me/notification-preferences': () => envelope(preferencesView()) });
    await expect(httpNotificationService.fetchPreferences('ignored')).resolves.toEqual(
      preferencesView(),
    );
  });

  it('replaces the whole preferences document and answers what the server stored', async () => {
    const stored = preferencesView({ channels: { ...preferencesView().channels, sms: true } });
    const { requests } = stubApi({ 'PUT /me/notification-preferences': () => envelope(stored) });

    const sent = preferencesView({ channels: { ...preferencesView().channels, sms: true } });
    await expect(httpNotificationService.savePreferences('ignored', sent)).resolves.toEqual(stored);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.body).toEqual(sent);
  });

  it('refuses a preferences document missing a channel or category the screen draws', async () => {
    const { channels } = preferencesView();
    const partial = { ...preferencesView(), channels: { ...channels, inApp: undefined } };
    stubApi({ 'GET /me/notification-preferences': () => envelope(partial) });
    await expect(httpNotificationService.fetchPreferences('ignored')).rejects.toThrow();

    const { categories } = preferencesView();
    stubApi({
      'GET /me/notification-preferences': () =>
        envelope({ ...preferencesView(), categories: { ...categories, ai: undefined } }),
    });
    await expect(httpNotificationService.fetchPreferences('ignored')).rejects.toThrow();
  });

  it('refuses quiet hours that are not HH:MM', async () => {
    stubApi({
      'GET /me/notification-preferences': () =>
        envelope(preferencesView({ quietHours: { enabled: true, from: '10pm', to: '07:00' } })),
    });
    await expect(httpNotificationService.fetchPreferences('ignored')).rejects.toThrow();
  });

  it('reads the badge counts from the server', async () => {
    stubApi({
      'GET /notifications/badge-counts': () => envelope({ notifications: 3, messages: 2 }),
    });
    await expect(httpNotificationService.fetchBadgeCounts()).resolves.toEqual({
      notifications: 3,
      messages: 2,
    });
  });
});
