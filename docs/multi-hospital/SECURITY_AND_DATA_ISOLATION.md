# Multi-Hospital — Security and Data Isolation

**Governing decisions (FINAL):** DR-01…DR-12, OD-01…OD-08, OD-12, OD-13, OQ-01.
**Work phases:** 22, 22A, 28, and **30 (the critical gate)**.
**Status:** NOT STARTED. No hospital isolation and no cross-hospital test exist today (AF-23).

> **Correction history.**
> - Rev. 1 required AI to exclude grant-covered data.
> - Rev. 3 documented "no Break-Glass" and forbade documenting cross-hospital content into the
>   requester's record.
> - Both are **superseded**:
>   - cross-hospital access has two legitimate paths, a **grant** and emergency **Break-Glass**
>     (OD-04);
>   - AI may use data authorized by either path within its scope and lifetime, with no raw retention
>     (OD-05);
>   - doctor-approved selective documentation into the requesting hospital's record is allowed
>     (OQ-01 = A).

---

## 1. The isolation model

| Subject | Rule | Source |
|---|---|---|
| **Default** | Hospital isolation: hospital-owned rows visible only inside their hospital | DR-01, DR-04 |
| **Clinics / Locations** | Subdivisions inside a hospital; never security boundaries | DR-01, OD-06 |
| **Doctor** | Active hospital + role + permissions. Assignment is workflow only and never crosses hospitals | DR-02, DR-05, DR-07 |
| **Hospital context** | Resolved server-side; a client hospital id is never authoritative | DR-08 |
| **Patient** | Global identity; one Medical Record per hospital | DR-03, OD-09 |
| **Cross-hospital, path 1 — grant** | Requested with a purpose; target Hospital Admin selects categories; valid only for the clinical purpose; revocable any time; audited; never permanent; no patient-consent step | DR-06, OD-01, OD-02, OD-03 |
| **Cross-hospital, path 2 — Break-Glass** | Genuine emergency only. Emergency reason; minimum necessary; time-limited; fully audited and attributable; revocable where applicable; never permanent; never bypasses employment or general isolation | OD-04 |
| **Documentation into own record** | The doctor may selectively document authorized cross-hospital information into the **requesting** hospital's record after explicit review and approval. It becomes that hospital's data, with provenance. No access to the source by side effect; never a whole-record copy | OQ-01 |
| **Consultation** | Allowed between hospitals; record data only through a grant or Break-Glass; audited | OD-13 |
| **AI** | Default current hospital only. Cross-hospital data only under a valid grant or Break-Glass, within scope and lifetime; no raw retention afterwards; doctor-approved saved content excepted | DR-12, OD-05 |
| **Booking** | Hospital from the slot; capacity 1 enforced in the database | DR-10, DR-11, OD-08 |
| **Discovery** | Authenticated only; reviews never expose clinical information | DR-09, OD-10 |
| **Platform Admin** | No automatic clinical access; any clinical access explicitly permissioned and audited | OD-07 |
| **Hospital Admin** | One hospital; decides grants targeting it; reviews Break-Glass events targeting it; no automatic access to other hospitals | OD-07 |
| **Employment end** | Immediate revocation of access, sessions, tokens, caches, grants and Break-Glass sessions; no grace period | OD-12 |

## 2. Enforcement principles

These follow `docs/handoff/clinic-isolation.md` §4 with "clinic" read as "hospital", plus the owner rules.
TECHNICAL RECOMMENDATION unless noted.

1. Derive the hospital from the server-side context, never from the request (DR-08).
2. Enforce in the data-access/authorization layer, not per controller.
3. Isolation holds against direct ids, lists, search, filters, exports, aggregates, admin endpoints,
   assignments, messages, AI context and cached data.
4. Return 404, not 403, for another hospital's resource (ADR-022).
5. Stamp the hospital on create from context; reject a mismatching client value.
6. Use structural constraints so a child row cannot belong to another hospital than its parent (DR-04).
7. Audit cross-hospital denials.
8. RLS on patient/clinical tables is a **production security gate** (G-8, ADR-022).
9. Client-side checks are display rules only. The fail-open `useClinicScope` (AF-17) is never a
   hospital-isolation mechanism.

## 3. Path 1 — Cross-Hospital Access Grant controls

- A grant carries:
  - requester and employment; source hospital; target hospital; patient;
  - clinical purpose;
  - **approved categories** (selected by the target Hospital Admin);
  - approver and time;
  - validity state;
  - explicit end / purpose closure;
  - revocation;
  - audit trail.
- **No fixed 7/30-day default** (OD-01). Purpose end is explicit — TECHNICAL RECOMMENDATION:
  - an end set at approval; and/or
  - closure of the linked consultation or encounter; plus
  - early closure by the requester or admin.
  - Never open-ended.
