# Multi-Hospital — Patient AI Agent: Integration Contracts

**Purpose:** the exact contracts the patient agent needs from other teams. Each one names its owner,
its acceptance criteria and what it blocks. The AI team **does not implement another team's schema or
backend code** without that owner's explicit authorization. Until a contract is delivered, the
dependent feature stays blocked: it is not faked.
**Checklist:** [`AI_CHECKLIST.md`](AI_CHECKLIST.md)
**Status:** all contracts PROPOSED. None is agreed by its owner yet.

> **Unified plan (2026-10-10).** These contracts are the AI team's *requests*. The authoritative
> contracts are owned elsewhere and are not restated here:
> - **Booking, confirmation and the patient tools' routes:** [`API_CONTRACT_CHANGES.md`](API_CONTRACT_CHANGES.md)
>   §10 (Backend). There is **one** confirmation contract, the appointment intent of §10.2.
> - **Backend tasks:** [`BACKEND_CHECKLIST.md`](BACKEND_CHECKLIST.md) §K (AST-\*). **Database tasks:**
>   [`DATABASE_CHECKLIST.md`](DATABASE_CHECKLIST.md) §I. **Decisions:** `BACKEND_CHECKLIST.md` K.3 (KD-\*).
>
> Each IC row names the task that owns its delivery. Where the unified design needs a change in a
> Backend- or Database-owned document, the change is listed in **§CA** below as a pending amendment.
> A pending amendment is a proposal for that owner, not part of the contract until the owner merges it.

