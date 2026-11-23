# Phase 22 — Hospital Context, Session & Authorization

**Previously:** "Organization-Scoped Identity, Session & Authorization"
(`PHASE-22-ORGANIZATION-SCOPED-IDENTITY-AND-AUTHORIZATION.md`), renamed on 2026-10-07.
**Origin:** audit-derived; reconciled with the FINAL owner decisions on 2026-10-07
**Primary Area:** Backend + Security
**Status:** IN PROGRESS — shadow slice under review from `claude/phase22-backend-hospital-authorization` (Phase 21 merged to `main` in PR #13)
**Implementation progress:** Hospital context is server-derived, in shadow mode, and resolved lazily — only where read, at most once per request (no global interceptor). Doctor → the one active `DoctorEmployment`; Hospital Admin → the one active hospital `admin` role assignment; only an `ACTIVE`, non-deleted hospital counts; missing, ambiguous, conflicting or unmapped scope stays unresolved; Platform Admin scope is never inferred (OD-07 mapping pending); patient scope stays unresolved until a resource is known. `GET /auth/session` adds `activeHospital` / `adminScope`. `PatientScopeService` compares its unchanged legacy decision with a fail-closed hospital-aware shadow rule and logs divergence only, behind `HOSPITAL_SCOPE_SHADOW_COMPARISON` (default on). No guard, query or access decision changes.
**Valid after the final decisions:** yes
**Depends On:** 20, 21
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
- [x] [BACKEND] Session `activeHospital` / `adminScope` (shadow-only; unresolved and unmapped scope stay null). **No switch route**
- [ ] [BACKEND] Redesign `PatientScopeService`: active hospital + role + permissions (shadow mode first)
  - [x] Shadow comparison: legacy decision unchanged; fail-closed hospital-aware rule
    (`HospitalPatientScopeShadow`) logged only, behind `HOSPITAL_SCOPE_SHADOW_COMPARISON`. Regression
    tests pin the legacy decisions; PostgreSQL tests cover isolation, legacy unowned assignments,
    former-hospital and ended-employment assignments, suspended/inactive/soft-deleted hospitals and
    Hospital Admin separation.
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
