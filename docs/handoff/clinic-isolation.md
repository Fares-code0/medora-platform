# Clinic isolation — what the frontend does, and what the backend must

**Status:** the frontend half ships (FRONTEND_CHECKLIST D-27b). The backend
half does not exist yet, and **the property is not delivered until it does.**
**Audience:** backend and data-access. Nothing in this document is optional
for a multi-clinic deployment.

> ⚠ **Realigned 2026-10-06 — multi-organization.** The owner has decided
> that Medora is a multi-hospital / multi-clinic platform. Two statements in
> §1 below were written for D-27b and no longer hold: *"one doctor, one
> primary clinic"* and *"an administrator is not clinic-scoped"*. §1 now
> states the current policy, with the superseded wording kept beneath it.
> §2 and §4 — the line between client and server, and what the backend must
> enforce — are unchanged and apply to every organization-scoped resource.
> The frontend's API dependencies are listed in
> `frontend/FRONTEND_CHECKLIST.md` §9.1. The tenancy decision is not yet in
> `docs/DECISIONS.md` (next free number: ADR-042).

> ⚠ **Superseded in part — 2026-10-07.** The owner's FINAL decisions make the
> **Hospital** the isolation boundary. A Clinic is a unit inside a hospital, not
> a boundary, and a doctor has one active hospital employment with no switcher.
> Cross-hospital access is only an audited **grant** or audited emergency
> **Break-Glass**. Where this document conflicts with them, they win:
> [`docs/multi-hospital/OWNER_DECISIONS.md`](../multi-hospital/OWNER_DECISIONS.md)
> and [`SECURITY_AND_DATA_ISOLATION.md`](../multi-hospital/SECURITY_AND_DATA_ISOLATION.md).

---

## 1. The policy

Medora is a multi-organization platform: many hospitals, clinics and
medical centers, each with one or more locations.

- A doctor may hold **memberships in several organizations**, each approved
  by that organization, and works in one **active organization** at a time.
  The active organization comes from the session, never from a request.
- In its active organization, a doctor may view, access, create, update and
  manage that organization's data. Clinical data is **organization-scoped**
  by default. A doctor may access data outside the doctor's active
  organization only through an explicitly approved future sharing
  mechanism. A doctor with multiple organization memberships may access each
  organization's data only within that organization's context.
- Administration is split. An **organization admin** is scoped to one
  organization and may never reach another's. A **platform admin** handles
  platform concerns (organizations, verification, platform settings).
  Clinical-record access is not part of the approved platform-admin scope;
  any such access needs an explicit owner decision. Existing Admin accounts
  require an explicit migration mapping to either Organization Admin or
  Platform Admin. No automatic conversion is approved.

**Superseded wording (D-27b, 2026-09-02), kept for the record:** *"Medora is
multi-clinic. The product model is one doctor, one primary clinic … An
administrator is not clinic-scoped. Platform administration spans clinics,
so 'no clinic' on an admin account means unscoped."* The distinction it drew
— *unscoped* is a different claim from *scoped to nothing* — still matters,
and now belongs to the platform admin alone.

## 2. The line

> **Client-side checks are not the security boundary and must never be
> treated as one.**

Everything a client filters, a client can unfilter: change a variable in a
debugger, replay a request with a different id, or simply read the response
that already contained the other clinic's rows. A row that reaches the
browser has already left the building.

What the frontend owes the policy is narrower and still worth having: it
never *displays* another clinic's data and never *offers* an action against
it. That is a correctness and honesty property. The isolation itself is
server-side, on every read and every write.

## 3. What the frontend now does

