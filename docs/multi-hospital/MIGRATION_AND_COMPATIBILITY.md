# Multi-Hospital — Migration and Compatibility

**Status:** planning only. Nothing is migrated. This document records every single-clinic assumption
found in the repository, what the FINAL owner decisions require instead, and how to get there without
breaking the running single-hospital system.

---

## 1. Conflicting decisions (superseded by accepted ADR-042; source ADR text retained)

ADR-018 is **not modified** by this documentation. Accepted ADR-042 records the supersession, as ADR-030 did for
ADR-018 §3.

| Record | What it says | Conflicts with | Required action |
|---|---|---|---|
| **ADR-018 §1** | Single clinic; no `clinic_id`; no tenant isolation tests | DR-01, DR-03, DR-04, DR-11 | Superseded by **ADR-042**; §1 source text is retained. §2 (billing off) and §4 (mobile readiness) stand. §3 is already superseded by ADR-030 |
| **ADR-010** clinics/facilities OUT + `backend/test/schema-adr010.e2e-spec.ts` | No clinic or facility entities, enforced by test | DR-01, OD-06 (Hospital, Clinic, Location are entities) | Superseded by **ADR-042**; replace the test assertion in Phase 21 |
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
| M-1 | `Doctor.hospital` free text | `04-people.prisma` | `DoctorEmployment` (DR-02) | Read-only during transition; backfill; keep the old text for audit |
| M-2 | One clinic seeded; global `organization` slice "Medora Clinic" | seed | Default Hospital + default Location (+ Clinic if needed) | — |
| M-3 | `ClinicWorkingDay` keyed by weekday only | `04-people.prisma` | Per hospital / clinic / location; internal working hours only | Never exposed as patient inventory (DR-10) |
| M-4 | Global organization setting | `platform_settings` | `HospitalSetting` + platform-only settings | Admin "Organization" panel reads the default hospital until split |
| M-5 | Global uniques (`Patient.mrn`, `Doctor.employeeId`, `Department.name`, `Room.name`, `StaffMember.email`, `Holiday(name,date)`) | schema | Per hospital (and clinic/location where relevant) | Build new uniques before dropping old; collision check |
| M-6 | One `Doctor.departmentId` | `Doctor` | Department on the employment (hospital/clinic-owned) | Backfill |
| M-7 | Patient clinical data on the global patient | `05-patients.prisma` | Under `HospitalMedicalRecord` | Existing patients already interacted with the default hospital → one record each (OD-09) |
| M-8 | `medical_records` = encounters | `08-records.prisma` | Encounters under the Medical Record | Do not rename in the same migration |
| M-9 | Appointments without a hospital; no slot entity; no DB double-booking guard | `07-scheduling.prisma` | `hospital_id`, `PublishedSlot`, constraints | Existing appointments → default hospital; doctor-side booking keeps working |
| M-10 | Notifications without a hospital | `10-communication.prisma` | Hospital-scoped | Backfill |
| M-11 | Authorization = assignment only | `shared/authz/patient-scope.service.ts` | Hospital + role + permissions (DR-05) | **Shadow mode** first; log diffs before switching |
| M-12 | Session without a hospital; mock-only `clinicId`; fail-open `useClinicScope` | auth; frontend | `activeHospital` from employment | Replace; do not extend the fail-open helper |
| M-13 | **One platform-wide `admin` role** | `Role` seed, `/admin/*` | **Platform Admin + Hospital Admin** (OD-07) | **Explicit migration task:** reconcile every existing admin account to Platform Admin or Hospital Admin (which hospital) through a reviewed mapping list. **No automatic conversion; do not assume all are Platform Admins** |
| M-14 | Messaging participant rule absent | `origin/backend` messaging | Hospital-scoped threads + cross-hospital consultation (OD-13) | Fix AF-16 before merging M20 |
| M-15 | `PatientAccessGrant` hospital-agnostic | `12-adr010.prisma` | Hospital-scoped or replaced (AF-38) | Existing grants → default hospital |
| M-16 | Audit events without a hospital | `audit_events` (ADR-024) | Nullable `hospital_id` | Partition-aware |
| M-17 | `ai_messages` stores prompts and completions verbatim | `ai-transcript.log.ts` comment; AI schema | C1/C2/C3 data classes: C2 (transient cross-hospital) tagged and purged/inaccessible at authorization end; C1 normal retention; C3 in clinical tables (DR-12, OQ-01) | Existing rows are all C1 (no cross-hospital AI exists). Must be in place before G-5 |
| M-18 | Ratings never written (`ratingAvg` null) | `04-people.prisma` | Aggregated from `satisfaction_surveys` (OD-10) | Backfill from existing surveys |
| M-19 | No coordinates, no insurance coverage model | schema | Location coordinates; `HospitalInsuranceCoverage` (OD-10, OD-14) | New data; uninsured patients are unaffected |

## 3. Migration strategy (TECHNICAL RECOMMENDATION)

1. **Expand:** new tables and nullable columns; default hospital and location; backfill.
2. **Dual-read:** services read new columns; authorization runs in shadow mode (M-11); admin mapping
   list prepared and reviewed (M-13).
3. **Enforce:** `NOT NULL`, composite FKs, per-hospital uniques; switch authorization; apply the admin
   mapping; drop the scope-out test.
4. **Contract:** remove legacy columns once no client reads them.
5. **Second hospital:** only after gates G-1…G-8.

Each step ships with its own down-migration and is rehearsed on a production-like copy (Phase 31).

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
