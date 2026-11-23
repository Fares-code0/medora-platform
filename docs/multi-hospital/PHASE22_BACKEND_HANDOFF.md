# Phase 22 — Backend Handoff (separated from the Phase 21 database PR)

**Date:** 2026-11-23 · **From:** database engineering · **To:** backend engineering

The Phase 21 database work is proposed to `main` on its own, from `fix/phase21-database-main-integration`.
The Phase 22 application code that PR #9 mixed into the database work, and that PR #12 extended, is
**not** in that pull request. It is preserved unchanged on its original branches; nothing here modifies
them. This document lists what belongs in a separate backend pull request and what it depends on.

## Where the code is

| Branch / PR | Commits | Content |
|---|---|---|
| `codex/phase21-data-model` (PR #9, head `b3020e8`) | `8282af2`, `515e301`, `b3020e8` | Hospital context type, decorator, resolver, Prisma repository, shadow interceptor, `GET /auth/session` fields, unit tests, session e2e |
| `claude/phase22-hospital-authz-continuation` (PR #12, head `063abc1`, stacked on PR #9) | `5bb5ec5`, `8baec77`, `063abc1` | PostgreSQL tests for the resolver, `PatientScopeService` shadow comparison, ACTIVE-hospital rule |

Both PRs target `Database`, which is 20 commits behind `main`. The backend PR should be cut from
`main` **after** the Phase 21 database PR merges, carrying only the application files below.

## Components

| Component | Files (on PR #12 head) | Status |
|---|---|---|
| Hospital context type and decorator | `src/common/auth/hospital-context.ts`, `src/common/auth/current-hospital-context.decorator.ts` | Shadow only |
| Hospital context resolution | `src/shared/authz/hospital-context.service.ts`, `prisma-hospital-context.repository.ts` (+ specs) | Doctor → one active `DoctorEmployment`; Hospital Admin → one active `admin` role assignment; otherwise `unresolved`; Platform Admin never inferred (OD-07 mapping pending) |
| Hospital context interceptor | `src/shared/authz/hospital-context-shadow.interceptor.ts` (+ spec), registered as `APP_INTERCEPTOR` in `authz.module.ts` | Attaches context after guards; failures become `resolution_unavailable` |
| Session response | `src/modules/auth/controllers/auth.controller.ts`, `services/session-user.service.ts` (+ spec) | `GET /auth/session` adds `activeHospital` and `adminScope` |
| PatientScopeService shadow comparison | `src/shared/authz/patient-scope.service.ts`, `hospital-patient-scope.shadow.ts`, `prisma-hospital-patient-scope.repository.ts` (+ specs) | Legacy decision unchanged; hospital-aware decision logged only |
| ACTIVE-hospital rule | `prisma-hospital-context.repository.ts` (`ACTIVE_HOSPITAL_FILTER`), `prisma-hospital-patient-scope.repository.ts` | Only `status = 'ACTIVE' AND deleted_at IS NULL` yields context |
| Tests | `test/hospital-context.e2e-spec.ts`, `test/hospital-patient-scope.e2e-spec.ts`, additions to `test/account-security.e2e-spec.ts` | PostgreSQL 16 |

## Spec files and documentation updates (explicit list)

The component table above names the source files. Every unit spec and every documentation update
that belongs to the same backend PR is listed here by name. None of them is in the database PR.

| File | Origin | What it covers | Backend responsibility |
|---|---|---|---|
| `backend/src/shared/authz/hospital-context.service.spec.ts` | PR #9 (`8282af2`, `515e301`, `b3020e8`) | Resolver decision table: doctor employment, admin assignment, ambiguity, unmapped admin, patient | Carry over unchanged |
| `backend/src/shared/authz/hospital-context-shadow.interceptor.spec.ts` | PR #9 (`8282af2`, `b3020e8`) | Context attached after guards; no principal; lookup failure → `resolution_unavailable`; handler errors not swallowed | Carry over; update if the interceptor becomes lazy (correction 2 below) |
| `backend/src/modules/auth/services/session-user.service.spec.ts` | PR #9 (`b3020e8`) | `activeHospital` / `adminScope` mapping in `GET /auth/session` | Carry over unchanged |
| `backend/src/shared/authz/prisma-hospital-context.repository.spec.ts` | PR #9 (`8282af2`, `b3020e8`), changed by PR #12 (`063abc1`) | Query shape, including the `status = 'ACTIVE' AND deleted_at IS NULL` filter | Carry over at PR #12's version |
| `backend/src/shared/authz/hospital-patient-scope.shadow.spec.ts` | PR #12 (`8baec77`, `063abc1`) | Fail-closed hospital-aware rule, comparison outcomes, log fields without PHI | Carry over at PR #12's version |
| `backend/src/shared/authz/patient-scope.service.spec.ts` | Exists on `main`; extended by PR #12 (`8baec77`, `063abc1`) | Regression matrix proving `canReach` / `assertCanReach` are unchanged with no shadow and with shadows that allow, deny or throw | Merge PR #12's additions into `main`'s file; do not drop the existing cases |

| Documentation update | Origin | Content | Backend responsibility |
|---|---|---|---|
| `docs/work-phases/PHASE-22-HOSPITAL-CONTEXT-AND-AUTHORIZATION.md` | PR #9 (`8282af2`, `515e301`, `b3020e8`) and PR #12 (`5bb5ec5`, `8baec77`, `063abc1`) | "Implementation progress" paragraph (shadow context, session fields, resolver tests, ACTIVE-hospital rule, `PatientScopeService` shadow) and the ticked shadow sub-deliverables | Apply to `main`'s copy (which still reads NOT STARTED) in the backend PR |
| `docs/multi-hospital/SECURITY_AND_DATA_ISOLATION.md` §2.1 "Phase 22 shadow mode — implementation status" | PR #12 (`8baec77`, `063abc1`) | What is computed but not enforced, the fail-closed shadow rule, the ACTIVE-hospital rule, log content | Add §2.1 to `main`'s copy in the backend PR |

## Required backend corrections before that PR is merge-ready

1. **Duplicate hospital-context queries.** For a doctor reaching a patient, one request runs the
   interceptor's context query, then `HospitalPatientScopeShadow.evaluate` resolves the same context
   again (`HospitalContextService.resolve`), then the assignment-scope query, besides the legacy
   `isAssigned` query: four round trips where two are needed. Reuse the context the interceptor already
   attached (request-scoped storage, or pass it in) instead of resolving twice.
2. **A query on every authenticated request.** The interceptor resolves context for every authenticated
   route, including ones that never read it, so every doctor and admin request costs one extra query.
   Resolve lazily (on first read) or behind a configuration switch, and measure before enabling
   broadly.
3. **Shadow cost on patient routes.** `PatientScopeService.canReach` awaits the shadow comparison on every
   call (it adds about two queries per doctor call, and file access calls it per file). Add a switch so it
   can be turned off without a deploy.
4. **Session parity test weakened.** `test/account-security.e2e-spec.ts` ("matches the payload the login
   response carried") was changed from `toEqual(fromLogin)` to comparing five picked fields. Restore a
   strict assertion: the session payload equals the login payload plus exactly `activeHospital` and
   `adminScope`.
5. **`account-security.e2e-spec.ts` is not Prettier-formatted** at `b3020e8` and later; format it when
   the backend PR touches it.
6. **OD-07 Platform Admin mapping** is undecided; platform scope is never produced. Platform Admin and
   Hospital Admin guards stay blocked on it.

## Database dependencies

The backend PR needs, from the Phase 21 database PR: `doctor_employments` (one active per doctor,
`doctor_employments_one_active_per_doctor_key`), `hospital_role_assignments` (active key
`(user_id, hospital_id, role_id) WHERE revoked_at IS NULL`, which serves the per-user lookup),
`hospitals.status` / `deleted_at` (`hospitals_status_check` limits status to ACTIVE, SUSPENDED,
INACTIVE), and the `patient_doctor_assignments` scope columns (`hospital_id`,
`hospital_medical_record_id`, `doctor_employment_id`, all-or-nothing by CHECK). No further schema change
is required for the shadow slice.

## Not changed by the database PR

No file in this list is modified by `fix/phase21-database-main-integration`. Its only overlap is that it
carries `main`'s unmodified `test/account-security.e2e-spec.ts`, `test/authz-repositories.e2e-spec.ts`
and `test/administration-center.e2e-spec.ts`; PR #9's edits to those three files were application or
seed-contamination workarounds and are not needed by the database change.
