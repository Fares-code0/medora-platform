# Multi-Hospital — Audit Findings (Current State)

**Re-verified:** 2026-10-07 against `origin/main` @ `033e1d8`, `origin/backend` @ `b259708`,
`origin/frontend` @ `c258d83`, `origin/patient-app` @ `61ba9d3`, and the local checkout.
**Rule:** every finding below describes the repository **as it is**. None is fixed. Each has evidence
an engineer can re-run. The owner-approved target is in `OWNER_DECISIONS.md`; the target architecture
is in `MASTER_PLAN.md`.

> **Revision (2026-10-07, final decisions).** Findings are unchanged where the code is unchanged. Some
> *meanings* changed with the final owner decisions (§2). The target for every finding is now the final
> specification in `OWNER_DECISIONS.md`: Hospital boundary, separate Clinic entity, multiple
> Locations, Platform Admin + Hospital Admin, two cross-hospital paths (grant and Break-Glass),
> doctor-approved documentation into the requesting hospital's record (OQ-01), authorization-bound AI with
> no raw retention, insurance-aware but
> never insurance-restricted discovery, and cross-hospital consultation. **All findings remain OPEN for
> implementation.**

Severity: **S1** blocks a second hospital or is a cross-hospital disclosure path · **S2** must change
before multi-hospital goes live · **S3** cleanup or terminology.

---

## 1. Findings

### Data model

| ID | Finding | Sev | Evidence |
|---|---|---|---|
| AF-01 | **No Hospital entity.** No `Hospital`, employment, location or per-hospital record model; no hospital column on any table. The schema is single-clinic by decision (ADR-018 §1). | S1 | `ls backend/prisma/schema` (13 files); `git grep '^model ' origin/main -- backend/prisma/schema` |
| AF-02 | **Single-clinic scope-out is enforced by a test.** ADR-010 scopes `clinics`/`facilities` out and a spec asserts it. | S1 | `backend/test/schema-adr010.e2e-spec.ts`; `docs/DECISIONS.md` ADR-010, ADR-018 |
| AF-03 | **`Doctor.hospital` is free text** (`String? @db.VarChar(80)`), not a relation. | S2 | `backend/prisma/schema/04-people.prisma` `model Doctor` |
| AF-04 | **Doctor department is single-valued** (`departmentId String?`) and `Department.name` is globally unique. Two hospitals cannot both have "Cardiology". Department ownership must move to Hospital (optionally Clinic), with the doctor's department on the employment. | S2 | `04-people.prisma` `Doctor.departmentId`; `02-lookups.prisma` `Department.name @unique` |
| AF-05 | **`ClinicWorkingDay` is keyed only by weekday** (`day Weekday @id`). One set of opening hours exists for the whole platform. It must be redesigned for Hospital + Clinic + (multiple) Locations, and kept as internal working hours, never as patient inventory (DR-10, OD-06). | S1 | `04-people.prisma` `model ClinicWorkingDay` |
| AF-06 | **Global uniqueness assumes one clinic.** `Patient.mrn`, `Doctor.employeeId`, `StaffMember.email`, `Room.name`, `Holiday(name,date)` are platform-unique. MRNs and employee ids are hospital-issued in reality. `Doctor.licenseNumber` can stay global. | S2 | `@unique` sweep of `backend/prisma/schema/*.prisma` |
| AF-07 | **Patient clinical data is keyed to the global patient**, not to a hospital record: `PatientAllergy` (`@@unique([patientId, allergen])`), `PatientMedication`, `PatientMedicalHistory`, `PatientVitalSign`, `PatientClinicalAlert`, `PatientNote`, `PatientDocument`, `PatientStudy`. Under DR-03/DR-04 these belong to a hospital-specific Medical Record. | S1 | `backend/prisma/schema/05-patients.prisma` |
| AF-08 | **"Medical record" name collision.** `medical_records` (`MR-…`) are encounter documents, several per patient. The owner's "Medical Record" is one per patient per hospital. | S3 | `08-records.prisma` `model MedicalRecord` (patientId, doctorId, appointmentId) |
| AF-09 | **Organization settings are one global slice.** `platform_settings` is keyed by `key`; the seed writes `organization: { name: 'Medora Clinic', … }`. | S2 | `11-platform.prisma` `PlatformSetting`; `backend/prisma/seed/platform-settings.ts` |
| AF-10 | **Working hours ≠ online slots, and only working hours exist.** `DoctorAvailability` is weekday windows (`@@unique([doctorId, weekday, startTime])`). There is no published-slot entity (DR-10). | S1 | `05-patients.prisma` `model DoctorAvailability` |
| AF-11 | **No database protection against double booking.** `appointments` has indexes only; no exclusion constraint or slot uniqueness. | S1 | `07-scheduling.prisma` `model Appointment`; `git grep -i 'exclude\|btree_gist' origin/main -- backend/prisma/migrations` (no match) |
| AF-12 | **Demo data is a single clinic and organization.** One clinic is seeded; the frontend mock issues `clinicId`; `clinic-scope.test.ts` uses synthetic multi-clinic rows because the running app cannot show a second clinic. | S2 | `backend/prisma/seed/*`; `origin/frontend:docs/handoff/clinic-isolation.md` §5 |

