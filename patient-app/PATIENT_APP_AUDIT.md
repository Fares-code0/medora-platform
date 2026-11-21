# Medora — Patient Mobile Application: Repository Audit & Architecture Assessment

**Audited tree:** `Fares-code0/smart-healthcare-assistant-system` @ `9e4e0d3` (main), 2026-09-02
**Method:** static read of the tracked tree — `backend/src` (21 modules), `backend/prisma/schema` (13 files, 4 513 lines), `backend/docs` (4 specs, 2 216 lines), `frontend/src` (859 files), `frontend/*.md` (27 documents), `docs/DECISIONS.md` (29 ADRs), `.github/workflows/ci.yml`
**Scope of this phase:** audit, architecture assessment, feature mapping, navigation proposal, checklist, gap analysis. **No application code was written.**
**Companion:** [`PATIENT_FRONTEND_CHECKLIST.md`](PATIENT_FRONTEND_CHECKLIST.md)

---

> ### ⚠ Multi-Hospital — FINAL (2026-10-07). Where this audit's facility, discovery and slot sections disagree, they are SUPERSEDED
>
> This audit is a 2026-09-02 snapshot of a single-clinic tree and is kept as written. Its
> **AD-3** recommendation ("ship *Our Clinic*, scope multi-facility discovery out"), the
> `/public/*` route sketches in §14 and the server-computed slots of BE-06 are superseded by
> the owner's FINAL Multi-Hospital decisions
> ([`docs/multi-hospital/OWNER_DECISIONS.md`](../docs/multi-hospital/OWNER_DECISIONS.md);
> ADR-042, *Proposed*): **Hospital** is the isolation boundary, with Clinics and multiple
> Locations inside it (DR-01, OD-06); discovery and comparison of hospitals and doctors —
> including distance and ratings/reviews — are in scope **after sign-in only** (DR-09, OD-10);
> patients book only **doctor-published** slots, one patient per slot (DR-10, OD-08);
> insured patients get insurance-aware results and **uninsured patients are not restricted**
> (OD-14); one global identity holds one Medical Record **per hospital**, created on first
> real interaction (OD-09); claiming a pre-existing record is **OPEN / DEFERRED (OQ-02,
> RA-030.1)**. The current plan for this app is `PATIENT_FRONTEND_CHECKLIST.md` and Phase 27
> ([`docs/work-phases/`](../docs/work-phases/README.md)).

> ### ⚠ Status update, 2026-09-14 — the AI interface exists; AD-4 does not
>
> **R-5 and AD-4 below are unchanged and still open.** There is no model
> provider, no red-flag classifier, no output filter and no named clinical
> owner, and nothing in the patient app talks to an assistant.
>
> What changed is that `patient-app/src/features/ai/` was built as an
> **interface only**: four screens, each of which states that no assistant
> is connected to this copy of Medora, a non-dismissible K-03 disclaimer on
> all of them, and a result placeholder that says nothing has read what the
> patient entered. There is deliberately no `service.ts`, no adapter behind
> `api/seam.ts` and no module in `api/endpoints/`; `ai-honesty.test.ts`
> fails the build on a network call, a storage call, a client-side
> classifier, or any stored string long enough to read as a scripted reply.
>
> So §15.4's AD-4 is still the blocker for everything R-5 warns about. The
> work now waiting on it is clinical and backend work, rather than a screen
> nobody has drawn. See Phase K/L of the checklist and
> `docs/TRACEABILITY.md` §AI.

> ### ⚠ Status update, 2026-09-03 — AD-1 has been decided
>
> **This document is a point-in-time audit of `9e4e0d3` and is deliberately
> left as written.** Its findings below are the state of the tree on
> 2026-09-02. One of them has since been overtaken, and the change is large
> enough that reading §0 without this note would mislead.
>
> **AD-1 — "Do patients authenticate?" — is decided.** The branch
> reconciliation of 2026-09-03 brought the `backend` branch into `main`,
> carrying **ADR-030 — Patient Identity and Authentication**, accepted by
> the project owner on 2026-09-02. It adopts **Option A of §4.1 of this
> audit**, exactly as §15.4 recommended: a nullable unique
> `patients.user_id`, a seeded `patient` role holding no permissions, and
> authentication through the existing M6 lifecycle. `register.schema.ts`
> now reads `z.enum(['doctor', 'admin', 'patient'])`.
>
> Read §0, §4.1 and the AD-1 row of §15.4 as **the question and the
> reasoning**, not as the current state. The answer is `docs/DECISIONS.md`
> ADR-030.
>
> **What ADR-030 does *not* settle**, and what the ✅/🔴 columns below
> therefore still describe correctly:
>
> - **RA-030.1 — the account-to-record claim flow is open.** A registered
>   patient account is authenticated *and unlinked*: it sees no clinical
>   data at all until claiming is separately decided. Auto-linking on email
>   is ruled out; everything else remains open.
> - **AD-5 / results release** is ADR-031, **proposed and not accepted**.
> - **AD-2** (patient self-service authority) and the patient appointment
>   action policy (ADR-033) are likewise undecided.
>
> Endpoints built since this audit, and now on `main`: `GET /me/profile`,
> `GET /me/appointments` (reads only — writes stay blocked pending
> ADR-033), the self-scoped `/notifications` feed with read state and
> badge counts, and `/patient/doctors` + `/patient/specialties`. The
> contract is `backend/docs/PATIENT_MOBILE_API_CONTRACT.md`; the sequence
> is `backend/docs/PATIENT_MOBILE_ENABLEMENT.md`.
>
> **AD-6 is also resolved**, separately and on the same day: **ADR-032**
> creates `patient-app` as the fifth integration branch, adopting §17's
> recommendation. Patient-app task branches are now cut from `patient-app`,
> not from `main`. Note the branch is `patient-app` with a hyphen —
> `patient_mobile_app` with underscores is the old task branch and is not a
> base for anything.

> ### ⚠ Second status update, 2026-09-06 — the client has begun consuming those endpoints
>
> The note above records that the *server* moved. This one records that the
> *client* has started to follow, because §15.2's "frontend only" and
> §15.3's "backend dependency" columns are the two lists a reader uses to
> decide what to build next, and four of §15.3's rows are no longer
> dependencies at all.
>
> **§15.3 rows that have landed on the server and are now consumed by this
> client:** BE-01 (`role: 'patient'`, and ADR-035 made the registration body
> a discriminated union), BE-04 (`/patient/doctors`, `/{id}`,
> `/patient/specialties`), BE-05 (`GET /me/appointments` and `/{id}` — the
> **reads only**), BE-10's read half (`GET /me/profile`), and BE-12's
> in-app half (`/notifications`, `badge-counts`, the three read-state
> routes — though push itself is still absent).
>
> **§15.3 rows that have NOT moved:** BE-02 (the claim flow — RA-030.1),
> BE-03 (`GET /auth/session`), BE-06/07/08 (the appointment writes, now
> blocked on **ADR-033** rather than on unbuilt endpoints), BE-09 (health
> records, blocked on ADR-031 — *Results Release Policy*), BE-11's clinic
> and departments projections, BE-13/14/15/16/17.
>
> **One correction to §15.3 itself, worth reading before quoting the
> table:** BE-04's row sketches `GET /public/doctors` and BE-05's
> `GET /me/appointments`. The first shipped as **`/patient/doctors`** and is
> **authenticated, not public**, because no rate limiting exists anywhere in
> this backend yet (§15.3 BE-17) and an open roster is an enumeration
> surface with nothing in front of it. Notifications shipped at
> **`/notifications`**, not `/me/notifications`: the feed is scoped by
> `recipient_id` and one route serves a doctor and a patient identically.
>
> **Nothing in the analysis below is edited.** §4.1's option table, §6's
> appointment flow, §7's disclosure reasoning and §16's risks are why the
> endpoints took the shape they did, and they read correctly as the
> reasoning that produced the current state. Where a §14 matrix cell or a
> §15 row disagrees with the code, `PATIENT_FRONTEND_CHECKLIST.md` and
> `docs/TRACEABILITY.md` are the current documents and this one is the
> dated one.

---

## 0. Executive summary — read this first

The patient mobile application cannot be built as a client of the Medora backend today, and the reason is not a missing endpoint. It is a **recorded, accepted architecture decision** that the patient app contradicts.

> **ADR-018 §3 — "Patients are records, not users."**
> *"No patient authentication, no patient portal, no patient role in the session model. `patients` is a clinical entity, not an account."*
> — `docs/DECISIONS.md:1276`, Accepted by the project owner, 2026-08-12

That decision is not a comment. It is load-bearing in code:

| Where | What it enforces |
|---|---|
| `backend/prisma/schema/03-identity.prisma:29` | `User` has no patient variant; `Patient` has no credential row, no session, no role |
| `backend/src/modules/auth/dto/register.schema.ts:45` | `role: z.enum(['doctor', 'admin'])` — a patient cannot register |
| `backend/prisma/seed/permissions.ts:146–201` | Six seeded roles: admin, doctor, reception, laboratory, pharmacy, nurse. **No `patient` role** |
| `backend/test/schema-reference.e2e-spec.ts:181` | A test *asserts* there is no patient role and fails if one appears |
| `10-communication.prisma:52` | `ConversationParticipant.userId → User` — a patient cannot be a party to a thread |
| `10-communication.prisma:229` | `Notification` recipient is a `User` — a patient cannot receive one |
| `10-communication.prisma:313` | `AiConversation` owner is a `User` — a patient cannot hold an AI session |

