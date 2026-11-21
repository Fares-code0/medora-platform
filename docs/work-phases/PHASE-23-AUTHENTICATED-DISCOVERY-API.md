# Phase 23 — Authenticated Hospital & Doctor Discovery API

**Previously:** "Public Hospital & Provider Discovery API" (`PHASE-23-PUBLIC-DISCOVERY-API.md`). The
public premise is **obsolete** (DR-09). Renamed on 2026-10-07.
**Origin:** audit-derived; reconciled with the FINAL owner decisions on 2026-10-07
**Primary Area:** Backend (+ Database)
**Status:** NOT STARTED
- Foundation exists: authenticated `/patient/doctors`, `/patient/doctors/:id` and
  `/patient/specialties`, single clinic (AF-18).

**Valid after the final decisions:** yes
**Depends On:** 21, 22
**Enables:** 24, 27

**Related documentation:** `docs/multi-hospital/DISCOVERY_AND_BOOKING.md` §1–§3,
`API_CONTRACT_CHANGES.md` §5
Backend tasks for the patient AI assistant (added 2026-10-10): `BACKEND_CHECKLIST.md` §K and
`API_CONTRACT_CHANGES.md` §10.

> **Correction history.**
> - *First version:* `/public/*`, signed-out access, multi-affiliation doctors. Superseded by DR-09 and
>   DR-02.
> - *Second version:* listing, comparison, ratings and insurance were "OD-required", and distance was
>   "not planned". Superseded:
>   - compare by specialty, location, **distance**, next slot and **ratings/reviews** (OD-10);
>   - insurance-aware for insured patients, **unrestricted for uninsured** (OD-14);
>   - multiple Locations and Clinics (OD-06).

---

## Objective

A signed-in patient, with no prior hospital relationship needed, can search and compare hospitals and
doctors.

## Owner decisions it implements

DR-01, DR-02, DR-09, OD-06, OD-10, OD-14, all FINAL.

## Deliverables

- [ ] [BACKEND] `@Authenticated()` discovery/search with comparison rows: hospital, clinic, location,
  doctor, specialty/department, distance, rating, next published slot, insurance flag
- [ ] [BACKEND] Hospital profile (clinics, multiple locations, departments, specialties, accepted
  insurance)
- [ ] [BACKEND] Doctors with one active hospital; doctors without employment excluded
- [ ] [BACKEND] Distance from per-request coordinates (not stored)
- [ ] [BACKEND] Ratings/reviews from `satisfaction_surveys`, moderated, no clinical content (AF-40)
- [ ] [BACKEND] Insurance: insured → coverage-aware; **uninsured → no filtering**
- [ ] [BACKEND] Rate limiting (AF-20) — TECHNICAL RECOMMENDATION
- [ ] [DATABASE] Search and distance indexes
- [ ] [TESTING] N-19, N-20, N-22; allow-list tests

## Blocking conditions

Phases 21 and 22.

## Security requirements

- Authenticated only. No PHI in discovery.
- Gate **G-7** (discovery half).

## Downstream phases

24, 27

## Source / evidence

- `backend/src/modules/doctors/controllers/patient-doctor.controller.ts`
- `origin/patient-app` checklist (superseded API-P01–P08)
