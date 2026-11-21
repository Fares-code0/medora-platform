# The mock → HTTP seam, and the auth slice of it

**Status:** the auth seam ships. It is the template for the other twelve
features (FRONTEND_CHECKLIST §6 DP-04).
**Scope of this document:** the pattern to copy, and every place the
backend contract and the frontend mock disagreed.

---

## 1. The pattern

One feature, one port, two adapters, one selection.

```text
             features/<x>/service.ts          ← the ONLY module the feature imports
                      │  selectService({ mock, http })
        ┌─────────────┴─────────────┐
  mock/mock-x-service.ts      api/endpoints/x.ts
        └─────────────┬─────────────┘
              types/<x>/x-service.ts           ← the port, typed from the BACKEND
```

| File | Role |
| --- | --- |
| `src/types/<x>/<x>-service.ts` | The port. Every shape transcribed from the backend DTOs. |
| `src/features/<x>/mock/mock-<x>-service.ts` | The mock adapter. |
| `src/api/endpoints/<x>.ts` | The HTTP adapter, on `ApiClient`. |
| `src/features/<x>/service.ts` | `export const xService = selectService({ mock, http })`. |
| `src/api/seam.ts` | `selectService` — **the only place `env.enableMocks` is read.** |

Five rules, each of which the auth slice had to learn the hard way:

1. **The port lives in `types/`, not in the feature.** The HTTP adapter is
   `api/endpoints/<x>.ts`, and `import/no-restricted-paths` forbids a
   platform layer (`src/api`) from importing a feature. A port under
   `features/` cannot be implemented by the adapter that needs it.
2. **Type the port from the backend, not from the mock.** Where they
   disagree the backend wins and the mock adapts — a mock shaped like the
   fake backend is one you rewrite on integration day.
3. **Nothing downstream may import an adapter.** `AuthProvider` importing
   `mock/mock-auth-service` directly is exactly the defect this removes.
4. **Import both adapters unconditionally.** Both then typecheck on every
   build, so neither rots behind the flag. A feature test asserts the two
   expose the same key set, because a method added to one and forgotten on
   the other is what typecheck alone will not catch.
5. **Read the flag once.** A feature that branches on `env.enableMocks`
   itself has two seams that can disagree.

## 2. Contract mismatches found (frontend fixed, backend unchanged)

Every row was verified against the API running locally, not read off the
source. `#` marks the ones that would have failed silently.

| # | Backend | Frontend before | Resolution |
| - | --- | --- | --- |
| 1 | Served at `/api/v1`; refresh cookie scoped `Path=/api/v1/auth` | `VITE_API_BASE_URL=…/api` | **#** Base URL corrected in `.env.example` and in `env.ts`'s default. With `/api` the cookie is never attached and silent refresh fails for every user with no error anywhere. |
| 2 | Every 2xx body is `{ data: … }` | `ApiClient` returns the raw body; `client.test.ts` asserts raw bodies | Unwrapped in `api/endpoints/auth.ts`, not in the shared transport — changing `ApiClient` would break every other feature's fixtures at once. |
| 3 | `email_unverified` is **403** | `normalizeHttpError` maps 403 → `kind: 'forbidden'`, dropping the code | **#** `ApiError` now carries the envelope's `code`. By status alone this failure is indistinguishable from every permission denial in the app, and the login page would show a generic error instead of routing to verify-email. |
| 4 | A 2FA login is a **success**: 200 `{ requiresOtp: true, otpToken }`, no cookie | Mock threw `otp_required` | `login` returns a `LoginOutcome`; `AuthProvider` converts the OTP branch into the thrown code the pages already branch on, and keeps the `otpToken`. |
| 5 | `POST /auth/otp/verify` needs `{ otpToken, code }` | `verifyOtp(code)` | The pending sign-in now carries the challenge handle. |
| 6 | `POST /auth/otp/resend` needs `{ otpToken }` | `resendOtp()` | Same handle. |
| 7 | `POST /auth/verification/resend` needs `{ email }` | `resendVerification()` | Takes the pending address. |
| 8 | `register` requires `acceptTerms`/`acceptPrivacy` as `z.literal(true)` | Mock's `RegisterInput` had neither | Added and sent. `users.terms_accepted_at` is NOT NULL, so a registration without them cannot be stored — this would have 422'd on the first real signup. |
| 9 | `login` accepts `rememberMe`, which picks the refresh TTL (30 d / 12 h) | Not sent | Sent. On the mock path it still picks the storage medium. |
| 10 | `verify-email` returns 204 and does **not** sign you in | Mock signed the user straight in | The port returns `AuthSession | null`; only the mock returns a session. The page's "Continue to sign in" state was already built for this. |
| 11 | `user.role`/`permissions` are loose strings; 22 permissions seeded, 21 in the UI union | Assumed the frontend unions | Unknown permissions are dropped (a capability the UI cannot render is a feature not yet shipped); an unknown **role** is fatal, since the whole route tree is selected by it. |
| 12 | Demo seeds carry **no password hash** (DB §14.5-15) | Login page advertises `doctor@medora.health` / `Medora123!` | The demo hint is now shown only when mocks are on. Against the live API those accounts exist but cannot be signed into — you must register. |

## 3. What stays on the mock path, and why

Nothing here is stubbed as a fake HTTP call.

- **Everything except auth.** The API implements auth, `/health`,
  `/ready`, `/me/2fa/*` and `/me/password` — and nothing else. All twelve
  other features still resolve mock data; that is DP-02, not this slice.
- **Idle auto-lock (A-11).** A pure client concern, and it stays in
  `AuthProvider` on both paths. The server's own session timeout is a
  separate, longer clock.

## 4. Asks for the backend

1. **A re-authentication endpoint** for the lock screen (A-07). There is
   none, so the HTTP adapter spends a real `POST /auth/login` — a true
   password check, but it mints a *second* session, and the one the lock
   screen interrupted stays live until its TTL expires. A
   `POST /me/password/verify` returning 204 would fix both. Related: an
   account with 2FA **cannot unlock in place** today, because login
   answers with a challenge and the lock screen has no field for a code.
   **Answered on `backend` (`4c6458d9`, 2026-11-05):** `POST /me/password/verify`
   exists as asked, shares sign-in's lockout, and revokes the session on the
   guess that locks the account. The web client uses it since
   `FRONTEND_CHECKLIST.md` §38.2 and falls back to the login spend only on a 404.
2. **Confirm the intended `Retry-After` contract on `otp/resend`** — the
   UI currently restarts its own 30 s countdown and only learns the real
   cooldown from a 429.

## 5. The refresh path — why single-flight is load-bearing

`ApiClient` already shared one refresh promise across concurrent 401s.
Against this backend that guarantee stops being an optimization:

- every refresh **rotates** the token, and
- the session row keeps one generation back, so re-presenting the retired
  token is treated as **theft and revokes the whole family**.

Verified directly: refreshing with a rotated-out token 401s *and* kills
the token that replaced it. So a second concurrent refresh does not waste
a request — it logs the user out.

Two consequences in the code:

- **`restore()` is itself single-flight.** React `StrictMode`
  double-invokes the provider's boot effect, which fired two concurrent
  refreshes per page load — observed against the live API before the
  guard existed.
- **The refresh call uses a second, handler-free `ApiClient`.** Routing it
  through the shared client would let its own 401 re-enter the
  single-flight helper and await the promise it is itself the body of —
  a hung boot screen that no timeout would ever clear.
