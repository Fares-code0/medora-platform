import { z } from 'zod';

/**
 * The PATCH form of a create schema: every field optional, **no defaults**.
 *
 * `schema.partial()` is not that in Zod 4. Zod 3 skipped a field's
 * `.default()` once `.partial()` had made it optional; Zod 4 applies it,
 * so `staffSchema.partial().parse({ name: 'X' })` returns
 * `{ name: 'X', status: 'off-duty', permissions: [] }` — and a PATCH that
 * renames a staff member would silently reset their status and their
 * permissions. A default belongs to creation ("what a new row starts
 * with"), never to an update ("what the client asked to change").
 *
 * This unwraps each field's default before making it optional, so an
 * absent field stays absent and the service's "only what was sent"
 * update keeps meaning what it says. `nullable().default(null)` unwraps
 * to `nullable()`, so an explicit `null` still clears the column.
 */
export function patchOf<Shape extends z.ZodRawShape>(
  schema: z.ZodObject<Shape>,
): z.ZodObject<PatchShape<Shape>> {
  const shape: Record<string, z.ZodOptional<z.core.$ZodType>> = {};

  for (const [key, field] of Object.entries(schema.shape)) {
    const inner: z.core.$ZodType = field instanceof z.ZodDefault ? field.unwrap() : field;
    shape[key] = z.optional(inner);
  }

  // `Object.entries` forgets the key → schema pairing, so the shape is
  // rebuilt untyped and re-typed once, here. The two types share no
  // structure TypeScript can compare (a string index signature against a
  // mapped type), hence `unknown` in between. `PatchShape` states what
  // the loop does; `patch-schema.spec.ts` asserts that it does it.
  return z.object(shape) as unknown as z.ZodObject<PatchShape<Shape>>;
}

type Undefaulted<Field> = Field extends z.ZodDefault<infer Inner> ? Inner : Field;

export type PatchShape<Shape extends z.ZodRawShape> = {
  -readonly [Key in keyof Shape]: z.ZodOptional<Undefaulted<Shape[Key]>>;
};
