# Backend hospital-isolation enforcement inventory (post Phase 22)

**Status:** audit record, 2026-11-23 · **Base:** `main` at `1803ead` (PR #52) · **Owner:** Backend ·
**Tracks:** #27 (enforcement), #16 (OD-07), #18, #20, #22–#26

This is an evidence-based inventory of where hospital-level isolation must eventually be enforced
in the Backend. It is **not** an enforcement change. Nothing here activates RLS, adds a blanket
hospital filter, makes the Phase 22 shadow authoritative, or grants Platform Admin anything.

## 1. Baseline facts (verified in code, not taken from the brief)

| Fact | Evidence |
|---|---|
| No domain module reads the hospital context or filters by `hospital_id` | `grep -rn "hospitalId\|HospitalContextService" src/modules` matches only `auth/services/session-user.service.ts` (session display) |
| The only authoritative clinical gate is the legacy care-assignment rule | `shared/authz/patient-scope.service.ts` `canReach` → `PatientAssignmentRepository.isAssigned`; the shadow result is discarded |
| `isAssigned` checks only `revoked_at IS NULL`, doctor and patient | `shared/authz/prisma-patient-assignment.repository.ts:42-57`: no hospital, employment, practice-status or doctor soft-delete predicate |
| `doctorIdForUser` (used by appointments, labs, pharmacy, records, reports, dashboard, patients) is `doctor.findUnique({ userId })` | e.g. `appointments/repositories/appointment.repository.ts:222`, `patients/repositories/patient.repository.ts:626`; `findUnique` is not filtered by the soft-delete extension (`shared/database/soft-delete.ts`) |
| Doctor practice suspension deliberately does **not** cut clinical access | `doctors/services/admin-doctor.service.ts:38-46` ("A suspended practitioner keeps … their login … conflating the two would mean a clinic could not suspend a doctor without also cutting off their access to their own records") |
| Non-doctor roles never get clinical access through `canReach` | `patient-scope.service.ts` `canReach` returns `false` unless `roleCode === 'doctor'` |
| Administrators read a **masked, platform-wide** patient directory | `patients/services/patient.service.ts:129-` (`list`: doctors scoped by `doctorId`, others masked across all patients) |
| No Backend route ends a doctor employment | no `doctorEmployment.update/create` outside tests; employment is written by seeds and Database fixtures only |
| `queue_entries` / `waiting_room_entries` carry `hospital_id` (PR #28), but the Backend only **updates** them | `administration/repositories/operations.repository.ts:157-201` (`updateMany` by id; no create) |
| Platform scope is never produced | `hospital-context.service.ts`: admins resolve one assignment or `admin_scope_not_mapped`; no platform mapping exists |

## 2. Surface inventory

Columns: **Ctx** = uses the authenticated user's hospital context · **X-H** = can return another
hospital's data today · **Legacy** = depends on the legacy care-assignment rule · **Layer** = where
the current check sits · **Bypass** = another path reaches the same data · **Closed** = fails closed
when context is missing · **PHI-early** = PHI can be read before authorization completes.

| Surface (routes) | Ctx | X-H | Legacy | Layer | Bypass | Closed | PHI-early | Notes / evidence |
|---|---|---|---|---|---|---|---|---|
| Patient chart and tabs: `/patients/:id/*` (36 routes) | No | **Yes**: an assignment in any hospital grants access | Yes | Service (`assertCanReach`) | No known path: every child route calls `assertCanReach` (`patient-tabs.controller.ts:74`) | N/A (no context used) | No: scope check precedes the read; out of scope is 404 (ADR-022) | Needs hospital-owned record (HMR) predicate (#27 step 2) |
| Patient directory and export: `GET /patients`, `GET /patients/export` | No | **Yes**: admins see a masked list of **every** patient | Doctors: yes; admins: no | Service/repository | `/search` (admin index carries no patients, `search.service.ts:10-17`) | N/A | Masked for admins; reveal is `patients.revealIdentity` + audited | Hospital Admin scope blocked by OD-07 mapping (#16) |
| Patient reveal: `POST /patients/:id/reveal` | No | **Yes**: any patient platform-wide | No | Controller `@Can` + service | — | N/A | Audited reveal by design | Must become hospital-scoped for Hospital Admin; Platform Admin per #16 |
| Medical records: `/medical-records/*` (14) | No | **Yes** (assignment-based) | Yes | Service (`assertCanReach`, `requireDoctor`) | Patient-tab routes | N/A | No | `requireDoctor` ignores practice status |
| Appointments: `/appointments/*` (11), `/patients/:id/appointments` | No | **Yes**: doctor's own appointments in any hospital | Partly (`doctorIdForUser`) | Service | Dashboard queue | N/A | No | Booking target hospital not stamped (Database E1/A4 pending) |
| Lab orders and results: `/lab-orders/*` (11), `/lab-tests` | No | **Yes** | Yes | Service | Files (attachments) | N/A | No | Laboratory role has no care-scoping model (D-14.2) |
| Prescriptions / pharmacy: `/prescriptions/*` (12), `/medications` | No | **Yes** | Yes | Service | — | N/A | No | Pharmacy role scope undefined for multi-hospital |
| Files: `/files/*`, `/attachments` | No | **Yes**: via patient scope | Yes (`file-access.service.ts:114-125`) | Service | Uploader can always read own upload | N/A | No | Uploader rule is hospital-blind |
| Messaging: `/conversations/*`, `/messages` | No | **Yes**: participant-based, any user | No | Repository (participants) | — | N/A | Message bodies can carry PHI | OD-13 consultation workflow not built |
| Notifications: `/notifications/*` | No | Recipient-only | No | Repository (`recipientId`) | — | N/A | Bodies may name patients | Content generation must be hospital-aware later |
| Search: `/search` | No | Doctor: assignment-based; admin: groups only | Doctor: yes | Service | — | N/A | No | — |
| Reports / analytics: `/reports/*` (11) | No | Own-practice data across hospitals | `doctorIdForUser` | Service | — | N/A | Aggregates | Per-hospital split needed |
| Dashboard: `/dashboard/*` (8) | No | Own data across hospitals | `doctorIdForUser` | Service | — | N/A | Lists patient names | Same as reports |
| AI: `/ai/*` (9) | No | **Yes** (context binding uses `assertCanReach`) | Yes (`ai-context.service.ts:94`) | Service | — | N/A | Transcripts stored verbatim (AF-39) | Cross-hospital AI blocked by grant design |
| Hospital administration: `/administration/*` (50) | No | **Yes**: departments, rooms, staff, shifts, queue are platform-wide | No | Controller, `roles:admin` in the route matrix | — | N/A | Staff PII | Hospital Admin scoping blocked by #16 |
| User / role administration: `/admin/users`, `/roles`, `/permissions` | No | **Yes**: every account | No | Controller `@Can('roles.manage')` | — | N/A | Staff PII | Platform vs Hospital Admin per #16 |
| Doctor administration: `/doctors/*` (admin) | No | **Yes** | No | Controller `@Can('doctors.manage' / 'doctors.verify')` | — | N/A | License documents | Same |
| Audit: `/audit-events`, incident bookmarks | No | **Yes**: whole ledger | No | `@Can('logs.view')` | — | N/A | Metadata-only by contract | Cross-hospital audit reads are an OD-07 question (#16 item 2) |
| Platform settings: `/platform-settings/*` | No | Platform-level by nature | No | `@Can('settings.manageSystem' / 'integrations.manage')` | — | N/A | No | Belongs to Platform Admin once mapped |
| Session: `GET /auth/session` | **Yes** (display) | No | No | Service | — | Yes (`unresolved` → both fields `null`) | No | Since ADR-046 role and context agree |
| Background jobs | No | Jobs are platform-wide sweeps | No | — | — | Yes: no request store since F5 (#24); no ambient fallback | — | Any future hospital-scoped job must carry an explicit, validated hospital id |
| Patient self routes: `/patient/*`, `/me/*` | No | Own data only | No (self scope, ADR-030) | Service | — | N/A | No | Hospital attribution is display work (#41–#43) |

## 3. Gaps that need a decision before code (not implemented here)

| # | Gap | Why it is not implemented here | Tracked |
|---|---|---|---|
| G1 | The legacy rule ignores the doctor's hospital, employment and practice status, so a suspended or terminated doctor keeps legacy access to assigned patients. **Resolved by S3 (§6): #18 decided; the rule is hospital-, employment- and lifecycle-aware** | Changing the **authoritative** rule is enforcement. Suspension is documented as *not* cutting access (`admin-doctor.service.ts:38-46`); reversing that is a product decision. Employment-based denial is OD-12, but it only becomes enforceable together with hospital-owned assignments (B3, #17) | #27, #22, #18 |
| G2 | Admin directory, reveal, administration, users, audit are platform-wide | Hospital Admin vs Platform Admin capabilities are undecided in detail | #16 |
| G3 | Employment end → immediate session and token revocation (OD-12) | **Implemented for the platform-wide admin (#54).** `POST /doctors/:doctorId/employments/:employmentId/end` (`doctors.manage`) sets `ended_at`, revokes the employment's live care assignments, the live `hospital_role_assignments` sourced from it (`revokedHospitalRoles`) and every session of the doctor's account, and writes `doctor.employment_ended` with `audit_events.hospital_id` set to the employment's hospital (as does `doctor.employment_started`), all in one transaction; the doctor's next request is 401 and the refresh token is refused (`doctor-employment-lifecycle.e2e-spec.ts`). **Remaining:** legacy assignments with no `doctor_employment_id` are not touched (#17; counted in the audit metadata as `legacyAssignmentsUntouched`); published slots and permission caches (G4) are not revoked; Hospital Admin scoping of the routes is S5 (#16) | #27, #54 |
| G4 | Role-permission edits (`role_permissions`) and overrides apply only at the next token issue (≤ 900 s) | Needs a permission version on the token or session; ADR-046 deliberately covers only the role code | #27 |
| G5 | Tenant context in PostgreSQL for RLS | Contract proposed (`RLS_BACKEND_CONTRACT.md`); GUC name and transaction wrapping need Backend + Database agreement | #20, #19 |
| G6 | Legacy rows with no hospital | Owner decision | #17 |

## 4. Staged enforcement plan

Each stage is behind a flag, keeps the legacy rule as the fallback until switched, and has negative
cross-hospital e2e tests before it ships.

| Stage | Content | Depends on | Tests that gate it |
|---|---|---|---|
| S0 (done in this PR) | F3 role consistency (ADR-046), F4 context excludes suspended or deleted doctors, F5 jobs outside request scope, F6 no stale shadow reads, C1 shadow bounded | — | See PR |
| S1 | Shadow observation in a real environment with C1 bounds; divergence metrics (`legacy_allow_shadow_deny` rate) | Decision to enable (#26) | Divergence dashboard; zero `legacy_deny_shadow_allow` |
| S2 | Data backfill so live assignments carry `hospital_id`, `doctor_employment_id`, `hospital_medical_record_id` | #17 (B3), Database | Backfill audit: every live assignment owned |
| S3 | Patient-scope enforcement: `canReach` requires the hospital-aware rule. **Done (2026-11-24), unflagged — the legacy rule and the shadow are removed.** Rule (`shared/authz/hospital-patient-scope.ts`): role `doctor`; exactly one active employment at an `ACTIVE`, non-deleted hospital, held by a `VERIFIED`, `ACTIVE`/`VACATION`, non-deleted doctor (#18, DR-02, OD-12); a live assignment owned by that employment (its `hospital_id`, `doctor_employment_id`, `hospital_medical_record_id`). Legacy assignments with no hospital grant nothing (#17); admins none (OD-07); out of scope is 404. `assertCanReach` returns the chart scope; every caller (patient chart/tabs, allergies/alerts, records, labs and trends, prescriptions and the safety screen, files, AI context, search) filters hospital-owned child rows to it. `HOSPITAL_SCOPE_SHADOW_*` retired. Not covered: S2 backfill must run before deployment or legacy-only charts become unreachable (#17 by design); messaging (OD-13) is participant-based and unchanged | S1, S2, #18, F6 done | `hospital-patient-scope.e2e-spec.ts` (rule against PostgreSQL), `hospital-clinical-isolation.e2e-spec.ts` (N-1, N-6…N-11 over HTTP) |
| S4 | Doctor-own lists (appointments, records, labs, prescriptions, reports, dashboard, search) filtered to the active hospital. **Done (2026-11-24):** lists, summaries, exports, dashboard widgets, action queue, critical alerts and analytics/insights read `hospital_id = <active hospital>` (NULL excluded); no clinical employment → empty or 404, never the admin directory. Writes stamp the server-derived hospital, employment and hospital medical record: patient registration (creates the HMR at the doctor's hospital), chart children, records, lab orders (+ report files), prescriptions (+ `patient_medications` on signing, renewals), doctor bookings, AI threads, clinical uploads; notifications copy the scope of the owned row they point at (required by `notifications_scoped_link_trg`). Not covered: patient self-booking and admin oversight/reassign (E1/A4, S5); AI thread list stays owner-scoped (each turn re-resolves the context) | S3, Database E1/A4 for appointments | `hospital-clinical-isolation.e2e-spec.ts` (per-route, including a doctor moving hospitals) |
| S5 | Hospital Admin scoping of administration, users, doctors, audit; Platform Admin capabilities | #16 | Admin A cannot read or change Hospital B rows (404) |
| S6 | Employment-end revocation (sessions, refresh tokens, permission caches) wired to the employment API when it exists. **Partly done (#54):** employment API (`GET`/`POST /doctors/:doctorId/employments`, `POST …/:employmentId/end`) with session, refresh-token, owned-assignment and employment-sourced hospital-role revocation in one transaction; both employment audit rows carry `hospital_id`. Open: permission caches (G4), published slots, legacy assignments (#17), Hospital Admin scoping (S5) | G3, OD-12 | Termination e2e: next request 401, refresh refused, derived hospital role revoked, audit `hospital_id` written — `doctor-employment-lifecycle.e2e-spec.ts` |
| S7 | PostgreSQL tenant context (`set_config(…, true)` per transaction) | #20 contract agreed | Concurrent-request leak test (#20) |
| S8 | RLS activation (Database) as defence in depth | S7, #19 | Database isolation suite |

## 5. Rules every stage keeps

- Hospital context is server-derived only; a client-sent hospital id is never trusted.
- Out of scope is 404, never 403 (ADR-022).
- Missing or ambiguous context fails closed. "No context" never means "all hospitals".
- Platform Admin gets no implicit clinical or cross-hospital access (OD-07); nothing emits
  `adminScope: { type: 'platform' }` until #16 is decided.
- Background work carries explicit, validated hospital and actor ids; it never inherits a request
  store (F5).

## 6. S3/S4 enforcement status (2026-11-24, commits `afa04af`, `e9e3494`)

Several §1 facts predate S3 and are now superseded: the hospital-blind legacy rule is no longer the
gate, `isAssigned` is hospital-aware, domain modules filter by `hospital_id`, and suspension now cuts
clinical access (#18). §1 stays as it was, as the audit record.

### The rule (authoritative, unflagged)

`PatientScopeService.canReach`/`assertCanReach` → `decidePatientReach`
(`backend/src/shared/authz/hospital-patient-scope.ts`). A principal reaches a patient only if **all**
of these hold:

1. the role is `doctor`. Platform Admin, Hospital Admin and every other role get no clinical access
   (OD-07);
2. the doctor has **exactly one** clinical employment, derived on the server: `doctor_employments.ended_at
   IS NULL`, at a hospital with `status = 'ACTIVE'` and `deleted_at IS NULL`, held by a doctor with
   `deleted_at IS NULL`, `verification_status = VERIFIED` and `practice_status IN (ACTIVE, VACATION)`.
   No employment, or more than one, fails closed;
3. a **live** assignment (`revoked_at IS NULL`) links that doctor and patient and is owned by that
   employment: `doctor_employment_id` is the active employment and `hospital_id` is its hospital, with
   the patient's `hospital_medical_record_id` there.

Out of scope is 404, the same as a missing patient (ADR-022). `assertCanReach` returns the chart scope
(`doctorId`, `doctorEmploymentId`, `hospitalId`, `patientId`, `hospitalMedicalRecordId`).
`PrismaPatientAssignmentRepository.isAssigned` answers with the same rule. The employment read is
memoized per request. The assignment read is never memoized (F6).

**Doctor lifecycle (#18).** VACATION keeps access. Unverified (PENDING, REJECTED, DOCS_REQUESTED),
SUSPENDED, terminated (no active employment) and soft-deleted doctors are denied. An assignment owned
by an ended employment stays denied after a rehire at the same hospital (OD-12). The session context
(`GET /auth/session`) is unchanged and still has no verification predicate. Session and login rules for
these states are separate work.

**Legacy ownership (#17).** An assignment with `hospital_id IS NULL` never grants access. Child rows
with no hospital are excluded from every doctor read and list. No legacy row is assigned, updated or
deleted. The shadow comparison, its C1 bounds and `HOSPITAL_SCOPE_SHADOW_*` are removed. A leftover
variable is ignored.

### Surfaces covered

- **Chart (N-1).** Detail, profile bundle, allergies, alerts, every tab (history, notes, vitals,
  medications, documents, studies, appointments) and reveal. Hospital-owned child rows are filtered to
  `hospital_id = active hospital`. `nextAppointment` reads the active hospital only. Emergency contacts
  and chronic conditions are patient-level. A doctor's directory and export list only patients with an
  assignment owned by the active employment. A doctor with no clinical employment gets an empty list,
  never the masked admin directory.
- **Medical records (N-6), lab orders, studies and trends (N-7), prescriptions and the safety screen
  (N-8).** Reads, details, lists, summaries and exports require `hospital_id` = the active hospital (and
  an owned assignment for the care arm). The safety screen reads only the active hospital's allergies
  and prescriptions.
- **Files (N-9).** A patient document, record attachment or lab attachment is readable only if the
  chart is reachable **and** `files.hospital_id` = the active hospital. This also applies to the
  uploader's own clinical upload.
- **AI (N-10).** Patient binding goes through `assertCanReach`. Record, lab and prescription entities
  must belong to the active hospital.
- **Search (N-11), appointments, dashboard (KPIs, schedule, trends, satisfaction, recent activity,
  action queue, critical alerts) and reports (analytics snapshot, insights, CSV, revenue alternate).**
  All are scoped to the doctor and the active hospital.
- **Writes stamp the server-derived scope.**
  - Patient registration creates the hospital medical record at the doctor's hospital, and the owned
    primary assignment.
  - Chart children carry `hospital_id` and `hospital_medical_record_id`.
  - Records, lab orders, prescriptions (including renewals) and doctor bookings also carry
    `doctor_employment_id`.
  - Signing a prescription stamps its `patient_medications` row.
  - Patient-bound AI threads are stamped.
  - Clinical uploads take the uploader's hospital. An unowned upload is claimed by the chart, record or
    order it is filed under. Another hospital's upload is refused.
  - Notifications copy the scope of the owned row they point at (`notifications_scoped_link_trg`).
- **Soft-delete lookups.**
  - Doctor-by-user lookups in patients, records, labs and pharmacy now go through the clinical
    employment.
  - These now use `findFirst` with `deletedAt: null`: appointments `doctorIdForUser` and `doctorSummary`
    (reassignment target), the labs department by name, and the patient self-scope lookup
    (`prisma-patient-self.repository.ts`).

### Not covered

- **The S2 backfill must run before deployment.** Until it does, charts reachable only through legacy
  assignments, including the demo seed's, are unreachable (#17, by design).
- **Admin surfaces (S5, #16).** The masked directory, oversight list, nudge and administrative cancel
  remain platform-wide.
- **Admin reassignment of a hospital-owned booking is refused with 409.** Phase 21 makes
  `doctor_employment_id` immutable in place. A transfer workflow is a Database decision.
- **Patient self-booking (`/me/appointments`) and the booking target hospital** wait on Database E1/A4.
- **Messaging (OD-13)** stays participant-based. The AI thread list stays owner-scoped (every turn
  re-resolves its context). Time-off resolution is doctor-level across hospitals.
- **The DR-05 permission-based rule** (without the assignment anchor) is not part of S3.

### Tests

The rule is tested against PostgreSQL in `backend/test/hospital-patient-scope.e2e-spec.ts`.
`backend/test/hospital-clinical-isolation.e2e-spec.ts` covers, over HTTP:

- N-1 and N-6…N-11;
- a patient assigned only at another hospital;
- a legacy unowned assignment;
- another hospital's child rows on a shared patient;
- VACATION, unverified, suspended, soft-deleted and terminated doctors;
- a doctor moving hospitals.

Fixtures create owned data: `test/support/hospital-fixture.ts` and
`createAuthHarness({ clinicalDoctors: true })`.
