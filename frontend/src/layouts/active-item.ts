/**
 * Active-nav-item matching, shared by the sidebar, the bottom tab bar and
 * the mobile drawer so all three agree.
 *
 * A plain `pathname.startsWith(item.path)` breaks when one item's path is a
 * prefix of another's — the admin area's overview lives at `/admin`, which
 * prefixes every other admin route, so it stayed lit on every page. The most
 * specific matching item wins, and matching is segment-aware so `/admin/staff`
 * never lights up for `/admin/staffing`.
 */

/** True when `pathname` is `path` itself or a route nested beneath it. */
function matches(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function isItemActive(
  pathname: string,
  path: string,
  allPaths: readonly string[],
  end = false,
): boolean {
  // `end` items match their own route only — used for an area index whose
  // path prefixes every sibling (React Router's NavLink vocabulary).
  if (end) return pathname === path;

  if (!matches(pathname, path)) return false;

  // Another item deeper down the same branch is the better answer.
  return !allPaths.some(
    (other) => other !== path && other.length > path.length && matches(pathname, other),
  );
}
