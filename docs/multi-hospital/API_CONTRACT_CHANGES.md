# Multi-Hospital — API Contract Changes (Proposal)

**Status:** proposal for the Backend team. Implemented so far: the shadow-only `GET /auth/session` fields `activeHospital` and `adminScope` (Phase 22), the doctor employment lifecycle (§8a, #54) and administrative scope (§8b, S5); everything else is not implemented. Paths and shapes are **TECHNICAL
RECOMMENDATIONS**; the rules in §0 follow the FINAL owner decisions.
**Base path:** `/api/v1` (ADR-011). Errors use the machine `code` envelope (ADR-012).
**Supersedes:** the 2026-10-06 proposals API-W01…W14 (`origin/frontend:frontend/FRONTEND_CHECKLIST.md`
§9.1) and API-P01…P19 (`origin/patient-app:patient-app/PATIENT_FRONTEND_CHECKLIST.md`) wherever they
assume organizations, memberships, a switcher, public routes or computed slots (§9).

---

## 0. Rules for every contract

1. **The server derives the hospital context**:
   - doctor: active employment;
   - Hospital Admin: their hospital;
   - Platform Admin: platform scope only (no clinical data);
   - patient: the resource acted on.

   **A client-supplied hospital id is never trusted as an authorization mechanism.** A `hospitalId` in
   a request is at most a filter inside what the caller may already see, or the target of an explicit
   workflow (discovery filter, grant request, consultation request).
2. A client-supplied hospital id on create that differs from the context is **rejected**.
3. Another hospital's resource id answers **404**, not 403.
4. Hospital-owned resources carry `hospital: { id, name }` and, where relevant, `clinic` and
   `location`, for display only.
5. **No doctor switch route** (DR-08).
6. **No unauthenticated discovery or booking route.** No `/public/*` (DR-09).
7. Cross-hospital authorization (grant or Break-Glass) is re-checked on **every** call, including AI calls
   (DR-12).
   (DR-12).

## 1. Session and profile

| Method | Path | Change |
|---|---|---|
| GET | `/auth/session` | Adds `activeHospital: {id, name} \| null` (doctor, from active employment), `adminScope: { type: 'platform' } \| { type: 'hospital', hospital: {id, name} } \| null` (OD-07). No `memberships[]`, no switcher |
| GET | `/me/profile` | Adds `employment: { hospital, clinic?, department?, location?, startedOn } \| null` and read-only `employmentHistory[]`. Replaces free-text `hospital` |
| — | *(rejected)* `POST /auth/session/organization` | Not created (DR-08) |

Errors: `no_active_employment` (a doctor without active employment cannot use clinical routes, OD-12).

## 2. Hospital-scoped clinical data

These keep their paths and become hospital-scoped server-side (DR-04, DR-05): `/patients`,
`/patients/:id/*`, `/appointments`, `/medical-records`, `/lab-orders`, `/prescriptions`,
`/dashboard/doctor`, `/reports/analytics`, `/notifications`, `/search`.

Patient-detail routes resolve to the patient's **Medical Record at the caller's active hospital**.
Foreign ids answer 404.

## 3. Cross-hospital access (DR-06, OD-01, OD-03)

| Method | Path | Who | Body / result |
|---|---|---|---|
| POST | `/cross-hospital-access/requests` | Doctor @ A (active employment) | `{ patientId, targetHospitalId, purpose, categories[], consultationId? }` → `202 { id, status: 'pending' }`. No disclosure of the patient's existence at B before approval |
| GET | `/cross-hospital-access/requests?direction=outgoing` | Doctor | Own requests and status |
| GET | `/hospital-admin/cross-hospital-access/requests` | Hospital Admin of B | Incoming queue for B only |
| POST | `/hospital-admin/cross-hospital-access/requests/:id/approve` | Hospital Admin of B | `{ categories[] (⊆ requested), endsAt }`. An explicit end is required: no open-ended grants (OD-01). TECHNICAL RECOMMENDATION: `endsAt` required, plus purpose closure |
| POST | `…/:id/reject` | Hospital Admin of B | `{ reason }` |
| POST | `…/grants/:id/revoke` | Hospital Admin of B | Immediate effect |
| POST | `/cross-hospital-access/grants/:id/close` | Requesting doctor | Purpose ended; immediate effect |
| GET | `/cross-hospital/medical-records/:recordId/:category` | Doctor holding a valid grant | Read-only; only granted categories; every call re-checks validity and writes an access event |
| GET | `/hospital-admin/cross-hospital-access/events?grantId=` | Hospital Admin of B | Audit of the grant |

Grant states: `PENDING → APPROVED | REJECTED`. From `APPROVED` → `EXPIRED | REVOKED | CLOSED |
INVALIDATED` (requester's employment ended). Only `APPROVED`, not past `endsAt`, gives access.

## 3a. Break-Glass emergency access (OD-04)

| Method | Path | Who | Body / result |
|---|---|---|---|
| POST | `/cross-hospital-access/break-glass` | Doctor @ A with Break-Glass permission and an active employment | `{ patientId, targetHospitalId, reasonCode, reasonText }` (both reason fields required) → `201 { id, scopeCategories, endsAt }`. The scope is the minimum-necessary emergency set (implementation specification); the window is bounded by platform policy |
| GET | `/cross-hospital/break-glass/:sessionId/:category` | That doctor, during the window | Read-only, in-scope categories only, one patient; every call re-checks validity and writes an access event |
| POST | `/cross-hospital-access/break-glass/:id/end` | Requesting doctor | Ends early |
| POST | `/hospital-admin/break-glass/:id/revoke` | Hospital Admin of the target hospital | Immediate effect |
| GET | `/hospital-admin/break-glass?status=` | Hospital Admin of the target hospital | Notifications, post-event review queue, access events |

After the window: every Break-Glass read answers 404. A continuing need uses the normal grant path.

## 3b. Doctor-approved documentation into the requesting hospital's record (OQ-01 = A)

| Method | Path | Who | Body / result |
|---|---|---|---|
| POST | `/medical-records/:recordId/cross-hospital-documentation` | Doctor at A, while the grant or Break-Glass is valid | `{ authorization: {type, id}, items: [{ category, sourceRef, content }], aiAssisted }`. The server checks each `sourceRef` lies within the authorized categories, refuses whole-record imports, creates Hospital A content (e.g. a note or addendum) and a provenance row → `201` |

The saved content is Hospital A data. Its provenance exposes source ids and metadata only. Following a
`sourceRef` to Hospital B without valid authorization answers 404.

## 4. Cross-hospital consultation (OD-13)

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/consultations` | Doctor @ A | `{ consultantDoctorId, patientId?, topic }`. The consultant may be at another hospital; audited |
| POST | `/consultations/:id/messages` | Participants | Clinical conversation and patient context. Record **data** appears only via a valid grant's categories or valid Break-Glass |
| POST | `/consultations/:id/close` | Participants | May close a linked grant's purpose (TECHNICAL RECOMMENDATION) |

Messages never carry Medical Record data the caller could not otherwise read under a grant.

## 5. Authenticated discovery (DR-09, OD-10, OD-14)

All routes are `@Authenticated()` (patient audience). Signed-out callers get 401. Request rate
limiting is recommended (AF-20).

| Method | Path | Result |
|---|---|---|
| GET | `/patient/discovery/search?q&specialtyId&departmentId&hospitalId&clinicId&locationId&near=lat,lng&sort=distance\|rating\|nextAvailable&page` | Comparison rows: `{ hospital, clinic?, location, doctor, specialty, department?, distanceKm?, rating: {average, count} \| null, nextAvailableSlot?, insurance: { covered: boolean } \| null }` |
| GET | `/patient/hospitals`, `/patient/hospitals/:id` | Hospital profile: clinics, locations (address, coordinates for distance), departments, specialties, accepted insurance |
| GET | `/patient/doctors`, `/patient/doctors/:id` | Extends today's routes; one active hospital per doctor; ratings/reviews (non-clinical) |
| GET | `/patient/specialties` | Unchanged |
| GET | `/patient/doctors/:id/reviews` | Public-to-patients review text, moderated, with no clinical content (OD-10) |

Distance: `near` is supplied by the client per request and **not stored**. `distanceKm` is present only
when the location has coordinates (TECHNICAL RECOMMENDATION).

Insurance (OD-14):
- If the patient has insurance on their global identity, results are **insurance-aware**: covered
  options are prioritized or flagged, and `insurance.covered` is set.
- If the patient has **no insurance**, `insurance` is `null` and **nothing is filtered out**: all
  hospitals, doctors and slots are returned.

## 6. Published slots and booking (DR-10, DR-11, OD-08, OD-09, OD-14)

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/me/published-slots` | Doctor | `{ startsAt, durationMin, locationId?, clinicId? }[]` at the active hospital; capacity always 1 |
| DELETE | `/me/published-slots/:id` | Doctor | Withdraw an unbooked slot |
| GET | `/me/published-slots?from&to` | Doctor | Own slots with status |
| GET | `/patient/doctors/:id/slots?from&to` | Patient | **Only** `PUBLISHED`, unbooked, future slots |
| POST | `/me/appointments` | Patient | `{ slotId, reason, visitTypeId?, notes? }` + `Idempotency-Key` (ADR-014). Hospital, doctor and time derive from the slot. `409 slot_taken`. Insured patients: coverage validated (`422 insurance_not_covered` with `detail`); uninsured patients: no insurance check. On the patient's first interaction with that hospital the Medical Record is created (OD-09) |
| GET | `/me/appointments`, `/me/appointments/:id` | Patient | Each carries hospital, clinic, location |
| POST | `/me/appointments/:id/{cancel,reschedule,confirm}` | Patient | Per server `availableActions` and implementation policy (OD-08); never violates capacity 1 |
| GET | `/me/medical-records` | Patient | One entry per hospital where a Medical Record exists |

## 7. AI context (DR-12)

| Method | Path | Change |
|---|---|---|
| POST | `/ai/conversations` | Body `{ mode, patientId?, refId?, authorization?: { type: 'GRANT' \| 'BREAK_GLASS', id } }`. No hospital field. The server binds the conversation to the active hospital and validates the authorization on **every** turn |
| POST | `/ai/conversations/:id/messages` | Each turn re-checks: hospital context unchanged; any authorization still valid (grant: approved, in category, purpose open, not expired or revoked; Break-Glass: active, in window, in scope; requester employed). If not, the turn proceeds **without** cross-hospital data |
| — | authorization end | Server purges or makes inaccessible C2 artefacts (transient cross-hospital context and un-approved derived output). C1 conversation data keeps normal retention. Doctor-approved content saved via §3b is Hospital A clinical data (C3) (`AI_CHECKLIST.md` §1) |

## 8. Administration (OD-07)

- `/platform/*`: hospitals lifecycle and configuration, Hospital Admin management, platform settings.
  No clinical data.
- `/hospital-admin/*`: one hospital's administration (staff, doctor employment hire/end, clinics,
  locations, operations, oversight, logs, reports, cross-hospital approvals).
- Clinical access by any admin only through explicit permission, audited.

## 8a. Doctor employment lifecycle — implemented (OD-12, #54)

Administrator routes beside the existing `/doctors/*` administration, permission `doctors.manage`.
Since S5 (§8b) they are scoped: Platform Admin platform-wide, Hospital Admin its own hospital only.
`doctorId` is the `doctors.id` uuid, as on every other administrator doctor route; the hospital is
named by its public id. Responses carry ids and counts only — no patient data.

| Method | Path | Request → Response | Errors |
|---|---|---|---|
| GET | `/doctors/:doctorId/employments` | → `200 DoctorEmploymentView[]`, newest first: `{ id, doctorId, hospital: { id: publicId, name }, hospitalDepartment: { id, name } \| null, startedAt, endedAt, active }` | 404 unknown or soft-deleted doctor |
| POST | `/doctors/:doctorId/employments` | `{ hospitalId: <hospital public id>, hospitalDepartmentId?: uuid }` → `201 DoctorEmploymentView` | 404 unknown/soft-deleted doctor or hospital; `409 hospital_inactive` (hospital not `ACTIVE`); `409 employment_active` (DR-02: one active employment per doctor, enforced by the database); 422 department not in that hospital |
| POST | `/doctors/:doctorId/employments/:employmentId/end` | → `200 { employment, revokedAssignments, revokedHospitalRoles, revokedSessions }` | 404 unknown employment, or one belonging to another doctor; `409 invalid_status_transition` already ended |

Ending is immediate (OD-12, no grace period) and is one transaction: the employment row is locked
and `ended_at` is set only if still active; live `hospital_role_assignments` whose
`source_doctor_employment_id` is this employment are revoked (`revoked_at`; counted as
`revokedHospitalRoles` — independent grants and grants at other hospitals are untouched); live
`patient_doctor_assignments` whose `doctor_employment_id` is this employment are
revoked; **every** session of the doctor's account is revoked (the doctor's next request is 401 and
the refresh token is refused; with no other active employment, a new sign-in is refused — §8b); the audit row
`doctor.employment_ended` (metadata: employment, hospital and department ids, the counts) is written
on the same transaction. Starting writes `doctor.employment_started`. Both rows set
`audit_events.hospital_id` to the employment's hospital (server-derived; other events leave it NULL).

