# Multi-Hospital — Backend Checklist

**Owner team:** Backend (with Security review)
**Work phases:**
- 22 — hospital context and authorization
- 22A — grants, Break-Glass, consultations, documentation provenance
- 23 — authenticated discovery
- 24 — slots and booking
- 26 — admin APIs
- 28 — AI authorization
- 29 — integration closure
- 30 — security tests
- §K — Backend support for the patient AI assistant (P-AI-3 appointment assistance, P-AI-4 doctor
  recommendation). Spans 23, 24, 28 and 30; added 2026-10-10

See `docs/work-phases/`.
**Decisions:** all FINAL (`OWNER_DECISIONS.md`), including OD-04 = A (Break-Glass) and OQ-01 = A.
Only OQ-02 (record-claim identity proofing, RA-030.1) is open, and it is deferred to implementation.
**Status:** NOT STARTED.

---

## A. Hospital context and session

- [ ] **A1** Request-scoped hospital context, resolved server-side — DR-08:
  - doctor → active employment; none → no clinical access (OD-12);
  - Hospital Admin → their hospital;
  - Platform Admin → platform scope, no clinical data (OD-07);
  - patient → the resource acted on.
- [ ] **A2** Session exposes `activeHospital` and `adminScope`. **No switch route.** No memberships list (DR-02, DR-08)
- [ ] **A3** Employment termination: **immediate** invalidation of sessions, refresh tokens, permission caches (all instances), dependent grants, **Break-Glass sessions** and AI access. No grace period (OD-12)
- [ ] **A4** Fix F33 (seeded admin cannot complete TOTP)
- [x] **A5** Lock-screen re-authentication endpoint (`docs/handoff/auth-seam.md` §4) — `POST /me/password/verify`, 2026-11-05 on `backend` (204, no new session; shares sign-in's lockout and revokes the session on lock; `backend/test/auth-reauthenticate.e2e-spec.ts`)

## B. Authorization

- [ ] **B1** Redesign `PatientScopeService` (assignment anchor, M7.2/ADR-022, AF-14). Default rule = **active hospital + role + permissions** (DR-05). Shadow-mode diff before switching
- [ ] **B2** Assignment is hospital-scoped workflow data and never an access bypass (DR-07)
- [ ] **B3** Enforcement in the data-access layer. Covers ids, lists, search, filters, exports, aggregates, admin endpoints, assignments, messages, AI context and caches
- [ ] **B4** 404 for foreign-hospital ids; hospital stamped on create; mismatching client hospital rejected
- [ ] **B5** Audit cross-hospital denials
- [ ] **B6** Server-side PHI withholding with audited reveal (AF-24)
- [ ] **B7** Platform Admin vs Hospital Admin guards. Platform Admin gets **no automatic clinical access**; any clinical access is explicitly permissioned and audited (OD-07)

## C. Hospital-scoped routes

- [ ] **C1** Scope `/patients`, `/patients/:id/*`, `/appointments`, `/medical-records`, `/lab-orders`, `/prescriptions`, `/dashboard/doctor`, `/reports/analytics`, `/notifications`, `/search` to the hospital context (AF-15)
- [ ] **C2** Split admin routes into `/hospital-admin/*` and `/platform/*` (M23 administration, M24 platform settings, M28 audit, oversight, users, doctors) — OD-07
- [ ] **C3** Hospital-scoped notifications and search

## D. Cross-hospital access — path 1: grants (DR-06, OD-01, OD-02, OD-03, OD-12)

- [ ] **D1** Request (purpose + categories), Hospital B Admin approve/reject. Approval sets approved categories ⊆ requested and an explicit end
- [ ] **D2** Grant-based read endpoints, category-filtered. **Validity re-checked on every call**: approved, not expired, not revoked, purpose open, requester employed, category included
- [ ] **D3** Revoke (Hospital B Admin), close (requester, purpose ended), automatic expiry. All take immediate effect
- [ ] **D4** Every lifecycle and access event audited, including AI use
- [ ] **D5** No patient-consent step for normal grants (OD-02); no fixed default duration (OD-01)

## D-BG. Cross-hospital access — path 2: Break-Glass (OD-04)

- [ ] **BG1** Start a Break-Glass session: authorized doctor (permission) with an **active employment**; required emergency reason; one patient; minimum-necessary emergency category set; bounded window
- [ ] **BG2** Every read validity-checked (active, within window, not revoked, employment active, category in scope) and audited with doctor, target hospital, patient, categories and resources
- [ ] **BG3** Target Hospital Admin notified at start; revocation endpoint; post-event review queue
- [ ] **BG4** Automatic end; afterwards 404, with no unrelated or continued access; continuing need goes through path 1
- [ ] **BG5** Never widens ordinary routes, never bypasses employment or general isolation, never permanent

## D-DOC. Doctor-approved documentation into the requesting hospital's record (OQ-01 = A)

- [ ] **DOC1** Save endpoint: doctor-only explicit action, while the authorization (grant or Break-Glass) is valid; per-item selection within the authorized categories; **no whole-record import**
- [ ] **DOC2** Creates Hospital A clinical content (e.g. note/addendum) plus a provenance row (source hospital, authorization, categories, source refs, approving doctor, time, `aiAssisted`)
- [ ] **DOC3** Saved content follows Hospital A rules. Provenance refs never resolve to B data without valid authorization. No access to B by side effect
- [ ] **D6** Grants never widen ordinary routes

## E. Cross-hospital consultation (OD-13)

- [ ] **E1** Consultation request, messages and close; participants may be at different hospitals; audited
- [ ] **E2** Messages may carry clinical conversation and patient context. Medical Record data only via a valid grant's categories or valid Break-Glass
- [ ] **E3** No bypass of isolation, categories, audit, employment or expiry/revocation

## F. In-hospital messaging (AF-16)

- [ ] **F1** Fix thread creation: each participant must be a valid user **in the caller's hospital** with an allowed role; an attached `patientId` must have a Medical Record in that hospital
- [ ] **F2** Bring M20 from `backend` to `main` only with F1 in place; cross-hospital conversations only through E

## G. Authenticated discovery (DR-09, OD-10, OD-14)

- [ ] **G1** `@Authenticated()` discovery/search endpoint with comparison rows: hospital, clinic, location, doctor, specialty/department, distance, rating, next published slot, insurance flag. No `@Public()`
- [ ] **G2** Distance from per-request coordinates (not stored); location coordinates
- [ ] **G3** Ratings and reviews from `satisfaction_surveys`; aggregate `ratingAvg`; moderate review text; never expose clinical or identifying content
- [ ] **G4** Insurance: insured patients get coverage-aware results; **uninsured patients get unrestricted results**
- [ ] **G5** Request rate limiting on discovery and booking (AF-20) — TECHNICAL RECOMMENDATION

G1–G5 are broken down into tasks with acceptance criteria in §K phase B (AST-B1…AST-B10) and AST-G1.

## H. Published slots and booking (DR-10, DR-11, OD-08, OD-09, OD-14)

- [ ] **H1** Doctor publishes and withdraws slots at the active hospital (and optionally clinic and location); capacity 1
- [ ] **H2** Patient sees only published, unbooked, future slots
- [ ] **H3** Booking in one transaction: atomic slot transition, `Idempotency-Key`, hospital and doctor from the slot, `409 slot_taken`
- [ ] **H4** Insured patients: coverage validated (`422 insurance_not_covered`); uninsured patients: no coverage check
- [ ] **H5** First real interaction creates the hospital Medical Record (OD-09)
- [ ] **H6** Patient actions via `availableActions` and implementation policy; never capacity > 1 or a hospital change

H1–H6 are broken down into tasks with acceptance criteria in §K phases C and D (AST-C1…AST-C6,
AST-D1…AST-D12).

## I. AI authorization (DR-12)

- [ ] **I1** `AiContextService` requires the hospital context; default current-hospital only
- [ ] **I2** Optional cross-hospital authorization (grant or Break-Glass): validity re-checked **every turn**; scope-filtered fragments only
- [ ] **I3** AI data classes (AF-39): C1 same-hospital (normal retention); C2 transient cross-hospital context and un-approved derived output, tagged and purged/inaccessible at authorization end; continuation lock. C3 = doctor-approved content saved via DOC1, which is Hospital A data
- [ ] **I4** No cross-hospital content in persistent RAG indexes, profiles or training
- [ ] **I5** No-clinical-write containment kept (M16.6)
- [ ] **I6** Provider adapter behind `AI_GATEWAY` (provider-agnostic), enabled only after G-5

## J. Security tests (Phase 30)

- [ ] **J1** Negative and lifecycle tests N-1…N-30 (`SECURITY_AND_DATA_ISOLATION.md` §9)
- [ ] **J2** Gates G-1…G-8

## K. Backend support for the patient AI assistant (P-AI-3, P-AI-4)

**Added:** 2026-10-10. **Status:** NOT STARTED. Nothing in this section is implemented.
**Scope:** the Backend side of the patient assistant that helps a signed-in patient discover and compare
hospitals and doctors, find real published slots, book with explicit confirmation, and manage their own
appointments. The AI side is `AI_CHECKLIST.md` §6 (AG-\*, with P-AI-3, P-AI-4, R1–R6), owned by the AI team and
maintained on the `Ai` branch; this branch carries a verbatim copy. The earlier `AIA-*` task IDs are
retired aliases (`AI_CHECKLIST.md` §6.12). The Database side
is `DATABASE_CHECKLIST.md` §I. Tool contracts: `API_CONTRACT_CHANGES.md` §10.

The AI engineer has not started. This section treats the assistant as greenfield and claims nothing exists
beyond the baseline in K.1.

**Proposed, not adopted:** the unified AI plan asks for changes to the intent contract and storage
(`API_CONTRACT_CHANGES.md` §10.5, `DATABASE_CHECKLIST.md` I.2). They are conditional on KD-2 choosing the
appointment intent and pending Backend and Database lead review. Until a later PR adopts them, §10.2–§10.4
and I2/I3 as written are authoritative, and nothing in them approves KD-2.

### K.0 Rules for every task in this section

1. **The Backend is the only authority.** Whether a patient may see, book, cancel or reschedule something,
   and whether a write succeeded, is decided and reported by the Backend. The model only relays the
   Backend's answer. It never decides authorization, availability or success.
2. **No direct data access for the model.** The model calls an allow-listed set of tools. Each tool maps to
   one validated Backend operation (`API_CONTRACT_CHANGES.md` §10). No SQL, no repository access, no
   database credentials, no "generic query" tool.
3. **Confirmation is enforced by the Backend, not requested in a prompt.** A booking, cancellation or
   rescheduling that starts in the assistant cannot complete without an explicit patient confirmation the
   model cannot produce (KD-2).
4. **Identity and hospital come from the server.** The patient is the authenticated session, never a tool
   argument. The hospital comes from the slot or the appointment row. A model-supplied `hospitalId` is at
   most a discovery filter (DR-08, `API_CONTRACT_CHANGES.md` §0).
5. **Authenticated only.** Discovery requires sign-in (DR-09). The task brief's conditional "public
   discovery before login, if approved" is **not approved**: DR-09 is FINAL. No assistant tool is reachable
   signed out.
6. **No invented data.** Ratings, distance and insurance are returned only when their data exists (AF-40).
   Otherwise the field is `null` and the assistant must not present it.

### K.1 Verified baseline (read-only audit, 2026-10-10, `backend` @ `0deef52`)

Method: read the controllers, services, repositories, Prisma schema, e2e specs and `docs/DECISIONS.md`, and
grep `backend/src`, `backend/prisma` and `backend/package.json`. Nothing was executed. "Missing" means not
found by the search named in the evidence column.

| # | Capability | Status | Evidence |
|---|---|---|---|
| BL-1 | Hospital entity and identifiers | **Missing** | No `model Hospital`, `Clinic` or location model in `backend/prisma/schema/*.prisma`. `Doctor.hospital` is free text `VarChar(80)` (`04-people.prisma`). AF-01, AF-03 |
| BL-2 | Doctor ↔ hospital relationship | **Missing** | No employment model. One `Doctor.departmentId`; `Department.name` globally unique. AF-03, AF-04 |
| BL-3 | Doctor discovery | **Partially implemented** | `GET /patient/doctors` (`q` ≤120 chars, `specialtyId`, `departmentId`, `sort` ∈ `name:asc\|name:desc\|rating:desc`, `pageSize` ≤100), `GET /patient/doctors/:doctorId`, `GET /patient/specialties`. All `@Authenticated()`. Verified and actively practising doctors only (`patient-doctor.repository.ts`). Allow-list projection with `FORBIDDEN_DOCTOR_FIELDS` (`patient-doctor.dto.ts`), tested in `test/patient-api.e2e-spec.ts`. The DTO docblock names a `patient-doctor.dto.spec.ts` that does not exist; the e2e spec is the real coverage. **Unmet:** no hospital, clinic, location, distance or insurance; `ratingAvg` is never written (AF-40), so `rating:desc` sorts on nulls |
| BL-4 | Hospital discovery and details | **Missing** | No hospital route on any controller. AF-18 |
| BL-5 | Patient-facing availability | **Missing** | Only doctor-side working hours: `GET/PUT /me/availability`, `/me/time-off` (`availability.controller.ts`), backed by `DoctorAvailability` weekday windows. No published-slot model, no patient slot route. AF-10, AF-22. Computed slots are superseded (DR-10) |
| BL-6 | Time zone and serialization | **Partially implemented** | One clinic-wide IANA zone from `platform_settings.localization.timezone`, falling back to UTC (`appointments/services/clinic-timezone.ts`). Timestamps on the wire are ISO-8601 UTC. No per-hospital or per-location zone |
| BL-7 | Appointment creation | **Partially implemented (doctor only)** | `POST /appointments` under `@Can('appointments.manageOwn')` (`appointment.controller.ts`). `SlotConflictChecker.assertBookable` reads, then the insert runs: check-then-write, no DB exclusion or uniqueness (AF-11). Tested in `test/appointments-book.e2e-spec.ts`; no concurrent-create test found. **Patient booking is missing:** `test/patient-appointments.e2e-spec.ts` asserts that `POST /me/appointments`, `/cancel` and `/confirm` are absent |
| BL-8 | Cancel and reschedule | **Partially implemented (doctor/admin only)** | `POST /appointments/:id/cancel\|reschedule` and `/admin/appointments/:id/cancel-administratively\|reassign`. Transitions are compare-and-set (`appointment.service.ts` `move()`; lost race → 409), proven by `test/appointments-transitions.e2e-spec.ts` "concurrency — compare-and-set". A cancellation reason is required by a DB CHECK. **Patient actions are missing and blocked:** ADR-033 is *Proposed* (KD-3) |
| BL-9 | Patient's own appointments (read) | **Verified existing** | `GET /me/appointments` and `GET /me/appointments/:appointmentId` (`patient-appointment.controller.ts`). Ownership is a WHERE clause through `PatientSelfScopeService`; 404 never 403; `clinicTimezone` returned. `test/patient-appointments.e2e-spec.ts`. Single clinic: no hospital field |
| BL-10 | Patient identity | **Partially implemented** | ADR-030: `patients.user_id` nullable and unique. Registration creates **no** `patients` row, so a new account is "authenticated but unlinked" and owns nothing. The claim flow is undecided (RA-030.1 / OQ-02). `patient-self-scope.service.ts`, `test/patient-identity.e2e-spec.ts`. Consequence: KD-4 |
| BL-11 | Authentication and session | **Verified existing** | Global `AccessTokenGuard`: every route needs a token unless `@Public()`. Access JWT ≤900 s (`config/env.schema.ts` `JWT_ACCESS_TTL`). Signature-only check, no DB read, so a revoked session keeps working until the token expires (`access-token.guard.ts`). Refresh rotation and `X-Client-Type: mobile`. `AuthorizationGuard` denies an unannotated route, enforced by `test/authz-matrix.e2e-spec.ts`. A patient holds zero capabilities (ADR-030 §6) |
| BL-12 | Hospital-level isolation | **Missing** | No hospital in the token, schema or scope services. AF-13, AF-14, AF-23 |
| BL-13 | Credential for a non-browser caller (AI service) | **Missing** | No service account or delegated token. API keys "authenticate nothing" (RA-M24.1, `platform-settings/services/api-key.service.ts`). Consequence: KD-1 |
| BL-14 | Validation and error envelope | **Verified existing** | Zod pipes (`common/validation/zod-validation.pipe.ts`). Stable machine `code` (ADR-012, `common/errors/error-codes.ts`, `common/http/all-exceptions.filter.ts`). **Needs verification:** no explicit JSON body limit is set in `main.ts`, so the framework default applies; M37.1 "JSON limits" is unticked |
| BL-15 | Rate limiting | **Missing** (except auth) | Per-account login lockout and OTP/resend throttles only (`login.service.ts`, `step-up.service.ts`). No limiter package in `backend/package.json` and none in `src/`. The comment in `error-codes.ts` about "the global limiter" describes nothing that exists. AF-20. ADR-030: rate limiting "must land before any public or patient route ships" |
| BL-16 | `Idempotency-Key` | **Missing** | ADR-014 is *Accepted*, but `grep -rn "Idempotency-Key" backend/src` finds nothing |
| BL-17 | Audit events | **Verified existing (partial for this scope)** | `AUDIT_DISPATCHER` → `shared/audit/prisma-audit.writer.ts` → partitioned `audit_events` (ADR-024). Appointment actions audit after commit (`appointment.service.ts` `afterWrite`). Best-effort, not transactional (RA-M28.2). No `hospital_id` on audit rows; no tool-call audit, because no tools exist |
| BL-18 | AI endpoints and provider | **Partially implemented (doctor only)** | `/ai/conversations*`, `/ai/prompts`, `/ai/model`, `/me/ai-settings`, all `@Can('ai.use')`. In the seeded matrix only `doctor` holds `ai.use`, and `patient` has no matrix column at all (`permission-catalogue.ts`), so **no patient AI route exists**. `AI_GATEWAY` → `UnconfiguredAiGateway` (503, AF-26). The port has no tool-use protocol (`shared/ai/ai-gateway.types.ts`). `ai_messages` stores text verbatim (AF-39); logs are metadata-only (`ai-transcript.log.ts`); containment in `modules/ai/ai-containment.spec.ts`; `test/ai-assistant.e2e-spec.ts`. `AiContextMode` is clinician-shaped (`01-enums.prisma`) |
| BL-19 | APIs an AI agent could call today | **Partially implemented** | Read-only: BL-3 and BL-9. No slot, booking, cancel or reschedule route for patients |
| BL-20 | Isolation and cross-patient tests | **Partially implemented** | Cross-patient 404 on `/me/appointments/:id` is tested (BL-9). `/me/profile` takes no id; `test/patient-api.e2e-spec.ts` asserts it returns the caller's own record and never another's. No hospital-isolation test exists (AF-23) |

### K.2 Ownership

| Team | Owns in this feature | Does not own |
|---|---|---|
| **Backend** | Authoritative APIs and business rules; patient identity and ownership enforcement; discovery API behaviour; published-slot reads; booking lifecycle; confirmation enforcement (KD-2); idempotency; concurrency; rate limiting; audit events; the tool contracts' server side (argument schemas, projections, error codes); Backend tests | Model choice, prompts, conversation behaviour, tool selection, AI evaluation |
| **AI** | Provider and model selection and configuration; system instructions; conversation behaviour; tool selection and orchestration; asking for and presenting confirmation in the conversation; ambiguity handling; health-information safety and red-flag triage (`PATIENT_MOBILE_API_CONTRACT.md` §8); AI evaluation sets and metrics; AI integration and regression tests | Whether an action is authorized or succeeded; data access |
| **Database** | Schema, migrations, constraints and indexes the tasks below depend on (K.5) | API behaviour |
| **Patient App** | Discovery, comparison, slot and confirmation screens; calling the confirm route from a patient action (KD-2); rendering Backend errors | Business rules |
| **Frontend** (web) | Doctor slot publishing (WEB-7) and Hospital Admin booking-policy screens (WEB-14), which produce the inventory and policy the assistant reads | — |
| **Shared** | Each shared row below names one **coordinating owner** and states each team's acceptance separately | — |

### K.3 Decision register (cross-team)

All owner decisions DR-01…DR-13, OD-01…OD-14 and OQ-01 are FINAL and are not reopened here. The items
below are technical choices (engineering owner decides), delegated specifications, or gaps no document
closes. A *Proposed* ADR (ADR-033) is not treated as final. Each item blocks the tasks it lists until it is
closed by the record named in "Closed by". Work that does not depend on an open item continues.
KD-9…KD-11 were added on 2026-10-10 with the AI plan (`AI_CHECKLIST.md` §6). **KD-12** was registered on
2026-10-10 from the unified AI plan (its amendment CA-8). It is **open and proposed**; registering it decides nothing.
The *Recommended default* cells of KD-6, KD-10 and KD-11 also record the unified AI plan's recommendations
(its amendment CA-9). Those are **unapproved** recommendations; the decisions stay with the owner.

| ID | Question to resolve | Decision owner | Affected tasks (Backend · Database · AI) | Affected client tasks (Patient App / Frontend) | If left unresolved | Closed by | Recommended default (not a decision) |
|---|---|---|---|---|---|---|---|
| **KD-1** | Where does the assistant's tool loop run, and with what credential does it call the Backend? (a) inside the Backend, executing tools with the request's own patient principal; (b) a separate AI service calling Backend HTTP routes. Under (b), which credential? None exists today (BL-13) | Backend lead + AI engineer (technical). **Owner** approval if a new credential type is proposed: that is a security-model change | AST-A5, AST-D7, AST-E1, AST-E2, AST-F7, AST-F8, AST-G5, AST-I2, AST-I3 · — · AG-1.1, AG-1.2, AG-6.1, AG-5.1, AG-9.3, AG-1.8 | patient-app K-02 (chat transport) | No assistant route can be built; the AI engineer works against a fake Backend only | An ADR (or an ADR-042 note) approved by both leads; plus the owner's approval if a new credential type is introduced | (a). It keeps provider keys behind `AI_GATEWAY` (M16.1) and needs no new credential. Under (b), forwarding the patient's own access token is **not enough**: the Backend could not tell the AI service from the app, so the confirm route (KD-2) could not refuse it. (b) therefore needs a distinguishable, assistant-scoped credential, which is a new credential type and needs the owner's approval. Never a platform-wide credential |
| **KD-2** | How does the Backend tell a patient-confirmed write from a model-initiated one? Two options are on record: (i) the appointment intent of §10.2, which needs DATABASE I2; (ii) patient-app K-06's "pre-fill the real booking flow", where the assistant hands parameters to the app's own booking screens and the app calls the §6 routes directly, so no intent storage is needed | Backend lead (contract), with the AI engineer and the Patient App lead | AST-D7, AST-E6, AST-F8, AST-H7, AST-I6 · DATABASE I2 · AG-4.3, AG-4.4, AG-4.7, AG-4.6, AG-6.3 | CLIENTS PA-7; patient-app K-06, I-05 | No assistant-initiated write of any kind may ship; the assistant stays read-only | `API_CONTRACT_CHANGES.md` §10.2 marked accepted (AST-A5), with the Patient App lead's sign-off | The appointment intent of §10.2: the model prepares; only a patient action in the app confirms, through a route outside the tool registry |
| **KD-3** | OD-08 makes cancellation, rescheduling and lead time "implementation policy". ADR-033 is still *Proposed* and asks a product/clinical owner to choose them (Q1 cancel, Q2 reschedule, Q3 the `awaiting-patient` response). Does OD-08 close ADR-033? Who signs off the values? Are they per hospital (DATABASE E4, CLIENTS WEB-14)? | **Owner** (Fares Al-Almashharawi) | AST-D3, AST-D4, AST-D5, AST-D6, AST-G8, AST-H10 · DATABASE E4 · AG-3.7, AG-4.7, AG-4.6 | patient-app I-07, I-08, I-09, I-10; CLIENTS WEB-14 | Patient cancel, reschedule and proposal response stay absent in the app and the assistant; the assistant tells the patient to contact the hospital | ADR-033 accepted or superseded by the owner, with signed policy values | Per-hospital policy with platform defaults, values signed off by the owner's delegate |
| **KD-4** | A newly registered patient has no `patients` row (ADR-030 §4), but booking needs a global identity (OD-09). When is it created for a patient with no pre-existing hospital record? Which fields are required to book? How does a later claim (OQ-02) avoid a duplicate identity? | **Owner**, on a Backend + Database proposal. Touches RA-030.1 | AST-D1, AST-D11, AST-H6 · DATABASE B1, I4 · AG-4.4 | patient-app I-03, I-05; CLIENTS PA-11 | An unlinked account cannot book through any channel (`patient_identity_required`) | An owner decision recorded as an ADR amending ADR-030 §4 (or a RA-030.1 resolution) | A non-clinical identity created at first booking from verified account data; claiming kept separate |
| **KD-5** | Is a patient booking auto-confirmed or pending doctor approval? | Backend (Phase 24 specification) under the OD-08 delegation. If KD-3 rules that ADR-033 still needs a product owner, the same sign-off applies here | AST-D1, AST-H6 · DATABASE E4 · AG-4.4, AG-4.5 | patient-app I-05 | The booking response's meaning is unfixed; the assistant can only relay the raw status | Phase 24 specification merged | Per-hospital setting; the response always carries the status, reported verbatim |
| **KD-6** | Where do patient-assistant conversations live, who may read them, how long are they kept? `ai_conversations` is clinician-shaped and `ai_messages` verbatim (AF-39). Patient-app K-07 names `ai_conversations` | AI engineer + Database; retention approved by the **owner** (ADR-007 policy) | AST-E2, AST-F6, AST-G7 · DATABASE I3 · AG-7.7, AG-5.4, AG-5.7, AG-7.3, AG-6.4, AG-8.4 | patient-app K-07 | No conversation history; patient-app K-07 cannot be built; only a stateless assistant, if the owner accepts one | A recorded decision with the owner's retention approval; patient-app K-07 updated by its team to match | A patient-owned store separate from clinician threads, readable only by that patient, with bounded retention **Unapproved recommendation from the unified AI plan (CA-9):** patient-deletable conversations; retention bounded by ADR-007's `messageDays` precedent (180 days), offered as a precedent only, **not adopted**; no hospital-staff or doctor access. The retention period is the owner's decision |
| **KD-7** | Rate-limit values, keys and store for discovery, slots, booking and assistant routes | Backend + Security (TECHNICAL RECOMMENDATION, AF-20) | AST-G1, AST-G8, AST-H14 · — (a shared cache, not PostgreSQL) · AG-6.2, AG-9.5 | — | ADR-030 says rate limiting must land before any patient route ships, so these routes cannot ship | Values recorded in the Phase 24 / M37 specification | Per user and per IP; a shared store (M31.1); 429 `rate_limited` with `Retry-After` |
| **KD-8** | Which zone governs a slot: the location's or the hospital's? Both carry `timezone` in `DATA_MODEL_CHANGES.md` §1 | Backend + Database (Phase 24 specification) | AST-C2, AST-C3 · DATABASE A1, A3 · AG-3.9, AG-3.11 | CLIENTS PA-6; patient-app I-04 | Slot times cannot be rendered unambiguously across locations | Phase 24 specification merged | The location's zone when the slot has a location, otherwise the hospital's |
| **KD-9** | Who is the named clinical owner who approves the red-flag set, health-information limits, refusal set and safety thresholds? | **Owner** names the person | AST-G9 · — · AG-2.1, AG-2.2, AG-2.3, AG-7.3, AG-7.8, AG-7.2, AG-6.6, AG-7.1, AG-9.1, AG-9.2 | patient-app K-03, K-04, W-10 | No patient AI can be released (`PATIENT_MOBILE_API_CONTRACT.md` §8; patient-app W-10) | A named person recorded in the sign-off register | None: the owner's choice |
| **KD-10** | Provider and model commitment: spending and the data-processing agreement | AI engineer selects under OD-11's delegation (evaluation AG-1.3, AG-1.4; the approval itself is AG-1.5, which is the owner's). `OWNER_DECISIONS.md` delegates provider selection **and its DPA** to implementation; the 2026-10-10 brief asks for owner approval before any paid commitment. The **owner** confirms which applies | AST-G5, AST-I3 · — · AG-1.3, AG-1.4, AG-1.5, AG-2.8, AG-9.3, AG-1.8 | — | No real provider; development continues against the fake gateway | A provider decision record with the owner's approval | Decided on the AG-1.3, AG-1.4, AG-1.5 criteria, not in advance **Unapproved recommendation from the unified AI plan (CA-9):** the owner approves the provider itself, as well as spending and the DPA, on the measured criteria C1–C7 of `AI_ARCHITECTURE.md` §4.3. **No provider is approved** |
| **KD-11** | Is the v1 patient assistant limited to navigation and appointments, or does it also answer general health questions? Patient-app K-01 lists `symptom` and `medication-info` modes | **Owner** (product scope), with the clinical owner (KD-9) | AST-G9 · — · AG-0.6, AG-2.1, AG-2.2, AG-2.3, AG-2.5, AG-2.6, AG-7.3, AG-7.8, AG-7.1 | patient-app K-01, K-05 | The knowledge strategy (AG-2.3, AG-2.5, AG-2.6) cannot start; the assistant is restricted to navigation and appointments | Owner approval of the first-release capability and non-goal list (`AI_ARCHITECTURE.md` §2.1; tracked in `AI_CHECKLIST.md` AG-0.6, formerly AIA-A1) | v1: navigation and appointments only; general health information as a later, separately gated capability **Unapproved recommendation from the unified AI plan (CA-9):** first release P-AI-3, P-AI-4 and the P-AI-8 emergency routing; P-AI-1 and P-AI-7 developed in parallel (OD-11) but released only after KD-9 and an approved corpus (AG-2.3) and the owner's approval. **Scope is not decided** |
| **KD-12** | Should the patient-agent release gate **G-P** (`AI_EVALUATION_AND_TESTING.md` §6) become a canonical gate beside G-1…G-8 (`SECURITY_AND_DATA_ISOLATION.md` §10)? Registered 2026-10-10 from the unified AI plan (CA-8, formerly AIQ-07). **Open and proposed; G-P is not approved** | **Owner**. Gate changes are canonical | AST-G9, AST-I9 · — · AG-9.1, AG-9.2, AG-8.3 | patient-app K-02…K-08 (AD-4 gate); CLIENTS PA-9 | The patient agent has no agreed canonical release gate; AST-G9's carried-over gates and AG-8.3's proposed thresholds remain the only release criteria, and both are themselves unapproved | An owner decision recorded in `OWNER_DECISIONS.md` or ADR-042, and, if adopted, a G-P row in `SECURITY_AND_DATA_ISOLATION.md` §10 | None recorded here. The G-P definition in `AI_EVALUATION_AND_TESTING.md` §6 is a proposal by the AI team |

