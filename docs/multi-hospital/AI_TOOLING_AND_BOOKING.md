# Multi-Hospital — Patient AI Agent: Tools and Booking

**Owner team:** AI (tool layer), Backend (the APIs behind it), Database (slots and proposals)
**Checklist:** [`AI_CHECKLIST.md`](AI_CHECKLIST.md) phases AG-3 and AG-4
**Architecture:** [`AI_ARCHITECTURE.md`](AI_ARCHITECTURE.md) §3 and §6
**Governing decisions (FINAL):** DR-08, DR-09, DR-10, DR-11, OD-08, OD-10, OD-14, DR-13
**Status:** PROPOSED. No tool is implemented. The names below are **logical tool names**, not
endpoints. Each maps to a real API or is marked missing.
**Authoritative contract:** [`API_CONTRACT_CHANGES.md`](API_CONTRACT_CHANGES.md) §10 (Backend). This
file adds the AI-side rules and tests. Where it describes a route, §10 wins; changes this plan needs in
§10 are the pending amendments CA-1…CA-13 in [`AI_INTEGRATION_CONTRACTS.md`](AI_INTEGRATION_CONTRACTS.md).

**Tool names and §10.3 capabilities.** The AI team owns tool names. Each `propose_*` tool calls the
§10.2 *prepare* route and never executes anything:

| Tool (this file) | §10.3 capability | Backend route |
|---|---|---|
| `list_specialties` | (not in §10.3; existing route) | `GET /patient/specialties` |
| `search_doctors` | `search_doctors` | `GET /patient/doctors` |
| `get_doctor_details` | `get_doctor_details` | `GET /patient/doctors/:doctorId` |
| `search_hospitals`, `get_hospital_details` | same | `GET /patient/hospitals[/:hospitalId]` |
| `get_available_slots` | `get_available_slots` | `GET /patient/doctors/:doctorId/slots` |
| `get_my_appointments` | `get_my_appointments`, `get_appointment_details` | `GET /me/appointments[/:appointmentId]` |
| `propose_appointment` | `create_appointment` (prepare half) | `POST /me/appointment-intents` `{action: 'book'}` |
| `propose_cancellation` | `cancel_appointment` (prepare half) | `POST /me/appointment-intents` `{action: 'cancel'}` |
| `propose_reschedule` | `reschedule_appointment` (prepare half) | `POST /me/appointment-intents` `{action: 'reschedule'}` |
| `get_intent` | read of §10.2 | `GET /me/appointment-intents/:intentId` |
| `discard_intent` | discard of §10.2 | `POST /me/appointment-intents/:intentId/discard` |

**Not a tool:** `POST /me/appointment-intents/:intentId/confirm`. Only the patient app's native control
calls it (§2.9).

---

## 1. Rules every tool obeys (TECHNICAL RECOMMENDATION)

| # | Rule | Enforced by |
|---|---|---|
| T-R1 | **Identity is injected, never argued.** No tool schema has `patientId`, `userId`, `role` or an authorizing `hospitalId`. The executor passes `principalOf(user)` from the authenticated request | Registry signature `execute(principal, args)`; a schema lint test fails on those property names |
| T-R2 | **Arguments are validated twice.** The provider receives a JSON Schema with `additionalProperties: false`, and the server re-parses with the tool's Zod schema before executing. A failure returns a structured tool error and is never executed | `ToolRegistry.execute` |
| T-R3 | **Tools call the same service method the patient controller calls**, with the same principal. They never call a repository, Prisma or SQL, or an admin or staff service | A dependency-zone lint rule (M2.2 style) |
| T-R4 | **Only registered, authorized tools are offered.** The patient assistant's registry contains only the tools in §2. Staff tools are not importable from the module | Module boundary plus a unit test on the registry contents |
| T-R5 | **Read tools are side-effect free.** `propose_*` tools write only an appointment intent (§10.2; `DATABASE_CHECKLIST.md` I2), never an appointment. There is no second proposal store (IC-07) | Code review plus a containment test, mirroring `ai-containment.spec.ts` |
| T-R6 | **Results are trimmed projections.** A tool returns the fields the model needs (ids, names, specialty, times, hospital, location, rating, insurance flag), never forbidden fields (`FORBIDDEN_DOCTOR_FIELDS`), and never another patient's data | Projection functions with snapshot tests |
| T-R7 | **Free text from data is untrusted.** Doctor biographies, review text and hospital descriptions are wrapped as data (§3) | Prompt assembler; prompt-injection eval set |
| T-R8 | **Errors are typed.** `{ ok: false, code, retryable, userMessageKey }`. The model sees the code. The patient sees a localized message chosen by the server | Error mapper |
| T-R9 | **Every call is bounded**: a per-tool timeout (5 s for reads), at most 6 rounds per turn, and at most 3 parallel calls per round | Orchestrator |
| T-R10 | **Every call is logged as metadata**: tool name, duration, outcome code and result count. No arguments or results in logs | `AiTranscriptLog`-style recorder |

