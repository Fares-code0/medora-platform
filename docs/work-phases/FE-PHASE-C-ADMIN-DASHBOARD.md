# Frontend Phase C — Build the Real Admin Dashboard

> **Historical record — not a task register** (labelled 2026-10-26). This file records a past phase as it was planned and built. Its Status line, task boxes and tables are not kept current, and nothing here is status. Open frontend work is tracked only in [`frontend/FRONTEND_CHECKLIST.md`](../../frontend/FRONTEND_CHECKLIST.md) §13 (doctor/admin web) and [`docs/multi-hospital/CLIENTS_CHECKLIST.md`](../multi-hospital/CLIENTS_CHECKLIST.md) (multi-hospital WEB/PA tasks); backend, database and AI items named here are tracked in those domains' own records. Where this file disagrees with them, they win.

**Original Source:** `frontend/FRONTEND_CHECKLIST.md` §7, Phase C (and §4 "Administrator Dashboard")
**Phase family:** lettered checklist phases
**Primary Area:** Frontend (+ Security)
**Status:** COMPLETED (frontend) — server-side enforcement and several data sources still owed; partly blocked (F33)
**Depends On:** Frontend Phase B
**Enables:** FE-10.10, Phase 26, Phase 30

---

## Objective

Build the Administrator Dashboard specified in `UX_ARCHITECTURE.md` §3, which
had never been built. All nine screens, with PHI governance underneath.

## Scope

8. ADM-10 PHI masking and elevation gate (`MaskedIdentifier`).
9. ADM-05 appointment oversight.
10. ADM-02 / ADM-03 doctors and verification queue.
11. ADM-04 patients and medical-access grid.
12. ADM-07 system logs.
13. ADM-01 overview.
14. ADM-06 communications monitoring.
15. ADM-08 reports.

## Out of Scope

Backend.

## Current Status

**COMPLETED** for the frontend: all nine §3 screens are live in the UI. Their
data status (FE-10):

| Screen | Live status on `main` |
|---|---|
| ADM-02/03 doctors + verification, ADM-05 oversight | Wired; **Blocked** (F33) |
| ADM-01 overview, ADM-04 patients, ADM-06 communications, ADM-07 logs, ADM-08 reports | **Still Mock** |

**Carried gaps (from the checklist):**
- PHI enforcement is frontend-only. The clear value still reaches the client.
- Telemetry, service health and storage on ADM-01 and ADM-08 are mock-served
  with no measuring backend.
- Four §3.8 figures (lab turnaround, AI usage/latency, latency percentiles,
  error rate) are unservable.

## Current State

`frontend/src/features/admin/{overview,doctors,appointments,patients,communications,logs,reports,phi}/`.

**Transferred**
- Server-side PHI withholding and audited reveal → **Phases 22 and 30**.
- Hospital vs platform split of every screen (realigned 2026-10-07; Platform Admin + Hospital Admin, OD-07 final) (ADM-01/02/03/07/09 platform
  halves → platform console) → **Phase 26**.
- Telemetry and metrics backend → **Phase 31**.

## Tasks

- [x] [FRONTEND] ADM-01…ADM-10
- [ ] [BACKEND] Withhold PHI until elevation is presented; audit the reveal — Phase 22 / 30
- [ ] [BACKEND] Admin patient-account API (M10.7), audit-log read route, admin reports — Phase 26
- [ ] [FRONTEND] Split screens into hospital administration vs platform administration — Phase 26

## Dependencies

- Depends on: Frontend Phase B
- Enables: FE-10.10, Phases 26, 30

## Files / Areas Affected

`frontend/src/features/admin/**`, `frontend/src/utils/phi-mask.ts`

## Acceptance Criteria

All nine §3 screens exist with UX-specified states. Met. Updated criteria
(server-enforced PHI, hospital scoping) are in Phases 26 and 30.

## Testing

Admin feature tests, `phi-mask.test.ts`. `phi-mask.ts` also runs the
**backend** suite per CLAUDE.md's cross-tree rule.

## Evidence

`frontend/FRONTEND_CHECKLIST.md` §4, §7 Phase C and its "Known gaps";
`docs/FE-10-INTEGRATION-STATUS.md` Blocked 1–8, Still Mock 14–19.

## Notes / Decisions Required

- Historical: `origin/frontend`'s ORG-03 note asked whether a platform admin may
  access clinical records. Final OD-07 answer: not automatically; only through
  explicit, audited permission.