### K.4 Task format

Every task: ID, title and outcome; owner; status; dependencies and blockers; acceptance criteria;
verification evidence; references. Status values: **Not Started**; **Not Started · Blocked** (with what
it waits on); **Partially implemented** (a base exists, criteria unmet); **Verified existing**. A task is
ticked only when its verification evidence exists in the repository and has been run. Documentation is
never that evidence.

### K.5 Cross-team dependency register

One owning task per piece of work: the Backend column owns API behaviour, the Database column owns
persistence (`DATABASE_CHECKLIST.md`), the AI column owns model-side work (`AI_CHECKLIST.md` §6), and the
client column owns UI (`CLIENTS_CHECKLIST.md`, `patient-app/PATIENT_FRONTEND_CHECKLIST.md`). Other columns
reference, never duplicate. An AI task is not integration-ready while a task to its left in the same row
is not Done (AI rule U6, `AI_CHECKLIST.md` §6).

| Flow step | Backend (owns API) | Database (owns persistence) | AI (owns model side) | Clients (own UI) | Open blockers |
|---|---|---|---|---|---|
| Hospital context and authentication | §A, §B (Phase 22); AST-F1, AST-F2, AST-F3, AST-F7 | A1–A5, C1, C2 | AG-1.1, AG-1.2, AG-5.1 | — | Phases 21–22; KD-1 |
| Hospital discovery and comparison | AST-B1, AST-B2, AST-B6, AST-B8, AST-B9, AST-B10 | A1–A3, B1, C7, E5, I5, I8 | AG-3.8, AG-3.11 | CLIENTS PA-2, PA-4, PA-5 | — |
| Doctor discovery | AST-B3, AST-B4, AST-B5 | A4, A5, C4 | AG-3.5, AG-3.10, AG-3.6 | CLIENTS PA-3 | — |
| Ratings and reviews | AST-B7 | I6 | AG-3.11 | CLIENTS PA-4 | Moderation specification (OD-10) |
| Published slots | AST-C1…AST-C6 | E1, A3, I5 | AG-3.9, AG-3.11 | CLIENTS WEB-7, PA-6 | KD-8 |
| Prepare and confirm | AST-D7, AST-E6 | I2 | AG-4.3, AG-4.4, AG-6.3 | CLIENTS PA-7; patient-app K-06 | KD-1, KD-2 |
| Book | AST-D1, AST-D8, AST-D9, AST-D11, AST-D12, AST-C5 | E1–E3, B1, B2, B5, I1, I4 | AG-4.4, AG-4.5 | CLIENTS PA-7 | KD-4, KD-5 |
| Read own appointments | AST-D2, AST-D3 | E2 | AG-3.7 | patient-app I-06 | KD-3 (for `availableActions`) |
| Cancel, reschedule, respond to a proposal | AST-D4, AST-D5, AST-D6 | E3, E4 | AG-4.7, AG-4.6 | patient-app I-08, I-09, I-10 | KD-3 |
| Assistant route and conversations | AST-E1…AST-E5, AST-E8, AST-F6 | I3 | AG-1.2, AG-3.2, AG-3.3, AG-6.1, AG-6.4, AG-6.8 | patient-app K-02, K-07 | KD-1, KD-6 |
| Safety | AST-G2, AST-G3, AST-G4, AST-G9 | — | AG-7.3, AG-7.8, AG-7.2, AG-6.6, AG-7.1, AG-2.2, AG-3.2, AG-7.4, AG-8.4, AG-5.4, AG-5.7 | patient-app K-03, K-04, W-10 | KD-9, KD-11 |
| Abuse and rate limits | AST-G1, AST-G8 | — (shared cache, M31.1) | AG-6.2, AG-9.5 | — | KD-7 |
| Audit | AST-D10, AST-E7 | C6 | AG-9.5 | — | — |
| Provider and secrets | AST-G5, AST-G6, AST-I3, AST-E9 | — | AG-1.3, AG-1.4, AG-1.5, AG-2.8, AG-9.3, AG-1.8 | — | KD-10 |
| Tests and fixtures | AST-H1…AST-H16, AST-I8 | G9, I7 | AG-8.2, AG-6.5, AG-8.1, AG-7.3, AG-4.8, AG-8.4, AG-7.4, AG-7.2, AG-8.5, AG-9.2 | — | — |
| Handoff and release | AST-I1…AST-I10 | — | AG-9.2, AG-9.1 | — | Everything above |

