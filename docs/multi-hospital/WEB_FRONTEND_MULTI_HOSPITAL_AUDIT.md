# Web Frontend (doctor/admin SPA) — Multi-Hospital Readiness Audit

## 1. Scope & baseline

- Tree: `frontend/` (React 18, Vite, TanStack Query 5, react-router 6.30). Paths are relative to the repo root unless they start `src/`, which means `frontend/src/`.
- Baseline commit: `ae63773` (`main`). Date: 2026-11-23.
- Method: read-only audit by subagents (no edits, no git, no installs, no test runs), verified by the lead engineer. Backend contracts were read from `backend/` for comparison only.
- "Confirmed" means confirmed by code reading and grep. No test was run for any finding.
- Register: `docs/multi-hospital/CLIENTS_CHECKLIST.md` (WEB-1 to WEB-16). It is the only status register for these tasks.
- Context: Phase 22 backend is in **shadow mode**. PR #14 is merged. PR #15 (Database Phase 22 RLS design) is open and unmerged. Dependency issues #16 to #27 are open.
- Lead-engineer corrections applied:
  - `GET /auth/session` already returns `activeHospital` and `adminScope` (`backend/src/modules/auth/services/session-user.service.ts:41-50, 84-100`, verified). So **WEB-1 is not blocked by the backend**. The checklist's "Blocked — Phase 22 … names no hospital" status for WEB-1 (CLIENTS_CHECKLIST.md line 108 and the 2026-10-26 to 2026-11-01 re-checks) is stale.
  - Displaying `adminScope` stays blocked on the owner decision in issue #16.
  - `activeHospital: null` is ambiguous. The server gives no reason. Shadow mode means the value is display information, not an authorization boundary.

## 2. Current architecture

- **Session type.** `SessionUser` = `id, name, email, role, permissions, clinicId?` (`src/types/auth/index.ts:56-81`). Roles: `doctor, admin, reception, laboratory, pharmacy` (`:15`).
- **HTTP adapter.** `src/api/endpoints/auth.ts`. `SessionUserDto` (`:73-79`) and `toSessionUser` (`:143-152`) keep only five backend fields. Restore is `POST /auth/refresh`, single-flight (`:256-288`). **No `/auth/session` call exists anywhere in `frontend/src`.**
- **AuthProvider** (`src/app/providers/AuthProvider.tsx`):
  - `finalize` (`:129-154`) runs on sign-in. It calls `queryClient.clear()`, `clearAiSessionData()` and the conversations reset.
  - `endSession` (`:156-165`) does the same on logout, refused refresh and account switch.
  - The 401 handler (`:207-236`) ends the session on a different user id. For the same user it calls `setUser` and keeps the cache.
  - `lock` (`:283-293`) clears the cache.
  - `logout` (`:270-281`) does not navigate.
- **API client** (`src/api/client.ts`). The access token is in memory, requests use `credentials: 'include'`, and refresh is single-flight (`:247-253`). No hospital header or parameter anywhere. 403 is mapped to `{kind:'forbidden', code?}` (`src/api/errors.ts:41`). There is no global 403 handler; each feature branches on it.
- **TanStack Query.** `src/configs/query-client.ts:12-28`: `staleTime` 30 s, `refetchOnWindowFocus` true, no QueryCache or MutationCache callbacks, no persister. Key factories are `createKeyFactory(domain)` (`src/api/query-keys.ts:15-24`, 19 domains). Only `['me','profile',userId]` carries a user id. **No key carries a hospital id.**
- **Service seam.** Every feature uses `selectService({mock, http})` (`src/api/seam.ts:67-70`). In a live build a feature with no HTTP adapter returns `notConnected(...)` (`src/api/http.ts:43`).
- **Router and guards** (`src/app/router/index.tsx`, `guards.tsx`). `RequireRole` takes a single role. The admin tree is one role. Most admin sections are `demoOnly` in a live build (`src/features/admin/routes.tsx:44-58, 178`). Only Appointment Oversight, Doctors, Access/Users/Roles and part of Settings are live.
- **Shell** (`src/layouts/`): `AppShell`, `AppSidebar`, `AppNavbar`, `AvatarMenu`.
- **Browser storage.** Per-user keys `medora.<userId>.*` (`src/services/preferences.ts`). The live path writes no PHI (pinned by `src/api/endpoints/auth-storage.test.ts:111` and `src/app/providers/AuthProvider.test.tsx:608`). Admin demo stores use global keys `medora.admin.*.v1` (demo only).
- **Hard guard.** `src/app/no-hospital-switcher.test.ts` (WEB-2, DR-08 FINAL) fails on switcher or picker wording and on routes that choose a hospital, clinic or tenant. Comments are stripped before matching.

