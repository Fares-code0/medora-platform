# Backend Requirements from the Frontend Owner Decisions (BR-DEC-001 … BR-DEC-006)

**What this page is.** A synchronized record, for backend engineers, of the six backend
requirements the project owner's frontend decisions DEC-001 … DEC-006a created on 2026-10-21/22.
It exists because those decisions were recorded in the frontend checklist on `frontend`, and
`backend` carried no copy of them and no reference to them.

**Authoritative source — this page does not replace it.**
`frontend/FRONTEND_CHECKLIST.md` on `origin/frontend` at **`a0142ea`** (merge of PR #78,
2026-10-22): §9.0 *Backend requirements from owner decisions* (line 513), §14 *Decision log*
(line 1081) and §14.1 *Decision records* (lines 1099–1303). Where this page and that source
disagree, the source wins and this page is corrected. The decisions are **not on `main`** as of
`99ef5db`, so working rule 7 (read frontend state from `origin/main`) does not yet reach them;
read the source with `git show origin/frontend:frontend/FRONTEND_CHECKLIST.md` until it is.

> ⚠ **This page documents required work. It is not evidence that any of it is implemented.**
> Every "Backend state" entry below was read from `origin/backend` at **`f19a385`** on
> 2026-10-22 by inspecting source, not by running the API. The presence of a module, route or
> file is recorded as what it is; it is never taken to mean a requirement is met. Nothing here
> has been **verified against a running API** — every requirement's verification status is
> **NOT VERIFIED**.

**Status vocabulary.** Approval: **ACCEPTED** (the owner approved the decision) · **OPEN**
(a question no one has answered). Implementation: **IMPLEMENTED** · **PARTIALLY IMPLEMENTED** ·
**IMPLEMENTATION PRESENT BUT NOT VERIFIED** (code that appears to serve the requirement exists,
but no test or run establishes that it does) · **NOT IMPLEMENTED** · **NOT VERIFIED**. The two
are never combined: an accepted decision can be unimplemented, and that is the normal state of
every row below.

**Two different backends were inspected.** The DEC-001…DEC-006 records describe "the current
backend" as seen from `frontend`, whose `backend/` tree is `main`'s. `origin/backend` is ahead
of it: the messaging module (M20), the administration module (M23) and file storage (M25) are
built here and are empty scaffolds there. Where that changes a requirement's state, the row
says so. **The requirement text itself is unchanged** — it is the text recorded with the
owner's approved decisions in the source. Whether the owner approved that wording separately
from the decision is not stated there.

---

> **Decision brief, 2026-10-30:** [`DECISION_BRIEF_2026-10-30.md`](DECISION_BRIEF_2026-10-30.md)
> quotes each open rule verbatim and gives the options, consequences and a recommendation for
> BR-DEC-003 points 4–5, BR-DEC-005 (refuse-vs-report, RA-005.1), BR-DEC-006 parts 1–3 and
> API-W09, and M10.7. Nothing in it is decided or implemented.

## Summary

| Req | From | Decision status | What the backend must do (short form — full text below) | Blocks | Backend state at `f19a385` |
|---|---|---|---|---|---|
| **BR-DEC-001** | DEC-001 | ACCEPTED 2026-10-21 | Only a chart note's author may edit or sign it, for direct API calls | **Production release** of chart-note edit and sign | **IMPLEMENTED** 2026-10-24 — verified over HTTP against the application and Postgres (see the section) |
| **BR-DEC-002** | DEC-002 | ACCEPTED 2026-10-22 | A route to discard an unsigned prescription draft | Discarding drafts from the client | **IMPLEMENTED** 2026-10-24 — `DELETE /prescriptions/{id}`, a soft delete (ADR-044); verified over HTTP against the application and Postgres |
| **BR-DEC-003** | DEC-003 | ACCEPTED 2026-10-21 | Versioned history correction; persisted reasons; tamper-evident audit; a read of removed/superseded entries; server-side authorization | History edit and remove (NEW-04b); reasons on contact removal and alert resolution | **PARTIALLY IMPLEMENTED** 2026-10-24 — reasons persisted (mandatory on history removal); correction route, removed-entry read and the who-may rule open |
| **BR-DEC-004** | DEC-004 | ACCEPTED 2026-10-21 | Author/role check on `PATCH /medical-records/:id`; a persisted reason per edit | Production release of record editing | **IMPLEMENTED** 2026-10-24 (author only; reason optional) — verified over HTTP against the application and Postgres. Two points remain the owner's: roles besides the author, and whether the reason is mandatory |
| **BR-DEC-005** | DEC-005 | ACCEPTED 2026-10-21 | Report or refuse a weekly grid that strands live appointments; serve the clinic timezone to doctors; RA-005.1 is OPEN | Exact stranded-appointment warnings; any clinic-hours rule | **IMPLEMENTED 2026-10-24 for criteria 1–3 (report mode)** — verified over HTTP against the application and Postgres. Refuse-vs-report and RA-005.1 remain the owner's |
| **BR-DEC-006** | DEC-006 / DEC-006a | ACCEPTED 2026-10-21 | Lab technician scoping; a pharmacy capability set with list/view/dispense; reception booking on behalf of a doctor and check-in/waiting-room access; staff messaging | The unavailable halves of the Reception, Laboratory and Pharmacy workspaces | **NOT IMPLEMENTED** for laboratory scoping, pharmacy and reception workflows. Staff messaging (part 4): **IMPLEMENTED and verified** 2026-10-24 for the three roles' use of `/conversations`; the staff participant rule (API-W09) stays open. Not implemented as a whole |

