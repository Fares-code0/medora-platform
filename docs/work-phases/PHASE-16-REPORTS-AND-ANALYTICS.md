# Phase 16 — Enterprise Reports & Analytics Center

> **Historical record — not a task register** (labelled 2026-10-26). This file records a past phase as it was planned and built. Its Status line, task boxes and tables are not kept current, and nothing here is status. Open frontend work is tracked only in [`frontend/FRONTEND_CHECKLIST.md`](../../frontend/FRONTEND_CHECKLIST.md) §13 (doctor/admin web) and [`docs/multi-hospital/CLIENTS_CHECKLIST.md`](../multi-hospital/CLIENTS_CHECKLIST.md) (multi-hospital WEB/PA tasks); backend, database and AI items named here are tracked in those domains' own records. Where this file disagrees with them, they win.

**Original Source:** `frontend/PHASE16_REPORTS_ANALYTICS.md`
**Primary Area:** Frontend (+ Backend dependency)
**Status:** PARTIALLY COMPLETED — the analytics UI is complete; data is seeded; `GET /reports/analytics` exists on `main` but is not wired
**Depends On:** Phases 02–15
**Enables:** Phase 17B (chart library promotion), Phase 29

---

## Objective

Build a Power BI / Looker-style analytics dashboard at `/doctor/reports`:

- KPIs, a sticky URL-owned filter bar, a category-driven analytics grid and
  insights
- saved and scheduled reports
- export to CSV, Excel, PDF or print
- a hand-rolled, token-styled SVG chart library

## Scope (original)

`features/doctor/reports/` with `buildSnapshot(filters)` deriving analytics from
small seeds, per-user saved and scheduled reports
(`medora.<userId>.reports.v1`), and 9 categories.

## Out of Scope

Real data, a third-party chart dependency.

## Current Status

**PARTIALLY COMPLETED.** The UI is done. The analytics are "illustrative demo
analytics" in every build.

## Current State

**Completed work**
- Charts promoted to `frontend/src/components/charts/` (Phase 17B), reused by the
  dashboard and admin reports.
- Category focus and filter cleanup (Stabilization post-16, bugs 3–4). Real
  export engine.
- The revenue category is governed by ADR-037: billing deferred, an alternate
  payload instead of 404.

**Remaining work**
- `GET /reports/analytics` is live on `main` (F40). The web client still uses
  seeds (FE-10 Still Mock row 5). The full reports module (saved and scheduled
  reports controller) is on the `backend` branch only.
- Multi-hospital (realigned 2026-10-07): analytics scoped to the current hospital.
- Owned by **Phase 29** (wiring) and **Phases 22 and 25** (scoping).

## Tasks

- [x] [FRONTEND] Analytics dashboard, chart library, saved/scheduled reports, export
- [x] [FRONTEND] HTTP adapter for `GET /reports/analytics` — Phase 29 · *verified 2026-11-22: `http-reports-service.ts` `fetchAnalytics`, selected by `reports/service.ts`*
- [x] [BACKEND] Saved/scheduled report routes to `main` (from `backend`) — Phase 29 · *verified 2026-11-22: `/reports/saved` and `/reports/scheduled` on `main`*
- [ ] [BACKEND] Analytics scoped to the current hospital — Phase 22

## Dependencies

- Depends on: Phases 02–15
- Enables: Phases 17B, 29

## Files / Areas Affected

`frontend/src/features/doctor/reports/**`, `frontend/src/components/charts/**`,
`backend/src/modules/reports/**`

## Acceptance Criteria

- Original: the dashboard responds to every filter; charts are theme-aware; zero
  console errors. Met.
- Updated: live analytics come from the API, and seeded figures keep their demo
  footnote until then.

## Testing

`features/doctor/reports/service.test.ts`, `DistributionBars.test.tsx`
(a11y regression).

## Evidence

- `frontend/PHASE16_REPORTS_ANALYTICS.md`
- `docs/FE-10-INTEGRATION-STATUS.md` Still Mock row 5 (F40)
- `git ls-tree origin/main` / `origin/backend -- backend/src/modules/reports`
- `docs/DECISIONS.md` ADR-037

## Notes / Decisions Required

None specific.
