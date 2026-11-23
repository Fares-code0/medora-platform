# Migration Safety Audit (WP-6, 2026-11-23)

**Scope:** all 42 migrations in `backend/prisma/migrations/` on `claude/db-phase22-rls-design-and-isolation-tests`
(41 on `main` `ae63773` plus `20261123130000_queue_hospital_ownership` from PR #28). Read-only review plus
disposable PostgreSQL 16.15 runs. **No existing migration was modified.** Applied migrations are immutable
(root `CLAUDE.md`); every finding below is handled forward-only or recorded.

## 1. Results

| Check | Result | Evidence |
|---|---|---|
| Ordering | Timestamp order is the dependency order; no duplicate or out-of-order names | `ls` of the directory; `migrate deploy` applies all in order |
| Fresh installation | **Passes**: all 42 apply on an empty database | `npm run db:deploy` on a fresh `medora_test`; CI does the same on every run |
| Drift | **No difference** between replayed history and the Prisma schema | `npm run db:check` (shadow database) |
| Upgrade from `main` | **Passes**: main's 41 migrations + legacy queue and waiting-room rows, then `20261123130000`; row count and content checksum unchanged, 0 rows assigned an owner, legacy updates still work | PR #28 description; `medora_base` run |
| Data integrity after apply | Base seed and the multi-hospital seed (twice) succeed; the full backend suite passes | gate runs in this package |
| Destructive changes | None unapproved (§2) | statement scan below |

## 2. Statements that drop, rewrite or update data

Scanned with a regex for `DROP TABLE|COLUMN|INDEX|CONSTRAINT|TYPE|TRIGGER|FUNCTION`, `ALTER COLUMN … TYPE / SET NOT NULL`,
`RENAME`, `DELETE`, `TRUNCATE`, `UPDATE`. Ten migrations match; each is classified:

| Migration | Statement | Classification |
|---|---|---|
| `20260826124528_m5_10_platform_audit_triggers` | `UPDATE lab_orders` inside a trigger function | Not a migration-time data change (runs on later writes) |
| `20260901041917_fix_scheduled_report_recipients_text` | `recipients` `CITEXT[]` → `TEXT[]` | Type change; existing values cast and preserved (the file notes the citext array was unusable through the driver). Not binary-coercible, so PostgreSQL may rewrite the table — small table |
| `20260913140000_m12_record_versions` | "rename" in a comment | False positive |
| `20260918130000_m19_5_delivery_sending_state` | `DROP CONSTRAINT notification_deliveries_status_check` | Replaced by a widened CHECK in the same file |
| `20261030090000_admin_bootstrap_invitation` | `invited_by DROP NOT NULL` | Relaxation; no data change |
| `20261030120000_spec_scalar_lists_not_null` | `UPDATE … SET x = '{}' WHERE x IS NULL`, then `SET NOT NULL` | Backfill then tighten, in its own transaction (documented in the file) |
| `20261030130000_db_branch_additive_columns` | `VARCHAR` widenings; `UPDATE appointments` backfills `ends_at`, `completed_at` | Widening is metadata-only in PostgreSQL; backfills derive from existing columns; own transaction |
| `20261113090000_index_review` | `DROP INDEX doctor_availability_doctor_id_weekday_idx` | Redundant index (covered by a unique index); performance only |
| `20261122170000_phase21_data_model` | 4 × `DROP INDEX` of global uniques, replaced by legacy/hospital partial uniques; `UPDATE` inside trigger functions | Uniqueness preserved for legacy rows; restoring the originals is data-dependent (`ROLLBACK_PROCEDURE.md` §9.3, §9.5) |
| `20261123120000_drop_audit_events_hospital_fkey` | `DROP CONSTRAINT audit_events_hospital_id_fkey` | **Owner-approved** (Decision 1, ADR-024 §3); column, index, trigger kept |

## 3. Transactions and partial failure

Prisma 7 runs a migration file **without** a wrapping transaction (measured; `DATABASE_ARCHITECTURE.md`).
Only **6 of 42** files carry their own `BEGIN … COMMIT` (`spec_scalar_lists_not_null`,
`db_branch_additive_columns`, `facility_foundation`, `phase21_data_model`, `one_active_staff_affiliation`,
`queue_hospital_ownership`). The other 36 are Prisma-generated or single-statement: a failure part-way
leaves earlier statements committed and the migration recorded as failed (P3018), to be resolved by hand
(`ROLLBACK_PROCEDURE.md` §5.3, §9.4). Recommendation for **new** hand-written migrations: wrap them in
`BEGIN … COMMIT` unless they need `CREATE INDEX CONCURRENTLY` (which cannot run in a transaction).

## 4. Locking and downtime

- No migration uses `CREATE INDEX CONCURRENTLY` or `NOT VALID`: every index build blocks writes and every
  validated FK/CHECK scans its table under lock. On the current data volume this is short; on a large
  production copy it must be measured.
- `20261122170000_phase21_data_model` is the heaviest: 24 tables altered inside one transaction, so their
  locks (mostly `ACCESS EXCLUSIVE`) are held until its `COMMIT` (`DATABASE_ARCHITECTURE.md`, "Migration
  safety and locking").
- `20261123130000_queue_hospital_ownership` touches two small tables: one FK validation and two index
  builds each.
- Recommended for production: rehearse on a restored copy, run in a maintenance window, set `lock_timeout`
  for the deploy session, take a verified backup first (`ROLLBACK_PROCEDURE.md` §9.1).

## 5. Rollback limitations

No down migrations exist (`ROLLBACK_PROCEDURE.md` §5.1). Irreversible or data-sensitive items:
the Phase 21 unique-index swaps, hospital-scoped rows written after deploy, trigger side effects (role
revocations), and the dropped audit FK (must not be re-added). Additive changes (new tables, nullable
columns, the queue ownership columns) are reversible by a corrective migration while no row uses them.

## 6. Open items

- Persistent-environment status of the hospital migrations is unknown (`PR5_MIGRATION_STATUS_AND_RECOVERY.md`).
- Owner decision 4 (Phase 21): consolidating the corrective trigger migration — only after every
  environment is verified.