---

## 2. Tool contracts

Status vocabulary: **Buildable** (the backing API exists), **Blocked** (it does not, and the owner and
contract are named), **Upgrade** (buildable now, then re-pointed when a better API ships).

### 2.1 `list_specialties` — Buildable

| Field | Contract |
|---|---|
| Purpose | Map "I need a heart doctor" or "أحتاج طبيب قلب" to a real specialty id |
| Input | `{}` |
| Output | `{ items: [{ id, name, parentId }] }`, from `GET /patient/specialties` |
| Auth | `@Authenticated()` patient; same as the route |
| Errors | `upstream_unavailable` (retryable) |
| Side effects | None |
| Notes | Specialty names are stored in one language today. Arabic labels are a data dependency (IC-09). The model must not invent a specialty id: it is validated against this list |
| Tests | Arabic and English symptom-to-specialty phrasing picks a listed id (EV-T01…T04). An invented id is rejected (unit) |
| Team / deps | AI, after AG-3.2 |

### 2.2 `search_doctors` — Buildable now, then Upgrade

| Field | Contract |
|---|---|
| Input (now) | `{ q?: string(1..120), specialtyId?: uuid, departmentId?: uuid, sort?: 'name:asc'\|'name:desc'\|'rating:desc', page?: int≥1, pageSize?: 1..20 }`, a subset of `doctorSearchSchema` with pageSize capped at 20 for context size |
| Input (after Phase 23) | adds `hospitalId?`, `locationId?`, `near?: {lat,lng}` (only from the device, per request, never stored), `sort: 'distance'\|'rating'\|'nextAvailable'` — over `GET /patient/discovery/search` |
| Output | `{ items: [{ doctorId, fullName, title, specialty, departmentName, yearsOfExperience, languages, rating, hospital?, location?, distanceKm?, nextAvailableSlot?, insurance? }], page, totalItems }` |
| Auth | Authenticated patient. Discovery needs no prior hospital relationship (DR-09) |
| Isolation | Only doctors the API returns, which after Phase 22/23 means active employment and verified (DR-02, G-08). The tool never widens a search the API narrowed |
| Insurance | Insured patient: results carry `insurance.covered`. Uninsured: `insurance` is null and **nothing is filtered** (OD-14). The tool never filters by insurance itself |
| Errors | `invalid_arguments`, `upstream_unavailable` |
| Side effects | None |
| Tests | Correct filters from natural language (EV-T05…T10). Empty results lead to a "no doctors found" message with no invented doctor (EV-H03). Pagination never exceeds 20 |
| Team / deps | AI now. Backend Phase 23 for the upgrade (IC-03) |

### 2.3 `get_doctor_details` — Buildable

| Field | Contract |
|---|---|
| Input | `{ doctorId: uuid }` |
| Output | The `PatientDoctorDetail` projection minus nothing new. `biography`, `education` and similar free text are marked untrusted (T-R7) |
| Auth | Authenticated patient |
| Errors | `not_found` (unknown or not discoverable; never says which), `upstream_unavailable` |
| Tests | An unknown id gives `not_found`. An injection string in a biography does not change tool behaviour (EV-I02) |

