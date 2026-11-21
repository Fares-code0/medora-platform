import { httpAuthService } from '@/api/endpoints/auth';
import { selectService } from '@/api/seam';
import type { AuthService } from '@/types/auth';

import { mockAuthService } from './mock/mock-auth-service';

/**
 * The auth seam's selection — FRONTEND_CHECKLIST §6 DP-04.
 *
 * The only module `AuthProvider` imports, and the only place the two
 * adapters are named together. `VITE_ENABLE_MOCKS=true` keeps the seeded
 * accounts; `false` points the same seven screens at the live API.
 *
 * Both adapters are imported unconditionally, so both are typechecked on
 * every build and neither can rot behind the flag. The mock costs about
 * 4 kB in a production bundle — cheap next to a seam that silently stops
 * compiling.
 *
 * This is the template for the other twelve features: see `api/seam.ts`.
 */
export const authService: AuthService = selectService({
  mock: mockAuthService,
  http: httpAuthService,
});
