import { selectService } from '@/api/seam';

import { withDemoAccess } from './dev/demo-session';
import { fixtureAuthService } from './fixtures/fixture-auth-service';
import { httpAuthService } from './http-auth-service';
import type { AuthService } from './model/types';

/**
 * The selection. The only module the auth feature imports for data, and
 * the only place `env.enableMocks` decides anything for it.
 */
const selected: AuthService = selectService({
  fixture: fixtureAuthService,
  http: httpAuthService,
});

/**
 * In development, and only there, the selected adapter also answers for
 * the demo patient's refresh token so that "Continue as Demo Patient"
 * survives an app restart. See `dev/demo-session.ts`.
 *
 * `__DEV__` is a compile-time constant Metro replaces with `false` in a
 * release build, so this reduces to `selected` — the demo token is then
 * honoured by nothing, which is the production-safety property
 * `dev/demo-access.test.ts` asserts directly.
 *
 * It is deliberately NOT `env.enableMocks`: that is an operator-set
 * variable that a deployment can get wrong, and the whole point of the
 * gate is that it cannot be got wrong.
 */
export const authService: AuthService = __DEV__ ? withDemoAccess(selected) : selected;
