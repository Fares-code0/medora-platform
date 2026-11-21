# Phase 08 — Doctor Pharmacy Management

> **Historical record — not a task register** (labelled 2026-10-26). This file records a past phase as it was planned and built. Its Status line, task boxes and tables are not kept current, and nothing here is status. Open frontend work is tracked only in [`frontend/FRONTEND_CHECKLIST.md`](../../frontend/FRONTEND_CHECKLIST.md) §13 (doctor/admin web) and [`docs/multi-hospital/CLIENTS_CHECKLIST.md`](../multi-hospital/CLIENTS_CHECKLIST.md) (multi-hospital WEB/PA tasks); backend, database and AI items named here are tracked in those domains' own records. Where this file disagrees with them, they win.

**Original Source:** `frontend/PHASE8_PHARMACY_SYSTEM.md`
**Primary Area:** Frontend
**Status:** COMPLETED — read-only scope delivered; prescribing and safety screen added by Frontend Phase D; live since FE-10.6; medication database (D-18) still blocked
**Depends On:** Phases 03, 04, 06, 07
**Enables:** Phase 10 (`context=pharmacy`)

---

## Objective

Build the prescription list (`/doctor/pharmacy`) and the prescription-document
detail page (`/doctor/pharmacy/:prescriptionId`). Safety warnings (interaction,
allergy, duplicate, dosage) appear as non-dismissible alerts. Read-only.

## Scope (original)

Summary cards, filters, a 12-column table, a static formulary catalogue, 520
seeded prescriptions with canned safety warnings, and cross-links from profile,
records and labs.

## Out of Scope

Prescribing and editing, backend, AI logic. The safety checks were frontend
placeholders.

## Current Status

**COMPLETED**, and **extended**. D-17/D-19 added a four-step authoring flow, a
blocking fail-closed safety screen, and sign / save-draft / renew / cancel.
All of it is connected (FE-10.6), including the formulary and the server safety
check.

## Current State

**Completed work**
- Live: `GET /prescriptions`, `GET /prescriptions/:id`, `GET /medications`,
  `POST /prescriptions/safety-check`, create / sign / renew / cancel. An
  unreadable safety body counts as a failed verdict.
- Print / Export PDF real (Phase 17B).

**Blocked**
- **D-18 medication database** (typeahead + monograph drawer): not started on
  purpose. It needs a drug reference dataset (clinical data service). The
  `Medication`, `DrugInteraction` and `MedicationMonograph` tables exist in
  `backend/prisma/schema/06-catalogues.prisma`, but there is no source data.

**Remaining work**
- Multi-hospital (realigned 2026-10-07): the safety screen must say it
  considered **this hospital's** Medical Record only (DR-03/DR-04). Other
  hospitals' allergies and medications are reachable only through an explicit
  grant or emergency Break-Glass (DR-06, OD-04, Phase 22A). Owned by **Phase 25**.

## Tasks

- [x] [FRONTEND] List, detail, safety alerts
- [x] [FRONTEND] Authoring, safety screen, mutations, live wiring
- [ ] [BACKEND] [DATABASE] Drug reference dataset for D-18 — clinical data service (not scheduled; blocked)
- [ ] [FRONTEND] "This hospital's record" safety wording — Phase 25

## Dependencies

- Depends on: Phases 03, 04, 06, 07
- Enables: Phase 10

## Files / Areas Affected

`frontend/src/features/doctor/pharmacy/**`

## Acceptance Criteria

- Original: every detail section renders, and critical warnings cannot be
  dismissed. Met.
- Updated: the safety screen fails closed on any response it cannot read. Met.

## Testing

`http-prescription-service.test.ts` (14), `live-wording.test.tsx` (4),
`NewPrescriptionPage.test.tsx`.

## Evidence

- `frontend/PHASE8_PHARMACY_SYSTEM.md`
- `docs/FE-10-INTEGRATION-STATUS.md` Connected rows 10–13
- `frontend/FRONTEND_CHECKLIST.md` §3.7, §9 rows 5–6

## Notes / Decisions Required

- Source of drug reference data for D-18. Not scheduled in Phases 20–31; it
  needs a product/clinical owner decision.
