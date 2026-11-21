# Phase 25 — Doctor Workspace: Active-Hospital Scope

**Previously:** "Doctor Workspace: Multi-Hospital Experience"
(`PHASE-25-DOCTOR-WORKSPACE-MULTI-HOSPITAL.md`), renamed on 2026-10-07.
**Origin:** audit-derived; reconciled with the FINAL owner decisions on 2026-10-07
**Primary Area:** Frontend
**Status:** NOT STARTED
**Valid after the final decisions:** yes
**Depends On:** 22, 22A, 24
**Enables:** 28, 29, 30

**Related documentation:** `docs/multi-hospital/CLIENTS_CHECKLIST.md` WEB-1…WEB-13c,
`API_CONTRACT_CHANGES.md` §1–§4

> **Correction history.**
> - *First version:* ORG-01 switcher, multi-membership, affiliations list, per-location availability
>   editing. Superseded by DR-02/DR-08/DR-10.
> - *Second version:* "what a former employee may see" was OD-12. Final answer: nothing clinical,
>   immediately (OD-12).
> - The authorized-record view follows the final rules for both paths: grant (OD-01, OD-03) and
>   Break-Glass (OD-04). The documentation flow follows OQ-01 = A.

---

## Objective

The doctor web workspace always operates in the doctor's **active hospital** (no switcher), shows only
that hospital's data, provides slot publishing, and offers the grant, Break-Glass, documentation and
consultation UI.

## Owner decisions it implements

DR-02, DR-04, DR-05, DR-06, DR-08, DR-10, DR-12, OD-04, OD-06, OD-12, OD-13, OQ-01, all FINAL.

## Deliverables

- [ ] [FRONTEND] Active hospital (and clinic/location) in the shell; **no switcher** (WEB-1, WEB-2)
- [ ] [FRONTEND] Hospital-scoped screens and query keys; caches cleared on employment end (WEB-3, WEB-4)
- [ ] [FRONTEND] Retire the fail-open `useClinicScope`/mock `clinicId`. It must not serve as isolation
  (WEB-5)
- [ ] [FRONTEND] Read-only employment and history in settings (WEB-6)
- [ ] [FRONTEND] Slot publishing, capacity 1 (WEB-7)
- [ ] [FRONTEND] "This hospital's record" wording; labelled cross-hospital content in AI, with authorization end (WEB-8, WEB-9)
- [ ] [FRONTEND] Grant request, authorized-record view, Break-Glass start/banner/end, documentation
  (select → review → approve/save, no "import all"), consultation workspace (WEB-10, WEB-11, WEB-13,
  WEB-13a, WEB-13c)
- [ ] [TESTING] N-23 (client); `frontend/src/types/auth/` parity rule (backend suite)

## Blocking conditions

Phases 22, 22A and 24 (per feature).

## Security requirements

Display only; the server enforces. Gate **G-4** (client half).

## Downstream phases

28, 29, 30

## Source / evidence

- `origin/frontend:frontend/src/features/doctor/clinic/useClinicScope.ts`
- `origin/frontend:frontend/FRONTEND_CHECKLIST.md` ORG-01 (superseded)