## 3. Existing functionality

- Sign-in, OTP, refresh and lock flows. Session end clears the query cache, AI chats and mock messaging, and is covered by `src/app/providers/AuthProvider.test.tsx:291-547`.
- WEB-2 done: no hospital switcher exists, and the test pins it.
- WEB-8 done: `src/features/doctor/patients/components/profile/OverviewTab.tsx:75` and `src/features/doctor/pharmacy/components/authoring/SafetyScreen.tsx:118,204` say "this hospital's record".
- WEB-4 partial: the whole cache ends with the session. WEB-5 partial: `src/features/doctor/clinic/useClinicScope.ts:29-48` fails closed, and My Clinic shows an empty state.
- WEB-6 prerequisite: the live profile does not offer the free-text hospital field (`src/app/providers/doctor-profile-wire.ts:52` returns `hospital: ''`).
- Doctor workspace: patients, appointments, availability, records, labs, pharmacy, notifications, dashboard and reports call real endpoints. None of them has a hospital field.
- Live admin: appointment oversight, doctors list and profile, users and roles.
- Read-only indicator hosts exist and are allowed by the no-switcher test:
  - the sidebar footer caption (`src/layouts/Sidebar/AppSidebar.tsx:118-160`)
  - the avatar menu header (`src/layouts/Navbar/AvatarMenu.tsx`)
  - the navbar start slot (`src/layouts/Navbar/AppNavbar.tsx:90-135`)
  - the `Logo` icon slot
  - the `ContentHeader` caption (`src/components/layout/ContentHeader.tsx:46-96`)
  - `Badge` neutral and `EmptyState` (the template is `NoClinicState` in `src/features/doctor/clinic/pages/MyClinicPage.tsx:49-60`)

## 4. Missing functionality

- No read of `activeHospital` or `adminScope`; no hospital label anywhere (WEB-1).
- No hospital id in query keys, and no clearing on a hospital change (WEB-4 open half).
- No provenance or scope labels on dashboards and reports (WEB-3).
- No read-only employment view (WEB-6).
- No slot publishing (WEB-7), cross-hospital access, Break-Glass, consultations or documentation UI (WEB-9 to WEB-13c).
- No Hospital Admin or Platform Admin role, guard, navigation or console (WEB-14 to WEB-16).
- No "no active hospital" state and no hospital-specific error codes.
- No per-hospital time zone, and no hospital column or filter in admin oversight.

## 5. Confirmed defects

**D-WEB-1. Module-level HTTP draft maps survive sign-out (confirmed by code reading, being fixed in this workstream).**

