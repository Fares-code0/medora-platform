/**
 * Request validation for the test catalogue (API §8.1).
 *
 * ## `q` is optional, and that is the order form's contract
 *
 * The ordering flow opens with the whole catalogue and narrows as the
 * clinician types. Requiring `q` would make the first render a 422, so
 * an absent `q` means "everything, paginated" and a present one means
 * "match name or LOINC code".
 *
 * ## The booleans arrive as strings
 *
 * `?includeInactive=true` is the string `"true"` by the time Express has
 * parsed it. `z.coerce.boolean()` is the wrong tool — it maps every
 * non-empty string to `true`, so `?includeInactive=false` would *show*
 * withdrawn tests, the opposite of what was asked. The explicit
 * `'true' | 'false'` enum refuses anything else with a 422 naming the
 * field, exactly as `medication.schema.ts` does.
 */

import { z } from 'zod';

import { LAB_CATEGORY_VALUES } from './labs-enums';

/** `"true"`/`"false"` → boolean. Anything else is a 422, never a guess. */
const flag = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();

export const labTestListSchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  category: z.enum(LAB_CATEGORY_VALUES).optional(),
  /**
   * A withdrawn test is hidden by default and still referenced by orders
   * written before it was withdrawn, so this is how an administrator
   * sees one rather than a reason to delete the row.
   */
  includeInactive: flag,
  page: z.coerce.number().int().min(1).default(1),
  /**
   * 20 by default and 100 at most, matching every other list in the API.
   * The catalogue is small, but a client that could ask for all of it in
   * one request is a client whose page size grows with the clinic's.
   */
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type LabTestListQuery = z.infer<typeof labTestListSchema>;
