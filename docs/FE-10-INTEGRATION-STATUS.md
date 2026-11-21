# FE-10 Frontend Integration Status

Final validation record for FE-10, the phase that connected the doctor/admin
web client (`frontend/`) to the Medora API. Written 2026-10-05 on branch
`claude/sweet-goodall-z99z4t`.

## Scope

FE-10.1 through FE-10.10, as committed:

| Phase    | Commit    | What it connected                                                  |
| -------- | --------- | ------------------------------------------------------------------ |
| FE-10.1  | `c64b484` | Live transport foundation (refresh policy, abort, strict readers)  |
| FE-10.2  | `b1e00c4` | Patients: directory, registration, patient record                  |
| FE-10.3  | `eba96d1` | Appointments: book, booking, transitions                           |
| FE-10.4  | `d515a04` | Doctor Overview, time off                                          |
| FE-10.5  | `bf7e0c3` | Medical records                                                    |
| FE-10.6  | `0814374` | Prescribing and formulary                                          |
| FE-10.7  | `ad886b2` | Laboratory                                                         |
| FE-10.8  | `16bb9dc` | Notifications and shell badges                                     |
| FE-10.9  | `cfdabee` | Doctor profile, account, security settings                         |
| FE-10.10 | `9a1a331` | Admin doctors, oversight, users, roles, invitations                |
| FE-10.V  | this one  | Final validation: one frontend correction (V-1) and this document  |

Out of scope throughout: `backend/`, the database, and `patient-app/` (the
React Native patient client, which has its own integration branch per
ADR-032). The web client has two roles, `doctor` and `admin`
(`frontend/src/types/auth/index.ts`). It has no patient role and no
patient routes. That is why the patient rows below say N/A instead of
recording a pass or a failure.

## Final Status

**FE-10 is partially connected. It is not 100% connected, and it was never
scoped to be.**

| Status      | Count | Meaning                                                                                       |
| ----------- | ----: | --------------------------------------------------------------------------------------------- |
| Connected   |    27 | Doctor-workspace features wired to real endpoints, with no silent mock fallback, contract-tested |
| Still Mock  |    22 | No backend route, or outside FE-10; a live build says "Not connected yet" / "Not available yet", hides the action, or labels the content as demo |
| Blocked     |    10 | Wired and contract-tested, but live validation is impossible (admin sign-in, Finding 33) or the backend never produces the data (Finding 35) |

How "Connected" was established in this final pass. Live browser validation
**could not be re-run in this session**: the container has no Medora
database or role (`medora`, `medora_test` and `medora_shadow` are all
absent; see Finding 39), so the API cannot serve, and creating one was out
of bounds. Each Connected row therefore rests on three things:

1. the endpoint exists in a backend controller (checked against
   `backend/src/**/*.controller.ts` route by route, see API Coverage);
2. the HTTP adapter's contract tests, which assert method, path, body and
   response mapping against captured API bodies, and refusals; and
3. the mock-mode browser sweep of the same screen (layout, states,
   responsiveness).

The phase sessions that built these features ran them against a live API:
Findings 31, 32 and 34 came from those runs, and the adapter fixtures are
captured bodies. That evidence is in the phase records and was **not
re-verified here**.

## Connected

All rows: live in a build with `VITE_ENABLE_MOCKS` unset/false, selected by
`api/seam.ts`. "Tests" counts the `it` blocks in the named adapter spec.

| #   | Feature                                  | Route                                         | API                                                                                                                                                       | Validation                                             | Status    |
| --- | ---------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | --------- |
| 1   | Patient directory, condition filter      | `/doctor/patients`, every patient picker      | `GET /patients`                                                                                                                                           | `http-directory.test.ts` (10); sweep                   | Connected |
| 2   | Patient registration                     | `/doctor/patients` (dialog)                   | `POST /patients`                                                                                                                                          | `http-directory.test.ts`; field errors mapped          | Connected |
| 3   | Patient record and its tabs              | `/doctor/patients/:id?tab=…`                  | `GET /patients/:id/profile`, `…/appointments`, `…/history`, `…/medications`, `…/notes`, `…/documents`, `…/studies`, `…/labs`                              | `http-profile-service.test.ts` (11), `http-patient-studies.test.ts` (2); sweep of all 10 tabs | Connected |
| 4   | Appointment book and booking             | `/doctor/appointments`                        | `GET /appointments`, `POST /appointments`                                                                                                                 | `http-appointment-service.test.ts` (11)                | Connected |
| 5   | Appointment transitions                  | `/doctor/appointments` (row menu)             | `POST /appointments/:id/{approve,reject,cancel,reschedule,complete,no-show}`; menus from server `availableActions`                                        | same spec; page tests (server refusal, menus)          | Connected |
| 6   | Block time off                           | `/doctor/appointments`                        | `POST /me/time-off`, `POST /me/time-off/:id/resolve`                                                                                                      | `http-time-off-service.test.ts` (4)                    | Connected |
| 7   | Overview: KPIs, today, decision list     | `/doctor/overview`                            | `GET /appointments/summary`, `GET /appointments`, `GET /dashboard/doctor/action-queue`, `GET /patients`                                                   | `http-dashboard-service.test.ts` (7)                   | Connected |
| 8   | Medical records list and detail          | `/doctor/medical-records`, `/:id`             | `GET /medical-records`, `GET /medical-records/:id`                                                                                                        | `http-record-service.test.ts` (17); sweep              | Connected |
| 9   | Record authoring and lifecycle           | `/doctor/medical-records/new`, detail         | `POST /medical-records`, `POST …/:id/notes` (note, addendum), `POST …/:id/notes/:noteId/sign`, `POST …/:id/status`                                        | same spec (partial-failure naming the record)          | Connected |
| 10  | Prescriptions list and detail            | `/doctor/pharmacy`, `/:id`                    | `GET /prescriptions`, `GET /prescriptions/:id`                                                                                                            | `http-prescription-service.test.ts` (14); sweep        | Connected |
| 11  | Formulary                                | `/doctor/pharmacy/new`                        | `GET /medications`                                                                                                                                        | same spec; no demo default formulary live              | Connected |
| 12  | Safety screen                            | `/doctor/pharmacy/new`                        | `POST /prescriptions/safety-check`                                                                                                                        | same spec; unreadable body is a failed verdict         | Connected |
| 13  | Sign, renew, cancel                      | `/doctor/pharmacy/new`, detail                | `POST /prescriptions`, `POST …/:id/sign`, `POST …/:id/renew`, `POST …/:id/cancel`                                                                         | same spec; `live-wording.test.tsx` (4)                 | Connected |
| 14  | Lab worklist and detail                  | `/doctor/labs`, `/:id`                        | `GET /lab-orders`, `GET /lab-orders/:id`                                                                                                                  | `http-lab-service.test.ts` (13); sweep                 | Connected |
| 15  | Lab review, single and bulk              | `/doctor/labs`, detail                        | `POST /lab-orders/:id/review`, `POST /lab-orders/review`                                                                                                  | same spec; `live-sections.test.tsx` (3)                | Connected |
| 16  | Lab ordering                             | `/doctor/labs/new`                            | `GET /lab-tests/catalogue`, `POST /lab-orders`                                                                                                            | same spec (part-way failure names placed orders)       | Connected |
| 17  | Attach lab report to record              | lab detail                                    | `POST /lab-orders/:id/attach-to-record`                                                                                                                   | `http-attachments.test.ts` (2)                         | Connected |
| 18  | Notification inbox, read/unread          | `/doctor/notifications`, bell drawer          | `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/:id/unread`                                                                    | `http-notification-service.test.ts` (6), `live-actions.test.tsx` (1) | Connected |
| 19  | Shell badges (notifications, messages)   | sidebar, bottom tabs, bell                    | `GET /notifications/badge-counts`                                                                                                                         | same spec; `http-messaging-service.test.ts` (2); `ShellBadgesProvider.test.tsx` | Connected |
| 20  | Professional profile                     | `/doctor/settings/profile`                    | `GET /me/profile`, `PATCH /me/profile`                                                                                                                    | `doctor-profile-wire.test.ts` (3)                      | Connected |
| 21  | Account details                          | `/doctor/settings/account`                    | `GET /me/account`, `PATCH /me/account` (username, phone; email read-only)                                                                                 | `http-settings-service.test.ts` (7)                    | Connected |
| 22  | Password change                          | `/doctor/settings/security`                   | `POST /me/password`                                                                                                                                       | same spec (wrong current password → field error)       | Connected |
| 23  | Two-factor setup / enable / disable      | `/doctor/settings/security`                   | `POST /me/2fa/setup`, `POST /me/2fa/enable`, `POST /me/2fa/disable`                                                                                       | same spec; `TwoFactorDialogs.test.tsx` (3). See F31    | Connected |
| 24  | Active sessions                          | `/doctor/settings/security`                   | `GET /me/sessions`, `DELETE /me/sessions/:id`, `POST /me/sessions/revoke-others`                                                                          | same spec                                              | Connected |
| 25  | Trusted devices                          | `/doctor/settings/security`                   | `GET /me/devices`, `DELETE /me/devices/:id`                                                                                                               | same spec                                              | Connected |
| 26  | Login history                            | `/doctor/settings/security`                   | `GET /me/login-history`                                                                                                                                   | same spec                                              | Connected |
| 27  | Activity log                             | `/doctor/settings/activity`                   | `GET /me/activity`                                                                                                                                        | same spec. See F32                                     | Connected |

