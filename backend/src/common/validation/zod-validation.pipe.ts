import { Injectable, type PipeTransform } from '@nestjs/common';
import { type ZodError, type ZodType, z } from 'zod';

import { AppException } from '../errors/app.exception';

/**
 * Zod validation → 422 with `fieldErrors` (RM M1.5, API §0.3).
 *
 * Zod is the frontend's source of truth for shapes (`features/auth/schemas`,
 * `settings/schemas.ts`), so the backend validates with the same vocabulary
 * rather than a parallel decorator dialect. That keeps one mental model
 * across the stack and makes drift visible.
 *
 * `fieldErrors` is keyed by **field path**, matching what the frontend's
 * `normalizeHttpError` hands to React Hook Form's `setError`. Nested and
 * array paths are flattened to dotted/bracketed keys — `contact.email`,
 * `allergies[0].severity` — because that is what RHF addresses fields by.
 */
@Injectable()
export class ZodValidationPipe<T extends ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    // Annotated rather than inferred so the parsed value reaches the
    // controller as the schema's output type, never as a wider one.
    const result: z.ZodSafeParseResult<z.output<T>> = this.schema.safeParse(value);

    if (!result.success) {
      throw AppException.validation(toFieldErrors(result.error));
    }

    const outOfRange = datesOutOfRange(result.data);
    if (outOfRange.length > 0) {
      throw AppException.validation(
        Object.fromEntries(
          outOfRange.map((path) => [path === '' ? '_errors' : path, [DATE_RANGE_MESSAGE]]),
        ),
      );
    }

    return result.data;
  }
}

/**
 * The years an instant may fall in, inclusive.
 *
 * `z.coerce.date()` accepts anything `new Date()` parses, which reaches
 * years ±275,760, and PostgreSQL's `timestamptz` (or the adapter writing
 * to it) refuses far less: `-200000-01-01`, `+275000-01-01` and
 * `-004713-11-24` each answered **500** as a record's `visitDate`
 * (2026-10-31). The bound is the API's own: every instant it serves is
 * ISO-8601 with a four-digit year (the M41.2 sweep, `timestamps-utc`), so
 * a date outside 0001–9999 is one it could not hand back. Whether a year
 * inside the range is *plausible* for a field is that field's rule.
 */
const MIN_YEAR = 1;
const MAX_YEAR = 9999;

export const DATE_RANGE_MESSAGE = `Must be a date between the years ${String(MIN_YEAR).padStart(4, '0')} and ${String(MAX_YEAR)}`;

/**
 * Every path in a parsed value holding a `Date` outside the range.
 *
 * Walked after parsing, so it sees exactly the fields a schema turned
 * into dates and nothing a client merely sent as a string. Iterative, for
 * the same reason as `reject-nul.pipe.ts`: parsed output can be deep.
 */
export function datesOutOfRange(root: unknown): string[] {
  const found: string[] = [];
  const pending: Array<readonly [unknown, string]> = [[root, '']];

  while (pending.length > 0) {
    const [value, path] = pending.pop()!;

    if (value instanceof Date) {
      const year = value.getUTCFullYear();
      if (year < MIN_YEAR || year > MAX_YEAR) found.push(path);
      continue;
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => pending.push([item, `${path}[${String(index)}]`]));
      continue;
    }

    if (typeof value !== 'object' || value === null) continue;
    if (Object.getPrototypeOf(value) !== Object.prototype) continue;

    for (const [key, child] of Object.entries(value)) {
      pending.push([child, path === '' ? key : `${path}.${key}`]);
    }
  }

  return found;
}

/** Convenience factory so routes read `@Body(zodBody(schema))`. */
export function zodBody<T extends ZodType>(schema: T): ZodValidationPipe<T> {
  return new ZodValidationPipe(schema);
}

/**
 * The same pipe, named for the other place it is used.
 *
 * `@Query(zodBody(...))` type-checks and works — the pipe does not care
 * where the value came from — but it reads as a mistake at every call
 * site, and a reader has to stop and confirm it is not one. The alias
 * costs one line and removes that.
 *
 * Query strings arrive as strings, so the schemas these guard use
 * `z.coerce` for numeric params. That is a property of the schema rather
 * than of the pipe, which is why there is one pipe and two names.
 */
export function zodQuery<T extends ZodType>(schema: T): ZodValidationPipe<T> {
  return new ZodValidationPipe(schema);
}

/**
 * Flattens a `ZodError` into `{ "path.to.field": ["message", …] }`.
 *
 * Errors on the object root (a refinement across two fields, say) have an
 * empty path; they are collected under `_errors`, which RHF surfaces as a
 * form-level message rather than dropping silently.
 */
export function toFieldErrors(error: ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? formatPath(issue.path) : '_errors';
    (fieldErrors[key] ??= []).push(issue.message);
  }

  return fieldErrors;
}

function formatPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((acc, segment) => {
    if (typeof segment === 'number') return `${acc}[${String(segment)}]`;
    // Zod 4 types a path segment as any property key. A symbol cannot
    // come out of a JSON body, but it is still spelled rather than lost.
    const key = String(segment);
    return acc.length === 0 ? key : `${acc}.${key}`;
  }, '');
}
