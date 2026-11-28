# PR #68: Final Security and Integration Audit

| | |
|---|---|
| Repository | `Fares-code0/medora-platform` |
| Pull request | #68, `claude/patient-app-end-to-end` → `main`. OPEN, not merged, not a draft |
| Base | `8161a1a6df3da3bf977f50cccef2be578c9c4744` (`main` = `origin/main`) |
| Head audited | `67ca164973b3ef6ce81e244afb26304e14e6ff92` (local = remote = GitHub `headRefOid`) |
| Diff | 255 files, +18,924 / −7,550. backend 76, docs 2, patient-app 177 |
| Audit date | 2026-11-27 |
| Method | Six independent read-only workstreams (A security, B database, C app integration, D clinical privacy and AI, E booking and notifications, F tests and docs). The coordinator re-verified both High code findings by reading the source. No code was changed. |

---

## 1. Executive summary

PR #68 is well built in most of the areas audited:
- patient-only gating;
- owner-scoped data access, with no IDOR found;
- staff-mediated linking that revokes sessions on unlink;
- booking concurrency;
- the reschedule-request state machine;
- status-only lab data;
- identical notifications for normal and critical results;
- AI-mode separation with a red-flag short-circuit that runs before the model is called;
- operator-configured emergency numbers.

Each of these was checked and holds up in code.

The audit nevertheless found **two High code defects and one High process gap** that must be resolved before merge:

1. **R-01 (High): a doctor cannot reschedule an appointment a patient booked.** Every patient booking now sets `appointments.published_slot_id`. The existing doctor reschedule changes `starts_at` but keeps the slot id. The phase-21 trigger then raises SQLSTATE 23514, which nothing maps, so the client gets a 500. The defect is old, but this PR makes it reachable for every patient booking.
2. **R-02 (High, clinical privacy): a linked patient can read their own lab attachments, record attachments and patient documents through `GET /files/:fileId[/download]`.** This contradicts approved decision 1 and the still-open ADR-031. The code predates this PR, but linking (ADR-048) is what makes it reachable in production. Exploiting it requires the file's UUID, and no patient route returns one, so practical exposure is low. The policy breach is still real, and the PR's own ADR text says it cannot happen.
3. **R-03 (High, process): the PR has never run CI.** The head commit carries `[skip ci]`, the status-check rollup is empty, and the new e2e specs have never run on Linux CI. In addition, the most recent `main` run shows the GitHub Actions billing or spending limit blocking jobs from starting.

Production readiness is a separate and larger gap, set out in §16. It includes:
- no slot-publishing API;
- no staff web screens;
- the hospital timezone missing from the contract;
- clinical sign-off on the red-flag lists and wording;
- missing EAS, push and AI provider configuration;
- emergency numbers per release country.

## 2. Final verdict

> **NOT READY — SECURITY/CLINICAL BLOCKER**

The verdict rests on R-02, a clinical-privacy breach of an approved owner decision, together with R-01 and R-03. Once those three are resolved, the PR is expected to qualify as **READY WITH NON-BLOCKING ISSUES** for merge. It is **not** production-ready either way (§16).

## 3. Scope and SHAs

Temporary sub-branches, all local-only and never pushed:

| Branch | Tip | Worktree |
|---|---|---|
| `claude/patient-app-end-to-end--be-appointments` | `cb37cb7` | `pe2e-be-appointments` |
| `claude/patient-app-end-to-end--be-identity` | `a9a914e` | `pe2e-be-identity` |
| `claude/patient-app-end-to-end--be-ai` | `5b28445` | `pe2e-be-ai` |
| `claude/patient-app-end-to-end--app-identity` | `1fdc9fd` | `pe2e-app-identity` |
| `claude/patient-app-end-to-end--app-appointments` | `fe0ceec` | `pe2e-app-appointments` |
| `claude/patient-app-end-to-end--app-health-ai` | `8a1d804` | `pe2e-app-health-ai` |

Every worktree was clean (`git status --porcelain` empty) at the start and at the end of the audit.

---

## 4. Finding matrix

Confidence: **V** = Verified by execution, **CC** = Code-confirmed, **S** = Suspected, **EXT** = Requires external validation.
"Intro" means newly introduced by PR #68. "Exposed" means the code predates the PR, but the PR makes it reachable.