**The second finding compounds the first.** The backend is implemented through Milestone 6 only. **35 of 188 roadmap items are complete.** Four controllers exist (`auth`, `me/password`, `me/2fa`, `health`) exposing **16 HTTP routes**. The other **18 module folders contain a single empty `@Module({})` class each** — appointments, patients, doctors, messaging, notifications, ai, files, search, dashboard and the rest are declared and unbuilt.

**Consequently: of the 25 patient capabilities the brief names, zero can be built against a live endpoint today.** One (Emergency guidance) is genuinely frontend-only and can ship first. The rest are blocked on backend work that the roadmap already plans but has not reached.

**The third finding is a contradiction inside the existing specs**, and the patient app is what forces it to be resolved. `UX_ARCHITECTURE.md` §3.4 (line 518) specifies an admin screen with *"unlock, reset credentials (sends secure reset — admin never sets a password directly), deactivate"* for **patient accounts**, and API §4.11 encodes those as endpoints. A patient account has credentials to reset. ADR-018 §3 says patients have no credentials. **Both are in the repository and they disagree.** Nobody has had to notice, because neither surface is built. The patient app cannot proceed until an owner decides which one stands.

**What this audit therefore recommends:** treat this phase's output as a specification, not a foundation to start coding on. The first checklist item is not a React Native project — it is **ADR-030**, the decision that gives patients identity. Everything else is downstream of it.

---

## 1. Repository architecture

A **monorepo** with three top-level trees and one CI workflow that path-filters between them.

```
smart-healthcare-assistant-system/
├── frontend/          Doctor + Admin SPA (React 18 · Vite · TS strict) — 859 files
├── backend/           NestJS 10 + Prisma 7 + PostgreSQL 16 — auth only, so far
├── docs/              29 ADRs (DECISIONS.md), reconciliation, M0 analysis, 4 numbered ADR files
├── .github/workflows/ ci.yml — path-filtered frontend/backend jobs + one aggregate `CI` check
└── CLAUDE.md          Branch/PR working agreement (integration branches per domain)
```

The intended runtime topology — and the one the patient app must join without altering:

```
                       MEDORA BACKEND  (NestJS · /api/v1)
                                │
        ┌───────────────┬───────┴───────┬────────────────┐
        │               │               │                │
   Doctor Web       Admin Web      Patient App      (future clients)
   (frontend/)      (frontend/)    (patient-app/)
        │               │               │                │
        └───────────────┴───────┬───────┴────────────────┘
                                │
                    PostgreSQL 16 (107 tables · 80 native enums)
                    Redis — specified (M7.1, M31), not yet present
```

**Branch model** (`CLAUDE.md`). `main` is protected. Four integration branches — `frontend`, `backend`, `Database`, `Ai` (capitalised on the remote, and case-sensitive). Every task gets `claude/<task>` cut from the relevant integration branch and a PR back into it. A patient app is a new domain that none of the four covers cleanly; **§16 of this report proposes how to place it.**

**Quality gates.** Zero errors on `typecheck · lint · test · build` for each tree. CI runs the backend suite against a real PostgreSQL service container — plus, notably, on changes to three *frontend* files (`types/auth/`, `features/admin/permissions.ts`, `utils/phi-mask.ts`) because the backend transcribes them and parity specs load the frontend source directly. A fourth client tree must decide whether it joins that arrangement.

---

## 2. Existing frontend — what already exists

`frontend/` is the **Doctor and Administrator web SPA**. React 18.3, TypeScript strict, Vite 6, Tailwind 3 over a CSS-variable token layer, TanStack Query 5, React Router 6, React Hook Form + Zod, Framer Motion, lucide-react.

**Feature modules** (`src/features/`):

| Area | Modules |
|---|---|
| `doctor/` | ai, anatomy, appointments, clinic, dashboard, labs, medical-records, messaging, notifications, patients, pharmacy, reports, settings |
| `admin/` | appointments (oversight), communications, doctors, logs, overview, patients, phi, reports, sections (15 settings panels), permissions |
| `auth/` | login, signup, forgot/reset, verify-email, OTP, lock screen — with a **mock adapter** and a real one behind one seam |
| `shared-domain/` | audited-access, clinic-operations, clinic-scope, conversations, data-error-reports, lab-studies, patient-identity |

**The single most important fact about this tree for the patient app:** *"every call resolves against local mock data — no endpoint is live"* (`FRONTEND_CHECKLIST.md` F-07). `src/api/endpoints/` contains only `auth.ts`. The doctor SPA is a complete UI over mocks; the backend integration is roadmap milestones M39–M40, unstarted.

**What the patient app can legitimately reuse:**

| Asset | Path | Reuse |
|---|---|---|
| Design tokens | `src/styles/tokens.css` | **Values, not the file.** Brand `#2c5282`, dark-mode `#8fb4e0`, Open Sans Variable + JetBrains Mono, four clinical semantic ramps, documented contrast reasoning |
| Design system spec | `frontend/DESIGN_SYSTEM.md` (1 025 lines) | The rationale a mobile token set must stay faithful to |
| i18n architecture | `src/i18n/` | 5 locales (en, ar, tr, fa, fr), total `Record<Locale, Record<MessageKey, string>>` typing, RTL via logical properties. **The pattern transfers; the catalogues are doctor/admin copy** |
| Error normalisation | `src/api/errors.ts`, `src/api/client.ts` | The transport contract shape — single-flight 401 refresh, 30 s timeout, `X-Correlation-Id` |
| Auth seam | `src/types/auth/`, `features/auth/` | The `AuthService` port + two adapters. The exact pattern a patient app should copy |
| Status vocabularies | `features/*/model/types.ts` | Enum literals are **law** (API contract §11 header). Kebab-case verbatim: `no-show`, `awaiting-patient`, `critical-low` |

**What it must not reuse:** layout, navigation, density, table-first information architecture. `UX_ARCHITECTURE.md` §12 is desktop-first at `xl`; the brief is explicit that shrinking it is the wrong move, and it is right.

---

## 3. Existing backend — the relevant APIs and modules

### 3.1 What is actually implemented

**Four controllers. Sixteen routes. That is the whole live API surface.**

| Route | Controller | Auth | Patient-app relevance |
|---|---|---|---|
| `POST /api/v1/auth/register` | `auth.controller.ts:65` | public | **`role` enum is `doctor\|admin` — closed to patients** |
| `POST /api/v1/auth/login` | `:89` | public | Reusable verbatim once patients have accounts |
| `POST /api/v1/auth/otp/verify` | `:118` | otp token | Reusable |
| `POST /api/v1/auth/otp/resend` | `:145` | otp token | Reusable |
| `POST /api/v1/auth/refresh` | `:162` | cookie **or body** | **Mobile path already exists** — see §5 |
| `POST /api/v1/auth/forgot-password` | `:196` | public | Reusable |
| `POST /api/v1/auth/reset-password` | `:207` | public | Reusable |
| `POST /api/v1/auth/verify-email` | `:218` | public | Reusable |
| `POST /api/v1/auth/verification/resend` | `:235` | public | Reusable |
| `POST /api/v1/auth/logout` | `:254` | authenticated | Reusable |
| `POST /api/v1/me/password` | `account-password.controller.ts:26` | authenticated | Reusable |
| `POST /api/v1/me/2fa/setup` · `/enable` · `/disable` | `two-factor.controller.ts:40,47,57` | authenticated | Optional for patients |
| `GET /api/v1/health` · `GET /api/v1/ready` | `health.controller.ts:26,38` | public | Ops only |

**Not implemented despite being in the contract:** `GET /auth/session` (API §1.11) — the patient app's session-restore call. It is specified and absent.

### 3.2 What is declared and empty

Eighteen module folders hold one file each — an empty `@Module({})` with a docblock naming its future milestone:

`administration` · `ai` (M16) · `appointments` (M11) · `audit` · `dashboard` (M27) · `doctors` (M9) · `files` (M25) · `labs` (M14) · `medical-records` (M12) · `messaging` (M20) · `notifications` (M19) · `patients` (M10) · `pharmacy` (M13) · `platform-settings` (M24) · `reports` (M21) · `search` (M26) · `settings` (M22) · `users` (M8)

### 3.3 What *is* built, and is genuinely load-bearing for the patient app

The authorization kernel is real and better than the endpoint count suggests:

- **`AuthorizationGuard`** registered globally after `AccessTokenGuard`. **Deny-by-default**: a route naming no rule is refused 403, and `test/authz-matrix.e2e-spec.ts` walks Nest's route table and fails naming any unannotated handler.
- **`PatientScopeService`** (M7.2, ticked) — resolves care relationships through `patient_doctor_assignments`, honours `revoked_at`, and returns **404, never 403**, for out-of-scope patients so that walking `PT-1000, PT-1001, …` cannot enumerate the roster.
- **PHI maskers** (`shared/phi/`) — character-for-character parity with `frontend/src/utils/phi-mask.ts`, bound by a spec that loads the frontend source.
- **`shared/status/status-machine.ts`** — the ADR-001 transition table as data, plus a DB trigger backstop.
- **22-capability permission catalogue**, bound three ways (frontend union ↔ backend catalogue ↔ Prisma seed) by parity specs.
- **Envelope/error contract** — `{ data }` success, `{ message, code, fieldErrors, detail, ref }` errors, `X-Correlation-Id` echo, Pino logging with redaction.

