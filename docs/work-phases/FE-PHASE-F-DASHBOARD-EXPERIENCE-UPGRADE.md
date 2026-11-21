# Frontend Phase F — Doctor Dashboard Experience Upgrade

> **Historical record — not a task register** (labelled 2026-10-26). This file records a past phase as it was planned and built. Its Status line, task boxes and tables are not kept current, and nothing here is status. Open frontend work is tracked only in [`frontend/FRONTEND_CHECKLIST.md`](../../frontend/FRONTEND_CHECKLIST.md) §13 (doctor/admin web) and [`docs/multi-hospital/CLIENTS_CHECKLIST.md`](../multi-hospital/CLIENTS_CHECKLIST.md) (multi-hospital WEB/PA tasks); backend, database and AI items named here are tracked in those domains' own records. Where this file disagrees with them, they win.

**Original Source:** `frontend/FRONTEND_CHECKLIST.md` §7 Phase F and §10 (DX-01…DX-23)
**Phase family:** lettered checklist phases (tranches F1–F4)
**Primary Area:** Frontend
**Status:** COMPLETED (F1, F4) — F2 and F3 are **OBSOLETE**: built, then removed with the Anatomy feature
**Depends On:** Phase 02, Frontend Phase D (for F4)
**Enables:** —

---

## Objective

Modernise the doctor dashboard: decisions-first information architecture, one
motion token layer, mobile priority order, reduced-motion coverage, and a
measured performance baseline (F1). Add an anatomical visualization in 2D (F2)
and 3D (F3). Make quick actions real (F4).

## Scope

| Tranche | Rows | Outcome |
|---|---|---|
| F1 | DX-01…DX-06 | ✅ 2.61 → 1.43 screens @1280×720; motion tokens + `Reveal`; mobile order; reduced-motion; DX-06 bundle baseline (closed F-11). DX-03 superseded by DS §9.4 (no counting-up clinical values) |
| F2 | DX-07…DX-14 | **Retired** — 2D anatomy map built (2026-08), removed 2026-10-04 |
| F3 | DX-15…DX-21 | **Retired** — 3D viewer/atlas (ADR-0002/0003, Z-Anatomy models) built, removed 2026-10-04; assets/records removed 2026-10-07 (PR #45, `origin/frontend`) |
| F4 | DX-22, DX-23 | ✅ New prescription, compose message, order lab, add record all open real flows |

## Out of Scope

Backend work.

## Current Status

- F1 and F4: **COMPLETED**.
- F2 and F3: **OBSOLETE**. The product removed Anatomy, so DX-07…DX-21 are closed
  as not applicable. Two rules outlived the feature and still bind other code:
  - **DX-10 honesty rule:** demo data carries a visible marker rendered from the
    data's own `source`.
  - **DX-13:** one control per thing.

## Current State

In this checkout, `docs/adr/0002-anatomy-3d-dependency.md`,
`docs/adr/0003-anatomy-atlas.md`, `docs/handoff/anatomy-region-insight-contract.md`
and `frontend/public/{anatomy,models}/LICENSE.md` still exist. `origin/frontend`
(PR #45) removed the remaining remnants. This checkout is 7 commits behind
`origin/frontend` (see `README.md`).

Unfinished work transferred: **none**.

## Tasks

- [x] [FRONTEND] F1 DX-01, DX-02, DX-04, DX-05, DX-06
- [x] [FRONTEND] F4 DX-22, DX-23
- [x] ~~F2 / F3~~ — obsolete (feature removed)

## Dependencies

- Depends on: Phase 02, Frontend Phase D
- Enables: —

## Files / Areas Affected

`frontend/src/features/doctor/dashboard/**`, `frontend/src/components/patterns/Reveal.tsx`,
`frontend/vite.config.ts`

## Acceptance Criteria

F1: ≤ 1.5 screens at 1280×720, measured. Met (1.43).

## Testing

DX-06 bundle table; reduced-motion verified live.

## Evidence

`frontend/FRONTEND_CHECKLIST.md` §10; `origin/frontend:frontend/FRONTEND_CHECKLIST.md`
§10.2 "F2 and F3 — retired"; git `f4c8a5d` (drop Anatomy), `ba79264` (remnants,
on `origin/frontend`).

## Notes / Decisions Required

None.
