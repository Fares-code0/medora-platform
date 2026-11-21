# Decision brief — BR-DEC-003, BR-DEC-005, BR-DEC-006 and M10.7 (2026-10-30)

**For:** the project owner. **Purpose:** each item below is blocked on a business or
authorization rule that no document states. This brief quotes the authoritative wording,
states the exact question, lists the options with their consequences, and gives a
recommendation. **Nothing here is decided, and no option has been implemented.** A
recommendation is an engineering opinion offered to make the decision quicker; it is not a
choice made on the owner's behalf.

**Sources, read on 2026-10-30:**

- `frontend/FRONTEND_CHECKLIST.md` on `origin/frontend` at **`4b4c8d1`** — §9.0 (requirements
  table) and §14.1 (decision records DEC-003, DEC-005, DEC-006, DEC-006a). This is the
  authoritative source for BR-DEC-*; `backend/docs/FRONTEND_DECISION_REQUIREMENTS.md` mirrors it.
- `docs/DECISIONS.md` on `origin/backend` at **`c93c233`** — ADR-005 (RA-005.1), ADR-030 (RA-030.1).
- `backend/docs/BACKEND_API_CONTRACT.md` §4.11; `backend/docs/BACKEND_IMPLEMENTATION_ROADMAP.md` M10.7.
- `docs/multi-hospital/OWNER_DECISIONS.md` — **FINAL** owner decisions, cited where they
  already constrain an answer (DR-05).

**How to answer:** a letter per decision (e.g. "D3-1: B, D3-2: A") is enough to start. Each
decision lists what would then be built and whether it needs a migration.

---

## Summary

| # | Item | Decision needed | Recommendation |
|---|---|---|---|
| D3-1 | BR-DEC-003 point 5 | Who may correct and remove a history event, and resolve an alert | **B** — a clinician holding `records.edit` who can reach the chart |
| D3-2 | BR-DEC-003 point 4 | Who may see removed and superseded history entries | **A** — anyone who may read the live chart, marked |
| D5-1 | BR-DEC-005 | Report or refuse a week that strands appointments | **C** — refuse unless the client acknowledges the stranded list |
| D5-2 | RA-005.1 | May a doctor's hours fall outside the clinic's working days | **C** — allowed, reported as a warning |
| D6-1 | BR-DEC-006 part 1 | Which lab orders a `laboratory` account may reach, and what it may do | **A** — every order in the clinic (DR-05), new capability, identity visible |
| D6-2 | BR-DEC-006 part 2 | The pharmacy capability set and what "dispense" records | **A** — view + dispense capabilities, clinic-wide, whole-quantity dispense |
| D6-3 | BR-DEC-006 part 3 | Reception booking on behalf, and check-in | **A** — any doctor in the clinic, new capability; identity visible for the day's appointments |
| D6-4 | API-W09 | Whom a staff account may open a message thread with | **B** — clinic staff only, not patients |
| D10-1 | M10.7 | Address patient governance by account or by record | **A** — by account now; record view after RA-030.1 |
| D10-2 | M10.7 | "Approve pending access requests" | **B** — drop from M10.7; it is Multi-Hospital Phase 22A's grant model |

---

## BR-DEC-003 — History correction and removal

### Authoritative wording (FRONTEND_CHECKLIST §14.1, DEC-003, APPROVED 2026-10-21, Option D)

> 2. **Medical history events.** *Edit* (correct an inaccurate event) and *Remove* (an event
> added in error), each with a **mandatory reason**, preserving the original and its audit
> history — versioned correction or soft deletion, never irreversible deletion — and marking
> corrected or removed entries where the data model supports it.

