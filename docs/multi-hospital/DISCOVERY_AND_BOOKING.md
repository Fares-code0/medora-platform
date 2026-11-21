# Multi-Hospital — Discovery and Booking

**Governing decisions (FINAL):** DR-09, DR-10, DR-11, OD-08, OD-09, OD-10, OD-14 (with DR-01, DR-02,
OD-06).
**Work phases:** 23 (authenticated discovery), 24 (published slots and booking), 27 (patient app).
**Status:** NOT STARTED.
- Today: an authenticated single-clinic doctor roster only.
- No slots, no geo data; `ratingAvg` is never written.
- Patient booking is incomplete (AF-18, AF-21, AF-22).

> **Superseded (do not build):**
> - signed-out / public discovery (G-11, E-01, H-06, API-P01–P08 as public);
> - computed slots from working hours (API-P11, I-04);
> - multi-affiliation doctors.

---

## 1. Canonical flow — OWNER APPROVED

```text
Sign in (login / identity verification)
   ↓
Discover Hospitals ─┐
Discover Doctors  ──┼─ Compare (specialty, location, distance, next slot, ratings/reviews, insurance)
   ↓                ┘
Select Doctor
   ↓
View Doctor-Published Online Slots
   ↓
Book (one slot, one patient)
```

- **No unauthenticated discovery.** Signed-out users see no hospitals, doctors, departments,
  specialties, locations or slots (DR-09).
- **No hospital relationship is needed to search** (DR-09).

## 2. Discovery and comparison (OD-10)

| Field | Source (TECHNICAL RECOMMENDATION) |
|---|---|
| Hospital, clinic, location | `Hospital`, `Clinic`, `HospitalLocation` (multiple locations per hospital, OD-06) |
| Doctor, specialty, department | Doctor + active employment (DR-02) |
| Distance | Location coordinates and the patient's **per-request** position; not stored. Shown only when both are known |
| Next available | Earliest future `PUBLISHED` slot (DR-10) |
| Ratings / reviews | `satisfaction_surveys` (`rating`, `comment`) from completed appointments. Aggregated per doctor; review text moderated. **No clinical or identifying content**, and nothing that weakens hospital isolation |
| Insurance | Coverage per hospital/doctor/service vs the patient's insurance (OD-14) |

Example (OD-10): *Search "Cardiology" → Hospital A · Dr. Ahmed · ★4.8 · 2.1 km · Today 16:00 /
Hospital B · Dr. Sara · ★4.6 · 5.4 km · Tomorrow 10:00.*

Listing rule: doctors without an active employment are not discoverable and have no slots (DR-02).
Verified/active only (existing G-08 rule).

## 3. Insurance (OD-14)

| Patient | Discovery | Booking |
|---|---|---|
| **Has insurance** | Insurance-aware: covered hospitals, doctors and services are prioritized or shown, and coverage is indicated | Booking **validates** applicable coverage |
| **Has no insurance** | **Unrestricted:** all available hospitals, all doctors, all published slots | Books under normal rules; no coverage check |

"No insurance" is never "no access". TECHNICAL RECOMMENDATION:
- The patient's coverage lives on the global identity (OD-09). It is person-level administrative
  data.
- Hospital/doctor/service coverage lives on the hospital side.

## 4. Published online slots (DR-10)

| Concept | Meaning |
|---|---|
| Working hours | Internal scheduling/business data (`doctor_availability`). **Never** exposed as bookable inventory |
| Published slot | A specific time the doctor published online. **The only patient-facing inventory.** Capacity 1 |

Example: working hours 08:00–16:00; published 10:00, 10:30, 11:00, 14:00, 14:30.

- The doctor publishes and withdraws slots.
- A slot belongs to the doctor's active hospital (and optionally a clinic and location) at publish
  time.
- TECHNICAL RECOMMENDATION: publishing outside working hours or inside time-off is refused or flagged.

## 5. Booking (DR-11, OD-08, OD-09)

A booking has exactly one **patient, hospital, doctor, date and published slot**.

```text
Patient (signed in) ── POST /me/appointments {slotId, …} + Idempotency-Key
   │
   ▼  one transaction
   slot PUBLISHED & future? ── no ──▶ 409 slot_taken
   insured? → coverage valid? ── no ──▶ 422 insurance_not_covered   (uninsured: skip)
   slot PUBLISHED → BOOKED (atomic conditional update / row lock)
   Appointment {patient, hospital ← slot, doctor ← slot, startsAt ← slot, slotId}
   first real interaction with this hospital? → create Medical Record @ hospital (OD-09)
```

Concurrency is guaranteed by the database (TECHNICAL RECOMMENDATION):
- an atomic conditional transition;
- unique booking per slot (partial unique index);
- a per-doctor overlap exclusion constraint;
- idempotent retries (ADR-014).

Test: N concurrent bookings of one slot → exactly one success (G-6).

## 6. Booking policies (implementation policy, OD-08)

Cancellation windows, rescheduling, no-show handling, lead time and horizon, slot duration and
auto-confirm vs approval are **implementation policy** specified in Phase 24. Constraints:
- they must never permit capacity > 1;
- they must never expose non-published times;
- they must never move an appointment across hospitals.

Related existing ADR: ADR-033 (patient appointment actions); its RA-033.1 booking question is answered
by OD-08 at the model level.

## 7. Client responsibilities

| Client | Responsibility |
|---|---|
| Patient app | Sign-in before Discover; search, filter and compare (distance, ratings, next slot, insurance); slot display; booking with 409/422 recovery; per-hospital Medical Record context. Signed out: only sign-in, registration and Emergency (N-12) |
| Doctor web | Publish and withdraw slots at the active hospital; see bookings; no hospital picker |
| Hospital Admin web | Clinics, locations, insurance acceptance, booking-policy configuration for the hospital; oversight |
