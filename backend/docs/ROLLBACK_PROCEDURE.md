# Rollback procedure — backend

**Scope.** How to back out a backend release and its database changes, and how to schema-change
safely so that a rollback stays possible. Roadmap item **M36.2** (`BACKEND_IMPLEMENTATION_ROADMAP.md`).
Related: [`PRODUCTION_SETUP.md`](PRODUCTION_SETUP.md) (migration order, envelope key rotation and its
rollback table), [`INCIDENT_RESPONSE.md`](INCIDENT_RESPONSE.md).

> **Status: NOT REHEARSED.** This procedure has not been run on staging. There is no staging
> environment in this repository (M36.1 is open), and nothing below has been run against a production
> database. The roadmap's verify step for M36.2 is "rollback rehearsed once on staging"; it stays open
> until that rehearsal is done and recorded. Treat every step as untested until then.

---

## 1. Roll back, or roll forward?

| Situation                                                                                                                            | Preferred action                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New release breaks requests, but the schema change it shipped is additive (expand phase only)                                        | **Roll back the application** to the previous image (§3). The database stays as it is                                                                                                                         |
| New release breaks requests and it shipped a contract change (a column or table dropped, a rename, a NOT NULL added without default) | Roll **forward**: the previous image cannot be trusted to run against the new shape. Ship a fix, or a corrective forward migration (§5)                                                                       |
| A migration failed part-way (`db:deploy` exited non-zero)                                                                            | Do **not** start the new image. Read the error, fix the cause, and run `npm run db:deploy` again. Prisma does not roll back a failed migration for you; check `npm run db:status` before anything else (§5.3) |
| Data was written wrongly by the new release                                                                                          | Roll forward with a data-correction migration or script. A data restore needs a backup (§4) and is not a routine step                                                                                         |
| Envelope encryption: a value cannot be decrypted                                                                                     | Stop. Do not change `DATA_ENCRYPTION_KEY` (§6). Follow PRODUCTION_SETUP §2.1                                                                                                                                  |

Roll back the application when the schema is still compatible with the previous build. The expand/
migrate/contract rule in §2 exists so that this is the usual case.

---

## 2. Schema changes: expand → migrate → contract

Every schema change that a rollback could meet is split across releases. A single release never
both changes the shape the old code uses and removes the old shape.

1. **Expand (additive migration, release N).**
   - Add the new table, nullable column, index or constraint that is not yet enforced.
   - Do not drop, rename, or tighten (NOT NULL, new unique) anything the release N-1 code reads or writes.
   - The migration header should say it is additive. `prisma/migrations/20261030130000_db_branch_additive_columns/migration.sql`
     is an example: "Additive only. No column, table, index or constraint is dropped or renamed."
   - Migrations are applied by `npm run db:deploy` **before** the new image starts (PRODUCTION_SETUP §1).
     The image does not contain `prisma/`.
2. **Code tolerant of both shapes (release N).**
   - The release N code must work whether or not the new column is populated: read the old shape when
     the new one is empty, and write both where needed.
   - This is what makes the release N image safe to roll back to, and the release N-1 image safe to run
     against the release N schema.
3. **Migrate / backfill (release N, after the schema is in place).**
   - Fill the new shape from the old, in a migration or a reviewed script. Example:
     `prisma/migrations/20261030120000_spec_scalar_lists_not_null/migration.sql` backfills before it
     tightens a column to NOT NULL.
   - Check that the backfill is complete before anything depends on it.
4. **Switch (release N+1 or later).** Code reads and writes only the new shape. The old shape is still in
   the database.
5. **Contract (a later release, after the rollback window).** Drop the old column or table, or add the
   NOT NULL constraint, in a migration of its own. Only when:
   - no running instance, worker, scheduled job or image tag still uses the old shape;
   - the release that needed the old shape is outside the rollback window the owner has agreed;
   - a backup exists (§4).

   Contract is the only step that a rollback of the application cannot undo at the database level.

**Rule of thumb.** If a release's migration removes anything, the previous image cannot be rolled back
to after that release has run, and the release must be rolled forward instead.

---

## 3. Rolling back an application release (without rolling back the database)

