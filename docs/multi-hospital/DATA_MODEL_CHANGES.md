# Multi-Hospital — Data Model Changes (Proposal)

**Status:** proposal. Nothing is implemented. The authoritative schema stays `backend/prisma/`.
Entities, fields and constraints are **TECHNICAL RECOMMENDATIONS** serving the FINAL owner decisions
cited. The Database owner may change names and shapes, but not the guarantees.

---

## 1. New entities

| Entity | Purpose | Key fields (recommended) | Serves |
|---|---|---|---|
| `Hospital` | Isolation boundary | `id`, `publicId`, `name`, `legalName`, contact, `status` (active/suspended), `timezone` | DR-01 |
| `Clinic` | Separate entity inside a hospital | `id`, `hospitalId` (FK), `name`, `specialtyIds?`, `locationId?`, `status` | DR-01, OD-06 |
| `HospitalLocation` | A site; **many per hospital in v1** | `id`, `hospitalId` (FK), `name`, address, `latitude?`, `longitude?` (for distance, OD-10), `timezone` | OD-06, OD-10 |
| `DoctorEmployment` | Doctor ↔ hospital lifecycle | `id`, `doctorId`, `hospitalId`, `clinicId?`, `departmentId?`, `employeeId?`, `status` (`ACTIVE`/`ENDED`), `startedOn`, `endedOn?`, `endReason?`, created/ended by | DR-02, OD-12 |
| `HospitalAdminAssignment` | Hospital Admin ↔ one hospital | `userId`, `hospitalId`, `status` | OD-07 |
| `PlatformAdmin` marker | Platform role (via `Role` or a flag) | — | OD-07 |
| `PatientIdentity` *(= today's `Patient`, re-scoped)* | Global person-level identity: name, date of birth, sex, contact, identity documents, insurance coverage | existing `Patient` id kept | OD-09, OD-14 |
| `HospitalMedicalRecord` | One patient's Medical Record at one hospital | `id`, `patientId`, `hospitalId`, `recordNumber` (hospital MRN), `openedAt`, `openedByInteraction` (`BOOKING`/`VISIT`/…), `status` | DR-03, OD-09 |
| `CrossHospitalAccessRequest` / `Grant` | DR-06 workflow | `id`, `requestingDoctorId`, `requestingEmploymentId`, `sourceHospitalId`, `targetHospitalId`, `patientId`, `targetMedicalRecordId`, `purpose` (text + optional `consultationId`/`encounterRef`), `requestedCategories[]`, `approvedCategories[]`, `status` (`PENDING`/`APPROVED`/`REJECTED`/`EXPIRED`/`REVOKED`/`CLOSED`/`INVALIDATED`), `decidedBy`, `decidedAt`, `endsAt` (**NOT NULL once approved; no open-ended grants**), `revokedAt?`, `revokedBy?`, `closedAt?` | DR-06, OD-01, OD-03 |
| `CrossHospitalAccessEvent` | Append-only access and lifecycle log for **both paths** | `id`, `authorizationType` (`GRANT`/`BREAK_GLASS`), `authorizationId`, `actorId`, `event` (`REQUESTED`/`APPROVED`/`REJECTED`/`STARTED`/`ACCESSED`/`REVOKED`/`EXPIRED`/`ENDED`/`CLOSED`/`INVALIDATED`/`AI_USED`/`DOCUMENTED`), `category?`, `resourceType?`, `resourceId?`, `at` | DR-06 (10), OD-04 |
| `BreakGlassSession` | Emergency access (OD-04) | `id`, `requestingDoctorId`, `requestingEmploymentId` (must be ACTIVE), `sourceHospitalId`, `targetHospitalId`, `patientId`, `targetMedicalRecordId`, `emergencyReasonCode`, `emergencyReasonText` (both required), `scopeCategories[]` (minimum-necessary emergency set), `startedAt`, `endsAt` (**NOT NULL**, bounded by platform policy), `status` (`ACTIVE`/`ENDED`/`REVOKED`/`INVALIDATED`), `revokedBy?`, `revokedAt?`, `reviewedBy?`, `reviewedAt?` (post-event review at the target hospital) | OD-04 |
| `CrossHospitalDocumentationProvenance` | Provenance for doctor-approved content saved into the **requesting** hospital's record (OQ-01) | `id`, `targetEntryType` + `targetEntryId` (the new Hospital A record content), `hospitalId` (= A), `sourceHospitalId` (= B), `authorizationType`, `authorizationId`, `categories[]`, `sourceRefs[]` (ids only, never content), `approvedByDoctorId`, `approvedAt`, `aiAssisted` (bool) | OQ-01 |
| `DataCategory` (enum) | Grant category taxonomy aligned with DR-04 | `ALLERGIES`, `MEDICATIONS`, `DIAGNOSES`, `VITALS`, `LAB_RESULTS`, `IMAGING`, `CLINICAL_NOTES`, `ENCOUNTERS`, `PRESCRIPTIONS`, … | OD-03 |
| `Consultation` + `ConsultationMessage` | Cross-hospital clinical consultation | `id`, `requestingDoctorId`, `requestingHospitalId`, `consultantDoctorId`, `consultantHospitalId`, `patientId?`, `status`, messages with author/time | OD-13 |
| `PublishedSlot` | Doctor-published online slot, capacity 1 | `id`, `doctorId`, `employmentId`, `hospitalId`, `clinicId?`, `locationId?`, `startsAt`, `durationMin`, `status` (`PUBLISHED`/`BOOKED`/`WITHDRAWN`), `appointmentId?` | DR-10, DR-11, OD-08 |
| `HospitalInsuranceCoverage` | Which insurance providers/plans a hospital (and optionally doctor/service) accepts | `hospitalId`, `insuranceProviderId`, `doctorId?`, `serviceRef?` | OD-14 |
| `HospitalSetting` | Per-hospital settings (profile, booking policy) replacing the global `organization` slice | `hospitalId`, `key`, `value` | DR-01, AF-09 |
| AI artefact class + tag | Every AI artefact is **C1** (same-hospital), **C2** (transient cross-hospital context / un-approved derived output) or **C3** (doctor-approved, saved into the record: lives in clinical tables, not AI tables). C2 rows carry `authorizationType` + `authorizationId` + `sourceHospitalId` for purge or inaccessibility at authorization end | — | DR-12, OD-05, AF-39 |

### Alternative for grants
Extend `PatientAccessGrant` (ADR-010 group 2) instead of a new entity. It has grantee, scope, reason,
granted-by and revoke-not-delete, but no hospital, no purpose and no categories, and its grantee may be
a whole role (AF-38). Either extend it to the full field list above, forbidding role-wide cross-hospital
grants, or keep it for in-hospital governance only and add the dedicated entity. Decide in ADR-042.

## 2. Hospital column on existing tables

**Rule:** `hospital_id uuid NOT NULL` on every hospital-owned table after backfill. Children of a
hospital-owned parent use a **composite foreign key** `(hospital_id, parent_id) → parent(hospital_id,
id)`, so a child can never attach to another hospital's parent (DR-04, structural).

| Group | Tables | Notes |
|---|---|---|
| Patient clinical | `PatientAllergy`, `PatientChronicCondition`, `PatientMedication`, `PatientMedicalHistory`, `PatientVitalSign`, `PatientClinicalAlert`, `PatientNote`, `PatientDocument`, `PatientStudy` | Re-home under `HospitalMedicalRecord` (DR-04) |
| Patient person-level | `PatientEmergencyContact`, `PatientInsurance` | Stay on the global identity (OD-09, OD-14). Recommendation; emergency contacts may be overridden per hospital if needed |
| Encounters & records | `MedicalRecord` (encounters), `RecordDiagnosis`, `RecordTreatmentPlanItem`, `RecordMedication`, `RecordAllergy`, `RecordNote`, `RecordAttachment`, `RecordTimelineEvent`, `RecordIssueReport`, `RecordVersion` | Encounter → `hospitalMedicalRecordId`; children by composite FK |
| Labs & pharmacy | `LabOrder`, `LabSpecimen`, `LabResult`, `LabAttachment`, `LabTimelineEvent`, `Prescription`, `PrescriptionSafetyWarning`, `PrescriptionNote`, `PrescriptionHistoryEntry`, `PrescriptionTimelineEvent` | Inherit from the Medical Record |
| Scheduling | `Appointment` (+ `publishedSlotId`), `AppointmentEvent`, `AppointmentRescheduleProposal`, `SatisfactionSurvey`, `QueueEntry`, `WaitingRoomEntry`, `DoctorTimeOff`, `DoctorAvailability` | Appointment hospital from the slot (DR-11). Availability = internal working hours, per employment |
| Care relationship | `PatientDoctorAssignment` | Hospital-scoped (DR-07) |
| Operations | `Department` (+ optional `clinicId`), `StaffMember`, `StaffShiftAssignment`, `Room` (+ `locationId`), `Resource`, `ClinicWorkingDay` → per hospital/clinic/location, `Holiday` (+ `locationId?`), `Announcement`, `Policy`, `DocumentTemplate` | Per hospital; Clinic and Location as attributes (OD-06) |
| Communication | `Conversation`, `ConversationParticipant`, `Message*`, `CommunicationAccessRequest`, `Notification`, `NotificationDelivery` | In-hospital threads; cross-hospital only via `Consultation` (OD-13) |
| AI | `AiConversation` (+ `hospitalId`), `AiMessage` (+ `dataClass` C1/C2, `authorizationType?`, `authorizationId?`), `AiUserSetting` | Bound to the hospital. C1 keeps normal retention; C2 is purged or made inaccessible at authorization end (DR-12) |
| Audit & reports | `AuditEvent` (partitioned, ADR-024; `hospitalId` nullable for platform events), `SavedReport`, `ScheduledReport*`, `ReportExport`, `IncidentBookmark`, `PatientAccessGrant` | — |
| Stays global | `User`, `Session`, credentials, `Role`, `Permission`, catalogues (`LabTestCatalogue`, `Medication*`, `DrugInteraction`, `IcdCode`, `Specialty`, `VisitType`, `ChronicCondition`, `InsuranceProvider`), `Doctor` (person + licence), patient identity, `PlatformSetting` (platform keys only) | — |

**Departments (AF-04):** department belongs to a hospital (optionally to a clinic). A doctor's
department is recorded on the **employment**, not on `Doctor`.

## 3. "Medical Record" naming

- Name the owner's concept `HospitalMedicalRecord`.
- Keep `medical_records` as encounter records.
- Do not rename in the same migration as the hospital backfill.

## 4. Constraints (guarantees are owner-mandated; mechanisms are recommendations)

| Constraint | Guarantee |
|---|---|
| Partial unique `doctor_employments(doctor_id) WHERE status='ACTIVE'` | One active employment (DR-02) |
| `btree_gist` exclusion on `(doctor_id, tstzrange(started_on, ended_on))` | No overlapping employment history |
| `CHECK (status <> 'ENDED' OR (ended_on IS NOT NULL AND end_reason IS NOT NULL))` | Ends recorded |
| `UNIQUE (patient_id, hospital_id)` on `hospital_medical_records` | One Medical Record per patient per hospital (DR-03) |
| `UNIQUE (hospital_id, record_number)` | Hospital MRN; replaces global `Patient.mrn` uniqueness |
| Composite FKs `(hospital_id, parent_id)` | Child in same hospital as parent (DR-04) |
| `CHECK (status <> 'APPROVED' OR ends_at IS NOT NULL)` and `approved_categories` non-empty | No permanent, no category-less grant (DR-06) |
| `break_glass_sessions`: `ends_at NOT NULL`, reason fields `NOT NULL`, `scope_categories` non-empty; partial index on `status = 'ACTIVE'` | Time-limited, reasoned, minimum-necessary emergency access (OD-04) |
| Provenance row required for every clinical entry created from cross-hospital data (enforced in the save service; FK to the authorization) | Auditable origin of documented content (OQ-01) |
| `UNIQUE (doctor_id, starts_at)` on `published_slots` | One slot per doctor-time |
| Partial unique `appointments(published_slot_id) WHERE status NOT IN ('CANCELLED', …)` | Capacity 1 (DR-11, OD-08) |
| Exclusion on `appointments (doctor_id, tstzrange(starts_at, starts_at + duration))` for active statuses | No overlapping bookings |
| Per-hospital uniques: `Department(hospital_id[, clinic_id], name)`, `Room(hospital_id, location_id, name)`, `DoctorEmployment(hospital_id, employee_id)`, `StaffMember(hospital_id, email)`, `Holiday(hospital_id[, location_id], name, date)` | Replace single-clinic uniques (AF-06) |
| `UNIQUE (user_id, hospital_id)` on Hospital Admin assignments | OD-07 |

## 5. Indexes

- Lead scoped indexes with `hospital_id`.
- `published_slots (hospital_id, doctor_id, starts_at) WHERE status = 'PUBLISHED'`.
- `pg_trgm` on hospital, clinic and doctor names.
- Location coordinates indexed for distance queries (plain lat/lng with a bounding box, or PostGIS;
  engineering choice).
- `cross_hospital_grants (requesting_doctor_id, status, ends_at)`.

## 6. Deliberately not modeled

- Simultaneous multi-hospital employment (forbidden, DR-02).
- A shared cross-hospital record (forbidden, DR-03).
- Whole-record copying between hospitals (OQ-01 permits only selective, doctor-approved documentation).
- Patient-consent fields for normal grants (consent not required, OD-02).
- Billing (ADR-037/038/039).
- Persistent AI copies of cross-hospital data (forbidden, DR-12).
