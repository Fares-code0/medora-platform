# Phase 29 — Cross-Layer Integration Closure

**Origin:** audit-derived. It collects FE-10 "Still Mock" rows not owned by Phases 26 or 28, plus
backend work stranded on `backend`. Reconciled with the FINAL owner decisions on 2026-10-07.
**Primary Area:** Integration (Backend + Frontend + Patient App)
**Status:** NOT STARTED
**Valid after the final decisions:** yes
**Depends On:**
- 22 — hospital context, for every item
- 22A — consultations
- 25 — web scoping
- 26 — admin surfaces
- 27 — patient messaging client
- historical surfaces: Phases 02, 04–07, 11, 14, 15, 16

**Enables:** 30, 31

**Related documentation:** `docs/multi-hospital/BACKEND_CHECKLIST.md` C, E, F; `API_CONTRACT_CHANGES.md`
§2, §4

> **Correction history.**
> - *Earlier versions:* cross-hospital staff messaging was "OD-13, default forbidden".
> - Final OD-13 = C: cross-hospital communication is allowed as an audited **clinical consultation**
>   (Phase 22A). Record data inside it still requires a grant (or valid Break-Glass). In-hospital messaging must close the
>   AF-16 gap first.

---

## Objective

Finish connecting every remaining web and patient-app surface to real, hospital-scoped routes. No live
surface stays silently mock.

## Technical dependencies

| Item | Needs |
|---|---|
| Messaging workspace and Communication tab (Phases 11, 14) | AF-16 fix → M20 to `main` → hospital scope → adapter. Cross-hospital conversations only via consultations (22A) |
| Patient messaging (patient-app M) | API-P17 unblocked (AD-1 / BE-13), hospital-scoped |
| Doctor reports (Phase 16) | `GET /reports/analytics` scoped (Phase 22); saved/scheduled routes from `backend` |
| Notification preferences and inbox actions (Phase 11) | Routes; hospital-scoped delivery |
| Privacy consents, integrations (Phase 15) | Routes, or removal by decision |
| Profile photo, document upload D-04b (Phases 15, 04) | M25 files; documents owned by the Medical Record's hospital |
| Lab annotations (07), record vitals (06) | Endpoints under the Medical Record |
| Propose-slots UI (05) | Reconcile with published slots (Phase 24) |
| Overview widgets (02) | M27 composites, hospital-scoped |
| Complaint flag (F35) | Source of truth |
| Global search (D-26) | M26, hospital-scoped |

## Deliverables

- [ ] [BACKEND] Fix AF-16; merge M20, M21, M25, M26 to `main` with hospital scoping and tests
- [ ] [BACKEND] Missing routes from the table above
- [ ] [FRONTEND] Adapters per row
- [ ] [PATIENT-APP] Patient messaging when unblocked
- [ ] [TESTING] Contract tests; N-16; re-issue the FE-10 status table

## Blocking conditions

Phase 22 (and 22A for consultations).

## Security requirements

Gate **G-7** (messaging half). Each merged module carries hospital negative tests.

## Downstream phases

30, 31

## Source / evidence

- `docs/FE-10-INTEGRATION-STATUS.md`
- `origin/backend:backend/src/modules/messaging/services/conversation.service.ts`
