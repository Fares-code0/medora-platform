# Phase 11 — Doctor Notifications & Communication Center

> **Historical record — not a task register** (labelled 2026-10-26). This file records a past phase as it was planned and built. Its Status line, task boxes and tables are not kept current, and nothing here is status. Open frontend work is tracked only in [`frontend/FRONTEND_CHECKLIST.md`](../../frontend/FRONTEND_CHECKLIST.md) §13 (doctor/admin web) and [`docs/multi-hospital/CLIENTS_CHECKLIST.md`](../multi-hospital/CLIENTS_CHECKLIST.md) (multi-hospital WEB/PA tasks); backend, database and AI items named here are tracked in those domains' own records. Where this file disagrees with them, they win.

**Original Source:** `frontend/PHASE11_NOTIFICATIONS.md`
**Primary Area:** Frontend
**Status:** PARTIALLY COMPLETED — inbox, read/unread and shell badges are live; preferences, archive/pin/delete and the Communication tab are still mock
**Depends On:** Phase 02
**Enables:** Phase 14 (messaging badge), Phase 19 (bell parity)

---

## Objective

Build `/doctor/notifications`: an inbox with URL-owned filters, bulk actions and
a detail drawer; a communication center (colleague chats, announcements, system
alerts); per-user notification preferences; and **live unread badges across the
whole shell** from one shared query cache.

## Scope (original)

`ShellBadgesContext` (layouts) + `ShellBadgesProvider` (app layer), so layouts
never import features. 30-second polling with a one-shot demo delivery, 64 seeded
notifications, 5 conversations, preferences under
`medora.<userId>.notificationPreferences`.

## Out of Scope

Backend, real push/email/SMS, PHI in storage. `/doctor/messages` stayed a
placeholder (Phase 14 built it).

## Current Status

**PARTIALLY COMPLETED.** The badge architecture and inbox are complete and live.
Several of the phase's own deliverables have no backend route.

## Current State

**Completed work (live, FE-10.8)**
- `GET /notifications`, `POST /notifications/:id/read|unread`,
  `GET /notifications/badge-counts` feeding the bell, sidebar and tab bar.
- PR #40 (local `51cefbd`) replaced the bell drawer with an anchored popover.

**Still mock / hidden in live builds**
- Notification preferences: no route. Corrected in FE-10.V (V-1) to say
  "Not connected" instead of pretending (Still Mock row 8).
- Archive, favourite, pin, delete, clear read: no route. Hidden live (row 10).
- Communication tab: no messaging API on `main` (row 1). The messaging module
  exists on the `backend` branch (M20), not on `main`.

**Remaining work** — **Phase 29** (routes and wiring). Hospital context on
each notification (realigned 2026-10-07; formerly "organization", API-P19/API-W02) — **Phases 25, 27**.

## Tasks

- [x] [FRONTEND] Inbox, drawer/popover, bulk selection, preferences UI
- [x] [FRONTEND] Shell badge seam and live badges (FE-10.8)
- [ ] [BACKEND] Notification preference and inbox-action routes — Phase 29
- [ ] [BACKEND] Messaging API on `main` (M20 from `backend`) — Phase 29
- [ ] [FRONTEND] Wire preferences/actions/communication tab — Phase 29
- [ ] [BACKEND] `hospital {id, name}` on notifications — Phase 22

## Dependencies

- Depends on: Phase 02
- Enables: Phases 14, 19, 29

## Files / Areas Affected

`frontend/src/features/doctor/notifications/**`, `frontend/src/layouts/badge-context.ts`,
`frontend/src/app/router/ShellBadgesProvider.tsx`, `backend/src/modules/notifications/**`

## Acceptance Criteria

- Original: one cache drives every badge; marking read updates all surfaces.
  Met, live.
- Remaining: every inbox action the UI offers live has a server route behind it.

## Testing

`http-notification-service` specs (FE-10.8), `ShellBadgesProvider.test.tsx`.

## Evidence

- `frontend/PHASE11_NOTIFICATIONS.md`
- `docs/FE-10-INTEGRATION-STATUS.md` Connected 18–19, Still Mock 1, 8, 10
- `git ls-tree origin/backend -- backend/src/modules/messaging` (controllers present) vs `origin/main` (absent)

## Notes / Decisions Required

- Should the Notifications page keep its lightweight Communication tab once the
  Phase 14 workspace is live? The two stores are separate by design
  (`medora.messages.v2` vs `medora.messaging.v1`), which duplicates a concept.
