# Database Branch Reconciliation — `database/` against `backend/prisma/`

**Audited:** 2026-10-30 · `backend` @ `c93c233` · `Database` @ `7833bda` (its `database/` content is `f8c9b76`, 2026-09-03) · `main` @ `64dff33`

**Method:** every artifact was loaded into a disposable local PostgreSQL 16.15 and compared through `information_schema` and `pg_catalog`, not by reading DDL text. No shared, staging or production database was touched. The account's Supabase connector lists no projects, and the repository holds no credentials for any hosted database.

**Question:** a report said the Database Engineer delivered about 96 tables while the backend's Prisma schema has about 16.

**Instruction:** the Database Engineer's design is the source of truth. Integrate it into Prisma and the migrations. Preserve its tables, relationships, constraints, types and rules unless a documented conflict requires clarification.

---

## 1. Verdict

**The table gap does not exist.** All 97 tables in `database/medora.dbml` were already in the Prisma schema before this change. The difference was in **columns**: 39 of the design's 867 columns were missing. This change adds the **23** that add to the schema without contradicting anything. The other **16** are renames or restructures that the written dictionary decides the other way, and they are left for the owners (§7).

| Thing counted                                      |              Before |               After | Notes                                                            |
| -------------------------------------------------- | ------------------: | ------------------: | ---------------------------------------------------------------- |
| Tables in `database/medora.dbml`                   |                  97 |                  97 | Loads cleanly; "about 96"                                        |
| …of which present in the database Prisma builds    |              **97** |              **97** |                                                                  |
| `CREATE TABLE` statements in `database/schema.sql` |                  89 |                  89 | Creates only 60 on a clean database (§6)                         |
| Prisma models on `backend`                         |             **111** |             **111** | 97 design tables + 14 decided additions (§3.2)                   |
| Base tables the migrations build                   |                 125 |                 125 | 111 models + 13 `audit_events` partitions + `_prisma_migrations` |
| Design columns present (by name)                   |           828 / 867 |       **851 / 867** | The 16 missing are §7 conflicts                                  |
| Prisma migration directories on `backend`          |                  27 |              **29** | +2 in this change                                                |
| Migrations applied on a clean database             |             27 / 27 |             29 / 29 | None pending, failed or rolled back                              |
| Prisma migration directories on `Database`         |                  16 |                  16 | Its history stops at `20260902190000_adr030_patient_user_link`   |
| Enum types · CHECKs · triggers · functions         | 80 · 129 · 78 · 120 | 80 · 131 · 81 · 123 | `medora.dbml` has 0 of each                                      |
| FKs · indexes (excluding partitions)               |           183 · 343 |           187 · 347 | `medora.dbml`: 160 · 136                                         |
| Extensions                                         |                   4 |                   4 | `plpgsql`, `pgcrypto`, `citext`, `pg_trgm`                       |

**Root cause of "16".** Nothing in the repository counts 16 tables or 16 models. The `Database` branch's own `backend/prisma/migrations/` has exactly **16 migration directories**, which most likely were counted as tables. That is an inference about how the number was produced; the measurements above are not.

**Why the model and table counts differ legitimately.** `audit_events` is one model over 13 monthly partitions (ADR-007). `_prisma_migrations` is Prisma's own bookkeeping table. There are no views and no implicit many-to-many join tables: every join table (`role_permissions`, `doctor_specialties`, `patient_chronic_conditions`, …) is an explicit model.

## 2. What the `Database` branch contains

`f8c9b76` (2026-09-03) adds three files under `database/`, which exists on no other branch. PR #94 proposed them and was closed unmerged. **The design has never been merged anywhere.** Its tables were not merged as such either: they already existed through the backend's M5 migrations, dated 2026-08-25/26, which predate the design.

- **`medora.dbml`** is PostgreSQL DDL despite its extension. It is a dbdiagram.io SQL export. It loads with `ON_ERROR_STOP` and is the complete form of the design. It is treated as the authoritative artifact.
- **`schema.sql`** is a partial, hand-written transcription that does not load (§6).
- **`seed.sql`** inserts a few reference rows (§6).

## 3. Tables

### 3.1 In the design, not in Prisma

