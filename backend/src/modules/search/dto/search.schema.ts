/**
 * Request validation for global search (API §16.1, RM M26).
 *
 * ## The minimum length is a cost control, not a preference
 *
 * A one-character term matches most of the clinic, and the work of
 * finding that out is the same whether the caller wanted it or not.
 * Messaging's own search already refuses a one-character query
 * (`messages?q=a` → 422) and this is the same rule at the same bound, so
 * a client does not have to learn two.
 *
 * ## `scope` is a filter, never a grant
 *
 * `scope=admin` asks for the administration index. It does not confer
 * the right to read it — the service decides what a caller may search
 * from their role, and a doctor asking for the admin scope gets the
 * doctor scope's refusal rather than the admin scope's results. A query
 * parameter that widened authorization would be the whole of the bug.
 */

import { z } from 'zod';

export const SEARCH_SCOPES = ['doctor', 'admin'] as const;

export type SearchScope = (typeof SEARCH_SCOPES)[number];

export const searchQuerySchema = z.object({
  q: z.string().trim().min(2, 'Search for at least two characters').max(80),
  scope: z.enum(SEARCH_SCOPES).optional(),
  /**
   * Per group, not overall. The shell shows seven rows and a group that
   * returned two hundred would push every other group off the panel; the
   * client decides how to interleave, which it cannot do if the server
   * has already truncated across groups.
   */
  limit: z.coerce.number().int().min(1).max(25).default(5),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;
