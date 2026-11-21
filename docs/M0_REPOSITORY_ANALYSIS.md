# M0.1 — Repository Analysis

**Milestone:** M0.1 of `backend/docs/BACKEND_IMPLEMENTATION_ROADMAP.md`
**Repository:** `Fares-code0/smart-healthcare-assistant-system` @ `02d5e50`
**Analysed:** 2026-08-12
**Status:** **PASS** — see §10. All contract-bearing frontend files were read, mapped, and cross-verified against the API contract. Two further checks concerning the *built* database are blocked for want of a schema dump; they belong to M4/M5 and are recorded in §10.1 because they block M0.2.

**Scope note.** This is analysis only. No backend code was written, no packages were installed, and no frontend file was modified. Where documents contradict each other, the contradiction is recorded in §11 and left unresolved for M0.2 (`docs/DECISIONS.md`).

**Sources treated as authoritative, per instruction:**

| Document | Authority |
|---|---|
| `backend/docs/BACKEND_API_CONTRACT.md` | The API contract |
| `backend/docs/PROJECT_BACKEND_MASTER_GUIDE.md` | Backend context / source of truth |
| `backend/docs/BACKEND_IMPLEMENTATION_ROADMAP.md` | Implementation order |
| `frontend/DATABASE_SCHEMA_EXTRACTION.md` | Database source of truth |

Cited below as **API §…**, **MG §…**, **RM M…**, **DB §…**. Frontend source is cited by path.

---

## 1. Repository understanding

### 1.1 What the repository is

A **monorepo** with one implemented workspace.

```
smart-healthcare-assistant-system/
├── frontend/          React 18 + TypeScript SPA — 569 tracked files, ~52k LOC in src/
│   ├── src/           13 feature modules across two role shells
│   └── *.md           24 documents, incl. DATABASE_SCHEMA_EXTRACTION.md (130 KB)
├── backend/docs/      Specification set. No code.
├── docs/              Backend working documents (this file).
└── .github/workflows/ One CI job, scoped to frontend/
```

The database exists outside this repository and has not yet been connected to anything.

### 1.2 Frontend architecture the backend must serve

**Two shells, one application.** `Role = 'doctor' | 'admin'` selects the route tree (`frontend/src/app/router/`). Doctors get `/doctor/*` with eleven feature modules; admins get `/admin/*`. Guards (`RequireAuth`, `RequireRole`, `RequirePermission`, `RequireGuest`) are declared to be **UX only** — `FRONTEND_ARCHITECTURE.md` §5.2 states verbatim that the server re-enforces every rule on every request. The backend cannot assume any client-side check happened.

**Uniform feature anatomy** (`FRONTEND_ARCHITECTURE.md` §3.4). Every feature folder contains `index.ts` (public API), `routes.tsx`, `pages/`, `components/`, `api/` (TanStack Query hooks over mock stores), `model/` (`types.ts` = DTO mirrors, `mock-data.ts`, `selectors.ts`, `filters.ts`). The header of each `model/types.ts` states the shape "mirrors the future DTOs so API integration swaps the data source without touching components."

**This is the actual contract.** MG §4 and §18.5 both say so, and it is the operative fact for the backend: `features/**/model/types.ts` field names and unions are law. A rename forces churn across nineteen delivered phases.

### 1.3 How the backend replaces the mocks

The seam is deliberate and already built. `ApiClient` (`frontend/src/api/client.ts`) is the only transport; features consume it through their own `api/` hooks; components never call it. Today every hook resolves against in-memory `Map` stores and `localStorage` instead.

```
Component → feature api/use*Query.ts → [ SEAM ] → mock store          (today)
Component → feature api/use*Query.ts → [ SEAM ] → src/api/endpoints/  (target)
                                                        ↓
                                                  ApiClient → HTTP → backend
```

`frontend/src/api/endpoints/` contains only `.gitkeep`. The env flag that selects the path, `VITE_ENABLE_MOCKS`, is parsed in `configs/env.ts` and **read nowhere that matters** — the swap mechanism is specified but not wired. That work is RM M39–M40 and is frontend-side.

Three things the backend must therefore provide exactly, not approximately:

1. **The envelope** — `{ data: … }`, `Paginated<T>`, and the `ApiError` union in `frontend/src/types/api/index.ts`. `normalizeHttpError` maps status codes to that union with no negotiation.
2. **The field names** — camelCase, verbatim from the model types (`dateTime`, `durationMin`, `hasSevereAllergy`, `refillsRemaining`).
3. **The enum literals** — the exact string unions, inventoried at DB §6.

### 1.4 State conventions that constrain endpoint design

From `FRONTEND_ARCHITECTURE.md` §10.3 and MG §5.3:

- List state (filters, sort, page, tabs) mirrors URL search params. **Server list endpoints must accept exactly those params** — they are the cache key.
- `staleTime` 30 s default; volatile surfaces (badges, action queue, presence) poll at **10–15 s**. Count endpoints must be O(1)-cheap.
- Optimistic updates only where the UX specs rollback (appointment accept/reject, mark-read, message send). **Prohibited** on prescriptions, critical-lab review, and permission changes — those are pessimistic and blocking, which means the server response is the source of truth and a failure must be visible.
- Query cache is memory-only and fully cleared on logout/lock. PHI must not survive a session.

---

## 2. Feature → API mapping

Every row was confirmed by opening the files. Paths are relative to `frontend/src/`.