**None.** All 97 are mapped by a Prisma model through `@@map`. `test/schema-db-branch.e2e-spec.ts` pins the list.

### 3.2 In Prisma, not in the design (14)

Each table traces to an accepted decision. None is an orphan, so none was removed:

| Table                                                                                      | Created by                                    | Authority                                    |
| ------------------------------------------------------------------------------------------ | --------------------------------------------- | -------------------------------------------- |
| `_conventions_reference`                                                                   | `20260814124013_conventions_reference`        | M4.2 infrastructure                          |
| `specialties`, `doctor_specialties`                                                        | M5.1 / M5.3                                   | DB §5 "`specialties` … table required"       |
| `drug_interactions`, `medication_monographs`                                               | M5.5                                          | DB §13 → ADR-010 (IN)                        |
| `patient_doctor_assignments`                                                               | M5.6                                          | DB §13 → ADR-010 (IN); the care-scope anchor |
| `incident_bookmarks`, `notification_deliveries`, `patient_access_grants`, `report_exports` | M5.11                                         | DB §13 → ADR-010 (IN)                        |
| `admin_invitations`                                                                        | `20260906120000_adr035_admin_invitations`     | ADR-035                                      |
| `permission_matrix_state`                                                                  | `20260911090000_m7_4_permission_matrix_state` | M7.4                                         |
| `record_versions`                                                                          | `20260913140000_m12_record_versions`          | M12, BR-DEC-004                              |
| `domain_events`                                                                            | `20260918120000_m19_1_domain_events_outbox`   | M19.1 transactional outbox                   |

## 4. Columns

### 4.1 Integrated by this change (23 columns, 5 widths)

Migration `20261030130000_db_branch_additive_columns` is additive only. Prisma generated the DDL part with `migrate diff --from-migrations`; the triggers, backfill and CHECKs are hand-written, as the repository does for everything Prisma cannot express.

