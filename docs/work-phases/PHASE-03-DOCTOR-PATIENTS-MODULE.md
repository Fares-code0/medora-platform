# Phase 03 — Doctor Patients Module

> **Historical record — not a task register** (labelled 2026-10-26). This file records a past phase as it was planned and built. Its Status line, task boxes and tables are not kept current, and nothing here is status. Open frontend work is tracked only in [`frontend/FRONTEND_CHECKLIST.md`](../../frontend/FRONTEND_CHECKLIST.md) §13 (doctor/admin web) and [`docs/multi-hospital/CLIENTS_CHECKLIST.md`](../multi-hospital/CLIENTS_CHECKLIST.md) (multi-hospital WEB/PA tasks); backend, database and AI items named here are tracked in those domains' own records. Where this file disagrees with them, they win.

**Original Source:** `frontend/PHASE3_PATIENTS_MODULE.md`
**Primary Area:** Frontend
**Status:** COMPLETED — the mock data layer it introduced is superseded by the live API (FE-10.2)
**Depends On:** Phase 02
**Enables:** Phase 04 (profile), Phase 05 (shared patient identity), every module that deep-links `?patient=`

---

## Objective

Build the patients list (UX §2.2, pattern P1) at `/doctor/patients`. URL-owned
search, filters, sort and pagination; summary cards; responsive table → card
list; row actions.

## Scope (original)

- `features/doctor/patients/` with standard feature anatomy.
- URL-param contract `?q=&gender=&ageRange=&…&sort=&page=&pageSize=`.
- 120 seeded deterministic mock patients (`mulberry32`).
- Loading / empty / error / no-match states.

## Out of Scope

Backend, API integration, patient profile (still a placeholder then), add/import/export
(info toasts at the time).

## Current Status

**COMPLETED.** The list exists and is **connected** to `GET /patients` with
server-side condition filtering. Registration is live on `POST /patients`.

## Current State

**Completed work**
- List, filters and URL state as specified.
- Add patient: a real dialog (Stabilization post-16), now live (FE-10.2).
- Export: real CSV/Excel/PDF/print engine (Stabilization post-16, DP-06).

**Superseded**
- The 120-patient generator was cut to 5 canonical patients by Phase 12. It is now
  used only when `VITE_ENABLE_MOCKS` is on. Live builds read the API.
- "Import patients" was removed as a fake affordance (Phase 17B).

**Remaining work**
- Multi-hospital (realigned 2026-10-07, DR-04/DR-05): the list must show only
  patients holding a Medical Record at the doctor's **current hospital**, with
  hospital-aware query keys. (`origin/frontend` API-W02 is the superseded
  organization-scoped form of this contract.)
  See **Phase 25**.

## Tasks

- [x] [FRONTEND] List page, filters, URL state, responsive cards
- [x] [FRONTEND] Live directory and registration (FE-10.2)
- [ ] [FRONTEND] Hospital-scoped directory and query keys — Phase 25
- [ ] [BACKEND] `GET /patients` scoped to the current hospital — Phase 22

## Dependencies

- Depends on: Phase 02
- Enables: Phases 04, 05, 06, 07, 08

## Files / Areas Affected

`frontend/src/features/doctor/patients/**`, `frontend/src/features/shared-domain/patient-identity/**`

## Acceptance Criteria

- Original: list renders, every filter is URL-restorable, and states are wired.
  Met.
- Updated (Phase 25): a patient with a Medical Record only at another hospital
  never appears, except through an explicit cross-hospital grant (Phase 22A).

## Testing

`http-directory.test.ts` (10 tests, FE-10.2) and the patients query-layer
tests from Phase A.

## Evidence

- `frontend/PHASE3_PATIENTS_MODULE.md`
- `docs/FE-10-INTEGRATION-STATUS.md` Connected rows 1–2
- `origin/frontend:frontend/FRONTEND_CHECKLIST.md` §9.1 API-W02

## Notes / Decisions Required

None specific to this phase.
