import { describe, expect, it } from 'vitest';

import { AppException } from '../errors/app.exception';

import { NUL_MESSAGE, RejectNulPipe, nulPaths } from './reject-nul.pipe';

/**
 * The NUL guard's own rules. `test/nul-input.e2e-spec.ts` drives it over
 * HTTP against the routes where a NUL used to become a 500.
 */
const pipe = new RejectNulPipe();
const NUL = 'Ahmed\u0000Hassan';

function refusal(run: () => unknown): Record<string, readonly string[]> | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof AppException) return error.fieldErrors;
    throw error;
  }
  return undefined;
}

describe('nulPaths', () => {
  it('names every field that carries one, in the Zod pipe’s path format', () => {
    expect(
      nulPaths({
        fullName: NUL,
        contact: { phone: '+20 100', note: NUL },
        allergies: [{ name: 'ok' }, { name: NUL }],
      }).sort(),
    ).toEqual(['allergies[1].name', 'contact.note', 'fullName']);
  });

  it('refuses a key that carries one, which jsonb cannot store either', () => {
    expect(nulPaths({ filters: { ['a\u0000b']: 1 } })).toEqual(['filters.a\u0000b']);
  });

  it('finds nothing in ordinary text, including other control characters', () => {
    expect(nulPaths({ note: 'line one\nline two\ttabbed', emoji: '🩺', name: 'Ãœ' })).toEqual([]);
  });

  it('survives nesting deep enough to overflow a recursive walk', () => {
    let deep: unknown = NUL;
    for (let level = 0; level < 100_000; level += 1) deep = { a: deep };

    expect(() => nulPaths(deep)).not.toThrow();
    expect(nulPaths(deep)).toHaveLength(1);
  });

  it('does not walk class instances such as Buffers', () => {
    expect(nulPaths({ file: Buffer.from([0, 0, 0]) })).toEqual([]);
  });
});

describe('RejectNulPipe', () => {
  it('refuses a body with 422 naming the field', () => {
    expect(refusal(() => pipe.transform({ firstName: NUL }, { type: 'body' }))).toEqual({
      firstName: [NUL_MESSAGE],
    });
  });

  it('names a path or query parameter by its own name', () => {
    expect(refusal(() => pipe.transform(NUL, { type: 'param', data: 'patientId' }))).toEqual({
      patientId: [NUL_MESSAGE],
    });
    expect(refusal(() => pipe.transform({ q: NUL }, { type: 'query' }))).toEqual({
      q: [NUL_MESSAGE],
    });
  });

  it('files a bare body string under _errors', () => {
    expect(refusal(() => pipe.transform(NUL, { type: 'body' }))).toEqual({
      _errors: [NUL_MESSAGE],
    });
  });

  it('passes through values from custom decorators, and clean values unchanged', () => {
    const user = { id: 'u', name: NUL };
    expect(pipe.transform(user, { type: 'custom' })).toBe(user);

    const body = { firstName: 'Ahmed' };
    expect(pipe.transform(body, { type: 'body' })).toBe(body);
  });
});
