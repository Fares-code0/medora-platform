# Medora — MFA Recovery: Repository Compatibility Matrix (v1.2.1)

**Supersedes** `../mfa-recovery-v1.2/MFA_RECOVERY_COMPATIBILITY_MATRIX_v1.2.md` (preserved unchanged).

**v1.2.1 changes:**

- **Task references follow the I-1 split:** IMP-11a (capability union, before DB-04), IMP-11b (disable field),
  IMP-11c (screens, after IMP-08).
- **Row statuses:** rows 8.27, 8.28, 8.32 and 8.33 are updated for the owner decisions.
- **The "Decision" column now names decisions that are APPROVED** (2026-11-13), except MRD-25 and MRD-26
  (DEFERRED) and MRD-29 (OPEN). See `MFA_RECOVERY_OWNER_DECISIONS_v1.2.1.md`.
- **Fit is a repository-fit rating, not a decision status.** Evidence is unchanged at `452dd006`.

**Baseline (read-only, git objects):**

| Ref | Commit |
|---|---|
| `origin/backend` | `cce25437` |
| `origin/frontend` | `ad4c6a8d` |
| `origin/patient-app` | `2ecc9071` |
| `origin/docs/medora-owner-decisions-2026-11-06` | `b978a6cc` |

Paths are under `backend/` unless prefixed `frontend/` or `patient-app/`.

**Fit key (repository fit, not decision status):**

| Fit | Meaning |
|---|---|
| **SUPPORTED** | An existing primitive meets it as is, or as a reusable pattern |
| **EXTEND** | An existing primitive meets it after a change |
| **PRIOR WORK** | Needs a prerequisite first |
| **CONFLICT** | v1.0 conflicted with approved architecture; routed to a decision |
| **MISSING** | New build |
| **SPLIT** | Part supported, part prior work |
| **NOTE** | No change; recorded for traceability |

All evidence is **VERIFIED** at the commits above. Every task and decision column names an item defined in the
v1.2 dependencies and decisions documents.

---

## Part A — The 56 original requirements (IDs unchanged from v1.1)

### 1. Identity, roles and tenancy

| # | Requirement | Evidence | v1.1 fit | v1.2 fit | Decision | Task / DB |
|---|---|---|---|---|---|---|
| 1.1 | "Super Admin" tier | Absent from docs; OD-07 defines Platform/Hospital Admin | CONFLICT | CONFLICT | MRD-01 | — |
| 1.2 | "Support" role | Absent everywhere | CONFLICT | CONFLICT | MRD-01 | — |
| 1.3 | Platform/Hospital Admin roles | `PLATFORM_ROLES` (`src/shared/authz/permission-catalogue.ts:31`); M-13 (`docs/multi-hospital/MIGRATION_AND_COMPATIBILITY.md:48`) | PRIOR WORK | PRIOR WORK | MRD-02 | PRE-03 |
| 1.4 | Tenant binding | No hospital model in `prisma/schema/*` | PRIOR WORK | PRIOR WORK | MRD-02 | PRE-03, DB-07 |
| 1.5 | Staff map to one tenant | DR-02 covers doctors only | EXTEND | EXTEND | MRD-05 | PRE-03 |
| 1.6 | Patients tenant-bound | `User` global (`DATA_MODEL_CHANGES.md:56`); OD-004 optional | CONFLICT | CONFLICT | MRD-04 | IMP-17 |
| 1.7 | Platform Admin approvers | No tier above; bootstrap refuses once an admin exists (`admin-bootstrap.service.ts` header) | CONFLICT | CONFLICT | MRD-03, MRD-26 | IMP-15, PRE-05, DB-11 |

### 2. Sessions and tokens