> **Backend requirement BR-DEC-003 (mandatory before history correction ships).**
> 1. A history-correction route (e.g. `PATCH /patients/:id/history/:eventId`) that writes a
> **new version** rather than overwriting, keeping the original readable.
> 2. A **mandatory `reason`** on history correction and removal, and an optional-or-mandatory
> `reason` on contact removal and alert resolution, persisted with the record — not only in a
> log line.
> 3. For every correction, removal and resolution: **actor, timestamp, target record, and
> before/after values**, in an audit trail that cannot be silently overwritten.
> 4. A read that can return removed and superseded history entries, **marked as such**, for
> clinicians permitted to see them.
> 5. **Server-side authorization** on all of the above (who may correct, remove, resolve),
> effective for direct API calls, not only the UI.

> **Update 2026-10-24.** … Still blocked: history **correction** (no route, point 1) and
> showing removed entries as removed (no read, point 4). Who may (point 5) is unchanged and
> remains the owner's.

### What is built (verified, PR #101)

Point 2 in full. Removal requires a reason (422 without), stored on the soft-deleted row;
contact removal and alert resolution take an optional reason. Point 3 in part: actor, time and
target are audited, and the before-state is the kept row. **Today's who-may rule** is
`@Can('patients.view')` plus `assertCanReach`. Because `canReach` is false for every
non-doctor role, in practice this means **any doctor with a care relationship to the patient**.

### D3-1 — Who may correct and remove a history event, and resolve an alert?

| Option | Rule | Consequences |
|---|---|---|
| **A** | Keep today's rule: any doctor who can reach the chart | No change for removal or resolution. Correction gets the same rule. `patients.view` is also held by reception, lab and pharmacy, so this stays doctor-only only while `canReach` excludes them; widening reach later (D6-1, D6-3, DR-05) would silently widen who may correct history |
| **B** | A clinician holding **`records.edit`** who can reach the chart | Ties the rule to a clinical-authoring capability (the doctor bundle holds it; reception, lab and pharmacy do not), so widening read access later does not widen write access. Correction, removal and resolution use one check. No migration |
| **C** | Only the event's author, as BR-DEC-001/004 did for chart notes and records | Strongest attribution. But history events are shared facts (a diagnosis, a surgery), not one clinician's note: a colleague who finds an error cannot correct it, and events entered at registration have a front-desk or importer author |
| **D** | B, plus administrators | An administrator correcting clinical history contradicts reconciliation §5 rule 5 (holding a capability is not a care relationship). Not recommended |

**Recommendation: B.** It is the rule that stays correct when access widens (DR-05 moves
doctors to hospital + role + permissions). It also keeps clinical writes behind a clinical
capability rather than behind "can see the patient". *Once decided:* `PATCH …/history/:id`
with a mandatory reason, writing a new version. The technical form is a version table keyed to
the event, the shape `record_versions` already uses for BR-DEC-004. Needs **one additive
migration**.

### D3-2 — Who may see removed and superseded entries?

| Option | Rule | Consequences |
|---|---|---|
| **A** | Anyone who may read the live chart, with entries **marked** removed or superseded and the reason shown | What DEC-003's "marking corrected or removed entries" reads as. A reader sees why the record changed. No new rule to maintain |
| **B** | Only those who may write (D3-1) | Readers of the chart cannot tell that it was corrected, which is the hidden-history problem DEC-003 set out to avoid |
| **C** | Administrators and audit only | Turns a clinical record question into an audit one; clinicians lose the context |

**Recommendation: A.** *Once decided:* `GET …/history?include=removed,superseded`, using the
soft-delete extension's explicit opt-in, with `removedAt`, `removalReason` and `supersededBy`
on each entry. No migration beyond D3-1's.

---

## BR-DEC-005 — Availability changes that strand appointments; RA-005.1

### Authoritative wording

FRONTEND_CHECKLIST §9.0:

