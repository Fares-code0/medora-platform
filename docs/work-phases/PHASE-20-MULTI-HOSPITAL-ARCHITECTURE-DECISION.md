# Phase 20 — Multi-Hospital Architecture Decision (Hospital ADR)

**Origin:** audit-derived (2026-10-07); reconciled with the owner's FINAL decisions the same day
**Primary Area:** Architecture (Database, Backend, Security, AI, Frontend and Patient App review)
**Status:** IN PROGRESS
- Owner decisions DR-01…DR-13, OD-01…OD-14 and OQ-01 are **FINAL**: `docs/multi-hospital/OWNER_DECISIONS.md`.
- ADR-042 exists as a **Proposed draft**, `docs/multi-hospital/ADR-042-DRAFT.md`, held outside the register
  pending owner approval.

**Valid after the final decisions:** yes
**Depends On:** owner decisions (done)
**Enables:** 21, 22, 22A, 23–31

**Related documentation:** `docs/multi-hospital/OWNER_DECISIONS.md`, `MASTER_PLAN.md`,
`MIGRATION_AND_COMPATIBILITY.md` §1, `DATA_MODEL_CHANGES.md`, `SECURITY_AND_DATA_ISOLATION.md`

> **Correction history.**
> - *First version (2026-10-07):* formalized an **organization** model from the 2026-10-06 checklist
>   realignments: multiple memberships, switcher, public discovery. Superseded by DR-01…DR-13.
> - *Second version (2026-10-07):* listed OD-01…OD-14 as open and said AI may not use granted
>   cross-hospital data. Superseded by the final decisions: all ODs resolved; AI may use granted data
>   under OD-05 with no retention.
> - *Third version (2026-10-07):* recorded OD-04 as "no break-glass" and OQ-01 as open. Superseded:
>   Break-Glass exists (OD-04 = A); doctor-approved documentation is allowed (OQ-01 = A).

---

## Objective

Formalize the final Hospital architecture as an accepted ADR (draft written; owner approval pending). The ADR supersedes the single-clinic and
assignment-anchored decisions and records the technical choices later phases build to.

## Why it exists

The Accepted ADRs (ADR-018 §1, the ADR-010 clinics/facilities clause, ADR-022's anchor) contradict the
owner's decisions (AF-31). Engineers must not build against them.

## Owner decisions it depends on

All FINAL, including OD-04 = A and OQ-01 = A. **OQ-02** (record-claim identity proofing, RA-030.1)
is recorded in the ADR as open and deferred to implementation. It does not change the architecture.

## Deliverables

- [x] [ARCHITECTURE] **ADR-042 draft** written: `docs/multi-hospital/ADR-042-DRAFT.md` (Proposed)
- [ ] [OWNER] Approve ADR-042. Then re-run the register sweep including
  `origin/backend:backend/docs/PENDING_ADRS.md`, and append it to `docs/DECISIONS.md`. The draft covers:
  - DR-01…DR-13, OD-01…OD-14 and OQ-01 by reference;
  - the Hospital → Clinic / Location hierarchy;
  - Platform Admin + Hospital Admin, and the deliberate mapping of existing admins;
  - both cross-hospital paths (grant; Break-Glass), doctor-approved documentation with provenance,
    consultations, published slots;
  - AI isolation with authorization-bound use (grant or Break-Glass), no raw retention, C1/C2/C3 classes;
  - supersession of ADR-018 §1 and the ADR-010 clause; partial supersession of ADR-022 (anchor only);
  - the `PatientAccessGrant` extend-or-replace choice (AF-38);
  - enforcement (data-access layer now, RLS as a production gate);
  - OQ-02 (open, deferred).
- [ ] [ARCHITECTURE] Supersession notes on ADR-018 and ADR-010 (history kept, text not rewritten)
- [ ] [ARCHITECTURE] Optional ADR-043 split (cross-hospital access + AI retention), only after a fresh register sweep
- [ ] [DATABASE] [BACKEND] [SECURITY] [AI] [FRONTEND] [PATIENT-APP] Review sign-off

## Blocking conditions

None for writing. Run the register sweep before allocating the number.

## Security requirements

The ADR adopts `SECURITY_AND_DATA_ISOLATION.md` §1–§5 and gates G-1…G-8.

## Downstream phases

21, 22, 22A, 23–31

## Source / evidence

- `docs/DECISIONS.md` ADR-010, ADR-018, ADR-022
- `git grep '^## ADR-' origin/* -- docs/DECISIONS.md` → highest ADR-039
- `origin/backend:backend/docs/PENDING_ADRS.md` (ADR-040, ADR-041)
- "next free number: ADR-042" in `origin/frontend:frontend/FRONTEND_CHECKLIST.md` and
  `origin/frontend:docs/handoff/clinic-isolation.md`
