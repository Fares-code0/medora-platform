# Frontend Phase B — Make the Admin Area Honest

> **Historical record — not a task register** (labelled 2026-10-26). This file records a past phase as it was planned and built. Its Status line, task boxes and tables are not kept current, and nothing here is status. Open frontend work is tracked only in [`frontend/FRONTEND_CHECKLIST.md`](../../frontend/FRONTEND_CHECKLIST.md) §13 (doctor/admin web) and [`docs/multi-hospital/CLIENTS_CHECKLIST.md`](../multi-hospital/CLIENTS_CHECKLIST.md) (multi-hospital WEB/PA tasks); backend, database and AI items named here are tracked in those domains' own records. Where this file disagrees with them, they win.

**Original Source:** `frontend/FRONTEND_CHECKLIST.md` §7, Phase B (and §5 "Administration Center")
**Phase family:** lettered checklist phases (see `FE-PHASE-A-STOP-SHIPPING-BLIND.md`)
**Primary Area:** Frontend
**Status:** COMPLETED (frontend); clinic-operations data still mock on `main`
**Depends On:** Phase 17A, Phase 18, Phase 19, Frontend Phase A
**Enables:** Frontend Phase C, Phase 26

---

## Objective

Fix the "admin page has a lot of missing things" problem. Ten of fifteen
administration sections were read-only tables with no actions. The area also ran
its own chrome outside the shared shell.

## Scope

4. AC-19: consolidate onto `AppShell` + `adminNavigation`. This also closed
   AC-17, ADM-11 and D-28.
5. AC-18: split Clinic Overview from Platform Overview. This also closed AC-21
   and AC-22.
6. AC-02…AC-13: CRUD for every admin section.
7. ADM-09: permission-matrix editor (`permissions.ts`, `PermissionMatrixPanel.tsx`,
   unsaved-changes guard, revisioned save).

## Out of Scope

Backend; the Admin Dashboard screens (Phase C).

## Current Status

**COMPLETED** for the frontend. It **supersedes Phase 17A's** layout and routing
decisions.

## Current State

- `frontend/src/features/admin/sections/*`; routes under `/admin/*`.
- The permission matrix is live over `/roles/matrix` (FE-10.10) but blocked on F33
  for live validation.
- Clinic operations (AC-02…AC-13) are mock-store backed. In a live build they say
  "Not connected" (FE-10 Still Mock row 15).
- Carried gaps: the matrix does not drive the live session's permissions
  (`useCan()` reads the issued bundle); custom role creation from a base template
  (§3.9) is not built.

**Transferred:** clinic-operations backend and hospital scoping (realigned 2026-10-07) → **Phase 26**.
Matrix-to-session binding → **Phase 22**.

## Tasks

- [x] [FRONTEND] AC-19, AC-18, AC-02…AC-13, ADM-09
- [ ] [BACKEND] Clinic-operations routes (M23) on `main`, hospital-scoped — Phase 26
- [ ] [BACKEND] Session permissions derived from the matrix (server-side) — Phase 22
- [ ] [FRONTEND] [BACKEND] Custom role from base template (UX §3.9) — Phase 26

## Dependencies

- Depends on: Phases 17A, 18, 19, Frontend Phase A
- Enables: Frontend Phase C, Phase 26

## Files / Areas Affected

`frontend/src/features/admin/**`, `frontend/src/layouts/navigation.ts`

## Acceptance Criteria

Every admin section has its create / edit / deactivate actions. A section with 0
`onClick` or 0 `useMutation` fails (`FRONTEND_CHECKLIST.md` §8 greps). Met.

## Testing

`frontend/src/features/admin/**/*.test.ts(x)`, including `permissions.test.ts`
and `PermissionMatrixPanel.test.tsx`.

## Evidence

`frontend/FRONTEND_CHECKLIST.md` §0 problem 2, §5, §7 Phase B and "Known gaps
carried out of Phase C". Git `63a4233`, `ba88056` ("Phase B: …CRUD").

## Notes / Decisions Required

See Phase 26.
