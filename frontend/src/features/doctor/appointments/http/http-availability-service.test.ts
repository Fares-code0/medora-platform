import { afterEach, describe, expect, it, vi } from 'vitest';

import { envelope, json, stubApi } from '@/test/api-stub';
import { isApiError } from '@/types/api';

import { WEEKDAYS } from '../model/availability';

import { httpAvailabilityService } from './http-availability-service';

/**
 * The weekly grid over HTTP (DEC-005) — API §3.8. Bodies follow
 * `backend/src/modules/doctors/dto/availability.dto.ts`.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

const VIEW = {
  week: WEEKDAYS.map((weekday) =>
    weekday === 'Sun'
      ? { weekday, open: false, windows: [], breaks: [] }
      : {
          weekday,
          open: true,
          windows: [{ start: '09:00', end: '17:00' }],
          breaks: [{ start: '12:00', end: '13:00' }],
        },
  ),
  defaultDurationMin: 30,
  bufferMin: 5,
  clinicTimezone: 'Africa/Cairo',
};

describe('httpAvailabilityService.get', () => {
  it('reads GET /me/availability', async () => {
    stubApi({ 'GET /me/availability': () => envelope(VIEW) });

    const availability = await httpAvailabilityService.get();

    expect(availability.week).toHaveLength(7);
    expect(availability.week[0]).toEqual(VIEW.week[0]);
    expect(availability.defaultDurationMin).toBe(30);
    expect(availability.bufferMin).toBe(5);
    expect(availability.clinicTimezone).toBe('Africa/Cairo');
  });

  it('reads a server that sends no clinic time zone as unknown, not as UTC (pre-BR-DEC-005)', async () => {
    const older: Partial<typeof VIEW> = { ...VIEW };
    delete older.clinicTimezone;
    stubApi({ 'GET /me/availability': () => envelope(older) });

    expect((await httpAvailabilityService.get()).clinicTimezone).toBeNull();
  });

  it('refuses a week that is not Monday-first, every day once', async () => {
    stubApi({
      'GET /me/availability': () => envelope({ ...VIEW, week: [...VIEW.week].reverse() }),
    });
    await expect(httpAvailabilityService.get()).rejects.toThrow();
  });

  it('surfaces 404 for an account with no practitioner record', async () => {
    stubApi({
      'GET /me/availability': () =>
        json({ code: 'not_found', message: 'No doctor profile for this account' }, 404),
    });
    await expect(httpAvailabilityService.get()).rejects.toSatisfy(
      (error: unknown) => isApiError(error) && error.kind === 'not_found',
    );
  });
});

describe('httpAvailabilityService.replace', () => {
  it('PUTs all seven days, a closed day with no ranges, and reads back the stored grid', async () => {
    const { requests } = stubApi({ 'PUT /me/availability': () => envelope(VIEW) });

    // A closed Saturday still holding its old ranges in the editor's draft.
    const closedWithLeftovers = {
      ...VIEW,
      week: VIEW.week.map((day) => (day.weekday === 'Sat' ? { ...day, open: false } : day)),
    };
    const { saved } = await httpAvailabilityService.replace(closedWithLeftovers);

    const body = requests[0]?.body as typeof VIEW;
    expect(requests[0]?.method).toBe('PUT');
    expect(body.week).toHaveLength(7);
    expect(body.week[5]).toEqual({ weekday: 'Sat', open: false, windows: [], breaks: [] });
    expect(body.defaultDurationMin).toBe(30);
    expect(body.bufferMin).toBe(5);
    // Read-only: the zone is the server's, never sent back.
    expect(body).not.toHaveProperty('clinicTimezone');
    expect(saved.week[5]?.open).toBe(true);
  });

  it('reads the server’s stranded report (BR-DEC-005)', async () => {
    stubApi({
      'PUT /me/availability': () =>
        envelope({
          ...VIEW,
          stranded: [
            {
              id: 'APT-9001',
              scheduledAt: '2030-01-07T15:00:00.000Z',
              durationMin: 30,
              status: 'confirmed',
              patientId: 'PT-1001',
            },
          ],
        }),
    });

    const { stranded } = await httpAvailabilityService.replace(VIEW);

    expect(stranded).toEqual([
      {
        id: 'APT-9001',
        dateTime: '2030-01-07T15:00:00.000Z',
        durationMin: 30,
        status: 'confirmed',
        patientId: 'PT-1001',
      },
    ]);
  });

  it('tells "no report" (null) apart from "nothing stranded" ([])', async () => {
    stubApi({ 'PUT /me/availability': () => envelope({ ...VIEW, stranded: [] }) });
    expect((await httpAvailabilityService.replace(VIEW)).stranded).toEqual([]);

    vi.unstubAllGlobals();
    stubApi({ 'PUT /me/availability': () => envelope(VIEW) });
    expect((await httpAvailabilityService.replace(VIEW)).stranded).toBeNull();
  });

  it('passes the server’s 422 field errors through, keyed by day', async () => {
    stubApi({
      'PUT /me/availability': () =>
        json(
          {
            code: 'validation_failed',
            message: 'The week is not internally consistent',
            fieldErrors: { 'week[0].windows': ['Working windows on one day cannot overlap'] },
          },
          422,
        ),
    });

    await expect(httpAvailabilityService.replace(VIEW)).rejects.toSatisfy(
      (error: unknown) =>
        isApiError(error) &&
        error.kind === 'validation' &&
        error.fieldErrors['week[0].windows']?.[0] === 'Working windows on one day cannot overlap',
    );
  });
});
