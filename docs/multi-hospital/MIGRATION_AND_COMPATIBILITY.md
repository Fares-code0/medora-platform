# Multi-Hospital — Migration and Compatibility

**Status:** planning for legacy-data integration. The unmerged PR #5 feature branch adds the initial
Hospital, HospitalLocation, and Clinic schema foundation only; these migrations do not assign or
backfill existing records. No persistent-environment migration status is established. This document
records the remaining single-clinic assumptions and the approved path to address them without breaking
the running system. See [PR #5 migration status and recovery](PR5_MIGRATION_STATUS_AND_RECOVERY.md).

---

## 1. Conflicting decisions (superseded by accepted ADR-042; source ADR text retained)

ADR-018 is **not modified** by this documentation. Accepted ADR-042 records the supersession, as ADR-030 did for
ADR-018 §3.

| Record | What it says | Conflicts with | Required action |
|---|---|---|---|
| **ADR-018 §1** | Single clinic; no `clinic_id`; no tenant isolation tests | DR-01, DR-03, DR-04, DR-11 | Superseded by **ADR-042**; §1 source text is retained. §2 (billing off) and §4 (mobile readiness) stand. §3 is already superseded by ADR-030 |
| **ADR-010** clinics/facilities OUT + `backend/test/schema-adr010.e2e-spec.ts` | No clinic or facility entities, enforced by test | DR-01, OD-06 (Hospital, Clinic, Location are entities) | Superseded by **ADR-042**; PR #5 keeps the test, removes Clinic from the obsolete OUT list, and asserts Clinic exists. `HospitalLocation` is the location model; no separate `facilities` table is introduced |
| **ADR-022** care-relationship scoping | "A doctor reaches a patient iff an assignment links them" (M7.2) | DR-05, DR-07 | Superseded in part by ADR-042 (the anchor only). Keep 404-not-403 and RLS-before-production |
| **ADR-033 / RA-033.1** | Patient booking policy undecided | — | Answered at model level by OD-08 (published slot, capacity 1). Policy values are implementation policy (Phase 24) |
| **ADR-030 / RA-030.1** | Global patient identity; claim flow deferred | Compatible with OD-09 | Keep. The claim identity-proofing **method** is OQ-02, open and deferred to implementation; the architecture does not change |
| **2026-10-06 realignment** (frontend ORG-01, A-08, API-W01/W03/W04/W09; patient-app G-11, E-01, H-06, API-P01–P08, P11; `docs/handoff/clinic-isolation.md` §1) | Organization boundary, memberships, switcher, signed-out discovery, computed slots, shared safety summary | DR-01, DR-02, DR-06, DR-08, DR-09, DR-10 | Superseded. Re-realign those files on their own branches (outside this documentation's scope). Mapping: `API_CONTRACT_CHANGES.md` §9 |
| **Earlier revisions of this folder** | "Locations undecided", "admin split undecided", "AI never uses granted data", "no Break-Glass", "every cross-hospital access needs Admin approval", "no documentation into the requester's record", "booking/discovery/insurance/messaging undecided" | OD-04…OD-14, OQ-01 | Superseded by the final `OWNER_DECISIONS.md` |
| **D-27b** (2026-09-02) "one doctor, one primary clinic" | Single primary clinic per doctor | — (close to DR-02) | Becomes "one active hospital employment"; clinic is an attribute of the employment |

**ADR number:** **ADR-042**, accepted and registered 2026-11-22 after a fresh sweep:
- No collision was found in the current canonical register or available pending-ADR files.
- ADR-043 remains reserved; ADR-044 is registered on origin/main.
- Re-run the sweep, including pending ADR files, before allocating another number.
## 2. Single-clinic assumptions in the current implementation

| # | Assumption | Where | Target | Compatibility note |
|---|---|---|---|---|
| M-1 | `Doctor.hospital` free text | `04-people.prisma` | `DoctorEmployment` (DR-02) | Read-only during transition; backfill only from a verified employment/hospital mapping and separate approval; keep old text for audit; leave unmapped rows unchanged |
| M-2 | One clinic seeded; global `organization` slice "Medora Clinic" | seed | Default Hospital + default Location (+ Clinic if needed) | Create only when approved; do not automatically assign legacy records to it |
| M-3 | `ClinicWorkingDay` keyed by weekday only | `04-people.prisma` | Per hospital / clinic / location; internal working hours only | Derive ownership only from a verified mapping and separate approval; never expose as patient inventory (DR-10) |
| M-4 | Global organization setting | `platform_settings` | `HospitalSetting` + platform-only settings | Admin "Organization" panel reads the default hospital until split |
| M-5 | Global uniques (`Patient.mrn`, `Doctor.employeeId`, `Department.name`, `Room.name`, `StaffMember.email`, `Holiday(name,date)`) | schema | Per hospital (and clinic/location where relevant) | Build and collision-check new uniques first; removal of old constraints is a separate destructive change requiring explicit approval |
| M-6 | One `Doctor.departmentId` | `Doctor` | Department on the employment (hospital/clinic-owned) | Backfill only from verified employment and department ownership mappings with separate approval; preserve unmapped rows |
| M-7 | Patient clinical data on the global patient | `05-patients.prisma` | Under `HospitalMedicalRecord` | Create records only for patients with a verified hospital ownership mapping and separate approval; do not blanket-assign unmapped legacy patients |
| M-8 | `medical_records` = encounters | `08-records.prisma` | Encounters under the Medical Record | Preserve identifiers; establish parent records only through verified hospital ownership mappings and separate approval; do not rename in the same migration |
| M-9 | Appointments without a hospital; no slot entity; no DB double-booking guard | `07-scheduling.prisma` | `hospital_id`, `PublishedSlot`, constraints | Map only with verified ownership; preserve unmapped appointments until an approved disposition; maintain current doctor-side booking during expansion |
| M-10 | Notifications without a hospital | `10-communication.prisma` | Hospital-scoped | Backfill only with verified ownership and separate approval; preserve unmapped rows |
| M-11 | Authorization = assignment only | `shared/authz/patient-scope.service.ts` | Hospital + role + permissions (DR-05) | **Shadow mode** first; log diffs before switching |
| M-12 | Session without a hospital; mock-only `clinicId`; fail-open `useClinicScope` | auth; frontend | `activeHospital` from employment | Replace; do not extend the fail-open helper |
| M-13 | **One platform-wide `admin` role** | `Role` seed, `/admin/*` | **Platform Admin + Hospital Admin** (OD-07) | **Explicit migration task:** reconcile every existing admin account to Platform Admin or Hospital Admin (which hospital) through a reviewed mapping list. **No automatic conversion; do not assume all are Platform Admins** |
| M-14 | Messaging participant rule absent | `origin/backend` messaging | Hospital-scoped threads + cross-hospital consultation (OD-13) | Fix AF-16 before merging M20 |
| M-15 | `PatientAccessGrant` hospital-agnostic | `12-adr010.prisma` | Hospital-scoped or replaced (AF-38) | Preserve identifiers and records; map only with verified grant ownership and separate approval; never assign all grants to a default Hospital |
| M-16 | Audit events without a hospital | `audit_events` (ADR-024) | Nullable `hospital_id` | Partition-aware; leave legacy scope null unless a verified ownership mapping and separate approval exist |
| M-17 | `ai_messages` stores prompts and completions verbatim | `ai-transcript.log.ts` comment; AI schema | C1/C2/C3 data classes: C2 (transient cross-hospital) tagged and purged/inaccessible at authorization end; C1 normal retention; C3 in clinical tables (DR-12, OQ-01) | Classify historical rows from verified provenance; do not assume tenant ownership from absence of a hospital column. C2 controls must be in place before G-5 |
| M-18 | Ratings never written (`ratingAvg` null) | `04-people.prisma` | Aggregated from `satisfaction_surveys` (OD-10) | Attribute only surveys with verified hospital ownership and separate approval; preserve unassigned surveys |
| M-19 | No coordinates, no insurance coverage model | schema | Location coordinates; `HospitalInsuranceCoverage` (OD-10, OD-14) | New data; uninsured patients are unaffected |

## 3. Migration strategy (TECHNICAL RECOMMENDATION)

1. **Expand:** new tables and nullable columns. Create a default hospital/location only when approved;
   backfill only records covered by verified ownership mappings and separate approval. Preserve
   unmapped rows unchanged.
2. **Dual-read:** services read new columns; authorization runs in shadow mode (M-11); admin mapping
   list prepared and reviewed (M-13).
3. **Enforce:** after validation and separate approval, add `NOT NULL`, composite FKs and per-hospital
   uniques; switch authorization; apply the reviewed admin mapping. Keep the ADR-042 Clinic assertion.
4. **Contract:** any legacy-column removal is a separate destructive change requiring explicit approval,
   verified usage evidence, and a preservation/recovery plan.
5. **Second hospital:** only after gates G-1…G-8.

Use forward-only migrations. Rehearse on a sanitized production-like copy and test backup restoration
(Phase 31). Do not use down-migrations, resets, or destructive rollback; recover by an approved forward
repair or verified backup restoration. No data backfill or schema contraction is authorized by this plan.

## 4. Client compatibility

- **Web:**
  - live builds already hide the free-text hospital field (FE-10.9);
  - the mock `clinicId` and fail-open `clinic-scope` helpers are replaced by the server's active
    hospital;
  - admin navigation splits per OD-07.
- **Patient app:**
  - discovery is already authenticated (`/patient/doctors`), consistent with DR-09;
  - the signed-out Discover plan (G-11) is **not** built;
  - "Our Clinic" becomes a hospital profile with clinics and locations.
- **API:** additive fields first (`hospital`, `clinic`, `location`); new route families for grants,
  consultations, discovery, slots and admin.
