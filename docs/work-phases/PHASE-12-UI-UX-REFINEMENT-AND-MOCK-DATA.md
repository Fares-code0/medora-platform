# Phase 12 — UI/UX Refinement & Mock Data Optimization

> **Historical record — not a task register** (labelled 2026-10-26). This file records a past phase as it was planned and built. Its Status line, task boxes and tables are not kept current, and nothing here is status. Open frontend work is tracked only in [`frontend/FRONTEND_CHECKLIST.md`](../../frontend/FRONTEND_CHECKLIST.md) §13 (doctor/admin web) and [`docs/multi-hospital/CLIENTS_CHECKLIST.md`](../multi-hospital/CLIENTS_CHECKLIST.md) (multi-hospital WEB/PA tasks); backend, database and AI items named here are tracked in those domains' own records. Where this file disagrees with them, they win.

**Original Source:** `frontend/PHASE12_UI_UX_REFINEMENT.md`
**Primary Area:** Frontend (Design System)
**Status:** SUPERSEDED — its density values were revised by Phases 13 and 17B and ADR-0001; its mock-data reduction no longer governs live builds (FE-10)
**Superseded by:** Phase 13, Phase 17B, `docs/adr/0001-token-revaluation-clinical-legibility.md`, FE-PHASE-E (FE-10)
**Depends On:** Phases 02–11
**Enables:** Phase 13

---

## Objective

A polish pass, not a feature phase. It had two goals:

1. Step the UI down one density notch and give each module its own layout
   composition and identity tone.
2. Shrink the mock data from ~1,300 generated records to **five canonical
   entities per module**, reused consistently across the app.

## Scope (original)

Typography and component-density tables (buttons 36px, inputs 32px, table rows
40px, sidebar 224px…). Per-module compositions: registry, document workspace,
analytics, medication safety, schedule, activity. A new `MetricStrip` pattern.
Five patients, five doctors, five medications, five lab tests, five rows per
list.

## Out of Scope

Any feature, workflow or interaction removal.

## Current Status

**SUPERSEDED.** Nothing here is "unfinished". The phase completed, and its
outputs were overtaken:

- **Values:** heading sizes changed again in Phase 13 (display 44→40…) and Phase
  17B (display 40→36…). ADR-0001 then revalued colour, elevation and radius for
  clinical legibility. The pixel tables in the source file no longer describe the
  app.
- **Mock data:** the five-entity cast still exists for mock mode
  (`VITE_ENABLE_MOCKS`). Since FE-10, live builds read the API, so the
  "five rows per list" premise does not hold in production.
- **Surviving outputs:** `components/patterns/MetricStrip.tsx` and the module
  identity-tone map are still in use.

## Current State

- Completed: all listed changes landed at the time (2026-08, imported in `ff5900e`).
- Unfinished work transferred: **none**.

## Tasks

- [x] [FRONTEND] Density step-down and per-module compositions
- [x] [FRONTEND] Canonical 5-entity mock dataset
- (no remaining tasks — superseded)

## Dependencies

- Depends on: Phases 02–11
- Enables: Phase 13

## Files / Areas Affected

`frontend/src/components/ui/**`, `frontend/src/components/patterns/MetricStrip.tsx`,
the `model/mock-data.ts` files under `frontend/src/features/doctor/*/`

## Acceptance Criteria

Original: no functionality lost; typecheck, lint and build green. Met.

## Testing

Original: manual DOM / computed-style inspection (screenshots unavailable).

## Evidence

- `frontend/PHASE12_UI_UX_REFINEMENT.md`
- `frontend/PHASE13_ENTERPRISE_UI_POLISH.md` (tokens.css heading changes)
- `frontend/PHASE17_STABILIZATION_AND_SETTINGS_COMPLETION.md` §2
- `docs/adr/0001-token-revaluation-clinical-legibility.md`
- `docs/FE-10-INTEGRATION-STATUS.md` (live vs mock selection by `api/seam.ts`)

## Notes / Decisions Required

None. When the old files are retired, treat `tokens.css` and ADR-0001 as the
source of truth for values, not this document.