- `src/features/doctor/medical-records/http/http-record-service.ts:298` holds `const drafts = new Map<string, MedicalRecordDraft>()`. `listDrafts()` (`:326-328`) returns every value with no user filter. A draft holds a `RecordPatientSnapshot` and clinical text, which is PHI (`model/authoring.ts:158-170`, `model/types.ts:228-234`).
- `src/features/doctor/pharmacy/http/http-prescription-service.ts:339-343, 406` holds `drafts`, `serverDrafts`, `renewalSources`, `formularyCache` and `intentKeys` at module level. `listDrafts()` (`:542-544`) has no user filter.
- The only resets are `__resetHttpRecordDrafts()` (`:300`) and `__resetHttpPharmacyState()` (`:345`). Only test files call them. `finalize`, `endSession` and `lock` do not.
- Effect: doctor A signs out with an unsaved note, doctor B signs in on the same tab, and the drafts query refetches and returns A's drafts. The same happens after lock, a refused refresh and a lock-screen logout. Under multi-hospital, a hospital X draft can appear under hospital Y.
- Existing tests reset the maps in `beforeEach`, which hides the leak. No test covers adapter-level clearing.

## 6. Architectural risks

- **R1.** `formularyCache` (`http-prescription-service.ts:343, 461-465`) is a module-lifetime promise. If the formulary becomes hospital-specific it will be stale. `pendingTicks` (`src/features/admin/doctors/http/http-doctors-service.ts:97`) is admin document state at module level and is never cleared.
- **R2.** `logout()` does not navigate. `RequireAuth` then redirects to `/login?returnTo=<previous user's path>` (`src/app/router/guards.tsx:38-41`). `resolveDestination` checks only the role workspace (`src/features/auth/pages/resolveDestination.ts:50-79`), so the next account of the same role lands on the previous user's deep link, for example `/doctor/patients/<id>`. The server must refuse it, but the URL leaks a patient id and, under multi-hospital, a cross-hospital deep link.
- **R3.** The 401 handler compares only `user.id` (`AuthProvider.tsx:217`). A same-user refresh that changes role, permissions or (later) active hospital keeps the cache. WEB-4's clear-on-hospital-change is not met.
- **R4.** Query keys have no hospital dimension. Isolation relies on clearing the whole cache. Background refetches in flight during a context change are guarded only for laboratory reads (`AuthProvider.test.tsx:497`).
- **R5.** Preferences are keyed per user, not per hospital (landing path, saved filters). They carry over if the hospital changes.
- **R6.** Toasts: a queued toast may render briefly after logout (`ToastProvider` is inside `AuthProvider`). Not verified.
- **R7.** `useClinicScope` maps `admin` to `UNSCOPED` (`src/features/doctor/clinic/useClinicScope.ts`). A Hospital Admin is scoped to one hospital, so this would be wrong. Mock-only today.
- **R8.** The backend controller comment says `AuthProvider` calls `/auth/session`. It does not, so a reviewer could assume hospital context already reaches the web client.
- **R9.** `activeHospital: null` is ambiguous: no employment, more than one active employment, an inactive hospital, an unsupported role and a lookup failure all return `null` with no reason. The client must not show it as "no employment".
- **R10.** Shadow mode: the value is not an authorization boundary. The UI label must never gate or imply access.
- **R11.** Locale freeze: new strings must be English literals, because every added key needs all five locale files. Shell accessible names go through `useT()`, so they cannot gain keys in this assignment. Arabic and Persian users would see English hospital labels.
- **R12.** Single clinic time zone per doctor (`src/features/doctor/appointments/model/availability.ts:72-88`). Per-hospital zones change slot arithmetic.
- **R13.** `frontend/src/types/auth/` changes also run the backend parity suite (CLAUDE.md). Changing `SessionUser` has CI scope implications.

## 7. Single-hospital assumptions (exact file:line)

