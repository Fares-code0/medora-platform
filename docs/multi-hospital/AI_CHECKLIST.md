# Multi-Hospital — AI Checklist

**Owner team:** AI (with Backend and Security)
**Work phase:** `docs/work-phases/PHASE-28-AI-CONTEXT-AND-HOSPITAL-ISOLATION.md`
**Governing decisions (FINAL):**
- DR-12 = OD-05 — isolation, authorization-bound use, retention;
- DR-13 = OD-11 — scope, parallel development, provider-agnostic, governance;
- OD-04 — Break-Glass;
- OQ-01 = A — doctor-approved documentation into the requesting hospital's record.

DR-04, DR-06, OD-12 and OD-13 apply too.
**Status:** NOT STARTED. Current AI state: `AUDIT_FINDINGS.md` AF-26…AF-30, AF-39.

**This is the one canonical AI checklist.** Rev. 6 (2026-10-10) **unifies** the two patient-assistant
plans that existed on `Ai` (§6, `AG-*`) and on `backend` (PR #53, `AIA-*`), by the owner's decision to
unify. It does not change any owner decision, and it resolves none of the open decisions.
- **Tasks:** `AG-*` in §6 are canonical. `AIA-*` survive only as aliases (§6.12).
- **Decisions:** one register, `KD-*` in [`BACKEND_CHECKLIST.md`](BACKEND_CHECKLIST.md) K.3. The AIQ
  register is retired (`AI_ARCHITECTURE.md` §9 maps it).
- **Booking contract:** one, the appointment intent of [`API_CONTRACT_CHANGES.md`](API_CONTRACT_CHANGES.md)
  §10.2. Changes this plan needs in Backend- and Database-owned text are the pending amendments
  CA-1…CA-13 (`AI_INTEGRATION_CONTRACTS.md` §CA), not in force until their owners merge them. §CA
  records which ones `backend` has taken up.
- **Backend tasks** are `BACKEND_CHECKLIST.md` §K (AST-\*); **Database tasks** are
  [`DATABASE_CHECKLIST.md`](DATABASE_CHECKLIST.md) §I.

Rev. 5 (2026-10-10) restructured the checklist and extended it:
- §2 and §5 keep their IDs and wording, now with the fields every item needs (below).
- §6 adds the **patient AI agent** plan (`AG-*` items), which turns P-AI-1, 3, 4, 7 and 8 into
  ordered, verifiable work.
- §0, §1, §3 and §4 are unchanged, word for word.

Supporting documents for the patient agent (read with this file):

| File | Covers |
|---|---|
| [`AI_ARCHITECTURE.md`](AI_ARCHITECTURE.md) | Phase 0 findings, target architecture, provider evaluation, and §9: the retired AIQ-01…AIQ-10 mapped onto KD-\* |
| [`AI_DATA_AND_KNOWLEDGE.md`](AI_DATA_AND_KNOWLEDGE.md) | Data categories K1–K5, RAG pipeline, provenance, fine-tuning gate |
| [`AI_TOOLING_AND_BOOKING.md`](AI_TOOLING_AND_BOOKING.md) | Tool contracts and the propose-then-confirm booking workflow |
| [`AI_SAFETY_AND_SECURITY.md`](AI_SAFETY_AND_SECURITY.md) | Threat model, emergency escalation, isolation, output validation, cost |
| [`AI_EVALUATION_AND_TESTING.md`](AI_EVALUATION_AND_TESTING.md) | Eval suite EV-*, metrics, proposed thresholds, proposed gate G-P (KD-12, proposed), negative tests PN-* |
| [`AI_INTEGRATION_CONTRACTS.md`](AI_INTEGRATION_CONTRACTS.md) | Contracts IC-01…IC-12 other teams own |

**Item fields.** Every item carries:
- a stable ID;
- the task;
- a status;
- the responsible team;
- dependencies and the blocking reason;
- acceptance criteria;
- the verification method and evidence;
- documentation.

An item is **Done** only when its evidence exists and has been checked.

| Status | Meaning |
|---|---|
| Not Started | Planned; no work yet |
| In Progress | Work has started on a task branch |
| In Review | Deliverable exists and awaits review or owner approval |
| Blocked | Cannot proceed. The blocking item is named |
| Deferred | Deliberately out of current scope, with the reason recorded |
| Done | Implemented **and** its evidence verified |

> **Correction history.**
> - Rev. 1 said AI must exclude cross-hospital data even under a grant (superseded by OD-05).
> - Rev. 3 recognized only grants and kept AI-drafted notes free of cross-hospital content (superseded).
>   AI may also use data under valid **Break-Glass** (OD-04). Doctor-approved content may be documented
>   into the requesting hospital's record (OQ-01 = A).
> - Rev. 6 (2026-10-10) unifies the `Ai` and `backend` patient-assistant plans (§6.10). No status was
>   raised; no open decision was closed.
> - Rev. 5 (2026-10-10) restructures §2 and §5 into the item fields above, and adds §6, the patient
>   agent plan, and §7. No rule is changed.

---

## 0. The rules (OWNER APPROVED)

**R1 — Default isolation.** AI context = Patient → current hospital context → **that hospital's**
Medical Record.

**R2 — Cross-hospital use only under valid authorization, re-checked on every use.** Valid
authorization is exactly one of:
- **(a) an approved Cross-Hospital Grant** whose categories include the data, whose clinical purpose is
  active, which is not expired or revoked, and whose requester is still employed (OD-01, OD-03, OD-12);
- **(b) valid Break-Glass access**, within its minimum-necessary scope and emergency window, not ended
  or revoked, and whose requester is still employed (OD-04).

AI may use **only** the data the doctor is authorized to use. Without valid authorization, it uses no
cross-hospital data.

**R3 — No retention of raw cross-hospital data after authorization ends.** On expiry, revocation,
purpose end, emergency-window end or employment end, the AI **immediately loses access**. Raw
cross-hospital data must not remain as:
- permanent AI memory;
- unrestricted patient-profile data;
- persistent RAG/vector content;
- model-training data;
- any AI-side permanent copy.

**R4 — Doctor-approved documentation is the exception (OQ-01 = A).** Content the doctor explicitly
reviews, approves and saves into the **requesting** hospital's Medical Record becomes that hospital's
clinical data. It follows that hospital's retention, access and audit rules, with provenance. It is
**selective, never a whole-record copy**, and it never grants access to the source record.

**R5 — Governance (OD-11).**
- AI is an assistant, not a doctor.
- It states uncertainty, never claims 100% certainty, and never presents uncertain output as fact.
- It recommends professional evaluation where appropriate.
- High-risk capabilities get stronger safeguards and release gates.

**R6 — Provider-agnostic (OD-11).** All provider calls go through `AI_GATEWAY`. A provider change does not
rebuild the core.

**Release gate.** No real AI provider is enabled for these workflows until hospital authorization
(Phase 22), grants and Break-Glass (Phase 22A) and gate **G-5** (`SECURITY_AND_DATA_ISOLATION.md` §8)
all pass.

## 1. AI data classes and retention (addresses AF-39)

Today `ai_messages` stores every prompt and completion verbatim (AF-39). Normal conversation history has
legitimate product value and is **not** deleted wholesale. Instead, every AI artefact belongs to exactly
one class.

| Class | What it is | Where it may live | Retention | Never |
|---|---|---|---|---|
| **C1 — Same-hospital AI data** | Conversations, prompts, completions and settings built only from the current hospital's data | `ai_conversations` / `ai_messages`, bound to the hospital | Normal product retention (ADR-007 policy), hospital-scoped access, soft delete as today | Visible to another hospital |
| **C2 — Transient cross-hospital context** | Raw source data from Hospital B fetched under a grant or Break-Glass, **and** any AI output derived from it that the doctor has not approved into a record (summaries, drafts, answers) | Assembled per request. If persisted at all (e.g. to show the conversation while authorization is valid), stored **tagged** with `authorizationType` (`GRANT`/`BREAK_GLASS`), `authorizationId`, source hospital and categories | **Tied to the authorization lifetime.** On end, purged or rendered inaccessible (redacted turn with a "cross-hospital content removed — authorization ended" marker). Audit keeps metadata only | Permanent AI memory, patient-profile context, persistent RAG/vector index, training, cache beyond the request, logs |
| **C3 — Doctor-approved documentation** | Content the doctor reviewed, edited, approved and **saved into Hospital A's Medical Record** (manually or from an AI draft) | Hospital A clinical tables (e.g. an encounter note or addendum), with provenance | Hospital A's normal clinical retention, access and audit rules | Treated as access to Hospital B; whole-record imports |

Transition rules — TECHNICAL RECOMMENDATION:
- C2 → C3 happens **only** through an explicit doctor save action. It records provenance (source
  hospital, authorization id, categories, source references, approving doctor, time). The authorization
  must be valid at save time.
- C2 never silently becomes C1. A conversation that used cross-hospital context keeps C1 turns. C2 turns
  are tagged and purged or redacted at authorization end.
- The metadata-only logging policy in `backend/src/shared/ai/ai-transcript.log.ts` (no prompt or
  completion text in logs) stays and also covers C2.

## 2. Foundations

All F items are doctor-AI and isolation foundations from Phase 28. Their wording is unchanged from
Rev. 4. F13 is the hand-off to the patient agent in §6.

| ID | Task | Status | Team | Depends on / blocking reason | Acceptance criteria | Verification & evidence | Docs |
|---|---|---|---|---|---|---|---|
| **F1** | `AiContextService` requires the server-derived hospital context; default current hospital only (today assignment-scoped, no hospital input — AF-28) | Blocked | AI + Backend | Phase 22 (hospital context does not exist yet) | Context assembly refuses without a server-derived hospital. A doctor at A gets only A data | T1, T10 in CI | Phase 28; `SECURITY_AND_DATA_ISOLATION.md` §8 |
| **F2** | Authorization-aware assembly: cross-hospital fragments are added only after re-checking R2 at request time, filtered to the authorized categories or emergency scope | Blocked | AI + Backend | Phase 22A (grants, Break-Glass) | Only authorized categories appear, re-checked on every turn | T2, T3 | §0 R2; `API_CONTRACT_CHANGES.md` §7 |
| **F3** | C2 handling: per-request assembly; tagged persistence only if needed; no caching beyond the request | Blocked | AI + Backend + Database | Phase 22A; C2 tagging columns (Database) | No C2 content outside the request unless tagged with its authorization | T4, T7 | §1 |
| **F4** | Purge/redaction job and on-read guard: when a grant or Break-Glass ends, C2 artefacts become inaccessible immediately (read-time check) and are purged or redacted (background). Metadata-only audit | Blocked | AI + Backend | Phase 22A; job registry (M30, ADR-041) | Read is refused at once, and purge or redaction completes, at authorization end | T4, T5 | §1; N-14, N-27 |
| **F5** | Continuation lock: the next turn after authorization ends rebuilds context without cross-hospital data | Blocked | AI + Backend | F2 | The next turn has no B data | T4 | §1 |
| **F6** | "Save to record" flow (C2 → C3): doctor-only explicit action; selective content; provenance; validity check at save; no whole-record import endpoint | Blocked | Backend + AI + Frontend | Phase 22A; OQ-01 provenance format (implementation specification) | Only an explicit doctor save writes. Provenance is recorded. Whole-record import does not exist | T8, T9; N-28…N-30 | §1; OQ-01 |
| **F7** | Retrieval/RAG (none today — AF-27): indexes partitioned by hospital. Cross-hospital content is never embedded into a persistent index; under authorization, the source hospital's data is read live with an authorization-scoped filter | Not Started | AI | The patient corpus (AG-2) holds **no** hospital data, so it is compliant by construction. A doctor-side index waits on Phase 22 | No hospital B content in any persistent index | T7; corpus validator (AG-2.4) | `AI_DATA_AND_KNOWLEDGE.md` §2; IC-10 |
| **F8** | No model training on cross-hospital data, ever (R3). Any training on same-hospital data needs a separate owner decision | Not Started | AI | — (policy) | No training pipeline exists that takes Medora data. Any fine-tuning proposal follows the gate | Repository review; `AI_DATA_AND_KNOWLEDGE.md` §6 | §0 R3 |
| **F9** | Containment: the AI module cannot write clinical records by itself. Only the doctor's save action (F6) writes. `aiAssisted` provenance stays (M16.6, `ai-containment.spec.ts`) | Not Started (spec exists on `main`/`backend`) | AI + Backend | — | The containment spec stays green, and covers the patient agent module too (AG-3.2) | `ai-containment.spec.ts` CI run | T11 |
| **F10** | Provider adapter behind `AI_GATEWAY` (today `UnconfiguredAiGateway`, 503 — AF-26); provider selection includes a data-processing agreement | Blocked | AI + Backend | IC-01 (port has no tool calling); KD-10 (no approved provider). Doctor workflows also wait on G-5 | The adapter passes the contract suite. The provider is approved with a data-handling record | Adapter contract tests; evaluation report | `AI_ARCHITECTURE.md` §4; AG-1.* |
| **F11** | Uncertainty and disclaimer on every output (R5) | Not Started | AI | KD-9 for reviewed copy | Every answer states uncertainty where relevant. The disclaimer is present | Eval rubric (M-3); K-03 test on the client | `AI_SAFETY_AND_SECURITY.md` §3 |
| **F12** | Web client: `/ai/*` HTTP adapter replaces the mock (AF-29). Cross-hospital content is labelled with its source and authorization end | Not Started | Frontend | Doctor AI provider (F10); labels need F2 | The mock is removed from the production path | Frontend suite; FE-10 F40 closed | `docs/FE-10-INTEGRATION-STATUS.md` |
| **F13** | Patient app: the assistant (UI-only today — AF-30) uses the same isolation and retention model | Blocked | AI + Patient App + Backend | Delivered through §6 (AG-5, AG-6). Waits on KD-1, KD-6, IC-02, IC-08 | §6 gate G-P (KD-12, proposed) passes | `AI_EVALUATION_AND_TESTING.md` §6 | §6 |
| **F14** | Consultations (OD-13): AI in a consultation obeys R1–R4; consultation messages are not an AI memory channel | Blocked | AI + Backend | Phase 22A consultations | AI in a consultation uses only authorized data | T13 | OD-13 |

## 3. Doctor AI capabilities (DR-13; parallel development, individually validated)

| ID | Capability | Data | Risk tier (TECHNICAL RECOMMENDATION) |
|---|---|---|---|
| D-AI-1 | Second-opinion / differential support | Current hospital; authorized cross-hospital data under R2 | High |
| D-AI-2 | Clinical information retrieval / RAG | Hospital-partitioned index; reference corpus | Medium |
| D-AI-3 | Patient-history summaries | Current hospital; authorized cross-hospital data under R2, labelled by source | Medium |
| D-AI-4 | Consultation-note preparation | Current encounter plus authorized cross-hospital data (C2). The doctor approves and saves (C3, OQ-01) | Medium |
| D-AI-5 | Ambient scribing | Current encounter audio (consent and recording rules are implementation policy) | High |
| D-AI-6 | Risk prediction | Current hospital | High |
| D-AI-7 | Report / lab analysis | Current hospital; authorized cross-hospital data under R2 | Medium |
| D-AI-8 | X-ray / MRI / CT analysis | Current hospital's studies (needs file storage M25) | High |
| D-AI-9 | Task automation | Current hospital; proposes, clinician confirms | Medium |

## 4. Patient AI capabilities (DR-13)

| ID | Capability | Data |
|---|---|---|
| P-AI-1 | Medical assistant / chatbot | General content; the patient's own record at the hospital they select |
| P-AI-2 | Image-based patient assistance | Images the patient submits |
| P-AI-3 | Appointment assistance | Authenticated discovery and published slots; never books without confirmation. Plan: §6 |
| P-AI-4 | Doctor recommendation | Discovery data (OD-10). Insurance-aware for insured patients, unrestricted for uninsured (OD-14). Explainable criteria. Plan: §6 |
| P-AI-5 | Patient-history summaries | One hospital's record at a time; never silently merged |
| P-AI-6 | Report / lab explanation | Released results only (ADR-031) |
| P-AI-7 | Information retrieval | Reference corpus |
| P-AI-8 | Patient guidance | Emergency escalation (patient-app Phase N) |

## 5. Tests (gate G-5)

The task wording is unchanged from Rev. 4 and is itself the acceptance criterion. Test names are
assigned when the specs are written. A test is reported as passing only from a CI run.

| ID | Task (= acceptance criterion) | Status | Team | Depends on / blocking reason | Verification & evidence | Docs |
|---|---|---|---|---|---|---|
| **T1** | Default: AI for a doctor at A never contains B data (by patient id, record id, retrieval, cache) | Blocked | Security + AI + Backend | F1; two-hospital seed (G-1, Phase 21) | e2e spec in the backend suite, CI run id | N-12 |
| **T2** | Valid grant: AI uses **only** the granted categories; ungranted categories never appear | Blocked | Security + AI | F2; Phase 22A | e2e spec, CI | N-13 |
| **T3** | Valid Break-Glass: AI uses only the emergency minimum-necessary scope during the window | Blocked | Security + AI | F2; Phase 22A | e2e spec, CI | N-24 |
| **T4** | Grant expires / is revoked / purpose ends mid-conversation: the next turn has no B data; C2 artefacts are inaccessible at once and purged or redacted | Blocked | Security + AI | F4, F5 | e2e spec, CI | N-14 |
| **T5** | Break-Glass window ends or is revoked: same as T4 | Blocked | Security + AI | F4 | e2e spec, CI | N-27 |
| **T6** | Requester's employment ends: same as T4, and no A data either (OD-12) | Blocked | Security + AI + Backend | Phase 22 employment lifecycle | e2e spec, CI | N-7, G-4 |
| **T7** | No B raw data in persistent RAG/vector stores, profile context, long-term memory, logs or training sets, before or after the end | Blocked | Security + AI | F3, F7 | e2e spec plus a store scan, CI | N-14 |
| **T8** | **Doctor-approved save (C3):** after the doctor saves selected content into A's record, that content stays readable at A after the grant ends (Hospital A data, with provenance). The **source** B data stays inaccessible. No "import whole record" path exists | Blocked | Security + Backend + AI | F6 | e2e spec, CI | N-28 |
| **T9** | Save without valid authorization, or by a non-doctor or by the AI alone, is refused | Blocked | Security + Backend | F6 | e2e spec, CI | N-29 |
| **T10** | Missing or ambiguous hospital context: refusal, not an unscoped context | Blocked | Security + AI | F1 | e2e spec, CI | — |
| **T11** | Containment: no AI-initiated clinical writes (existing spec stays green) | Not Started (spec exists on `main`/`backend`) | AI + Backend | — | `ai-containment.spec.ts` CI run; extended to the patient module (AG-3.2) | F9 |
| **T12** | Patient AI: per-hospital summaries; no cross-hospital merge | Deferred | AI + Patient App | P-AI-5 is outside the patient agent's candidate v1 (KD-11). It applies when P-AI-5 is scheduled | e2e spec, CI | §4 |
| **T13** | Consultation with AI: obeys T2–T8 | Blocked | Security + AI | F14; Phase 22A | e2e spec, CI | OD-13 |

## 6. Patient AI agent plan (AG-*)

**Goal.** A bilingual patient assistant that is integrated with Medora's real services. It:
- finds and compares real doctors and hospitals;
- answers general health questions from reviewed sources;
- shows the patient's own appointments;
- proposes bookings, cancellations and reschedules that **the patient confirms**, then reports only
  verified outcomes.

**Order.** Phases run in dependency order. A phase may start once its own dependencies are met; it
need not wait for the previous phase to finish. At each phase boundary the AI team reports changes,
tests, evidence, blockers and the proposed next step.

**Doc keys:**

| Key | File |
|---|---|
| ARCH | `AI_ARCHITECTURE.md` |
| DATA | `AI_DATA_AND_KNOWLEDGE.md` |
| TOOL | `AI_TOOLING_AND_BOOKING.md` |
| SAFE | `AI_SAFETY_AND_SECURITY.md` |
| EVAL | `AI_EVALUATION_AND_TESTING.md` |
| IC | `AI_INTEGRATION_CONTRACTS.md` |

**Honesty rule.** Phases 3, 4 and 6 have items that depend on APIs that do not exist (hospitals,
slots, booking, cancel and reschedule). Those items stay **Blocked**. Nothing is mocked in the
production path to make them look done.

**Unified rules.** Every AG item obeys these. They merge this plan's design principles
(`AI_ARCHITECTURE.md` §3.2) with the rules of the `backend` plan.
- **U1 — The Backend decides.** Authorization, patient ownership, hospital isolation, slot revalidation,
  booking execution, idempotency and the final result are the Backend's. The assistant relays them.
- **U2 — Tools only.** Live data comes only from the tools of `AI_TOOLING_AND_BOOKING.md` §2. No
  database access, SQL, repository access or generic query tool.
- **U3 — The model never confirms or executes a write.** It prepares an appointment intent. The patient
  confirms in the app (`API_CONTRACT_CHANGES.md` §10.2). There is no confirm tool.
- **U4 — Success only from the Backend.** The assistant says "booked" only after a `confirmed` intent read
  in the same turn. `prepared` and `unknown` are never success. An uncertain outcome is reconciled by the
  server, never retried blindly (CA-1, CA-2).
- **U5 — Distinct AI identity.** If KD-1 chooses a separate AI service, it authenticates with its own
  credential. A forwarded patient token is never proof of the AI service's identity.
- **U6 — No integration readiness on blocked dependencies.** An AG item that depends on a Backend
  (`AST-*`) or Database (`DATABASE_CHECKLIST.md` §I) task is not integration-ready, and is not ticked,
  while that task is not Done with its evidence. Fakes are for development only.
- **U7 — Owner gates stay open.** Clinical functions need the named clinical owner (KD-9) and an
  approved first-release scope (KD-11). The provider, spending and DPA (KD-10) and conversation retention
  (KD-6) stay open until the owner decides.
- **U8 — Signed in, always (DR-09).** Every patient-assistant route and every tool requires an
  authenticated patient session. Signed out, the Backend answers 401 before any model call, tool call or
  provider request. This covers patient-specific actions and data (own appointments, appointment
  intents, conversations, profile) **and** discovery of hospitals, doctors, specialties, locations and
  slots: DR-09 (FINAL) permits no public or signed-out discovery, so no tool is offered on a signed-out
  path. Discovery needs no prior hospital relationship (DR-09). The signed-out patient surfaces are
  sign-in, registration and the Emergency screen (`CLIENTS_CHECKLIST.md` PA-1); the assistant is not one
  of them. Enforcing and testing this is Backend work (`BACKEND_CHECKLIST.md` K.0 rule 5; AST-F3, Not
  Started). Allowing any signed-out discovery needs a new owner decision superseding DR-09, not an
  amendment to this plan.

### 6.0 Phase 0 — Repository and architecture alignment

| ID | Task | Status | Team | Depends on / blocking reason | Acceptance criteria | Verification & evidence | Docs |
|---|---|---|---|---|---|---|---|
| AG-0.1 | Inspect the git state: branch, working tree, divergence of all integration branches | Done | AI | — | Branch, clean tree and ahead/behind counts recorded | `git status`, `git rev-list --left-right --count` output recorded 2026-10-10 | ARCH §1.1 |
| AG-0.2 | Read the canonical multi-hospital decisions and plans | Done | AI | — | Every DR, OD and OQ bearing on AI and booking is cited | Citations in ARCH and in this section | ARCH; `OWNER_DECISIONS.md` |
| AG-0.3 | Establish the real AI starting point on `Ai` and the other branches | Done | AI | — | Findings P0-1…P0-12 have file evidence | `git ls-tree` and `git show` paths cited per finding | ARCH §1.2 |
| AG-0.4 | Map the logical tools to the real APIs and classify each as buildable or blocked | Done | AI | — | Each of 10 tools mapped, with its owner | Route and file paths cited | ARCH §1.3; TOOL §2 |
| AG-0.5 | Record dependencies on other teams as contracts | In Review | AI | Owning teams must review IC-01…IC-12 | Each contract has an owner, acceptance criteria and what it blocks | Owner sign-off per IC | IC |
| AG-0.6 | Decide the v1 scope and the open decisions this plan waits on: KD-1, KD-2, KD-6, KD-9, KD-10, KD-11 and the proposed KD-12 | Blocked | Owner (KD-6, KD-9, KD-10, KD-11, KD-12); engineering leads (KD-1, KD-2) | The decisions themselves | Each KD has a closing record in `BACKEND_CHECKLIST.md` K.3 | Recorded answers | ARCH §2, §9 |
| AG-0.7 | Fix the integration base: `Ai` is 312 behind `main` and lacks `docs/multi-hospital/` | Done | Owner + AI | Formerly AIQ-08, resolved for `Ai` on 2026-10-10 with the owner's authorization | `Ai` contains `main` and the canonical folder; AI task branches cut from it | Verified 2026-10-10. Fast-forward `3f0436e` → `033e1d8`, without force. PR #51 (merge `c4e07d5`) brought in the shared docs: `docs/multi-hospital/` tree `df82856`, `docs/work-phases/` tree `da384c5`. PR #52 (merge `ddbaa75`) brought in these seven documents. `git rev-list --left-right --count origin/main...origin/Ai` = 0/5, and all five are documentation commits. This records branch and documentation synchronization only: no AI implementation exists, and no AG-1…AG-9 item changes status. Not part of this item: `backend` has since revised four shared multi-hospital docs (PR #53), so `Ai` held the earlier revision until it re-synced them from `backend` at `1f28d2e` on 2026-10-10 (ARCH §1.1) | ARCH §1.1, §9 |
| AG-0.8 | Unify the two patient-assistant plans into this one (owner decision, 2026-10-10) and propagate: CA-1…CA-13 adopted by their owners on `backend`; the shared docs reach `main` | In Review | AI (coordinates) + Backend + Database + Patient App | Review of the reconciliation PR into `Ai`; Backend and Database leads for CA-* | One task vocabulary (`AG-*`), one decision register (KD-\*), one booking contract (§10.2), one intent store (I2); `AIA-*` only as aliases | `git merge-tree` of `Ai` against `backend` is free of conflicts in `docs/multi-hospital/` and `docs/work-phases/` while each branch carries the other's owner revision: `backend`'s four Backend-owned files on `Ai` (re-synced 2026-10-10 at `1f28d2e`) and `Ai`'s seven AI files on `backend`. An AI-doc change on `Ai` conflicts until its sync to `backend` merges. Each CA's state is in `AI_INTEGRATION_CONTRACTS.md` §CA | §6.10; IC §CA |
| AG-0.9 | Patient-assistant ADR; the number is allocated only after the register sweep in `CLAUDE.md` | Not Started | Architecture + AI | KD-1, KD-2 and KD-6 answered | The ADR records those answers and the §10.2 contract | ADR merged | ARCH §9 |

### 6.1 Phase 1 — Model and AI architecture

| ID | Task | Status | Team | Depends on / blocking reason | Acceptance criteria | Verification & evidence | Docs |
|---|---|---|---|---|---|---|---|
| AG-1.1 | Architecture document | In Review | AI | Owner review | Components, principles, routing, open decisions documented | This file set | ARCH |
| AG-1.2 | Decide where the agent code lives, its branch model, and how it authenticates to the Backend | Blocked | Backend lead + AI engineer; owner for a new credential type or patient capability | KD-1 | A recorded decision honouring U5 | ADR (AG-0.9) | ARCH §3.3 |
| AG-1.3 | Provider evaluation harness: runs EVAL scenarios against any adapter; records versions, usage, latency and cost | Not Started | AI | AG-1.2 (where it lives); AG-8.1 (scenarios); IC-01 types | One command produces a report for a given model id | Report artifact stored with the run id | ARCH §4.3; EVAL §1 |
| AG-1.4 | Run the provider evaluation on the shortlist | Not Started | AI | AG-1.3; provider test accounts and keys (owner); budget approval | A report per candidate with C1–C7 scores and terms excerpts dated | Stored reports; raw outputs | ARCH §4.3 |
| AG-1.5 | Approve a provider (and an optional fallback) with its data-handling record, spending and DPA | Blocked | Owner | KD-10; AG-1.4 | Approval recorded with the model id, region and retention settings | Signed decision | ARCH §4.3 |
| AG-1.6 | Extend the gateway port: tools, structured output, stop reasons, usage | Blocked | Backend + AI | IC-01 owner authorization (backend kernel code) | Doctor `/ai/*` tests unchanged and green. Adapter contract suite defined | Backend suite CI run | IC-01 |
| AG-1.7 | Provider adapter with timeouts, bounded retries, a circuit breaker and abort | Blocked | AI + Backend | AG-1.5, AG-1.6 | Passes the adapter contract suite including the fault cases | CI run; EV-F* results | ARCH §4.2 |
| AG-1.8 | Configuration: new env vars validated at boot; key server-only and never logged | Blocked | Backend + AI | AG-1.6 | Boot fails on invalid config. `env.spec.ts` covers the new vars. No key in logs | Backend suite | ARCH §4.2 |

### 6.2 Phase 2 — Healthcare knowledge and data

| ID | Task | Status | Team | Depends on / blocking reason | Acceptance criteria | Verification & evidence | Docs |
|---|---|---|---|---|---|---|---|
| AG-2.1 | Data and knowledge strategy | In Review | AI | Owner and clinical review | K1–K5 separated, RAG and provenance defined | DATA | DATA |
| AG-2.2 | Name the clinical content owner | Blocked | Owner | KD-9 | A named person recorded in `patient-app/docs/SIGNOFF.md` and here | Register entry | DATA §2.3 |
| AG-2.3 | Select sources and verify each licence | Blocked | AI + clinical owner | AG-2.2 | A source register with the verified licence, verifier and date per source | The register file | DATA §2.2 |
| AG-2.4 | Corpus format and front-matter validator | Not Started | AI | AG-1.2 (location) | The build fails on a missing provenance or review field. Only `approved` documents are indexed | Unit tests; CI run | DATA §2.3 |
| AG-2.5 | Ingestion: chunking, Arabic normalization, BM25 index artifact | Not Started | AI | AG-2.4 | Deterministic index build. Normalization unit tests for alef forms, ى and ة, diacritics, tatweel and digits | Unit tests | DATA §2.4 |
| AG-2.6 | Retrieval evaluation set and measurement | Not Started | AI + clinical owner | AG-2.5; approved documents (AG-2.3) | recall@5 ≥ 0.85; refusal precision ≥ 0.95 | Eval report | DATA §2.7; EVAL §5 |
| AG-2.7 | Freshness and update procedure in CI (past-due documents de-indexed) | Not Started | AI | AG-2.4 | The CI check lists past-due documents and the build excludes them | CI run | DATA §2.6 |
| AG-2.8 | Fine-tuning | Deferred | AI | Not justified; the gate is documented | A proposal exists only if it meets all six gate conditions | — | DATA §6 |

### 6.3 Phase 3 — Agent and tools

| ID | Task | Status | Team | Depends on / blocking reason | Acceptance criteria | Verification & evidence | Docs |
|---|---|---|---|---|---|---|---|
| AG-3.1 | Tool contracts | In Review | AI | Backend review of each mapping | Every tool has input, output, auth, errors, side effects, confirmation and tests | TOOL | TOOL §2 |
| AG-3.2 | Tool registry: patient tools only; Zod validation; principal injection; dependency-zone lint; containment spec extended | Blocked | AI | AG-1.2; IC-02 module | Rules T-R1…T-R6 enforced by tests | Backend suite CI run | TOOL §1 |
| AG-3.3 | Agent orchestrator: bounded loop (rounds, calls, deadline, tokens); refusal and fault handling | Blocked | AI | AG-1.6, AG-3.2 | T-R9 bounds hold. Faults produce localized safe messages | Unit and integration tests; EV-F* | ARCH §3 |
| AG-3.4 | `list_specialties` over `GET /patient/specialties` | Blocked | AI | AG-3.2 | TOOL §2.1 tests | CI; EV-T01…T04 | TOOL §2.1 |
| AG-3.5 | `search_doctors` over `GET /patient/doctors` | Blocked | AI | AG-3.2 | TOOL §2.2 tests | CI; EV-T05…T10 | TOOL §2.2 |
| AG-3.6 | `get_doctor_details` over `GET /patient/doctors/:id` | Blocked | AI | AG-3.2 | TOOL §2.3 tests | CI; EV-I02 | TOOL §2.3 |
| AG-3.7 | `get_my_appointments` over `GET /me/appointments[/:id]` | Blocked | AI | AG-3.2 | TOOL §2.6 tests; PN-03 | CI | TOOL §2.6 |
| AG-3.8 | `search_hospitals`, `get_hospital_details` | Blocked | AI | IC-03: no `Hospital` model (Database Phase 21) and no hospital API (Backend Phase 23) | TOOL §2.4 tests | CI; N-19…N-22 | TOOL §2.4 |
| AG-3.9 | `get_available_slots` | Blocked | AI | IC-04: no `PublishedSlot` (Phase 24) | TOOL §2.5; working hours never shown | CI | TOOL §2.5 |
| AG-3.10 | Re-point `search_doctors` to `/patient/discovery/search` (hospital, distance, next slot, insurance) | Blocked | AI | IC-03 (Phase 23) | OD-10 fields come only from the API. The uninsured are unfiltered (OD-14) | CI; N-20, N-21 | TOOL §2.2 |
| AG-3.11 | Conversation behaviour: ask for what the next tool call needs before searching; compare only on values present in tool results and call a `null` field unknown; show times in the slot's own zone | Blocked | AI | AG-3.3; AG-3.9 for slots; KD-8 for the zone | EV-M clarification threshold met; zero compared values absent from tool results | Eval report (EV-M, EV-H) | TOOL §2; ARCH §6 |

### 6.4 Phase 4 — Real booking and appointment management

| ID | Task | Status | Team | Depends on / blocking reason | Acceptance criteria | Verification & evidence | Docs |
|---|---|---|---|---|---|---|---|
| AG-4.1 | Decide the confirmation mechanism; propose-then-confirm on §10.2 intents is the recommended option (resolves patient-app K-06 vs P-AI-3) | Blocked | Backend lead + AI engineer + Patient App lead; owner acknowledges (CA-6) | KD-2 | KD-2 closing record in K.3 | Decision record; ADR (AG-0.9) | ARCH §6 |
| AG-4.2 | Intent storage: the one store is `DATABASE_CHECKLIST.md` I2 (the earlier `ai_action_proposals` is retired); its extra fields and states are CA-1, CA-11 | Blocked | Database + Backend | KD-2; IC-07; AG-4.1 | Schema reviewed by Database. `db:check` green. No second proposal store exists | Database PR | IC-07; IC §CA |
| AG-4.3 | `propose_appointment` tool (§10.2 prepare) and the `intent_prepared` event | Blocked | AI | AG-4.2, AG-3.9, IC-05; Backend AST-D7 | TOOL §2.7. The summary comes from DB rows, never model text | CI | TOOL §2.7 |
| AG-4.4 | Confirm and discard per §10.2 (patient app only; no tool): verify, book with the client key and the intent-derived key, read back; the assistant learns the result through `get_intent` | Blocked | Backend (routes, AST-D7) + AI (`get_intent`, result reporting) | IC-05 (no `POST /me/appointments`, no idempotency implementation, no DB double-booking guard: AF-11); Backend AST-D1, AST-D7, AST-D8; CA-2…CA-4 | B-1…B-10 | e2e CI run | TOOL §2.8a, §2.9, §4 |
| AG-4.5 | Uncertain-outcome reconciliation (`UNKNOWN` → replay or read) | Blocked | AI + Backend | AG-4.4 | B-6. Never "booked" before verification | Fault-injection test | ARCH §6 |
| AG-4.6 | `propose_cancellation` | Blocked | AI | KD-3 (ADR-033 is Proposed and chooses no policy); IC-06; Backend AST-D4 | TOOL §2.8; reason mandatory | CI; EV-C* | TOOL §2.8 |
| AG-4.7 | `propose_reschedule` | Blocked | AI | KD-3; IC-06; Backend AST-D5 | TOOL §2.8 | CI; EV-C* | TOOL §2.8 |
| AG-4.8 | Concurrency: two patients, one slot; duplicate confirms | Blocked | AI + Security | AG-4.4; G-6 | Exactly one booking (B-3, B-4) | e2e CI run | TOOL §4 |

### 6.5 Phase 5 — Multi-hospital support and data isolation

| ID | Task | Status | Team | Depends on / blocking reason | Acceptance criteria | Verification & evidence | Docs |
|---|---|---|---|---|---|---|---|
| AG-5.1 | Patient authorization for `/me/assistant/*` (patients hold zero capabilities) | Blocked | Backend + AI | Backend AST-E2; KD-1; IC-02 | A-1, A-2 | PN-01, PN-02 | SAFE §5 |
| AG-5.2 | Conversation ownership as a WHERE clause; 404-not-403 | Blocked | AI + Backend | AG-5.1; IC-07 | A-3 | PN-04 | SAFE §5 |
| AG-5.3 | No identity or authorizing hospital in tool arguments | Blocked | AI | AG-3.2 | A-4, A-7 | PN-05, PN-09 | TOOL T-R1 |
| AG-5.4 | No cross-user state: no shared tool caches, no long-term memory, per-conversation context only | Blocked | AI | AG-3.3 | A-8 | PN-10 (concurrent conversations) | SAFE §5 |
| AG-5.5 | Discovery isolation inherited from the API (active employment, verified) | Blocked | Backend | Phases 22, 23 | A-9 | PN-11 | SAFE §5 |
| AG-5.6 | Staff cannot read patient assistant transcripts | Blocked | Database + Backend | `DATABASE_CHECKLIST.md` I3 (separate tables recommended, CA-11); KD-6 | A-11 | PN-13 | SAFE §5 |
| AG-5.7 | Metadata-only logging for the patient agent (tool names, rounds, usage, safety events) | Blocked | AI | AG-3.3 | No prompt, completion, argument or result text in any log line | Unit test on the log recorder | SAFE §8 |

### 6.6 Phase 6 — Patient experience integration

| ID | Task | Status | Team | Depends on / blocking reason | Acceptance criteria | Verification & evidence | Docs |
|---|---|---|---|---|---|---|---|
| AG-6.1 | Client contract: routes and SSE events | In Review | AI + Patient App + Backend | Owner review | Event list agreed by Patient App | Sign-off on IC-02 | IC-02 |
| AG-6.2 | Patient app adapter (SSE, abort → `stopped`) replacing "not connected"; renders loading, timeout, rate-limited and unavailable states | Blocked | Patient App | AD-4; IC-02; G-P (KD-12, proposed); relaxing `ai-honesty.test.ts` is Patient App's decision | K-02 green against the real endpoint | Patient-app suite | IC-08 |
| AG-6.3 | Confirmation card, result states, expiry | Blocked | Patient App | AG-4.4 | B-9; no booking without a tap (acceptance step 5) | Patient-app tests; e2e | IC-08 |
| AG-6.4 | Server-persisted history (K-07), patient delete | Blocked | Patient App + Backend | KD-6; `DATABASE_CHECKLIST.md` I3; IC-07 | Nothing stored on the device | `ai-honesty.test.ts` storage assertions stay | IC-08 |
| AG-6.5 | Arabic and English; RTL; localized tool status and errors | Blocked | Patient App + AI | AG-6.2; IC-09 for names | EV quality rubric ≥ 4.0 per language | Eval report; RTL snapshots | EVAL §5 |
| AG-6.6 | Emergency event rendered before any text | Blocked | Patient App | AG-7.2 | SSE order verified | e2e; acceptance step 11 | SAFE §2 |
| AG-6.7 | Patient web client | Deferred | — | No patient web client exists (`frontend/` is doctor/admin) | — | — | ARCH P0-12 |
| AG-6.8 | Keep staff AI separate | Not Started | AI + Frontend | — | No shared route, prompt, tool set or conversation table between `/ai/*` and `/me/assistant/*` | Code review; registry test | ARCH §3.2 |

### 6.7 Phase 7 — Healthcare safety and security

| ID | Task | Status | Team | Depends on / blocking reason | Acceptance criteria | Verification & evidence | Docs |
|---|---|---|---|---|---|---|---|
| AG-7.1 | Safety and security document | In Review | AI + Security | Owner and clinical review | S-1…S-13 each with a primary control | SAFE | SAFE |
| AG-7.2 | Server-side red-flag gate (lexicon and classifier), degrading toward safety | Blocked | AI | AG-1.6 (classifier); production needs clinical sign-off (AG-2.2) | Red-flag recall 100% on EV-S | Eval report | SAFE §2 |
| AG-7.3 | Output validator: action claims, diagnosis language, citations, URLs, phone numbers, fabricated ids | Blocked | AI | AG-3.3 | Zero false action claims, fabrications or diagnosis language reaching the patient | Unit tests; EV-X*, EV-H* | SAFE §6 |
| AG-7.4 | Prompt-injection handling (delimited untrusted blocks) | Blocked | AI | AG-3.3 | EV-I* pass; no action or scope change | Eval report | SAFE §4 |
| AG-7.5 | Rate limits and cost controls; circuit breaker | Blocked | AI + Backend | IC-11 (AF-20: no throttler); Backend AST-G1; KD-7; AG-3.3 | The limits in SAFE §7 hold | Load test; unit tests | SAFE §7 |
| AG-7.6 | Audit events for intents and confirmations | Blocked | Backend + AI | IC-12; Backend AST-D10, AST-E7; AG-4.4 | Every state change audited, metadata only | e2e | SAFE §8 |
| AG-7.7 | Retention, minimization and redaction for patient conversations | Blocked | Owner + Backend | KD-6 | The policy is implemented and tested | e2e | SAFE §8 |
| AG-7.8 | Disclaimer and limitation copy clinically reviewed | Blocked | Owner (clinical) | KD-9; L-04, W-10 | A signed entry in the sign-off register | Register | SAFE §3 |

### 6.8 Phase 8 — Evaluation and testing

| ID | Task | Status | Team | Depends on / blocking reason | Acceptance criteria | Verification & evidence | Docs |
|---|---|---|---|---|---|---|---|
| AG-8.1 | Eval suite v0: scenarios EV-G…EV-X in Arabic and English, with synthetic fixtures | Not Started | AI | AG-1.2 (location); EV-S needs clinical review before it counts | The minimum counts in EVAL §3 are met, and every scenario passes the schema check | Suite file count and schema check in CI | EVAL §2–3 |
| AG-8.2 | Harness: scoring, metrics, report with versions | Not Started | AI | AG-8.1; AG-1.3 | The metrics in EVAL §4 are computed from a run | Report artifact | EVAL §4 |
| AG-8.3 | Approve the thresholds before the first measured run | In Review | Owner | Owner | The thresholds are frozen with a date | Recorded approval | EVAL §5 |
| AG-8.4 | Negative test specs PN-01…PN-13 | Blocked | AI + Security | AG-5.* | 100% pass | CI run | EVAL §8 |
| AG-8.5 | Per-release evaluation report | Not Started | AI | AG-8.2, AG-1.5 | The report follows EVAL §9 | Stored report | EVAL §9 |

### 6.9 Phase 9 — Final integration and acceptance

| ID | Task | Status | Team | Depends on / blocking reason | Acceptance criteria | Verification & evidence | Docs |
|---|---|---|---|---|---|---|---|
| AG-9.1 | Gate G-P adopted | Blocked | Owner | KD-12 (registered in K.3 as open and proposed, `backend` PR #57) | The gate is recorded as canonical | Decision record | EVAL §6 |
| AG-9.2 | End-to-end acceptance on two-hospital staging (steps 1–11) | Blocked | All | Phases 21–24; AG-4.*; AG-6.*; AG-1.5 | Every step has evidence | Evidence pack | EVAL §7 |
| AG-9.3 | Setup and environment-variable documentation | Not Started | AI | AG-1.8 | A new developer can run the agent locally against a test provider configuration | Walkthrough by a second person | ARCH §4.2 |
| AG-9.4 | Final evidence pack: architecture, contracts, eval results, test evidence, open dependencies | Not Started | AI | AG-9.2 | Complete and linked from this checklist | — | all |
| AG-9.5 | Operations: monitoring (latency, tool error codes, 429s, refusals, red-flag triggers; metadata only); a server-side switch that turns the assistant off (503) without a deploy; rollback of prompts and model version | Not Started | AI + Backend | AG-3.3; Backend AST-G6 | The switch is tested; dashboards hold no PHI | Runbook; switch test | SAFE §7 |

**What is buildable before any other team delivers.** Once KD-1 is answered (formerly AIQ-08 was resolved
for `Ai` on 2026-10-10), these need nothing new from Backend, Database or Patient App:

- AG-1.3 (harness);
- AG-2.4 to AG-2.5 (corpus tooling);
- AG-8.1 to AG-8.2 (eval suite and harness);
- the four read tools AG-3.4 to AG-3.7, once IC-01 and IC-02 land.

Everything that books, cancels, reschedules or compares hospitals waits on Phases 21–24 and ADR-033.

### 6.10 Reconciliation record (2026-10-10)

The owner decided to unify the `Ai` plan (this §6) and the `backend` plan of PR #53. The owner approved
the unification, **not** the decisions underneath it. What was decided by the reconciliation itself:

| Topic | Outcome | Where |
|---|---|---|
| Task vocabulary | `AG-*` canonical; `AIA-*` aliases only (§6.12) | this file |
| Decision vocabulary | One register, KD-\* in `BACKEND_CHECKLIST.md` K.3. AIQ-01…AIQ-10 retired and mapped; nothing resolved by the mapping. One new decision proposed: KD-12 (gate G-P) | `AI_ARCHITECTURE.md` §9; CA-8 |
| Booking contract | One: the appointment intent of `API_CONTRACT_CHANGES.md` §10.2. The `/me/assistant/actions/…` confirm and decline routes are retired | `AI_TOOLING_AND_BOOKING.md` §2.9; IC-02 |
| Storage | One intent store, `DATABASE_CHECKLIST.md` I2. `ai_action_proposals` retired | IC-07; CA-11 |
| Kept from the `Ai` plan | `unknown` state with server-side reconciliation, read-back verification, intent-derived booking key, `propose_*` tool names, provider criteria C1–C7, gate G-P, data categories K1–K5 | CA-1…CA-3; TOOL; ARCH §4.3; EVAL §6; DATA |
| Kept from the `backend` plan | KD register and its owners, §10 contract and error codes, rules U5 and U6, the sign-in rule (U8, from `BACKEND_CHECKLIST.md` K.0 rule 5), the integration-readiness gate, the Patient App traceability of PR #54 | rules U1–U8; K.3; §10 |
| Still open | KD-1, KD-2, KD-3, KD-4, KD-5, KD-6, KD-7, KD-8, KD-9, KD-10, KD-11, and the proposed KD-12. None is treated as approved | `BACKEND_CHECKLIST.md` K.3 |

### 6.11 Tool names

The tool names, their §10.3 capabilities and their Backend routes are tabulated once, in
`AI_TOOLING_AND_BOOKING.md` (header table). `prepare_booking` in earlier `backend` text is
`propose_appointment`; `confirm_booking` is the patient app's confirm and is **not** a tool.

### 6.12 Alias map: `AIA-*` → `AG-*`

`AIA-*` were the task IDs of the `backend` plan. They are **retired as tasks**. Their owners have
replaced them (CA-10): `BACKEND_CHECKLIST.md` §K, `API_CONTRACT_CHANGES.md` §10 and Phase 28 on
`backend` (PR #57), and the patient-app traceability table (PR #61). The map stays so that "formerly
AIA-…" notes and older records still resolve. Status, owner and acceptance are those of the AG item.

| Alias | Canonical item(s) |
|---|---|
| AIA-A1 | AG-0.6 |
| AIA-A2 | AG-1.1 |
| AIA-A3 | AG-1.2 |
| AIA-A4 | AG-1.3, AG-1.4, AG-1.5 |
| AIA-A5 | AG-1.1, rule U1 |
| AIA-B1 | AG-2.1 |
| AIA-B2 | AG-2.2, AG-2.3 |
| AIA-B3 | AG-2.5, AG-2.6 (release depends on KD-11) |
| AIA-B4 | AG-8.1 |
| AIA-B5 | AG-2.8 |
| AIA-B6 | AG-7.7 |
| AIA-C1 | AG-3.8 |
| AIA-C2 | AG-3.8 |
| AIA-C3 | AG-3.5, AG-3.10 |
| AIA-C4 | AG-3.6 |
| AIA-C5 | AG-3.9 |
| AIA-C6 | AG-3.7 |
| AIA-C7 | AG-3.7 |
| AIA-C8 | AG-4.3 (`prepare_booking` is now `propose_appointment`) |
| AIA-C9 | AG-4.4 (confirm is not a tool; `get_intent` reads the result) |
| AIA-C10 | AG-4.7 |
| AIA-C11 | AG-4.6 |
| AIA-C12 | AG-3.2, AG-3.3 |
| AIA-D1 | AG-3.11 |
| AIA-D2 | AG-3.11 |
| AIA-D3 | AG-3.11 |
| AIA-D4 | AG-4.3 |
| AIA-D5 | AG-4.3, rule U3 |
| AIA-D6 | AG-4.4, AG-4.5, rule U4 |
| AIA-D7 | AG-4.4 |
| AIA-D8 | AG-4.6, AG-4.7 |
| AIA-D9 | AG-7.3 |
| AIA-E1 | AG-7.3, AG-7.8 |
| AIA-E2 | AG-7.2, AG-6.6 |
| AIA-E3 | AG-7.1 |
| AIA-E4 | AG-7.8, AG-2.2 |
| AIA-E5 | AG-3.2, rule U1 |
| AIA-E6 | AG-7.4, AG-8.4 |
| AIA-E7 | AG-5.4, AG-5.7, AG-7.3 |
| AIA-F1 | AG-6.1 |
| AIA-F2 | AG-5.1, rule U5 |
| AIA-F3 | AG-6.2 |
| AIA-F4 | AG-6.3 |
| AIA-F5 | AG-6.3, rule U4 |
| AIA-F6 | AG-6.4 |
| AIA-F7 | AG-6.8 |
| AIA-G1 | AG-8.2 |
| AIA-G2 | AG-6.5, AG-8.1 |
| AIA-G3 | AG-8.1 |
| AIA-G4 | AG-8.1 |
| AIA-G5 | AG-8.1, AG-7.3 |
| AIA-G6 | AG-4.8, AG-8.1 |
| AIA-G7 | AG-8.4 |
| AIA-G8 | AG-7.4 |
| AIA-G9 | AG-7.2 |
| AIA-G10 | AG-8.1 |
| AIA-G11 | AG-8.4 |
| AIA-G12 | AG-8.5 |
| AIA-H1 | rule U6, AG-9.2 |
| AIA-H2 | rule U6, AG-9.2 |
| AIA-H3 | AG-9.2 |
| AIA-H4 | AG-9.3, AG-1.8 |
| AIA-H5 | AG-9.5 |
| AIA-H6 | AG-9.1, AG-9.2 |

## 7. Claim discipline

Medora does **not** have a functioning AI agent. This holds until all of the following are
demonstrated with evidence:

- AG-1.7 (a real provider);
- AG-3.3 to AG-3.7 (authorized tools);
- AG-4.4 (verified booking);
- AG-7.2 and AG-7.3 (safety controls);
- AG-9.2 (end-to-end acceptance).

Status reports must say which of these are met.