**Known deferral that affects the patient app directly:** `InMemoryPermissionCache` is per-process (M7.1 unticked). With more than one instance, a revoked permission keeps working for up to 5 minutes. Adding a large mobile client population makes multi-instance deployment likelier, so this moves from "known" to "blocking" sooner than the roadmap assumes.

---

## 4. Patient data model

`patients` is a **clinical record owned by clinicians**, not an account. `05-patients.prisma:42`.

```
Patient  (public_id "PT-…", mrn, full_name, date_of_birth, gender, blood_type,
          phone, email?, address?, photo_url?, status, risk_level, medical_notes?,
          last_visit_at, registered_at, assigned_doctor_id)
  │
  ├── PatientAllergy              allergen, severity mild|moderate|severe, reaction
  ├── PatientChronicCondition
  ├── PatientEmergencyContact     ≤1 primary (partial unique)
  ├── PatientInsurance
  ├── PatientDocument             referral|consent|external-record|insurance|report
  ├── PatientNote                 authored + signable by a clinician
  ├── PatientMedicalHistory       diagnosis|surgery|procedure|hospitalization|vaccination
  ├── PatientVitalSign            systolic/diastolic split
  ├── PatientClinicalAlert        critical|warning
  ├── PatientMedication           active|completed|discontinued
  └── PatientStudy                lab|imaging × completed|pending|critical
```

Four structural properties that the patient app must respect rather than work around:

1. **Every satellite carries `patient_id` directly**, never only through a parent — because ADR-022's future RLS policy must name the owning patient without a multi-table join.
2. **Soft delete throughout.** DB §7: PHI is never hard-deleted. A patient is deactivated, never removed.
3. **`age`, `nextAppointment`, `hasSevereAllergy` are derived, never stored** — the DTO computes them.
4. **No account linkage exists.** There is no `patients.user_id`, no credential row, no session. *This is the gap.*

`patients.email` is nullable and is a **contact field**, not a login. `users.email` is `citext UNIQUE`. Nothing joins them.

### 4.1 The identity gap, stated precisely

To let a patient sign in, exactly one of these must be decided (§14, ADR-030):

| Option | Shape | Cost | Risk |
|---|---|---|---|
| **A — `patients.user_id` FK** (recommended) | Nullable unique FK `patients.user_id → users.id`; a new `patient` role with an empty-by-default bundle; registration links or creates the clinical record | One migration, one role, one link/claim flow. Reuses **all** of M6 auth and the `ConversationParticipant`/`Notification`/`AiConversation` FKs unchanged | Account-to-record claiming is a real identity-proofing problem (see §16 R-2) |
| **B — separate `patient_accounts` table** | Parallel identity domain with its own credentials and sessions | Duplicates M6 in full; two lockout policies, two token families, two audit trails | Contradicts §30 of the brief (no second auth system). **Not recommended** |
| **C — no patient login; guest/OTP booking only** | Public discovery + phone-OTP booking, no persistent account | Smallest change; ADR-018 stands unamended | Kills health records, messaging, AI history, notifications — most of the brief |

Option A is the only one that satisfies the brief while keeping ADR-018's stated intent (*"the appointment state machine already models patient-facing states"*, *"`patient_doctor_assignments` is the care-relationship anchor a future patient login would scope against"*). ADR-018 anticipated this migration; it did not forbid it.

---

## 5. Authentication — how patient auth should work

**The transport is already mobile-ready.** This is the audit's most encouraging finding, and it is deliberate: ADR-018 §4 states *"Mobile readiness is not deferred"*.

| Mechanism | Status | Evidence |
|---|---|---|
| `X-Client-Type: mobile` → refresh token **in the response body** instead of a cookie | **Built and tested** | `auth.controller.ts:285`; `test/auth-refresh.e2e-spec.ts:250` |
| Refresh rotation + reuse detection (family revocation) | **Built** | `Session.previousTokenHash`, ADR-026 |
| Access token ≤ 15 min, `sub`/`role`/`permissions`/`sid` | **Built** | M6.3 |
| `/api/v1` versioning | **Built** | ADR-011 |
| `Idempotency-Key` accepted on state-changing POSTs | Specified (ADR-014), **not yet enforced** | API §0.5 |
| Argon2id hashing, lockout, anti-enumeration timing | **Built** | M6.2 |
| Push-device registration | **Specified, unbuilt** | RM M41.2 |

**Therefore the patient app's auth stack is:**

```
Welcome → Register (role: patient)   ──┐
       → Login (email + password)    ──┤
       → OTP step-up (if enabled)    ──┼→ POST /auth/login  with  X-Client-Type: mobile
       → Email verification          ──┘         │
                                                 ├── accessToken  → in-memory only, never persisted
                                                 └── refreshToken → iOS Keychain / Android Keystore
                                                                    (expo-secure-store or
                                                                     react-native-keychain)
Session restore on cold start:  refresh token from secure storage → POST /auth/refresh
                                (X-Client-Type: mobile, token in body) → new access token
                                → GET /auth/session   ← ⚠ NOT IMPLEMENTED (API §1.11)
```

**Rules the patient client must not break:**

- The access token lives in memory only. Never `AsyncStorage`, never Redux-persist, never a log line.
- One single-flight refresh. Concurrent 401s queue behind one refresh and replay; a second refresh with a rotated token revokes the whole family.
- **401 means token, and nothing else** (ADR-013). A wrong password is 401 `invalid_credentials` and must *not* trigger refresh-then-logout — this is precisely the defect `REPO_AUDIT.md` §4 finding 3.2 records in the web client (`normalizeHttpError` drops `code`). The mobile client must read `code` from day one and branch on it.
- Logout clears secure storage *and* calls `POST /auth/logout`. Biometric unlock (if offered) gates the app, never the token.

**Blocked on:** `role: 'patient'` in `register.schema.ts`, a `patient` role in the seed, and `GET /auth/session`. All three are small; none exists.

---

## 6. Appointment integration — the exact existing flow

**Schema: complete. API: entirely unbuilt (M11, 0 of 6 items).**

`Appointment` (`07-scheduling.prisma:53`) carries `public_id` (`APT-…`), `patient_id`, `doctor_id`, `department_id?`, `visit_type_id`, `starts_at`, `duration_min > 0`, `status`, `priority`, `is_new_patient`, `is_follow_up`, `reason` (≤300, required), `notes?`, `cancelled_reason?` (CHECK-enforced when cancelled).

**The status machine (ADR-001), server-enforced, illegal → 409 `conflict`:**

```
                    ┌──────────────────────────────┐
   pending ────────▶│ confirmed │ cancelled        │
                    └──────────────────────────────┘
   scheduled ┐
   confirmed ├──▶ rescheduled | cancelled            (always)
   rescheduled┘   + completed | no-show              (only when slot ≤ today)

   awaiting-patient ──▶ confirmed | cancelled | rescheduled

   terminal: completed · cancelled · no-show
```

Two backstops: `AppointmentStatusMachine` in `shared/status/` (the table as data) **and** a DB trigger (M5.10), so a migration or a psql session cannot walk a row into an illegal state.

**Every transition inserts an `appointment_events` row** with actor, from/to status, reason, timestamp — and **notifications fire only after commit**, through the outbox. `AppointmentRescheduleProposal` exists as the table that makes `awaiting-patient` reachable (up to 3 alternative slots).

**What this means for the patient app — and it is the most important design constraint in this document:**

> **The frontend must never compute whether an action is allowed.**
> It renders the actions the server says are available, and it renders `409 conflict` when it loses a race. `availableActions()` on the client is a mirror, never an authority. A cancellation window, a reschedule cut-off, a "too late to cancel" rule — all of these are the server's, and the patient app must not invent one.

**Availability → bookable slots.** `DoctorAvailability` is one row per contiguous range per weekday (a weekday with no rows is a non-working day — there is deliberately no `enabled` boolean); breaks are rows with `is_break = true` *inside* a range; `DoctorTimeOff` is absolute-time unavailability (`vacation | emergency-block`). `doctors.default_duration_min` ∈ {15,20,30,45,60} and `buffer_min` describe how a doctor books.

**Slot generation is not in the schema and not in any contract endpoint.** `GET /appointments` (API §5.1) is the *doctor's book*. There is no `GET /doctors/{id}/slots`. This is a **new endpoint the patient app requires** (§15, BE-06) — and it must be computed server-side: availability minus time-off minus booked appointments minus buffer, in the clinic's timezone, is business logic, and §2 of the brief forbids duplicating it in the client.

**Patient-initiated booking does not exist.** API §5.3 `POST /appointments` is `doctor` auth and takes `patientId`. A patient booking for themselves needs a route whose actor *is* the patient (`POST /me/appointments`), creating in status `pending` for doctor approval (§5.4/§5.5 already model that side of the loop).