- Validity is re-checked on **every** access, never cached past the request:
  - approved, not expired, not revoked, purpose open;
  - requester employed;
  - category included.
- Grant-based reads use a separate code path and endpoint family. Each read writes an access event.
- Enumeration resistance: before approval, the requester learns nothing about the patient at B.
- Audited events: request, approval (with categories), rejection, each access, revocation, expiry,
  purpose end, invalidation by employment end.

## 4. Path 2 — Break-Glass controls (OD-04)

| Control | Requirement (owner) | Mechanism (TECHNICAL RECOMMENDATION) |
|---|---|---|
| Who | An authorized doctor with an **active employment**; never bypasses employment | Dedicated permission (e.g. `crossHospital.breakGlass`) on top of active employment; not available to admins |
| Reason | Emergency reason required | Structured reason code + free text, both mandatory |
| Scope | Minimum necessary | One patient per session. A predefined emergency category set (implementation specification with clinical sign-off), never all categories by default |
| Time | Time-limited | Bounded window set by platform policy, with no open-ended sessions; ends automatically |
| Audit | Full, attributable to doctor, target hospital and patient, with categories and data accessed | Every read writes an access event (category, resource ids); session start and end events |
| Revocation | Immediate where technically applicable | Target Hospital Admin (and platform security) can end a session; validity re-checked on every request |
| After the window | No unrelated or continued access | Session `ENDED`; subsequent requests 404; the doctor must use path 1 for any continuing need |
| Oversight | — | Target Hospital Admin notified at session start; post-event review queue at the target hospital |
| AI | Same restrictions as OD-05 | AI uses only the session's scope, only during the window; C2 purge at end (`AI_CHECKLIST.md` §1) |

Break-Glass does **not** create a grant, permanent access or any widening of ordinary routes.

## 5. Documentation into the requesting hospital's record (OQ-01 = A)

- **Who and when:** only the doctor, by an explicit review-and-save action, while the authorization
  (grant or Break-Glass) is valid.
- **What:** selected, relevant information within the authorized categories. **No** "import entire
  record" capability. TECHNICAL RECOMMENDATION: per-item selection and a server-side check that every
  source reference lies within the authorized categories.
- **Result:** a new Hospital A clinical entry, e.g. a note or addendum on the encounter. It is
  **Hospital A data** under Hospital A's retention, access and audit rules.
- **Provenance:** source hospital, authorization type and id, categories, source references, approving
  doctor, time. Provenance references never resolve to Hospital B data without a valid authorization.
- **No side effect:** saving creates no access to Hospital B. The original stays reachable only through
  a valid grant or Break-Glass.
- **AI drafts:** remain C2 (transient) until the doctor saves (`AI_CHECKLIST.md` §1).

## 6. Employment changes (OD-12)

On termination:
- the active employment ends;
- sessions and refresh tokens lose hospital context **immediately**;
- permission caches are invalidated across instances (AF-25);
- grants and Break-Glass sessions requested under that employment become unusable;
- AI access ends (C2 purge);
- client caches are cleared.

There is no grace period. History and audit are kept, and Hospital A's records stay with Hospital A.

## 7. Auditing

- Every clinical read and write is recorded with its hospital (`audit_events`, ADR-024 partition
  design).
- Read auditing and anomaly review compensate for DR-05's wider in-hospital access.
- Grant, Break-Glass and consultation events and every cross-hospital access are auditable.
- Documentation saves (OQ-01) record provenance.
- Audit stores metadata, not clinical content.

## 8. Cache, session and AI-store isolation

TECHNICAL RECOMMENDATION:
- Caches holding hospital-scoped data are keyed by hospital.
- Permission caches are invalidated on employment, role, grant and Break-Glass changes.
- AI stores follow the C1/C2/C3 classes (`AI_CHECKLIST.md` §1).
- C2 is never in persistent indexes, profiles, long-term memory, logs or training.

## 9. Required negative and lifecycle tests

Seed:
- Hospitals **A** and **B**, each with ≥2 Locations and ≥1 Clinic;
- doctor **dA** at A, with Break-Glass permission; doctor **dA2** at A, without it;
- doctor **dB** at B;
- doctor **dX**, employment at B ended, now at A;
- patient **P** with Medical Records at A and B;
- Hospital Admins **aA** and **aB**; Platform Admin **pA**;
- insured patient **Pi**; uninsured patient **Pu**.

