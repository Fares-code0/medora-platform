# Medora — Patient Mobile API Contract

**Status:** **§1 Authentication, §2.1 Profile, §3 Doctor discovery, §4 Appointment reads and §5 Notifications are LIVE.** ADR-030 (patient identity) and ADR-034 (the token-in-body auth variant) are accepted and implemented, and all of the above are tested against a real database. **Appointment writes (§4.4–4.6), §6 clinical data, §7 messaging and §8 AI are not built** — each is blocked on a decision or a milestone named in place. §6 remains blocked on **ADR-031**, which is still open.
**Companion to:** [`BACKEND_API_CONTRACT.md`](BACKEND_API_CONTRACT.md) — this is an addendum, not a replacement. Every convention in that document's §0 applies here unchanged and is **not** repeated.
**Derived from:** `patient-app/PATIENT_APP_AUDIT.md` §14 (56 mapped capabilities), the existing API contract, and ADR-030 / ADR-031.
**Audience:** the Patient Mobile frontend developer. You should be able to implement every screen against this document without reading backend source.

> ⚠ **Multi-Hospital — FINAL owner decisions (2026-10-07).** The LIVE routes below stay as they are. Their future shape follows [`docs/multi-hospital/API_CONTRACT_CHANGES.md`](../../docs/multi-hospital/API_CONTRACT_CHANGES.md) §5–§7, which proposes, unimplemented:
> - authenticated hospital and doctor discovery with distance, ratings/reviews and insurance (uninsured patients unrestricted);
> - doctor-published slots with capacity 1;
> - `slotId` booking;
> - one Medical Record per hospital, created on first real interaction.
>
> Discovery stays **authenticated**: there is no public directory (DR-09). Where §4.3 and §10 below disagree, the decisions win.

---

## 0. How to read this, and what it guarantees

This document exists so the mobile client is not blocked on backend implementation. It is **contract-first**: the shapes below are fixed now so the client can build its transport layer, its types, its query keys and its mock adapter against a contract that will not move underneath it.

**What it guarantees:** if a route below is later implemented, it is implemented in this shape. A change to a shape here is a change to this document first, in the same pull request.

**What it does not guarantee:** a date. Every route carries an explicit readiness state, and three of them are blocked on decisions no engineer may take alone.

### 0.1 Readiness vocabulary

| State | Meaning for the mobile client |
|---|---|
| ✅ **LIVE** | Implemented and e2e-tested in the backend **today**. Build against the real endpoint |
| 🟠 **CONTRACT — GATED ON ADR-030** | Shape is fixed. Blocked only on owner approval of patient identity. Build against the mock seam; the swap is an adapter change |
| 🔴 **BLOCKED BY ADR-031** | Shape is fixed but the endpoint **must not ship** until the results-release policy is decided. Build the screen; expect fixtures for longer |
| ⬜ **NOT MVP** | Out of the first patient-mobile slice. Do not build |
| ➖ **NO BACKEND** | Frontend-only. Nothing to wait for |

### 0.2 Inherited conventions — read `BACKEND_API_CONTRACT.md` §0, then these deltas

Everything in §0 of the main contract holds: `/api/v1` base path, `{ data }` success envelope, the `{ message, code, fieldErrors, detail, ref }` error envelope, `Paginated<T>`, `X-Correlation-Id`, the 30 s timeout, `Idempotency-Key` on state-changing POSTs, and the status→client-kind mapping.

Four deltas apply to a mobile client specifically:

1. **`X-Client-Type: mobile` selects the whole mobile auth mode.** Send it on **every** auth request. On the request side `/auth/refresh` reads the token from the body; on the response side `login`, `otp/verify` and `refresh` return `data.refreshToken` and set no cookie (ADR-014, ADR-034, MG §15.2). Only the exact lowercase value `mobile` selects it — `Mobile` and any other value are treated as a web client, so a typo fails closed into the cookie mechanism.

   On the **request** side the header remains a *fallback selector*, not an override: a cookie, when present, always wins, so an attacker who controls a header cannot talk a browser into sending its token in a body.

   ✅ **Closed by ADR-034 (2026-09-02).** The header is now honoured on **all three routes that mint a refresh token** — `login`, `otp/verify` and `refresh` — on the response side as well as the request side. Under `X-Client-Type: mobile` you receive `data.refreshToken` in the body and **no cookie is set**; without the header you get the `httpOnly` cookie and no body token. Exactly one copy of the credential is issued either way. A previous revision of this document described the old asymmetry and told you to parse `Set-Cookie`; **that is no longer necessary and no longer correct.**
2. **`401` means token, and nothing else** (ADR-013). Branch on the error `code`, never on the status alone. `invalid_credentials` is a wrong password and must **not** trigger refresh-then-logout; only a token failure may. The web client has a recorded defect here (`REPO_AUDIT.md` §4, finding 3.2 — `normalizeHttpError` drops `code`). **Read `code` from day one.**
3. **Ownership failures return `404`, never `403`.** See §0.4. Render them as "not found", not as "forbidden".
4. **The server owns every business rule.** The client renders `availableActions` from the server; it never computes whether a cancel is allowed. See §4.

