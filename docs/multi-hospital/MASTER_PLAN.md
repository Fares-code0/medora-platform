# Multi-Hospital — Master Plan

**Authority:** the FINAL owner decisions in `OWNER_DECISIONS.md` (DR-01…DR-13, OD-01…OD-14, OQ-01 = A).
Only OQ-02 (record-claim identity proofing) is open, and it is deferred to implementation.
This plan describes the **target**. `AUDIT_FINDINGS.md` describes the **current** implementation.

Markers used across this folder:
- **OWNER APPROVED** — decided by the owner (DR-xx / OD-xx)
- **TECHNICAL RECOMMENDATION** — an engineering proposal the engineering owner may change without a
  product decision
- **OPEN (OQ-02)** — the one remaining owner question (deferred; does not block the architecture)

> **Superseded architecture (do not build):**
> - Organization as the boundary; multiple simultaneous memberships; an active-organization switcher;
>   organization admin;
> - signed-out / public discovery and `/public/*` routes;
> - computed slots from working hours;
> - assignment as the universal access rule;
> - "AI never uses granted cross-hospital data";
> - "no Break-Glass" and "every cross-hospital access needs Hospital Admin approval";
> - "cross-hospital information can never be documented into the requesting hospital's record".
>
> These came from the 2026-10-06 realignment and earlier revisions of this folder. They remain only as
> history.

---

## 1. Concepts and glossary

