# Multi-Hospital — Database Checklist

**Owner team:** Database (with Backend review)
**Work phase:** `docs/work-phases/PHASE-21-MULTI-HOSPITAL-DATA-MODEL-AND-MIGRATION.md`; §I also serves
Phases 23, 24 and 28 (patient AI assistant, `BACKEND_CHECKLIST.md` §K)
**Prerequisite:** ADR-042 accepted (Phase 20). All owner decisions needed here are FINAL
(`OWNER_DECISIONS.md`), including OQ-01 = A. The only open item is OQ-02 (record-claim identity
proofing, RA-030.1). It is deferred to implementation and affects claim tooling only.
**Status:** NOT STARTED. Nothing below is implemented.

---

## A. Hospital, Clinics, Locations, employment, admins

- [ ] **A1** `Hospital` — DR-01
- [ ] **A2** `Clinic` as a **separate entity** belonging to one hospital — OD-06
- [ ] **A3** `HospitalLocation`, **multiple per hospital**, with coordinates for distance — OD-06, OD-10
- [ ] **A4** `DoctorEmployment` (`ACTIVE`/`ENDED`, dates, end reason; clinic, department and employee id on the employment) — DR-02, AF-04
- [ ] **A5** At most one active employment per doctor, enforced in the database — DR-02
- [ ] **A6** Employment history retained; no overlapping periods — DR-02, OD-12
- [ ] **A7** Keep `Doctor.licenseNumber` global; retire `Doctor.hospital` free text after backfill (AF-03)
- [ ] **A8** Hospital Admin assignment (one hospital per assignment) and Platform Admin role — OD-07
- [ ] **A9** Re-key `ClinicWorkingDay` to hospital / clinic / location (AF-05); working hours remain internal, never patient inventory — DR-10

## B. Patient identity and per-hospital Medical Records

