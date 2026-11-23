# Multi-hospital enforcement — implementation contracts

What the backend now guarantees, and where each guarantee lives. The decision record is
[ADR-047](../DECISIONS.md); the RLS design and inventory are [RLS_DESIGN.md](RLS_DESIGN.md) and
[RLS_BACKEND_CONTRACT.md](RLS_BACKEND_CONTRACT.md).

## 1. Effective authorization

| Contract | Where |
| --- | --- |
| Authorization comes from the database on every request, never the token's `permissions` claim (display-only) | `shared/authz/permission-resolver.service.ts`, `authorization.guard.ts` |
| Cache key `user\|role\|authz_version`; every authorization change bumps `users.authz_version` in its own transaction | `permission-resolver.service.ts`, writers in `users`, `doctors`, `hospitals`, `auth` |
| Role change revokes every session and refresh token; permission edits apply on the next request without revocation | `users/services/platform-user.service.ts`, ADR-046 |
| Server policy overlay: no standing admin PHI; admin-only platform capabilities; category ceilings; custom roles capped by base category | `shared/authz/authz-policy.ts` |
| Doctor/staff standing gate: no capability without clinical standing; terminated accounts refused at login and refresh | `prisma-role.repository.ts` (`standingOf`), `login.service.ts`, `refresh.service.ts` |

## 2. Administrative scope

| Scope | Source | Reach |
| --- | --- | --- |
| Platform Admin | active `platform_admin_grants` row (exclusive with a hospital assignment; no self-grant; last one cannot be revoked) | every administrative route; never PHI by default |
| Hospital Admin | exactly one active `hospital_role_assignments` row for `admin` | only routes marked `@HospitalScope()`, confined to its hospital |
| none | anything else (including the legacy dev/test admin accounts) | no administrative route |

Administrative routes are platform-tier by default. Hospital-tier today: staffing
(`hospitals/:hospitalId/doctor-employments`, `…/staff-affiliations`), the role catalogue and
custom-role creation (`GET /roles`, `GET /permissions`, `POST /roles`), and the audit ledger list and
detail (scoped to the hospital). `@PlatformScope()` marks routes that must never open to a Hospital
Admin.

## 3. Clinical access (DR-05)

- A doctor reaches a patient iff the patient has a Hospital Medical Record at the doctor's clinical
  hospital (`PatientScopeService` → `PrismaPatientAssignmentRepository.reachesPatient`). Assignment
  shapes "My Patients" lists only.
- Registration opens the record at the registering doctor's hospital. New medical records, lab
  orders and prescriptions are stamped with `hospital_id`, `hospital_medical_record_id` and
  `doctor_employment_id` (refused without a stamp); derived rows inherit the parent's stamp.
- Out-of-scope resources answer 404.

## 4. Controlled cross-hospital access

| Flow | Rules | Where |
| --- | --- | --- |
| Exceptional Access | eligible: clinical doctor or scoped admin; re-authentication; reason ≥ 12 chars; ≤ 24 h; categories; per-hospital independent approval; reads only via `GET /exceptional-access/:id/data` by the requester; every read audited | `modules/controlled-access` |
| Emergency Override | active at once; hospital admins notified; `critical` audit; retrospective review by the hospital's admin | same |
| Information request | named patient, record, items, reason; only the owning Hospital Admin decides; approved subset; ≤ 30 days; reader must be the requester and a clinical doctor; every read audited | same |

## 5. Audit

- Every lifecycle, scope and access event carries `hospital_id`.
- Every successful read of a PHI-capability route writes `phi.read` before the response is
  released, and fails closed (`PhiReadAuditInterceptor`).
- Ledger reads are themselves audited (`audit_ledger.read`).

## 6. Row-Level Security

- RLS is enabled on 73 tables. It binds the runtime role from `prisma/roles/provision-runtime-role.sql`
  (NOSUPERUSER, NOBYPASSRLS, not the owner).
- Context is transaction-local: `app.scope`, `app.hospital_id`, `app.user_id`, `app.patient_id`. It
  is set per request by `TenantContextResolver` and applied by `tenant-context.adapter.ts` when
  `DATABASE_TENANT_CONTEXT` is on. Authorization lookups and jobs run under explicit `system` scope.
- Production refuses to start without the tenant context, or on a role that bypasses RLS.
- Proven by `rls-runtime-role.e2e-spec.ts` (database) and `rls-app-runtime.e2e-spec.ts` (the
  application as the runtime role).

## 7. Legacy data

- Rows with `hospital_id IS NULL` stay invisible to every hospital scope.
- `npm run db:backfill:dry-run` proposes owners from evidence only, in a read-only transaction, and
  refuses production. A real backfill must write `ownership_assignments` evidence rows; it is a
  production step, not part of this change.
