# Phase 9 — Authentication

Frontend-only, enterprise-grade authentication for Medora, implemented as Phase 9 **inside
the same unified codebase** as Phases 0–8 (same repository, same branch, alongside
`PHASE8_PHARMACY_SYSTEM.md`). **Realistic mock auth — no backend, no network, no real
tokens, no PHI in storage.** Built entirely from the Phase 1 component library; redesigns
nothing in the four FINAL docs (DESIGN_SYSTEM, UX_ARCHITECTURE, FRONTEND_ARCHITECTURE,
COMPONENT_LIBRARY).

This module replaces the Phase-0 auth placeholders (login / session-locked) with the real
guest experience and wires them to a swappable mock auth service.

## Routes

| Path | Guard | Page |
| --- | --- | --- |
| `/login` | RequireGuest → AuthLayout | `LoginPage` |
| `/signup` | RequireGuest → AuthLayout | `SignupPage` |
| `/forgot-password` | RequireGuest → AuthLayout | `ForgotPasswordPage` |
| `/reset-password` | RequireGuest → AuthLayout | `ResetPasswordPage` |
| `/verify-email` | RequireGuest → AuthLayout | `VerifyEmailPage` |
| `/verify-otp` | RequireGuest → AuthLayout | `VerifyOtpPage` |
| `/lock-screen` | standalone | `LockScreenPage` |
| `/403` · `/404` · `*` | — | existing `ForbiddenPage` / `NotFoundPage` |
| `/doctor/*` · `/admin/*` | RequireAuth → RequireRole | Phase 2–8 feature areas |

Auth pages are code-split via `React.lazy` in `routes.tsx` (one chunk each) inside a
`Suspense` boundary. The subtree is spread into the app router as `authRoutes`
(`src/app/router/index.tsx`), and `routes/index.ts` gained `signup`, `verifyEmail`,
`verifyOtp`, `notFound`, and renamed `sessionLocked` → `lockScreen` (`/lock-screen`).

## Folder structure

```
src/features/auth/
├── index.ts                       # public surface: authRoutes, LocaleProvider/useLocale
├── routes.tsx                     # lazy route subtree (guest branch + lock screen)
├── i18n/
│   ├── dictionary.ts              # typed keys; English populated, extensible
│   ├── LocaleProvider.tsx         # persists locale, reflects <html lang>/dir (incl. RTL)
│   └── useT.ts                    # t(key) with English fallback
├── mock/
│   ├── types.ts                   # MockAuthError + codes, MockUserRecord, RegisterInput
│   ├── users.ts                   # 4 seeded accounts, findUser, toSessionUser
│   ├── delay.ts                   # withLatency / rejectWithLatency (400–900 ms)
│   ├── session-store.ts           # remember-me-aware mock session (local/sessionStorage)
│   └── mock-auth-service.ts       # the swappable "backend" (stateless async ops)
├── schemas/
│   ├── password.ts                # shared strong-password policy + checks
│   └── login.ts signup.ts forgot.ts reset.ts otp.ts
├── components/
│   ├── MedoraLogo.tsx AuthCard.tsx AuthFooter.tsx AuthFallback.tsx AuthFormError.tsx
│   ├── SocialButtons.tsx LanguageSelector.tsx AuthThemeToggle.tsx
│   ├── PasswordStrengthMeter.tsx password-strength.ts
│   ├── OtpInput.tsx Countdown.tsx useCountdown.ts
│   └── index.ts
├── layout/
│   ├── AuthLayout.tsx             # two-column split (brand + content)
│   └── BrandPanel.tsx             # illustration, welcome, benefits, security badge
└── pages/
    ├── LoginPage.tsx SignupPage.tsx ForgotPasswordPage.tsx ResetPasswordPage.tsx
    └── VerifyEmailPage.tsx VerifyOtpPage.tsx LockScreenPage.tsx
```

**Touched outside the feature (integration points, additive & backward-compatible):**

- `src/routes/index.ts` — added `signup`, `verifyEmail`, `verifyOtp`, `notFound`; renamed
  `sessionLocked` → `lockScreen`.
- `src/app/router/guards.tsx` — added `RequireGuest`; retargeted the locked redirect.
- `src/app/router/index.tsx` — mounts `authRoutes`; explicit `/404`.
- `src/app/router/placeholders.tsx` — removed the login/session-locked placeholders.
- `src/app/providers/AuthProvider.tsx` — real mock implementation (see Architecture).
- `src/app/providers/index.tsx` — mounts `LocaleProvider` outermost.
- `src/services/preferences.ts` — added the global `locale` preference.
- `eslint.config.js` — ignore nested `.claude/` worktrees when linting this checkout.

## Architecture

`AuthProvider` (`src/app/providers/AuthProvider.tsx`) is the single source of auth state and
the stable contract every consumer depends on. It replaces the Phase-0 placeholder while
keeping `login/logout/lock/unlock`, `useCan`, and `useHasRole` **signature-compatible**, so
the route guards were untouched apart from the additive `RequireGuest`.

```ts
interface AuthContextValue {
  status: 'booting' | 'authenticated' | 'unauthenticated' | 'locked';
  user: SessionUser | null;
  login(email, password, opts?: { rememberMe?: boolean }): Promise<void>;
  logout(): Promise<void>;
  lock(): void;
  unlock(password: string): Promise<void>;
  register(input): Promise<{ nextStep: 'verify-email'; email: string }>;
  forgotPassword(email): Promise<void>;
  resetPassword(token, password): Promise<void>;
  verifyEmail(token): Promise<void>;
  verifyOtp(code): Promise<void>;
  resendOtp(): Promise<void>;
  resendVerification(): Promise<void>;
}
```