| ID | Finding | Severity | Conf. | Intro by PR #68 | Merge blocker | Release blocker |
|---|---|---|---|---|---|---|
| R-01 | Doctor reschedule of a slot-booked appointment fails in DB (500) | **High** | CC | Exposed | **Yes** | Yes |
| R-02 | Patient can read own lab/record attachments and documents via `/files` | **High** | CC | Exposed | **Yes** | Yes |
| R-03 | PR never ran CI (`[skip ci]`); Actions billing-blocked on `main` | **High** (process) | V | Intro | **Yes** | Yes |
| R-04 | Personal-AI history survives unlink; may be re-sent after relink | Medium | CC | Intro | Recommended | Yes (before AI is enabled) |
| R-05 | No per-patient cap or rate limit on book/cancel/reschedule | Medium | CC | Intro | No | Yes |
| R-06 | `GET /me/appointments/:id` returns staff free-text `notes`/`reason` | Medium | CC | Exposed | No (owner decision) | Yes, unless accepted |
| R-07 | Hospital timezone missing from contract; slots render in device tz | Medium | CC | Intro (slots) / pre-existing (appts) | No | Yes, if multi-tz |
| R-08 | Clinic gets no alert for reschedule requests; requests silently superseded | Medium | CC | Intro | No | Yes (feature) |
| R-09 | Doctor time off ignored by slot listing and booking | Medium | CC | Intro | No | Yes |
| R-10 | Red-flag lists miss common EN/AR phrasings; Arabic exact-order match | Medium (clinical) | CC | Intro | No | Yes, pending clinician |
| R-11 | Single escalation message; no crisis wording for self-harm | Medium (clinical) | CC | Intro | No | Yes, pending clinician |
| R-12 | Assistant never sends `locale` → Arabic users get English replies and escalation | Medium | CC | Intro | No | Yes |
| R-13 | `EXPO_PUBLIC_EMERGENCY_NUMBERS` not in any EAS profile | Medium | V (repo) / EXT (EAS cloud) | Intro | No | Yes |
| R-14 | New unique index has no data preflight | Low | EXT | Intro | No | Pre-deploy check |
| R-15 | Unmapped DB errors (lock timeout, trigger refusal, non-slot unique) → 500 | Low | CC | Intro | No | No |
| R-16 | Cross-hospital overlap check blind to other hospitals' appointments | Low | CC | Intro | No | No |
| R-17 | Link-code enumeration oracle (`*_already_linked` before consumption) | Low | CC | Intro | No | No |
| R-18 | Link codes: unsalted SHA-256 (offline crack ≈ 1 min/GPU) | Low | CC | Intro | No | No |
| R-19 | Rate limiter off by default, per-IP, fails open | Low | CC | Pre-existing | No | Config item |
| R-20 | Any hospital holding a record can link/unlink an account | Low (design) | CC | Intro | No | Owner decision |
| R-21 | Reschedule lifecycle edge cases (see §9) | Low | CC | Intro | No | No |
| R-22 | Patient-app UX defects: raw reason/actor tokens, stale cache, error messages, duplicate retry | Low | CC | Intro | No | No |
| R-23 | `policyNumberLast4` returns whole number when ≤ 4 chars | Low | CC | Intro | No | No |
| R-24 | `testName` (e.g. HIV, hCG) shown to patient and AI | Low | CC | Intro (ADR-050 approved) | No | Owner confirmation |
| R-25 | `/me/profile` returns `bloodType` | Low | CC | Pre-existing | No | Owner decision |
| R-26 | Three flaky patient-app tests under full-suite load | Low | V (reproduced) | Intro | No | No |
| R-27 | Documentation drift (CLAUDE.md ADR register note, draft marker, ARCHITECTURE "pending") | Info | V | Mixed | No | No |
| R-28 | Push is never delivered (no provider; app registers no token) | Info | CC | Pre-existing | No | Yes (if push needed) |
| R-29 | No output validation of model answers | Low | S | Intro | No | Pending clinician |
| R-30 | Patient AI input retained indefinitely and sent to provider | Info | CC | Intro | No | DPA / retention decision |

---

## 5. Security findings

### R-01 is in §9; R-02 is in §8.

### R-04: Personal-AI history survives unlink (Medium, CC, introduced)

**Where:**
- Personal threads are owned by the *user*, not the patient: `backend/src/modules/ai/repositories/patient-ai-conversation.repository.ts:63-78, 164-173`.
- Unlink does not touch AI threads: `backend/src/modules/patients/repositories/patient-account-link.repository.ts:148-178`.
- The next turn replays prior turns: `backend/src/modules/ai/services/patient-ai.service.ts:210-250`.

**Actual behaviour:** after an unlink, the account can still read assistant answers that were built from the former record. If the account is later linked to a different record, the old record's turns are sent to the model alongside the new record's context.

**Impact:** the context of one patient record could cross into another's. This is latent today, because no AI provider is configured.

**Remediation:** in the unlink transaction, delete or archive the account's `patient_mode = 'personal'` threads, or bind each thread to the `patient_id` it was opened under and refuse it when that differs from the current link.

### R-05: No booking cap or rate limit (Medium, CC, introduced)

`POST /me/appointments`, cancel, and the reschedule routes carry no `@RateLimited` and no per-patient cap; ADR-049 acknowledges this. A single linked patient can book every published slot. Each booking at a new hospital also creates a Medical Record there (OD-09), which matters for the hospital-reach model.

**Remediation:**
- add `@RateLimited` to these routes;
- cap open future bookings per patient, with the number decided by the owner.

### R-17: Link-code validity oracle (Low, CC)

Staff `POST /patients/:id/account-link` returns `patient_already_linked` or `account_already_linked` after the code has matched, but without consuming it and without writing an audit row. `account_already_linked` also tells one hospital that the person is linked to a record at another hospital.

**Remediation:**
- run the linked-state checks before the code lookup, or return one generic error;
- audit failed attempts.

### R-18: Link-code hashing (Low, CC; defence-in-depth)

The keyspace is 31⁸ ≈ 8.5 × 10¹¹ ≈ 2³⁹·⁶.