Shared under all of them is the FE-10.1 transport foundation
(`api/client.ts`, `api/http.ts`, `api/seam.ts`; `client.test.ts` 15,
`http.test.ts` 14, `seam.test.ts`). It is infrastructure and is not counted
as a feature.

## Still Mock

> **Since this record (checked 2026-10-26).** This table is FE-10's state on 2026-10-05, and it is
> left as written. Five of its rows have since been connected, each over routes that only an API
> built from `backend` serves. The current status is in `frontend/FRONTEND_CHECKLIST.md`.
>
> | Row | Now | Where |
> | --- | --- | --- |
> | 2 Overview pulse, trend, satisfaction, activity | Trend, satisfaction and activity are connected over RM M27. Practice pulse still has no source | §3.1, PR #108 |
> | 5 Doctor reports | Connected over RM M21 through `selectService` | §3.11, PR #111 |
> | 6 Privacy consents, 7 integrations | Connected over RM M22. Connecting an integration still waits on a server OAuth flow | §3.12, PR #109 |
> | 8 Notification preferences | Connected over RM M19.4 | §3.10, NEW-24 |
>
> Rows 1 (messaging), 3 (My Clinic) and 4 (AI) are still mock. The AI assistant has its `/ai/*`
> routes, but D-09 holds it until Phase 28 adds hospital isolation, and its seam
> (`features/doctor/ai/service.ts`) now says so. F40 below is resolved for reports, and for the AI
> it is superseded by D-09.

| #   | Feature                                                   | Route                                                                         | Reason                                                                                         | Live behavior                                                  |
| --- | --------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1   | Messaging and the communication center                    | `/doctor/messages`, Notifications → Communication tab                         | No messaging routes on the API — *realigned 2026-10-06:* the route exists on the `backend` branch (M20 — `/conversations`), not on `main`, and is single-tenant | "Not connected yet"; a failed load is an error, never an empty inbox |
| 2   | Overview: practice pulse, trend, satisfaction, recent activity | `/doctor/overview`                                                       | No server source (RM M27)                                                                      | Each widget says "Not available yet"                           |
| 3   | My Clinic board                                           | `/doctor/my-clinic`                                                           | Clinic-operations store has no backend — *realigned 2026-10-06:* the route exists on the `backend` branch (M23 — `/administration/queue`, `/administration/waiting-room`), not on `main`, and is single-tenant | "Not connected yet"                                            |
| 4   | AI assistant                                              | `/doctor/ai`                                                                  | Outside FE-10. **The backend now serves `/ai/*`** (F40)                                        | Mock replies, each carrying a mock-output disclaimer           |
| 5   | Doctor reports                                            | `/doctor/reports`                                                             | Outside FE-10. **The backend now serves `GET /reports/analytics`** (F40)                       | Seeded analytics, footnoted "illustrative demo analytics"      |
| 6   | Privacy consents                                          | `/doctor/settings/privacy`                                                    | No route                                                                                       | "Not connected yet"                                            |
| 7   | Calendar/app integrations                                 | `/doctor/settings/integrations`                                               | No route                                                                                       | "Not connected yet"                                            |
| 8   | Notification preferences                                  | `/doctor/settings/notifications`, Notifications → Preferences                 | No route (corrected in this pass, V-1)                                                         | "Not connected yet"; the Preferences button is not offered     |
| 9   | Profile photo                                             | `/doctor/settings/profile`                                                    | File upload outside FE-10 (`PUT /me/profile/photo` exists)                                     | Not offered                                                    |
| 10  | Archive, favourite, pin, delete, clear read               | `/doctor/notifications`, bell                                                 | No route                                                                                       | Hidden; the adapter refuses with `not_connected`               |
| 11  | Lab annotations                                           | lab detail                                                                    | No annotation endpoint                                                                         | "Notes are not available", no Add note                         |
| 12  | Vitals on a medical record                                | `/doctor/medical-records/new`                                                 | API §6.3 cannot attach vitals — **recorded on the chart instead since 2026-10-21** (`POST /patients/:id/vitals`) | Not offered on the record, and the form says why |
| 13  | ~~Proposing slots~~                                       | `/doctor/appointments`                                                        | **Connected 2026-10-21** — see "Post-FE-10 additions"                                          | Offered where the server allows it                             |
| 14  | Admin overview                                            | `/admin`                                                                      | Clinic-operations store — *realigned 2026-10-06:* the route exists on the `backend` branch (M23.1 — `/administration/overview`), not on `main`, and is single-tenant | "Not connected yet"                                            |
| 15  | Clinic management (13 sections)                           | `/admin/{clinic,queue,waiting-room,staff,departments,shifts,schedule,holidays,rooms,resources,announcements,policies,templates}` | Clinic-operations store — *realigned 2026-10-06:* the route exists on the `backend` branch (M23.2–M23.5 — `/administration/*`), not on `main`, and is single-tenant | "Not connected yet"                                            |
| 16  | Admin patients                                            | `/admin/patients`, `/:id`                                                     | No admin patient-account API                                                                   | "Not connected yet"                                            |
| 17  | Communications oversight                                  | `/admin/communications`, `/:conversationId`                                   | No messaging API — *realigned 2026-10-06:* the route exists on the `backend` branch (M20.7 — `/admin/conversations`), not on `main`, and is single-tenant | "Not connected yet"                                            |
| 18  | System logs                                               | `/admin/logs`                                                                 | No audit-log read route — *realigned 2026-10-06:* the route exists on the `backend` branch (M28.3 — `/audit-events`), not on `main`, and is single-tenant | "Not connected yet"                                            |
| 19  | Admin reports                                             | `/admin/reports`                                                              | Not integrated                                                                                 | "Not connected yet"                                            |
| 20  | Admin profile                                             | `/admin/profile`                                                              | Demo store                                                                                     | "Not connected yet"                                            |
| 21  | Platform settings document and audit panel                | `/admin/settings/{general,organization,branding,localization,notifications,email,sms,security,api-keys,integrations,backup,retention,privacy,about,audit}` | No platform-settings route — *realigned 2026-10-06:* the route exists on the `backend` branch (M24 — `/platform-settings`), not on `main`, and is single-tenant | "Not connected yet"                                            |
| 22  | Unserved admin actions                                    | `/admin/doctors`, `/admin/settings/roles`                                     | Doctor invitations, access resets, reopening, role template/clinic, matrix reset: no routes (F37) | Hidden; the adapter refuses with `not_connected`              |

