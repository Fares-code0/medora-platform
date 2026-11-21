# Phase 04 — Doctor Patient Profile

> **Historical record — not a task register** (labelled 2026-10-26). This file records a past phase as it was planned and built. Its Status line, task boxes and tables are not kept current, and nothing here is status. Open frontend work is tracked only in [`frontend/FRONTEND_CHECKLIST.md`](../../frontend/FRONTEND_CHECKLIST.md) §13 (doctor/admin web) and [`docs/multi-hospital/CLIENTS_CHECKLIST.md`](../multi-hospital/CLIENTS_CHECKLIST.md) (multi-hospital WEB/PA tasks); backend, database and AI items named here are tracked in those domains' own records. Where this file disagrees with them, they win.

**Original Source:** `frontend/PHASE4_PATIENT_PROFILE.md`
**Primary Area:** Frontend
**Status:** COMPLETED (original read-only scope) — profile now live; document upload and hospital-scoped display still open
**Depends On:** Phase 03
**Enables:** Phases 06–10 (deep links and "Ask AI" entry points)

---

## Objective

Build the patient profile (UX §2.3, pattern P2) at
`/doctor/patients/:patientId`. Identity header with a non-dismissible
severe-allergy strip, sticky summary sidebar, tabbed clinical content.
Read-only.

## Scope (original)

Identity header, summary sidebar, 9 tabs (overview, history, medications,
allergies, labs & imaging placeholders, appointments, notes, documents), a
deterministic per-patient mock generator, and `?tab=` deep links.

## Out of Scope

Record editing, labs logic, AI logic, uploads, imaging viewer, the AI summary panel.

## Current Status

**COMPLETED** for the read-only scope. All tabs are connected to the API
(FE-10.2). Open gaps are follow-on capabilities this phase explicitly excluded.

## Current State

**Completed work**
- Profile and tabs live on `GET /patients/:id/profile` and
  `…/appointments|history|medications|notes|documents|studies|labs`.
- Lab results tab is real (D-05). Imaging has no source and says so.
- Print / export patient summary built (D-06, `model/patient-export.ts`).

**Removed**
- The Anatomy tab (added later, 2026-08) was removed with the Anatomy feature
  (PR #37, 2026-10-04). The tab count went 10 → 9.

**Remaining work**
- **D-04b document upload:** the frontend half is built, but storage refuses.
  Backend file storage M25 and the scan gate are needed. Owned by **Phase 29**.
- **Multi-hospital (realigned 2026-10-07):** tabs render only the current
  hospital's Medical Record (DR-03/DR-04), never presented as the patient's
  complete history. Data from another hospital is reachable **only** through an
  explicit, admin-approved cross-hospital grant, or emergency Break-Glass (DR-06, OD-04, Phase 22A). The
  2026-10-06 "shared safety summary" (API-W04) is superseded. Owned by
  **Phases 25 and 22A**.

## Tasks

- [x] [FRONTEND] Identity header, sidebar, tabs, deep links
- [x] [FRONTEND] Live profile and tabs (FE-10.2)
- [ ] [FRONTEND] [BACKEND] Document upload (D-04b, M25) — Phase 29
- [ ] [FRONTEND] Hospital-scoped tabs and source labels — Phase 25
- [ ] [BACKEND] [FRONTEND] Cross-hospital record access via explicit grant (DR-06) — Phase 22A; grant limited to approved data categories (OD-03, final)

## Dependencies

- Depends on: Phase 03
- Enables: Phases 06, 07, 08, 10

## Files / Areas Affected

`frontend/src/features/doctor/patients/**` (profile components), `features/shared-domain/lab-studies/`

## Acceptance Criteria

- Original: all tabs render with loading / not-found / error states, and the
  severe-allergy strip is visible on every tab. Met.
- Updated: under multi-hospital, a tab never implies completeness across
  hospitals (Phase 25).

## Testing

`http-profile-service.test.ts` (11), `http-patient-studies.test.ts` (2), and a
10-tab browser sweep (FE-10.V).

## Evidence

- `frontend/PHASE4_PATIENT_PROFILE.md` §4
- `docs/FE-10-INTEGRATION-STATUS.md` Connected row 3
- `origin/frontend:frontend/FRONTEND_CHECKLIST.md` §3.3 (D-04b, multi-organization note), §9.1 API-W04

## Notes / Decisions Required

- Resolved by the final owner decisions (2026-10-07): access to another
  hospital's record only through a purpose-bound, category-limited, revocable,
  audited grant (DR-06, OD-01, OD-03), with no patient consent required (OD-02),
  or in an emergency through time-limited, minimum-necessary, audited
  Break-Glass (OD-04). Selected information may be documented into this
  hospital's record after the doctor's explicit approval (OQ-01). See
  `docs/multi-hospital/OWNER_DECISIONS.md`.
