import { z } from 'zod';

import { logger } from '@/utils/logger';

/**
 * Response validation.
 *
 * ── What this is for ─────────────────────────────────────────────────
 * "The frontend must fail safely if the backend returns an unexpected
 * shape" (§12 of the brief). A `TypeError: undefined is not an object`
 * three components deep is not failing safely; a typed error state is.
 *
 * ── What this is NOT ─────────────────────────────────────────────────
 * A place to invent schemas for endpoints that do not exist. There is
 * exactly one concrete schema module in this tree — `auth.ts`, for the
 * ten routes that are actually built — because everything else is a
 * fixture behind a port. When BE-04 or BE-05 lands, its schema is written
 * from the contract that shipped with it, not guessed now.
 */

export const envelopeSchema = <T extends z.ZodTypeAny>(data: T) => z.object({ data });

export const paginatedSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    page: z.number().int().nonnegative(),
    pageSize: z.number().int().positive(),
    totalItems: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  });

/**
 * The most issue paths one contract error carries and logs.
 *
 * zod reports one issue per failing element and caps nothing, so a
 * malformed collection yields an issue list as long as the payload.
 * Mapping every one of them built a second copy of that list — measured
 * at ~6 MB of path strings for 100,000 bad rows — which was then both
 * retained on the thrown error and handed to the logger to serialise.
 * Diagnosing a shape mismatch needs the first few paths, not every
 * index, so the list is bounded and the true total is reported beside it.
 *
 * This bounds *this module's* amplification only. zod still allocates its
 * own issue objects before `safeParse` returns, which is the cost the
 * advisory describes (GHSA-mrhx-c7xc-m3w5, no fix in any 3.x); removing
 * that needs the 4.x upgrade, which is T-12's remaining half and the
 * owner's call. See `docs/DEPENDENCIES.md` §4.1.
 */
const MAX_REPORTED_ISSUES = 20;

/** Thrown when a response does not match its contract. */
export class ResponseContractError extends Error {
  constructor(
    readonly endpoint: string,
    /**
     * Field PATHS only — never values, which can be PHI. Bounded by
     * `MAX_REPORTED_ISSUES`; `issueCount` is how many there really were.
     */
    readonly issues: readonly string[],
    /** Total issues reported, which may exceed `issues.length`. */
    readonly issueCount: number = issues.length,
  ) {
    super(`Unexpected response shape from ${endpoint}.`);
    this.name = 'ResponseContractError';
  }
}

/**
 * Parses a response body against its schema.
 *
 * On failure it logs the field PATHS and the endpoint — never the payload.
 * A validation dump of a `/me/health/labs` response is a lab report in a
 * log file, which is precisely what T-04 forbids.
 */
export function parseResponse<T extends z.ZodTypeAny>(
  endpoint: string,
  schema: T,
  payload: unknown,
): z.infer<T> {
  const result = schema.safeParse(payload);
  if (result.success) {
    return result.data as z.infer<T>;
  }
  const reported = result.error.issues;
  const issues = reported
    .slice(0, MAX_REPORTED_ISSUES)
    .map((issue) => `${issue.path.join('.')}: ${issue.code}`);
  logger.error('Response failed its contract', {
    endpoint,
    issues,
    issueCount: reported.length,
  });
  throw new ResponseContractError(endpoint, issues, reported.length);
}