| # | Feature | Location | Model / types | API hooks | API contract | Backend module |
|---|---|---|---|---|---|---|
| 1 | **Auth** | `features/auth/` | `mock/types.ts` (`MockAuthErrorCode`, `MockUserRecord`, `RegisterInput`, `LoginResult`), `types/auth/index.ts` (`Role`, `Permission`, `SessionUser`, `AuthStatus`) | `mock/mock-auth-service.ts` (11 functions — not Query hooks) | **§1** | `auth` |
| 2 | **Patient identity** | `features/shared-domain/patient-identity/` | `types.ts` (`Patient`, `PatientStatus`, `RiskLevel`, `Gender`, `BloodType`), `roster.ts` (5 canonical patients) | — (consumed by others) | **§4** | `patients` |
| 3 | **Patients** | `features/doctor/patients/` | `model/profile-types.ts` (`PatientProfileBundle`, `VitalSigns`, `AllergyRecord`, `MedicationRecord`, `MedicalHistoryEvent`, `StudyRecord`, `AppointmentRecord`, `ClinicalNote`, `PatientDocument`, `EmergencyContact`, `InsuranceInfo`, `ClinicalAlert`) | `api/usePatientsQuery.ts`, `api/usePatientProfileQuery.ts` | **§4** | `patients` |
| 4 | **Appointments** | `features/doctor/appointments/` | `model/types.ts` (`Appointment`, `AppointmentStatus`, `AppointmentPriority`, `AppointmentAction`, `AppointmentPatientSnapshot`) | `api/useAppointmentsQuery.ts` | **§5** | `appointments` |
| 5 | **Medical records** | `features/doctor/medical-records/` | `model/types.ts` (`MedicalRecord` + 9 child types, `RecordTimelineKind`, `DiagnosisConcept`) | `api/useMedicalRecordsQuery.ts` | **§6** | `medical-records` |
| 6 | **Pharmacy** | `features/doctor/pharmacy/` | `model/types.ts` (`Prescription`, `Medication`, `SafetyWarning`, `PrescriptionTimelineKind`, `RefillStatus`) | `api/usePrescriptionsQuery.ts` | **§7** | `pharmacy` |
| 7 | **Laboratory** | `features/doctor/labs/` | `model/types.ts` (`LabTest`, `LabResultItem`, `LabSpecimen`, `LabReferenceRange`, `LabTimelineKind`, `LabResultFlag`) | `api/useLabTestsQuery.ts` | **§8** | `labs` |
| 8 | **Messaging** | `features/doctor/messaging/` | `model/types.ts` (`Conversation`, `ChatMessage`, `Contact`, `MessagingFolder`, `MessageStatus`, `SharedLink`) | `api/useMessagingQueries.ts` | **§9** | `messaging` |
| 9 | **Notifications** | `features/doctor/notifications/` | `model/types.ts` (`DoctorNotification`, `NotificationPreferences`, `NotificationBadgeCounts`, `NotificationRelated`, `Conversation`, `ChatMessage`) | `api/useNotificationsQuery.ts` | **§10** (+ §16 badges) | `notifications` |
| 10 | **AI assistant** | `features/doctor/ai/` | `model/types.ts` (`AiConversation`, `ChatMessage`, `AiConversationContext`, `AiSettings`, `AiContextMode`) | `api/useAiQueries.ts` | **§11** | `ai` |
| 11 | **Reports** | `features/doctor/reports/` | `model/types.ts` (`AnalyticsSnapshot`, `CategoryView`, `ReportFilters`, `Insight`, `SavedReport`, `ScheduledReport`, `ScheduleRun`) | `api/useReportsQueries.ts` | **§12** | `reports` |
| 12 | **Settings** | `features/doctor/settings/` | `model/types.ts` (`SettingsDocument`, `AccountSettings`, `SecuritySettings`, `ActiveSession`, `TrustedDevice`, `LoginEvent`, `PrivacySettings`, `WorkflowPreferences`, `IntegrationState`, `ActivityEntry`) | `api/useSettingsQueries.ts` | **§13**, **§2**, **§3** | `settings`, `users`, `doctors` |
| 13 | **Dashboard** | `features/doctor/dashboard/` | `model/mock-data.ts` — **no `types.ts`** | **none** | **§16.2–16.3** | `dashboard` |
| 14 | **Clinic administration** | `features/admin/` | `administration.types.ts` (`StaffMember`, `Department`, `Room`, `Resource`, `WorkingDay`, `Holiday`, `ShiftAssignment`, `QueueEntry`, `WaitingPatient`, `Announcement`, `Policy`, `DocumentTemplate`, `ClinicOverview`, `PlatformStatus`, `AuditEvent`, `SearchResult`) | `administration.queries.ts` over `administration.api.ts` | **§18** | `administration` |
| 15 | **Platform settings** | `features/admin/` | `admin-settings.types.ts` (`AdminSettingsDocument`, 11 slice interfaces, `PlatformUser`, `ApiKey`, `IntegrationSetting`, `BackupEntry`) | `admin-settings.queries.ts` over `admin-settings.api.ts` | **§19**, **§15** | `platform-settings`, `roles` |
| 16 | **PHI governance** | `features/admin/phi/` | `administration.types.ts` (`PhiAccessEvent`, `PhiJustificationCategory`), `utils/phi-mask.ts` | `administration.api.ts` → `phiAccess.list/record` | **§4.9**, **§14** | `patients` (reveal), `audit` |
| 17 | **Appointment oversight** | `features/admin/appointments/` | `oversight.types.ts` | `oversight.queries.ts` over `oversight.api.ts` | **§5.10** | `appointments` |
| 18 | **Global search** | `features/admin/useAdminSearchIndex.ts`, doctor navbar | `administration.types.ts` (`SearchResult`) | client-side index | **§16.1** | `search` |

### 2.1 Appendix A reconciliation (line by line)

API contract Appendix A lists fifteen swap points. Each was resolved against the tree:

| Appendix A entry | Result |
|---|---|
| `features/auth/mock/mock-auth-service.ts` + `session-store.ts` | ✅ exists |
| `features/doctor/appointments/api/useAppointmentsQuery.ts` | ✅ |
| `features/doctor/patients/api/usePatientsQuery.ts`, `usePatientProfileQuery.ts` | ✅ |
| `features/doctor/medical-records/api/useMedicalRecordsQuery.ts` | ✅ |
| `features/doctor/labs/api/useLabTestsQuery.ts` | ✅ |
| `features/doctor/pharmacy/api/usePrescriptionsQuery.ts` | ✅ |
| `features/doctor/messaging/api/useMessagingQueries.ts` | ✅ |
| `features/doctor/notifications/api/useNotificationsQuery.ts` + `ShellBadgesProvider` | ✅ |
| `features/doctor/ai/api/useAiQueries.ts` | ✅ |
| `features/doctor/reports/api/useReportsQueries.ts` | ✅ |
| `features/doctor/settings/api/useSettingsQueries.ts` | ✅ |
| `features/doctor/administration/administration.queries.ts` | ❌ **moved** → `features/admin/administration.queries.ts` |
| `features/doctor/administration/admin-settings.queries.ts` | ❌ **moved** → `features/admin/admin-settings.queries.ts` |
| `app/providers/DoctorProfileProvider.tsx` / `admin-profile.ts` | ✅ (`features/admin/admin-profile.ts`) |
| `features/doctor/dashboard/model/mock-data.ts` | ✅ |

Thirteen of fifteen resolve. The two failures are the administration rename (frontend checklist D-28). Recorded as ambiguity **A-10**; the contract patch is RM M0.4.

### 2.2 Seams that exist in code but not in Appendix A

Three surfaces have shipped since the contract was written and have no Appendix A entry:

- `features/admin/appointments/oversight.queries.ts` — ADM-05 appointment oversight, consumes API §5.10
- `features/admin/phi/` + `administration.api.ts → phiAccess` — ADM-10 PHI masking and reveal, consumes API §4.9 and §14
- `features/admin/sections/settings/PermissionMatrixPanel.tsx` — ADM-09 permission matrix, consumes API §15.2–15.3

These are live consumers with real behaviour to match (see §4.6).

---

## 3. Authentication contract

