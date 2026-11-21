# Phase 01 — Design Tokens, Theme & Component Library

> **Historical record — not a task register** (labelled 2026-10-26). This file records a past phase as it was planned and built. Its Status line, task boxes and tables are not kept current, and nothing here is status. Open frontend work is tracked only in [`frontend/FRONTEND_CHECKLIST.md`](../../frontend/FRONTEND_CHECKLIST.md) §13 (doctor/admin web) and [`docs/multi-hospital/CLIENTS_CHECKLIST.md`](../multi-hospital/CLIENTS_CHECKLIST.md) (multi-hospital WEB/PA tasks); backend, database and AI items named here are tracked in those domains' own records. Where this file disagrees with them, they win.

**Original Source:** `frontend/COMPONENT_LIBRARY.md` ("Version 1.0.0 — Phase 1 deliverable")
**Also referenced in:** `frontend/PROJECT_SETUP.md` ("1 — Tokens & theme · folded into Phase 0")
**Planned in:** `frontend/FRONTEND_ARCHITECTURE.md` §13.1 rows "1. Tokens & theme" and "2. Design-system core"
**Primary Area:** Frontend (Design System)
**Status:** COMPLETED
**Depends On:** Phase 00
**Enables:** Phases 02–19, every frontend feature

---

## Objective

Build the single source of UI for Medora. Design tokens (`styles/tokens.css` →
`tailwind.config.ts`), light/dark theming with a no-flash boot, and a tiered
component library: Tier 1 `ui/` atoms and `feedback/`, Tier 2 `patterns/`, and
`layout/` primitives. Feature code composes these and never re-implements them.

## Scope (original)

- `tokens.css` semantic token layer, ThemeProvider, self-hosted fonts.
- Tier 1: buttons, fields, overlays, navigation, `DataTable`, feedback
  (Alert, Toast, Skeleton, EmptyState, ErrorState…).
- Tier 2: StatusBadge (the P8 status→colour vocabulary), KPI/statistic cards,
  SearchBar, FilterBar, DashboardWidget.
- Layout: PageContainer, Section, Stack, Grid, ContentHeader.
- Accessibility contract (focus, keyboard, triple-encoded status, reduced motion).

## Out of Scope

Pages and features. DatePicker, Calendar, Accordion and Popover were explicitly
deferred (`COMPONENT_LIBRARY.md` §10).

## Current Status

**COMPLETED.** The library shipped and is still the only sanctioned UI source.
The token *values* were later revalued, and the deferred items were partly
picked up. Neither change undoes this phase's deliverable.

## Current State

**Completed work**
- `frontend/src/components/{ui,feedback,patterns,layout,charts}` exist and are
  used app-wide. `ui/` holds ~40 primitives.
- The architecture audit behind ADR-0001 found **zero** hardcoded palette classes
  across 589 source files, so the "tokens only" rule held.

**Superseded in part**
- Colour, elevation and radius values in `DESIGN_SYSTEM.md` §12.1 are superseded
  by `docs/adr/0001-token-revaluation-clinical-legibility.md` (2026-08-19).
- Density and type-scale values were changed again by Phases 12, 13 and 17B.

**Deferred items, today**
- Popover: an anchored notification popover shipped in PR #40 (local `51cefbd`).
  No general `Popover` primitive exists in `components/ui/`.
- Accordion: `Collapsible` exists in `components/ui/`.
- DatePicker / Calendar primitives: still absent. Appointments uses
  feature-local calendar views (see Phase 05).
- Workbench: Storybook 9 stood up (F-09, ADR-0004). Only 5 of ~45 components
  have stories.
- Colocated tests now exist (`Card.test.tsx`, `DataTable.test.tsx`, …).

## Tasks

- [x] [FRONTEND] Token layer + Tailwind mapping + ThemeProvider + no-flash boot
- [x] [FRONTEND] Tier 1 atoms and feedback components
- [x] [FRONTEND] Tier 2 patterns and layout primitives
- [ ] [FRONTEND] Stories for the remaining Tier 1–2 components (F-09 follow-up; "mechanical against this pattern")
- [ ] [FRONTEND] DatePicker / Calendar primitives (still a DS-governance item)

## Dependencies

- Depends on: Phase 00
- Enables: every page-building phase

## Files / Areas Affected

`frontend/src/styles/tokens.css`, `frontend/tailwind.config.ts`,
`frontend/src/components/**`, `frontend/src/app/providers/ThemeProvider*`

## Acceptance Criteria

- Original: every component is strict TypeScript, token-only, works in both
  themes, keyboard and screen-reader operable, and typecheck/lint/build green.
  Met at the time.
- Updated: an axe WCAG 2.1 A/AA sweep of 19 routes was clean on 2026-09-01
  (`FRONTEND_CHECKLIST.md` F-14).

## Testing

Component tests in `components/**/*.test.tsx`. The Storybook a11y addon runs on
every existing story, but it is not wired into CI. Whether a failing axe check
should block a merge is an open owner policy call (F-09).

## Evidence

- `frontend/COMPONENT_LIBRARY.md` §1, §8, §10
- `docs/adr/0001-token-revaluation-clinical-legibility.md`, `docs/adr/0004-component-workbench.md`
- `frontend/FRONTEND_CHECKLIST.md` F-09, F-14
- `ls frontend/src/components/ui` (audit, 2026-10-07)

## Notes / Decisions Required

- Should axe failures in Storybook block merges? (Owner decision, F-09.)
