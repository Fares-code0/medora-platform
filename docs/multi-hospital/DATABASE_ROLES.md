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

## 4. The audit partition jobs (resolved — option 2, finding F-05)

`AuditRepository` creates monthly partitions through `create_audit_events_partition(date)` and drops
expired ones through `drop_audit_events_partition(text)`. Since migration
`20261125090000_audit_partition_hardening` both are owner-defined `SECURITY DEFINER` functions with a
pinned `search_path = pg_catalog, public` and schema-qualified DDL, so the runtime role holds no DDL
right of its own (`CREATE TABLE` and `DROP TABLE` stay refused; `database-roles.e2e-spec.ts`).

- Creation accepts only the first day of a month, and secures the new partition at once: every
  non-owner privilege is revoked and Row-Level Security is enabled with no policy, so a partition can
  never be addressed directly — reads and appends go through `audit_events`, whose policies apply.
- The drop accepts only an `audit_events_YYYY_MM` child of `audit_events` whose month has ended; never
  the DEFAULT partition or another table. The retention window itself remains the service's.

The option considered and not adopted was a separate owner connection for the retention job.

## 5. Deployment requirements (operations)

1. Run `db:deploy` as the owner role, then the template (tokens replaced) as the owner role.
2. Set the runtime role's `LOGIN PASSWORD` through the secret channel; never commit it.
3. Point the application's `DATABASE_URL` at the runtime role; keep migrations, seeds and the audit
   partition job (until §4 is decided) on the owner role.
4. Re-run the template after any migration that adds an append-only table (the `REVOKE` must be repeated).
5. Rollback: point `DATABASE_URL` back at the owner role — immediate, no data change.