> **Realigned 2026-10-06 (multi-organization).** Rows 1, 3, 14, 15, 17, 18 and 21 said "no route". That was true of `main`, which FE-10 was validated against, but the routes exist on the `backend` branch (M20, M23, M24, M28) and have not reached `main`. They are single-tenant: before any of these surfaces is wired, the Backend team must scope them by organization — and by location where they are operational. See `frontend/FRONTEND_CHECKLIST.md` §9.1 (API-W05, W09, W10, W12, W13). Whether and when `backend` reaches `main` is the owner's integration decision.

Live by design but not server-backed, so **not** counted as mock:

- appearance, accessibility and workflow preferences (`/doctor/settings/{appearance,accessibility,preferences}`):
  this browser's own settings, stored under a per-user key;
- unsigned record and prescription drafts: kept in tab memory only, and the
  toast says so.

The anatomy explorer and the patient record's Anatomy tab were removed from
the doctor workspace upstream (PR #37) and arrived here with the merge; see
"Merge of origin/frontend".

## Blocked

| #   | Feature                                   | Blocker                                                                    | Finding  | Validation impact                                                         |
| --- | ----------------------------------------- | -------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------- |
| 1   | Doctor verification roster and detail     | Seeded admin cannot complete TOTP; no other legitimate admin session       | F33      | `GET /doctors`, `GET /doctors/:id`: `http-doctors-service.test.ts` (18), `live-doctors.test.tsx` (11). Never live-validated |
| 2   | Verification actions                      | as above                                                                   | F33      | `POST /doctors/:id/documents/:docId/{approve,reject}`, `…/{verify,request-documents,reject,suspend,reactivate}`: same specs |
| 3   | Appointment oversight list and KPIs       | as above                                                                   | F33      | `GET /admin/appointments`, `GET /admin/appointments/summary`, `GET /doctors`: `http-oversight-service.test.ts` (13), `live-oversight.test.tsx` (6) |
| 4   | Oversight actions                         | as above                                                                   | F33      | `POST /admin/appointments/:id/{nudge,reassign,cancel-administratively}`: same specs |
| 5   | Users panel                               | as above                                                                   | F33      | `GET /admin/users`, `PATCH /admin/users/:id`: `http-access-service.test.ts` (15), `live-access.test.tsx` (11) |
| 6   | Roles matrix                              | as above                                                                   | F33, F36 | `GET /roles/matrix`, `GET /roles`, `PUT /roles/matrix` (409 merge): same specs |
| 7   | Staff invitation                          | as above                                                                   | F33, F42 | `POST /auth/admin-invitations`: same specs                                |
| 8   | Pending-verifications badge               | as above                                                                   | F33      | `GET /doctors?verification=pending`: `ShellBadgesProvider.test.tsx`      |
| 9   | Admin "My Settings"                       | as above                                                                   | F33, F41 | The doctor settings center under `/admin/preferences/:section`, over `/me/*` |
| 10  | Oversight "complaint attached" flag       | Backend flag has no source of truth and never fires                        | F35      | Adapter maps `complaint: null`; the filter can never match live           |

## Post-FE-10 additions (2026-10-21)

Struck through in "API Coverage" below. Connected on the same terms as the
rows above — an adapter with contract tests and a mock twin, selected by
`api/seam.ts` — and, like them, **not live-validated**: there is still no
Medora database in the container (F39).

| Feature | Route | API | Validation |
| --- | --- | --- | --- |
| Mark all notifications read | `/doctor/notifications`, bell | `POST /notifications/read-all` | `http-notification-service.test.ts`, `useMarkAllNotificationsReadMutation.test.tsx`, `service.test.ts` |
| Propose other times | `/doctor/appointments` | `POST /appointments/:id/propose-slots` | `http-appointment-service.test.ts`, `mock-appointment-service.test.ts`, `AppointmentsPage.test.tsx` |
| Upcoming time off, cancel a block | `/doctor/appointments` | `GET /me/time-off`, `DELETE /me/time-off/:id` | `http-time-off-service.test.ts`, `mock-time-off-service.test.ts`, `UpcomingTimeOffDrawer.test.tsx` |
| Medication monograph | `/doctor/pharmacy/new` | `GET /medications/:id/monograph` (404 → "no monograph") | `http-prescription-service.test.ts`, `MonographDrawer.test.tsx` |
| Prescription notes | `/doctor/pharmacy/:id` | `POST /prescriptions/:id/notes` | `http-prescription-service.test.ts`, `mock-prescription-service.test.ts`, `PrescriptionNotesSection.test.tsx` |
| Record an allergy | `/doctor/patients/:id?tab=allergies` | `POST /patients/:id/allergies` (409 on a duplicate) | `http-profile-service.test.ts`, `RecordAllergyDialog.test.tsx`, `allergy-safety-coherence.test.ts` |
| Record vital signs | `/doctor/patients/:id` (Overview) | `POST /patients/:id/vitals` | `http-profile-service.test.ts`, `vitals.test.ts`, `RecordVitalsDialog.test.tsx` |
| Raise a clinical alert *(pass 2)* | `/doctor/patients/:id` (Overview) | `POST /patients/:id/alerts` | `http-profile-service.test.ts`, `mock-profile-service.test.ts`, `chart-writes.test.tsx` |
| Add a history event *(pass 2)* | `/doctor/patients/:id?tab=history` | `POST /patients/:id/history` | same three specs |
| Add / correct emergency contacts *(pass 2)* | `/doctor/patients/:id` (Overview) | `POST /patients/:id/emergency-contacts`, `PATCH …/:contactId` | same three specs |
| Prescribing strip's current medications *(pass 2)* | `/doctor/pharmacy/new` | `GET /patients/:id/medications` (active entries) — replaces deriving them from `GET /prescriptions`, which is the prescriber's own list | `http-prescription-service.test.ts`, `mock-prescription-service.test.ts`, `PatientContextStrip.test.tsx` |
| Report an issue on a record *(pass 2)* | `/doctor/medical-records/:id` | `POST /medical-records/:id/report-issue` | `http-record-service.test.ts`, `mock-record-service.test.ts`, `ReportRecordIssue.test.tsx` |

**Pass 2 also removed a live-mode fake success:** the patient profile's "Flag a data error" filed into a session-memory demo store and announced delivery to the administrators' queue in live builds, where no patient-level report route exists and the admin patients area is not connected. The entry is now absent live (`live-data-error-report.test.tsx`).

`frontend/FRONTEND_CHECKLIST.md` §12 has the detail, and the fake-success
audit run in the same pass.

## Route Sweep

Mock routes: the mock dev server signed in through the mock login form
(doctor and admin demo accounts). The detail routes (doctor patient, record,
lab and prescription; admin doctor and patient) and `/doctor/anatomy` were
run on a mock-mode **production** bundle, because their rows navigate on
click rather than through a link. Live routes: a
live production build (`VITE_ENABLE_MOCKS=false`) pointed at an API address
with nothing listening. Each check records the landing path, the number of
`h1`s, the horizontal overflow (`scrollWidth > clientWidth`), route-error
text, blank-screen text length, and console/page errors. Widths:
desktop 1440×900, tablet 820×1180, mobile 390×844.

**Result: 239 checks (216 page × width, 8 role-restriction, 15 live-build).
0 horizontal overflow, 0 route-error pages, 0 blank screens, exactly one
`h1` on every page. 1 console-error source, dev-server only (below).**

| Role    | Route                                                         | Desktop | Mobile | Live/Mock                         | Result |
| ------- | ------------------------------------------------------------- | ------- | ------ | --------------------------------- | ------ |
| Doctor  | `/doctor/overview`                                            | pass    | pass   | Connected (4 widgets not available) | pass |
| Doctor  | `/doctor/patients`                                            | pass    | pass   | Connected                         | pass |
| Doctor  | `/doctor/patients/:id` + 10 tabs (9 after the merge)          | pass    | pass   | Connected                         | pass |
| Doctor  | `/doctor/appointments`                                        | pass    | pass   | Connected                         | pass |
| Doctor  | `/doctor/medical-records`, `/new`, `/:id`                     | pass    | pass   | Connected                         | pass |
| Doctor  | `/doctor/labs`, `/new`, `/:id`                                | pass    | pass   | Connected                         | pass |
| Doctor  | `/doctor/pharmacy`, `/new`, `/:id`                            | pass    | pass   | Connected                         | pass |
| Doctor  | `/doctor/notifications`                                       | pass    | pass   | Connected (preferences: not connected) | pass |
| Doctor  | `/doctor/messages`                                            | pass    | pass   | Still Mock                        | pass |
| Doctor  | `/doctor/my-clinic`                                           | pass    | pass   | Still Mock                        | pass |
| Doctor  | `/doctor/ai`                                                  | pass    | pass   | Still Mock (F40)                  | pass |
| Doctor  | `/doctor/reports`                                             | pass    | pass   | Still Mock (F40)                  | pass |
| Doctor  | `/doctor/anatomy`                                             | pass    | pass   | Removed by the merge (404)        | pass at `a4070e9` (dev server logged a Draco `SyntaxError`; production bundle clean) |
| Doctor  | `/doctor/settings/{profile,account,security,activity}`        | pass    | pass   | Connected                         | pass |
| Doctor  | `/doctor/settings/{privacy,integrations,notifications}`       | pass    | pass   | Still Mock                        | pass |
| Doctor  | `/doctor/settings/{appearance,preferences,accessibility,about}` | pass  | pass   | Browser-local                     | pass |
| Admin   | `/admin`                                                      | pass    | pass   | Still Mock                        | pass |
| Admin   | 13 clinic-management sections                                 | pass    | pass   | Still Mock                        | pass |
| Admin   | `/admin/doctors`, `/admin/doctors/:id` (+ documents tab)      | pass    | pass   | Blocked (F33)                     | pass (mock) |
| Admin   | `/admin/patients`, `/admin/patients/:id`                      | pass    | pass   | Still Mock                        | pass |
| Admin   | `/admin/appointments`                                         | pass    | pass   | Blocked (F33)                     | pass (mock) |
| Admin   | `/admin/communications`, `/admin/logs`, `/admin/reports`, `/admin/profile` | pass | pass | Still Mock          | pass |
| Admin   | `/admin/settings/{general,users,roles,audit}`                 | pass    | pass   | users/roles Blocked; rest Still Mock | pass (mock) |
| Admin   | `/admin/preferences/{profile,notifications}`                  | pass    | pass   | Blocked (F33)                     | pass (mock) |
| Patient | (none in this client)                                         | N/A     | N/A    | patient-app, outside FE-10        | N/A |

The tablet width (820) was checked on every row above. Its results match
desktop and mobile and are left out of the table to keep it narrow.

**Role restriction** (mock build, desktop):

| Signed in as | Route                                                                     | Result                                  |
| ------------ | ------------------------------------------------------------------------- | --------------------------------------- |
| Doctor       | `/admin`, `/admin/doctors`, `/admin/settings/roles`, `/admin/appointments` | 403 "You don't have access to this page" |
| Admin        | `/doctor/overview`, `/doctor/patients`, `/doctor/pharmacy`, `/doctor/labs` | 403 "You don't have access to this page" |

**Live build, signed out** (all three widths):

| Route                            | Result                                                                  |
| -------------------------------- | ----------------------------------------------------------------------- |
| `/doctor/overview`               | → `/login?returnTo=%2Fdoctor%2Foverview`                                |
| `/admin`                         | → `/login?returnTo=%2Fadmin`                                            |
| `/doctor/settings/notifications` | → `/login?returnTo=…`                                                   |
| `/login`                         | Renders; **no demo credentials** shown (they are shown in mock builds)  |
| Sign-in attempt                  | `POST /api/v1/auth/login` sent to the API; visible error; **no fallback to the mock accounts** |

**The dev-server console error.** `/doctor/anatomy` fetches the Draco
decoder from `node_modules/.vite/libs/draco/`, which the Vite dev server's
dependency optimizer answers with `index.html`. The production bundles
(mock and live) ship hashed `draco_decoder-*.wasm` / `draco_wasm_wrapper-*.js`,
and the same route on the production bundle logs nothing. The page still
renders. FE-10 did not touch the anatomy code; this was pre-existing, and the
route no longer exists after the merge.

## API Coverage

Every endpoint FE-10 calls, all of which exist in a backend controller
(verified by extracting the `@Controller` × `@Get/@Post/@Patch/@Put/@Delete`
routes from `backend/src`):

- **Patients:** `GET /patients`, `POST /patients`, `GET /patients/:id/profile`,
  `GET /patients/:id/{appointments,history,medications,notes,documents,studies,labs}`
- **Appointments:** `GET /appointments`, `POST /appointments`,
  `GET /appointments/summary`,
  `POST /appointments/:id/{approve,reject,cancel,reschedule,complete,no-show}`
- **Time off:** `POST /me/time-off`, `POST /me/time-off/:id/resolve`
- **Dashboard:** `GET /dashboard/doctor/action-queue`
- **Medical records:** `GET /medical-records`, `GET /medical-records/:id`,
  `POST /medical-records`, `POST /medical-records/:id/notes`,
  `POST /medical-records/:id/notes/:noteId/sign`, `POST /medical-records/:id/status`
- **Pharmacy:** `GET /medications`, `GET /prescriptions`, `GET /prescriptions/:id`,
  `POST /prescriptions`, `POST /prescriptions/safety-check`,
  `POST /prescriptions/:id/{sign,renew,cancel}`
- **Laboratory:** `GET /lab-orders`, `GET /lab-orders/:id`, `GET /lab-tests/catalogue`,
  `POST /lab-orders`, `POST /lab-orders/:id/review`, `POST /lab-orders/review`,
  `POST /lab-orders/:id/attach-to-record`
- **Notifications:** `GET /notifications`, `GET /notifications/badge-counts`,
  `POST /notifications/:id/read`, `POST /notifications/:id/unread`
- **Self:** `GET/PATCH /me/profile`, `GET/PATCH /me/account`, `POST /me/password`,
  `POST /me/2fa/{setup,enable,disable}`, `GET /me/sessions`,
  `DELETE /me/sessions/:id`, `POST /me/sessions/revoke-others`, `GET /me/devices`,
  `DELETE /me/devices/:id`, `GET /me/login-history`, `GET /me/activity`
- **Admin (blocked live, F33):** `GET /doctors`, `GET /doctors/:id`,
  `POST /doctors/:id/documents/:docId/{approve,reject}`,
  `POST /doctors/:id/{verify,request-documents,reject,suspend,reactivate}`,
  `GET /admin/appointments`, `GET /admin/appointments/summary`,
  `POST /admin/appointments/:id/{nudge,reassign,cancel-administratively}`,
  `GET /admin/users`, `GET /admin/users/:id`, `PATCH /admin/users/:id`,
  `GET /roles`, `GET /roles/matrix`, `PUT /roles/matrix`, `POST /auth/admin-invitations`

Backend routes that exist and that FE-10 did **not** integrate (future
work, not defects): ~~`POST /notifications/read-all`~~, `PUT /me/profile/photo`,
~~`POST /appointments/:id/propose-slots`~~, ~~`GET /me/time-off`~~,
~~`DELETE /me/time-off/:id`~~, `GET/PUT /me/availability`,
`PATCH /medical-records/:id`, `GET /medical-records/:id/versions`,
~~`POST /medical-records/:id/report-issue`~~,
`POST /prescriptions/:id/discontinue`, ~~`POST /prescriptions/:id/notes`~~,
~~`GET /medications/:id/monograph`~~, `GET /lab-orders/summary`,
`POST /lab-orders/:id/{results,attachments,transition}`, `GET /patients/:id/lab-trends`,
the patient child CRUD (`/patients/:id/{allergies,alerts,emergency-contacts,history,notes,vitals}`) — of which `POST` allergies, alerts, history, emergency contacts and vitals, and `PATCH` emergency contacts, are connected since 2026-10-21,
`POST /roles/matrix/preview`, `GET /reports/analytics`, and the `/ai/*` family. (Of the patient child CRUD, `POST …/allergies` and `POST …/vitals` are connected since 2026-10-21.)

## Mock Data Audit

The flag `env.enableMocks` is read in four places: `api/seam.ts` (the
selection), `DoctorProfileProvider` (provider selection), `LoginPage` (the
demo-accounts hint), and `NewPrescriptionPage` (the `?simulate=` safety
fixture, mock only). A production build with `VITE_ENABLE_MOCKS=true` is
refused at boot (`configs/env.ts`).

Every production module that imports from a mock path, classified:

| Module                                                   | What it uses                         | Classification |
| -------------------------------------------------------- | ------------------------------------ | -------------- |
| `*/service.ts` seams (admin access, oversight, doctors; appointments, dashboard, labs, records, messaging, notifications, patients, pharmacy, settings; patient directory) | mock adapter as the `mock` side of `selectService` | Intentional mock mode |
| `dashboard/components/*Widget.tsx`, `http-dashboard-service.ts`, `OverviewPage.tsx` | **types only** from `model/mock-data` | Not data |
| `notifications/model/store.ts`                           | seeded corpus; imported only by the mock adapter | Intentional mock mode |
| `settings/http/http-settings-service.ts`                 | `SEED_SETTINGS.privacy/integrations`, typed carriers; both sections render "Not connected yet" live and integrations are forced `connected: false` | Legitimate, never rendered live |
| `settings/model/store.ts` `liveWorkflowStore`            | `SEED_SETTINGS.workflow` as defaults (landing page, date/time format, timezone `America/Chicago`) | Legitimate live fallback (UI preference defaults, not clinical data) |
| `DoctorProfileProvider` (`readProfile` → seed)           | mock branch only; live uses `emptyProfile` | Intentional mock mode |
| `patients/components/profile/anatomy` `ANATOMY_DEMO_INSIGHTS` | removed by the merge, with the Anatomy tab | — |
| `doctor/ai/service.ts`, `doctor/reports/service.ts`      | mock adapter bound **without** a seam | Intentional, disclosed in the UI. Stale rationale, see F40 |
| `features/auth/pages/LoginPage.tsx`                      | demo accounts; shown only when `env.enableMocks` | Intentional mock mode (verified absent live in the sweep) |
| admin `admin-profile.ts`, `logs.api.ts`, `reports.api.ts` seeds | behind `demoOnly` routes | Intentional mock mode; live routes are "Not connected yet" |
| `shared-domain/clinic-operations/store.ts`               | `selectService({ mock, http: unconnected })` | Intentional; live refuses every call |

Searched specifically for `|| MOCK_…`, `?? mock…`, `catch` blocks that return
seed data, hard-coded badge counts (none; the navigation reads
`ShellBadgesContext`, default 0), and hard-coded ids in the HTTP adapters
(none). The catch-returns-seed hits (`DoctorProfileProvider`, the AI,
notification, settings and reports stores, the admin profile/logs/reports
seeds) are all on the mock side or behind a demo-only route.

**Result: one accidental live-mode fake-success was found and fixed (V-1,
notification preferences). No other accidental demo-data leakage. Two
disclosed demo surfaces remain live (AI, doctor reports, F40).**

## Capability Audit

| Area                | Supported endpoint                    | Unsupported action handling                                                     | Server refusal shown          | Fake success? |
| ------------------- | ------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------- | ------------- |
| Pharmacy            | yes                                   | Drafts tab-local and disclosed; renew/cancel follow the server state machine    | Server reason on sign refusal | No            |
| Labs                | yes                                   | Annotations hidden ("not available"); bulk review only for all-normal           | Server reason on write        | No            |
| Notifications       | read/unread, badge counts             | Archive/favourite/pin/delete/clear hidden; adapter refuses `not_connected`; **preferences now not connected (V-1)** | n/a | **Was yes (V-1), now no** |
| Account / security  | yes                                   | Email read-only; privacy and integrations "Not connected yet"                   | Wrong password → field error  | No            |
| 2FA                 | yes                                   | Disable signs out immediately (F31 behaviour stated)                            | yes                           | No            |
| Doctor verification | yes                                   | Invite, reset access, reopen, role template/clinic hidden; history tabs dropped | yes                           | No            |
| Appointment oversight | yes                                 | History and capacity not served → not shown; patient identity "withheld"        | yes                           | No            |
| Admin users         | yes                                   | Admin role only by invitation (refusal worded)                                  | yes                           | No            |
| Roles matrix        | yes                                   | Reset hidden; stale revision → merge dialog (F36)                               | yes                           | No            |
| Invitations         | yes                                   | Reception/laboratory/pharmacy now land in minimal workspaces (F42, DEC-006a)     | yes                           | No            |
| Admin My Settings → Profile | `PATCH /me/profile` is practitioner-only | **Not offered to admins** (DEC-007) — My Settings opens on Account; the URL redirects there (F41 resolved) | n/a | No |

## Role / Authorization Audit

- **Patient.** Not a role of this client. `toSessionUser` refuses any role
  outside `ROLES` (`doctor`, `admin`, and since DEC-006a `reception`,
  `laboratory`, `pharmacy`), so a patient account cannot reach a single
  route of the web client. It is shown as "Incorrect email or password" (F42).
  Patient functionality belongs to `patient-app/`, outside FE-10.
- **Doctor.** `RequireRole role="doctor"` guards `/doctor/*`. Signed in as a
  doctor, every `/admin/*` route tried renders the 403 page in place. The
  admin-only badge query (`GET /doctors?verification=pending`) is enabled
  only for `role === 'admin'`, so a doctor never requests the roster.
- **Admin.** `RequireRole role="admin"` guards `/admin/*`. Signed in as an
  admin, every `/doctor/*` route tried renders 403. The admin surfaces call
  only routes the backend gates for admin. Live validation is impossible
  (F33).
- **Permission parity.** The backend `permission-catalogue.ts` and the
  frontend `Permission` union / `features/admin/permissions.ts` were not
  changed in this pass. The backend parity specs that read the frontend
  sources (`permission-catalogue.spec.ts`, `seed-parity.spec.ts`,
  `phi-mask.spec.ts`, `password.schema.spec.ts`) are among the 583 passing
  unit specs. F38 stands.
- Guards are UX only; the server enforces every rule (FRONTEND_ARCHITECTURE
  §12.1). No authorization rule was changed.

## API Adapter Audit

All 18 FE-10 HTTP adapters (the 13 `features/*/http/*.ts`, the 3
`shared-domain/*/http-*.ts`, `admin/doctors/api/pending-badge.ts` and the
live half of `DoctorProfileProvider`) were reviewed for method, path, body, mapping,
errors, ids, fallbacks and duplicates.

- Method and path: all match a backend controller route (API Coverage).
- Mapping: strict readers (`api/http.ts`). A body the adapter cannot read
  is `malformed_response`, a visible error, never an empty result.
- Errors: no swallowed errors. The `catch` blocks rethrow, re-label a 404
  as the screen's not-found, or attach context (a record created whose
  note failed; lab orders placed before a part-way failure). The two that
  return a value are deliberate. `toSafetyWarnings` returns `null`, and
  the caller turns that into a **failed** verdict. `editorName` falls back
  to the `usr_…` handle when the editor lookup fails.
