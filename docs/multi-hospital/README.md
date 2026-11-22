# Medora Multi-Hospital Documentation

This folder is the authoritative architecture specification for Medora as a multi-hospital platform.
The repository implementation remains partial; backend feature integration is still single-clinic
(AUDIT_FINDINGS.md).

- **Owner:** Fares Al-Almashharawi
- **Decisions:** `OWNER_DECISIONS.md`. All of DR-01…DR-13, OD-01…OD-14 and **OQ-01** are **FINAL**
  (2026-10-07). Only **OQ-02** (record-claim identity proofing, RA-030.1) is open, and it is deferred to
  implementation.
- **ADR:** ADR-042 is Accepted (2026-11-22) and registered in docs/DECISIONS.md; ADR-042-DRAFT.md is retained as the source copy.

- **Roadmap:** `docs/work-phases/` (Phases 20–31 and 22A)

## Read in this order

| # | File | For |
|---|---|---|
| 1 | [`OWNER_DECISIONS.md`](OWNER_DECISIONS.md) | Everyone. All final decisions; OQ-02 deferred |
| 1a | [`ADR-042-DRAFT.md`](ADR-042-DRAFT.md) | Accepted ADR source copy; canonical entry is in docs/DECISIONS.md |
| 2 | [`AUDIT_FINDINGS.md`](AUDIT_FINDINGS.md) | Everyone. Current code (AF-01…AF-40) and the terminology audit |
| 3 | [`MASTER_PLAN.md`](MASTER_PLAN.md) | Everyone. Target architecture, glossary, target vs current |
| 4 | [`IMPLEMENTATION_ORDER.md`](IMPLEMENTATION_ORDER.md) | Leads |
| 5 | [`DATA_MODEL_CHANGES.md`](DATA_MODEL_CHANGES.md) | Database, Backend |
| 6 | [`DATABASE_CHECKLIST.md`](DATABASE_CHECKLIST.md) | Database |
| 7 | [`BACKEND_CHECKLIST.md`](BACKEND_CHECKLIST.md) | Backend |
| 8 | [`API_CONTRACT_CHANGES.md`](API_CONTRACT_CHANGES.md) | Backend, Frontend, Patient App |
| 9 | [`DISCOVERY_AND_BOOKING.md`](DISCOVERY_AND_BOOKING.md) | Backend, Patient App, Frontend |
| 10 | [`CLIENTS_CHECKLIST.md`](CLIENTS_CHECKLIST.md) | Frontend, Patient App |
| 11 | [`AI_CHECKLIST.md`](AI_CHECKLIST.md) | AI, Backend |
| 12 | [`SECURITY_AND_DATA_ISOLATION.md`](SECURITY_AND_DATA_ISOLATION.md) | Security, Testing, everyone |
| 13 | [`MIGRATION_AND_COMPATIBILITY.md`](MIGRATION_AND_COMPATIBILITY.md) | Database, Backend, Architecture |

## The architecture in one screen