### Phase A — Architecture and contract alignment

| ID | Task and outcome | Owner | Status | Depends on / blocked by | Acceptance criteria | Verification | Refs |
|---|---|---|---|---|---|---|---|
| AST-A1 | **Adopt the governing decisions.** Backend lead and AI engineer accept K.0 as the rules for the assistant | Shared — coordinating: Backend lead. Backend: K.0 applies to every Backend route. AI: K.0 applies to every tool and prompt | Not Started | — | Both leads approve this section in review; any disagreement with a FINAL decision is raised to the owner, not edited here | Approved pull request | OWNER_DECISIONS DR-08…DR-13, OD-08…OD-10, OD-14 |
| AST-A2 | **Source-of-truth map.** For hospital, clinic, location, doctor, employment, specialty, department, patient identity, Medical Record, published slot, appointment, insurance coverage and rating: name the owning table and Backend module | Backend | Not Started · Blocked (Database A1–A5, B1–B2, E1–E2) | Phase 21 schema | Every entity names one table and one module; nothing the AI side holds is authoritative; K.1 is replaced by the post-Phase-21 state | Map reviewed against the merged schema | DATA_MODEL_CHANGES §1–§2 |
| AST-A3 | **Database dependency register.** K.5 is acknowledged by Database. The three items it lacked were drafted on 2026-10-10 as DATABASE I1–I3 (plus I4–I7) | Shared — coordinating: Backend. Backend: raises. Database: accepts or rejects each item | Not Started | — | The Database lead accepts or rejects each of DATABASE I1–I7, with a recorded reason for any rejection | Database lead sign-off in review | K.5 |
| AST-A4 | **Responsibility split.** K.2 accepted by Backend and AI | Shared — coordinating: Backend lead | Not Started | — | No task in §K has an AI owner for a Backend responsibility, or the reverse | Review approval by both leads | K.2, AI_CHECKLIST §4 |
| AST-A5 | **Tool contracts approved.** `API_CONTRACT_CHANGES.md` §10 moves from proposal to accepted | Shared — coordinating: Backend. AI: confirms the set covers P-AI-3/P-AI-4 | Not Started · Blocked (KD-1, KD-2) | AST-A1 | Each capability in §10.3 has an endpoint, schemas, errors and owner; open fields resolved | §10 status line changed in an approved PR | API_CONTRACT_CHANGES §10 |
| AST-A6 | **Resolve KD-1…KD-12** | Per K.3 | Not Started · Blocked (decision owners) | — | Each KD has a recorded answer (ADR, ADR-042 note or phase specification) and K.3 links it | Linked record exists | K.3 |

