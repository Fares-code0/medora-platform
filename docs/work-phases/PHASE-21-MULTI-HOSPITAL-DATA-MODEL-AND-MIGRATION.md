# Phase 21 — Multi-Hospital Data Model & Migration

**Origin:** audit-derived; reconciled with the FINAL owner decisions on 2026-10-07
**Primary Area:** Database (+ Backend)
**Status:** NOT STARTED (blocked on Phase 20)
**Valid after the final decisions:** yes
**Depends On:** Phase 20
**Enables:** 22, 22A, 23, 24, 26

**Related documentation:** `docs/multi-hospital/DATA_MODEL_CHANGES.md`, `DATABASE_CHECKLIST.md`,
`MIGRATION_AND_COMPATIBILITY.md`
Patient AI assistant prerequisites (added 2026-10-10): `DATABASE_CHECKLIST.md` §I (I1–I7).

> **Correction history.**
> - *First version:* modelled `Organization`, `OrganizationMembership` (several per doctor) and
>   `PatientEnrollment`. Superseded by Hospital (DR-01), one active employment (DR-02) and per-hospital
>   Medical Records (DR-03).
> - *Second version:* left Locations, admin scope, record creation and grant fields "OD-required".
>   Superseded by the final decisions: Clinic is a separate entity, multiple Locations (OD-06);
>   Platform/Hospital Admin (OD-07); first-interaction record creation and global identity (OD-09);
>   purpose-bound, category-limited grants with an explicit end (OD-01, OD-03); consultations (OD-13);
>   insurance coverage (OD-14).

---

## Objective

Add the Hospital model to `backend/prisma/` and move existing single-clinic data under a default
Hospital without breaking the running system.

## Why it exists

AF-01…AF-12, AF-35, AF-38, AF-39, AF-40.

## Owner decisions it implements

DR-01…DR-04, DR-06, DR-07, DR-10, DR-11, DR-12 (AI storage), OD-01, OD-03, OD-04, OD-06, OD-07, OD-08,
OD-09, OD-12, OD-13, OD-14, OQ-01, all FINAL. OQ-02 (open, deferred) affects record-claim tooling only.

## Deliverables

**Stage 1 — model** (`DATABASE_CHECKLIST.md` A–F)
- [ ] [DATABASE] `Hospital`; `Clinic` (separate entity); `HospitalLocation` (multiple, with
  coordinates)
- [ ] [DATABASE] `DoctorEmployment` (one active, history; department/clinic on the employment);
  Hospital Admin assignment; Platform Admin role
- [ ] [DATABASE] Global patient identity + `HospitalMedicalRecord (patient, hospital)`, created on the
  first real interaction; patient clinical tables re-homed
- [ ] [DATABASE] `hospital_id` + composite FKs (structural ownership, DR-04); hospital-scoped
  assignments
- [ ] [DATABASE] Grant entity (purpose, categories, explicit end, revocation, employment link);
  `BreakGlassSession` (reason, minimum-necessary scope, bounded window, review); access events for both;
  documentation provenance (OQ-01); `Consultation`
- [ ] [DATABASE] `PublishedSlot` (capacity 1); `Appointment.hospital_id NOT NULL`; booking
  constraints
- [ ] [DATABASE] `HospitalInsuranceCoverage`; per-hospital uniques and settings
- [ ] [DATABASE] AI storage: `AiConversation.hospital_id`; `AiMessage` data class (C1/C2) and authorization tag (AF-39)

**Stage 2 — migration** (`DATABASE_CHECKLIST.md` G)
- [ ] [DATABASE] Default hospital and location; backfill; one active employment per doctor; one Medical
  Record per existing patient at the default hospital
- [ ] [DATABASE] **Existing admin accounts mapped deliberately** to Platform Admin or Hospital Admin via a
  reviewed list. No automatic conversion (OD-07)
- [ ] [DATABASE] Expand → dual-read → enforce → contract, with down-migrations
- [ ] [DATABASE] Gate seed (two hospitals with ≥2 locations and ≥1 clinic each, …)
- [ ] [TESTING] Replace the ADR-010 scope-out assertion; `db:check` and `db:deploy` on clean
  PostgreSQL 16
- [ ] [DATABASE] Fix or retire `database/schema.sql`

## Blocking conditions

Phase 20.

## Security requirements

- Structural hospital ownership; one active employment in the database; no open-ended grants or
  Break-Glass sessions.
- Gate **G-1**.

## Downstream phases

22, 22A, 23, 24, 26

## Source / evidence

`docs/multi-hospital/AUDIT_FINDINGS.md`; `backend/prisma/schema/*.prisma`.
