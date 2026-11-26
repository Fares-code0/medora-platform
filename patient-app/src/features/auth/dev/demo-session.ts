import type { AuthService, SignInResult } from '../model/types';

/**
 * The development demo patient — **`__DEV__` builds only**.
 *
 * ## Why this exists
 *
 * The app requires a session that only a backend can issue, and the
 * backend's patient authentication (ADR-030) is not deployable yet. Until
 * it is, there is no way past `LoginScreen` and therefore no way to work
 * on the home, appointments, doctors, messages or profile screens at all.
 * This is the stand-in for that, and nothing more.
 *
 * ## Why it is not just another fixture account
 *
 * `fixtures/fixture-auth-service.ts` already has three seeded accounts,
 * and they are the right tool for *testing sign-in* — they exercise wrong
 * passwords, the OTP step-up and the unverified-email branch. They are the
 * wrong tool for *getting past sign-in*, because using one means typing a
 * password, which means a password exists in the repository for someone to
 * paste somewhere it matters.
 *
 * This has no password. The button is the affordance. There is nothing
 * here that could be used as a credential anywhere else, because there is
 * no credential.
 *
 * ## What `__DEV__` does and does not guarantee
 *
 * `__DEV__` is substituted with `false` by Metro in a release build, so
 * both gates on this feature — the button in `LoginScreen` and the
 * `withDemoAccess` wrapper in `service.ts` — are eliminated as dead code.
 * A release build has no way to *reach* any of this.
 *
 * It does not follow that these bytes are absent from a release bundle.
 * Metro resolves its module graph before minification and does not
 * tree-shake by module the way Rollup does, so the strings below may well
 * ship even though nothing can execute them. That is why the guarantee is
 * written as a *behaviour* and tested as one: `demo-access.test.ts` proves
 * that the un-wrapped service — the one a release build gets — refuses
 * this refresh token. A token that no production code path honours is not
 * a bypass, whether or not its bytes are on disk.
 *
 * (The web app can and does make the stronger claim; see
 * `frontend/scripts/demo-access-boundary.ts`, which fails the build.)
 *
 * ## Removing it
 *
 * When ADR-030's endpoints land: delete this directory, delete the
 * `withDemoAccess` line from `service.ts`, and delete the one `__DEV__`
 * block from `LoginScreen`. Nothing else references it.
 */

/**
 * The refresh token the demo session stores in the keychain.
 *
 * A cold start reads whatever token is on the device and asks the auth
 * service to exchange it (`SessionProvider`'s restore effect), so the demo
 * session survives an app restart only if some adapter answers for this
 * value. In development `withDemoAccess` does. In production nothing does,
 * which is the whole safety property.
 *
 * Prefixed `dev-demo-` rather than shaped like a JWT on purpose: a string
 * that looks like a credential invites being treated as one.
 */
export const DEMO_PATIENT_REFRESH_TOKEN = 'dev-demo-patient-refresh';

/**
 * The demo patient.
 *
 * `AuthenticatedIdentity` is deliberately minimal (see `model/types.ts`):
 * a subject id, a display name, an email, a verification flag and the
 * `patient` role the eligibility gate requires (C-11), with no permissions,
 * because the client makes no per-action authorization decision. This fixture invents nothing beyond it — in particular it does
 * not guess at how ADR-030 models patient identity, which is the rule that
 * file was written to obey.
 *
 * `@medora.local` marks it as local rather than provisioned, so it is not
 * mistaken for a real account in a screenshot.
 */
export const DEMO_PATIENT_SESSION: SignInResult = {
  tokens: {
    // Memory-only, like every access token here (checklist T-02). There is
    // no server to authorize against, so this authorizes nothing.
    accessToken: 'dev-demo-patient-access',
    refreshToken: DEMO_PATIENT_REFRESH_TOKEN,
  },
  identity: {
    subjectId: 'demo-patient-001',
    displayName: 'Demo Patient',
    email: 'demo.patient@medora.local',
    emailVerified: true,
    role: 'patient',
  },
};

/** Whether a stored token is the demo one. Pure, so it is testable alone. */
export function isDemoRefreshToken(token: string): boolean {
  return token === DEMO_PATIENT_REFRESH_TOKEN;
}

/**
 * Teaches an auth service to restore the demo session, and nothing else.
 *
 * Only `refresh` is intercepted, because only `refresh` stands between the
 * demo session and surviving an app restart. Every other method — login,
 * OTP, recovery, password change, registration — delegates untouched, so
 * the real flows behave exactly as they did and a demo session cannot
 * reach any of them. In particular `login` is NOT intercepted: there is no
 * email and no password that signs anyone in as the demo patient.
 *
 * Applied in `service.ts` behind `__DEV__`.
 */
export function withDemoAccess(inner: AuthService): AuthService {
  return {
    ...inner,
    refresh: (refreshToken) =>
      isDemoRefreshToken(refreshToken)
        ? Promise.resolve(DEMO_PATIENT_SESSION)
        : inner.refresh(refreshToken),
  };
}