- **Boot:** `status='booting'` → `readSession()` → `authenticated` (valid persisted session)
  or `unauthenticated` — the stand-in for a real silent-refresh call.
- **Provider order:** `LocaleProvider → ThemeProvider → QueryProvider → AuthProvider →
  MotionProvider → ToastProvider`. Locale/Theme sit outside auth so the login surface can
  localize and theme before sign-in.
- **Interrupted sign-in (2FA / unverified email):** `login` throws `otp_required` or
  `email_unverified`; the provider stashes the in-flight attempt and the login page routes to
  `/verify-otp` or `/verify-email`. When verification then succeeds, the provider
  **finalizes** the pending sign-in (creates the session) so the user lands in their
  workspace without re-entering credentials.
- **Route protection** (`src/app/router/guards.tsx`, UX-only — the server re-enforces every
  rule): `RequireGuest` (authenticated → role dashboard), `RequireAuth` (unauthenticated →
  `/login?returnTo=…`; locked → `/lock-screen`), `RequireRole` (wrong role → in-place 403),
  `RequirePermission` (capability gate via `useCan`).
- **Session (UI):** Remember Me selects the storage medium; boot rehydrates; an idle timer
  (`configs/session.ts → sessionPolicy.idleLockMs`, default 10 min) auto-locks; the lock
  screen re-authenticates via `unlock(password)`; logout clears the session store **and** the
  user's namespaced UI preferences.
- **Validation / a11y / responsive / theme / i18n:** React Hook Form + Zod; inline field
  errors + `AuthFormError` (`role="alert"`); WCAG-AA labelled fields and a 6-cell OTP group
  with arrow/backspace/paste/auto-submit; two-column split on `lg+` collapsing to a centered
  card; token-driven light/dark/system toggle; functional language selector persisting a
  global `locale` and reflecting `<html lang>`/`dir` (incl. RTL), English fully translated
  with English fallback for other locales.

## Components used (existing library only)

`Button`, `LinkButton`, `IconButton`, `Input`, `PasswordInput`, `Checkbox`, `Select`,
`Card`, `Alert`, `Divider`, `Spinner`, `Tooltip`, `Dropdown`, plus `ContentHeader` /
`PageContainer` / `Stack` layout primitives and the `ThemeProvider` / `ToastProvider` /
`useDisclosure` hooks. Auth-specific compositions (`AuthCard`, `AuthLayout`, `BrandPanel`,
`OtpInput`, `PasswordStrengthMeter`, `MedoraLogo`, …) are thin arrangements of those
primitives — no new design-system components, no inline styles, no hardcoded colors.

## Mock data model

`mock/mock-auth-service.ts` is stateless and async with realistic latency (400–900 ms),
mapping 1:1 onto future HTTP endpoints. Failures throw a typed `MockAuthError` with a `code`:
`invalid_credentials · email_unverified · otp_required · otp_invalid · email_taken ·
token_invalid · weak_password · rate_limited`.

### Seeded accounts (password `Medora123!`)

| Email | Role | Behaviour |
| --- | --- | --- |
| `doctor@medora.health` | doctor | normal sign-in → Doctor workspace |
| `admin@medora.health` | admin | normal sign-in → Admin workspace |
| `unverified@medora.health` | doctor | `email_unverified` → `/verify-email` |
| `secure@medora.health` | doctor | `otp_required` → `/verify-otp` (code `123456`) |
| any other email / wrong password | — | `invalid_credentials` |

The login page shows these in a dismissible "Demo credentials" hint. Other rules: `register`
rejects seeded emails with `email_taken`; `forgotPassword` always resolves (anti-enumeration);
`resetPassword`/`verifyEmail` reject only the literal token `invalid`; `verifyOtp` accepts
only `123456`. `session-store.ts` persists a **mock** payload `{ token, user, exp, rememberMe }`
(no PHI, no real credentials) — Remember Me → `localStorage` (30-day expiry), otherwise
`sessionStorage` (12-hour, dies with the tab); `readSession` validates expiry.

## Future API integration points

The public `AuthProvider` interface is the stable contract — pages and guards do **not**
change when the backend arrives.

| Seam | Today | Later phase |
| --- | --- | --- |
| `mock/mock-auth-service.ts` | Stateless async ops with typed `MockAuthError` | Real API client with the same signatures (or map server errors onto the codes) |
| `mock/session-store.ts` | `localStorage`/`sessionStorage` mock payload | httpOnly-cookie / refresh-token semantics; boot becomes a silent-refresh request |
| OTP / email verification | `123456` / literal `invalid` stubs | Server challenges; the pending-sign-in finalize logic already models two-step completion |
| Permissions | Seeded bundles in `mock/users.ts` | Server-provided claims on the session payload; `useCan`/`RequirePermission` already consume them |
| i18n | `i18n/dictionary.ts` (English) | Populate additional locales or swap the dictionary behind `useT`; `SUPPORTED_LOCALES` drives the selector |

## Verification

No test runner is configured; the quality gate is `npm run typecheck` + `npm run lint`
(0 errors; pre-existing react-refresh warnings accepted) + `npm run build`, all green on the
unified Phases 0–9 branch. Flows were additionally driven in the browser: doctor/admin
sign-in and role routing, invalid credentials, 2FA OTP (paste + auto-submit), guest redirect,
lock → invalid/valid unlock, logout, `/404`, signup with the live strength meter,
forgot-password success, and theme + language persistence across light/dark and LTR/RTL.

## Out of scope (per Phase 9 brief)

No backend, no real network calls, no real tokens or credentials, no PHI in storage. Social
sign-in buttons are non-functional placeholders. AI logic is not implemented.
