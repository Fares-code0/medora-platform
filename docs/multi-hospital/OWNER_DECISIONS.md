# Multi-Hospital — Owner Decisions (Canonical, Final)

**Owner:** Fares Al-Almashharawi
**Decision dates:** 2026-10-06 (multi-hospital direction) · 2026-10-07 (DR-01…DR-13 clarification) ·
2026-10-07 (final OD-01…OD-14) · 2026-10-07 (**OQ-01 = A**, **OD-04 correction: Break-Glass exists**;
this revision)
**Status of this document:** **FINAL and authoritative.** When any other document, checklist, ADR draft,
phase file or code comment disagrees with this file, this file wins until ADR-042 is accepted.

This file holds only owner decisions. Technical choices are marked **TECHNICAL RECOMMENDATION** in the
other files of this folder.
- **All of DR-01…DR-13, OD-01…OD-14 and OQ-01 are FINAL.**
- The only open item is **OQ-02**, the identity-proofing method for claiming a pre-existing hospital
  record. It is deferred to implementation together with RA-030.1 and does not affect the Hospital
  isolation architecture.

> **Revision history.**
> - *Rev. 2 (2026-10-07):* listed OD-01…OD-14 as open and said AI may never use granted data.
>   Superseded by final OD-01…OD-14 and OD-05 = B.
> - *Rev. 3 (2026-10-07):* documented **OD-04 as "Break-Glass not approved"** and OD-02 as "resolved by
>   DR-06". Both readings were wrong or incomplete and are **superseded**:
>   - **OD-04 = A: Break-Glass Emergency Access exists.** Cross-hospital access therefore has **two**
>     legitimate paths, the normal grant and emergency Break-Glass.
>   - **OD-02:** patient consent is not required for normal cross-hospital access (owner decision, not
>     an inference).
>   - **OQ-01 = A:** doctor-approved, selective documentation into the requesting hospital's own record
>     is allowed.

---

## ADR status

No ADR in `docs/DECISIONS.md` records these decisions yet. ADR-018 §1, the ADR-010 clinics/facilities
clause and ADR-022's assignment anchor still read as Accepted and conflict with them
(`MIGRATION_AND_COMPATIBILITY.md` §1).

The ADR number for the Hospital architecture is **ADR-042**, verified 2026-10-07:
- highest published is ADR-039 (`backend`);
- ADR-040 and ADR-041 are held in `origin/backend:backend/docs/PENDING_ADRS.md`;
- ADR-042 appears only as "next free number" text.

A **draft** is held at [`ADR-042-DRAFT.md`](ADR-042-DRAFT.md), status *Proposed — pending owner
approval*. It is **not** entered in `docs/DECISIONS.md`. This mirrors the repository's practice of holding
unpublished ADRs outside the register (`backend/docs/PENDING_ADRS.md`), and it avoids a number collision
while ADR-039…041 live only on `backend`.

---

## Summary

