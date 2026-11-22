# ADR-042 — Hospital Is the Isolation Boundary

> **Accepted 2026-11-22 and registered in `docs/DECISIONS.md`.** This file remains at its original
> path as the proposal record. The accepted entry in `docs/DECISIONS.md` is canonical.
---

## ADR-042 — Hospital Is the Isolation Boundary

**Status:** **Accepted** · **Date:** 2026-11-22 · **Owner:** Fares Al-Almashharawi. The owner-approved
implementation safeguards below are part of this decision.
**Supersedes:**
- **ADR-018 §1** (single clinic, no `clinic_id`, no tenant isolation tests). ADR-018 §2 (billing off) and
  §4 (mobile readiness) remain Accepted; §3 is already superseded by ADR-030.
- **ADR-010**'s scope-out of `clinics`/`facilities` (and the assertion in
  `backend/test/schema-adr010.e2e-spec.ts`).

**Supersedes in part:** **ADR-022**, only its anchor ("a doctor reaches a patient iff a
`patient_doctor_assignments` row links them", RM M7.2). ADR-022's 404-not-403 rule and "RLS before
production" remain.
**Decided by:** project owner (Fares Al-Almashharawi), 2026-10-06 / 2026-10-07: DR-01…DR-13,
OD-01…OD-14, OQ-01. Additional safeguards were approved 2026-11-22.
**Open:** OQ-02, the record-claim identity-proofing method. Patient record claiming remains blocked until
identity-proofing is explicitly decided.
### Context

Medora was specified and built as a single clinic (ADR-018 §1, ADR-010). The owner has decided that
Medora is a multi-hospital platform. The repository audit (`docs/multi-hospital/AUDIT_FINDINGS.md`,
AF-01…AF-40) shows that:
- no hospital entity or hospital column exists;
- authorization is anchored on doctor–patient assignment;
- several routes are platform-wide;
- patient clinical data hangs off the global patient;
- AI messages are stored verbatim.

### Decision

1. **Hospital is the security, authorization, clinical-data and tenancy boundary.** Clinic is a separate
   entity inside a Hospital. A Hospital has one or more Locations. Neither Clinic nor Location is a
   boundary (DR-01, OD-06).
2. **Doctors:**
   - at most one active hospital employment, with history kept;
   - no hospital switcher; hospital context resolved server-side from the active employment;
   - employment end revokes access derived from that employment to that hospital immediately, with no grace period; unrelated access is not revoked.

   (DR-02, DR-08, OD-12)
3. **Patients:**
   - one global identity;
   - one Medical Record per hospital, created on the first real interaction;
   - clinical children structurally bound to the record's hospital.

   (DR-03, DR-04, OD-09)
4. **Default access:** active hospital + role + permissions. Assignment is hospital-scoped workflow data
   and never a bypass (DR-05, DR-07).
5. **Cross-hospital access has two paths:**
   - **Grant:** purpose, target Hospital Admin approval, admin-selected categories, valid only for the
     purpose (no fixed default), revocable, audited, no patient consent (DR-06, OD-01…OD-03).
   - **Break-Glass:** emergency reason, minimum necessary, time-limited, fully audited and attributable,
     revocable where applicable, never permanent, never bypassing employment (OD-04).
6. **Documentation:** a doctor may selectively document authorized cross-hospital information into the
   requesting hospital's record after explicit review and approval. It becomes that hospital's data with
   provenance. It creates no access to the source and is never a whole-record copy (OQ-01).
7. **Consultations** between hospitals are allowed. They never bypass grants, Break-Glass controls, audit,
   employment or revocation (OD-13).
8. **Administration:**
   - Platform Admin: platform and hospital lifecycle, no automatic clinical access;
   - Hospital Admin: one hospital;
   - existing admin accounts are mapped deliberately.

   (OD-07)
9. **Discovery and booking:**
   - discovery is authenticated (comparison by distance, ratings, next slot, insurance);
   - uninsured patients are unrestricted;
   - only doctor-published slots, capacity 1, with DB-level protection against double booking.

   (DR-09…DR-11, OD-08, OD-10, OD-14)
10. **AI:**
    - hospital-only by default;
    - cross-hospital data only under a valid grant or Break-Glass, within scope and lifetime;
    - raw cross-hospital data is never retained afterwards (C1/C2/C3 data classes);
    - provider-agnostic gateway; assistant governance; capabilities developed in parallel with stronger
      gates for high-risk ones.

    (DR-12, DR-13, OD-05, OD-11)

**Technical choices recorded here** (details in `docs/multi-hospital/`):
- **Enforcement:**
  - data-access-layer enforcement now, RLS on clinical tables as a production gate;
  - 404 for another hospital's ids; hospital stamped from context;
  - composite foreign keys `(hospital_id, parent_id)`.
- **Constraints:**
  - partial unique index for one active employment;
  - booked-slot uniqueness and per-doctor overlap exclusion.
- **Cross-hospital entities:**
  - grant, Break-Glass session, access-event and documentation-provenance entities;
  - extend or replace `PatientAccessGrant`, never with role-wide cross-hospital grants (AF-38).
- **AI:** `ai_messages` gains data-class tagging; C2 is purged or made inaccessible at authorization end.

### Implementation safeguards

- Preserve all existing data, identifiers, clinical history, soft-deleted records and migration history.
  Existing migrations are not modified or replayed as part of this architecture decision.
- Never assign legacy clinical records to a default Hospital without a verified ownership mapping.
  Any data backfill requires separate explicit approval.
- Patient record claiming remains blocked while OQ-02 is open.
- Cross-hospital grants, Break-Glass, consultations, AI C2 retention/purge and provenance are architectural
  targets only. Do not implement them until their technical specifications are reviewed and approved.
- RLS is not considered complete until tenant-context handling and cross-hospital negative tests pass.
- This ADR does not authorize production database access, destructive migration, data backfill, deployment,
  push or merge. Each requires separate explicit approval.
### Consequences

**Database.**
- New: Hospital, Clinic, Location, employment, admin scope, per-hospital Medical Record, grants,
  Break-Glass, provenance, published slots, insurance coverage.
- `hospital_id` on hospital-owned tables. Backfill only rows with verified ownership mappings and only after separate explicit approval; never assign unmapped records by default.
- Per-hospital uniques.

**API.**
- Hospital-scoped routes; no switch route; no `/public/*`.
- New families: grants, Break-Glass, documentation, consultations, published slots, `/hospital-admin`,
  `/platform`.

**Backend.**
- `PatientScopeService` redesigned.
- Session invalidation on employment end.
- The AI context requires the hospital context and re-checks cross-hospital authorization every turn.

**Frontend / Patient App.**
- Active hospital, no switcher.
- Admin consoles split.
- Authenticated discovery and comparison; slot booking.
- Per-hospital records.

**Testing.**
- Negative and lifecycle tests N-1…N-30.
- Gates G-1…G-8 (`docs/multi-hospital/SECURITY_AND_DATA_ISOLATION.md`). No second real hospital before they pass, including tenant-context handling and cross-hospital negative tests.

### Alternatives considered

| Alternative | Rejected because |
|---|---|
| Organization as the boundary with multiple memberships and a switcher (2026-10-06 realignment) | Owner decisions DR-01, DR-02, DR-08 |
| Public / signed-out discovery | DR-09 |
| One shared medical record across hospitals | DR-03 |
| Grants only, no emergency path | OD-04: Break-Glass exists |
| Forbid documenting any cross-hospital information into the requesting record | OQ-01 = A (selective, doctor-approved) |
| AI never uses cross-hospital data | OD-05 = B (authorization-bound use, no retention) |