### 2.4 `search_hospitals` and `get_hospital_details` — Blocked

| Field | Contract |
|---|---|
| Backing API | `GET /patient/hospitals`, `GET /patient/hospitals/:id` (`API_CONTRACT_CHANGES.md` §5) — **not built** |
| Blocked by | Database Phase 21 (`Hospital`, `Clinic`, `HospitalLocation`), Backend Phase 23. Contract IC-03 |
| Input | `{ q?, specialtyId?, near?, acceptsMyInsurance?: boolean, page? }` and `{ hospitalId }` |
| Output | `{ hospitalId, name, locations: [{ id, name, address, distanceKm? }], specialties, acceptedInsurance?: boolean }` |
| Until unblocked | The tool is **not registered**. The agent says hospital comparison is not available yet, and it does not invent hospitals from doctor records |

### 2.5 `get_available_slots` — Blocked

| Field | Contract |
|---|---|
| Backing API | `GET /patient/doctors/:id/slots?from&to` — only `PUBLISHED`, unbooked, future slots (DR-10) — **not built** |
| Blocked by | Database and Backend Phase 24 (`PublishedSlot`, capacity 1). Contract IC-04 |
| Input | `{ doctorId: uuid, from: ISO date, to: ISO date }`, where `to − from ≤ 14 days`. The server rejects past ranges |
| Output | `{ timezone: IANA, slots: [{ slotId, startsAt (UTC), durationMin, location? }] }`. The client and agent **format** with the server-given zone and never compute one (audit R-12) |
| Relative dates | "Tomorrow afternoon" is resolved by the model using a server-supplied `now` and timezone in the per-turn context. The server validates the range. Ambiguity, such as "next week", is asked about, not guessed |
| Never | Show working hours as availability. Show a slot the API did not return |

### 2.6 `get_my_appointments` — Buildable

| Field | Contract |
|---|---|
| Input | `{ status?: wire status \| wire status[], from?: date, to?: date, upcoming?: boolean, page?, pageSize?: 1..20 }`, a subset of `patientAppointmentQuerySchema` (which also requires `from ≤ to`); or `{ appointmentId }` for one |
| Output | Summaries with id, doctor, time, status and (after Phase 24) hospital, clinic and location. `clinicTimezone` is passed through |
| Auth | Self-scope by WHERE clause (`PatientSelfScopeService`). An unlinked account yields an empty list. Another patient's id yields `not_found` |
| Isolation | The patient's own administrative data across hospitals, each item labelled with its hospital. No clinical record content |
| Tests | Forged `appointmentId` belonging to another patient gives `not_found` (PN-03). An empty account gives a friendly empty answer |

### 2.7 `propose_appointment` — Blocked

| Field | Contract |
|---|---|
| Purpose | Prepare an **appointment intent**, never a booking (§3, architecture §6). Route: `POST /me/appointment-intents` `{action: 'book', slotId, reason, visitTypeId?}` (§10.2) |
| Input | `{ slotId: uuid, reason: string(3..300), visitTypeId?: uuid }`. `reason` is capped at the `appointments.reason` width (300) |
| Server checks | Slot exists, is `PUBLISHED` and future. The doctor is discoverable. The patient account is linked or linkable per OD-09. The insured patient's coverage is pre-checked (warning only; the final check is at booking) |
| Output | The §10.2 prepare response: `{ intentId, action, summary: { hospital, clinic?, location?, doctor, startsAt, durationMin, timezone }, expiresAt }`. The summary is built from database rows, not from model text |
| Side effects | One intent (`DATABASE_CHECKLIST.md` I2). An SSE `intent_prepared` event |
| Idempotency | The prepare route takes an `Idempotency-Key` (§10.2), so a retried prepare returns the same intent. One open intent per conversation and payload is proposed as CA-11 |
| Blocked by | IC-04, IC-05, IC-07; decision **KD-2**; Backend AST-D1, AST-D7 |