### Phase B — Hospital and doctor discovery APIs (Phase 23; G1–G5)

All routes: `@Authenticated()` patient audience; signed out → 401 (DR-09); `Paginated<T>` envelope; `pageSize`
≤100; whitelisted `sort`; zod validation → 422 `validation_failed` with field paths; unknown and invisible
resources → the same 404. A `hospitalId` parameter is a filter only.

| ID | Task and outcome | Owner | Status | Depends on / blocked by | Acceptance criteria | Verification | Refs |
|---|---|---|---|---|---|---|---|
| AST-B1 | **Hospital list and search** — `GET /patient/hospitals` (`q`, `specialtyId`, `near`, `sort`, `page`, `pageSize`) | Backend | Not Started · Blocked (Database A1–A3, C7, I5) | Phase 22 | Active hospitals only; fields per §10.3 `search_hospitals`; allow-list projection (no internal contact, staff or operational data) | e2e: 401 signed out; envelope; caps; whitelist; suspended hospital absent; projection allow-list | API_CONTRACT §5; G1 |
| AST-B2 | **Hospital details** — `GET /patient/hospitals/:hospitalId`: clinics, locations (address, coordinates), departments, specialties, accepted insurance | Backend | Not Started · Blocked (Database A1–A3; E5 for insurance) | AST-B1 | Unknown, suspended and malformed ids answer the same 404; insurance list empty rather than invented when E5 is absent | e2e per criterion | API_CONTRACT §5; OD-06 |
| AST-B3 | **Doctor search with hospital dimension** — extend the existing `GET /patient/doctors` with `hospitalId`, `clinicId`, `locationId` filters and one active hospital per doctor | Backend | **Partially implemented** (BL-3) · Blocked (Database A4–A5) | Phase 22 | Doctors without an active employment are absent (DR-02); filters never widen what a patient may see; existing forbidden-field tests stay green | Extended `test/patient-api.e2e-spec.ts` | API_CONTRACT §5; G1 |
| AST-B4 | **Doctor details** — extend `GET /patient/doctors/:doctorId` with employment hospital, clinic, location | Backend | **Partially implemented** (BL-3) · Blocked (Database A4) | AST-B3 | `FORBIDDEN_DOCTOR_FIELDS` extended to any new internal column; a doctor whose employment ended answers 404 | e2e, including a forbidden-value-under-renamed-key case for the new fields | `patient-doctor.dto.ts` |
| AST-B5 | **Specialty and department filters** — keep `GET /patient/specialties`; add per-hospital departments | Backend | **Partially implemented** (specialties exist) · Blocked (Database C4) | AST-B2 | Two hospitals can both have "Cardiology"; filtering by one hospital's department returns only that hospital | e2e on a two-hospital seed | AF-04 |
| AST-B6 | **Distance** — `near=lat,lng` per request; `distanceKm` only when the location has coordinates; `sort=distance` only with `near` | Backend | Not Started · Blocked (Database A3, I5) | AST-B1 | Coordinates are never stored or logged; `sort=distance` without `near` → 422; no coordinates → `distanceKm: null`, never 0 | e2e plus a log-capture assertion that coordinates do not appear | OD-10; G2 |
| AST-B7 | **Ratings and reviews** — aggregate from `satisfaction_surveys`; moderated review text | Backend | Not Started · Blocked (moderation specification, OD-10 delegated; DATABASE I6) | — | `rating: null` until an aggregate exists; review text carries no clinical or identifying content (N-22); `ratingAvg` either written by a defined job or removed from sorting | e2e for N-22 and the null case | AF-40; G3 |
| AST-B8 | **Insurance-aware results** — insured: covered options flagged or prioritized; uninsured: `insurance: null` and nothing filtered | Backend | Not Started · Blocked (Database E5, B1) | AST-B1 | Uninsured patient sees every hospital, doctor and slot (N-20); insured patient sees coverage flags | e2e for both patients | OD-14; G4 |
| AST-B9 | **Comparison search** — `GET /patient/discovery/search` comparison rows | Backend | Not Started · Blocked (AST-B1…B8, AST-C2) | — | Every comparison field is sourced or `null`; `nextAvailableSlot` is a published, unbooked, future slot | e2e on a two-hospital seed | API_CONTRACT §5; DISCOVERY_AND_BOOKING §2 |
| AST-B10 | **Discovery error and paging contract** — one documented behaviour across B1–B9 | Backend | Not Started | — | A page past the end is empty, not an error; malformed ids do not 500; 429 carries `Retry-After` once AST-G1 lands | Shared e2e helper asserting the envelope on every discovery route | `BACKEND_API_CONTRACT.md` §0.2; ADR-012 |