### Authorization, session, API

| ID | Finding | Sev | Evidence |
|---|---|---|---|
| AF-13 | **No hospital context in the session.** The access token carries no hospital, employment or membership. | S1 | `origin/frontend:docs/handoff/clinic-isolation.md` §5; `backend/src/modules/auth/**` |
| AF-14 | **Authorization is assignment-anchored**, which conflicts with DR-05/DR-07. `PatientScopeService.canReach` = role is doctor **and** `patient_doctor_assignments` row exists. No hospital predicate. | S1 | `backend/src/shared/authz/patient-scope.service.ts` (M7.2, ADR-022) |
| AF-15 | **Several routes are platform-wide.** Admin staff, rooms, queue, patient directory (`GET /patients`, masked), appointment oversight and reassignment, `/doctors`, `/admin/users`, logs and search answer for the whole platform. | S1 | `origin/frontend:docs/handoff/clinic-isolation.md` §5; `origin/frontend:frontend/FRONTEND_CHECKLIST.md` §9.1 notes |
| AF-16 | **Message-thread authorization gap** (on `backend`, not yet on `main`). `ConversationService.create` accepts any existing user ids as participants and an optional `patientId`. It checks only that the users exist. There is no role, relationship or hospital rule on who may be messaged or which patient may be attached. Reads are participant-scoped. | S1 | `origin/backend:backend/src/modules/messaging/services/conversation.service.ts` `create()` |
| AF-17 | **Frontend clinic scope fails open.** `useClinicScope()` returns `clinicId: user.clinicId ?? null`. Real API sessions carry no `clinicId` (the mock issues it), and `visibleToScope`/`isInScope` treat `null` as "show everything". The doc correctly calls this a display rule, not a boundary, but it is fail-open in live builds. It must **not** become the hospital-isolation mechanism; it is retired in favour of the server-derived active hospital. | S2 | `origin/frontend:frontend/src/features/doctor/clinic/useClinicScope.ts`; `…/shared-domain/clinic-scope/index.ts` |
| AF-18 | **Patient doctor discovery requires sign-in.** `/patient/doctors`, `/patient/doctors/:id` and `/patient/specialties` are `@Authenticated()`. This **matches** DR-09. There is no hospital dimension and no hospital discovery route. | info | `backend/src/modules/doctors/controllers/patient-doctor.controller.ts` |
| AF-19 | **No public routes exist**, which is consistent with DR-09. The 2026-10-06 plan proposed `/public/*` routes; those plans are now rejected. | info | `git grep -l "@Public()" origin/main -- backend/src`: only the auth, admin-invitation, two-factor and health controllers (plus decorator definitions). `patient-doctor.controller.ts` explains why it chose `@Authenticated()` over `@Public()` |
| AF-20 | **No general request rate limiting.** Only per-account login lockout (`login.service.ts`) exists. There is no throttler on discovery or booking routes. ADR-030 records this. | S2 | `origin/main:backend/src/modules/auth/services/login.service.ts`; `docs/DECISIONS.md` ADR-030 security note |
| AF-21 | **Patient booking is incomplete.** The patient app's booking flow, slot picker, confirm and actions are 🟨 over seams. RA-033.1 (patient booking policy) is undecided in `docs/DECISIONS.md`; the final owner decision OD-08 now answers it at model level (published slot, capacity 1). | S1 | `origin/patient-app:patient-app/PATIENT_FRONTEND_CHECKLIST.md` I-03…I-10; `docs/DECISIONS.md` RA-033.1 |
| AF-22 | **No patient availability/slot endpoint.** The doctor side has `/me/time-off`. There is no patient-facing slots route on any branch. | S1 | `git ls-tree -r origin/main -- backend/src` (no slot controller) |
| AF-23 | **Cross-hospital tests do not exist.** ADR-018 §Testing: "No test asserts tenant isolation, because there are no tenants to isolate." | S1 | `docs/DECISIONS.md` ADR-018 |
| AF-24 | **PHI masking is frontend-only.** The clear identifier still reaches the admin client. | S2 | `frontend/FRONTEND_CHECKLIST.md` §7 "Known gaps carried out of Phase C" |
| AF-25 | **`InMemoryPermissionCache` is per-process.** Employment changes must invalidate permissions across instances. | S2 | `backend/src/shared/authz/in-memory-permission-cache.ts`; ADR-030 security note |

