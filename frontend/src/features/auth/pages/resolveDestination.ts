import { routes } from '@/routes';
import { isInWorkspace } from '@/routes/workspaces';
import { ROLES, type Role } from '@/types/auth';

/** True when `path` is `base` itself or something nested under it. */
function within(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}/`);
}

/**
 * `decodeURIComponent` throws `URIError` on malformed percent-encoding — a
 * bare `%`, `%ZZ`, a truncated `%E0%A4%A` — and this value arrives from a
 * query string anyone can craft. It is read during render in `RequireGuest`
 * and again in LoginPage's sign-in path, so an unhandled throw there is a
 * crashed page, not a dropped parameter. A target that cannot be decoded is
 * refused, which is what every other unusable `returnTo` already gets.
 */
function decodeSafely(returnTo: string): string {
  try {
    return decodeURIComponent(returnTo);
  } catch {
    return '';
  }
}

/**
 * Rewrites a pre-Phase-B administration link onto its /admin equivalent.
 * The area moved out of /doctor, so an old `returnTo` would otherwise read
 * as a doctor path and be discarded by the role check below.
 */
function translateLegacy(path: string): string {
  if (!within(path, routes.legacy.administrationRoot)) return path;
  const rest = path.slice(routes.legacy.administrationRoot.length).replace(/^\/+|\/+$/g, '');
  return rest === '' ? routes.admin.root : `${routes.admin.root}/${rest}`;
}

/**
 * Role-aware returnTo resolution (Phase 19 bug fix). A stored returnTo can
 * belong to the OTHER role — e.g. an expired doctor session leaves
 * `?returnTo=/doctor/overview`, and an admin signing in would be walked
 * straight into the doctor guard's 403 page before reaching their panel.
 * Only follow a same-origin path the signed-in role may actually visit;
 * everything else falls back to the root redirect (role landing).
 *
 * Takes a ROLE, not an email, so RequireGuest can apply the identical rule.
 * On a cold boot straight onto /login the two race, and RequireGuest used to
 * win with a plain role-landing redirect — silently dropping returnTo and
 * breaking every deep link that required signing in first.
 *
 * `account` makes a returnTo the property of the account it was captured
 * for (A-W1). `RequireAuth` captures one whenever a session in this tab
 * ends, so it is the path the PREVIOUS account was on — `/doctor/patients/
 * <id>`, say. When this tab knows who that was and someone else has signed
 * in, the next user must not land on it: they go to their own landing page.
 * With no previous account known (a fresh load onto a bookmarked deep link)
 * there is no one else's path to carry over, and the role rule alone
 * applies, as before. Ids stay in memory; none is ever put in the URL.
 */
export interface ReturnToAccount {
  /** The account now signed in. */
  readonly userId: string | undefined;
  /** The account whose session last ended in this tab; null when none has. */
  readonly previousUserId: string | null;
}

export function resolveDestination(
  returnTo: string | null,
  role: Role | undefined,
  account?: ReturnToAccount,
): string {
  if (!returnTo || !role) return routes.root;

  if (account?.previousUserId && account.previousUserId !== account.userId) return routes.root;

  const decoded = translateLegacy(decodeSafely(returnTo));

  // A backslash appears in no route this app declares, and a browser reads
  // `/\` in a URL as `//` — so spelling the second slash as a backslash
  // carries an off-site target straight past the protocol-relative rule
  // below. React Router 6.30.4 carries an advisory for that exact shape
  // (GHSA-wrjc-x8rr-h8h6, open redirect via backslash in `<Link>` and
  // `useNavigate`), so it is refused here, before `navigate()` sees it.
  // Refused rather than stripped: repairing the path means guessing what a
  // hostile author meant, and the only legitimate value is one we can read
  // as written.
  if (decoded.includes('\\')) return routes.root;

  if (!decoded.startsWith('/') || decoded.startsWith('//')) return routes.root;

  const path = decoded.split('?')[0] ?? decoded;

  // A doctor may return anywhere outside the other roles' workspaces (the
  // doctor area plus the shared pages); every other role only inside its own
  // (DEC-006a). A link into someone else's area goes home rather than to a
  // 403 — the guard would refuse it anyway, and the server refuses its data.
  if (role === 'doctor') {
    const elsewhere = ROLES.some((other) => other !== 'doctor' && isInWorkspace(path, other));
    return elsewhere ? routes.root : decoded;
  }
  return isInWorkspace(path, role) ? decoded : routes.root;
}
