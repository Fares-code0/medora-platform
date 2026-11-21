# Phase 00 — Project Setup & Scaffolding

> **Historical record — not a task register** (labelled 2026-10-26). This file records a past phase as it was planned and built. Its Status line, task boxes and tables are not kept current, and nothing here is status. Open frontend work is tracked only in [`frontend/FRONTEND_CHECKLIST.md`](../../frontend/FRONTEND_CHECKLIST.md) §13 (doctor/admin web) and [`docs/multi-hospital/CLIENTS_CHECKLIST.md`](../multi-hospital/CLIENTS_CHECKLIST.md) (multi-hospital WEB/PA tasks); backend, database and AI items named here are tracked in those domains' own records. Where this file disagrees with them, they win.

**Original Source:** `frontend/PROJECT_SETUP.md` ("Phase 0 scaffolding per `FRONTEND_ARCHITECTURE.md` §13.1")
**Planned in:** `frontend/FRONTEND_ARCHITECTURE.md` §13.1, row "0. Project setup"
**Primary Area:** Frontend (Architecture / Tooling)
**Status:** COMPLETED
**Depends On:** the approved design documents (`DESIGN_SYSTEM.md`, `UX_ARCHITECTURE.md`, `FRONTEND_ARCHITECTURE.md`)
**Enables:** Phase 01 and every later frontend phase

---

## Objective

Stand up the doctor/admin web client (`frontend/`): Vite + React + strict
TypeScript, the feature-based folder skeleton, path aliases, ESLint boundary
rules, Prettier, Zod-validated environment and the core contracts (`types/auth`,
`types/api`, branded ids, `api/client.ts`) that every later phase builds on.

## Scope (original)

- Vite + React 18 + TypeScript strict, `exactOptionalPropertyTypes`.
- Folder skeleton: `app/`, `features/`, `components/`, `layouts/`, `routes/`,
  `hooks/`, `services/`, `api/`, `types/`, `utils/`, `constants/`, `configs/`,
  `styles/`, `assets/`.
- One-way dependency rule `app → features → platform layers`, enforced as an
  ESLint build failure (`import/no-restricted-paths`).
- Commands: `dev`, `build`, `preview`, `typecheck`, `lint`, `format`.
- Contracts: `Role`/`Permission`/`SessionUser`, `ApiResponse<T>`,
  `Paginated<T>`, `ApiError`, branded entity ids, in-memory access token.

## Out of Scope

Pages, design-system components, auth implementation, API integration.
The plan row in `FRONTEND_ARCHITECTURE.md` §13.1 also listed Vitest and CI; the
executed phase did **not** deliver them (see Current State).

## Current Status

**COMPLETED.** The scaffold exists and every later phase was built on it. The two
planned items it skipped (test runner, CI) were delivered later by Frontend
Phase A (see `FE-PHASE-A-STOP-SHIPPING-BLIND.md`).

## Current State

**Completed work**
- The folder layout in `PROJECT_SETUP.md` still matches `frontend/src/` (the
  `app/`, `features/`, `components/`, `layouts/`, `api/`, `types/` trees all exist).
- Boundary rules are still lint-enforced. CLAUDE.md's quality gate
  (`typecheck && lint && test && build`) runs on this scaffold.
- `api/client.ts` still exists. It now has a live HTTP transport
  (`api/http.ts`, `api/seam.ts`) that FE-10.1 added.

**What drifted**
- `PROJECT_SETUP.md`'s own "Phase Status" table is stale. It shows Phases 2–4 as
  "next/pending" and uses the *planned* numbering (2 = design-system core,
  3 = shell, 4 = auth). The executed phases were numbered differently
  (2 = doctor dashboard, 9 = auth). See `README.md`, "Two numbering systems".
- Vitest, Storybook and CI were added later (Phase A, F-09). They were not part
  of this phase.

**Remaining work:** none attributable to this phase.

## Tasks

- [x] [FRONTEND] Vite + React + strict TypeScript project
- [x] [FRONTEND] Feature-based folder skeleton and lint-enforced boundaries
- [x] [FRONTEND] Zod-validated env, query-client defaults, feature flags
- [x] [FRONTEND] Core type contracts and `ApiClient` shell
- [x] [TESTING] Test runner and CI — **delivered later by Frontend Phase A, not here**

## Dependencies

- Depends on: approved `DESIGN_SYSTEM.md`, `UX_ARCHITECTURE.md`, `FRONTEND_ARCHITECTURE.md` v1.0.0
- Enables: Phase 01 onward

## Files / Areas Affected

`frontend/package.json`, `frontend/vite.config.ts`, `frontend/eslint.config.js`,
`frontend/src/{app,configs,types,api,routes,styles}/`

## Acceptance Criteria

- `npm run build` green on the empty skeleton — met.
- Boundary violations fail lint — met and still enforced.

## Testing

Original: typecheck + lint + build only (no test runner existed). Today the
frontend suite runs Vitest (181 `*.test.ts(x)` files at audit time) in CI.

## Evidence

- `frontend/PROJECT_SETUP.md` (phase table, folder responsibilities)
- `frontend/FRONTEND_ARCHITECTURE.md` §13.1 (planned Phase 0 row)
- `frontend/FRONTEND_CHECKLIST.md` §1 F-01…F-10 (F-08 test runner and F-10 CI marked "Phase A")
- Phase documents entered this repository in merge `ff5900e` (2026-08-10). They
  were authored in a separate local repository on branch
  `claude/doctor-lab-system-phase-7-c1f15a`.

## Notes / Decisions Required

- `PROJECT_SETUP.md`'s phase table should be corrected or removed when the old
  files are retired, because it contradicts the executed numbering.