Transcribed from API §1, MG §5.2/§7.1/§11, `FRONTEND_ARCHITECTURE.md` §6, and the coded mock. Where the mock and the contract diverge, both are stated.

### 3.1 Registration — `POST /auth/register`

Body mirrors `features/auth/schemas/signup.ts` and `RegisterInput`: `firstName` (1–60), `lastName` (1–60), `email` (RFC), `phone` (`/^\+?[0-9][0-9\s-]{6,18}$/`), `password` (≥8 with upper + lower + digit + symbol), `confirmPassword` (client-checked, server ignores), `role` (`doctor|admin`), `licenseNumber?` (≤40), `acceptTerms: true`, `acceptPrivacy: true`.

- Success **201** → `{ data: { nextStep: "verify-email", email } }`
- Existing email → **409 `email_taken`**
- Policy violation → **422 `weak_password`**
- Side effect: verification email with a single-use token, TTL 24 h. Consent timestamps stored.

### 3.2 Login — `POST /auth/login`

Body `{ email, password, rememberMe: false }`.

| Condition | Response |
|---|---|
| Unknown email **or** bad password | **401 `invalid_credentials`** — identical timing and shape, no enumeration |
| `emailVerified = false` | **403 `email_unverified`** |
| Failures ≥ `loginAttemptLimit` | **429 `rate_limited`** + `Retry-After` |
| 2FA enabled | **200** `{ data: { requiresOtp: true, otpToken } }` — **no session issued** |
| Success | **200** `{ data: { user: SessionUser, accessToken, expiresIn: 900 } }` + `Set-Cookie: medora_rt=…` |

Every attempt writes a `login_events` row (device, IP, approximate location, result, failureCode, anomaly flags). `singleSessionPerUser` policy revokes other sessions when set.

### 3.3 Email verification

- `POST /auth/verify-email` `{ token }` → **204**, or **422 `token_invalid`**
- `POST /auth/verification/resend` — rate-limited
- Login is blocked until verified (§3.2)

### 3.4 OTP / 2FA

**Step-up at login:** `POST /auth/otp/verify` `{ otpToken, code }` where `code` matches `/^\d{6}$/`. Wrong code → **401 `otp_invalid`**; bounded attempts → **429 `rate_limited`**. Success returns the same payload as a successful login. `POST /auth/otp/resend` is rate-limited (the client renders a countdown).

**Enrolment** (API §2.9): `POST /me/2fa/setup` → `{ otpauthUrl, secret, recoveryCodes }`; `POST /me/2fa/enable` `{ code }`; `POST /me/2fa/disable` `{ password }`. TOTP secret encrypted at rest, recovery codes encrypted (DB §10).

Enforced per role when `twoFactorRequired` is set in the security policy slice.

### 3.5 Access token

- JWT, **≤ 15 minutes**, claims `sub` / `role` / `permissions` / `sid` (MG §11.1)
- Transported as `Authorization: Bearer`, injected by `ApiClient`
- **Memory only** on the client — never `localStorage` or `sessionStorage` (`FRONTEND_ARCHITECTURE.md` §6.2, an explicit XSS control)
- Permissions are baked into the token and are **static for the session**; changes apply at next issue

### 3.6 Refresh token

- **Opaque**, rotating, hashed at rest, family-revocation on reuse detection
- Cookie `medora_rt`; `httpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`
- TTL: `rememberMe` → 30 days, otherwise 12 hours, **sliding**
- `POST /auth/refresh` is cookie-only; returns `{ user, accessToken, expiresIn }`; invalid/expired → **401** and the client hard-logs-out
- Mobile variant: with `X-Client-Type: mobile` the refresh token travels in the body instead of a cookie (MG §15.2)
- Reuse of a rotated token revokes the entire session family

### 3.7 Logout — `POST /auth/logout`

Revokes the session server-side and clears the cookie. The client then clears the in-memory token, **clears the entire TanStack Query cache** (PHI must not survive logout), clears per-user UI preferences, and redirects to `/login`. BroadcastChannel syncs the logout across tabs.

### 3.8 Password flows

| Flow | Contract |
|---|---|
| Forgot — `POST /auth/forgot-password` | **Always 202** `{ accepted: true }` regardless of whether the email exists (anti-enumeration) |
| Reset — `POST /auth/reset-password` | `{ token, password }`; expired/used/unknown → **422 `token_invalid`**; policy violation → **422 `weak_password`**; success **204**, revokes all sessions, writes a `password` activity row |
| Change — `POST /me/password` | `{ currentPassword, newPassword }`; current must match, new must differ and satisfy policy; revokes other sessions [RECOMMENDATION, API §2] |

Policy is `≥8 with upper + lower + digit + symbol` (`utils/password.ts`), with expiry per `passwordExpiryDays` and a reuse-history check marked [RECOMMENDATION] (MG §11.2).

### 3.9 Session lifecycle

| Event | Behaviour |
|---|---|
| Boot | Silent `POST /auth/refresh` rehydrates the access token; router shows a splash until it resolves |
| Any 401 | **One** single-flight refresh, then replay the request once; concurrent 401s share the promise |
| Refresh failure | Hard logout with full cache clear, `returnTo` preserved |
| Idle ≥ 10 min (configurable via `sessionTimeoutMinutes`) | Client-side lock: blur overlay + re-auth dialog, 60 s warning |
| Absolute timeout | Forced logout, "Session ended" notice |
| Admin revokes session | Same cache-clearing logout on next refresh |

`GET /auth/session` returns the current `SessionUser`. Active-session management is API §2.4–2.5.

### 3.10 Error code vocabulary

Eight codes, from `frontend/src/features/auth/mock/types.ts` and API §1:

`invalid_credentials` · `email_unverified` · `otp_required` · `otp_invalid` · `email_taken` · `token_invalid` · `weak_password` · `rate_limited`

The auth pages branch on these (`LoginPage.tsx:46-56`, `VerifyOtpPage.tsx`). **They currently arrive via `MockAuthError`, a class only the mock throws** — see ambiguity **A-04**, which is the highest-severity finding in this report.

---

## 4. Authorization model

### 4.1 Roles

`Role = 'doctor' | 'admin'` (`frontend/src/types/auth/index.ts`) selects the route tree and shell.

Wider vocabularies already exist in data and must be reconciled in one `roles` table (DB §A1):

- `PlatformRole` — admin, doctor, reception, laboratory, pharmacy (users panel)
- `StaffRole` — doctor, nurse, receptionist, laboratory, pharmacy (`administration.types.ts:15`)
- `ContactRole` — doctor, nurse, pharmacist, patient (`messaging/model/types.ts:8`)

### 4.2 The 22 permissions

Verbatim from `frontend/src/types/auth/index.ts`. **This union is the entire vocabulary — a permission not listed here cannot exist anywhere.**

