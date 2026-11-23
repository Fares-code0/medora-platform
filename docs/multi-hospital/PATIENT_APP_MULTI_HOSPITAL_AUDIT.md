# Patient App (React Native + Expo) — Multi-Hospital Readiness Audit

## 1. Scope & baseline

- Tree: `patient-app/`. Paths are relative to the repo root; `src/` means `patient-app/src/`.
- Baseline commit: `ae63773` (`main`). Date: 2026-11-23.
- Method: read-only audit by subagents (no edits, no git, no installs, no test runs), verified by the lead engineer. About 130 files were read or grepped of 347 under `src/`. TanStack Query source in `node_modules` was read to confirm library behaviour.
- "Verified" means by code reading only. Nothing was run.
- Register: `docs/multi-hospital/CLIENTS_CHECKLIST.md` (PA-1 to PA-11).
- Context: Phase 22 backend is in shadow mode. PR #14 is merged. PR #15 (Database Phase 22 RLS design) is open and unmerged. Dependency issues #16 to #27 apply where cited.
- Locale files (`src/i18n/messages/en.ts`, `ar.ts`) were **not** modified and are not to be modified in this assignment.

### Technology versions (installed, matching `package.json`)

| Package                                                     | Version                      |
| ----------------------------------------------------------- | ---------------------------- |
| Expo SDK                                                    | `expo` 58.0.23               |
| React Native                                                | 0.88.1                       |
| React / react-dom                                           | 19.3.0                       |
| `@tanstack/react-query`                                     | 5.104.5 (declared `^5.62.0`) |
| `@react-navigation/native` / `native-stack` / `bottom-tabs` | 7.5.1 / 7.21.0 / 7.21.0      |
| `expo-secure-store` / `expo-local-authentication`           | 58.0.2 / 58.0.2              |
| `@react-native-async-storage/async-storage`                 | 2.2.0                        |
| TypeScript                                                  | `~6.0.3`                     |
| Jest / jest-expo                                            | `~29.7.0` / `~58.0.14`       |

- No `app.config.*`. `app.json`: `scheme: "medora"`, `android.allowBackup: false`, `USE_BIOMETRIC`, `NSFaceIDUsageDescription`.
- `build` is `expo export --platform android` (Metro bundle).

## 2. Current architecture

