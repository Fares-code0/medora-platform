# Phase 14 — Doctor Messaging & Communication Center

> **Historical record — not a task register** (labelled 2026-10-26). This file records a past phase as it was planned and built. Its Status line, task boxes and tables are not kept current, and nothing here is status. Open frontend work is tracked only in [`frontend/FRONTEND_CHECKLIST.md`](../../frontend/FRONTEND_CHECKLIST.md) §13 (doctor/admin web) and [`docs/multi-hospital/CLIENTS_CHECKLIST.md`](../multi-hospital/CLIENTS_CHECKLIST.md) (multi-hospital WEB/PA tasks); backend, database and AI items named here are tracked in those domains' own records. Where this file disagrees with them, they win.

**Original Source:** `frontend/PHASE14_MESSAGING_CENTER.md`
**Primary Area:** Frontend (+ Backend dependency)
**Status:** PARTIALLY COMPLETED — the workspace UI and seam are complete; data is mock on `main` because the messaging API exists only on the `backend` integration branch
**Depends On:** Phases 02, 11
**Enables:** Phase 29 (messaging integration), Phase 26 (communications oversight)

---

## Objective

Make `/doctor/messages` a full three-pane communication workspace (folder rail,
conversation list, chat), in the spirit of Teams/Slack and EMR inboxes. It
includes folders, search, compose, reply, star / pin / mute / archive / delete,
delivery and read states, failed-send retry, drafts autosave, a details drawer
and a polled badge.

## Scope (original)

`features/doctor/messaging/` with a localStorage store (`medora.messaging.v1`),
a promise-based mock service, 5 contacts and 5 conversations, and a
`ShellBadgesProvider` messages badge.

## Out of Scope

Real transport. Forward, emoji, attachment upload and voice were placeholders.
Group-thread creation, virtualization.

## Current Status

**PARTIALLY COMPLETED.** The frontend deliverable is done and sits behind a seam
(`service.ts`, `http/` directory present). It cannot go live:

- `main` has **no messaging routes** (FE-10 Still Mock row 1). A live build shows
  "Not connected".
- The `backend` branch carries `backend/src/modules/messaging` with conversation,
  attachment, search and oversight controllers (M20). It is **single-tenant** and
  not merged to `main`.

## Current State

**Completed work**
- Workspace, folders, states, drafts, responsive list↔chat swap (Phase 14).
- Emoji picker added and dead attach/voice/forward buttons removed (Phase 17B).
- Messages quick action opens the compose picker (D-24 / DX-22).

**Remaining work**
- Fix the thread-creation authorization gap (AF-16: any existing user can be
  added as a participant, any `patientId` attached). Then merge the M20 messaging
  API to `main`, scoped per hospital (realigned 2026-10-07; formerly
  "organization", API-W09). Wire the web adapter. Owned by
  **Phase 29**.
- Patient-to-doctor messaging (patient-app Phase M, API-P17) is blocked on AD-1 /
  BE-13. Owned by **Phase 29**.

## Tasks

- [x] [FRONTEND] Three-pane workspace, mock service, badge
- [ ] [BACKEND] Bring M20 messaging from `backend` to `main` — Phase 29
- [ ] [BACKEND] [DATABASE] Hospital-scoped conversations + participant rule (AF-16); cross-hospital only as audited consultations (OD-13, final; Phase 22A) — Phases 21, 22, 29
- [ ] [FRONTEND] HTTP adapter behind `messaging/service.ts` — Phase 29
- [ ] [PATIENT-APP] Patient messaging (API-P17) — Phase 29

## Dependencies

- Depends on: Phases 02, 11
- Enables: Phases 26, 29

## Files / Areas Affected

`frontend/src/features/doctor/messaging/**`, `backend/src/modules/messaging/**`
(on `backend`), `backend/prisma/schema/10-communication.prisma`

## Acceptance Criteria

- Original: every listed interaction works against the mock. Met.
- Updated: in a live build, threads come from the API, and a recipient picker
  lists only colleagues the API returns for the current hospital.

## Testing

`features/doctor/messaging/service.test.ts`. Live contract tests are still to be
written in Phase 29.

## Evidence

- `frontend/PHASE14_MESSAGING_CENTER.md`
- `docs/FE-10-INTEGRATION-STATUS.md` Still Mock row 1
- `git ls-tree origin/backend -- backend/src/modules/messaging` vs `origin/main`
- `origin/frontend:frontend/FRONTEND_CHECKLIST.md` §3.9 note (API-W09)

## Notes / Decisions Required

- None open. OD-13 (final): cross-hospital communication is an audited clinical
  consultation. Medical Record data inside it still requires a grant (or valid
  Break-Glass, OD-04).