### AI

| ID | Finding | Sev | Evidence |
|---|---|---|---|
| AF-26 | **No AI provider is connected.** `AI_GATEWAY` is bound to `UnconfiguredAiGateway` (503 "The AI assistant is not configured"). `AI_PROVIDER`/`AI_API_KEY` are optional env. | S2 | `backend/src/shared/ai/unconfigured-ai-gateway.ts`, `shared/ai/ai.module.ts`, `config/env.schema.ts` |
| AF-27 | **No RAG or vector store.** No embeddings, vector extension or retrieval module on any branch. | S2 | `git grep -i 'vector\|embedding' origin/main -- backend/src backend/prisma` (no AI match) |
| AF-28 | **AI context uses the assignment anchor** (`AiContextService` → `PatientScopeService`). It inherits AF-14 and has no hospital input. It is fail-closed (409/404) and limited to one patient per thread. | S1 | `backend/src/modules/ai/services/ai-context.service.ts` |
| AF-29 | **Doctor AI UI remains mock** even though `/ai/*` exists on `main` (FE-10 Still Mock row 4, finding F40). | S2 | `docs/FE-10-INTEGRATION-STATUS.md`; `frontend/src/features/doctor/ai/service.ts` |
| AF-30 | **Patient AI is UI-only**, "disconnected by construction" (K-02…K-04, L-01). When connected it must use the **same** authorization, isolation and retention model as doctor AI (DR-12). | S3 | `origin/patient-app` commit `57b0607` |
| AF-39 | **AI messages are stored verbatim.** `ai_messages` holds every prompt and completion verbatim (the patient chart is resolved into the system prompt), under soft delete. Normal same-hospital history (C1) may legitimately stay. Once cross-hospital AI exists (OD-05, under a grant or Break-Glass), raw Hospital B context and derived un-approved output (C2) would persist past the authorization, which violates DR-12. Required: data-class tagging (C1/C2), purge or inaccessibility of C2 at authorization end, metadata-only audit. Doctor-approved content saved into the requesting hospital's record (C3) lives in clinical tables (OQ-01) | S1 | `backend/src/shared/ai/ai-transcript.log.ts` (header comment: "`ai_messages` holds every prompt and completion verbatim") |

### Documentation and decisions