| # | Requirement | Evidence | v1.1 fit | v1.2 fit | Decision | Task / DB |
|---|---|---|---|---|---|---|
| 2.1 | Per-request session validation | `access-token.guard.ts:21-24` (no database read) | PRIOR WORK | PRIOR WORK | C-12 | PRE-01 |
| 2.2 | Immediate invalidation | `session.service.ts:167`; `env.schema.ts:122` (900 s) | PRIOR WORK | PRIOR WORK | C-12 | PRE-01 |
| 2.3 | Revoke sessions and refresh | Row = refresh family (ADR-026); access tokens outlive it | SPLIT | SPLIT | — | PRE-01 |
| 2.4 | Revocation in the caller's transaction | `session.service.ts:159-173` use `this.prisma.db` | EXTEND | EXTEND | — | IMP-01 |
| 2.5 | Session kind | No column; `locked` never read in `src` | MISSING | MISSING | — | DB-03 |
| 2.6 | 15 min absolute, no slide | `rotate()` slides (`session.service.ts:112`) | EXTEND | EXTEND | — | IMP-03, DB-03 |
| 2.7 | No refresh credential | `refresh_token_hash` `NOT NULL UNIQUE` | MISSING | MISSING | — | DB-03 |
| 2.8 | Token type separation | No `typ` on access tokens (`access-token.service.ts:57-75`) | EXTEND | EXTEND | — | IMP-02 |
| 2.9 | `exp` capped at the session deadline | Access `exp` from `JWT_ACCESS_TTL` only | EXTEND | EXTEND | — | IMP-02 |
| 2.10 | Deny-by-default | `@Public()` opt-out pattern (`common/auth/public.decorator.ts:16`) | EXTEND | EXTEND | — | IMP-03 |
| 2.11 | Endpoint allowlist | No recovery routes | MISSING | MISSING | — | IMP-05 |
| 2.12 | Block contact changes during recovery | `PATCH /me/account` (`src/modules/users/controllers/account.controller.ts:54`). **Depends on the unbuilt IMP-03** | SUPPORTED | **EXTEND** (corrected) | — | IMP-03 |
| 2.13 | Rate-limited re-issue | `@RateLimited('auth')` exists; the per-request counter is new | SUPPORTED | **EXTEND** (corrected) | MRD-19 | IMP-13, DB-01 |

### 3. Recovery codes and factors

| # | Requirement | Evidence | v1.1 fit | v1.2 fit | Decision | Task / DB |
|---|---|---|---|---|---|---|
| 3.1 | Atomic single-use consumption | `step-up.service.ts:130-187`, lock at 142 | SUPPORTED | SUPPORTED | — | — |
| 3.2 | Last code starts recovery | `establishSession` at `step-up.service.ts:189` | EXTEND | EXTEND | MRD-27, MRD-02 | IMP-04, IMP-25 |
| 3.3 | Fail-closed audit | `transactional-audit.writer.ts:52-63` | SUPPORTED | SUPPORTED | — | — |
| 3.4 | Hashed codes, never restored | `recovery-code.service.ts` (HMAC, constant-time) | SUPPORTED | SUPPORTED | — | — |
| 3.5 | Count only via `GET /me/2fa` | `two-factor.service.ts:100-107` | SUPPORTED | SUPPORTED | — | — |
| 3.6 | Re-enrolment without the current TOTP | `two-factor.service.ts:117-128, 258-276` | MISSING | MISSING | MRD-15 | IMP-06 |
| 3.7 | Pending secret held in a token | `two-factor.service.ts:284-301` | SUPPORTED | SUPPORTED | — | — |
| 3.8 | Lost authenticator with codes | Re-enrolment step 2 is TOTP-only | EXTEND | EXTEND | MRD-16 | IMP-09 |
| 3.9 | Old TOTP suspended | Login challenge at `login.service.ts:228-233`. **A persisted state is needed** (S2) | EXTEND | **MISSING** (corrected) | MRD-08 | DB-09, IMP-07, IMP-19 |
| 3.10 | Attempt limits | `step-up.service.ts:73-78, 182-186`; `credential-lockout.service.ts:46` | SUPPORTED | SUPPORTED | MRD-19 | — |

### 4. Approvals and lifecycle

