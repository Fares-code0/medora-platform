# Phase 16A — Stabilization Pass (Post Phase 16)

> **Historical record — not a task register** (labelled 2026-10-26). This file records a past phase as it was planned and built. Its Status line, task boxes and tables are not kept current, and nothing here is status. Open frontend work is tracked only in [`frontend/FRONTEND_CHECKLIST.md`](../../frontend/FRONTEND_CHECKLIST.md) §13 (doctor/admin web) and [`docs/multi-hospital/CLIENTS_CHECKLIST.md`](../multi-hospital/CLIENTS_CHECKLIST.md) (multi-hospital WEB/PA tasks); backend, database and AI items named here are tracked in those domains' own records. Where this file disagrees with them, they win.

**Original Source:** `frontend/STABILIZATION_POST_PHASE16.md`
**Numbering note:** the source says "No redesign, no new phase". It is an
unnumbered pass between Phase 16 and Phase 17. It gets its own file here so it
is not lost; the suffix `A` marks it as interstitial.
**Primary Area:** Frontend
**Status:** COMPLETED
**Depends On:** Phases 03, 05, 15, 16
**Enables:** Phase 17B (export engine reused for every document action)

---

## Objective

Fix ten user-reported defects and turn dead buttons into real actions, so the
doctor app behaves like a production application.

## Scope (original)

1. Global profile sync: a new `DoctorProfileProvider` became the single source.
2. Canvas profile photo editor.
3. Report category focus (`CATEGORY_VIEW`).
4. Patient and Doctor report filters removed.
5. Real Add Appointment dialog.
6. Real Add Patient dialog.
7. Dependency-free export engine (`utils/export.ts`: CSV, Excel, PDF, print) and
   `ExportButton`.
8. Dead global buttons wired or labelled "coming in a later phase".
9. Settings verified.
10. Toasts and confirmations.

## Out of Scope

Redesign, new features.

## Current Status

**COMPLETED.** All ten fixes landed. Later work changed some of them:

- Add Patient and Add Appointment are now live (FE-10.2, FE-10.3).
- The "coming in a later phase" toasts this pass introduced were **removed** by
  Phase 17B, which replaced or deleted every remaining fake action.
- `ProfilePhotoField` was promoted to `components/patterns` (Phase 18).
- Live builds do not offer profile photo upload yet (Phase 15 remaining work).

## Current State

`frontend/src/utils/export.ts`, `components/patterns/ExportButton.tsx` and
`app/providers/DoctorProfileProvider.tsx` still exist. DP-06 "real export" is
closed on this engine.

Unfinished work transferred: **none**.

## Tasks

- [x] [FRONTEND] Bugs 1–10 as listed

## Dependencies

- Depends on: Phases 03, 05, 15, 16
- Enables: Phase 17B

## Files / Areas Affected

`frontend/src/app/providers/DoctorProfileProvider.tsx`, `frontend/src/utils/export.ts`,
`frontend/src/components/patterns/ExportButton.tsx`, appointments/patients dialogs

## Acceptance Criteria

Original: each bug reproduced and verified fixed in the browser; zero console
errors. Met.

## Testing

Original: manual browser verification. A real CSV and a valid PDF blob were
captured. Export call sites were re-verified under DP-06.

## Evidence

- `frontend/STABILIZATION_POST_PHASE16.md`
- `frontend/FRONTEND_CHECKLIST.md` §6 DP-06

## Notes / Decisions Required

None.
