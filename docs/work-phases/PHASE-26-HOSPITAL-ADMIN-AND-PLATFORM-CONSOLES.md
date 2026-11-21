# Phase 26 — Hospital Admin & Platform Admin Consoles

**Previously:** "Organization Console & Platform Console"
(`PHASE-26-ORGANIZATION-AND-PLATFORM-ADMINISTRATION.md`), renamed on 2026-10-07.
**Origin:** audit-derived; carries forward Phases 17A and 18 and Frontend Phases B–C; reconciled with the
FINAL owner decisions on 2026-10-07
**Primary Area:** Frontend + Backend (+ Database)
**Status:** NOT STARTED
**Valid after the final decisions:** yes
**Depends On:** 21, 22, 22A
**Enables:** 29, 30

**Related documentation:** `docs/multi-hospital/CLIENTS_CHECKLIST.md` WEB-14…WEB-16,
`BACKEND_CHECKLIST.md` B7/C2, `API_CONTRACT_CHANGES.md` §8, `OWNER_DECISIONS.md` OD-07

> **Correction history.**
> - *First version:* treated organization admin / platform admin as decided, scoped by organization.
> - *Second version:* marked the hierarchy OD-07 (open).
> - Final (OD-07 = B):
>   - **Platform Admin**: hospital lifecycle and configuration, Hospital Admin management, platform
>     configuration; **no automatic clinical access**.
>   - **Hospital Admin**: one hospital, its staff, and cross-hospital approvals.
>   - Existing admin accounts are **mapped deliberately**; no default.
>   - Multiple Locations and Clinics per hospital (OD-06).

---

## Objective

Replace today's single platform-wide admin area with two consoles, both backed by real, scoped routes:

- **Hospital Admin console** (one hospital): clinics, locations, staff, doctor employment (hire/end),
  operations, booking policy, insurance acceptance, oversight, logs, reports, cross-hospital approvals.
- **Platform Admin console**: hospital lifecycle, Hospital Admin management, platform settings. No
  automatic clinical data.

## Owner decisions it implements

DR-01, DR-02, DR-06, OD-06, OD-07, OD-08, OD-12, OD-14, all FINAL.

## Deliverables

- [ ] [BACKEND] `/hospital-admin/*`: M23 on `main`, hospital-scoped; clinics; locations; employment
  hire/end (triggers OD-12 revocation); oversight; logs (M28); reports; cross-hospital approvals;
  Break-Glass notifications, revocation and post-event review (OD-04)
- [ ] [BACKEND] `/platform/*`: hospitals lifecycle, Hospital Admin management, platform settings (M24),
  backup/restore (501 today)
- [ ] [BACKEND] Any clinical access by an admin only through explicit, audited permission
- [ ] [DATABASE] Hospital Admin assignment; admin-account mapping list (migration)
- [ ] [FRONTEND] Hospital Admin console (WEB-14); Platform Admin console (WEB-15); role guards (WEB-16);
  split of the 16 settings panels (Phase 18)
- [ ] [TESTING] N-9, N-10, N-11; admin live sweep after F33

## Blocking conditions

Phases 21, 22 and 22A.

## Security requirements

- A Hospital Admin never reaches another hospital.
- A Platform Admin gets no clinical data without explicit, audited permission.

## Downstream phases

29, 30

## Source / evidence

- `docs/FE-10-INTEGRATION-STATUS.md` Still Mock 14–22, Blocked 1–9
- `git ls-tree origin/backend -- backend/src/modules/{administration,platform-settings}`