- **Provider order** (`src/bootstrap/App.tsx:152-175`): SafeArea, PreferenceGate, Locale, Theme, ErrorBoundary, QueryClient, Network, Session, LinkCapture/UpgradeGate, BiometricLockGate, Toast, Navigation. `PhiPrivacyShield` wraps the container while authenticated (`:132`).
- **Navigation** (`src/navigation/RootNavigator.tsx:60-117`) switches on session state, not routes. `booting` shows the splash. `unauthenticated` shows `AuthStack` (Welcome, Login, Register, Otp, Forgot/Reset, VerifyEmail, Consent, Emergency). `unconfirmed` shows `SessionCheckStack`. `authenticated` shows `AppTabs` (Home, Discover, Appointments, Messages, Profile) plus `Emergency` (modal) and `Booking` (fullScreenModal). Every PHI screen unmounts when the session ends.
- **Seam.** `selectService({fixture, http})` (`src/api/seam.ts`). Several domains have only an `unavailableService(...)` HTTP adapter (health, messages, clinic, AI).
- **API client** (`src/api/client.ts`). Fetch-based, 30 s timeout. Headers: `X-Client-Type: mobile`, `X-Correlation-Id`, optional `Idempotency-Key`, `Bearer` (`:231-242`). No hospital header or tenant claim. Access token in memory only.
- **Identity.** `AuthenticatedIdentity = {subjectId, displayName, email, emailVerified}` (`src/features/auth/model/types.ts:29-36`). The zod schema (`src/api/endpoints/auth.ts:58-67`) is non-strict, so extra backend fields are silently dropped. The audit found no `/auth/session` consumption in the patient app (grep: no hospital in session or auth types).
- **Storage.** Refresh token in expo-secure-store (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`, key `medora.refresh-token`, `src/features/auth/storage.ts:31`). Non-identifying session guard record. Preferences (theme, locale, onboarding, biometric opt-in) via AsyncStorage with a closed vocabulary. No drafts, chats or profile on disk.
- **Query cache** (`src/api/query-client.ts:82-106`). `staleTime` 30 s, `gcTime` 5 min, retry at most 2 and never for auth, forbidden or validation errors. No persister (asserted by `src/storage/phi-guard.test.ts:116`). Cleared by `clearPhiCache` (`:116-121`), which removes each `PHI_QUERY_DOMAINS` entry (`src/api/query-keys.ts:34-41`) and then calls `client.clear()`.

## 3. Existing functionality

- Sign-in before discovery (PA-1 done): `/patient/doctors*` and `/patient/specialties` are `@Authenticated()`, and the signed-out stack has no Discover.
- Live: `GET me/appointments`, `GET me/appointments/{id}` (`src/api/endpoints/appointments.ts:125,143`); `GET patient/doctors`, `/patient/doctors/{id}`, `/patient/specialties` (`src/api/endpoints/doctors.ts:269,288,296`); notifications (`notifications`, `badge-counts`, `read`, `unread`, `read-all`, `me/notification-preferences`; `src/api/endpoints/notifications.ts:130-184`); `me/profile` (`src/api/endpoints/profile.ts:96`).
- Not built (refuse with `unavailableService` or `EndpointNotImplementedError('ADR-033')`): booking writes, slots, health records (`src/features/health/service.ts:15-29`), messaging, AI (`src/features/ai/availability.ts:60-64`, `connected:false`), clinic/hospital profile (`src/features/clinic/service.ts:195`), `patient/departments`.
- Cache sweep, lock, biometrics, locale (en, ar) and RTL handling all exist and are tested (section 17).

## 4. Missing functionality

- No hospital, clinic or location on appointments, doctors, records, notifications or messages.
- No hospital directory (`/patient/hospitals`), compare, distance, insurance or reviews (PA-2 to PA-5).
- No slot listing or booking with `slotId` and idempotency (PA-6, PA-7).
- No per-hospital "My records" (PA-8). No patient AI hospital binding (PA-9).
- No hospital key in PHI query keys (PA-10 open half). No record claim (PA-11).
- No per-appointment time zone (only page-level `clinicTimezone`).
- No 403-code distinction in the client (see section 6).

## 5. Confirmed defects

One confirmed (D-PA-1, below); confirmed and fixed in this workstream, see section 18.

**D-PA-1. Optimistic rollback resurrects the previous account's notification feed after sign-out (confirmed by failing-first tests and fixed; section 18).**

- Reported path: `src/api/optimistic.ts` `restore()` calls `queryClient.setQueryData(key, data)` for each snapshot entry. In TanStack 5.104.5, `setQueryData` calls `queryCache.build(...)` and so can recreate a query that `clear()` removed (`query-core/build/modern/queryClient.js:192-200`). `MutationCache.clear()` only drops references (`mutationCache.js:126-136`), and an in-flight `Mutation.execute` still runs `onError` (`mutation.js:209`). The callbacks are on `useMutation` options (`src/features/notifications/screens/NotificationsScreen.tsx` `markRead`, `markUnread`, `markAllRead`; `NotificationPrefsScreen.tsx` `save`), so they survive unmount.
- Reported effect: A marks a notification read, the request is still pending when A signs out, then it fails (timeout, network, or a 401 returned as `cancelled`). `restore()` re-creates `['notifications','list',...]` with A's feed. If B signs in on the same device within `gcTime` (5 min) and opens Notifications, A's rows render until B's refetch replaces them. Offline, they can stay.
- No test covers it. `session-restore.test.tsx:1148-1186` checks the cache only right after the sweep. Treat as unconfirmed until reproduced.

## 6. Architectural risks

- **R-1.** The biometric-unlock opt-in is device-wide and survives sign-out (`src/features/auth/biometrics.ts:159-165`, `src/storage/preference-store.ts:44-57`). Account B inherits the opt-in (not the lock; `cold-start-lock.test.tsx:652`). A product decision, not a leak.
- **R-2.** A wall-clock correction can end a session without a backend rejection (`session-guard.ts:169`, `FUTURE_SKEW_TOLERANCE_MS = 60_000`, `:37`; forward jump leads to `reauthenticate`). Intended local policy, listed because it is outside the "only a server rejection ends the session" principle.
- **R-3.** Local-only session ends (T-11 `reauthenticate`, guard `invalid`, keychain refusal, logout from `unconfirmed`) delete the device token but do not revoke the server family. Revocation needs a backend route.
- **R-4.** In `endSessionNow`, `await tokenStorage.clear()` (`SessionProvider.tsx:234`) runs before `clearPhiCache` (`:240`). PHI stays in memory briefly. Small window, nothing on disk.
- **R-5.** Query keys have no account or hospital dimension. Isolation relies entirely on clearing at session end. Any future path that installs a session without `endSessionNow` (server-driven account switch, in-app hospital switch) would leak.
- **R-6.** Only `optimistic.ts` uses `setQueryData` on mutation error paths. Other mutations were not audited exhaustively.
- **R-7.** Comments cite test files that do not exist: `storage.test.ts` (`storage.ts:26-28`), `query-client.test.ts` (`query-keys.ts:31-32`), `errors.test.ts` (`src/types/api.ts:42-43`). Drift only.
- **R-8.** A 403 has no session effect and no code-level handling (`src/api/errors.ts:120`, `src/components/feedback/ErrorState.tsx:129-133`). When hospital authorization starts returning 403, the app shows a generic error state and cannot tell refusal kinds apart.
- **R-9.** Zod `z.object` strips unknown keys (`src/api/endpoints/appointments.ts:45-97`, `doctors.ts:209-229`). A new server `hospital` field is lost until the schema changes. This is the safe default, but it is also silent.
- **R-10.** `PatientSafeDoctor.hospital` is a single free-text string (`src/features/doctors/model/types.ts:542`). The HTTP adapter sets it to `null` deliberately (`src/features/doctors/http-doctor-service.ts:43-48,72`; asserted at `http-doctor-service.test.ts:253-255`). Do not infer it from `departmentName` or `officeLocation`.
- **R-11.** `ClinicService.getProfile()` takes no id (`src/features/clinic/service.ts`). `clinicKeys` have no hospital id, so caches would mix hospitals. `clinic.singleClinicNote` becomes false.
- **R-12.** Health records carry no origin field, and `BookingRequest` carries no hospital. The contract must define them. The client must not infer.
- **R-13.** Emergency must stay hospital-independent (section 11).

## 7. Single-hospital assumptions (exact file:line)

| File:line                                                                                                          | Assumption                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/clinic/model/types.ts:3-21`                                                                          | "one clinic, not a directory" (ADR-018/010); `ClinicProfile` has no id. Superseded by multi-hospital.                                                         |
| `src/features/clinic/service.ts:81-91, 114-121, 195`                                                               | `getProfile()` without id; fixture 'Medora Clinic', Amman address; HTTP is `unavailableService('BE-11')`                                                      |
| `src/features/clinic/screens/ClinicScreen.tsx:29,76-87,269`                                                        | no-id query keys; single-clinic note                                                                                                                          |
| `src/features/doctors/model/types.ts:538-542`                                                                      | `hospital: string \| null`, "v1 is single-clinic (ADR-018 §1)"                                                                                                |
| `src/features/doctors/screens/DoctorProfileScreen.tsx:178-190`                                                     | renders `hospital` and `officeLocation` as one free-text pair                                                                                                 |
| `src/features/doctors/fixtures/doctor-fixtures.ts:38-98`                                                           | fixtures hardcode 'Medora Clinic' (fixture/dev only)                                                                                                          |
| `src/features/appointments/model/types.ts:334-410, 454-460`                                                        | `Appointment`, `BookableSlot` and `BookingRequest {doctorId,slotId,startsAt,reason,notes}` have no hospital                                                   |
| `src/api/endpoints/appointments.ts:100` and `src/features/appointments/http-appointment-service.ts:126-128`        | one `clinicTimezone` per list page                                                                                                                            |
| `src/features/appointments/screens/AppointmentDetailScreen.tsx:100-102`, `components/AppointmentCard.tsx:42-44,57` | "clinic time" is an implicit single zone; the card's composite a11y label has no hospital                                                                     |
| `src/features/appointments/booking/BookingFlow.tsx:44-60`                                                          | steps doctor, date, time, reason, confirm; no hospital step; slots endpoint unbuilt                                                                           |
| `src/features/appointments/fixtures/appointment-fixtures.ts:232`                                                   | actor 'The clinic'                                                                                                                                            |
| `src/features/health/model/types.ts:43-178`                                                                        | no origin, hospital or issuer on any record type                                                                                                              |
| `src/features/profile/http-profile-service.ts:83`                                                                  | `CLINIC = 'Your clinic'` hardcoded `ownedBy` on the **production** path; also `profile/service.ts:41-56`. `linkedToClinicalRecord: boolean` is a single link. |
| `src/features/emergency/model/types.ts:200-219`                                                                    | `EmergencyConfiguration.clinic` single; copy "Your clinic" at `EmergencyScreen.tsx:55,124-150,162,193`; `EmergencyContacts.tsx:259`                           |
| `src/features/messages/service.ts:24`, `screens/MessagesScreen.tsx:78-79`                                          | 'Medora Clinic reception'; "call the clinic"                                                                                                                  |
| `src/features/notifications/service.ts:54`                                                                         | 'The clinic confirmed...' (fixture)                                                                                                                           |
| `src/features/support/screens/SupportScreen.tsx:100-110`                                                           | urgent notice, English                                                                                                                                        |
| `src/features/home/components/Announcements.tsx:50,61`                                                             | "From your clinic"; notes `/patient/hospitals/*` unbuilt                                                                                                      |
| `src/navigation/AppTabs.tsx`                                                                                       | `Clinic` route in `DiscoverStackParamList` has no id param                                                                                                    |
| `src/i18n/messages/en.ts:661-662` (`ar.ts:587-588`)                                                                | `clinic.singleClinicNote` states one clinic only (locale file; flag only)                                                                                     |
| `src/api/query-keys.ts:34-41`                                                                                      | no account or hospital dimension in keys                                                                                                                      |
| `src/features/doctors/recent.ts:43`                                                                                | recent doctors list is not hospital-scoped (memory only, cleared at session end)                                                                              |

## 8. Existing API contracts (usable now)

- `GET me/appointments` (query `upcoming`, `to`, `sort`, `page`) and `GET me/appointments/{id}`. Summary: `id, startsAt, durationMin, status, priority, reason, isNewPatient, isFollowUp, visitType, departmentName, doctor{id,fullName,title,specialty,photoUrl}`. The list adds page-level `clinicTimezone`. Detail adds `notes, cancelledReason, clinicTimezone, events[]`. **No hospital, clinic or location** (`backend/src/modules/appointments/dto/patient-appointment.dto.ts:36-82`).
- `GET patient/doctors` (`q`, `specialtyId`, `departmentId`, `page`), `GET patient/doctors/{id}`, `GET patient/specialties`. `PatientDoctorSummary` and `Detail` (`backend/src/modules/doctors/dto/patient-doctor.dto.ts:29-53`) have **no hospital**; the free-text `doctors.hospital` column is deliberately not projected (`:60-64`).
- `GET notifications`, `notifications/badge-counts`, `POST notifications/{id}/read`, `/unread`, `notifications/read-all`, `GET/PUT me/notification-preferences`. No hospital. Deep links resolve only `appointments/{id}` (`src/features/notifications/deep-link.ts:59-77`).
- `GET me/profile`. Auth: login, OTP, refresh, logout. These bodies carry no hospital data.
- `GET /auth/session` exists on the backend for any authenticated principal, but for a patient it returns `activeHospital: null` and `adminScope: null` (resolver gives `resource_required` for patients). It has nothing for the patient app to consume. The audit found no patient-app call to it.
- Error envelope `{message, code, fieldErrors?, detail?, ref?}`. No hospital-specific codes exist (`backend/src/common/errors/error-codes.ts`). The patient app's `normalizeHttpError` matches the envelope (`src/api/errors.ts:44-90`).

## 9. Missing API contracts (planned in `docs/multi-hospital/API_CONTRACT_CHANGES.md`; not implemented; shapes are recommendations)

- `GET /patient/hospitals`, `/patient/hospitals/:id`, `GET /patient/discovery/search` (PA-2).
- `GET /patient/doctors[/:id]` extended with hospital, clinic, location, `nextAvailableSlot`, rating and insurance; `GET /patient/doctors/:id/reviews` (PA-3 to PA-5).
- `GET /patient/doctors/:id/slots`, `POST /me/appointments` (with `slotId` and `Idempotency-Key`), cancel, reschedule, confirm (PA-6, PA-7). Planned errors: `slot_taken` (409), `insurance_not_covered` (422), `intent_expired`, `intent_used`, `idempotency_key_reused`, `appointment_action_not_allowed`, `patient_identity_required`. **None are shipped.**
- Hospital, clinic and location on appointment DTOs (PA-7); per-appointment time zone.
- `GET /me/medical-records` and per-hospital record DTOs with origin (PA-8).
- Patient AI authorization field (PA-9).
- `/me/appointment-intents*`. Record-claim method (PA-11, OQ-02, undecided).
- A hospital segment for caches follows from the DTOs above (PA-10).

## 10. Security considerations

- **Session-rejection rule (must not regress).** Only a genuine backend rejection ends the session and deletes the refresh token. The classifier is `src/features/auth/refresh-outcome.ts:46-48`: `isApiError(error) && error.kind === 'auth' && error.code === 'unauthorized'` (HTTP 401 with envelope code `unauthorized`; mapping at `src/api/errors.ts:62-63`). Everything else is "no answer" and the keychain token stays: network, timeout, cancelled, 5xx, 429, 403 (including a WAF 403), 400/422, 401 without a code or with another code or a non-JSON body, `ResponseContractError` (captive portal 200 HTML), and any non-ApiError. A keychain read failure never deletes anything. Consumers: cold start and retry (`SessionProvider.tsx:449-466`) and mid-session (`:643-654`). A non-rejection leaves the state `unconfirmed` (cold start) or rethrows the transport error (mid-session, `src/api/client.ts:306-311, 358-364`).
- **Locally decided ends (deliberate policy):** keychain write refused after rotation (`:338-341`); guard `corrupt` or `bg.at` more than 60 s in the future (`session-guard.ts:157-158,169`); T-11 `reauthenticate` (`session-guard.ts:170-172`); tombstone `ended` discard (`:548-551`); a refresh handler that throws a non-ApiError (`client.ts:359-364`, tested at `client.test.ts:599`). None comes from offline, timeout, 5xx or a temporary refresh failure. **Any hospital-related 403 or error code introduced later must be classified "no answer", never as a rejection.** Do not widen the classifier.
- 403 from hospital authorization must not end the session, and must not be retried (`src/api/query-client.ts:73`).
- Access token memory only; refresh token in secure store. Tokens carry no hospital claim, and the client sends no hospital id as an authorization mechanism.
- PHI cache: no persister, cleared at every session end (section 17). Held deep links are bound to `subjectId` (`src/navigation/link-resume.ts:38,130-137`). Android backup is off.
- Add hospital or account dimensions to PHI query keys only together with a clear or reset. Keys alone do not replace the sweep (R-5).
- Discovery caches must stay separate from PHI caches (PA-10); `doctors` is the only domain deliberately outside `PHI_QUERY_DOMAINS`.
- Distance and location (PA-4): request location permission in context, and do not store the position (OD-10).
- Logs stay redacted (T-04). Never log hospital ids with PHI. Monitoring breadcrumbs persist in memory across sign-out and are redacted (R-8 in the source report, low risk).

## 11. Emergency workflow independence

- `src/features/emergency/screens/EmergencyScreen.tsx` reads no session, profile or hospital. Header guarantees (`:14-37`): works signed out, offline, with no API dependency, two-step dial, never invents a number.
- Reachable from `AuthStack` (`src/navigation/AuthStack.tsx:117`), `RootNavigator` (modal, `:98-99`), `SessionCheckStack`, the header button (`EmergencyHeaderButton.tsx:347-366`), the Welcome card (`WelcomeScreen.tsx:58`), `SIGNED_OUT_ROUTES` (`link-resume.ts:55`) and the `emergency` link (`linking.ts:64`).
- Dialling uses `tel:` behind a `ConfirmSheet` naming the number (`dial.ts:44-59`, `EmergencyCallButton.tsx:423-496`). No auto-call, no location sharing, no clinic notification.
- Data: `emergencyService` returns `UNCONFIGURED_EMERGENCY` for both fixture and http (`src/features/emergency/service.ts:156-163`). `useEmergencyConfiguration` never throws (`:269-291`). `EmergencyNumber.region` is region-scoped, and thus already hospital-independent.
- `EmergencyContacts.tsx:249-256` is session-gated and additive: it returns null unless authenticated and renders nothing on failure.
- **Rules for multi-hospital work:** never gate Emergency on a hospital, session or records. Never key `EmergencyConfiguration` by hospital. Keep `EmergencyContacts` additive. The `onBook` path (`RootNavigator.tsx:38`) navigates to Booking with `{}`, so it must not become hospital-dependent. A hospital-specific emergency line may only be added as an optional extra.
- Tests proving independence: `emergency.test.tsx` mounts with **no providers**; also `emergency-configured.test.tsx`, `emergency-contacts.test.tsx`, `dial.test.ts`, `navigation.test.tsx`, link-guard and link-resume tests.

## 12. Accessibility & RTL

- Helpers (`src/features/accessibility/a11y.ts`): `pressableA11y` (label required), `headingA11y`, `decorative`, `announce` (`AccessibilityInfo.announceForAccessibility`), `focusOn`, `labelWithHint`; `useAnnounceOnChange`, `useReducedMotion`. Live regions: `ErrorState.tsx:218`, `EmergencyCallButton.tsx:461`. `announce()` callers: booking, toast, paged list (`PagedList.tsx:175`).
- Touch target minimum is 44 (`src/theme/spacing.ts:70`; `Button.tsx:102,140`; `Chip.tsx` hitSlop 48).
- Audits and enforcement: `docs/A11Y_AUDIT.md`, `src/test/a11y-audit.test.ts`, `src/test/screen-headings.test.tsx`.
- New hospital names on cards go through `pressableA11y` and `headingA11y`. `AppointmentCard.tsx:42-44` builds its composite label from when and specialty. Adding the hospital needs an i18n template change (outside this assignment's locale freeze).
- RTL: locales `en` and `ar` only (`src/i18n/locales.ts:13`). `LocaleProvider.tsx:81-82` uses `I18nManager.allowRTL/forceRTL`; a change needs a restart (`:124`). `Icon.tsx:136` mirrors directional glyphs. Tests: `accessibility/rtl.test.tsx`, `i18n.test.tsx`, `raw-key-leak.test.tsx`.
- Hospital names are mixed-direction content (Arabic and Latin names, addresses, phone numbers). Add an isolation strategy before rendering names inside translated sentences. Do not assume the `ar` locale implies Arabic names.
- Keyboard, switch and screen-reader coverage of a future hospital compare view (PA-4) is untested.

## 13. Localization gaps (to be tracked separately; locale files not modified in this assignment)

- No `hospital.*`, `facility.*` or `location.*` keys exist. The only hospital-related key is `clinic.singleClinicNote` (`en.ts:661-662`, `ar.ts:587-588`), which becomes false under multi-hospital.
- Clinic-centric keys for later review: `nav.title.clinic` (`en.ts:361`), `discover.clinicCard.*` (`:613-614`), `clinic.*` (`:643-662`), `appointment.clinicTime` (`:704`), `appointment.status.pending` "Awaiting clinic" (`:681`), `booking.*` (`:741-763`), `messages.empty.body` (`:770`), `thread.closed.body` (`:783`), `health.*` including "kept by your clinic" (`:798-886`), `onboarding.slide.clinic.*` (`:423-425`), `home.announcements.title` "From your clinic" (`:403`), `state.error.*` "could not reach the clinic" (`:69-94`), `privacy.*` (`:539-555`), `auth.welcome.tagline` (`:194`).
- English-only literals outside the locale files: Emergency screen and contacts (`EmergencyScreen.tsx:55,125,134,162,193`, `EmergencyContacts.tsx:259`, `content/guidance.ts:89-94`; deliberate no-inline-copy exemption, owner decision W-10); Support urgent notice (`SupportScreen.tsx:100-110`); Messages urgent copy (`MessagesScreen.tsx:78-79`); profile `CLINIC = 'Your clinic'` (`http-profile-service.ts:83`); fixture strings (`messages/service.ts:24`, `notifications/service.ts:54`, `appointment-fixtures.ts:232`).
- Any multi-hospital copy needs new keys in both `en.ts` and `ar.ts` (`ar.ts` is typechecked against `en.ts`). `i18n/no-inline-copy.test.ts` forbids bare English in rendering files outside the allow-list, so a new screen cannot work around the freeze with literals.
- Only two locales exist in the patient app, while the web app has five.

## 14. Required tests

1. Session-rejection regression suite stays green and is extended: a hospital-related 403 (with and without a code), a hospital-specific 4xx and a 5xx during refresh all leave the token in the keychain. Existing guards: `src/features/auth/refresh-outcome.test.ts` (`isSessionRejection` and the `it.each` no-answer cases at `:32-45`), `session-restore.test.tsx` (`:144`, `:211-236`, `:238`, `:363`, `:401`, `:462`, `:480`, `:542`, `:1085`, `:1189`, sign-out races `:624-731`), `src/api/client.test.ts` (`401 handling`, `:304-609`), `src/api/refresh-endpoint.test.ts:33`, `session.test.tsx:157`.
2. D-PA-1 (once verified): optimistic mutation pending, then `clearPhiCache`, then mutation rejects, and the cache stays empty. Add to `src/api/optimistic.test.ts`.
3. Cross-account test: sign in A, populate PHI domains and recent doctors, sign out, sign in B, and assert the cache, recent doctors and held link are empty.
4. Schema tests: appointment and doctor schemas accept a new hospital object and expose it; an unknown shape fails closed (no silent null in a safety display).
5. Hospital label on `AppointmentCard`, detail and doctor profile: accessible name includes the hospital; RTL; no hospital inferred from `departmentName` or `officeLocation`.
6. Per-appointment time zone formatting across two hospitals in one list.
7. Emergency independence: add a test that Emergency mounts and dials with no hospital data and no session, and that `EmergencyConfiguration` is not keyed by hospital. The existing no-provider test must stay green.
8. Query-key test: hospital and account dimensions in PHI keys, and `phi-guard.test.ts` still lists every clinical domain in `PHI_QUERY_DOMAINS`.
9. 403 handling: the hospital refusal state renders and the session survives.
10. Booking: 409 `slot_taken` recovery, 422 coverage message for insured patients, and uninsured patients see everything (PA-5, PA-7), written when the contract exists.
11. Update `src/test/projections.test.ts` (forbidden fields; line 52 lists 'hospital') when the projection changes.
12. Fixtures and tests that embed 'Medora Clinic' and 'Medora Central' (`doctor-profile.test.tsx:40`, `clinic-screen.test.tsx`) need hospital-bearing fixtures.

## 15. Work classification

| Task                                                                                                | Category                                    | Dependencies                                                   | CLIENTS_CHECKLIST row |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------- | --------------------- |
| Fix optimistic rollback resurrecting cache after clear (only if verified)                           | Implement now (after lead verification)     | verification of D-PA-1                                         | PA-10 (account half)  |
| Cross-account regression test (A to B) and stale test-file comment fixes (R-7)                      | Implement now (test and comments only)      | none                                                           | PA-10                 |
| Schema readiness: allow an optional hospital object in appointment and doctor schemas, still unused | Prepare-not-activate                        | contract shape from backend                                    | PA-7, PA-3            |
| Neutral wording for the production `CLINIC = 'Your clinic'` in profile `ownedBy`                    | Prepare-not-activate                        | locale freeze (tracked separately)                             | PA-8                  |
| Keep Emergency independence tests; add the listed assertions                                        | Implement now (tests only)                  | none                                                           | PA-1 (adjacent)       |
| Hospital search and profile with locations                                                          | Blocked-Backend                             | `/patient/hospitals*`, #27                                     | PA-2                  |
| Doctor search with one active hospital                                                              | Blocked-Backend                             | extended `/patient/doctors`                                    | PA-3                  |
| Compare, distance, ratings                                                                          | Blocked-Backend and Blocked-Product-Owner   | discovery contract; OD-10 UX                                   | PA-4                  |
| Insurance-aware results                                                                             | Blocked-Backend                             | coverage contract                                              | PA-5                  |
| Published slots, booking with `slotId` and idempotency, 409 and 422 recovery                        | Blocked-Backend                             | ADR-033, `/patient/doctors/:id/slots`, `POST /me/appointments` | PA-6, PA-7            |
| Hospital, clinic, location and zone on each appointment                                             | Blocked-Backend                             | DTO change                                                     | PA-7                  |
| My records, one record per hospital, hospital named on every clinical screen                        | Blocked-Backend                             | `GET /me/medical-records`, BE-09                               | PA-8                  |
| Hospital record key in PHI caches                                                                   | Prepare-not-activate                        | per-hospital record API                                        | PA-10                 |
| Patient AI with hospital isolation                                                                  | Blocked-Backend                             | AD-4, BE-14, Phase 28                                          | PA-9                  |
| Record claim                                                                                        | Blocked-Product-Owner                       | OQ-02 / RA-030.1                                               | PA-11                 |
| Revoke-by-refresh-token on local session ends                                                       | Blocked-Backend                             | new revoke route                                               | PA-10 (R-3)           |
| Reset biometric opt-in on sign-out                                                                  | Blocked-Product-Owner                       | product decision R-1                                           | none                  |
| Rules a patient-facing cache can rely on (RLS and tenant context)                                   | Blocked-Database                            | #19, #20, #21, PR #15                                          | PA-8, PA-10           |
| Locale keys for hospital copy (en and ar)                                                           | Blocked-Product-Owner (separate assignment) | locale freeze lifted                                           | PA-2 to PA-8          |

## 16. Product decisions required

1. Does a patient ever act inside a "current hospital", or is hospital always derived from the doctor, slot or record? This decides whether any switching UI exists (and whether R-5 matters).
2. Booking: is the hospital derived from the doctor and slot only, or sent by the client? (The API doc says a mismatched client `hospitalId` is rejected. `BookingRequest` must not carry an unvalidated hospital.)
3. What an insured patient sees when coverage is unknown, and the exact uninsured behaviour (OD-14: unrestricted).
4. The Emergency configuration: region-only, or optional per-hospital extras? Stay hospital-independent for the core.
5. Whether Emergency, Support and Messages urgent English-only copy (W-10) gets Arabic.
6. Biometric opt-in on account change (R-1).
7. Record claim method (OQ-02).
8. Whether `clinic.singleClinicNote` and the "Clinic" navigation naming are replaced now or with PA-2.
9. Hospital name display rules for mixed Arabic and Latin names.

## 17. Recommended implementation order

1. The lead verifies D-PA-1. If confirmed, fix `src/api/optimistic.ts` to write only to queries that still exist (or guard by session epoch), with the regression test.
2. Add the cross-account and Emergency-independence tests, and correct the stale comment references (R-7). No behaviour change.
3. Add 403-aware but session-safe error handling when the backend defines hospital refusal codes. Do not touch the classifier.
4. Prepare the hospital-bearing schemas, fixtures and cache-key structure behind inactive code paths, once the backend contract (PA-7, PA-8) is published.
5. Locale keys in a separate assignment, then PA-2 to PA-5 (discovery), then PA-6 and PA-7 (booking), then PA-8 (records) and PA-10 (hospital key). PA-9 and PA-11 last.
6. Re-run the quality gate (`npm --prefix patient-app run typecheck && ... lint && ... test && ... build`). `backend/prisma/schema/01-enums.prisma` and `backend/src/modules/auth/dto/` changes also run this suite through `src/test/parity.test.ts`.

### Existing session and cache tests (reference)

- Auth: `features/auth/{refresh-outcome,session-restore(1221 lines),session,cold-start-lock,session-guard,biometrics,signed-out-notice,two-factor,http-auth-service,lock-policy}`, `dev/demo-restore`.
- API: `api/{client,refresh-endpoint,optimistic}.test`.
- Storage: `storage/phi-guard.test.ts`, `durable-preference-store.test.ts`, `platform-storage.test.ts`; `test/security.test.ts`, `test/store-privacy.test.ts`.
- Other: `features/doctors/recent.test.ts`, `navigation/link-resume.test.tsx`, `link-guard.test.ts`, `navigation.test.tsx`.
- Jest setup: `jest-expo` preset, `src/test/setup.ts` mocks secure-store, AsyncStorage, local-auth, font, NetInfo, AccessibilityInfo. `test/render.tsx` provides `renderWithProviders`.

## 18. Outcome of this workstream (2026-11-23)

- **D-PA-1 confirmed and fixed** (issue #45). Reading `@tanstack/query-core` 5.104.5 confirmed the path: `QueryClient.clear()` drops the mutation from the cache but does not cancel it; `Mutation.execute()` still runs `onError`; `setQueryData` builds a missing query. Failing-first tests reproduced both effects: the cleared notifications query came back with account A's data, and account B's query under the same key was overwritten with A's list. `src/api/optimistic.ts` now snapshots the `Query` instances and restores only into the instance that is still in the cache. The normal-case rollback is unchanged. `onSettled`'s invalidation after a clear is harmless: it matches nothing, or refetches B's own query with B's token.
- **Cross-account regression test added** (`src/features/auth/account-switch.test.tsx`). It uses the real `SessionProvider`, `createQueryClient()` and the link coordinator: after A signs out and B signs in, no cache entry holds A's data, recent doctors is empty and no held link survives. No new leak found.
- **Emergency independence (issue #46): no change needed.** `emergency.test.tsx` mounts the screen with no session, network or API; `emergency-configured.test.tsx` proves the call action is offered and dials `tel:` after confirmation with no session. Nothing in `src` provides a hospital context.
- **Session-rejection rule unchanged.** The classifier was not touched; `refresh-outcome`, `session-restore`, `client`, `refresh-endpoint` and `session` suites pass unchanged.
- **Follow-up found, not changed:** a rollback after sign-out still calls `onRollback`, so a generic "couldn't mark read" toast (no PHI) can appear on the login screen or in the next account's session. Recorded on issue #45.

Issues: tracker #29; patient app #40–#48; shared localization #49. Dependencies: #16–#27, PR #15.
