# Frontend Phase E / FE-10 — Leave the Mocks Behind (Live API Integration)

> **Historical record — not a task register** (labelled 2026-10-26). This file records a past phase as it was planned and built. Its Status line, task boxes and tables are not kept current, and nothing here is status. Open frontend work is tracked only in [`frontend/FRONTEND_CHECKLIST.md`](../../frontend/FRONTEND_CHECKLIST.md) §13 (doctor/admin web) and [`docs/multi-hospital/CLIENTS_CHECKLIST.md`](../multi-hospital/CLIENTS_CHECKLIST.md) (multi-hospital WEB/PA tasks); backend, database and AI items named here are tracked in those domains' own records. Where this file disagrees with them, they win.

**Original Sources:**
- `frontend/FRONTEND_CHECKLIST.md` §7, Phase E (DP-04 endpoint swap, DP-06 exports, A-12 auth, F-19 i18n)
- `docs/FE-10-INTEGRATION-STATUS.md` (FE-10.1 … FE-10.10 and FE-10.V)

**Phase family:** Phase E (checklist) was executed as **FE-10**. "FE-10" matches
*planned* Phase 10 "Backend integration" in `frontend/FRONTEND_ARCHITECTURE.md`
§13.1. It is **not** executed Phase 10 (AI Assistant).
**Primary Area:** Frontend + Integration
**Status:** PARTIALLY COMPLETED — 27 connected, 22 still mock, 10 blocked (FE-10.V, 2026-10-05)
**Depends On:** Frontend Phases A–D, backend milestones M6–M15, M19, M21
**Enables:** Phases 22–31

---

## Objective

Connect the doctor/admin web client to the Medora API feature by feature. The
adapter is selected in one place (`api/seam.ts`). Live builds have no silent
mock fallback.

## Scope (as committed)

| Sub-phase | Commit | Connected |
|---|---|---|
| FE-10.1 | `c64b484` | Live transport (refresh policy, abort, strict readers) |
| FE-10.2 | `b1e00c4` | Patients: directory, registration, record |
| FE-10.3 | `eba96d1` | Appointments: book, booking, transitions |
| FE-10.4 | `d515a04` | Doctor Overview, time off |
| FE-10.5 | `bf7e0c3` | Medical records |
| FE-10.6 | `0814374` | Prescribing and formulary |
| FE-10.7 | `ad886b2` | Laboratory |
| FE-10.8 | `16bb9dc` | Notifications and shell badges |
| FE-10.9 | `cfdabee` | Doctor profile, account, security |
| FE-10.10 | `9a1a331` | Admin doctors, oversight, users, roles, invitations |
| FE-10.V | `a4070e9` | Final validation (V-1) + status record |

Also in Phase E: DP-06 real exports ✅, A-12 real auth ✅, F-19 i18n ✅ (five
locales; ~2,045 strings await a clinical translator).

## Out of Scope

`backend/`, the database, `patient-app/`.

## Current Status

**PARTIALLY COMPLETED** — "partially connected… never scoped to be 100%"
(FE-10.V). Live browser validation could not be re-run in the final pass
because there was no Medora database in that container (F39).

## Current State

- **Connected (27):** every doctor clinical workflow, notifications and badges,
  and profile/account/security.
- **Still Mock (22):** messaging, four Overview widgets, My Clinic, AI (backend
  now serves `/ai/*`, F40), reports (`GET /reports/analytics` exists, F40),
  privacy, integrations, notification preferences, profile photo, inbox actions,
  lab annotations, record vitals, propose-slots, admin overview, 13
  clinic-management sections, admin patients, communications, logs, admin
  reports, admin profile, platform settings, unserved admin actions.
- **Blocked (10):** all admin live validation (F33: seeded admin cannot complete
  TOTP); the complaint flag never fires (F35).
- Merged after FE-10.V: PR #37 (Anatomy removed), PR #38–#40 (Overview fix,
  customizable admin Overview, full-page settings). On `origin/frontend`
  (`694a3cb`), not yet in this checkout: PR #41 (multi-organization checklist
  realignment), PR #44 (Vercel ignore step), PR #45 (Anatomy remnants removed).

**Transferred**
- Every Still Mock / Blocked row is assigned to a new phase:
  - F33 → **Phase 22**
  - AI → **Phase 28**
  - Admin and clinic rows → **Phase 26**
  - Messaging, reports, preferences, inbox actions, annotations, vitals,
    propose-slots, photo, Overview widgets → **Phase 29**
- Re-running the live browser sweep against a real database → **Phase 31**.

## Tasks

- [x] [FRONTEND] FE-10.1 … FE-10.10, FE-10.V
- [ ] [BACKEND] Fix F33, F35 — Phases 22, 29
- [ ] [FRONTEND] Remaining Still Mock rows — Phases 26, 28, 29
- [ ] [TESTING] Live re-validation of all Connected rows against a seeded database — Phase 31

## Dependencies

- Depends on: Frontend Phases A–D; backend M6–M15, M19, M21 on `main`
- Enables: Phases 22–31

## Files / Areas Affected

`frontend/src/api/{client,http,seam}.ts`, `frontend/src/api/endpoints/**`, every
`frontend/src/features/**/service.ts` + `http/` adapter

## Acceptance Criteria (from FE-10.V)

Each Connected row has a backend controller route, adapter contract tests, and a
mock-mode browser sweep. Each Still Mock row says so in the UI ("Not connected
yet" / "Not available yet") or hides the action. Met for the recorded rows.

## Testing

Adapter contract specs per feature. The route sweep ran 239 checks: 0 overflow,
0 route errors, 0 blank screens.

## Evidence

`docs/FE-10-INTEGRATION-STATUS.md` (all tables); `git log` commits above;
`frontend/FRONTEND_CHECKLIST.md` §6 DP-01…DP-06, §7 Phase E.

## Notes / Decisions Required

- `FRONTEND_CHECKLIST.md` DP-04 still reads "1 of 13". The FE-10 status document
  supersedes it.