### 0.3 Authentication state machine

```
cold start
   │
   ├─ refresh token in secure storage?  ──no──▶  Welcome / Login
   │                                   
   └─yes─▶ POST /auth/refresh  (X-Client-Type: mobile, token in body)
              │
              ├─ 200 ▶ accessToken in MEMORY ONLY ▶ authenticated
              │        + store the ROTATED refreshToken from the body
              └─ 401 ▶ clear secure storage ▶ Welcome / Login
```

Send `X-Client-Type: mobile` on login, OTP verify and refresh alike; each returns `data.refreshToken` and sets no cookie. **Replace the stored token on every refresh** — presenting a rotated-away token is treated as reuse and revokes the whole session family (ADR-026), logging the user out everywhere. That behaviour is unchanged by the body variant and is covered by tests. **One exception (ADR-045):** within 30 seconds of a rotation, re-sending the token it retired — a retry after a lost response, or two concurrent refreshes — returns `200` with the *same* `data.refreshToken` the rotation issued, rather than revoking. Store whatever the response carries, as always; after 30 seconds the reuse rule above applies.

**Storage rules, non-negotiable:** the access token lives in memory only — never `AsyncStorage`, never a persisted store, never a log line. The refresh token lives in iOS Keychain / Android Keystore (`expo-secure-store`). Logout clears secure storage **and** calls `POST /auth/logout`. A biometric gate protects the app, never the token.

### 0.4 Ownership — the rule behind every `/me/*` route

Every route below whose path begins `/me/` resolves the caller's `users.id` to their own patient record through `patients.user_id` (ADR-030 §1) and scopes the query to it. Three consequences the client must expect:

- **A patient can never address another patient's row.** There is no `patientId` parameter on any `/me/*` route, by design — the subject is the token.
- **An id that exists but is not yours returns `404`, not `403`** — mirroring `PatientScopeService`'s established discipline (M7.2), so walking `APT-3001, APT-3002, …` cannot enumerate the clinic's bookings.
- **An authenticated-but-unlinked account** (registered, never claimed a clinical record — ADR-030 §4) is the normal resting state after signup. It returns `200` with `patient: null` on `GET /me/profile`, and **empty collections**, never an error, on every clinical list. **The client must render this state as a first-class "complete your registration at the clinic" case, not as an error.**

---

## 1. Authentication — mostly LIVE today

The transport is built. Only the `patient` role value and one route are missing.

| # | Method & Route | Auth | State | Note |
|---|---|---|---|---|
| P1.1 | `POST /auth/register` | — | ✅ **LIVE** | `role` accepts `patient` (ADR-030) |
| P1.2 | `POST /auth/login` | — | ✅ **LIVE** | Returns `refreshToken` in the body under the header (ADR-034) |
| P1.3 | `POST /auth/otp/verify` | otp token | ✅ **LIVE** | Returns `refreshToken` in the body under the header (ADR-034) |
| P1.4 | `POST /auth/otp/resend` | otp token | ✅ **LIVE** | |
| P1.5 | `POST /auth/refresh` | body + `X-Client-Type: mobile` | ✅ **LIVE** | Token in **and** out of the body under the header (ADR-034) |
| P1.6 | `POST /auth/logout` | ✓ | ✅ **LIVE** | |
| P1.7 | `POST /auth/forgot-password` | — | ✅ **LIVE** | Always `202`, anti-enumeration |
| P1.8 | `POST /auth/reset-password` | — | ✅ **LIVE** | Revokes all sessions |
| P1.9 | `POST /auth/verify-email` | — | ✅ **LIVE** | |
| P1.10 | `POST /auth/verification/resend` | — | ✅ **LIVE** | Rate-limited |
| P1.11 | `GET /auth/session` | ✓ | 🟠 **specified, absent** | API §1.11 / roadmap M8.1. The cold-start call. **Use P1.5's response payload until it lands** — it carries the same `user` object |
| P1.12 | `POST /me/password` | ✓ | ✅ **LIVE** | |
| P1.13 | `POST /me/2fa/setup` · `/enable` · `/disable` | ✓ | ✅ **LIVE** | Optional for patients |

### P1.1 — Register (the one change to an existing route)

**Only the `role` enum widens.** Every other field, bound and error is unchanged from API §1.1.

```http
POST /api/v1/auth/register
Content-Type: application/json
```
```json
{
  "firstName": "Sara",
  "lastName": "Al-Amin",
  "email": "sara@example.com",
  "phone": "+966501234567",
  "password": "…",
  "role": "patient",
  "acceptTerms": true,
  "acceptPrivacy": true
}
```

| Field | Rule |
|---|---|
| `firstName`, `lastName` | 1–60 chars, required |
| `email` | RFC email. Existing → **409 `email_taken`** |
| `phone` | `/^\+?[0-9][0-9\s-]{6,18}$/` |
| `password` | ≥8, upper + lower + digit + symbol → else **422 `weak_password`** |
| `role` | **`doctor \| admin \| patient`** ← the only change |
| `licenseNumber` | ≤40, optional. **Not applicable to patients**; omit it |
| `acceptTerms`, `acceptPrivacy` | Literal `true`. `false` is a validation error, not a stored `false` |
| `confirmPassword` | Client-side only; the server strips it |

