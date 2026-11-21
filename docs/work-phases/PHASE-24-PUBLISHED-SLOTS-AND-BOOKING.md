# Phase 24 — Doctor-Published Online Slots & Hospital-Scoped Booking

**Previously:** "Availability & Multi-Hospital Booking"
(`PHASE-24-AVAILABILITY-AND-MULTI-HOSPITAL-BOOKING.md`), renamed on 2026-10-07.
**Origin:** audit-derived; reconciled with the FINAL owner decisions on 2026-10-07
**Primary Area:** Backend + Database
**Status:** NOT STARTED
**Valid after the final decisions:** yes
**Depends On:** 21, 22, 23
**Enables:** 25, 27, 30

**Related documentation:** `docs/multi-hospital/DISCOVERY_AND_BOOKING.md` §4–§6,
`API_CONTRACT_CHANGES.md` §6, `DATA_MODEL_CHANGES.md` §4
Backend tasks for the patient AI assistant (added 2026-10-10): `BACKEND_CHECKLIST.md` §K and
`API_CONTRACT_CHANGES.md` §10.

> **Correction history.**
> - *First version:* computed slots per location (API-P11, API-W03). Superseded by doctor-published
>   slots (DR-10).
> - *Second version:* booking rules were "OD-08 required" and record creation "OD-09 required".
>   Superseded:
>   - capacity 1 per published slot, with atomic, concurrency-safe booking (OD-08); cancel, reschedule,
>     no-show and lead time are implementation policy;
>   - the Medical Record is created on the first real interaction (OD-09);
>   - insured patients' coverage is validated, uninsured patients unrestricted (OD-14).

---

## Objective

- Doctors publish online slots (capacity 1) at their active hospital, optionally per clinic and
  location.
- Signed-in patients see only those slots and book one.
- Exactly one of N concurrent bookings succeeds.

## Owner decisions it implements

DR-10, DR-11, OD-06, OD-08, OD-09, OD-14, all FINAL.

## Deliverables

- [ ] [BACKEND] Publish, withdraw and list slots (`/me/published-slots`); working hours remain internal
- [ ] [BACKEND] Patient slots endpoint: published, unbooked, future only
- [ ] [BACKEND] Booking transaction: atomic slot transition, idempotency, hospital and doctor from the
  slot, `409 slot_taken`
- [ ] [BACKEND] Insured patients: coverage validation (`422 insurance_not_covered`); uninsured: no check
- [ ] [BACKEND] First real interaction → hospital Medical Record (exact trigger specified here)
- [ ] [BACKEND] Patient actions per implementation policy (cancel, reschedule, no-show, lead time),
  never capacity > 1
- [ ] [DATABASE] Booked-slot uniqueness and overlap exclusion
- [ ] [TESTING] N-17, N-18, N-21; timezone tests across locations

## Blocking conditions

Phases 21, 22 and 23.

## Security requirements

- Hospital always from the slot.
- Gate **G-6**.

## Downstream phases

25, 27, 30

## Source / evidence

- `05-patients.prisma` `DoctorAvailability`
- `07-scheduling.prisma` `Appointment`
- ADR-033 / RA-033.1 (answered at model level by OD-08)
