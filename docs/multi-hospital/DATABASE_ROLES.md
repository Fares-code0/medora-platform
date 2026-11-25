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
| **Runtime** (e.g. `medora_app`) | The application's `DATABASE_URL` | `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`, `LOGIN` with a secret password; owns nothing | `USAGE` on `public`; `SELECT/INSERT/UPDATE/DELETE` on all tables; **only `SELECT/INSERT` on `audit_events`** (ADR-007 R2); `USAGE/SELECT` on sequences; functions only through `PUBLIC` plus explicit `EXECUTE` on `create_audit_events_partition` and the `app_rls` helpers — **no** blanket or default function grant, and **no** audit retention (H1); default privileges for future owner-created tables and sequences |
| **Audit maintenance** (`medora_audit_maintenance` group + a login, e.g. `medora_audit_retention`) | Audit partition retention only, from `npm run audit:retention`, scheduled by operations | `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`; owns nothing; never the application's `DATABASE_URL` | `SELECT` on `platform_settings` (the retention window); `EXECUTE` on `create_audit_events_partition` and `drop_audit_events_partition`; nothing else (template `prisma/roles/provision-audit-maintenance-role.sql`) |
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

## 4. The audit partition jobs (resolved — F-05, then corrected by H1)

`AuditRepository` creates monthly partitions through `create_audit_events_partition(date)` and drops
expired ones through `drop_audit_events_partition(text)`, both owner-defined `SECURITY DEFINER`
functions with a pinned `search_path = pg_catalog, public` and schema-qualified DDL (migration
`20261125090000_audit_partition_hardening`), so no application role holds a DDL right of its own.

- Creation accepts only the first day of a month and secures the new partition at once (every
  non-owner privilege revoked, RLS on with no policy), so a partition is never addressed directly. The
  runtime role may create: an empty, secured future month destroys nothing.
- **Dropping is not the runtime role's (H1, migration `20261125100000_audit_retention_maintenance_role`).**
  F-05 originally let the runtime role call the drop, which — with the template's former blanket
  `GRANT EXECUTE ON ALL FUNCTIONS` — let the application role (or anything that compromised it) delete
  any past month of the append-only ledger. Now:
  - `audit_retention_entitled()` is true only when the *session* user owns the ledger or belongs to
    `medora_audit_maintenance`; the drop function refuses everyone else (`42501`) **whatever EXECUTE
    grants exist**;
  - the runtime template grants no function wholesale and revokes the drop and the other owner-only
    helpers; the migration strips existing grants from every non-owner, non-maintenance grantee;
  - the in-app sweep still keeps future months ready, and reports expired months as `deferred`;
  - retention is `npm run audit:retention` (`src/cli/audit-retention.ts`), run by operations with
    `AUDIT_MAINTENANCE_DATABASE_URL`, refusing to start unless the database says the connection is
    entitled. It boots only `AuditRetentionCliModule` (configuration, one database client, the
    retention policy, the audit repository and retention service) — never the application module, whose
    lifecycle hooks (for example the refresh-successor sweep over `sessions`) would run under a role
    that may not read those tables, and must not be granted them. The drop's own rules are unchanged: only an ended `audit_events_YYYY_MM` month, never the
    DEFAULT partition or another table; the window is `retention.auditLogDays`.
- Proven by `rls-runtime-role.e2e-spec.ts` (the runtime role is refused every route to removing a month —
  the drop, the owner-only helpers, `DROP`/`DETACH`/`TRUNCATE` — even after an explicit re-grant; the
  maintenance role drops only a past month), `rls-app-runtime.e2e-spec.ts` (the application as the
  runtime role defers) and `database-roles.e2e-spec.ts`.

## 5. Deployment requirements (operations)

1. Run `db:deploy` as the owner role, then the template (tokens replaced) as the owner role.
2. Set the runtime role's `LOGIN PASSWORD` through the secret channel; never commit it.
3. Point the application's `DATABASE_URL` at the runtime role; keep migrations and seeds on the owner
   role. Provision the audit maintenance role from `provision-audit-maintenance-role.sql`, give its
   login's URL to the scheduled `npm run audit:retention` as `AUDIT_MAINTENANCE_DATABASE_URL` (never to
   the application), and schedule it (daily is enough).
4. Re-run the template after any migration that adds an append-only table (the `REVOKE` must be repeated).
5. Rollback: point `DATABASE_URL` back at the owner role — immediate, no data change.