### Phase C — Real appointment availability (Phase 24; H1–H2)

| ID | Task and outcome | Owner | Status | Depends on / blocked by | Acceptance criteria | Verification | Refs |
|---|---|---|---|---|---|---|---|
| AST-C1 | **Doctor publishes and withdraws slots** — `/me/published-slots` at the active hospital | Backend | Not Started · Blocked (Database E1, A4) | Phase 22 | Capacity 1; hospital stamped from the employment; a client `hospitalId` is rejected; withdrawing a booked slot is refused | e2e | API_CONTRACT §6; H1 |
| AST-C2 | **Patient slot read** — `GET /patient/doctors/:doctorId/slots?from&to` | Backend | Not Started · Blocked (AST-C1, KD-8) | — | Only `PUBLISHED`, unbooked, future slots; bounded `from`/`to` window; each slot carries `slotId`, hospital, clinic?, location?, `startsAt`, `durationMin`, `timezone` | e2e: booked, withdrawn, past and other-doctor slots absent | API_CONTRACT §6; H2 |
| AST-C3 | **Time zone and serialization** — `startsAt` as ISO-8601 UTC with `Z`; IANA `timezone` per slot and appointment; no local-time strings | Backend | Not Started · Blocked (KD-8) | AST-C2 | Two locations in different zones render correctly; a DST-boundary slot round-trips | Unit tests and the Phase 24 timezone e2e | BL-6; Phase 24 |
| AST-C4 | **Freshness semantics** — the slot response carries a server `asOf`; the contract states a listed slot is a snapshot, not a reservation | Backend | Not Started | AST-C2 | No shared cache of slot availability beyond one request; no hold or reservation exists unless separately decided | Contract text plus an e2e: a slot booked after listing is refused at write time | K.0 rule 6 |
| AST-C5 | **Write-time revalidation** — inside the booking transaction, `409 slot_taken` with `detail.reason` ∈ `booked\|withdrawn\|past` | Backend | Not Started · Blocked (AST-D1) | — | The code is stable (ADR-012); the body names no other patient | e2e for each reason | DISCOVERY_AND_BOOKING §5 |
| AST-C6 | **Working hours never exposed** — `DoctorAvailability` stays doctor-only internal data | Backend | **Verified existing** (2026-10-16): `test/patient-working-hours-isolation.e2e-spec.ts` sweeps every GET route in the running app as a linked patient; no grid or time-off time or field leaks; mutation-checked | — | No patient route returns availability-derived times | e2e over the patient route table | DR-10; AF-10 |