**Limitations:** legacy assignments with no `doctor_employment_id` are not touched (#17) and are only
counted (`legacyAssignmentsUntouched` in the audit metadata); published slots and permission caches
are not revoked.

## 8b. Doctor lifecycle at sign-in and per request — implemented (#18)

Owner decision 2026-11-23 (`OWNER_DECISIONS.md`, "Doctor lifecycle"). **Terminated** means a
`doctors` row with at least one `doctor_employments` row and none active (`ended_at IS NULL`); a
doctor with **no** employment rows (legacy, unmapped) is not terminated and keeps sign-in.

| State | Sign-in and token minting | Requests with an existing access token |
|---|---|---|
| Employment terminated | `POST /auth/login`, `/auth/otp/verify`, `/auth/otp/recovery`: **`403 account_inactive`** (existing code and message, after the password, exactly as a non-`ACTIVE` account). `POST /auth/refresh`: `401` and the session is revoked | `401 unauthorized` on every route (same as a dead session); `POST /auth/logout` still `204` |
| Suspended (`practice_status = suspended`) | Allowed (unchanged) | Own-account routes only (below). Every other authenticated route: **`403 practice_suspended`** (new code) |
| Unverified | Allowed (unchanged) | Unchanged here; clinical access is the authorization layer's |
| Vacation | Allowed (unchanged) | Unchanged |

Own-account routes a suspended doctor keeps: `GET /auth/session`, `POST /auth/logout`,
`GET`/`PATCH /me/profile`, `PUT /me/profile/photo`, `GET`/`PATCH /me/account`, `POST /me/password`,
`POST /me/password/verify`, `GET /me/2fa`, `POST /me/2fa/{setup,enable,reenroll,reenroll/confirm,disable}`,
`GET /me/sessions`, `POST /me/sessions/revoke-others`, `DELETE /me/sessions/:sessionId`,
`GET`/`POST /me/devices`, `DELETE /me/devices/:deviceId`, `GET /me/login-history`. Everything else —
including `/me/settings`, `/me/activity`, `/me/notification-preferences`, `/me/availability`,
`/patient/doctors` — is `403 practice_suspended`. Decided from the database on every request.

**New client-visible error code:** `practice_suspended` (403). Clients should show "your practice is
suspended; only your account settings are available" and not refresh or sign out on it. It needs
frontend and patient-app translations (not added here).

`GET /patient/doctors` and `GET /patient/doctors/:doctorId` additionally exclude terminated doctors
(already excluded: unverified, any practice status other than `active` — including vacation — and
soft-deleted). The detail route answers 404 for them.

## 8c. Administrative scope — implemented (S5, OD-07, 2026-11-24)

The existing administrator routes keep their paths; the `/platform/*` and `/hospital-admin/*` split in
§8 is not introduced. Every administrative route now resolves the caller's **administrative scope**
from the database on each request (`shared/authz/admin-scope.service.ts`, `AdminScopeGuard`):

| Scope | When |
|---|---|
| Platform Admin | `admin` role **and** a live, explicit `platform_admin_assignments` grant (never inferred from the role, M-13) |
| Hospital Admin | `admin` role, no grant, live hospital `admin` assignments in exactly **one** active hospital |
| none | anything else: unmapped admin, two hospitals, inactive hospital, both designations |

**Status codes (changed):**

- An administrator with **no** scope is **403 `forbidden`** on every administrative route (previously
  200 for any `admin`). Same generic body as `AuthorizationGuard`: a missing capability, not a hint.
- A **Hospital Admin** on a platform-only route is **403 `forbidden`**.
- A Hospital Admin addressing **another hospital's row** is **404** (ADR-022), as for a missing row.
- A **Platform Admin** on the queue / waiting-room routes is **403** (their rows name patients; OD-07:
  no automatic PHI).
- A **non-admin** account holding an administrative capability by override (e.g. `logs.view`,
  `roles.manage`) is **403** on these routes: an override is not an administrative scope.
  Reception's `GET /administration/queue` and `GET /administration/waiting-room` are unchanged.

| Routes | Platform Admin | Hospital Admin |
|---|---|---|
| `GET /administration/overview`, `GET /administration/audit-events` | platform-wide | counts/rows with its `hospital_id` |
| `/administration/staff` (CRUD) | all | staff with an active affiliation there; `POST` creates the affiliation |
| `GET /administration/departments` | all | catalogue, `staffCount` over its staff only |
| `POST/PATCH/DELETE /administration/departments` | yes | 403 (catalogue has no `hospital_id`) |
| `/administration/rooms`, `/administration/resources` (CRUD) | all | its `hospital_id`; stamped on create |
| `/administration/shifts` | all (legacy, hospital-less create) | its shifts; create needs an active affiliation (else 422 `staffId`), stamped |
| `/administration/queue*`, `/administration/waiting-room*` | 403 | its rows; `assign-room` only to its rooms (404) |
| working-days, holidays, announcements, policies, document-templates, platform-status, `/administration/jobs*` | yes | 403 |
| `/platform-settings*`, `/roles*`, `/permissions`, `/users/:id/permissions` | yes | 403 |
| `/admin/users*` | all accounts | its staff (active employment / affiliation / live hospital role there), never `admin` or `patient` accounts |
| `/doctors`, `/doctors/:id*` (admin) | all | doctors with an active employment there |
| `GET /doctors/:id/employments` | all | its employments only |
| `POST /doctors/:id/employments` | any hospital | only its own hospital; a doctor employed elsewhere is 404 (not 409) |
| `POST /doctors/:id/employments/:eid/end` | any | its employments only |
| `GET /audit-events`, `/:id`, `POST /audit-events/export` | whole metadata-only ledger (unchanged) | rows with its `hospital_id`; export audited under that hospital |
| `GET /auth/session` `adminScope` | `{ type: 'platform' }` | `{ type: 'hospital', hospital }`; `null` with no scope |

Not scoped by S5 (outside its files): `/admin/appointments*`, `/admin/record-issues*`,
`/admin/conversations*`, `/admin/message-flags*`, `POST /auth/admin-invitations`, the patient directory
and reveal (`/patients*`). `/me/incident-bookmarks` stays owner-scoped (no ledger content).

## 9. Mapping from the 2026-10-06 proposals

| Old | Fate |
|---|---|
| API-W01 `activeOrganization`, `memberships`, switch | **Superseded** by §1 (one active hospital, no switch) |
| API-W02 organization-scoped routes | **Kept as** §2, scoped by Hospital |
| API-W03 `affiliations[]`, availability by location | **Superseded** by single employment (§1) and published slots (§6) |
| API-W04 shared cross-organization safety summary | **Superseded** by the grant workflow (§3) |
| API-W05…W13 admin/console | **Kept in intent**, as `/hospital-admin/*` and `/platform/*` (§8) |
| API-W09 staff messaging | **Replaced** by in-hospital messaging + cross-hospital consultation (§4) |
| API-W14 scoped search | **Kept** (§2) |
| API-P01–P05 *public* organizations, doctors, specialties | **Superseded**: authenticated `/patient/*` (§5) |
| API-P06 ratings | **Kept**, now with reviews (§5, OD-10) |
| API-P07 distance/nearby | **Now in scope** (OD-10), authenticated (§5) |
| API-P08 rate limiting as a prerequisite for *public* routes | **Re-scoped**: recommended for authenticated discovery and booking |
| API-P10 appointments with organization/location | **Kept as** hospital + clinic + location (§6) |
| API-P11 computed slots | **Superseded** by doctor-published slots (DR-10) |
| API-P12/P13 book and actions | **Kept**, keyed by `slotId` (§6) |
| API-P14 enrollments | **Replaced** by `/me/medical-records` (§6) |
| API-P15 claim a record | Method open (OQ-02 / RA-030.1) |
| API-P16 health records with source | **Kept**, per hospital Medical Record |
| API-P17 patient messaging | Hospital-scoped when unblocked (AD-1 / BE-13) |
| API-P18/P19 organization on announcements/notifications | **Kept as** hospital |

## 10. AI patient-assistant tool contracts (proposal, 2026-10-10)

**Status:** proposal. Nothing in this section is implemented. Tasks, owners and blockers:
`BACKEND_CHECKLIST.md` §K (AST-*). Decisions it waits on: K.3 (KD-1…KD-12). AI-side tasks: `AI_CHECKLIST.md` §6 (AG-3.\*, AG-4.\*; formerly AIA-C1…AIA-C12);
Database prerequisites: `DATABASE_CHECKLIST.md` §I.

The ten capability names below (`search_hospitals`, …) are the AI engineer's **logical** vocabulary.
They are not endpoint names. Each one maps to one Backend route, and the "Today" field says whether that
route exists. The model never gets database access, SQL or a generic query tool (`BACKEND_CHECKLIST.md`
K.0).

### 10.1 Rules for every tool

| Concern | Rule |
|---|---|
| Authentication | A signed-in patient session. Signed out → 401 (DR-09). Under KD-1 (a) the tool runs inside the Backend with the request's own principal, and the tool registry simply has no confirm. Under KD-1 (b) the AI service needs a credential the Backend can tell apart from the app's, or the confirm route cannot refuse it (§10.2); plain forwarding of the patient's token does not satisfy this (K.3, KD-1). A platform-wide service credential is never used |
| Patient identity | The session, resolved by `PatientSelfScopeService`. **No tool argument names a patient**; a `patientId` argument is refused as an unknown key |
| Hospital context | Never taken from model text. Discovery: `hospitalId` is a filter only. Booking: from the slot. Actions on an appointment: from the appointment row. A write whose supplied `hospitalId` differs from the derived one is rejected (§0 rule 2) |
| Validation | One strict zod schema per tool, the same one the HTTP route uses. Unknown keys, oversized strings and bad id formats → 422 `validation_failed` with field paths. Never coerced or repaired |
| Results | The same allow-listed projections as the HTTP routes (`FORBIDDEN_DOCTOR_FIELDS` and its successors). `pageSize` for tools capped below the HTTP cap (value set in AST-E4) |
| Writes | Only through an appointment intent (§10.2). Never a direct write tool |
| Idempotency | `Idempotency-Key` on every write (ADR-014). Same key with a different body → 422 `idempotency_key_reused` |
| Audit | One `assistant.tool_call` event per call: tool, outcome code, latency, conversation id, user id, hospital id if any. No argument values or free text |
| Rate limits | Per user and per IP (AST-G1, KD-7); 429 `rate_limited` with `Retry-After` |
| Freshness | Read results are snapshots. A listed slot is not a reservation; only the write-time check decides |

### 10.2 Confirmation: appointment intents (KD-2 recommendation)

A model may **prepare** a write. Only the patient, by an action in the app, may **confirm** it.

| Method | Path | Who | Body / result |
|---|---|---|---|
| POST | `/me/appointment-intents` | Patient session; callable as a tool; `Idempotency-Key` required (ADR-014), so a retried prepare returns the same intent | `{ action: 'book' \| 'cancel' \| 'reschedule', slotId?, appointmentId?, newSlotId?, reason?, visitTypeId?, notes? }` → `201 { intentId, action, summary: { hospital, clinic?, location?, doctor, startsAt, durationMin, timezone, currentAppointment? }, expiresAt }`. Runs every check the commit would run (ownership, slot state, policy, coverage) and writes **only** the intent. Failures surface now (e.g. `409 slot_taken`) |
| GET | `/me/appointment-intents/:intentId` | Patient; callable as a tool (read) | The summary the app renders on its confirmation card, the intent `status` (`prepared\|confirmed\|discarded\|expired`) and, once confirmed, the resulting appointment id and status. This is how the assistant learns the authoritative result (AG-4.4) |
| POST | `/me/appointment-intents/:intentId/confirm` | Patient, **from the app only**. Not in the tool registry; refuses an assistant-delegated credential | No body parameters; `Idempotency-Key` required. Executes the stored action with the stored parameters, revalidating at write time. Result identical to the §6 route it stands for |
| POST | `/me/appointment-intents/:intentId/discard` | Patient; callable as a tool | Idempotent |

Rules: an intent is bound to the patient, the action, its target and a hash of its parameters; it is
single use and short-lived (TTL set in AST-D7). Another patient's intent → 404. Expired → 409
`intent_expired`. Already confirmed or discarded → 409 `intent_used`. The §6 write routes stay for the
app's own screens, where the patient's tap is the confirmation. Under KD-1 (b) they also refuse an
assistant-delegated credential, so the model cannot bypass the intent.

**Two different "confirm" operations.** `POST /me/appointment-intents/:intentId/confirm` (this section,
AST-D7) confirms a booking, cancellation or rescheduling the assistant prepared. `POST
/me/appointments/:id/confirm` (§6, AST-D6) is the patient accepting a doctor's proposed slot
(`awaiting-patient`, ADR-033 Q3). The second is not an intent action and no assistant tool reaches it.

**Four distinct steps.** *Prepare* writes only an intent. *Confirm* is the patient's action in the app.
*Create* is the Backend executing the §6 write inside the confirm call. *Read* is `GET` on the intent or
on `/me/appointments/:id`; only a read reports the authoritative result.

### 10.3 Capability mapping

Tool names are the AI team's (`AI_TOOLING_AND_BOOKING.md`, header table). The prepare halves of
`create_appointment`, `cancel_appointment` and `reschedule_appointment` are the tools
`propose_appointment`, `propose_cancellation` and `propose_reschedule` (earlier text called the first
one `prepare_booking`). `get_intent` and `discard_intent` read and withdraw an intent. The confirm of
§10.2 (`confirm_booking` in earlier text) is the patient app's action and is **not** a model tool.

#### `search_hospitals`
| Field | Value |
|---|---|
| Today | **Not implemented** (BL-4) |
| Route | `GET /patient/hospitals` (§5) |
| Request | `q?` (1–120), `specialtyId?`, `near?` (`lat,lng`), `sort?` ∈ `name\|distance\|nextAvailable`, `page`, `pageSize` |
| Response | `Paginated<{ hospital: {id, name}, locations: [{id, name, distanceKm \| null}], specialties: [{id, name}], nextAvailableSlot: {slotId, startsAt, timezone} \| null, insurance: {covered} \| null }>` |
| Authorization | Any signed-in patient; active hospitals only; no ownership dimension |
| Rules | `sort=distance` needs `near`; `near` is never stored or logged; uninsured → `insurance: null`, nothing filtered (OD-14) |
| Errors | 401, 422 `validation_failed`, 429 `rate_limited` |
| Idempotency | Read |
| Audit | Tool-call event only |
| Tests | AST-H1, AST-H2, AST-H11 |
| Owner / deps | Backend · AST-B1, AST-B6, AST-B8 · DATABASE A1–A3, E5 |

#### `get_hospital_details`
| Field | Value |
|---|---|
| Today | **Not implemented** (BL-4) |
| Route | `GET /patient/hospitals/:hospitalId` (§5) |
| Response | `{ id, name, clinics[], locations: [{id, name, address, latitude?, longitude?, timezone}], departments[], specialties[], acceptedInsurance[] \| null }` |
| Authorization | Any signed-in patient; active hospitals only |
| Errors | 401; 404 `not_found`, identical for unknown, suspended and malformed ids; 429 |
| Idempotency / audit | Read · tool-call event |
| Tests | AST-H1, AST-H11 |
| Owner / deps | Backend · AST-B2 · DATABASE A1–A3 |

#### `search_doctors`
| Field | Value |
|---|---|
| Today | **Exists, single clinic:** `GET /patient/doctors` with `q`, `specialtyId`, `departmentId`, `sort` ∈ `name:asc\|name:desc\|rating:desc`, `page`, `pageSize` ≤100. Returns `PatientDoctorSummary` `{id, fullName, title, specialty, departmentName, photoUrl, yearsOfExperience, languages, ratingAvg}` |
| Change | Add `hospitalId?`, `clinicId?`, `locationId?`, `near?` filters and `hospital`, `clinic?`, `location?`, `nextAvailableSlot`, `rating: {average, count} \| null`, `insurance` fields |
| Authorization | Any signed-in patient; verified, actively practising doctors with an active employment only (DR-02) |
| Errors | 401, 422, 429 |
| Idempotency / audit | Read · tool-call event |
| Tests | Existing `test/patient-api.e2e-spec.ts`, extended by AST-H1 |
| Owner / deps | Backend · AST-B3 · DATABASE A4–A5 |

#### `get_doctor_details`
| Field | Value |
|---|---|
| Today | **Exists, single clinic:** `GET /patient/doctors/:doctorId` → `PatientDoctorDetail` (summary plus biography, education, certifications, skills, `officeLocation`, `officeHours`, specialties) |
| Change | Add the employment's hospital, clinic and location |
| Errors | 401; 404 identical for unknown, invisible and malformed ids |
| Idempotency / audit | Read · tool-call event |
| Tests | Existing forbidden-field cases, extended by AST-B4 |
| Owner / deps | Backend · AST-B4 · DATABASE A4 |

#### `get_available_slots`
| Field | Value |
|---|---|
| Today | **Not implemented** (BL-5). Working hours exist but are internal (DR-10) |
| Route | `GET /patient/doctors/:doctorId/slots?from&to` (§6) |
| Request | `doctorId`, `from`, `to` (ISO-8601; bounded window, maximum set in AST-C2), `locationId?` |
| Response | `{ asOf, items: [{ slotId, startsAt, durationMin, timezone, hospital, clinic?, location? }] }` |
| Rules | `PUBLISHED`, unbooked, future only; a snapshot, not a reservation; `timezone` per KD-8 |
| Errors | 401; 404 unknown doctor; 422 window invalid or too wide; 429 |
| Idempotency / audit | Read · tool-call event |
| Tests | AST-H5, AST-H11 |
| Owner / deps | Backend · AST-C2, AST-C3 · DATABASE E1 · KD-8 |

#### `get_my_appointments`
| Field | Value |
|---|---|
| Today | **Exists, single clinic:** `GET /me/appointments` with `status[]`, `from`, `to`, `upcoming`, `sort`, `page`, `pageSize`; items `{id, startsAt, durationMin, status, priority, reason, isNewPatient, isFollowUp, visitType, departmentName, doctor}` plus `clinicTimezone` |
| Change | Add `hospital`, `clinic?`, `location?` and per-item `timezone` |
| Authorization | Ownership as a WHERE clause; an unlinked account gets an empty page |
| Hospital | All of the patient's own appointments, each labelled with its hospital |
| Errors | 401, 422, 429 |
| Idempotency / audit | Read · tool-call event |
| Tests | Existing `test/patient-appointments.e2e-spec.ts`, extended by AST-D2 |
| Owner / deps | Backend · AST-D2 · DATABASE E2 |

#### `get_appointment_details`
| Field | Value |
|---|---|
| Today | **Exists, single clinic:** `GET /me/appointments/:appointmentId` → summary plus `notes`, `cancelledReason`, `events[]` (coarse actor only), `clinicTimezone` |
| Change | Hospital fields; `availableActions` once KD-3 is resolved, never before |
| Errors | 401; 404 identical for unknown, another patient's and unlinked |
| Idempotency / audit | Read · tool-call event |
| Tests | Existing spec, extended by AST-D3 and AST-H3 |
| Owner / deps | Backend · AST-D3 · KD-3 |

#### `create_appointment`
| Field | Value |
|---|---|
| Today | **Not implemented.** `POST /me/appointments` is absent and asserted absent |
| Route | Tool: `POST /me/appointment-intents` `{action: 'book', slotId, reason, visitTypeId?, notes?}`. Commit: patient confirm (§10.2), executing `POST /me/appointments` (§6) |
| Response | Prepare: the intent summary. Confirm: `201 { id, status, hospital, doctor, startsAt, durationMin, timezone }`. `status` per KD-5, reported verbatim |
| Rules | Slot `PUBLISHED` and future, rechecked in the write transaction; hospital and doctor from the slot; insured → coverage validated; first interaction → Medical Record (OD-09); identity per KD-4 |
| Errors | 401; 404 unknown slot or intent; 409 `slot_taken` (`detail.reason` ∈ `booked\|withdrawn\|past`); 422 `insurance_not_covered`; 409 `patient_identity_required` (KD-4); 409 `intent_expired` / `intent_used`; 422 `idempotency_key_reused`; 422; 429 |
| Concurrency | Database guarantee: exactly one of N concurrent bookings of a slot succeeds (DR-11) |
| Audit | `appointment_intent.prepare`, `appointment_intent.confirm`, `appointment.book` (channel `assistant`) |
| Tests | AST-H5…AST-H9, AST-H15 |
| Owner / deps | Backend (AI: presents the summary and asks) · AST-D1, AST-D7, AST-D8 · KD-2, KD-4, KD-5 · DATABASE E1–E3, B1–B2 |

#### `reschedule_appointment`
| Field | Value |
|---|---|
| Today | **Not implemented** for patients. A doctor-side `POST /appointments/:id/reschedule` exists and is not reachable by a patient |
| Route | Tool: `POST /me/appointment-intents` `{action: 'reschedule', appointmentId, newSlotId}`. Commit: patient confirm, executing `POST /me/appointments/:id/reschedule` |
| Rules | Owner only; policy window (KD-3); never across hospitals; old slot released and new slot booked in one transaction |
| Errors | 401; 404 (unknown or not yours); 409 `slot_taken`; 409 `appointment_action_not_allowed` (policy, with `detail`); 409 `invalid_status_transition`; 409 `stale_write` (lost race); intent and idempotency errors as above; 429 |
| Audit | `appointment.reschedule` plus intent events |
| Tests | AST-H3, AST-H7, AST-H9, AST-H10 |
| Owner / deps | Backend · AST-D5, AST-D7 · **KD-3** |

#### `cancel_appointment`
| Field | Value |
|---|---|
| Today | **Not implemented** for patients (doctor-side `POST /appointments/:id/cancel` exists) |
| Route | Tool: `POST /me/appointment-intents` `{action: 'cancel', appointmentId, reason}`. Commit: patient confirm, executing `POST /me/appointments/:id/cancel` |
| Rules | Owner only; reason required (DB CHECK); policy window (KD-3); compare-and-set |
| Errors | 401; 404; 409 `appointment_action_not_allowed`; 409 `invalid_status_transition`; 409 `stale_write`; intent and idempotency errors; 422; 429 |
| Audit | `appointment.cancel` plus intent events |
| Tests | AST-H3, AST-H7, AST-H10 |
| Owner / deps | Backend · AST-D4, AST-D7 · **KD-3** |

### 10.4 Error-code reference for tools

Existing codes keep their meaning (ADR-012). New codes are **proposed** and become fixed when first shipped.

| Code | HTTP | Exists today? | Meaning | Recovery for the assistant |
|---|---|---|---|---|
| `unauthorized` | 401 | Yes | No or expired session | Ask the patient to sign in again; never retry with another credential |
| `not_found` | 404 | Yes | Unknown, invisible or not the caller's | Say it was not found; never guess another id |
| `validation_failed` | 422 | Yes | Malformed arguments (field paths in `details`) | Fix the arguments from the patient's words, or ask |
| `rate_limited` | 429 | Yes (auth only today) | Too many requests | Wait `Retry-After`; tell the patient |
| `service_unavailable` | 503 | Yes | Provider or dependency down | Say the action did not happen |
| `invalid_status_transition` | 409 | Yes | The appointment's status does not allow the action | Re-read the appointment and explain |
| `stale_write` | 409 | Yes (doctor-side appointments) | Lost a concurrent update | Re-read; do not retry blindly |
| `slot_taken` | 409 | Proposed (§6) | Slot booked, withdrawn or past (`detail.reason`) | Offer to fetch fresh slots |
| `insurance_not_covered` | 422 | Proposed (§6) | Insured patient, option not covered | Explain; offer covered options |
| `appointment_action_not_allowed` | 409 | Proposed | Policy window forbids the action (`detail` says why) | Explain the policy result verbatim |
| `patient_identity_required` | 409 | Proposed (KD-4) | Account has no global patient identity yet | Direct the patient to the identity step in the app |
| `intent_expired` | 409 | Proposed | Confirmation window passed | Prepare a new intent |
| `intent_used` | 409 | Proposed | Intent already confirmed or discarded | Re-read the appointment |
| `idempotency_key_reused` | 422 | Proposed (ADR-014) | Same key, different request | A client bug: new key for a new request |

### 10.5 Proposed amendments from the unified AI plan — NOT adopted

**Status: proposals only.** They come from the unified AI plan (`AI_INTEGRATION_CONTRACTS.md` §CA, merged
into `Ai` by PR #56).
- **Conditional:** each applies **only if KD-2 chooses option (i)**, the appointment intent. Writing them
  down does not choose option (i), and does not approve KD-2.
- **Not in force:** they need the **Backend lead's** review (and the **Database lead's** for the storage
  parts, `DATABASE_CHECKLIST.md` I.2) before any of them is adopted.
- **Authoritative text:** until a later PR adopts them, §10.2–§10.4 above is the contract.
- **Adoption** means a PR that edits §10.2–§10.4 themselves, with the leads' approval recorded, and then
  removes the row from this table.

| CA | Section it would change | Authoritative now (§10.2–§10.4) | Proposed (conditional on KD-2 (i)) | Review needed |
|---|---|---|---|---|
| CA-1 | §10.2 states; §10.4 | `status` ∈ `prepared\|confirmed\|discarded\|expired` | Add `failed` (with a `code`, e.g. `slot_taken`) and `unknown`. `unknown` is never reported as success | Backend lead; Database lead (I2 states) |
| CA-2 | §10.2 confirm | "No body parameters; `Idempotency-Key` required. Executes the stored action with the stored parameters, revalidating at write time" | In addition, book with an idempotency key derived from the intent id, so a repeated confirm with a new client key still books at most once. On a timeout or 5xx from booking, the intent becomes `unknown` and the **server** reconciles by replaying with the same key or by reading the patient's appointments for that slot. Never a blind retry of a non-idempotent booking | Backend lead (ADR-014 applies) |
| CA-3 | §10.2 confirm | No read-back step | Before an intent becomes `confirmed`, read the appointment back through the patient's own read path and return those details | Backend lead |
| CA-4 | §10.2 confirm result | "Result identical to the §6 route it stands for" | The confirm response is the intent: `{ intentId, status, appointment?, code? }`, the same shape as `GET /me/appointment-intents/:intentId` | Backend lead |
| CA-5 | §10.2 rules; AST-D7 | "single use and short-lived (TTL set in AST-D7)" | TTL of 10 minutes unless the Backend lead records another value | Backend lead |
| CA-12 | §10.2 discard | Discard route; no "decline" | The patient app's "Decline" button calls discard; there is no separate decline route | Backend lead |
