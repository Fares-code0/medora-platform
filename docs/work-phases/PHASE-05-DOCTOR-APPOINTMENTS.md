# Phase 05 — Doctor Appointments Module

> **Historical record — not a task register** (labelled 2026-10-26). This file records a past phase as it was planned and built. Its Status line, task boxes and tables are not kept current, and nothing here is status. Open frontend work is tracked only in [`frontend/FRONTEND_CHECKLIST.md`](../../frontend/FRONTEND_CHECKLIST.md) §13 (doctor/admin web) and [`docs/multi-hospital/CLIENTS_CHECKLIST.md`](../multi-hospital/CLIENTS_CHECKLIST.md) (multi-hospital WEB/PA tasks); backend, database and AI items named here are tracked in those domains' own records. Where this file disagrees with them, they win.

**Original Source:** `frontend/PHASE5_APPOINTMENTS.md`
**Primary Area:** Frontend
**Status:** COMPLETED — live since FE-10.3; location awareness and slot proposals still open
**Depends On:** Phases 03, 04
**Enables:** Phase 24 (published slots and hospital-scoped booking), Phase 25

---

## Objective

Build `/doctor/appointments`: a list plus Day/Week/Month calendar views, a
details drawer with deep links, and the full action set (approve, reject,
cancel, reschedule, complete, no-show) as a typed status machine. It also
promoted the shared patient identity to `features/shared-domain/patient-identity/`.

## Scope (original)

URL-driven views (`?view=list|day|week|month&date=`), 320 time-coherent mock
appointments, reason and reschedule dialogs, mock slot availability, and the
`availableActions()` status machine.

## Out of Scope

Backend, real scheduling, the booking flow, block time off, drag-to-reschedule,
and a DS Calendar primitive.

## Current Status

**COMPLETED.** The module is live. The **client-side** status machine is
superseded by server-provided `availableActions`.

## Current State

**Completed work**
- Live `GET/POST /appointments` and transitions
  `/appointments/:id/{approve,reject,cancel,reschedule,complete,no-show}`. Menus
  come from the server's `availableActions` (FE-10.3).
- Add appointment dialog (Stabilization post-16), live.
- Block time off: live via `POST /me/time-off` (FE-10.3/10.4). Phase 17B
  had removed the earlier fake button.

**Superseded**
- The client-computed `availableActions()` gave way to the server's list. The
  rule "the server owns every transition" now applies to both clients
  (patient-app audit §6).

**Remaining work**
- Proposing slots: `POST …/propose-slots` exists, but there is no UI flow
  (FE-10 Still Mock row 13). Owned by **Phase 29**.
- Multi-hospital (realigned 2026-10-07): appointments belong to one hospital
  (DR-11), shown with a hospital label. Patients book only **doctor-published
  online slots** (DR-10), capacity 1 (OD-08). Appointments also show the clinic
  and location (a hospital has multiple Locations in v1, OD-06). Owned by
  **Phases 24 and 25**.

## Tasks

- [x] [FRONTEND] List + calendar views, drawer, dialogs
- [x] [FRONTEND] Live booking and transitions (FE-10.3)
- [ ] [FRONTEND] Propose-slots UI — Phase 29
- [ ] [FRONTEND] Hospital, clinic and location labels; slot publishing — Phase 25
- [ ] [BACKEND] [DATABASE] Published slots; appointments carry hospital — Phase 24

## Dependencies

- Depends on: Phases 03, 04
- Enables: Phases 24, 25

## Files / Areas Affected

`frontend/src/features/doctor/appointments/**`, `features/shared-domain/patient-identity/**`

## Acceptance Criteria

- Original: all four views render the same filtered dataset, and actions follow
  the status machine. Met.
- Updated: actions offered = actions the server lists; a 409 is rendered, never
  pre-empted.

## Testing

`http-appointment-service.test.ts` (11), `http-time-off-service.test.ts` (4),
and page tests for server refusal.

## Evidence

- `frontend/PHASE5_APPOINTMENTS.md` §3
- `docs/FE-10-INTEGRATION-STATUS.md` Connected rows 4–6, Still Mock row 13
- `origin/frontend:frontend/FRONTEND_CHECKLIST.md` §3.4 multi-organization note (superseded by DR-10/DR-11)

## Notes / Decisions Required

See Phase 24. OD-08 (final): one patient per published slot. Cancellation,
rescheduling, no-show and lead-time values are implementation policy (ADR-033).
