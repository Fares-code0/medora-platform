import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import {
  AUTHENTICATED_USER,
  type AuthenticatedUser,
  type RequestWithUser,
} from './authenticated-user';

/**
 * Injects the principal the access-token guard attached (RM M6.2).
 *
 * Non-null by construction: a handler only runs after the guard has
 * either populated the request or rejected it, and a `@Public()` route
 * has no business asking for a user. A route that does both is a
 * programming error, and it throws here rather than handing back
 * `undefined` for a later line to dereference.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request[AUTHENTICATED_USER];

    if (user === undefined) {
      throw new Error(
        '@CurrentUser() used on a route with no authenticated principal — the route is @Public() or the guard is not registered.',
      );
    }

    return user;
  },
);