- **Offline, after a database leak:** one GPU computes the whole SHA-256 table in about 40–90 seconds, so every code live within the 15-minute TTL is recoverable.
- **Online:** a guess matches any live code platform-wide, so the success rate per attempt is (number of live codes) ÷ 8.5 × 10¹¹. Even with rate limiting off and an insider sending 200 requests per second, that is about 2 × 10⁻⁵ per live code per day.

A recovered code still requires an admin at a hospital desk to attest an in-person ID check. It links the *victim's account* to a record the attacker chose; it does not hand over the victim's data. Codes are single-use, and the comparison is an indexed digest lookup, so timing is not a factor.

**Conclusion:** HMAC with a server secret is worthwhile hardening, but it is **not necessary** for merge.

### R-19 and R-20 (Low)

- **R-19:** the rate limiter is off by default, counts per IP, fails open when Redis is down, and shares one bucket between linking and login. All of this is pre-existing.
- **R-20:** any hospital that holds a record for the patient may link or unlink, and patients create such records simply by booking. This is a design note for the owner.

### R-23: `policyNumberLast4` (Low)

`backend/src/modules/patients/services/patient-account-link.service.ts:247` returns the whole policy number when it is 4 characters or fewer. Fix: mask the number entirely when it is that short.

### Verified correct (security)

- Every new patient route answers 403 `patient_only` to non-patients before any query runs.
- The patient's identity is resolved from the database on every request, and the role is re-checked against the database.
- No IDOR on appointments, reschedule requests, AI threads or lab orders: all are owner-filtered, and a foreign id gets 404.
- A reschedule request cannot change the doctor or the hospital.
- `patients.manageAccounts` is held only by admin, in both the seed and the catalog. The admin-only guard list prevents granting it to anyone else, and **reception does not hold it**, which preserves that open decision.
- The staff reschedule-queue routes use `appointments.manageOwn` and need a doctor profile. Reception gets 404.
- Linking:
  - codes come from a CSPRNG, are single-use, and an account can have only one live code;
  - **no email matching** anywhere;
  - staff must attest an in-person ID check;
  - no document number is stored.
- **Unlink** clears the link, revokes **all** sessions, deletes codes, bumps `authz_version` and writes the audit row, all in one transaction. Previously issued access tokens are rejected on their next request; `patient-account-link.e2e-spec.ts` asserts this (the spec was read, not run).
- In the app:
  - the eligibility gate runs on login, OTP, restore and every refresh, and fails closed;
  - tokens are kept in SecureStore;
  - PHI caches are cleared on sign-out and on an account switch;
  - Emergency stays reachable from the access-denied screen.

---

## 6. Backend findings

- **R-15 (Low): unmapped errors surface as 500.** Booking maps every unique violation to `slot_taken`, not only violations of the slot indexes. Lock timeouts (55P03), Prisma transaction timeouts and a trigger refusal during approval are not mapped at all. The fix is a narrow error mapper.
- **R-16 (Low): overlap check blind to other hospitals.** `assertSlotFree` runs under the slot hospital's RLS scope, so it cannot see the same doctor's appointments at another hospital. Overlapping slots across hospitals could double-book a doctor.
- **Informational:**
  - `supersedeStale` runs an UPDATE on every GET of reschedule requests, and `supersedeFor` is dead code.
  - Cancellation compares against the app clock, while slot locking uses the database clock.
  - Spent link codes are never purged.

## 7. Database findings and migration review

| Migration | Verdict |
|---|---|
| `20261126100000_patient_appointment_actions` | **Additive.** Adds `appointment_reschedule_requests`, with composite tenant FKs, CHECKs, a partial unique index (one pending request per appointment), RLS ENABLE plus policies, and a tenant-key immutability trigger. Also adds the `appointments_one_live_booking_per_slot` unique index and the key `(id, hospital_id)`. |
| `20261126110000_patient_account_link_codes` | **Additive.** Hash-only storage, one live code per account, CHECKs, classified as internal or system like `sessions`, no RLS (the identity-table convention). |
| `20261126120000_patient_ai` | **Additive.** Adds `ai_conversations.patient_mode`, with a CHECK that patient threads bind no patient, hospital or record, and `ai_messages.escalated`. The CHECK accepts every existing row. |

General findings:
- `git diff --name-status 8161a1a..67ca164 -- backend/prisma/migrations` shows only **A** (added) entries, so no existing migration was edited.
- The `.prisma` schema matches the SQL by inspection. **`db:check` was not run in this audit**; it passed in the earlier implementation run.
- No new SECURITY DEFINER functions are added.
- RLS is ENABLE without FORCE, which is the project convention.
- No new query is missing an index.
- **R-14 (Low, EXT):** `appointments_one_live_booking_per_slot` has no duplicate-data preflight. Before this PR, only the dev seed set `published_slot_id`, so production duplicates are practically impossible. Still, before deploying run:
  ```sql
  SELECT published_slot_id, count(*) FROM appointments
   WHERE published_slot_id IS NOT NULL AND status IN (<live statuses incl. 'rescheduled'>)
   GROUP BY 1 HAVING count(*) > 1;
  ```
  The index build briefly takes a lock on `appointments`.
- **Informational:** the patient-scope RLS UPDATE policy on `appointment_reschedule_requests` does not restrict which columns change. This is consistent with the project's column-agnostic RLS, and the API enforces the transitions.
- The `tenant-scope-callsites.spec.ts` justification for `patient-booking.repository.ts` is accurate: the hospital comes from the database row and every statement is keyed to the slot and the caller's own patient.

