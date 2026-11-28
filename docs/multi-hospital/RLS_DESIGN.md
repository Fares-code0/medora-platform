# Phase 22 — PostgreSQL Row-Level Security: Design, Coverage and Readiness

**Status:** **ACTIVATED** (PR #61). RLS is enabled with policies on **74 tables** by migrations
`20261124130000_rls_enforcement` onward (most recently `20261125101000_rls_idempotency_records_owner`), and
binds the runtime role from `backend/prisma/roles/provision-runtime-role.sql`. The implemented tenant
context is `app.scope` / `app.hospital_id` / `app.user_id` / `app.patient_id`
(`docs/multi-hospital/IMPLEMENTATION_CONTRACTS.md` §6); Appendix A is kept current by
`backend/test/rls-inventory.e2e-spec.ts`. Sections 1–8 below are the **design record**: §1 is the
pre-activation baseline of 2026-11-23, and the proposal file they cite is historical.

*Original status (2026-11-23):* DESIGN — not activated. Companion documents:
[`DATABASE_ROLES.md`](DATABASE_ROLES.md) (runtime role, verified) and
[`RLS_BACKEND_CONTRACT.md`](RLS_BACKEND_CONTRACT.md) (tenant-context contract for #20). The proposed
policies live in `backend/prisma/rls-proposal/phase22-rls-proposal.sql` (not a migration) and are
exercised only by `backend/test/rls-proposal.e2e-spec.ts`, inside transactions that are always rolled
back. **Owner:** database engineering. **As of:** 2026-11-23, `main` `ae63773`.

RLS is defence in depth behind the application's hospital-scoped authorization (SECURITY_AND_DATA_ISOLATION
§2, gate G-8). It does not replace Phase 22 enforcement in the Backend, which is also not complete.

## 1. Verified starting point (PostgreSQL 16, fresh `db:deploy` of 41 migrations) — pre-activation baseline, 2026-11-23

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

## 3. Coverage inventory (128 tables, from the catalog)

The authoritative per-table list — class, primary key, ownership path, foreign-key parents, sensitivity,
expected behaviour and whether a policy is required — is **Appendix A**, generated from the catalog and
guarded by a test. The groupings below explain the patterns.

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
- `queue_entries` and `waiting_room_entries` lacked a hospital column; PR #28 (#21) adds a direct,
  nullable `hospital_id`, so Appendix A classifies them as **Direct**. Existing rows stay unowned until
  an approved mapping (#17).
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

The proposal now creates a policy for **every Direct and Indirect table of Appendix A (68 tables)**;
a test asserts RLS is enabled with at least one policy on each. Behaviour is proven per pattern on
representative tables (below), not on each of the 68 individually.

| Pattern | Shape | Test |
|---|---|---|
| Direct | `USING / WITH CHECK (hospital_id = app_rls.current_hospital_id())` | 1, 2, 3, 9 |
| Indirect | `EXISTS (SELECT 1 FROM parent p WHERE p.id = fk AND p.hospital_id = ctx)` | 1, 2, 9 |
| Effective employment (DB-1 / F4) | `app_rls.effective_doctor_hospital(user)` — active employment, doctor not soft-deleted and practice not suspended, hospital ACTIVE and not deleted | 4–6 |
| Context accessor | transaction-local GUC; empty / malformed → NULL → no match | 8, 9 |
| Privileged access | none — only the owner/superuser bypass exists; an explicit policy needs OD-07 | 10 |
| Two-level indirect (`message_attachments`, `message_flags` → `messages` → `conversations`) | `EXISTS` join through both parents | coverage |
| Patient identity (`patients` + 3 children) | SELECT/UPDATE where an HMR exists for the context hospital; **no INSERT policy** (B8) | patient identity |
| Queue records (PR #28) | direct `hospital_id` | queue |
| Concurrency / pooling | transaction-local context on two connections | concurrency suite |

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
| B8 | Creating a patient under RLS: a new patient has no HospitalMedicalRecord at insert time, so no identity policy can admit the INSERT; the flow (create patient + HMR, or a dedicated insert policy) needs a decision | Owner + Backend |
| B9 | The audit partition job needs DDL and cannot run as the runtime role (`DATABASE_ROLES.md` §4) | Database + Backend (decision) |
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

Implemented (PostgreSQL 16, disposable): `rls-proposal.e2e-spec.ts` (16 tests, incl. coverage of all 68
tables, INSERT/DELETE both directions, FK boundary, queue, patient identity, two concurrent connections,
connection reuse), `rls-inventory.e2e-spec.ts` (inventory = catalog), `database-roles.e2e-spec.ts`
(runtime role), `database-statement-timeout.e2e-spec.ts` (7). Removing `ENABLE ROW LEVEL SECURITY` from
the proposal fails the 10 policy-dependent tests (verified). Original plan:

`backend/test/rls-proposal.e2e-spec.ts` (PostgreSQL 16, disposable `medora_test` only):
1 cross-hospital reads; 2 cross-hospital writes refused (`rowCount 0`, `42501`); 3 appointments;
4–6 effective employment with ended employment, suspended/deleted doctor, suspended/deleted hospital,
history retained; 7 no ambiguous resolution (`23505`); 8 pooled-connection context leak (transaction-local
vs session-level); 9 missing/empty/malformed context; legacy rows invisible; 10 no privileged policy,
owner/superuser bypass even with FORCE. Removing `ENABLE ROW LEVEL SECURITY` from the proposal makes the six
policy-dependent tests fail (verified), so they test PostgreSQL behaviour, not their own fixtures.

## 9. Owner decisions still required (no policy is invented meanwhile)

| Table | Holds | Decision needed | Until decided |
|---|---|---|---|
| `satisfaction_surveys` | A patient's rating of a doctor and visit (PHI) | Is a survey owned by the hospital of the appointment it rates (Direct, `hospital_id` + clinical rule), or by the patient (patient-scoped)? And may a doctor see their own ratings only in aggregate (as the dashboard does today)? | No RLS; read only by the doctor dashboard's own-rating histogram (`dashboard.repository.ts`). |
| `patient_access_grants` | A superseded grant model (PHI) | Drop it in the pre-production cleanup (recommended: no code path reads or writes it), or classify it? | No RLS; unused. |
| `domain_events` | Outbox payloads with nullable hospital attribution | Which worker role reads the outbox, and under what policy (#24)? | No RLS; written by the application, read by jobs under `system` scope. |

## Appendix A — Per-table RLS coverage (generated from the PostgreSQL catalog)

Generated from a fresh `db:deploy` of 42 migrations (incl. `20261123130000_queue_hospital_ownership`, PR #28), then updated for the multi-hospital enforcement migrations (`20261124100000`–`20261124130000`: four new tables, `roles.hospital_id`; RLS now **enforced** — see §5 and `rls-runtime-role.e2e-spec.ts`). **128 tables**, each listed once: Direct 37, Global/reference 35, Indirect 33, Internal/system 21, Unresolved 2. `backend/test/rls-inventory.e2e-spec.ts` fails if a table is added, removed or listed twice.

| Table | Class | PK | Ownership path | FK parents | Sensitivity | Expected RLS behaviour | Policy |
|---|---|---|---|---|---|---|---|
| `_conventions_reference` | Internal/system | id | — | — | Operational | No hospital policy; per-user or system access | No |
| `admin_invitations` | Internal/system | id | — | roles, users | Operational | No hospital policy; per-user or system access | No |
| `admin_profiles` | Global/reference | id | — | users | PII | No hospital policy (user-scoped design later where per-user) | No |
| `ai_conversations` | Direct | id | hospital_id | hospital_medical_records, patients, users | PHI | ALL: hospital_id = context (USING and WITH CHECK); legacy NULL rows per #17; plus a patient/participant policy for the patient app | Yes |
| `ai_messages` | Indirect | id | ai_conversations | ai_conversations | PHI | ALL: EXISTS parent row in context hospital (USING and WITH CHECK) | Yes |
| `ai_prompt_templates` | Global/reference | id | — | — | Reference | No policy; read-only reference for the runtime role | No |
| `ai_user_settings` | Global/reference | user_id | — | users | PII | No hospital policy (user-scoped design later where per-user) | No |
| `announcements` | Global/reference | id | — | users | Reference | No policy; read-only reference for the runtime role | No |
| `api_keys` | Internal/system | id | — | users | Secret | No hospital policy; per-user or system access | No |
| `appointment_events` | Indirect | id | appointments | appointments, users | PHI | ALL: EXISTS parent row in context hospital (USING and WITH CHECK) | Yes |
| `appointment_reschedule_proposals` | Indirect | id | appointments | appointments, users | PHI | ALL: EXISTS parent row in context hospital (USING and WITH CHECK) | Yes |
| `appointment_reschedule_requests` | Direct | id | hospital_id (= its appointment's) | appointments, published_slots, users | PHI | SELECT: parent appointment visible and same hospital; INSERT/UPDATE: parent clinically writable; DELETE: system only (migration 20261126100000, ADR-049) | Yes |
| `appointments` | Direct | id | hospital_id | departments, doctor_employments, doctors, hospital_departments, hospital_medical_records, patients, published_slots, users, visit_types | PHI | ALL: hospital_id = context (USING and WITH CHECK); legacy NULL rows per #17 | Yes |
| `audit_events` | Internal/system | id,occurred_at | hospital_id (nullable attribution) | — | Audit | INSERT from any scope, attribution checked (20261125091000); SELECT scoped by hospital (OD-07); no UPDATE/DELETE grant; partitions owner-only with RLS (20261125090000); retention only by the audit maintenance role (20261125100000, H1) | Yes |
| `backups` | Internal/system | id | — | users | Secret | No hospital policy; per-user or system access | No |
| `chronic_conditions` | Global/reference | id | — | — | Reference | No policy; read-only reference for the runtime role | No |
| `clinic_operating_hours` | Indirect | id | clinics | clinics, users | Operational | ALL: EXISTS parent row in context hospital (USING and WITH CHECK) | Yes |
| `clinic_working_days` | Global/reference | day | — | — | Reference | No policy; read-only reference for the runtime role | No |
| `clinics` | Direct | id | hospital_id | hospitals | Operational | ALL for staff: hospital_id = context; plus patient discovery SELECT (active hospitals only) | Yes |
| `communication_access_requests` | Indirect | id | conversations | conversations, users | PHI | ALL: EXISTS parent row in context hospital (USING and WITH CHECK) | Yes |
| `conversation_participants` | Indirect | conversation_id,user_id | conversations | conversations, users | PHI | ALL: EXISTS parent row in context hospital (USING and WITH CHECK) | Yes |
| `conversation_shared_links` | Indirect | id | conversations | conversations, users | PHI | ALL: EXISTS parent row in context hospital (USING and WITH CHECK) | Yes |
| `conversations` | Direct | id | hospital_id | hospital_medical_records, patients | PHI | ALL: hospital_id = context (USING and WITH CHECK); legacy NULL rows per #17; plus a patient/participant policy for the patient app | Yes |
| `departments` | Global/reference | id | — | staff_members | Reference | No policy; read-only reference for the runtime role | No |
| `doctor_availability` | Direct | id | hospital_id | doctor_employments, doctors | Operational | ALL: hospital_id = context (USING and WITH CHECK); legacy NULL rows per #17 | Yes |
| `doctor_employments` | Direct | id | hospital_id | doctors, hospital_departments, hospitals | Operational | ALL: hospital_id = context | Yes |
| `doctor_specialties` | Global/reference | doctor_id,specialty_id | — | doctors, specialties | PII | No hospital policy (user-scoped design later where per-user) | No |
| `doctor_time_off` | Direct | id | hospital_id | doctor_employments, doctors | Operational | ALL: hospital_id = context (USING and WITH CHECK); legacy NULL rows per #17 | Yes |
| `doctor_verification_documents` | Global/reference | id | — | doctors, files, users | PII | No hospital policy (user-scoped design later where per-user) | No |
| `doctors` | Global/reference | id | — | departments, users | PII | No hospital policy (user-scoped design later where per-user) | No |
| `document_templates` | Global/reference | id | — | users | Reference | No policy; read-only reference for the runtime role | No |
| `domain_events` | Internal/system | id | hospital_id (nullable attribution) | hospitals | Audit | Outbox read by workers outside a request; worker role/policy decision (#24) | Worker decision |
| `drug_interactions` | Global/reference | id | — | medications | Reference | No policy; read-only reference for the runtime role | No |
| `files` | Direct | id | hospital_id | hospitals, users | Operational | ALL: hospital_id = context; legacy NULL files need a policy decision (#17) | Yes |
| `holidays` | Global/reference | id | — | — | Reference | No policy; read-only reference for the runtime role | No |
| `hospital_departments` | Direct | id | hospital_id | departments, hospitals | Operational | ALL for staff: hospital_id = context; plus patient discovery SELECT (active hospitals only) | Yes |
| `hospital_insurance_coverage` | Direct | id | hospital_id | hospitals, insurance_providers | Operational | ALL for staff: hospital_id = context; plus patient discovery SELECT (active hospitals only) | Yes |
| `hospital_locations` | Direct | id | hospital_id | hospitals | Operational | ALL for staff: hospital_id = context; plus patient discovery SELECT (active hospitals only) | Yes |
| `hospital_medical_record_conditions` | Direct | id | hospital_id | chronic_conditions, hospital_medical_records, users | PHI | ALL: hospital_id = context (USING and WITH CHECK); legacy NULL rows per #17 | Yes |
| `exceptional_access_grants` | Direct | id | hospital_id | hospital_medical_records, hospitals, patients, users | PHI | ALL: own hospital or own request (requester_user_id = context user); decided by the owning Hospital Admin | Yes |
| `information_requests` | Direct | id | target_hospital_id | hospital_medical_records, hospitals, patients, users | PHI | ALL: target hospital or own request; decided by the owning Hospital Admin | Yes |
| `hospital_medical_records` | Direct | id | hospital_id | hospitals, patients | PHI | ALL: hospital_id = context (USING and WITH CHECK); legacy NULL rows per #17 | Yes |
| `hospital_role_assignments` | Direct | id | hospital_id | doctor_employments, hospital_staff_affiliations, hospitals, roles, users | Operational | ALL: hospital_id = context | Yes |
| `hospital_staff_affiliations` | Direct | id | hospital_id | hospital_departments, hospitals, staff_members | Operational | ALL: hospital_id = context | Yes |
| `hospitals` | Direct | id | id (tenant table) | — | Operational | ALL for staff: hospital_id = context; plus patient discovery SELECT (active hospitals only) | Yes |
| `icd_codes` | Global/reference | id | — | — | Reference | No policy; read-only reference for the runtime role | No |
| `idempotency_records` | Internal/system | id | — | users | PHI (cached responses) | ALL: the caller's own rows (`user_id = app.user_id`) or `system` (the expiry sweep); no context sees nothing (20261125101000, M1) | Yes |
| `incident_bookmarks` | Internal/system | id | — | users | Operational | No hospital policy; per-user or system access | No |
| `insurance_providers` | Global/reference | id | — | — | Reference | No policy; read-only reference for the runtime role | No |
| `lab_analyte_specs` | Global/reference | id | — | lab_test_catalogue | Reference | No policy; read-only reference for the runtime role | No |
| `lab_attachments` | Indirect | id | lab_orders | files, lab_orders, users | PHI | ALL: EXISTS parent row in context hospital (USING and WITH CHECK) | Yes |
| `lab_orders` | Direct | id | hospital_id | departments, doctor_employments, doctors, hospital_departments, hospital_medical_records, lab_test_catalogue, patients, users | PHI | ALL: hospital_id = context (USING and WITH CHECK); legacy NULL rows per #17 | Yes |
| `lab_results` | Indirect | id | lab_orders | lab_analyte_specs, lab_orders, users | PHI | ALL: EXISTS parent row in context hospital (USING and WITH CHECK) | Yes |
| `lab_specimens` | Indirect | lab_order_id | lab_orders | lab_orders, users | PHI | ALL: EXISTS parent row in context hospital (USING and WITH CHECK) | Yes |
| `lab_test_catalogue` | Global/reference | id | — | — | Reference | No policy; read-only reference for the runtime role | No |
| `lab_timeline_events` | Indirect | id | lab_orders | lab_orders, users | PHI | ALL: EXISTS parent row in context hospital (USING and WITH CHECK) | Yes |
| `login_events` | Internal/system | id | — | users | Operational | No hospital policy; per-user or system access | No |
| `medical_records` | Direct | id | hospital_id | appointments, departments, doctor_employments, doctors, hospital_departments, hospital_medical_records, patients | PHI | ALL: hospital_id = context (USING and WITH CHECK); legacy NULL rows per #17 | Yes |
| `medication_monographs` | Global/reference | medication_id | — | medications | Reference | No policy; read-only reference for the runtime role | No |
| `medication_strengths` | Global/reference | id | — | medications | Reference | No policy; read-only reference for the runtime role | No |
| `medications` | Global/reference | id | — | — | Reference | No policy; read-only reference for the runtime role | No |
| `message_attachments` | Indirect | id | messages → conversations | files, messages | PHI | ALL: EXISTS parent row in context hospital (USING and WITH CHECK) | Yes |
| `message_flags` | Indirect | id | messages → conversations | messages, users | PHI | ALL: EXISTS parent row in context hospital (USING and WITH CHECK) | Yes |
| `messages` | Indirect | id | conversations | conversations, users | PHI | ALL: EXISTS parent row in context hospital (USING and WITH CHECK) | Yes |
| `notification_deliveries` | Indirect | id | notifications | notifications | PHI | ALL: EXISTS parent row in context hospital (USING and WITH CHECK) | Yes |
| `notification_preferences` | Global/reference | user_id | — | users | PII | No hospital policy (user-scoped design later where per-user) | No |
| `notifications` | Direct | id | hospital_id | appointments, hospital_medical_records, lab_orders, medical_records, patients, prescriptions, users | PHI | ALL: hospital_id = context (USING and WITH CHECK); legacy NULL rows per #17; plus a patient/participant policy for the patient app | Yes |
| `otp_codes` | Internal/system | id | — | users | Secret | No hospital policy; per-user or system access | No |
| `patient_access_grants` | Unresolved | id | hospital- or patient-owned? (decision with #16/#17) | patients, roles, users | PHI | Superseded by `exceptional_access_grants` / `information_requests`; no code path reads it; no policy — **owner decision required** (§9) | Decision first |
| `patient_account_link_codes` | Internal/system | id | — | users | Secret | No hospital policy; per-user or system access (ADR-048 linking codes, digest only) | No |
| `patient_allergies` | Direct | id | hospital_id | hospital_medical_records, patients, users | PHI | ALL: hospital_id = context (USING and WITH CHECK); legacy NULL rows per #17 | Yes |
| `patient_chronic_conditions` | Indirect | patient_id,condition_id | patients → hospital_medical_records (legacy, global) | chronic_conditions, patients, users | PII/PHI | SELECT where an HMR exists for the context hospital; global identity (DR-03); writes via identity flows | Yes |
| `patient_clinical_alerts` | Direct | id | hospital_id | hospital_medical_records, patients | PHI | ALL: hospital_id = context (USING and WITH CHECK); legacy NULL rows per #17 | Yes |
| `patient_doctor_assignments` | Direct | id | hospital_id | doctor_employments, doctors, hospital_medical_records, patients, users | PHI | ALL: hospital_id = context (USING and WITH CHECK); legacy NULL rows per #17 | Yes |
| `patient_documents` | Direct | id | hospital_id | files, hospital_medical_records, patients, users | PHI | ALL: hospital_id = context (USING and WITH CHECK); legacy NULL rows per #17 | Yes |
| `patient_emergency_contacts` | Indirect | id | patients → hospital_medical_records | patients | PII/PHI | SELECT where an HMR exists for the context hospital; global identity (DR-03); writes via identity flows | Yes |
| `patient_insurance` | Indirect | id | patients → hospital_medical_records | insurance_providers, patients | PII/PHI | SELECT where an HMR exists for the context hospital; global identity (DR-03); writes via identity flows | Yes |
| `patient_medical_history` | Direct | id | hospital_id | hospital_medical_records, patients, users | PHI | ALL: hospital_id = context (USING and WITH CHECK); legacy NULL rows per #17 | Yes |
| `patient_medications` | Direct | id | hospital_id | doctors, hospital_medical_records, patients, prescriptions | PHI | ALL: hospital_id = context (USING and WITH CHECK); legacy NULL rows per #17 | Yes |
| `patient_notes` | Direct | id | hospital_id | hospital_medical_records, patients, users | PHI | ALL: hospital_id = context (USING and WITH CHECK); legacy NULL rows per #17 | Yes |
| `patient_studies` | Direct | id | hospital_id | hospital_medical_records, lab_orders, patients | PHI | ALL: hospital_id = context (USING and WITH CHECK); legacy NULL rows per #17 | Yes |
| `patient_vital_signs` | Direct | id | hospital_id | hospital_medical_records, medical_records, patients, users | PHI | ALL: hospital_id = context (USING and WITH CHECK); legacy NULL rows per #17 | Yes |
| `patients` | Indirect | id | hospital_medical_records (patient_id) — visible where the hospital holds a record | doctors, users | PII/PHI | SELECT where an HMR exists for the context hospital; global identity (DR-03); writes via identity flows | Yes |
| `permission_matrix_state` | Internal/system | id | — | users | Operational | No hospital policy; per-user or system access | No |
| `permissions` | Global/reference | id | — | — | Reference | No policy; read-only reference for the runtime role | No |
| `platform_integrations` | Internal/system | id | — | users | Secret | No hospital policy; per-user or system access | No |
| `ownership_assignments` | Internal/system | id | hospital_id (evidence of an assignment, append-only) | hospitals, users | Operational | ALL: system scope only (backfill evidence); one row per assigned row; filling a legacy NULL `hospital_id` anywhere (except `files` adoption) requires a matching row (20261125102000, M2) | Yes |
| `platform_admin_grants` | Internal/system | id | — (platform scope, OD-07) | users | Operational | ALL: platform or system scope only | No |
| `platform_settings` | Internal/system | key | — | users | Operational | No hospital policy; per-user or system access | No |
| `policies` | Global/reference | id | — | users | Reference | No policy; read-only reference for the runtime role | No |
| `prescription_history_entries` | Indirect | id | prescriptions | prescriptions | PHI | ALL: EXISTS parent row in context hospital (USING and WITH CHECK) | Yes |
| `prescription_notes` | Indirect | id | prescriptions | prescriptions, users | PHI | ALL: EXISTS parent row in context hospital (USING and WITH CHECK) | Yes |
| `prescription_safety_warnings` | Indirect | id | prescriptions | prescriptions, users | PHI | ALL: EXISTS parent row in context hospital (USING and WITH CHECK) | Yes |
| `prescription_timeline_events` | Indirect | id | prescriptions | prescriptions, users | PHI | ALL: EXISTS parent row in context hospital (USING and WITH CHECK) | Yes |
| `prescriptions` | Direct | id | hospital_id | departments, doctor_employments, doctors, hospital_departments, hospital_medical_records, medical_records, medications, patients | PHI | ALL: hospital_id = context (USING and WITH CHECK); legacy NULL rows per #17 | Yes |
| `published_slots` | Direct | id | hospital_id | doctor_employments, hospitals | Operational | ALL for staff: hospital_id = context; plus patient discovery SELECT (active hospitals only) | Yes |
| `queue_entries` | Direct | id | hospital_id | hospitals, patients, rooms | PII/PHI | ALL: hospital_id = context; legacy NULL rows per #17 | Yes |
| `record_allergies` | Indirect | id | medical_records | medical_records | PHI | ALL: EXISTS parent row in context hospital (USING and WITH CHECK) | Yes |
| `record_attachments` | Indirect | id | medical_records | files, medical_records, users | PHI | ALL: EXISTS parent row in context hospital (USING and WITH CHECK) | Yes |
| `record_diagnoses` | Indirect | id | medical_records | icd_codes, medical_records, users | PHI | ALL: EXISTS parent row in context hospital (USING and WITH CHECK) | Yes |
| `record_issue_reports` | Indirect | id | medical_records | medical_records, users | PHI | ALL: EXISTS parent row in context hospital (USING and WITH CHECK) | Yes |
| `record_medications` | Indirect | id | medical_records | medical_records, prescriptions | PHI | ALL: EXISTS parent row in context hospital (USING and WITH CHECK) | Yes |
| `record_notes` | Indirect | id | medical_records | medical_records, users | PHI | ALL: EXISTS parent row in context hospital (USING and WITH CHECK) | Yes |
| `record_timeline_events` | Indirect | id | medical_records | medical_records, users | PHI | ALL: EXISTS parent row in context hospital (USING and WITH CHECK) | Yes |
| `record_treatment_plan_items` | Indirect | id | medical_records | medical_records | PHI | ALL: EXISTS parent row in context hospital (USING and WITH CHECK) | Yes |
| `record_versions` | Indirect | id | medical_records | medical_records, users | PHI | ALL: EXISTS parent row in context hospital (USING and WITH CHECK) | Yes |
| `report_exports` | Indirect | id | files | files, users | PHI | ALL: EXISTS parent row in context hospital (USING and WITH CHECK) | Yes |
| `resources` | Direct | id | hospital_id | departments, hospital_departments, hospitals | Operational | ALL: hospital_id = context (USING and WITH CHECK); legacy NULL rows per #17 | Yes |
| `role_permissions` | Global/reference | role_id,permission_id | — | permissions, roles, users | Reference | No policy; read-only reference for the runtime role | No |
| `roles` | Internal/system | id | hospital_id (custom roles only; system roles NULL) | hospitals, roles | Reference | No hospital policy; custom roles are hospital-scoped by the service (§2.8), system roles are reference data | No |
| `rooms` | Direct | id | hospital_id | departments, hospital_departments, hospitals | Operational | ALL: hospital_id = context (USING and WITH CHECK); legacy NULL rows per #17 | Yes |
| `satisfaction_surveys` | Unresolved | id | hospital- or patient-owned? (decision) | appointments, doctors, patients | PHI | Undecided — no policy until ownership is decided — **owner decision required** (§9) | Decision first |
| `saved_reports` | Global/reference | id | — | users | Reference | No policy; read-only reference for the runtime role | No |
| `scheduled_report_runs` | Internal/system | id | — | scheduled_reports | Operational | No hospital policy; per-user or system access | No |
| `scheduled_reports` | Global/reference | id | — | users | Reference | No policy; read-only reference for the runtime role | No |
| `sessions` | Internal/system | id | — | users | Secret | No hospital policy; per-user or system access | No |
| `specialties` | Global/reference | id | — | specialties | Reference | No policy; read-only reference for the runtime role | No |
| `staff_members` | Global/reference | id | — | departments, users | PII | No hospital policy (user-scoped design later where per-user) | No |
| `staff_shift_assignments` | Direct | id | hospital_id | hospital_staff_affiliations, staff_members | Operational | ALL: hospital_id = context (USING and WITH CHECK); legacy NULL rows per #17 | Yes |
| `trusted_devices` | Internal/system | id | — | users | Secret | No hospital policy; per-user or system access | No |
| `user_activity_log` | Global/reference | id | — | users | PII | No hospital policy (user-scoped design later where per-user) | No |
| `user_credentials` | Internal/system | user_id | — | users | Secret | No hospital policy; per-user or system access | No |
| `user_integrations` | Global/reference | user_id,integration | — | users | Secret | No hospital policy (user-scoped design later where per-user) | No |
| `user_interface_preferences` | Global/reference | user_id | — | users | PII | No hospital policy (user-scoped design later where per-user) | No |
| `user_permissions` | Global/reference | user_id,permission_id | — | permissions, users | PII | No hospital policy (user-scoped design later where per-user) | No |
| `user_settings` | Global/reference | user_id | — | users | PII | No hospital policy (user-scoped design later where per-user) | No |
| `users` | Global/reference | id | — | roles | PII | No hospital policy (user-scoped design later where per-user) | No |
| `verification_tokens` | Internal/system | id | — | users | Secret | No hospital policy; per-user or system access | No |
| `visit_types` | Global/reference | id | — | — | Reference | No policy; read-only reference for the runtime role | No |
| `waiting_room_entries` | Direct | id | hospital_id | appointments, hospitals, patients | PII/PHI | ALL: hospital_id = context; legacy NULL rows per #17 | Yes |
