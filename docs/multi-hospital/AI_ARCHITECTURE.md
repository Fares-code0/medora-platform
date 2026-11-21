# Multi-Hospital — Patient AI Agent: Architecture

**Owner team:** AI, with Backend, Database, Patient App and Security
**Checklist:** [`AI_CHECKLIST.md`](AI_CHECKLIST.md) (canonical; this file is its architecture reference)
**Governing decisions (FINAL, `OWNER_DECISIONS.md`):** DR-09, DR-10, DR-11, DR-12, DR-13 (= OD-11),
OD-08, OD-10, OD-14. DR-12's isolation rules bind the patient agent through `AI_CHECKLIST.md` F13.
**Status:** PROPOSED. This is documentation. No agent code exists, and no provider is selected.
**Revision:** 2 (2026-10-10). Revision 1 was written from a read-only inspection of every integration
branch. Revision 2 **unifies** it with the `backend` plan of PR #53 (see §1.1): one task vocabulary
(`AG-*`, `AI_CHECKLIST.md` §6), one decision register (`KD-*`, `BACKEND_CHECKLIST.md` K.3), and one
booking contract (`API_CONTRACT_CHANGES.md` §10).

Markers follow the folder convention:

- **OWNER APPROVED** cites a DR or OD.
- **TECHNICAL RECOMMENDATION** is this team's proposal.
- **OPEN (KD-x)** is a decision this plan cannot make. The register is `BACKEND_CHECKLIST.md` K.3; §9
  maps the retired AIQ-01…AIQ-10 onto it.

---

## 1. Phase 0: where the AI work actually starts

All facts below come from `git` against the remote at the inspection date, not from earlier
descriptions. Re-measure before relying on any count; they go stale on every merge.

### 1.1 Branch state (re-measured 2026-10-10, after PRs #51 and #52)

