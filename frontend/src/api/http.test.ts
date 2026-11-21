import { describe, expect, it, vi } from 'vitest';

import {
  fetchAllPages,
  isNotConnected,
  notConnected,
  readData,
  readDay,
  readEnum,
  readOptionalDay,
  readOptionalString,
  readPage,
  readString,
} from './http';

/**
 * The adapter building blocks (FE-10). The property that matters most is
 * the negative one: an unreadable body becomes an error the screen shows,
 * never an empty result it renders as "nothing here".
 */

/** The value `fn` throws — so assertions can match its fields. */
function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw');
}

function page(items: unknown[], pageNumber: number, totalPages: number) {
  return {
    data: { items, page: pageNumber, pageSize: 100, totalItems: items.length, totalPages },
  };
}

describe('readData', () => {
  it('returns the payload of a { data } envelope', () => {
    expect(readData({ data: { id: 'p1' } }, 'patient')).toEqual({ id: 'p1' });
  });

  it.each([null, [], 'text', { items: [] }])(
    'refuses a body that is not an envelope: %j',
    (body) => {
      expect(thrown(() => readData(body, 'patient'))).toMatchObject({
        kind: 'server',
        code: 'malformed_response',
        ref: 'patient',
      });
    },
  );
});

describe('readPage', () => {
  it('reads a Paginated payload', () => {
    expect(readPage(page([{ id: 1 }], 1, 1), 'patients')).toMatchObject({
      items: [{ id: 1 }],
      totalPages: 1,
    });
  });

  it('refuses a page whose items are not an array, rather than reading it as empty', () => {
    expect(
      thrown(() =>
        readPage(
          { data: { items: null, page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } },
          'x',
        ),
      ),
    ).toMatchObject({ code: 'malformed_response' });
  });
});

describe('fetchAllPages', () => {
  it('walks every page and concatenates the items in order', async () => {
    const fetchPage = vi.fn((n: number) =>
      Promise.resolve(n === 1 ? page(['a', 'b'], 1, 2) : page(['c'], 2, 2)),
    );

    await expect(fetchAllPages(fetchPage, 'patients')).resolves.toEqual(['a', 'b', 'c']);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage).toHaveBeenNthCalledWith(1, 1, 100);
  });

  it('stops after one request for an empty collection', async () => {
    const fetchPage = vi.fn(() => Promise.resolve(page([], 1, 0)));

    await expect(fetchAllPages(fetchPage, 'patients')).resolves.toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('fails instead of downloading without bound', async () => {
    const fetchPage = vi.fn((n: number) => Promise.resolve(page(['x'], n, 999)));

    await expect(fetchAllPages(fetchPage, 'patients', 3)).rejects.toMatchObject({
      code: 'malformed_response',
    });
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });
});

describe('field readers', () => {
  const record = { name: 'Khaled', email: null, status: 'active' };

  it('reads present fields and treats null optional strings as null', () => {
    expect(readString(record, 'name', 'patient')).toBe('Khaled');
    expect(readOptionalString(record, 'email', 'patient')).toBeNull();
  });

  it('names the field that was wrong', () => {
    expect(thrown(() => readString(record, 'missing', 'patient'))).toMatchObject({
      ref: 'patient.missing',
    });
  });

  it('refuses a value outside the frontend vocabulary', () => {
    expect(readEnum(record, 'status', ['active', 'discharged'] as const, 'patient')).toBe('active');
    expect(
      thrown(() => readEnum(record, 'status', ['discharged'] as const, 'patient')),
    ).toMatchObject({ ref: 'patient.status' });
  });
});

describe('readDay', () => {
  it('reads a day served as UTC midnight as local midnight, so it formats as that day', () => {
    const day = readDay({ visitDate: '2026-10-04T00:00:00.000Z' }, 'visitDate', 'record');
    expect(day).toBe('2026-10-04T00:00:00');
    expect(new Date(day).getDate()).toBe(4);
    expect(readDay({ visitDate: '2026-10-04' }, 'visitDate', 'record')).toBe('2026-10-04T00:00:00');
  });

  it('refuses an instant that is not a day, rather than dropping its time', () => {
    expect(() =>
      readDay({ visitDate: '2026-10-04T09:30:00.000Z' }, 'visitDate', 'record'),
    ).toThrow();
  });

  it('keeps an absent optional day null', () => {
    expect(readOptionalDay({ followUpDate: null }, 'followUpDate', 'record')).toBeNull();
  });
});

describe('notConnected', () => {
  it('is recognisable, so a screen can say "not connected" instead of "failed"', () => {
    const error = notConnected('messaging');
    expect(error).toMatchObject({ kind: 'server', code: 'not_connected', ref: 'messaging' });
    expect(isNotConnected(error)).toBe(true);
    expect(isNotConnected(new Error('boom'))).toBe(false);
  });
});