- [ ] **B1** Global patient identity (today's `Patient`): person-level identity, demographic and contact fields; insurance coverage (recommended) — OD-09, OD-14
- [ ] **B2** `HospitalMedicalRecord (patient, hospital)` unique — DR-03
- [ ] **B3** Hospital record number unique per hospital; retire global `Patient.mrn` uniqueness (AF-06)
- [ ] **B4** Re-home patient clinical tables under the Medical Record (AF-07) — DR-04
- [ ] **B5** Record creation on **first real interaction**; store `openedByInteraction`. The exact trigger is specified in Phase 21/24 — OD-09
- [ ] **B6** Never create records for hospitals the patient has not interacted with — OD-09

## C. Hospital scope propagation

- [ ] **C1** `hospital_id` on every hospital-owned table (`DATA_MODEL_CHANGES.md` §2)
- [ ] **C2** Composite FKs so children share the parent's hospital — DR-04 (structural)
- [ ] **C3** Hospital-scoped `PatientDoctorAssignment` — DR-07
- [ ] **C4** Per-hospital uniques (AF-06); department ownership per hospital/clinic (AF-04)
- [ ] **C5** `HospitalSetting`; `platform_settings` for platform keys only (AF-09)
- [ ] **C6** `AuditEvent.hospital_id` (nullable for platform events), partition-aware (ADR-024)
- [ ] **C7** Hospital-leading indexes

## D. Cross-hospital grants and consultations

- [ ] **D1** Grant entity with: requester and employment, source hospital, target hospital, patient, target record, purpose, requested and approved categories, status, approver, decision time, `endsAt` (required when approved), revocation, closure — DR-06, OD-01, OD-03
- [ ] **D2** `DataCategory` taxonomy aligned with DR-04 — OD-03
- [ ] **D3** Append-only access/lifecycle event log, including `AI_USED` — DR-06 (10), DR-12
- [ ] **D4** Grants become unusable when the requesting employment ends (status `INVALIDATED` or a validity predicate on employment) — OD-12
- [ ] **D5** Extend-or-replace decision for `PatientAccessGrant`; no role-wide cross-hospital grants (AF-38)
- [ ] **D6** `Consultation` and messages, auditable — OD-13
- [ ] **D7** `BreakGlassSession`: required emergency reason, minimum-necessary category scope, one patient, bounded `endsAt`, status, revocation, post-event review; requester's employment must be active — OD-04
- [ ] **D8** `CrossHospitalDocumentationProvenance` for doctor-approved content saved into the **requesting** hospital's record; selective references only, never content copies of the source — OQ-01
- [ ] **D9** **No** patient-consent fields for normal grants (OD-02); no fixed default grant duration (OD-01)

## E. Published slots and booking

- [ ] **E1** `PublishedSlot` (doctor, employment, hospital, clinic?, location?, start, duration, status), capacity 1 — DR-10, OD-08
- [ ] **E2** `Appointment.hospital_id NOT NULL`, `published_slot_id` for online bookings — DR-11
- [ ] **E3** Booked-slot uniqueness and per-doctor overlap exclusion — DR-11
- [ ] **E4** Per-hospital booking-policy storage (implementation policy values) — OD-08
- [ ] **E5** `HospitalInsuranceCoverage` — OD-14

## F. AI storage

- [ ] **F1** `AiConversation.hospital_id`; `AiMessage.data_class` (C1/C2) + `authorization_type?` / `authorization_id?` (AF-39) — DR-12
- [ ] **F2** Purge/redaction support for C2 artefacts at authorization end (grant **or** Break-Glass). C1 keeps normal retention; C3 lives in clinical tables — DR-12, OD-05
- [ ] **F3** Any vector index partitioned by hospital; **no** persistent embedding of cross-hospital content — DR-12

## G. Migration

- [ ] **G1** Default Hospital from the `organization` slice; one default Location; one default Clinic only if operational data needs it
- [ ] **G2** Backfill `hospital_id` everywhere → `NOT NULL`
- [ ] **G3** One active employment per existing doctor at the default hospital
- [ ] **G4** One Medical Record per existing patient at the default hospital (they already interacted with it); re-point clinical rows
- [ ] **G5** **Existing admin accounts mapped deliberately** to Platform Admin or Hospital Admin through an explicit reconciliation list. No default mapping — OD-07
- [ ] **G6** Per-hospital uniques, built before dropping global ones (collision check first)
- [ ] **G7** Down-migrations; rehearsal on a production-like copy (Phase 31)
- [ ] **G8** Replace `schema-adr010.e2e-spec.ts`'s scope-out assertion (AF-02)
- [ ] **G9** Seed for gates (`SECURITY_AND_DATA_ISOLATION.md` §9): two hospitals (≥2 locations and ≥1 clinic each); doctors dA (Break-Glass permission), dA2, dB, dX; patient P with records at A and B; admins aA, aB, pA; insured and uninsured patients
- [ ] **G10** Fix or retire `database/schema.sql` (AF-37)

## H. Row-level security (production gate G-8)

- [ ] **H1** RLS on patient/clinical tables keyed by hospital, context set per transaction — ADR-022 + DR-01
- [ ] **H2** Authorization-aware policy for cross-hospital reads (grant categories and validity, or Break-Glass scope and window) — DR-06, OD-04
- [ ] **H3** AI DB role: no clinical writes (M16.6 / M37.3); reads only through the same hospital/grant policies — DR-12

## I. Patient AI assistant prerequisites (BACKEND_CHECKLIST §K)

**Added:** 2026-10-10. **Status:** NOT STARTED. Nothing below is implemented. This section lists every
persistence prerequisite of the patient assistant (`BACKEND_CHECKLIST.md` §K, `AI_CHECKLIST.md` §6). It
reuses sections A–H wherever a task already exists, and adds a task only where none does. The
cross-team register that maps Backend, Database and AI tasks is `BACKEND_CHECKLIST.md` K.5; the
decisions (KD-x) are K.3.

Status values follow `BACKEND_CHECKLIST.md` K.4: **Not Started**; **Not Started · Blocked** (with what
it waits on); **Partially implemented**; **Verified existing**. Nothing is ticked without a merged
migration and a passing test.

### I.0 Prerequisite audit

Current state read from `backend/prisma/schema/*.prisma` at `backend` @ `0deef52` (2026-10-10). Every
dependent ID below exists in `BACKEND_CHECKLIST.md` §K or `AI_CHECKLIST.md` §6.

| # | Capability | Required? | Current state (evidence) | Database task | Backend / AI tasks that depend on it | Assistant-specific acceptance (added to the existing task) | Evidence required |
|---|---|---|---|---|---|---|---|
| 1 | Hospital and clinic, stable identifiers | Yes (DR-01, OD-06) | Missing: no `model Hospital` or `Clinic` (AF-01) | A1, A2 | AST-B1, AST-B2, AST-B9 · AG-3.8 | Each has a uuid key and a non-guessable public id; `status` lets discovery exclude suspended hospitals | Migration; `db:check`; schema spec |
| 2 | Locations and time zones | Yes (OD-06, OD-10, DR-10) | Missing. Today one clinic-wide zone in `platform_settings.localization.timezone` (BL-6) | A3, plus I5 for indexes | AST-B6, AST-C2, AST-C3 · AG-3.9 | `Hospital.timezone` NOT NULL; `HospitalLocation.timezone` nullable; both hold valid IANA names (CHECK or reference list); coordinates nullable, range-checked. Which zone governs a slot: **KD-8** | Schema spec asserting the CHECKs |
| 3 | Doctor ↔ hospital employment | Yes (DR-02) | Missing: `Doctor.hospital` is free text (AF-03) | A4, A5, A6 | AST-B3, AST-B4, AST-C1 · AG-3.5, AG-3.10, AG-3.6 | A doctor with no `ACTIVE` employment has no reachable discovery row and cannot hold a `PUBLISHED` slot | Partial-unique spec; seed I7 |
| 4 | Published slots as the only patient inventory | Yes (DR-10) | Missing (AF-10, BL-5) | E1 | AST-C1, AST-C2 · AG-3.9 | `startsAt` is `timestamptz`; `durationMin > 0`; `status` ∈ `PUBLISHED\|BOOKED\|WITHDRAWN`; `hospital_id` equals the employment's hospital (composite FK, C2) | Schema spec |
| 5 | No double booking, no invalid allocation | Yes (DR-11, OD-08) | Missing: indexes only, no exclusion or slot uniqueness (AF-11) | E2, E3 | AST-D1, AST-D5, AST-D9, AST-H9 · AG-4.4, AG-4.5 | Partial unique `appointments(published_slot_id)` for active statuses; per-doctor overlap exclusion; the slot's `BOOKED` transition and the appointment insert happen in one transaction; a reschedule releases and books in one transaction | A DB-level test: N concurrent inserts for one slot → exactly one row |
| 6 | Booking-policy storage | Yes, per hospital (OD-08 delegation; CLIENTS WEB-14) | Missing | E4 | AST-D3, AST-D4, AST-D5, AST-D6, AST-G8 | Shape fixed only after **KD-3** (which rules exist) and **KD-5** (auto-confirm vs approval). Platform defaults plus per-hospital overrides | Blocked until KD-3/KD-5 |
| 7 | Global patient identity and record lifecycle | Yes (OD-09, DR-03) | Partial: `patients.user_id` nullable unique (ADR-030); registration creates no `patients` row (BL-10) | B1, B2, B5, B6, plus **I4** | AST-D1, AST-D11 | One identity per account; one Medical Record per (patient, hospital), created in the booking transaction (B5) | Unique-constraint spec; booking e2e (AST-H6) |
| 8 | Safe identity creation and claiming without duplicates | Yes | Missing; undecided (**KD-4**, OQ-02 / RA-030.1) | **I4** | AST-D1 | See I4 | See I4 |
| 9 | Hospital-scoped patient records | Yes (DR-03, DR-04) | Missing: clinical data on the global patient (AF-07) | B2, B4, C2 | AST-D11 | Not read by any assistant tool in this scope; required so booking creates the right record | Composite-FK spec |
| 10 | Idempotency-key storage | Yes (ADR-014 Accepted) | Missing: no `Idempotency-Key` handling anywhere (BL-16) | **I1** | AST-D8, AST-H8 · AG-4.3, AG-4.4, AG-4.7, AG-4.6 (retries) | See I1 | See I1 |
| 11 | Booking-confirmation persistence | Yes **if** KD-2 adopts the appointment-intent design; not needed for a stateless design | Missing | **I2** | AST-D7, AST-H7 · AG-4.3, AG-4.4, AG-4.7, AG-4.6 | See I2 | See I2 |
| 12 | Patient-assistant conversation persistence | Yes **if** conversations are stored (**KD-6**). Patient-app K-07 expects server persistence | Missing. `ai_conversations` is clinician-shaped, `ai_messages` verbatim (BL-18, AF-39) | **I3** | AST-E2, AST-F6, AST-G7 · AG-6.4, AG-8.4 | See I3 | See I3 |
| 13 | Ownership, retention, access and audit persistence | Yes | Partial: `audit_events` exists, partitioned (ADR-024), no `hospital_id` (BL-17); no rate-limit or tool-call tables needed | C6, plus retention in I1–I3 | AST-D10, AST-E7, AST-H15 | Tool-call and intent events go to `audit_events`, not a new table; every new table (I1–I3) has a defined purge | Purge tests in I1–I3 |
| 14 | Review moderation for ratings | Yes for ratings/reviews (OD-10) | Missing: `satisfaction_surveys.comment` unmoderated; `Doctor.ratingAvg` never written (AF-40) | **I6** | AST-B7 · AG-3.5, AG-3.10, AG-3.11 | See I6 | See I6 |
| 15 | Insurance coverage | Yes (OD-14) | Partial: `InsuranceProvider`, `PatientInsurance` exist; nothing links coverage to hospitals (AF-40) | E5, B1 | AST-B8, AST-D12 | Coverage rows reference hospital (and optionally doctor/service); an uninsured patient has no coverage row and is never filtered | Seed I7 covers both patients |
| 16 | Two-hospital test seed | Yes | Missing (AF-12) | G9, plus **I7** | AST-H4, AST-I8 · AG-8.2, AG-9.2 | See I7 | See I7 |
| 17 | Indexes for discovery and slot reads | Yes | Missing (no hospital, slot or trigram indexes) | C7, refined by **I5** | AST-B1, AST-B6, AST-C2 | See I5 | See I5 |
| 18 | Rate-limit counters | **Not a PostgreSQL concern** | — | none | AST-G1 | Shared cache (M31.1), owned by Backend | — |
| 19 | Localized (Arabic and English) names | Yes for Arabic answer quality (IC-09); the patient app is bilingual | Missing: `Specialty.name` and `Department.name` are single unlocalized columns (`02-lookups.prisma`); only notifications carry a `locale` | **I8** | AST-B1…AST-B5 · AG-6.5, AG-3.4 | See I8 | See I8 |

### I.1 New tasks

| ID | Task and outcome | Owner | Status | Depends on / blocked by | Constraints and invariants | Acceptance criteria | Evidence required |
|---|---|---|---|---|---|---|---|
| **I1** | **Idempotency-key store** (ADR-014): one row per `(user, endpoint, key)` with the request hash, the stored response, and an expiry | Database (Backend: AST-D8 uses it) | Not Started | ADR-014 (Accepted) | `UNIQUE (user_id, endpoint, key)`; `expires_at` NOT NULL (24 h, ADR-014); the row is written in the same transaction as the write it guards (TECHNICAL RECOMMENDATION), so a replay can never re-execute; store only what a replay must return | A second insert with the same triple fails on the unique constraint; expired rows are purged by a job; a request hash mismatch is detectable from the row | Migration; `db:check`; schema spec for the unique constraint; purge test |
| **I2** | **Appointment-intent store** (the KD-2 recommendation): a prepared, not yet confirmed, booking, cancellation or rescheduling | Database (Backend: AST-D7) | Not Started · Blocked (**KD-2**) | E1, E2, B1 | Bound to one patient identity and one user; `action` ∈ `BOOK\|CANCEL\|RESCHEDULE`; target slot or appointment ids; parameter hash; `status` ∈ `PREPARED\|CONFIRMED\|DISCARDED\|EXPIRED`, leaving `PREPARED` once only; `expires_at` NOT NULL and after `created_at`; result appointment id set only when `CONFIRMED`; `hospital_id` derived from the target, never supplied | A second confirm of the same intent changes nothing; another patient's intent is unreachable by the owner predicate; expired intents are purged after a retention window set in AST-D7 within ADR-007 (intents can hold reason text) | Migration; CHECK specs; concurrent-confirm test (with AST-H7) |
| **I3** | **Patient-assistant conversation store**, patient-owned and separate from clinician `ai_conversations` (or a clear audience discriminator on it) | Shared — coordinating: Database. Database: schema. AI: content and modes. Backend: AST-E2 access path | Not Started · Blocked (**KD-6**) | B1 | Owner is the patient's user; no staff read path; one patient per conversation; message text stored only if KD-6 allows, otherwise metadata only; a patient context vocabulary distinct from the clinician `AiContextMode` (patient-app K-01). A new enum in `01-enums.prisma` also runs the **patient-app** suite (CLAUDE.md) | A doctor or admin query cannot reach a patient conversation; retention purge per KD-6; soft delete matches the rest of the AI tables | Migration; ownership spec; purge test |
| **I4** | **Global identity for a new patient, without duplicates**: when an identity row is created for an account with no pre-existing hospital record, and how a later claim (OQ-02) links rather than duplicates | Database + Backend (proposal); **owner decides** (KD-4) | Not Started · Blocked (**KD-4**, OQ-02 for claiming) | B1, B4 | At most one identity per account (`patients.user_id` UNIQUE already exists, ADR-030); the identity holds no clinical data once B4 lands; claiming never auto-links on email (ADR-030 §4) | The decided trigger creates exactly one identity; a claim against an account that already has one follows the decided link/merge path and leaves one identity | Migration; constraint spec; claim test once OQ-02 is decided |
| **I5** | **Read-path indexes for the assistant** (refines C7 with `DATA_MODEL_CHANGES.md` §5) | Database | Not Started · Blocked (A1–A3, E1) | C7 | `published_slots (hospital_id, doctor_id, starts_at) WHERE status = 'PUBLISHED'`; `pg_trgm` on hospital, clinic and doctor names; a location-coordinate index (bounding box or PostGIS, engineering choice); `(user_id, status, expires_at)` on I2 when it exists | Query plans for AST-B1, AST-B6 and AST-C2 on the I7 seed use these indexes | `EXPLAIN` output recorded in the PR |
| **I6** | **Review moderation state** for `satisfaction_surveys`, and a defined source for the doctor rating | Database (Backend: AST-B7) | Not Started · Blocked (moderation specification, OD-10 delegated) | — | Moderation status, moderator and time; only approved text is selectable for display; `Doctor.ratingAvg` either maintained by a defined job or dropped from patient sorting | Unmoderated text cannot be read by the patient-facing query; the aggregate is reproducible from source rows | Migration; spec over the projection |
| **I7** | **Assistant test fixtures** (extends G9): synthetic data only | Database (Backend and AI consume) | Not Started · Blocked (G9, E1, A3) | G9 | Two hospitals in different IANA zones, one with a DST change; per hospital ≥2 doctors with an active employment and one with an ended employment; slots that are future-free, booked, withdrawn and past; patients: insured, uninsured, an unlinked account, one with appointments at both hospitals | Every fixture category above exists after `db:reset`; no real person's data | Seed run in CI; a fixture spec that counts each category |
| **I8** | **Localized names** (requirement from the unified AI plan, IC-09): Arabic and English names for specialties, departments, hospitals, clinics and locations. A requirement only; nothing is implemented | Database (Backend: AST-B1…AST-B5 projections) | Not Started · Blocked (A1–A3, C4). Proposed; the Database lead accepts or rejects it | A1–A3, C4 | Each localized name carries its language; a missing translation is null and never machine-translated; proper names are never translated automatically | Discovery queries can select either language; seed I7 carries both | Migration; schema spec; seed check |

### I.2 Proposed amendments to I2 and I3 — NOT adopted

From the unified AI plan (`AI_INTEGRATION_CONTRACTS.md` §CA). They need the **Database lead's** review.
- **Authoritative text:** until a later PR adopts them, I2 and I3 in §I.1 as written are authoritative.
- **I2 amendments:** conditional on **KD-2** choosing the appointment intent. Writing them down approves
  nothing.
- **I3 amendments:** conditional on **KD-6**. Writing them down approves nothing.

| CA | Task | Authoritative now | Proposed | Conditional on |
|---|---|---|---|---|
| CA-1 | I2 | `status` ∈ `PREPARED\|CONFIRMED\|DISCARDED\|EXPIRED` | Add `FAILED` (with a result code) and `UNKNOWN` | KD-2 (i) |
| CA-11 | I2 | Bound to patient and user; action; target; parameter hash; states above; `expires_at`; result appointment when confirmed | Add a nullable conversation link and one open intent per conversation and payload hash, so a retried prepare cannot create a duplicate | KD-2 (i) |
| CA-11 | I3 | "patient-owned and separate from clinician `ai_conversations` (or a clear audience discriminator on it)" | Recommend separate `patient_assistant_*` tables, so staff access is impossible by construction (A-11); the discriminator stays a permitted alternative until decided | KD-6 |

## Quality gate

`npm --prefix backend run typecheck && lint && test && build`, plus `db:check` / `db:deploy` on a clean
PostgreSQL 16. `01-enums.prisma` changes also run the **patient-app** suite (CLAUDE.md).