1. **Identify the previous image.** The previous image tag is the rollback target. This repository's CI
   does **not** build or push a container image (no `docker build` step in `.github/workflows/`), and no
   registry or tag scheme is defined here. Where the previous tag comes from is an open item (M35.1 /
   M36.1). Record the tag of every release before it ships.
2. **Confirm the schema is compatible** with that image: the migrations since it was built must all be
   expand-phase (§2). If any contract migration has run since, stop and roll forward (§1).
3. **Confirm the envelope write format** (§6). An earlier build cannot read keyed envelopes it was not
   written for.
4. **Start the previous image** with the same environment. Do not change `DATABASE_URL`,
   `DATA_ENCRYPTION_KEY`, `JWT_SECRET` or other secrets as part of the rollback.
5. **Check readiness.** The image's `HEALTHCHECK` calls `GET /api/v1/ready` (`backend/Dockerfile`). Confirm
   `/api/v1/ready` returns 200 and the logs show no error-level lines.
6. **Do not run `db:deploy` on the rollback.** There are no pending migrations for an expand-only release,
   and an older checkout must never be used to run migrations against a newer schema.
7. **Record** the time, the tags used, and the reason, in the incident record (`INCIDENT_RESPONSE.md`).

Rolling back the application does **not** undo applied migrations. That is intended: the expand phase
was written so the old code runs against the new schema.

---

## 4. Data-backup prerequisites — open items

**No backup pipeline exists in this repository.** Two roadmap items own it, and neither is done:

- **M24.5** — backup endpoints. `POST` (manual backup) and `POST …/{id}/restore` are not implemented
  (they answer 501).
- **M38.2** — backup automation and a **restore drill executed**, with a DR runbook (RPO ≤ 24 h, RTO ≤ 4 h).
  Its verify step is "restore drill log committed". No such log exists.

Until those are done, before any contract migration, destructive data change, or rehearsal that touches a
real database, the operator must take a backup **outside this repository's tooling**, and confirm it can be
restored. That restore has not been tested. The procedure does not name a backup tool, a storage location or
a retention period, because none is defined in the repository.

Do not treat a database snapshot taken for another reason as a tested backup.

---

## 5. Why there are no down migrations, and how to write a corrective one

### 5.1 No down migrations

Prisma's migration engine applies committed migration folders forward. `prisma migrate deploy` (the
`db:deploy` script) applies pending migrations and does not generate or run an "undo". There is no
`down` file in `prisma/migrations/`, and this repository defines no down-migration tool. `db:reset`
(`prisma migrate reset --force`) drops and recreates the database. **It must never be run against
a production or shared database.**

Do not edit a migration folder that has already been applied anywhere. Prisma records a checksum of each
applied migration; editing one changes what its folder says, and the change will not reach databases
that already applied it. (This is Prisma's documented behaviour; it is not exercised by a test in this
repository.)

### 5.2 Writing a corrective forward migration

When a migration was wrong, and the release that carries it cannot be rolled back:

1. Fix the **schema** in `prisma/schema/` so it describes the state the database must reach.
2. In a development database, generate the migration with `npm run db:migrate` (`prisma migrate dev`).
   Review the generated SQL. Edit the new folder only if it is not yet applied anywhere.
3. Write the **corrective** change as a new, later-timestamped folder that moves the database from the
   bad state to the good one. Hand-written SQL is acceptable for data fixes.
   - Note from the repository: `db:check` ignores the nullability of scalar-list columns in both directions
     (see the header of `20261030120000_spec_scalar_lists_not_null/migration.sql`). A list column's NOT NULL
     needs hand-written SQL and a backfill.
4. Keep it additive where possible, so the release that depends on it can still be rolled back.

### 5.3 Verifying a migration

Run from `backend/`, with `DATABASE_URL` (and `SHADOW_DATABASE_URL` for the drift check) set, as
`prisma.config.ts` reads them:

