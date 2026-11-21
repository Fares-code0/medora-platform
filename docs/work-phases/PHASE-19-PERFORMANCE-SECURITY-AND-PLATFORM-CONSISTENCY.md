# Phase 19 — Performance, Authentication & Platform Consistency

> **Historical record — not a task register** (labelled 2026-10-26). This file records a past phase as it was planned and built. Its Status line, task boxes and tables are not kept current, and nothing here is status. Open frontend work is tracked only in [`frontend/FRONTEND_CHECKLIST.md`](../../frontend/FRONTEND_CHECKLIST.md) §13 (doctor/admin web) and [`docs/multi-hospital/CLIENTS_CHECKLIST.md`](../multi-hospital/CLIENTS_CHECKLIST.md) (multi-hospital WEB/PA tasks); backend, database and AI items named here are tracked in those domains' own records. Where this file disagrees with them, they win.

**Original Source:** `frontend/PHASE19_PERFORMANCE_SECURITY_AND_PLATFORM_CONSISTENCY.md`
**Audited build:** `f68366c` ("Phase 19 — Performance, Security & Platform
Consistency", per the `frontend/FRONTEND_CHECKLIST.md` header, audited
2026-08-09). It was built in a local repository on
`claude/doctor-lab-system-phase-7-c1f15a` and imported here in merge `ff5900e`
(2026-08-10).
**Primary Area:** Frontend (Performance + Security)
**Status:** COMPLETED — the performance and security work stands; two of its structural choices were superseded; its two-role guard model needs reassessment for multi-hospital (DR-02, DR-05, DR-08; OD-07)
**Depends On:** Phases 09, 11, 15, 17A, 18
**Enables:** Frontend Phase A (the checklist audit started from this build), Phase 22, Phase 25

---

## Objective

Harden the platform rather than extend it:

- shrink the entry bundle
- make the Administration Center strictly admin-only
- remove consumer OAuth placeholders from login
- reuse the doctor header and settings verbatim in the admin shell
- make the notification bell real in both shells
- fix the "admin walks through a 403" login bug

## Scope (original)

- framer-motion → `LazyMotion` with an async `motion-features.ts` chunk.
- Mock services dynamically imported.
- Entry chunk 165.63 → 127.77 kB gzip (−22.9%).
- `/doctor/administration/*` under `RequireRole admin`.
- Open-redirect hardening and role-aware `returnTo`.
- Mock token refresh.
- Header and settings parity.

## Out of Scope

Backend, new features.

## Current Status

**COMPLETED.** Each listed change was verified in the browser at the time and
the gates were green. Current repository state:

**Still in force**
- `LazyMotion` (`app/providers/MotionProvider.tsx`). DX-06 measured the async
  `motion-features` chunk again on 2026-08-25.
- Role-aware `returnTo`: `features/auth/pages/resolveDestination.ts` with tests.
- No social sign-in.
- Shared `NotificationButton` / `AvatarMenu` across shells.
- The admin mounts the doctor settings center (now `/admin/preferences/:section`).

**Superseded**
- *Admin area as `/doctor/administration/*`.* Frontend Phase B (AC-19) moved it
  onto `AppShell` at `/admin/*`. The old path survives only as a legacy redirect.
- *Mock token refresh (`refreshSession()`).* Replaced by real refresh rotation
  over the httpOnly cookie (A-12, ADR-026).
- *Notification bell drawer.* An anchored popover since PR #40.

**Needs reassessment**
- The route-guard table assumes exactly two roles (`doctor`, `admin`). The
  owner's multi-hospital decisions (2026-10-06, clarified 2026-10-07) need
  hospital-scoped authorization. Doctors are bound to one current hospital with
  no switcher (DR-02/DR-08); a Hospital Admin approves cross-hospital requests
  (DR-06); the hierarchy is Platform Admin + Hospital Admin (OD-07, final).
  Owned by **Phases 22, 25 and 26**.

## Tasks

- [x] [FRONTEND] Bundle reduction (LazyMotion, async mock services)
- [x] [FRONTEND] Admin-only administration, open-redirect + role-aware returnTo
- [x] [FRONTEND] Header/settings/notification parity across shells
- [ ] [BACKEND] Session exposes the current hospital and admin scope (Platform Admin / Hospital Admin, OD-07) — Phase 22
- [ ] [FRONTEND] Hospital-aware guard table and navigation — Phases 25, 26

## Dependencies

- Depends on: Phases 09, 11, 15, 17A, 18
- Enables: Frontend Phase A, Phases 22, 25

## Files / Areas Affected

`frontend/src/app/providers/{MotionProvider.tsx,motion-features.ts,AuthProvider.tsx}`,
`frontend/src/app/router/{index.tsx,guards.tsx,ShellBadgesProvider.tsx}`,
`frontend/src/features/auth/pages/{LoginPage.tsx,resolveDestination.ts}`,
`frontend/src/layouts/**`

## Acceptance Criteria

- Original: a doctor deep-linking an admin URL gets 403; admin login lands
  directly in admin; the entry chunk shrinks. Met.
- Updated (Phases 25–26): a Hospital Admin cannot reach another hospital or
  platform routes. A Platform Admin has no automatic clinical access (OD-07).

## Testing

`resolveDestination.test.ts`, the Phase A guard tests (all 5 branches × 4
guards), `features/admin/routes.test.tsx`.

## Evidence

- `frontend/PHASE19_PERFORMANCE_SECURITY_AND_PLATFORM_CONSISTENCY.md`
- `frontend/FRONTEND_CHECKLIST.md` header (`f68366c`), §7 Phase B (AC-19), §10.1 DX-06
- `frontend/src/app/router/index.tsx` (`routes.legacy.administrationRoot`)
- `origin/frontend:frontend/FRONTEND_CHECKLIST.md` A-08 realignment note

## Notes / Decisions Required

- The phase count stopped here. Later frontend work was tracked as lettered
  phases (A–F) and FE-10, not as Phase 20+. See `README.md` and the `FE-PHASE-*`
  files. Phases 20+ in this folder are **new, audit-derived** phases.