| ID | Decision (one line) | Status |
|---|---|---|
| DR-01 | **Hospital** is the security, authorization, clinical-data and tenancy boundary. Clinic and Location are subordinate entities, never the boundary | FINAL |
| DR-02 | One active hospital employment per doctor; history kept; no switcher | FINAL |
| DR-03 | One separate Medical Record per patient per hospital; no universal record | FINAL |
| DR-04 | All clinical children belong to the same hospital as their Medical Record, enforced structurally | FINAL |
| DR-05 | Default doctor access = active hospital + role + permissions (not assignment) | FINAL |
| DR-06 | Cross-hospital access has **two** legitimate paths: (1) a purpose-bound, category-limited, revocable, audited **grant** approved by the target hospital's Admin; (2) emergency **Break-Glass** (OD-04). Neither is permanent | FINAL |
| DR-07 | Doctor–patient assignment never crosses hospitals and never bypasses isolation | FINAL |
| DR-08 | No doctor hospital switcher; hospital context resolved server-side | FINAL |
| DR-09 | Patient discovery requires sign-in; no public / signed-out discovery | FINAL |
| DR-10 | Patients see only doctor-published online slots | FINAL |
| DR-11 | One booking per slot, no double booking, enforced at the database/transaction level | FINAL |
| DR-12 | AI isolation: hospital-only by default. May use cross-hospital data **only** under a valid grant or valid Break-Glass access, within its scope and lifetime, and **must not retain raw cross-hospital data** afterwards (= OD-05). Doctor-approved content saved into the requesting hospital's record is that hospital's data (OQ-01) | FINAL |
| DR-13 | Broad AI scope, parallel development, provider-agnostic, assistant-not-doctor governance (= OD-11) | FINAL |
| OD-01 | Grant valid for the specific clinical/review purpose only; Admin may revoke any time; all events audited; **no fixed 7/30-day default** | FINAL |
| OD-02 | Patient consent is **not required** for normal cross-hospital access; the target hospital's authorized Admin approves or rejects; all audited | FINAL |
| OD-03 | Access is granular by Medical Record data category; the target Hospital Admin selects the categories; ungranted categories are inaccessible | FINAL |
| OD-04 | **Break-Glass Emergency Access EXISTS:** emergency reason, minimum necessary, time-limited, fully audited, attributable, revocable, never permanent, never bypassing employment, OD-05 AI rules | FINAL (A) |
| OD-05 | AI may use cross-hospital data under a valid grant or Break-Glass, within scope and lifetime; raw data not retained afterwards | FINAL (B + retention rule) |
| OD-06 | Clinic is a separate entity inside a Hospital; a Hospital may have multiple Locations in v1 | RESOLVED (Clinic = B, Locations = A) |
| OD-07 | Platform Admin + Hospital Admin; Platform Admin has no automatic clinical access; existing admin accounts are mapped deliberately | RESOLVED (B) |
| OD-08 | Each Published Slot: one doctor, at most one patient; atomic, concurrency-safe booking | RESOLVED (A) |
| OD-09 | Medical Record created on the first real interaction with a hospital; one global patient identity | RESOLVED (A + global identity) |
| OD-10 | After login, search and compare hospitals and doctors by specialty, location, distance, slots, ratings/reviews | RESOLVED (B) |
| OD-11 | Parallel capability development; provider-agnostic gateway; assistant governance | RESOLVED (B / A / A) |
| OD-12 | Employment end revokes hospital access immediately, with no grace period | RESOLVED (A) |
| OD-13 | Cross-hospital clinical consultation messaging allowed; never bypasses grants | RESOLVED (C) |
| OD-14 | Insurance-aware discovery and booking for insured patients; **no restriction** for uninsured patients | RESOLVED (A + no-insurance exception) |
| OQ-01 | Doctor-reviewed, doctor-approved, **selective** documentation of authorized cross-hospital information into the requesting hospital's own record is allowed; it becomes that hospital's data with provenance; never a whole-record copy; never access to the source | FINAL (A) |
| OQ-02 | Identity-proofing method for claiming a pre-existing hospital record | **OPEN / DEFERRED** to implementation (RA-030.1); does not change the architecture |

---

## DR-01 — Hospital is the isolation boundary

| Field | Value |
|---|---|
| **Decision** | Hospital is the primary security, authorization, clinical-data and tenancy/isolation boundary. Organization, Tenant, Location and Clinic are **not** the boundary. A **Clinic is a separate entity from Hospital**. A Hospital may contain multiple Clinics and multiple Locations. Hospital remains the isolation boundary. |
| **Status / Owner / Date** | FINAL · Fares Al-Almashharawi · 2026-10-07 |
| **Rationale** | Isolation follows the unit that owns clinical data and employs doctors. |
| **Consequences** | Every hospital-owned row carries its Hospital, and every scoped read and write is checked against a server-derived hospital context. Clinics and Locations are attributes *inside* a hospital, used for operations, discovery and display, never to grant or deny access across hospitals. |
| **Dependencies** | — (root) |
| **Superseded assumptions** | ADR-018 §1 (single clinic). ADR-010's scope-out of `clinics`/`facilities`. The 2026-10-06 "organization is the boundary" model. The previous revision's statement that a Location is subordinate and "existence undecided" (now decided, OD-06). |