- No hard-coded ids. No demo fallback on any HTTP side.
- Tolerated backend quirks, each handled on purpose: the Prisma `bloodType`
  spelling (`AB_POSITIVE`) on the lab and prescription projections; the
  roles-matrix 409 detail arriving as a JSON string (F36); a review
  response that returns only who reviewed and when (missing fields stay
  `null`); calendar days served as UTC midnight (`readDay`).
- Request volume, an efficiency observation and not a defect: the lab
  worklist loads each order's full document, a few at a time, because the
  summary lacks result values. The global search triggers the same load on
  first use. Mark-all-read sends one request per id, although
  `POST /notifications/read-all` exists.

## Responsive Validation

Covered by the route sweep at 1440, 820 and 390. No page overflowed
horizontally at any width, including the tables (patients, records, labs,
pharmacy, appointments, admin doctors, admin users), the settings center,
the roles matrix, the doctor profile and the admin doctor profile, and
appointment oversight. Drawers and dialogs were not opened one by one in
this pass. Their responsive behaviour rests on the component tests and the
per-phase sweeps.

## Quality Gates

Final tree = `9a1a331` + V-1. Frontend, run twice: on `9a1a331` (baseline)
and after V-1.

| Gate                          | Command                                  | Baseline `9a1a331`                 | After V-1                          |
| ----------------------------- | ---------------------------------------- | ---------------------------------- | ---------------------------------- |
| Frontend typecheck            | `npm --prefix frontend run typecheck`    | 0 errors                           | 0 errors                           |
| Frontend lint                 | `npm --prefix frontend run lint`         | 0 errors, 20 warnings              | 0 errors, 20 warnings              |
| Frontend tests                | `npm --prefix frontend run test`         | 186 files, 2093 passed             | 187 files, 2095 passed             |
| Frontend build                | `npm --prefix frontend run build`        | pass                               | pass                               |
| Frontend format (not a gate)  | `npm --prefix frontend run format:check` | 271 files flagged                  | V-1 files clean                    |
| Backend typecheck             | `npm --prefix backend run typecheck`     | 0 errors                           | (backend unchanged)                |
| Backend lint                  | `npm --prefix backend run lint`          | 0 errors, 0 warnings               | (backend unchanged)                |
| Backend build                 | `npm --prefix backend run build`         | pass                               | (backend unchanged)                |
| Backend unit specs            | `npx vitest run src` (in `backend/`)     | 32 files, 583 passed               | (backend unchanged)                |
| Backend full suite incl. e2e  | `npm --prefix backend run test`          | **FAIL**: 55 files / 187 tests failed, 36 files / 648 passed, 1058 skipped | (backend unchanged) |