---

## BR-DEC-001 — Chart notes: only the author may edit or sign

- **Source decision.** DEC-001 *Patient chart notes: create, edit, sign* — ACCEPTED (Option C,
  with conditions), 2026-10-21. Source §14.1, line 1103.
- **Why.** The frontend offers Edit and Sign only on the signed-in user's own unsigned notes, and
  says plainly that this is a display rule, not authorization. Until the server enforces it,
  any clinician who can reach a chart can edit or sign a colleague's unsigned note through the
  API. That was accepted only because nothing is deployed.
- **Required behaviour (as recorded in the source).** `PATCH /patients/:id/notes/:noteId` and
  `POST …/notes/:noteId/sign` must refuse a caller who is not the note's author, for direct API
  requests as well as the UI — as `POST /medical-records/:id/notes/:noteId/sign` already does
  ("Author only").
- **Acceptance criteria** *(derived from the required behaviour; not separately approved by the
  owner).*
  1. A `PATCH` or sign of an unsigned chart note by any user other than its author is refused and
     leaves the note unchanged.
  2. The author can still edit and sign their own unsigned note.
  3. The refusal holds for a direct HTTP request with a valid session, not only via the client.
  4. Signed notes remain uneditable (existing behaviour — 409 `invalid_status_transition`).
- **Release gate.** Chart-note editing and signing is **not production-ready** until this is
  implemented and verified against a running API. PR #78 repeats the warning: do not promote
  `frontend` to production before BR-DEC-001 lands.
- **Two different note systems — only one is in scope.** BR-DEC-001 concerns **chart notes**:
  model `PatientNote`, table `patient_notes`, served under `/patients/:patientId/notes`. It does
  **not** concern **medical-record notes**: model `RecordNote`, table `record_notes`
  (`backend/prisma/schema/08-records.prisma:183`, `:203`), served under
  `/medical-records/:recordId/notes`. The two have separate tables, repositories, services and
  routes.
