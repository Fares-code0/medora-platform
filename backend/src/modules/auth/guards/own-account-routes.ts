import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { ExecutionContext } from '@nestjs/common';

/**
 * The routes a **suspended doctor** may still use (#18,
 * `docs/multi-hospital/OWNER_DECISIONS.md`, "Doctor lifecycle":
 * Suspended — login "own profile only", clinical access denied).
 *
 * An allow-list, so it fails closed: a route added tomorrow is refused to
 * a suspended doctor until someone adds it here, where a reviewer sees
 * it. Keyed on the route's declared method and path (controller path +
 * handler path, without the global prefix), read from Nest's own routing
 * metadata — not on the request URL, which a client controls.
 *
 * What is on it is the account holder's own account and nothing else:
 * who they are, their profile, their credentials and second factor, and
 * their sessions, devices and sign-in history — so a suspended doctor can
 * still sign in, see why they cannot work, keep their account secure and
 * sign out. Nothing that reads or changes clinical, scheduling or
 * messaging data is listed. `POST /auth/logout` is not listed because it
 * never reaches this check (`@AllowEndedSession()`).
 */
export const OWN_ACCOUNT_ROUTES: ReadonlySet<string> = new Set([
  // The session shell (API §1.4).
  'GET auth/session',
  // Own profile and account.
  'GET me/profile',
  'PATCH me/profile',
  'PUT me/profile/photo',
  'GET me/account',
  'PATCH me/account',
  // Own credentials and second factor.
  'POST me/password',
  'POST me/password/verify',
  'GET me/2fa',
  'POST me/2fa/setup',
  'POST me/2fa/enable',
  'POST me/2fa/reenroll',
  'POST me/2fa/reenroll/confirm',
  'POST me/2fa/disable',
  // Own sessions, trusted devices and sign-in history (API §2.4–2.7).
  'GET me/sessions',
  'POST me/sessions/revoke-others',
  'DELETE me/sessions/:sessionId',
  'GET me/devices',
  'POST me/devices',
  'DELETE me/devices/:deviceId',
  'GET me/login-history',
]);

/**
 * `"<METHOD> <controller path>/<handler path>"` for the handler about to
 * run, or `null` when Nest's routing metadata is missing (which the guard
 * treats as "not on the list").
 */
export function routeKey(context: ExecutionContext): string | null {
  const handler = context.getHandler();
  const method: unknown = Reflect.getMetadata(METHOD_METADATA, handler);
  const handlerPath: unknown = Reflect.getMetadata(PATH_METADATA, handler);
  const controllerPath: unknown = Reflect.getMetadata(PATH_METADATA, context.getClass());

  if (typeof method !== 'number' || RequestMethod[method] === undefined) return null;

  const segments = [...pathSegments(controllerPath), ...pathSegments(handlerPath)];
  return `${RequestMethod[method]} ${segments.join('/')}`;
}

/** Whether the handler about to run is one a suspended doctor may use. */
export function isOwnAccountRoute(context: ExecutionContext): boolean {
  const key = routeKey(context);
  return key !== null && OWN_ACCOUNT_ROUTES.has(key);
}

function pathSegments(path: unknown): string[] {
  // A controller or handler may declare several paths; a route with more
  // than one is not on the list (none of the listed routes declares two).
  if (path === undefined) return [];
  if (typeof path !== 'string') return ['\u0000'];
  return path.split('/').filter((segment) => segment.length > 0);
}