```text
Platform
└── Hospital  ← isolation boundary
    ├── Clinics    (separate entity, belongs to one Hospital)
    └── Locations  (one or more in v1, belong to one Hospital)
```

## DR-02 — Doctor employment

| Field | Value |
|---|---|
| **Decision** | A doctor has at most **one active hospital employment** at a time (Doctor → Hospital A; ends → no active employment; later → Hospital B). Historical employment records remain as history. There must never be two simultaneously active employments. There is no hospital switcher. |
| **Status / Owner / Date** | FINAL · Fares Al-Almashharawi · 2026-10-07 |
| **Consequences** | Employment is a first-class record with a lifecycle. "Two active employments" must be unrepresentable in the database. The doctor's hospital context derives from the active employment. |
| **Dependencies** | DR-01 |
| **Superseded assumptions** | 2026-10-06 "memberships in several organizations", ORG-01 switcher, API-W01 `memberships[]`, API-W03 `affiliations[]`. `Doctor.hospital` free text as the source of truth. |

## DR-03 — One Medical Record per patient per hospital

| Field | Value |
|---|---|
| **Decision** | A patient has one separate Medical Record per Hospital (Patient X → Medical Record @ A, @ B, @ C). There is no universal shared medical record. |
| **Status / Owner / Date** | FINAL · Fares Al-Almashharawi · 2026-10-07 |
| **Consequences** | One global patient identity (OD-09) and *N* hospital-specific Medical Records. A Medical Record is never global or shared. |
| **Dependencies** | DR-01, OD-09 |
| **Superseded assumptions** | One `patients` row carrying all clinical data. The 2026-10-06 cross-organization "shared safety summary" (API-W04). |

> **Terminology — TECHNICAL RECOMMENDATION.** *Medical Record* (capitalized) = the owner's per-hospital
> record. Today's `medical_records` table (`MR-…`) stores **encounter documents**, several per patient
> (`DATA_MODEL_CHANGES.md` §3).

## DR-04 — Hospital ownership of clinical data

| Field | Value |
|---|---|
| **Decision** | Medical Records and everything clinically belonging to them belong to the same Hospital. That includes diagnoses, allergies, medications, vital signs, laboratory results, imaging, clinical notes, encounters, prescriptions and other record children. A child clinical row must never be attachable to a record from another hospital. Ownership is enforced **structurally**, not only in UI logic. |
| **Status / Owner / Date** | FINAL · Fares Al-Almashharawi · 2026-10-07 |
| **Consequences** | Database constraints (e.g. composite foreign keys) make a cross-hospital child unrepresentable. Patient-level clinical tables keyed to the global patient today must move under the Medical Record (AF-07). |
| **Dependencies** | DR-01, DR-03 |
| **Superseded assumptions** | ADR-018 §1 "no `clinic_id` on any table". |

## DR-05 — Default doctor access

| Field | Value |
|---|---|
| **Decision** | A doctor's normal access = **the doctor's active Hospital + role + permissions**. It is not determined universally by doctor–patient assignment. A doctor at Hospital A accesses Hospital A patient records according to role and permissions. Assignment may exist for workflow/business purposes but is not the universal security boundary. |
| **Status / Owner / Date** | FINAL · Fares Al-Almashharawi · 2026-10-07 |
| **Consequences** | `PatientScopeService`'s assignment anchor (M7.2, ADR-022) is redesigned. Read auditing becomes the compensating control for wider in-hospital access. |
| **Dependencies** | DR-01, DR-02, DR-04 |
| **Superseded assumptions** | ADR-022 / M7.2 "a doctor reaches a patient iff an assignment links them" (404-not-403 and RLS-before-production are kept). |

