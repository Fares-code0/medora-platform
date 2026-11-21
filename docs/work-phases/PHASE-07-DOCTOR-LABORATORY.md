# Phase 07 — Doctor Laboratory System

> **Historical record — not a task register** (labelled 2026-10-26). This file records a past phase as it was planned and built. Its Status line, task boxes and tables are not kept current, and nothing here is status. Open frontend work is tracked only in [`frontend/FRONTEND_CHECKLIST.md`](../../frontend/FRONTEND_CHECKLIST.md) §13 (doctor/admin web) and [`docs/multi-hospital/CLIENTS_CHECKLIST.md`](../multi-hospital/CLIENTS_CHECKLIST.md) (multi-hospital WEB/PA tasks); backend, database and AI items named here are tracked in those domains' own records. Where this file disagrees with them, they win.

**Original Source:** `frontend/PHASE7_LAB_SYSTEM.md`
**Primary Area:** Frontend
**Status:** COMPLETED — read-only scope delivered; review loop and ordering added later; live since FE-10.7; annotations still missing
**Depends On:** Phases 03, 04, 06
**Enables:** Phases 08, 10

---

## Objective

Build the lab worklist (`/doctor/labs`) and the result-document detail page
(`/doctor/labs/:labId`). Results tables with reference ranges, non-dismissible
critical-value banners, specimen info and a lifecycle timeline. Read-only.

## Scope (original)

Six summary cards, 7 filters plus a critical toggle, an 11-column table, a
25-test catalogue across 8 categories, 520 seeded orders, and `?patient=` deep
links from profile and records.

## Out of Scope

Editing, backend, AI logic. Print, export and AI analysis were placeholder toasts.

## Current Status

**COMPLETED**, and **extended**. The review loop (D-10…D-14: inbox,
mark-reviewed fail-closed on criticals, trends, attach-to-record) and lab
ordering (DX-23) shipped under Frontend Phases D and F. All of it is connected
(FE-10.7).

## Current State

**Completed work**
- Live: `GET /lab-orders`, `GET /lab-orders/:id`, single and bulk review,
  `GET /lab-tests/catalogue`, `POST /lab-orders`, `POST …/attach-to-record`.
- Print / Export PDF real (Phase 17B, `model/lab-export.ts`).

**Remaining work**
- Lab annotations: no endpoint, so the UI says "Notes are not…" (FE-10 Still Mock
  row 11). Owned by **Phase 29**.
- Lab turnaround for admin reports needs a shared laboratory service (Phase C
  carried gap). Owned by **Phase 26**.
- Multi-hospital (realigned 2026-10-07): the worklist is scoped to the current
  hospital (DR-04). Owned by **Phases 22 and 25**.

## Tasks

- [x] [FRONTEND] Worklist, detail, catalogue, critical banners
- [x] [FRONTEND] Review loop, ordering, attach-to-record, live wiring
- [ ] [BACKEND] Lab annotation endpoint — Phase 29
- [ ] [BACKEND] Hospital-scoped lab orders — Phase 22
- [ ] [FRONTEND] Hospital-scoped worklist — Phase 25

## Dependencies

- Depends on: Phases 03, 04, 06
- Enables: Phases 08, 10

## Files / Areas Affected

`frontend/src/features/doctor/labs/**`, `features/shared-domain/lab-studies/`

## Acceptance Criteria

- Original: every section renders, criticals are never colour-alone. Met.
- Updated: a review that omits a critical value is rejected **server-side**
  (`FRONTEND_CHECKLIST.md` §9 row 13).

## Testing

`http-lab-service` contract specs (FE-10.7) and the D-11/D-14 page tests.

## Evidence

- `frontend/PHASE7_LAB_SYSTEM.md`
- `docs/FE-10-INTEGRATION-STATUS.md` Connected rows 14–17, Still Mock row 11
- `frontend/FRONTEND_CHECKLIST.md` §3.6, §9 row 13

## Notes / Decisions Required

None specific to this phase.
