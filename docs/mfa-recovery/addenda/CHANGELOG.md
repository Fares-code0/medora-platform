# MFA Recovery: Addenda Changelog

Changes recorded **after** v1.2.1. The v1.2.1 changelog (`../v1.2.1/MFA_RECOVERY_V1.2.1_CHANGELOG.md`) and every
v1.2.1 document are unchanged; this file continues the record without editing them.

## 2026-11-14 — decisions D1 and D2

| File | Nature |
|---|---|
| `2026-11-14_OWNER_DECISION_ADDENDUM_D1_D2.md` | New. Verbatim owner decisions; compatibility verdicts against the v1.2.1 originals; implemented scope |
| `2026-11-14_COMPATIBILITY_MATRIX_SUPPLEMENT.md` | New. Matrix rows 9.01–9.08 (Part C) |
| `CHANGELOG.md` | New. This file |

| Item | Recorded status |
|---|---|
| D1 — shared password lockout on `POST /me/password` and `POST /me/2fa/disable` | APPROVED (2026-11-14); COMPATIBLE; implemented on branch `claude/mfa-security-decisions-1-2` (one consolidated pull request; not merged) |
| D2 — current password before first-time `POST /me/2fa/setup` (all roles); web and patient-app clients | APPROVED (2026-11-14); COMPATIBLE; invitation acceptance excluded for `admin`, `reception`, `laboratory` and `pharmacy` (no prior password); implemented on branch `claude/mfa-security-decisions-1-2` (one consolidated pull request; not merged) |
| Every v1.2.1 MRD, FD, CL, R, A, IMP, DB, MRR, NR and ACC item | **Unchanged.** No risk accepted (0 of 12 ACC records). IMP-30 still BLOCKED / NOT IMPLEMENTED |

Also updated, outside this directory: `backend/docs/BACKEND_API_CONTRACT.md` §2.9 (the setup request body, and the
lockout outcome on the three password-checking `/me` routes).

## 2026-11-14 — owner clarifications after the security review

| File | Change |
|---|---|
| `2026-11-14_OWNER_DECISION_ADDENDUM_D1_D2.md` | §2.2 and §2.3 corrected: the invitation exception names all four invitable roles; the `enable` row no longer claims every pending secret was password-checked; §3.3 lists the unchanged invitation flow and `enable`; new §5 (invitation exception APPROVED with its sequence and limits; pre-D2 pending secrets recorded as a known, unresolved limitation; route-specific audit metadata recorded as a potential improvement) |
| `2026-11-14_COMPATIBILITY_MATRIX_SUPPLEMENT.md` | Row 9.08 corrected (four roles); row 9.09 added (pending-secret limitation) |
| `CHANGELOG.md` | This entry |

No v1.2.1 document, risk record or decision status is changed. No ACC record is created or accepted.

## 2026-11-14 — final review corrections

| File | Change |
|---|---|
| `2026-11-14_OWNER_DECISION_ADDENDUM_D1_D2.md` | Companions line: rows 9.01–9.09. §5.3: the web lockout row states the exact classification (429 with code `rate_limited`) and the once-only sign-out; new open row for the enrolment and re-enrolment dialogs, which still classify by status |
| `frontend/src/features/doctor/settings/model/password-lockout.ts` (new), `sections/AccountSection.tsx`, `components/TwoFactorDialogs.tsx` | Change-password and 2FA-disable treat a 429 as the password lockout only with the server's envelope code `rate_limited`; each ends the session at most once. Tests: `AccountSection.lockout.test.tsx` (new), `TwoFactorDialogs.test.tsx` |
| `CHANGELOG.md` | This entry |

No v1.2.1 document, risk record or decision status is changed.

## 2026-11-14 — validation record

Run against a disposable local PostgreSQL 16.15 cluster (its own data directory and port; not the system cluster) and
a disposable local Redis, migrated and seeded with the repository's own `db:check`, `db:deploy` and `db:seed`. No
Docker daemon was available, so these were local processes rather than containers. Both were removed afterwards.

| Suite | Result |
|---|---|
| Backend, full `vitest run`, one file at a time, Redis flushed first | 216 files passed, 2 skipped; 3447 tests passed, 7 skipped, 0 failed. The 2 skipped files are the opt-in live object-storage specs (`s3-live`, `storage-live`) |
| Backend, D1/D2 and related auth specs (verbose) | `auth-two-factor` (38, including all 7 D1/D2 cases), `auth-login`, `auth-recovery`, `auth-recovery-code`, `auth-reauthenticate`, `auth-admin-invitation`, `patient-identity`, `users-account`, the 5 Redis-backed specs and `password-guess-budget`: 263/263 |
| Frontend | Typecheck, lint (0 errors), build pass; 3302 tests passed, 3 skipped |
| Patient app | Typecheck, lint, build pass; 2112 tests passed |

Pre-existing, unrelated flakiness seen in parallel full runs, in specs and code this change does not touch:
`rate-limit` (the fail-open limiter's Redis connection not yet writable at the first requests), `push-delivery`
(timing under load), and `medications` (fails when re-run within the 1-hour `reference-data` Redis cache TTL of a
previous run, because the test inserts a formulary row directly and the cached list does not see it). Each passes in
isolation and in the clean run above.


## 2026-11-14 — PRE-01 implementation authorization

| File | Nature |
|---|---|
| `2026-11-14_OWNER_DECISION_ADDENDUM_PRE-01.md` | New. Records the owner's G4 implementation authorization for PRE-01 (and PRE-01 alone), the implementation's verified status against spec §5.1, the logout exception, the MRR-01 status, and where PRE-01 changes a statement in the D1/D2 addendum §5.3 |
| `CHANGELOG.md` | This entry |

| Item | Recorded status |
|---|---|
| PRE-01 | **AUTHORIZED FOR IMPLEMENTATION (G4)**; IMPLEMENTED in the uncommitted working tree of `claude/backend-four-phase-hardening`, pending owner review; G6–G9 not given. The "wrong session kind" clause is NOT IMPLEMENTED (no recovery sessions exist) |
| MRR-01 | MITIGATED in the working tree only; not merged; **not accepted** (ACC-01 unchanged) |
| C-12 | Unchanged (OPEN); not exercised — the session read is uncached |
| Every other v1.2.1 MRD, FD, CL, R, A, IMP, DB, MRR, NR and ACC item | **Unchanged** |

No v1.2.1 document and no file in `../v1.2-review/` is changed; hashes are recorded in the addendum's §7.

## 2026-11-14 — PRE-01 owner decisions and load validation

| File | Change |
|---|---|
| `2026-11-14_OWNER_DECISION_ADDENDUM_PRE-01.md` | Status: G4 APPROVED; PRE-01 behaviour APPROVED; logout exception APPROVED with its four safeguards; wrong session kind UNRESOLVED by owner instruction; G7 (push, one pull request to `main`) authorized; G8 and G9 not authorized. New §2.3: load and outage measurements. §6 replaced by the owner's decisions, verbatim |
| `CHANGELOG.md` | This entry |

No v1.2.1 document and no file in `../v1.2-review/` is changed.
