import { SetMetadata, type CustomDecorator } from '@nestjs/common';

/**
 * Marks a route as reachable without an access token (RM M6.2).
 *
 * The access-token guard is registered globally, so the default for
 * every route in the application — including ones a later milestone adds
 * and forgets to think about — is "authentication required". Opting out
 * is explicit and greppable; opting *in* would mean a route added
 * without a guard is silently public, which is the failure mode this
 * inversion exists to remove.
 *
 * It lives in `common/` because `modules/health` needs it and M2.2's
 * zone 1 forbids health from importing auth.
 */
export const IS_PUBLIC_KEY = 'auth:public';

export const Public = (): CustomDecorator<string> => SetMetadata(IS_PUBLIC_KEY, true);
