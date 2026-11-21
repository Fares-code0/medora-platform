import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { patchOf } from './patch-schema';

/**
 * A PATCH carries only what the client sent (Zod 4 migration, M37.1).
 *
 * Zod 4 applies a field's `.default()` even after `.partial()` has made
 * it optional. The whole e2e suite stayed green across that change — no
 * test had ever asked what a PATCH body parses *to*, only whether it was
 * accepted — so the real schemas are pinned too, next to each schema
 * (`administration.schema.spec.ts`, `patient-tabs.schema.spec.ts`), and
 * over HTTP in `administration-center.e2e-spec.ts`.
 */
describe('patchOf', () => {
  const create = z.object({
    name: z.string().min(1),
    status: z.enum(['active', 'retired']).default('active'),
    tags: z.array(z.string()).default([]),
    note: z.string().nullable().default(null),
  });
  const update = patchOf(create);

  it('leaves an absent field absent instead of filling in its default', () => {
    expect(update.parse({ name: 'X' })).toEqual({ name: 'X' });
    expect(update.parse({})).toEqual({});
  });

  it('keeps the field rules — only the default is removed', () => {
    expect(update.safeParse({ name: '' }).success).toBe(false);
    expect(update.safeParse({ status: 'unknown' }).success).toBe(false);
    expect(update.parse({ status: 'retired', tags: ['a'] })).toEqual({
      status: 'retired',
      tags: ['a'],
    });
  });

  it('still lets a nullable-with-default field be cleared with an explicit null', () => {
    expect(update.parse({ note: null })).toEqual({ note: null });
  });

  it('does not touch the create schema, whose defaults still apply', () => {
    expect(create.parse({ name: 'X' })).toEqual({
      name: 'X',
      status: 'active',
      tags: [],
      note: null,
    });
  });
});
