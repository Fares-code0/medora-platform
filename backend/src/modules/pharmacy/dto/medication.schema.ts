/**
 * Request validation for the formulary (API §7.1).
 *
 * ## `q` is optional, and that is the typeahead's contract
 *
 * The stepper opens with the full formulary and narrows as the clinician
 * types. Requiring `q` would make the first render a 422, so an absent
 * `q` means "everything, paginated" and a present one means "match name
 * or generic".
 *
 * ## The booleans arrive as strings
 *
 * `?controlled=true` is the string `"true"` by the time Express has
 * parsed it. `z.coerce.boolean()` is the wrong tool — it maps every
 * non-empty string to `true`, so `?controlled=false` would filter to
 * controlled substances, which is the opposite of what was asked. The
 * explicit `'true' | 'false'` enum refuses anything else with a 422
 * naming the field.
 */

import { z } from 'zod';

import {
  MEDICATION_CATEGORY_VALUES,
  MEDICATION_FORM_VALUES,
  MEDICATION_ROUTE_VALUES,
} from './pharmacy-enums';

/** `"true"`/`"false"` → boolean. Anything else is a 422, never a guess. */
const flag = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();

function enumOf(values: [string, ...string[]]) {
  return z.enum(values).optional();
}

export const medicationListSchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  category: enumOf(MEDICATION_CATEGORY_VALUES),
  form: enumOf(MEDICATION_FORM_VALUES),
  route: enumOf(MEDICATION_ROUTE_VALUES),
  controlled: flag,
  highRisk: flag,
  /**
   * Inactive medications are withdrawn from the formulary but still
   * referenced by historical prescriptions, so the default hides them
   * and `includeInactive=true` is how an administrator sees one.
   */
  includeInactive: flag,
  page: z.coerce.number().int().min(1).default(1),
  /**
   * 20 by default and 100 at most, matching every other list in the API.
   * A typeahead that returned the whole formulary on each keystroke is
   * the p95 this milestone's verify step measures.
   */
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type MedicationListQuery = z.infer<typeof medicationListSchema>;