**201:**
```json
{ "data": { "nextStep": "verify-email", "email": "sara@example.com" } }
```

**Critical for onboarding UX (ADR-030 §4):** registration creates an **account and nothing else**. It does **not** create a clinical record and does **not** link to an existing one. A patient who has been seen at the clinic is *not* automatically connected to their chart — that is a separate identity-proofing flow which is **explicitly undecided** (ADR-030 RA-030.1). Design the post-signup screen for an account with no clinical data. Do not promise the user their records will appear.

**Errors:** `409 email_taken` · `422 weak_password` (+ `fieldErrors`) · `422` validation with `fieldErrors` · `429 rate_limited` (+ `Retry-After`).

### P1.5 — Refresh, mobile variant (LIVE — build against this now)

```http
POST /api/v1/auth/refresh
X-Client-Type: mobile
Content-Type: application/json

{ "refreshToken": "<from secure storage>" }
```
```json
{ "data": { "user": { "id": "usr_…", "name": "Sara Al-Amin", "email": "sara@example.com",
                      "role": "patient", "permissions": [] },
            "accessToken": "eyJ…", "expiresIn": 900,
            "refreshToken": "<rotated — replace what you stored>" } }
```
**No `Set-Cookie` is issued.** The rotated `refreshToken` is in the body — replace what you stored, atomically, before the next request.

**`user.id` is the client-facing `usr_…` public identifier**, not the database key — the two are deliberately distinct (`AuthenticatedUser`, "two ids"). Quote it in logs and support tickets; it is the only user id the API ever emits.

Three rules the client must honour:
- **Single-flight.** Concurrent 401s queue behind **one** refresh and replay. A second refresh with an already-rotated token is treated as reuse and **revokes the entire session family** (ADR-026) — the user is logged out everywhere.
- **Always replace the stored token** with the rotated one, atomically.
- **`401` here is terminal.** Clear secure storage and return to Welcome.

**Note `permissions: []`.** A patient holds **zero capabilities** by design (ADR-030 §6) — this is correct, not a bug, and it is what closes every clinician route to them automatically. The client must not gate patient features on this array; it will always be empty.

---

## 2. Patient profile — `/me`

| # | Method & Route | Auth | State |
|---|---|---|---|
| P2.1 | `GET /me/profile` | ✓ | ✅ **LIVE** |
| P2.2 | `PATCH /me/profile` | ✓ patient, self | 🟠 **BLOCKED BY RA-030.2** — the editable field set is undecided |

### P2.1 — `GET /me/profile`

**200 — linked account:**
```json
{ "data": {
  "account": { "id": "usr_…", "firstName": "Sara", "lastName": "Al-Amin",
               "displayName": "Sara Al-Amin", "email": "sara@example.com",
               "phone": "+966501234567", "emailVerified": true,
               "twoFactorEnabled": false, "avatarUrl": null },
  "patient": { "id": "PT-1042", "fullName": "Sara Al-Amin", "dateOfBirth": "1994-03-11",
               "age": 31, "gender": "female", "bloodType": "O+",
               "phone": "+966501234567", "email": "sara@example.com",
               "address": "…", "photoUrl": null,
               "registeredAt": "2026-01-08T09:12:00.000Z", "lastVisitAt": "2026-08-02T10:00:00.000Z" }
} }
```

**200 — authenticated but unlinked (the state after signup):**
```json
{ "data": { "account": { "…": "as above" }, "patient": null } }
```

**`patient: null` is a success, not an error.** Render the "not yet linked" state — a 404 on one's own profile is indistinguishable from a broken session, and a mobile client's natural response to that is to log the user out.

The route is `@Authenticated()`, not patient-only: a doctor or admin calling it gets their own `account` with `patient: null`, because no clinical record links to their user row. That is correct for a self-service route and discloses nothing.

`gender` and `bloodType` arrive as the **wire vocabulary** — `female`/`male`, `A+`…`O-` — not as the Prisma member names (`FEMALE`, `O_POSITIVE`). ADR-023 §2 makes that mapping the API layer's job, and it is done server-side.

**Deliberately absent from this projection, and they will not be added:** `mrn`, `status`, `riskLevel`, `medicalNotes`, `assignedDoctorId`, `createdBy`/`updatedBy`. `medicalNotes` is a clinician's free-text working note about the patient and is not a patient-facing field; `riskLevel` and `status` are clinical triage classifications whose disclosure without clinical context is a patient-safety question, not a UI decision. `age` is **derived server-side**, never stored (DB §14.5-6) — do not compute it on the client from `dateOfBirth`, so the two cannot disagree.

**Errors:** `401` (no/invalid token) · `404` (the token is valid but the account row is gone — deactivated or deleted).

### P2.2 — `PATCH /me/profile` — 🟠 **REQUIRES PRODUCT DECISION**

**Not implemented, and not specifiable yet.** The repository was searched for a definition of patient self-service authority and there is none:

