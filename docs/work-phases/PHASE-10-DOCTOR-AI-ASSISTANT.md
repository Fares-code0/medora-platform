# Phase 10 — Doctor AI Assistant

> **Historical record — not a task register** (labelled 2026-10-26). This file records a past phase as it was planned and built. Its Status line, task boxes and tables are not kept current, and nothing here is status. Open frontend work is tracked only in [`frontend/FRONTEND_CHECKLIST.md`](../../frontend/FRONTEND_CHECKLIST.md) §13 (doctor/admin web) and [`docs/multi-hospital/CLIENTS_CHECKLIST.md`](../multi-hospital/CLIENTS_CHECKLIST.md) (multi-hospital WEB/PA tasks); backend, database and AI items named here are tracked in those domains' own records. Where this file disagrees with them, they win.

**Original Source:** `frontend/PHASE10_AI_ASSISTANT.md`
**Primary Area:** Frontend + AI
**Status:** PARTIALLY COMPLETED — the frontend surface and seam are complete; replies are still canned; the backend AI module exists but is not wired
**Depends On:** Phases 04, 06, 07, 08
**Enables:** Phase 28

> **Numbering collision:** this is *executed* Phase 10. "FE-10" in
> `docs/FE-10-INTEGRATION-STATUS.md` is a different thing: the *planned* Phase 10
> "Backend integration" from `FRONTEND_ARCHITECTURE.md` §13.1. See
> `FE-PHASE-E-LIVE-API-INTEGRATION-FE-10.md`.

---

## Objective

Build the doctor AI assistant at `/doctor/ai`. It has an AI dashboard, a chat
workspace with simulated streaming, and context modes grounded in patient,
record, labs and pharmacy (`?context=…&patientId=&refId=`). It also has local
conversation history and assistant settings. There is no real AI.

## Scope (original)

Chat state machine (idle → thinking → streaming, stop, retry, regenerate), a
markdown renderer, a prompt library, conversation CRUD over localStorage, a
settings drawer, "Ask AI" entry points from four modules, and the
provenance / disclaimer rule.

## Out of Scope

A real model, backend, new packages.

## Current Status

**PARTIALLY COMPLETED.** The UI and the seam are done (D-09 frontend half). The
product's purpose, a real clinical assistant, is not delivered: every reply is
canned and labelled as demo output.

## Current State

**Completed work**
- `features/doctor/ai/` with `service.ts` as the only door. `service.test.ts`
  asserts that nothing reaches past the seam and that every reply carries the
  demo disclaimer.
- The `aiAssistant` feature flag was removed. The module is gated by the
  `ai.use` permission in all three entry points (D-08).

**Remaining work**
- **Backend now serves `/ai/*`** (FE-10 finding F40). The backend has
  conversation, message and settings controllers, a context
  repository/service, a prompt builder, and `ai-containment.spec.ts` (the M16
  provider-SDK and no-clinical-write containment). The web client is **not**
  wired to it (FE-10 Still Mock row 4).
- No model provider decision is recorded in the frontend docs.
- Multi-hospital (final owner decisions, 2026-10-07; DR-12 = OD-05):
  - AI context comes from the current hospital's Medical Record by default.
  - Cross-hospital data may be used **only** while a valid approved grant (or valid
    Break-Glass, OD-04) covers the category or scope and the clinical purpose is active.
  - When the grant or Break-Glass window ends, the AI loses access and **retains
    nothing** (no memory, RAG/vector copy, profile context or training).
  - Doctor-reviewed, doctor-approved content may be saved into the current hospital's
    record with provenance (OQ-01 = A); the AI may help draft it.
  - Owned by **Phase 28**.

## Tasks

- [x] [FRONTEND] Chat workspace, context modes, history, settings, provenance
- [x] [FRONTEND] Service seam (D-09 frontend half)
- [ ] [FRONTEND] HTTP adapter for `/ai/*` behind the seam — Phase 28
- [ ] [AI] [BACKEND] Model provider adapter (after gate G-5) and hospital-scoped context assembly — Phase 28
- [ ] [TESTING] Contract tests for the AI adapter; cross-hospital context tests — Phases 28, 30

## Dependencies

- Depends on: Phases 04, 06, 07, 08
- Enables: Phase 28

## Files / Areas Affected

`frontend/src/features/doctor/ai/**`, `backend/src/modules/ai/**`,
`backend/prisma/schema/*` (`AiConversation`, `AiMessage`, `AiUserSetting`, `AiPromptTemplate`)

## Acceptance Criteria

- Original: the chat behaves correctly against the mock, including failure and
  retry. Met.
- Updated (Phase 28): a live reply is generated from hospital-scoped context
  only, keeps the disclaimer, and the AI module cannot write clinical records.

## Testing

`features/doctor/ai/service.test.ts`, `backend/src/modules/ai/ai-containment.spec.ts`,
`ai-prompt.builder.spec.ts`.

## Evidence

- `frontend/PHASE10_AI_ASSISTANT.md`
- `frontend/FRONTEND_CHECKLIST.md` §3.5 (D-08, D-09), §9 row 4
- `docs/FE-10-INTEGRATION-STATUS.md` Still Mock row 4 (F40)
- `git ls-tree origin/main -- backend/src/modules/ai`

## Notes / Decisions Required

- Provider: architecture is provider-agnostic (OD-11, final). Choosing a provider
  includes its data-processing agreement, a compliance step at selection (Phase 28).
