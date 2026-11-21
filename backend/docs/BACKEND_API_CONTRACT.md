# Medora — Backend API Contract

**Purpose:** Complete API specification derived from the frontend (Phases 0–19). This is the contract the backend implements and the frontend integrates against.
**Companions:** `PROJECT_BACKEND_MASTER_GUIDE.md` (context), `BACKEND_IMPLEMENTATION_ROADMAP.md` (build order), `DATABASE_SCHEMA_EXTRACTION.md` (**DB §…** table references).

**Provenance labels** (per endpoint or module):
- **[MOCK-SEAM]** — a mock service/query hook in the code performs exactly this operation today; shapes are transcribed from `features/**/model/types.ts` and `api/use*.ts`.
- **[DERIVED]** — implied by UI affordances/UX blueprint but not exercised by a coded mock. Marked *Derived from Frontend Requirements*.
- **[SPEC]** — specified in `UX_ARCHITECTURE.md` for confirmed scope not yet coded (e.g., doctor verification, content-access gate).

> **Field names are law.** JSON fields use camelCase and must match the frontend model types verbatim (`dateTime`, `durationMin`, `hasSevereAllergy`, `refillsRemaining`, …). Enum values are the exact string literals of the frontend unions (see DB §6 inventory).

---

> **Patient Mobile client:** the patient-facing surface is specified separately in
> [`PATIENT_MOBILE_API_CONTRACT.md`](PATIENT_MOBILE_API_CONTRACT.md), which inherits every
> convention in §0 below. That addendum is **contract-only and unimplemented**, gated on the
> proposed ADR-030 (patient identity) and ADR-031 (results release). Note in particular that
> §3.4 `GET /doctors` and §4 `GET /patients` are **staff** routes and must not be reused for a
> patient client — see that document's forbidden-field list.

## 0. Global Conventions (apply to every endpoint; not repeated below)

### 0.1 Base URL & headers

- Base: `{VITE_API_BASE_URL}` → recommend `https://<host>/api/v1`. All routes below are relative to it.
- Client always sends: `Accept: application/json`, `X-Correlation-Id: <uuid>` (echo it back; use as error `ref`), `Authorization: Bearer <accessToken>` on protected routes, `Content-Type: application/json` on bodies, and cookies (`credentials: 'include'`).
- Server sets the refresh cookie: `medora_rt`; `httpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`.
- Client timeout is **30 s** — no synchronous endpoint may exceed it; long work is async (job + notification) or streamed.

### 0.2 Envelopes

- Success: `{ "data": <payload> }`. `204 No Content` for bodyless success.
- Paginated payload (`Paginated<T>`):
  ```json
  { "items": [...], "page": 1, "pageSize": 20, "totalItems": 143, "totalPages": 8 }
  ```
