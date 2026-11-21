import { z } from 'zod';

import { addLogSink, clearLogSinks, type LogRecord } from '@/utils/logger';

import { paginatedSchema, parseResponse, ResponseContractError } from './envelope';

/**
 * `parseResponse` is the one function every typed response goes through,
 * so it is also the one place a malformed collection is amplified.
 *
 * zod reports one issue per failing element and caps nothing
 * (GHSA-mrhx-c7xc-m3w5, unfixed in 3.x), which this module used to turn
 * into a path string per element: a second copy of the payload, retained
 * on the thrown error and handed to the logger. These tests pin the
 * bound. They fail on the unbounded version, which reported every index.
 */

const rowSchema = z.object({ id: z.string() });
const pageSchema = paginatedSchema(rowSchema);

function page(rows: number): unknown {
  return {
    // Every row is the wrong shape, so each one produces its own issue.
    items: Array.from({ length: rows }, () => ({ id: 1 })),
    page: 0,
    pageSize: rows,
    totalItems: rows,
    totalPages: 1,
  };
}

function captureLogs(): LogRecord[] {
  const records: LogRecord[] = [];
  addLogSink((record) => records.push(record));
  return records;
}

describe('parseResponse', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    clearLogSinks();
    jest.restoreAllMocks();
  });

  it('returns the parsed body when the response matches its contract', () => {
    const body = { items: [{ id: 'a' }], page: 0, pageSize: 1, totalItems: 1, totalPages: 1 };
    expect(parseResponse('/me/appointments', pageSchema, body)).toEqual(body);
  });

  it('reports every path when there are few, and counts them', () => {
    try {
      parseResponse('/me/appointments', pageSchema, page(3));
      throw new Error('expected a contract error');
    } catch (error) {
      expect(error).toBeInstanceOf(ResponseContractError);
      const contract = error as ResponseContractError;
      expect(contract.issues).toHaveLength(3);
      expect(contract.issueCount).toBe(3);
      expect(contract.issues[0]).toBe('items.0.id: invalid_type');
    }
  });

  it('bounds the retained paths for a large collection but keeps the true count', () => {
    const rows = 5_000;
    try {
      parseResponse('/me/appointments', pageSchema, page(rows));
      throw new Error('expected a contract error');
    } catch (error) {
      const contract = error as ResponseContractError;
      // The bound, not one path per row — this is the assertion that
      // fails on the unbounded version.
      expect(contract.issues).toHaveLength(20);
      expect(contract.issueCount).toBe(rows);
    }
  });

  it('logs the bounded list and the true count, never one line per row', () => {
    const records = captureLogs();
    expect(() => parseResponse('/me/appointments', pageSchema, page(5_000))).toThrow(
      ResponseContractError,
    );

    expect(records).toHaveLength(1);
    const context = records[0]?.context as {
      issues: string[];
      issueCount: number;
      endpoint: string;
    };
    expect(context.endpoint).toBe('/me/appointments');
    expect(context.issues).toHaveLength(20);
    expect(context.issueCount).toBe(5_000);
  });

  it('carries field paths only, never a value from the payload', () => {
    const body = {
      items: [{ id: 'not-a-number' }],
      page: 0,
      pageSize: 1,
      totalItems: 1,
      totalPages: 1,
    };
    const schema = paginatedSchema(z.object({ id: z.number() }));
    try {
      parseResponse('/me/appointments', schema, body);
    } catch (error) {
      const contract = error as ResponseContractError;
      expect(contract.issues.join(' ')).not.toContain('not-a-number');
    }
  });
});
