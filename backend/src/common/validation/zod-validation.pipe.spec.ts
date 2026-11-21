import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AppException } from '../errors/app.exception';

import { DATE_RANGE_MESSAGE, datesOutOfRange, zodBody } from './zod-validation.pipe';

/**
 * The pipe's date bound. `test/date-range.e2e-spec.ts` drives it over HTTP
 * against the route where an out-of-range date used to become a 500.
 */
const schema = z.object({
  visitDate: z.coerce.date(),
  followUps: z.array(z.object({ on: z.coerce.date() })).default([]),
  note: z.string().optional(),
});

function fieldErrorsOf(run: () => unknown): Record<string, readonly string[]> | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof AppException) return error.fieldErrors;
    throw error;
  }
  return undefined;
}

describe('ZodValidationPipe — dates the API cannot hand back', () => {
  const pipe = zodBody(schema);

  it('refuses a year past 9999 or before 0001, naming the field', () => {
    for (const value of [
      '+275000-01-01T00:00:00.000Z',
      '-200000-01-01T00:00:00.000Z',
      '-004713-11-24T00:00:00.000Z',
    ]) {
      expect(fieldErrorsOf(() => pipe.transform({ visitDate: value }))).toEqual({
        visitDate: [DATE_RANGE_MESSAGE],
      });
    }
  });

  it('names a nested date by its path', () => {
    expect(
      fieldErrorsOf(() =>
        pipe.transform({
          visitDate: '2026-09-10T09:00:00.000Z',
          followUps: [{ on: '2026-10-01T00:00:00.000Z' }, { on: '+100000-01-01T00:00:00.000Z' }],
        }),
      ),
    ).toEqual({ 'followUps[1].on': [DATE_RANGE_MESSAGE] });
  });

  it('accepts both ends of the range', () => {
    for (const value of ['0001-01-01T00:00:00.000Z', '9999-12-31T23:59:59.999Z']) {
      expect(pipe.transform({ visitDate: value }).visitDate).toEqual(new Date(value));
    }
  });

  it('does not read strings, only what the schema turned into dates', () => {
    expect(datesOutOfRange({ note: '+275000-01-01T00:00:00.000Z' })).toEqual([]);
  });
});