| Domain | Permissions |
|---|---|
| Clinical data | `patients.view`, `patients.revealIdentity`, `records.view`, `records.edit`, `prescriptions.create`, `labs.review` |
| Scheduling | `appointments.manageOwn`, `appointments.reassign`, `appointments.cancelAdministratively` |
| Communication | `messages.send`, `communications.viewMetadata`, `communications.viewContent`, `communications.resolveFlags` |
| Administration | `doctors.manage`, `doctors.verify`, `patients.manageAccounts`, `roles.manage`, `settings.manageSystem`, `integrations.manage` |
| Audit | `logs.view`, `logs.export` |
| AI | `ai.use` |

### 4.3 Role bundles

Seeded in `frontend/src/features/auth/mock/users.ts` (MG §6.3):

- **Doctor** — `patients.view`, `patients.revealIdentity`, `records.view`, `records.edit`, `prescriptions.create`, `labs.review`, `appointments.manageOwn`, `messages.send`, `communications.viewMetadata`, `ai.use`
- **Admin** — `patients.view`, `patients.manageAccounts`, `appointments.reassign`, `appointments.cancelAdministratively`, `messages.send`, `communications.viewMetadata`, `communications.viewContent`, `communications.resolveFlags`, `doctors.manage`, `doctors.verify`, `roles.manage`, `settings.manageSystem`, `integrations.manage`, `logs.view`, `logs.export`

**The asymmetries are deliberate and must not be "fixed":** admin has no `ai.use` (AI is a clinical tool), no `records.edit`, no `prescriptions.create`. Doctor has no log access.

### 4.4 User overrides

`user_permissions` (DB §A5) carries per-user grants and revocations layered over the role bundle. Effective permissions = role bundle ± overrides, resolved server-side, Redis-cached, invalidated on change (RM M7.1). API §15.5 exposes `GET/PUT /users/{id}/permissions`.

### 4.5 Patient care-scoping

The single most important authorization rule (MG §6.4-1, UX §1.5):

> Doctors see clinical data **only for patients under their care.**

The anchor is `patient_doctor_assignments` (DB §13.1) — an M:N care team with `role` (primary/consulting), `assigned_at`, `revoked_at`, `granted_by`. Today the frontend carries a single free-text `assignedDoctor: string` on `Patient`.

Every patient-child access path — records, labs, prescriptions, appointments, notes, documents, AI context binding — routes through one `PatientScopeService`. A doctor requesting another doctor's patient gets 403/404 **with no data leakage in the error** (RM M7.2). MG §9-4 and RM M4.4 leave open whether this is enforced by Postgres RLS or service-layer scoping in v1; RLS on PHI tables is required before production (RM M37.3).

### 4.6 Admin masking and reveal

Admins see demographics and operational metadata by default, with **masked identifiers**: name masking (`Kh••• N•••`) and MRN last-4 only.

- Per-row reveal requires `patients.revealIdentity`
- `POST /patients/{id}/reveal` returns full identity **atomically with the audit write** — no audit row means no reveal
- Message **content** access is separately gated: justification category (`complaint | safety | legal | audit`) + reason → optional second-admin approval per policy → read-only watermarked view → audit event carrying a reference number

**The frontend has already shipped its half** (ADM-10): `frontend/src/utils/phi-mask.ts` holds pure maskers, `features/admin/phi/` holds the elevation provider and justification prompt, and `administration.api.ts → phiAccess` is an append-only log with `record` but deliberately no update or remove. Grants are in-memory and lapse after 15 minutes. **The server's masking output must agree with `phi-mask.ts` character-for-character**, and the 15-minute grant lifetime is a behaviour the server now owns.

### 4.7 Audit requirements for authorization

Every flagged action writes to the immutable ledger through one choke point (MG §6.4-5): identity reveals, message-content access, severe-interaction acknowledgments, exports, doctor-verification decisions, suspensions, role-matrix edits, platform-settings writes, and every P4 reason-required destructive action.

Role-matrix edits additionally require an affected-user-count preview, explicit confirmation, and produce a 409 merge flow on concurrent edits (MG §6.4-4).

---

## 5. API conventions

### 5.1 Base URL

Contract: `{VITE_API_BASE_URL}` → `https://<host>/api/v1`.
Repository: `frontend/.env.example` and the `configs/env.ts` default are `http://localhost:3000/api` — **no `/v1`**. See ambiguity **A-03**.

### 5.2 Request headers

Sent by `ApiClient` on every request (`frontend/src/api/client.ts`):

| Header | Value | Notes |
|---|---|---|
| `Accept` | `application/json` | always |
| `X-Correlation-Id` | `crypto.randomUUID()` | fresh per request |
| `Content-Type` | `application/json` | only when a body is present |
| `Authorization` | `Bearer <accessToken>` | only when a token is set |
| — | `credentials: 'include'` | cookies always sent |

**Specified but not implemented by the client:** `Idempotency-Key` (API §0.5) and `X-Client-Type` (MG §15.2). See **A-06**.

Client timeout is **30 s** via `AbortController`. No synchronous endpoint may exceed it — long work becomes an async job plus notification, or streams.

### 5.3 Response envelope

```json
{ "data": <payload> }
```

`204 No Content` for bodyless success — `ApiClient` returns `undefined` and does not attempt to parse.

### 5.4 Pagination

```json
{ "items": [...], "page": 1, "pageSize": 20, "totalItems": 143, "totalPages": 8 }
```

Common params (`ListParams` in `frontend/src/types/api/index.ts`): `q`, `sort` (`field:asc|desc`, whitelisted per endpoint), `page` (1-based, default 1), `pageSize` (default 20, **max 100**). Unknown params ignored; invalid values → 422. Audit logs use **keyset** pagination for 100k+ rows (MG §12).

### 5.5 Error format

```json
{ "message": "Human readable", "code": "machine_code",
  "fieldErrors": { "email": ["Invalid email"] }, "detail": "…", "ref": "corr-id" }
```

### 5.6 HTTP status mappings

Binding, because `frontend/src/api/errors.ts` implements exactly this:

| Status | `ApiError.kind` | Server must supply | Client behaviour |
|---|---|---|---|
| 400, 422 | `validation` | `fieldErrors` keyed by field path | RHF `setError` per field |
| 401 | `auth` | (nothing rendered) | single-flight refresh → replay → else hard logout |
| 403 | `forbidden` | — | 403 pattern / disabled affordance |
| 404 | `not_found` | — | not-found state |
| 409 | `conflict` | `detail` (human-readable) | merge dialog / stale refetch |
| 429 | `rate_limited` | **`Retry-After` header** in seconds | countdown |
| 5xx | `server` | `ref` | support reference shown |
| — | `network` | (client-side) | retryable |

Two gaps between this table and the code: `errors.ts` reads no `code` field (**A-04**), and it applies the refresh path to *all* 401s (**A-05**).