| # | Requirement | Evidence | v1.1 fit | v1.2 fit | Decision | Task / DB |
|---|---|---|---|---|---|---|
| 4.1 | State machine | `src/shared/status/status-machine.ts` (409) | SUPPORTED | SUPPORTED | — | IMP-05 |
| 4.2 | One active request per user | Partial unique precedent `patient_doctor_assignments_one_live_primary`. **State-only predicate** | SUPPORTED | SUPPORTED | MRD-14 | DB-01 |
| 4.3 | Two distinct approvals | `communication_access_requests` single approver (`10-communication.prisma:198`) | MISSING | MISSING | MRD-12 | DB-02, IMP-08 |
| 4.4 | Self-approval refused | Code-only precedent (`messaging/services/oversight.service.ts:182`) | EXTEND | EXTEND | — | DB-02 |
| 4.5 | Approver eligibility | No tier or tenant | PRIOR WORK | PRIOR WORK | MRD-13, MRD-05 | PRE-03, IMP-08 |
| 4.6 | 24 h expiry | M30.1 (roadmap line 1851); **repeatable jobs exist** (`shared/jobs/bullmq-job-queue.ts`) | SUPPORTED | SUPPORTED | MRD-14 | IMP-29 |
| 4.7 | Identity verification | No approved procedure (only OQ-02) | MISSING | MISSING | MRD-06, MRD-23 | IMP-13, IMP-20 |
| 4.8 | Emailed single-use token | `TokenKind` = `EMAIL_VERIFICATION`, `PASSWORD_RESET` | EXTEND | EXTEND | MRD-06 | DB-06, IMP-13 |

### 5. Permissions and contracts

| # | Requirement | Evidence | v1.1 fit | v1.2 fit | Decision | Task / DB |
|---|---|---|---|---|---|---|
| 5.1 | Permission names | 22 flat `<resource>.<camelCaseAction>`; frontend first; `permission-catalogue.spec.ts`; `varchar(60)` | CONFLICT | CONFLICT | MRD-17 | IMP-11a, DB-04 |
| 5.2 | `COMPLETE_MFA_REENROLLMENT` as a permission | A role capability can't express the target's own action | CONFLICT | CONFLICT | MRD-17 | — |
| 5.3 | Staff disable needs a code | `docs/BACKEND_API_CONTRACT.md:132`; `two-factor.service.ts:191, 205` | EXTEND | EXTEND | MRD-04 | IMP-10 |
| 5.4 | Doctor SPA disable | `frontend/src/features/doctor/settings/http/http-settings-service.ts:376, 381`; `api/useSettingsQueries.ts:133` | EXTEND | EXTEND | MRD-04 | IMP-11b |
| 5.5 | Patient app disable | `patient-app/src/api/endpoints/account.ts:173`; `features/auth/components/TwoFactorSetup.tsx:111-157` | NOTE | NOTE | MRD-04 | IMP-17 |
| 5.6 | CI coupling | `auth/dto` changes run the patient-app suite (`ci.yml`) | NOTE | NOTE | — | IMP-16, IMP-27 |

### 6. Audit and notifications

| # | Requirement | Evidence | v1.1 fit | v1.2 fit | Decision | Task / DB |
|---|---|---|---|---|---|---|
| 6.1 | Actor, target, session, time | `audit_events` (`11-platform.prisma`) | SUPPORTED | SUPPORTED | — | — |
| 6.2 | Tenant on audit rows | No column (C6) | PRIOR WORK | PRIOR WORK | — | DB-05 |
| 6.3 | Correlation id, outcome | Via `payload` | SUPPORTED | SUPPORTED | — | — |
| 6.4 | Categories | `AuditCategory` enum | SUPPORTED | SUPPORTED | — | — |
| 6.5 | Transactional notification | `shared/outbox/outbox.types.ts` (`dedupeKey`, `correlationId`) | SUPPORTED | SUPPORTED | — | IMP-12 |
| 6.6 | Email delivery with retry | M19.5, M30.1, M19.4 — **roadmap-verified, not code-verified**; new notification rules needed | SUPPORTED | **EXTEND** (corrected) | — | IMP-12 |
| 6.7 | Existing auth mail retried | `auth-mail.service.ts:28-36` (direct mailer) | EXTEND | EXTEND | MRD-18 | IMP-12 |
| 6.8 | Trusted channel | `email_verified_at`; **no email-change path** (`account.service.ts:79-102`) | SUPPORTED | SUPPORTED | — | — |

### 7. Database primitives

