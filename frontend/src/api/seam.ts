import { env } from '@/configs/env';

/**
 * The mock → HTTP seam (FRONTEND_CHECKLIST §6 DP-04).
 *
 * One feature, one port interface, two adapters, one selection. Nothing
 * downstream of a seam may import an adapter directly — that is the whole
 * point, and it is the rule the auth seam broke before this file existed
 * (`AuthProvider` hard-imported `mock/mock-auth-service`).
 *
 * ## The pattern, to be copied
 *
 * ```ts
 * // features/<x>/model/<x>-service.ts   — the port. Types come from the
 * //                                       BACKEND DTOs, not from the mock.
 * export interface XService { … }
 *
 * // features/<x>/mock/mock-x-service.ts — the mock adapter
 * export const mockXService: XService = { … };
 *
 * // features/<x>/http/http-x-service.ts — the HTTP adapter, on ApiClient
 * export const httpXService: XService = { … };          (FE-10)
 *
 * // features/<x>/service.ts             — the selection, and the only
 * //                                       module the feature imports
 * export const xService = selectService({ mock: mockXService, http: httpXService });
 * ```
 *
 * **Where the HTTP adapter lives follows where its port lives.** Auth's
 * port is in `types/auth`, so its adapter can sit in `api/endpoints/`.
 * Every other port is typed in its feature's `model/`, and `src/api` may
 * not import a feature (§1.2), so those adapters sit in the feature's own
 * `http/` folder beside `mock/`, built from the shared readers in
 * `api/http.ts`. A feature with no backend yet has no `http` adapter to
 * select: in a live build its port answers `notConnected(…)` rather than
 * seeded fixtures (FE-10 §18), so fictional clinical data can never sit
 * next to a real sign-in.
 *
 * `selectService` is deliberately the *only* place `env.enableMocks` is
 * read. A feature that branches on the flag itself has two seams that can
 * disagree, which is the failure this indirection exists to prevent.
 */

/**
 * Pure selection, so both branches are testable without module mocking.
 * `selectService` below is the one-liner that binds it to the real flag.
 */
export function selectImplementation<T>(
  enableMocks: boolean,
  implementations: { readonly mock: T; readonly http: T },
): T {
  return enableMocks ? implementations.mock : implementations.http;
}

/**
 * Picks the adapter for the current build. See the pattern above.
 *
 * In a production build `import.meta.env.MEDORA_MOCKS_STRIPPED` is the
 * constant `true` and this always answers the HTTP adapter — the runtime half
 * of RM M40.4. The build half rewrites every call site to its HTTP adapter
 * before bundling, so the mock one is not even shipped
 * (`scripts/mock-boundary.ts`); that rewrite reads the call structurally, so
 * any argument shape is covered as long as the object names `mock` and `http`.
 */
export function selectService<T>(implementations: { readonly mock: T; readonly http: T }): T {
  if (import.meta.env.MEDORA_MOCKS_STRIPPED === true) return implementations.http;
  return selectImplementation(env.enableMocks, implementations);
}