### 5.7 Correlation IDs

Accept `X-Correlation-Id`, generate one if absent, echo it on the response, bind it to the pino log line, and return it as `ref` on 5xx. It is the support reference the UI displays.

### 5.8 Idempotency

State-changing POSTs with side effects — prescription send, appointment create, message send — accept an `Idempotency-Key` header; replays return the original result (API §0.5, MG §8.4). This makes retry-safe writes possible on flaky mobile networks (MG §15.7).

### 5.9 Concurrency

| Mechanism | Applies to |
|---|---|
| Compare-and-set (`WHERE status = :expected`) | every status transition; lost race → 409 `conflict` with `detail` |
| Optimistic concurrency (`updatedAt` echoed back) | settings documents, permission matrix; mismatch → 409 **with both change sets** for the merge dialog |
| Single transaction | multi-row clinical writes: record + children, prescription + warnings, transition + event + outbox row |
| Outbox | notifications and emails fire **only after commit** — the UX requires that notifications fire only on confirmed server success |

---

## 6. Domain inventory

Nineteen backend modules, matching RM M2.1 and the module skeleton list.

| Module | Responsibility |
|---|---|
| `auth` | Registration, login, email verification, OTP step-up, token issue and rotation, logout, password flows, lockout, `login_events` |
| `users` | Account settings, active sessions, trusted devices, login history, activity feed, admin platform-users panel, 2FA enrolment |
| `doctors` | Professional profile documents, license-change re-verification, verification workflow (documents, approve/reject/request), availability grid and time-off, admin doctor list with operational stats, suspend/reactivate |
| `patients` | Patient master data, identifier search, the profile bundle and its ten tabs, allergies, conditions, history, vitals, notes, documents, emergency contacts, insurance, clinical alerts, derived fields, masked projections and audited reveal, admin account governance |
| `appointments` | Scheduling engine: list and calendar queries, conflict checking against availability, the transition matrix, event history, slot proposals, emergency time-off blast flow, admin oversight (nudge, reassign, administrative cancel) |
| `medical-records` | Clinical documents and their seven child collections, status lifecycle, one-primary-diagnosis rule, note signing with AI provenance, attachments, row versioning with before/after diffs, issue reports. Never hard-deletes |
| `labs` | Test catalogue and analyte specs, order pipeline, specimen capture and condition gating, result entry with reference-range snapshotting and flag computation, critical-review discipline, per-analyte trends, attach-to-record identity check |
| `pharmacy` | Formulary and monographs, **the safety screen** (allergy / interaction / duplicate / dosage), draft-and-sign lifecycle with fail-closed rules, renew, discontinue, refill accounting, expiry sweep, patient medication list materialisation |
| `messaging` | Conversations, participants, messages, per-participant folder state, delivery and read receipts, patient-thread edit and delete rules, scan-gated attachments, own-thread search, presence, admin metadata oversight and the content-access gate |
| `notifications` | Domain-event fan-out from the outbox, category and priority rules including critical pinning, the feed and its row actions, badge counts, the preference matrix with the locked security category and quiet hours, per-channel delivery workers |
| `ai` | Conversations and messages, server-authoritative context binding under care scope, SSE streaming with cancellation, prompt templates, per-user AI settings, response feedback. **No write access to clinical tables** |
| `reports` | Per-category analytics with comparison deltas, insight computation, saved reports, scheduled reports with a cron executor and run history, exports |
| `settings` | The per-user settings document and its slice updates, integration OAuth, personal data-export requests |
| `administration` | Clinic operations: overview aggregates, staff, departments, rooms, resources, working schedule, holidays, shifts, live queue, waiting room, announcements, policies, document templates, platform status |
| `platform-settings` | The eleven configuration slices, API keys, platform integrations with test-connection, backups, maintenance-mode flag |
| `audit` | The single INSERT-only write choke point, the investigation query surface with keyset pagination and correlated events, logged exports, incident bookmarks, partition maintenance and retention |
| `files` | Uploads with per-kind validation and checksums, S3 adapter, signed short-TTL downloads, the malware-scan gate, orphan cleanup |
| `search` | Role-scoped grouped search — doctor over patients/appointments/records under care scope, admin over entities plus sections and settings panels |
| `dashboard` | The doctor Overview composite and its independently fetchable widgets, the action queue, the fail-loud critical-alerts banner, cross-module summary counts |

Cross-cutting services in `shared/`: `AuditService`, the transactional outbox, `PatientScopeService`, status machines, `AiGateway`, and the files-service interface.

---

## 7. Database dependency map

**No redesign.** This maps backend modules to existing sections of `frontend/DATABASE_SCHEMA_EXTRACTION.md`. Entity numbers are DB §1.

| Backend module | DB domain | Tables |
|---|---|---|
| `auth` | **A** | `roles`, `permissions`, `role_permissions`, `users`, `user_permissions`, `user_credentials`, `sessions`, `trusted_devices`, `login_events`, `verification_tokens`, `otp_codes` (1–11) |
| `users` | **A**, **J** | `users`, `user_permissions`, `sessions`, `trusted_devices`, `login_events`, `user_activity_log` (12), `user_settings` (67) |
| `doctors` | **B**, **SPEC** | `doctors` (13), `admin_profiles` (14), `doctor_verification_documents` (87), `doctor_availability` (88) |
| `patients` | **B** | `patients` (15) + eleven satellites (16–26): allergies, chronic conditions, emergency contacts, insurance, documents, notes, medical history, vital signs, clinical alerts, medications, studies |
| `appointments` | **C**, **SPEC** | `appointments` (27), `appointment_events` (28), `appointment_reschedule_proposals` (89), `satisfaction_surveys` (93) |
| `medical-records` | **D**, **SPEC** | `medical_records` (29) + seven children (30–37), `record_issue_reports` (92) |
| `labs` | **E** | `lab_test_catalogue` (38), `lab_analyte_specs` (39), `lab_orders` (40), `lab_specimens` (41), `lab_results` (42), `lab_attachments` (43), `lab_timeline_events` (44) |
| `pharmacy` | **F** | `medications` (45), `medication_strengths` (46), `prescriptions` (47), `prescription_safety_warnings` (48), `prescription_notes` (49), `prescription_history_entries` (50), `prescription_timeline_events` (51) |
| `messaging` | **G**, **SPEC** | `conversations` (52), `conversation_participants` (53), `messages` (54), `message_attachments` (55), `conversation_shared_links` (56), `broadcast_channels` (59), `communication_access_requests` (90), `message_flags` (91) |
| `notifications` | **G** | `notifications` (57), `notification_preferences` (58) |
| `ai` | **H** | `ai_conversations` (60), `ai_messages` (61), `ai_user_settings` (62), `ai_prompt_templates` (63) |
| `reports` | **I** | `saved_reports` (64), `scheduled_reports` (65), `scheduled_report_runs` (66) |
| `settings` | **J** | `user_settings` (67), `user_interface_preferences` (68), `user_integrations` (69) |
| `administration` | **K** | `departments` (70), `staff_members` (71), `staff_shift_assignments` (72), `rooms` (73), `resources` (74), `clinic_working_days` (75), `holidays` (76), `queue_entries` (77), `waiting_room_entries` (78), `announcements` (79), `policies` (80), `document_templates` (81) |
| `platform-settings` | **L** | `platform_settings` (82), `platform_integrations` (83), `api_keys` (84), `backups` (85) |
| `audit` | **M** | `audit_events` (86) — partitioned monthly, BRIN on `occurred_at` |
| `files` | **§11** | central `files` table |
| `search` | — | reads across A/B/C/D via `pg_trgm` GIN indexes (DB §8) |
| `dashboard` | — | reads across C/D/E/F/G; no owned tables |