| # | Requirement | Evidence | v1.1 fit | v1.2 fit | Decision | Task / DB |
|---|---|---|---|---|---|---|
| 7.1 | CHECK constraints | 46 in migrations | SUPPORTED | SUPPORTED | — | DB-01 to DB-11 |
| 7.2 | Partial unique index | Precedent exists | SUPPORTED | SUPPORTED | — | DB-01, DB-09 |
| 7.3 | Row lock in a transaction | `step-up.service.ts:142` | SUPPORTED | SUPPORTED | — | IMP-04 to IMP-08 |
| 7.4 | Migration drift guard | CI `db:check` | SUPPORTED | SUPPORTED | — | — |

---

## Part B — New v1.2 requirements

| # | Requirement | Evidence | Fit | Decision | Task / DB |
|---|---|---|---|---|---|
| 8.01 | Password reset refused while suspended; outstanding reset tokens voided at recovery start | `password-recovery.service.ts:57-86` (no recovery check) | EXTEND | MRD-21 | IMP-18, IMP-14 |
| 8.02 | Reset never revokes recovery sessions | `reset()` calls `revokeAllFor` (`:86`) | EXTEND | MRD-21 | IMP-18 |
| 8.03 | Re-issue requires a password that predates the request | `user_credentials.password_updated_at` exists (`account.dto.ts:22` comment) | EXTEND | MRD-21 | IMP-13 |
| 8.04 | Persisted suspension state | None | MISSING | MRD-08 | DB-09, IMP-19 |
| 8.05 | Login, OTP verify and OTP recovery refuse while suspended (403 codes) | `login.service.ts:228-233`; `step-up.service.ts:61, 130` | EXTEND | MRD-08 | IMP-07 |
| 8.06 | Expire-before-use for stale requests; no time-dependent index | State machine; repeatable jobs | EXTEND | MRD-14 | IMP-29 |
| 8.07 | Recovery Reference (hash stored, shown only in the session) | None | MISSING | MRD-23 | DB-01, IMP-20 |
| 8.08 | Handover Code for administrator-initiated requests (whole code delivered by the initiator; keyed HMAC; never by email or SMS; CL-3) | None | MISSING | MRD-23, MRD-07 | DB-01, IMP-20, IMP-23 |
| 8.09 | Initiation confirmation and attestation evidence per approval | None | MISSING | MRD-23 | DB-02, IMP-20 |
| 8.10 | Public cancel-with-proof | None | MISSING | MRD-22 | IMP-21 |
| 8.11 | TOTP step-replay ledger | ±1 step, no ledger (`totp.service.ts:31, 94`) | MISSING | MRD-28 | DB-10, IMP-28 |
| 8.12 | Shared lockout on public endpoints | `credential-lockout.service.ts:46` | SUPPORTED | — | IMP-13, IMP-21 |
| 8.13 | Enumeration-safe public answers | `forgot()` silent precedent (`password-recovery.service.ts:57-60`) | SUPPORTED | — | IMP-13, IMP-21 |
| 8.14 | Email link: hashed, bound, single use, POST confirmation | `verification_tokens.token_hash` unique, consume pattern | EXTEND | MRD-06 | DB-06, IMP-13 |
| 8.15 | Approval re-validation at APPROVED and completion | None | MISSING | MRD-24 | IMP-22 |
| 8.16 | Employment end or change cancels the request (OD-12) | No employment model | PRIOR WORK | MRD-24 | PRE-03, IMP-22 |
| 8.17 | `/auth/otp/recovery` discriminated response | `step-up.service.ts:189`; DTO `auth/dto/login.schema.ts:44` | EXTEND | MRD-27 | IMP-25 |
| 8.18 | Doctor SPA handles `kind` | `frontend/src/api/endpoints/auth.ts:329-342` (`adoptOrRefuse`) | EXTEND | MRD-27 | IMP-26 |
| 8.19 | Patient app tolerates the additive `kind` | `patient-app/src/api/endpoints/auth.ts:72, 122`; `schemas/envelope.ts:21` (plain `z.object`) | SUPPORTED | MRD-27, MRD-04 | IMP-27 |
| 8.20 | Backend error-code list additions | `common/errors/error-codes.ts:16-33` | EXTEND | MRD-27 | IMP-25 |
| 8.21 | SPA `AuthErrorCode` union and `AUTH_CODES` | `frontend/src/types/auth/auth-error.ts:19-37`; `api/endpoints/auth.ts:196-213` | EXTEND | MRD-27 | IMP-26 |
| 8.22 | Patient-app error mapper | `patient-app/src/features/auth/useAuthErrorMessage.ts:53-71` (`default` branch) | SUPPORTED | MRD-04 | IMP-27 |
| 8.23 | SPA login and verify screens render the recovery codes | `frontend/src/features/auth/pages/LoginPage.tsx:73-77`; `VerifyOtpPage.tsx` | EXTEND | MRD-27 | IMP-26 |
| 8.24 | Administrator-initiated request | None | MISSING | MRD-07 | IMP-23 |
| 8.25 | Self-cancel through the recovery session | None | MISSING | MRD-09 | IMP-24 |
| 8.26 | Voluntary request blocks the remaining codes | Contradiction removed (spec §12.2) | MISSING | MRD-16 | IMP-19 |
| 8.27 | BG-B operator approval records — **not to be built (CL-1; BG-B inactive)** | DB-02 approver is a user FK | MISSING | MRD-26 (DEFERRED) | DB-11, IMP-15 (BG-B part) |
| 8.28 | External evidence store — **not to be built under the current authorization (CL-1)** | None (OD-006 lists it as future design) | MISSING | MRD-26 (DEFERRED) | PRE-05 |
| 8.29 | Hospital nullability rule (null if and only if Platform Admin target) | None | MISSING | MRD-01 | DB-01 |
| 8.30 | Email-change invariant | No email-change path (`account.service.ts:79-102`) | SUPPORTED | MRD-06 | IMP-18 (guard for future paths) |
| 8.31 | Refusal audit and `login_events` codes | `failure_code varchar(30)` (`03-identity.prisma`, `LoginEvent`) | SUPPORTED | — | IMP-07, IMP-21 |
| 8.32 | Two-approver cancellation after APPROVED for non-security reasons; single-approver security cancellation (A-12; initiator too, R-8); thresholds count cancellations | None | MISSING | MRD-12 + A-12 | IMP-08 |
| 8.33 | Hardened interim last-code behaviour (generic messages, R-1) — **IMP-30 BLOCKED / NOT IMPLEMENTED** (IMP-01 unauthorized; no §17 criteria) | `step-up.service.ts:189`; `revokeAllFor` | EXTEND | MRD-20 | IMP-30 (needs IMP-01) |
| 8.34 | Platform Admin authority over staff recovery | OD-07 text names no staff-account remit | CONFLICT | MRD-13 | IMP-08 |
| 8.35 | API keys at recovery start: revoke **owned** keys once OD-003 adds ownership; none today | `api_keys.created_by` is a creator, not an owner (`11-platform.prisma`, `ApiKey`); no route accepts keys (RA-M24.1) | PRIOR WORK | MRD-11 | DB-08, IMP-04 |

