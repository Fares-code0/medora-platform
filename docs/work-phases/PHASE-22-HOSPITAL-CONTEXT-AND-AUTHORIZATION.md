# Phase 22 — Hospital Context, Session & Authorization

**Previously:** "Organization-Scoped Identity, Session & Authorization"
(`PHASE-22-ORGANIZATION-SCOPED-IDENTITY-AND-AUTHORIZATION.md`), renamed on 2026-10-07.
**Origin:** audit-derived; reconciled with the FINAL owner decisions on 2026-10-07
**Primary Area:** Backend + Security
**Status:** IN PROGRESS (Phase 21 implementation is on Draft PR #9; shadow-context slice underway)
**Valid after the final decisions:** yes
**Depends On:** 20, 21
**Implementation progress:** Server-derived hospital context is attached after authentication and authorization in shadow mode. GET /auth/session now adds activeHospital for a doctor with one active employment and adminScope for an explicitly mapped Hospital Admin. Missing, conflicting, or unmapped scope remains null; legacy admins are never inferred to be Platform Admins. Patient scope stays unresolved until a patient resource is known. These fields do not change guards, queries, or access decisions. The resolver is covered against PostgreSQL 16 (`backend/test/hospital-context.e2e-spec.ts`): ended employments and revoked assignments drop the hospital immediately, two admin hospitals stay ambiguous, non-admin hospital roles and admin rows held by doctor or patient accounts grant no admin scope, and an unmapped administrator never becomes platform scope; `GET /auth/session` drops `activeHospital` on the next request after an employment ends. Only an `ACTIVE`, non-deleted hospital yields context (allow-list on `hospitals.status`, which the `hospitals_status_check` constraint already limits to ACTIVE, SUSPENDED and INACTIVE): a suspended, inactive or soft-deleted employer or admin hospital reads as missing context, an administrator with one active and one suspended hospital resolves to the active one, and the patient-scope shadow denies assignments owned by an unavailable hospital. `PatientScopeService` now also computes a shadow hospital-aware decision (see `docs/multi-hospital/SECURITY_AND_DATA_ISOLATION.md` §2.1); it is compared and logged only and changes no access decision. Platform Admin scope is still never produced: no platform-role mapping exists yet (OD-07 mapping pending). Tenant enforcement and the remaining deliverables below are pending.
**Enables:** 22A, 23, 24, 25, 26, 27, 28, 29, 30

**Related documentation:** `docs/multi-hospital/BACKEND_CHECKLIST.md` A–C, `API_CONTRACT_CHANGES.md` §0–§2,
§8, `SECURITY_AND_DATA_ISOLATION.md`

> **Correction history.**
> - *First version:* `activeOrganization`, `memberships[]`, a switch route, organization admin, and
>   assignment plus an organization predicate. Superseded by DR-02/DR-05/DR-07/DR-08.
> - *Second version:* left the admin hierarchy (OD-07) and employment-end behaviour (OD-12) open.
>   Superseded: Platform Admin + Hospital Admin, Platform Admin with no automatic clinical access;
>   immediate revocation with no grace period.

---

## Objective

Every request carries a server-derived hospital context, and every hospital-owned read and write is
authorized against it.

## Why it exists

AF-13, AF-14, AF-15, AF-24, AF-25, AF-36.

## Owner decisions it implements

DR-01, DR-02, DR-04, DR-05, DR-07, DR-08, OD-07, OD-12, all FINAL.

## Deliverables

- [ ] [BACKEND] Request-scoped hospital context:
  - doctor → active employment;
  - Hospital Admin → their hospital;
  - Platform Admin → platform scope with **no** clinical data;
  - patient → resource.
- [x] [BACKEND] Shadow-only session activeHospital / adminScope metadata. Unresolved and unmapped scope stays null; **no switch route**
- [ ] [BACKEND] Redesign `PatientScopeService`: active hospital + role + permissions (shadow mode first)
  - [x] Shadow comparison: `PatientScopeService` keeps the legacy decision and compares it with a
    fail-closed hospital-aware rule (`HospitalPatientScopeShadow`); logged only, never enforced.
    Regression tests pin the legacy decisions; PostgreSQL tests cover isolation, legacy unowned
    assignments, former-hospital and ended-employment assignments, suspended, inactive and soft-deleted hospitals, and Hospital Admin separation.
  - [ ] Permissions in the hospital-aware rule, and switching enforcement on (needs owner approval)
- [ ] [BACKEND] Data-access-layer enforcement across ids, lists, search, filters, exports, aggregates,
  admin endpoints, assignments, messages, AI context and caches; 404 rule; stamping; mismatch rejection
- [ ] [BACKEND] Platform Admin vs Hospital Admin guards; explicit, audited clinical permission only
- [ ] [BACKEND] Employment termination → immediate invalidation of sessions, tokens, permission caches,
  dependent grants, Break-Glass sessions and AI access; no grace period
- [ ] [BACKEND] Server-side PHI withholding with audited reveal
- [ ] [BACKEND] Fix F33; lock-screen re-authentication endpoint
- [ ] [TESTING] N-1, N-6, N-7, N-8, N-9, N-10, N-11, N-23

## Blocking conditions

Phases 20 and 21.

## Security requirements

Gate **G-2** (completed in 30) and **G-4**.

## Downstream phases

22A, 23–30

## Source / evidence

- `backend/src/shared/authz/patient-scope.service.ts`
- `origin/frontend:docs/handoff/clinic-isolation.md` §4–§5
- `docs/FE-10-INTEGRATION-STATUS.md` (F33)
- ADR-022
