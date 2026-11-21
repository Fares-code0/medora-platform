import { describe, expect, it } from 'vitest';

import { resolveDestination } from './resolveDestination';

/**
 * Post-login destination. Phase 19 made this role-aware after a stale
 * `returnTo` from the other role walked an admin sign-in into the 403 page.
 * Phase B moved the administration area from /doctor/administration to
 * /admin, so a returnTo captured before the move must be translated BEFORE
 * the role check — otherwise it reads as a doctor path and gets discarded.
 *
 * It takes a ROLE rather than an email so that both callers — LoginPage
 * after sign-in, and RequireGuest when an already-authenticated user lands
 * on /login — compute the identical destination. They race on a cold boot,
 * and before this they disagreed: RequireGuest ignored returnTo entirely and
 * sent everyone to their role's landing page.
 */

const ADMIN = 'admin' as const;
const DOCTOR = 'doctor' as const;

describe('resolveDestination', () => {
  it('sends a user with no returnTo to the root redirect', () => {
    expect(resolveDestination(null, ADMIN)).toBe('/');
    expect(resolveDestination('', DOCTOR)).toBe('/');
  });

  it('sends a user of unknown role to the root redirect', () => {
    expect(resolveDestination('/admin/staff', undefined)).toBe('/');
  });

  it('refuses off-site and protocol-relative targets', () => {
    expect(resolveDestination('//evil.example.com', ADMIN)).toBe('/');
    expect(resolveDestination('https://evil.example.com', ADMIN)).toBe('/');
  });

  /**
   * A backslash is not a legitimate character in any route this app
   * declares, and a browser treats `/\` in a URL as `//` — so a target
   * the `//` rule above refuses can be smuggled past it by spelling the
   * second slash as a backslash. React Router 6.30.4 carries an advisory
   * for exactly that shape (GHSA-wrjc-x8rr-h8h6, open redirect via
   * backslash in `<Link>` and `useNavigate`), so this is refused here
   * before it reaches `navigate()`.
   *
   * The doctor branch is the one that needed it: a doctor may return
   * anywhere outside the other roles' workspaces, and `/\evil.example.com`
   * is inside none of them, so it was returned verbatim.
   */
  it('refuses a backslash target, which the protocol-relative rule misses', () => {
    expect(resolveDestination('/\\evil.example.com', DOCTOR)).toBe('/');
    expect(resolveDestination('/\\/evil.example.com', DOCTOR)).toBe('/');
    expect(resolveDestination('\\\\evil.example.com', DOCTOR)).toBe('/');
    // Encoded, because the value arrives from a query string.
    expect(resolveDestination(encodeURIComponent('/\\evil.example.com'), DOCTOR)).toBe('/');
    // A backslash anywhere in the path is refused, not just in front.
    expect(resolveDestination('/doctor/labs\\@evil.example.com', DOCTOR)).toBe('/');
  });

  it('returns an admin to the admin path they asked for', () => {
    expect(resolveDestination('/admin/staff', ADMIN)).toBe('/admin/staff');
    expect(resolveDestination('/admin/settings/security', ADMIN)).toBe('/admin/settings/security');
  });

  it('returns a doctor to the doctor path they asked for', () => {
    expect(resolveDestination('/doctor/labs', DOCTOR)).toBe('/doctor/labs');
  });

  it('discards a returnTo belonging to the other role', () => {
    expect(resolveDestination('/doctor/overview', ADMIN)).toBe('/');
    expect(resolveDestination('/admin/staff', DOCTOR)).toBe('/');
  });

  it('translates a pre-Phase-B administration link and honours it for an admin', () => {
    expect(resolveDestination('/doctor/administration', ADMIN)).toBe('/admin');
    expect(resolveDestination('/doctor/administration/staff', ADMIN)).toBe('/admin/staff');
    expect(resolveDestination('/doctor/administration/settings/security', ADMIN)).toBe(
      '/admin/settings/security',
    );
  });

  it('still refuses a translated administration link for a doctor', () => {
    expect(resolveDestination('/doctor/administration/staff', DOCTOR)).toBe('/');
  });

  /**
   * `decodeURIComponent` throws `URIError` on malformed percent-encoding,
   * and this value comes from a query string anyone can craft. It is read
   * during render in `RequireGuest` and in LoginPage's sign-in path, so a
   * throw is a crashed page rather than a dropped parameter.
   */
  it('refuses a returnTo that cannot be decoded instead of throwing', () => {
    expect(() => resolveDestination('%ZZ', DOCTOR)).not.toThrow();
    expect(resolveDestination('%ZZ', DOCTOR)).toBe('/');
    expect(resolveDestination('%E0%A4%A', ADMIN)).toBe('/');
    expect(resolveDestination('/admin/staff%', ADMIN)).toBe('/');
  });

  it('accepts a URL-encoded returnTo', () => {
    expect(resolveDestination(encodeURIComponent('/admin/queue?filter=urgent'), ADMIN)).toBe(
      '/admin/queue?filter=urgent',
    );
  });

  // DEC-006a: three more workspaces, each closed to the others.
  it('returns a staff account only into its own workspace', () => {
    expect(resolveDestination('/reception/appointments', 'reception')).toBe(
      '/reception/appointments',
    );
    expect(resolveDestination('/laboratory/catalogue', 'laboratory')).toBe('/laboratory/catalogue');
    expect(resolveDestination('/pharmacy/patients', 'pharmacy')).toBe('/pharmacy/patients');

    expect(resolveDestination('/doctor/overview', 'reception')).toBe('/');
    expect(resolveDestination('/admin/staff', 'laboratory')).toBe('/');
    expect(resolveDestination('/reception/appointments', 'pharmacy')).toBe('/');
  });

  it('keeps a doctor out of the staff workspaces but not out of the doctor pharmacy', () => {
    expect(resolveDestination('/reception/appointments', DOCTOR)).toBe('/');
    expect(resolveDestination('/pharmacy/patients', DOCTOR)).toBe('/');
    expect(resolveDestination('/doctor/pharmacy', DOCTOR)).toBe('/doctor/pharmacy');
  });
});