Warnings, classified:

- **20 lint warnings**, all `react-refresh/only-export-components`. These
  are pre-existing, and the count equals the CLAUDE.md ceiling. FE-10 added
  none.
- **Build chunk-size warning** (`GLTFLoader` 635 kB): pre-existing (3D
  anatomy), unavoidable without a code-split decision outside FE-10.
- **React Router v7 future-flag warnings** in test stderr: pre-existing.
- **Prettier: 271 files flagged** at both the FE-10 base (`91372fb`) and
  `9a1a331`. Under `src/`, FE-10 cleaned 5 files and left 5 others
  unformatted (`admin/overview/overview.ts`, `appointments/pages/AppointmentsPage.tsx`,
  `dashboard/components/{AppointmentsTrend,Notifications,Satisfaction}Widget.tsx`).
  `format:check` is not a CLAUDE.md gate, and CI does not run it. These
  are not reformatted here, to keep the diff to the correction.

**Backend e2e status: failing for environment reasons, not passing.** Every
one of the 55 failing files is a `test/*.e2e-spec.ts`, and every failure is
a connection failure. With PostgreSQL stopped (its state in this fresh
container): `Can't reach database server at 127.0.0.1:5432` (P1001). With
the service started read-only for diagnosis: `Authentication failed …
credentials for 'medora' are not valid`. The server holds only `postgres`,
`template0` and `template1`; the `medora` role, `medora`, `medora_test` and
`medora_shadow` do not exist. Nothing was created, and the service was
stopped again. All 32 non-e2e spec files pass.