**The round trip the brief describes is genuinely already modelled** — it just has no patient-facing half:

```
PATIENT books           →  status: pending          (NEW route needed)
DOCTOR approves/rejects →  confirmed | cancelled    (API §5.4/§5.5, unbuilt — M11)
        ↓ outbox
PATIENT notified        →  notifications            (Notification.userId → User — blocked)
DOCTOR reschedules      →  rescheduled / awaiting-patient + proposals
PATIENT re-confirms     →  confirmed                (NEW route needed)
```

---

## 7. Doctor integration — how patient→doctor workflows connect

`Doctor` (`04-people.prisma:21`) holds everything a patient-facing profile needs: `full_name`, `title`, `specialty` (display string) + `doctor_specialties` (id-bearing, one primary), `department_id`, `years_of_experience`, `languages[]`, `biography`, `education[]`, `certifications[]`, `skills[]`, `photo_url`, `rating_avg` (derived from `SatisfactionSurvey`), `verification_status`, `practice_status`, `office_location`, `office_hours`.

**And it holds fields a patient must never see:** `license_number`, `license_expires_on`, `employee_id`, `contact_email`, `contact_phone`, `emergency_contact_name`, `emergency_contact_phone`, `linkedin_url`, verification documents.

> **BE-04 is therefore a projection requirement, not a filter suggestion.** A patient-facing doctor DTO is a **separate server-side projection**. Shipping the admin DTO and hiding fields in the mobile UI would leak a practitioner's licence number and personal phone number to every patient over the wire, and no amount of client code fixes that. Frontend authorization is not authorization.

**Discovery filters the patient app needs, and what backs them:**

