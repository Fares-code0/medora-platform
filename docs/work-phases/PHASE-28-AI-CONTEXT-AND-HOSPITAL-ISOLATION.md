# Phase 28 — AI Integration, Hospital Isolation & Authorization-Bound Retention

**Previously:** "AI Integration, Context & Organization Isolation"
(`PHASE-28-AI-CONTEXT-AND-ORGANIZATION-ISOLATION.md`), renamed on 2026-10-07.
**Origin:** audit-derived; carries forward Phase 10; reconciled with the FINAL owner decisions (OD-04 = A,
OD-05 = B, OQ-01 = A) on 2026-10-07
**Primary Area:** AI + Backend + Frontend (+ Patient App, + Security)
**Status:** NOT STARTED
- The backend `/ai/*` module exists on `main`.
- The provider is a 503 stub.
- The doctor UI is mock; the patient AI is UI-only.

**Valid after the final decisions:** yes
**Depends On:** 10, 22, 22A, 25, 27
**Enables:** 30, 31

**Related documentation:** `docs/multi-hospital/AI_CHECKLIST.md`, `SECURITY_AND_DATA_ISOLATION.md` §8–§10
Backend tasks for the patient AI assistant (added 2026-10-10): `BACKEND_CHECKLIST.md` §K and
`API_CONTRACT_CHANGES.md` §10. AI tasks: `AI_CHECKLIST.md` §6 (AG-\*; owned by the AI team on `Ai`). Database: `DATABASE_CHECKLIST.md` §I.

> **Correction history.**
> - *First version:* "AI context drawn only from the active organization".
> - *Second version:* "AI must exclude cross-hospital data even under a grant" (superseded by OD-05).
> - *Third version:* grant-only, with AI-drafted notes excluding cross-hospital content until OQ-01.
>   **Superseded:**
>   - AI may also use data authorized by **Break-Glass** (OD-04), within its scope and window;
>   - doctor-approved content saved into the requesting hospital's record is that hospital's data
>     (OQ-01 = A);
>   - the AI may help draft it.

---

## Objective

- Connect real AI capabilities under a fail-closed, hospital-scoped context.
- Allow cross-hospital use only under valid authorization (grant or Break-Glass), with **no raw
  retention** after it ends.
- Address AF-39 (`ai_messages` stored verbatim) with the C1/C2/C3 data classes.
- Build the provider-agnostic gateway and hospital-partitioned retrieval.

## Why it exists

AF-26, AF-27, AF-28, AF-29, AF-30, AF-39.

## Owner decisions it implements

DR-04, DR-06, DR-12 (= OD-05), DR-13 (= OD-11), OD-04, OD-12, OD-13, OQ-01, all FINAL.

## Deliverables

- [ ] [AI] [BACKEND] Hospital context required; default current hospital only (`AI_CHECKLIST.md` F1)
- [ ] [AI] [BACKEND] Authorization-aware assembly: grant (category, purpose, validity) or Break-Glass
  (scope, window), re-checked every turn (F2)
- [ ] [AI] [BACKEND] **Data classes** (`AI_CHECKLIST.md` §1):
  - C1 same-hospital history keeps normal retention;
  - C2 transient cross-hospital context and un-approved derived output, tagged with the authorization and
    purged or made inaccessible at its end;
  - continuation lock.

  (F3–F5)
- [ ] [AI] [BACKEND] "Save to record" (C2 → C3): doctor-only explicit save of selected content into
  Hospital A's record, with provenance; no whole-record import (F6)
- [ ] [AI] Hospital-partitioned RAG; no persistent embedding of cross-hospital content; no training on
  it (F7, F8)
- [ ] [AI] Provider-agnostic adapter behind `AI_GATEWAY`; enabled only after G-5 (F10)
- [ ] [AI] Parallel capability tracks D-AI-1…9 and P-AI-1…8, each individually validated; stronger
  gates for high-risk capabilities
- [ ] [FRONTEND] `/ai/*` adapter; cross-hospital content labelled with its source and authorization end
  (F12)
- [ ] [PATIENT-APP] Same model for patient AI (F13)
- [ ] [TESTING] `AI_CHECKLIST.md` T1–T13 = gate **G-5**

## Blocking conditions

- Phases 22 and 22A.
- A real provider waits for G-5.

## Security requirements

- Fail-closed.
- No raw cross-hospital retention.
- No AI-initiated clinical writes; only doctor saves (M16.6).
- Gate **G-5**.

## Downstream phases

30, 31

## Source / evidence

- `backend/src/shared/ai/unconfigured-ai-gateway.ts`
- `backend/src/shared/ai/ai-transcript.log.ts`
- `backend/src/modules/ai/services/ai-context.service.ts`
- `docs/FE-10-INTEGRATION-STATUS.md` (F40)