## Browser Validation

| Kind             | What                                                                                                            | Status |
| ---------------- | --------------------------------------------------------------------------------------------------------------- | ------ |
| Live validated (this session) | Live production build: guards, login page, sign-in failure with no mock fallback, no demo credentials | **Passed**. API-dependent pages could not be reached, since there was no API |
| Live validated (this session) | Any signed-in live page, doctor or admin                                                           | **Blocked**: no database in the container (F39). Creating one was prohibited |
| Live validated (phase sessions) | Doctor surfaces FE-10.2–10.9                                                                     | Reported in the phase records; **not re-verified** here |
| Mock validated   | Every doctor and admin route above, at 3 widths                                                                 | **Passed** |
| Blocked          | **Live admin**, every admin surface                                                                             | **Blocked (F33). Live admin validation has never passed.** |

## Backend Findings

Each finding was re-verified against the current source.

| #   | Finding                                                                                                   | Verified now                                                                                                                                                                        | Changed? |
| --- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| F31 | Disabling 2FA revokes the current session too, although the comment says "every other session"            | `two-factor.service.ts` `disable()` calls `sessions.revokeAllFor(user.id)` (no exclusion); its doc comment says "Every other session is revoked". The frontend states it and signs out | No       |
| F32 | Lab actions appear in the activity log as profile events                                                  | `lab-order.service.ts:345` and `lab-review.service.ts:167` write `kind: 'profile'`; `ActivityKind` has no lab member                                                                  | No       |
| F33 | Seeded admin cannot complete TOTP; the invitation flow itself needs an authenticated admin                | `login.service.ts`: a privileged role without `twoFactorEnabled` is refused `two_factor_required` (403) before any challenge                                                         | No       |
| F34 | **Fixed 2026-10-21 (pass 2).** Login shows a generic "Something went wrong" for `two_factor_required`                                    | `LoginPage.tsx` branches only on `email_unverified`, `otp_required`, `invalid_credentials`. `two_factor_required`, `account_inactive` and `rate_limited` all fall to `login.error.generic`, although `api/endpoints/auth.ts` maps them. Fixing it is a frontend change outside FE-10 | No |
| F35 | Backend oversight flag is `complaint`; frontend uses `complaint-attached`; backend flag never fires       | `appointment.schema.ts:178` `'complaint'`; `appointment-oversight.service.ts:482` "no source of truth yet"; frontend `oversight.types.ts:131` `complaint-attached`; adapter maps `complaint: null` | No |
| F36 | Roles-matrix stale-save conflict details arrive as a JSON string in the error message                     | `http-access-service.ts` `conflictCurrent()` still `JSON.parse`s the detail string                                                                                                   | No       |
| F37 | Backend lacks several admin UI features, which stay unavailable live                                      | No routes for doctor invitations, access reset, reopen, role template/clinic, matrix reset, platform settings, clinic operations, admin patients, communications, logs | No |
| F38 | No permission drift between frontend and backend roles                                                    | Neither side changed; backend unit specs (including parity) pass                                                                                                                    | No       |
| F39 | Backend e2e needs a `medora_test` database that is absent                                                 | Still absent. In this container the `medora` role and the dev database are absent too, and PostgreSQL was stopped at start                                                          | **Extended** |