| ID | Finding | Sev | Evidence |
|---|---|---|---|
| AF-31 | **Single-clinic ADRs conflict with the owner's decisions.** ADR-018 §1 and ADR-010 (clinics/facilities out) are still Accepted. ADR-022's assignment anchor conflicts with DR-05/DR-07. | S1 | `docs/DECISIONS.md`; `MIGRATION_AND_COMPATIBILITY.md` §1 |
| AF-32 | **The 2026-10-06 realignment used the superseded Organization model.** It has multiple memberships, an active-organization switcher, signed-out discovery and `/public/*` routes. Those docs live on `origin/frontend` and `origin/patient-app` and are not updated by this task (outside its scope). | S2 | `origin/frontend:frontend/FRONTEND_CHECKLIST.md` line 8, ORG-01, §9.1; `origin/patient-app:patient-app/PATIENT_FRONTEND_CHECKLIST.md` line 9, G-11, API-P01–P08; `origin/frontend:docs/handoff/clinic-isolation.md` §1 |
| AF-33 | **ADR number confusion.** The checklists say "next free: ADR-042". The published register ends at ADR-039 (`backend`). ADR-040 and ADR-041 are drafted in `backend/docs/PENDING_ADRS.md`. ADR-042 is free (re-verified 2026-10-07). It is now held as a Proposed draft in `ADR-042-DRAFT.md`, outside the register | S3 | `git grep '^## ADR-' origin/* -- docs/DECISIONS.md`; `origin/backend:backend/docs/PENDING_ADRS.md` |
| AF-34 | **Key backend modules are stranded on `backend`.** `messaging`, `administration` (M23), `platform-settings` (M24), `files` (M25) and the full `reports` controllers are not on `main`, and all are single-tenant. | S2 | `git ls-tree origin/backend` vs `origin/main` for `backend/src/modules/*/controllers` |

### Migration and runtime risks

| ID | Finding | Sev | Evidence |
|---|---|---|---|
| AF-35 | **Migration compatibility risk.** Adding a `NOT NULL` hospital column to ~100 tables needs a default-hospital backfill. `audit_events` is partitioned with a composite key (ADR-024). Global unique indexes must become per-hospital without colliding during backfill. | S1 | ADR-024; AF-06 |
| AF-36 | **Cross-hospital cache/session risk.** Web query keys carry no hospital. The patient app caches discovery results. The server permission cache is per-process. After an employment ends, a stale session or cache could keep serving the old hospital's data. | S1 | `frontend/src/api/query-keys.ts`; AF-25; patient-app `clearPhiCache` |
| AF-37 | **`database/schema.sql` does not load** (on `Database`). It is not a usable migration path. | S3 | CLAUDE.md "`database/schema.sql` does not load as written" |
| AF-38 | **An existing grant model has no hospital dimension.** `PatientAccessGrant` (ADR-010 group 2: grantee user **or whole role**, scope `view`/`reveal_identity`/`manage`, reason, revoked rather than deleted) is a natural precursor of DR-06 grants. As built, a role-wide grant would apply across every hospital. | S1 | `backend/prisma/schema/12-adr010.prisma` `model PatientAccessGrant` |
| AF-40 | **No discovery data for OD-10/OD-14.** There are no coordinates on any table (distance impossible). `Doctor.ratingAvg` exists but is never written; `satisfaction_surveys` holds `rating` + free-text `comment`, so review text needs moderation before display. There is no hospital/doctor insurance-coverage model (`InsuranceProvider` and `PatientInsurance` exist; nothing links coverage to hospitals). | S2 | `04-people.prisma` `ratingAvg`; `07-scheduling.prisma` `SatisfactionSurvey`; `02-lookups.prisma` `InsuranceProvider`; `05-patients.prisma` `PatientInsurance` |

---

## 2. Findings whose meaning changed with the owner decisions

| Finding | Earlier plan | Final position (2026-10-07) |
|---|---|---|
| AF-18 sign-in for discovery | 2026-10-06: a gap, discovery should be public | **Correct as is** (DR-09). Discovery needs hospital, clinic, location, distance, ratings and insurance, not de-authentication |
| AF-19 no public routes | 2026-10-06: build `/public/*` | **Stays that way** (DR-09) |
| AF-20 rate limiting | Prerequisite for public routes | Recommended for authenticated discovery and booking. TECHNICAL RECOMMENDATION |
| AF-14 / AF-28 assignment anchor | Keep, plus an organization predicate | **Redesign:** active hospital + role + permissions (DR-05); assignment is workflow only (DR-07) |
| AF-16 messaging gap | Messaging scope undecided | Close it for in-hospital threads; cross-hospital communication only through audited **consultations** (OD-13) |
| AF-38 `PatientAccessGrant` | — | Becomes (or is replaced by) a purpose-bound, category-limited, hospital-aware grant (DR-06). Break-Glass sessions are a separate entity (OD-04) |
| AF-39 AI message storage | Earlier revision: AI never uses granted data, so storage was irrelevant | **Now critical:** AI may use data authorized by a grant or Break-Glass (OD-05), so C1/C2/C3 retention controls are mandatory before G-5 |
| AF-40 discovery data | Distance "not planned" | **In scope** (OD-10): coordinates, ratings/reviews, insurance coverage (OD-14) |
| D-27b "one doctor, one primary clinic" | Superseded by multi-membership (2026-10-06) | Close to DR-02 again: one active **hospital** employment; clinic is an attribute |

