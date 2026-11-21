import { describe, expect, it } from 'vitest';

import { cursorFor, parseCursor } from './audit.repository';

/**
 * The audit list's keyset cursor (`<occurredAt>|<id>`, §14.1).
 *
 * A cursor only ever comes back from a client that was handed one, so a
 * malformed one is read as "no cursor" — the first page — rather than as
 * an error that would break paging. That has to hold for **both** halves:
 * an id that is not a uuid used to pass through to the keyset comparison
 * on a uuid column, which PostgreSQL answers with a 500 (API contract
 * audit, 2026-11-14).
 */
describe('parseCursor', () => {
  const id = '3112eaee-6a3e-4b55-9d3b-6a1c2b3c4d5e';
  const at = '2026-10-30T09:00:00.000Z';

  it('round-trips a cursor this server issued', () => {
    const cursor = cursorFor({ occurredAt: new Date(at), id } as Parameters<typeof cursorFor>[0]);
    expect(parseCursor(cursor)).toEqual({ occurredAt: new Date(at), id });
  });

  it('reads no cursor as no cursor', () => {
    expect(parseCursor(undefined)).toBeNull();
  });

  it.each([
    ['no separator', `${at}${id}`],
    ['an instant that is not one', `not-a-date|${id}`],
    ['an id that is not a uuid', `${at}|garbage`],
    ['an id with SQL in it', `${at}|' OR 1=1 --`],
    ['an empty id', `${at}|`],
  ])('reads a cursor with %s as no cursor', (_case, cursor) => {
    expect(parseCursor(cursor)).toBeNull();
  });
});
