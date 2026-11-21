import { describe, expect, it } from 'vitest';

import { applySoftDeleteFilter, FILTERED_READ_OPERATIONS, ONLY_DELETED } from './soft-delete';

/**
 * The filter predicate, tested without a database (RM M4.2).
 *
 * `test/database.e2e-spec.ts` proves the behaviour end to end against a
 * real Postgres. This file pins the rule itself, because the rule is
 * subtle — it turns on key *presence*, not value — and a database test
 * would not say clearly which of the three cases broke.
 */
describe('applySoftDeleteFilter (RM M4.2)', () => {
  it('adds the filter when the caller says nothing about deletedAt', () => {
    expect(applySoftDeleteFilter({})).toEqual({ where: { deletedAt: null } });
  });

  it('preserves the caller’s other conditions', () => {
    expect(applySoftDeleteFilter({ where: { label: 'ward-a' } })).toEqual({
      where: { label: 'ward-a', deletedAt: null },
    });
  });

  it('leaves the query alone when deletedAt is already specified', () => {
    // Asking for only-deleted rows must not be turned into a query for
    // rows that are both deleted and not deleted.
    const args = { where: { deletedAt: { not: null } } };
    expect(applySoftDeleteFilter(args)).toEqual(args);
  });

  it('leaves an only-deleted query alone', () => {
    const args = { where: { ...ONLY_DELETED } };
    expect(applySoftDeleteFilter(args)).toEqual(args);
  });

  it('detects the key by presence, not by truthiness', () => {
    // `undefined` is falsy, so a truthiness check would re-add the
    // filter and turn this into "deleted and not deleted" — no rows.
    const args = { where: { deletedAt: undefined } };
    expect(applySoftDeleteFilter(args)).toEqual(args);
  });

  it('covers every read that can return a soft-deleted row', () => {
    // A read missing from this list leaks deleted clinical rows into an
    // ordinary query, which is the failure that matters here.
    expect([...FILTERED_READ_OPERATIONS].sort()).toEqual([
      'aggregate',
      'count',
      'findFirst',
      'findFirstOrThrow',
      'findMany',
    ]);
  });

  it('does not mutate the caller’s arguments', () => {
    // Prisma reuses argument objects across retries; mutating one would
    // make the second attempt of a query different from the first.
    const args = { where: { label: 'ward-a' } };
    const result = applySoftDeleteFilter(args);

    expect(args).toEqual({ where: { label: 'ward-a' } });
    expect(result).not.toBe(args);
  });
});