- **Backend state at `f19a385` — NOT IMPLEMENTED.** Read from source; not run.
  - *The chart note records its author, and nothing compares it with the caller.*
    `PatientNote.authorId` (`author_id`) is at `backend/prisma/schema/05-patients.prisma:292`
    (model at `:289`, `@@map("patient_notes")` at `:313`). Neither chart-note path reads it.
  - *Edit — `PATCH /patients/:patientId/notes/:noteId`.* Route at
    `backend/src/modules/patients/controllers/patient-tabs.controller.ts:167`; the class is
    guarded only by `@Can('patients.view')` (`:72`). `PatientTabsService.updateNote`
    (`backend/src/modules/patients/services/patient-tabs.service.ts:255`) calls only
    `requireReachable` (`:440`–`:453`: the patient exists and the caller has a care relationship,
    via `scope.assertCanReach`). `updateUnsignedNote`
    (`backend/src/modules/patients/repositories/patient-tabs.repository.ts:324`) updates where
    `{ id: noteId, patientId, signed: false }` (`:333`).
  - *Sign — `POST /patients/:patientId/notes/:noteId/sign`.* Route at
    `patient-tabs.controller.ts:178`. `PatientTabsService.signNote` (`patient-tabs.service.ts:279`)
    calls only `requireReachable`. `signNote` (`patient-tabs.repository.ts:354`) updates where
    `{ id: noteId, patientId, signed: false }` (`:358`).
  - *`updatedBy` is a record, not a check.* Both repository methods write the caller's id to
    `updatedBy` (`patient-tabs.repository.ts:337`, `:362`). That records who made the change; it
    is not part of the update's predicate and refuses no one.
  - *No other layer enforces it.* No migration defines a trigger, policy or check on
    `patient_notes`, and the global guards (`backend/src/modules/auth/auth.module.ts:99`, `:112`,
    `:118` — access token, authorization, maintenance mode) are not author-aware. The two
    `updateMany` calls above (`patient-tabs.repository.ts:332`, `:357`) are the only writes to
    `patientNote` in `backend/src`.
  - *The `not_note_author` check does not implement BR-DEC-001.* It is the precedent the
    requirement cites, and it applies only to **medical-record-note signing**,
    `POST /medical-records/:recordId/notes/:noteId/sign`
    (`backend/src/modules/medical-records/controllers/record.controller.ts:155`–`:156`).
    `RecordService.signNote`
    (`backend/src/modules/medical-records/services/record.service.ts:362`) compares
    `note.authorId !== user.id` (`:372`) and throws 403 `not_note_author` (`:373`). Nothing
    equivalent exists on either chart-note route.