## DR-06 — Cross-hospital access (two paths)

| Field | Value |
|---|---|
| **Decision** | A doctor at Hospital A may access a patient's Medical Record at Hospital B **only** through one of two legitimate paths. **Path 1, normal Cross-Hospital Access Grant:** (1) the doctor requests access; (2) the request states the clinical/review purpose; (3) Hospital B's authorized Admin approves or rejects; (4) approval creates an explicit grant; (5) access is audited; (6) the grant is limited to the **approved data categories**; (7) it is valid only for the duration of the clinical purpose; (8) Hospital B Admin may revoke it at any time; (9) expiry, revocation or purpose end stops access **immediately**; (10) request, approval, rejection, access, revocation, expiry and related events are all audited. **Path 2, emergency Break-Glass (OD-04):** in a genuine emergency an authorized doctor obtains time-limited, minimum-necessary access without waiting for approval, under the controls in OD-04. **There is no permanent cross-hospital access on either path.** |
| **Status / Owner / Date** | FINAL · Fares Al-Almashharawi · 2026-10-07 |
| **Consequences** | Grants and Break-Glass sessions are separate entities from doctor–patient assignment. Each carries enough scope to enforce: requesting doctor (and employment), target hospital, patient, purpose or emergency reason, authorized data categories, approval or emergency attribution, validity state, expiry / end-of-purpose / emergency window, revocation, and audit trail. Both depend on the requester's active employment (OD-12). |
| **Dependencies** | DR-01, DR-03, DR-04, OD-01…OD-05, OD-07, OD-12 |
| **Superseded assumptions** | API-W04 shared safety summary. Any reading of grants as permanent. **Rev. 3's "every cross-hospital access goes through Hospital Admin approval"**, which is wrong: Break-Glass exists. |

```text
Path 1 — normal                                   Path 2 — emergency (Break-Glass)
Doctor @ A                                        Doctor @ A (active employment, authorized)
 → request {patient, purpose, categories}          → emergency reason
 → Hospital B Admin approves {categories, end}     → minimum-necessary emergency scope
 → category-scoped grant                           → time-limited window
 → purpose-limited access, audited                 → every access audited; B notified
 → revoke / expire / purpose end                   → automatic end; revocable where applicable
```

## DR-07 — Doctor–patient assignment

| Field | Value |
|---|---|
| **Decision** | Assignment never crosses hospitals and is not the universal authorization rule. It cannot bypass hospital isolation and cannot grant access to another hospital's records. |
| **Status / Owner / Date** | FINAL · Fares Al-Almashharawi · 2026-10-07 |
| **Consequences** | `patient_doctor_assignments` becomes hospital-scoped. Every assignment-gated feature re-checks the hospital. |
| **Dependencies** | DR-01, DR-05 |
| **Superseded assumptions** | ADR-022 / M7.2 "the assignment is the anchor". |

## DR-08 — No doctor hospital switcher

| Field | Value |
|---|---|
| **Decision** | Doctors have no hospital switcher. The active hospital context is resolved **server-side** from the authenticated employment/authorization context. A client-supplied hospital id is never the authority for clinical scope. |
| **Status / Owner / Date** | FINAL · Fares Al-Almashharawi · 2026-10-07 |
| **Consequences** | No switch route. Any hospital id in a request is at most a filter inside the caller's authorized scope, or the target of an explicit workflow (a grant request, a discovery query). |
| **Dependencies** | DR-02 |
| **Superseded assumptions** | ORG-01 switcher; API-W01 `POST /auth/session/organization`. |

## DR-09 — Authenticated patient discovery

