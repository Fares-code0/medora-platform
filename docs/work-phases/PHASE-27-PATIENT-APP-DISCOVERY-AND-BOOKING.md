# Phase 27 — Patient App: Authenticated Discovery, Comparison, Booking & Per-Hospital Records

**Origin:** audit-derived; consolidates patient-app Phases E, G, H, I, J, O and P; reconciled with the
FINAL owner decisions on 2026-10-07
**Primary Area:** Patient App
**Status:** NOT STARTED
- Already built: signed-in doctor discovery over `/patient/doctors` and live appointments over
  `/me/appointments`.
- Booking is a seam.

**Valid after the final decisions:** yes
**Depends On:** 22, 23, 24
**Enables:** 28, 30, 31

**Related documentation:** `docs/multi-hospital/CLIENTS_CHECKLIST.md` PA-1…PA-11,
`DISCOVERY_AND_BOOKING.md`, `API_CONTRACT_CHANGES.md` §5–§6

> **Correction history.**
> - *First version:* signed-out discovery (G-11, E-01, H-06) and computed slots. Superseded by DR-09 and
>   DR-10.
> - *Second version:* comparison, distance, ratings, insurance, booking rules and record creation were
>   "OD-required". Final:
>   - comparison by specialty, location, distance, next slot, ratings/reviews (OD-10);
>   - insurance-aware for insured patients, **unrestricted for uninsured** (OD-14);
>   - capacity-1 published slots (OD-08);
>   - first-interaction Medical Record and global identity (OD-09).

---

## Objective

A signed-in patient discovers and **compares** hospitals and doctors, sees doctor-published slots,
books, and sees each hospital's Medical Record separately.

## Owner decisions it implements

DR-02, DR-03, DR-04, DR-09, DR-10, DR-11, DR-12, OD-06, OD-08, OD-09, OD-10, OD-14, all FINAL. OQ-02
(record-claim identity proofing, RA-030.1) is open and deferred to implementation. It gates only PA-11
and does not change the architecture.

## Deliverables

- [ ] [PATIENT-APP] Discover only when signed in. Signed out: sign-in, registration, Emergency (PA-1)
- [ ] [PATIENT-APP] Hospital search and profile with clinics and multiple locations (PA-2)
- [ ] [PATIENT-APP] Doctor search (PA-3)
- [ ] [PATIENT-APP] Comparison with distance, ratings/reviews and next slot (PA-4)
- [ ] [PATIENT-APP] Insurance-aware vs unrestricted behaviour (PA-5)
- [ ] [PATIENT-APP] Published slots only (PA-6)
- [ ] [PATIENT-APP] Booking with 409/422 handling (PA-7)
- [ ] [PATIENT-APP] Per-hospital "My records" (PA-8)
- [ ] [PATIENT-APP] Patient AI under the same isolation and retention model (PA-9)
- [ ] [PATIENT-APP] Cache separation (PA-10)
- [ ] [PATIENT-APP] Record claim only after OQ-02 (PA-11)
- [ ] [TESTING] N-19, N-20, N-21 client side; cache isolation; parity suite. Gate: `npm --prefix
  patient-app run typecheck && lint && test && build`

## Blocking conditions

Phases 23 and 24 (per screen).

## Security requirements

No discovery or booking data without a session. Gates **G-4** (client) and **G-7**.

## Downstream phases

28, 30, 31

## Source / evidence

- `origin/patient-app:patient-app/PATIENT_FRONTEND_CHECKLIST.md` (2026-10-06 notes now partly
  superseded)
- `origin/patient-app:patient-app/docs/ARCHITECTURE.md` line 706
