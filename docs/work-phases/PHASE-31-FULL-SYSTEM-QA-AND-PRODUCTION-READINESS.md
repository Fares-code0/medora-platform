# Phase 31 — Full-System QA, Production Readiness & Second-Hospital Readiness Gate

**Origin:** audit-derived; reconciled with the FINAL owner decisions on 2026-10-07
**Primary Area:** Testing + Integration (all teams)
**Status:** NOT STARTED
**Valid after the final decisions:** yes
**Depends On:** 30
**Enables:** production release and onboarding of a second real hospital

**Related documentation:** `docs/multi-hospital/IMPLEMENTATION_ORDER.md` steps 12–13,
`MIGRATION_AND_COMPATIBILITY.md` §3

> **Correction history.**
> - *First version:* journeys assumed signed-out discovery and a doctor switching organizations.
> - Now:
>   - journeys start with patient sign-in;
>   - a doctor changes hospital only by ending one employment and starting another (no grace period);
>   - grant and Break-Glass journeys include AI use, doctor-approved documentation and non-retention;
>   - admin journeys cover Platform Admin and Hospital Admin.

---

## Objective

Validate the whole system end to end on a two-hospital staging database. Rehearse the migration,
including the admin-account mapping. Then pass the second-hospital readiness gate.

## Deliverables

- [ ] [TESTING] Live route sweep per role: doctor, Hospital Admin, Platform Admin, insured patient,
  uninsured patient
- [ ] [TESTING] E2E journeys:
  - patient signs in → compares hospitals and doctors (distance, rating, next slot, insurance) →
    books a published slot at Hospital B → Medical Record @ B is created on that first interaction;
  - an uninsured patient sees and books without restriction;
  - doctor at A sees only A;
  - doctor at A requests B access (purpose, categories) → Hospital Admin of B approves → access
    audited → AI uses granted categories → doctor saves selected items into A's record (provenance) →
    revocation → doctor and AI lose access to B; no raw B data retained; the saved A content remains;
  - emergency **Break-Glass** at B: reason → minimum-necessary access → window ends → access gone;
    audited; B's Hospital Admin reviews;
  - cross-hospital consultation, audited;
  - doctor's employment at A ends → immediate loss of access → employed at B → B permissions only.
- [ ] [DATABASE] Migration rehearsal with rollback, including the **deliberate admin-account mapping**
- [ ] [INTEGRATION] `backend`, `frontend` and `patient-app` merged to `main`; CI green on all three
  suites
- [ ] [BACKEND] Telemetry, health and storage; backup/restore; M38
- [ ] [FRONTEND] [PATIENT-APP] Clinical translation pass; a11y sweep; store submission
- [ ] [OWNER] **Second-hospital readiness sign-off**

## Blocking conditions

Phase 30 (G-1…G-8).

## Security requirements

All gates re-run on the release candidate.

## Downstream phases

Release.

## Source / evidence

- `docs/FE-10-INTEGRATION-STATUS.md`
- Branch divergence on 2026-10-07: frontend 1/30, backend 3/22, Database 292/3, Ai 292/0,
  patient-app 27/8