- **Tests.** The chart-note e2e tests (`backend/test/patients-tabs.e2e-spec.ts:299`–`:394`) each
  use a single doctor's token: freeze after signing, refuse a second signature, and 404 for a note
  on another patient's chart. **None has a different user attempt to edit or sign a colleague's
  chart note.** The only author-refusal test is for medical-record notes
  (`backend/test/medical-records.e2e-spec.ts:903`, "refuses a colleague signing someone else's
  note", expecting 403 `not_note_author` at `:937`–`:938`).
- **Verification.** NOT VERIFIED. BR-DEC-001 stays **NOT IMPLEMENTED** and **NOT VERIFIED** until
  both chart-note routes refuse a non-author server-side and e2e tests prove that a different
  user is refused on each of edit and sign.
- **Update 2026-10-24 — IMPLEMENTED.** The paragraphs above are the state at `f19a385` and are kept
  as the record of the gap. Now:
  - `PatientTabsRepository.updateUnsignedNote` and `.signNote` carry **`authorId: <caller>`** in the
    `updateMany` predicate beside `signed: false`, so authorship is enforced by the same statement
    as the write and cannot race a change.
  - When no row moves, `PatientTabsService` explains why: the note is absent, then **403
    `not_note_author`** if the caller is not the author (the medical-record precedent's code and
    status), then 409 `invalid_status_transition` if it is signed. Authorship is checked first,
    so a colleague is told a signed note is not theirs rather than that it is signed.
  - **Verified** by `patients-tabs.e2e-spec.ts`, "refuses edit and sign by a colleague on the care
    team, and changes nothing". It runs over HTTP against the booted application and PostgreSQL 16.
    The colleague is first assigned to the patient and shown to read the note, so the refusal under
    test is authorship rather than care scope. Edit → 403 and sign → 403, both `not_note_author`.
    The row is unchanged in every column, `updated_by` included. The author can still edit (200)
    and sign (200). Acceptance criterion 4 (signed notes uneditable) is covered by the existing
    "freezes a note once it is signed".
  - **Reproduced against the old code first:** the colleague's `PATCH` answered **200** with the
    body rewritten under the author's name.
  - Full backend gate green on the branch. Production promotion is still the owner's call; this
    removes the blocker PR #78 named.

## BR-DEC-002 — Discard an unsigned prescription draft

- **Source decision.** DEC-002 *Cancel vs Discontinue for prescriptions* — ACCEPTED (Option A),
  2026-10-22. Source §14.1, line 1116.
- **Why.** The client now offers Cancel (`/cancel`) only before therapy takes effect and
  Discontinue (`/discontinue`) only after; a draft offers neither, because both routes refuse a
  draft. An abandoned draft can therefore only be left. DEC-002 made no backend change and
  needed none for its own behaviour; the missing route is the residual.
- **Required behaviour (as recorded in the source).** A route to discard an unsigned prescription
  draft. Today `/cancel` and `/discontinue` refuse a draft (409 `draft_not_discontinuable`,
  D-13.1: the `signed_at` CHECK forbids a withdrawn draft from leaving `draft`) and nothing else
  removes one.
- **Acceptance criteria** *(derived; not separately approved).*
  1. An unsigned draft can be discarded by an authorized caller through a dedicated route.
  2. A signed prescription cannot be discarded through that route.
  3. The discard is audited.
- **Open point, not decided here.** Whether a discarded draft is deleted, soft-deleted or kept in
  a terminal state is a design choice the requirement does not make; it must respect the
  D-13.1 `signed_at` constraint and roadmap working rule 6 (record it as an ADR).
- **Backend state at `f19a385` — NOT IMPLEMENTED.**
  `backend/src/modules/pharmacy/controllers/prescription.controller.ts` serves `safety-check`,
  create, list, `summary`, detail, `sign`, `renew`, `discontinue`, `cancel` and `notes`; no
  discard route. `draft_not_discontinuable` is raised in
  `backend/src/modules/pharmacy/services/prescription-status.machine.ts:147`.
- **Verification.** NOT VERIFIED.
- **Update 2026-10-24 — IMPLEMENTED.** The open point is decided by **ADR-044**: a discard is a
  **soft delete**. `deleted_at` is set and `status`/`signed_at` are untouched, so the D-13.1 CHECK
  needs no exception and the row stays for the audit event.
  - `DELETE /prescriptions/{id}` returns **204** for the prescriber's own unsigned draft. The draft
    state is in the write's predicate.
  - Anything past `draft` returns **409 `prescription_not_draft`**.
  - Someone else's prescription, or a second discard, returns **404**.
  - The discard is audited as `prescription.discard`.
  - Acceptance criteria 1–3 are **verified** by four cases in `prescriptions-lifecycle.e2e-spec.ts`,
    over HTTP against the application and PostgreSQL 16:
    - The draft is gone from detail and list, the row survives with `deleted_at` set, and the
      audit row exists.
    - A signed prescription is refused and stays in force.
    - Another doctor gets the missing-prescription 404, and the draft survives.
    - A second discard returns 404.

## BR-DEC-003 — History correction and removal with reasons

- **Source decision.** DEC-003 *Resolving alerts; correcting and removing history events;
  removing contacts* — ACCEPTED (Option D, custom), 2026-10-21. Source §14.1, line 1137.
- **Why.** The owner allowed history *edit* and *remove* only with a mandatory reason and only
  if the original and its audit history are preserved. The frontend did not build either: a
  mandatory reason the server discards would be a faked record, and an edit has no route.
  Alert resolution and contact removal were built; they record who and when, but not why.
- **Required behaviour (as recorded in the source).**
  1. A history-correction route (e.g. `PATCH /patients/:id/history/:eventId`) that writes a
     **new version** rather than overwriting, keeping the original readable.
  2. A **mandatory `reason`** on history correction and removal, and an optional-or-mandatory
     `reason` on contact removal and alert resolution, persisted with the record — not only in a
     log line.
  3. For every correction, removal and resolution: **actor, timestamp, target record, and
     before/after values**, in an audit trail that cannot be silently overwritten.
  4. A read that can return removed and superseded history entries, **marked as such**, for
     clinicians permitted to see them.
  5. **Server-side authorization** on all of the above (who may correct, remove, resolve),
     effective for direct API calls, not only the UI.
- **Acceptance criteria** *(derived; not separately approved).* Each of 1–5 holds for a direct
  API call: a correction leaves the prior version readable; a correction or removal without a
  reason is refused; the stored reason can be read back; the audit entry carries actor, time,
  target and before/after values; removed entries are returned (marked) to permitted readers
  and not to others.
- **Open point, not decided here.** *Who* may correct, remove or resolve (point 5) is not
  specified by the decision; it needs an authorization rule before it can be built.
- **Backend state at `f19a385` — NOT IMPLEMENTED.**
  `backend/src/modules/patients/controllers/patient-tabs.controller.ts:78` (`GET history`),
  `:87` (`POST history`), `:97` (`DELETE history/:eventId`, no request body, so no reason can be
  stored); there is no `PATCH` on history. Per DEC-003's inspection, the global soft-delete
  filter hides removed rows from every read.
- **Backend state 2026-10-24 — PARTIALLY IMPLEMENTED (point 2, and point 3 in part).** Verified
  over HTTP against PostgreSQL 16 (`patients-tabs.e2e-spec.ts`, `patients-clinical.e2e-spec.ts`).
  Migration `20261024150000_br_dec_003_removal_reasons` adds three nullable `VARCHAR(300)` columns.
  | Point | State | Evidence |
  |---|---|---|
  | 2 — reasons, persisted | **IMPLEMENTED** | `DELETE …/history/{id}` **requires** `{ reason }` — no body, no reason, a blank or a 301-character one are each 422 and remove nothing — and stores it trimmed in `patient_medical_history.removal_reason`. `DELETE …/emergency-contacts/{id}` takes an **optional** `{ reason }` into `removal_reason`; with no body it still answers 204, because the client calling it today sends none (DEC-003: required "**if** the backend can record it" — the client's to enforce now that it can). `PATCH …/alerts/{id}` `{ active: false, reason? }` stores `resolution_reason` and **returns it** as `resolutionReason`; a reason without `active: false` is 422. |
  | 3 — audit trail | **PARTIAL** | Actor, time and target were already audited (`patient.history_remove`, `patient.contact_remove`, `patient.alert_update`). The rows now record *that* a reason was given (`reasonGiven`, or `reason` in the changed-field list), never its text: `audit.types` keeps clinical content out of audit rows ("field names belong here; field values do not"). The before-state is the soft-deleted row itself, which is kept. Before/after **values** in the audit trail would contradict that rule and are not written. |
  | 1 — versioned correction | NOT IMPLEMENTED | No `PATCH …/history`. Needs a version model and the point-5 rule. |
  | 4 — read of removed entries | NOT IMPLEMENTED | The soft-delete filter still hides removed history and contacts from every read, so their reasons are stored but not served. "For clinicians permitted to see them" is the point-5 rule. |
  | 5 — who may | **OPEN — unchanged** | Removal and resolution keep the authorization they already had: `@Can('patients.view')` plus `assertCanReach` — a doctor outside the care relationship gets 404 and nothing is written (asserted). This PR adds reasons to those routes; it does not decide who may use them. |
- **Verification.** Point 2 **VERIFIED** 2026-10-24. Points 1, 4 and 5 NOT VERIFIED (not implemented / open).

## BR-DEC-004 — Record edits: author/role check and a reason

- **Source decision.** DEC-004 *Editing a medical record after creation* — ACCEPTED (Option A),
  2026-10-21. Source §14.1, line 1165.
- **Why.** The client offers Edit only on a `draft` record with nothing signed, which is stricter
  than the server (which also accepts `active`). It cannot restrict Edit to the record's author:
  the record carries a doctor name and a doctor-table id, neither of which is the session's user
  id. Until the server enforces it, edits are attributable (actor, time, before/after) but not
  justified, and not restricted to the author.
- **Required behaviour (as recorded in the source).** Server-side author/role authorization on
  `PATCH /medical-records/:id` (effective for direct API calls), and a reason accepted and
  persisted with each version row.
- **Acceptance criteria** *(derived; not separately approved).*
  1. A `PATCH` from a caller outside the permitted author/role set is refused.
  2. A `PATCH` without a reason is handled per the agreed rule (required or optional — the
     requirement says "accepted and persisted"; whether it is mandatory is not stated).
  3. `GET /medical-records/:id/versions` returns the stored reason with each version.
- **Open point, not decided here.** Which roles besides the author may edit is not specified.
- **Backend state at `f19a385` — NOT IMPLEMENTED.**
  `backend/src/modules/medical-records/services/record.service.ts:222` `update` calls
  `this.require(user, publicId)` (`:227`, care scope) and `assertEditable(current.status)`
  (`:229`) and nothing else; the update DTO carries no reason field.
- **Verification.** NOT VERIFIED.
- **Update 2026-10-24 — IMPLEMENTED, with the two open points decided conservatively.**
  - **Author only.** `RecordService.update` refuses a caller whose doctor row is not the record's
    `doctor_id` with **403 `not_record_author`**, before editability and before any write. The open
    point "which roles besides the author" is answered with *none* until the owner names some.
    Admitting a role later is one condition in one place.
  - **Reason accepted and persisted, not required.** `reason` (1–300 characters, trimmed) is
    optional on `PATCH`. It is written to the new column `record_versions.reason` in the same
    transaction as the version row, and returned on every `GET …/versions` entry (`null` when none
    was given or for versions written before the column existed). The source says "accepted and
    persisted", not "required". Making it mandatory is a one-line schema change once decided.
  - A body carrying only `reason` is **422**. A reason explains a change and is not one.
  - The ledger row records `reasonGiven: true|false`, not the text. The text is chart content, and
    its home is the chart's own history.
  - Migration `20261024090000_br_dec_004_record_version_reason` adds one nullable `VARCHAR(300)`.
    No backfill and no lock beyond the `ALTER`. `db:check` reports no drift.
  - **Verified** in `medical-records.e2e-spec.ts`, over HTTP against the application and
    PostgreSQL 16:
    - A colleague who shares the patient, and is shown to read the record, is refused (403
      `not_record_author`). The document is unchanged and no version row is written.
    - Two author edits, one with a reason and one without, read back newest first as
      `[null, "<reason>"]`.
    - A reason-only body → 422.
  - **Reproduced against the old code first:** the colleague's `PATCH` answered 200 and rewrote the
    chief complaint.

## BR-DEC-005 — Availability changes that strand appointments; clinic timezone

- **Source decision.** DEC-005 *Weekly availability editor* — ACCEPTED (Option A), 2026-10-21.
  Source §14.1, line 1178.
- **Why.** Before a changed week is saved, the client identifies upcoming appointments the new
  hours would no longer cover, links each to rescheduling, and moves nothing automatically. The
  check reads times in the device's timezone because no doctor-reachable endpoint serves the
  clinic's, so it can be wrong where the two differ. A save made through the API directly
  strands bookings with no warning at all.
- **Required behaviour (as recorded in the source).** `PUT /me/availability` reports (or, by policy,
  refuses) a week that leaves live future appointments outside the new hours, returning the
  affected appointment ids — the server is the only place this can be exact, since it alone
  knows the clinic timezone. Until then, the clinic timezone readable by a doctor
  (`platform_settings.localization.timezone`) so the client check can compare in the right zone.
  Separately, decide **RA-005.1** (may a doctor's hours fall outside clinic opening hours?) and,
  if they may not, enforce it server-side and serve clinic hours to the client.
- **Acceptance criteria** *(derived; not separately approved).*
  1. A `PUT /me/availability` that would leave live future appointments uncovered returns their
     ids (or is refused, if the policy chosen is refusal), computed in the clinic timezone.
  2. A doctor can read the clinic timezone.
  3. No appointment is moved or cancelled by the save.
- **Open decision.** **RA-005.1 — OPEN** (ADR-005, `docs/DECISIONS.md`). "Report or refuse" is
  also a policy choice the requirement leaves open.
- **Backend state at `f19a385` — NOT IMPLEMENTED.**
  `backend/src/modules/doctors/services/availability.service.ts:75` `replaceGrid` validates the
  week and replaces it, with no appointment check; impacted-appointment detection exists only on
  the time-off path (`:148`). `GET /me/settings`
  (`backend/src/modules/settings/controllers/settings.controller.ts:34`, `:38`) returns the
  user's own workflow timezone (default `UTC`), not the clinic's; `/platform-settings` requires
  `settings.manageSystem` (`backend/src/modules/platform-settings/controllers/platform-settings.controller.ts:56`),
  which only the admin bundle holds.
- **Verification.** NOT VERIFIED.
- **Update 2026-10-24 — IMPLEMENTED for acceptance criteria 1–3, in report mode.**
  - **Criterion 1.** `PUT /me/availability` now returns `stranded[]`: the live future appointments
    (the time-off preview's statuses and projection, the patient handle and never a name) that the
    new grid no longer covers.
    - An appointment is covered when, read in the clinic's timezone, it lies wholly inside one of
      that weekday's windows, overlaps no break, and does not cross midnight. Anything else is
      stranded.
    - The rule is a pure function (`doctors/services/stranded-appointments.ts`). Its unit spec pins
      ten cases: closed day, overrun, a break crossed versus touched, clinic-local versus UTC
      reading, the clinic's weekday versus UTC's, a New York DST change, and a visit crossing
      midnight.
  - **Criterion 2.** `GET` and `PUT /me/availability` carry `clinicTimezone`, read from
    `platform_settings.localization.timezone`. It falls back to `UTC` when that is unset or not a
    zone the runtime knows. No new route, and doctors still cannot read `/platform-settings`.
  - **Criterion 3.** Nothing is moved or cancelled. The e2e asserts both appointments are still
    `CONFIRMED` after the save.
  - **Verified** by three cases in `doctor-availability.e2e-spec.ts`, over HTTP against the
    application and PostgreSQL 16:
    - the zone served matches the stored one;
    - a narrowed Thursday strands exactly the out-of-hours appointment and keeps the other. The
      instants are chosen to give the same answer in UTC and in Cairo at either offset, because
      another suite writes `Africa/Cairo`, and the case was run with the database set to each;
    - an empty week of bookings yields `[]`.
  - **Still open, and not decided here:** whether such a save should be **refused** rather than
    reported, and **RA-005.1** (may a doctor's hours fall outside clinic opening hours). Report mode
    is the conservative reading of "reports (or, by policy, refuses)". The audit row records the
    stranded count. — Workflows for the Reception, Laboratory and Pharmacy roles

- **Source decisions.** DEC-006 *Reception, Laboratory and Pharmacy accounts* — ACCEPTED
  (Option C), 2026-10-21, source line 1274; scope settled by DEC-006a — ACCEPTED (Option A),
  2026-10-21, source line 1293. Origin: F42 in `docs/FE-10-INTEGRATION-STATUS.md` (on
  `frontend` only).
- **Why.** The owner chose minimal, honest web workspaces for these three roles now, with no
  invented permissions, workflows or endpoints. Reception got a useful workspace (masked
  directory, appointment oversight with nudge and reassign); Laboratory and Pharmacy got only
  shared features plus a plain statement that their clinical work is unavailable until the
  backend supports it.
- **Required behaviour (as recorded in the source), in four parts.**
  1. **Laboratory:** a technician scoping model (which orders a `laboratory` account may reach —
     department, site or worklist), and lab-role access to `/lab-orders` list/detail,
     `…/transition`, `…/results` and `…/attachments` without `requireDoctor`.
  2. **Pharmacy:** a pharmacy capability set and routes to list, view and dispense prescriptions
     (none exists; all of `/prescriptions/*` requires `prescriptions.create`).
  3. **Reception:** booking, cancelling and rescheduling **on behalf of** a doctor (today
     `/appointments/*` is `requireDoctor`), and check-in / waiting-room routes.
  4. **All three:** staff messaging.

  The source also carries two parenthetical observations — "the `administration` module is an
  empty scaffold" after part 3, and "`messaging` module is an empty scaffold" after part 4. They
  describe `main`'s `backend/` tree and are true there; they are not true on this branch, so they
  are moved into "Backend state" below rather than repeated as requirement text.
- **Acceptance criteria** *(derived; not separately approved).* Each part is reachable by the
  named role through capabilities it holds, without a doctor profile, and refused to roles that
  do not hold them; part 1 additionally limits a technician to the orders the scoping model
  allows.
- **Open decisions.** The technician scoping model (D-14.2, `lab-order.service.ts` header) and
  the pharmacy capability set are authorization designs no document has made. They need an ADR
  (working rule 6).
- **Backend state at `f19a385` — NOT IMPLEMENTED as a whole.** Parts 1, 2 and 3 are not
  implemented for the roles that need them. Part 4 has code that appears to serve it, but nothing
  verifies it for the reception, laboratory and pharmacy roles. Read from source; not run.

  | Part | State | Evidence |
  |---|---|---|
  | 1 Laboratory | NOT IMPLEMENTED | `backend/src/modules/labs/services/lab-order.service.ts:20` (D-14.2, "no scoping model") and `:392` (a `laboratory` account stops at the doctor check) |
  | 2 Pharmacy | NOT IMPLEMENTED | `backend/src/modules/pharmacy/controllers/prescription.controller.ts:53` and `medication.controller.ts:26` are `@Can('prescriptions.create')`; the pharmacy bundle is `['patients.view', 'messages.send']` (`backend/src/shared/authz/permission-catalogue.ts:274`); no dispense route |
  | 3 Reception — booking on behalf | NOT IMPLEMENTED | `backend/src/modules/appointments/services/appointment.service.ts:96`, `:130`, `:147` (and further) call `requireDoctor` |
  | 3 Reception — check-in / waiting room | NOT IMPLEMENTED (for reception) | Check-in and waiting-room routes exist on `backend` (M23.4, `GET /administration/waiting-room`, `…/:id/call`, `…/:id/seat`), but the controller is `@Roles('admin')` (`backend/src/modules/administration/controllers/administration.controller.ts:84`), so they are restricted to administrators and a reception account cannot reach them. The required reception workflow does not exist. **On `main` this module is an empty scaffold** |
  | 4 Staff messaging | **IMPLEMENTED — verified 2026-10-24** for reachability and membership; participant rule open | `backend/test/messaging-staff-roles.e2e-spec.ts` (14 cases, over HTTP against PostgreSQL 16): a `reception`, a `laboratory` and a `pharmacy` account each opens a thread with a doctor, writes, is read by the doctor, reads the reply and finds the thread in its own list — with no doctor profile involved. A staff account outside a thread gets the same 404 as a missing thread (ADR-022). The capability is shown to be what admits them: a `patient` account (no `messages.send`) and a pharmacy account with `messages.send` revoked by override both get 403. **Still not addressed, and not tested as if it were:** the staff participant rule (API-W09 — whom such an account may open a thread with; today any holder of `messages.send` may address any active account) and hospital scoping (multi-hospital AF-16). **On `main` this module is an empty scaffold**, which is why DEC-006 records it as missing |

- **Verification.** Part 4 **VERIFIED** 2026-10-24 (above). Parts 1–3 **NOT VERIFIED** — not implemented.

---

## Related register items

- **RA-005.1 (ADR-005) — OPEN.** BR-DEC-005 depends on it. Unchanged by DEC-005, which decided
  to build the editor *without* inventing clinic hours.
- **RA-027.1 (the cumulative "Open items carried forward" table under ADR-022; cited by
  ADR-027 §6) — OPEN in the register.** Its
  product question — whether `reception`, `laboratory` and `pharmacy` get a shell — was answered
  by the owner in DEC-006 (Option C) and DEC-006a (Option A) on `frontend`. The backend already
  issues the full platform role (`backend/src/modules/auth/services/session-user.service.ts:57`,
  `role: user.role.code`). Closing RA-027.1 is the register owner's call and is not done here.
- **D-13.1** (prescription status machine) and **D-14.2** (lab scoping) are the in-code records
  behind BR-DEC-002 and BR-DEC-006 part 1.

## What this page deliberately does not restate

- **DEC-007 … DEC-011** have no backend requirement. DEC-007 removed the practitioner Profile
  section from the admin's My Settings (resolving F41: `PATCH /me/profile` answers 404 without a
  `doctors` row). DEC-008 (touch targets), DEC-009 (Latin digits), DEC-010 (Gregorian calendar,
  closed) and DEC-011 (separators) are display rules; the backend's Gregorian, Latin-digit data
  is what they keep consistent with.
- **API-W01 … API-W14** (frontend checklist §9.1, 2026-10-06) are the frontend's proposed
  multi-organization contracts. The owner's FINAL Hospital model of 2026-10-07 supersedes that
  model in part, and the backend side of that work is owned by
  [`docs/multi-hospital/BACKEND_CHECKLIST.md`](../../docs/multi-hospital/BACKEND_CHECKLIST.md)
  and [`API_CONTRACT_CHANGES.md`](../../docs/multi-hospital/API_CONTRACT_CHANGES.md).
- **The older §9 dependency rows** (re-authentication endpoint for the lock screen, file upload,
  model service, interaction service, drug reference data, sharing policy, PHI masking
  enforcement, lab and record endpoints) are already in this branch's copy of
  `frontend/FRONTEND_CHECKLIST.md` §9.

## Keeping this page honest

- When a requirement's implementation lands, update its "Backend state" with the commit and the
  verification evidence (working rule 2), and update §9.0 of the source checklist in the same
  change or the next frontend one.
- When `frontend` reaches `main` and `main` is merged into `backend`, this branch's
  `frontend/FRONTEND_CHECKLIST.md` will carry §9.0 and §14.1 itself. This page then becomes the
  backend's status view of those requirements; the requirement text stays authoritative only in
  the source.
