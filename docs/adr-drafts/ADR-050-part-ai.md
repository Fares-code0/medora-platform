# ADR-050 (part: Patient AI) — Patient assistant: general and personalized experiences

**Status:** Draft for the coordinator to merge into `docs/DECISIONS.md` under ADR-050
(Patient-facing information layer and Patient AI). Implemented on the backend; generation is
**blocked** until a provider is configured (see Blockers).
**Date:** 2026-11-26
**Scope:** `backend/src/modules/ai` (patient files only), migration
`20261126120000_patient_ai`. The clinician assistant (`/ai/conversations`, ADR/M16) is unchanged
except for one defence-in-depth filter (below).

## Context

The owner decided (2026-11-26, decision 7) that patients get an AI assistant in two separate
experiences, that the provider is unconfigured today and must answer honestly, that patients get
**no** `ai.use` permission and never reach the clinician routes, and that results stay unexposed
because ADR-031 (results release policy) is not approved.

## Decision

### 1. Two experiences, fixed at creation

| | `general` | `personal` |
|---|---|---|
| Purpose | Patient education, terminology, appointment preparation, app guidance | The same, plus the caller's own appointments, lab **test status** and insurance on file |
| Patient data loaded | **None, ever.** The prompt builder takes no context argument. | Only the patient-facing layer (§3), re-read from the session **every turn** |
| Needs a linked record | No | Yes — `409 patient_not_linked` on create and on send |
| Audit of context read | — | `patient_ai.context.read`, metadata counts only |

`POST /me/ai/conversations { mode }` fixes the mode; there is no route that changes it.

### 2. Isolation boundaries

- **Separate surface.** `PatientAiController` (`/me/ai/conversations`), `PatientAiService`,
  `PatientAiContextService`, `PatientAiConversationRepository`, `PatientAiContextRepository` and
  their own prompts. Nothing of the clinician prompt, context resolver or settings routes is used,
  except `titleFromMessage` and the read of the caller's AI language setting.
- **Patient-only.** `@Authenticated()` (a patient holds zero capabilities, ADR-030 §6); the service
  refuses any role other than `patient` with **403 `patient_only`** before touching a row.
- **Owner-only.** Every read and write is keyed on `owner_id = caller`; another patient's thread, a
  clinician's thread and an unknown id all answer **404**.
- **Clinician and patient threads are mutually invisible.** Patient threads carry
  `patient_mode IS NOT NULL` and every patient query requires it; the clinician repository's `LIVE`
  filter now also requires `patient_mode IS NULL` (the one change to clinician code — a narrowing
  filter; all clinician tests stay green). Patients without `ai.use` get 403 on `/ai/*`.
- **Persistence.** Reuses `ai_conversations` / `ai_messages`:
  - `ai_conversations.patient_mode varchar(16)` — NULL for clinician threads, `general` | `personal`
    for patient threads. A CHECK (`ai_conversations_patient_mode_check`) requires a patient thread to
    have `context_mode = 'general'` and **no** `patient_id`, `hospital_id`,
    `hospital_medical_record_id` or `ref_public_id`. The personal context is never bound to the row;
    it is resolved from the session through `PatientSelfScopeService` each turn, so an account
    unlinked after the thread was opened stops getting personal answers immediately.
  - `ai_messages.escalated boolean NOT NULL DEFAULT false` — the red-flag answer.
  - A varchar + CHECK rather than a new enum value, so the `ai_context_mode` vocabulary served by
    `/meta/enums` and mirrored by the frontend does not change.
  - RLS: the existing owner-only policies apply unchanged (patient threads have no patient id).

### 3. Data allowed in personal mode (contract §4)

Read directly with Prisma in `patient-ai-context.repository.ts` (read-only; covered by
`ai-containment.spec.ts`), with explicit selects:

- **Appointments** (20 most recent by start): public id, start, duration, status (wire value),
  visit type, department, doctor name and specialty, hospital name. **Not** `reason` / `notes`
  (they may be patient-typed text).
- **Lab orders** (20 most recent, `hospital_id` not null, not soft-deleted): public id, test name,
  category, specimen type, status mapped `ORDERED→awaiting_collection`,
  `COLLECTED|PROCESSING→in_progress`, `COMPLETED→completed`, `CANCELLED→cancelled`, requested /
  collected / completed dates, hospital name, and the fixed marker
  `results: "not available: release policy pending"`. **Never** clinical indication,
  interpretation, results, flags, `has_critical_result`, reviewer, ordering-doctor notes.
