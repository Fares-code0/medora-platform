# Phase 09 — Authentication

> **Historical record — not a task register** (labelled 2026-10-26). This file records a past phase as it was planned and built. Its Status line, task boxes and tables are not kept current, and nothing here is status. Open frontend work is tracked only in [`frontend/FRONTEND_CHECKLIST.md`](../../frontend/FRONTEND_CHECKLIST.md) §13 (doctor/admin web) and [`docs/multi-hospital/CLIENTS_CHECKLIST.md`](../multi-hospital/CLIENTS_CHECKLIST.md) (multi-hospital WEB/PA tasks); backend, database and AI items named here are tracked in those domains' own records. Where this file disagrees with them, they win.

**Original Source:** `frontend/PHASE9_AUTHENTICATION.md`
**Primary Area:** Frontend (+ Security)
**Status:** COMPLETED — mock authentication superseded by real HTTP auth (A-12); role model needs reassessment for multi-hospital
**Depends On:** Phases 00–02
**Enables:** Phase 19 (guard hardening), Phase 22 (hospital-aware session), FE-10

---

## Objective

Replace the Phase 0 auth placeholders with a full guest experience: login,
signup, forgot/reset password, email verification, OTP (2FA), lock screen,
route guards and idle auto-lock. All of it ran behind a swappable mock auth
service with a stable `AuthProvider` contract.

## Scope (original)

7 auth pages, `RequireGuest` / `RequireAuth` / `RequireRole` /
`RequirePermission` guards, Remember-Me session storage, a 10-minute idle lock,
4 seeded mock accounts, a locale provider with RTL, and social sign-in buttons
(placeholders).

## Out of Scope

Backend, real tokens, real network, PHI in storage, AI.

## Current Status

**COMPLETED.** The `AuthProvider` contract this phase defined survived exactly as
intended: the real backend replaced the mock adapter without page or guard
rewrites. Several original details are superseded (below).

## Current State

**Completed work**
- Real auth: `features/auth/service.ts` selects the mock or HTTP adapter via
  `api/seam.ts`. Verified end to end against the live API, including four
  concurrent 401s collapsing into **one** refresh rotation (A-12).
- Invitation acceptance (`AcceptInvitationPage.tsx`) was added. Registration is
  split by role and administrators are invited (ADR-035).
- `resolveDestination.ts` (role-aware `returnTo`, Phase 19) is unit-tested.

**Superseded**
- Mock session store and "mock token refresh" → httpOnly refresh cookie
  (ADR-011, ADR-013, ADR-026).
- Social sign-in buttons were removed in Phase 19.
- i18n: English-only → five locales (en, ar, tr, fa, fr) with RTL. About 2,045
  strings still await a clinical translator (`docs/handoff/i18n.md`).

**Remaining work**
- Lock screen re-authentication endpoint does not exist (`docs/handoff/auth-seam.md` §4). Owned by **Phase 22**.
- **F33:** the seeded administrator cannot complete TOTP, so no admin feature can
  be validated live (FE-10 Blocked rows 1–9). Owned by **Phase 22**.
- Multi-hospital (realigned 2026-10-07): the session carries the doctor's
  **current hospital**, derived from the active employment (DR-02). There is
  **no hospital switch** (DR-08), so the 2026-10-06 `activeOrganization` /
  `memberships` / switch-route plan (API-W01) is superseded. Admin roles
  are Platform Admin + Hospital Admin (OD-07, final). Existing admin accounts
  are mapped deliberately during migration. Owned by **Phases 21, 22, 25 and 26**.

## Tasks

- [x] [FRONTEND] Auth pages, guards, idle lock, locale provider
- [x] [FRONTEND] [BACKEND] Real auth seam and refresh (A-12)
- [ ] [BACKEND] Re-authentication endpoint for the lock screen — Phase 22
- [ ] [BACKEND] Fix F33 (admin TOTP in seed/dev) — Phase 22
- [ ] [BACKEND] Hospital-aware session (current hospital from employment) — Phase 22
- [ ] [FRONTEND] Role guards for doctor, Hospital Admin and Platform Admin (OD-07); **no** hospital switcher — Phases 25, 26

## Dependencies

- Depends on: Phases 00–02
- Enables: Phases 19, 22, 25

## Files / Areas Affected

`frontend/src/features/auth/**`, `frontend/src/app/providers/AuthProvider.tsx`,
`frontend/src/app/router/guards.tsx`, `frontend/src/api/endpoints/auth*.ts`,
`backend/src/modules/auth/**`

## Acceptance Criteria

- Original: every flow works against mocks, including lock and 2FA. Met.
- Updated: every flow works against the live API. Met for doctors; blocked for
  admins (F33).

## Testing

`auth.test.ts`, `auth-refresh.test.ts`, `resolveDestination.test.ts`, guard
tests (Phase A).

## Evidence

- `frontend/PHASE9_AUTHENTICATION.md`
- `frontend/FRONTEND_CHECKLIST.md` A-12, §9 row 2
- `docs/FE-10-INTEGRATION-STATUS.md` Blocked rows 1–9 (F33)
- `docs/DECISIONS.md` ADR-011, ADR-013, ADR-026, ADR-030, ADR-034, ADR-035

## Notes / Decisions Required

- None open. Admin vocabulary is final: Platform Admin + Hospital Admin (OD-07,
  `docs/multi-hospital/OWNER_DECISIONS.md`).
