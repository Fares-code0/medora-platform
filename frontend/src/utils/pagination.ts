/**
 * Client-side page arithmetic for the P1 worklists (DS §8.26).
 *
 * One implementation shared by `Pagination` — which draws the controls — and
 * every page that slices its rows, so the two can never disagree about which
 * page is showing. They used to: `Pagination` clamped an out-of-range page for
 * display while the page sliced with the raw URL value, so `?page=9` on a
 * three-page list rendered "Showing 21–25" above an empty table.
 */

/** Pages needed for `totalItems`. Never below 1, so an empty list is "page 1 of 1". */
export function pageCount(totalItems: number, pageSize: number): number {
  return Math.max(1, Math.ceil(totalItems / pageSize));
}

/** `page` clamped into `1..pageCount`. */
export function clampPage(page: number, totalItems: number, pageSize: number): number {
  return Math.min(Math.max(1, page), pageCount(totalItems, pageSize));
}

/** The rows of the (clamped) page `page`. */
export function pageSlice<T>(rows: readonly T[], page: number, pageSize: number): readonly T[] {
  const current = clampPage(page, rows.length, pageSize);
  return rows.slice((current - 1) * pageSize, current * pageSize);
}
