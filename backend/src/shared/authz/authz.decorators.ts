/**
 * Route authorization metadata (RM M7.1, API §0.4).
 *
 * API §0.4's shorthand has four states and all four are here:
 * `@Public()` for `—`, `@Authenticated()` for `✓`, `@Roles(...)` for a
 * role, `@Can(...)` for a capability.
 *
 * `@Authenticated()` was deliberately absent while this kernel had no
 * routes to guard, on the reasoning that a route needing only a login is
 * usually a route whose capability nobody thought about. Five real
 * routes have since disproved the general case: `POST /auth/logout` and
 * the four `/me/…` account routes act on *the caller's own* account, so
 * there is no capability to name — the user id in the token is the whole
 * authorization decision. Leaving them unmarked would have had the guard
 * deny them, which is not "safe", just wrong.
 *
 * The deny-by-default rule is unchanged, and this is what keeps it
 * honest: `@Authenticated()` makes "any signed-in user may do this" a
 * claim someone wrote down and a reviewer can grep for, rather than the
 * silent consequence of an omission.
 *
 * ## `@Public()` is M6's, not ours
 *
 * There was briefly a second `Public` here, with its own metadata key.
 * Two decorators of the same name and different keys is the worst
 * available outcome: M6's global authentication guard reads
 * `IS_PUBLIC_KEY`, so a route marked with *this* module's version would
 * still have demanded a token — and, because the authorization guard
 * denies anything it does not recognise, a route marked with M6's
 * version would have been denied by this one. Neither failure shows up
 * in a type. So there is exactly one `Public`, it lives in `common/auth`
 * where `modules/health` can reach it without importing `modules/auth`,
 * and it is re-exported here only as a convenience for callers already
 * importing `@Can`.
 */

import { SetMetadata, type CustomDecorator } from '@nestjs/common';

import type { Permission, PlatformRole } from './permission-catalogue';

export const CAN_METADATA = 'medora:authz:can';
export const ROLES_METADATA = 'medora:authz:roles';
export const AUTHENTICATED_METADATA = 'medora:authz:authenticated';
export const PLATFORM_SCOPE_METADATA = 'medora:authz:platform-scope';
export const HOSPITAL_SCOPE_METADATA = 'medora:authz:hospital-scope';

/**
 * API §0.4's `✓` — any authenticated user, no capability required.
 *
 * Use it only where the token's subject *is* the authorization decision:
 * a route that reads or changes the caller's own account. Anything that
 * touches another user's data, or the clinic's, wants `@Can(...)`.
 */
export function Authenticated(): CustomDecorator<string> {
  return SetMetadata(AUTHENTICATED_METADATA, true);
}

/**
 * Requires every listed capability — `@Can('a', 'b')` means both, not
 * either. The narrower reading is the safe one to be wrong about: a
 * route that demanded too much fails loudly in review, one that demanded
 * too little fails silently in production.
 */
export function Can(...capabilities: readonly Permission[]): CustomDecorator<string> {
  return SetMetadata(CAN_METADATA, capabilities);
}

/**
 * Requires the principal to hold one of the listed platform roles.
 *
 * Typed to `PlatformRole`, so a role that exists in the `roles` table but
 * has no column in the permission matrix — `nurse` today — cannot be
 * named here. That is intentional: such a role holds no capability by
 * construction, so a route restricted to it would be unreachable.
 */
export function Roles(...roles: readonly PlatformRole[]): CustomDecorator<string> {
  return SetMetadata(ROLES_METADATA, roles);
}

/**
 * Platform-tier route (§2.2, §2.3): only a Platform Admin may call it. A
 * Hospital Admin holding the same capability is refused, because the route
 * acts across hospitals (the permission matrix, platform settings,
 * integrations, the platform audit ledger, platform admin grants).
 */
export function PlatformScope(): CustomDecorator<string> {
  return SetMetadata(PLATFORM_SCOPE_METADATA, true);
}

/**
 * Hospital-tier route (§2.3): a Hospital Admin may call it, confined by the
 * service to its own hospital. Administrative routes are platform-tier by
 * default (deny by default): a route opens to Hospital Admins only when it
 * has been built to scope its data to one hospital and says so here.
 */
export function HospitalScope(): CustomDecorator<string> {
  return SetMetadata(HOSPITAL_SCOPE_METADATA, true);
}

export { IS_PUBLIC_KEY, Public } from '../../common/auth/public.decorator';

export const OUTSIDE_STANDING_METADATA = 'medora:authz:outside-standing';

/**
 * The allowlist for an account without clinical standing (audit F-09).
 *
 * A doctor or staff member who is suspended, unverified, never employed,
 * between employments or otherwise outside clinical standing may use only
 * routes carrying this marker: their own account and profile, its
 * security (password, two-factor, sessions), the session read, the
 * verification documents that restore standing, the files those are
 * uploaded through, and the status vocabulary. Every other route —
 * `@Authenticated()` ones included — answers 403 `clinical_standing_required`
 * for them. Explicit rather than inferred: a new route is closed to them
 * until someone decides otherwise.
 */
export function OutsideClinicalStanding(): CustomDecorator<string> {
  return SetMetadata(OUTSIDE_STANDING_METADATA, true);
}
