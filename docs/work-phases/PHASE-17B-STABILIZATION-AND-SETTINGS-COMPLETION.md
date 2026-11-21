# Phase 17B — Stabilization, Global Fixes & Settings Completion

> **Historical record — not a task register** (labelled 2026-10-26). This file records a past phase as it was planned and built. Its Status line, task boxes and tables are not kept current, and nothing here is status. Open frontend work is tracked only in [`frontend/FRONTEND_CHECKLIST.md`](../../frontend/FRONTEND_CHECKLIST.md) §13 (doctor/admin web) and [`docs/multi-hospital/CLIENTS_CHECKLIST.md`](../multi-hospital/CLIENTS_CHECKLIST.md) (multi-hospital WEB/PA tasks); backend, database and AI items named here are tracked in those domains' own records. Where this file disagrees with them, they win.

**Original Source:** `frontend/PHASE17_STABILIZATION_AND_SETTINGS_COMPLETION.md`
**Numbering note:** the second of two "Phase 17" documents. See
`PHASE-17A-DOCTOR-ADMINISTRATION-CENTER.md`.
**Primary Area:** Frontend
**Status:** COMPLETED
**Depends On:** Phases 15, 16, 16A
**Enables:** Phase 18 (shared patterns), Frontend Phase A (audit baseline)

---

## Objective

Do a full-UI audit and fix all eleven findings:

- chart placeholders
- "coming in a later phase" toasts
- dead composer buttons
- missing About/Help
- the disabled Help nav item
- 320 px tab-bar clipping
- the duplicate breadcrumb
- the dishonest "Block time off"
- dead code
- the thin doctor profile
- type scale one notch too large

## Scope (original)

Global type-scale step-down. Navigation fixes. A new Settings › About section
(version, copy diagnostics, support, legal). Profile completion (education,
certifications, skills, links, emergency contact). Every fake action made real
or removed. Charts promoted from reports to `src/components/charts/` with two
real dashboard widgets.

## Out of Scope

New feature modules, backend.

## Current Status

**COMPLETED.** A final sweep found zero "coming soon", `onPlaceholder` or TODO
markers in `src`. Later changes did not reverse this phase:

- Its type scale is the current scale. ADR-0001 revalued colour, elevation and
  radius, not the type scale.
- "Block time off" was removed here as dishonest. It later **returned as a real,
  live feature** (FE-10.3/10.4, `POST /me/time-off`), which is consistent with
  this phase's rule: show a real action or none.

## Current State

`frontend/src/components/charts/`, `features/doctor/settings/sections/AboutSection.tsx`,
`hooks/useShareLink.ts`, `utils/export.ts` (`openPdfPreview`) all exist.

Unfinished work transferred: **none**.

## Tasks

- [x] [FRONTEND] All eleven audit findings fixed
- [x] [FRONTEND] Shared chart library + dashboard chart widgets
- [x] [FRONTEND] About section, profile completion, placeholder removal

## Dependencies

- Depends on: Phases 15, 16, 16A
- Enables: Phase 18, Frontend Phases A–F

## Files / Areas Affected

`frontend/src/styles/tokens.css`, `frontend/src/components/charts/**`,
`frontend/src/features/doctor/{dashboard,settings,labs,medical-records,pharmacy,patients,messaging}/**`,
`frontend/src/layouts/**`

## Acceptance Criteria

Original: every route walked at 320/375/768/desktop, both themes, no horizontal
scroll, console clean. Met.

## Testing

Original: manual walkthrough and quality gates. Later re-verified by the
2026-09-03 verification sweep (`FRONTEND_CHECKLIST.md` §11).

## Evidence

- `frontend/PHASE17_STABILIZATION_AND_SETTINGS_COMPLETION.md` §1, §8, §9
- `docs/FE-10-INTEGRATION-STATUS.md` Connected row 6 (Block time off)

## Notes / Decisions Required

None.
