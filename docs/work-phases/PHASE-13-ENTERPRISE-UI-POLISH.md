# Phase 13 — Enterprise UI Polish & UX Refinement

> **Historical record — not a task register** (labelled 2026-10-26). This file records a past phase as it was planned and built. Its Status line, task boxes and tables are not kept current, and nothing here is status. Open frontend work is tracked only in [`frontend/FRONTEND_CHECKLIST.md`](../../frontend/FRONTEND_CHECKLIST.md) §13 (doctor/admin web) and [`docs/multi-hospital/CLIENTS_CHECKLIST.md`](../multi-hospital/CLIENTS_CHECKLIST.md) (multi-hospital WEB/PA tasks); backend, database and AI items named here are tracked in those domains' own records. Where this file disagrees with them, they win.

**Original Source:** `frontend/PHASE13_ENTERPRISE_UI_POLISH.md`
**Primary Area:** Frontend (Design System)
**Status:** SUPERSEDED — its heading scale was replaced by Phase 17B and its palette by ADR-0001; its interaction patterns survive
**Superseded by:** Phase 17B (type scale), `docs/adr/0001-token-revaluation-clinical-legibility.md` (colour values), Frontend Phase F / DX-01 (dashboard layout)
**Depends On:** Phase 12
**Enables:** Phase 14 onward (visual baseline)

---

## Objective

A presentation-only pass on top of Phase 12:

- slightly smaller headings
- button press feedback
- hover borders on interactive cards
- subtle zebra-striped tables and persistent sorted-column emphasis
- identity-toned empty states and tinted error chips
- an executive hero band on the dashboard and an accent-washed AI workspace

## Scope (original)

`tokens.css` heading scale (display 40, h1 26, h2 20, h3 17), `styles.ts`,
`Card`, `Sidebar`, `DataTable`, `EmptyState` (`tone` prop), `ErrorState`, the
seven module empty-state tones, `OverviewPage` hero band, `AiAssistantPage` wash.

## Out of Scope

Any route, feature, hook, provider, query or mock-data change.

## Current Status

**SUPERSEDED.** The phase completed. Its numbers were overtaken:

- The heading scale was stepped down again by Phase 17B (display 36, h1 24,
  h2 18, h3 16).
- Colour values behind the tones were revalued by ADR-0001.
- The dashboard hero band sits inside the DX-01 "decisions first" layout
  (Frontend Phase F).

Surviving patterns: press feedback, zebra rows, `EmptyState` tones and the AI
accent wash (the UX §1.5 provenance rule).

## Current State

- Completed: all listed changes landed at the time.
- Unfinished work transferred: **none**.
- Known limitation then — "chart widgets remain placeholders" — was closed by
  Phase 17B.

## Tasks

- [x] [FRONTEND] Heading step, interaction feedback, table and empty-state polish
- (no remaining tasks — superseded)

## Dependencies

- Depends on: Phase 12
- Enables: later visual work

## Files / Areas Affected

`frontend/src/styles/tokens.css`, `frontend/src/components/ui/{Card,DataTable,Sidebar}.tsx`,
`frontend/src/components/feedback/{EmptyState,ErrorState}.tsx`

## Acceptance Criteria

Original: typecheck, lint and build green; manual DOM verification. Met.

## Testing

Original: manual only. The axe sweep later covered these surfaces (F-14).

## Evidence

- `frontend/PHASE13_ENTERPRISE_UI_POLISH.md`
- `frontend/PHASE17_STABILIZATION_AND_SETTINGS_COMPLETION.md` §2, §9
- `docs/adr/0001-token-revaluation-clinical-legibility.md`

## Notes / Decisions Required

None.