New findings from this validation:

| #   | Finding                                                                                                                                                                                                                                       | Side                 | Action |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------ |
| F40 | The backend now serves `/ai/*` and `GET /reports/analytics`, but `/doctor/ai` and `/doctor/reports` still bind their mock services without a seam. Their comments say "no assistant endpoint exists" and "the backend implements auth, `/health`, `/ready` and `/me/*` and nothing else", which is no longer true. Both disclose their demo nature in the UI. | Frontend (outside FE-10) | Documented; integration is future work |
| F41 | `/admin/preferences/profile` (admin "My Settings") offers the doctor professional-profile form. `PATCH /me/profile` answers 404 for an account with no `doctors` row, so an admin's save always fails, and the failure is shown. | Frontend (FE-10.9 reuse) | **Resolved 2026-10-22 (DEC-007):** `profile` is a practitioner-only settings section, so an admin is never offered the form; My Settings opens on Account. Tested and browser-verified on the demo bundle; no live run |
| F42 | The web client places only `doctor`/`admin` sessions. FE-10.10's invitation dialog creates `reception`, `laboratory` and `pharmacy` accounts, and those accounts (like patients) are then refused at this client's sign-in with "Incorrect email or password". | Frontend (product gap) | **Resolved in the frontend by DEC-006/006a** (2026-10-21, branch `claude/frontend-owner-decisions`): the three roles sign in to minimal `/reception`, `/laboratory`, `/pharmacy` workspaces. Lab orders, dispensing and booking for them wait on BR-DEC-006 (`frontend/FRONTEND_CHECKLIST.md` §9.0) |
| V-1 | Notification preferences (delivery channels, quiet hours, categories) were offered live as switches labelled "Changes apply immediately". They were stored only in localStorage and nothing read them back, so turning e-mail off silently did nothing. | Frontend (FE-10.8/10.9 gap) | **Fixed in this pass** |

## FE-10 Regression Check

- **Full suite after V-1:** 187 files, 2095 tests pass (baseline 186 / 2093;
  +1 file, +2 tests from V-1). The `http-notification-service` capability
  assertion gained `preferences: false`; nothing was removed or loosened.
- **Pharmacy, labs, records, patient profile, appointments, Overview,
  notifications, settings, 2FA, doctor profile, admin:** the routes render
  in the sweep at all widths. The adapter and live-posture specs pass.