## 8. Clinical privacy and AI findings

### R-02: Patient file access to clinical attachments (High, CC, exposed by this PR)

**Evidence** (re-verified by the coordinator):
- `backend/test/authz-route-matrix.snapshot.txt:83-84`: `GET /api/v1/files/:fileId` and `/download` are open to roles `ADRLPTN`, which includes **P**atient.
- `backend/src/modules/files/services/file-access.service.ts:92-111`: for `patient_document`, `record_attachment` and `lab_attachment`, `canRead` calls `reachesPatient`.
- `file-access.service.ts:145-159`: `reachesPatient` returns `selfScope.patientIdFor(principal) === patientId`, so the patient may read their own clinical file.
- At the database level, `app_rls.file_of_current_patient` in `backend/prisma/migrations/20261125095000_rls_files_conversations/migration.sql:67-76`, used by `files_read` at line 101, admits the same three kinds.

**Expected:** decision 1 says a patient never accesses lab results, medical documents or record content, and ADR-031 (release) is open, so the patient role should be denied all three kinds.

**Actual:** a linked patient holding a file UUID receives the metadata and a signed download URL.

> **Correction (remediation, 2026-11-27).** The remediation investigation showed that the own-chart path described above never matched in practice. `reachesPatient` compares the patient's public id (`PT-…`, from `findPatientIdByUserId`) with a UUID. So the API never served a patient their chart's linked files. That is a latent defect: "fixing" the comparison would have opened all three kinds.
>
> The path that was actually reachable was different. `POST /files` accepted these three kinds from a patient. The uploader shortcut (`uploadedBy === user.id`) then served them back. That exposed only bytes the patient had supplied, but it was still a patient reading a "clinical" file kind.
>
> Both API paths are now closed (see `docs/audits/PR-68-R02-PATIENT-FILE-ACCESS-DESIGN.md`). The database-level path (`app_rls.file_of_current_patient`) remains open, pending migration approval.

**Exploitability:** low. The UUIDs are random and no patient-facing route returns one. However, a UUID can leak through a support screenshot, a shared link or a later feature. This PR also states in `docs/DECISIONS.md` that no result, record, note or prescription is readable by a patient, which this contradicts.

**Origin:** the code is on `main`. It becomes reachable because ADR-048 linking now sets `patients.user_id` in production.

**Remediation:**
- deny these three kinds to the patient role in `canRead`;
- add a **new** migration that redefines `app_rls.file_of_current_patient` to exclude them, or to return false;
- add e2e tests asserting 404 for each kind.

This is a database change, so it needs approval.

### R-06: Staff free text in patient appointment detail (Medium, CC, exposed)

`GET /me/appointments/:id` returns the staff-typed `notes`, `reason` and event reasons, and `patient-app/src/features/appointments/screens/AppointmentDetailScreen.tsx:149-158, 234-236` displays them. ADR-050 already keeps these fields out of the AI context, which shows they were considered sensitive. Clinicians may write clinical content into them.

**Owner decision needed:** whether staff notes are patient-visible. If not, drop them from the patient projection.

### R-24 and R-25 (Low, owner confirmation)

- **R-24:** `testName` is shown on `/me/lab-orders` and is sent to the personal AI. A name like "HIV" or "hCG" can reveal the suspected diagnosis. ADR-050 approved the field, so the owner only needs to confirm it explicitly.
- **R-25:** `/me/profile` returns `bloodType`. This is pre-existing.

### R-10 and R-11: Red-flag coverage and escalation wording (Medium, clinical, clinician sign-off pending)

Missing from the English list:
- "difficulty/trouble breathing", plain "short of breath";
- "blue lips", "chest is tight", "can't speak";
- "don't want to live", "took too many pills", "won't wake up".

Missing categories in both languages:
- worst-ever headache;
- fever with stiff neck;
- bleeding in pregnancy;
- severe abdominal pain;
- head injury;
- hypoglycaemia;
- harm to others.

Arabic matching requires an exact phrase in order, so "ألم شديد في صدري" does not match. Common colloquial forms such as "ضيق نفس", "كتمة" and "ما ابي اعيش" are also missed.

Every flag returns one identical message, so self-harm gets no crisis-line wording. The Arabic text is grammatically correct and does not give false reassurance.

These are **release blockers pending qualified clinical sign-off**. They are not merge blockers: the check fails safe, and with no provider configured the AI only ever returns 503.

### Other AI findings

- **R-29 (Low, S):** model output is not validated. The prompt is the only control against fabricated results.
- **Red-flag check scope (Low):** only the current message is checked, so an emergency described across two messages reaches the model. This is documented in the code.
- **Insurance in personal AI context (Low):** personal AI receives provider, plan, valid-until date and active status. That is more than "presence", but it matches ADR-050.
- **R-30 (Info):** patient input is stored indefinitely and is sent to the external provider. This needs a retention decision and the data-processing agreement (OD-11).

### Verified correct (clinical)