| Looked for | Found |
|---|---|
| A patient-editable field list | **Nothing** |
| `PATCH /patients/{id}` (API §4.8) | Exists — *"Update status/riskLevel/contacts (audited)"*, auth **`doctor`**. A clinician route |
| M10.2 "Create, update, soft deactivate" | Clinician workflow (AddPatientDialog) |
| UX patient self-service screens | **Nothing** |

Writing this endpoint means choosing a data-ownership policy, which is ADR-030 **RA-030.2** / audit **AD-2**. Four questions need answers before a line is written:

1. **Which fields may a patient change?** The candidates are `phone`, `address` and the contact `email`. `fullName`, `dateOfBirth`, `gender` and `bloodType` are clinical-record identity — a patient editing their own date of birth changes their age on every clinical screen.
2. **Who wins when a clinician edits the same field?** The audit recommends clinician-wins with an audit row. Nobody has agreed it.
3. **Does an edit need verification?** Changing a phone number silently re-points the number a future OTP or appointment reminder goes to.
4. **Does it apply to an unlinked account?** There is no record to patch, so it is a 404 — but that needs stating rather than inferring.

**Until those are answered the route stays absent.** Build the profile screen read-only; the edit affordance is one form behind a flag.

---

## 3. Doctor discovery — the patient-safe projection

| # | Method & Route | Auth | State |
|---|---|---|---|
| P3.1 | `GET /patient/doctors` | ✓ | ✅ **LIVE** |
| P3.2 | `GET /patient/doctors/{doctorId}` | ✓ | ✅ **LIVE** |
| P3.3 | `GET /patient/specialties` | ✓ | ✅ **LIVE** |
| P3.4 | `GET /patient/departments` | ✓ | 🟠 **NOT BUILT** — `departments` is the administration module's table (ADR-004, M23), and putting its read in the doctors module would misplace ownership. Filter by `departmentId` works today; build the chip list from `departmentName` on the results until M23 lands |

**These are NOT `GET /doctors`.** API §3.4's `GET /doctors` is an **administrator roster** gated on `can:doctors.manage` and returns the internal Doctor entity. It must never be reused for a patient client. These are a separate server-side projection (ADR-030 §10).

**Authenticated, not public — now an owner decision (DR-09, 2026-10-07): no public directory will be added.** The audit sketched these as `/public/*`. They are specified here as **authenticated** instead, for one reason: **no rate limiting exists anywhere in this backend today** (audit BE-17/R-9). An unauthenticated `GET /public/doctors/{id}` is an enumeration surface over the clinic's practitioner roster with nothing in front of it. Requiring a token puts a revocable credential and a session trail on every read. If a genuinely public pre-login directory is wanted later, it arrives with rate limiting, not before.

### P3.1 — `GET /patient/doctors`

**Query params** (all optional): `q` (case-insensitive name match) · `specialtyId` (uuid) · `departmentId` (uuid) · `sort` ∈ `name:asc|name:desc|rating:desc` · `page` (1-based, default 1) · `pageSize` (default 20, **max 100**).

⚠ **`doctors` has no public `doc_…` handle.** Unlike `patients` (`PT-…`), `users` (`usr_…`) and `appointments` (`APT-…`), the `doctors` table carries no `public_id` column — so `id` here is the raw uuid, and that is what `GET /patient/doctors/{doctorId}` expects. A malformed id answers **404**, not 500.

**Out-of-range params are rejected, not clamped.** `pageSize=5000` is **422** with `fieldErrors`, and so is a `sort` value outside the whitelist. The client should not send them; if it does, it gets a validation error rather than a silently different result.

**200** — `Paginated<PatientDoctorSummary>`:
```json
{ "data": { "items": [ {
      "id": "3f1c…-uuid", "fullName": "Amelia Chen", "title": "Dr.",
      "specialty": "Cardiology", "departmentName": "Cardiology",
      "photoUrl": "…", "yearsOfExperience": 12,
      "languages": ["en", "ar"], "ratingAvg": 4.7
  } ], "page": 1, "pageSize": 20, "totalItems": 43, "totalPages": 3 } }
```

**Server-side defaults that are safety properties, not filters** — the client cannot turn them off and must not offer a toggle: only `verification_status = 'verified'` and an active practice status are returned. Showing an unverified or suspended practitioner to a patient is a patient-safety issue.

### P3.2 — `GET /patient/doctors/{doctorId}`

**200** — `PatientDoctorDetail` = the summary above **plus** `biography`, `education[]`, `certifications[]`, `skills[]`, `officeLocation`, `officeHours`, and `specialties[]` (`{ id, name }`, primary first).

`ratingAvg` is a **number or null** — null when no satisfaction survey has been recorded. It is stored as a SQL `DECIMAL` and converted server-side, so it never arrives as an object.

**404** if the doctor does not exist **or** is unverified/inactive — the same response for both, so the endpoint cannot be used to discover that a suspended practitioner exists.

### P3.3 / P3.4 — Specialties and departments

**200** — flat arrays for filter chips: `{ "data": [ { "id": "…", "name": "Cardiology", "parentId": null } ] }` and `{ "data": [ { "id": "…", "name": "Cardiology" } ] }`.

### 🔒 The forbidden-field list — binding, and covered by a contract test

