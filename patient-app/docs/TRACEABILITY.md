# Traceability — screen → service → endpoint → module → table

**Checklist row:** A-04 · **Audit:** §14
**Rule:** no row below names an endpoint that is not either **live today** or
recorded in audit §15.3. Where the endpoint does not exist, the row says so and
names the dependency — it does not invent a plausible path.

## Legend

| Code | Meaning |
|---|---|
| ✅ **LIVE** | The endpoint exists in the backend today and this app calls it |
| 🟡 **FIXTURE** | Screen built; adapter behind the seam returns fixtures. Production build fails loudly |
| 🔴 **BLOCKED** | Needs a named backend dependency or architecture decision |
| ➖ **OUT OF V1** | Scoped out (audit §15.5) |

---

## Authentication

| Screen | Service method | Endpoint | Module | Tables | State |
|---|---|---|---|---|---|
| `WelcomeScreen` | — | — | — | — | ✅ frontend only |
| `LoginScreen` | `authService.login` | `POST /auth/login` | auth | `users`, `sessions`, `login_events` | ✅ **LIVE** — for a patient principal too, since ADR-030. The refresh token arrives **in the body** under `X-Client-Type: mobile` (ADR-034) |
| `OtpScreen` | `authService.verifyOtp` · `resendOtp` | `POST /auth/otp/verify` · `/resend` | auth | `otp_codes` | ✅ **LIVE** |
| — (cold start) | `authService.refresh` | `POST /auth/refresh` (`X-Client-Type: mobile`) | auth | `sessions` | ✅ **LIVE**, body-token path built and e2e-tested |
| `SessionUnconfirmedScreen` | `retryRestore` → `authService.refresh` | `POST /auth/refresh` (`X-Client-Type: mobile`) | auth | `sessions` | ✅ frontend only, over the same live route. Shown when a stored refresh token could not be **exchanged because the server did not answer** (no signal, timeout, 5xx, a middlebox's 403). Only a 401 — the one refusal `/auth/refresh` sends — ends the session (`refresh-outcome.ts`); the token is kept and retried, by hand or on reconnect, never while Emergency is open. *Sign out of this phone* is local only: `POST /auth/logout` revokes the session an access token names, and this state has none, so the server is not asked and the confirmation says so |
| `AccessDeniedScreen` | `SessionProvider` eligibility gate (`features/auth/eligibility.ts`) | login / OTP / `POST /auth/refresh` payload `user.role`; `GET /me/patient-link` `403 patient_only`; `POST /auth/logout` | auth | `users.role` | ✅ frontend only, over live routes (C-11). A non-patient account is revoked server-side and swept locally, then shown *This app is for patients only*; Emergency stays a route. An ordinary endpoint 403 never triggers it |
| `RegisterScreen` | `authService.register` | `POST /auth/register` | auth | `users`, `user_credentials` | ✅ **LIVE** — ADR-030 added the `patient` role and **ADR-035** made the body a discriminated union whose patient branch carries nothing clinical. Creates an account linked to no record (ADR-030 §4) |
| `VerifyEmailScreen` | `resendVerification` | `POST /auth/verification/resend` | auth | `verification_tokens` | ✅ **LIVE** |
| `ForgotPasswordScreen` | `forgotPassword` | `POST /auth/forgot-password` | auth | `verification_tokens` | ✅ **LIVE** |
| `ResetPasswordScreen` | `resetPassword` | `POST /auth/reset-password` | auth | `verification_tokens` | ✅ **LIVE** — the token may be pasted bare or as the whole emailed link; `medora://reset-password?token=…` prefills it, signed out only. The emailed https link does not open the app (no universal links; D-17) |
| Profile → sign out | `authService.logout` | `POST /auth/logout` | auth | `sessions` | ✅ **LIVE** |
| — (session restore) | — | `GET /auth/session` | auth | `users` | ✅ **built (M8)** — and **still not called by this app**, now for a stronger reason than its absence: `SessionUserService.current()` returns `{id, name, email, role, permissions}` with a non-`ACTIVE` check, and `RefreshService.refresh()` returns the same five fields under `user` with the same check, at exactly the moment restore would call it. A round trip W-08 budgets, for no field this client does not already hold — and two of them (`role`, `permissions`) are ones T-07 keeps off `AuthenticatedIdentity`. D-13, `ARCHITECTURE.md` §4.2 |
| Account claim | — | — | — | `patients.user_id` | 🔴 **RA-030.1** — the column exists (ADR-030 Option A); the **flow** does not. Deferred inside ADR-030 with auto-linking on email ruled out. ⚠ Not ADR-031, which is Results Release Policy |

---

## Emergency — the one feature that needs no backend

| Screen / component | Source | Endpoint | State |
|---|---|---|---|
| `EmergencyScreen` | `content/guidance.ts` (**bundled**) | — | ✅ **complete** |
| `EmergencyDisclaimer` | bundled | — | ✅ |
| Red-flag list | bundled | — | ✅ |
| `EmergencyCallButton` (two-step dial) | — | — | ✅ |
| "When to call vs book" | bundled | — | ✅ |
| Operator emergency numbers | `emergencyService.getConfiguration` | none — BE-11's `GET /public/emergency-contacts` was withdrawn with every `/public/*` route (DR-09) and no replacement is defined; it must answer signed out | 🔴 **BE-11 / owner** — ships unconfigured and says so. **Never guessed** |
| Clinic phone / directions on Emergency | same | `GET /patient/hospitals/:id` (proposed, `docs/multi-hospital/API_CONTRACT_CHANGES.md` §5; supersedes `GET /public/clinic`, DR-09) | 🔴 **BE-11** — not built |
| Patient's emergency contacts | `healthService.listEmergencyContacts` | `GET /me/health/*` | 🟡 **BE-09** — built over the fixture (N-08). Signed out it renders nothing and **makes no request**; a failure renders nothing either, so the bundled guidance is never displaced |
| First-aid instruction | — | — | 🔴 **N-07** — needs a named clinical owner (W-10). Deliberately absent |
| Nearby emergency hospitals | — | — | ➖ Future — needs real location data (API-P07). *Was* AD-3, reversed 2026-10-06. Still ➖ under the 2026-10-07 Multi-Hospital decisions: OD-10 covers distance in signed-in discovery, not this emergency feature (N-10) |

---

## Home

| Component | Service | Endpoint | Module | Tables | State |
|---|---|---|---|---|---|
| Greeting | `useIdentity()` | — | — | — | ✅ |
| **Emergency card** | — | — | — | — | ✅ **complete** |
| Next-appointment card | `appointmentService.list('upcoming')` | `GET /me/appointments?upcoming=true` | appointments (M11) | `appointments` | ✅ **LIVE** — the same `useAppointments('upcoming')` the Appointments tab uses, so it moved when that did. What is still absent is `availableActions`, which is why F-03 is not closed: the card renders date, time, doctor and status, and offers no action the server did not offer |
| Quick actions | — | — | — | — | ✅ |
| Recent activity (`RecentActivity`) | `activityService.listRecentActivity` | — (no route serves this feed) | — | — | 🟡 **M8 landed; `GET /me/activity` is a different feed** — it is the account-security log (`profile · password · login · settings · security · integration · privacy`), not the clinical one this section renders, so the endpoint and module columns no longer name it. The section is built over the fixture behind the seam and the production adapter refuses by name. It renders **nothing at all** on a refusal rather than an error card: `RecentActivity`'s docblock argues why an absence beats a wrong answer on the app's front screen |
| Tab-bar unread badges | `notificationService.unreadCount` | `GET /notifications/badge-counts` | notifications (M19) | `notifications` | ✅ **LIVE** — O-02 landed at PR #127; the badge and its foreground poll are built on the live count |
| Announcements (`Announcements`) | `clinicService.listAnnouncements` | — | communication (M20) | `announcements` | 🟡 **BE-11** — see the Clinic section; silent on a failure *and* on an empty list, for two different reasons |
| Unlinked-account explanation (F-09, Home and Appointments) | `useRecordLink` → `profileService.get` | `GET /me/profile` (`patient: null`) | patients (ADR-030) | `users`, `patients` | ✅ **LIVE** — the same query Profile makes; replaces the empty state only. No link or claim action (RA-030.1) |
| `HomeScreen` | — | — | — | — | ✅ the screen itself; every section it renders is a row above |
| AI assistant FAB | — | — | ai (M16) | — | 🔴 **AD-4 — no entry point exists** |

---

## Doctor discovery

| Screen | Service | Endpoint | Module | Tables | State |
|---|---|---|---|---|---|
| `DiscoverScreen` | `doctorService.search` | `GET /patient/doctors` | doctors (M9) | `doctors`, `doctor_specialties` | ✅ **LIVE** |
| `DoctorCard` | same | same | — | — | ✅ **LIVE** — renders only the A-05 allow-list, and the response schema strips the rest at the seam |
| `DoctorProfileScreen` | `doctorService.getById` | `GET /patient/doctors/{doctorId}` | doctors (M9) | `doctors` | ✅ **LIVE** — 404 for unknown, unverified and inactive alike |
| Specialty chips | `listSpecialties` | `GET /patient/specialties` | doctors (M9) | `specialties` | ✅ **LIVE** |
| Department filter | `listDepartments` | `GET /patient/departments` | administration (M23) | `departments` | 🟡 **BE-11 / M23** — the route is contract §3.4 P3.4, NOT BUILT. Filtering by `departmentId` works and `DepartmentFilter` is built over it (G-07); with no list to choose from the control renders nothing, so search keeps working unfiltered |
| Verified-only default | — | server-side in `patient-doctor.service.ts` | doctors (M9) | `doctors.verification_status` | ✅ **LIVE, server-side. Not a client filter** — the client is tested never to send one |
| Slot preview on the profile | `appointmentService.listSlots` | `GET /patient/doctors/:id/slots` (proposed, `API_CONTRACT_CHANGES.md` §6 — doctor-published only, DR-10; supersedes `GET /public/doctors/{id}/slots`) | appointments (M11) | `doctor_availability`, `doctor_time_off` | 🟡 **BE-06 — server-computed.** `AvailabilityPreview` is built over it (G-09): it renders the first few future slots and nothing else, hands a tapped time to the booking flow as a request that flow re-checks, and renders nothing at all while the read refuses |

---

## Clinic

| Screen | Service | Endpoint | Module | Tables | State |
|---|---|---|---|---|---|
| `ClinicScreen` | `clinicService.getProfile` | `GET /patient/hospitals/:id` (proposed, `API_CONTRACT_CHANGES.md` §5; supersedes `GET /public/clinic`, DR-09) | platform-settings (M24) | `platform_settings` → `organization` | 🟡 **BE-11** |
| Opening hours | `getOpeningHours` | `GET /patient/hospitals/:id` locations (proposed, §5; supersedes `GET /public/clinic/hours`) | administration (M23) | `clinic_working_days`, `holidays` | 🟡 **BE-11** |
| Announcements on Home | `listAnnouncements` | — | communication (M20) | `announcements` | 🟡 **BE-11** — no route is specified for the public projection, so none is named here. The projection itself is: no `author_id` (A-05), no `archived`/`deleted_at`, no `expires_at` (the server filters; this client never computes against a clock) |
| Departments list | `doctorService.listDepartments` | `GET /patient/hospitals/:id` departments (proposed, §5; supersedes `GET /public/departments`) | administration (M23) | `departments` | 🟡 **BE-11** |
| `DepartmentScreen` | `doctorService.search({ departmentId })` | `GET /patient/doctors?departmentId=` | doctors (M12) | `doctors`, `departments` | ✅ **LIVE** — BE-04's projection serves the list itself (H-05). The row above is why the screen is still 🟨 on the checklist: the way IN is the department list, which is not |
| `tel:` + maps hand-off | `features/emergency/dial.ts` | — | — | — | ✅ frontend only |
| Multi-hospital search, distance | — | `GET /patient/discovery/search`, `GET /patient/hospitals` (proposed, `docs/multi-hospital/API_CONTRACT_CHANGES.md` §5; supersedes the public `GET /public/organizations`, API-P01) | — | — | ⬜ **H-06, H-07, H-08, Q-05** — signed-in hospital search and comparison, **including distance**, are in scope (DR-09, OD-10, 2026-10-07 Multi-Hospital FINAL). Never signed out |

---

## Appointments

> The whole phase obeys one rule: **the server owns every transition.** The
> client renders `availableActions` and renders `409 conflict` when it loses a
> race. `appointments.test.tsx` asserts no action is derived from `status`.
>
> The live payload does not carry `availableActions` yet, and its absence is
> the contract (§4): `[]` would assert that no action is available, which is a
> statement about policy ADR-033 has not made. The port therefore makes the
> field optional — `undefined` is *not stated*, `[]` would be *stated as none*.

| Screen | Service | Endpoint | Module | Tables | State |
|---|---|---|---|---|---|
| `AppointmentsScreen` | `list('upcoming' \| 'past')` | `GET /me/appointments` | appointments (M11) | `appointments` | ✅ **LIVE** — `upcoming=true` resolves on the server's clock; Past uses the contract's `to` |
| `AppointmentCard` | — | — | — | `appointment_status` | ✅ **LIVE** — all 8 statuses render; the wire value is checked against `APPOINTMENT_STATUSES` at the seam |
| `AppointmentDetailScreen` | `getById` | `GET /me/appointments/{appointmentId}` | appointments (M11) | `appointments`, `appointment_events` | ✅ **LIVE** — 404 for unknown, not-yours and unlinked alike |
| `BookingFlow` (5 steps) | `listSlots` + `book` | `GET …/slots` · `POST /me/appointments` | appointments (M11) | `appointments` | 🔴 **ADR-033 / RA-033.1** — a decision, not an unbuilt endpoint |
| Slot step | `listSlots` | `GET /patient/doctors/:id/slots` (proposed, §6, DR-10; supersedes `GET /public/doctors/{id}/slots`) | appointments (M11) | availability − time-off − booked − buffer | 🔴 **RA-033.1 — no client-side generation.** The slot maths is derivable from ADR-005; the booking policy is not |
| Cancel sheet | `cancel(id, reason)` | `POST /me/appointments/{id}/cancel` | appointments (M11) | `appointments.cancelled_reason` | 🔴 **ADR-033 Q1** — may a patient cancel, from which statuses, up to when? |
| Reschedule sheet | `requestReschedule` | `POST …/reschedule` | appointments (M11) | `appointment_reschedule_proposals` | 🔴 **ADR-033 Q2** — request-shaped or direct? |
| Proposal response | `acceptProposal` | `POST …/confirm` | appointments (M11) | `appointment_reschedule_proposals` | 🔴 **ADR-033 Q3** — plus the doctor-side `propose-slots` (M11.4), unbuilt |
| Event timeline | `getById` | same | appointments (M11) | `appointment_events` | ✅ **LIVE** — `actor` is the coarse `patient \| clinic \| system`; `actor_name` is deliberately not projected |

---

## Health records

> Gated by **AD-5**. Every record carries a server-supplied `ReleaseState` and
> `ReleaseNotice` renders the withheld cases honestly — never a blank, never an
> error the patient could retry past.

| Screen | Service | Endpoint | Module | Tables | State |
|---|---|---|---|---|---|
| `HealthRecordsScreen` | `listAllergies` · `listConditions` · `listMedications` · `listHistory` | `GET /me/health/*` | patients (M10) | `patient_allergies`, `patient_chronic_conditions`, `patient_medications`, `patient_medical_history` | 🟡 **BE-09** |
| `LabResultsScreen` | `listLabOrders` · `getLabOrder` | `GET /me/health/labs` | labs (M14) | `lab_orders`, `lab_results` | 🟡 **BE-09 + AD-5** |
| `PrescriptionsScreen` | `listPrescriptions` | `GET /me/health/prescriptions` | pharmacy (M13) | `prescriptions` | 🟡 **BE-09** — read-only, permanently |
| `DocumentsScreen` | `listDocuments` | `GET /me/health/documents` | files (M25) | `patient_documents`, `files` | 🔴 **BE-09 + BE-15** — no object storage exists |
| `VisitsScreen` | `listVisits` | `GET /me/health/visits` | medical-records (M12) | `medical_records` | 🟡 **BE-09 + AD-5** — the patient projection, never the clinician's note |
| `VisitDetailScreen` | `listVisits` | same | medical-records (M12) | `medical_records` | 🟡 **BE-09 + AD-5** — **no by-id route.** The contract has the list and nothing else, so `useVisit` selects out of the same query rather than naming a route that does not exist |

---

## Messages

| Screen | Service | Endpoint | Module | Tables | State |
|---|---|---|---|---|---|
| `MessagesScreen` | `listConversations` | `GET /me/conversations` | messaging (M20) | `conversations`, `conversation_participants` | 🔴 **AD-1 + BE-13** — participants are `User`s |
| `ThreadScreen` | `getConversation` · `send` | `GET`/`POST …/messages` | messaging (M20) | `messages` | 🔴 **BE-13** |
| Read receipts | `markRead` | `POST …/read` | messaging (M20) | `conversation_participants.last_read_at` | 🟡 **BE-13** — called by `ThreadScreen` when the count says something is unread; no tab badge, because no conversation badge-count endpoint exists |
| Attachments | — | — | messaging + files | `message_attachments` | 🔴 **BE-13 + BE-15** — no affordance built |
| Delete a message | — | — | — | — | ➖ **405 in patient threads.** No affordance, by design |
| Emergency route in the composer | — | — | — | — | ✅ frontend only |

---

## Notifications

| Screen | Service | Endpoint | Module | Tables | State |
|---|---|---|---|---|---|
| `NotificationsScreen` | `list` · `markRead` · `markAllRead` | `GET /notifications` · `POST /notifications/{id}/read` · `POST /notifications/read-all` | notifications (M19) | `notifications` | ✅ **LIVE** — the surface is `/notifications`, **not** `/me/notifications`; an earlier revision of the patient contract said otherwise and was wrong |
| Tab-bar badge | `unreadCount` | `GET /notifications/badge-counts` | notifications (M19) | `notifications` | ✅ **LIVE** — an earlier revision of this row said the badge and its foreground poll were not built. They landed as O-02 at PR #127 |
| Push registration | — | `POST /me/devices` | notifications (M41.2) | `notification_deliveries` | 🔴 **BE-12** — documented in `push-registration.ts`, **not faked** |
| Preferences | `getPreferences` · `updatePreferences` | `GET`/`PUT /me/notification-preferences` | notifications (M19) | `notification_preferences` | ✅ **LIVE** (2026-11-01) — M19.4 serves both routes, `@Authenticated()` so a patient reaches them. `NotificationPrefsScreen` reads the row through the HTTP adapter and writes it whole (O-06); not yet run against a live backend (V-07's class of check) |

---

## Profile

| Screen | Service | Endpoint | Module | Tables | State |
|---|---|---|---|---|---|
| `ProfileScreen` | `profileService.get` | `GET /me/profile` | patients (ADR-030) | `users`, `patients` | ✅ **LIVE** — `patient: null` is a success, not a 404 |
| `LinkRecordScreen` | `patientLinkService.getState`, `.issueCode` | `GET /me/patient-link`, `POST /me/patient-link/code` | patients (ADR-048) | patient link codes | ✅ **LIVE per contract** — staff-mediated linking: the screen explains the desk visit with an identity document and shows a short-lived 8-character code (grouped 4-4, countdown to `expiresAt`); `409 already_linked` re-reads the state. The staff route that consumes the code is not called from this app |
| `EditProfileScreen` (phone) | `profileService.update` | `PATCH /me/account` | users (M8) | `users.phone` | ✅ **LIVE** (P-03) — the account's own contact detail, and the one field on this document a patient owns. `account.controller.ts` names patients as the audience: a `@Can(...)` there would deny people who hold zero capabilities by design (ADR-030 §6). The write re-reads `GET /me/profile` rather than patching its own copy, because `AccountView` carries neither `displayName` nor the clinical half |
| `EditProfileScreen` (clinical fields) | `profileService.update` | `PATCH /me/profile` | patients (ADR-030) | `patients` | 🔴 **RA-030.2** — not unbuilt but unspecifiable: the editable field set, the conflict rule, and whether an edit needs verification are all undecided. The adapter refuses these by name rather than sending them somewhere they cannot go |
| `EditProfileScreen` (email) | — | — | — | `users.email` | 🔴 **no flow** — `updateAccountSchema` excludes `email` on purpose: moving a sign-in address needs the new one verified and the old one notified, or a borrowed session walks off with the account. Read-only until that flow exists |
| `SecurityScreen` (device list) | `listSessions` | `GET /me/sessions` | auth (`account-security.controller.ts`) | `sessions` | ✅ **Live since M8** (P-06). Four fields of eight: `location` and `ipAddress` are on the wire and deliberately unparsed (T-04). `deviceLabel` is nullable — both source columns are — and the screen, not the adapter, names the absence (C-09) |
| `SecurityScreen` (revoke) | `revokeSession` | `DELETE /me/sessions/{id}` | auth (`account-security.controller.ts`) | `sessions` | ✅ **Live since M8** (P-06). Confirmed before it runs, and never offered for the current session — the screen withholds the control and the server owns the rule, so the adapter adds no second copy of it |
| `SecurityScreen` (change password) | `authService.changePassword` | `POST /me/password` | auth | `user_credentials` | ✅ **LIVE** — built (P-05); `api/endpoints/account.ts` |
| `PreferencesScreen` | `PreferenceStore` | — | — | — | ✅ frontend only |
| Sign out | `authService.logout` | `POST /auth/logout` | auth | `sessions` | ✅ **LIVE** |
| Profile photo | — | `PUT /me/profile/photo` | files (M25) | `files` | 🔴 **BE-15** — no affordance built |
| Data export, deactivation | `profileService.getPrivacyState` · `requestDataExport` · `requestDeactivation` | — (unspecified) | — | — | 🟡 **unspecified** — re-attributed from BE-10: M8 landed and shipped neither request, and §15.3 defines no row that covers them, so no `BE-nn` code is cited. `PrivacyScreen` is built over the fixture (P-09, P-10); all three methods refuse by name. The close request is never a delete: PHI is not hard-deleted (DB §7) |

---

## Onboarding, consent and support — the screens with no endpoint

Three screens read **configuration**, not an API, and they are here so the
register is complete rather than because they have a dependency. A-04's rule
cuts both ways: a screen that needs nothing from the backend should say so,
because "absent from the register" and "needs an endpoint nobody has built" are
the two states this document exists to keep apart.

| Screen | Source | Endpoint | State |
|---|---|---|---|
| `OnboardingScreen` | `PreferenceStore` (E-02) | — | ✅ frontend only. The carousel is skipped for ever once seen, which is a durable preference and not a record |
| `ConsentScreen` | `EXPO_PUBLIC_TERMS_URL` · `EXPO_PUBLIC_PRIVACY_URL` | — | ✅ frontend only. The documents are **operator-published URLs**, `https:` only and re-checked at the call site; unset is an honest state the screen renders in words (E-05, W-11). The accepted **version** is displayed and deliberately not sent — `POST /auth/register` has no field for one (BE-01) |
| `SupportScreen` | `EXPO_PUBLIC_SUPPORT_EMAIL` | — | ✅ frontend only. Opens the patient's mail app and nothing else; it is not a clinical channel and says so (W-11) |

---

## AI

**The screens exist. Nothing behind them does, and nothing is stubbed.**

Audit AD-4 and R-5 are unchanged: there is no model provider in this project, the
doctor-side assistant is a canned-response generator, and a patient-facing symptom
bot built on it would be the most dangerous thing this project could ship. Phase K
stays closed until a provider, a server-side red-flag classifier, an output filter
and a **named clinical owner** exist.

What changed on 2026-09-14 is that the interface was built ahead of them, so that
what is waiting on AD-4 is the clinical and backend work rather than a screen
nobody has drawn. The Endpoint column below is the point of this table: **every row
is `—`**. There is no `features/ai/service.ts`, no adapter behind `api/seam.ts` and
no module in `api/endpoints/` — a seam is a promise that something can be plugged
in, and nothing can be. `features/ai/ai-honesty.test.ts` fails on a `fetch`, an
`@/api/` import, a storage call, a client-side classifier, or a string long enough
to read as a scripted reply.

| Screen / component | Source | Endpoint | State |
|---|---|---|---|
| `AiHomeScreen` | `availability.ts` (**constant**) | — | 🟨 renders the unavailable state |
| `AiChatScreen` | — | — | 🟨 empty transcript, disabled composer. **No seeded greeting** |
| `AiSymptomsScreen` | `content/intake.ts` (**bundled**) | — | 🟨 the three-step form works; the result step is a placeholder |
| `AiImageScreen` | — | — | 🟨 picker disabled; EXIF and scan rules stated ahead of the code |
| `AiDisclaimer` (K-03) | catalogue | — | ✅ non-dismissible, outside the scroll, on all four screens |
| `AiSafetyCard` | catalogue | — | ✅ unconditional Emergency route; never dials |
| `AiUnavailableNotice` | `availability.ts` | — | ✅ names AD-4 / BE-14 (and BE-15 on the image screen) |
| `AiMessageBubble`, `AiTypingIndicator` | props | — | 🟨 drawn and tested; **no screen can produce their input** |
| `AiComposer` | props | — | 🟨 not editable; states the reason on screen |
| `AiResultPlaceholder` | props | — | ✅ says nothing read the input and nothing was sent |
| `AiImagePicker` | props | — | 🟨 four states tested; `empty` is the only one reachable |
| Assistant replies | — | **BE-14** | 🔴 no provider, no endpoint, no ADR |
| Red-flag classification | — | **BE-14** | 🔴 K-04 — **server-side by requirement**. Deliberately absent from this tree |
| Conversation history | — | **BE-14** | 🔴 K-07 — server-persisted. Local storage forbidden and asserted absent |
| Image upload / scan | — | **BE-15** | 🔴 no object storage, no scanner, no files service (M25) |
| Image findings | — | **BE-14 + L-04** | 🔴 needs a vision model and a named clinical owner's sign-off |