| Piece | Where | What it is |
| --- | --- | --- |
| `clinicId` on the session | `src/types/auth/index.ts`, `features/auth/mock/` | The doctor's primary clinic, issued with the session by the **mock only**. Optional — absent on an admin means unscoped; absent on a **doctor** means nothing to show (fail closed, AF-17, 2026-10-26). *Realigned 2026-10-06:* to be replaced by the server-issued active organization and memberships (FRONTEND_CHECKLIST ORG-01, API-W01). |
| `ClinicScope` + filters | `features/shared-domain/clinic-scope/` | `visibleToScope`, `ownedByDoctor`, `isInScope`. Pure, tested, and documented as **not** a boundary. |
| `useClinicScope()` | `features/doctor/clinic/useClinicScope.ts` | Derives the scope from the session — never from a route param, because a scope the URL can set is a scope the URL can widen. A doctor whose session names no clinic gets `null`, and the board renders an explicit empty state without fetching (AF-17, CLIENTS_CHECKLIST WEB-5; until 2026-10-26 that case fell through to the admin's "every clinic"). |
| Attribution on the model | `features/shared-domain/clinic-operations/types.ts` | `QueueEntry` and `WaitingPatient` carry `clinicId`, `doctorId` and `patientId`. This is what D-27b was actually blocked on. |
| The doctor board | `features/doctor/clinic/pages/MyClinicPage.tsx` | Shows the doctor their own clinic, and their own patients within it. |

Two deliberate choices worth keeping when the server arrives:

- **Unattributed rows fail closed.** A row whose `clinicId` does not match is
  excluded, and a row with no clinic is excluded too — an unattributed row is
  one nobody can prove belongs here, and defaulting it visible is what a leak
  looks like in a demo.
- **Other clinicians' patients are reduced to a count, not hidden.** "Three
  people are waiting, none for you" is operationally useful and carries no
  patient identity. A silently empty board reads as a bug and gets
  worked around.

## 4. What the backend must enforce

1. **Derive the clinic from the session, never from the request.** No
   endpoint may accept a `clinicId` parameter that widens what the caller
   sees. If a client sends one, it is a filter *within* the caller's scope at
   most — never a selector of scope.
2. **Scope every read.** List, get, search, export, aggregate, count. An
   aggregate is a read: a cross-clinic average, a "patients waiting" total,
   or a report row leaks membership and volume even when it names nobody.
3. **Scope every write.** Create, update, delete, state transitions. A write
   must be refused when the target belongs to another clinic — and refused
   *server-side*, not merely absent from the UI.
4. **Return 404, not 403, for another clinic's resource id.** A 403
   confirms the id exists, which is itself a cross-clinic disclosure.
5. **Stamp the clinic on create from the session**, not from the payload.
   A client-supplied `clinicId` on a create is an attempt to write into
   another clinic, and should be rejected rather than trusted or corrected.
6. **Enforce at the data-access layer, not per-controller.** One place that
   cannot be forgotten beats N places that can. A per-endpoint check is one
   new endpoint away from a hole.
7. **Audit cross-clinic denials.** A denied read is the signal that something
   is either misconfigured or probing; it should be visible in the log
   ADM-07 already renders.
8. **Test the negative.** For each resource: doctor A cannot read, list,
   update or delete doctor B's clinic's row — by direct id, by search, by
   export, and by aggregate.

## 5. Known gaps the backend has to close

These are frontend-visible today and cannot be fixed from the frontend.

- **Doctor identity does not resolve against the staff roster.** The
  checklist row named this and it is still true. `staff` is a clinic roster
  (`stf-doc`, "Dr. Lena Hart") with no account behind it; a queue entry has
  to name the account a signed-in doctor actually holds
  (`usr_doctor_amelia`). `CLINIC_DOCTORS` in
  `features/shared-domain/clinic-operations/store.ts` is a seeded stand-in
  for that join. **Needed:** one staff record, one account, one link.
- **Only one clinic is seeded.** The scope filters are exercised against
  synthetic multi-clinic rows in `clinic-scope.test.ts`, but the running app
  has a single clinic, so a real cross-clinic leak cannot be observed in the
  browser yet. A second seeded clinic — server-side — is the first thing to
  add when the endpoints exist.
- **Every other doctor surface is still unscoped.** Appointments, patients,
  records, labs, pharmacy and messaging read stores that have no `clinicId`
  at all. Attribution has to reach those models before the scope can be
  applied to them, and the order matters: attribute, then enforce
  server-side, then reflect in the client. Reflecting first would be
  security theatre.
- **There is no organization context in a real session** (added
  2026-10-06). The access token carries no organization and no membership,
  and the data model has no organization or membership at all. The
  server must issue the active organization and memberships before the
  client can reflect them (FRONTEND_CHECKLIST §9.1, API-W01).
- **Every admin route is platform-wide** (added 2026-10-06). Staff, rooms,
  queue, the patient directory, appointment oversight, reassignment, logs
  and search all answer for the whole platform. Each must be scoped to the
  organization admin's organization, with platform concerns moved to a
  separate platform-admin surface (FRONTEND_CHECKLIST §4, §9.1).
- **ADM-10's masking and this scoping are different controls.** Masking
  governs *which identifiers* an authorised reader sees; scoping governs
  *which rows* exist for them at all. Neither substitutes for the other.
