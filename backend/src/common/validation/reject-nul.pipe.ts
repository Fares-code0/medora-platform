import { type ArgumentMetadata, Injectable, type PipeTransform } from '@nestjs/common';

import { AppException } from '../errors/app.exception';

/**
 * Refuses any request value carrying a NUL character (U+0000), with 422.
 *
 * ## Why
 *
 * PostgreSQL cannot store NUL in `text`, `varchar` or `jsonb` — not in a
 * value and not in a JSON key — and Zod's `string()` accepts it. So a NUL
 * reached the database and came back as a driver error, which the filter
 * answers with 500. Observed on 2026-10-31 at the public registration
 * route (`firstName`), a patient's name, a record's chief complaint, and
 * the patient search's `q`: anyone could make the API answer 500 and log
 * an unhandled exception, signed in or not.
 *
 * Refused rather than stripped. Silently changing what a clinician typed
 * into a clinical record is worse than telling them it was not accepted,
 * and no legitimate client sends NUL in JSON.
 *
 * ## Where
 *
 * One global pipe (`APP_PIPE` in `app.module.ts`), so it runs before
 * every route's own `zodBody`/`zodQuery` and on path parameters that no
 * schema checks. Values from custom parameter decorators (the
 * authenticated user, an uploaded file) are the server's, not the
 * client's, and are passed through.
 *
 * The walk is iterative. A 100 kB body can nest tens of thousands of
 * levels deep, and a recursive scan would overflow the stack on exactly
 * the input it exists to refuse.
 */
export const NUL_MESSAGE = 'Must not contain a NUL character';

@Injectable()
export class RejectNulPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (metadata.type === 'custom') return value;

    const paths = nulPaths(value, metadata.data ?? '');
    if (paths.length > 0) {
      throw AppException.validation(
        Object.fromEntries(paths.map((path) => [path === '' ? '_errors' : path, [NUL_MESSAGE]])),
      );
    }

    return value;
  }
}

/** Every path under `root` whose string value or object key contains NUL. */
export function nulPaths(root: unknown, rootPath = ''): string[] {
  const found: string[] = [];
  const pending: Array<readonly [unknown, string]> = [[root, rootPath]];

  while (pending.length > 0) {
    const [value, path] = pending.pop()!;

    if (typeof value === 'string') {
      if (value.includes('\u0000')) found.push(path);
      continue;
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => pending.push([item, `${path}[${String(index)}]`]));
      continue;
    }

    if (!isPlainObject(value)) continue;

    for (const [key, child] of Object.entries(value)) {
      const childPath = path === '' ? key : `${path}.${key}`;
      if (key.includes('\u0000')) found.push(childPath);
      pending.push([child, childPath]);
    }
  }

  return found;
}

/**
 * JSON objects and query objects, not class instances. A `Buffer`, a
 * `Date` or a stream is not client text and is not walked.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
