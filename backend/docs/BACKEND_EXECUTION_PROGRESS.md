# Medora Backend — Execution Progress (implementation mission)

Companion to `backend/docs/BACKEND_COMPLETION_AUDIT.md` (the 97-task audit at `8161a1a`, preserved unchanged).
This file tracks what the implementation mission changed; the audit's original findings are not edited.

- **Branch:** `claude/medora-backend-audit-44bxad` (local commits only — **nothing pushed**, no PR, no CI run).
- **Base:** `8161a1a6df3da3bf977f50cccef2be578c9c4744` (= `origin/main` when the mission started).
- **Scope kept:** backend `src/` and `test/`, backend docs. No change to `prisma/**` (schema, migrations, seeds,
  roles SQL), `frontend/`, `patient-app/`, `.github/`, `Dockerfile`, `docker-compose.yml`, `CLAUDE.md` or root `docs/`.

## 1. Verification environment (local, reproducible)

| Item | Value |
|---|---|
| Node / npm | v22.23.5 / 10.9.9; `npm ci` from `backend/package-lock.json` |
| PostgreSQL | 16.15, local throwaway cluster; role `medora` (superuser, as CI's service container), dbs `medora_test`, `medora_shadow` |
| Redis | 7.x local (`redis-server`, snapshots disabled) |
| Database prep | `db:check` → "No difference detected"; `db:deploy` (all migrations); `db:seed` |
| Runtime-role runs | `npm run test:e2e:runtime-role -- <specs>` (provisions `medora_e2e_app_runtime`, NOSUPERUSER/NOBYPASSRLS, from `prisma/roles/provision-runtime-role.sql`) |

Every change below was run **as owner and under the restricted runtime role**.

**Final gate at `5ff7759` (+ comment-only `a0dbb7b`), all executed locally:**

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 (after fixing 2 `require-await` errors in `dr05-resource-scope.e2e-spec.ts`; 0 warnings) |
| `npm run test` (unit + e2e, owner connection) | 4342 passed, 7 skipped, 2 failed + 3 files refused to start. The 2 failures (`schema-reference`) were leftover `az04_*` roles from an early iteration of this mission's own test, removed from the local DB; the 3 files (`facility-foundation`, `multi-hospital-data-model`, `rls-proposal`) refuse to run outside CI without a disposable-DB opt-in. Re-run with `CI=true`: 4 files, 55 passed |
| `npm run build` | exit 0 |
| `npm run test:e2e:runtime-role` (whole `test/` directory as `medora_e2e_app_runtime`) | **162 files passed, 2 skipped; 2920 passed, 7 skipped, 0 failed** | The audit's RLS-02 point stands:
CI still runs e2e as owner only (changing CI was not authorized).

## 2. Task ledger (audit IDs)

Status per the mission's vocabulary. "Verified" = targeted specs executed and passing as owner **and** runtime role.

| ID | Before | After | Commit | Evidence (tests) |
|---|---|---|---|---|
| AZ-04 custom-role identity reveal | DEFECT P1 | **DONE** | `2e077b6` | `patients-reveal.e2e-spec.ts` "AZ-04 …" (red on old code: full identity returned; green now) |
| AI-02 ref-bound AI thread hospital stamp | DEFECT P1 | **DONE** | `2e077b6` | `ai-assistant.e2e-spec.ts` "stamps a reference-bound thread …" (red on old code) |
| AI-08 gateway payload leakage test | MISSING P2 | **DONE** | `b7aa224` | `ai-assistant.e2e-spec.ts` "carries nothing of another chart …" |
| NOT-01 delivery crash recovery / retry | DEFECT P2 | **DONE** (email; push failure stays terminal) | `11aa2b5` | `notification-delivery-recovery.e2e-spec.ts` (7) |
| ADM-01 hospital/clinic/location/department admin | MISSING P1 | **DONE** | `ede2c3e` | `hospital-admin.e2e-spec.ts` (11) |
| ADM-03 insurance providers + coverage admin | MISSING P1 | **DONE** | `ede2c3e` | `insurance-admin.e2e-spec.ts` (7) |
| OPS-03 DB pool / session timeouts | MISSING P2 | **DONE** (statement timeout opt-in, default off) | `2458d8a` | `database-pool.e2e-spec.ts`, `env.spec.ts`, `prisma.service.spec.ts` |
| MSG-01 messaging participant rule (F1) | DEFECT P1 | **DONE** | `86fa110` | `messaging-participants.e2e-spec.ts` (12) |
| DSC-01 patient discovery rows | MISSING P1 | **DONE** (rating null — DSC-03) | `bc42f4a` | `patient-discovery.e2e-spec.ts` (22), `discovery.service.spec.ts` |
| DSC-02 distance from request coordinates | MISSING P1 | **DONE** | `bc42f4a` | same |
| DSC-04 insurance-aware, uninsured unrestricted | MISSING P1 | **DONE** | `bc42f4a` | same |
| DSC-05 `/patient/doctors` hospital + next slot | PARTIAL P1 | **DONE** (additive fields) | `bc42f4a` | same + `patient-api.e2e-spec.ts` |
| XH-03 controlled access survives transfer | DEFECT P1 | **PARTIAL** — step 1 done (revoked in the staffing transaction, audited); step 2 (source employment on the grant, checked in RLS) is a DB dependency | `b6291f6` | `controlled-access-lifecycle.e2e-spec.ts` |
| XH-05 list / queue endpoints | MISSING P1 | **DONE** | `b6291f6` | same |
| XH-07 404 after the window | DEFECT P2 | **DONE** | `b6291f6` | same + `controlled-access.e2e-spec.ts` (8 expectations 403→404) |
| XH-08 existence oracle on request | DEFECT P2 | **PARTIAL** — probe attempts now audited (fail-closed); the 404 stays. A uniform answer needs a DB change (below). A decoy-201 design was rejected as a misleading success | `b6291f6` | same |
| XH-09 lifecycle audit transactional | PARTIAL P2 | **DONE** | `b6291f6` | same (audit-failure rollback cases) |
| XH-01 approver narrows categories / end | PARTIAL P1 | **DONE** (requested categories survive in the audit rows only) | `b6291f6` | same |
| AUTH-07 per-account second-factor budget | DEFECT P2 | **DONE** for the budget; TOTP-replay refusal BLOCKED (DB) | `f4f3437` | `auth-otp-budget.e2e-spec.ts` (9), `auth-recovery-code.e2e-spec.ts` updated |
| AZ-06 refused reaches audited (B5) | NEEDS VERIFICATION P2 | **DONE** | `8bffc42` | `patients-reveal.e2e-spec.ts` "AZ-06 …" |
| SLT-01 publish / withdraw slots | MISSING P1 | **DONE** | `57da74c` | `published-slots.e2e-spec.ts` (17) |
| SLT-02 patient bookable-slot list | MISSING P1 | **DONE** | `57da74c` | same (incl. runtime-role fix) |
| SLT-03 atomic idempotent booking | MISSING P1 | **DONE** | same | `patient-booking.e2e-spec.ts` (15), `patient-booking-concurrency.e2e-spec.ts` (8-way → exactly one 201) |
| SLT-04 insurance validation at booking | MISSING P1 | **DONE** | same | same |
| SLT-05 record created on first booking | PARTIAL P1 | **DONE** | same | same |
| APT-02 idempotency hardening | DEFECT P2 | **PARTIAL** — post-commit result-store failure no longer re-executes; key required on booking; stale `in_progress` takeover not done (unsafe without knowing commit state); other routes keep an optional key | same | same + `idempotency.e2e-spec.ts` |
| XH-10 Break-Glass notifies target admins | NEEDS VERIFICATION P2 | **DONE** (activity-feed entry; see new items) | `6c5d0ed` | `controlled-access-notification.e2e-spec.ts` (4) |
| AUTH-08 seeded admin completes TOTP | NEEDS VERIFICATION P3 | **DONE** (verified by execution) | — | `admin-bootstrap.e2e-spec.ts` (passes, incl. runtime role) |
| DOCS-04 stale code comments | MISSING P3 | **DONE** — files/platform-settings/jobs and the `users/` self-profile comments fixed; messaging attachment, lab attachment and AI gateway comments verified accurate (past tense / design citation) | `08a1c2f`, `a0dbb7b` | comment-only diffs |
| AUTH-09 deep refresh reuse | PARTIAL P3 | **BLOCKED** (DB + ADR amending ADR-026/045) | — | — |
| ADM-05 `/me/data-export` | MISSING P2 | **BLOCKED** (owner: contents, patient clinical data vs ADR-031, tracking row) | — | — |
| OPS-01 image build | NEEDS VERIFICATION P1 | **DEFECT confirmed** (infra) — `npm ci` in the deps stage exits 1: `prisma generate` finds no schema | — | literal reproduction of `Dockerfile:12-13` (log kept in the session scratchpad) |
| OPS-04 multi-instance jobs | NEEDS VERIFICATION P2 | **BLOCKED** (infra decision) — the 8 runnable jobs cannot corrupt data on N inline instances, but each instance repeats the work; `audit.retention-sweep`, `files.malware-scan`, `files.orphan-sweep` race harmlessly. Production should use the bullmq driver or add a leader lock | — | read-only verification |
| OPS-08 body validation | NEEDS VERIFICATION P3 | **PARTIAL** — all 158 `@Body` use `zodBody`; unknown keys are stripped, not rejected (strictness is an API decision) | — | read-only verification |

Also changed at integration (main agent): `tenant-scope-callsites.spec.ts` now detects raw `set_config('app.scope', …)`
(the staffing revocation used one and the helper-name pattern missed it) and lists every reviewed site;
`authz-route-matrix.snapshot.txt` and `docs/openapi.json` regenerated (39 new operations, **0 removed**; only the two
approve routes changed shape — the optional narrowing fields).

### Count against the audit matrix (97 tasks)

| Status | Audit (`8161a1a`) | Now |
|---|---|---|
| DONE | 20 | **46** |
| PARTIAL | 11 | 10 |
| MISSING | 23 | 9 |
| DEFECT | 15 | 7 |
| BLOCKED | 19 | 22 |
| NEEDS VERIFICATION | 9 | 3 |

Remaining DEFECT: AZ-10, RLS-03, RLS-04, RLS-06 (DB), XH-11 (owner), OPS-05 (needs a durable store), OPS-01 (infra).
Remaining NEEDS VERIFICATION: AZ-09, RLS-07, CLN-02.

## 3. New findings during implementation (not in the audit)

| ID | Finding | Status | Owner |
|---|---|---|---|
| AZ-11 | `POST /roles` accepts 30-character codes; `audit_events.actor_role` is `VARCHAR(20)`. A holder of a 21–30 character custom role fails every fail-closed audit (PHI reads answer 503). The web client also allows 30 (`frontend/src/features/admin/access/role-rules.ts:33`). | BLOCKED — widen `actor_role` to `VARCHAR(30)` (DB) | Database |
| RUN-01 | A Prisma query is lazy: returned un-awaited from `runAsSystem(() => …)` it runs after the system context ends, under the caller's scope. Found in the new patient slot list (listed nothing under RLS) and latent in the new messaging lookup; both fixed. Pre-existing sites already used `async () => await …`. | DONE (fixed); a lint rule would make it structural | Backend |
| SLT-07 | The doctor's own `POST /appointments` does not consult published slots; a doctor can book over their own published slot (the slot then disappears from the patient list; the no-overlap constraint prevents a double booking). | P3, design choice to confirm | Owner / Backend |
| XH-13 | Break-Glass "notification" is a security entry in the admins' activity feed, written after the grant commits by a recorder that swallows errors; no push/email. | P3, owner design | Owner |
| NOT-02b | Push delivery failures stay terminal (no retry); `push-delivery.e2e-spec.ts` asserts that today. | P3 | Backend |
| XH-01b | Approver narrowing overwrites `categories` on the grant row; the requested set survives only in the audit rows. An `approved_categories` column would keep both. | P3 | Database |

## 4. Database dependencies (exact; nothing was changed)

| Need | Why | Unblocks |
|---|---|---|
| `exceptional_access_grants` / `information_requests`: source employment (or hospital) column, checked in `app_rls.has_controlled_access` | grants must die with the requesting employment at the DB layer too | XH-03 step 2 |
| nullable `hospital_medical_record_id` (+ `patient_id`) on both tables, CHECK that ACTIVE/APPROVED requires a record | store an unmatched request as PENDING so the response is uniform | XH-08 |
| `user_credentials.totp_last_step bigint NULL` | refuse a replayed TOTP time-step | AUTH-07b |
| `audit_events.actor_role` → `VARCHAR(30)` | match `roles.code` | AZ-11 |
| retired refresh-token hash history table (or a new token format) + ADR | detect reuse of tokens ≥2 rotations old | AUTH-09 |
| `approved_categories` on grants, CHECK `approved_categories <@ categories` | keep requested vs approved on the row | XH-01b |
| unchanged from the audit: RLS-03, RLS-04, RLS-06, RLS-05, RLS-08 (S2 backfill + owner review before any deployment), consultation and provenance tables (CONS-01, DOC-01), `ai_messages.data_class` (AI-04), `HospitalSetting` / moderation (ADM-04, DSC-03), durable dead-letter store (OPS-05) | | |

## 5. Owner decisions still required

Unchanged from the audit (OWN-1 … OWN-14), plus:
- **ADM-05** — what a personal data export contains; whether patient clinical data is excluded until ADR-031.
- **XH-13** — whether Break-Glass needs a real notification channel (push/email), not only the activity feed.
- **SLT-07** — whether a doctor's own booking must respect published slots.
- **OPS-03** — the production `DATABASE_STATEMENT_TIMEOUT_MS` value (shipped opt-in, default off).
- **MSG-01** — whether custom roles derived from doctor/staff may be messaging participants (they are refused, fail-closed).
- The 2026-11-24 doctor-derived custom role question generally: such roles hold doctor permissions but no care reach anywhere (reveal, records, messaging all refuse) — consistent and fail-closed, but probably not what an owner creating such a role expects.

## 6. Not done in this session

- RLS-02 (CI runtime-role step), OPS-07 (CI gates): CI changes not authorized.
- OPS-01/OPS-02 (Dockerfile, migrate job): infrastructure, not authorized. Fix for OPS-01: copy `prisma/` and
  `prisma.config.ts` before `npm ci` (or `npm ci --ignore-scripts` then `npx prisma generate` in the build stage).
- DOCS-01/02/03: `docs/multi-hospital/BACKEND_CHECKLIST.md`, `API_CONTRACT_CHANGES.md` and the other root `docs/`
  files, and `CLAUDE.md`, are shared documentation; the mission did not authorize editing them. This file's ledger
  is the reconciliation to apply. `backend/docs/PATIENT_MOBILE_API_CONTRACT.md` §4 still marks P4.3/P4.4 blocked —
  update it together with the client teams (the contract's change-control rule).

## 7. Continuation point

1. Re-verify: `git log --oneline 8161a1a..HEAD` (this branch), clean tree apart from the two preserved audit files.
2. Recreate the local DB (section 1) and run the backend gate plus `npm run test:e2e:runtime-role` (whole suite).
3. Next eligible backend work, in order: AZ-09 (an idempotent replay re-checks resource scope) test; NOT-02b push
   retry (with the push-delivery assertion); a lint/spec guard for RUN-01 (lazy Prisma query inside `runAsSystem`);
   CLN-02 once the owner answers; then the DB-dependent items as the Database team lands them.
4. Owner/infra/CI items: section 5 and section 6.

## 8. Integration with `origin/main` (merge, 2026-11-28)

`origin/main` advanced 44 commits (to `01edb56`) after this work started, and independently delivered
ADR-048 (patient account linking), **ADR-049** (patient booking, cancellation, reschedule requests) and
**ADR-050** (patient hospital directory, information layer, patient AI). It was merged into this branch with a
merge commit; the 17 commits above are unchanged ancestors.

**Resolution rule: main is authoritative where both sides built the same thing.**

| Area | Taken from main | Kept from this branch | Removed from this branch |
|---|---|---|---|
| `POST /me/appointments` | `PatientBookingController/Service/Repository` (initial status `pending`, ADR-049) | — | the branch's booking service and its route on `PatientAppointmentController` |
| `GET /patient/doctors/:doctorId/slots` | main's `PatientSlotController` (response contract unchanged) | — | the branch's `patient-slot.controller.ts`, `PublishedSlotService.bookable` and the booking-only repository methods |
| `GET /patient/hospitals[/:id]` | `PatientHospitalController` (ADR-050) | — | the two handlers on `DiscoveryController` and their service, repository, DTO and schema code |
| `/patient/doctors[/:id]` | main's DTO/repository/service (its own `hospital` field) | — | the branch's additive `nextAvailableSlot` field (not in main's contract) |
| Doctor slot publishing | — | `POST/GET/DELETE /me/published-slots` (main has none; ADR-049 notes publishing as unbuilt) | — |
| Discovery search | — | `GET /patient/discovery/search` | — |
| Security fixes, controlled access, AUTH-07, AZ-06, NOT-01, OPS-03, admin/insurance | — | all (none conflicted; the three original defects are still fixed in the merged tree) | — |

Constraint mapping: main's booking maps every unique violation, including the new
`appointments_one_live_booking_per_slot`, to `409 slot_taken`; the branch's `booking-errors.ts` is reduced
to the `mentionsConstraint` helper still used by slot publishing. The 8-way concurrency spec now runs
against main's route (exactly one 201, one row).

**Follow-up fixes made during integration:**
- Discovery treated a `rescheduled` booking as releasing its slot; main's index and `SLOT_HOLDING_STATUSES`
  treat it as holding. Aligned (`RELEASED_STATUSES = CANCELLED, COMPLETED, NO_SHOW`), with a test that fails
  on the old definition.
- `NotificationDeliveryService.finish()` is fenced on the claim (`status = 'sending'` and the claimed
  `attempts`), so a worker that outlived its lease cannot overwrite a newer claim's outcome (test fails on
  the old code). A deleted row keeps today's P2025 behaviour, which `push-delivery.e2e-spec.ts` pins as a
  known defect awaiting a decision.
- The scope-selection scanner also matches `SET [LOCAL] app.scope` and a double-quoted `set_config`, with a
  focused pattern test; its reviewed list matches the merged tree.

**Corrections to earlier sections:** patient cancellation and reschedule *requests* are no longer blocked on
ADR-033 — ADR-049 decided and main implemented them; only re-confirming a clinic proposal (ADR-033 Q3)
remains open. SLT-02…SLT-05 are now satisfied by main's ADR-049 implementation, not by this branch's code.

**Deferred LOW findings (with rationale):** the Break-Glass/transfer race needs the source-employment column
(XH-03 step 2, Database); custom roles are refused as messaging participants (fail-closed, consistent with
AZ-04); `liveBookingOf` ignores soft-deleted appointments while main's index does not (theoretical); the
discovery next slot has no 31-day window while main's listing defaults to one (UX only).

**Verification of the merged tree (local):** typecheck, lint and build pass; the full suite as owner (CI
mode): 4567 passed, 1 failed — `doctor-soft-delete.e2e-spec.ts`, identical to main's file, a global row
count shifted by concurrent suites (passes alone, twice); the whole e2e suite under the restricted runtime
role: 171 files, 3016 tests, 0 failures.