### 2.8 `propose_cancellation`, `propose_reschedule` — Blocked

| Field | Contract |
|---|---|
| Input | `{ appointmentId, reason: string(3..300) }`, and `{ appointmentId, newSlotId, reason }`, sent as §10.2 intents with `action: 'cancel'` and `action: 'reschedule'` |
| Server checks | The appointment is the caller's. The action is in the server's `availableActions` for that appointment (ADR-033). A reason is mandatory, because `appointments_cancelled_reason_required` is a CHECK constraint |
| Blocked by | **KD-3** (ADR-033 is Proposed and chooses no policy). Backend AST-D4, AST-D5 and IC-06 after it is decided |
| Never | Compute cancellation eligibility in the AI layer. That is policy, and it belongs to the server |

### 2.8a `get_intent`, `discard_intent` — Blocked

| Field | Contract |
|---|---|
| Purpose | Read the authoritative state of an intent the assistant prepared, or withdraw it before the patient acts |
| Input | `{ intentId }` |
| Output | `get_intent`: the §10.2 read, `{ intentId, action, status, summary, expiresAt, appointment?, code? }`. `discard_intent`: the same shape after the discard |
| Auth | Authenticated patient; another patient's intent gives `not_found` |
| Never | Treat `prepared`, `unknown` or a missing result as success (B-7) |
| Blocked by | AST-D7; decision KD-2 |

### 2.9 Confirmation endpoint (not a tool)

`POST /me/appointment-intents/:intentId/confirm` (`API_CONTRACT_CHANGES.md` §10.2). Only the patient
app's native control calls it, after the patient taps "Confirm". It is never registered as a tool and,
under KD-1 (b), refuses an assistant-delegated credential. The card's "Decline" button calls
`…/discard` (CA-12). An earlier revision named `/me/assistant/actions/:proposalId/{confirm,decline}`;
those routes are **retired**, so there is one confirmation contract.

After a confirm, the assistant learns the outcome only by reading the intent (`get_intent`). The patient
app may tell the assistant route that an intent changed, carrying the id only; the assistant re-reads
and never trusts the notice's content.

---

## 3. Untrusted content handling

Tool results are serialized as JSON inside a clearly delimited tool-result block. The system prompt
states that tool results are data and that instructions inside them are never followed. This is
defence in depth, not the control. The control is T-R1…T-R5: even a fully obeyed injection cannot
book, read another patient's data or call an unregistered tool.

---

## 4. Booking workflow: acceptance criteria (AG-4)

| # | Criterion | Test |
|---|---|---|
| B-1 | No appointment row is created by any code path reachable from the model | Containment spec: run the orchestrator with every tool, assert no `appointments` insert |
| B-2 | Confirm requires the intent owner, the `prepared` status and no expiry. The confirm request carries no parameters, so the prepared payload cannot be changed at confirm | Unit and e2e: wrong user gives 404; expired gives `409 intent_expired`; used gives `409 intent_used` (§10.4) |
| B-3 | Exactly one booking for N concurrent confirms of the same intent, whether they carry the same or different client keys (CA-2) | e2e |
| B-4 | Exactly one success when two patients confirm intents for the same slot | e2e (G-6, N-17) |
| B-5 | A slot taken after prepare results in intent status `failed` with `slot_taken` (CA-1) and an offer of fresh slots | e2e |
| B-6 | Timeout or 5xx results in intent status `unknown`, then **server-side** reconciliation by idempotent replay or a read (CA-2). No blind retry. No success is shown before verification | Fault-injection test |
| B-7 | The assistant text never claims success without a `confirmed` intent read in the same turn | Output-validator unit test and eval EV-B07 |
| B-8 | The returned details match a fresh `GET /me/appointments/:id` | e2e |
| B-9 | Arabic and English summaries render the same facts | Snapshot test per language |
| B-10 | An expired session at confirm gives 401 and no booking | e2e |