| Term | Meaning | Source |
|---|---|---|
| **Hospital** | The security, authorization, clinical-data and tenancy boundary | DR-01 |
| **Clinic** | A separate entity belonging to one Hospital (e.g. an outpatient cardiology clinic). Never a boundary | DR-01, OD-06 |
| **Location** | A site of a Hospital (Main Campus, Emergency Center, Outpatient Location). **Multiple per hospital in v1.** Descriptive/operational, never a boundary | OD-06 |
| **Employment** | Doctor ↔ Hospital with a lifecycle. At most one active; history kept | DR-02 |
| **Active hospital** | The hospital of the doctor's active employment, resolved server-side. No switcher | DR-02, DR-08 |
| **Global patient identity** | One per person: identity, demographic, contact fields | OD-09 |
| **Medical Record** | One per patient per hospital, created on the first real interaction with that hospital. Never shared or global | DR-03, OD-09 |
| **Encounter record** | Today's `medical_records` row (`MR-…`), one clinical document per visit. Belongs to a Medical Record | TECHNICAL RECOMMENDATION |
| **Cross-Hospital Access Grant** | Normal path: purpose-bound, category-limited (categories chosen by B's Hospital Admin), revocable, audited permission for a doctor at A to read the patient's Medical Record at B. Valid only for the clinical purpose; no fixed default duration; no patient-consent step; never permanent | DR-06, OD-01…OD-03 |
| **Break-Glass access** | Emergency path: an authorized, actively employed doctor gets minimum-necessary, time-limited, fully audited access to one patient's data at another hospital without waiting for approval. Revocable where applicable; ends automatically; never permanent | OD-04 |
| **Cross-hospital documentation** | Selective information the doctor reviewed and explicitly saved into the **requesting** hospital's record. It becomes that hospital's data, with provenance; never a whole-record copy; never access to the source | OQ-01 |
| **Consultation** | Cross-hospital clinical conversation between doctors. Record data inside it still needs a grant or Break-Glass | OD-13 |
| **Platform Admin** | Platform-level administration (hospital lifecycle, Hospital Admin management, platform configuration). **No automatic clinical access** | OD-07 |
| **Hospital Admin** | Administers one hospital; approves or rejects cross-hospital requests targeting it | OD-07, DR-06 |
| **Published slot** | A doctor-published online time with capacity 1; the only patient-facing booking inventory | DR-10, OD-08 |

```text
Platform (Platform Admins)
└── Hospital  ◀── isolation boundary
    ├── Hospital Admins, Staff, Doctors (via active employment)
    ├── Clinics
    ├── Locations (1..n)
    ├── Medical Records (one per patient who interacted with this hospital)
    │     └── encounters, diagnoses, allergies, medications, vitals, labs, imaging,
    │         notes, prescriptions … (structurally bound to the same hospital)
    └── Published Slots ─▶ Appointments (patient, hospital, doctor, date, slot)

Global Patient Identity ──▶ Medical Record @ A, @ B, @ C …
```

## 2. Target vs current

| Area | Target | Current (`AUDIT_FINDINGS.md`) |
|---|---|---|
| Isolation | Hospital on every hospital-owned row; server-checked on every read and write | None (AF-01, AF-02) |
| Clinics / Locations | Separate entities under a Hospital; multiple Locations | One global `ClinicWorkingDay` set, one seeded clinic (AF-05, AF-12) |
| Doctor ↔ hospital | One active employment, history kept | `Doctor.hospital` free text; one `departmentId` (AF-03, AF-04) |
| Patient | Global identity + per-hospital Medical Records | Clinical data on the global patient (AF-07) |
| In-hospital access | Hospital + role + permissions | Assignment only (AF-14) |
| Cross-hospital | Two paths, grant (DR-06) and Break-Glass (OD-04); consultations (OD-13); selective doctor-approved documentation (OQ-01) | Not possible; messaging gap (AF-16); `PatientAccessGrant` without hospital (AF-38) |
| Admin | Platform Admin + Hospital Admin | One platform-wide `admin` (AF-15) |
| Discovery | Authenticated; compare by specialty, location, distance, next slot, ratings; insurance-aware | Authenticated doctor roster only, single clinic (AF-18); no geo data; unwritten `ratingAvg` |
| Booking | Published slots, capacity 1, DB-level guarantee | Working hours only, no DB double-booking guard (AF-10, AF-11) |
| AI | Hospital-only by default. Cross-hospital use only under a valid grant or Break-Glass; no raw retention afterwards; C1/C2/C3 data classes | 503 stub; no RAG; assignment-scoped context; verbatim message storage (AF-26…AF-30, AF-39) |

## 3. Hospital isolation — DR-01, DR-04, DR-05, DR-07, DR-08

- The hospital context is resolved **server-side** for every request:
  - doctor: from active employment;
  - Hospital Admin: from their hospital assignment;
  - Platform Admin: platform scope, with **no** clinical data;
  - patient: from the resource acted on.
- A client hospital id is never the authority.
- Enforcement lives in the data-access/authorization layer. Isolation must hold against direct ids,
  lists, search, filters, exports, aggregates, admin endpoints, assignments, messages, AI context and
  cached data.
- Structural constraints make a cross-hospital child row unrepresentable (DR-04).
- Assignments are hospital-scoped workflow data, never an access bypass (DR-07).

## 4. Doctor employment — DR-02, OD-12

- Hiring creates the active employment. Termination ends it with a reason and date.
- On termination: **immediate** revocation of hospital access, sessions, tokens, permission caches and
  dependent grants. No grace period. History and audit kept.
- A later employment at another hospital carries that hospital's permissions only.

## 5. Patients — DR-03, OD-09

- One global identity (person-level identity, demographic and contact fields).
- One Medical Record per hospital, **created on the first real interaction** (e.g. booking or visit;
  the exact trigger is fixed in the Phase 21/24 specification).
- Clinical data always lives under the per-hospital Medical Record.
- Insurance: TECHNICAL RECOMMENDATION is to treat the patient's coverage as person-level data on the
  global identity, because it drives discovery across hospitals (OD-14). It is administrative, not
  clinical.

## 6. Cross-hospital access — two legitimate paths (DR-06, OD-01…OD-04)

```text
PATH 1 — normal grant                              PATH 2 — emergency Break-Glass
Doctor @ A                                         Doctor @ A (active employment + Break-Glass permission)
 → request {patient, purpose, categories}           → emergency reason (required)
 → Hospital B Admin approves {categories, end}      → minimum-necessary emergency scope, one patient
   or rejects (audited)                             → time-limited window
 → category-scoped grant, purpose lifetime          → every access audited & attributed; B notified
 → every access audited                             → automatic end; revocable where applicable
 → ends: purpose end · expiry · revocation ·        → ends: window end · revocation ·
         requester employment end                           requester employment end
         ↓                                                  ↓
   access (doctor AND AI) stops immediately; no permanent access on either path
```

- **No fixed 7/30-day default** (OD-01).
- **No patient-consent step** for normal access (OD-02).
- **Categories** are chosen by the target Hospital Admin (OD-03).
- Neither path widens ordinary routes or creates permanent access.

### 6a. Doctor-approved documentation into the requesting hospital's record (OQ-01 = A)

```text
Hospital B authorized data (grant or Break-Glass)
  → doctor reviews → selects relevant information (AI may draft/summarize)
  → doctor explicitly approves and saves
  → new Hospital A Medical Record content with provenance
      (source hospital, authorization, categories, approving doctor, time)
  → Hospital A retention / access / audit rules apply
  → Hospital B original stays under Hospital B's control
```

- Selective only; never an entire external record.
- Saving creates no access to Hospital B.


## 7. Cross-hospital consultation — OD-13

Doctors at different hospitals may hold an auditable **consultation** (clinical conversation, patient
context, explicitly approved data categories). Viewing Hospital B's Medical Record from a consultation
still requires a valid grant or Break-Glass. Consultations never bypass isolation, grants, Break-Glass
controls, audit, employment or
expiry/revocation.

## 8. Discovery — DR-09, OD-10, OD-14

`Sign in → Discover hospitals → Discover doctors → Compare → Select doctor → View published slots → Book`.
- Comparison fields: hospital, doctor, specialty/department, location, **distance**, next published
  slot, **ratings/reviews**.
- Insured patients get insurance-aware results and coverage validation at booking.
- **Uninsured patients are unrestricted.**
- Details: `DISCOVERY_AND_BOOKING.md`.

## 9. Booking — DR-10, DR-11, OD-08

- Patients see only doctor-published slots.
- Each slot has capacity 1, and exactly one of N concurrent bookings succeeds, enforced in the
  database/transaction.
- Policies (cancel, reschedule, no-show, lead time) are implementation policy and cannot break
  capacity 1.

## 10. AI — DR-12 (= OD-05), DR-13 (= OD-11)

- **Default:** current-hospital context only.
- **Cross-hospital:** allowed only under **valid authorization**, either an approved grant (category
  included, purpose active, not expired or revoked, requester employed) or valid Break-Glass (within its
  emergency scope and window). Re-checked on **every** use. Only authorized data is used.
- **No raw retention:** when the authorization ends, the AI loses access. Raw cross-hospital data is not
  kept as permanent memory, unrestricted profile data, persistent RAG/vector content or training data.
- **Three data classes** (`AI_CHECKLIST.md` §1):
  - C1 same-hospital data, normal retention;
  - C2 transient cross-hospital context and un-approved derived output, tied to the authorization and
    purged or made inaccessible at the end;
  - C3 doctor-approved content saved into the requesting hospital's record, which is that hospital's
    data (OQ-01).
- **Capabilities** are developed in parallel. Higher-risk capabilities have stronger validation and
  release gates.
- **Provider-agnostic** gateway (the existing `AI_GATEWAY` seam).
- **Governance:** uncertainty is stated, never 100% certainty, professional evaluation recommended
  when appropriate.
- **Gate:** no real provider is enabled for these workflows before **G-5** passes.
- Details: `AI_CHECKLIST.md`.

## 11. Administration — OD-07

- Platform Admin: hospital lifecycle, Hospital Admin management, platform configuration; no automatic
  clinical access.
- Hospital Admin: one hospital, staff, cross-hospital approvals.
- Existing `admin` accounts are mapped deliberately during migration (M-13), never by default.

## 12. Dependencies and gates

- Order: `IMPLEMENTATION_ORDER.md`.
- Gates G-1…G-8: `SECURITY_AND_DATA_ISOLATION.md` §10. No second real hospital before all pass.

## 13. Out of scope

- Billing and payments (ADR-037/038/039).
- Drug reference data (D-18).
- Whole-record copying between hospitals (forbidden; OQ-01 permits only selective, doctor-approved
  documentation).
