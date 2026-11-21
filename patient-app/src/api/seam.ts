import { env } from '@/configs/env';
import type { MessageKey } from '@/i18n';

/**
 * The fixture -> HTTP seam.
 *
 * Many of the endpoints this app needs do not exist (audit §15.3), so a
 * feature is a fixture adapter today and an HTTP adapter later, and the
 * point of this file is that "later" is a one-line change per feature
 * rather than a rewrite of the screens.
 *
 * "Later" has already arrived for several features, which pass a real
 * adapter as `http`. `docs/ARCHITECTURE.md` §4.1 is the register of
 * which is which and `src/test/docs-consistency.test.ts` keeps it
 * honest; this comment deliberately does not repeat the list, because a
 * list here is a second place for it to go stale.
 *
 * ## The pattern, to be copied for every feature
 *
 * ```ts
 * // features/<x>/model/<x>-service.ts   the PORT. Types come from the
 * //                                     backend DTO vocabulary, never
 * //                                     from the fixture.
 * export interface XService { … }
 *
 * // features/<x>/fixtures/<x>-fixture-service.ts   the fixture adapter
 * // api/endpoints/<x>.ts                           the HTTP adapter
 *
 * // features/<x>/service.ts             the selection, and the only
 * //                                     module the feature imports
 * export const xService = selectService({
 *   fixture: fixtureXService,
 *   http: httpXService,
 * });
 * ```
 *
 * `selectService` is the ONLY place `env.enableMocks` is read. A feature
 * that branches on the flag itself has two seams that can disagree — the
 * exact failure this indirection exists to prevent, and the one the web
 * app hit before its own seam existed.
 *
 * A feature whose HTTP adapter cannot be written yet (because the
 * endpoint does not exist) passes `unavailableService(...)` as `http`.
 * That is the honest shape: the production build then FAILS LOUDLY with
 * "not implemented" rather than silently serving a patient invented data.
 */

/** Pure, so both branches are testable without module mocking. */
export function selectImplementation<T>(
  enableMocks: boolean,
  implementations: { readonly fixture: T; readonly http: T },
): T {
  return enableMocks ? implementations.fixture : implementations.http;
}

/** Picks the adapter for the current build. */
export function selectService<T>(implementations: { readonly fixture: T; readonly http: T }): T {
  return selectImplementation(env.enableMocks, implementations);
}

/**
 * Thrown by a service method whose backend endpoint does not exist yet.
 * Rendered by `ErrorState` as an explicit "not available yet" rather than
 * as a network failure the patient could retry past.
 *
 * ── `capability` is a catalogue KEY, not a sentence (C-09) ────────────
 *
 * It used to be a plain English string written in the service layer, and
 * two renderers — `ErrorState` and `authErrorKey` — interpolate it into a
 * translated sentence. So every refusal an Arabic-speaking patient met
 * was half-translated: *"Recent activity غير متاح بعد."* on roughly ten
 * screens, which is most of the app's current surface.
 *
 * `no-inline-copy.test.ts` could not see it, and its exemption explains
 * why: a service is "out of scope: this asks about rendered copy". True of
 * every other string in a service and false of this one. A `MessageKey`
 * makes the typechecker the guard instead — a new refusal cannot be added
 * with a sentence in it.
 *
 * The `Error.message` still carries the key rather than the words. It is a
 * developer-facing string for a log or a test, and a key there is more
 * useful than prose: it greps straight to the catalogue entry and to every
 * other call site that refuses for the same reason.
 */
export class EndpointNotImplementedError extends Error {
  constructor(
    /** The audit §15.3 row that will make this work — e.g. `BE-05`. */
    readonly dependency: string,
    /** What the patient was trying to do, as a catalogue key. Never PHI. */
    readonly capability: MessageKey,
  ) {
    super(`${capability} is not available yet: blocked on ${dependency}.`);
    this.name = 'EndpointNotImplementedError';
  }
}

/**
 * Builds an HTTP adapter for a service whose endpoints do not exist,
 * where every method rejects with the blocking dependency named.
 *
 * This is what keeps the rule in §11 of the brief — "do not invent
 * backend endpoints" — enforceable rather than aspirational. There is no
 * plausible-looking path string anywhere in this tree for a route that is
 * not in the API contract.
 */
export function unavailableService<T extends object>(
  dependency: string,
  capability: MessageKey,
  methods: readonly (keyof T)[],
): T {
  const impl: Record<string, unknown> = {};
  for (const method of methods) {
    impl[String(method)] = () =>
      Promise.reject(new EndpointNotImplementedError(dependency, capability));
  }
  return impl as T;
}