| ID | Contract | Owner | Blocks | Upstream plan | Owning task (authoritative) |
|---|---|---|---|---|---|
| IC-01 | Gateway port: tools, structured output, stop reasons, usage | Backend (`shared/ai` kernel), authored with AI | Every model-backed feature | Phase 28, F10 | AST-E1; AST-E9 (the port extension, added by CA-13) |
| IC-02 | `/me/assistant/*` route family and SSE event contract | Backend + AI | All runtime | patient-app BE-14 | AST-E2 (routes), AST-E8 (versioning); confirmation is §10.2, not IC-02 |
| IC-03 | Hospital discovery: `/patient/hospitals[/:id]`, `/patient/discovery/search` | Database (21) + Backend (23) | `search_hospitals`, `get_hospital_details`, hospital-aware search | `API_CONTRACT_CHANGES.md` §5 | AST-B1…AST-B10; DATABASE A1–A5 |
| IC-04 | Published slots: `GET /patient/doctors/:id/slots` | Database + Backend (24) | `get_available_slots`, all booking | §6 there; DR-10 | AST-C2…AST-C5; DATABASE E1 |
| IC-05 | Booking: `POST /me/appointments` with `Idempotency-Key` | Backend + Database (24) | the confirm of a `propose_appointment` intent | §6 there; DR-11, G-6 | AST-D1, AST-D8, AST-D9; DATABASE E1–E3, I1 |
| IC-06 | Cancel and reschedule with `availableActions` | Owner (ADR-033 policy), then Backend | `propose_cancellation`, `propose_reschedule` | ADR-033 (Proposed) | AST-D4, AST-D5 (blocked on KD-3) |
| IC-07 | Storage: appointment intents; patient conversations | Database + Backend | AG-4.*, AG-6.4 | — | DATABASE I2 (intents), I3 (conversations) |
| IC-08 | Patient app adapter and confirmation UI | Patient App | All patient UX | K-02…K-08, AD-4 | patient-app K-02…K-07; CLIENTS PA-7 |
| IC-09 | Localized (Arabic and English) names for specialties, departments, hospitals and locations | Database + Backend | Arabic answer quality | — | DATABASE I8 (added by CA-13; proposed, pending the Database lead's acceptance) |
| IC-10 | Vector storage (optional, later) | Database | Hybrid retrieval only | AF-27, F7 | none (optional; DATABASE F3 rule applies) |
| IC-11 | Request rate limiting | Backend | AG-7.5 | AF-20 | AST-G1 (KD-7) |
| IC-12 | Audit event kinds for proposals | Backend (audit module) | AG-7.6 | ADR-024 | AST-D10, AST-E7 |

---

## IC-01 — Gateway extension

- **Required:** the optional `runAgentStep` and `generateStructured` methods and the neutral types in
  `AI_ARCHITECTURE.md` §4.1. The existing `generate` and `describe` are unchanged.
- **Also required:** env additions per `AI_ARCHITECTURE.md` §4.2, validated in `config/env.schema.ts`
  (an unknown provider fails boot; the key is never logged).
- **Acceptance:**
  - doctor `/ai/*` tests stay green unchanged;
  - an adapter contract test suite runs any adapter against recorded fixtures, covering text, a tool
    call, parallel tool calls, refusal, max_tokens, timeout, 429 and 5xx;
  - `UnconfiguredAiGateway` keeps answering 503 when unconfigured.
- **Why AI cannot do this alone:** `backend/src/shared/ai/` is backend kernel code. CLAUDE.md requires
  owner authorization for Backend source changes.

## IC-02 — Patient assistant routes and events

| Method | Path | Notes |
|---|---|---|
| GET | `/me/assistant/conversations` | Own conversations, paginated |
| POST | `/me/assistant/conversations` | `{ context: 'navigation'\|'symptom'\|'appointment'\|'medication-info' }`, the patient-app K-01 vocabulary. No patient, user or hospital field |
| GET | `/me/assistant/conversations/:id` | Own only; 404 otherwise |
| DELETE | `/me/assistant/conversations/:id` | Soft delete by the patient (AIQ-05) |
| POST | `/me/assistant/conversations/:id/messages` | `{ content: string(1..2000) }`. SSE response |
| POST | `/me/assistant/messages/:messageId/feedback` | `{ value: -1 \| 1 }` (K-08) |

All routes use `@Authenticated()` plus patient self-scope (AST-E2; decision KD-1). They follow the same
refusal semantics as `/ai/*`: a refusal before streaming is a real HTTP status, never an error event
inside a 200.

**Confirmation is not in this route family.** Earlier revisions put `confirm` and `decline` under
`/me/assistant/actions/:proposalId/…`. Those routes are **retired**. The one confirmation contract is
`API_CONTRACT_CHANGES.md` §10.2:
- prepare: `POST /me/appointment-intents` (called by the `propose_*` tools);
- read: `GET /me/appointment-intents/:intentId` (how the assistant learns the result);
- confirm: `POST /me/appointment-intents/:intentId/confirm`, **called only by the patient app's native
  control**, never registered as a tool, and refusing an assistant-delegated credential under KD-1 (b);
- discard: `POST /me/appointment-intents/:intentId/discard` (the card's "Decline" button, or a tool).

**SSE events** (named events, one JSON payload each):

| Event | Payload | Client behaviour |
|---|---|---|
| `emergency` | `{ categoryKey }` | Show the Emergency route **before** any text |
| `tool_status` | `{ key: 'searching_doctors'\|'checking_slots'\|…}` | Localized progress line; never raw arguments |
| `delta` | `{ text }` | Append (released one validated sentence at a time) |
| `citation` | `{ id, title, publisher, url }` | Render a source chip |
| `intent_prepared` | `{ intentId, action, summary, expiresAt }`, the §10.2 prepare response | Native confirmation card. The card renders the server's summary, never model text |
| `intent_result` | `{ intentId, status, appointment?, code? }`, read from `GET /me/appointment-intents/:intentId` | Update the card; status wording is server-supplied. `unknown` is never shown as success (CA-1, CA-2) |
| `done` | `{ messageId, status: 'complete'\|'stopped'\|'error', error? }` | Finish |

## IC-03 — Hospital discovery

As specified in `API_CONTRACT_CHANGES.md` §5, plus three requirements for the agent:

1. Every row carries stable ids for the hospital, location and doctor, so the agent can refer back to
   them without restating names.
2. `rating` is `{ average, count }` or null. Never a fabricated default.
3. `insurance` is null for uninsured patients, and nothing is filtered (OD-14).

**Acceptance:** G-7 discovery half; N-19…N-22.

## IC-04 — Published slots

`GET /patient/doctors/:id/slots?from&to` returns only `PUBLISHED`, unbooked, future slots, with an
IANA `timezone` and `slotId`. The range is capped (14 days proposed). **Acceptance:** working-hours
times never appear. A booked slot disappears on the next read.

## IC-05 — Booking

`POST /me/appointments { slotId, reason, visitTypeId?, notes? }` with `Idempotency-Key`.

- Errors: `409 slot_taken`, `422 insurance_not_covered` (with `detail`).
- Hospital, doctor and time derive from the slot.
- The response carries the created appointment id.

Required by the agent: the **same key replayed returns the same result** (ADR-014), so the confirm
endpoint can reconcile an `unknown` outcome (CA-2). The confirm route books with a key derived from the
intent id, so a repeated tap carrying a new client key still books at most once (CA-2).

**Acceptance:** G-6, N-17, N-18, and B-3…B-6 in `AI_TOOLING_AND_BOOKING.md` §4.

## IC-06 — Cancel and reschedule

`POST /me/appointments/:id/{cancel,reschedule}` per `availableActions` on each appointment payload.
A reason is mandatory (CHECK `appointments_cancelled_reason_required`).

**Blocked on ADR-033 choosing a policy.** That is an owner and clinical decision, not an engineering
one.

## IC-07 — Storage (Database)

The AI team does not write migrations. **There is one storage model for prepared actions:** the
appointment-intent store, `DATABASE_CHECKLIST.md` **I2** (conditional on KD-2). The separate
`ai_action_proposals` table proposed in an earlier revision is **retired**, so that no second
proposal/intent store exists. Its useful properties are proposed to the Database team as amendment
**CA-11**: a nullable conversation link, a payload hash with one open intent per conversation and
payload, and the `failed` and `unknown` states of CA-1.

**Patient conversations** are `DATABASE_CHECKLIST.md` **I3**, decided under **KD-6**. Two shapes:

- **(a)** Reuse `ai_conversations` / `ai_messages`. This needs an `audience` discriminator (`STAFF` or
  `PATIENT`), a patient context enum, and a `tool` role for tool-result turns.
- **(b)** Separate `patient_assistant_*` tables. These make staff access structurally impossible.

The recommendation is **(b)**, because A-11 then holds by construction (proposed as CA-11). The choice
stays with Database and Backend under KD-6.

## IC-08 — Patient app

The patient app needs:

- an `/me/assistant/*` adapter with an SSE reader and abort support (cancel leads to `stopped`);
- the confirmation card and result states;
- the emergency event, rendered before any text;
- citation chips;
- server-persisted history (K-07), never local storage;
- RTL layout.

The `ai-honesty.test.ts` gate is relaxed only for the connected screens, by the Patient App team,
after AD-4 is satisfied.

## IC-09 — Localized names

Specialty, department, hospital and location names in Arabic and English. If only one language is
stored, the agent displays the stored name verbatim and never machine-translates proper names.

## IC-10 — Vector storage (optional)

`pgvector`, or an alternative, only if the measured retrieval upgrade justifies it
(`AI_DATA_AND_KNOWLEDGE.md` §2.4). Indexes hold the K1 corpus only. They are never patient data and
never cross-hospital data (F7).

## IC-11 — Rate limiting

A request throttler on `/me/assistant/*`: per patient and per IP. It answers `429` with `Retry-After`.

## IC-12 — Audit

Event kinds for intent prepared, confirmed, discarded, expired, failed, unknown and reconciled
(AST-D10 lists the prepare, confirm, expire and discard kinds; the rest are CA-1).
Metadata only, under the `user_action` category, which already fits (ADR-033 evidence).

---

## CA — Pending amendments to Backend- and Database-owned documents

These are the changes the unified plan needs in documents the AI team does not own. **None is in force
until its owner merges it on `backend`.** Each is written so the owner can adopt it as a short edit.
Until then the authoritative text is the current `API_CONTRACT_CHANGES.md` §10,
`BACKEND_CHECKLIST.md` §K and `DATABASE_CHECKLIST.md` §I on `backend`. `Ai`'s copies of those files,
and of Phase 28, were re-synced byte-identical from `backend` at `1f28d2e` on 2026-10-10; if
`backend` has moved since, its revision wins.

**Status of each amendment.** First recorded against `backend` at `9395040` (after PRs #57 and #58).
Re-verified on 2026-10-10 against `backend` at `1f28d2e` (which adds only PR #60, a sync of the AI
files) and `patient-app` at `4967d1e` (after PRs #61 and #62); no amendment's status changed except
CA-10's. Re-measure before relying on it. *Recorded* is not *adopted*: a recorded proposal stays out of
the contract until its owner adopts it.

| CA | Status |
|---|---|
| CA-1…CA-5, CA-12 | Recorded as proposals, **not adopted**, in `API_CONTRACT_CHANGES.md` §10.5, conditional on KD-2 option (i). Backend lead review pending (CA-1 also the Database lead) |
| CA-6, CA-7 | Not taken up. Held for a separate owner approval |
| CA-8 | KD-12 registered in K.3 as **open and proposed**. G-P is not approved |
| CA-9 | Recorded in K.3 as **unapproved** recommendations on KD-6, KD-10 and KD-11. All three stay open: no retention period is adopted, no provider is approved, the scope is not decided |
| CA-10 | Applied on `backend` in `BACKEND_CHECKLIST.md` §K and K.5, `API_CONTRACT_CHANGES.md` §10.3 and Phase 28 (PR #57), and on `patient-app` in the `PATIENT_FRONTEND_CHECKLIST.md` traceability table and Phase K notes (PR #61). A documentation and traceability change only; it implements nothing. The only `AIA-*` left in either place are "formerly" notes and pointers to the alias map in `AI_CHECKLIST.md` §6.12 |
| CA-11 | Recorded as proposals, **not adopted**, in `DATABASE_CHECKLIST.md` §I.2: I2 conditional on KD-2 option (i), I3 on KD-6. Database lead review pending |
| CA-13 | Added as Not Started requirements: AST-E9 (gateway extension, IC-01) and DATABASE I8 (localized names, IC-09). I8 still needs the Database lead's acceptance |

| ID | Target (owner) | Proposed change | Why | Decides or approves |
|---|---|---|---|---|
| CA-1 | `API_CONTRACT_CHANGES.md` §10.2, §10.4 (Backend); `DATABASE_CHECKLIST.md` I2 (Database) | Add intent states `failed` (with `code`) and `unknown`. `GET /me/appointment-intents/:intentId` returns them. `unknown` is never a success | Invariant 5: an uncertain outcome needs an explicit state | Backend lead; Database lead |
| CA-2 | §10.2 confirm (Backend); AST-D7, AST-D8 | The confirm route books with an idempotency key derived from the intent id, in addition to the client `Idempotency-Key` (ADR-014). On a timeout or 5xx from booking, the intent becomes `unknown` and the **server** reconciles by replaying with the same key or by reading the patient's appointments for that slot. It never retries a non-idempotent booking blindly | Invariant 5; combines both plans' idempotency rules | Backend lead |
| CA-3 | §10.2 confirm (Backend); AST-D7 | Before an intent becomes `confirmed`, the server reads the appointment back through the patient's own read path and returns those details | Invariant 4; B-8 in `AI_TOOLING_AND_BOOKING.md` | Backend lead |
| CA-4 | §10.2 (Backend) | The confirm response carries the resulting intent: `{ intentId, status, appointment?, code? }`, the same shape as the read | One result shape for the app and the assistant | Backend lead |
| CA-5 | AST-D7 TTL (Backend) | Set the intent TTL at 10 minutes, unless the Backend lead records another value | Replaces "TTL set in AST-D7" with a number | Backend lead |
| CA-6 | `BACKEND_CHECKLIST.md` K.3, KD-2 (Backend) | KD-2's closing record also needs the **owner's acknowledgement**, because the choice changes the product statement in patient-app K-06 (the earlier AI register, AIQ-03, named the owner for that reason). Recommended option stays (i), the appointment intent | Keeps both plans' ownership concerns | Owner acknowledges; leads decide |
| CA-7 | K.3, KD-1 (Backend) | Record that the owner also approves any **new patient capability**, in addition to any new credential type (from AIQ-01). Record the option shapes A/B/C of `AI_ARCHITECTURE.md` §3.3 against KD-1 (a)/(b), with B requiring a distinct AI-service credential | Invariant 6 | Owner (only for those two cases); leads otherwise |
| CA-8 | K.3 (Backend) | Add **KD-12** (proposed): should the patient-agent release gate **G-P** (`AI_EVALUATION_AND_TESTING.md` §6) become a canonical gate beside G-1…G-8 (`SECURITY_AND_DATA_ISOLATION.md` §10)? Decision owner: the owner. Affects AST-G9, AG-9.1 and the Patient App integration gate | Gate changes are canonical (from AIQ-07) | **Owner** |
| CA-9 | K.3, KD-6, KD-10, KD-11 (Backend) | Record the AI plan's recommendations as recommended defaults, still open: **KD-6** patient-deletable conversations, retention bounded by ADR-007's `messageDays` (180) precedent, no staff access; **KD-10** the owner approves the provider itself as well as spending and the DPA, on the measured criteria of `AI_ARCHITECTURE.md` §4.3; **KD-11** first release = P-AI-3, P-AI-4 and P-AI-8 emergency routing, with P-AI-1 and P-AI-7 developed in parallel but released only after KD-9 and an approved corpus | One register with both plans' reasoning | **Owner** (all three stay open) |
| CA-10 | `BACKEND_CHECKLIST.md` §K, K.5; `API_CONTRACT_CHANGES.md` §10.3; Phase 28; patient-app traceability (Backend, Patient App) | Replace AIA-\* references with the AG-\* items in `AI_CHECKLIST.md` §6.12, and add the `propose_*` tool names to §10.3 beside the capability names | AIA-\* are now aliases only | Backend lead; Patient App lead |
| CA-11 | `DATABASE_CHECKLIST.md` I2, I3 (Database) | **I2:** add a nullable conversation link, a payload hash, one open intent per conversation and payload, and the CA-1 states. **I3:** recommended shape is separate `patient_assistant_*` tables, so staff access is impossible by construction (A-11). The choice stays under KD-6 | Invariant 8: one storage model with both plans' properties | Database lead; KD-6 |
| CA-12 | §10.2 (Backend) | Name the card's "Decline" button as `discard`; there is no separate decline route | One vocabulary | Backend lead |
| CA-13 | `BACKEND_CHECKLIST.md` §K; `DATABASE_CHECKLIST.md` (Backend, Database) | Add owning tasks for two requests that have none: the gateway extension of IC-01 (tools, structured output, stop reasons, usage), and localized Arabic and English names of IC-09 | Every request needs an owning task | Backend lead; Database lead |