**No patient-facing response may contain any of these**, at any nesting depth, on any route in this document:

```
license_number / licenseNumber        license_expires_on / licenseExpiresOn
employee_id / employeeId              contact_email / contactEmail
contact_phone / contactPhone          emergency_contact_name / emergencyContactName
emergency_contact_phone / emergencyContactPhone
linkedin_url / linkedinUrl            verification documents
```

Three contract tests enforce this against the **serialized response body**, not against a TypeScript type — a type proves what the compiler was told, only the wire proves what a client receives. Two assert that no forbidden **key** appears at any nesting depth in the list and detail responses; the third asserts that no forbidden **value** appears anywhere in the raw JSON, which catches the subtler failure of someone mapping `licenseNumber` into a field called `credentials`. The list lives in code as `FORBIDDEN_DOCTOR_FIELDS` (`src/modules/doctors/dto/patient-doctor.dto.ts`), so it is an assertable value rather than an omission. Hiding a field in a React Native screen leaves it on the network and in every proxy log. **Frontend authorization is not authorization.**

---

## 4. Appointments — reads LIVE, writes blocked

| # | Method & Route | Auth | State |
|---|---|---|---|
| P4.1 | `GET /me/appointments` | ✓ | ✅ **LIVE** |
| P4.2 | `GET /me/appointments/{appointmentId}` | ✓ | ✅ **LIVE** |
| P4.3 | `GET /patient/doctors/{doctorId}/slots` | ✓ | 🟠 **BLOCKED — REQUIRES PRODUCT DECISION** |
| P4.4 | `POST /me/appointments` | ✓ | 🟠 **BLOCKED — REQUIRES PRODUCT DECISION** |
| P4.5 | `POST /me/appointments/{id}/cancel` | ✓ | 🟠 **BLOCKED — REQUIRES PRODUCT DECISION** |
| P4.6 | `POST /me/appointments/{id}/confirm` | ✓ | 🟠 **BLOCKED — REQUIRES PRODUCT DECISION** |

**Ownership.** No route takes a `patientId`; the subject is the token, resolved through `patients.user_id`. Another patient's appointment, an unknown id, and an unlinked account all answer the **same 404** — never 403, because a 403 confirms the appointment exists and would let a client walk `APT-…` ids to learn the clinic's booking volume.

### P4.1 — `GET /me/appointments`

**Query params** (all optional): `status` (repeatable; ADR-001 wire values) · `from`, `to` (ISO-8601) · `upcoming=true` · `sort` ∈ `startsAt:asc|startsAt:desc` (default `startsAt:desc`) · `page` (default 1) · `pageSize` (default 20, **max 100**).

`upcoming=true` resolves against the **server's** clock, so a device with a wrong clock cannot shift the boundary. It never overrides an explicit `from`. `from` later than `to` is **422**.

**200:**
```json
{ "data": {
  "items": [ {
    "id": "APT-3007",
    "startsAt": "2026-10-01T09:00:00.000Z",
    "durationMin": 30,
    "status": "confirmed",
    "priority": "normal",
    "reason": "Follow-up on blood pressure",
    "isNewPatient": false,
    "isFollowUp": true,
    "visitType": "Follow-up",
    "departmentName": "Cardiology",
    "doctor": { "id": "3f1c…-uuid", "fullName": "Dr. Amelia Chen",
                "title": null, "specialty": "Cardiology", "photoUrl": null }
  } ],
  "page": 1, "pageSize": 20, "totalItems": 6, "totalPages": 1,
  "clinicTimezone": "UTC"
} }
```

**`status` is law, kebab-case, verbatim** (ADR-001): `scheduled` · `confirmed` · `pending` · `completed` · `cancelled` · `rescheduled` · `no-show` · `awaiting-patient`. A value outside that set is **422** — note `no_show` is the *Prisma* spelling and is rejected.

**Timezones (audit R-12).** Every timestamp is ISO-8601 **UTC**; `clinicTimezone` is the clinic's IANA zone, read from `platform_settings.localization.timezone`. **Format with it; never compute.** "Today" is a question about the clinic's zone, not the device's — a travelling patient changes their device zone, not their appointment.

The embedded `doctor` is §3's patient-safe projection and is covered by the same forbidden-field tests.

**An unlinked account gets an empty page, not an error** — `items: []`, `totalItems: 0`, with `clinicTimezone` still populated.

### P4.2 — `GET /me/appointments/{appointmentId}`

**200** — the summary above plus `notes`, `cancelledReason`, `clinicTimezone`, and `events[]` newest-first:
```json
{ "events": [ { "action": "approve", "fromStatus": "pending", "toStatus": "confirmed",
                "occurredAt": "2026-09-01T12:00:00.000Z", "actor": "clinic",
                "reason": "Approved" } ] }
```

`actor` is a **coarse category** — `patient` · `clinic` · `system` — and never a staff member's name, id or email. The database stores `actor_name`; it is deliberately not projected. An appointment history is not a route into the clinic's staff directory.

**Errors:** `401` · `404` (unknown, not yours, or unlinked — indistinguishable by design).

