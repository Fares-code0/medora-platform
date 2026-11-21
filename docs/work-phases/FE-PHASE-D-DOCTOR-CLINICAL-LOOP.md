# Frontend Phase D — Close the Doctor's Clinical Loop

> **Historical record — not a task register** (labelled 2026-10-26). This file records a past phase as it was planned and built. Its Status line, task boxes and tables are not kept current, and nothing here is status. Open frontend work is tracked only in [`frontend/FRONTEND_CHECKLIST.md`](../../frontend/FRONTEND_CHECKLIST.md) §13 (doctor/admin web) and [`docs/multi-hospital/CLIENTS_CHECKLIST.md`](../multi-hospital/CLIENTS_CHECKLIST.md) (multi-hospital WEB/PA tasks); backend, database and AI items named here are tracked in those domains' own records. Where this file disagrees with them, they win.

**Original Source:** `frontend/FRONTEND_CHECKLIST.md` §7, Phase D (and §3.3–§3.8, §3.13)
**Phase family:** lettered checklist phases
**Primary Area:** Frontend
**Status:** PARTIALLY COMPLETED — prescribing, lab review/ordering, record authoring and global search done; D-18 (medication database) blocked; ~~D-22 (share) awaiting policy~~ *(corrected 2026-10-26: D-22 was closed as copy-link by DEC-016, option A, 2026-10-24; its status is the register's, `frontend/FRONTEND_CHECKLIST.md` §13.3 D-22, decision in §14.1)*
**Depends On:** Phases 04–08, Frontend Phase A
**Enables:** FE-10.5–FE-10.7, Frontend Phase F (F4)

---

## Objective

Give the doctor write access where UX §2.3/§2.6/§2.7 requires it. Phases 06–08
were read-only by scope, so a doctor could not prescribe, review a lab, or write
a record.

## Scope

16. D-17 / D-18 / D-19: prescription authoring, safety screen, medication database.
17. D-21: medical-record authoring (create, sign, amend).
18. D-10…D-14: lab inbox, mark-reviewed, trends, attach-to-record.
19. D-26 global search · D-01 quick actions · D-04 / D-05 / D-06 profile gaps.

## Out of Scope

Backend endpoints (specified in `FRONTEND_CHECKLIST.md` §9 rows 13–14 for the
backend to build).

## Current Status

**PARTIALLY COMPLETED.**

| Row | State |
|---|---|
| D-17 / D-19 prescribing + fail-closed safety screen | ✅ (live, FE-10.6) |
| **D-18 medication database** | ⬜ **blocked** on drug reference data |
| D-21 record authoring | ✅ (live, FE-10.5) |
| D-10…D-14 lab review loop | ✅ (live, FE-10.7) |
| D-26 global search | ✅ doctor-shell index and keyboard-complete panel; backend `/search` (M26) on `backend` only |
| D-01 quick actions | ✅ via DX-22 / DX-23 (Phase F4) |
| D-04 documents | read side ✅; **D-04b upload** blocked on file storage (M25) |
| D-05 lab/imaging tabs | lab real; imaging has no source and says so |
| D-06 patient summary PDF | ✅ (was already built) |
| D-22 share | ~~needs a server-side sharing policy~~ — corrected 2026-10-26: DEC-016 A closed it as copy-link, which grants no access by sharing, so no sharing policy is needed; status in `FRONTEND_CHECKLIST.md` §13.3 D-22 |

## Current State

See the table. **Transferred:**
- D-04b upload → **Phase 29**.
- D-26 hospital-scoped search (realigned 2026-10-07) → **Phases 25, 29**.
- D-18 and D-22 stay **unscheduled** pending owner and clinical decisions
  (see `README.md`). *(Corrected 2026-10-26: D-22's decision was taken — DEC-016 A, 2026-10-24.
  D-18 is still unscheduled and blocked.)*

## Tasks

- [x] [FRONTEND] D-17, D-19, D-21, D-10…D-14, D-26 (frontend), D-01, D-05, D-06
- [ ] [BACKEND] [DATABASE] Drug reference dataset (D-18) — unscheduled, blocked
- ~~[BACKEND] Sharing policy (D-22) — unscheduled, needs product decision~~ — not needed, so not ticked
  as done: DEC-016 A (2026-10-24) closed D-22 as copy-link with no new permission (corrected 2026-10-26;
  status in `FRONTEND_CHECKLIST.md` §13.3 D-22)
- [ ] [BACKEND] File storage + scan gate (M25) for D-04b — Phase 29

## Dependencies

- Depends on: Phases 04–08, Frontend Phase A
- Enables: FE-10.5–10.7, Frontend Phase F4

## Files / Areas Affected

`frontend/src/features/doctor/{pharmacy,labs,medical-records,patients}/**`,
`frontend/src/features/doctor/useDoctorSearchIndex.ts`

## Acceptance Criteria

Fail-closed safety and signing rules hold client-side and are specified for
server re-enforcement. Met for the built rows.

## Testing

`NewPrescriptionPage.test.tsx`, record/lab service specs,
`useDoctorSearchIndex.test.tsx`.

## Evidence

`frontend/FRONTEND_CHECKLIST.md` §0 problem 3, §3.3–§3.8, §7 Phase D, §9 rows 5–7, 13–14;
`origin/frontend:frontend/FRONTEND_CHECKLIST.md` D-26 row.

## Notes / Decisions Required

- D-18 data source; ~~D-22 sharing policy~~ (resolved by DEC-016 A, 2026-10-24 — corrected 2026-10-26).