### 7.1 Recommended tables (DB §13) that backend milestones depend on

These are §13 **inferred recommendations**, never mixed with confirmed entities. Six are hard prerequisites:

| Table | Required by | Consequence if absent |
|---|---|---|
| `patient_doctor_assignments` | `patients`, all clinical modules | **Care scoping cannot be enforced** — the anchor for §4.5 and RLS |
| `drug_interactions` | `pharmacy` | The severity-graded safety screen degrades to one canned string per drug |
| `medication_monographs` | `pharmacy` | API §7.2 has no data source |
| `notification_deliveries` | `notifications` | No per-channel delivery tracking |
| `incident_bookmarks` | `audit` | API §14.4 has no data source |
| `report_exports` | `reports` | Export artefacts unaddressable |

Whether these exist in the built database is **unverified** — see §10, item V-8.

### 7.2 Constraints and rules the backend must respect, not re-invent

From DB §9 and §7:

- **No DELETE grant** to the application role on `medical_records`, patient-thread `messages`, or `audit_events`
- Status-transition enforcement by trigger implementing the DB §4.1 matrix — illegal transition raises at DB level
- CHECK constraints: `duration_min > 0`, `refills_remaining BETWEEN 0 AND refills_allowed`, `end_date >= start_date`, `text_scale BETWEEN 90 AND 130`, `temperature BETWEEN 0 AND 1`, `quantity > 0`, `capacity > 0`, `notification_preferences.cat_security = true`, `ai_conversations` requires a patient unless mode is `general`
- Partial unique indexes: one primary diagnosis per record, one primary emergency contact, one active insurance
- FK policy: CASCADE for user-owned satellites and document children; RESTRICT on clinical anchors; SET NULL on optional links so history survives account removal
- `has_critical_result` is the one trigger-maintained denormalisation; everything else derived (age, `hasSevereAllergy`, `nextAppointment`, `staffCount`, waiting minutes) is computed, not stored

---

## 8. Security requirements

Consolidated from MG §11, DB §10, `FRONTEND_ARCHITECTURE.md` §12, and UX §1.5.

**Tokens and sessions**
1. JWT access ≤15 min with `sub`/`role`/`permissions`/`sid`; opaque rotating refresh, hashed at rest, family-revocation on reuse
2. Cookie `httpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`
3. Mobile: identical endpoints, refresh in body under `X-Client-Type: mobile`
4. Session revocation must take effect on the next refresh

**Credentials**
5. Argon2id hashing; policy ≥8 with upper/lower/digit/symbol; current password required to change; expiry per `passwordExpiryDays`; reuse history [RECOMMENDATION]
6. Single-use hashed tokens with TTL for verification and reset; resend endpoints rate-limited
7. **Anti-enumeration everywhere** — forgot-password always 202; login failures identical in timing and shape
8. TOTP secrets and recovery codes encrypted; OTP attempts bounded

**Authorization**
9. Role + permission guards server-side on **every** route; per-user overrides honoured; permission changes take effect at next session issue
10. Care-relationship scoping on all clinical data; RLS on PHI tables before production

**PHI**
11. Masked admin projections by default; reveal and content-access endpoints write their audit event **atomically** with the disclosure
12. **No PHI in URLs, logs, error messages, or telemetry** — ids only, never names or MRNs in query strings
13. Encrypted columns for secrets and high-sensitivity PII (insurance policy numbers, integration configs, SMTP/SMS credentials)
14. Secrets are write-only in the API surface — never returned after write
15. Retention per `patientRecordYears`, `auditLogDays`, `messagesDays`; soft delete only on PHI

**Transport and web**
16. Helmet-equivalent headers; strict CORS with exact origins and `credentials: true` (required by the cookie flow)
17. CSRF: `SameSite=Strict` plus Origin check on auth routes
18. Parameterised queries only; JSON body limits; file type/size validation plus a malware-scan gate before download activation
19. SSRF protection on integration test-connection endpoints

**Rate limiting**
20. Strict on auth (per-IP and per-account), moderate globally, generous on polling endpoints — always with `Retry-After`
21. Lockout per `loginAttemptLimit`; anomaly flags (bursts, new location, impossible travel) recorded on `login_events` and surfaced as security alerts

**Audit**
22. One choke point, INSERT-only, no update or delete method in the service and no grant at the DB role
23. Log exports write their own audit event
24. Retention job drops only out-of-window partitions

**Operational**
25. Env-injected secrets, 12-factor, never committed
26. OWASP ASVS L2 target; dependency audit and lockfile-only installs in CI
27. Open-redirect rules on any server-emitted redirect (email links) equivalent to the client's `returnTo` validation

---

## 9. Real-time, background and infrastructure requirements

### 9.1 Redis

| Use | Detail |
|---|---|
| Permission/session cache | Effective permissions per user, invalidated on change (RM M7.1) |
| Badge counters | `GET /notifications/badge-counts` polled at 10–15 s by every open client; target p95 < 50 ms |
| Reference-data cache | Formulary, ICD codes, lab catalogue — long TTL with explicit bust on edit |
| Rate-limit counters | Unified across auth, polling and general endpoints |
| Presence | TTL heartbeat driving coarse online/away/offline (API §9) |
| Stampede protection | Dashboard aggregates |

### 9.2 BullMQ background jobs

Notification fan-out and per-channel delivery · scheduled-report execution · prescription expiry sweep · refill-due computation · license-expiry warnings (<60 / <30 days) · retention purges · backup runs · malware scans · satisfaction-survey dispatch · orphan file cleanup · async exports (PDF/Excel) · AI usage-log retention.

Infrastructure required: queue registry, retry/backoff policy, dead-letter handling, job metrics, and an admin-only Bull Board.

### 9.3 Object storage

S3-compatible — MinIO in development, S3 in production. Every upload surface flows through one files service: metadata row in `files`, object in storage, SHA-256 checksum, malware-scan gate, signed short-TTL download URLs honouring `Content-Disposition`.