- **Insurance on file**: provider name, plan, valid-until, active — **no policy number** —
  and `authorizations: "not available: workflow undecided"` (ADR-039 item 5).

Never: medical records, notes, diagnoses, prescriptions/medications, results, other patients.

### 4. Prompt-injection hardening

- The data sits in one `<patient_facing_data>` … `</patient_facing_data>` block, one JSON object per
  line, each with `source` and `date`. Values are `JSON.stringify`-escaped and `<` / `>` are
  escaped, so no stored value can close the block or open a fake one.
- The prompt states that the block is data, not instructions, and that nothing in the conversation
  can change it.
- **Patient-typed text never enters the system prompt** — it travels only as `user` turns; the
  builder has no parameter for it.
- The prompt states explicitly what is **unavailable** (results, interpretation, reason for a test,
  records, notes, diagnoses, prescriptions, insurance decisions — release policy pending) and that
  "completed" means the lab work finished, not that a result was released or is normal.

### 5. Red-flag escalation (deterministic, before the model)

`patient-ai-red-flags.ts` normalises the message (NFKC, lower-case, Arabic diacritics/tatweel
removed, أ/إ/آ/ٱ→ا, ى→ي, ة→ه, ؤ→و, ئ→ي, punctuation→space) and matches English regexes and Arabic
phrases (substring, because Arabic attaches prefixes) in eight categories: chest pain, stroke
signs, severe breathing difficulty, suicidal ideation / self-harm, severe bleeding, anaphylaxis,
loss of consciousness / seizure, poisoning / overdose.

On a match: the user turn and a **fixed** assistant answer (`en` or `ar`, from the request
`locale`, else the user's AI language setting, else `en`) are persisted with `escalated: true`; the
gateway is **not** called; the stream is one `delta` with the text and `done` with
`escalated: true`. The check runs **before** the configuration check, so escalation works on a
deployment with no provider. The copy tells the person to contact local emergency services now or
use the app's Emergency screen; it contains **no phone number** (numbers vary by country; none is
invented). The matched category is not logged or audited (it is itself health data); the
transcript log records `outcome: escalated` only.

**Known false-negative limits:** misspellings beyond the normalisations, unlisted dialect
phrasings, Arabizi / transliterated Arabic, other languages, indirect descriptions ("he went grey
and collapsed" — partially covered), and a description split across messages. Negation is not
parsed, deliberately: "no chest pain" escalates (false positive preferred). This is a safety floor,
not triage.

### 6. Provider, streaming, limits

- Unconfigured gateway (`describe().configured === false`, the production binding today) →
  **503 `service_unavailable`** before anything is written or any context is read. No output is
  fabricated; a fake gateway exists only in tests.
- A configured gateway that fails mid-stream finishes the message as `error` exactly like the
  clinician path; client disconnect → `stopped`.
- SSE frames: `event: delta` / `data: {"text": "…"}` …, then `event: done` /
  `data: {"messageId","status","error","escalated"}`.
- Fixed temperature 0.3, 1 000 output tokens, 20-turn window; content 1–2 000 characters.
- Sends are `@RateLimited('patient_ai')` — a new bucket with its own counter, same
  `RATE_LIMIT_AUTH_*` max/window, effective only when `RATE_LIMIT_ENABLED`.
- Transcript log: metadata only (`contextMode: patient_general | patient_personal`).
- Audit: `patient_ai.conversation.create` / `.delete`, `patient_ai.context.read` (counts), all
  classified `user_action`.

## Blockers (not resolved by this ADR)

1. **No provider configured.** Generation needs `AI_PROVIDER` / `AI_API_KEY` and a provider
   adapter in `shared/ai`, **and** a data-processing agreement with the provider per OD-11
   (DR-13) before any patient text — let alone personal context — leaves the platform.
2. **Clinical sign-off** of the escalation copy (en and ar) and of the red-flag phrase lists.
3. **Results / record explanations are blocked by ADR-031** (release policy not approved). The
   personal mode must keep stating they are unavailable until it is accepted; no release column
   exists and none was invented.
4. Insurance authorization status is blocked by ADR-039 item 5 (state machine undecided).

## Consequences

- One table pair serves both assistants; the separation is enforced by a column, a CHECK and two
  mutually exclusive query filters, and is tested in both directions (`test/patient-ai.e2e-spec.ts`).
- The personal context is always current and never persisted on the thread; each turn costs three
  indexed reads plus an audit row.