- The patient role holds no capability, so every `/patients/**`, lab, prescription, medical-record, doctor-AI and messaging route refuses patients at the guard.
- `/search`, exceptional access and information requests refuse patients in the service layer. Data export returns 501.
- `/me/lab-orders` selects only status fields. Results, flags, indication, interpretation, the critical marker and the reviewer are never selected. The status maps five database states to four patient statuses, with no "critical" or "reviewed" status.
- **Notifications:**
  - Completing a test publishes **exactly one** event, `lab_order.completed` or `lab_order.critical_released`, at the same moment.
  - Both topics map to the same rule: same title, `NORMAL` priority, not pinned, the same body format, and the deep link `medora://records/labs`.
  - The doctor's critical alert is separate and goes only to the doctor.
  - The patient therefore cannot tell normal from critical, by count, timing or content (decision 7).
- **General AI** loads no patient data (decision 4).
- **Personal AI** re-reads only the patient's own appointments, test status and insurance presence on every turn, with an audit row that records counts only (decision 5).
- **Red flags** short-circuit **before** any provider call, and work with no provider configured (decision 6).
- AI threads are isolated by owner and mode in both code and RLS, and doctor AI routes exclude patient threads. Patients hold no `ai.use`.
- **Messaging:**
  - disabled, with no patient messaging route (decision 3);
  - the app's production messaging adapter makes no network call.
- **Patient app storage:** nothing clinical is persisted to storage. The removed screens and their fixtures are gone, and no leftover route calls a prohibited endpoint.
- **Emergency numbers:** come only from operator configuration, and the app hard-codes none.

## 9. Booking and scheduling findings

### R-01: Doctor reschedule of a slot-booked appointment (High, CC, exposed by this PR)

**Evidence** (re-verified by the coordinator):
- `backend/prisma/migrations/20261122170000_phase21_data_model/migration.sql:428-451`: the trigger `validate_active_appointment_employment` fires `BEFORE INSERT OR UPDATE OF … published_slot_id, starts_at, duration_min`. When `published_slot_id IS NOT NULL` and `slot_start <> NEW.starts_at OR slot_duration <> NEW.duration_min`, it raises SQLSTATE 23514 on the constraint `appointments_published_slot_available_check`.
- `backend/src/modules/appointments/services/appointment.service.ts:335-397`: `AppointmentService.reschedule` calls `AppointmentRepository.transition`.
- `backend/src/modules/appointments/repositories/appointment.repository.ts:542-552`: the update writes `startsAt` and `durationMin` but never `publishedSlotId`.
- `backend/src/modules/appointments/repositories/patient-booking.repository.ts:290`: every patient booking sets `publishedSlotId`. Approved reschedule requests are slot-bound as well.

**Reproduction (by code path):**
1. A patient books a slot.
2. The clinic confirms the booking.
3. The doctor uses the web app's existing "Reschedule" action, `POST /appointments/:id/reschedule`, choosing any new time.
4. The trigger raises 23514.
5. `underScheduleLock` maps only lock errors, so the global filter returns **500**. The exact status is not executed; it is Suspected.

Separately, a stale slot id on a `rescheduled` row would keep holding the old slot under the new `appointments_one_live_booking_per_slot` index.

**Origin:** the `transition()` gap exists on `main`, but there only seed data set slot ids. This PR makes it reachable for every patient booking. No test covers it.

**Remediation:**
- on a doctor reschedule to an arbitrary time, clear `publishedSlotId`, or rebind it to a matching slot;
- map the refusal to 409;
- add an e2e test: a patient books, the clinic confirms, the doctor reschedules.

### R-07: Timezone (Medium, CC)

**What is correct:** storage is `timestamptz` throughout, and the API emits ISO UTC strings ending in `Z`.

**What is wrong:**
- `hospitals.timezone` exists, but nothing in the backend reads it.
- Appointment payloads carry `clinicTimezone`, which is one platform-wide setting rather than the appointment's hospital.
- The slots route carries no timezone at all.
- As a result, BookingFlow groups and shows slots in the **device** timezone, while appointment cards use the platform timezone.
- The insurance "valid today" check uses the UTC date.
- Notification bodies print the raw UTC ISO string.

**Conclusion:** the defect is in the backend contract, so a frontend-only workaround is not appropriate. The fix is for slot and appointment payloads to carry the hospital's IANA timezone, which the app then formats in.

### R-08, R-09 and R-21

- **R-08 (Medium):** reschedule requests reach no one.
  - `reschedule_request.created` deliberately has no notification rule, and the web app has no queue screen.
  - Requests have no expiry, so they sit until the original start time and are then silently superseded, with no answer to the patient.
- **R-09 (Medium):** neither slot listing nor booking consults `doctor_time_off`.
- **R-21 (Low):**
  - a clinic can reject a request after the appointment has started, so the patient gets a "declined" notice instead of a supersede;
  - a request whose requested slot has already started stays pending, and every approval attempt returns 409;
  - staff transitions supersede requests after commit, not inside the same transaction as ADR-049 states;
  - `availableActions` offers reschedule when the appointment has a hospital but no doctor employment, and the write path then refuses it with 409;
  - a slot blocked by a doctor's off-grid booking is still listed, and booking it correctly returns 409.

### Release-level gap: slot publishing