### 🟠 P4.3–P4.6 — why the write routes are blocked

These are **not** unbuilt-because-unprioritised. Each needs a rule that **no source in this repository states**, and inventing one would put clinical-operations policy in a service class.

> **ADR-001's transition table says which *statuses* may follow which. It does not say *who* may make a transition.** That gap is the whole blocker.

**The question is now written up as [ADR-033](../../docs/DECISIONS.md#adr-033--patient-appointment-action-policy-cancellation-and-rescheduling) — Patient Appointment Action Policy**, proposed and awaiting a product/clinical owner. It lays out the options for patient cancellation (C-A…C-D), patient-initiated rescheduling (R-A…R-C), the `awaiting-patient` proposal response, and where a timing window could live — with the migration, storage, API and UI impact of each. **It deliberately recommends nothing.**

| Route | Blocked on |
|---|---|
| `.../cancel` | **ADR-033 Q1** — may a patient cancel, from which statuses, and up to when? |
| `.../reschedule` | **ADR-033 Q2** — request-shaped or direct, and does it need a new transition? |
| `.../confirm` | **ADR-033 Q3** — the `awaiting-patient` response. Closest to settled: ADR-001 already attributes that row to *"patient response"*. Also needs the doctor-side `propose-slots` (M11.4), which is unbuilt |
| `POST /me/appointments` | **ADR-033 RA-033.1** — patient booking is a separate decision, explicitly out of ADR-033's scope |
| `.../slots` | Mechanically derivable from ADR-005 (availability − time-off − booked − buffer); the **policy** is not — booking horizon, same-day, minimum notice. RA-033.1 ⚠ *Superseded 2026-10-07:* patients see only **doctor-published** slots (capacity 1); computed availability is never patient inventory (DR-10, OD-08). Policy values remain implementation policy |

**Three things ADR-033 establishes that are already binding**, whatever is decided, and which the client should assume:

1. **A cancellation always carries a reason.** `appointments_cancelled_reason_required` is a database CHECK, not a convention — a reasonless cancel is not representable. Design the cancel sheet with a reason field.
2. **A lost race is `409 conflict`**, and terminal states (`completed`, `cancelled`, `no-show`) accept nothing. Refetch and re-render; never retry.
3. **The server will return the window's effect, not just enforce it** — a disabled button with no explanation is a support call. Leave room in the appointment detail for a "why not" line.

**`availableActions` is therefore absent from the payloads above**, and its absence is deliberate. §4's own rule is that the client must never compute whether an action is allowed — so shipping `availableActions: []` would assert "no action is available", a claim nobody has the authority to make, and the app would show a patient no cancel button. An omitted field is a visible gap; a wrong one is a silent defect. **The field arrives with the routes it describes, once the policy exists.**

**What to build now:** the appointment list and detail screens, fully, against live data. Leave the action buttons out.

---

## 5. Notifications — LIVE

| # | Method & Route | Auth | State |
|---|---|---|---|
| P5.1 | `GET /notifications` | ✓ | ✅ **LIVE** |
| P5.2 | `GET /notifications/badge-counts` | ✓ | ✅ **LIVE** |
| P5.3 | `POST /notifications/{id}/read` | ✓ | ✅ **LIVE** |
| P5.4 | `POST /notifications/{id}/unread` | ✓ | ✅ **LIVE** |
| P5.5 | `POST /notifications/read-all` | ✓ | ✅ **LIVE** |
| P5.6 | `POST /notifications/{id}/archive` · `/favorite` · `/pin`, `POST /notifications/clear-read` | ✓ | ⬜ **NOT BUILT** — M19 |
| P5.7 | `GET`/`PUT /me/notification-preferences` | ✓ | ⬜ **NOT BUILT** — M19 (§10.5's quiet-hours and `categories.security` rules) |
| P5.8 | `POST /me/devices` (push token) | ✓ | ⬜ **NOT MVP** — no push provider exists (M41.2) |

⚠ **These are `/notifications`, not `/me/notifications`.** An earlier revision of this document specified the latter; it was wrong. **API §10 already defines this surface** and marks every route `✓` — any authenticated user — because the feed is scoped by `notifications.recipient_id` and is therefore self-scoped by construction. One route tree serves doctors and patients through one code path. A patient-specific route over the same table would be the parallel model the design forbids. **Update your client to `/notifications`.**

**Ownership.** The recipient is the token's subject. No route takes a user id. Reads *and writes* are scoped: marking someone else's notification read answers **404**, and the row stays unread.

### P5.1 — `GET /notifications`

**Query params:** `status` ∈ `active|unread|read|archived` (default `active`, meaning not archived) · `category` · `priority` · `page` · `pageSize` (default 20, max 100).

`category` ∈ `appointments` · `medical-records` · `laboratory` · `pharmacy` · `patients` · `ai` · `system` · `security`.
`priority` ∈ `normal` · `important` · `critical`.
Note `medical-records` is **hyphenated** — `medical_records` is the database spelling and is **422**.

**200:**
```json
{ "data": {
  "items": [ {
    "id": "9f2e…-uuid",
    "title": "Appointment confirmed",
    "body": "Your appointment has been confirmed.",
    "category": "appointments", "priority": "normal", "kind": "update",
    "sender": "Medora Clinic",
    "readAt": null, "archived": false, "favorite": false, "pinned": false,
    "createdAt": "2026-09-02T08:00:00.000Z",
    "related": { "patientId": null, "recordId": null, "labOrderId": null,
                 "prescriptionId": null, "appointmentId": "APT-3007" }
  } ],
  "page": 1, "pageSize": 20, "totalItems": 12, "totalPages": 1
} }
```

**Ordering: pinned first, then newest.** Critical alerts stay pinned until acted on (UX 2.9).

**`related` carries ids and never linked content.** A notification announcing a lab result is not a way to read one — follow the id to a route that enforces its own authorization. Those clinical routes do not exist yet (§6), and **"the patient was notified" must never be read as "the patient may see it"**.

### P5.2 — `GET /notifications/badge-counts`

**200:** `{ "data": { "notifications": 3, "messages": 0 } }`

Unread, unarchived counts for the caller. This is the **foreground poll target** — API §10.4 requires it be O(1)-cheap, and it is two indexed aggregates returning two integers. Poll every 10–15 s while foregrounded; cap the display at 99+ client-side. `messages` sums the caller's `conversation_participants.unread_count`, so it is real rather than a placeholder — it will simply read 0 until messaging ships.

**Do not architect around a socket.** No realtime transport exists. Poll on foreground; push replaces polling when P5.8 lands.

### P5.3–P5.5 — read state

`POST /notifications/{id}/read` → **204**. `POST /notifications/{id}/unread` → **204**. Both are **idempotent**: marking an already-read notification read succeeds, so an optimistic client that retries after a flaky connection does not get an error and roll back a correct state.

`POST /notifications/read-all` → **200** `{ "data": { "updated": 4 } }` — the count lets the client reconcile its badge without a second fetch. Scoped to the caller; it never touches another user's rows.

**Errors:** `401` · `404` (unknown id, malformed id, or not yours — all identical).

---

## 6. Health records, labs and prescriptions — 🔴 BLOCKED BY ADR-031

| # | Method & Route | State |
|---|---|---|
| P6.1 | `GET /me/health/allergies` | 🔴 **BLOCKED BY ADR-031** (scope boundary undecided — RA-031.1) |
| P6.2 | `GET /me/health/medications` | 🔴 **BLOCKED BY ADR-031** (as above) |
| P6.3 | `GET /me/health/history` | 🔴 **BLOCKED BY ADR-031** |
| P6.4 | `GET /me/health/labs` | 🔴 **BLOCKED BY ADR-031** |
| P6.5 | `GET /me/health/visits` | 🔴 **BLOCKED BY ADR-031** |
| P6.6 | `GET /me/health/prescriptions` | 🔴 **BLOCKED BY ADR-031** |
| P6.7 | `GET /me/health/documents` | ⬜ **NOT MVP** — no object storage or malware scanning exists (M25) |

**Why these are blocked and the appointment routes are not.** There is **no release mechanism in the schema** — no `released_at`, no `visible_to_patient`, no patient-visibility flag on any clinical table. The only adjacent column, `lab_orders.reviewed_at`, is a *clinician's* review workflow feeding the doctor dashboard's "Critical unreviewed" chip; it is not a patient-disclosure control, and quietly reusing it as one would encode a clinical policy in a column that means something else.

**The undecided question:** may a patient see a `critical-high` result before a clinician has reviewed it? See ADR-031 for the four options on the table. This is not an engineering question.

**What the mobile team should do meanwhile:** build these screens **fully**, against fixtures, behind the same mock seam as everything else. The shapes above are stable, the navigation is real, and the loading/empty/error states are the same work either way. When ADR-031 lands, one adapter changes.

**A patient may already be *notified* about a result.** `notifications.related.labOrderId` can name one, and §5 is live. That is deliberate and safe: the notification carries **ids only, never linked content**, and the id leads to a route that does not exist. Do not treat a notification as permission to display a result, and do not build a screen that infers one from a title.

**ADR-031 now carries a decision-impact table** — what each of R-A/R-B/R-C/R-D would cost in columns, migrations, backfill and background jobs, and what is decision-independent. It is there so the decision can be taken on evidence. The backfill is the part to read: under three of the four options every existing `lab_results` row has no release state and there is no safe automatic default.

**When they do ship, two rules are already fixed:**
- The gate is **server-side**, on the row. An unreleased result must be **absent from the response**, not present-and-masked — a masked field in a payload is a disclosure to anyone reading the network.
- A held result renders as **"results pending clinician review"** with a contact route, never as an empty screen. An empty screen tells a patient their result does not exist.

---

## 7. Messaging — ⬜ NOT MVP

`GET /me/conversations` · `GET`/`POST /me/conversations/{id}/messages` · `POST /me/conversations/{id}/read`.

**Structurally unblocked by ADR-030** — `conversation_participants.user_id` and `messages.author_id` already point at `users.id`, so a patient becomes a full participant with real per-viewer state (unread, pinned, archived, `last_read_at`) with **no schema change**. It is excluded from the first slice on sequencing grounds only: M20 is unbuilt, and appointments plus identity are the critical path.

Existing rules that will apply unchanged when it lands: **delete is not supported in patient threads → 405** (archive only, DB §7); the edit window is **≤5 minutes** and sets a visible `editedAt`; attachments return **403 `scan_pending`** until scanned clean. The composer must surface an emergency affordance — `MessageFlag.emergency_language` exists precisely because patients describe urgent symptoms into threads a clinician reads tomorrow.

---

## 8. Patient AI — ⬜ NOT MVP, deliberately last

**Do not build this, and do not build a plausible-looking placeholder for it.**

There is no model provider in this repository: no SDK, no key, no adapter. The doctor-side AI in the web client is *"a deterministic canned-response generator"* storing conversations in `localStorage`. **That mock is the hazard** — it makes shipping a symptom bot the easiest thing to do by accident and the most dangerous thing in the product.

`ai_conversations.user_id → users.id` means ADR-030 unblocks *ownership*, and nothing else. The context vocabulary (`general | patient | record | labs | pharmacy`) is clinician-shaped; a patient assistant needs its own, its own scope resolver ("self"), and its own refusal set.

Gated on all of: a real provider decision, a **red-flag triage classifier that routes emergency descriptions to the Emergency screen before generating any text**, a named clinical owner who signs off the prompt and refusal set, a server-side output filter (no diagnosis, no dosage, no prescription — enforced, not requested), full audit of every exchange, PHI-safe logging, and rate limiting.

> *2026-10-10:* the Backend plan for the appointment-assistant part of patient AI (discovery, published
> slots, booking, cancel and reschedule through tools) is
> [`docs/multi-hospital/BACKEND_CHECKLIST.md`](../../docs/multi-hospital/BACKEND_CHECKLIST.md) §K, with
> tool contracts in [`API_CONTRACT_CHANGES.md`](../../docs/multi-hospital/API_CONTRACT_CHANGES.md) §10.
> Every gate above still applies; §K carries them as AST-G9. Nothing there is implemented, and this
> section's "do not build a placeholder" rule stands.

---

## 9. Emergency — ➖ NO BACKEND REQUIRED

**Ship this first. It needs nothing from this document.**

Emergency must work **offline, signed out, and with no backend dependency**. It belongs in bundled or locally-cached content reachable without a session.

**Emergency numbers must come from operator/deployment configuration and must never be hardcoded, guessed, or inferred.** They are country- and region-specific, they change, and a wrong number in a healthcare app is a distinct category of harm. If unconfigured, the app must say so plainly rather than display a plausible number. No backend route is proposed here, because no approved configuration source exists yet — inventing one would be inventing the numbers.

Also required, and purely frontend: a persistent, non-dismissible "Medora is not an emergency service" disclaimer, and **two-step activation on any dial action** — a single tap that dials is a defect on a screen that lives in a pocket.

---

## 10. Explicitly out of scope

| Item | Why |
|---|---|
| Hospital / facility discovery, "nearby", distance, maps search | ADR-010 scopes `clinics`/`facilities` **out**; ADR-018 §1 forbids `clinic_id`; `schema-adr010.e2e-spec.ts:117` **tests** that no `clinic_id` exists. There are no geo columns and no PostGIS anywhere. Audit **AD-3** — reversing this is a multi-clinic programme, not a mobile feature ⚠ **No longer out of scope (2026-10-07):** that programme is now the Multi-Hospital plan. Signed-in discovery of hospitals, clinics and locations, with distance and ratings, is Phase 23 (`API_CONTRACT_CHANGES.md` §5) |
| Any doctor or admin surface | PHI boundary |
| Prescribing, ordering labs, editing records, signing notes | Clinician capabilities |
| Any route taking another patient's id | The point of §0.4 |
| Billing, payments, insurance claims | ADR-018 §2, `billing: false`, no tables |
| Telemedicine / video, wearables, multi-clinic switching | No infrastructure, no spec. A patient never "switches" hospitals: one identity holds one Medical Record per hospital (OD-09) |

---

## 11. Change control

This contract is authoritative for the patient mobile client. A backend change to any shape here lands **in the same pull request** as the change to this file. New routes are added here before they are implemented, not after.

**Status of this document:** §1, §2.1, §3 (except P3.4), §4.1–4.2 and §5.1–5.5 describe **live** behaviour. §4.3–4.6, §2.2 and §§6–8 are specification or blocked, marked in place. **Implementation status:** the patient identity foundation (ADR-030), the token-in-body auth variant (ADR-034), `GET /me/profile`, the patient-safe doctor projection, patient appointment **reads**, and the notification feed with its read state and badge counts are all built and tested. **Blocking decisions:**
- **ADR-031** (results release) — blocks §6 entirely.
- **ADR-033** (patient appointment action policy) — blocks §4.3–4.6 and the `availableActions` field. Written up with options and costs; awaiting a product/clinical owner.
- **RA-030.2** (patient self-service authority) — blocks §2.2.
- **RA-030.1** (the record-claim flow) — blocks any screen that requires a patient to be *linked* to a chart. Unlinked accounts work everywhere and return empty collections.