| Field | Value |
|---|---|
| **Decision** | Patient discovery is not public. A patient signs in before discovering hospitals, doctors, departments/specialties, locations and available slots. No signed-out or public discovery, and no `/public/*` discovery model. |
| **Status / Owner / Date** | FINAL · Fares Al-Almashharawi · 2026-10-07 |
| **Consequences** | Discovery routes are authenticated patient routes. A patient needs no prior hospital relationship to search. |
| **Dependencies** | DR-01 |
| **Superseded assumptions** | 2026-10-06 G-11, E-01, H-06 signed-out discovery; API-P01–P05 "Public"; the earlier Phase 23 "Public Discovery API". |

## DR-10 — Doctor-published online slots

| Field | Value |
|---|---|
| **Decision** | Patients see **only** appointment slots that the doctor has explicitly published online. Calculated or generated availability based on working hours is never exposed. Working hours may exist internally for scheduling/business logic; they are not the patient's bookable inventory. |
| **Status / Owner / Date** | FINAL · Fares Al-Almashharawi · 2026-10-07 |
| **Consequences** | A dedicated `PublishedSlot` model/representation. |
| **Dependencies** | DR-01, DR-02 |
| **Superseded assumptions** | Computed slots ("availability − time-off − booked − buffer", API-P11, patient-app I-04). |

## DR-11 — One booking per slot / no double booking

| Field | Value |
|---|---|
| **Decision** | Every booking has exactly one Patient, one Hospital, one Doctor, one date and one Published Slot. Each Published Slot can be booked by only one patient; there is no multi-capacity slot. Concurrent requests for the same slot give exactly one successful booking. Double booking is prevented at the **database/transaction level**, not only by frontend checks. |
| **Status / Owner / Date** | FINAL · Fares Al-Almashharawi · 2026-10-07 |
| **Dependencies** | DR-01, DR-02, DR-10, OD-08 |
| **Superseded assumptions** | Appointments without a hospital; client-side conflict detection as the only guard. |

## DR-12 — AI hospital isolation and retention (= OD-05)

