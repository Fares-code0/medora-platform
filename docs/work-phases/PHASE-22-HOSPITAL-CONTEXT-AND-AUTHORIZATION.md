# Phase 22 — Hospital Context, Session & Authorization

**Previously:** "Organization-Scoped Identity, Session & Authorization"
(`PHASE-22-ORGANIZATION-SCOPED-IDENTITY-AND-AUTHORIZATION.md`), renamed on 2026-10-07.
**Origin:** audit-derived; reconciled with the FINAL owner decisions on 2026-10-07
**Primary Area:** Backend + Security
**Status:** IN PROGRESS — shadow slice under review from `claude/phase22-backend-hospital-authorization` (Phase 21 merged to `main` in PR #13)
**Implementation progress:** Hospital context is server-derived, in shadow mode, and resolved lazily — only where read, at most once per request (no global interceptor). Doctor → the one active `DoctorEmployment`; Hospital Admin → the one active hospital `admin` role assignment; only an `ACTIVE`, non-deleted hospital counts; missing, ambiguous, conflicting or unmapped scope stays unresolved; Platform Admin scope is never inferred (OD-07 mapping pending); patient scope stays unresolved until a resource is known. `GET /auth/session` adds `activeHospital` / `adminScope`. `PatientScopeService` compares its unchanged legacy decision with a fail-closed hospital-aware shadow rule and logs divergence only, behind `HOSPITAL_SCOPE_SHADOW_COMPARISON`, **opt-in (default off)**: enabling it under real load requires bounded shadow query execution first (condition C1, below). No guard, query or access decision changes.
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

## Open findings — PR #14 security audit (2026-11-23)

The audit returned *approved with conditions*. F1 (shadow awaited inline) is fixed in PR #14: the
comparison is detached from `canReach`/`assertCanReach`. F2 (log wording) is corrected in
`SECURITY_AND_DATA_ISOLATION.md` §2.1. The rest are **open**:

| # | Finding | Location | Must be resolved before |
|---|---|---|---|
| F3 (#23) | Context is resolved from the token's role while the session payload's `role` is read from the database; after a role change within the access-token lifetime they can disagree (display only) | `backend/src/modules/auth/services/session-user.service.ts` | Any use of the context beyond display |
| F4 (#22) | A doctor whose practice is suspended, or whose profile is soft-deleted, still resolves an active-employment context (display and shadow logging only today) | `backend/src/shared/authz/prisma-hospital-context.repository.ts` | **Authorization enforcement** |
| F5 (#24) | Background work started inside a request (e.g. an inline-queue timer) inherits that request's memo store | `backend/src/shared/authz/request-scope.ts`; `backend/src/shared/jobs/inline-job-queue.ts` | **Authorization enforcement** |
| F6 (#25) | The assignment-scope memo can be stale within a request that changes an assignment and then checks it (shadow logging only) | `backend/src/shared/authz/hospital-patient-scope.shadow.ts` | **Shadow results becoming authoritative** |
| F7 (in #25) | The same patient looked up by public id and by internal id gets two memo entries (one extra query; no correctness impact) | `backend/src/shared/authz/hospital-patient-scope.shadow.ts` | Optional optimisation |

**Resource-safety audit (2026-11-23).** Shadow queries share the application's Prisma pool (10
connections per process by default), with no enforced statement timeout and an unbounded
connection-wait queue; because the comparison is detached, a slow database lets them accumulate.
`HOSPITAL_SCOPE_SHADOW_COMPARISON` therefore defaults to **off**. **Condition C1 (open, #26):** before the
shadow is enabled in any environment with real load, bound its execution — a statement timeout on the
shadow queries and/or an in-flight cap that skips comparisons — without changing authorization.

## Database work package after PR #14 (2026-11-23, PR #15)

**Completed (database, no activation):**
- DB-1 (F4): the status model is sufficient — no schema change; effective-employment rule written and proven (`backend/docs/DATABASE_ARCHITECTURE.md`).
- DB-2 (C1, database side): no timeout bounds application queries today; a transaction-local `statement_timeout` is proven to cancel slow and lock-waiting statements without leaking on a pooled connection (`backend/test/database-statement-timeout.e2e-spec.ts`).
- DB-3: RLS design and full 124-table coverage inventory (`docs/multi-hospital/RLS_DESIGN.md`); proposed policies in `backend/prisma/rls-proposal/` (never applied).
- DB-4: behavioural isolation tests of the proposed policies (`backend/test/rls-proposal.e2e-spec.ts`).

**RLS readiness: NOT READY.** No table has RLS; the application connects as the superuser table owner (bypasses RLS). Blockers: #20 (tenant-context contract), #19 B2 (non-owner application role), #17 (legacy rows), #16 (OD-07), #18 (VACATION / verification), #21 (queue tables lack ownership).

**Backlog (GitHub):**

| Issue | Owner | Depends on |
|---|---|---|
| #16 OD-07 Platform Admin vs Hospital Admin | Owner decision | — |
| #17 Legacy row ownership (B3) | Owner decision | — |
| #18 VACATION / unverified doctor context (B7) | Owner decision | — |
| #19 Activate RLS | Database | #16, #17, #18, #20, PR #15 |
| #20 Tenant-context propagation for RLS | Backend (+ Database) | PR #15 |
| #21 Hospital ownership for queue tables | Database | ownership decision |
| #22 F4 exclude suspended / deleted doctors | Backend | #18, PR #15 |
| #23 F3 role consistency | Backend | — |
| #24 F5 background-job context isolation | Backend | — |
| #25 F6 (+F7) shadow cache invalidation | Backend | — |
| #26 C1 shadow resource bounds | Backend | PR #15 (evidence) |
| #27 Authorization enforcement | Backend | #16, #22, #24 (#23, #25) |

**Remaining security blockers:** enforcement (#27) is not implemented; multi-hospital isolation is **not** enforced by the application or the database.



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