- **Shell badges:** `ShellBadgesProvider.test.tsx` passes. Navigation has no
  hard-coded counts.
- **Live/mock switching:** a live build shows no demo credentials, falls
  back to no mock accounts, and redirects every guarded route. The live
  posture specs (`live-posture`, `live-access`, `live-doctors`,
  `live-oversight`, `live-actions`, `live-sections`, `live-wording`,
  `live-preferences`) pass.
- **No regression found.**

## Merge of origin/frontend

`origin/frontend` had moved 5 commits past this branch's base (`91372fb` →
`228b6f4`): PR #35, a customizable doctor Overview, and PR #37, which removed
the anatomy explorer and the patient Anatomy tab, dropped the doctor columns
from the doctor's own worklists, and standardised paging. It was merged into
this branch after the validation above. The merge conflicted in 8 files, all
in the Overview that FE-10.4 rewrote, and in one more file that merged
without markers but no longer compiled.

**The conflict was a design collision, not only a textual one.** PR #35's
catalogue rendered each widget as `ComponentType<{ menu, className }>`, and
each widget read its figures straight from `model/mock-data.ts`, including
the new `MetricWidgets.tsx`, which merged cleanly. Taken as it was, a live
build would have shown seeded KPIs, a seeded schedule and seeded alerts
beside a real sign-in, which FE-10.4 had removed. The resolution keeps both
halves:

- **PR #35's page, whole:** the catalogue, the wrapping grid, the customize
  drawer, remove-with-Undo, the empty first visit, and persistence.
- **FE-10.4's data, whole:** the page makes one `useDashboardOverviewQuery()`
  call through the dashboard seam. `DashboardWidgetSlotProps` gains
  `overview`, and the grid hands it to every widget. The six data widgets
  keep their FE-10.4 props (data, loading, error), gain the `menu` slot,
  and are bound to their section of the document in
  `components/OverviewWidgetSlots.tsx`. The metric tiles read their KPI
  from the document. No widget imports the fixture module any more.
- **The greeting** keeps FE-10.4's count of today's appointments and
  waiting requests from the document.
- **The drawer's markers follow the build:** "Sample data" in the demo,
  nothing for a server-backed widget live, and "Not available yet" live for
  practice pulse, the trend, satisfaction and recent activity.
- **New:** practice pulse, the trend, satisfaction and recent activity now
  show a failed load as a failure with Retry. They used to fall through to
  "Not available yet". In the fixed layout they sat in collapsed bands; on
  a dashboard of the doctor's choosing they are first-class.
- `PatientProfilePage.test.tsx` merged without markers but lost the
  `userEvent`/`waitFor` imports that FE-10.2's lazy-tab tests still use. The
  imports are restored.

Tests: the fixed-layout assertions in `OverviewPage.test.tsx` (collapsed
bands, the `dashboard-alerts` id) went with the fixed layout, as PR #35
retired them. FE-10.4's behavioural checks were ported onto the composable
page: four "Not available yet" from a live-shaped source; a failed load
with Retry, now including a metric tile and an analytics widget; and the
greeting's counts. Added: a metric tile shows the source's figure (`42`),
not the fixture's; and the catalogue test renders every widget against an
empty document and asserts that no seeded patient, alert, statistic,
activity row or KPI caption appears.

Effect on this document's counts: Still Mock goes from 23 to 22, because the
patient Anatomy tab is gone. `/doctor/anatomy` is now a 404. Connected (27)
and Blocked (10) are unchanged.

Gates on the merged tree:

| Gate               | Result                                                       |
| ------------------ | ------------------------------------------------------------ |
| Frontend typecheck | 0 errors                                                     |
| Frontend lint      | 0 errors, 20 warnings (the accepted ceiling)                 |
| Frontend tests     | 178 files, 1973 passed (187 − 16 files deleted upstream with anatomy and the fixed layout + 7 added upstream) |
| Frontend build     | pass (after `npm ci` on the merged lockfile, which drops `three`) |

The merge touches no backend file, so the backend results above stand.

### Browser QA of the merged Overview

Run in Chromium on production bundles, 63 checks, all passing:

- **Live build** (`VITE_ENABLE_MOCKS=false`), with every `/api/v1` call
  answered by Playwright route interception using live-shaped bodies
  (the adapter's contract-test shapes). This is a stubbed API. No backend
  or database was involved, so it is **not** live-backend validation.
- **Demo build** (mocks on).

What was checked:

- **First visit:** empty state, Customize and Open appointments.
- **Add, remove, Undo:** removing a widget closes the gap and sends focus
  to Customize; Undo restores the widget in place; removing the last
  widget returns the empty state.
- **Refresh:** the selection and its order persist, and the figures are
  re-read from the response.
- **Responsive:** at 1440, 820 and 390 with all 12 widgets: no horizontal
  overflow, no overlap, no control outside the viewport, one widget per
  row on mobile.
- **Data from the response:** schedule rows from `/appointments` in time
  order, alerts from the action queue, and metric tiles showing the
  response's 17 / 6 / 3 / 41 (mock: 5 / 1 / 5 / 9). The greeting reads
  "3 appointments today · 6 requests need your decision". No string from
  the fixture module appears on the page.
- **"Not available yet":** exactly the four unserved widgets, both with
  data and with an empty response. With an empty response, the schedule,
  alerts and metrics show their own empty states or `0`.
- **Failure:** "Couldn't load …" with Retry on every data widget, and no
  invented counts. Retry refetches and every widget recovers.
- **Demo build:** the drawer marks the 10 data widgets "Sample data", and
  sample figures render.

One defect found and fixed: on a failed load, "Today's schedule" was
subtitled "0 appointments" above "Couldn't load today's schedule". The
count is now hidden on error as well as while loading. This dated from
FE-10.4, and `OverviewPage.test.tsx` now pins it.

## Security

- No authentication bypass. Live pages were reached only through the real
  guards. Mock-mode sign-ins used the mock build's own login form.
- No authorization bypass. No guard, role or permission rule changed.
- No TOTP secret injection. No credential, seeded admin or TOTP state was
  touched.
- No database manipulation. PostgreSQL was started only to list databases
  and roles read-only, then stopped. Nothing was created, migrated or seeded.
- No backend modifications. The FE-10.V diff is confined to `frontend/` and
  this document.

## Git

| Item         | Value                                                                                   |
| ------------ | --------------------------------------------------------------------------------------- |
| Branch       | `claude/sweet-goodall-z99z4t`                                                           |
| FE-10.10     | `9a1a331`                                                                               |
| Validation   | `a4070e9` — V-1 and this document, on top of `9a1a331`                                   |
| Final commit | the merge of `origin/frontend` (`228b6f4`) into this branch, on top of `a4070e9`         |
| Working tree | clean after the commit                                                                  |
| Push status  | pushed to `origin/claude/sweet-goodall-z99z4t`                                          |
| PR status    | none opened                                                                             |
| Merge        | none                                                                                    |
| Deployment   | none                                                                                    |
