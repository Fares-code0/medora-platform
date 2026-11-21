# Phase 17A — Doctor Administration Center

> **Historical record — not a task register** (labelled 2026-10-26). This file records a past phase as it was planned and built. Its Status line, task boxes and tables are not kept current, and nothing here is status. Open frontend work is tracked only in [`frontend/FRONTEND_CHECKLIST.md`](../../frontend/FRONTEND_CHECKLIST.md) §13 (doctor/admin web) and [`docs/multi-hospital/CLIENTS_CHECKLIST.md`](../multi-hospital/CLIENTS_CHECKLIST.md) (multi-hospital WEB/PA tasks); backend, database and AI items named here are tracked in those domains' own records. Where this file disagrees with them, they win.

**Original Source:** `frontend/PHASE17_DOCTOR_ADMINISTRATION_CENTER.md`
**Numbering note:** two files claim "Phase 17". This one (clinic administration)
is `17A`. `PHASE17_STABILIZATION_AND_SETTINGS_COMPLETION.md` is `17B`. Neither
source states which came first. Both landed on the same branch before Phase 18,
which extends this one.
**Primary Area:** Frontend
**Status:** SUPERSEDED — relocated and rebuilt by Phase 19 and Frontend Phase B; the clinic-operations data still has no backend; the multi-hospital model splits it again
**Superseded by:** Phase 19 (admin-only), Frontend Phase B (AC-17…AC-22: consolidated onto `AppShell`, CRUD added, moved to `/admin/clinic`), Phase 26 (hospital administration)
**Depends On:** Phases 01, 02, 09
**Enables:** Phase 18

---

## Objective

Give the doctor a self-contained clinic-management environment at
`/doctor/administration`. It had its own rail and command bar and covered 13
sections: overview, queue, waiting room, staff, departments, shifts, schedule,
holidays, rooms, resources, announcements, policies, document templates.

## Scope (original)

`features/doctor/administration/` with feature-local console primitives
(`Panel`, `MetricTile`, `DataGrid`…). One TanStack Query hook per dataset over a
read-only mock API (max 5 rows each). Writes existed only for announcements and
templates, in component state. The route was mounted **outside** `AppShell`,
behind `RequireRole('doctor')`.

## Out of Scope

Backend, write endpoints, shared platform chrome (deliberately not reused).

## Current Status

**SUPERSEDED.** The phase completed as written. Its design decisions were then
reversed by later phases on purpose:

| Original decision | What replaced it |
|---|---|
| Doctor-owned, under `RequireRole('doctor')` | **Admin-only** (Phase 19) |
| Own chrome, outside `AppShell` | Consolidated onto `AppShell` + `adminNavigation` (Phase B, AC-19) |
| `/doctor/administration/*` | `/admin/clinic` + `/admin/{queue,waiting-room,staff,…}`. The legacy path is kept only as a redirect (`routes.legacy.administrationRoot`) |
| 10 of 13 sections read-only | CRUD for every section (Phase B, AC-02…AC-13) |
| Doctor's own clinic view | A doctor-scoped read-only board at `/doctor/my-clinic` (D-27b) |

`frontend/src/features/doctor/administration/` **no longer exists**. The sections
live in `frontend/src/features/admin/sections/`.

## Current State

**Transferred, unfinished work**
- **No backend for clinic operations on `main`.** The 13 sections and
  `/doctor/my-clinic` render "Not connected" in live builds (FE-10 Still Mock
  rows 3, 14, 15). An `administration` module (M23) exists on the `backend`
  branch, single-tenant.
- **Multi-hospital (realigned 2026-10-07):** clinic operations become
  **hospital administration** sections scoped to one hospital (DR-01). Opening
  hours and holidays become hospital data, with Clinic and Location as
  subdivisions (multiple Locations per hospital, OD-06 final). Admin roles are
  Platform Admin + Hospital Admin (OD-07 final). Owned by **Phase 26**.

## Tasks

- [x] [FRONTEND] 13 sections, rail, command bar, global search (original)
- [x] [FRONTEND] Relocation, consolidation and CRUD (Phase 19, Phase B)
- [ ] [BACKEND] M23 administration routes on `main`, scoped by hospital — Phase 26
- [ ] [FRONTEND] Hospital-scoped administration sections (no doctor switcher; Hospital Admin scope, OD-07) — Phase 26

## Dependencies

- Depends on: Phases 01, 02, 09
- Enables: Phase 18, Frontend Phase B, Phase 26

## Files / Areas Affected

Originally `frontend/src/features/doctor/administration/**` (deleted). Now
`frontend/src/features/admin/sections/**`, `frontend/src/features/doctor/clinic/**`,
`backend/src/modules/administration/**` (on `backend`).

## Acceptance Criteria

- Original: all 13 sections render with filters and search. Met at the time.
- Updated (Phase 26): a Hospital Admin sees and edits only their own
  hospital's operations; a doctor sees their board for the current hospital.

## Testing

Admin section tests under `frontend/src/features/admin/**`, e.g.
`administration.meta.test.ts`, `routes.test.tsx`.

## Evidence

- `frontend/PHASE17_DOCTOR_ADMINISTRATION_CENTER.md`
- `frontend/PHASE19_PERFORMANCE_SECURITY_AND_PLATFORM_CONSISTENCY.md` (Security Improvements)
- `frontend/FRONTEND_CHECKLIST.md` §0 problem 2, §5, §7 Phase B
- `ls frontend/src/features/doctor` (no `administration/`), `ls frontend/src/features/admin/sections`
- `docs/FE-10-INTEGRATION-STATUS.md` Still Mock rows 3, 14, 15
- `origin/frontend:frontend/FRONTEND_CHECKLIST.md` D-27b note, ORG-02

## Notes / Decisions Required

- Which clinic-operations sections are per Location or per Clinic is an
  implementation design choice under OD-06 (final: Clinic is a separate entity,
  multiple Locations).
