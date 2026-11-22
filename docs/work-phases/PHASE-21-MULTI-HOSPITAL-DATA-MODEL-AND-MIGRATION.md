# Phase 21 — Multi-Hospital Data Model & Migration

**Origin:** audit-derived; reconciled with the FINAL owner decisions on 2026-10-07
**Primary Area:** Database (+ Backend)
**Status:** IN PROGRESS — ADR-042 is accepted; PR #5 adds only the initial Hospital, HospitalLocation
and Clinic foundation. The remaining data model, verified ownership mapping and migration work below
are not implemented.
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

Add the hospital-owned data model and integrate it in stages without breaking the running system.
Do not assign existing records to a default Hospital without a verified ownership mapping and separate
explicit approval; unmapped records remain unassigned.

## Why it exists

AF-01…AF-12, AF-35, AF-38, AF-39, AF-40.

## Owner decisions it implements

DR-01…DR-04, DR-06, DR-07, DR-10, DR-11, DR-12 (AI storage), OD-01, OD-03, OD-04, OD-06, OD-07, OD-08,
OD-09, OD-12, OD-13, OD-14, OQ-01, all FINAL. OQ-02 (open, deferred) affects record-claim tooling only.

## Deliverables

**Stage 1 — model** (`DATABASE_CHECKLIST.md` A–F)
- [x] [DATABASE] Initial additive `Hospital`, `Clinic` (separate entity), and `HospitalLocation`
  models and migrations are present on PR #5's unmerged feature branch. They do not provide clinical
  ownership or tenant authorization.
- [ ] [DATABASE] Complete the target model: staff affiliations, HospitalMedicalRecord, clinical
  ownership, composite tenant foreign keys, grants, booking, insurance, settings, and AI data classes.
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
- [ ] [DATABASE] Create any approved default hospital/location; backfill only rows with a verified
  ownership mapping and separate approval. Never blanket-assign legacy records. One active employment
  per doctor and Medical Record ownership are separate reviewed steps.
- [ ] [DATABASE] **Existing admin accounts mapped deliberately** to Platform Admin or Hospital Admin via a
  reviewed list. No automatic conversion (OD-07)
- [ ] [DATABASE] Use additive, forward-only expand/dual-read/validate stages. Any enforcement or schema
  contraction requires a separate explicit approval; do not rely on destructive down-migrations.
- [ ] [DATABASE] Gate seed (two hospitals with ≥2 locations and ≥1 clinic each, …)
- [x] [TESTING] PR #5 updates the superseded ADR-010 Clinic assertion and adds PostgreSQL 16 facility
  tests; `db:check` and `db:deploy` passed in disposable CI run 45038104419.
- [ ] [DATABASE] Fix or retire `database/schema.sql`

## Blocking conditions

Complete remaining Phase 20 review sign-offs and verify migration history/state for every target
environment before any persistent deployment. The PR #5 branch does not establish that status.

## Security requirements

- Structural hospital ownership; one active employment in the database; no open-ended grants or
  Break-Glass sessions.
- Gate **G-1**.

## Downstream phases

22, 22A, 23, 24, 26

## Source / evidence

`docs/multi-hospital/AUDIT_FINDINGS.md`; `backend/prisma/schema/*.prisma`.
