# Patient-safe projections

**Checklist row:** A-05 · **Audit:** §7, R-3 · **Backend dependency:** BE-04, BE-11
**Status:** specification. The server-side projections it describes do **not exist yet.**

---

## Why this document exists

`doctors` (`backend/prisma/schema/04-people.prisma:21`) holds everything a
patient-facing profile needs — and a set of fields a patient must never see.
`GET /doctors` in the API contract (§3.4) is `can:doctors.manage`: an **admin
roster**. Reusing it as the patient's doctor list would send every
practitioner's licence number and personal mobile number to every patient who
opens the app.

Hiding those fields in the mobile UI does not fix it. The data has already
crossed the wire; anyone running a proxy against their own phone can read it.

> **Frontend authorization is not authorization.** The control is a separate
> server-side projection (BE-04) with a contract test asserting the forbidden
> fields are absent from the response body.

This document is the allow-list that projection must implement, and the
deny-list the client enforces on its own half.

---

## Doctor — patient-safe allow-list

The **only** fields a patient-facing doctor payload may contain.

| Field | Type | Notes |
|---|---|---|
| `id` | string | The doctor's public id |
| `fullName` | string | |
| `title` | string \| null | "Dr", "Prof" — display only |
| `specialty` | string | The display string on `doctors.specialty` |
| `departmentName` | string \| null | Resolved from `departments` (ADR-004) |
| `photoUrl` | string \| null | May legitimately be absent |
| `yearsOfExperience` | number \| null | |
| `languages` | string[] | |
| `biography` | string \| null | |
| `education` | string[] | |
| `ratingAvg` | number \| null | Derived from `SatisfactionSurvey`; null when unrated |
| `hospital` | string \| null | `doctors.hospital varchar(80)` — a free-text display string, not an entity |
| `officeLocation` | string \| null | Where the patient goes |

Mirrored in `src/features/doctors/model/types.ts` as `PatientSafeDoctor`.

### Forbidden — never in a patient-facing response

| Field | Why |
|---|---|
| `license_number` / `licenseNumber` | Professional credential. Disclosing it enables impersonation of the practitioner |
| `license_expires_on` / `licenseExpiresOn` | Same |
| `employee_id` / `employeeId` | Internal HR identifier |
| `contact_email` / `contactEmail` | The doctor's own address. Patients reach clinicians through the clinic or a message thread |
| `contact_phone` / `contactPhone` | The doctor's own number |
| `emergency_contact_name` / `emergencyContactName` | **The doctor's next of kin.** A third party who has no relationship with the patient at all |
| `emergency_contact_phone` / `emergencyContactPhone` | Same |
| `linkedin_url` / `linkedinUrl` | Personal |
| verification documents | Internal compliance artefacts |

Mirrored in `FORBIDDEN_DOCTOR_FIELDS`, and asserted by
`src/test/projections.test.ts`.

### Server-side defaults that are not client filters

Two rules belong to the projection and must **not** be expressible as a client
parameter:

1. **Verified and active only.** `doctors.verification_status = 'verified'` and
   an active `practice_status`. Returning an unverified or suspended
   practitioner to a patient is a safety issue, not a filter preference
   (checklist G-08).
2. **No enumeration.** `GET /public/doctors/{id}` walked over ids is a roster
   dump. Rate limiting (BE-17) does not exist today; it is a prerequisite for
   shipping any public route (audit R-9).

---

## Hospitals, clinics and locations — patient-safe projections