| Command             | What it checks                                                                                                                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run db:check`  | `prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema --exit-code`. Non-zero exit means the migrations and the schema disagree (drift). CI runs it against a shadow database |
| `npm run db:status` | `prisma migrate status`: which migrations are applied, and whether any are pending or failed. Run it before and after `db:deploy`                                                                         |
| `npm run db:deploy` | `prisma migrate deploy`: applies pending migrations to the target database. Used in CI (against a scratch database) and in production (PRODUCTION_SETUP §1)                                               |

For a corrective migration, the order is: `db:check` (no drift) → `db:deploy` against a freshly created
scratch database → `db:status` (nothing pending or failed) → the backend test suite
(`npm run test`), which includes the migration-dependent e2e specs.

A failed migration (`db:status` shows it failed) must be resolved before any further deploy. Prisma will not
apply later migrations past a failed one. Resolving a failed migration is a database change: take a backup
(§4) and record it in the incident record first.

---

## 6. Envelope encryption: `DATA_ENCRYPTION_KEY` and the write format

This section summarises `PRODUCTION_SETUP.md` §2 and §2.1. That file is authoritative; read it before any
key or format change. Commands are exactly as documented there.

- **Never roll back by putting the old `DATA_ENCRYPTION_KEY` value back alone.** Values already re-sealed
  under the new key would open under no configured key.
- **Write format.** `DATA_ENCRYPTION_WRITE_FORMAT=legacy` is the default. Both layouts are always read.
  A build from before the keyring reads only the legacy layout. So:
  - rolling back to an earlier build is safe only while every stored envelope is legacy, and no
    `DATA_ENCRYPTION_KEY_PREVIOUS` rotation is in progress;
  - leaving phase 2 (`keyed`): set `legacy` on every instance, then run
    `npm run crypto:reencrypt -- --confirm` until it exits **0**, then deploy the earlier build.
- **Rotation rollback.** The table in PRODUCTION_SETUP §2.1 ("Rollback") is the procedure. It starts from
  "K1 current, K2 previous" and re-seals with `--confirm` until exit 0.
- **Preview first.** `npm run crypto:reencrypt -- --dry-run` writes nothing and is not audited. A dry run
  never authorises retiring a key.
- **Exit 0 is point-in-time.** Before retiring a key, the preconditions in PRODUCTION_SETUP §2.1 (R1) must
  hold. A clean run alone is not enough.
- **Unreadable values** are never overwritten. Their row ids are printed. Find the key that can read them
  before dropping any key.

The rotation and its rollback are not rehearsed on staging either.

---

## 7. Checklist

**Before a release that changes the schema**

- [ ] The migrations are expand-phase only, or the release is planned as a roll-forward.
- [ ] Release N code tolerates both the old and the new shape.
- [ ] The previous image tag is recorded (§3.1).
- [ ] `npm run db:check` passes (no drift).
- [ ] `npm run db:deploy` was run against a scratch database and `npm run db:status` is clean.
- [ ] No contract step is in this release, or the backup in §4 exists and its restore is known to work.

**Before rolling back the application**

- [ ] The reason and the decision (roll back vs roll forward, §1) are recorded.
- [ ] Every migration since the target image is expand-phase (`db:status` lists them; read their SQL).
- [ ] Envelope write format is legacy, or no earlier build is needed (§6).
- [ ] Secrets and `DATABASE_URL` are unchanged.
- [ ] The previous image starts and `GET /api/v1/ready` returns 200.
- [ ] `db:deploy` is **not** run for the rollback.

**Before any database change against production**

- [ ] Owner authorisation is recorded. Nothing here authorises production work by default.
- [ ] A backup exists outside this repository's tooling, and its restore is tested (§4, open: M24.5 / M38.2).
- [ ] `db:reset` is not used.

**After a rollback or a corrective migration**

- [ ] `db:status` shows nothing pending or failed.
- [ ] The incident record names the tags, the migrations applied, and the time.
- [ ] A rehearsal is scheduled (M36.2 verify step). It is not recorded as done until it is.

---

## 8. Not verified

- **Rehearsal.** Nothing in this document has been run on staging. No staging environment exists.
- **Image registry and tags.** No image build or push appears in `.github/workflows/`. The tag scheme is not
  defined.
- **Backups.** No backup tool, location, retention or restore test exists in the repository (§4).
- **Prisma 7 behaviour** described in §5.1 (no down migrations, checksum of applied migrations) is Prisma's
  documented design. It is not covered by a test in this repository.
- **Production.** Nothing has been run against a production database.
- **Phase 21 recovery (§9).** The Prisma 7 transaction behaviour in §9.1 was measured on a disposable
  PostgreSQL 16 database. The restore and index-restoration steps in §9.4–§9.5 have **not** been rehearsed.

---

## 9. Phase 21 — multi-hospital data model: recovery strategy

Applies to `20261122150000_hospital_core`, `20261122160000_facility_foundation`,
`20261122170000_phase21_data_model`, `20261123100000_fix_scoped_clinical_link_trigger`,
`20261123120000_drop_audit_events_hospital_fkey`, `20261123120100_one_active_staff_affiliation` and
`20261123130000_queue_hospital_ownership`. Their
persistent-environment status is **unknown** (`docs/multi-hospital/PR5_MIGRATION_STATUS_AND_RECOVERY.md`);
verify it per environment, read-only, before any step below. Locking and duration are analysed in
`DATABASE_ARCHITECTURE.md` (*Migration safety and locking*).

### 9.1 Before deploying

- **Backup.** Take a full backup immediately before `db:deploy` and confirm it restores (§4 — no tooling
  exists here, so this is an operator step). It is the only complete way back from §9.3's irreversible items.
- **Deploy all four together**, in order. `20261122170000` alone leaves `validate_scoped_clinical_links()`
  broken: every INSERT or watched UPDATE on `medical_records`, `patient_vital_signs`, `prescriptions`,
  `patient_medications`, `patient_studies` and `notifications` fails until `20261123100000` is applied.
- **Prisma 7 does not add a transaction around a migration file** (measured: without `BEGIN`, a failing
  statement left the earlier ones committed and the migration recorded as failed, P3018). `facility_foundation`
  and `phase21_data_model` carry their own `BEGIN; … COMMIT;`, so a failure rolls each back completely
  (measured with a wrapped probe); `hospital_core` does not, and can be left partially applied. In every case
  the failed migration stays recorded in `_prisma_migrations` and blocks later deploys until resolved.
- Set `lock_timeout` for the deploy session so a blocked DDL statement fails instead of stalling traffic.

### 9.2 Reversible (additive) changes

These add structure only and can be dropped by a reviewed corrective migration **as long as no row uses
them**:

- New tables: `hospitals`, `hospital_locations`, `clinics`, `hospital_departments`, `clinic_operating_hours`,
  `doctor_employments`, `hospital_staff_affiliations`, `hospital_role_assignments`, `hospital_medical_records`,
  `hospital_medical_record_conditions`, `published_slots`, `hospital_insurance_coverage`.
- New nullable columns (`hospital_id`, `hospital_medical_record_id`, `doctor_employment_id`,
  `published_slot_id`, department/affiliation references) on 24 existing tables (plus `hospital_id` on
  `queue_entries` and `waiting_room_entries`, `20261123130000`, with its two validation functions and four triggers), with their CHECKs,
  composite foreign keys, indexes and triggers, and the trigger functions.

Order for removal, if ever required: triggers → functions → foreign keys and CHECKs on existing tables →
added columns → new tables, children before parents (`hospital_medical_record_conditions`,
`hospital_role_assignments`, `published_slots` … before `hospital_medical_records`, `doctor_employments`,
`hospital_departments`, `clinics`, `hospital_locations`, `hospitals`). Every foreign key here is
`ON DELETE RESTRICT`, so a remaining row blocks the drop instead of cascading — that is intended.

### 9.3 Irreversible or data-sensitive changes

- **Hospital-scoped rows written after deploy.** Any row with a non-NULL `hospital_id`,
  `hospital_medical_record_id` or `doctor_employment_id`, and every row in the new tables, is real data.
  Dropping the columns or tables destroys it. **Never contract while such rows exist**; export them and
  get owner approval first.
- **Unique-index swaps.** `20261122170000` drops four global unique indexes and replaces each with a pair of
  partial indexes (legacy rows / hospital-scoped rows):

  | Dropped | Replaced by |
  |---|---|
  | `patient_allergies_patient_id_allergen_key (patient_id, allergen)` | `patient_allergies_legacy_unique`, `patient_allergies_hospital_unique (hospital_medical_record_id, allergen)` |
  | `staff_shift_assignments_staff_id_kind_key (staff_id, kind)` | `staff_shift_assignments_legacy_unique`, `staff_shift_assignments_hospital_unique (staff_id, hospital_id, kind)` |
  | `doctor_availability_doctor_id_weekday_start_time_key` | `doctor_availability_legacy_unique`, `doctor_availability_employment_unique (doctor_employment_id, …)` |
  | `rooms_name_key (name)` | `rooms_legacy_name_key`, `rooms_hospital_name_key (hospital_id, name)` |

  After deploy, the same patient may legitimately hold the same allergen once per hospital record, a staff
  member the same shift kind at two hospitals, and two hospitals a room with the same name. **Recreating an
  original global index fails on those duplicates**, and resolving them means deleting or merging clinical
  and operational rows. See §9.5.
- **Trigger side effects.** Ending an employment or affiliation revoked the role assignments it sourced
  (`revoke_ended_hospital_affiliation_roles`). Removing the trigger does not un-revoke them; revocations are
  history and must not be reversed by a schema rollback.
- **`audit_events.hospital_id`.** The ledger has no DELETE path (ADR-024); a dropped column cannot be
  re-populated. Treat it as contract-only, after owner review. Its foreign key was removed by owner
  decision (`20261123120000`, ADR-024 §3) and must not be re-added as a recovery step.
- **One active staff affiliation (`20261123120100`).** Dropping
  `hospital_staff_affiliations_one_active_per_staff_key` is structurally reversible but re-opens a rule
  the owner approved (MRD-05 (a)); re-creating it fails while any staff member has two active
  affiliations. If the migration itself fails with the `MRD-05 (a)` error, nothing was created: resolve
  the listed staff by owner decision, `prisma migrate resolve --rolled-back` it, and deploy again. Never
  end an affiliation to make it pass; ending one revokes the roles it sourced.
- **Ownership keys are immutable in place** (`prevent_tenant_scope_reassignment`,
  `prevent_attached_file_reassignment`). A wrongly assigned hospital cannot be corrected by `UPDATE`; it
  needs a separately reviewed correction process. Do not disable the triggers to "fix" data.
- **Legacy rows were not assigned a hospital** by these migrations, and must not be assigned one by guessing
  during recovery.

### 9.4 Recovery sequencing

1. **Stop and classify.** `npm run db:status` (read-only) on the affected environment. Record which of the
   four migrations are applied, failed, or absent. Take a backup of the current state (§4) before changing
   anything.
2. **Failed (`P3018`).** For `facility_foundation` or `phase21_data_model`, confirm none of the file's
   objects exist (its own transaction rolled back), fix the cause, then mark it rolled back
   (`prisma migrate resolve --rolled-back <name>`) and deploy again. For `hospital_core`, which is not
   wrapped, compare the database with the SQL to find which statements committed, then either complete the
   rest by hand under review and `resolve --applied`, or reverse what committed and `resolve --rolled-back`.
   None of these files is idempotent, so never re-run one over a partial state. All of this is a database
   change: owner authorisation and an incident record first.
3. **Applied, application must roll back.** Phase 21 is expand-only for existing code: existing columns,
   identifiers and legacy uniqueness for unscoped rows are preserved. Roll back the **application** (§3)
   and leave the schema in place. Do not drop anything.
4. **Applied, schema must be removed (exceptional).** Only with no hospital-scoped data (§9.3), owner
   approval and a tested backup. Write a corrective forward migration (§5.2) in the §9.2 order, restoring
   the original unique indexes last (§9.5).
5. **Data damaged.** Restore from the pre-deploy backup into a separate database, verify it, then plan the
   cut-over. A restore discards everything written since the backup.

### 9.5 Restoring an original unique index

Before recreating any index from the §9.3 table, check for duplicates read-only, for example:

```sql
SELECT patient_id, allergen, count(*) FROM public.patient_allergies
GROUP BY patient_id, allergen HAVING count(*) > 1;
```

If any row comes back, stop: the duplicates are hospital-owned clinical or operational records, and which
one survives is an owner and clinical decision, not a recovery step. Only with zero duplicates, recreate the
original index (prefer `CREATE UNIQUE INDEX CONCURRENTLY` as its own top-level statement), then drop the two
partial indexes. Recreating it first and dropping the partials second keeps uniqueness enforced throughout.
