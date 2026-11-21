# Phase 02 — Doctor Dashboard Shell & Overview

> **Historical record — not a task register** (labelled 2026-10-26). This file records a past phase as it was planned and built. Its Status line, task boxes and tables are not kept current, and nothing here is status. Open frontend work is tracked only in [`frontend/FRONTEND_CHECKLIST.md`](../../frontend/FRONTEND_CHECKLIST.md) §13 (doctor/admin web) and [`docs/multi-hospital/CLIENTS_CHECKLIST.md`](../multi-hospital/CLIENTS_CHECKLIST.md) (multi-hospital WEB/PA tasks); backend, database and AI items named here are tracked in those domains' own records. Where this file disagrees with them, they win.

**Original Source:** `frontend/PHASE2_DOCTOR_DASHBOARD.md`
**Primary Area:** Frontend
**Status:** COMPLETED (original scope) — shell and Overview later reworked by Frontend Phase F (F1) and connected by FE-10.4
**Depends On:** Phase 00, Phase 01
**Enables:** Phases 03–19 (every doctor feature mounts inside this shell)

---

## Objective

Deliver the doctor app shell (sidebar, navbar, breadcrumbs, bottom tab bar,
mobile drawer, responsive switching) and the Overview page (UX §2.1) on mock
data. Every other doctor section rendered an honest in-shell placeholder.

## Scope (original)

- `layouts/AppShell.tsx`, `navigation.ts` (menu as data, permission-filtered),
  `AppSidebar`, `AppNavbar`, `AppBreadcrumb`, `GlobalSearch` (field only),
  `NotificationButton`, `AvatarMenu`, `BottomTabBar`, `MobileNavDrawer`.
- Overview: welcome header, 4 KPI widgets, today's schedule, notifications
  widget, statistic cards, two chart placeholders, recent activity, quick
  actions, AI widget placeholder.
- `/doctor` → `/doctor/overview`, lazy feature chunk.

## Out of Scope

Every other doctor module, admin dashboard, authentication, backend, API
integration, business logic. The inline accept/reject decision flows were
deferred to the appointments work.

## Current Status

**COMPLETED** for the original scope. The phase's own mock-era placeholders were
all replaced later, by named phases:

| Phase 02 placeholder | Replaced by |
|---|---|
| Mock doctor session in `AuthProvider` | Phase 09 (mock auth), then A-12 / FE-10 (real auth) |
| `shell-mock.ts` badge counts + bell feed | Phase 11 (`ShellBadgesProvider`), then FE-10.8 (`GET /notifications/badge-counts`) |
| Overview fixtures | FE-10.4 (`GET /appointments/summary`, `/dashboard/doctor/action-queue`, …) |
| Chart placeholder widgets | Phase 17B (shared `components/charts/`) |
| Disabled "Help" sidebar item | Phase 17B (→ Settings › About) |
| Section placeholders | Phases 03–16 |

## Current State

**Completed work**
- `frontend/src/layouts/` shell and `features/doctor/dashboard/` exist. The
  Overview was rebuilt "decisions first" by DX-01 (2.61 → 1.43 screens at
  1280×720) and connected to live endpoints by FE-10.4.

**Remaining work (owned elsewhere)**
- Four Overview widgets (practice pulse, trend, satisfaction, recent activity)
  are still **mock**: there is no server source (backend M27). Owned by **Phase 29**.
- The Overview's Anatomy widget was removed with the Anatomy feature
  (2026-10-04, PR #37).
- Multi-hospital (realigned 2026-10-07, DR-02/DR-08): the shell must name the
  doctor's **current hospital** (from current employment). There is **no hospital
  switcher**. The 2026-10-06 ORG-01 switcher plan is superseded. Owned by **Phase 25**.

## Tasks

- [x] [FRONTEND] App shell, navigation config, responsive switching
- [x] [FRONTEND] Overview composition on mock data
- [x] [FRONTEND] Live Overview KPIs/decision list (FE-10.4)
- [ ] [BACKEND] Dashboard composites for practice pulse / trend / satisfaction / activity (M27) — see Phase 29
- [ ] [FRONTEND] Current-hospital name in the shell, no switcher (DR-08) — see Phase 25

## Dependencies

- Depends on: Phase 00, Phase 01
- Enables: Phases 03–19

## Files / Areas Affected

`frontend/src/layouts/**`, `frontend/src/features/doctor/dashboard/**`,
`frontend/src/app/router/index.tsx`

## Acceptance Criteria

- Original: navigable shell at all breakpoints. Overview renders as its own lazy
  chunk; typecheck/lint/build green. Met.

## Testing

Original: typecheck, lint, build. Current: `http-dashboard-service.test.ts`
(7 tests, FE-10.4) plus shell/router tests.

## Evidence

- `frontend/PHASE2_DOCTOR_DASHBOARD.md` §2 (placeholder table)
- `docs/FE-10-INTEGRATION-STATUS.md` (Connected row 7; Still Mock row 2)
- `frontend/FRONTEND_CHECKLIST.md` §10.1 DX-01, DX-06
- Git: `f4c8a5d` (Anatomy dropped), `d515a04` (FE-10.4)

## Notes / Decisions Required

None specific to this phase.