> **BR-DEC-005** | DEC-005 | `PUT /me/availability` reports (or, by policy, refuses) a week that
> leaves live future appointments outside the new hours, returning the affected appointment ids
> … Separately, decide **RA-005.1** (may a doctor's hours fall outside clinic opening hours?)
> and, if they may not, enforce it server-side and serve clinic hours to the client.

DEC-005 agreed behaviour:

> 6. Nothing is cancelled or rescheduled automatically; a save never implies existing bookings
> were resolved. … 9. No clinic hours are invented and no clinic-hour restriction is enforced
> without an approved policy and an authoritative source.

ADR-005, residual ambiguity:

> **RA-005.1 — May a doctor's availability fall outside `clinic_working_days`?** No source
> states whether the clinic's hours bound a doctor's grid. This ADR does **not** enforce a
> bound — the two tables are independent as specified.

### What is built (verified, PR #94)

Report mode. Every `PUT /me/availability` answers with `stranded[]` (live appointments outside
the saved week, computed in the clinic's timezone) and serves `clinicTimezone`. The save always
succeeds and nothing is moved.

### D5-1 — Report or refuse?

| Option | Rule | Consequences |
|---|---|---|
| **A** | Report (today) | A save through the API directly strands bookings with only a report in a response no one may read. The web client shows the report |
| **B** | Refuse (409) any week that strands appointments | The doctor must reschedule first, then narrow their hours. Safe, but blocks a legitimate change, such as a doctor leaving on a known date, until every booking is resolved |
| **C** | Refuse (409, listing `stranded[]`) **unless** the request carries an explicit acknowledgement (e.g. `acknowledgeStranded: true`), then save and report | The API-direct case is protected. The doctor stays in control, and nothing moves automatically (DEC-005 item 6). The client already shows the list before saving, so it sends the acknowledgement after the doctor confirms. Audit records that the acknowledgement was given |

**Recommendation: C.** It is the one reading of "reports (or, by policy, refuses)" that
protects a direct API call without blocking a deliberate change. *Once decided:* a body field
and a 409 path on `PUT /me/availability`. No migration. Needs a matching client change, so it
should land with a frontend task.

### D5-2 — RA-005.1: may a doctor's hours fall outside the clinic's working days?

The authoritative source for clinic hours now exists: `clinic_working_days`, edited at
`/administration/working-days` (M23.3).

| Option | Rule | Consequences |
|---|---|---|
| **A** | Independent (today) | No restriction. Doctors may publish hours on a day the clinic is closed |
| **B** | Bounded: refuse (422 per day) windows outside the clinic's working day | Enforces the clinic's calendar. Breaks on-call, telehealth or extended-hours arrangements, and becomes wrong per location once Multi-Hospital adds locations (API-W03) |
| **C** | Allowed, but reported as a warning (`outsideClinicHours[]` beside `stranded[]`) | Surfaces likely mistakes without forbidding legitimate exceptions. Changes nothing for existing grids |

**Recommendation: C**, revisited when per-location hours land. *Once decided:* a read of
`clinic_working_days` in the availability save, and doctors able to read clinic hours (today
they cannot read `/administration/*`). No migration.

---

## BR-DEC-006 — Reception, Laboratory and Pharmacy workflows

### Authoritative wording (FRONTEND_CHECKLIST §9.0)

> **BR-DEC-006** | DEC-006 / 006a | Laboratory: a technician scoping model (which orders a
> `laboratory` account may reach — department, site or worklist), and lab-role access to
> `/lab-orders` list/detail, `…/transition`, `…/results`, `…/attachments` without
> `requireDoctor`. Pharmacy: a pharmacy capability set and routes to list, view and dispense
> prescriptions (none exists; all of `/prescriptions/*` requires `prescriptions.create`).
> Reception: booking, cancelling and rescheduling **on behalf of** a doctor (today
> `/appointments/*` is `requireDoctor`), and check-in / waiting-room routes … All three: staff
> messaging …

DEC-006 condition: *"no invented permissions, workflows or endpoints"*. That condition is why
each of the following needs the owner. In-code record D-14.2 (`lab-order.service.ts`):
*"deciding what scopes a technician (their department? every specimen in the building?) … is an
authorization design decision and not this milestone's to invent."*

Owner decision **DR-05 (FINAL)**: *"A doctor's normal access = the doctor's active Hospital +
role + permissions. It is not determined universally by doctor–patient assignment."* It speaks
of doctors, but it is the owner's stated access model.

**Today's bundles** (`prisma/seed/permissions.ts`):
- laboratory: `patients.view, records.view, labs.review, messages.send`
- pharmacy: `patients.view, messages.send`
- reception: `patients.view, appointments.manageOwn, appointments.reassign, messages.send, communications.viewMetadata`

### D6-1 — Laboratory: which orders, which actions, which identity?

| Option | Scope | Consequences |
|---|---|---|
| **A** | **Every lab order in the clinic** (later: in the technician's active hospital) | DR-05's model applied to the lab. Simple and correct for a single-site clinic. Every read audited, which is DR-05's compensating control. No migration |
| **B** | Orders whose `department_id` matches the technician's department | Needs each laboratory account linked to a department. Accounts have no department today; `staff_members.department_id` exists but its `user_id` link is optional, so it needs a migration or a data rule. `lab_orders.department_id` is nullable, so orders with none would be unreachable |
| **C** | A worklist: orders explicitly assigned to a technician | Needs assignment data and a UI to assign. Most precise, most process |

Two further sub-questions, whatever the scope:

- **Actions:** list and detail, specimen transitions, result entry and attachments for the
  technician; **review and sign-off stay a doctor's** (`labs.review` is today in the laboratory
  bundle, and its name suggests clinical review). Recommendation: a new capability **`labs.process`**
  for the technician actions. Whether `labs.review` stays in the laboratory bundle is a
  question to answer with it.
- **Patient identity:** a technician labelling a specimen needs the patient's name, date of
  birth and MRN. The masked projection is a wrong-patient risk at the bench. Recommendation:
  clear identity **on lab-order views only**, audited, with no general chart access.

**Recommendation: A, with `labs.process` and clear identity on order views.** *Once decided:*
a scope rule in `LabOrderService` replacing `requireDoctor` for these routes, and a capability
added to the catalogue. Adding a capability is a **cross-tree change**: `frontend/src/types/auth`
is the source of truth, and the parity specs bind the two, so it is frontend and backend
together.

### D6-2 — Pharmacy: capability set and "dispense"

| Option | Rule | Consequences |
|---|---|---|
| **A** | New `prescriptions.view` + `prescriptions.dispense`; clinic-wide; dispense moves `active → dispensed` for the **whole** prescribed quantity, recording who and when | Uses the existing status (`DISPENSED`). One action, auditable. No migration if only who and when are recorded |
| **B** | A, plus partial dispensing (quantity, batch or lot, remaining balance) | Real-pharmacy fidelity. Needs a dispensing-events table (migration) and rules for when a partially dispensed prescription is complete |
| **C** | View only (no dispense) for now | Unblocks the workspace's read half without a write. Pharmacists still dispense outside Medora |

Sub-questions: may pharmacy see prescriptions in `draft` or `pending-approval`
(recommendation: no, only `active` and later); may pharmacy refuse or return a prescription
to the prescriber (recommendation: not in the first step).

**Recommendation: A.** *Once decided:* two capabilities (cross-tree, as above), a pharmacy
list and detail route, and a dispense transition in the existing status machine.

### D6-3 — Reception: booking on behalf, and check-in

| Option | Rule | Consequences |
|---|---|---|
| **A** | Reception may book, cancel and reschedule for **any doctor in the clinic**, under a new capability (e.g. `appointments.manageOthers`), with every action attributed to the reception user and visible to the doctor | Matches a front desk. The doctor's own status-machine rules still apply (no override of what a doctor could not do) |
| **B** | Only for doctors in the receptionist's department | Same department-link gap as D6-1 B |
| **C** | Only for doctors who have delegated to that receptionist | Needs a delegation model and UI |

Check-in and waiting room: the routes exist (M23.4) but are `@Roles('admin')`. The question is
whether reception gets them under the same new capability. Recommendation: yes.

**Patient identity at the desk:** reception today sees the **masked** directory, and a
receptionist cannot check in a patient they cannot identify. Recommendation: clear identity for
**patients with an appointment that day** (or for the appointment being booked), audited, with
no general chart access.

**Recommendation: A, with check-in under the same capability and day-scoped identity.**

### D6-4 — API-W09: whom may a staff account message?

Today any holder of `messages.send` may open a thread with **any active account** (verified,
PR #98).

| Option | Rule | Consequences |
|---|---|---|
| **A** | Anyone (today) | Includes patients' accounts. A pharmacist could message a patient directly |
| **B** | Clinic staff only (any non-patient role), not patients | Covers the internal coordination DEC-006 asks for. Patient messaging stays a clinician's |
| **C** | B, plus patients the staff member has a workflow link to (an appointment today, an order) | Useful later. Needs the D6-1 to D6-3 scope rules first |

**Recommendation: B**, plus a directory route listing whom the caller may message. Without
that route the web client cannot pick a recipient at all (FRONTEND_CHECKLIST D-24).

---

## M10.7 — Admin patient governance

### Authoritative wording

API contract §4.11:

> Admin governance [SPEC UX §3.4]: `GET /admin/patients` (masked columns) · `GET
> /admin/patients/{id}` (profile/activity/permissions tabs) · `POST …/unlock` ·
> `/reset-credentials` (sends secure reset — admin never sets a password) · `/deactivate` (P4) ·
> access-grant list/revoke/approve | can:`patients.manageAccounts`

Roadmap M10.7 (assessed 2026-10-24): *"BLOCKED — on two decisions, not on engineering … No
patient account is linked to a patient record, by design … The contract addresses every control
through the record … so each would find no account for every patient today … 'Approve pending
access requests' has no model."*

ADR-030 RA-030.1: *"How a registered patient account becomes linked to `PT-1042` is a separate
decision with an identity-proofing requirement … Auto-linking on email is ruled out; everything
else remains open."*

### D10-1 — Address account controls by account or by record?

| Option | Rule | Consequences |
|---|---|---|
| **A** | **By account now:** `GET /admin/patient-accounts`, `POST /admin/patient-accounts/{usr_…}/unlock`, `/reset-credentials`, `/deactivate`. The record-based `/admin/patients/{id}` view arrives with RA-030.1 | An administrator can unlock, reset and deactivate the patient accounts that exist today (patients registered through the app). Reuses the M8.2 mechanics (lockout columns, `PasswordRecoveryService`, soft deactivation). It is a different URL shape from the contract's, so the contract needs an amendment |
| **B** | Wait for RA-030.1 and build the contract as written | No administrator control over patient accounts until identity proofing is decided |

**Recommendation: A.** Patient accounts exist now, and so does the need to unlock one. *Once
decided:* four routes behind `patients.manageAccounts` and a contract amendment. No migration.

### D10-2 — "Approve pending access requests"

| Option | Rule | Consequences |
|---|---|---|
| **A** | Design a pending-request model on `patient_access_grants` now | `patient_access_grants` has no pending state, nothing writes it and no authorization path reads it. It would be a grant model built twice |
| **B** | **Drop it from M10.7** and take it from Multi-Hospital Phase 22A, where the owner has already decided the grant model (OD-01…OD-04: purpose-bound, category-scoped, approved by the target Hospital Admin, revocable) | One grant model, the one the owner already chose |

**Recommendation: B.**

---

## What is not in this brief, and why

- **Rate limiting and `TRUST_PROXY`** are deployment facts, not business rules. See
  `RATE_LIMITING.md` for the checklist the deployment completes.
- **The first administrator** is decided (owner instruction, 2026-10-30) and implemented. See
  `PRODUCTION_SETUP.md`.
- **`DATA_ENCRYPTION_KEY` rotation** is engineering work (a dual-key decrypt and a
  re-encryption job), recorded as open in `PRODUCTION_SETUP.md` §2.
