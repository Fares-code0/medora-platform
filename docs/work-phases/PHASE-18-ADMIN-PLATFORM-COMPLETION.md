# Phase 18 — Enterprise Admin Panel Completion & Platform Parity

> **Historical record — not a task register** (labelled 2026-10-26). This file records a past phase as it was planned and built. Its Status line, task boxes and tables are not kept current, and nothing here is status. Open frontend work is tracked only in [`frontend/FRONTEND_CHECKLIST.md`](../../frontend/FRONTEND_CHECKLIST.md) §13 (doctor/admin web) and [`docs/multi-hospital/CLIENTS_CHECKLIST.md`](../multi-hospital/CLIENTS_CHECKLIST.md) (multi-hospital WEB/PA tasks); backend, database and AI items named here are tracked in those domains' own records. Where this file disagrees with them, they win.

**Original Source:** `frontend/PHASE18_ADMIN_PLATFORM_COMPLETION.md`
**Primary Area:** Frontend (+ Backend dependency)
**Status:** PARTIALLY COMPLETED — the UI is complete; platform settings and the admin profile have no API on `main`; users and roles are wired but blocked (F33); multi-hospital administration (OD-07) splits the settings center in two
**Depends On:** Phase 17A, Phase 17B
**Enables:** Phase 19, Frontend Phases B–C, Phase 26

---

## Objective

Bring the admin portal to parity with the doctor portal:

- a 16-panel **Platform Settings** center with real forms, validation, mock
  persistence, save / undo / reset
- an editable **Administrator Profile**
- an **executive dashboard** band (hospital KPIs, system health, licence,
  integrations, audit feed, registrations)

It also fixed the hamburger-drawer bug and hardened the drawer to modal
semantics.

## Scope (original)

`AdminSettingsDocument` in localStorage (`medora.admin.settings.v1`), the
`SettingsPanelForm` envelope, a per-user admin profile, a `PlatformStatus`
aggregate, and `ProfilePhotoField` / `TagListField` promoted to shared patterns.

## Out of Scope

Backend.

## Current Status

**PARTIALLY COMPLETED.** The frontend deliverable exists, now under
`frontend/src/features/admin/` (`admin-settings.types.ts`, `admin-profile.ts`,
`sections/settings/*Panels.tsx`, `PermissionMatrixPanel.tsx` from Phase B). In a
live build, most of it is not served.

## Current State

**Live but blocked (wired and contract-tested; not validated live because of F33)**
- Users panel (`GET/PATCH /admin/users`), roles matrix (`/roles/matrix`, 409
  merge), staff invitations (`POST /auth/admin-invitations`). FE-10 Blocked
  rows 5–7.

**Still mock on `main`**
- The platform settings document and audit panel (Still Mock row 21). A
  `platform-settings` module (M24) exists on the `backend` branch only. Backup
  create and restore answer 501 there.
- Admin profile (row 20).
- Executive telemetry: system health, storage and licence figures are invented
  (Phase C carried gap; no telemetry backend).

**Remaining work**
- Multi-hospital **split** (realigned 2026-10-07): platform panels go to
  platform administration. The "Organization" panel becomes per-**hospital**
  settings. OD-07 (final): Platform Admin (platform and hospital lifecycle, no
  automatic clinical access) + Hospital Admin (one hospital). Owned by
  **Phase 26**.
- Merge M24 to `main` and fix F33. Owned by **Phases 26 and 22**.

## Tasks

- [x] [FRONTEND] 16-panel settings center, admin profile, executive band
- [x] [FRONTEND] Users/roles/invitations HTTP adapters (FE-10.10)
- [ ] [BACKEND] Fix F33 so admin flows can be validated live — Phase 22
- [ ] [BACKEND] Platform-settings routes on `main`; backup create/restore — Phase 26
- [ ] [BACKEND] Admin profile route — Phase 26
- [ ] [FRONTEND] Split settings into hospital settings and platform settings (Platform Admin vs Hospital Admin, OD-07) — Phase 26
- [ ] [BACKEND] Telemetry/health source for the executive band — Phase 31

## Dependencies

- Depends on: Phases 17A, 17B
- Enables: Phases 19, 26

## Files / Areas Affected

`frontend/src/features/admin/{admin-settings.types.ts,admin-profile.ts,sections/settings/**,sections/AdminProfileSection.tsx}`,
`frontend/src/components/patterns/{ProfilePhotoField,TagListField}.tsx`,
`backend/src/modules/platform-settings/**` (on `backend`)

## Acceptance Criteria

- Original: every panel saves, undoes and resets against mock persistence. Met.
- Updated: in a live build, every panel offered is backed by a route, and
  platform-wide panels are reachable only by a platform admin.

## Testing

`GeneralPanels.test.tsx`, `PermissionMatrixPanel.test.tsx`,
`http-access-service.test.ts` (15), `live-access.test.tsx` (11).

## Evidence

- `frontend/PHASE18_ADMIN_PLATFORM_COMPLETION.md`
- `docs/FE-10-INTEGRATION-STATUS.md` Blocked 5–7, 9; Still Mock 20–22
- `frontend/FRONTEND_CHECKLIST.md` §7 "Known gaps carried out of Phase C"
- `origin/frontend:frontend/FRONTEND_CHECKLIST.md` AC-14, ORG-03, §9.1 API-W12/W13

## Notes / Decisions Required

- Panel-by-panel placement follows OD-07 (final) and is implementation design in
  Phase 26.
