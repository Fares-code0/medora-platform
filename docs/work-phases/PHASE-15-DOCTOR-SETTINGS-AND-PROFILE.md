# Phase 15 — Doctor Settings & Profile Center

> **Historical record — not a task register** (labelled 2026-10-26). This file records a past phase as it was planned and built. Its Status line, task boxes and tables are not kept current, and nothing here is status. Open frontend work is tracked only in [`frontend/FRONTEND_CHECKLIST.md`](../../frontend/FRONTEND_CHECKLIST.md) §13 (doctor/admin web) and [`docs/multi-hospital/CLIENTS_CHECKLIST.md`](../multi-hospital/CLIENTS_CHECKLIST.md) (multi-hospital WEB/PA tasks); backend, database and AI items named here are tracked in those domains' own records. Where this file disagrees with them, they win.

**Original Source:** `frontend/PHASE15_DOCTOR_SETTINGS_PROFILE.md`
**Primary Area:** Frontend
**Status:** PARTIALLY COMPLETED — profile, account, security and activity are live; privacy, integrations and notification preferences are not served; the free-text "hospital" field must become the doctor's current employment
**Depends On:** Phases 09, 11
**Enables:** Phase 16A (profile provider), Phase 17B (About section), Phase 19 (admin reuse)

---

## Objective

Build an enterprise settings center at `/doctor/settings/:section` with 10
sections: profile, account, security, privacy, notifications, appearance,
preferences, accessibility, integrations, activity log. It has a sticky save bar
for batched edits and applies safe switches immediately.

## Scope (original)

`features/doctor/settings/` (schemas, store under
`medora.<userId>.settings.v1`, mock service that logs activity), an
`InterfaceSettingsProvider`, no-flash boot script extensions
(density / contrast / motion / text scale), and the shared `utils/password.ts`.

## Out of Scope

Backend. Integrations connect and disconnect only as mocks.

## Current Status

**PARTIALLY COMPLETED.** The surface is complete (11 sections after Phase 17B
added About). In a live build only some sections are server-backed.

## Current State

**Live (FE-10.9)**
- Profile (`GET/PATCH /me/profile`), account (`/me/account`, email read-only),
  password change, 2FA setup/enable/disable, sessions, trusted devices, login
  history, activity log.

**Browser-local by design (not counted as mock)**
- Appearance, accessibility and workflow preferences.

**Still mock**
- Privacy consents, calendar/app integrations, notification preferences, profile
  photo upload (`PUT /me/profile/photo` exists; the file flow is outside FE-10).
  FE-10 Still Mock rows 6–9.

**Changed since**
- PR #40 (local `51cefbd`): settings is a full page and "My Profile" left the
  sidebar.
- Phase 19: the admin mounts the same settings center under its own path builder.

**Remaining work**
- Missing routes and photo upload. Owned by **Phase 29**.
- Multi-hospital (realigned 2026-10-07, DR-02): replace the free-text
  **hospital** field with the read-only **current employment** (hospital,
  department, since) and optional history. There is no list of simultaneous
  affiliations; API-W03 is superseded. Online-slot publishing (DR-10) replaces
  per-location availability editing. Owned by **Phases 24 and 25**.

## Tasks

- [x] [FRONTEND] 10 + 1 sections, sticky save bar, live appearance
- [x] [FRONTEND] Live profile/account/security/activity (FE-10.9)
- [x] [BACKEND] Privacy-consent, integrations, notification-preference routes — Phase 29 · *verified 2026-11-22: `PATCH /me/settings/privacy`, `/me/integrations/:id/{connect,disconnect}`, `/me/notification-preferences` on `main`*
- [x] [FRONTEND] Profile photo upload over `PUT /me/profile/photo` — Phase 29 · *verified 2026-11-22: `putProfilePhoto` (`doctor-profile-wire.ts`) from the Profile section; the route answers 503 until an object store is configured*
- [ ] [BACKEND] `employment` on `/me/profile`; `/me/published-slots` — Phases 22, 24
- [ ] [FRONTEND] Current employment replaces the hospital field — Phase 25

## Dependencies

- Depends on: Phases 09, 11
- Enables: Phases 16A, 17B, 19, 25

## Files / Areas Affected

`frontend/src/features/doctor/settings/**`, `frontend/src/app/providers/{InterfaceSettingsProvider,DoctorProfileProvider}.tsx`,
`frontend/index.html` (boot script), `backend/src/modules/users/**` (`/me/*`)

## Acceptance Criteria

- Original: every control changes real app state. Met (in mock mode).
- Updated: every control offered in a live build is server-backed or explicitly
  browser-local.

## Testing

Settings HTTP adapter specs (FE-10.9) and `features/doctor/settings/service.test.ts`.

## Evidence

- `frontend/PHASE15_DOCTOR_SETTINGS_PROFILE.md`
- `docs/FE-10-INTEGRATION-STATUS.md` Connected 20–27, Still Mock 6–9
- `origin/frontend:frontend/FRONTEND_CHECKLIST.md` §3.12 note (API-W03)
- `docs/DECISIONS.md` ADR-036 (`/me/profile` is one route)

## Notes / Decisions Required

None open. OD-12 (final): on employment end, access is revoked immediately with
no grace period; history is kept.
