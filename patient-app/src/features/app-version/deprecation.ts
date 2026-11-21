/**
 * API deprecation notices — checklist W-07.
 *
 * ── What this is, and how it differs from W-06 ───────────────────────
 * W-06 is the operator's emergency stop: a build below the floor is
 * blocked outright. This is the softer signal that should arrive long
 * before that — the server saying "the surface this build calls is on
 * its way out". It is advisory, so it is a banner and never a gate: a
 * patient must not be locked out of their appointments because a version
 * of an endpoint is scheduled for retirement.
 *
 * The two read the same responses through the same observer, which is
 * why `ApiClient` keeps a set of observers rather than one.
 *
 * ── The headers, and why these spellings ─────────────────────────────
 * - `Deprecation` — RFC 9745. The value is `@<unix-seconds>`; the
 *   pre-RFC drafts many servers still emit used an HTTP-date instead, so
 *   both are accepted. A bare `true` (an even older draft) is accepted
 *   as "deprecated, date unstated", because refusing it would discard a
 *   real warning over a spelling.
 * - `Sunset` — RFC 8594, an HTTP-date, the moment the surface stops
 *   answering. Optional: a deprecation without one is still a
 *   deprecation.
 *
 * **The backend does not send either header yet** — deprecation headers
 * are part of RM M41.2, which is untouched, the same milestone W-06 is
 * waiting on. So this is built, tested and inert: no header means no
 * notice and nothing on screen. When M41.2 lands and agrees these
 * spellings, the banner starts working with no client change.
 *
 * ── Failing quiet ────────────────────────────────────────────────────
 * Every ambiguous case resolves to "say nothing": absent header,
 * unparseable value, a sunset that cannot be read. W-06 fails open
 * because a wrong gate locks patients out; this fails quiet because a
 * wrong banner cries wolf, and a banner nobody believes is worse than no
 * banner at all.
 */

/** RFC 9745. */
export const DEPRECATION_HEADER = 'Deprecation';
/** RFC 8594. */
export const SUNSET_HEADER = 'Sunset';

export interface DeprecationNotice {
  /** When the surface was (or will be) deprecated. Null when unstated. */
  readonly deprecatedAt: Date | null;
  /** When it stops answering. Null when the server did not say. */
  readonly sunsetAt: Date | null;
}

/** A date, or null. Never `Invalid Date`, which compares false to everything. */
function parseHttpDate(raw: string): Date | null {
  const value = new Date(raw);
  return Number.isNaN(value.getTime()) ? null : value;
}

/**
 * `@1735689600` (RFC 9745), an HTTP-date (the pre-RFC drafts), or `true`
 * (older still, meaning "deprecated, no date"). Anything else is null.
 *
 * The boolean spelling is distinguishable from a failed parse by the
 * return of `decideDeprecation`, not here: this returns null for both,
 * and the caller below treats a present-but-dateless header as a notice.
 */
export function parseDeprecationDate(raw: string | null | undefined): Date | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value.length === 0) return null;

  const unix = /^@(\d+)$/.exec(value);
  if (unix !== null) {
    const seconds = Number(unix[1]);
    return Number.isSafeInteger(seconds) ? new Date(seconds * 1000) : null;
  }

  return parseHttpDate(value);
}

export function parseSunsetDate(raw: string | null | undefined): Date | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value.length === 0 ? null : parseHttpDate(value);
}

/**
 * The whole decision, pure — no headers object, no clock, no React.
 *
 * A `Sunset` with no `Deprecation` is deliberately NOT a notice. The two
 * headers are independent in the RFCs, and announcing a retirement the
 * server has not actually declared deprecated would be this client
 * inventing a fact.
 */
export function decideDeprecation(
  deprecationRaw: string | null | undefined,
  sunsetRaw: string | null | undefined,
): DeprecationNotice | null {
  if (typeof deprecationRaw !== 'string' || deprecationRaw.trim().length === 0) return null;

  const lowered = deprecationRaw.trim().toLowerCase();
  // The one value that explicitly means "not deprecated".
  if (lowered === 'false') return null;

  const deprecatedAt = parseDeprecationDate(deprecationRaw);
  // A header that is neither a date nor the boolean `true` is a spelling
  // this client does not know. Saying nothing beats guessing.
  if (deprecatedAt === null && lowered !== 'true') return null;

  return { deprecatedAt, sunsetAt: parseSunsetDate(sunsetRaw) };
}
