import type { ApiError, Paginated } from '@/types/api';

/**
 * Shared building blocks for the HTTP adapters behind each feature's port
 * (FE-10, `docs/handoff/auth-seam.md` §1).
 *
 * Every adapter does the same three things to a response: take the
 * payload out of the `{ data }` envelope (API §0.2), refuse a body it
 * cannot read, and — for list endpoints — walk the pages. They live here
 * once so each adapter's own file is only its mapping, and so "the server
 * answered something unexpected" is one error everywhere rather than a
 * different crash per feature.
 *
 * **A malformed body is a server error, never an empty result.** An
 * adapter that coerced an unreadable list into `[]` would tell a doctor
 * "no patients" when the truth is "we could not read the answer" — the
 * fake-success failure this checklist keeps filing. So a shape mismatch
 * throws, the feature renders its error state, and the user can retry.
 */

/** Wraps a normalized ApiError in a real Error, as `api/errors.ts` does. */
function toThrowable(error: ApiError): ApiError & Error {
  return Object.assign(new Error(`API error: ${error.kind}`), error);
}

/**
 * The response did not have the shape the adapter was written against.
 * `ref` names what was being read, so a support report says where.
 */
export function malformedResponse(what: string): ApiError & Error {
  return toThrowable({ kind: 'server', code: 'malformed_response', ref: what });
}

/**
 * A feature with no backend behind it, asked for data in a live build.
 *
 * The live posture for unconnected features (FE-10 §18): rather than
 * falling back to seeded fixtures — fictional patients next to a real
 * sign-in — the feature's port rejects with this, and the screen renders
 * its ordinary error state. `ref` is the feature, for the same reason as
 * above.
 */
export function notConnected(feature: string): ApiError & Error {
  return toThrowable({ kind: 'server', code: 'not_connected', ref: feature });
}

/** True when an error is `notConnected`'s — screens may word it specially. */
export function isNotConnected(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === 'not_connected'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The payload of a `{ data: … }` envelope.
 *
 * Checks the envelope only; the payload's own shape is the caller's
 * mapper's business, because only it knows what a field must be.
 */
export function readData(body: unknown, what: string): unknown {
  if (!isRecord(body) || !('data' in body)) throw malformedResponse(what);
  return body.data;
}

/** A `Paginated<T>` payload whose items are still unread (`unknown`). */
export function readPage(body: unknown, what: string): Paginated<unknown> {
  const data = readData(body, what);
  if (
    !isRecord(data) ||
    !Array.isArray(data.items) ||
    typeof data.page !== 'number' ||
    typeof data.pageSize !== 'number' ||
    typeof data.totalItems !== 'number' ||
    typeof data.totalPages !== 'number'
  ) {
    throw malformedResponse(what);
  }
  return {
    items: data.items as readonly unknown[],
    page: data.page,
    pageSize: data.pageSize,
    totalItems: data.totalItems,
    totalPages: data.totalPages,
  };
}

/** The largest page the API serves (API §0.2: `pageSize` max 100). */
export const MAX_PAGE_SIZE = 100;

/**
 * Every item of a paginated collection, fetched page by page.
 *
 * Used where a screen was built over the whole collection — filtering,
 * sorting and paging on the client — and the collection is bounded by the
 * caller's scope (a doctor's own patients, their own appointments). The
 * `maxPages` ceiling turns an unexpectedly huge answer into an error the
 * screen can show instead of an unbounded download; moving those screens
 * to server-side paging is the follow-up if a real caseload ever reaches
 * it.
 */
export async function fetchAllPages(
  fetchPage: (page: number, pageSize: number) => Promise<unknown>,
  what: string,
  maxPages = 20,
): Promise<readonly unknown[]> {
  const items: unknown[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const result = readPage(await fetchPage(page, MAX_PAGE_SIZE), what);
    items.push(...result.items);
    if (result.page >= result.totalPages || result.items.length === 0) return items;
  }
  throw malformedResponse(`${what}: more than ${String(maxPages)} pages`);
}

// ── Field readers for adapter mappers ─────────────────────────────────────
//
// Small and strict on purpose: a mapper reads the fields it renders through
// these, so a missing or mistyped field fails as `malformedResponse` rather
// than reaching a component as `undefined`.

export function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) throw malformedResponse(what);
  return value;
}

export function readString(record: Record<string, unknown>, key: string, what: string): string {
  const value = record[key];
  if (typeof value !== 'string') throw malformedResponse(`${what}.${key}`);
  return value;
}

export function readOptionalString(
  record: Record<string, unknown>,
  key: string,
  what: string,
): string | null {
  const value = record[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw malformedResponse(`${what}.${key}`);
  return value;
}

export function readNumber(record: Record<string, unknown>, key: string, what: string): number {
  const value = record[key];
  if (typeof value !== 'number' || Number.isNaN(value)) throw malformedResponse(`${what}.${key}`);
  return value;
}

export function readOptionalNumber(
  record: Record<string, unknown>,
  key: string,
  what: string,
): number | null {
  const value = record[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || Number.isNaN(value)) throw malformedResponse(`${what}.${key}`);
  return value;
}

export function readBoolean(record: Record<string, unknown>, key: string, what: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') throw malformedResponse(`${what}.${key}`);
  return value;
}

export function readArray(
  record: Record<string, unknown>,
  key: string,
  what: string,
): readonly unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) throw malformedResponse(`${what}.${key}`);
  return value as readonly unknown[];
}

/**
 * A calendar day (`@db.Date`), which the API serves as UTC midnight —
 * `2026-10-04T00:00:00.000Z` — read as **local** midnight.
 *
 * Formatted as served, that instant is still the 3rd anywhere west of
 * Greenwich, so an encounter on the 4th would be charted on the 3rd. A day
 * has no time zone; local midnight is the instant that formats as the same
 * day everywhere.
 */
export function readDay(record: Record<string, unknown>, key: string, what: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})(T00:00:00(\.000)?Z)?$/.exec(readString(record, key, what));
  if (match === null) throw malformedResponse(`${what}.${key}`);
  return `${match[1] ?? ''}T00:00:00`;
}

export function readOptionalDay(
  record: Record<string, unknown>,
  key: string,
  what: string,
): string | null {
  return record[key] === null || record[key] === undefined ? null : readDay(record, key, what);
}

/** A string that must be one of a closed vocabulary — the frontend's union. */
export function readEnum<T extends string>(
  record: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  what: string,
): T {
  const value = readString(record, key, what);
  if (!(allowed as readonly string[]).includes(value)) throw malformedResponse(`${what}.${key}`);
  return value as T;
}
