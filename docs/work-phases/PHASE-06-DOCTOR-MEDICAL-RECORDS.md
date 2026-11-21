# Phase 06 — Doctor Medical Records Module

> **Historical record — not a task register** (labelled 2026-10-26). This file records a past phase as it was planned and built. Its Status line, task boxes and tables are not kept current, and nothing here is status. Open frontend work is tracked only in [`frontend/FRONTEND_CHECKLIST.md`](../../frontend/FRONTEND_CHECKLIST.md) §13 (doctor/admin web) and [`docs/multi-hospital/CLIENTS_CHECKLIST.md`](../multi-hospital/CLIENTS_CHECKLIST.md) (multi-hospital WEB/PA tasks); backend, database and AI items named here are tracked in those domains' own records. Where this file disagrees with them, they win.

**Original Source:** `frontend/PHASE6_MEDICAL_RECORDS.md`
**Primary Area:** Frontend
**Status:** COMPLETED — read-only scope delivered; authoring added by Frontend Phase D (D-21); live since FE-10.5
**Depends On:** Phases 03, 04
**Enables:** Phases 07, 08, 10 (cross-links and "Ask AI" with `context=record`)

---

## Objective

Build the medical records list (`/doctor/medical-records`) and the
clinical-document detail page (`/doctor/medical-records/:recordId`): URL-owned
filters, a sticky summary column, and a non-dismissible allergy strip.
Read-only.

## Scope (original)

List with summary cards, 7 advanced filters, `?patient=` deep link, and an
11-column table. Detail sections: chief complaint, HPI, exam, vitals, diagnoses,
plan, medications, allergies, notes, attachments, timeline. 300 seeded mock
records.

## Out of Scope

Editing, backend, AI logic. Print, export, share and AI review were placeholder
toasts.

## Current Status

**COMPLETED** for the original scope, and **extended**. Authoring, signing and
amend-not-edit shipped under D-21 (Frontend Phase D). List, detail and authoring
are connected (FE-10.5).

## Current State

**Completed work**
- Live: `GET /medical-records`, `GET /medical-records/:id`, `POST /medical-records`,
  notes / addendum / sign, `POST …/:id/status`.
- Print / Export PDF / Share produce real output (Phase 17B, `model/record-export.ts`).
- The rules "only a note's author may sign it" and "a signed note is immutable"
  were specified for server re-enforcement (`FRONTEND_CHECKLIST.md` §9 row 14).

**Remaining work**
- Vitals on a new record: the API cannot attach vitals (API §6.3), so the UI does
  not offer it (FE-10 Still Mock row 12). Owned by **Phase 29**.
- Multi-hospital (realigned 2026-10-07): lists show the current hospital's
  encounters. A new encounter is stamped with the hospital by the server from the
  session (DR-04). Encounters belong to the patient's Medical Record at that
  hospital (DR-03). Owned by **Phases 21, 22 and 25**.

## Tasks

- [x] [FRONTEND] List, detail, URL state, responsive cards
- [x] [FRONTEND] Authoring, sign, amend (D-21) and live wiring (FE-10.5)
- [ ] [BACKEND] Vitals attachable to a record — Phase 29
- [ ] [BACKEND] Records scoped and stamped by hospital — Phase 22
- [ ] [FRONTEND] Hospital-scoped list/detail — Phase 25

## Dependencies

- Depends on: Phases 03, 04
- Enables: Phases 07, 08, 10

## Files / Areas Affected

`frontend/src/features/doctor/medical-records/**`

## Acceptance Criteria

- Original: list and detail render every section with all states. Met.
- Updated: the server stamps the hospital; the client never chooses it.

## Testing

`http-record-service.test.ts` (17), including a partial failure that names the
record.

## Evidence

- `frontend/PHASE6_MEDICAL_RECORDS.md`
- `docs/FE-10-INTEGRATION-STATUS.md` Connected rows 8–9, Still Mock row 12
- `frontend/FRONTEND_CHECKLIST.md` §3.8 (D-21), §9 row 14

## Notes / Decisions Required

None specific to this phase.