### Phase D — Appointment lifecycle and booking authorization (Phase 24; H3–H6)

The patient is always the session (`PatientSelfScopeService`). No route takes a `patientId`. Another
patient's appointment, an unknown id and an unlinked account answer the same 404.

| ID | Task and outcome | Owner | Status | Depends on / blocked by | Acceptance criteria | Verification | Refs |
|---|---|---|---|---|---|---|---|
| AST-D1 | **Book** — `POST /me/appointments` `{ slotId, reason, visitTypeId?, notes? }` + `Idempotency-Key` | Backend | Not Started · Blocked (Database E1–E3, B1–B2, I4; KD-4; KD-5; AST-D8) | AST-C2 | One transaction: slot `PUBLISHED`→`BOOKED` by conditional update; hospital, doctor and time from the slot; client `hospitalId`/`doctorId` differing from the slot → rejected (N-8); 201 returns appointment id, status, hospital, doctor, `startsAt`, `timezone` | e2e; G-6 (AST-H9) | API_CONTRACT §6; H3; DR-11 |
| AST-D2 | **List own appointments** — extend `GET /me/appointments` with hospital, clinic, location and per-item `timezone` | Backend | **Partially implemented** (BL-9) · Blocked (Database E2) | Phase 22 | Existing ownership and 404 tests stay green; every item names its hospital | Extended `test/patient-appointments.e2e-spec.ts` | API_CONTRACT §6 |
| AST-D3 | **Own appointment detail** — extend `GET /me/appointments/:appointmentId`; add `availableActions` | Backend | **Partially implemented** (BL-9) · Blocked (KD-3 for `availableActions`) | AST-D2 | `availableActions` is absent until KD-3 is resolved, never an empty array (contract §4 rule) | e2e | PATIENT_MOBILE_API_CONTRACT §4 |
| AST-D4 | **Cancel own appointment** — `POST /me/appointments/:id/cancel` `{ reason }` + `Idempotency-Key` | Backend | Not Started · Blocked (KD-3; Database E1–E3) | AST-D2 | Ownership in the WHERE clause; status machine plus policy window; compare-and-set (lost race → 409); the slot is released per policy; reason required (DB CHECK) | e2e incl. cross-patient 404 and race | ADR-033 Q1; H6 |
| AST-D5 | **Reschedule own appointment** — `POST /me/appointments/:id/reschedule` `{ newSlotId }` + `Idempotency-Key` | Backend | Not Started · Blocked (KD-3) | AST-D1, AST-D4 | Old slot released and new slot booked in one transaction; never across hospitals; never capacity > 1 | e2e incl. race with a competing booking of `newSlotId` | ADR-033 Q2; DISCOVERY_AND_BOOKING §6 |
| AST-D6 | **Respond to a proposal** — `POST /me/appointments/:id/confirm` for `awaiting-patient`. This "confirm" accepts a doctor's proposed slot (ADR-033 Q3). It is **not** the booking confirmation of AST-D7, and no assistant tool or intent action reaches it | Backend | Not Started · Blocked (KD-3; reconciling M11.4 propose-slots with published slots, Phase 29) | AST-D2 | Only the owning patient; only from `awaiting-patient` | e2e | ADR-033 Q3 |
| AST-D7 | **Confirmation enforcement** — appointment intents per KD-2: prepare (model-callable), confirm (patient-app only), discard | Shared — coordinating: Backend. Backend: routes, binding, expiry, refusal of assistant credentials on confirm. AI: never exposes confirm as a tool. Patient App: confirm only on a patient tap | Not Started · Blocked (KD-1, KD-2; DATABASE I2) | AST-D1, AST-D4, AST-D5 | Intent bound to patient, action, target and a parameter hash; single use; short TTL; confirm executes exactly the prepared parameters; expired or used → refused with a stable code | AST-H7 | API_CONTRACT §10.2 |
| AST-D8 | **`Idempotency-Key`** per ADR-014 on D1, D4, D5, D6, the intent prepare and the intent confirm | Backend (Database for storage) | Not Started (BL-16) | DATABASE I1 | Stored per `(key, user, endpoint)` with a request hash; replay returns the stored response; same key with a different body → 422 `idempotency_key_reused`; concurrent same-key → one execution; 24 h TTL | AST-H8 | ADR-014 |
| AST-D9 | **Concurrency and consistency** | Backend (Database for constraints) | Not Started · Blocked (Database E3) | AST-D1 | Exactly one of N concurrent bookings of a slot succeeds; no partial writes; a 409 is never retried automatically | AST-H9; G-6 | DR-11; OD-08 |
| AST-D10 | **Lifecycle audit events** — `appointment.book`, `.cancel`, `.reschedule`, `.confirm` (the AST-D6 proposal response), `appointment_intent.prepare\|confirm\|expire\|discard` (the AST-D7 booking confirmation) | Backend | Not Started | AST-D1…D7 | Metadata only (ids, status, hospital id, channel `app\|assistant`); no reason text, no PHI; decide whether these writes must be transactional rather than best-effort (RA-M28.2) | AST-H15 | BL-17; ADR-024 |
| AST-D11 | **Medical Record on first interaction** with that hospital | Backend | Not Started · Blocked (Database B2, B5, I4; KD-4) | AST-D1 | Exactly one record per patient per hospital, created by the booking transaction, never for other hospitals | e2e | OD-09; H5 |
| AST-D12 | **Insurance validation at booking** | Backend | Not Started · Blocked (Database E5, B1) | AST-D1 | Insured + uncovered → `422 insurance_not_covered`; uninsured → no coverage check (N-21) | e2e for both | OD-14; H4 |

### Phase E — AI integration API and tool contracts (Phase 28)