| File:line                                                                                                                                                                     | Assumption                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/types/auth/index.ts:62-80`                                                                                                                                               | `clinicId?`, "one doctor, one primary clinic, admin unscoped"                                          |
| `src/features/doctor/clinic/useClinicScope.ts:29-48`                                                                                                                          | derives scope from `clinicId`; admin => UNSCOPED                                                       |
| `src/features/shared-domain/clinic-scope/index.ts:28-84`                                                                                                                      | display filter, not a boundary                                                                         |
| `src/features/shared-domain/clinic-operations/store.ts:333, 646`                                                                                                              | `CLINIC_ID = 'clinic-meadowbrook'`, `'Medora Clinic — Riverside'`                                      |
| `src/features/admin/sections/WaitingRoomSection.tsx:13, 240`                                                                                                                  | check-in writes `clinicId: CLINIC_ID` (demo only)                                                      |
| `src/app/providers/DoctorProfileProvider.tsx:42, 74`                                                                                                                          | free-text `hospital`; mock seed `'Medora General Hospital'`                                            |
| `src/features/doctor/settings/sections/ProfileSection.tsx:266-275`, `schemas.ts:29`                                                                                           | free-text "Hospital" input; "Set by your clinic administrator."                                        |
| `src/features/admin/doctors/InviteDoctorDialog.tsx:114`                                                                                                                       | "Clinic assignment (Medora Central by default)". *Corrected 2026-11-25:* **not reachable live**: the live adapter has `capabilities.invite: false` and `administrative: null` (`http-doctors-service.ts`), so the dialog and its clinic select are mock/demo only.          |
| `src/features/admin/doctors/doctors.ts:483-488`                                                                                                                               | `CLINICS = ['Medora Central','Medora North','Medora Riverside','Unassigned']`                          |
| `src/features/admin/doctors/api/doctors.api.ts:103, 120, 227`                                                                                                                 | `clinic: 'Medora Central'` (demo)                                                                      |
| `src/features/admin/doctors/doctors.types.ts:109-112`                                                                                                                         | `AdministrativeFields.clinic: string` (live write is `notConnected`, `http-doctors-service.ts:299`)    |
| `src/features/admin/api/admin-settings.api.ts:36-88`                                                                                                                          | one organization / `platformName` / branding document (not connected live)                             |
| `src/features/admin/admin-profile.ts:72`, `administration.meta.ts:90,151,156`, `routes.tsx:105,217`                                                                           | one-clinic admin framing                                                                               |
| `src/features/staff/home/StaffHomePage.tsx:59`                                                                                                                                | "Every appointment across the clinic"                                                                  |
| `src/features/doctor/clinic/pages/MyClinicPage.tsx:60,127`                                                                                                                    | "your own clinic only"                                                                                 |
| `src/features/doctor/appointments/...` `BookingScheduleStep.tsx:96-97`, `BookingDetailsStep.tsx:169`, `AvailabilitySection.tsx:233,287,397,402`, `NewAppointmentPage.tsx:149` | "the clinic's time zone"                                                                               |
| `src/features/doctor/pharmacy/components/authoring/MonographDrawer.tsx:79`, `MedicationStep.tsx:103`                                                                          | "the clinic formulary"                                                                                 |
| `src/api/query-keys.ts:15-24`; 166 `queryKey` occurrences                                                                                                                     | no hospital in keys                                                                                    |
| `src/configs/env.ts` (`VITE_API_BASE_URL`), `index.html:7`, `src/hooks/useDocumentTitle.ts:23-28`                                                                             | one API base; title has no hospital slot                                                               |
| `src/i18n/messages/en.ts:207-239`                                                                                                                                             | `nav.myClinic`, `nav.clinicOverview`, `nav.section.facility`, `nav.policies` (locale files, flag only) |
| `src/features/auth/mock/users.ts:75,96,107,218`                                                                                                                               | mock users carry `clinicId: 'clinic-meadowbrook'`                                                      |

Not defects: brand `Logo label="Medora"` (`AppSidebar.tsx:51`) is product branding. `facility` on history events (`features/doctor/patients/model/profile-types.ts:96`) is free-text patient history, not tenant context.

## 8. Existing API contracts (usable now)

- `GET /auth/session` (`@Authenticated()`, any role): `{id, name, email, role, permissions, activeHospital: {id, name} | null, adminScope: {type:'platform'} | {type:'hospital', hospital:{id,name}} | null}` (`session-user.service.ts:41-50`).
  - Doctor with exactly one active employment: `activeHospital` set, `adminScope` null.
  - Admin with exactly one active hospital-admin assignment: `activeHospital` null, `adminScope = {type:'hospital', ...}`.
  - `adminScope.type === 'platform'` is never produced yet (`hospital-context.service.ts:46-100`).
  - Everything else (patient, reception, laboratory, pharmacy, nurse, zero or several employments, lookup failure) returns both null.
  - `hospital.id` is the internal `hospitals.id` uuid, not `public_id`.
  - 401 `unauthorized` for deleted or non-ACTIVE accounts.
- Login, OTP and refresh bodies carry **no** hospital data (`login.service.ts:70-84`). A client must call `/auth/session` after sign-in.
- Error envelope `{message, code, fieldErrors?, detail?, ref?}` (`backend/src/common/http/all-exceptions.filter.ts:18-47, 93-106`). **No hospital-specific error codes exist.**
- All other doctor and admin DTOs listed in `fe-pages-ui` (patients, appointments, medical records, labs, prescriptions, dashboard, reports, `/admin/appointments`, `/doctors`) have **no hospital field**.

## 9. Missing API contracts (planned in `docs/multi-hospital/API_CONTRACT_CHANGES.md`, not implemented; shapes are recommendations)

- `GET /me/profile` with `employment` and `employmentHistory` (WEB-6). The `no_active_employment` code is planned but not thrown today.
- Hospital provenance (`hospital: {id,name}`) on hospital-owned resources (WEB-3).
- A reason code for a null `activeHospital` (no employment, ambiguous, hospital suspended, lookup failed). **Not planned in the doc; recommended as a request to the backend team.**
- Slot publishing `/me/published-slots` (WEB-7).
- `/cross-hospital-access/*`, `/hospital-admin/cross-hospital-access/requests*`, Break-Glass, `/consultations*` (WEB-10 to WEB-13c).
- `/platform/*` and `/hospital-admin/*` (WEB-14 to WEB-16; the doc gives prefixes only).
- Hospital-scoped analytics and time-zone fields (WEB-3, R12).
- A platform-admin `adminScope` (blocked on #16).

## 10. Security considerations

- The server is the boundary. The client sends no hospital id, header or claim and must never do so (DR-08, API doc rules: "client hospitalId never an authorization mechanism").
- Treat `activeHospital` as display only. Do not derive permissions, route guards or query scoping from it while the backend is in shadow mode (#27 is not done; RLS #19 and #20 are not active).
- PHI in client memory: fix D-WEB-1. Treat all module-level adapter state as session state and clear it with the query cache.
- `returnTo` carries a patient id across users (R2).
- Do not render `adminScope` for admins until #16 settles the platform and hospital model. Do not guard on `adminScope.type === 'platform'`.
- Never log the hospital id with PHI. Do not store `activeHospital` in localStorage. Keep it in memory, refetched per session.
- Shared admin demo stores use global localStorage keys with fictional PHI. They are stripped in production, but demo builds share them between users.
- The AI assistant stays on its disclosed mock until Phase 28; the web client must send no hospital to it (WEB-9).

## 11. Required tests

1. `AuthProvider`-level test: user B sees none of user A's medical-record and prescription drafts after logout, lock then different login, and refused refresh.
2. Adapter tests for the new `clear*` functions: maps empty, `formularyCache` reset, `pendingTicks` reset.
3. `returnTo` is dropped on a user-initiated logout, and kept (or bound to the user id) on a refused refresh.
4. Same-user refresh with changed role or permissions clears the cache (or ends the session).
5. `/auth/session` adapter: parses `activeHospital` and `adminScope`, tolerates absent and null fields, and ignores unknown `adminScope.type` values safely. Add the fields to the parity spec under `src/types/auth/` (the backend suite also runs).
6. Hospital label component: renders name; renders nothing (or a neutral state) for null; passes `no-hospital-switcher.test.ts`; passes the heading-outline, logical-properties and touch-target ratchets; Latin hospital name inside RTL uses `isolateLtr`.
7. Update `AppSidebar`, `AppNavbar` and `AvatarMenu` tests, which assert exact shell structure.
8. Doctor with `activeHospital: null` gets the explicit empty state (modelled on `NoClinicState`), not "employment ended".
9. Prepared query-key test: hospital segment present on hospital-scoped keys, and a key-change test for WEB-4 (written but inactive until activation).
10. Admin: no label from `adminScope` is rendered while #16 is open.

## 12. Work classification

| Task                                                                                                                           | Category                               | Dependencies                                        | CLIENTS_CHECKLIST row                |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- | --------------------------------------------------- | ------------------------------------ |
| Clear HTTP draft maps (records, prescriptions) on session end, lock and account change; add the test                           | Implement now (confirmed defect)       | none                                                | New row proposed; adjacent to WEB-4  |
| Clear `formularyCache` and `pendingTicks` at session end                                                                       | Implement now                          | none                                                | New row proposed (adjacent to WEB-4) |
| Drop or bind `returnTo` on user-initiated logout                                                                               | Implement now (UX choice noted)        | none                                                | New row proposed                     |
| End or clear on a same-user refresh when role or permissions change                                                            | Implement now                          | none                                                | WEB-4 (partial half)                 |
| Read `activeHospital` from `GET /auth/session` into optional `SessionUser.activeHospital`; read-only label for doctors (WEB-1) | Implement now                          | backend shadow-mode caveat (R9, R10); parity spec   | WEB-1 (status stale)                 |
| Explicit "no active hospital" empty state (copy neutral, no reason claimed)                                                    | Prepare-not-activate                   | R9 reason code                                      | WEB-5, WEB-1                         |
| ~~Neutral copy for `InviteDoctorDialog.tsx:114` (live route)~~ Not needed live (corrected 2026-11-25: demo only)                                                                     | Implement now (small; English literal) | locale freeze                                       | none (new row proposed)              |
| Show `adminScope` / hospital name for admins                                                                                   | Blocked-Product-Owner                  | #16                                                 | WEB-1, WEB-16                        |
| Hospital id in query keys, clear on hospital change                                                                            | Prepare-not-activate                   | WEB-1 landed; server hospital-scoped responses; #27 | WEB-4                                |
| Retire `clinicId` and `useClinicScope`                                                                                         | Blocked-Backend                        | active hospital authoritative (#27, #23)            | WEB-5                                |
| Read-only employment in Settings                                                                                               | Blocked-Backend                        | `GET /me/profile` employment                        | WEB-6                                |
| Hospital-scoped provenance labels                                                                                              | Blocked-Backend                        | hospital fields on DTOs                             | WEB-3                                |
| Doctor with no or ambiguous employment, vacation, suspended doctor                                                             | Blocked-Backend                        | #18, #22, reason code                               | WEB-1, WEB-5                         |
| Per-hospital time zone in booking and availability                                                                             | Blocked-Backend                        | hospital time zone field                            | WEB-3                                |
| Publish and withdraw slots                                                                                                     | Blocked-Backend                        | `/me/published-slots`                               | WEB-7                                |
| Grant, Break-Glass, consultation, documentation UI                                                                             | Blocked-Backend                        | Phase 22A API                                       | WEB-9 to WEB-13c                     |
| Hospital Admin and Platform Admin consoles, role guards, navigation                                                            | Blocked-Product-Owner                  | #16, `/platform/*`, `/hospital-admin/*`             | WEB-14, WEB-15, WEB-16               |
| Hospital-scoped admin oversight column and filter                                                                              | Blocked-Backend                        | hospital on admin DTOs                              | WEB-14                               |
| Cross-tenant guarantees (RLS) the UI may rely on                                                                               | Blocked-Database                       | #19, #20, #21, PR #15                               | WEB-3, WEB-4                         |
| Hospital switcher for any role                                                                                                 | Not planned (DR-08 FINAL)              | #16 for any admin selector                          | WEB-2                                |

## 13. Product decisions required

1. **#16 Platform vs Hospital admin.** What the admin UI shows for `adminScope`, and whether a Platform Admin ever picks a hospital. The no-switcher test and DR-08 forbid a selector today.
2. What to show for `activeHospital: null` (neutral text versus a reason). Needs a backend reason code or an agreed neutral wording.
3. Cross-user deep links: should logout drop `returnTo` always, or only when it is a user-initiated logout?
4. Scope of the WEB-1 label per role: doctors only, or also staff roles that get null (reception, laboratory, pharmacy)?
5. Where the label lives (sidebar caption, avatar menu, navbar) and its mobile story (the breadcrumb is hidden under `md`).
6. Whether the "My clinic" and "Clinic" naming becomes "hospital" (locale files, separate assignment).
7. Whether Hospital Admin keeps the `admin` role string or gets a distinct role code (affects `Role`, `RequireRole` and the parity spec; #16, #23).

## 14. Recommended implementation order

1. Fix D-WEB-1 plus R1 (clear adapter state on session end), with tests. This is in progress.
2. `returnTo` handling on logout (R2), and the same-user refresh check (R3, role and permissions only).
3. Add `/auth/session` consumption: `SessionUser.activeHospital` (optional), parity spec update and adapter tests. Fetch after sign-in and after restore. Do not fetch on every route.
4. WEB-1 read-only label for doctors, with ratchet and shell-test updates and an English-literal accessible name.
5. ~~Neutral-copy fix for the live `InviteDoctorDialog`.~~ Not needed: the dialog is not reachable in a live build (corrected 2026-11-25).
6. Prepare (inactive): key-factory support for an optional scope segment, the "no active hospital" state, and tests.
7. Wait for backend and owner decisions (#16, #18, #22, #23, #27) before WEB-3, WEB-4 activation, WEB-5, WEB-6, WEB-7 and the admin consoles.
8. Update the stale WEB-1 status in `docs/multi-hospital/CLIENTS_CHECKLIST.md`.

## 15. Outcome of this workstream (2026-11-23)

Steps 1, 4 and 8 above were done; the rest is tracked as issues. Deviations from the recommendations, by decision of the lead engineer:

- **D-WEB-1 fixed** (issue #36). `src/api/session-memory.ts` is an import-free boundary that the record, prescription and admin-doctor adapters register their in-memory reset with (drafts, `serverDrafts`, `renewalSources`, `formularyCache`, `intentKeys`, `pendingTicks`). `AuthProvider` clears it on every sign-in, logout, refused refresh and cross-tab account switch. **A lock keeps it** for the same user's unlock (an idle auto-lock must not discard an unfinished clinical note); a different account signing in from the lock screen gets nothing. The new tests fail without the fix.
- **WEB-1 implemented as a separate read, not on `SessionUser`** (issue #31). `src/api/endpoints/session.ts` reads only `activeHospital`, strictly validated. `src/layouts/Sidebar/useActiveHospital.ts` queries it for an authenticated doctor in live mode, keyed by user id. `src/layouts/Sidebar/ActiveHospital.tsx` renders it read-only in the sidebar account card. `SessionUser`, the parity spec and the auth lifecycle are unchanged, so the backend parity suite is not triggered. Loading, null, malformed and error answers render nothing (the neutral "no active hospital" state of step 6 waits on a reason code, R9).
- **Not done here:** `returnTo` (R2), same-user role-change refresh (R3), invite-dialog copy. They are recorded in issue #35 and #34 rather than expanding this change.

Issues: tracker #29; web #30–#39; shared localization #49. Dependencies: #16–#27, PR #15.
