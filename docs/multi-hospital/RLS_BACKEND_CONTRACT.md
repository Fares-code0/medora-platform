# Backend ↔ PostgreSQL Tenant-Context Contract (for #20)

**Status:** PROPOSED by database engineering, **pending Backend agreement** (#20). Nothing here is
implemented in the Backend, and no policy is active. Every PostgreSQL behaviour stated is proven by a
test on PostgreSQL 16 (references in brackets).

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