| ID | Task and outcome | Owner | Status | Depends on / blocked by | Acceptance criteria | Verification | Refs |
|---|---|---|---|---|---|---|---|
| AST-E1 | **Tool execution boundary** per KD-1 | Shared — coordinating: Backend. Backend: executes tools only through Backend services or routes. AI: calls only registered tools | Not Started · Blocked (KD-1) | AST-A5 | Allow-listed registry; an unknown tool is refused; no SQL, repository or credential reaches the model | Containment test extending `ai-containment.spec.ts`; AST-H12 | K.0 rule 2 |
| AST-E2 | **Patient-assistant entry routes** — patient-audience routes outside `/ai/*` (which stays `ai.use`, doctor only) | Shared — coordinating: Backend. Backend: route, auth, ownership, persistence. AI: orchestration behind it | Not Started · Blocked (KD-1, KD-6; DATABASE I3) | AST-E1 | `@Authenticated()` plus ownership; one patient per conversation; a doctor or admin token gets no patient conversation | e2e incl. cross-patient 404 | BL-18; PATIENT_MOBILE_API_CONTRACT §8 |
| AST-E3 | **Tool argument schemas** — one zod schema per tool, exported as JSON Schema for the AI engineer | Backend | Not Started | AST-A5 | Strict (unknown keys refused); bounded strings; id formats checked; **no tool accepts `patientId`** | Unit tests per schema | §10.1 |
| AST-E4 | **Tool result projections** — the same allow-listed projections as the HTTP routes, with a smaller page cap | Backend | Not Started | AST-E3 | No forbidden doctor field, staff identity or other patient's data in any tool result | Forbidden-field tests run against tool results | `patient-doctor.dto.ts` |
| AST-E5 | **Tool error mapping** — stable `code`, HTTP status and `recoverable` flag for every failure | Backend | Not Started | AST-E3 | Every code in §10.4 is reachable by a test; no tool returns an unclassified error | AST-H12, AST-H13 | §10.4; ADR-012 |
| AST-E6 | **Capability coverage** — each of the ten capabilities in §10.3 implemented through its Backend route | Backend (AI consumes) | Not Started · Blocked (per §10.3 row) | Phases B–D | All ten have a passing contract test, or are recorded as deliberately absent with the blocking KD | Contract tests | §10.3 |
| AST-E7 | **Tool-call audit** — one event per tool invocation: tool, outcome code, latency, conversation id, user id, hospital id if any | Shared — coordinating: Backend. Backend: writes the event. AI: supplies the conversation id | Not Started | AST-E1 | No argument values, no free text, no PHI in the event | AST-H15 | BL-17 |
| AST-E8 | **Contract versioning** — tool schemas carry a version; breaking changes follow change control | Backend | Not Started | AST-A5 | A schema change without a version bump fails a snapshot test | Snapshot test | PATIENT_MOBILE_API_CONTRACT §11 |
| AST-E9 | **Gateway tool-use extension** (requirement from the unified AI plan, IC-01): add optional `runAgentStep` and `generateStructured` to the `AI_GATEWAY` port with provider-neutral tool, structured-output, stop-reason and usage types; validate the new AI environment variables at boot. A requirement only; nothing is implemented (BL-18) | Backend (`shared/ai` kernel), authored with AI | Not Started · Blocked (KD-1) | AST-E1 | Doctor `/ai/*` tests stay green unchanged; an adapter contract suite runs any adapter against recorded fixtures (text, tool call, parallel tool calls, refusal, max_tokens, timeout, 429, 5xx); `UnconfiguredAiGateway` still answers 503 when unconfigured; the API key is never logged | Backend suite in CI; adapter contract suite | `AI_INTEGRATION_CONTRACTS.md` IC-01; `AI_ARCHITECTURE.md` §4.1–§4.2; AG-1.6, AG-1.8 |

### Phase F — Multi-hospital security and data isolation

| ID | Task and outcome | Owner | Status | Depends on / blocked by | Acceptance criteria | Verification | Refs |
|---|---|---|---|---|---|---|---|
| AST-F1 | **Patient identity from the session only** | Backend | **Partially implemented** (2026-10-16): no patient route declares a patient parameter and a smuggled `patientId` is never honoured (`test/patient-identity-from-session.e2e-spec.ts`). "Refused as an unknown key" awaits a decision: every schema strips unknown keys by convention (`account.schema.ts`) | — | No patient route or tool takes `patientId`; a supplied one is refused as an unknown key | AST-H3, AST-H12 | ADR-030 §6 |
| AST-F2 | **Hospital context never from model text** — discovery `hospitalId` is a filter; booking takes the hospital from the slot; actions take it from the appointment row | Backend | Not Started · Blocked (Phase 22) | — | A write whose client or tool `hospitalId` differs from the derived one is rejected (N-8) | AST-H4 | DR-08; API_CONTRACT §0 |
| AST-F3 | **No signed-out discovery** — DR-09 applies to every assistant tool | Backend | Not Started | — | Every discovery, slot, booking and assistant route answers 401 signed out (N-19) | AST-H2; `authz-matrix.e2e-spec.ts` | DR-09 |
| AST-F4 | **Patient-visible data only** — discovery projections across hospitals and the patient's own appointments, each labelled with its hospital | Backend | Not Started · Blocked (Phase 22) | — | No staff-only or operational data (working hours, rooms, queue, staff identities) and no other patient's data via any patient route or tool | AST-H4 | SECURITY_AND_DATA_ISOLATION §1 |
| AST-F5 | **Non-disclosing errors** — same 404 for unknown, foreign and unlinked; conflict bodies name no other patient | Backend | Not Started (precedent: `appointments-book.e2e-spec.ts` "names no patient in the overlap conflict") | — | Byte-identical 404 bodies across the three cases on every new route | AST-H3 | ADR-022 |
| AST-F6 | **Conversation and cache isolation** — one patient per conversation; tool results cached within a turn at most; no cross-conversation memory; logs metadata-only | Shared — coordinating: AI. AI: context assembly. Backend: storage scoping and logs | Not Started · Blocked (KD-6; DATABASE I3) | AST-E2 | A second patient's data never enters a conversation; nothing tool-returned is logged as text | AST-H3; log-capture test | DR-12; `ai-transcript.log.ts` |
| AST-F7 | **Default deny** — every new route carries an explicit decorator; an assistant credential (if KD-1 = b) reaches no staff route | Backend | Not Started · Blocked (KD-1) | — | `authz-matrix.e2e-spec.ts` covers the new routes | Spec run | BL-11 |
| AST-F8 | **Session liveness at commit** — the access token is checked by signature only (≤900 s window, BL-11). Decide whether intent confirm and booking also check the session row | Shared — coordinating: Backend. Backend + Security decide | Not Started · Blocked (KD-1, KD-2) | — | Decision recorded; if adopted, a revoked session cannot confirm | e2e | OD-12; G-4 |

### Phase G — AI safety, reliability and abuse protection