- Common list params (`ListParams` + per-module filters): `q`, `sort` (`field:asc|desc`, whitelisted per endpoint), `page` (1-based, default 1), `pageSize` (default 20, max 100).
- Path identifiers: a malformed id (not the resource's id shape) answers exactly as an unknown one does — **404**, never 500. Enforced for every parameterised route by `test/path-parameter-robustness.e2e-spec.ts` (2026-11-14).

### 0.3 Error contract (client mapping in `src/api/errors.ts` — binding)

```json
{ "message": "Human readable", "code": "machine_code", "fieldErrors": {"email": ["Invalid email"]}, "detail": "…", "ref": "corr-id" }
```

| Status | Client kind | Required fields |
|---|---|---|
| 400/422 | validation | `fieldErrors` |
| 401 | auth (token only — triggers single-flight refresh then logout) | — |
| 403 | forbidden | — |
| 404 | not_found | — |
| 409 | conflict | `detail` |
| 429 | rate_limited | header `Retry-After: <seconds>` |
| 5xx | server | `ref` |

### 0.4 Authorization shorthand

- **Auth** column: `—` public · `✓` any authenticated user · `doctor` / `admin` role · `can:<permission>` capability (from the 22-permission union).
- All clinical-data routes are additionally **care-scoped**: doctors access only patients assigned to them (403/404 otherwise). ⚠ *Superseded in part by the Multi-Hospital decisions (2026-10-07):* the target rule is **active hospital + role + permissions**, with hospital context resolved server-side and foreign-hospital ids answering 404; assignment is hospital-scoped workflow only (DR-05, DR-07, DR-08). Cross-hospital access goes only through a category-scoped grant or Break-Glass. Proposed contracts: [`docs/multi-hospital/API_CONTRACT_CHANGES.md`](../../docs/multi-hospital/API_CONTRACT_CHANGES.md). Admin patient projections are **masked** unless revealed (module 4.9).
- Every P4 action (reason-required destructive operation) stores the reason and writes an audit event (module 14) — noted as *“P4/audited”*.

### 0.5 Idempotency & concurrency

- State-changing POSTs accept `Idempotency-Key`; replays return the original result.
  **[ADR-014, implemented 2026-11-05]** Honoured on `POST /appointments`, `POST /prescriptions`,
  `POST /prescriptions/{id}/sign`, `POST /prescriptions/{id}/renew`, `POST /lab-orders`,
  `POST /conversations` and `POST /conversations/{id}/messages`; ignored elsewhere. The key is
  1–128 visible ASCII characters (else 422 `validation_failed` on `Idempotency-Key`), scoped to the
  authenticated user, kept 24 h. A replay — same key, same `METHOD /path`, same body (canonical
  JSON) — returns the stored result with the original status and `Idempotency-Replayed: true`, and
  executes nothing. Same key, different endpoint or body → **422 `idempotency_key_reused`**; the
  first request still running → **409 `idempotency_request_in_progress`**. A failed request
  releases its key, so a corrected retry executes. No header → unchanged behaviour.
- Status transitions are compare-and-set; a lost race returns 409 `conflict` with `detail`.
- Document updates (settings, permission matrix) send `updatedAt` back; mismatch → 409 (frontend has merge-dialog UX).

---

## 1. Authentication [MOCK-SEAM — `features/auth/mock/*`]

**Error codes** used by this module (frontend branches on them): `invalid_credentials`, `email_unverified`, `otp_required`, `otp_invalid`, `email_taken`, `token_invalid`, `weak_password`, `rate_limited`.
**Tables:** DB §A4–A11.

| # | Method & Route | Description | Auth |
|---|---|---|---|
| 1.1 | `POST /auth/register` | Create account (doctor/admin) | — |
| 1.2 | `POST /auth/login` | Password sign-in | — |
| 1.3 | `POST /auth/otp/verify` | 2FA step-up | — (otp session token) |
| 1.4 | `POST /auth/otp/resend` | Resend OTP | — (otp session token) |
| 1.4a | `POST /auth/otp/recovery` `{ otpToken, recoveryCode }` | Complete the step-up with a single-use recovery code (owner decision R1). Same challenge, attempt bound and success payload as 1.3; 401 `otp_invalid` / 429 like 1.3. Never returns the remaining count. Mails the account holder (R3) | — (otp session token) |
| 1.5 | `POST /auth/refresh` | Rotate refresh cookie → new access token | cookie |
| 1.6 | `POST /auth/logout` | Revoke session, clear cookie | ✓ |
| 1.7 | `POST /auth/forgot-password` | Start reset (anti-enumeration) | — |
| 1.8 | `POST /auth/reset-password` | Complete reset | — |
| 1.9 | `POST /auth/verify-email` | Consume verification token | — |
| 1.10 | `POST /auth/verification/resend` | Resend verification email | — |
| 1.11 | `GET /auth/session` | Current session user | ✓ |

**1.1 Register** — Body (mirrors `signupSchema` + `RegisterInput`): `firstName` (1–60), `lastName` (1–60), `email` (RFC), `phone` (`/^\+?[0-9][0-9\s-]{6,18}$/`), `password` (≥8, upper+lower+digit+symbol → else 422 `weak_password`), `confirmPassword` (server ignores; client-checked), `role` (`doctor|admin`), `licenseNumber?` (≤40), `acceptTerms: true`, `acceptPrivacy: true`. Existing email → **409 `email_taken`**. Success **201**: `{ "data": { "nextStep": "verify-email", "email": "…" } }`. Sends verification email (single-use token, TTL 24 h).

**1.2 Login** — Body: `{ "email", "password", "rememberMe": false }`. Rules: unknown email or bad password → 401 `invalid_credentials` (identical timing/shape — no enumeration); verified=false → **403 `email_unverified`**; lockout after `loginAttemptLimit` failures → 429 `rate_limited`; 2FA enabled → **200** `{ "data": { "requiresOtp": true, "otpToken": "<short-lived>" } }` (no session yet). Otherwise **200**:
```json
{ "data": { "user": { "id": "usr_doctor_amelia", "name": "Dr. Amelia Chen", "email": "doctor@medora.health", "role": "doctor", "permissions": ["patients.view", "…"] }, "accessToken": "eyJ…", "expiresIn": 900 } }
```
plus `Set-Cookie: medora_rt=…` (TTL: rememberMe → 30 d, else 12 h — sliding). Every attempt writes `login_events` (device, IP, location approx., result, failureCode, anomaly flags). Honors `singleSessionPerUser` policy (revokes other sessions).

**1.3 OTP verify** — Body: `{ "otpToken", "code" }` (`code`: exactly 6 digits `/^\d{6}$/`). Wrong → 401 `otp_invalid`; attempts bounded → 429 `rate_limited`. Success → same payload as 1.2 success. **Lifetime (owner decision 2026-11-06):** the `otpToken` challenge is valid for **10 minutes, absolute from issue**; after that verify and resend answer 401 `otp_invalid` and the user signs in again for a new challenge. **1.4 resend**: rate-limited (client shows countdown); it does **not** extend the 10-minute deadline and does not reset the attempt count.

**Session validation on every protected request (PRE-01; owner decisions I4, O-13).** A validly signed access token is refused with **401 `unauthorized`** as soon as its session is revoked (logout, §2.5 revoke one / revoke others, §1.8 reset, §2.3 change, §2.9 2FA disable or lockout, refresh-token reuse, single-session sign-in, administrative deactivation) or expired, or its account is no longer `ACTIVE` or is deleted — on the next request, not when the token expires. The client's handling is unchanged: refresh once, then sign out (ADR-013). `POST /auth/logout` is the one exception: it accepts a validly signed token for an already-ended session (revoked, expired, or an account no longer `ACTIVE`), so it stays idempotent (204, cookie cleared) — but the token's session must still exist and belong to the token's subject, or it is 401 like any other route.

**1.5 Refresh** — cookie-only. Rotates token (reuse of a rotated token revokes the whole session family); slides expiry; returns `{ "data": { "user": <SessionUser>, "accessToken": "…", "expiresIn": 900 } }`. Invalid/expired → 401 (client hard-logs-out). *Mobile variant:* with `X-Client-Type: mobile`, refresh token travels in body instead of cookie (master guide §15).

**1.7 Forgot** — Body `{ "email" }`. **Always 202** `{ "data": { "accepted": true } }`. **1.8 Reset** — `{ "token", "password" }`; expired/used/unknown token → 422 `token_invalid`; policy violation → 422 `weak_password`; success 204; revokes all sessions; writes activity `password`. **1.9 Verify-email** — `{ "token" }` → 204 or 422 `token_invalid`.

**1.11 Session** — 200 `{ "data": { "user": <SessionUser> } }`; permissions are static per session (changes apply at next issue).

---

## 2. Users & Account [MOCK-SEAM settings + DERIVED admin panel]

**Tables:** DB §A4–A9, A12, J1.

| # | Method & Route | Description | Auth |
|---|---|---|---|
| 2.1 | `GET /me/account` | Account settings (username, phone, email, passwordUpdatedAt) | ✓ |
| 2.2 | `PATCH /me/account` | Update username (3–30, `/^[a-z0-9._-]+$/i`), phone (7–30) | ✓ |
| 2.3 | `POST /me/password` | Change password `{ currentPassword, newPassword }` — current must match, new must differ + policy | ✓ |
| 2.3a | `POST /me/password/verify` **[auth-seam §4.1, A-07]** | Lock-screen re-authentication `{ password }` → **204**, issuing nothing (no token, cookie or session); the open session continues. Wrong password → 401 `invalid_credentials`. Shares sign-in's attempt counter: the attempt that reaches `loginAttemptLimit` locks the account, **revokes the current session** and answers 429 `rate_limited` + `Retry-After`; a request while locked does the same. Two-factor accounts unlock in place (no challenge). Audited `auth.reauthenticate` / `auth.reauthenticate_failed` | ✓ |
| 2.4 | `GET /me/sessions` | Active sessions (`ActiveSession`: id, device, browser, ipAddress, location, startedAt, lastActiveAt, current) | ✓ |
| 2.5 | `DELETE /me/sessions/{sessionId}` · `POST /me/sessions/revoke-others` | Revoke one / all other sessions | ✓ |
| 2.6 | `GET /me/devices` · `POST /me/devices` · `DELETE /me/devices/{id}` | Trusted devices (`TrustedDevice`) | ✓ |
| 2.7 | `GET /me/login-history` | Paginated `LoginEvent` list (failures highlighted client-side) | ✓ |
| 2.8 | `GET /me/activity` | Paginated `ActivityEntry` feed (kind ∈ profile/password/login/settings/security/integration/privacy) | ✓ |
| 2.9 | `POST /me/2fa/setup` `{ password }` → `{ otpauthUrl, secret, recoveryCodes }` (**409** when 2FA is already on; **401** `invalid_credentials` for a wrong password, nothing issued — owner decision D2, 2026-11-14) · `POST /me/2fa/enable` `{ code }` · `POST /me/2fa/disable` `{ password }`. The password on `setup`, `disable` and `POST /me/password` spends from the shared sign-in guess budget (owner decision D1): the guess that reaches the limit, or any request while locked, revokes the calling session and answers **429** `rate_limited` | TOTP lifecycle | ✓ |
| 2.9a | `GET /me/2fa` → `{ enabled, recoveryCodesRemaining }` | 2FA settings view; the only place the remaining count is served (owner decision R2) | ✓ |
| 2.9b | `POST /me/2fa/reenroll` `{ password, code }` → `{ otpauthUrl, secret, enrolmentToken }` · `POST /me/2fa/reenroll/confirm` `{ enrolmentToken, code }` → `{ recoveryCodes }` | Replace an existing factor (owner decision Q7 / R4): current password + current-factor code, then a code from the new secret; only then are the factor and recovery codes replaced, atomically. The old factor and codes keep working until confirm succeeds | ✓ |
| 2.10 | `GET /admin/users` · `POST /admin/users` (invite) · `PATCH /admin/users/{id}` (role/active) | Platform users panel (`PlatformUser`: id, name, email, role ∈ PlatformRole, active, lastActiveAt) | can:`doctors.manage` or `roles.manage` |

Business rules: username unique; 2.3 revokes other sessions on success [RECOMMENDATION]; 2.10 deactivation is soft (never delete users with clinical trails).

---

## 3. Doctors — profile, verification, availability

**[MOCK-SEAM]** profile (DoctorProfileProvider / settings `profileSchema`); **[SPEC]** verification & availability (UX §3.2–3.3, 2.11; DB §B1, S1–S3).

| # | Method & Route | Description | Auth |
|---|---|---|---|
| 3.1 | `GET /me/profile` | Doctor (or admin) profile document. `doctor.photoUrl` is a **signed URL or `null`** — see *Doctor photo URLs* below | ✓ |
| 3.2 | `PATCH /me/profile` | Update profile; license-field edits ⇒ `verificationStatus:'pending'` + admin notification (audited) | ✓ |
| 3.3 | `PUT /me/profile/photo` | Photo upload (multipart field `photo`; `image/jpeg\|png\|webp`, ≤ 5 MB, bytes checked against the declared type → 422). Writes a `files` row (`kind = profile_photo`) and returns the 3.1 document — with `doctor.photoUrl: null` until the malware scan marks the new photo clean. Replacing a photo soft-deletes the previous `files` row (17.3's cleanup collects its object). 503 `service_unavailable` when object storage is unavailable | ✓ (doctor profile; 404 otherwise) |
| 3.4 | `GET /doctors` | Admin list: q (name/email/license), specialty, verification, status, joined range; columns need patientsCount, appointments30d, rating, lastActiveAt | can:`doctors.manage` |
| 3.5 | `GET /doctors/{doctorId}` | Admin detail (profile/documents/activity/appointments/statistics tabs) | can:`doctors.manage` |
| 3.6 | `POST /doctors/{doctorId}/verify` · `/request-documents` · `/reject` | Verification decisions; body `{ reason }` for reject/request (P4/audited, doctor notified) | can:`doctors.verify` |
| 3.6a | `GET/POST /me/verification-documents` **[NEW-46, 2026-11-15]** | The doctor's half of 3.6. `GET` lists the caller's documents, newest first, in 3.5's document shape (`kind`, `fileId`, `uploadedAt`, `expiresOn`, `decision`, `decidedAt`, `rejectReason`, `checks`). `POST { fileId, kind, expiresOn? }` files an upload made through 17.1 with `kind = verification_document`: `kind` ∈ `medical_license\|degree_certificate\|national_id\|other`, `expiresOn` a `YYYY-MM-DD` day → **201** with the document, `decision: 'pending'`. Another account's upload, another kind, a deleted or unknown id → **422** on `fileId` (one answer for all, not an existence oracle); an upload already filed → **409 `verification_document_already_filed`**; an account with no doctor profile → **404**. Audited `doctor.verification_document_upload` (document id and kind, never the filename). Does not change `verificationStatus` and never replaces a filed document. Once filed, the file is the reviewer's evidence: `DELETE /files/{id}` (17.3) on it answers **409 `verification_document_filed`**; an unfiled upload stays deletable. Review stays on 3.6 (`doctors.verify`): a doctor approving or rejecting their own document gets **403** | ✓ (own `doctors` row; every role reaches the guard, any account without a doctor profile gets 404) |
| 3.7 | `POST /doctors/{doctorId}/suspend` · `/reactivate` | Suspension with consequence preview (`affectedAppointments` count returned by 3.5) (P4/audited) | can:`doctors.manage` |
| 3.8 | `GET/PUT /me/availability` | Weekly grid (per-day toggles + ranges + breaks), defaultDurationMin ∈ {15,20,30,45,60}, bufferMin **[BR-DEC-005]** `GET` and `PUT` carry `clinicTimezone` (IANA, from `localization.timezone`, fallback `UTC`); `PUT` also returns `stranded[]` — live future appointments the new grid no longer covers, read in that zone (`{ id, scheduledAt, durationMin, status, patientId }`, never a name). A report: the save succeeds and nothing moves | doctor |
| 3.9 | `POST /me/time-off` | Vacation/emergency block `{ from, to, mode }` → returns impacted appointments for the emergency flow (module 5.8) | doctor |

Validation (3.2, from `profileSchema`): fullName 2–80, specialty 2–60, licenseNumber 3–40, yearsOfExperience 0–70, biography ≤600, languages ≤8, education ≤8, certifications ≤8, skills ≤12, URLs full (`.url()`), contactEmail email, contactPhone 7–30.

**Doctor photo URLs (2026-10-31).** Every response that carries a doctor's photo — 3.1 `doctor.photoUrl`, the 3.3 response, and on the patient surface `GET /patient/doctors`, `GET /patient/doctors/{id}`, `GET /me/appointments` and `GET /me/appointments/{id}` (embedded `doctor.photoUrl`; [`PATIENT_MOBILE_API_CONTRACT.md`](./PATIENT_MOBILE_API_CONTRACT.md) §3–§4) — carries `photoUrl: string | null` with one meaning:

- a **signed, short-TTL URL** a browser can load directly in an `<img>`: presigned against the object store, `Content-Disposition: inline`, valid for **60 seconds** (`DOWNLOAD_TTL_SECONDS`, the same TTL as 17.2). It is minted on every read and never stored, so clients must **re-read the resource for a fresh URL** rather than cache the URL itself;
- **`null`** when the doctor has no photo, when the photo has **not yet passed the malware scan** (unscanned or `infected` — the 17.2 gate, applied as `null` rather than a 403 so the surrounding document still loads), when the stored reference names no live profile photo, or when the URL could not be signed. Clients show initials.

The stored value (`doctors.photo_url`) is the photo's `files.id`; it never reaches the wire. A legacy value written before this change is either an absolute `https:` URL (returned unchanged) or a bare object-store key (never scanned → `null`). One server-side resolver (`shared/files/profile-photo-urls.ts`) serves all six responses with one `files` lookup per response. **Limitation:** URL signing is verified against the real S3 adapter's output and a local socket, not against a live S3-compatible store (RA-M25.1).

---

## 4. Patients [MOCK-SEAM list/profile bundle — `shared-domain/patient-identity`, `patients/model/profile-types.ts`]

**Tables:** DB §B3–B14. All doctor routes care-scoped; admin sees masked projections.

| # | Method & Route | Description | Auth |
|---|---|---|---|
| 4.1 | `GET /patients` | List. Params: `q` (auto-detect name/PT-id/phone/MRN + optional `scope=name|id|phone|mrn`), `status` (active/under-treatment/critical/follow-up/discharged), `gender`, `riskLevel`, `condition`, `ageMin/ageMax`, `lastVisitFrom/To`, `hasUpcoming`, sort (name/lastVisit/nextAppointment), page/pageSize | can:`patients.view` |
| 4.2 | `POST /patients` | Register (AddPatientDialog): name, dateOfBirth (past), gender, bloodType, phone, `email?`, `address?`, `insurance?`, `medicalNotes?`, allergies[], chronicConditions[] → generates `PT-…` id + MRN | doctor |
| 4.3 | `GET /patients/{patientId}` | List-shape `Patient` DTO (incl. derived `age`, `hasSevereAllergy`, `lastVisit`, `nextAppointment`, `assignedDoctor`) | can:`patients.view` |
| 4.4 | `GET /patients/{patientId}/profile` | Full `PatientProfileBundle` header + summary (latest vitals, top meds, conditions, next appointment, emergency contact, clinical alerts) | doctor |
| 4.5 | Tab endpoints: `GET …/history` (5-kind events) · `/appointments` · `/medications` · `/allergies` · `/documents` · `/notes` · `/studies` (imaging, grouped by category) · `/labs` (laboratory history, grouped by category — M15.3, served by the labs module) | Lazy per-tab fetch (P2 pattern) | doctor |
| 4.6 | CRUD children: `POST/PATCH/DELETE …/allergies/{id}` (allergen, severity mild/moderate/severe, reaction, notes) · `…/history` · `…/emergency-contacts` · `…/notes` (title, body; `signed` via `POST …/notes/{id}/sign`) · `…/vitals` (systolic/diastolic split) | Attributed (`recordedBy`), audited. **BR-DEC-003:** `DELETE …/history/{id}` requires `{ reason }` (1–300 chars, trimmed; 422 without it) and `DELETE …/emergency-contacts/{id}` accepts an optional `{ reason }`; both persist it on the soft-deleted row (`removal_reason`). Clinical-alert resolution — `PATCH /patients/{id}/alerts/{alertId}` `{ active: false, reason? }` — persists `resolutionReason` and returns it on the alert view; a `reason` without `active: false` is 422. Audit rows record that a reason was given, never its text | doctor |
| 4.7 | `POST /patients/{patientId}/documents` · `GET /patients/{patientId}/documents/{documentId}/download` | **[D-04 / D-04b]** Link an uploaded file to the Documents tab, and sign a download URL for one document. JSON, not multipart: the bytes go through `POST /files` (17.1) with kind `patient_document`. Body `{ fileId, category }`, category ∈ referral/consent/external-record/insurance/report → **201** `PatientDocumentView`; not linkable → 422 on `fileId`; already linked → 409 `document_already_linked`. Download → `{ url, expiresInSeconds: 60 }`; out of care scope → 404 **before** the scan gate; 403 `scan_pending` until clean. Full rules in **§4.7 detail** below | can:`patients.view` + care scope |
| 4.8 | `PATCH /patients/{patientId}` | Update status/riskLevel/contacts (audited) | doctor |
| 4.9 | `POST /patients/{patientId}/reveal` | **Unmask identity for admins — atomically audit-logged**; returns full name/MRN. Body `{ category: clinical-review\|patient-request\|safety-investigation\|billing-dispute\|legal-request, reason (≥12 chars trimmed, ≤500) }` (ADM-10's vocabulary) → **200** `{ patientId, fullName, mrn, email?, phone, dateOfBirth, revealed: true, revealedAt }`. Ledger unable to take the row → **503 `audit_unavailable`**, nothing disclosed. A doctor is care-scoped (out of scope → 404). The ledger keeps `category`, not `reason` **[M7.3]** | can:`patients.revealIdentity` |
| 4.10 | `GET /patients/export` | CSV respecting current filters (async job → file → notification if large). **[Implemented 2026-11-05 — synchronous]** §4.1's filters and `sort`, no paging; same scope as the list (a doctor's own patients in the clear, anyone else the masked `MaskedIdentity` columns). `text/csv` attachment, `Cache-Control: no-store`, RFC 4180 quoting, formula-leading text prefixed with `'`. More than 5,000 rows → **409 `export_too_large`** (the async path waits on M25.3, as RA-M21.2). Audited `patient.export` (warning) with the row count and filter *names* | can:`patients.view` |
| 4.11 | Admin governance [SPEC UX §3.4]: `GET /admin/patients` (masked columns) · `GET /admin/patients/{id}` (profile/activity/permissions tabs) · `POST …/unlock` · `/reset-credentials` (sends secure reset — admin never sets a password) · `/deactivate` (P4) · access-grant list/revoke/approve | can:`patients.manageAccounts` |

Business rules: severe allergy drives the fixed allergy strip — 4.3/4.4 must always include `allergies` + `hasSevereAllergy`; patient deletion does not exist (deactivate only); email/address/insurance optional fields appear only when provided (in-app registrations).

### 4.7 detail — patient documents: link and download

Both routes sit on `PatientTabsController` beside the `GET …/documents` tab (4.5). Responses use the
§0 envelope (`{ "data": … }`) and error shape.

**Authorization.** The route needs the `patients.view` capability, but the capability alone does not
grant access. Both routes first resolve the `PT-…` handle and then require a **care relationship**
through `PatientScopeService.assertCanReach`: the caller must be a doctor assigned to the patient. A
caller outside the care relationship gets `404 not_found` "Patient not found". That includes an
administrator, who holds `patients.view` without any care relationship. The body is identical to the
one for a patient that does not exist, so the answer never says which of the two it is. Request-body
validation (422 on the shape) runs before the scope check. It depends only on the body, so it reveals
nothing about the patient.

#### `POST /patients/{patientId}/documents` — link an upload

Request body (`application/json`):

| Field      | Type   | Rule                                                                           |
| ---------- | ------ | ------------------------------------------------------------------------------ |
| `fileId`   | string | UUID returned by `POST /files` (17.1), uploaded with kind `patient_document`   |
| `category` | string | One of `referral` · `consent` · `external-record` · `insurance` · `report`     |

The categories are the `DocumentCategory` enum (`backend/prisma/schema/01-enums.prisma`) in its wire form.

`201 Created` → `PatientDocumentView`, the same item shape the 4.5 Documents tab lists:

```json
{ "data": {
  "id": "uuid",
  "name": "original upload name, ≤200 chars",
  "category": "consent",
  "sizeKb": 1,
  "uploadedAt": "2026-10-31T12:00:00.000Z",
  "uploadedBy": "the caller's public user id, or null"
} }
```

`sizeKb` is rounded up from the stored byte count, the same rule `POST /files` uses, so the two
surfaces agree. The view carries no `fileId`. A client opens a document through the download route
below, not by holding the file id.

**Which uploads are linkable.** Only the caller's **own**, live, unlinked upload of kind
`patient_document`. The checks run in this order:

| Order | Condition                                                                                                                                                     | Status | Code                      |
| ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -----: | ------------------------- |
| 1     | Body is not `{ fileId: uuid, category: <enum> }`                                                                                                              | 422    | `validation_failed` (`fieldErrors.fileId` / `fieldErrors.category`) |
| 2     | Patient missing, or not in the caller's care                                                                                                                  | 404    | `not_found`               |
| 3     | Upload never issued, soft-deleted, its object already swept (M25.5), uploaded by another account, or of another kind                                          | 422    | `validation_failed` (`fieldErrors.fileId`) |
| 4     | Upload already linked to a live patient document, on this chart or any other                                                                                  | 409    | `document_already_linked` (with `detail`) |

The five causes in row 3 all produce one answer, so the response never confirms that some other
account holds an id.

**One upload, one document, even under concurrency.** The link runs in one transaction that takes
`SELECT … FROM files … FOR UPDATE` on the upload's row before it checks for an existing link and
inserts. Concurrent requests to link one upload, to the same patient or to different patients, are
therefore serialized. Exactly one gets `201`, and every other gets `409 document_already_linked`.
This relies on Postgres's default READ COMMITTED isolation. `patient_documents.file_id` has an index
but **no unique constraint**, so the guarantee holds for this route and not for a write that bypasses
it.

**The scan does not gate the link.** A pending or infected upload can be linked. The M25.3 gate
applies at download.

**Audit.** `patient.document_add` on `patient:{PT-…}`, metadata `{ documentId, category }`. The
filename is never recorded, because it is the field most likely to carry a patient's name. The row is
written after the link commits, as for the other 4.6 child writes.

#### `GET /patients/{patientId}/documents/{documentId}/download` — signed URL

`200 OK` →

```json
{ "data": { "url": "https://…signed…", "expiresInSeconds": 60 } }
```

The route returns a JSON body rather than a `302`, the same shape as `GET /files/{id}/download`
(17.2) and the record-attachment download (6.7). A redirect would put the signed URL, which is a
bearer credential for the bytes, into browser history and proxy logs. The URL is presigned by the
storage adapter, is valid for `DOWNLOAD_TTL_SECONDS` = **60 s**, and carries
`Content-Disposition: attachment; filename="<original name>"` as a signed parameter. The filename
has CR, LF, `"` and `\` stripped and is cut to 120 characters. The client must fetch the URL promptly.
It is not reusable after it expires, and a new call issues a new one.

**Check order. Scope comes before the scan gate.** A `403 scan_pending` names a real file, so it must
be unreachable for anyone who may not see that the file exists. Otherwise it is an existence oracle.

| Order | Condition                                                                                                                       | Status | Code                  |
| ----: | ------------------------------------------------------------------------------------------------------------------------------- | -----: | --------------------- |
| 1     | Patient missing, or not in the caller's care                                                                                    | 404    | `not_found` "Patient not found" |
| 2     | No live document with this id **on this patient**: never issued, malformed id, soft-deleted, its file soft-deleted, or belongs to another chart | 404    | `not_found` "Document not found" |
| 3     | File not yet scanned (`scan_result` null or anything but `clean`)                                                               | 403    | `scan_pending` "…still being scanned…" |
| 4     | File marked infected                                                                                                            | 403    | `scan_pending` "…rejected by the malware scan…" |
| 5     | Object store unconfigured or unreachable                                                                                        | 503    | `service_unavailable` |

The cases in row 2 share one body. A document id that exists on a chart the caller *can* reach gets
the same 404 under another chart as an id that was never issued. The gate turns on `scan_result`, not
`scanned_at`; see 17.2 and `shared/files/scan-gate.ts`.

**Audit.** A successful download writes `file.download` on `file:{fileId}` with metadata
`{ kind: "patient_document", patientId: "PT-…", documentId }`. That is the patient *handle*, never the
name, the filename or the URL. Every refusal above throws before signing, so a refused download writes
no `file.download` row.

**Live operation.** These routes need an object store (M25.2) and a scanner that marks files clean
(M25.3, run by M30.2). The bound `MALWARE_SCANNER` scans nothing, so until an engine is bound every
upload stays pending and every download answers `403 scan_pending`. The e2e suite
(`test/patient-documents.e2e-spec.ts`) drives the routes with an in-memory store double and sets
`scan_result` directly. It has not been run against a real object store.

---

## 5. Appointments [MOCK-SEAM `useAppointmentsQuery.ts` + status machine `availableActions()`]

**Tables:** DB §C1–C2, S2–S3. Statuses: `scheduled | confirmed | pending | completed | cancelled | rescheduled | no-show` (+ `awaiting-patient` per ADR). Priorities: `low|normal|high|urgent`.

| # | Method & Route | Description | Auth |
|---|---|---|---|
| 5.1 | `GET /appointments` | Doctor's book. Params: `view=list|day|week|month`, `date`, `from/to`, `status`, `visitType`, `priority`, `q` (patient), page/pageSize (list view). Items carry denormalized `patient` snapshot `{id, name, mrn, phone, age, gender}` | doctor (own) |
| 5.2 | `GET /appointments/{id}` | Detail + `events[]` history (action, from/to status, actor, occurredAt, reason, detail) | doctor/admin |
| 5.3 | `POST /appointments` | Create: `{ patientId, dateTime, durationMin>0, visitType, department, priority, reason (non-empty), notes? }` → 201, status `scheduled`; conflict vs availability/overlap → 409 | doctor |
| 5.4 | `POST /appointments/{id}/approve` | `pending → confirmed`; patient notified after commit | doctor |
| 5.5 | `POST /appointments/{id}/reject` | `pending → cancelled` — body `{ reasonCategory, reason? }` (P4/audited, patient notified) | doctor |
| 5.6 | `POST /appointments/{id}/reschedule` | From scheduled/confirmed/rescheduled: `{ dateTime, reason }` → `rescheduled`; patient re-confirms unless within auto-accept window | doctor |
| 5.7 | `POST /appointments/{id}/cancel` · `/complete` · `/no-show` | cancel: P4 reason; complete/no-show only when slot date ≤ today (else 409) | doctor |
| 5.8 | `POST /appointments/{id}/propose-slots` | Up to 3 alternative slots → `awaiting-patient` [SPEC] | doctor |
| 5.9 | `POST /me/time-off/{blockId}/resolve` | Emergency flow: per-appointment/bulk `{ action: reschedule-proposal \| handover \| cancel-apology }`; requires prior blast-radius confirmation `{ confirmedCount }` [SPEC UX §2.4] | doctor |
| 5.10 | Admin oversight [SPEC UX §3.5]: `GET /admin/appointments` (all doctors; filters + `flag=stuck-pending|repeated-reschedules|complaint`; `ageInState` field) · `POST …/{id}/nudge` (templated, logged) · `/reassign` `{ doctorId, reason }` (same specialty, live availability; both parties notified) · `/cancel-administratively` `{ reason }` | can:`appointments.reassign` / `appointments.cancelAdministratively` |
| 5.11 | `GET /appointments/summary` | Cards: today, pending, upcoming, completed-week (+ admin strip: pending>24h, cancellation/no-show rates) | doctor/admin |

**Transition matrix (server-enforced; illegal → 409 `conflict`):** `pending→{confirmed,cancelled}`; `scheduled|confirmed|rescheduled→{rescheduled,cancelled}` always, `+{completed,no-show}` when slot ≤ today; `awaiting-patient→{confirmed,cancelled,rescheduled}`; terminal: completed/cancelled/no-show. Every transition inserts an `appointment_events` row; **notifications only after commit** (outbox).

**Slot writes are serialised per doctor (BE-1).** 5.3 create, 5.6 reschedule and 5.10 `/reassign` check the slot and write it in one transaction holding the doctor's schedule lock (both doctors' for a reassign), so two concurrent requests for overlapping slots produce one success and one **409 `slot_conflict`** — never two bookings. If the lock is not granted within **5 s** (another request is changing the same schedule) the route answers **503 `service_unavailable`**, `detail` "The doctor's schedule is being changed by another request. Try again." Nothing was written; retrying is safe, and on 5.3 a retry with the same `Idempotency-Key` executes (§0.5 — a failed request releases its key). The 503 carries no SQL, lock or patient detail. A `/reassign` racing a cancellation or completion of the same appointment answers 409 `stale_write` instead of moving it.

Example — 5.5 reject:
```http
POST /api/v1/appointments/APT-3007/reject
{ "reasonCategory": "schedule_conflict", "reason": "Clinic emergency block" }
→ 200 { "data": { "id": "APT-3007", "status": "cancelled", … } }
```

---

## 6. Medical Records [MOCK-SEAM `medical-records/model/types.ts`]

**Tables:** DB §D1–D9. Status: `draft|active|completed|archived`; priority `low|normal|high|critical`. **Never hard-deleted; fully versioned.**

| # | Method & Route | Description | Auth |
|---|---|---|---|
| 6.1 | `GET /medical-records` | Params: `q`, `status`, `priority`, `visitType`, `department`, `diagnosisCode`, `from/to`, sort (visitDate), pagination. Items carry patient snapshot + `diagnoses[]` (primary shown) | can:`records.view` |
| 6.2 | `GET /medical-records/{id}` | Full document: chiefComplaint, historyOfPresentIllness, physicalExamination, diagnoses (one `isPrimary`), vitals, treatmentPlan[], medications[], allergies[], notes[], attachments[], timeline[], followUpDate | can:`records.view` |
| 6.3 | `POST /medical-records` | Create draft (patientId, visitDate, visitType, department, chiefComplaint non-empty, HPI, exam; optional children) — transactional; timeline `created` | can:`records.edit` |
| 6.4 | `PATCH /medical-records/{id}` | Update fields/children; every change → timeline event + version diff; one-primary-diagnosis enforced (partial unique). **[BR-DEC-004]** Author only — a caller who is not the record's doctor → **403 `not_record_author`**; optional `reason` (≤300) persisted on the version row; a body with only `reason` → 422 | can:`records.edit` |
| 6.5 | `POST /medical-records/{id}/status` | `{ status }` along draft→active→completed→archived (guarded) | can:`records.edit` |
| 6.6 | `POST /medical-records/{id}/notes` · `POST …/notes/{noteId}/sign` | Notes; signing freezes content; `aiAssisted` provenance persists; unsigned notes feed the action queue | can:`records.edit` |
| 6.7 | `POST /medical-records/{id}/attachments` (kind ∈ lab-result/imaging/referral/consent/external-report) · `GET …/attachments/{id}/download` | Files service. **[M12.5]** Body `{ fileId, kind, name? }` — `fileId` from `POST /files` with kind `record_attachment`, the caller's own, unlinked → **201** the record detail; not linkable → 422 on `fileId`; already linked → 409 `attachment_already_linked`; finalised record → 409 `record_not_editable`. Download → `{ url, expiresInSeconds: 60 }`, 403 `scan_pending` until clean, 404 out of care scope | can:`records.edit` (attach) · can:`records.view` (download) |
| 6.8 | `GET /medical-records/{id}/versions` | Before/after diffs for audit/investigation [DERIVED — UX 1.5.3 + logs diff viewer]; each version carries `reason` (string or null) **[BR-DEC-004]** | can:`records.view` (diffs also surface in module 14) |
| 6.9 | `POST /medical-records/{id}/report-issue` | Flag data error → admin queue `{ description }` [SPEC UX 2.3]. Notifies every active administrator (`Record data issue reported`, body `Record MR-…`, never the description) | doctor |
| 6.9a | `GET /admin/record-issues?status=&sort=reportedAt:asc\|desc&page=&pageSize=` · `PATCH /admin/record-issues/{id}` `{ status: investigating\|resolved }` **[RM M12.7, 2026-11-05]** | The admin queue behind 6.9: `{ id, status, description, record: { id, status, visitDate, department }, patientId (PT-… handle only), reportedBy, reportedAt, resolvedBy, resolvedAt, updatedAt, availableActions }`, oldest first. `open → investigating → resolved`, `open → resolved`; `resolved` terminal; illegal or lost move → 409 `invalid_status_transition`; unknown id → 404. Audited `record_issue.investigate` / `record_issue.resolve` | roles:`admin` |
| 6.10 | `GET /medical-records/summary` · `GET /medical-records/export` · `GET /medical-records/{id}/export` | Cards (open/completed/critical counts) + exports. **[Exports implemented 2026-11-05]** List export: §6.1's filters, CSV, same rules as §4.10. Single-record export: a `Field,Value` CSV (the frontend's `recordSummaryDataset` rows plus history, examination, vitals, allergies and **signed** notes only), care-scoped (out of scope → the same 404 as missing). Both audited `medical_record.export` | can:`records.view` |

---

## 7. Pharmacy / Prescriptions [MOCK-SEAM `pharmacy/model/*`]

**Tables:** DB §F1–F7 (+ `drug_interactions`, `medication_monographs`). Status: `pending-approval|active|completed|discontinued|expired` (+ `draft`, `dispensed` per ADR). Refills: `none|available|due|pending`, `0 ≤ refillsRemaining ≤ refillsAllowed`.

| # | Method & Route | Description | Auth |
|---|---|---|---|
| 7.1 | `GET /medications` | Formulary typeahead: `q` (name/generic), `category`, `form`, `route`, `controlled`, `highRisk` → `Medication` DTOs incl. `allergyClass`, `interactionNote` | doctor |
| 7.2 | `GET /medications/{id}/monograph` | Indications, contraindications, dosing, pregnancy category (reference-only) [DERIVED UX 2.7] | doctor |
| 7.3 | `GET /prescriptions` | Params: `q`, `status`, `refillStatus`, `patientId`, `medication`, `department`, `from/to`, `warningSeverity`, pagination. Items carry patient snapshot (incl. `allergies`, `hasSevereAllergy`) + medication + `warnings[]` | doctor (own) |
| 7.4 | `GET /prescriptions/{id}` | Full document: dosage, frequency, route, duration/durationDays, quantity, instructions, refill fields, warnings, notes, history, timeline | doctor |
| 7.5 | `POST /prescriptions/safety-check` | **The safety screen.** Body: `{ patientId, medicationId, dosage?, currentStep }` → `{ warnings: SafetyWarning[], blocking: boolean }` (kinds interaction/allergy/duplicate/dosage × severity info/warning/critical). Allergy match ⇒ `blocking: true` | can:`prescriptions.create` |
| 7.6 | `POST /prescriptions` | Create **draft**: patientId, medicationId, dosage, frequency, route, durationDays, quantity>0, refillsAllowed, instructions | can:`prescriptions.create` |
| 7.7 | `POST /prescriptions/{id}/sign` | Sign & send. Server **re-runs 7.5 in-transaction**: allergy conflict ⇒ 409 `code:"allergy_conflict"` (**no override**); severe interaction requires body `{ acknowledgedWarningIds: [...], reason }` else 409 `code:"acknowledgment_required"`; safety source down ⇒ 409 `code:"safety_check_unavailable"` (**draft-only, fail closed**). Success → status active/pending-approval + timeline `prescribed` | can:`prescriptions.create` |
| 7.8 | `POST /prescriptions/{id}/renew` | Returns a pre-filled draft from a prior Rx | can:`prescriptions.create` |
| 7.9 | `POST /prescriptions/{id}/discontinue` · `/cancel` | `{ reason }` (P4/audited) | can:`prescriptions.create` |
| 7.9a | `DELETE /prescriptions/{id}` **[BR-DEC-002, ADR-044]** | Discard an **unsigned draft** — soft delete → **204**; anything past `draft` → 409 `prescription_not_draft`; not the caller's prescription or already discarded → 404. Audited `prescription.discard` | can:`prescriptions.create` (prescriber only) |
| 7.10 | `POST /prescriptions/{id}/notes` · `GET /prescriptions/summary` · `GET /prescriptions/export` | Notes, cards, export. **[Export implemented 2026-11-05]** §7.3's filters, the prescriber's own list, CSV, same rules as §4.10; audited `prescription.export` | doctor |

Example — blocked sign:
```http
POST /api/v1/prescriptions/RX-200003/sign
→ 409 { "message": "Allergy conflict: Penicillin class", "code": "allergy_conflict", "detail": "Patient has a severe Penicillin allergy (anaphylaxis)." }
```

---

## 8. Laboratory [MOCK-SEAM `labs/model/*`]

**Tables:** DB §E1–E7. Pipeline `ordered→collected→processing→completed` (+`cancelled`); priorities `routine|urgent|stat`; flags `normal|low|high|critical-low|critical-high|abnormal`.

| # | Method & Route | Description | Auth |
|---|---|---|---|
| 8.1 | `GET /lab-tests/catalogue` | Test catalogue (code LOINC-style, name, category, analyte specs incl. reference + critical ranges) | doctor |
| 8.2 | `GET /lab-orders` | Params: `q` (patient/test/LAB-id), `status`, `category`, `priority`, `flag`, `reviewStatus`, `patientId`, `from/to`, pagination; items carry patient snapshot, `hasCriticalResult`, result summary counts | doctor (own orders / care-scoped) |
| 8.3 | `GET /lab-orders/{id}` | Full order: test info, orderedBy, clinicalIndication, specimen (type/container/site/collector/collectedAt/receivedAt/condition/volume), `results[]` (analyte, value, numericValue, unit, referenceRange{low,high,text}, flag), interpretation, attachments, timeline (7 kinds) | doctor |
| 8.4 | `POST /lab-orders` | Order: `{ patientId, testCode, priority, clinicalIndication, department }` → 201 `ordered` [DERIVED — ordering UI referenced from profile/records] | doctor |
| 8.5 | `POST /lab-orders/{id}/transition` | `{ to: collected\|processing\|completed\|cancelled, detail? }` — pipeline-guarded; specimen condition ∈ {Hemolyzed, Clotted, Insufficient volume} blocks `processing` (409) | doctor/lab role |
| 8.6 | `POST /lab-orders/{id}/results` | Enter/verify results: snapshots reference ranges, computes flags + `hasCriticalResult`; timeline `resulted`/`verified` | lab role [DERIVED] |
| 8.7 | `POST /lab-orders/{id}/review` | Mark reviewed. **Critical results: individual review only** (`bulk:false`); bulk allowed only when all flags normal; write failure must surface (no optimistic success) | can:`labs.review` |
| 8.8 | `GET /patients/{patientId}/lab-trends?analytes=a,b,c&from=&to=` | Time series per analyte (max 3), reference band included | doctor |
| 8.9 | `POST /lab-orders/{id}/attach-to-record` | `{ recordId, confirmedPatient: { name, mrn } }` — identity check must match (else 422) | doctor |
| 8.10 | `GET /lab-orders/summary` | Cards incl. **`criticalUnreviewed` count** (header chip; poll-friendly) | doctor |
| 8.11 | `POST /lab-orders/{id}/attachments` · `GET …/download` · `GET /lab-orders/export` | Attachments (report/addendum/external/raw-data) + export. **[Export implemented 2026-11-05]** §8.2's filters, the ordering doctor's worklist, CSV (counts and the critical flag, no result values), same rules as §4.10; audited `lab_order.export` | doctor |

---

## 9. Messaging [MOCK-SEAM `messaging/model/*`, `mock-messaging-service.ts`]

**Tables:** DB §G1–G5, S4–S5.

| # | Method & Route | Description | Auth |
|---|---|---|---|
| 9.1 | `GET /conversations` | Params: `folder=inbox|unread|starred|sent|drafts|archived`, `q`; items: participants, topic, lastActivityAt, unreadCount, pinned/starred/archived/muted, draft | can:`messages.send` |
| 9.2 | `POST /conversations` | `{ participantIds, topic? }` (doctor picker limited to own patients + colleagues) | can:`messages.send` |
| 9.3 | `GET /conversations/{id}/messages` | Paginated (cursor) messages: authorId, kind text/system, body (markdown-lite), sentAt, status, attachments | participant |
| 9.4 | `POST /conversations/{id}/messages` | Send `{ body, attachmentIds? }` → 201 `sent`; delivery/read progress via read receipts. **[M20.4, 2026-11-05]** `attachmentIds` are **file ids** from `POST /files` (kind `message_attachment`): the sender's own, live, never-attached uploads, ≤ 10, no repeats; anything else → **422 `validation_failed` on `attachmentIds`** and nothing is sent | participant |
| 9.5 | `PATCH /conversations/{id}/messages/{msgId}` | Edit — **≤5 min after send, patient threads**; sets `editedAt` (visible mark); delete not supported in patient threads (405) | author |
| 9.6 | `POST /conversations/{id}/read` | Mark read up to `{ messageId }` (drives unreadCount + read ✓✓) | participant |
| 9.7 | `PATCH /conversations/{id}` | pin/star/archive/mute/draft updates | participant |
| 9.8 | `GET /messages/search?q=` | Full-text within own threads | can:`messages.send` |
| 9.9 | `GET /contacts` | Directory (role, department, presence, lastActiveAt, favorite) | ✓ |
| 9.10 | Attachments: `POST /conversations/{id}/attachments` (scan-gated) · `GET /attachments/{id}/download` (403 until `scan=clean`) | Files service. **[M20.4]** The upload is `POST /files` + `attachmentIds` (one upload path, as §6.7): no second upload route is served | participant |
| 9.11 | Admin oversight [SPEC UX §3.6]: `GET /admin/conversations` (metadata only, patient masked) · `POST /admin/conversations/{id}/access-request` `{ justificationCategory ∈ complaint\|safety\|legal\|audit, reason }` → grant per policy (optional second-admin `POST …/access-requests/{id}/approve`) · `GET /admin/conversations/{id}/content` (read-only, watermarked, requires active grant; **every access audit-logged with ref**) · flags queue: `GET /admin/message-flags` · `POST …/{flagId}/resolve` `{ resolution, note }` (P4) | can:`communications.viewMetadata` / `viewContent` / `resolveFlags` |

---

## 10. Notifications [MOCK-SEAM `notifications/model/*`]

**Tables:** DB §G6–G8. Categories: appointments, medical-records, laboratory, pharmacy, patients, ai, system, security × priority normal/important/critical × kind alert/reminder/update.

| # | Method & Route | Description | Auth |
|---|---|---|---|
| 10.1 | `GET /notifications` | Params: `category`, `status=active|unread|read|archived`, `priority`, `q`, pagination; items = `DoctorNotification` incl. `related` ids (patientId/recordId/labId/prescriptionId/appointmentId) | ✓ |
| 10.2 | `POST /notifications/{id}/read` · `/unread` · `/archive` · `/favorite` · `/pin` | Row actions (optimistic client, rollback on failure) | ✓ |
| 10.3 | `POST /notifications/read-all` · `POST /notifications/clear-read` | Bulk actions (bell footer) | ✓ |
| 10.4 | `GET /notifications/badge-counts` | `{ notifications, messages }` unread counts — **poll target (10–15 s), must be O(1)-cheap**; display caps at 99+ client-side | ✓ |
| 10.5 | `GET/PUT /me/notification-preferences` | `NotificationPreferences`: channels {email,sms,push,desktop,inApp} × per-category booleans + quietHours {enabled, from "HH:MM", to}. **`categories.security` must remain true** (422 otherwise); quiet hours never suppress critical lab alerts | ✓ |
| 10.6 | `GET /notifications/summary` | Cards (unread/critical/by-category) | ✓ |

Server-side creation only (fan-out from domain events; critical items pinned until acted on).

---

## 11. AI Assistant [MOCK-SEAM `ai/model/*`, `mock-ai-service.ts`] — doctor-only

**Tables:** DB §H1–H4. All routes require can:`ai.use` (admins have no entry point).

**Implemented at M16.** Every model call goes through the `AI_GATEWAY` kernel port in `shared/ai`; `AI_API_KEY` is reachable from nowhere else, and `ai-containment.spec.ts` asserts both that boundary and the M16.6 rule that this module never writes a clinical table. Until `AI_PROVIDER`/`AI_API_KEY` are set, generation fails loudly — the message persists with status `error` carrying the 503's line — while every other route here works normally. Two additions beyond the table below: `GET /ai/model` (the status card's `{ name, version, configured }`, served rather than hard-coded so a client cannot claim a model the deployment is not running) and `feedback` on a message, so a refresh does not show a thumb un-pressed.

| # | Method & Route | Description |
|---|---|---|
| 11.1 | `GET /ai/conversations` (`q`, `favorite`) · `POST /ai/conversations` `{ context }` · `PATCH …/{id}` (title, favorite) · `DELETE …/{id}` (soft) |
| 11.2 | `GET /ai/conversations/{id}` — messages (role user/assistant, content, status complete/stopped/error) |
| 11.3 | `POST /ai/conversations/{id}/messages` — send user message; **response streams via SSE** (`text/event-stream`: token deltas, final `done` with message id/status); cancellable → status `stopped` |
| 11.4 | Context binding: `context = { mode: general\|patient\|record\|labs\|pharmacy, patientId?, refId? }`. Server resolves bound entities under the doctor's care scope; **partial/failed context ⇒ 409 (fail closed, no generation)**; one patient max per conversation |
| 11.5 | `GET /ai/prompts` — prompt templates (favorites via settings) |
| 11.6 | `GET/PUT /me/ai-settings` — temperature 0–1 (0.1 steps), responseLength concise/balanced/detailed, language en/ar, autoContext, streaming, favoritePromptIds |
| 11.7 | `POST /ai/messages/{id}/feedback` `{ rating: up\|down }` [DERIVED — quality telemetry, UX 2.5] |
| 11.8 | Saving to record happens through **module 6.6** with `aiAssisted: true` — there is deliberately no AI-side write into clinical tables |

---

## 12. Reports & Analytics [MOCK-SEAM `reports/model/*`]

**Tables:** DB §I1–I3. Doctor scope = own data only.

| # | Method & Route | Description |
|---|---|---|
| 12.1 | `GET /reports/analytics?category=overview|revenue|patients|appointments|laboratory|records|pharmacy|messages|ai&range=today|week|month|quarter|year|custom&from&to&compare=true&gender&ageBand` → `AnalyticsSnapshot` (KPI data with deltas, chart series, distribution data) per category view. `revenue` only when billing flag on (else the **flag-off alternate**, ADR-037: 200 with `{ category, billingEnabled: false, alternate: 'top-visit-types', notice, topVisitTypes[], range }` — never 404, never 500). Implemented at M17.2; the other eight categories answer 501 `not_implemented` until M21 |
| 12.2 | `GET /reports/insights?range=…` → `Insight[]` (workload/busiest/critical/pharmacy/lab/revenue/ai) |
| 12.3 | Saved reports: `GET/POST /reports/saved` (name + filter snapshot) · `DELETE …/{id}` |
| 12.4 | Scheduled: `GET/POST /reports/scheduled` (frequency daily/weekly/monthly, format, recipients) · `PATCH …/{id}` (pause/resume) · `DELETE` · `GET …/{id}/runs` (status sent/failed) — executor is a cron job; failures notify |
| 12.5 | `POST /reports/export` `{ category, filters, format: csv\|excel\|pdf }` → sync CSV or async job → file + notification |

---

## 13. Doctor Settings Center [MOCK-SEAM `settings/model/*`, `mock-settings-service.ts`] — reused by admins as “My Settings”

**Tables:** DB §J1–J3.

| # | Method & Route | Description |
|---|---|---|
| 13.1 | `GET /me/settings` — the full `SettingsDocument` (account, security meta, privacy, workflow preferences, integrations, appearance/accessibility prefs) |
| 13.2 | `PATCH /me/settings/{section}` — slice update (`privacy`: profileVisibility, surveyParticipation…; `preferences`: landingPage overview/patients/appointments/labs/messages, patientTab, recordsTab, dateFormat, timeFormat; `appearance`/`accessibility`: theme light/dark/system, density, textScale 90–130, focusRings) — validated per `settings/schemas.ts`, optimistic-concurrency 409 |
| 13.3 | Integrations: `POST /me/integrations/{id}/connect` · `/disconnect` (id ∈ google-calendar/outlook/zoom/teams; OAuth server-side, tokens encrypted, write-only) |
| 13.4 | `POST /me/data-export` — own-activity export request (async job → file → notification) [DERIVED UX 2.11 Privacy] |
| 13.5 | Account/security/activity endpoints — see module 2; profile — module 3 |

---

## 14. Audit & System Logs [MOCK-SEAM administration feed + SPEC UX §3.7]

**Tables:** DB §M1. Read-only for everyone — no mutation endpoints exist.

| # | Method & Route | Description | Auth |
|---|---|---|---|
| 14.1 | `GET /audit-events` | Filters: `q` (summary full-text), `actorRole=doctor|admin|system`, `actorId`, `category=authentication|security|user_action|admin_activity|system`, `severity=info|warning|critical`, `from/to` (time precision), `ip`; keyset pagination (100k+ rows); retention window returned in meta; `pivot` (counts by category and severity over the filtered set, never the page) on the first page, and on a cursor page only with `pivot=true` (`pivot=false` skips it) | can:`logs.view` |
| 14.2 | `GET /audit-events/{id}` | Full structured payload + before/after diff + `correlated` (same session / same actor ±5 min) | can:`logs.view` |
| 14.3 | `POST /audit-events/export` | CSV/JSON respecting filters — **the export itself writes an audit event** | can:`logs.export` |
| 14.4 | `GET/POST /me/incident-bookmarks` · `DELETE /me/incident-bookmarks/{id}` | Named saved event selections [SPEC] | can:`logs.view` |

Internal (not HTTP): `AuditService.write(event)` — the single choke point every module calls; INSERT-only.

---

## 15. Roles & Permissions [SPEC UX §3.9 + `types/auth` union]

| # | Method & Route | Description | Auth |
|---|---|---|---|
| 15.1 | `GET /roles` | Roles + member counts; `GET /permissions` — the 22-capability catalogue grouped by domain | can:`roles.manage` |
| 15.2 | `GET /roles/matrix` | capabilities × roles grid + `updatedAt` | can:`roles.manage` |
| 15.3 | `PUT /roles/matrix` | Full-grid update: body `{ grid, updatedAt, confirm: true }` — response to a dry run first: `POST /roles/matrix/preview` → `{ affectedUsers }`; concurrent edit → 409 with both change sets (merge dialog) — all changes audited | can:`roles.manage` |
| 15.4 | `POST /roles` | Custom role from base template `{ code, label, baseRoleId }` | can:`roles.manage` |
| 15.5 | `GET/PUT /users/{id}/permissions` | Per-user overrides | can:`roles.manage` |

---

## 16. Search, Dashboard & Shell

| # | Method & Route | Description | Auth |
|---|---|---|---|
| 16.1 | `GET /search?q=&scope=` | Role-scoped grouped results. Doctor: patients/appointments/records; admin: entities + administration sections/settings panels (`SearchResult{id,label,hint,section,path?}`) | ✓ |
| 16.2 | `GET /dashboard/doctor` | Overview composite: KPIs (todayCount+nextAt, pendingRequests, totalPatients, completedWeek+delta), todaySchedule[], actionQueue[] (pending requests, unreviewed critical labs, unsigned notes, stale messages — sorted urgency then age), trends (14-day series), satisfaction, recentActivity[], quickActions meta. Widgets may also be fetched individually (`/dashboard/doctor/schedule`, `/action-queue`, …) — UX loads widgets independently with per-widget errors. **`GET /dashboard/doctor/action-queue` is live (M15.4)**; the composite and its other widgets are M40 | doctor |
| 16.3 | `GET /dashboard/doctor/critical-alerts` | Row-0 banner: unreviewed abnormal labs, allergy conflicts on today's patients, urgent reschedules — **failure must be visible (fail loud)** | doctor |

---

## 17. Files [DERIVED — every attachment surface; DB §11]

| # | Method & Route | Description | Auth |
|---|---|---|---|
| 17.1 | `POST /files` | Multipart upload: `kind` ∈ profile_photo/patient_document/record_attachment/lab_attachment/message_attachment/verification_document/branding_asset; per-kind type/size validation; returns `{ id, name, sizeKb, mimeType }`; malware scan queued | ✓ (kind-scoped) |
| 17.2 | `GET /files/{id}/download` | Signed short-TTL redirect or stream; `Content-Disposition` set; **403 `scan_pending` until scan=clean**. Doctor photos are also served inline as `photoUrl` on the profile and patient surfaces, behind the same gate — see §3 *Doctor photo URLs* | owner/scoped |
| 17.3 | `DELETE /files/{id}` | Soft delete (orphan cleanup job handles storage). A `verification_document` filed through 3.6a answers **409 `verification_document_filed`** (NEW-46, 2026-11-15) | owner |

---

## 18. Administration Center — clinic operations [MOCK-SEAM `administration.api.ts` — every getter below exists in the mock]

**All routes:** admin role. **Tables:** DB §K1–K12. CRUD is [DERIVED] where the mock is read-only (the UI has add/edit affordances).

| # | Resource | Endpoints & notes |
|---|---|---|
| 18.1 | Overview | `GET /administration/overview` → `ClinicOverview` (todaysPatients/Appointments, waiting, completed, cancelled, doctorUtilization %, averageWaitingMinutes, clinicOccupancy %, hourlyActivity[]) |
| 18.2 | Staff | `GET/POST /administration/staff` · `PATCH/DELETE …/{id}` — role ∈ doctor/nurse/receptionist/laboratory/pharmacy, presence on-duty/on-break/off-duty/on-leave, permissions[] |
| 18.3 | Departments | CRUD — name, description, status active/inactive, headStaffId; `staffCount` derived |
| 18.4 | Rooms | CRUD — kind consultation/lab/procedure/pharmacy/waiting × status available/occupied/cleaning/maintenance, capacity>0 |
| 18.5 | Resources | CRUD — quantity, reorderLevel; status in-stock/low/out derived (`quantity ≤ reorderLevel`) |
| 18.6 | Schedule | `GET/PUT /administration/working-days` (7 rows: open, start<end, breakLabel) |
| 18.7 | Holidays | CRUD — kind public/clinic, recurring |
| 18.8 | Shifts | CRUD — staffId, kind morning/evening/on-call/vacation/leave, days boolean[7] |
| 18.9 | Queue | `GET /administration/queue` · `POST …/{id}/advance|assign-room|remove` — ticket, priority routine/priority/urgent, waiting/estimated minutes, delayed flag |
| 18.10 | Waiting room | `GET /administration/waiting-room` · `POST …/{id}/call|seat` (waiting→called→in-room) |
| 18.11 | Announcements | CRUD + pin/archive — priority low/normal/high, expiresAt |
| 18.12 | Policies | CRUD — category, summary, version bump on edit |
| 18.13 | Templates | CRUD — kind prescription/certificate/referral/lab-request/radiology-request/discharge; usageCount derived |
| 18.14 | Audit feed | `GET /administration/audit-events` (thin recent feed; full surface = module 14) |
| 18.15 | Platform status | `GET /administration/platform-status` → `PlatformStatus` (revenueMonth+delta, activeUsers, doctors, patients, departments, appointmentsMonth, growth, `system` health {status, uptimePercent, cpu/ram %, storage GB, apiResponseMs}, `license` {plan, seatsUsed/Total, renewsOn}, registrations[]) — sourced from monitoring + DB |
| 18.16 | Search | module 16.1 with admin scope |
| 18.17 | Background jobs **[BACKEND-ORIGINATED — M30.1]** | `GET /administration/jobs` → `{ driver inline\|bullmq, enabled, processLocal, jobs[] }` — per schedule: name, summary, cadence, `state` runnable\|blocked (+`blocked.reason`/`unblockedBy`), `nextRunAt` (null when blocked), retry policy, metrics · `GET …/jobs/dead-letters?job=` · `POST …/jobs/{name}/run` → **202** (409 `job_blocked` for a blocked schedule) · `POST …/jobs/dead-letters/{id}/replay` → **202**. Both mutations audited `job.trigger`/`job.replay` |

**18.17 has no mock seam, and that is stated rather than hidden.** Every other row
in this module is transcribed from `features/admin/`. This one is
backend-originated: M30.1 requires an admin-only view of the job registry, and the
frontend has no such screen to transcribe from. It is recorded here so M33.2's
coverage diff has a contract row to match rather than reporting a phantom route,
and ADR-041 §3 records why it exists instead of a mounted Bull Board.

---

## 19. Platform Settings [MOCK-SEAM `admin-settings.*` — 16 panels]

**All routes:** can:`settings.manageSystem` (integrations panel: can:`integrations.manage`). **Tables:** DB §L1–L4. Every write is audited; risky slices require `confirm: true`.

| # | Method & Route | Description |
|---|---|---|
| 19.1 | `GET /platform-settings` | Full `AdminSettingsDocument` (11 form slices + users/integrations/apiKeys/backups collections) |
| 19.2 | `PATCH /platform-settings/{slice}` | slice ∈ general/organization/branding/localization/notifications/security/email/sms/backup/retention/privacy — Zod-validated per the slice interfaces; optimistic concurrency; **security & retention slices require typed confirmation** (`confirm: true` + audited consequence text) |
| 19.3 | Users | module 2.10 |
| 19.4 | API keys | `POST /platform-settings/api-keys` → **full key returned exactly once** `{ key, prefix }`; `GET` lists prefix-only; `POST …/{id}/revoke` |
| 19.5 | Integrations | `GET /platform-settings/integrations` · `PATCH …/{id}` (config write-only, encrypted) · `POST …/{id}/test-connection` → result trail · enable/disable (P4 consequence summary) |
| 19.6 | Backups | `GET /platform-settings/backups` · `POST /platform-settings/backups` (manual) · `POST …/{id}/restore` [DERIVED — restore requires out-of-band confirmation policy] |
| 19.7 | Maintenance mode | via 19.2 general slice — when on, middleware returns 503 + message to non-admin requests |

---

## 20. Health & Meta

| # | Method & Route | Description | Auth |
|---|---|---|---|
| 20.1 | `GET /health` | Liveness `{ status, services: { db, redis, storage, mail, ai } }` — feeds the System Health card | — |
| 20.2 | `GET /ready` | Readiness probe | — |
| 20.3 | `GET /meta/enums` [RECOMMENDATION] | Server's enum vocabulary for contract tests | ✓ |

---

## Appendix A — Endpoint ↔ frontend seam map (integration checklist)

| Frontend seam (swap point) | Contract modules |
|---|---|
| `features/auth/mock/mock-auth-service.ts` + `session-store.ts` | 1 |
| `features/doctor/appointments/api/useAppointmentsQuery.ts` | 5 |
| `features/doctor/patients/api/usePatientsQuery.ts`, `usePatientProfileQuery.ts` | 4 |
| `features/doctor/medical-records/api/useMedicalRecordsQuery.ts` | 6 |
| `features/doctor/labs/api/useLabTestsQuery.ts` | 8 |
| `features/doctor/pharmacy/api/usePrescriptionsQuery.ts` | 7 |
| `features/doctor/messaging/api/useMessagingQueries.ts` | 9 |
| `features/doctor/notifications/api/useNotificationsQuery.ts` + `ShellBadgesProvider` | 10, 16 |
| `features/doctor/ai/api/useAiQueries.ts` | 11 |
| `features/doctor/reports/api/useReportsQueries.ts` | 12 |
| `features/doctor/settings/api/useSettingsQueries.ts` | 13, 2, 3 |
| `features/admin/administration.queries.ts` | 18 |
| `features/admin/admin-settings.queries.ts` | 19, 15 |
| `app/providers/DoctorProfileProvider.tsx` / `admin-profile.ts` | 3 |
| `features/doctor/dashboard/model/mock-data.ts` | 16.2–16.3 |
| `features/admin/appointments/oversight.queries.ts` | 5.10 |
| `features/admin/phi/` + `administration.api.ts → phiAccess` | 4.9, 14 |
| `features/admin/sections/settings/PermissionMatrixPanel.tsx` | 15.2–15.3 |

**Path corrections (ADR-009, M0.4).** The administration module was renamed `features/doctor/administration/` → `features/admin/` (frontend checklist D-28); the two administration rows are repointed accordingly. The last three rows are seams that shipped after this contract was first written — ADM-05 appointment oversight, ADM-10 PHI governance, ADM-09 permission matrix — and are live consumers with behaviour the server must match. All eighteen paths were re-verified against the tree on 2026-08-12. No endpoint, field, status code, or shape was changed.

## Appendix B — Notes & open items

1. Endpoints marked [SPEC] implement confirmed UX scope with no coded consumer yet (verification, admin oversight, content-access gate, availability) — build them; the admin surfaces will consume them.
2. Enum unifications (appointment `awaiting-patient`, prescription `draft`/`dispensed`) follow the Phase-0 ADRs; update this contract when resolved. *Resolved in the client on the `backend` → `frontend` integration (2026-10-31): the frontend's `AppointmentStatus` and `PrescriptionStatus` unions now carry all three, and `test/meta-enums.e2e-spec.ts` asserts set equality with `/meta/enums` rather than the earlier superset.*
3. Realtime upgrade path: 10.4/16 polling endpoints may later be complemented by SSE invalidation pushes without changing response shapes.
4. All timestamps ISO-8601 UTC; all ids are the business ids the frontend displays (`PT-…`, `APT-…`, `MR-…`, `LAB-…`, `RX-…`, `usr_…`) with UUID internals hidden behind them.

*End of API contract.*