---

## 3. Terminology audit

Classes:
- **(1) historical evidence:** keep;
- **(2) superseded assumption:** keep for history, never build;
- **(3) valid subordinate concept;**
- **(4) current target architecture.**

| Term / phrase | Where | Class | Treatment |
|---|---|---|---|
| "organization" as the boundary, "organization-scoped", organization admin | `origin/frontend` checklist (2026-10-06 notes, §9.1), `origin/patient-app` checklist, audit, ARCHITECTURE, PUBLIC_PROJECTIONS, `origin/frontend:docs/handoff/clinic-isolation.md` | (2) | Superseded by Hospital (DR-01) and Platform Admin + Hospital Admin (OD-07). Those files are outside this documentation's scope (AF-32) |
| "organization" in `docs/work-phases/` | correction notes in Phases 20–31 and realignment notes in historical phases | (1)/(2) | Kept only as labelled history |
| `organization` platform-settings slice (`'Medora Clinic'`) | seed, admin "Organization" panel | (1) | Becomes default-hospital profile + platform settings |
| "organization switcher", "active organization", "hospital switcher" | ORG-01, API-W01, earlier Phase 22/25 | (2) | Forbidden (DR-08) |
| "memberships", "affiliations[]" | API-W01, API-W03 | (2) | Replaced by one active employment + history (DR-02) |
| "public / signed-out discovery", `/public/*` | patient-app G-11, E-01, H-06, API-P01–P08; earlier Phase 23/27 | (2) | Forbidden (DR-09) |
| "computed slots", "availability − time-off − booked − buffer" | API-P11, patient-app I-04, earlier Phase 24 | (2) | Superseded by doctor-published slots (DR-10) |
| "assignment is the anchor" | ADR-022, M7.2, `PatientScopeService` | (1)/(2) | Superseded as the universal rule (DR-05, DR-07) |
| "AI never uses cross-hospital data, even under a grant" | earlier revision of this folder (DR-12, G-5, N-6) | (2) | **Superseded** by OD-05: authorization-bound use (grant or Break-Glass), no raw retention |
| "Break-Glass not approved", "every cross-hospital access requires Hospital Admin approval" | Rev. 3 of this folder (OD-04, MASTER_PLAN, checklists, Phase 22A) | (2) | **Superseded** by OD-04 = A: Break-Glass exists as the emergency path |
| "cross-hospital information cannot be documented into the requesting hospital's record" | Rev. 3 safe default (AI-drafted notes excluded cross-hospital content) | (2) | **Superseded** by OQ-01 = A: selective, doctor-approved documentation with provenance |
| "Location" | API-P02/P11/P12, ORG-02 | (3)/(4) | A subdivision of a Hospital; **multiple per hospital in v1** (OD-06); never a boundary |
| "Clinic", `clinicId`, "Our Clinic", `ClinicWorkingDay` | D-27b, frontend mock, schema, patient-app H-01 | (1) → (3)/(4) | Clinic is now a **separate entity inside a Hospital** (OD-06), never the boundary. Today's names are single-clinic implementation history |
| "one location per hospital" | not claimed anywhere current | — | Forbidden by OD-06 |
| "no insurance → no discovery" | not claimed anywhere | — | Forbidden by OD-14 |
| "Platform Admin sees all clinical data" | not claimed anywhere | — | Forbidden by OD-07 |
| "shared Medical Record", "shared safety summary" (API-W04) | `origin/frontend` §9.1 | (2) | Replaced by the grant (DR-06) |
| "multi-clinic" | D-27b, 2026-10-06 | (1) | Historical; the owner's term is multi-hospital |
| "Hospital" | owner decisions, this folder | (4) | Canonical boundary term (`Doctor.hospital` free text is historical, AF-03) |
| "tenant", "multi-tenant" | ADR-018, ADR-010 | (1)/(2) | Medora's tenant concept is the Hospital |