> ⚠ **Multi-Hospital — FINAL (2026-10-07) · Supersedes the 2026-10-06 note below.**
> The owner's final decisions ([`OWNER_DECISIONS.md`](../../docs/multi-hospital/OWNER_DECISIONS.md))
> replace the organization model. None of these projections is built; all are the Backend team's
> ([`API_CONTRACT_CHANGES.md`](../../docs/multi-hospital/API_CONTRACT_CHANGES.md) §5):
>
> - They are served to **signed-in patients only** (DR-09). There is no `/public/*`
>   discovery route and no signed-out discovery, so "public" in the older text below
>   means *patient-safe*, never *unauthenticated*.
> - **Hospital** is the isolation boundary (DR-01). The projection is a **hospital profile**
>   (`GET /patient/hospitals/:id`): `id`, `name`, public phone and website, its **clinics**
>   (a separate entity inside the hospital), its **locations** (several per hospital:
>   address, timezone, hours, coordinates for distance), departments, specialties and
>   accepted insurance (OD-06, OD-14). There is no organization `type`.
> - A **doctor** shows **one active hospital** employment (hospital, clinic, department,
>   location), not an `affiliations[]` list (DR-02).
> - **Distance** is computed from coordinates the client sends per request and never
>   stores; **ratings/reviews** are aggregated from real surveys, moderated and free of
>   clinical or identifying content (OD-10).
> - **Slots** are only doctor-published slots (DR-10), never "server-computed" availability.
>
> The same "never exposes" column below still holds for hospitals, clinics and locations.
> The doctor allow-list above is unchanged.
>
> *The 2026-10-06 multi-organization note, superseded and kept for the record:*
>
> ⚠ **Multi-organization realignment (2026-10-06) · Replace.** Medora is a
> multi-hospital / multi-clinic platform, so the single clinic projection
> below gives way to three public projections — none built yet, all the
> Backend team's (see `PATIENT_FRONTEND_CHECKLIST.md`, *Backend dependency*):
>
> | Projection | Exposes | Never exposes |
> |---|---|---|
> | **Organization** (API-P01, API-P02) | `id`, `name`, `type` (hospital · clinic · medical center), public phone and website, its locations, departments (`id`, `name`, `description`) and specialties | Staff rosters, rooms, resources, queue and waiting-room state, settings, integration configuration, and any count derived from patients |
> | **Location** (inside API-P02) | `id`, `name`, `addressLine`, `city`, `country`, `timezone`, opening hours, holidays; verified coordinates only when they exist (API-P07) | Anything operational about the site |
> | **Doctor affiliations** (API-P03, API-P04) | Per affiliation: organization `id` / `name`, location `id` / `name` / `city`, department `id` / `name` | Membership internals — approval history, internal role, schedule beyond the server-computed slots |
>
> These are served **without sign-in** once rate limiting exists (API-P08).
> Ratings appear only from real survey data (API-P06); distance only from
> real coordinates (API-P07). The doctor allow-list above is unchanged.
>
> *Superseded section, kept for the record:*

`platform_settings` is reachable today only behind `can:settings.manageSystem`.
The public projection (BE-11) exposes the `organization` slice:

| Field | Source |
|---|---|
| `name`, `addressLine`, `city`, `country`, `phone`, `website` | `platform_settings` → `organization` |
| Departments: `id`, `name`, `description` | `departments` (ADR-004) |
| Opening hours | `clinic_working_days` (7 rows) |
| Holidays | `holidays` |

**Not exposed:** rooms (`rooms` is internal operations), staff rosters, resource
status, integration configuration, or any other settings slice.

---

## Emergency numbers — public projection

`GET /public/emergency-contacts` (BE-11). Operator-supplied, per deployment
region.

The app ships with **none**, renders a screen that says so, and never guesses
(see `src/features/emergency/model/types.ts`). Emergency numbers are
country-specific, they change, and a wrong one is a category of harm distinct
from every other bug in this repository.

---

## What the client can and cannot guarantee

| Guarantee | Who holds it | Where |
|---|---|---|
| A forbidden field is not in the response | **Server** (BE-04) | Does not exist yet |
| A forbidden field is not in this app's types | Client | `PatientSafeDoctor` |
| A forbidden field is not in this app's fixtures | Client | `projections.test.ts` |
| No component renders a forbidden field | Client | `projections.test.ts` |
| Unverified practitioners are not returned | **Server** (BE-04) | Does not exist yet |

The two rows that say **Server** are the ones that matter. This document exists
so that whoever writes BE-04 does not have to rediscover them.