There is no doctor or staff API or UI to publish or withdraw slots, on `main` or on this branch. Slots exist only in seeds and fixtures, and ADR-049 records this. Patient booking therefore has nothing to offer in a real deployment. This is not a merge blocker, because the feature is safely inert, but it is a production blocker for booking.

### Verified correct (booking)

- **Slot listing** excludes past, withdrawn and held slots, and slots at inactive hospitals or for inactive doctors.
- **Started slots** are refused twice: once in the service and again under the row lock.
- **Booking:**
  - Locks are taken in the order doctor, then slot, then a re-check. The unique index is the race backstop and maps to 409.
  - New bookings start as `pending`.
  - The first booking at a hospital creates the Medical Record in the same transaction, using `ON CONFLICT` on the patient-and-hospital key, so concurrent first bookings cannot duplicate it.
  - Idempotency holds under retries and under concurrent requests with the same key.
- **Cancellation** is allowed strictly before `startsAt`. It is re-checked in a compare-and-set update, uses closed reason codes, frees the slot, and supersedes pending requests in the same transaction.
- **Reschedule requests:**
  - One pending request per appointment, with the same doctor and hospital.
  - The requested slot is **not** held.
  - Approval is atomic under locks, moves the same row and frees the old slot.
  - If the requested slot was taken, approval returns 409 and the request **stays pending**; this is tested.
  - Rejection leaves the appointment unchanged; this is tested.

## 10. Patient app findings

- **Contract parity verified:** paths, methods, payloads, zod schemas and enumerations all match the backend controllers, DTOs and `openapi.json`. The enumerations checked were 8 appointment statuses, 6 cancel reasons, `availableActions`, 5 reschedule statuses and the lab statuses.
- **Idempotency key:** sent on book and on create-reschedule. It is reused after network or 5xx errors and dropped after a definite 4xx.
- **Error mapping:** `slot_taken`, `patient_not_linked`, `reschedule_request_pending`, `insurance_not_covered`, `patient_only` and 503 are each mapped. Mutations are never auto-retried.
- **Mocks:** `EXPO_PUBLIC_ENABLE_MOCKS=true` is hard-rejected when `APP_ENV=production`.
- **R-12 (Medium):** the assistant never sends `locale`, so Arabic-UI users get English answers and English escalation text. Fix: send the UI locale.
- **R-13 (Medium):** `EXPO_PUBLIC_EMERGENCY_NUMBERS` is set in no EAS profile. Unless it is provisioned in the EAS cloud environment, release builds show no call buttons. This needs external validation.
- **R-22 (Low):**
  - The timeline prints the raw event reason (`patient:cost — note`) and the raw actor token (`patient` / `clinic` / `system`). Fixtures send "You", which hides the second problem in tests.
  - `useCancelAppointment` invalidates its cache only on success, so a 409 leaves stale action buttons even though the text says "It has been refreshed".
  - A 404 on cancel or withdraw shows the "someone else booked that time" message.
  - A desk link made while the app is idle is not picked up until the screen remounts and 30 seconds have passed.
  - Retrying a failed assistant turn stores the question twice.
- **Informational:**
  - The `.strict()` schemas on `/me/lab-orders` and `/me/insurance` will reject any field the backend adds later. Consider `.passthrough()` or strip.
  - SSE has no idle timeout and no Stop button.
  - Clinic, Department and Home-activity screens remain "not available" in production, as they were before this PR.

## 11. Notification findings

- Verified correct:
  - normal and critical completions produce the same single patient notification;
  - a reschedule approval or rejection notifies the patient once;
  - a patient's own cancellation notifies only the doctor;
  - dedupe keys are sound.
- **R-08:** see §9.
- **R-28 (Info, pre-existing):** no push provider is configured, so push deliveries are recorded as `skipped / no-provider`, and the app registers no push token. Notifications are in-app only.
- Notification bodies print raw UTC timestamps (see R-07). There is no push payload to inspect yet.

## 12. Test results and failure classification

### Run during this audit (Agent F, worktree `patient-e2e`, head `67ca164`)

| Command | Result |
|---|---|
| `npm --prefix backend run typecheck` | ✅ 0 errors |
| `npm --prefix backend run lint` | ✅ exit 0 |
| `npm --prefix patient-app run typecheck` | ✅ exit 0 |
| `npm --prefix patient-app run lint` | ✅ exit 0 |
| `npm --prefix patient-app run test` | **2633 / 2635 passed**; 2 failed (`doctors/availability-preview.test.tsx`, `appointments/booking-recovery.test.tsx`, find-by-testID timeouts under load). Both files re-run 3×: **3/3 passed** |
| `npx vitest run src` (backend unit specs, no DB, no Redis) | 1509 passed, **7 failed**, 17 skipped. 6 failures are Redis specs with `ECONNREFUSED` (no Redis running). 1 is `tenant-scope-callsites` (Windows path, below) |

**Not run in this audit:**
- the backend DB-backed e2e suite;
- `db:check`;
- `expo export`;
- Docker;
- k6.

### Earlier full backend run (author-reported, not re-run)

| Result | Count |
|---|---|
| Passed | 4279 |
| Failed | 12 tests in 18 files |
| Skipped | 79 |

Classification of the 18 failing files, re-checked against the test code:

| Group | Classification | Confidence |
|---|---|---|
| `spawn npx ENOENT`: `admin-bootstrap`, `database-roles`, `platform-admin-invariant`, `envelope-key-rotation*`, `rls-proposal`, one `rls-runtime-role` case | **Windows-only.** `execFileSync('npx', …)` without `shell:true` (`admin-bootstrap:105`, `envelope-key-rotation:171,216,228`, `test/support/isolated-database.ts:185,187`, `run-e2e-as-runtime-role.ts:57`). Linux is unaffected; none of these files are in the diff. | CC |
| `facility-foundation`, `multi-hospital-data-model` | **Opt-in** (`MEDORA_FACILITY_DISPOSABLE_DB=1`, `MEDORA_PHASE21_DISPOSABLE_DB=1`). They passed on a disposable DB in the earlier run. | CC + author-reported |
| `rls-inventory` | **Windows CRLF.** `split('\n')` over `RLS_DESIGN.md`; `core.autocrlf=true` and there is no `.gitattributes`. | CC |
| `production-seed-credentials` | **Windows-only, pre-existing.** `path.relative` produces backslashes. | CC |
| `tenant-scope-callsites` | **Windows-only, pre-existing.** `endsWith('shared/database/tenant-context.ts')`. The PR's three new reviewed entries are complete. | V (reproduced locally) |
| 5-second timeouts in 6 files | Author-reported to pass with `--testTimeout=120000`. **Not re-verified** (needs a DB). | Author-reported |

`main` CI run 45668676846 (at `8161a1a`) reported the backend job as **success**. That is consistent with every non-timeout failure above being Windows-only or opt-in.

**R-26 (Low): flaky tests.** Three patient-app tests are flaky under full-suite load: the two above, plus `notifications.test.tsx > marks all read across every page loaded` from the earlier run. They should be stabilised, or given larger `findBy` timeouts.

### CI state (R-03)

- `gh run list --branch claude/patient-app-end-to-end` returns no runs, and `statusCheckRollup` is `[]`.
- The new e2e specs `patient-booking`, `patient-account-link`, `patient-info-layer`, `patient-hospital-discovery`, `patient-ai` and `patient-lab-notifications` have **never run in CI**.
- On the latest `main` push run (45668676846), the aggregate `CI` job and the nightly k6 runs (45805181893, 45985345280) failed to start, with the message: *"The job was not started because recent account payments have failed or your spending limit needs to be increased."* That is GitHub billing, not code.

## 13. Release readiness

| Dimension | State |
|---|---|
| Merge | Blocked by R-01, R-02, R-03 |
| Patient booking in production | Blocked: no slot-publishing API or UI, no staff reschedule queue UI, R-07, R-08, R-09 |
| Record linking in production | Backend ready; no staff web UI (admin-only API) |
| Patient AI in production | Blocked: no provider, no DPA, R-04, R-10, R-11, R-12, clinician sign-off |
| Push | Blocked: no provider, no real EAS projectId, no token registration |
| App store build | Blocked: `EXPO_PUBLIC_API_BASE_URL` missing from EAS profiles (fails at boot by design), placeholder `extra.eas.projectId`, R-13 |

## 14. Open owner decisions (preserved, not decided)

1. ADR-031: results release policy. Nothing may be exposed until it is decided (see R-02).
2. ADR-039 item 5: the insurance approval workflow.
3. Messaging policy beyond the approved "disabled" state.
4. ADR-033 Q3 (patient reply to a clinic proposal) and Q4 (timing windows).
5. Clinical sign-off on the emergency and escalation wording, and on the Arabic safety text (R-10, R-11).
6. Whether reception staff may link patient accounts. Today it is admin only, and that was verified.
7. **New, raised by this audit:**
   - whether staff `notes` and `reason` are patient-visible (R-06);
   - whether `bloodType` (R-25) and diagnostic `testName` (R-24) are acceptable;
   - the booking cap value (R-05);
   - whether any hospital holding a record may unlink (R-20);
   - AI retention (R-30).

## 15. Merge blockers

| ID | Area | Fix scope |
|---|---|---|
| R-01 | Backend | Clear or rebind `publishedSlotId` on doctor reschedule; map 23514 to 409; e2e |
| R-02 | Backend + **new** DB migration | Deny the three clinical file kinds to the patient role in `FileAccessService` and in `app_rls.file_of_current_patient`; e2e |
| R-03 | Process | Resolve Actions billing, then one CI run on the final head (no `[skip ci]`) |
| R-04 | Backend (recommended) | Purge or bind personal AI threads on unlink. Small, and it closes a cross-record path before any provider is enabled |

## 16. Production blockers (beyond merge)

**Engineering:**
- slot-publishing API and UI;
- staff web UI for linking and for reschedule approval;
- R-05, R-07, R-08, R-09, R-12, R-13.

**Clinical:**
- R-10 and R-11, with clinician sign-off.

**External dependencies:**
- the production API URL in the EAS profiles;
- a real EAS project ID;
- push credentials;
- AI provider credentials and the data-processing agreement;
- emergency numbers for every release country.

**Pre-deploy:**
- run the R-14 duplicate preflight query;
- set rate limiting on (R-19).

## 17. Post-merge roadmap