| ID | Task and outcome | Owner | Status | Depends on / blocked by | Acceptance criteria | Verification | Refs |
|---|---|---|---|---|---|---|---|
| AST-G1 | **Rate limiting** on discovery, slots, booking, intents and assistant routes | Backend | Not Started · Blocked (KD-7; shared store M31.1) | — | Limits per user and per IP; 429 `rate_limited` with `Retry-After`; holds across instances | AST-H14 | AF-20; G5; ADR-030 |
| AST-G2 | **Request size limits** — explicit JSON body limit; assistant message length cap; tool argument caps | Backend | **Partially implemented** (2026-10-16): explicit 100 kB JSON/URL-encoded limit; 413 `payload_too_large` before any handler (`test/request-limits.e2e-spec.ts`). Message and tool-argument caps wait on the assistant routes | — | An oversized body is refused with a stable code before any handler runs | e2e | M37.1 |
| AST-G3 | **Server-side validation of every tool call** with the same schemas as the HTTP routes | Backend | Not Started | AST-E3 | Malformed arguments → 422 with field paths; never silently coerced or repaired | AST-H12 | §10.1 |
| AST-G4 | **Manipulation resistance** — authorization never depends on conversation content; the tool registry is fixed server-side | Shared — coordinating: Backend. Backend: the tool layer refuses whatever the model says. AI: prompt-injection evaluation | Not Started | AST-E1 | Injected instructions ("ignore the rules", forged ids, another patient's appointment id) produce the same refusals as direct calls | AST-H12 plus the AI evaluation set | K.0 rules 1–4 |
| AST-G5 | **Provider credentials** — `AI_PROVIDER` and `AI_API_KEY` stay server-side; rotation documented | Shared — coordinating: AI. AI: provider account. Backend: secret handling and containment | Not Started · Blocked (KD-1) | — | Keys never reach a client or a log; `ai-containment.spec.ts` still passes | Spec run; secret scan | `config/env.schema.ts`; M16.1 |
| AST-G6 | **Timeouts, retries, outages** — bounded tool-call timeouts; writes retried only with the same `Idempotency-Key`; provider outage → 503 `service_unavailable` | Shared — coordinating: Backend. AI: orchestration retries | Not Started | AST-D8 | A provider outage performs no write; a timeout never leaves a half-booking | AST-H13 | AF-26 |
| AST-G7 | **Privacy in logs and retention** — no coordinates, reasons or free text in logs; retention per KD-6 | Backend | Not Started · Blocked (KD-6) | — | Log-capture tests show metadata only | Log-capture test | ADR-007; MG §11.6 |
| AST-G8 | **Booking abuse controls** — caps on open intents and future bookings per patient, so a looping agent cannot hoard slots | Backend | Not Started · Blocked (KD-3, KD-7 for values) | AST-D7 | Cap exceeded → stable refusal code; values configurable | e2e | DR-11 |
| AST-G9 | **Carry over the patient-AI gates** of `PATIENT_MOBILE_API_CONTRACT.md` §8: a provider decision; red-flag triage to Emergency before any text is generated; a named clinical owner signing off prompts and refusals; a server-side output filter; full audit; PHI-safe logging; rate limiting | Backend: enforcement hooks on the assistant route, audit, PHI-safe logs, rate limits. The AI-owned gates are owned elsewhere and only referenced here: triage AG-7.2, output-filter rules AG-7.3, clinical sign-off AG-7.8, provider decision AG-1.5 | Not Started · Blocked (AI engineer; clinical owner) | AST-E2 | No real provider serves patients until every gate has evidence | Gate checklist with evidence links | PATIENT_MOBILE_API_CONTRACT §8; R5 |

### Phase H — Tests and verification (feeds Phase 30)

Each test below is an automated e2e or unit test in `backend/test` or beside its source. "Passes" means
it ran green in CI on the merged commit; no count is claimed in advance. N-ids refer to
`SECURITY_AND_DATA_ISOLATION.md` §9.

| ID | Test task | Owner | Status | Depends on | Acceptance and verification (success is verified when) |
|---|---|---|---|---|---|
| AST-H1 | Discovery: auth required, paging, filters, distance, insurance (N-20, N-21), reviews free of clinical content (N-22), projection allow-list | Backend | Not Started | Phase B | The spec covers each AST-B criterion and passes in CI |
| AST-H2 | Signed-out access refused on every discovery, slot, booking, intent and assistant route (N-19) | Backend | Not Started | AST-F3 | `authz-matrix.e2e-spec.ts` and a 401 sweep pass |
| AST-H3 | Ownership: another patient's appointment or intent via list, detail, cancel, reschedule, confirm and tools → identical 404 | Backend | Not Started | Phase D | Byte-identical bodies asserted |
| AST-H4 | Hospital isolation on a two-hospital seed: slot at B → appointment at B (N-18); mismatched `hospitalId` rejected (N-8); no staff-only data | Backend | Not Started · Blocked (DATABASE G9, I7) | Phase 22 | N-8 and N-18 pass |
| AST-H5 | Availability and stale slots: booked, withdrawn and past slots absent from reads and refused at write with the right `detail.reason` | Backend | Not Started | AST-C2, AST-C5 | All three reasons asserted |
| AST-H6 | Successful booking end to end, including first-interaction Medical Record and the KD-5 status | Backend | Not Started · Blocked (KD-4, KD-5) | AST-D1, AST-D11 | Response, rows and audit event asserted |
| AST-H7 | Confirmation: commit without a confirmed intent refused; another patient's intent → 404; reuse, expiry and parameter change refused; an assistant credential cannot confirm | Backend | Not Started · Blocked (KD-2) | AST-D7 | Each case asserted with its code |
| AST-H8 | Idempotency: replay returns the original response and writes once; same key, different body → 422; concurrent same key → one execution | Backend | Not Started | AST-D8 | Row counts and bodies asserted |
| AST-H9 | Concurrency: N parallel bookings of one slot → exactly one 201 (N-17, G-6); reschedule vs booking race; cancel vs booking race | Backend | Not Started · Blocked (Database E3) | AST-D9 | One winner, the rest 409, in repeated runs |
| AST-H10 | Cancel and reschedule authorization and policy windows | Backend | Not Started · Blocked (KD-3) | AST-D4, AST-D5 | Inside and outside the window asserted |
| AST-H11 | Invalid identifiers: malformed or unknown hospital, doctor, slot and appointment ids → the contract's 404/422, never 500 | Backend | Not Started | Phases B–D | Each id type asserted |
| AST-H12 | Malformed and unauthorized tool arguments: unknown keys, injected `patientId`/`hospitalId`, oversized strings, unknown tool → refused with no side effect | Backend | Not Started | AST-E3, AST-G3 | No row written in any case |
| AST-H13 | Downstream failure: provider 503 → no write; a DB failure mid-booking rolls back the slot transition | Backend | Not Started | AST-G6 | Slot state and row counts asserted after each failure |
| AST-H14 | Rate limiting: limit reached → 429 with `Retry-After`; one user's limit does not affect another | Backend | Not Started · Blocked (KD-7) | AST-G1 | Asserted against the configured values |
| AST-H15 | Audit correctness: each write and tool call emits exactly one event with the expected metadata and no PHI | Backend | Not Started | AST-D10, AST-E7 | Event rows asserted field by field |
| AST-H16 | Regression: the full backend gate passes; existing doctor-side appointment specs unchanged; the "write routes are absent" case in `patient-appointments.e2e-spec.ts` is replaced deliberately in the PR that adds the routes | Backend | Not Started | All | `npm --prefix backend run typecheck && lint && test && build` green in CI |

### Phase I — Integration readiness and handoff

The Backend does not mark an AI dependency complete until the behaviour is implemented and the matching
AST-H test passes in CI. **Verification for every row below:** the AI engineer reviews the deliverable
against the merged code and the passing AST-H tests it relies on. A written document alone never ticks a
row. References: `API_CONTRACT_CHANGES.md` §10 and K.3.

| ID | Deliverable to the AI engineer | Owner | Status | Depends on | Acceptance criteria |
|---|---|---|---|---|---|
| AST-I1 | Approved tool contracts with exported JSON Schemas | Backend | Not Started | AST-A5, AST-E3 | §10 marked accepted; schemas generated from the code, not hand-written |
| AST-I2 | Authentication and authorization expectations, per the KD-1 outcome | Backend | Not Started · Blocked (KD-1) | — | States the credential, its lifetime, what it can and cannot reach, and the confirm restriction |
| AST-I3 | Environment-variable **names** (no values). Existing: `AI_PROVIDER`, `AI_API_KEY` (`backend/src/config/env.schema.ts`). Any new name comes from KD-1 | Backend | Not Started | KD-1 | Every name listed with purpose and owner; values only in the secret store |
| AST-I4 | Error-code reference (§10.4), frozen per ADR-012 | Backend | Not Started | AST-E5 | Every code has status, meaning and recovery |
| AST-I5 | Sanitized request/response examples per tool, from synthetic seed data only | Backend | Not Started | AST-E6 | No real person's data; examples validate against the schemas |
| AST-I6 | Confirmation and idempotency behaviour | Backend | Not Started · Blocked (KD-2) | AST-D7, AST-D8 | Sequence for prepare → patient confirm → result, including expiry and replay |
| AST-I7 | Hospital-context and ownership rules (K.0 rules 4–5, AST-F1, AST-F2) | Backend | Not Started | Phase 22 | Matches the implemented guards |
| AST-I8 | Mock and test environment: a fake `AI_GATEWAY` (the M16.1 pattern), a two-hospital seed, a fixed clock | Backend (Database for the seed) | Not Started · Blocked (DATABASE G9, I7) | — | The AI engineer can run the integration suite locally without a provider key |
| AST-I9 | Integration-test prerequisites: which AST-H tests must be green before AI integration tests start | Shared — coordinating: Backend | Not Started | — | List agreed by both leads |
| AST-I10 | Blocker register: K.3 and K.5 kept current | Backend | Not Started | — | Every open blocker names an owner and a question |

**Joint handoff checklist** (both columns ticked before the assistant calls a real Backend write):

| Backend confirms | AI confirms |
|---|---|
| [ ] Phases B–D routes the tools need are live and their AST-H tests pass in CI | [ ] The tool set matches §10.3; no tool calls a route outside it |
| [ ] Confirmation (AST-D7) refuses unconfirmed writes and assistant credentials on confirm | [ ] Confirm is never exposed as a tool; the conversation asks the patient and shows the prepared summary |
| [ ] `Idempotency-Key` is honoured on every write the tools reach | [ ] Retries reuse the same key; a 409 is reported, not retried |
| [ ] Errors follow §10.4 | [ ] Every §10.4 code has a defined conversational recovery |
| [ ] Rate limits and size caps are active | [ ] The orchestrator backs off on 429 using `Retry-After` |
| [ ] Audit events are written for tool calls and writes | [ ] The conversation id is passed on every tool call |
| [ ] KD-1…KD-12 resolved or explicitly out of scope for the release | [ ] AST-G9 gates have evidence (triage, output filter, clinical sign-off); AG-9.1, AG-9.2 accepted |

## Quality gate

`npm --prefix backend run typecheck && lint && test && build`. Changes to `backend/src/modules/auth/dto/`
also run the patient-app parity suite (CLAUDE.md).