| Filter | Backing | State |
|---|---|---|
| By specialty | `specialties` (self-referencing tree) + `doctor_specialties` | Table exists · no endpoint |
| By department | `departments` (ADR-004, one table, FK'd everywhere) | Table exists · no endpoint |
| By name | `pg_trgm` GIN indexes are installed | No endpoint |
| By availability | `doctor_availability` + `doctor_time_off` | Tables exist · **no slot endpoint** |
| Verified only | `doctors.verification_status = 'verified'` | **Must be a server-side default for the patient projection.** Showing an unverified or suspended practitioner to a patient is a safety issue, not a filter preference |
| By rating | `doctors.rating_avg` | Column exists · no endpoint |

`GET /doctors` (API §3.4) exists in the contract as **`can:doctors.manage` — an admin roster**. It is not the patient's list, and must not be reused as one.

---

## 8. Hospital & clinic integration

**This is the largest scope gap in the brief, and it is a deliberate product decision, not an oversight.**

> **ADR-018 §1 — "v1 is single-clinic. No `clinic_id` on any table."**
> **ADR-010** scopes `clinics` and `facilities` **OUT** of the schema entirely.
> `backend/test/schema-adr010.e2e-spec.ts:117` — *"has no `clinic_id` anywhere"* — is an **enforced test**.

There is one clinic. It is not a row anywhere. What exists instead:

| Concept | Where it actually lives | Patient-facing? |
|---|---|---|
| Clinic identity, address, phone | `platform_settings` → `organization` slice (`name`, `legalName`, `phone`, `website`, `addressLine`, `city`, `country`) — see `frontend/src/features/admin/admin-settings.types.ts:212` | **Behind `can:settings.manageSystem`.** Needs a public projection |
| Departments | `departments` table (ADR-004) | No endpoint |
| Rooms | `rooms` (consultation/lab/procedure/pharmacy/waiting) | **Internal operations — out of scope for patients** |
| Working days / holidays | `clinic_working_days` (7 rows), `holidays` | No endpoint |
| "Hospital" | **`doctors.hospital varchar(80)`** — a free-text display string. Not an entity, not normalised, not searchable, no address, no phone | Unusable as a directory |

**There are no geo columns anywhere in the schema.** A grep for `latitude|longitude|geo|coordinates` across all 13 schema files returns only `ip_address inet` rows and `patients.address` free text. There is no PostGIS extension, no facility coordinates, no distance query.

> ⚠ **Superseded 2026-10-07 (Multi-Hospital FINAL).** The conclusions below described the 2026-09-02 single-clinic schema. Signed-in hospital discovery, distance and comparison are now in scope (DR-09, OD-10); see the banner at the top of this audit.

**Therefore, honestly stated:**

- "Search hospitals", "browse healthcare facilities", "nearby hospitals", "hospital phone numbers", "hospital locations" — **BLOCKED — ARCHITECTURE DECISION REQUIRED**. They require re-scoping ADR-010 and ADR-018 §1 to introduce a `facilities` entity with geo. That is a product decision with multi-clinic implications, and it is far larger than a patient app.
- **What can ship instead, honestly:** a single **"Our Clinic"** screen — the one clinic's name, address, phone, departments, working days and holidays, with a maps hand-off (`geo:` / `maps://` deep link built from the address string) and a `tel:` link. This is truthful about a single-clinic product and needs one small public endpoint (BE-11), not a new domain.
- The recommendation is to **ship "Our Clinic" in v1 and record multi-facility discovery as a scoped-out epic** (§15 AD-3). Building a facilities directory to make one screen look like Zocdoc would be speculative generality of exactly the kind ADR-018 exists to prevent.

---

## 9. AI integration

**Schema exists. Endpoints do not. Model provider does not. Patient-facing AI does not exist as a concept anywhere.**

| Layer | State |
|---|---|
| Tables `ai_conversations`, `ai_messages`, `ai_user_settings`, `ai_prompt_templates` | **Built** (M5.9) |
| API contract §11 — 8 endpoint groups, SSE streaming | **Specified** |
| Backend `ai` module | **Empty `@Module({})`** — M16, unstarted |
| Model provider | **None.** No SDK, no key, no adapter. `MG` lists "AI service" as a health-check key only |
| Frontend AI | `features/doctor/ai/` — *"a deterministic canned-response generator"*, conversations in `localStorage` (`model/types.ts:11`) |

**Every constraint in API §11 is doctor-shaped and blocks patient reuse:**

- *"All routes require `can:ai.use` (admins have no entry point)"* — patients have no role, hence no capability.
- `AiConversation.userId → User` — a patient cannot own a conversation.
- Context modes are `general | patient | record | labs | pharmacy` — **clinician contexts**. "Bind this conversation to patient PT-1042's chart" is a doctor action. A patient AI needs its own vocabulary (`navigation | symptom | appointment | medication-info`).
- §11.4: *"Server resolves bound entities under the doctor's care scope; partial/failed context ⇒ 409, fail closed, no generation."* A patient's scope is "self", which the resolver has no concept of.

**Medical image assistance: nothing exists.** No vision model, no image pipeline. `files` (M25) is unbuilt; the `File` register has `storage_key` and a scan gate (`403 scan_pending` until clean), but no storage backend. Uploading a photo of a rash is **BLOCKED — BACKEND DEPENDENCY** on at least: files service, an object store, malware scanning, a vision-capable model, and a clinical-safety review.

**The clinical-safety requirement is not optional and not a UI nicety.** A patient-facing symptom assistant is a materially different risk product from a doctor's clinical copilot. Before any patient AI ships it needs, at minimum:

1. A **red-flag triage classifier** that routes emergency symptom descriptions to the Emergency screen *before* generating conversational text — chest pain, stroke signs, anaphylaxis, suicidal ideation.
2. **Persistent, non-dismissible framing**: this is guidance, not diagnosis. Not a one-time modal.
3. **No dosage, no prescription, no diagnosis** in output — enforced server-side by prompt and by output filter, never by asking the model nicely.
4. **Audit of every exchange** (`AiMessage` rows already support it).
5. A **named clinical owner** who signs off on the prompt and the refusal set.

The checklist marks Phase K **P1 and gated on AD-4**, deliberately behind appointments and records. Shipping a plausible-sounding symptom bot on a canned-response generator would be the single most dangerous thing this project could do, and the existing mock makes it the *easiest* thing to do by accident.

---

## 10. Messaging integration

**Schema built (M5.9). API unbuilt (M20, 0 of 7). And the model excludes patients structurally.**

```
Conversation (kind: direct|group|announcement|system, topic?, patient_id?, read_only)
  ├── ConversationParticipant  (conversation_id, USER_ID) ← per-viewer state:
  │                             unreadCount, pinned, starred, archived, muted, draft
  ├── Message                  (author_id → User?, kind text|system, body, sentAt,
  │                             status sending|sent|delivered|read, editedAt)
  ├── MessageAttachment        (scan-gated: no download until scan = clean)
  ├── MessageFlag              (emergency_language | harassment_abuse | phi_wrong_channel | …)
  └── CommunicationAccessRequest (ADR-006 admin content-access gate)
```

`conversations.patient_id` is the *bound clinical context* — *"its presence is what makes a thread a patient thread"* — **not** patient membership. Membership is `ConversationParticipant.userId → users.id`. A patient with no user row cannot be a participant, cannot be an author, cannot have unread state.

Existing rules the patient client must honour once unblocked:
- **Edit window ≤ 5 minutes**, patient threads only, sets a visible `editedAt`. Deliberately *not* a CHECK constraint — the window is a platform setting.
- **Delete is not supported in patient threads → 405.** Archive only (DB §7).
- Attachments are **403 `scan_pending`** until scanned clean.
- `MessageFlag` already has an `emergency_language` category — the patient app must surface an emergency affordance in the composer rather than let a patient describe chest pain into a thread a doctor reads tomorrow.

Read receipts (`POST /conversations/{id}/read`, `lastReadAt`, `unreadCount`) and badge polling (`GET /notifications/badge-counts`, *"poll target 10–15 s, must be O(1)-cheap"*) are specified. **No realtime transport exists** — no WebSocket, no SSE beyond the AI stream. §3 of API Appendix B notes SSE invalidation as a later, shape-preserving upgrade. A patient app should poll on foreground and rely on push when it exists, not architect around a socket that does not.

---

## 11. Emergency integration

**Nothing patient-facing exists. This is also the one feature area that can be built almost entirely without the backend.**

What exists and what it is:

| Item | Reality |
|---|---|
| `patient_emergency_contacts` | The **patient's next of kin**, recorded by a clinician. Not a service directory |
| `doctors.emergency_contact_*` | The **doctor's own** next of kin. Not patient-facing |
| `doctor_time_off.kind = 'emergency-block'` | A doctor blocking their calendar |
| `MessageFlag.emergency_language` | A moderation category |
| `AppointmentPriority.urgent` | A booking priority |
| National emergency numbers | **Do not exist anywhere.** No table, no setting, no constant |
| Nearby emergency hospitals | **Impossible** — no facilities entity, no geo (§8) |

**The brief says "do not invent emergency numbers", and that instruction is doing real work.** Emergency numbers are country- and region-specific (123 vs 997 vs 112 vs 911), they change, and a wrong one in a healthcare app is a category of harm distinct from any other bug in this repository.

**Recommended v1 Emergency experience — deliverable, honest, and mostly frontend:**

1. **A hard, persistent, non-dismissible disclaimer**: *"Medora is not an emergency service. If this is a life-threatening emergency, call your local emergency number now."* — top of screen, not a footnote.
2. **A configurable emergency-numbers table**, seeded per deployment region by the operator (`platform_settings` slice, BE-11), rendered as `tel:` links. **Never hardcoded, never guessed.** If it is unconfigured, the app says so plainly rather than showing a plausible number.
3. **The clinic's own phone and address** from the organization slice (BE-11), with `tel:` and a maps hand-off.
4. **Offline-first, cached.** Emergency content must render with no network and no session. This is the one screen that must work when everything else fails — it belongs in bundled/`MMKV`-cached content, reachable **without login**.
5. **Static first-aid guidance**, clinically reviewed and attributed, bundled with the app.
6. **Two-step activation on any dial action** — the brief is right that prominence must not become accidental calls. A single tap that dials is a design defect on a screen a phone will be in a pocket next to.

**Explicitly not v1:** nearest-hospital routing, emergency dispatch integration, SOS-to-contacts, live ambulance ETA. Each depends on §8's facilities decision or on infrastructure that does not exist.

---

## 12. Proposed mobile architecture

### 12.1 Stack — chosen to match the existing repository, not to be new

| Concern | Choice | Why this and not the alternative |
|---|---|---|
| Framework | **React Native + Expo (managed, dev-client capable)** | Expo carries `expo-secure-store`, `expo-location`, `expo-notifications`, `expo-image-picker` and OTA updates as first-party. Bare RN would mean assembling five community modules and two native toolchains for a graduation project. Ejection remains available |
| Language | **TypeScript, `strict: true`** | Matches both trees. Non-negotiable |
| Navigation | **React Navigation 7** (native-stack + bottom-tabs) | The platform standard; deep-linking maps cleanly onto the notification payloads §14 will need. *Expo Router is the alternative and is rejected only because file-system routing makes the auth/role gate implicit where the web app keeps it explicit* |
| Server state | **TanStack Query 5** | **Same version as `frontend/`.** The query-key factory pattern (`src/api/query-keys.ts`), retry policy and cache semantics transfer directly, and so does everyone's knowledge of them |
| Client state | **Zustand** (session + UI only) | Server state belongs to Query. Redux Toolkit is more machinery than three stores justify |
| Forms | **React Hook Form + Zod** | Same as `frontend/`. **The Zod schemas are shared verbatim with the backend DTOs** — `register.schema.ts` already mirrors the frontend's `signup.ts` field for field. A third transcription is a third place to drift |
| Styling | **StyleSheet + a typed theme via context** | `tokens.css` values ported to `theme/tokens.ts`. NativeWind was considered and rejected: it adds a Babel/Metro transform for a shorthand, and it does not make the token set any more faithful |
| Secure storage | **`expo-secure-store`** (Keychain / Keystore) | Refresh token only. Nothing else |
| Non-sensitive cache | **`react-native-mmkv`** | Emergency content, discovery caches, i18n. **Never PHI** |
| HTTP | **`fetch` + a hand-written client** | Ports `frontend/src/api/client.ts` — single-flight refresh, `X-Correlation-Id`, `X-Client-Type: mobile`, 30 s timeout. Axios buys nothing the existing client does not already do correctly |
| i18n | **`i18next` + `react-i18next`**, RTL via `I18nManager` | Arabic is a live target (`frontend/src/i18n/` ships 5 locales). The typed-catalogue discipline transfers |
| Testing | **Jest + React Native Testing Library**; **Detox** for E2E at Phase U | Matches the repo's test-first gates |

**Dependency discipline:** every addition beyond this list requires a line in the checklist saying which capability needs it. The repo's working agreement is lockfile-only installs and a clean audit (`MG §11.11`).

### 12.2 Tree

```
patient-app/
├── app.json · eas.json · metro.config.js · babel.config.js · tsconfig.json
├── PATIENT_FRONTEND_CHECKLIST.md · PATIENT_APP_AUDIT.md
└── src/
    ├── api/
    │   ├── client.ts             transport: refresh, correlation id, X-Client-Type, timeouts
    │   ├── errors.ts             {message, code, fieldErrors, detail, ref} → typed union
    │   ├── query-keys.ts         the key factory, ported
    │   └── endpoints/            one file per contract module; ONLY real endpoints
    ├── features/
    │   ├── auth/  home/  doctors/  appointments/  clinic/
    │   ├── health-records/  messages/  ai/  emergency/  profile/  notifications/
    │   │   └── <feature>/  api/ · components/ · hooks/ · model/ · screens/
    ├── components/              Button, Card, Input, Sheet, Skeleton, EmptyState, ErrorState…
    ├── navigation/              RootNavigator · AuthStack · AppTabs · linking.ts
    ├── theme/                   tokens.ts · typography.ts · spacing.ts · ThemeProvider
    ├── hooks/  i18n/  types/  utils/
    └── test/
```

`features/*/model/types.ts` mirrors the backend DTOs **verbatim, camelCase, kebab-case enum literals preserved** — the API contract's *"Field names are law"* applies to this client exactly as to the web one.

### 12.3 Layering rule

```
screens → hooks (TanStack Query) → api/endpoints → api/client → NETWORK
              ↑                                        ↓
          components (presentational, no fetching)  errors.ts → typed error union
```

A screen never calls `fetch`. A component never calls a hook that fetches. This is the same rule `FRONTEND_ARCHITECTURE.md` §10 sets for the web app, and it is what makes the mock→real swap a one-directory change.

### 12.4 Offline policy — PHI-aware, and deliberately narrow

| Tier | Content | Store | Rationale |
|---|---|---|---|
| **Bundled** | Emergency guidance, disclaimers, first aid | App bundle | Must work with no network, no session |
| **Cached, non-PHI** | Clinic info, departments, specialties, doctor directory | MMKV, TTL 24 h | Discovery survives a tunnel |
| **Memory only** | Appointments, records, messages, AI history | TanStack Query cache | **PHI is never written to disk.** Cleared on logout, on background timeout, on token loss |
| **Never** | Access token, PHI, message bodies | — | — |

**Mutations are not queued offline.** An appointment booking replayed from a queue three hours later against a slot that no longer exists is worse than a clear "you're offline" message. Reads degrade; writes refuse.

---

## 13. Proposed navigation

Five tabs. The brief's straw-man structure survived the audit with **one substantive change**, and the change matters.

```
┌──────────────────────────────────────────────────────────────────┐
│  RootNavigator                                                   │
│  ├─ [unauthenticated] AuthStack                                  │
│  │     Welcome · Register · Login · OTP · VerifyEmail            │
│  │     · ForgotPassword · ResetPassword                          │
│  │     └─ Emergency  ◀── REACHABLE WITHOUT SIGNING IN            │
│  │                                                               │
│  └─ [authenticated] AppTabs                                      │
│      ├─ Home        upcoming appointment · quick actions ·       │
│      │              emergency banner · recent activity           │
│      ├─ Discover    doctors · specialties · departments ·        │
│      │              Our Clinic · search                          │
│      ├─ Appointments  upcoming | past · detail · booking flow    │
│      ├─ Messages    threads · thread · composer                  │
│      └─ Profile     personal · health records · notifications ·  │
│                     preferences · security · logout              │
│                                                                  │
│  Modal / global (over any tab):                                  │
│      Emergency (also a persistent header affordance)             │
│      AI Assistant (FAB on Home + Discover)                       │
│      BookingFlow (full-screen modal stack, 5 steps)              │
└──────────────────────────────────────────────────────────────────┘
```

**The change: Health Records lives under Profile, not as a sixth tab.**
Five tabs is the platform maximum before labels truncate on a 375 pt screen. Records are a *reference* surface — consulted occasionally, not a daily destination — while Messages is a *conversational* one with unread state that belongs in the tab bar. Records get a prominent Profile entry and a Home shortcut.

**Emergency is not a tab, and that is deliberate.** A tab is one of five equals; emergency is not an equal. It gets:
- a persistent header affordance on every authenticated screen,
- a Home card above the fold,
- a route in the **AuthStack**, so a person in crisis who is signed out or whose token expired still reaches it,
- **two-step activation** before any dial.

**Booking is a full-screen modal stack**, not tab-nested — five steps (Specialty/Doctor → Doctor → Date → Slot → Confirm) with a stepper, a discard guard, and no tab bar competing for the thumb.

**Deep links** map to notification payloads: `medora://appointments/{id}`, `medora://messages/{conversationId}`, `medora://doctors/{id}`, `medora://emergency`.

---

## 14. Patient feature matrix

**Legend** — ✅ endpoint live · 🟡 schema exists, endpoint unbuilt · 🔶 needs a **new** endpoint · 🔴 needs an architecture decision · ➖ out of scope

Traceability reads: **Feature → Screen → Component → Endpoint → Backend module → DB entity.**

| # | Patient feature | Screen | Endpoint | Backend module | DB entity | State |
|---|---|---|---|---|---|---|
| **AUTHENTICATION** |
| 1 | Register | `RegisterScreen` | `POST /auth/register` | auth ✅ | `users`, `user_credentials` | 🔴 **`role` enum excludes `patient`** (AD-1) |
| 2 | Login | `LoginScreen` | `POST /auth/login` | auth ✅ | `users`, `sessions`, `login_events` | 🔴 gated on AD-1; transport ✅ |
| 3 | OTP step-up | `OtpScreen` | `POST /auth/otp/verify` · `/resend` | auth ✅ | `otp_codes` | 🔴 gated on AD-1 |
| 4 | Session persistence | — | `POST /auth/refresh` (`X-Client-Type: mobile`) | auth ✅ | `sessions` | ✅ **built and tested** |
| 5 | Session restore | — | `GET /auth/session` | auth | `users` | 🔶 **specified (§1.11), not implemented** |
| 6 | Email verification | `VerifyEmailScreen` | `POST /auth/verify-email` · `/verification/resend` | auth ✅ | `verification_tokens` | 🔴 gated on AD-1 |
| 7 | Password recovery | `ForgotPasswordScreen` | `POST /auth/forgot-password` · `/reset-password` | auth ✅ | `verification_tokens` | 🔴 gated on AD-1 |
| 8 | Logout | Profile | `POST /auth/logout` | auth ✅ | `sessions` | ✅ |
| **HOME** |
| 9 | Next appointment | `HomeScreen` | `GET /me/appointments?upcoming=1` | appointments | `appointments` | 🔶 new (BE-05) |
| 10 | Quick actions | `HomeScreen` | — | — | — | ✅ frontend only |
| 11 | Recent activity | `HomeScreen` | `GET /me/activity` | users (M8) | `user_activity_log` | 🟡 |
| 12 | Unread badges | tab bar | `GET /notifications/badge-counts` | notifications (M19) | `notifications` | 🟡 + 🔴 (recipient is a `User`) |
| **DOCTOR DISCOVERY** |
| 13 | Search doctors | `DoctorSearchScreen` | `GET /public/doctors` | doctors (M9) | `doctors`, `doctor_specialties` | 🔶 **new patient projection** (BE-04) |
| 14 | Filter by specialty | `DoctorSearchScreen` | `GET /public/specialties` | doctors (M9) | `specialties` | 🔶 new (BE-04) |
| 15 | Filter by department | `DoctorSearchScreen` | `GET /public/departments` | administration (M23) | `departments` | 🔶 new (BE-11) |
| 16 | Doctor profile | `DoctorProfileScreen` | `GET /public/doctors/{id}` | doctors (M9) | `doctors` | 🔶 new (BE-04) |
| 17 | Availability / slots | `SlotPickerScreen` | `GET /public/doctors/{id}/slots?from&to` | appointments (M11) | `doctor_availability`, `doctor_time_off`, `appointments` | 🔶 **new, server-computed** (BE-06) |
| **HOSPITAL / CLINIC** |
| 18 | Our Clinic | `ClinicScreen` | `GET /public/clinic` | platform-settings (M24) | `platform_settings` (organization slice) | 🔶 new (BE-11) |
| 19 | Departments & services | `ClinicScreen` | `GET /public/departments` | administration (M23) | `departments` | 🔶 new (BE-11) |
| 20 | Working days / holidays | `ClinicScreen` | `GET /public/clinic/hours` | administration (M23) | `clinic_working_days`, `holidays` | 🔶 new (BE-11) |
| 21 | Multi-hospital search | — | — | — | — | 🔴 **ADR-010/018 §1 scope out** (AD-3) |
| 22 | Nearby / geo / distance | — | — | — | — | 🔴 **no geo columns, no PostGIS** (AD-3) |
| **APPOINTMENTS** |
| 23 | Book | `BookingFlow` | `POST /me/appointments` | appointments (M11) | `appointments`, `appointment_events` | 🔶 new (BE-07) |
| 24 | Upcoming / past | `AppointmentsScreen` | `GET /me/appointments` | appointments (M11) | `appointments` | 🔶 new (BE-05) |
| 25 | Detail + history | `AppointmentDetailScreen` | `GET /me/appointments/{id}` | appointments (M11) | `appointments`, `appointment_events` | 🔶 new (BE-05) |
| 26 | Cancel | `AppointmentDetailScreen` | `POST /me/appointments/{id}/cancel` | appointments (M11) | `appointments` | 🔶 new (BE-08) — **server owns the rule** |
| 27 | Reschedule / re-confirm | `AppointmentDetailScreen` | `POST /me/appointments/{id}/reschedule` · `/confirm` | appointments (M11) | `appointment_reschedule_proposals` | 🔶 new (BE-08) |
| 28 | Status reflection | all | *(server-provided `availableActions`)* | appointments (M11) | `appointment_status` enum | 🔶 — client must never compute |
| **HEALTH RECORDS** |
| 29 | Medical history | `HealthRecordsScreen` | `GET /me/health/history` | patients (M10) | `patient_medical_history` | 🔶 new (BE-09) |
| 30 | Allergies | `HealthRecordsScreen` | `GET /me/health/allergies` | patients (M10) | `patient_allergies` | 🔶 new (BE-09) |
| 31 | Medications | `HealthRecordsScreen` | `GET /me/health/medications` | patients (M10) | `patient_medications` | 🔶 new (BE-09) |
| 32 | Lab results | `LabResultsScreen` | `GET /me/health/labs` | labs (M14) | `lab_orders`, `lab_results` | 🔶 new (BE-09) + 🔴 **release policy** (AD-5) |
| 33 | Prescriptions | `PrescriptionsScreen` | `GET /me/health/prescriptions` | pharmacy (M13) | `prescriptions` | 🔶 new (BE-09) |
| 34 | Visit summaries | `VisitDetailScreen` | `GET /me/health/visits` | medical-records (M12) | `medical_records` | 🔶 new (BE-09) + 🔴 (AD-5) |
| 35 | Documents | `DocumentsScreen` | `GET /me/health/documents` · `/{id}/download` | files (M25) | `patient_documents`, `files` | 🟡 **no storage backend exists** |
| **AI ASSISTANT** |
| 36 | Navigation assistant | `AiChatScreen` | `POST /me/ai/conversations/{id}/messages` (SSE) | ai (M16) | `ai_conversations`, `ai_messages` | 🔴 **no model provider; owner is a `User`; contexts are clinician-shaped** (AD-4) |
| 37 | Symptom guidance | `AiChatScreen` | as above | ai (M16) | as above | 🔴 (AD-4) + **clinical safety review** |
| 38 | Medical image assist | `AiImageScreen` | *none* | ai + files | *none* | 🔴 **no vision model, no storage, no scanning** |
| 39 | Booking assistance | `AiChatScreen` | as above | ai (M16) | as above | 🔴 (AD-4) |
| **MESSAGING** |
| 40 | Conversation list | `MessagesScreen` | `GET /me/conversations` | messaging (M20) | `conversations`, `conversation_participants` | 🔴 **participants are `User`s** (AD-1) + 🟡 |
| 41 | Thread + send | `ThreadScreen` | `GET`/`POST /me/conversations/{id}/messages` | messaging (M20) | `messages` | 🔴 + 🟡 |
| 42 | Read receipts | `ThreadScreen` | `POST /me/conversations/{id}/read` | messaging (M20) | `conversation_participants.last_read_at` | 🔴 + 🟡 |
| 43 | Attachments | `ThreadScreen` | `POST …/attachments` · `GET /attachments/{id}/download` | messaging + files | `message_attachments` | 🔴 + 🟡 (scan gate exists in schema only) |
| **NOTIFICATIONS** |
| 44 | In-app list | `NotificationsScreen` | `GET /me/notifications` | notifications (M19) | `notifications` | 🔴 (recipient is a `User`) + 🟡 |
| 45 | Preferences | `NotificationPrefsScreen` | `GET`/`PUT /me/notification-preferences` | notifications (M19) | `notification_preferences` | 🔴 + 🟡 |
| 46 | Push delivery | — | `POST /me/devices` (push token) | notifications (M19/M41.2) | `notification_deliveries` (`PUSH` channel exists) | 🔶 **no registration endpoint, no provider** (BE-12) |
| **PROFILE** |
| 47 | View / edit profile | `ProfileScreen` | `GET`/`PATCH /me/profile` | users (M8) | `users`, `patients` | 🔶 new (BE-10) + 🔴 **which fields may a patient edit?** (AD-2) |
| 48 | Photo | `ProfileScreen` | `PUT /me/profile/photo` | files (M25) | `files` | 🟡 no storage backend |
| 49 | Change password | `SecurityScreen` | `POST /me/password` | auth ✅ | `user_credentials` | ✅ |
| 50 | Sessions / devices | `SecurityScreen` | `GET /me/sessions` · `DELETE …/{id}` | users (M8) | `sessions`, `trusted_devices` | 🟡 |
| **EMERGENCY** |
| 51 | Guidance + disclaimer | `EmergencyScreen` | — | — | — | ✅ **frontend only — ship first** |
| 52 | Emergency numbers | `EmergencyScreen` | `GET /public/emergency-contacts` | platform-settings (M24) | `platform_settings` | 🔶 new (BE-11) — **never hardcode** |
| 53 | Clinic phone / directions | `EmergencyScreen` | `GET /public/clinic` | platform-settings (M24) | `platform_settings` | 🔶 new (BE-11) |
| 54 | Nearby emergency hospitals | — | — | — | — | 🔴 (AD-3) |
| **LOCATION** |
| 55 | Permission + maps hand-off | `ClinicScreen` | — | — | — | ✅ frontend only (address → `geo:`/`maps://`) |
| 56 | Distance / proximity search | — | — | — | — | 🔴 (AD-3) |

**Tally — 56 mapped capabilities:** ✅ live **4** · ✅ frontend-only **3** · 🔶 new endpoint required **26** · 🟡 schema-only **8** · 🔴 architecture decision **15**.

---

## 15. Gap analysis

### 15.1 Already supported (build against it today)

| # | Capability | Evidence |
|---|---|---|
| AS-1 | Password login, OTP step-up, refresh rotation with reuse detection, logout | M6 complete, e2e-tested |
| AS-2 | **Mobile token-in-body refresh** (`X-Client-Type: mobile`) | `auth.controller.ts:285`, `auth-refresh.e2e-spec.ts:250` |
| AS-3 | Password reset, email verification, resend | M6.4/M6.5 |
| AS-4 | Change password, TOTP 2FA lifecycle | `me/password`, `me/2fa` |
| AS-5 | Error envelope + machine `code` + correlation id | `common/http/`, `common/errors/` |
| AS-6 | Deny-by-default authorization, care scoping, PHI masking | M7 kernel |
| AS-7 | 107 tables, 80 enums, appointment status machine + DB trigger | M5 complete |

### 15.2 Frontend only (no backend change)

| # | Capability |
|---|---|
| FO-1 | **Emergency guidance, disclaimers, first aid, two-step dial** — bundled, offline, pre-auth |
| FO-2 | Mobile design system: tokens ported from `tokens.css`, typography, spacing, dark mode, safe areas |
| FO-3 | Navigation shell, deep-link table, auth gate |
| FO-4 | Loading / skeleton / empty / error / offline states |
| FO-5 | Form validation (Zod schemas shared with backend DTOs) |
| FO-6 | Location permission UX + maps/`tel:` hand-off from an address string |
| FO-7 | i18n + RTL scaffolding (5 locales, logical properties) |
| FO-8 | Accessibility: 44×44 pt targets, dynamic type, screen-reader labels, reduced motion |
| FO-9 | Secure storage plumbing, PHI-aware cache policy, session-expiry handling |

### 15.3 Backend dependency (existing plan, unbuilt)

Each maps to a roadmap milestone that already exists. **This is not new backend scope — it is the roadmap arriving.**

| # | Need | New? | Milestone |
|---|---|---|---|
| BE-01 | `role: 'patient'` in `register.schema.ts` + seeded `patient` role | small change | M6/M7 |
| BE-02 | `patients.user_id` FK + link/claim flow | **migration** | new |
| BE-03 | `GET /auth/session` (specified §1.11, absent) | small | M6 |
| BE-04 | **Patient-facing doctor projection** — no licence, no personal contact; verified/active only ⚠ *Realigned 2026-10-06 (multi-organization):* extended — the projection gains `affiliations` (organization, location, department) and is served **without sign-in** once BE-17 exists (API-P03, API-P04 in `PATIENT_FRONTEND_CHECKLIST.md`). ⚠ **Superseded 2026-10-07 (Multi-Hospital FINAL):** the projection stays **authenticated** (DR-09) and carries the doctor's **one active hospital** employment, not `affiliations[]` (DR-02). | **new** | M9 |
| BE-05 | `GET /me/appointments` (+ `/{id}`) — patient-scoped list & detail | **new** | M11 |
| BE-06 | `GET /public/doctors/{id}/slots` — **server-computed** availability − time-off − booked − buffer ⚠ **Superseded 2026-10-07 (Multi-Hospital FINAL):** patients see only **doctor-published** slots, capacity 1, from authenticated `GET /patient/doctors/:id/slots`; computed availability is never patient inventory (DR-10, DR-11, OD-08). | **new** | M11 |
| BE-07 | `POST /me/appointments` — patient-initiated, creates `pending` | **new** | M11 |
| BE-08 | `POST /me/appointments/{id}/cancel` · `/reschedule` · `/confirm` + server-provided `availableActions` | **new** | M11 |
| BE-09 | `GET /me/health/*` — history, allergies, medications, labs, prescriptions, visits, documents | **new** | M10/M12/M13/M14 |
| BE-10 | `GET`/`PATCH /me/profile` for patients | **new** | M8 |
| BE-11 | `GET /public/clinic` · `/departments` · `/specialties` · `/emergency-contacts` — public projections ⚠ *Realigned 2026-10-06 (multi-organization):* the single-clinic projection is **replaced** by organization and location projections (API-P01, API-P02) and public specialties (API-P05); `/emergency-contacts` stays a per-region operator setting. ⚠ **Superseded 2026-10-07 (Multi-Hospital FINAL):** organizations become **hospitals** (with clinics and multiple locations), served to **signed-in** patients only (DR-01, DR-09, OD-06; `docs/multi-hospital/API_CONTRACT_CHANGES.md` §5). | **new** | M23/M24 |
| BE-12 | Push-device registration + a push provider | planned | M41.2 |
| BE-13 | Patient participation in `conversations` (FK consequence of BE-02) | **new** | M20 |
| BE-14 | Patient-scoped AI: own context vocabulary, own scope resolver, own safety rules | **new** | M16 |
| BE-15 | Files service + object storage + malware scanning | planned | M25 |
| BE-16 | Redis permission cache (needed before multi-instance; a mobile population makes that sooner) | planned | M7.1/M31 |
| BE-17 | Rate limiting on public and patient routes — none exists today ⚠ *Realigned 2026-10-06 (multi-organization):* now also a **prerequisite for signed-out discovery** (API-P08) — no public route opens before it. ⚠ **Superseded 2026-10-07 (Multi-Hospital FINAL):** there is no signed-out discovery (DR-09); rate limiting is recommended for authenticated discovery and booking. | **new** | M37 |

### 15.4 Architecture decision required

| # | Decision | Blocks | Recommendation |
|---|---|---|---|
| **AD-1** | **Do patients authenticate?** ADR-018 §3 says no; UX §3.4 + API §4.11 assume patient accounts with resettable credentials. **The repository contradicts itself.** | *Everything.* 15 matrix rows | **Amend ADR-018 §3 via a new ADR-030.** Option A (§4.1): nullable `patients.user_id`, a `patient` role, a claim flow. ADR-018 already names the anchors this would use |
| **AD-2** | **Patient self-service authority.** Which fields may a patient edit? Who owns `phone`, `address`, `insurance` when a clinician also edits them? | Profile, registration | Patient owns contact + preferences; clinical fields stay clinician-owned and read-only. Conflicts resolve clinician-wins with an audit row |
| **AD-3** | **Multi-facility + geo.** ADR-010 scopes `clinics`/`facilities` out; ADR-018 §1 forbids `clinic_id`; a test enforces it. Hospital discovery and "nearby" need all three reversed | 4 matrix rows | **Keep out of v1.** Ship "Our Clinic". Record a scoped-out epic. Reversing this is a multi-clinic programme, not a mobile feature ⚠ *Realigned 2026-10-06 (multi-organization):* **reversed by the owner.** Medora is a multi-hospital / multi-clinic platform: hospital, clinic and medical-center discovery is in scope and available signed out; "Our Clinic" becomes an organization profile; nearby and distance stay future and need real location data. The backend and database work is those teams'; the ADRs (018 §1, 010 group 16) are not yet superseded in `docs/DECISIONS.md`. ⚠ **Superseded in part 2026-10-07 by the FINAL Multi-Hospital decisions** (`docs/multi-hospital/OWNER_DECISIONS.md`; ADR-042 *Proposed*): **Hospital** is the boundary and Clinic/Location are entities inside it (DR-01, OD-06); discovery is **signed-in only**, never signed out (DR-09); "Our Clinic" becomes a hospital profile; distance and ratings are in scope for signed-in comparison (OD-10); uninsured patients are unrestricted (OD-14). |
| **AD-4** | **Patient AI safety.** Doctor AI is a canned-response mock with no provider. A patient symptom assistant is a different risk class | 4 matrix rows | Gate on: a real provider, a red-flag triage classifier that routes to Emergency *before* generating, a named clinical owner, an output filter, and full audit. **Ship after appointments and records, never before** |
| **AD-5** | **Results-release policy.** May a patient see a `critical-high` lab result before a clinician has reviewed it? `lab_orders.reviewed_by` and `criticalUnreviewed` already exist | Labs, visit summaries | **Hold critical/abnormal results until reviewed.** Show "results pending review" plus a contact route. Requires a clinical policy owner |
| **AD-6** | **Where does `patient-app/` live in the branch model?** `CLAUDE.md` has four integration branches; none covers a fourth client | Git workflow, CI | Add a `patient-app` integration branch cut from `main`; add a CI path filter. §16 |
| **AD-7** | **Realtime.** Messaging and badges are poll-based; no socket exists | Messaging UX | Poll on foreground + push. Do not architect around a socket that does not exist (API Appendix B §3 keeps SSE shape-compatible) |

### 15.5 Out of scope — do not build

| # | Item | Why |
|---|---|---|
| OOS-1 | Any doctor or admin surface in the patient app | §4 of the brief; also a PHI boundary |
| OOS-2 | Prescribing, ordering labs, editing records, signing notes | Clinician actions. `records.edit`, `prescriptions.create`, `labs.review` are clinician capabilities |
| OOS-3 | Viewing another patient's data in any form | The whole point of care scoping |
| OOS-4 | Billing, payments, insurance claims | ADR-018 §2, `billing: false`, no tables |
| OOS-5 | A second backend, a second database, duplicated appointment logic | §2 and §30 of the brief |
| OOS-6 | Client-side appointment business rules | The server owns transitions (§6) |
| OOS-7 | Telemedicine / video | No infrastructure, no spec |
| OOS-8 | Emergency dispatch, ambulance integration, SOS-to-contacts | No infrastructure; a safety-critical integration far beyond this scope |
| OOS-9 | Wearables / device sync | No spec, no tables |
| OOS-10 | Multi-clinic switching | ADR-018 §1 |

---

## 16. Risks

| # | Risk | Severity | Detail & mitigation |
|---|---|---|---|
| **R-1** | **ADR-018 §3 is not a gap, it is a decision.** Building patient auth without amending it means shipping code that contradicts a signed architecture record, and a *test* that asserts no patient role fails | **Critical** | Do not code around it. **ADR-030 first**, with the owner. This is checklist item A-01 and nothing precedes it |
| **R-2** | **Account-to-record linking is an identity-proofing problem, not a form.** A patient signing up with `sara@…` must be matched to `PT-1042` — and a wrong match discloses one person's PHI to another | **Critical** | Never auto-link on email alone. Require a clinic-issued claim code, or staff-mediated linking, or MRN + DOB + an OTP to the phone **already on the clinical record**. Every attempt audited. Rate-limited. This deserves its own ADR section |
| **R-3** | **Doctor DTO leakage.** `doctors` carries `license_number`, `contact_phone`, `emergency_contact_phone`, `employee_id` | **High** | A **separate server-side projection** (BE-04) with a contract test asserting the forbidden fields are absent from the response body. Hiding them in the UI is not a control |
| **R-4** | **The backend is 35/188 complete.** The patient app depends on 26 endpoints that do not exist. Building a mobile app over mocks repeats the doctor SPA's position — 859 files against zero live endpoints | **High** | Sequence the checklist by backend readiness, not by screen appeal. Ship Emergency (needs nothing) → auth (needs AD-1 + BE-01/02) → discovery → appointments. Keep a **single** mock adapter behind the same seam the web app uses, so the swap is one directory |
| **R-5** | **A patient symptom assistant on a canned-response generator.** The existing mock makes this the *easiest* thing to build by accident, and the most dangerous thing to ship | **High** | AD-4. Phase K stays P1 and gated. No AI ships without a red-flag classifier and a named clinical owner |
| **R-6** | **Emergency prominence vs accidental dialling.** Prominent + one-tap = pocket dials to emergency services | **High** | Two-step activation. Confirmation sheet naming the number. Never a swipe or a long-press-to-dial |
| **R-7** | **Unreviewed critical results reaching a patient first** | **High** | AD-5. Server-side gate on `reviewed_at`, not a client filter |
| **R-8** | **PHI on device.** A cached record on a lost, unlocked phone is a disclosure | **High** | PHI in memory only; MMKV for non-PHI only; clear on logout/background timeout; no PHI in logs, crash reports or analytics; screenshot suppression on records screens; optional biometric gate |
| **R-9** | **No rate limiting exists.** Public discovery endpoints + a mobile client are an enumeration surface (`GET /public/doctors/{id}` walked over ids) | **High** | BE-17 before any public route ships. Care scoping's 404-not-403 discipline (M7.2) must extend to every new `/me/*` route |
| **R-10** | **Redis is still deferred.** `InMemoryPermissionCache` is per-process; a revocation does not propagate for up to 5 min | **Medium** | BE-16 before multi-instance. A mobile population brings that forward |
| **R-11** | **Field-name drift.** *"Field names are law"*, and a fourth client is a fourth place to transcribe them | **Medium** | Generate or share DTO types; add a parity spec for the patient app the way `permission-catalogue.spec.ts` binds frontend↔backend |
| **R-12** | **Timezone correctness.** Slots, reminders and "today" across UTC storage, clinic timezone (`localization.timezone`) and device timezone | **Medium** | Server returns ISO-8601 UTC *and* the clinic timezone; the client formats, never computes. Test across DST boundaries |
| **R-13** | **CI and branch model do not cover a fourth tree.** `ci.yml` filters `frontend/` and `backend/` only; a `patient-app/` commit runs **nothing** and reports green | **Medium** | AD-6 + a third CI job with its own path filter, added to the aggregate `CI` check |
| **R-14** | **No mobile release infrastructure.** No store accounts, no signing, no EAS config, no privacy manifests | **Medium** | Phase W. Start store enrolment early — review latency is weeks, not hours |
| **R-15** | **Scope.** The brief describes ~10 feature areas over a backend at Milestone 6 of 43 | **Medium** | The checklist's P0 set is deliberately small. Treat P1/P2 as a backlog, not a plan |

---

## 17. Git & CI placement (AD-6, resolved as a recommendation)

`CLAUDE.md` defines four integration branches. A patient app fits none:

| Option | Assessment |
|---|---|
| Branch from `frontend` | `frontend` means the doctor/admin SPA. A React Native tree there invites a merge that touches both |
| Branch from `main` | Correct for a genuinely new top-level tree — the precedent is `backend/`, which was created on `main` as specs-only |
| **New `patient-app` integration branch from `main`** | **Recommended.** Mirrors the existing per-domain model; task branches `claude/<task>` → PR → `patient-app` → later `main` |

**CI must gain a third job** with a `^patient-app/` path filter, added to the aggregate `CI` check's `needs` list — otherwise a patient-app commit runs no suite and reports green (R-13).

**This document and the checklist are cross-domain audit artifacts** (they read backend, database, frontend and docs, and change none of them), which is why they are committed from `main` on the designated task branch rather than from an integration branch.

---

## 18. Recommended sequence

```
0.  ADR-030 — patient identity                  ◀── OWNER DECISION. Blocks everything
1.  Emergency (bundled, offline, pre-auth)      ◀── ships with zero backend
2.  Project setup + design system + navigation
3.  BE-01/02/03  →  Auth + onboarding
4.  BE-04/11     →  Doctor discovery + Our Clinic
5.  BE-05/06/07/08 → Appointments (the core loop)
6.  BE-09 + AD-5 →  Health records
7.  BE-12        →  Notifications + push
8.  AD-1 (FKs) + BE-13 → Messaging
9.  AD-4 + BE-14 →  AI assistant  ◀── last, deliberately
```

**What is being asked of the owner before implementation begins:** decisions **AD-1** (patient identity — blocks everything), **AD-3** (multi-facility scope), **AD-4** (AI safety gate) and **AD-5** (results release). AD-2, AD-6 and AD-7 have recommendations in this document that can stand unless overruled.

---

*End of audit. The implementation plan is [`PATIENT_FRONTEND_CHECKLIST.md`](PATIENT_FRONTEND_CHECKLIST.md).*