| Topic | Final rule | ID |
|---|---|---|
| Boundary | **Hospital** is the security, clinical-data and tenancy boundary | DR-01 |
| Clinic / Location | Clinic is a separate entity inside a hospital; a hospital has **multiple Locations** in v1; neither is a boundary | DR-01, OD-06 |
| Doctors | One active hospital employment; history kept; no switcher; context resolved server-side | DR-02, DR-08 |
| Employment end | Immediate revocation of access, sessions, tokens, caches, grants and Break-Glass; no grace period | OD-12 |
| Patients | One global identity; one Medical Record per hospital, created on the first real interaction | DR-03, OD-09 |
| Clinical data | Structurally owned by the Medical Record's hospital | DR-04 |
| Doctor access | Active hospital + role + permissions; assignment is workflow only and never crosses hospitals | DR-05, DR-07 |
| Cross-hospital, normal | Grant: requested with a purpose; categories chosen by the target Hospital Admin; valid for the purpose only (no fixed default); revocable; audited; no patient consent needed; never permanent | DR-06, OD-01…OD-03 |
| Cross-hospital, emergency | **Break-Glass:** emergency reason, minimum necessary, time-limited, fully audited and attributable, revocable where applicable, never permanent, never bypassing employment | OD-04 |
| Cross-hospital documentation | Doctor-reviewed, doctor-approved, **selective** documentation into the requesting hospital's own record. It becomes that hospital's data with provenance; never a whole-record copy; never access to the source | OQ-01 |
| Consultation | Cross-hospital doctor consultation allowed; record data only through a grant or Break-Glass | OD-13 |
| Admins | Platform Admin + Hospital Admin. Platform Admin has no automatic clinical access. Existing admins are mapped deliberately | OD-07 |
| Discovery | Signed-in only; compare by specialty, location, distance, next slot, ratings/reviews | DR-09, OD-10 |
| Insurance | Insured: insurance-aware discovery and validated booking. **Uninsured: unrestricted** | OD-14 |
| Booking | Only doctor-published slots; capacity 1; DB-level no double booking | DR-10, DR-11, OD-08 |
| AI | Hospital-only by default. Cross-hospital data only under a valid grant or Break-Glass, within scope and lifetime. **No raw retention after the authorization ends** (C1/C2/C3 classes). Doctor-approved saved content is the requesting hospital's data. Parallel capabilities; provider-agnostic; assistant governance | DR-12 (OD-05), DR-13 (OD-11), OQ-01 |

## Superseded architecture (history only — do not build)

- Organization as the boundary.
- Multiple simultaneous memberships; an active-organization or hospital switcher.
- Signed-out / public discovery and `/public/*` routes.
- Computed slots from working hours.
- Assignment as the universal access rule.
- "AI never uses granted cross-hospital data".
- "No Break-Glass" / "every cross-hospital access needs Hospital Admin approval".
- "Cross-hospital information can never be documented into the requesting hospital's record".
- Locations, admin hierarchy, booking, discovery, insurance and messaging as "owner decision required".

## Classification used in every file

| Marker | Meaning |
|---|---|
| **OWNER APPROVED / FINAL** | A DR-xx or OD-xx decision. Only the owner may change it |
| **TECHNICAL RECOMMENDATION** | How to implement. The engineering owner may change it, recorded in ADR-042 or the phase file |
| **OPEN / DEFERRED (OQ-02)** | The only open item: record-claim identity proofing, deferred to implementation |
| **Implementation policy / specification** | Values or details the owner delegated to implementation (e.g. cancellation windows, category taxonomy, first-interaction trigger) |

## Specialist check

| Specialist | Can they proceed without guessing a product decision? |
|---|---|
| Database | Yes. Hospital, Clinic, multiple Locations, employment, admin scopes, global identity + per-hospital records, grants, Break-Glass sessions, documentation provenance, consultations, slots, insurance coverage, AI data classes. Claim tooling waits for OQ-02 |
| Backend | Yes. Context, authorization redesign, grants, Break-Glass, doctor-approved documentation, consultations, discovery with distance/ratings/insurance, booking, AI authorization and retention |
| AI | Yes. Default isolation; authorization-bound use (grant or Break-Glass); C1/C2/C3 retention; parallel capabilities; provider-agnostic; governance |
| Frontend | Yes. Active hospital, no switcher, Platform/Hospital Admin consoles, grant / Break-Glass / consultation / documentation UI, slot publishing |
| Patient App | Yes. Sign-in → discover/compare (distance, ratings, insurance; uninsured unrestricted) → published slots → book; per-hospital records |
| Security | Yes. N-1…N-30 and gates G-1…G-8 |

## What this folder does not change

This documentation does not itself implement application code, schema changes, migrations, tests, or deployment.
ADR-042 is accepted and registered; ADR-018 source text is retained, with its supersession recorded in ADR-042.