| Table                 | Added from the design                                                                              | How                                                                                                                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `appointments`        | `ends_at`, `completed_at`, `cancelled_at`, `cancelled_by` → `users`, `no_show_at`, `checked_in_at` | **Derived and trigger-maintained** (§4.2). Backfilled from the slot, `appointment_events` and `waiting_room_entries`. `ends_at` is NOT NULL through the CHECK `appointments_ends_at_present`. |
| `visit_types`         | `code` (unique), `description`, `default_duration_min`; `name` 40 → 120                            | Codes, descriptions and durations for Consultation, Follow-up and Emergency are seeded from `seed.sql`. New CHECK `visit_types_default_duration_positive` (DB §9's `duration > 0`).           |
| `chronic_conditions`  | `code` (unique), `description`; `name` 80 → 200                                                    | Codes HTN, DM2 and ASTHMA are seeded from `seed.sql`                                                                                                                                          |
| `insurance_providers` | `code` (unique), `phone`, `website`; `name` 120 → 200                                              |                                                                                                                                                                                               |
| `icd_codes`           | `description`; `code` 10 → 20; `label` 200 → 255                                                   |                                                                                                                                                                                               |
| `resources`           | `department_id` → `departments`, SET NULL, indexed                                                 |                                                                                                                                                                                               |
| `policies`            | `body`, `effective_date`, `author_id` → `users`, `active` (NOT NULL, default true)                 |                                                                                                                                                                                               |
| `document_templates`  | `title`, `body`, `author_id` → `users`                                                             |                                                                                                                                                                                               |

**NOT NULL in the design, nullable here:** the three lookup `code`s, `policies.body`/`effective_date` and `document_templates.title`/`body`. Existing rows have no value, the design's `seed.sql` supplies codes for only 3 of 8 visit types and 3 of 10 conditions, and the administration API does not carry a policy body yet. Making them NOT NULL needs either values for every row or an API change. That is an owner decision (§7, item 6), not something to invent.

**Precision.** The new timestamps are `timestamptz(3)`, the M4.2 convention for every timestamp in this schema (a JavaScript `Date` holds milliseconds). The design leaves PostgreSQL's default precision.

### 4.2 The derived appointment columns

`appointment_events` remains the history (DB §C2). The six columns are the latest answers from that history, stored on the row. Database triggers keep them correct for every writer, so no service code changed:

- `ends_at` is recomputed as `starts_at + duration_min` on every insert and update. A client-supplied value is overwritten.
- `completed_at`, `cancelled_at` and `no_show_at` are stamped by the **transition** into that status. A row _inserted_ already terminal, such as an import, keeps NULL unless the caller supplies the time; no time is invented.
- `cancelled_by` is the `actor_id` of the `appointment_events` row recording the cancellation. `appointments.updated_by` is not used, because it would name the previous writer when a non-user actor cancels.
- `checked_in_at` is the latest _live_ `waiting_room_entries.checked_in_at` for the appointment, recomputed on insert, delete and change of the entry, so a soft-deleted check-in clears it.

**Backfill.** A terminal row with no matching event keeps NULL timestamps, because its real time is unknown. This was verified on a 27-migration database holding appointments in four states.

### 4.3 Shared columns: where Prisma differs from the design and keeps its form

| Difference                                     | Count | Decision                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------- | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `varchar` in the design, native enum in Prisma |    90 | **Kept as enums.** DB §6 and ADR-001…005 fix these vocabularies, and the API, the patient-app parity test and the status triggers depend on them. All 36 string defaults in the design are valid labels of the matching enum, so the two agree on values. Downgrading to `varchar` would discard validation the design does not replace (it has no CHECKs). |
| `json` → `jsonb`                               |     3 | Kept: DB §2 says `jsonb`                                                                                                                                                                                                                                                                                                                                    |
| `varchar[]` → `text[]`                         |     2 | Kept: equivalent in PostgreSQL                                                                                                                                                                                                                                                                                                                              |
| `policies.version` 30 vs 20                    |     1 | Kept: DB §K11 says `varchar(20)`. Listed in §7.                                                                                                                                                                                                                                                                                                             |
| Prisma NOT NULL, design nullable               |    22 | Kept: each matches the dictionary's "Null: no" (B1, B2, A5, I1, K2), the M4.2 audit columns, or the scalar-list fix in §5.3. Every value valid under Prisma is also valid under the design.                                                                                                                                                                 |
| Prisma nullable, design NOT NULL               |     2 | `appointment_reschedule_proposals.proposed_by` and `record_issue_reports.reported_by` are kept nullable. They are SET NULL foreign keys so that history survives the removal of an account (DB §9). Listed in §7.                                                                                                                                           |

## 5. Constraints

### 5.1 Foreign keys

The design has 160 FKs and Prisma now has 187. 149 match by (table, columns → table), and the 4 added here cover `appointments.cancelled_by`, `resources.department_id` and both `author_id`s.

- **Delete behaviour is kept as Prisma has it.** Every FK in the design is `NO ACTION`. Prisma implements DB §9's policy: `CASCADE` for owned satellites, `SET NULL` for optional links and `RESTRICT` for clinical anchors.
- **Three FKs in the design point the wrong way and are not implemented:** `users(id) → doctors`, `users(id) → admin_profiles` and `users(id) → user_credentials`. Together they require every user's id to be a doctor's id, an admin profile's id _and_ a credential's id. That makes it impossible to insert any user whose rows are not all three, which is a dbdiagram `Ref` direction error. Prisma has the intended `doctors.user_id → users` and equivalents.
- **Not implemented, and documented:** `audit_events(actor_id, session_id)` FKs. The table is append-only, partitioned and must outlive what it names (ADR-007). Also `patient_clinical_alerts.created_by`, because the M4.2 convention leaves every `created_by`/`updated_by` unconstrained and the design constrains it on this one table only.

### 5.2 Uniqueness, CHECKs, triggers

Prisma has every unique key in the design except `ai_prompt_templates.key`, a rename of `slug`, which is unique (§7). That count includes the three new `code` keys. `queue_entries(ticket)` is unique per UTC day among live rows in Prisma (`queue_entries_ticket_per_day`), so tickets restart daily, where the design makes a ticket unique forever. Prisma also has what the design omits from the dictionary: the partial uniques "one primary diagnosis", "one primary emergency contact" and "one active insurance" (DB §9), plus `rooms(name)`, `policies(title, version)`, `staff_shift_assignments(staff_id, kind)` and `patients(public_id)`.

### 5.3 A Prisma defect fixed: scalar lists that must be NOT NULL

The comparison flagged `medications.frequencies` and `durations_days`: NOT NULL in the design, nullable in Prisma. DB §F1 agrees with the design. Every list column was then checked against the dictionary, and eleven had the same defect: `doctors.{languages,education,certifications,skills}` (§B1), `admin_profiles.{education,certifications,experience}` (§B2), `medications.{frequencies,durations_days}` (§F1), `staff_members.permissions` (§K2) and `staff_shift_assignments.days` (§K3).

**Cause.** Prisma cannot express a NOT NULL list: `String[]` migrates to a nullable `TEXT[]`. `prisma migrate diff`, and so `npm run db:check`, ignores list nullability in both directions. This was verified with an empty diff after applying `SET NOT NULL` to a probe database. That is why CI never caught it.

**Fix.** Migration `20261030120000_spec_scalar_lists_not_null` backfills NULL to `'{}'`, the column's own default. A NULL `days` mask aborts the migration instead, because it has no neutral value. The migration then sets those eleven plus `scheduled_reports.recipients` NOT NULL. `test/schema-scalar-lists.e2e-spec.ts` pins the nullability of every list column, and `00-conventions.prisma` records the rule.

## 6. `database/schema.sql` and `database/seed.sql`

**`schema.sql`** on a clean database without `ON_ERROR_STOP` produces 30 errors, all `relation "…" does not exist`: `medical_records` ×10, `prescriptions` ×5, `lab_orders` ×5, `departments` ×4, `appointments` ×4 and `files` ×2. It creates 60 of its 89 tables. The causes:

- Forward references: `patient_medications → prescriptions` is the one `CLAUDE.md` already records, and it is not the only one.
- Eight tables are referenced but never created: `chronic_conditions`, `icd_codes`, `insurance_providers`, `visit_types`, `patient_chronic_conditions`, `patient_documents`, `patient_emergency_contacts` and `patient_insurance`.

**`seed.sql`** loads against `medora.dbml`. Against the Prisma schema it fails at its first insert, because `roles.updated_at` is NOT NULL and Prisma's `@updatedAt` is set by the client. It also runs once only: random ids and no conflict handling make a second run fail on the unique codes. What it adds that does not conflict is now in `prisma/seed/` (§4.1). The rest is listed in §7.

## 7. Conflicts that need an owner's decision

These are places where the design and the written dictionary (`frontend/DATABASE_SCHEMA_EXTRACTION.md`, which the M5 schema, the API contract and the frontend were built against) define the same thing differently. Taking the design's side would rename or reshape columns that services, DTOs and the frontend read, so none was changed:

1. **Renames.**
   - `ai_prompt_templates`: `key`/`title`/`prompt`/`category` vs `slug`/`label`/`prompt_text`/`context_mode` (DB §H4).
   - `appointment_events`: `previous_status`/`new_status`/`note` vs `from_status`/`to_status`/`reason`/`detail` (DB §C2).
   - `appointments.cancellation_reason` vs `cancelled_reason` (DB §C1).
   - `rooms.notes` vs `note` (DB §K4).
   - `icd_codes.title` vs `label`.

   Each is mechanically possible as a non-destructive `RENAME COLUMN`, with the Prisma field name unchanged through `@map`, so the API would not change. Of the database functions, only `record_appointment_canceller` (added here) reads one of these columns, and no raw SQL in `src/` does. The blocker is not technical: two documents the project calls approved disagree about the name. The owners should pick one, and the losing document should be corrected.

2. **`staff_shift_assignments` shape.** The design has one row per weekday with `starts_at`/`ends_at`/`active`. DB §K3 has one row per (staff, kind) with a `days boolean[7]` mask, and the administration API returns that mask. This is a restructure with a data migration, not a rename.
3. **`document_templates.active`.** This is `NOT archived`. Two flags for one fact would drift, so it was not added.
4. **Enums vs `varchar`, `NO ACTION` vs DB §9 delete policy, and missing CHECKs** (§4.3, §5.1). Prisma is stricter everywhere. Adopting the design literally would remove validation and would require explicit approval.
5. **Widths and nullability where the dictionary is explicit:** `policies.version` (20 vs 30), `proposed_by` and `reported_by` (§4.3).
6. **Making the new columns NOT NULL** (§4.1). Codes for the remaining 5 visit types, 7 conditions and every insurance provider, and a policy body and effective date in the administration API.
7. **`seed.sql` data that conflicts.**
   - Role codes `ADMIN`/`DOCTOR`/`NURSE`/`PHARMACIST`/`RECEPTIONIST`/`LAB_TECH` vs `admin`/`doctor`/`reception`/`laboratory`/`pharmacy`/`nurse`/`patient`, which the authorization matrix uses.
   - ICD codes `I10`/`E11`/`J45` vs DB §5's `I10`/`E11.9`/`J45.909`.
   - A `Radiology` department.
   - Two insurance providers, where `InsuranceProvider` documents "seeded empty: rows arrive with real clinic data".
8. **The inverted `users` FKs** (§5.1). These should be corrected in `medora.dbml`.
9. **The future of `database/`.** Either regenerate `medora.dbml` from the migrations, so the diagram is the database the application runs, or fix `schema.sql`. This is DATABASE_CHECKLIST G10 / AUDIT_FINDINGS AF-37, and it is `Database`-branch work.

## 8. Migration history and existing databases

- **Identical content on every branch.** Every `migration.sql` on `main`, `Database`, `Ai`, `patient-app` and `frontend` is the same git blob as `backend`'s. Nothing was renamed, edited after sharing or duplicated.
- **Linear history.** Each branch's set is a prefix of `backend`'s: `Database` 16, `patient-app` 19, `main`/`Ai`/`frontend` 23 and `backend` 27, now 29. No branch has a migration `backend` lacks.
- **Clean database:** `migrate deploy` applies 29/29. `migrate status` reports up to date, `db:check` (migrations → schema) reports no difference, a live-database → schema diff is empty, and the seed runs twice idempotently.
- **Upgrading a 27-migration database with data:** both migrations apply. The backfill yields the event times, the canceller and the check-in, and leaves NULL where no evidence exists.
- **Guard path:** a NULL `days` aborts `20261030120000` before anything changes, and Prisma records it as failed (P3018). After the row is fixed, `prisma migrate resolve --rolled-back 20261030120000_spec_scalar_lists_not_null` followed by `migrate deploy` completes it. This was verified end to end.
- **A database built from `medora.dbml` cannot be baselined onto this history.** `prisma migrate diff` from such a database to this schema is a 3,087-line script: 135 `DROP COLUMN`, 124 type changes, 163 dropped constraints and 14 new tables. That count excludes the CHECKs, triggers and functions, which Prisma does not diff. Some of the drops are renames that would lose data. `migrate resolve --applied` or `db push` would hide the difference rather than reconcile it. No such database was found. If one exists, it needs a hand-written, owner-authorised data migration, with a verified backup taken first.

**Before applying these migrations to any shared database:** take a backup. Neither migration drops a column or rewrites existing values. `20261030120000` tightens nullability and backfills NULL lists to `'{}'`. `20261030130000` only adds and widens, then backfills the new columns. Each runs inside an explicit `BEGIN … COMMIT`. `migrate deploy` does not wrap a migration in a transaction itself: a probe migration that failed part-way left its earlier statements applied, and with the explicit transaction it left nothing. `20261030120000` can stop on a NULL shift mask, and recovery is as described above.

## 9. Reproducing this audit

```bash
# A disposable cluster; never a shared database.
git show origin/Database:database/medora.dbml > /tmp/medora.dbml.sql
createdb medora_dbml   && psql -v ON_ERROR_STOP=1 -d medora_dbml -f /tmp/medora.dbml.sql
createdb medora_prisma && DATABASE_URL=postgresql://…/medora_prisma npm --prefix backend run db:deploy
```

```sql
-- Run in both databases and diff the output.
SELECT c.table_name, c.column_name,
       CASE WHEN c.data_type = 'USER-DEFINED' THEN 'enum:' || c.udt_name ELSE c.data_type END,
       c.character_maximum_length, c.is_nullable
FROM information_schema.columns c
JOIN information_schema.tables t USING (table_schema, table_name)
WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
ORDER BY 1, 2;
```