Consumers: profile photos, patient documents (5 categories), record attachments (5 kinds), lab attachments (4 kinds), message attachments, doctor verification documents, branding assets, report exports, backup artefacts.

### 9.4 Email and SMS

- **Email** — SMTP configured through the platform email slice; mailhog in development. Verification, password reset, notification channel delivery, scheduled report delivery.
- **SMS** — provider configured through the SMS slice; a stub is acceptable initially.
- **Push** — device-token registration at `/me/devices`, FCM/APNs behind the existing `push` channel preference (mobile scope).

All channel sends are queued jobs with delivery-tracking rows, and fire **only after the domain transaction commits**.

### 9.5 SSE and real-time

- **AI message generation** streams over SSE (`text/event-stream`): token deltas then a final `done` carrying message id and status; cancellable, producing status `stopped`. This is also what keeps AI responses inside the client's 30 s timeout.
- **Everything else polls today.** Badge counts and presence are polling endpoints at 10–15 s. MG §3.2 and API Appendix B mark SSE invalidation pushes as an upgrade path that must not change response shapes. WebSockets are explicitly later.

---

## 10. M0.1 verification checklist

The roadmap's M0.1 verify step is:

> a written checklist maps each frontend feature module → its API-contract module (Appendix A of the contract, confirmed line by line).

| # | Verification item | Status | Evidence |
|---|---|---|---|
| V-1 | `PROJECT_BACKEND_MASTER_GUIDE.md` read | **PASS** | 18 sections; §5.2, §6.2–6.4, §8.1, §10.4, §11, §15, §17 transcribed into §3–§8 above |
| V-2 | `BACKEND_API_CONTRACT.md` read | **PASS** | All 20 modules + §0 conventions + Appendices A and B; conventions in §5 |
| V-3 | `DATABASE_SCHEMA_EXTRACTION.md` read | **PASS** | §1 entity list (93), §4 business rules, §6 enum inventory, §7 audit matrix, §8 indexes, §9 constraints, §10 security, §11 files, §13 recommendations, §14 outputs. Mapped in §7 |
| V-4 | `FRONTEND_ARCHITECTURE.md` §6 and §10 read | **PASS** | §6.1–6.5 → §3 and §4; §10.1–10.3 → §1.4 and §5 |
| V-5 | `src/api/client.ts`, `errors.ts` read | **PASS** | Headers, timeout, single-flight refresh and the full status→`kind` map in §5.2/§5.6. Three defects found (A-04, A-05, A-06) |
| V-6 | `types/api`, `types/auth`, `types/common.ts` read | **PASS** | `ApiResponse`, `Paginated`, `ListParams`, `ApiError`; `Role`, 22 `Permission`s, `SessionUser`, `AuthStatus`; branded ids and `IsoDateTime`/`IsoDate` |
| V-7 | Every `features/**/model/types.ts` read | **PASS** | Nine files. Two features carry their model elsewhere: `patients` (in `model/profile-types.ts` + `shared-domain/patient-identity/types.ts`) and `dashboard` (**no `types.ts` at all** — only `model/mock-data.ts`) |
| V-8 | Every `features/**/api/use*.ts` read | **PASS** | Eleven files catalogued in §2. Confirmed by grep that `labs`, `pharmacy`, `medical-records` and `dashboard` contain **zero `useMutation`** |
| V-9 | `features/auth/mock/*` read | **PASS** | All five files. `mock-auth-service.ts` exposes 11 functions; **no `refresh()`** (A-07); `verifyOtp(code)` takes no `otpToken` (A-08); `login(email, password)` takes no `rememberMe` (A-09) |
| V-10 | `administration.api.ts` / `.types.ts` read | **PASS** | At `features/admin/`, not `features/doctor/administration/`. `administrationApi` surface and 25 exported types catalogued |
| V-11 | `admin-settings.api.ts` / `.types.ts` read | **PASS** | `adminSettingsApi` surface and 21 exported types; `createApiKey` already implements show-once semantics |
| V-12 | **Appendix A confirmed line by line** | **PASS** *(defect found)* | All 15 entries checked; 13 resolve, 2 are stale (§2.1). The verification ran to completion — the finding is that the *contract* is out of date, not that the check is incomplete |
| V-13 | Feature → contract-module mapping complete | **PASS** | §2, 18 rows, every contract module 1–20 has at least one frontend consumer or is explicitly marked as having none |
| V-14 | Relationships verified, not just files opened | **PASS** | Enum unions cross-checked against DB §6; seam paths resolved against the tree; `useMutation` coverage measured; masking behaviour compared between `phi-mask.ts` and API §4.9 |
**Overall M0.1: PASS.** The milestone's own verify criterion — the feature → contract-module map, confirmed against Appendix A line by line — is satisfied in §2 and §2.1. Every listed file was read, and the relationships between features, models, hooks and contract modules were cross-verified rather than assumed.

### 10.1 Out of M0.1 scope, but blocking downstream

Two checks that a reader might expect here belong to M4/M5, not M0.1. They are recorded now because they block **M0.2**, not this milestone.

| # | Item | Status | Evidence |
|---|---|---|---|
| V-15 | Built database verified against the DB specification | **BLOCKED** | The database exists outside this repository. No DDL, `pg_dump --schema-only`, or connection string has been provided. Whether the built schema matches DB §1–§14 — including whether the six §13 prerequisite tables exist (§7.1) — cannot be determined from this repository |
| V-16 | Enum values in the built database confirmed | **BLOCKED** | Same cause as V-15. DB §6 states the intended vocabulary, but the built database has already frozen these decisions and this report cannot read them. Directly affects A-01 and A-02 |

Both share one remedy: a schema dump of the built database.

---

## 11. Ambiguities discovered

Recorded, not resolved. These are M0.2 input for `docs/DECISIONS.md`.

