# Phase 22 — PostgreSQL Row-Level Security: Design, Coverage and Readiness

**Status:** DESIGN — **not activated.** No migration enables RLS or creates a policy. The proposed
policies live in `backend/prisma/rls-proposal/phase22-rls-proposal.sql` (not a migration) and are
exercised only by `backend/test/rls-proposal.e2e-spec.ts`, inside transactions that are always rolled
back. **Owner:** database engineering. **As of:** 2026-11-23, `main` `ae63773`.

RLS is defence in depth behind the application's hospital-scoped authorization (SECURITY_AND_DATA_ISOLATION
§2, gate G-8). It does not replace Phase 22 enforcement in the Backend, which is also not complete.

## 1. Verified starting point (PostgreSQL 16, fresh `db:deploy` of 41 migrations)

| Fact | Evidence |
|---|---|
| No table has RLS enabled; no policy, no view, no `SECURITY DEFINER` function exists | `pg_class.relrowsecurity` 0 of 124 tables; `pg_policies` empty; `pg_views` 0; `pg_proc.prosecdef` none |
| The application connects as the **owner of every table** | `pg_tables.tableowner = medora` for all 138 public tables (incl. partitions) |
| In CI and Compose that role is a **superuser** | `pg_roles.rolsuper = true` for `medora` (the postgres image's `POSTGRES_USER`) |
| Consequence | A superuser bypasses RLS always, even with `FORCE ROW LEVEL SECURITY`; a non-superuser owner bypasses it unless `FORCE` is set. **No policy can protect anything until the application uses a separate non-owner, non-superuser role.** Proven by test 10 |
| Migrations and seeds run as the same role | `npm run db:deploy`, `db:seed` use `DATABASE_URL` |

## 2. Tenant-context requirements (contract to be agreed with Backend)

The Backend↔PostgreSQL contract is **not decided**; the GUC name `app.hospital_id` in the proposal is a
placeholder. Whatever is chosen must satisfy, and the tests prove why:

1. **Transaction-local only** (`set_config(name, value, true)` / `SET LOCAL`). A session-level setting
   survives on a pooled connection into the next request (test 8).
2. **Set inside the same transaction as the queries it scopes.** With Prisma's driver adapter, a query
   outside an explicit transaction runs on whichever pooled connection is free; the setting must be
   applied in an interactive `$transaction` that wraps the request's database work.
3. **Fail closed.** Missing, empty or malformed context resolves to NULL and matches no row (test 9).
4. **Server-derived.** The value comes from the Backend's resolved hospital context (Phase 22), never
   from a client.
5. **One hospital per session.** Doctors have at most one active employment and staff at most one
   active affiliation (DR-02, MRD-05 a), enforced by unique indexes (test 7), so resolution cannot be
   ambiguous. Hospital Admins with more than one hospital are unresolved by design.

## 3. Coverage inventory (124 tables, from the catalog)

Legend — **H** `hospital_id` column, **R** `hospital_medical_record_id`, **P** `patient_id`, **D** doctor/employment.

### 3.1 Clinical, directly hospital-owned (policy: `hospital_id = context`) — 18 tables
`hospital_medical_records` (HP), `appointments`, `lab_orders`, `medical_records`,
`patient_doctor_assignments`, `prescriptions` (HRPD), `ai_conversations`, `conversations`,
`hospital_medical_record_conditions`, `notifications`, `patient_allergies`, `patient_clinical_alerts`,
`patient_documents`, `patient_medical_history`, `patient_medications`, `patient_notes`, `patient_studies`,
`patient_vital_signs` (HRP).

- SELECT/UPDATE/DELETE: `hospital_id = context`. INSERT/UPDATE `WITH CHECK` the same.
- **Legacy rows have `hospital_id IS NULL`** (Phase 21 assigned no owner). Under this policy they are
  invisible to every tenant (test "legacy rows"). Activation needs an owner-approved ownership mapping or
  an explicit legacy policy — **blocker B3**.
- Cross-hospital access is legitimate only through a grant or Break-Glass (DR-06, OD-04), neither built;
  those need their own policies later.
- `notifications` / `conversations` also have user-facing access (the patient app reads its own);
  patient-role sessions need a patient policy, not a hospital one.

### 3.2 Clinical children, ownership derived through a parent (policy: `EXISTS` parent in context) — 29 tables
`record_allergies`, `record_attachments`, `record_diagnoses`, `record_issue_reports`, `record_medications`,
`record_notes`, `record_timeline_events`, `record_treatment_plan_items`, `record_versions` → `medical_records`;
`lab_results`, `lab_specimens`, `lab_attachments`, `lab_timeline_events` → `lab_orders`;
`prescription_history_entries`, `prescription_notes`, `prescription_safety_warnings`,
`prescription_timeline_events` → `prescriptions`; `appointment_events`, `appointment_reschedule_proposals`
→ `appointments`; `ai_messages` → `ai_conversations`; `messages`, `conversation_participants`,
`conversation_shared_links`, `communication_access_requests` → `conversations`; `message_attachments`,
`message_flags` → `messages`; `notification_deliveries` → `notifications`; plus `files` (H) and
`report_exports` (via `files`).

- `EXISTS` policies cost a parent lookup per row; every parent FK is indexed, but list endpoints over large
  child tables should be measured. Denormalising `hospital_id` onto hot children is an option for later.
- Two-level children (`message_attachments` → `messages` → `conversations`) chain two lookups.

### 3.3 Hospital operational data (policy: `hospital_id = context` for staff; separate read policies for discovery) — 17 tables
`clinics`, `clinic_operating_hours` (via `clinics`), `hospital_locations`, `hospital_departments`, `hospital_insurance_coverage`, `rooms`,
`resources`, `staff_shift_assignments`, `hospital_staff_affiliations`, `hospital_role_assignments` (H);
`doctor_employments`, `doctor_availability`, `doctor_time_off`, `published_slots` (HD); `hospitals`
(the tenant table itself); `audit_events`, `domain_events` (H, nullable).

- Patients legitimately read *other* hospitals' `hospitals`, `clinics`, `hospital_locations` and
  `published_slots` (discovery and booking, DR-09/DR-10): those need a separate SELECT policy for the
  patient role, limited to active hospitals.
- `doctor_availability`, `doctor_time_off`, `rooms`, `resources`, `staff_shift_assignments` keep legacy
  rows with no hospital (same B3 question).
- `audit_events` is append-only and partitioned (ADR-024); reading it across hospitals is a Platform
  Admin question (**OD-07**). Inserts must never be blocked by RLS — a failed audit insert loses the event.
- `domain_events` is the outbox, read by workers without a request context (see §5).

### 3.4 Patient-level data without a hospital column — 8 tables
`patients`, `patient_emergency_contacts`, `patient_insurance`, `patient_chronic_conditions` (legacy),
`patient_access_grants`, `satisfaction_surveys`, `queue_entries`, `waiting_room_entries`.

- `patients` and the first three are part of the global identity (DR-03) — visible to any hospital that
  holds a record for the patient; a policy needs `EXISTS hospital_medical_records(patient, context)`.
- **Schema gap:** `queue_entries` and `waiting_room_entries` are hospital operations with **no
  `hospital_id`**. They cannot be isolated until an ownership column is added and backfilled — which
  needs an owner-approved mapping for existing rows (tracked as a database issue).
- `patient_access_grants` and `satisfaction_surveys` need a decision on whether they are hospital- or
  patient-owned.

### 3.5 Global, identity and platform data (no hospital policy) — 52 tables
Reference catalogues (`chronic_conditions`, `icd_codes`, `lab_test_catalogue`, `lab_analyte_specs`,
`medications`, `medication_monographs`, `medication_strengths`, `drug_interactions`, `insurance_providers`,
`specialties`, `visit_types`, `departments`, `holidays`, `clinic_working_days`, `permissions`, `roles`,
`role_permissions`, `permission_matrix_state`, `ai_prompt_templates`, `document_templates`, `policies`,
`announcements`, `platform_settings`, `platform_integrations`, `_conventions_reference`), identity and
per-user data (`users`, `user_*`, `sessions`, `trusted_devices`, `otp_codes`, `verification_tokens`,
`login_events`, `admin_profiles`, `admin_invitations`, `api_keys`, `ai_user_settings`,
`notification_preferences`, `idempotency_records`, `incident_bookmarks`), staff/doctor profiles
(`doctors`, `doctor_specialties`, `doctor_verification_documents`, `staff_members` — global people, hospital membership is via employment/affiliation), and
platform operations (`backups`, `saved_reports`, `scheduled_reports`, `scheduled_report_runs`).

- No hospital policy. Per-user tables could later get `user_id = current user` policies; that is a
  separate, user-scoped design. `departments` and `holidays` are global today; per-hospital variants
  already exist (`hospital_departments`).

## 4. Proposed policy shapes (proven in tests)

| Pattern | Shape | Test |
|---|---|---|
| Direct | `USING / WITH CHECK (hospital_id = app_rls.current_hospital_id())` | 1, 2, 3, 9 |
| Indirect | `EXISTS (SELECT 1 FROM parent p WHERE p.id = fk AND p.hospital_id = ctx)` | 1, 2, 9 |
| Effective employment (DB-1 / F4) | `app_rls.effective_doctor_hospital(user)` — active employment, doctor not soft-deleted and practice not suspended, hospital ACTIVE and not deleted | 4–6 |
| Context accessor | transaction-local GUC; empty / malformed → NULL → no match | 8, 9 |
| Privileged access | none — only the owner/superuser bypass exists; an explicit policy needs OD-07 | 10 |

## 5. Operational paths that must keep working

- **Migrations and seeds** run as the owner role and are unaffected by RLS (owner bypass), which is what
  they need. The application role must be a *different* role for RLS to mean anything.
- **Background jobs and the outbox worker** run without a request: they either use a dedicated role with
  an explicit, audited policy, or run as the owner. Must be decided with Backend (F5 overlaps: a job must
  not inherit a request's context).
- **Audit writes** must never be refused (ADR-024 §4).
- **Patient app** sessions are not hospital-scoped (patient → resource): they need patient policies.

## 6. Activation blockers

| # | Blocker | Owner |
|---|---|---|
| B1 | Tenant-context contract (GUC name, where it is set, transaction wrapping in the Prisma adapter) — #20 | Backend + Database |
| B2 | A non-owner, non-superuser application role and grants, in every environment — #19 | Database + operations |
| B3 | Ownership of legacy rows with `hospital_id IS NULL` (mapping or explicit legacy policy) — #17 | Owner decision |
| B4 | OD-07 — Platform Admin / Hospital Admin access, incl. audit reads — #16 | Owner decision |
| B5 | Patient-role and discovery policies (§3.1, §3.3) — #19 | Database, after B1 |
| B6 | Hospital ownership for `queue_entries`, `waiting_room_entries` — #21 | Database, needs B3-style mapping |
| B7 | Open policy questions in the effective-employment rule: does VACATION, or an unverified doctor (`verification_status`), yield clinical context? The proposal allows VACATION and ignores verification — #18 | Owner decision |

## 7. Rollout plan (once B1–B4 are resolved)

1. Create the application role (no superuser, no BYPASSRLS, not owner); grant table privileges; keep
   migrations on the owner role.
2. Backend sets the context transaction-locally in every request transaction (B1), behind a flag.
3. One migration per pattern: enable RLS + policies, **without FORCE**, table group by table group,
   starting with §3.1; patient and discovery policies before the patient app is affected.
4. Run the isolation suite against the application role in CI; measure `EXISTS` policy cost on list
   endpoints.
5. Only then switch the application's `DATABASE_URL` to the non-owner role. Rollback: switch back to the
   owner role (instant, no data change), then drop policies in a corrective migration.

## 8. Test plan

`backend/test/rls-proposal.e2e-spec.ts` (PostgreSQL 16, disposable `medora_test` only):
1 cross-hospital reads; 2 cross-hospital writes refused (`rowCount 0`, `42501`); 3 appointments;
4–6 effective employment with ended employment, suspended/deleted doctor, suspended/deleted hospital,
history retained; 7 no ambiguous resolution (`23505`); 8 pooled-connection context leak (transaction-local
vs session-level); 9 missing/empty/malformed context; legacy rows invisible; 10 no privileged policy,
owner/superuser bypass even with FORCE. Removing `ENABLE ROW LEVEL SECURITY` from the proposal makes the six
policy-dependent tests fail (verified), so they test PostgreSQL behaviour, not their own fixtures.