| Field | Value |
|---|---|
| **Decision** | **Default:** AI obeys hospital isolation (Patient → current hospital context → that hospital's Medical Record). **Cross-hospital:** AI **may** use cross-hospital data only while the doctor holds **valid authorization**, meaning either (a) an approved Cross-Hospital Grant whose categories include the data, whose clinical purpose is active and which is currently valid, or (b) valid Break-Glass access, within its minimum-necessary scope and emergency lifetime. AI may use **only** the data the doctor is authorized to use. **Retention:** when the authorization ends (expiry, revocation, purpose end, emergency window end, employment end), the AI **immediately loses access**. Raw cross-hospital data must not remain as permanent AI memory, unrestricted patient-profile data, persistent RAG/vector content or model-training data, and must not leave an AI-side permanent copy. Transient AI records derived from cross-hospital data follow the authorization/retention rules. **Exception (OQ-01 = A):** content the doctor explicitly reviews, approves and saves into the requesting hospital's own Medical Record becomes that hospital's clinical data and follows its normal rules. |
| **Status / Owner / Date** | FINAL · Fares Al-Almashharawi · 2026-10-07 |
| **Consequences** | AI context assembly re-checks authorization on every use. AI storage distinguishes three classes: (1) same-hospital conversation data; (2) transient cross-hospital context and AI output derived from it, tagged to its authorization and purged or rendered inaccessible when it ends; (3) doctor-approved content saved into the requesting hospital's record. Today `ai_messages` stores prompts and completions verbatim (AF-39), so class 2 must be designed before cross-hospital AI is enabled. |
| **Dependencies** | DR-04, DR-06, OD-04, OD-12, OD-13, OQ-01 |
| **Superseded assumptions** | Rev. 1's "AI never uses cross-hospital data, even under a grant". Rev. 3's grant-only wording (Break-Glass also authorizes AI use within its scope and lifetime). |

## DR-13 — AI product scope and governance (= OD-11)

| Field | Value |
|---|---|
| **Decision** | Planned scope, each capability individually approved/validated: medical AI assistant/chatbot; RAG / information retrieval; patient-history summaries; report/lab analysis; X-ray/MRI/CT analysis; second-opinion support; risk prediction; ambient scribing; consultation-note preparation; task automation; appointment assistance; doctor recommendation (also patient guidance and image-based patient assistance from the 2026-10-07 clarification). Capabilities may be developed **in parallel**; that does not make any of them production-ready. Higher-risk clinical capabilities require stronger validation, safety controls, evaluation, governance and release gates. **Provider-agnostic:** a provider adapter/gateway allows changing provider without rebuilding the core. **Governance:** AI is an assistant, not a doctor replacement. It communicates uncertainty, never claims 100% certainty, never presents uncertain output as fact, recommends professional evaluation when appropriate, and applies stronger safeguards to high-risk capabilities. |
| **Status / Owner / Date** | FINAL · Fares Al-Almashharawi · 2026-10-07 |
| **Dependencies** | DR-12 |
| **Superseded assumptions** | Phase 10 / M16's chat-only scope; a single sequential capability roadmap. |

---

## OD-01 … OD-14 — final answers

### OD-01 — Grant duration, expiry, revocation — FINAL
- Cross-hospital access is granted for a **specific clinical/review purpose** and is valid only for the
  duration of that purpose.
- The target hospital's Admin may revoke at any time.
- Grant, approval, use, revocation and expiration events are audited.
- **There is no fixed 7-day or 30-day default.**
- Expiry, revocation, purpose end or requester employment end (OD-12) stops access immediately, for the
  doctor and for the AI (DR-12).
- How "purpose end" is represented (an end set at approval, closure of the linked consultation or
  encounter, explicit closure by the requester or admin) is implementation design. It must never yield
  an open-ended grant (TECHNICAL RECOMMENDATION, `SECURITY_AND_DATA_ISOLATION.md` §3).

### OD-02 — Patient consent — FINAL
- Patient consent is **not required** for normal cross-hospital access.
- The target hospital's authorized Admin approves or rejects. All requests and access events are
  audited.
- Jurisdiction-specific legal review remains a go-live compliance check (Phase 31); it is not a design
  change.

### OD-03 — Grant scope — FINAL
- Access is granular by Medical Record **data category**.
- The target Hospital Admin explicitly selects which categories the requesting doctor may access.
- The doctor cannot access ungranted categories.
- The category taxonomy (aligned with DR-04: diagnoses, allergies, medications, vitals, lab results,
  imaging, clinical notes, encounters, prescriptions, …) is an implementation specification.

### OD-04 — Break-Glass Emergency Access — FINAL: A (EXISTS)
In a genuine emergency, an authorized doctor may obtain emergency access to another hospital's patient
data **without waiting for** the normal Hospital Admin approval workflow.

Break-Glass **must**:
- require the doctor to provide an **emergency reason**;
- enforce **minimum-necessary** data access;
- be **time-limited**;
- be **fully audited**;
- be attributable to the **requesting doctor**;
- be attributable to the **target hospital and patient**;
- record **what categories/data were accessed**;
- be **immediately revocable** where technically applicable;
- **not** create unrestricted permanent access;
- **not** bypass employment authorization;
- **not** bypass hospital isolation generally;
- **not** allow unrelated access after the emergency window ends;
- obey the **same AI restrictions** as OD-05.

AI under Break-Glass may use only the data the doctor is authorized to use through that emergency
access, within its minimum-necessary scope and emergency lifetime. When Break-Glass ends, the AI loses
access and retains no raw cross-hospital data (no permanent memory, RAG/vector data, patient-profile
data or training data).

Implementation specifications (not owner questions):
- which doctors are "authorized" (a role/permission, on top of active employment);
- the minimum-necessary emergency category set (clinical sign-off);
- the maximum emergency window, which must be bounded;
- the post-event review and notification flow for the target hospital.

### OD-05 — AI and cross-hospital data — FINAL: B + retention rule
AI may use cross-hospital data only while the doctor holds valid authorization, either an approved grant
or valid Break-Glass access, and only for its authorized scope and lifetime.

When that authorization ends:
- AI loses access;
- raw cross-hospital data does not remain in permanent AI memory, unrestricted patient-profile data,
  persistent RAG/vector storage or model training;
- transient AI records derived from cross-hospital data are handled by the authorization/retention
  rules.

Doctor-approved content intentionally saved into the requesting hospital's own Medical Record is
different: it becomes that hospital's clinical data (OQ-01). See DR-12.

### OD-06 — Clinic and Locations — RESOLVED: Clinic = B, Locations = A
- **Clinic** is a separate entity from Hospital. It belongs to one Hospital and does not replace
  Hospital as the isolation boundary.
- A Hospital may have **multiple Locations in v1** (e.g. Main Campus, Emergency Center, Outpatient
  Location). v1 is not designed around one location per hospital.
- Locations are descriptive/operational subdivisions and never security boundaries.

### OD-07 — Admin hierarchy — RESOLVED: B (Platform Admin + Hospital Admin)

```text
Platform Admin
├── Hospital A ── Hospital Admins, Staff
├── Hospital B ── Hospital Admins, Staff
└── Hospital C ── Hospital Admins, Staff
```

- **Platform Admin:** hospital lifecycle/configuration, hospital administration, Hospital Admin
  management, platform-level configuration. **Does not automatically receive access to clinical or
  medical records** because of the platform role; clinical access stays explicitly permissioned and
  audited.
- **Hospital Admin:** scoped to one hospital. Manages its hospital and its staff per permissions. Handles
  cross-hospital access requests targeting its hospital (DR-06). Cannot automatically access another
  hospital's clinical data.
- **Existing admin accounts** must be deliberately mapped to Platform Admin or Hospital Admin during
  migration/account reconciliation. **Do not assume** all existing admins are Platform Admins. This is
  an explicit migration task (`MIGRATION_AND_COMPATIBILITY.md` M-13).

### OD-08 — Booking — RESOLVED: A
- Each Published Slot belongs to exactly one doctor and can have exactly one patient (capacity 1).
- Booking is atomic, concurrency-safe, free of double booking, and correctly associates hospital,
  doctor and patient.
- Cancellation, rescheduling, no-show and lead-time rules are **implementation policy**, specified
  separately (`DISCOVERY_AND_BOOKING.md` §6). They must not contradict the one-patient-per-slot rule or
  the published-slot model.

### OD-09 — Medical Record creation and global patient identity — RESOLVED: A + global identity = YES
- A hospital's Medical Record for a patient is created on the patient's **first real interaction** with
  that hospital (e.g. booking, visit, or another defined hospital interaction). Records are not created
  for every hospital automatically. The exact trigger is made explicit during implementation (Phase 21 /
  24 specification).
- The patient has **one global identity** holding person-level identity, demographic and contact
  fields.
- The Medical Record is **never** a global shared record.
- Claiming and migration of existing records must preserve the identity/record distinction.

### OD-10 — Discovery — RESOLVED: B
After login, patients search and **compare** hospitals and doctors with information such as hospital,
doctor, specialty/department, location, **distance**, available published slots ("next available"),
**ratings/reviews** and other information useful for choosing where to book.

Example: *Cardiology → Hospital A · Dr. Ahmed · 4.8 · 2.1 km · Today 16:00 / Hospital B · Dr. Sara ·
4.6 · 5.4 km · Tomorrow 10:00*.

Discovery stays authenticated (DR-09). Ratings and reviews must not weaken hospital isolation or expose
private clinical information.

### OD-11 — AI — RESOLVED: capability order B, provider A, governance A
See DR-13.

### OD-12 — Employment end — RESOLVED: A
When a doctor's employment at Hospital A ends:
- Hospital A access is revoked **immediately**. Old sessions, tokens and permission caches must not
  keep granting it. **No grace period** for clinical-data access.
- Historical employment and audit history remain stored. Hospital A's Medical Records stay with
  Hospital A.
- Joining Hospital B later gives Hospital B permissions only. Previous Hospital A employment never
  leaks authorization into Hospital B.
- Cross-hospital grants that depend on the old employment become unusable at termination (for the
  doctor and for the AI).

### OD-13 — Cross-hospital messaging — RESOLVED: C
- Cross-hospital communication is allowed as a **clinical consultation workflow** (Doctor A @ A →
  Consultation Request → Doctor B @ B).
- A consultation may contain clinical conversation, patient context and explicitly approved data
  categories.
- **Medical Record access still requires the Cross-Hospital Access Grant** (or valid Break-Glass in an
  emergency). Messaging must not bypass hospital isolation, grants, Break-Glass controls, audit,
  employment authorization, or revocation/expiration.
- Consultation messages and access events are auditable.
- If AI participates, OD-05 applies: only currently authorized data, no raw retention after the grant or
  Break-Glass window ends.

### OD-14 — Insurance — RESOLVED: A with the no-insurance exception
- **Patient has insurance:** discovery and booking are insurance-aware. Covered hospitals,
  doctors/services and compatible bookable options are prioritized or shown. Booking validates
  applicable coverage.
- **Patient has no insurance:** the patient is **not restricted**. They see all available hospitals,
  all available doctors and available published slots, and can search, compare and book under normal
  rules.
- "No insurance" never means "no access to discovery".

---

## OQ-01 — Documenting cross-hospital information into the requesting hospital's record — FINAL: A

Cross-hospital information **may** be documented into the requesting hospital's own Medical Record, but
**only after explicit review and approval by the doctor**.

```text
Hospital B authorized data (valid grant or Break-Glass)
  → doctor reviews it
  → doctor selects relevant information (AI may help draft or summarize)
  → doctor explicitly approves and saves
  → content becomes Hospital A Medical Record data
      → Hospital A retention / access / audit rules apply
      → provenance records that it came from an authorized cross-hospital interaction
  → Hospital B's original record stays owned and controlled by Hospital B
```

Rules:
- **Selective, not a copy.** This is never permission to copy entire external medical records.
  Documentation is what the doctor judges relevant to the care at Hospital A.
- **Doctor approval is mandatory.** Nothing reaches Hospital A's record without the doctor's explicit
  review and save. An AI draft is transient (DR-12 class 2) until then.
- **Provenance.** It is auditable that the content originated from an authorized cross-hospital
  interaction: source hospital, authorization (grant or Break-Glass), categories, approving doctor and
  time.
- **No access by side effect.** Saving derived content into Hospital A's record creates **no**
  permanent access to Hospital B. The original Hospital B data stays reachable only through a valid
  grant or valid Break-Glass.
- **AI.** AI must not retain the raw Hospital B data as permanent memory, profile data, unrestricted
  RAG/vector data or training data merely because it was used. The only exception is the
  doctor-approved content saved into Hospital A's record, which is now Hospital A data.

## OQ-02 — Claiming a pre-existing hospital record — OPEN / DEFERRED (implementation decision)

How a patient's global Medora identity is linked to a Medical Record that a hospital created before the
patient used Medora (the identity-proofing method) is **not decided**.
- It is an identity-proofing and migration sub-decision, tracked with the existing **RA-030.1**
  (ADR-030).
- **It does not block the architecture.** It must be defined before record **claiming** is
  implemented (Phase 27, PA-11), and it must not change the Hospital isolation model.

## Implementation specifications delegated by the owner (not owner questions)

- the exact first-interaction trigger (OD-09);
- the data-category taxonomy (OD-03);
- how "purpose end" is represented (OD-01);
- Break-Glass authorized-doctor permission, emergency category set and maximum window (OD-04);
- cancellation, reschedule, no-show and lead-time policy values (OD-08);
- review moderation (OD-10);
- provider selection and its data-processing agreement (OD-11);
- the provenance format for documented cross-hospital content (OQ-01).
