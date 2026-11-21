# Frontend Phase A — Stop Shipping Blind

> **Historical record — not a task register** (labelled 2026-10-26). This file records a past phase as it was planned and built. Its Status line, task boxes and tables are not kept current, and nothing here is status. Open frontend work is tracked only in [`frontend/FRONTEND_CHECKLIST.md`](../../frontend/FRONTEND_CHECKLIST.md) §13 (doctor/admin web) and [`docs/multi-hospital/CLIENTS_CHECKLIST.md`](../multi-hospital/CLIENTS_CHECKLIST.md) (multi-hospital WEB/PA tasks); backend, database and AI items named here are tracked in those domains' own records. Where this file disagrees with them, they win.

**Original Source:** `frontend/FRONTEND_CHECKLIST.md` §7 "Recommended order of work", Phase A
**Phase family:** lettered *checklist* phases (A–F). These came **after**
Phase 19 and replaced the numbered sequence for frontend work. They are
recorded here because they are where Phases 00–19's open items actually went.
**Primary Area:** Frontend (Testing + Accessibility)
**Status:** COMPLETED (2026-08-09)
**Depends On:** Phase 19
**Enables:** Frontend Phases B–F, FE-10

---

## Objective

Give the frontend a test runner, CI, and the three accessibility basics the
Phase 19 audit found missing. Until then every phase had been verified only by
typecheck, lint, build and manual clicks.

## Scope

1. F-08 test runner (Vitest + jsdom + Testing Library) with tests on guards,
   `ApiClient` and the patients query layer.
2. F-10 CI on GitHub Actions (typecheck, lint, test, build).
3. F-15 skip link, F-16 per-page titles, F-17 heading hierarchy. A-10 was
   withdrawn as a false positive.

## Out of Scope

Feature work.

## Current Status

**COMPLETED.** At the end of the phase there were 52 tests in 10 files and CI
was green. Today the frontend has 181 test files. CI (`.github/workflows/ci.yml`)
path-filters three suites: frontend, backend, patient-app.

## Current State

All listed rows are ✅ in `FRONTEND_CHECKLIST.md` §1.

Unfinished work transferred: **none**.

## Tasks

- [x] [TESTING] Vitest setup and first 52 tests
- [x] [TESTING] CI workflow
- [x] [FRONTEND] Skip link, document titles, heading levels

## Dependencies

- Depends on: Phase 19
- Enables: everything after; CLAUDE.md quality gates assume this exists

## Files / Areas Affected

`frontend/vitest.config.ts`, `frontend/src/test/setup.ts`, `.github/workflows/ci.yml`,
`frontend/src/layouts/SkipToContent.tsx`, `frontend/src/hooks/useDocumentTitle.ts`

## Acceptance Criteria

Gates after Phase A: typecheck 0 errors, lint 0 errors / 20 warnings, test
52/52, build green. Met.

## Testing

Self-referential: this phase *is* the test baseline.

## Evidence

`frontend/FRONTEND_CHECKLIST.md` §1 (F-08, F-10, F-15–F-17), §7 Phase A.

## Notes / Decisions Required

None.
