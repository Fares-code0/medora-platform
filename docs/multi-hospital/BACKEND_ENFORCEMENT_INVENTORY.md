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
| G1 | The legacy rule ignores the doctor's hospital, employment and practice status, so a suspended or terminated doctor keeps legacy access to assigned patients | Changing the **authoritative** rule is enforcement. Suspension is documented as *not* cutting access (`admin-doctor.service.ts:38-46`); reversing that is a product decision. Employment-based denial is OD-12, but it only becomes enforceable together with hospital-owned assignments (B3, #17) | #27, #22, #18 |
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
| S3 | Patient-scope enforcement: `canReach` requires the hospital-aware rule (flag; legacy fallback off per environment) | S1, S2, #18, F6 done | Cross-hospital negative e2e for every `assertCanReach` caller (N-1, N-6…N-11) |
| S4 | Doctor-own lists (appointments, records, labs, prescriptions, reports, dashboard, search) filtered to the active hospital | S3, Database E1/A4 for appointments | Per-route negative e2e; list counts per hospital |
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
