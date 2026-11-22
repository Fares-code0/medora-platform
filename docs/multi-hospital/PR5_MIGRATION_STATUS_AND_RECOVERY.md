# PR #5 — Migration Status Verification and Recovery

**As of:** 2026-11-22 · **Scope:** read-only evidence and conditional recovery planning only.

This guide does not authorize a database connection, migration, replay, resolution, schema repair,
backfill, reset, or data change. Do not paste database URLs, credentials, or unredacted migration logs
into a ticket or chat.

## Repository and deployment evidence

- PR #5 is based on `Database` commit `babee3974a5641e4c3e61a9d629e5a93107e3b67`. Both migration
  directories are additions on the feature branch (commit `b711fb6`); neither exists in the PR base.
  This proves their repository introduction point, not whether equivalent SQL was run out of band.
- The earlier extension migration `20260814120000_enable_extensions` creates `pgcrypto` and `citext`,
  required by `hospital_core`'s `gen_random_uuid()` defaults and `CITEXT` email column.
- `.github/workflows/ci.yml` uses a PostgreSQL 16 service whose database is `medora_test`; it runs
  `npm run db:deploy`. Available PR runs [45034628254](https://github.com/Fares-code0/medora-platform/actions/runs/45034628254)
  (Backend tests failed after migration and seed succeeded), [45037805035](https://github.com/Fares-code0/medora-platform/actions/runs/45037805035)
  (cancelled after migration and seed succeeded), and [45038104419](https://github.com/Fares-code0/medora-platform/actions/runs/45038104419)
  (all checks succeeded) each ran against a fresh disposable service database. This proves successful
  application in those CI jobs only; the canceled/failed test outcomes do not indicate a migration
  failure.
- `.github/workflows/perf-nightly.yml` uses a per-run PostgreSQL 16 service database
  `medora_perf_ci` and runs `db:deploy`. The available latest run at review time was on `main` commit
  `404127548d7e35130442270bdfcaf77ef1f7b6fa`, before these migrations entered the branch; it is not
  evidence about these migration names.
- `backend/docker-compose.yml` starts a local PostgreSQL 16 database named `medora` with the persistent
  named volume `postgres-data`. `backend/README.md` documents running `npm run db:deploy` against the
  configured `DATABASE_URL`; `backend/prisma.config.ts` loads `.env`. Local/manual application is
  therefore possible, but no evidence found in the repository establishes whether it occurred.
- `backend/Dockerfile` builds and starts the API; it does not run migrations. The repository contains
  no deployment workflow or infrastructure definition that identifies development, staging, or
  production database targets. External deployment systems, manual DBA actions, copied SQL, restores,
  and environment inventories are not visible from this checkout.

| Environment             | Evidence available here                                                                                                 | Classification for `hospital_core`      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Local                   | A persistent local Compose database and a documented manual `db:deploy` command exist. No local database was inspected. | **Unknown**                             |
| Development             | No development database target or deployment metadata is recorded in this repository.                                   | **Unknown**                             |
| Staging                 | No repository deployment target or database metadata identifies it.                                                     | **Unknown**                             |
| Production              | No repository deployment target or database metadata identifies it.                                                     | **Unknown**                             |
| CI — PR run 45038104419 | CI explicitly targets disposable PostgreSQL 16 `medora_test`; migration deploy and the Backend job succeeded.           | **Applied in that disposable run only** |
| CI — performance        | Available latest run predates the feature migration commit; workflow uses disposable `medora_perf_ci`.                  | **Not evidence for these migrations**   |

The CI service containers are destroyed with their jobs. For a past run, use its workflow/job logs and
artifacts; do not expect a live database to remain available for inspection.

Missing files, absent `_prisma_migrations` rows, a successful fresh CI run, and Git history alone do
not prove a migration was never applied in a persistent environment.

## Read-only operator verification procedure

An authorized operator or DBA must perform these checks separately for every actual local,
development, staging, production, and CI database that may have been targeted. Use an organization-
approved libpq service entry named `medora-audit-readonly`, configured for the intended database and
a read-only role; keep passwords in the approved passfile/secret mechanism, not in command arguments.
Do not print or share the connection string. The session is explicitly read-only and ends with
`ROLLBACK`.

### 1. Confirm the connected database and migration-table location

Run with `psql` or an equivalent SQL client. If identity or read-only state is unexpected, stop and do
not run the remaining queries against that connection.

```sh
psql "service=medora-audit-readonly" -X -v ON_ERROR_STOP=1 <<'SQL'
BEGIN TRANSACTION READ ONLY;
SELECT current_database() AS database_name,
       current_user AS database_role,
       current_schema() AS current_schema,
       current_setting('server_version_num') AS postgres_version_num,
       current_setting('transaction_read_only') AS transaction_read_only;
SELECT to_regclass('public._prisma_migrations') AS prisma_migrations_table,
       to_regclass('public.hospitals') AS hospitals_table,
       to_regclass('public.hospital_locations') AS hospital_locations_table,
       to_regclass('public.clinics') AS clinics_table;
ROLLBACK;
SQL
```

Record the environment label, database name, server version, read-only state, and object-presence
results. Do not record a connection URL or secret. If `_prisma_migrations` is present, continue.

### 2. Read the two migration records

```sh
psql "service=medora-audit-readonly" -X -v ON_ERROR_STOP=1 <<'SQL'
BEGIN TRANSACTION READ ONLY;
SELECT migration_name, checksum, started_at, finished_at, rolled_back_at,
       applied_steps_count, logs
FROM public._prisma_migrations
WHERE migration_name IN (
  '20261122150000_hospital_core',
  '20261122160000_facility_foundation'
)
ORDER BY migration_name, started_at;
ROLLBACK;
SQL
```

If the table does not exist, do not run this query. Record that fact as evidence, but classify status
as **unknown** until deployment records, backups/restores, and any out-of-band SQL are reconciled.
Protect `logs`; inspect failure details privately and redact secrets before sharing a summary.

Compare each stored checksum with the SHA-256 of the exact committed file for that migration. For
example, from the reviewed repository checkout:

```sh
sha256sum backend/prisma/migrations/20261122150000_hospital_core/migration.sql
sha256sum backend/prisma/migrations/20261122160000_facility_foundation/migration.sql
```

On PowerShell, use `Get-FileHash <path> -Algorithm SHA256` for each file.

Do not change either migration file to make a checksum match.

### 3. Inspect actual schema objects

Run these catalog queries in a new read-only transaction. They return schema metadata, not patient
records.

```sh
psql "service=medora-audit-readonly" -X -v ON_ERROR_STOP=1 <<'SQL'
BEGIN TRANSACTION READ ONLY;
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('hospitals', 'hospital_locations', 'clinics')
ORDER BY table_name, ordinal_position;

SELECT rel.relname AS table_name, con.conname AS constraint_name,
       con.contype AS constraint_type, pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint AS con
JOIN pg_class AS rel ON rel.oid = con.conrelid
JOIN pg_namespace AS ns ON ns.oid = rel.relnamespace
WHERE ns.nspname = 'public'
  AND rel.relname IN ('hospitals', 'hospital_locations', 'clinics')
ORDER BY rel.relname, con.conname;

SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('hospitals', 'hospital_locations', 'clinics')
ORDER BY tablename, indexname;

SELECT rel.relname AS table_name, trg.tgname AS trigger_name,
       pg_get_triggerdef(trg.oid) AS trigger_definition,
       proc.proname AS function_name,
       pg_get_functiondef(proc.oid) AS function_definition
FROM pg_trigger AS trg
JOIN pg_class AS rel ON rel.oid = trg.tgrelid
JOIN pg_namespace AS ns ON ns.oid = rel.relnamespace
JOIN pg_proc AS proc ON proc.oid = trg.tgfoid
WHERE NOT trg.tgisinternal
  AND ns.nspname = 'public'
  AND rel.relname IN ('hospitals', 'hospital_locations')
ORDER BY rel.relname, trg.tgname;
ROLLBACK;
SQL
```

Compare results to the unchanged SQL in both migration directories. `hospital_core` should create
`hospitals` and `hospital_locations` with the columns, primary/unique/check constraints, foreign key,
and indexes in its file. `facility_foundation` should add `clinics`, add nullable
`hospital_locations.timezone`, and install `validate_facility_iana_timezone()` plus its two triggers.
An object existing by name is not enough; compare its full definition. The second migration is
transaction-wrapped; the first is not.

### 4. Reconcile evidence before classifying

For each environment, compare the database results with deployment/job logs, release records,
operator-maintained migration logs, backups/restores, and any manual SQL history. Record each
migration independently as **applied**, **partially applied**, or **unknown**. Use **never applied**
only when an authorized environment owner can support that conclusion from the complete deployment
and restore history, not merely from absent rows or files. Preserve evidence and do not publish raw
database logs.

## State-specific recovery options (not executed)

| Observed state                                                    | Safe disposition                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Successful history row and all expected objects/definitions match | Treat as applied. Do not replay, edit, or resolve it. Preserve the checksum and history.                                                                                                                                                                                                                                                                                                                                   |
| Successful history row but objects are missing or differ          | Treat as schema/history divergence. Stop automatic migration. Preserve current data; have the DBA and owner review a forward-only repair migration. Never reset or drop objects to force alignment.                                                                                                                                                                                                                        |
| Row with `rolled_back_at` set                                     | Treat it as a historical resolution, not proof that SQL effects are absent. Inspect all attempts and actual schema; if objects remain or evidence conflicts, stop and use the inconsistent-state path.                                                                                                                                                                                                                     |
| Failed/incomplete row and no effects from `hospital_core`         | Do not call this “never applied.” After the operator proves the failed attempt left no schema effects and the owner approves, a reviewed recovery may first resolve that failed attempt as rolled back, then apply the unchanged SQL through a transaction-wrapped procedure, verify the complete catalog, and only then reconcile Prisma history as applied.                                                              |
| Failed/incomplete row and partial `hospital_core` objects         | Do not retry `migrate deploy`; the non-transactional statements may collide with partial objects. Preserve all objects/data and failure logs. Review a forward-only completion plan against exact catalog definitions; only reconcile migration history after the full intended schema is verified and the owner explicitly approves.                                                                                      |
| No migration row and no expected objects                          | Status remains unknown until deployment, restore, and manual-SQL evidence is reconciled. If an authorized owner establishes this is a genuinely new target and approves first application, a transaction-wrapped execution of the unchanged SQL is a proposed operational option; first validate that exact procedure on disposable PostgreSQL 16, then verify the target schema before any Prisma history reconciliation. |
| No migration row but some/all expected objects exist              | Treat as out-of-band or untracked schema. Do not run `migrate deploy` and do not mark applied. Reconcile origin, definitions, and backups; then prepare an owner-approved forward recovery.                                                                                                                                                                                                                                |
| `facility_foundation` failed, with `hospital_core` complete       | Because the facility SQL is wrapped in `BEGIN`/`COMMIT`, its DDL should roll back as one unit on an ordinary SQL failure. Verify that clinics, timezone column, function, and triggers are absent before any retry or history resolution; retain the failure row/logs.                                                                                                                                                     |
| Rows, checksums, and schema disagree or evidence is incomplete    | Unknown/inconsistent. Stop; preserve state and request DBA/owner review. No automatic replay, `migrate resolve`, file edit, or destructive repair.                                                                                                                                                                                                                                                                         |

Any use of `prisma migrate resolve --rolled-back`, `prisma migrate resolve --applied`, transaction-
wrapped SQL application, or a repair migration is a **future database operation**. None is authorized
by this guide. It requires verified environment evidence, a reviewed plan, backup/recovery readiness,
and explicit approval. Since Step 1's file is deliberately unchanged, ordinary `migrate deploy` does
not gain an in-file transaction guarantee; the first-application procedure must be agreed before any
persistent deployment.

## Remaining decision and merge gate

An authorized owner/DBA must provide per-environment status evidence using the procedure above and
decide how to handle a first application of the unchanged, non-transactional `hospital_core` file.
That evidence and decision are unavailable to this repository-only review. Until then, persistent
application status is unknown and PR #5 is not ready for merge approval. No persistent database was
accessed to prepare this guide.