| # | Attempt | Expected |
|---|---|---|
| N-1 | dA → P @ B by id, list, search, filter, export, aggregate, without authorization | 404 / absent |
| N-2 | dA with an approved grant (allergies, labs) → those categories via the grant path | Allowed; access events written |
| N-3 | dA with that grant → P @ B notes (ungranted) | 404 |
| N-4 | dA with a valid grant or Break-Glass → P @ B via **ordinary** routes | 404 (no widening) |
| N-5 | Grant expired / revoked / purpose ended / dA's employment ended | Access stops immediately |
| N-6 | dA's assignment to P @ A → P @ B | 404 (DR-07) |
| N-7 | dX (ended at B) → B data through old sessions, tokens, caches, AI conversations, grants or Break-Glass | Refused, no grace period |
| N-8 | Create with `hospitalId = B` in the body (record, appointment, message, slot) | Rejected |
| N-9 | aA approves, lists or reads requests targeting B | 404 |
| N-10 | aA reads B's staff, rooms, queue, appointments, logs, reports, exports | 404 / absent |
| N-11 | pA reads any patient's clinical record without explicit permission | Refused and audited |
| N-12 | AI for dA without authorization → P @ B data | Excluded |
| N-13 | AI for dA with a valid grant → only granted categories, only while valid | Allowed within scope |
| N-14 | AI after authorization end (grant or Break-Glass) | No further use; C2 inaccessible and purged; nothing in RAG, profile, memory, logs or training |
| N-15 | Consultation dA ↔ dB showing P @ B record data without a grant or Break-Glass | Refused; audited |
| N-16 | Message thread with arbitrary participant ids or an unrelated `patientId` (AF-16) | Rejected |
| N-17 | Two concurrent bookings of one Published Slot | Exactly one succeeds |
| N-18 | Booking a slot of a doctor @ B | Appointment belongs to B |
| N-19 | Unauthenticated discovery, slots or booking | 401 |
| N-20 | Uninsured Pu discovery | All hospitals, doctors and slots visible |
| N-21 | Insured Pi books an uncovered option | Coverage validation applies |
| N-22 | Reviews in discovery | No clinical or identifying content |
| N-23 | Cache leak after dX's employment change | No B data anywhere |
| N-24 | **Break-Glass** by dA with an emergency reason → P @ B emergency categories | Allowed during the window; every access audited and attributed; aB notified |
| N-25 | Break-Glass without a reason, by dA2 (no permission), by an admin, or by a doctor without active employment | Refused |
| N-26 | Break-Glass → non-emergency category or another patient | 404 (minimum necessary, one patient) |
| N-27 | After the Break-Glass window ends or aB revokes it | Next request 404; AI loses access; C2 purged |
| N-28 | **Doctor saves** selected authorized B information into A's record (with provenance) | Saved as Hospital A data. Still readable at A after the grant ends; the B source stays inaccessible |
| N-29 | Save attempted after authorization ended, by the AI alone, by a non-doctor, or as a whole-record import | Refused |
| N-30 | Provenance reference on a saved A entry used to fetch B data without authorization | 404 |

## 10. Mandatory security gates (FINAL)

No second real hospital is onboarded until every gate is green in CI.

| Gate | Requirement | Tests | Phase |
|---|---|---|---|
| **G-1** | Two hospitals in seed/test data; every hospital-owned clinical row has a valid hospital scope | schema checks | 21 |
| **G-2** | A Hospital A doctor cannot access Hospital B data through id, list, search, export, aggregate, assignment, message, admin path or cache, unless explicitly authorized by the grant workflow or valid Break-Glass | N-1, N-6, N-8, N-9, N-10, N-11, N-16, N-23 | 22, 30 |
| **G-3** | Grant and Break-Glass tests cover request, approval, rejection, category restriction, valid access, expiry, revocation, purpose termination, emergency reason, minimum necessary, emergency window end, audit, and no widening of ordinary routes | N-2…N-5, N-15, N-24…N-27 | 22A, 30 |
| **G-4** | Employment termination immediately removes hospital access, including old sessions, tokens, caches, grants and Break-Glass | N-5, N-7, N-23 | 22, 25, 27, 30 |
| **G-5** | **AI:** obeys hospital isolation by default; uses cross-hospital data **only** under a valid grant or Break-Glass, within its categories/scope and lifetime; stops immediately at the end; **retains no raw cross-hospital data** (no permanent memory, RAG/vector storage, patient-profile memory or training). Doctor-approved saved content behaves as requesting-hospital data. Must pass **before a real AI provider is enabled** for these workflows | N-12…N-14, N-27, N-28, `AI_CHECKLIST.md` T1–T13 | 28, 30 |
| **G-6** | Concurrent booking attempts for one Published Slot produce exactly one successful booking | N-17, N-18 | 24, 30 |
| **G-7** | Patient discovery requires authentication, and the message-thread authorization gap is closed | N-16, N-19…N-22 | 23, 27, 29, 30 |
| **G-8** | Production clinical-data security has RLS / defence in depth, and no unresolved High/Critical isolation findings | security review; N-28…N-30 | 30 |