| # | Ambiguity | Sources in conflict | Severity |
|---|---|---|---|
| **A-01** | **Appointment status has three vocabularies.** `AppointmentStatus` (`appointments/model/types.ts:24`) has 7 values. `ProfileAppointmentStatus` (`patients/model/profile-types.ts:137`) has 5 — no `scheduled`, no `rescheduled`. UX and API §5 add `awaiting-patient`, which exists in neither union. DB §4.1 notes it is "not yet in the coded enum" | MG §17-1, DB §4.1/§16, API §5 | **High** — schema freeze depends on it |
| **A-02** | **Prescription status lacks `draft` and `dispensed`.** `PrescriptionStatus` has 5 values, but `PrescriptionTimelineKind` includes `dispensed`, and API §7.6 says "Create **draft**" | MG §17-2, DB §6, `pharmacy/model/types.ts:29,196` | **High** |
| **A-03** | **Base path mismatch.** Contract specifies `/api/v1` with cookie `Path=/api/v1/auth`; `.env.example` and `configs/env.ts` default to `/api`. As written the browser never sends the refresh cookie | API §0.1, `frontend/.env.example`, `configs/env.ts:11` | **High** — silent-refresh cannot work |
| **A-04** | **The error `code` is dropped by the transport layer.** Contract §0.3 and MG §10.4 require a machine `code`; the auth pages branch on it. But `ErrorBody` in `errors.ts` has no `code`, `normalizeHttpError` never reads it, and the `ApiError` union has no member carrying it. The codes reach the pages only via `MockAuthError`. With mocks off, every login failure normalizes to `{ kind: 'auth' }`, which the client treats as token expiry → refresh → **logout on a wrong password** | API §0.3, MG §10.4, `src/api/errors.ts`, `LoginPage.tsx:46` | **Critical** |
| **A-05** | **401 is overloaded.** `ApiClient.request` retries every 401 through the refresh handler; API §1.2 returns 401 `invalid_credentials` for a bad password; MG §10.3 says 401 is for token problems **only**. The two halves of the spec disagree and the client implements the permissive one | `client.ts:110`, API §1.2, MG §10.3 | **High** |
| **A-06** | **Two specified headers are not implemented.** `Idempotency-Key` (API §0.5) and `X-Client-Type` (MG §15.2) are never sent by `ApiClient` | API §0.5, MG §15.2, `client.ts` | Medium |
| **A-07** | **No HTTP refresh seam exists.** `mock-auth-service.ts` has no `refresh()`. The "silent refresh" is `session-store.refreshSession()`, a localStorage sliding-expiry read. The boot-refresh path in MG §5.2 has no mock counterpart to swap | MG §5.2, `features/auth/mock/` | Medium |
| **A-08** | **OTP verification signature differs.** Contract §1.3 requires `{ otpToken, code }`; the mock is `verifyOtp(code)` with no token concept, so there is no coded model for the short-lived OTP session | API §1.3, `mock-auth-service.ts:65` | Medium |
| **A-09** | **`rememberMe` is client-side only.** Contract §1.2 puts it in the login body and derives cookie TTL from it; the mock's `login(email, password)` never receives it — `session-store.persistSession` applies it locally | API §1.2, `mock-auth-service.ts:26`, `session-store.ts:38` | Low |
| **A-10** | **Appendix A has two stale paths.** `features/doctor/administration/*.queries.ts` → `features/admin/*.queries.ts` | API Appendix A, tree | Low — doc fix |
| **A-11** | **Second-admin approval for content access has no default.** The policy exists as a setting; which way it defaults is undecided | MG §17-6, API §9.11 | Medium |
| **A-12** | **Doctor references are free-text.** `Appointment.doctor: string`, `Patient.assignedDoctor: string`. DB wants FKs with a denormalised `doctorName` retained in list DTOs | MG §17-3, DB §14.5-3 | Medium |
| **A-13** | **Four diverging department lists plus a `Department` entity.** `DEPARTMENTS` (appointments, 5), `RECORD_DEPARTMENTS`, `LAB_DEPARTMENTS`, `PRESCRIBER_DEPARTMENTS`, and `administration.types.ts → Department` | MG §17-4, DB §14.5-4 | Medium |
| **A-14** | **Availability is specced but not coded.** Weekly grid, buffers and vacation mode exist only in UX and DB §S2; appointments conflict-checking depends on them | MG §17-5, API §3.8 | Medium |
| **A-15** | **Retention defaults undecided** — records years, audit days, messages days. Compliance input needed | MG §17-7 | Medium |
| **A-16** | **Billing flag-off behaviour stated twice, differently.** API §12.1 says "404/flag-off alternate"; RM M17.2 requires the alternate payload and forbids 500. The frontend renders alternates and has no 404 branch | API §12.1, RM M17.2 | Low |
| **A-17** | **Role vocabularies do not agree.** `PlatformRole` uses `pharmacy`, `ContactRole` uses `pharmacist`, `StaffRole` omits `patient`. One `roles` table must absorb all three | DB §A1/§14.5-7, three frontend unions | Medium |
| **A-18** | **`ConversationKind` differs between layers.** `notifications/model/types.ts:156` has 3 values (direct, announcement, system); DB §6 lists 4 (adds `group`) | DB §6, `notifications/model/types.ts` | Low |
| **A-19** | **Three distinct `ChatMessage` types** exist — in `messaging`, `notifications` and `ai`. They are different shapes sharing a name. The backend must not unify them into one DTO | three `model/types.ts` files | Low — noted to prevent an error |
| **A-20** | **Queue and waiting-room APIs are shaped differently.** Contract §18.9–18.10 specifies action endpoints (`advance`, `assign-room`, `call`, `seat`); `administrationApi` exposes generic `crud()` for both | API §18.9–18.10, `administration.api.ts:880` | Low |
| **A-21** | **`broadcast_channels` (DB entity 59) has no contract endpoint.** It backs the Communication Center's announcement and system channels | DB §1 domain G, API §9 | Low |
| **A-22** | **`POST /auth/2fa` vs `POST /auth/otp/verify`.** `FRONTEND_ARCHITECTURE.md` §6.1 names the former; API §1.3 names the latter | FE arch §6.1, API §1.3 | Low |
| **A-23** | **Feature flag `aiAssistant` is dead code.** It is declared `false` while AI routes mount on the `ai.use` permission. Either wire it or delete it — the backend should not infer that AI is disabled | frontend checklist F-12, `configs/feature-flags.ts` | Low |
| **A-24** | **The built database is unverified against the specification.** Recorded as an ambiguity because every schema-dependent decision below M0.2 rests on it | §10 V-15, V-16 | **Critical** |

---

## 12. What M0.2 must resolve

The roadmap's M0.2 requires one accepted ADR per MG §17 item. Mapping this report's findings onto them:

| MG §17 item | This report |
|---|---|
| 1 — Appointment enum | A-01 |
| 2 — Prescription enum | A-02 |
| 3 — Doctor FKs vs free-text | A-12 |
| 4 — Unified departments | A-13 |
| 5 — Availability model | A-14 |
| 6 — Content-access policy default | A-11 |
| 7 — Retention defaults | A-15 |

RM M0.3–M0.6 additionally cover: repository layout, the Appendix A patch (A-10), the DB §13 table scoping (§7.1), and the four transport decisions (A-03 through A-06).

**Not yet assigned to any ADR:** A-17 (role vocabularies), A-18, A-19, A-20, A-21, A-22, A-23, and — most importantly — **A-24**, which gates the schema-dependent half of M0.2. The enum ADRs (A-01, A-02) cannot be *decided* if the built database has already frozen those enums; they become ADRs that **record** what the database chose.

---

*End of M0.1 analysis. No backend implementation has been started.*