---

## Summary

### Part A (56 original rows)

| Fit | v1.1 | v1.2 | Change |
|---|---:|---:|---|
| SUPPORTED | 21 | 18 | 2.12, 2.13 and 6.6 moved to EXTEND |
| EXTEND | 14 | 16 | +2.12, +2.13, +6.6; 3.9 moved to MISSING |
| PRIOR WORK | 6 | 6 | — |
| CONFLICT | 6 | 6 | — |
| MISSING | 6 | 7 | +3.9 |
| SPLIT | 1 | 1 | 2.3 |
| NOTE | 2 | 2 | 5.5, 5.6 |
| **Total** | **56** | **56** | No row removed or renumbered |

### Part B (35 new rows)

| Fit | Count |
|---|---:|
| SUPPORTED | 6 |
| EXTEND | 12 |
| PRIOR WORK | 2 |
| CONFLICT | 1 |
| MISSING | 14 |

### Client mapping of the API changes (P1-6)

| Change | Doctor SPA | Patient app |
|---|---|---|
| `/auth/otp/recovery` `kind` | 8.18 (EXTEND) | 8.19 (SUPPORTED, regression only) |
| New error codes | 8.21, 8.23 | 8.22 (SUPPORTED by `default`; receives none, class D) |
| `/me/2fa/disable` code | 5.4 | 5.5 (NOTE unless MRD-04(ii)(b)) |