| Branch | Tip | vs `origin/main` (behind / ahead) | Holds `docs/multi-hospital/` | Note |
|---|---|---|---|---|
| `Ai` | `c67860d` | 0 / 7 | Yes | Fast-forwarded from `3f0436e` to `main` (no merge commit, no force). Then PR #51 (merge `c4e07d5`), PR #52 (merge `ddbaa75`) and PR #55 (merge `c67860d`). All commits beyond `main` are documentation |
| `main` | `033e1d8` | — | **No** | Holds the M16 backend `/ai/*` module. Not modified by the sync |
| `frontend` | `ce29fbb` | 1 / 32 | Yes (PR #47) | Shared docs identical to the revision `Ai` imported |
| `backend` | `5bc9c93` | 3 / 26 | Yes (PRs #49, #53) | PR #53 (2026-10-10) revised four shared multi-hospital docs and four phase files after `Ai` imported them. See the consequence below |
| `patient-app` | `c5510de` | 27 / 13 | Yes (PRs #48, #54) | Patient app AI interface, disconnected. Shared docs identical to the revision `Ai` imported. PR #54 aligned its checklist (K-01, K-06, K-07, I-04) with the `backend` plan |
| `Database` | `ed57b38` | 312 / 3 | No | `database/` raw SQL only |
| `backup/ai-docs-2026-10-10` | `88d2fd6` | — | — | Safety copy of these seven documents on the pre-sync `Ai`. Not for merging |

The task branches `claude/ai-sync-multi-hospital-docs` (`e328c62`) and `claude/ai-patient-agent-plan`
(`8818a22`) are merged into `Ai`. No other team's branch was merged into `Ai`.

The repository's `CLAUDE.md` branch table (measured 2026-09-03 on the earlier remote) is stale on every
branch, because the file is identical everywhere. The remote has since moved from `Fares-code0` to
`Fares7324`.

**Consequence (formerly AIQ-08; resolved for `Ai`).**
- *Done:* `Ai` contains `main`, the shared multi-hospital docs (PR #51, `docs/multi-hospital/` tree
  `df82856` as imported) and this plan (PR #52). The relative links in this folder resolve on `Ai`. This is documentation
  only: the AI starting point in §1.2 is unchanged, and no AI component is implemented.
- *Not done, and the owner's:* the multi-hospital folder is still absent from `main`.
- *Diverged after the import, then reconciled (2026-10-10, owner decision to unify):* `backend` PR #53
  revised `AI_CHECKLIST.md`, `API_CONTRACT_CHANGES.md`, `BACKEND_CHECKLIST.md`, `DATABASE_CHECKLIST.md`
  and Phases 21, 23, 24 and 28, including a second patient-assistant plan (`AIA-*`, `KD-1`…`KD-11`, §10).
  The reconciliation PR into `Ai`:
  - takes `backend`'s revision of the seven files it alone changed, **byte-identical**, so the
    Backend contract, decision register and Database tasks this plan cites exist on `Ai`;
  - unifies `AI_CHECKLIST.md` §6 on the `AG-*` vocabulary, keeps `AIA-*` only as aliases
    (`AI_CHECKLIST.md` §6.12) and retires AIQ-01…AIQ-10 in favour of KD-\* (§9);
  - lists the changes it needs in Backend- and Database-owned documents as pending amendments
    CA-1…CA-13 (`AI_INTEGRATION_CONTRACTS.md` §CA). They take effect only when their owners merge them on
    `backend`.
- *Known:* the shared docs were added separately on `frontend`, `backend`, `patient-app` and `Ai`, so
  their copies share no history. Re-measure with `git merge-tree` before merging anything to `main`:
  - after the reconciliation, `Ai` and `backend` differed only in `AI_CHECKLIST.md`. `backend` then took
    the seven AI files from `Ai` (PR #57) and revised `API_CONTRACT_CHANGES.md`, `BACKEND_CHECKLIST.md`,
    `DATABASE_CHECKLIST.md` and Phase 28 (PRs #57, #58). `Ai` re-synced those four from `backend` at
    `1f28d2e` on 2026-10-10. On any later divergence, keep `backend`'s revision of those four and
    `Ai`'s revision of the seven AI files;
  - `frontend` and `patient-app` still carry the pre-#53 revision of the seven files, so they conflict with
    both `backend` and `Ai` there; keeping the `backend` revision resolves those.

### 1.2 What exists for AI today

| # | Finding | Evidence | Bearing on the patient agent |
|---|---|---|---|
| P0-1 | **The `Ai` branch holds no AI implementation.** It has only the doctor-side frontend mock (`frontend/src/features/doctor/ai/`) and an empty `backend/src/modules/ai/` scaffold | `git ls-tree -r origin/Ai` | Greenfield, as the brief says |
| P0-2 | The backend M16 module `/ai/conversations[/:id/messages]` exists on `main` and `backend`. It streams over SSE, persists turns, and re-checks context on every send | `backend/src/modules/ai/**` | A sound base for transport, persistence and fail-closed context. It is **doctor-only** |
| P0-3 | **Patients cannot reach `/ai/*`.** Every controller is `@Can('ai.use')`. `ai.use` is seeded for clinical roles only, and patients hold **zero capabilities** by ADR-030 §6 | `ai-conversation.controller.ts`, `shared/authz/permission-catalogue.ts`, `patient-appointment.controller.ts` docblock | The patient agent needs its own route family (Backend AST-E2, IC-02; decision KD-1) |
| P0-4 | **The gateway port has no tool calling and no structured output.** `AiGatewayPort.generate()` takes `{system, turns, temperature, maxOutputTokens, language}` and yields text deltas | `backend/src/shared/ai/ai-gateway.types.ts` | An agent cannot be built on the port as it is. It needs extending, provider-neutrally (IC-01) |
| P0-5 | `AI_GATEWAY` is bound to `UnconfiguredAiGateway`, which answers 503. `AI_PROVIDER` and `AI_API_KEY` are optional env vars | `shared/ai/unconfigured-ai-gateway.ts`, `config/env.schema.ts` (AF-26) | No provider. Adding one is a configuration and adapter task |
| P0-6 | Logging is metadata-only (`AiTranscriptLog`), and `ai_messages` stores text verbatim | `shared/ai/ai-transcript.log.ts` (AF-39) | Reuse the logging rule. Patient transcript retention is OPEN (KD-6) |
| P0-7 | Conversation context modes are clinician-shaped (`general / patient / record / labs / pharmacy`), and `owner_id` is a `User` | `01-enums.prisma` `AiContextMode`, `10-communication.prisma` | The patient vocabulary is different (patient-app K-01: `navigation / symptom / appointment / medication-info`) |
| P0-8 | **The patient app AI is UI-only by construction.** `features/ai/ai-honesty.test.ts` fails the build on a network call, a storage call, a client-side classifier or a scripted reply. It is gated on **AD-4** (provider, server-side red-flag triage, named clinical owner, output filter, audit) and **BE-14** (patient-scoped AI backend) | `origin/patient-app:patient-app/PATIENT_APP_AUDIT.md` §15.4 and BE-14; checklist K-01…K-08 | Connecting the client is Patient App work, behind AD-4 |
| P0-9 | **Patient-app K-06 says "the AI never books"**, while `AI_CHECKLIST.md` P-AI-3 says "never books without confirmation", and this brief asks for confirmed execution | `PATIENT_FRONTEND_CHECKLIST.md` K-06; `AI_CHECKLIST.md` §4 | A real conflict. §6 proposes a design that satisfies both. OPEN (KD-2) |
| P0-10 | No RAG, no vector store, no embeddings, and no approved medical corpus | AF-27 | §5 and `AI_DATA_AND_KNOWLEDGE.md` |
| P0-11 | No named clinical owner. Sign-off register items are unsigned | `patient-app/docs/SIGNOFF.md` (W-10, L-04) | Blocks any production medical content (KD-9) |
| P0-12 | No patient-facing web client exists. `frontend/` is the doctor/admin SPA | `CLAUDE.md` branch model | Phase 6 integrates the patient app only |

### 1.3 What exists for the tools the agent needs

| Logical tool | Real API today (`origin/backend`) | State | Owner of the gap |
|---|---|---|---|
| `list_specialties` | `GET /patient/specialties` | **Exists** | — |
| `search_doctors` | `GET /patient/doctors?q&specialtyId&departmentId&sort&page&pageSize` | **Exists**, but single-clinic with no hospital, distance, slot or insurance data | Backend (Phase 23) for the hospital-aware version |
| `get_doctor_details` | `GET /patient/doctors/:id` | **Exists** | — |
| `get_my_appointments` | `GET /me/appointments`, `GET /me/appointments/:id` | **Exists**, read-only, self-scoped, 404-not-403 | — |
| `search_hospitals` | none | **Missing.** There is no `Hospital` model on any branch | Database (Phase 21), Backend (Phase 23) |
| `get_hospital_details` | none | **Missing** | Database (21), Backend (23) |
| `get_available_slots` | none | **Missing.** There is no `PublishedSlot` model (AF-10, AF-22) | Database and Backend (Phase 24) |
| `create_appointment` | none | **Missing.** `POST /me/appointments` is unbuilt. There is no DB double-booking guard (AF-11) and no idempotency implementation | Backend and Database (Phase 24) |
| `cancel_appointment` | none | **Missing.** Blocked by ADR-033 (Proposed, chooses no policy) | Owner and clinical decision, then Backend |
| `reschedule_appointment` | none | **Missing.** Blocked by ADR-033 | Owner and clinical decision, then Backend |

**Bottom line.** Four read tools can be built against today's API. Every hospital, slot and booking
tool is blocked on Phases 21, 23 and 24, which belong to Database and Backend and have not started.
This plan keeps those tools blocked. It does not mock them in the production path.

---

## 2. Scope

### 2.1 Candidate scope for the patient agent, v1 (OPEN, KD-11)

The two plans recommended different first releases, and **the owner decides (KD-11)**. The `backend`
plan proposed navigation and appointments only. This plan proposed the table below. The unified
recommendation (recorded in K.3 as an unapproved recommendation, CA-9) is: **release P-AI-3, P-AI-4
and the P-AI-8 emergency routing first**; develop P-AI-1 and P-AI-7 in parallel (OD-11) but release them
only after the clinical owner is named (KD-9), the corpus is approved (AG-2.3) and the owner approves
them. Nothing below is approved.

| Capability (`AI_CHECKLIST.md` §4) | v1 behaviour |
|---|---|
| P-AI-1 medical assistant: general information and navigation | Bilingual conversation. It explains which kind of clinician handles a concern, using retrieval-grounded general information and never a diagnosis |
| P-AI-3 appointment assistance | View own appointments. Propose bookings, cancellations and reschedules, which the **patient** confirms in a native control (§6) |
| P-AI-4 doctor recommendation | Explainable ranking over real discovery results only (OD-10, OD-14) |
| P-AI-7 information retrieval | Retrieval-augmented answers from a clinically reviewed corpus, with citations |
| P-AI-8 patient guidance | Server-side red-flag triage before any generation, which routes to the Emergency screen |

### 2.2 Out of scope for v1

| Item | Why |
|---|---|
| P-AI-2 image assistance (patient-app Phase L) | Needs M25 file storage, a vision evaluation and its own clinical gate |
| P-AI-5 history summaries, P-AI-6 lab explanation | They read the clinical record. Patient-app K-01 deliberately excludes `record`, `labs` and `pharmacy` from the patient vocabulary, and ADR-031 governs released results |
| Diagnosis, triage scoring, treatment or dosing advice | DR-13 governance. AD-4 classes this as a different risk class |
| Staff AI (D-AI-1…9) | Separate scope with its own authorization (`AI_CHECKLIST.md` §2, §3) |
| Fine-tuning and training on any Medora data | Not justified (`AI_DATA_AND_KNOWLEDGE.md` §6). Never on patient data without a new owner decision |
| Anatomy, Z-Anatomy, GLB, Three.js | Excluded by the brief and removed from the frontend (PR #45) |

---

## 3. Target architecture

### 3.1 Components

```text
Patient App (React Native)
  │  HTTPS, patient access token
  ▼
/me/assistant/*  (new route family, @Authenticated, patient self-scope)   ── IC-02
  │
  ├─ AssistantConversationService   ownership, persistence, retention (KD-6)
  ├─ SafetyGate (pre)               red-flag triage before any provider call       ── §7, AG-7.2
  ├─ AgentOrchestrator              bounded tool loop (rounds, calls, deadline, tokens)
  │     ├─ PromptAssembler          frozen system prompt + tool specs + retrieved passages
  │     ├─ ToolRegistry             only patient tools; Zod-validated args; principal injected
  │     │     ├─ read tools  ──▶ existing patient services (same code path as the controllers)
  │     │     └─ propose_*   ──▶ POST /me/appointment-intents (§10.2; writes an intent, never a booking)
  │     └─ Retriever                curated, versioned corpus; lexical index (AI_DATA_AND_KNOWLEDGE)
  ├─ SafetyGate (post)              output validator: action-claim check, diagnosis language,
  │                                  links and phone numbers allowlist
  └─ AI_GATEWAY (shared/ai)         provider adapter, extended for tools (IC-01)
                                           │
                                           ▼
                                     LLM provider (KD-10)

/me/appointment-intents/:intentId/confirm  ◀── the patient's tap in the app, never the model   ── §6
  └─ intent confirm (Backend AST-D7) ──▶ booking service (POST /me/appointments semantics)
                                     ──▶ verify by read (CA-3); unknown → server reconciliation (CA-2)
```

### 3.2 Design principles (TECHNICAL RECOMMENDATION)

1. **The model holds no authority.** Identity, patient, hospital scope and permissions come from the
   access token through the same self-scope services the patient controllers use
   (`PatientSelfScopeService`). Tool argument schemas contain no `patientId`, `userId` or
   authorizing `hospitalId`. A hospital id in a discovery filter is a filter, never authority
   (DR-08).
2. **Tools call services, not storage.** No tool touches Prisma, a repository, SQL or HTTP to an
   internal admin route. A dependency rule enforces this, in the style of M2.2's zone rules (AG-3.2).
3. **The model cannot cause a side effect.** Writes go through a server-held appointment intent
   (§10.2) that the patient confirms in a native control. A chat message saying "yes" is not a
   confirmation (§6). The model has no confirm tool and no database access.
4. **Fail closed and say so.** A missing tool, an unavailable provider or an unverifiable outcome
   produces an explicit, localized message. Nothing is ever a plausible guess. This continues the
   honesty rule already in `UnconfiguredAiGateway` and `ai-honesty.test.ts`.
5. **Enforcement lives in services.** The system prompt describes policy. The registry, the validators
   and the confirm endpoint enforce it. A prompt-injection success can change wording but not actions.
6. **Separate from staff AI.** The patient assistant is a different module, route family, prompt set,
   tool set and conversation vocabulary from the doctor `/ai/*` module. They share only the kernel
   (`AI_GATEWAY`, `AiTranscriptLog`).
7. **Provider-agnostic (OD-11).** Only the adapter in `shared/ai/` knows the provider. The orchestrator
   speaks the neutral contract of IC-01.

### 3.3 Where the code lives, and how it authenticates (OPEN, KD-1)

| Option | Shape | For | Against |
|---|---|---|---|
| **A (recommended) = KD-1 (a)** | A new `backend/src/modules/patient-assistant/` module in the existing NestJS app, authored on `claude/*` task branches cut from `Ai`, with Backend review | Tools call the patient services in-process with the real principal, and no new auth hop is needed. Reuses the kernel, audit, config and test infrastructure | Touches the `backend/` tree, so it needs Backend owner authorization per task. It is cross-tree for CI |
| B = KD-1 (b) | A separate AI service calling the Backend over HTTP | Clear deployment separation | **Needs a distinct AI-service credential** that the Backend can tell apart from the app's, plus the patient's delegation. A forwarded patient token is **never** proof of the AI service's identity: with it, the Backend could not refuse the service on the confirm route. A new credential type needs the owner's approval (KD-1). Also a new deployable, a second rate-limit surface and duplicated config |
| C (variant of A) | A top-level `ai/` package (pure TypeScript, no NestJS) for the orchestrator, eval and corpus, consumed by the backend | Clear AI ownership on the `Ai` branch | A new top-level tree needs an ADR and CI path filters. Wiring still needs a backend module |

Option A with a hybrid is also viable: the eval suite and corpus could live in a separate tree under
AI ownership while the runtime stays in the backend. Nothing is implemented until KD-1 is decided.

---

## 4. Model-provider architecture

### 4.1 Gateway extension (IC-01)

The existing port is chat-only by design ("nothing here names … a tool-use protocol"). The extension
keeps that neutrality: Medora types in, Medora types out, and the adapter maps them.

```ts
// Proposed additions to shared/ai/ai-gateway.types.ts. Contract only; not implemented.
interface AiToolSpec {
  name: string;                      // snake_case, stable
  description: string;
  inputSchema: JsonSchema;           // generated from the tool's Zod schema; additionalProperties: false
}
interface AiAgentRequest extends AiGenerationRequest {
  tools: readonly AiToolSpec[];
  history: readonly AiAgentTurn[];   // includes prior tool calls and results
}
type AiAgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }    // input re-validated server-side
  | { type: 'stop'; reason: 'end' | 'tool_use' | 'max_tokens' | 'refusal' | 'other'; usage: AiUsage };
interface AiGatewayPort {
  generate(request, signal?): AsyncIterable<AiDelta>;                  // unchanged
  runAgentStep?(request: AiAgentRequest, signal?): AsyncIterable<AiAgentEvent>;
  generateStructured?<T>(request, schema: JsonSchema, signal?): Promise<T>;
  describe(): AiModelDescription;
}
```

Design notes:

- Optional methods keep the doctor module compiling unchanged.
- `refusal` is a first-class stop reason. The orchestrator turns it into a safe, localized message and
  never retries it silently.
- Usage (input and output tokens) is returned so cost controls (§7) have real numbers.
- The orchestrator never relies on **forced** tool choice. At least one candidate provider rejects
  forced `tool_choice` on its newest models (§4.3). The loop uses automatic tool choice, strict schemas
  and server-side validation.

### 4.2 Configuration (IC-01, AG-1.8)

| Variable | Exists | Rule |
|---|---|---|
| `AI_PROVIDER` | yes | Enum of implemented adapters. An unknown value fails boot |
| `AI_API_KEY` | yes | Server-only and never logged. It is read only inside `shared/ai/` |
| `AI_MODEL` | **new** | The exact pinned model id, never an alias. It is recorded in `describe()` and in every eval report |
| `AI_REQUEST_TIMEOUT_MS` | **new** | Per provider call. Default proposal is 30000 for streaming |
| `AI_TURN_DEADLINE_MS` | **new** | The whole agent turn, including tools. Default proposal is 45000 |
| `AI_MAX_TOOL_ROUNDS` | **new** | Default proposal is 6 |
| `AI_PATIENT_DAILY_TURN_LIMIT` | **new** | Per patient. Default proposal is 100 |
| `AI_DAILY_COST_CEILING_USD` | **new** | Global circuit breaker (§7) |
| `AI_DATA_REGION` | **new, optional** | Provider-specific processing-region pin, where the provider offers one |

The adapter uses bounded exponential-backoff retries (429, 5xx and network errors only), a circuit
breaker, and abort propagation (the existing `AbortSignal` path).

### 4.3 Provider evaluation (AG-1.3…AG-1.5; nothing is approved)

OD-11 delegates "provider selection and its data-processing agreement" to implementation. This brief
additionally requires documented evaluation and owner approval before any provider is used. The
evaluation is a **measurement**, run on the eval suite of `AI_EVALUATION_AND_TESTING.md`. It is not a
recollection of marketing claims.

**Criteria and weights (TECHNICAL RECOMMENDATION; owner may reweight):**

| # | Criterion | Weight | How it is measured |
|---|---|---|---|
| C1 | Arabic quality (MSA and common dialect input) | 20 | Blind 1–5 rubric by two Arabic-speaking reviewers on EV scenarios tagged `ar` |
| C2 | English quality | 10 | Same rubric, `en` scenarios |
| C3 | Tool selection and argument accuracy | 20 | Automatic: exact tool, schema-valid args, correct values vs the gold label (EV-T*) |
| C4 | Safety behaviour | 15 | Red-flag recall, refusal of diagnosis, no false action claims (EV-S*, EV-B*) |
| C5 | Latency | 10 | p50 and p95 time to first token and full turn, measured from the same region as staging |
| C6 | Cost | 10 | Measured tokens × the provider's published price **on the eval date** (the date is recorded) |
| C7 | Data handling and terms | 15 | Pass/fail gates plus a score: DPA available, no training on API data by default, retention and zero-retention options, processing region, sub-processors. Read from the provider's current terms, cited with date |
| — | Integration complexity | gate | An official TypeScript SDK, streaming plus tools, and a stable model pinning policy |

A provider that fails any C7 gate is excluded whatever its score.

**Shortlist for the first run.** These are candidates, not approvals:

| Candidate | Facts verified for this plan | To verify during evaluation |
|---|---|---|
| Anthropic Claude API | Per the vendor's SDK reference, cached 2026-10-06: pinned model ids such as `claude-sonnet-5-5`, `claude-haiku-5-5` and `claude-opus-5-5`; tool use with `strict: true` schema validation; structured outputs (`output_config.format`); a `refusal` stop reason; forced `tool_choice` (`any`/`tool`) **rejected** on the newest models; an official TypeScript SDK; a request-level inference-geography parameter on current models | Arabic quality (C1), latency from our region, retention and DPA terms for health data, current prices on the eval date |
| OpenAI API | — (not verified in this session) | All criteria from current vendor documentation |
| Google Gemini API / Vertex AI | — (not verified in this session) | All criteria from current vendor documentation |
| Self-hosted open-weight model with an Arabic-capable family | — (not verified in this session) | All criteria. Hosting cost and operational burden are counted under C6 and integration |

The evaluation report records, for each candidate: the exact model id, the date, the eval suite
version, raw scores, cost per 100 conversations, and the terms excerpts relied on. The owner approves
one primary provider and, optionally, one fallback, together with spending and the DPA (KD-10). A fallback is used only when it has passed the
same gates (KD-10).

### 4.4 Model routing (TECHNICAL RECOMMENDATION, confirmed by measurement)

| Stage | Model tier | Why |
|---|---|---|
| Red-flag classifier (structured output) | Small and fast | Runs on every message before generation. Latency matters, and the output is a small schema |
| Agent turn (tools and answer) | Mid tier | Tool accuracy and Arabic quality dominate. Escalate a tier only if the eval shows a gap |
| Offline eval judging | Any tier, separate from the model under test | Avoids self-grading bias. A human audits a sample |

---

## 5. Knowledge and retrieval (summary)

Full design: [`AI_DATA_AND_KNOWLEDGE.md`](AI_DATA_AND_KNOWLEDGE.md).

- Live hospital, doctor, slot and appointment data is **never** in the knowledge base. It is fetched
  through tools on every turn.
- Medical information comes only from a curated, licensed, clinically reviewed, versioned corpus.
- v1 retrieval is lexical (BM25 with Arabic normalization) over corpus files in the repository. It
  needs no database or schema change. Embeddings are a measured later upgrade.
- If retrieval finds nothing above threshold, the assistant says it cannot answer reliably and offers
  navigation to a clinician. It does not fall back to unsupported model knowledge for medical claims.

---

## 6. Consequential actions: propose, then the patient confirms

This design resolves the P0-9 conflict. The model **proposes**. The patient **confirms** in the app.
The Backend **executes**, **verifies** and **reports**. The model never invokes a side-effecting
operation, so "the AI never books" (patient-app K-06) stays true, and P-AI-3's "never without
confirmation" holds by construction. The contract is the appointment intent of
[`API_CONTRACT_CHANGES.md`](API_CONTRACT_CHANGES.md) §10.2; the mechanism itself is still decision
**KD-2**, with this design as the recommended option.

```text
1  Patient: "Book me with a cardiologist tomorrow afternoon"
2  Agent asks for anything missing (which hospital or area, a preferred doctor, the reason)
3  Agent → search_doctors / get_available_slots   (real data only)
4  Agent presents options; patient picks one in chat or by tapping a slot chip
5  Agent → propose_appointment {slotId, reason}  =  POST /me/appointment-intents {action:'book', …}
      server: slot PUBLISHED and future? doctor discoverable? patient eligible? (every commit check)
      server: builds the summary from authoritative rows (not from model text)
      server: stores intent {owner, action, target, parameter hash, summary, expiresAt, status prepared}
      SSE  → intent_prepared {intentId, summary, expiresAt}      (rendered as a native card)
6  Patient taps "Confirm" → POST /me/appointment-intents/:intentId/confirm   (app only, not a tool)
      server: caller owns it, prepared, not expired; no parameters accepted
      server: book via the booking service; client Idempotency-Key + a key derived from intentId (CA-2)
      server: verify by reading the appointment back through the patient's own read path (CA-3)
      server: intent → confirmed (appointment) | failed (code) | unknown            (CA-1)
7  Assistant → get_intent  →  SSE intent_result {status, verified details | code}
      only a confirmed intent read in this turn lets the assistant say "booked" (B-7)
```

| Situation | Behaviour |
|---|---|
| Slot taken between prepare and confirm | `failed` with `slot_taken`. The patient is told plainly and offered fresh slots for the same doctor |
| Duplicate tap or network retry | The intent is single use and the booking key derives from the intent id, so one booking at most. The second response returns the first result |
| Intent expired or conversation deleted | `409 intent_expired` or 404 (§10.4). Nothing is booked, and the agent can propose again |
| Patient's session expired at confirm | 401. Nothing is booked, and the intent stays `prepared` until it expires |
| Timeout or 5xx from booking | `unknown`. The **server** reconciles by idempotent replay or by a read for this patient and slot (CA-2). It never retries blindly. **Never "booked" until verified.** The patient sees "We could not confirm this yet" with a link to My Appointments |
| Model writes "your appointment is booked" without a confirmed intent read in the turn | The post-generation validator blocks or replaces the sentence (AG-7.3), and it is logged as a safety event |

Cancel and reschedule use the same mechanism (`propose_cancellation`, `propose_reschedule`). Both stay
blocked until KD-3 (ADR-033) is decided and Backend ships AST-D4 and AST-D5.

---

## 7. Safety, isolation and cost (summary)

Full design: [`AI_SAFETY_AND_SECURITY.md`](AI_SAFETY_AND_SECURITY.md).

- **Pre-generation red-flag triage on the server** (AD-4, patient-app K-04): a clinically reviewed
  bilingual lexicon plus a structured classifier. Either one firing emits an `emergency` event, which
  the client renders before any generated text. A classifier error degrades toward safety: the
  emergency route is shown.
- **Post-generation validation**: action-claim check, diagnosis-language check, URL and phone
  allowlist, and the disclaimer marker.
- **Isolation**: conversation ownership is a WHERE clause with 404-not-403. There is no cross-user
  cache, no long-term memory across conversations, metadata-only logs, and no hospital staff access to
  patient assistant transcripts unless KD-6 decides otherwise.
- **Cost**: per-patient daily turn limit, per-turn token and round caps, a global daily cost ceiling
  that trips the circuit breaker to a 503 "assistant unavailable", and a request rate limit (depends
  on the AF-20 throttler).

---

## 8. Client contract (summary)

Full contract: [`AI_INTEGRATION_CONTRACTS.md`](AI_INTEGRATION_CONTRACTS.md) IC-02 and IC-08. SSE events:

- `delta`
- `tool_status` ("Searching doctors…", localized; no raw arguments)
- `emergency`
- `intent_prepared`
- `intent_result`
- `citation`
- `done`

---

## 9. Open decisions: retired AIQ register, mapped to KD

Decisions live in **one** register, [`BACKEND_CHECKLIST.md`](BACKEND_CHECKLIST.md) K.3 (KD-1…KD-12). The
AIQ register of revision 1 is **retired**. Each AIQ maps onto a KD, a task or an amendment, and none is
resolved by the mapping. Recommendations from AIQ that K.3 did not record were proposed to its
owner as CA-6…CA-9 (`AI_INTEGRATION_CONTRACTS.md` §CA, which records what `backend` has taken up).

| Retired | Now | Owner per the unified plan | Note |
|---|---|---|---|
| AIQ-01 patient authorization | Task Backend AST-E2; decision KD-1 | Backend lead + AI engineer; owner for any new patient capability (CA-7) | Recommendation unchanged: `/me/assistant/*` under `@Authenticated()` with self-scope, no new capability |
| AIQ-02 where the code lives | **KD-1** | Backend lead + AI engineer; owner for a new credential type | §3.3 options A/B/C map to KD-1 (a)/(b) |
| AIQ-03 booking execution model | **KD-2** | Leads decide; owner acknowledges (CA-6) | §6 is the recommended option (i), the appointment intent |
| AIQ-04 provider, DPA, terms | **KD-10** | **Owner** | Measured per §4.3 |
| AIQ-05 conversation retention | **KD-6** | **Owner** approves retention | Recommended default in CA-9 |
| AIQ-06 clinical owner | **KD-9** | **Owner** names | — |
| AIQ-07 release gate G-P | **KD-12, proposed** (CA-8) | **Owner** | Registered in K.3 as open and proposed (`backend` PR #57). G-P is not approved |
| AIQ-08 integration base | Not a decision | — | Resolved for `Ai`; landing the docs on `main` is AG-0.8 |
| AIQ-09 patient-assistant ADR | Task AG-0.9 | Architecture | Written once KD-1, KD-2 and KD-6 are answered |
| AIQ-10 v1 scope | **KD-11** | **Owner** | §2.1 |
