# Backend ↔ PostgreSQL Tenant-Context Contract (for #20)

**Status:** **IMPLEMENTED** (PR #61). The Backend applies the contract and the policies are active
(`RLS_DESIGN.md`, Appendix A). What was built differs from the proposal below in one respect: the
context is a **scope** plus ids, not a single hospital id — `app.scope` (`hospital`, `platform`,
`patient`, `system`; any other value, including the `self` scope of a caller with no tenant, reads as
NULL and fails closed), `app.hospital_id`, `app.user_id` and `app.patient_id`, all transaction-local,
resolved per request by `TenantContextResolver` (in `AuthorizationGuard`) and applied by
`tenant-context.adapter.ts` (`IMPLEMENTATION_CONTRACTS.md` §6). The threat model and the FORCE RLS
assessment are at the end of this document. Sections 1–6 are the original proposal (2026-11-23),
kept as the design record; every PostgreSQL behaviour they state is proven by a test on PostgreSQL 16
(references in brackets).

## 1. What PostgreSQL needs

One transaction-local setting per request transaction:

| Item | Proposed value |
|---|---|
| Setting name | `app.hospital_id` (placeholder; final name agreed in #20 and then used by the policy migrations) |
| Value | The server-derived hospital id (UUID text) from `HospitalContextService.forRequest`, or `''` when the context is unresolved |
| Scope | **Transaction-local** only: `SELECT set_config('app.hospital_id', $1, true)` |
| Role | The runtime role (`DATABASE_ROLES.md`); never the owner |

PostgreSQL side (`backend/prisma/rls-proposal/phase22-rls-proposal.sql`): `app_rls.current_hospital_id()`
returns NULL for a missing, empty or malformed value, and every policy compares with `=`, so NULL matches
no row.

## 2. Transaction boundaries (the part that must be exactly right)

1. The `set_config` call and **every query it should scope** must run in the **same transaction on the
   same connection**. With `@prisma/adapter-pg`, queries outside an explicit transaction go to whatever
   pooled connection is free, so the request's database work must run inside an interactive
   `prisma.$transaction(async (tx) => { … })`, and the first statement in it sets the context.
2. Never set it session-level (`set_config(…, false)` or plain `SET`): it survives on the pooled
   connection into the next request [`rls-proposal.e2e-spec.ts` test 8].
3. Reset is automatic: a transaction-local value ends at `COMMIT` or `ROLLBACK`; the next transaction on
   the reused connection starts with no context and sees nothing [concurrency suite, "reused connection"].
4. Concurrent requests on different connections are isolated by construction [concurrency suite,
   "two interleaved transactions"].
5. Long requests: keep the transaction to the database work only (no external calls inside it); combine
   with the shadow timeout pattern below where relevant.

## 3. Missing or invalid context

| Situation | Database behaviour | Backend expectation |
|---|---|---|
| Context unresolved | Set `''` → no rows visible, every write refused (`42501`) [test 9] | Treat as "no access"; do not fall back to a broad query |
| Malformed value | Same as missing [test 9] | Should never happen: value comes only from the server context |
| Context set but row belongs to another hospital | Not visible; update/delete affect 0 rows; insert/update stamped with another hospital refused (`42501`) [tests 1–3, INSERT/DELETE, queue] | Return 404 (ADR-022), never 403 |
| Row's own hospital but parent of another hospital | Refused by composite FK (`23503`) or by the scoped-link trigger (`23514`, the trigger sees only the tenant's parents) [FK boundary test] | Map to 404 / 422 as today |

## 4. Background work

- Jobs and workers must **not** inherit a request's context (F5, #24). A job that touches hospital data
  sets its own context explicitly, per transaction, from data it loaded (e.g. the row's `hospital_id`),
  or runs as a dedicated role with an explicit, audited policy (to be designed with #16).
- The audit partition job needs DDL and cannot run as the runtime role as written
  (`DATABASE_ROLES.md` §4).
- `audit_events` inserts must never be blocked: the proposal puts no RLS on `audit_events`.

## 5. Resource bounds for the shadow queries (#26)

Proven [`database-statement-timeout.e2e-spec.ts`]:
- `set_config('statement_timeout', '<ms>', true)` inside the transaction cancels a slow statement and a
  lock wait with `57014`; `set_config('lock_timeout', …, true)` cancels only the lock wait with `55P03`;
- neither leaks to the next transaction on the reused connection; a session-level `SET` would;
- a global or role-level `statement_timeout` would also cut legitimate long work (migrations, exports),
  so it is not recommended.

Pattern for the shadow comparison (Backend, #26): an in-flight cap that skips when reached, and the two
shadow queries inside one interactive transaction that first sets `statement_timeout` (a few hundred ms).

## 6. Dependencies on database state (Issues #22–#27)

| Issue | Database fact it relies on |
|---|---|
| #22 F4 | `doctors.practice_status`, `doctors.verification_status`, `doctors.deleted_at`, `doctor_employments.ended_at`, `hospitals.status` / `deleted_at` (all present, indexed); reference rule `app_rls.effective_doctor_hospital` |
| #23 F3 | None (Backend only) |
| #24 F5 | §4 above |
| #25 F6 | `patient_doctor_assignments` scope columns (present) |
| #26 C1 | §5 above |
| #27 Enforcement | Policies (#19) are defence in depth; enforcement must not rely on them. Queue rows now carry `hospital_id` (PR #28): new rows must be stamped from context |

## Threat model: who chooses a scope (audit F-15)

- **The context is the server's, never the client's.** `TenantContextResolver` derives the request
  context from the authenticated caller's own records (Platform Admin grant, Hospital Admin
  assignment, the doctor's one clinical employment, the staff affiliation, the patient's own record).
  No header, query parameter, body field or route parameter is read to choose a scope or a hospital,
  and no caller of any role resolves to `system` (`tenant-context.resolver.spec.ts`).
- **`system` is chosen by code only**, at a reviewed list of call sites: trusted lookups of the caller's
  own staffing that precede and decide the context, DR-05 reach checks, audit attribution, the masked
  directory's reach, and platform maintenance jobs. `tenant-scope-callsites.spec.ts` fails when a new
  `runAsSystem` / `runWithTenantContext` / `setTenantContext` call site appears, so one cannot be added
  without review.
- **What the database still checks** when a trusted path holds `system`: the append-only and
  attribution rules of the audit ledger (`audit_events_append`), the tenant-key triggers
  (`prevent_tenant_scope_reassignment`, `validate_scoped_clinical_links`), and the Platform Admin
  invariant — none of which depends on the scope.
- **Residual risk**: a bug inside a reviewed `system` call site (e.g. a lookup keyed by an id the
  caller supplied, without filtering on the caller) could read across tenants. Each listed site
  filters on the authenticated user's own id; the list is the review surface.

## FORCE ROW LEVEL SECURITY: assessed, not adopted (audit F-18)

Every tenant table (86 relations in `public` with RLS on, the audit partitions of F-05 included) has RLS
**enabled**; none has it **forced**. FORCE would bind the table owner
as well.

- **Why not now.** The owner is the migration and backfill identity. Under FORCE every migration,
  seed, backfill and operator repair would need an explicit `system` context, and a forgotten one would
  fail closed in production deploys (or, worse, be worked around ad hoc). The protection FORCE adds —
  against the *application* connecting as the owner — is already provided another way.
- **The control that replaces it.** The application connects as the provisioned runtime role
  (`prisma/roles/provision-runtime-role.sql`): NOSUPERUSER, NOBYPASSRLS, owning nothing. In
  production the service refuses to start on a role that is a superuser, has BYPASSRLS or owns a table
  (`runtime-role.check.ts`), and `DATABASE_TENANT_CONTEXT` is required. The RLS runtime suites prove
  the policies bind that role.
- **Revisit when** any non-owner path must be prevented from ever using the owner credential (e.g. a
  shared operations account), or when migrations move to a separate migrator role that does not own the
  tables — then FORCE can be enabled with no deploy-time cost. The remaining exposure is operational:
  the owner credential must stay out of the application's environment.