- Hardening and cleanup:
  - HMAC link codes (R-18);
  - remove the linking oracle (R-17);
  - map the remaining errors (R-15);
  - cross-hospital overlap check (R-16);
  - lifecycle edge cases (R-21);
  - app UX fixes (R-22);
  - short policy-number masking (R-23);
  - stabilise the flaky tests (R-26);
  - make `supersedeStale` read-only;
  - purge spent link codes.
- Features:
  - push token registration and a provider;
  - model-output validation (R-29);
  - multi-turn red-flag context;
  - a link/unlink notice to the patient.
- Documentation (R-27):
  - `docs/DECISIONS.md:5121` still reads "Draft for the coordinator to merge…";
  - `patient-app/docs/ARCHITECTURE.md:210-211` says two service files are "pending" though they exist;
  - `CLAUDE.md` still says the highest ADR is 044 and the next is 045. It should be updated, but only with the owner's authorisation;
  - ADR-047 has no register row, which is pre-existing.

## 18. Temporary worktree and branch comparison

Each sub-branch was compared with `claude/patient-app-end-to-end` by ancestry, by patch identity (`git cherry`) and by content. Each merge commit's conflict resolution was inspected with `git show --remerge-diff`.

| Sub-branch | Tip | Ancestor of PR head | Commits not in PR | Patches not in PR |
|---|---|---|---|---|
| `--be-appointments` | `cb37cb7` | yes | 0 | 0 |
| `--be-identity` | `a9a914e` | yes | 0 | 0 |
| `--be-ai` | `5b28445` | yes | 0 | 0 |
| `--app-identity` | `1fdc9fd` | yes | 0 | 0 |
| `--app-appointments` | `fe0ceec` | yes | 0 | 0 |
| `--app-health-ai` | `8a1d804` | yes | 0 | 0 |

Some files differ between a sub-branch tip and the PR head. Every difference comes from later merges or follow-up commits on the PR branch combining slices, not from lost work.

Remerge-diff shows that manual conflict resolution happened only in three merges:
- **`0536d88`:** `openapi.json` and the route-matrix snapshot, both regenerated from the merged code.
- **`9592f3f`:** `ARCHITECTURE.md`, `ar.ts`, and the `ai`/`health`/`parity`/`service-seam` tests. The `ar.ts` resolution intentionally dropped strings for the deleted record screens and kept the insurance string.
- **`d55ee37`:** `ARCHITECTURE.md` tables.

The other three merges resolved cleanly.

**Conclusion:** no unmerged work or useful agent change remains in the six sub-branches. All six worktrees and branches still exist and are untouched. **No cleanup was performed.** It awaits explicit approval.

## 19. Recommended next actions

Proposed fix batches, all on the existing PR #68 branch, with no new PR. **None is started; each needs approval.**

| Batch | Contents | Trees | Independent? | Scope / risk |
|---|---|---|---|---|
| 1 | R-01: doctor reschedule slot handling, 23514 → 409 mapping, e2e | Backend | Yes | Small / low |
| 2 | R-02: deny clinical file kinds to patients in the service, plus a **new** migration redefining `app_rls.file_of_current_patient`, plus e2e | Backend + DB | Yes | Small / medium (RLS change; needs DB-change approval) |
| 3 | R-04: purge or bind personal AI threads on unlink; R-23 masking | Backend | Yes | Small / low |
| 4 | R-12: send the assistant locale; R-22: app UX fixes; R-26: flaky tests | Patient App | Yes | Small–medium / low |
| 5 | R-05 (needs the cap value), R-06 (needs a decision), R-15, R-17 | Backend | After owner decisions | Medium / low |
| 6 | R-07: timezone contract (hospital tz on slot and appointment payloads; app formats in it) | Backend + Patient App | After 1 | Medium / medium |
| 7 | R-08 / R-09: reschedule-request notification rule and expiry; time-off filtering | Backend | Yes | Medium / medium |
| 8 | Slot publishing; staff linking and reschedule UI | Backend + **Web frontend** | Separate PR(s), owner decision | Large |
| 9 | Documentation drift (R-27) | Docs (+ CLAUDE.md with authorisation) | Yes | Trivial |

**Recommended order:** 1 → 2 → 3, then one local backend gate with a DB, then CI.

1. Do batch 1, then batch 2, then batch 3.
2. Run the local backend gate, including `db:check` and the new e2e specs, on a disposable DB.
3. Resolve GitHub Actions billing.
4. Push **one** commit **without** `[skip ci]` so the PR runs CI once (R-03).

Batches 4, 7 and 9 can follow in the same PR if approved. Batches 5 and 6 wait for owner decisions, and batch 8 is roadmap work.

---

### Audit actions performed (all read-only except writing this file)

- **Git and GitHub reads:**
  - `git fetch`, `git worktree list`, `for-each-ref`, `ls-remote`;
  - `gh pr view 68`, `gh run list`, the Actions jobs and annotations API;
  - `git merge-base`/`--is-ancestor`, `git cherry`, per-file `git diff`, `git show --remerge-diff` on every merge commit;
  - `git status --porcelain` on all seven task worktrees, before and after.
- **Local checks** (Agent F, listed in §12): typecheck, lint and jest for the patient app; typecheck, lint and no-DB vitest for the backend.
- **Not done:**
  - no commits, pushes, merges, deployments, CI triggers, Docker, migrations or database access;
  - no edits to any file other than this report.
