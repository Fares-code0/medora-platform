# Medora — MFA Recovery Security Architecture

**Version:** 1.2.1 (revises 1.2: records the owner decisions of 2026-11-13 and corrects findings I-1 to I-9).
v1.2 is preserved unchanged in `../mfa-recovery-v1.2/`.

**Document status:** design with owner decisions recorded. **The design is not signed off: gate G2 is still
closed** (§0A.4 lists the blockers).
**Scope:** Backend MFA recovery, plus the client and contract impact it causes.

**Implementation status:**

- **Nothing in this design is implemented** beyond the pre-existing behaviour marked VERIFIED.
- **Nothing is authorized for implementation.** IMP-30 (interim hardening, FD-18) is **BLOCKED / NOT
  IMPLEMENTED**: the owner's scope correction of 2026-11-13 (L-005) says do not implement IMP-30 or IMP-01. See
  `IMP-30_INTERIM_HARDENING_SCOPE_RECORD.md`.
- No repository, worktree, branch, schema or contract was changed to write this document.

**Verified against (read-only, git objects):** the v1.2 evidence below. Re-checked 2026-11-12 at `origin/backend`
`452dd006`: the cited paths are unchanged (`../mfa-recovery-v1.2-review/01_INITIAL_VERIFICATION.md` §2).

