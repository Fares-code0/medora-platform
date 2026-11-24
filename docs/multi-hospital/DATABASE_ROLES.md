# Database Role Separation (WP-5)

**Status:** designed and **verified on disposable PostgreSQL 16**; **not deployed** (no environment's
credentials or configuration were changed). Template: `backend/prisma/roles/provision-runtime-role.sql`.
Tests: `backend/test/database-roles.e2e-spec.ts`. Prerequisite for RLS (#19, blocker B2).

## 1. Why

The application, migrations and seeds all connect as one role, which owns every table and is a superuser
in CI/Compose. A superuser bypasses RLS always; a non-superuser owner bypasses it unless `FORCE` is set
(`RLS_DESIGN.md` §1). Hospital-isolation policies can only bind a **different** role.

## 2. Roles

| Role | Purpose | Attributes | Privileges |
|---|---|---|---|
| **Owner / migration** (today `medora`) | `prisma migrate deploy`, seeds, DDL, ownership of all objects | Owns the schema objects; need not be a superuser in production | Everything on its objects; bypasses RLS as owner (required for migrations and seeds) |
| **Runtime** (e.g. `medora_app`) | The application's `DATABASE_URL` | `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`, `LOGIN` with a secret password; owns nothing | `USAGE` on `public`; `SELECT/INSERT/UPDATE/DELETE` on all tables; **only `SELECT/INSERT` on `audit_events`** (ADR-007 R2); `USAGE/SELECT` on sequences; `EXECUTE` on functions; default privileges for future owner-created tables, sequences, functions |
| Read-only | — | **Not created**: no current consumer needs it (reports run inside the application). Add only with a concrete user. | — |

Not granted to the runtime role, on purpose: `CREATE` on the schema, `TRUNCATE`, `REFERENCES`, `TRIGGER`,
ownership, role or database creation.

## 3. Verification (PostgreSQL 16.15, disposable)

`database-roles.e2e-spec.ts` runs the real template in rolled-back transactions:

| Property | Result |
|---|---|
| Not superuser, no BYPASSRLS, no CREATEROLE/CREATEDB, owns 0 relations | ✔ |
| SELECT / INSERT / UPDATE / DELETE application data; `nextval` on reference sequences | ✔ |
| `audit_events`: INSERT allowed; UPDATE and DELETE refused (`42501`) | ✔ |
| `CREATE TABLE`, `ALTER TABLE`, `DROP TABLE`, `TRUNCATE`, `CREATE ROLE` refused; `GRANT` without grant rights changes nothing | ✔ |
| A table created later by the owner is readable through default privileges | ✔ |
| Bound by RLS (proposal) while the owner bypasses it; no context → no rows | ✔ |
| Owner/migration role keeps DDL | ✔ |
| No role left behind | ✔ |

**Whole-application check.** The full backend suite was run with `DATABASE_URL` pointing at a role
provisioned from the template (committed in a throwaway database, dropped afterwards): **3,759 tests
passed**. Every failure was classified:

- **Test infrastructure (expected):** suites that create roles or databases (`database-roles`,
  `rls-proposal`, `admin-bootstrap`, envelope-key-rotation suites), and suites whose guard requires the
  `medora` user (Phase 21, facility, RLS).
- **Test cleanup of the append-only ledger (expected):** `audit-coverage`, `audit-ledger`, `audit-pivot`,
  `schema-platform` delete their own audit rows, and say in comments that they rely on running as the
  owner. The runtime role correctly cannot.
- **One application path (finding §4):** the audit retention job.

## 4. Finding — the audit partition jobs need DDL

`AuditRepository` (`backend/src/modules/audit/repositories/audit.repository.ts`) calls
`create_audit_events_partition(date)` (creates a partition: `CREATE TABLE … PARTITION OF`) and drops
expired partitions with `DROP TABLE IF EXISTS`. Both are refused for the runtime role (proven; and the
retention test fails with `permission denied for schema public` when run as it).

Options (decision needed; tracked on #19):
1. Run the retention/partition job on a separate connection as the owner role (Backend change).
2. Owner-defined `SECURITY DEFINER` functions for create and for drop-expired, executable by the runtime
   role (Database migration + Backend call change). **Caution, proven in the test:**
   `create_audit_events_partition` uses *unqualified* names, so a definer wrapper must pin
   `search_path = public, pg_temp` (safe only because the runtime role cannot create in `public`) — or,
   better, the function is first rewritten with schema-qualified names. A drop function must restrict
   itself to `audit_events_YYYY_MM` partitions older than the retention window.

## 5. Deployment requirements (operations)

1. Run `db:deploy` as the owner role, then the template (tokens replaced) as the owner role.
2. Set the runtime role's `LOGIN PASSWORD` through the secret channel; never commit it.
3. Point the application's `DATABASE_URL` at the runtime role; keep migrations, seeds and the audit
   partition job (until §4 is decided) on the owner role.
4. Re-run the template after any migration that adds an append-only table (the `REVOKE` must be repeated).
5. Rollback: point `DATABASE_URL` back at the owner role — immediate, no data change.