| Ref | Commit |
|---|---|
| `origin/backend` | `cce25437` (merge of PR #207); re-checked at `452dd006` |
| `origin/frontend` | `ad4c6a8d`; re-checked at `c20cf560` |
| `origin/patient-app` | `2ecc9071`; re-checked at `bb80009b` |
| `origin/docs/medora-owner-decisions-2026-11-06` | `b978a6cc` |

**Companion documents (v1.2.1):**

| File | Contains |
|---|---|
| `MFA_RECOVERY_OWNER_DECISIONS_v1.2.1.md` | Decisions MRD-01 to MRD-29 and FD-17 to FD-31, with recorded status |
| `MFA_RECOVERY_OPEN_SECURITY_RISKS_v1.2.1.md` | Risks MRR-01 to MRR-25, NR-1 to NR-8; acceptance records ACC-01 to ACC-12 |
| `MFA_RECOVERY_COMPATIBILITY_MATRIX_v1.2.1.md` | Original rows 1.1–7.4 and new rows 8.01–8.35 |
| `MFA_RECOVERY_IMPLEMENTATION_DEPENDENCIES_v1.2.1.md` | PRE-, IMP-, DB- and DOC- items (I-1, I-3, I-9 corrected) |
| `IMP-30_INTERIM_HARDENING_SCOPE_RECORD.md` | The IMP-30 scope, and its two blockers (BLOCKED / NOT IMPLEMENTED) |
| `MFA_RECOVERY_V1.2.1_CHANGELOG.md` | v1.2 → v1.2.1 changes |
| `../mfa-recovery-v1.2-review/00_OWNER_DECISION_LOG.md` | The formal decision log (verbatim owner answers) |

---

## 0. Status discipline

Every rule and decision carries **exactly one** status:

| Status | Meaning |
|---|---|
| **APPROVED** | Approved by the owner: spec v1.0 §1, or a FINAL project decision (cited) |
| **VERIFIED** | A repository fact, checked in git objects at the commits above (file:line cited) |
| **RECOMMENDED** | Proposed by this design. Not approved |
| **OPEN** | An owner decision is required (MRD-xx) |
| **BLOCKED** | Cannot proceed until a named decision or prerequisite is resolved |

**v1.2.1 adds these statuses**, used as defined in the decision log:

| Status | Meaning |
|---|---|
| **DEFERRED** | The owner explicitly postponed the decision |
| **AUTHORIZED FOR SPECIFICATION** | A specification may be written. Nothing may be built |
| **AUTHORIZED FOR IMPLEMENTATION** | Only a specifically approved scope. **Today: none** (IMP-30 BLOCKED / NOT IMPLEMENTED, L-005) |
| **NOT ACCEPTED** | A residual risk that has not been accepted |
| **IMPLEMENTED** | Verified in source code and tests |

In v1.2.1, **APPROVED** means an explicit owner decision. It never implies that anything is implemented, or that
any risk is accepted.

Proposed names (endpoints, tables, columns, error codes, permissions) are **proposals**. None of them exists in
the repository unless marked VERIFIED.

---

## 0A. Owner decisions in force (v1.2.1)

Recorded in `../mfa-recovery-v1.2-review/00_OWNER_DECISION_LOG.md` (entries L-001 to L-005, 2026-11-13).
**Precedence:** where a later section still reads OPEN or RECOMMENDED for an item decided here, this section
governs. v1.2.1 rewrites the affected sections directly where that can be done without inventing detail.

### 0A.1 Strategic direction (Group 1), APPROVED

1. Identity verification in person, or by conditional live video.
2. Callback temporarily removed, until reliable phone-change auditing exists.
3. A Recovery Reference Code binds the verified person to the recovery request and session.
4. Two independent approvers grant access in administrator-mediated recovery.
5. One eligible approver may immediately stop a suspicious request.
6. Strategic approval does **not** approve every technical amendment. Each amendment is recorded individually
   (§0A.3).

### 0A.2 Decisions, by spec section

| Spec section | Decision | Status |
|---|---|---|
| §2 classes | MRD-01 (a): Platform Admin is the tier above, no Support role. MRD-05 (a): one active employment for non-doctor staff. **FD-21: OD-004's mandatory staff MFA covers every non-patient role**; enforcement needs a rollout / grace period first (no code authorization) | APPROVED |
| §3 interim | MRD-20 (b) Hardened Interim. **Messages generic; the count only in 2FA settings (R-1)**. IMP-30 carved out of G2 (FD-18 (b)). **ACC-09 OPEN, NOT ACCEPTED** | APPROVED; IMP-30 **BLOCKED / NOT IMPLEMENTED** (L-005) |
| §5 | MRD-11 (a) API keys once OD-003 exists; MRD-14 (a) 24 h whole request; MRD-15 (a) no ordinary session at completion | APPROVED |
| §6 | MRD-06 by sub-item (6.A, 6.B, 6.C(i), 6.C(ii) conditional under A-5, 6.C(iii) removed, 6.D, 6.E); MRD-23 (a) with 23.A–23.D; MRD-10 (a); MRD-19 as listed | APPROVED |
| §6.4 binding by path (R-4) | Last-code path: Recovery Reference. Administrator-mediated path (and P2 when specified): **email request reference + Handover Code** | APPROVED |
| §6.4 Handover Code (CL-3, R-5) | Initiator delivers the **whole** code; **no split-code design**; request-bound; lifetime-limited; required at every issuance and re-issuance; counts toward MRD-19; keyed HMAC only; never by email or SMS; trusted channel only. Lost code: cancel the request and start a new one | APPROVED |
| §7 | MRD-07 (a) three people; **CL-4**: initiating needs `accounts.approveMfaRecovery`, the initiator never approves and is excluded from the two approvers, tenant and class limits apply, no new authority. MRD-12 amended by A-12; **R-8**: the initiator may make a security cancellation only and counts toward abuse thresholds. MRD-13 (a) and **R-2**: Platform Admins recover Hospital Admins (§7.2 / OD-07) and do **not** act on staff recovery. MRD-17 as proposed. MRD-24 accepted | APPROVED |
| §7.4 | MRD-03: **BG-A only**. MRD-26: BG-B deferred. **CL-1: BG-B stays inactive even after PRE-05**, unless MRD-03 is explicitly decided again. **PRE-05, DB-11 and the BG-B part of IMP-15 must not be built** | APPROVED (BG-A); BG-B DEFERRED / inactive |
| §7 headcount (CL-6) | Minimum headcounts acknowledged; ACC-03 and ACC-05 **NOT ACCEPTED**; no BG-B fallback. **FD-25 (a): keep at least 4 active Platform Admins** as an interim operating rule (operating policy, not code) | APPROVED |
| §8–§9 | MRD-08 (a) persisted suspension; MRD-09 (a) self-cancel any time | APPROVED |
| §10–§12 | MRD-21 (a) refuse reset while suspended; MRD-22 (a) public cancel-with-proof; MRD-16 R-A, with R-B as an option. **CL-7**: dual approval applies to administrator-mediated grants, not to R-A or cancel-with-proof, and neither path bypasses suspended-account controls | APPROVED |
| §12 codes | Recovery-code rules **R1–R5 are IMPLEMENTED (PR #186)**: 10 codes, 40 bits each, keyed HMAC inside the encrypted field, single use, count only in `GET /me/2fa` (R2). **FD-24 (a): new code sets must be ≥ 64 bits before R-A is built**, conditional on primary-source NIST verification. That is not a current-weakness finding | R1–R5 IMPLEMENTED; FD-24 APPROVED (conditional) |
| §13 | MRD-04 (ii)(a): patients keep password-only MFA disablement (risk NR-3 recorded, NOT ACCEPTED) | APPROVED |
| §14 | MRD-27 (a) discriminated 200 on the same route; MRD-18 R3 email onto the outbox; MRD-28 (b) step ledger on every TOTP verification, including patient sign-in (CL-9; patient-app regression tests in the future scope) | APPROVED |
| P2 (MRD-29) | P2 is the preferred direction (CL-5). **Excluded from the first design approval.** On P2 only, the initiator delivers the whole Handover Code **jointly with a second independent verifier**; both actions audited (FD-19). The email link is required (R-3). ACC-12 created as a record only | **MRD-29 OPEN**; P2 DEFERRED |
| Patients (MRD-04 (i)(a)) | Out of scope of this design. Patient recovery is a **separate track** (FD-22): see §18 | APPROVED (scope); patient track AUTHORIZED FOR SPECIFICATION after legal / privacy review |
| Risk acceptance | MRD-25 deferred. **FD-20 (a): ACC-01 to ACC-12 reviewed individually during design approval**: each accepted, rejected or given more controls. **No risk is accepted** | Process APPROVED; every ACC NOT ACCEPTED |

### 0A.3 Amendments A-1 to A-13

All 13 are **APPROVED** individually (ballot, 2026-11-13; recorded L-001). They are incorporated into the
sections named below.

| Amendment | Incorporated in | Limitation |
|---|---|---|
| A-1 | Invariant 14 (§4) | — |
| A-2 | §8.5 completion | The clause about "the newly set [password] on the MRD-29 P2 path" is **not in force**: P2 is DEFERRED |
| A-3, A-5, A-6 | §6.1 IV-3 methods | — |
| A-4 | §6.2 | — |
| A-7 | §6.3 | — |
| A-8 | §6.4 evidence | Retention follows `auditLogDays` until the A2 retention decision |
| A-9, A-11 | §6.4 Recovery Reference | — |
| A-10 | §6.4, §15 | — |
| A-12 | §7.6 | — |
| A-13 | §6.4 evidence | — |

### 0A.4 Still OPEN or DEFERRED (blocks G2 unless stated)

| Item | Status |
|---|---|
| MRD-29 / P2 | OPEN; P2 deferred from the first approval (does not block G2) |
| ACC-01 to ACC-12 | All NOT ACCEPTED; reviewed individually at G2 (FD-20). **ACC-09 is required before G2** |
| MRD-25 | DEFERRED (it is the FD-20 review) |
| C-12 | OPEN, owned by the project register |
| Recovery ADR number | Allocated at DOC-01, after checking every branch's register |
| Jurisdiction (FD-29) | Not determined. **NIST SP 800-63B-4 AAL2 is a design target only**; no conformance, certification or compliance is claimed (§18) |

---

## 1. Approved inputs (unchanged from v1.1)

| Control | Requirement | Status |
|---|---|---|
| Last recovery code | Starts a restricted recovery flow | APPROVED (v1.0) |
| Previous sessions | Revoke all existing sessions and refresh tokens | APPROVED (v1.0) |
| Recovery session | Dedicated recovery-only session; 15 minutes, absolute | APPROVED (v1.0) |
| Recovery request lifetime | 24 hours | APPROVED (v1.0) |
| Approval | Two distinct authorized approvers | APPROVED (v1.0) |
| Ordinary user recovery | Two Hospital Admins of the same tenant | APPROVED (v1.0) |
| Hospital Admin recovery | Two approvers of the tier above. v1.0 called that tier "Super Admin" | APPROVED (v1.0) as policy. **The tier is Platform Admin: APPROVED (MRD-01 (a), 2026-11-13)** |
| Session expiry | Re-authenticate and get a new restricted session bound to the same request | APPROVED (v1.0) |
| Rejection | Terminal. A new request needs administrative review | APPROVED (v1.0) |
| MFA disablement | Current second factor or an approved recovery process; password alone is insufficient | APPROVED (v1.0) for staff. Patients: password only, APPROVED (MRD-04 (ii)(a)); risk NR-3 NOT ACCEPTED |

**FINAL project decisions this design depends on:**

| Decision | Content |
|---|---|
| OD-004 | MFA mandatory for staff, optional for patients |
| OD-07 | Platform Admin + Hospital Admin; Platform Admin remit = "hospital lifecycle/configuration, hospital administration, Hospital Admin management"; existing admins mapped through M-13 |
| OD-12 | Employment end revokes hospital access immediately |
| DR-02 | One active employment per doctor |
| I2 | PostgreSQL authoritative; Redis a cache |
| I4 | Session validation on every protected request |
| O-13 | Revocation immediate for new requests |
| Q7 / R4 | Re-enrolment needs the current factor; old factor valid until the new one is proven |
| R1–R5 | Recovery-code redemption, implemented in #186 |

I2, I4 and O-13 are recorded only on the docs branch (`OWNER_DECISIONS.md:648-654`).

**v1.2 rewrites no approved policy.** Where this design narrows or interprets one, it raises an OPEN decision.
**v1.2.1 adds only the owner decisions of 2026-11-13** (§0A). It rewrites no FINAL project decision. OD-004 is
**clarified** by FD-21 (scope = every non-patient role), not changed.

---

## 2. Account classes

| Class | Who | Tenant | MFA | Policy | Status |
|---|---|---|---|---|---|
| **A. Ordinary staff** | `doctor`, `reception`, `laboratory`, `pharmacy` (`permission-catalogue.ts:31`, VERIFIED), and any other non-patient, non-admin role (FD-21) | Active-employment hospital. One active employment for doctors (DR-02) and for other staff (MRD-05 (a)) | Mandatory (OD-004; scope clarified by FD-21: every non-patient role). **Not enforced in code today except for `admin`** (`login.service.ts:205, 362-364` at `452dd006`; NR-3); enforcement needs a rollout / grace period first | §7.1 | Policy APPROVED; tenant rule APPROVED (MRD-05 (a)) |
| **B. Hospital Admin** | OD-07 Hospital Admin. Does not exist yet (VERIFIED: no tenant model) | The admin's single hospital | Mandatory | §7.2 | APPROVED (v1.0); tier = Platform Admin (MRD-01 (a)) |
| **C. Platform Admin** | OD-07 Platform Admin. Does not exist yet | **None** | Mandatory | §7.4 BG-A | APPROVED: BG-A only (MRD-03); BG-B inactive (CL-1) |
| **D. Patient** | Role `patient` | None (users global; DR-03) | Optional (OD-004) | Out of this design; current behaviour kept; separate patient track (§18) | APPROVED (MRD-04 (i)(a), (ii)(a)) |

**Hospital nullability rule** (RECOMMENDED, enforced by DB-01):

- `mfa_recovery_requests.hospital_id IS NULL` **if and only if** `account_class = 'platform_admin'`.
- Class A and B requests always carry the hospital of the target's active employment, or of the admin's scope.
- Class D requests cannot be created: a CHECK on `account_class`, plus the creation path refuses the `patient` role.

---

## 3. The interim period (before Phase 21) — finding X8 / P1-5

**VERIFIED:**

- No tenant model and no admin tiers exist (`prisma/schema/*`; `PLATFORM_ROLES`).
- Approver eligibility as approved cannot be evaluated.
- Today the last recovery code yields an **ordinary session**, like any other code (`step-up.service.ts:189`).

**Consequences of the gap:**

1. **The approved last-code policy (v1.0) is not enforced.** A person holding the password and the last code
   gets full ordinary access, without dual approval or re-enrolment.
2. **Other sessions stay alive** after the last code is used, unless the global single-session policy is on.
3. **An administrator who loses the authenticator and every code has no self-service recovery** (MRR-12,
   VERIFIED: setup refused, re-enrolment needs TOTP, admin disable refused).
4. The R3 notification email **is** sent on every redemption (VERIFIED, #186). The only interim warning today
   is that email to the account holder.

**This risk is not accepted by this design.**

**v1.2.1: the owner chose (b) Hardened Interim (MRD-20, APPROVED 2026-11-13, CL-2).** Conditions:

- **ACC-09 stays OPEN and NOT ACCEPTED.** Choosing (b) is not risk acceptance. (b) is an interim exception to
  strategic point 4 (two approvers grant access), chosen knowingly and recorded as such.
- **Generic messages (R-1).** The v1.2 wording of (b) below, "a message to the user that no recovery codes
  remain", **conflicts with the FINAL rule R2** (the count appears only in 2FA settings). The owner's R-1
  decision governs: every email and in-app message is generic (for example "a recovery code was used; review
  your two-factor settings"), and the count appears only in `GET /me/2fa`. **No API response change.**
- **"Staff classes only"** cannot be evaluated before Phase 21 (no classes exist). It is read as **every
  non-patient role**, which matches FD-21's reading of OD-004.
- **FD-18 (b):** IMP-30 is carved out of G2 as a separate, stand-alone hardening task.
- **Owner scope correction (2026-11-13, L-005):** do NOT implement IMP-30 or IMP-01. **IMP-30 is BLOCKED / NOT
  IMPLEMENTED.** Its two blockers:
  1. IMP-01 is an unauthorized prerequisite;
  2. IMP-30 has no defined acceptance criteria in §17.

  See `IMP-30_INTERIM_HARDENING_SCOPE_RECORD.md`.

The options as presented in v1.2 (retained for the record):

| Option | What happens until Phase 21 | Security consequence |
|---|---|---|
| (a) Accept the gap | Current behaviour | Policy unenforced; MRR-16 stays **High** |
| (b) Hardened interim (RECOMMENDED) | On the **last** code, staff classes only: still an ordinary session, **plus**: revoke every *other* session; an audit row at severity `WARNING`; a notification to administrators; a message to the user that no recovery codes remain and that the authenticator must not be lost before recovery exists. No new self-service path is added (MRD-16 R-A needs a remaining code, so it cannot help after the last one). The `WARNING` audit row is the review record; no new column is needed | Reduces session persistence and adds visibility. **Still not the approved policy.** MRR-16 becomes Medium |
| (c) Interim lock | The last code refuses a session; the account is locked until an administrator acts | No approvers exist yet, so this is a lockout with no exit. Not recommended |
| (d) Interim dual approval with today's `admin` role (MRD-02(b)) | Two other `admin`s approve | Treats every `admin` as a Platform Admin, which OD-07 forbids. Not recommended |

**v1.2 (superseded):** "BLOCKED until MRD-20 is decided: IMP-30 (interim behaviour), and any statement that the v1.0
policy is in force." MRD-20 is now decided. **The v1.0 last-code policy is still not in force**: it needs Phase 21
and the full flow.

---

## 4. Security invariants

v1.1 numbering is kept; v1.2 changes are in **bold**.

1. A recovery session never provides ordinary access.
2. A request is bound to one user, and to one hospital exactly when the class is A or B (§2 rule).
3. At most two **counted** approvals, from distinct principals, **each still eligible when counted (§7.5)**.
4. Neither the target nor the initiator approves.
5. Hospital Admins never decide Hospital Admin requests.
6. Hospital Admin recovery needs two distinct approvers of the tier fixed by MRD-01.
7. Recovery codes are single-use and never restored.
8. Terminal requests are never reused.
9. **While the target's authenticator is suspended (§9), no ordinary session is issued for the account by any route:
   login, OTP, recovery code, password reset or refresh.**
10. Every security transition is audited fail-closed.
11. Authorization is enforced in the backend.
12. No failure leaves unintended access or a state with no way forward. **Every terminal state has a defined exit (§9.4).**
13. Recovery tokens and ordinary tokens are never accepted in each other's place.
14. **No password-only route (login, password reset, public endpoints) issues any session or changes recovery state.**
    **v1.2.1 (A-1, APPROVED):** the scope is accounts with a live suspension or an active recovery request. For
    those accounts, no route that verifies only the password issues any session or changes recovery state. This
    removes the contradiction with OD-004's password-only patients and grace-period staff, whose ordinary
    password sign-in is unaffected.
15. **New: the person approvers verify is the person who controls the recovery session (§6.4).**
16. **New: no time-dependent predicate decides whether a request is active. Expiry is a persisted state transition (§8.4).**

---

## 5. Session security

### 5.1 Prerequisite PRE-01: per-request session validation

| Fact | Status |
|---|---|
| The global access-token guard does no database read (`access-token.guard.ts:21-24`) | VERIFIED |
| Access-token lifetime defaults to 900 s (`env.schema.ts:122`) | VERIFIED |
| `revokeAllFor` sets `revoked_at` (`session.service.ts:167`); a session row is its refresh family (ADR-026) | VERIFIED |
| Validating session security on every request is policy (I4, O-13) | APPROVED. Implementation **not authorized** |

PRE-01 (RECOMMENDED design): every protected request resolves `sid` and refuses it when the session is revoked,
expired, of the wrong kind, or the user is not `ACTIVE`. PostgreSQL is authoritative; any cache is bounded by C-12
(OPEN). **The recovery flow is BLOCKED on PRE-01.**

### 5.2 Token types (RECOMMENDED)

| Token | `typ` | Accepted by | Refused by |
|---|---|---|---|
| Ordinary access | `access` (new; today none, VERIFIED at `access-token.service.ts:57-75`) | Access guard | Recovery guard |
| Recovery | `mfa_recovery` (`rid`, `sid`; `exp` = min(iat + 15 min, session deadline)) | Recovery guard on `@RecoveryRoute()` routes | Access guard, with 403 `mfa_recovery_restricted` |
| Challenge | `otp` (VERIFIED) | `/auth/otp/*` | All other routes |
| Re-enrolment | `2fa_reenroll` (VERIFIED, `two-factor.service.ts:69, 284-301`) | Re-enrolment confirm | All other routes |

**Rollout:** a token with no `typ` is accepted as `access` for one `JWT_ACCESS_TTL` window after deployment.

### 5.3 Recovery session properties

| Property | Rule | Status |
|---|---|---|
| Kind | `sessions.kind = 'mfa_recovery'` (DB-03) | APPROVED (v1.0) as concept; storage RECOMMENDED |
| Lifetime | 15 minutes, absolute; `expires_at` never moved | APPROVED (v1.0) |
| Refresh | **No refresh credential issued** (today `rotate()` slides expiry, `session.service.ts:112`, VERIFIED) | RECOMMENDED |
| Conversion | Never converted to an ordinary session | APPROVED (v1.0) |
| Single live session | At most one per request; issuing one revokes the previous | RECOMMENDED |
| Revocation | At any terminal transition, in the same transaction | APPROVED (v1.0) |

### 5.4 Deny-by-default and the endpoint allowlist (RECOMMENDED)

The access guard refuses recovery tokens. Recovery routes opt in with `@RecoveryRoute()`, mirroring how `@Public()`
opts out (`common/auth/public.decorator.ts:16`, VERIFIED). A route that forgets the decorator refuses recovery
tokens, so the design fails closed.

**Routes reached with a recovery token:**

| Method and path | Purpose | Allowed request states |
|---|---|---|
| `GET /auth/mfa-recovery` | The caller's own status, **including the Recovery Reference** (§6.4). Never approver identities | Every non-terminal state |
| `POST /auth/mfa-recovery/enrolment` | Start enrolment | APPROVED, ENROLLMENT_PENDING |
| `POST /auth/mfa-recovery/enrolment/confirm` | Prove the new factor and complete | ENROLLMENT_PENDING |
| `POST /auth/mfa-recovery/cancel` | Self-cancel (MRD-09) | PENDING_APPROVAL, APPROVED, ENROLLMENT_PENDING |
| `POST /auth/mfa-recovery/logout` | End the recovery session | Any |

**Public routes** (no token; identity-verified; rate-limited; responses that reveal nothing):

| Method and path | Purpose | Spec |
|---|---|---|
| `POST /auth/mfa-recovery/session` | Re-issue a recovery session | §6.3 |
| `POST /auth/mfa-recovery/email-link/confirm` | Confirm an emailed link. POST only | §6.3 |
| `POST /auth/mfa-recovery/cancel-with-proof` | The owner proves the old authenticator and cancels | §10 |

Everything else is refused, explicitly including:

- `/me/*` (`PATCH /me/account` changes the phone with no verification, `account.controller.ts:54`, VERIFIED);
- `/auth/refresh`;
- every administrative, clinical, messaging and API-key route.

### 5.5 Credentials when recovery starts

| Credential | Action | Status |
|---|---|---|
| Ordinary sessions | Revoke all | APPROVED (v1.0) |
| Old TOTP secret | **Suspended, with a persisted state (§9)** | APPROVED (MRD-08 (a)) |
| Password-reset tokens | Outstanding ones marked used. **New resets refused while suspended (§11)** | APPROVED (MRD-21 (a)) |
| In-flight `2fa_reenroll` tokens | Unusable once PRE-01 lands (bound to a revoked `sid`) | VERIFIED behaviour; depends on PRE-01 |
| API keys | No action until OD-003 adds ownership; then revoke owned keys (`api_keys.created_by` is a creator, VERIFIED) | APPROVED (MRD-11 (a)) |

---

## 6. Identity verification

**VERIFIED:**

- No identity-verification procedure is approved in this project. The only identity-proofing item is OQ-02 / RA-030.1, open.
- Allowed primitives:
  - the password (Argon2id, with lockout at `credential-lockout.service.ts:46`);
  - the verified email address (`users.email_verified_at`);
  - hashed single-use tokens (`verification_tokens.token_hash`, unique);
  - administrator attestation;
  - audit.
- No email-change path exists: `PATCH /me/account` changes only the username and phone (`account.service.ts:79-102`).
- Phone numbers are unverified.

**v1.2.1: the procedure is APPROVED by sub-item (MRD-06, 2026-11-13).** 6.A, 6.B, 6.C(i), 6.D and 6.E are
approved; 6.C(ii) is approved conditionally under A-5; 6.C(iii) (callback) is removed. MRD-06 and MRD-23 were
decided together, item by item, as finding I-4 required.

### 6.1 Levels

| Level | Proves | Mechanism |
|---|---|---|
| IV-1 Knowledge | The password | The password check plus the existing lockout |
| IV-2 Possession of the mailbox | Control of the verified email for **this** request | §6.3 email link |
| IV-3 Person | The account holder in person, by an out-of-band check | An approver attestation from the approved method list |
| IV-4 Binding | **The person verified in IV-3 controls the recovery session** | §6.4. **By path (R-4, APPROVED):** last-code path = Recovery Reference; administrator-mediated path (and P2, when specified) = email request reference + Handover Code |

**IV-3 attestation methods (v1.2.1, APPROVED):**

| Method | Status | Conditions |
|---|---|---|
| (i) In person, with photo ID matched to the employment record | APPROVED | A-3 |
| (ii) Live video, with photo ID | APPROVED **conditionally** | **A-5:** only if the approver starts the call from trusted contact details (never a requester-supplied link), **and** personally recognises the person or compares them against an employment-record photo. Otherwise use (i). A-3 applies. Expert review of video assurance is authorized (FD-31); the condition stands until then |
| (iii) Callback | **REMOVED** | **A-6:** removed now. Before it may return there must be: a phone-specific change record (when, by whom; that is database work, not authorized); audited roster-phone changes; and an email to the user whenever the roster number changes. Then the 7-day / not-by-an-approver rule is reconsidered |

**A-3 (APPROVED):** an identity check counts only when the **approver initiates** contact through a trusted channel
(outbound call, in person, or a video call the approver set up). An inbound contact from the requester never counts.

**Password-only is never sufficient** (invariant 14). Every recovery-session issuance needs:

- IV-1;
- a possession factor (the last code, or IV-2);
- for re-issue or admin-initiated sessions, IV-4.

### 6.2 Procedures

| Situation | Requirement | Status |
|---|---|---|
| Initial recovery, last-code path | Password (at login) + the last code against a live challenge creates the request and the first recovery session. Both approvers then perform IV-3 + IV-4 (Recovery Reference) | APPROVED (MRD-06 6.B; MRD-23 (a)) |
| Re-issue an expired recovery session | IV-1 + IV-2 (+ the Handover Code on the administrator path, CL-3). Allowed only in APPROVED or ENROLLMENT_PENDING (v1.0). At most 3 per request (MRD-19). Status-only re-issue while PENDING_APPROVAL is not allowed (MRD-10 (a)) | APPROVED (MRD-06, MRD-10, MRD-19) |
| Administrator-initiated request (after rejection or expiry, MRD-07) | The initiator holds `accounts.approveMfaRecovery` (CL-4), performs IV-3, and delivers the **whole Handover Code** to the person out of band, through a trusted identity-verification channel (CL-3; §6.4). Two **other** eligible approvers each perform IV-3 + IV-4, binding on the **email request reference** (R-4). The user then gets a session with IV-1 + IV-2 + the Handover Code. The initiator never approves (three people) | APPROVED (MRD-07 (a), CL-3, CL-4, R-4) |
| Password and authenticator both lost (MRD-29 P2) | Not available. P2 is **DEFERRED** from the first design approval. Until it is specified and approved, such a user cannot recover (finding I-5; the owner's decision of 2026-11-13, §19) | MRD-29 OPEN |
| Platform Admin | §7.4: BG-A only | APPROVED (MRD-03); BG-B inactive (CL-1) |

**A-4 (APPROVED):** every recovery-session issuance and re-issue sends an email to the verified address, with
the request time.

### 6.3 Email-link security, finding S6 (APPROVED: MRD-06 6.D; values MRD-19)

**A-7 (APPROVED), in addition to the table below:**

- the email-link token travels in the URL **fragment**, and the page POSTs it;
- `Referrer-Policy: no-referrer`;
- no third-party scripts on the landing page;
- the email shows a **request reference** (the reference approvers bind on, on the administrator path, R-4).

| Property | Rule |
|---|---|
| Storage | Only a hash is stored (`verification_tokens` pattern, VERIFIED). New `TokenKind` value (DB-06) |
| Binding | Bound to user + request id + purpose (`mfa_recovery_reissue`). Useless for any other purpose, request or user |
| Lifetime | 15 minutes (MRD-19). Void at once on any terminal request transition, and when a newer link is issued for the same request |
| Single use | Consumed by a conditional update; a second use fails |
| **POST confirmation** | The emailed URL opens a page that does **nothing** on GET. Only a POST from that page (`/auth/mfa-recovery/email-link/confirm`) consumes the token. Mail scanners and link previews that fetch the URL with GET cannot spend it |
| What confirmation proves | Only IV-2. It returns a short-lived, single-use **link proof** (bound to the same request, 5 minutes) that `POST /auth/mfa-recovery/session` requires alongside the password. **It never issues a session by itself** |
| Order | Password and link proof are checked together. One generic answer covers every failure combination |
| Enumeration | Public endpoints answer the same way whether or not the account or request exists (precedent: `forgot()` returns silently for an unknown email, `password-recovery.service.ts:57-60`, VERIFIED). Link-request endpoints always answer 202 |
| Rate limits | Per account and per IP: the `auth` bucket (VERIFIED) plus a per-request issuance cap of 3 links (MRD-19) |
| Lockout | A wrong password at `/auth/mfa-recovery/session` counts toward the same credential lockout as login |
| Email content | No codes, no approver names, no account state beyond "a recovery step was requested". Includes "not you? contact your administrator" |
| Invariant | There is no email-change path today (VERIFIED). **Any future email-change path must refuse while the authenticator is suspended, and must re-verify** |

### 6.4 Binding the verified person to the recovery session — finding S3 / P1-3 (APPROVED: MRD-23 (a), 23.A–23.D, A-9 to A-13, CL-3, R-4, R-5)

**v1.2.1 rules in force.** Where the v1.2 text below differs, these govern:

| Item | Rule |
|---|---|
| Binding by path (R-4) | **Last-code path:** the Recovery Reference. **Administrator-mediated path (and P2, when specified):** the request reference shown in the email to the verified address (A-7), plus the Handover Code. The Recovery Reference exists only inside a recovery session, so approvals that happen before any session (administrator path) cannot use it |
| Recovery Reference storage (A-9) | **Keyed HMAC**, not plain SHA-256. Crockford base32, grouped `XXXXX-XXXXX`. One reference per request, unchanged on re-issue |
| Reference failures (A-11; MRD-19) | A mismatch is a **counted failure**; **3 in total** → CANCELLED (`reference_failures`) + alert. An explicit "I did not start this" → **immediate REJECTED** (`subject_denied`) by one approver, with a security alert. (v1.2 below said a mismatch rejects at once and "more than 3" cancel; A-11 replaces both) |
| `reference_matched` (A-13) | Computed by the server, never entered by the approver. Each approval also records channel direction, the approver's session id and IP, and server time |
| Approver script (A-10) | Mandatory anti-coaching script: is the code on your own screen? has anyone else contacted you? staff never send this code. **Plus** an email and in-app notification to the user when a request is created |
| Attestation reference (A-8) | About 200 characters at most. UI guidance: do not enter document numbers. Retained under `auditLogDays` until the A2 retention decision |
| Handover Code (CL-3) | Bound to one request; valid only for that request's lifetime; required at **every** applicable session issuance and re-issuance; re-issuances count toward MRD-19's limit of 3; stored as a **keyed HMAC** only; **never sent by email or SMS**; transferred only through a trusted identity-verification channel. **The initiator delivers the whole code. No split-code design** |
| Lost Handover Code (R-5) | Cancel the request and start a new one. The code is never re-issued within a request |
| Handover on P2 (FD-19) | P2 only: the initiator delivers the whole code **jointly with a second independent verifier**, and both actions are audited. **P2 is DEFERRED**, so this rule takes effect only with P2's separate specification |
| Initiator (CL-4, R-8) | Needs `accounts.approveMfaRecovery`; never approves their own request; excluded from the two approvers; may make a **security cancellation only**; counts toward abuse thresholds |

The gap: an approver verifies the real employee, but nothing proves that this person, rather than an attacker
holding the password and the last code, controls the recovery session.

**Recovery Reference (last-code path):**

- At request creation the server generates a random **Recovery Reference**: 10 base32 characters, about 50 bits.
- Only its hash is stored (DB-01). The plaintext is shown **only** through `GET /auth/mfa-recovery`, to the
  recovery-session holder.
- During IV-3, the approver asks the verified person to:
  1. read the Recovery Reference from their screen; and
  2. confirm explicitly that they initiated this request.
- The approver enters the reference and ticks **"subject confirmed they initiated this request"**. The server
  compares hashes, constant-time.
- **A mismatch, or "subject did not initiate"**, rejects the request at once (reason `subject_denied`). This
  notifies the target and the tier above.
- More than 3 wrong references across approvers cancels the request (`reference_failures`) and raises an alert.

**Handover Code (administrator-initiated path):**

- At initiation the server generates a **Handover Code**: same strength, hash stored. It is shown once to the
  initiator, who gives it to the verified person out of band during IV-3.
- Session issuance requires IV-1 + IV-2 + the Handover Code. Each approver confirms with the person that they
  hold the code and requested recovery.

**Evidence recorded per approval (DB-02):**

- the method (from the approved list);
- an attestation reference (free text, no identity-document numbers or images);
- `reference_matched` (boolean);
- `subject_confirmed_initiation` (boolean);
- the time.

All of it is audited fail-closed. An approval with `subject_confirmed_initiation = false` is a rejection by
construction (CHECK in DB-02).

---

## 7. Approval model

### 7.1 Ordinary staff (class A) — APPROVED (v1.0) policy; mechanics APPROVED (MRD-06, MRD-17, MRD-23, 2026-11-13)

The eligible approver is a Hospital Admin of the target's active-employment hospital who:

- is `ACTIVE`;
- passes PRE-01;
- holds `accounts.approveMfaRecovery` (MRD-17);
- is not the target or the initiator;
- performs IV-3 + IV-4.

### 7.2 Hospital Admin (class B)

- Approvers are two distinct members of the tier fixed by MRD-01 (assumed Platform Admin).
- OD-07 explicitly gives Platform Admin "Hospital Admin management". That grant is **VERIFIED in the OD-07 text**.
- Hospital Admins never decide these requests.

### 7.3 Platform Admin authority over staff accounts — finding S8 (APPROVED: MRD-13 (a), R-2)

**v1.2.1 decision:** Platform Admins do **not** act on staff (class A) recovery. Staff recovery is Hospital Admins
only; with too few eligible approvers the request waits and expires. **No single-person bypass.** Platform Admins
recover Hospital Admins under §7.2 / OD-07. The small-hospital deadlock (MRR-06) remains, and **ACC-05 is NOT
ACCEPTED** (CL-6). The v1.2 text below is kept for the record.

OD-07 lists the Platform Admin remit as:

- hospital lifecycle and configuration;
- hospital administration;
- Hospital Admin management.

It does **not** name staff account administration. v1.1 inferred that Platform Admins could stand in for missing
Hospital Admins; **v1.2 withdraws that inference.**

MRD-13 now asks the owner directly:

- May Platform Admins act on staff (class A) recovery at all?
- If so, only when the hospital has fewer than two eligible Hospital Admins?

**Until it is decided**, staff recovery in a hospital with too few approvers waits until the request expires.
**No single-person bypass.**

### 7.4 Platform Admin recovery (APPROVED: BG-A only, MRD-03; BG-B DEFERRED and inactive, MRD-26, CL-1)

**v1.2.1 decisions:**

- **BG-A is the only Platform Admin recovery path.** It needs at least 3 Platform Admins (4 on the
  administrator-initiated path).
- **BG-B is inactive**, even after PRE-05 exists, unless the owner explicitly decides MRD-03 again.
  **PRE-05, DB-11 and the BG-B part of IMP-15 must not be built.** There is no BG-B fallback (CL-6).
- **Interim operating rule (FD-25 (a), APPROVED):** keep **at least four active Platform Admins**. This is an
  operating policy, not a code authorization.
- **Future (FD-25):** individual, sealed emergency identities may be **studied** in a future design, only after
  these prerequisites exist:
  - phishing-resistant MFA;
  - independent alerting (FD-27);
  - custody controls;
  - tests;
  - security review.

  **Shared credentials are not recommended.** This is not BG-A or BG-B, and nothing is authorized beyond study.
- MRR-04 and MRR-12 remain; ACC-03 and ACC-08 are **NOT ACCEPTED**.

The v1.2 options below are kept for the record. BG-B's description is **not** in force.

| Option | Mechanism | Status |
|---|---|---|
| BG-A, peer approval | Two **other** active Platform Admins, under all of §6–§7. Needs at least 3 Platform Admins | RECOMMENDED as the default |
| BG-B, operator break-glass | A server-side command, no HTTP surface, two named operators (two-person rule). Opens a class C request with **operator approval records** (DB-11): operator identity, attestation, both signatures. The user completes normal enrolment with IV-1 + IV-2 + a Handover Code | RECOMMENDED only as a fallback. **BLOCKED** on: an ADR exception to ADR-017 §3 (the bootstrap command refuses once any admin exists, "not a second way in", VERIFIED); and the external evidence store (PRE-05) |

**Evidence for both options:**

- audit rows in the database;
- plus an append-only copy in an **external evidence store** outside the database (PRE-05), as OD-006
  requires for restores. **This store does not exist** (VERIFIED: OD-006 lists it as a future design);
- mandatory retrospective review;
- notification to every other Platform Admin.

### 7.5 Re-validating approvals and handling employment changes — finding S5 (APPROVED: MRD-24; hooks BLOCKED on PRE-03)

- **When counted:** each approval checks eligibility at the moment it is cast.
- **At APPROVED** (second approval), in the same transaction under the request row lock, the server re-validates
  **both** approvals:
  - each approver is still `ACTIVE`;
  - still holds the permission;
  - still has the right tier and hospital;
  - is not the target or the initiator.

  It also re-validates the target's hospital. An approval that fails re-validation is **voided** (recorded, not
  deleted) and the request stays PENDING_APPROVAL.
- **At completion:** the target's class and hospital are re-validated. A change makes the request CANCELLED
  (`target_changed`).
- **Employment events (OD-12):**
  - when the target's employment at the request's hospital ends or changes, the request becomes CANCELLED
    (`employment_changed`) and its recovery sessions are revoked;
  - when an approver's employment ends, their uncounted approvals are voided.
- These hooks need the Phase 21 employment model (PRE-03), so they are **BLOCKED** until then.

### 7.6 Rejection, cancellation and abuse (APPROVED: MRD-12 as amended by A-12; R-8)

| Rule | Design |
|---|---|
| Rejection | Any one eligible approver; reason category and text required; terminal (APPROVED) |
| **Security cancellation (A-12)** | **A single eligible approver may cancel with reason `suspected_compromise` at any non-terminal state**, including after APPROVED. This implements strategic point 5 |
| After APPROVED, non-security reasons | Rejection is not allowed. A non-security cancellation needs **two** eligible approvers (finding S10), **or** the owner via cancel-with-proof (§10), **or** self-cancel (MRD-09) |
| Initiator (R-8) | May make a **security cancellation only**; never approves; counts toward the abuse thresholds |
| Abuse thresholds | Counted over 30 days: **rejections and cancellations together**. 2 against the same target, or 3 by the same approver, notify the tier above. The rejecting or cancelling approver is excluded from approving the next request for that target |
| Duplicates and races | Unique `(request_id, approver_id)`; row lock; the shared state machine answers 409 (VERIFIED) |

---

## 8. Request lifecycle

### 8.1 States (APPROVED, v1.0)

- Non-terminal: PENDING_APPROVAL, APPROVED, ENROLLMENT_PENDING.
- Terminal: COMPLETED, REJECTED, EXPIRED, CANCELLED.

### 8.2 Transitions

| From | To | Trigger | Status |
|---|---|---|---|
| (none) | PENDING_APPROVAL | Last code (§9.2); admin initiation (MRD-07); voluntary request (MRD-16 R-B) | Last code APPROVED; others RECOMMENDED |
| PENDING_APPROVAL | APPROVED | Second approval that passes re-validation (§7.5) | APPROVED (v1.0); re-validation RECOMMENDED |
| PENDING_APPROVAL | REJECTED | One eligible approver rejects; or `subject_denied` (§6.4) | APPROVED (v1.0) |
| APPROVED | ENROLLMENT_PENDING | Enrolment starts | APPROVED (v1.0) |
| ENROLLMENT_PENDING | ENROLLMENT_PENDING | Enrolment restarts (at most 3, MRD-19) | RECOMMENDED |
| ENROLLMENT_PENDING | COMPLETED | The new factor is proven and completion re-validates (§7.5) | APPROVED (v1.0) |
| Any non-terminal | EXPIRED | `now ≥ expires_at`, applied by §8.4 | APPROVED (v1.0) for PENDING; all states RECOMMENDED (MRD-14) |
| Any non-terminal | CANCELLED | §7.6 cancellation; cancel-with-proof (§10); self-cancel (MRD-09); enrolment attempts exhausted; `reference_failures`; `employment_changed`; `target_changed` | RECOMMENDED |

### 8.3 Deadline

`expires_at = created_at + 24 h`, written once, for the **whole** request (APPROVED, MRD-14 (a)).

### 8.4 Stale requests, with no time-dependent index — findings S2 and P1-2 (RECOMMENDED)

- **"Active" means the persisted state is non-terminal.** It never means "state non-terminal *and* `expires_at` >
  now". The partial unique index (DB-01) is on **state only**, which is valid in PostgreSQL. A predicate using
  `now()` cannot be indexed.
- **Expiry is applied before every use (transition on access).** Every path that reads or relies on an active
  request first runs `expireIfDue(request)` inside its own transaction, under the request row lock. That covers:
  - creation;
  - login;
  - re-issue;
  - approval;
  - enrolment;
  - cancel-with-proof;
  - status.

  When `now ≥ expires_at`, the request moves to EXPIRED, its recovery sessions are revoked, and the audit and
  outbox rows are written. **Then** the caller's action proceeds against the updated state.
- **A sweeper backs this up:** a repeatable job on the existing queue (VERIFIED: repeatable BullMQ jobs exist in
  `shared/jobs/bullmq-job-queue.ts`) expires overdue requests every 5 minutes.
- **Creation is never blocked by a stale row:** creation expires any overdue active row for the user first, then
  inserts. The index then sees no conflict.

### 8.5 Completion (RECOMMENDED)

One transaction:

1. Re-validate (§7.5).
2. Verify the new code.
3. Replace the TOTP secret.
4. Store new recovery-code digests.
5. **Clear the suspension (§9).**
6. Move the request to COMPLETED.
7. Revoke the recovery session.
8. Write the audit row (fail-closed) and the outbox event.

The new codes are returned once. **No ordinary session is issued**; the user signs in fresh (APPROVED, MRD-15 (a)).

**A-2 (APPROVED):** completion (`enrolment/confirm`) also re-checks the password, so a stolen recovery token
alone cannot finish enrolment. A-2's clause about "the newly set [password] on the MRD-29 P2 path" is **not in
force**: P2 is DEFERRED.

---

## 9. Authenticator suspension lifecycle — findings S2 and P1-2

### 9.1 Persisted state (RECOMMENDED; storage DB-09)

Suspension is **persisted**, not derived from request state, so its life is explicit and independent of time.
DB-09 proposes a table `mfa_factor_suspensions`, one live row per user, with these fields:

| Field | Meaning |
|---|---|
| `user_id` | The account |
| `state` | `SUSPENDED` (blocks every factor use) or `RECOVERY_REQUIRED` (still blocked; no active request) |
| `request_id` | The current or last request |
| `suspended_at`, `reason`, `cleared_at`, `cleared_by_route` | Lifecycle record |

Constraints: a partial unique index on `user_id WHERE cleared_at IS NULL` (no time dependence), and CHECKs on
state.

### 9.2 State table

| Event | Suspension state after | Request | Status |
|---|---|---|---|
| Last code redeemed (staff classes) | `SUSPENDED` | Created (PENDING_APPROVAL) | APPROVED trigger; persisted state RECOMMENDED |
| Administrator-initiated request | `SUSPENDED` (created if absent) | Created | RECOMMENDED |
| Voluntary request (MRD-16 R-B) | `SUSPENDED` — **remaining codes also blocked** (resolves S7) | Created | APPROVED (MRD-16: R-B available as an option) |
| COMPLETED | **Cleared** (new factor active) | Terminal | RECOMMENDED |
| Cancel-with-proof (§10) | **Cleared** (old TOTP restored) | CANCELLED | APPROVED (MRD-22 (a)) |
| REJECTED, EXPIRED, CANCELLED (any other route) | `RECOVERY_REQUIRED` (stays blocked) | Terminal | APPROVED (MRD-08 (a)) |
| `RECOVERY_REQUIRED` + a new admin-initiated request | `SUSPENDED` (`request_id` updated) | New request | RECOMMENDED |
| `RECOVERY_REQUIRED` + cancel-with-proof | Cleared | — | RECOMMENDED |

**Exits from `RECOVERY_REQUIRED`** (invariant 12):

- cancel-with-proof, if the owner still has the old authenticator;
- an administrator-initiated request, if not.

The account is never left with no way forward.

### 9.3 What suspension blocks (RECOMMENDED)

While a suspension row is live:

- `/auth/login` gives no challenge and no session. It answers 403 with `mfa_recovery_pending` when `SUSPENDED`,
  or `mfa_recovery_required` when `RECOVERY_REQUIRED`.
- `/auth/otp/verify` and `/auth/otp/recovery` refuse. A challenge issued before suspension is void.
- `/auth/refresh` refuses: no ordinary session exists, and PRE-01 refuses the revoked ones.
- `/auth/reset-password` refuses (§11).
- `/me/2fa/*` is unreachable, because no ordinary session exists.

Because the state is persisted, login checks the suspension row, never request time. An expired request leaves
`RECOVERY_REQUIRED`, not an accidentally unblocked account (resolves S2).

### 9.4 Consistency

- Every transition that changes the suspension and the request does so **in one transaction**.
- A CHECK keeps state and `request_id` consistent.
- A periodic consistency check (part of the §8.4 sweeper) flags a `SUSPENDED` row whose request is terminal,
  converts it to `RECOVERY_REQUIRED`, and audits it (MRR-24).

---

## 10. Owner cancellation with proof — findings S4 and P1-4 (APPROVED: MRD-22 (a); replay ledger MRD-28 (b))

**CL-7 (APPROVED):** cancel-with-proof is not an administrator-mediated grant, so dual approval does not apply.
It keeps every control below and does not bypass suspended-account controls: it only restores the owner's own
old authenticator.

**Threat:** an attacker holding the password and the last code suspends the real owner, who still has the
authenticator, for up to 24 hours or more. Self-cancel needs the recovery session, which the attacker holds.

**`POST /auth/mfa-recovery/cancel-with-proof`** is public.

**Body:** `{ email, password, code }`, where `code` is a TOTP code from the **old** (suspended) authenticator.

**Checks**, all inside one transaction, with one generic failure answer:

1. Find the account. An unknown email takes the same path, with a decoy Argon2id verification (the login
   precedent).
2. Verify the password against the credential lockout. A failure counts toward lockout.
3. Verify the TOTP code against the **suspended** secret, with **replay protection**: the accepted time step must
   be newer than `totp_last_used_step` (DB-10). Without this, a code could be replayed for about 90 seconds;
   VERIFIED: ±1 step and no step tracking (`totp.service.ts:31, 94`). A failure counts toward lockout.
4. Run `expireIfDue`. A live suspension must exist (`SUSPENDED` or `RECOVERY_REQUIRED`).

**On success:**

1. Any active request becomes CANCELLED (`owner_proved_factor`).
2. Every recovery session is revoked.
3. The suspension is cleared (old TOTP restored).
4. Audit (fail-closed) and outbox events are written.
5. Email to the owner: "recovery cancelled; **change your password**, because someone used your password and a
   recovery code". Notification to the request's approver pool.

The owner then signs in normally with the authenticator and regenerates codes through Q7/R4 re-enrolment (which
has the current factor).

| Control | Rule |
|---|---|
| Rate limits | `auth` bucket per IP; plus at most 5 attempts per account per 15 minutes, counted in PostgreSQL on the suspension row (I2: security state is not in Redis only) |
| Replay | Time-step ledger (DB-10); conditional update decides |
| Enumeration | Identical answer and similar timing for every failure (decoy hash) |
| Audit | Successes and failures (failures through the non-throwing writer, with a `login_events` failure code; `failure_code` is `varchar(30)`, VERIFIED) |
| Abuse by the attacker | The endpoint needs the **old** authenticator. An attacker who has it already had full login capability before recovery, so this grants nothing new |

**Why the owner cannot be locked out permanently:**

- An attacker can create at most **one** last-code request per stolen code. After the last code, none remain.
- Every other request path needs administrators.
- Owner **with** the old device: cancels at once with proof.
- Owner **without** it: approvers bind identity to the session (§6.4); the owner denies initiation; the request
  becomes REJECTED (`subject_denied`); the owner then goes through administrator initiation with a Handover Code.
- Password reset is unavailable while suspended (§11), so the attacker cannot use it to revoke the owner's
  recovery session.

---

## 11. Password reset during recovery — findings S1 and P1-1 (APPROVED: MRD-21 (a))

**Known limitation (finding I-5; not resolved in v1.2.1):** a user who has forgotten the password **and** lost
the authenticator cannot pass IV-1, and so cannot recover. The only proposed answer is MRD-29 P2, which is
**DEFERRED**. The owner's decision of 2026-11-13 records that such users stay locked out until a future P2 design
is approved (§19). That statement is a recorded design consequence; it is **not** acceptance of ACC-12 or any
other ACC record.

**VERIFIED:**

- `forgot()` sends a reset link to the verified email (`password-recovery.service.ts:57-70`).
- `reset()` consumes the token, stores the new password and **revokes every session** (`:73-86`).
- Neither checks recovery state.
- No administrator-side reset exists.

**Threat:** the verified mailbox alone yields IV-1 (via reset) **and** IV-2 (via the link). That turns recovery
re-issue into a mailbox-only takeover. A reset also revokes the owner's recovery session, a denial-of-service
lever.

**Recommended rule (MRD-21 option (a)):** while a suspension row is live (`SUSPENDED` or `RECOVERY_REQUIRED`):

| Route | Behaviour |
|---|---|
| `POST /auth/forgot-password` | Answers exactly as today (silent, uniform) **but issues no reset token**. Sends an informational email instead: "password reset is unavailable while account recovery is in progress; if this was not you, contact your administrator" |
| `POST /auth/reset-password` | Refuses every token for the account with the existing `token_invalid` (no new code, no information to the caller). Tokens issued before suspension were already voided (§5.5) |
| Effect on recovery sessions | None. Reset cannot run, so it cannot revoke them (removes the DoS lever) |
| Password changes | `/me/password` needs an ordinary session, and none exists. The password can change only **after** completion |
| IV-1 integrity | The password presented at re-issue is the one that existed when the request was created. Additionally, `/auth/mfa-recovery/session` refuses when `password_updated_at > request.created_at`, as defence in depth |

Alternatives are in MRD-21.

---

## 12. Recovery codes

### 12.1 Last code (APPROVED trigger; mechanics RECOMMENDED)

**Today (VERIFIED):** redemption runs in one transaction, under `FOR UPDATE` (`step-up.service.ts:142`), and
calls `establishSession()` for every code (`:189`).

**Proposed:** for staff classes, after PRE-03 and MRD-02, when `remaining.length === 0`, the same transaction:

1. Runs `expireIfDue` on any active request.
2. If an active request still exists: **roll back** (the code is not spent) and answer 409 `mfa_recovery_active`.
3. Spends the challenge and the code.
4. Creates the request, with its Recovery Reference.
5. Creates the `SUSPENDED` row.
6. Revokes all ordinary sessions (transaction-aware, IMP-01).
7. Creates the recovery session.
8. Writes the audit rows and outbox events.
9. Returns the **recovery response shape** (§14.1).

**Patients (class D)** keep today's behaviour and response (MRD-04).

### 12.2 Authenticator lost while codes remain (APPROVED: MRD-16, R-A with R-B as an option) — S7 contradiction resolved

**v1.2.1 conditions:**

- **CL-7:** R-A is self-service with an existing valid factor (a recovery code). Dual approval does not apply.
  It keeps its own requirements: an ordinary session, the password, and a code. It cannot be used while
  suspended, because suspension blocks ordinary sessions.
- **FD-24 (a), APPROVED and conditional:** R-A uses a recovery code to re-enrol, which is the "saved recovery
  code" use in NIST SP 800-63B-4 §4.2.1.1. **New recovery-code sets must be at least 64 bits before R-A is
  built**, subject to verification against the primary NIST text. This does **not** describe today's 40-bit codes
  as a weakness in their current role (a second-factor look-up secret at sign-in). It authorizes no change to
  code generation.

| Option | Behaviour | Codes during the flow |
|---|---|---|
| **R-A (RECOMMENDED)** | Q7/R4 re-enrolment (`/me/2fa/reenroll`) accepts a recovery code (consumed) as the "current factor" in step 2. No request and no suspension | The rest stay valid until the new factor is proven (Q7/R4, APPROVED) |
| R-B | A voluntary dual-approval request | **Blocked** from creation onward (suspension `SUSPENDED`). v1.1 said they stayed valid, which contradicted login suspension; **v1.2 removes that** |

### 12.3 Never

- Restore a consumed code.
- Expose the remaining count outside `GET /me/2fa` (VERIFIED: `two-factor.service.ts:100`).
- Log codes, secrets, passwords or OTPs.

---

## 13. MFA disablement (unchanged from v1.1 except references)

| Class | Rule | Status |
|---|---|---|
| `admin` today | Refused (`two-factor.service.ts:205`) | VERIFIED |
| Staff | Password + current factor (TOTP or a consumed recovery code). Refused entirely once OD-004 enforcement lands. **FD-21:** OD-004 covers every non-patient role, but enforcement needs a rollout / grace period first; **no immediate enforcement change is authorized** | APPROVED (v1.0) "password alone insufficient"; mechanism RECOMMENDED (IMP-10 not authorized). Today non-admin staff can still disable with the password alone (MRR-09, VERIFIED; NR-3) |
| Patients | Password only (API §2.9), **kept** | APPROVED (MRD-04 (ii)(a)); downgrade risk NR-3 recorded, NOT ACCEPTED |

Contract and client mapping are in §14.3.

---

## 14. API compatibility — findings S9 and P1-6

### 14.1 `POST /auth/otp/recovery` response (APPROVED: MRD-27 (a))

**Today (VERIFIED):**

- `200 { data: <authenticated payload> }`, the same shape as login success (`step-up.service.ts:189`).
- Request DTO `otpRecoverySchema` in `backend/src/modules/auth/dto/login.schema.ts:44`. Under that directory, so
  a change also runs the **patient-app** CI suite (`ci.yml`, VERIFIED). The patient-app parity test reads
  `auth/dto/recovery.schema.ts`, which is the *password-reset* schema, not this one (VERIFIED).

**Proposed:** a discriminated union on the same route and status.

```text
200 { data: { kind: "session", ...today's authenticated payload } }            ← every non-last code, all classes, and every patient redemption
200 { data: { kind: "mfa_recovery", recoveryToken, expiresIn, request: { state, expiresAt } } }   ← last code, staff classes, after enablement
```

`kind: "session"` is **additive** to today's payload. Recovery responses carry **no** refresh credential and set
no refresh cookie.

### 14.2 Callers

| Caller | Evidence (VERIFIED) | Effect | Required change |
|---|---|---|---|
| Doctor SPA `redeemRecoveryCode` | `frontend/src/api/endpoints/auth.ts:329-342`: posts, then `adoptOrRefuse(unwrap(body))` expecting `AuthenticatedPayloadDto`; page `features/auth/pages/VerifyOtpPage.tsx`; type `types/auth/auth-service.ts:155` | A `mfa_recovery` payload would fail `toSession` (no `user`) | Branch on `kind`: `session` → existing path; `mfa_recovery` → hold the recovery token in memory (never `apiClient.setAccessToken`), route to new recovery screens (IMP-26) |
| Patient app `redeemRecoveryCode` | `patient-app/src/api/endpoints/auth.ts:113-123`: `parseResponse(…, sessionSchema, raw)`; `sessionSchema = envelopeSchema(tokensSchema.extend({ user }))` (line 72), plain `z.object` (`schemas/envelope.ts:21`, unknown keys stripped) | `kind: "session"` is ignored safely. A `mfa_recovery` payload would fail the parse, but patients never receive it (class D excluded) | **No code change.** Regression tests only (IMP-27) |

**Rollout order (BLOCKED steps marked):**

1. Backend adds `kind: "session"` (additive).
2. The SPA release that understands `mfa_recovery` ships.
3. Only then does the backend enable the last-code recovery response. This step is **BLOCKED** on PRE-03,
   MRD-02 and MRD-27.

### 14.3 Error codes (RECOMMENDED)

The three lists are closed (VERIFIED):

- backend `common/errors/error-codes.ts:16-33`;
- SPA `types/auth/auth-error.ts:19-37` (`AuthErrorCode`), plus the `AUTH_CODES` filter in `auth.ts:196-213`.
  An unknown code becomes a raw `ApiError`, so the user sees a generic failure;
- patient app `features/auth/useAuthErrorMessage.ts:53-71`, a `switch` with a generic `default`.

| New code | HTTP | Raised by | Backend list | SPA union + UI | Patient app |
|---|---|---|---|---|---|
| `mfa_recovery_pending` | 403 | Login, OTP verify, OTP recovery (account `SUSPENDED`) | Add | Add; `LoginPage.tsx` (branches at :73-77) shows "recovery in progress" | Not received (class D); default branch is safe |
| `mfa_recovery_required` | 403 | Same (account `RECOVERY_REQUIRED`) | Add | Add; LoginPage shows "contact your administrator / cancel with your authenticator" | Not received |
| `mfa_recovery_active` | 409 | OTP recovery (last code while a request is active) | Add | Add; VerifyOtpPage | Not received |
| `mfa_recovery_restricted` | 403 | Access guard (recovery token on an ordinary route) | Add | Add (defensive; the client should never send it) | Not received |
| `mfa_code_required` | 422 | `/me/2fa/disable` (staff without a code) | Add | Add; doctor settings dialog (`TwoFactorDialogs.tsx`) | Only if MRD-04(ii)(b) |

Codes follow ADR-012 snake_case. 403, not 401, keeps the SPA from treating these as "refresh, then sign out"
(ADR-013).

### 14.4 `/me/2fa/disable` — same as v1.1 §10.1

Additive rollout. The doctor SPA disable call is `http-settings-service.ts:376`; its re-enrolment call already
sends `{ password, code }` at `:381`. Patient app: `account.ts:173` and `TwoFactorSetup.tsx:111-157`, changed
only if MRD-04(ii)(b).

### 14.5 Regression requirements (RECOMMENDED; IMP-27)

- A patient's last-code redemption still returns `kind: "session"` with tokens; patient-app tests parse it with
  the unchanged `sessionSchema`.
- A non-last code returns `kind: "session"` for every class.
- An SPA released before the change keeps working with `kind: "session"` (additive field).
- The SPA handles all five new codes, with no generic-error fallback (unit tests on `toAuthError`).
- The patient-app error mapper renders its generic message for an unexpected code.
- Login, OTP verify, refresh and the disable flow are unchanged for accounts with no suspension.
- The patient-app CI suite runs on every `auth/dto` change (VERIFIED path filter).

---

## 15. Audit and notifications

**Audit:** the v1.1 §13.1 event list, plus:

- `auth.mfa_recovery.reference_checked` (matched or not; never the value);
- `auth.mfa_recovery.approval_voided`;
- `auth.mfa_recovery.suspension_changed`;
- `auth.mfa_recovery.cancel_with_proof` (success or failure);
- `auth.password_reset_refused`;
- `auth.mfa_recovery.refused_route` (a recovery token on an ordinary route; sampled or rate-limited to avoid log
  flooding).

Every transition is fail-closed through `TransactionalAuditWriter.recordWithin` (`transactional-audit.writer.ts:52`,
VERIFIED). Refusals use the non-throwing writer and `login_events`.

**v1.2.1 notification rules (APPROVED):**

- **R-1:** every notification is **generic**. The remaining-code count appears only in 2FA settings (R2, FINAL).
- **MRD-18:** the R3 recovery-code email moves onto the outbox.
- **A-4:** an email on every recovery-session issuance and re-issue.
- **A-10:** an email and in-app notification to the user when a request is created.
- **FD-27, AUTHORIZED FOR SPECIFICATION only:** an **independent external alert channel** for recovery,
  emergency and BG-A events that administrators cannot suppress. Specification may be written; nothing may be
  built (§18).

**Notifications:** the v1.1 §13.2 outbox design (VERIFIED primitives: outbox with `dedupeKey` and `correlationId`;
email worker M19.5; retry and dead-letter queue M30.1; `security` category locked on, M19.4).

- **New topics:** `auth.mfa_recovery.cancelled_with_proof`, `.subject_denied`, `.approval_voided`,
  `auth.password_reset_refused`.
- **Outbox reliability:**
  - the outbox row is written in the state-change transaction;
  - delivery is at-least-once with `dedupeKey = requestId:transition[:n]`;
  - a delivery failure never changes recovery state;
  - dead-lettered security notifications raise an operator alert (the M30.1 dead-letter queue exists; alert
    routing is RECOMMENDED).

---

## 16. Threat controls

| Threat | Control | Depends on |
|---|---|---|
| Mailbox-only takeover | Reset refused while suspended; password must predate the request (§11) | MRD-21 |
| Approver verifies the wrong person | Recovery Reference / Handover Code; explicit initiation confirmation (§6.4) | MRD-23 |
| Owner locked out by an attacker | Cancel-with-proof (§10); `subject_denied` rejection | MRD-22, MRD-23 |
| Stale request keeps an account blocked or unblocked | Persisted suspension; expire before use; sweeper (§8.4, §9) | MRD-08, MRD-14 |
| Email-link prefetch, replay, enumeration | POST confirmation, single use, binding, uniform answers (§6.3) | MRD-06 |
| TOTP replay on the public endpoint | Step ledger (DB-10) | MRD-28 |
| Stale approvals, employment change | Re-validation; OD-12 hooks (§7.5) | MRD-24, PRE-03 |
| Single approver undoes an approval | Two-person cancellation after APPROVED for non-security reasons; a single-approver **security** cancellation stops a suspicious request (A-12) (§7.6) | MRD-12 + A-12 |
| Client mis-parsing | Discriminated response, release order, regression tests (§14) | MRD-27 |
| Unenforced policy in the interim | MRD-20 (b) Hardened Interim (§3); IMP-30 BLOCKED / NOT IMPLEMENTED; ACC-09 NOT ACCEPTED | MRD-20, FD-18 |

v1.1 threats (stolen code, stolen session, refresh abuse, cross-tenant access, contact takeover, Platform Admin
abuse) keep their v1.1 controls.

---

## 17. Acceptance tests

v1.0 §12 and v1.1 §15 are retained. Added:

| Area | Tests |
|---|---|
| Password reset | Refused while `SUSPENDED` or `RECOVERY_REQUIRED`; `forgot` stays uniform and issues no token; no recovery session revoked by a reset attempt |
| Suspension | Persisted transitions for every row of §9.2; expiry yields `RECOVERY_REQUIRED`, never an unblocked account; login answers the correct 403 code in each state |
| Stale requests | A last code with only an *overdue* active request: the request expires first and creation proceeds. No path decides "active" from time alone |
| Recovery Reference | Wrong reference counted and refused (A-11); 3 failures in total cancel with an alert; "I did not start this" rejects at once (`subject_denied`); `reference_matched` is computed server-side (A-13); stored as keyed HMAC (A-9); never logged |
| Handover Code | Required for every session issuance and re-issuance on administrator-initiated requests; re-issuances count toward MRD-19; never sent by email or SMS; keyed HMAC only (CL-3) |
| Cancel-with-proof | Success restores the old TOTP; replayed code (same step) refused; lockout shared; uniform answers; rate limits |
| Email link | GET does not consume; POST does; second use fails; voided at terminal states; link proof alone never yields a session |
| Re-validation | A voided approver approval keeps the request PENDING; an employment change cancels |
| Cancellation after APPROVED | Non-security reasons need two approvers; a single eligible approver (or the initiator, R-8) may make a `suspected_compromise` security cancellation at any non-terminal state (A-12) |
| API | All §14.5 regression requirements |
| TOTP replay (MRD-28 (b), CL-9) | A replayed code (same time step) is refused on **every** TOTP verification: login, OTP verify, re-enrolment and cancel-with-proof, **including patient sign-in**. Patient-app compatibility and regression tests are part of the future implementation scope |
| Interim (IMP-30) | **None defined in §17**: this is blocker 2 of IMP-30, which is BLOCKED / NOT IMPLEMENTED. A proposed, unapproved set is kept for a future decision (`IMP-30_INTERIM_HARDENING_SCOPE_RECORD.md` §4) |

---

## 18. Related owner decisions outside the recovery flow (v1.2.1)

These were decided in the same round. They are recorded here so the spec is complete, but **they are not part of
the recovery flow, and none authorizes implementation.**

| FD | Decision | Status | What it authorizes |
|---|---|---|---|
| FD-21 | OD-004's mandatory staff MFA covers **every non-patient role** (Admin, Doctor, Pharmacy and any other staff role). A rollout / grace period is required before enforcement; staff who haven't enrolled must not be suddenly locked out | APPROVED (policy clarification) | Nothing in code. A future enforcement change needs its own authorization |
| FD-22 | **Patient recovery is a separate track.** Direction: staged recovery, first email + password + a cooling-off period (illustrative range 24–72 hours), with cancellation and notifications; later, in-person clinic re-proofing. **Requires legal / privacy review.** Patients keep password-only MFA disablement (MRD-04 (ii)(a)); the associated risk (NR-3) is recorded and **NOT ACCEPTED** | APPROVED (direction); patient track to be specified separately | Specification after legal / privacy review. Nothing may be built. **The staff / admin AAL2 target does not apply to patient recovery** |
| FD-23 | Account-wide **progressive delay and alert** after repeated incorrect second-factor attempts across sign-ins; the counter resets only after a successful second factor. **Not implemented.** Proxy-dependent per-IP enforcement is not added unless separately verified and authorized | APPROVED (preferred improvement) | Specification. Not implementation (NR-1, NR-2) |
| FD-24 | New recovery-code sets ≥ 64 bits before R-A is built, conditional on primary-source NIST verification (§12.2) | APPROVED (conditional) | Nothing now. No change to code generation |
| FD-25 | At least 4 active Platform Admins (interim operating rule); sealed individual emergency identities may be studied later, after prerequisites; shared credentials not recommended (§7.4) | APPROVED (operating policy) | Study only |
| FD-26 | **Clinical continuity** through a covering-clinician and approver rota. Suspended / in-recovery accounts, administrators and emergency identities are **excluded** from this mechanism. **OD-04 Break-Glass remains a clinical, cross-hospital mechanism, never an account-recovery mechanism.** Legal review is required if HIPAA applies | APPROVED | Procedure; legal review if HIPAA applies |
| FD-27 | An independent external alert channel for recovery, emergency and BG-A events, which administrators cannot suppress | **AUTHORIZED FOR SPECIFICATION** | Specification only |
| FD-29 | **Jurisdiction: not yet determined** (Option D); Medora may target multiple markets. No jurisdiction is assumed (not Turkey, Cyprus, the United States, or any other), and HIPAA applicability is not assumed. **Target standard: NIST SP 800-63B-4. Assurance target: AAL2, as a design target only.** No conformance, certification or compliance is claimed. Primary-source verification and qualified expert / legal review are prerequisites to any conformance claim | APPROVED (target); jurisdiction OPEN | Nothing beyond the target statement |
| FD-30, FD-31 and §8 of the decision package | **Qualified healthcare-security and legal experts may be engaged** to review: P2; video identity verification; SMS-primary authentication; session lifetimes; passkeys; recovery-code storage and generation; throttling; emergency Platform Admin custody; jurisdiction and HIPAA applicability; clinical access; patient re-proofing; retention; NIST conformance | AUTHORIZED (to arrange and specify the review) | **No review has taken place yet** |

## 19. Known limitations and recorded conflicts (v1.2.1)

| # | Item | Resolution recorded |
|---|---|---|
| 1 | v1.2 §3 option (b) text ("message that no recovery codes remain") vs R2 / R-1 | Owner decision R-1 governs: generic messages; count only in settings |
| 2 | CL-3 (the initiator delivers the whole code) vs CL-5 (the P2 deliverer must not be the initiator, unless two people deliver jointly) | FD-19: on P2 only, the initiator delivers jointly with a second independent verifier; both audited. P2 is DEFERRED |
| 3 | Both password and authenticator lost (I-5) | No path until P2. The owner's 2026-11-13 decision states that this temporary lockout is accepted as a design consequence until P2 is approved. **Recorded as a decision consequence only.** Because FD-20 requires every ACC record to be reviewed individually, it is **not** recorded as acceptance of ACC-12 or any other ACC record |
| 4 | OD-004 (staff MFA mandatory) vs code (MFA enforced only for `admin`) | Policy clarified (FD-21); the discrepancy remains in code; NR-3 NOT ACCEPTED; no enforcement change authorized |
| 5 | IMP-30 depends on IMP-01 in the v1.2 dependency plan; IMP-01 is not authorized; no IMP-30 acceptance criteria exist | Both recorded as blockers; the owner's scope correction (L-005) confirms: do not implement IMP-30 or IMP-01. IMP-30 BLOCKED / NOT IMPLEMENTED. No code changed |
| 6 | NIST and legal texts were never retrieved in full (network policy) | Every NIST reference is extract-level. AAL2 is a target, not a claim |
