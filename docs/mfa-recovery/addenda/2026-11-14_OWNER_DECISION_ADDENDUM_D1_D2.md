# MFA Recovery: Owner-Decision Addendum of 2026-11-14 (Decisions D1 and D2)

| Field | Value |
|---|---|
| Date | 2026-11-14 |
| Status | **APPROVED** by the owner (2026-11-14T07:14Z); **AUTHORIZED FOR IMPLEMENTATION** within the scope below (2026-11-14T08:35Z and 09:17Z) |
| Nature | **New decisions taken after v1.2.1.** Neither is a v1.2.1 decision, and neither is recorded as one. They sit beside v1.2.1 and do not edit it |
| Originals | `../v1.2.1/*` and `../v1.2-review/00_OWNER_DECISION_LOG.md`, unchanged, as committed at `bec19d4c` on `claude/mfa-recovery-v1.2.1-originals` |
| Companions | `2026-11-14_COMPATIBILITY_MATRIX_SUPPLEMENT.md` (new matrix rows 9.01–9.09); `CHANGELOG.md` (this addendum's change record) |

**Naming.** "D1" and "D2" are this addendum's labels. They are not MRD numbers, and this addendum allocates no MRD,
FD or ADR number.

---

## 1. The decisions, verbatim

From the owner's message "Medora — Verify and Record Security Decisions Before Implementation", 2026-11-14T07:14:07Z:

> Decision 1 — Password verification attempt limits
> APPROVED.
> Failed password checks for:
>
> * POST /me/password
> * POST /me/2fa/disable
>
> must consume attempts from the existing shared lockout counter, following the same invariant as the existing
> password verification flow.
>
> Decision 2 — First-time 2FA enrollment
> APPROVED.
> Require password verification before first-time 2FA setup, before issuing the TOTP secret and recovery codes.

Scope as restated by the owner in "Medora — Combined Execution Authorization", 2026-11-14T08:35:54Z (B3, B4):

> Decision 1: Every failed current-password verification must consume the same existing lockout budget.
> Successful verification must follow the existing reset rules. At the lockout threshold, follow the established
> behavior, including session termination where required by the existing lock-screen verification flow. […] Do
> not change thresholds, durations, progressive lockout behavior, or reset semantics. […] Do not create a second
> password-attempt counter.
>
> Decision 2: This applies to: Patients. Doctors. Administrators. Pharmacy users. Other staff roles covered by the
> existing MFA policy. […] This decision concerns first-time enrollment only. Do not automatically extend it to
> re-enrollment, disabling MFA, recovery, or other authentication flows. […] Include invitation-based enrollment
> only if it is genuinely within the approved scope and can be updated without conflicting with its existing
> security requirements.

---

## 2. Compatibility assessment

Every reference below is to the recovered originals. Nothing in this section relies on an earlier summary.

### 2.1 D1: shared password lockout budget on `/me/password` and `/me/2fa/disable`

**Verdict: COMPATIBLE.** No v1.2.1 requirement, decision, amendment or risk record conflicts with D1. Several
point the same way.

| Source | What it says | Relation to D1 |
|---|---|---|
| Spec §6, VERIFIED primitives | "the password (Argon2id, with lockout at `credential-lockout.service.ts:46`)" | D1 reuses exactly this primitive |
| Spec §6.1, IV-1 | "The password check plus the existing lockout" | The design never checks a password without the shared lockout. D1 extends that to two routes that did |
| Spec §6.3 | "A wrong password at `/auth/mfa-recovery/session` counts toward the same credential lockout as login" | Same rule, applied to a future public route. D1 applies it to two existing authenticated routes |
| Spec §10, check 2 | "Verify the password against the credential lockout. A failure counts toward lockout" | Same |
| Matrix 3.10 and 8.12 | Attempt limits and "Shared lockout on public endpoints": SUPPORTED by `credential-lockout.service.ts:46` | D1 needs no new primitive (supplement row 9.01) |
| MRD-19 (APPROVED, "as listed") | The recovery flow's numeric limits: re-issues, links, enrolment restarts (spec §6.2, §6.3, §8.2) | Not touched. D1 changes no number: the threshold and duration remain `loginAttemptLimit` and `lockoutMinutes` from the existing policy |
| MRD-04 (ii)(a) (APPROVED); FD-22 | Patients keep **password-only** 2FA disablement | Preserved. The disable route still takes only `{ password }`; D1 bounds the guesses, it adds no factor |
| Spec §13; MRR-09; NR-3 (OPEN, NOT ACCEPTED) | Non-admin staff can disable 2FA with the password alone; IMP-10 (code required for staff) is **not authorized** | Unchanged. D1 is not IMP-10 and does not claim to mitigate NR-3 or MRR-09 |
| ADR-035 §7, spec §13 row "`admin` today" | Administrators are refused at `/me/2fa/disable` before any password check | Preserved: the refusal still precedes the password check, so an administrator's request spends nothing |
| F31 (2FA disable revokes all sessions; needs a separate owner decision) | — | Unchanged on success: a correct password still ends in `revokeAllFor`. The only new revocation is the established lock-screen one at the threshold (§3.1) |
| FD-23 (APPROVED, specification only); NR-1, NR-2 | Account-wide progressive delay for **second-factor** attempts; not implemented | Not implemented by D1. D1 is about the password; it adds no progressive delay and touches no second-factor counter |
| Spec §11, row "Password changes" | "`/me/password` needs an ordinary session" | Unchanged |
| A-1 / invariant 14 | No password-only route issues a session or changes recovery state for an account in recovery | Unaffected: D1 issues nothing and touches no recovery state |

**Existing code invariant reused.** `CredentialLockoutService`'s own contract reads: "One counter —
`user_credentials.failed_attempts / locked_until` — and every path that checks a password against an account spends
from it". Before D1 two paths broke it: `PasswordRecoveryService.change` and `TwoFactorService.disable` verified the
password with no lockout at all. D1 restores the invariant; it does not create a policy.

### 2.2 D2: current password before first-time 2FA enrolment

**Verdict: COMPATIBLE, with one route excluded as outside the decision's terms** (invitation acceptance for the
four invitable roles, §2.3; exception confirmed by the owner, §5.1). No
v1.2.1 requirement prohibits a password before first-time enrolment, and none requires a different process.

| Source | What it says | Relation to D2 |
|---|---|---|
| Spec §1 FINAL decisions, Q7 / R4 | "Re-enrolment needs the current factor; old factor valid until the new one is proven" | **Distinct route.** First-time setup is `POST /me/2fa/setup`, which refuses an enrolled account with 409; re-enrolment is `/me/2fa/reenroll`. D2 changes only the first. Re-enrolment already requires the password (`two-factor.service.ts`, step 1) and is left exactly as it is |
| Spec §1, §12; owner decisions §1, R1–R5 (IMPLEMENTED, PR #186) | 10 codes × 40 bits, keyed HMAC in the encrypted column, single use, count only in `GET /me/2fa` | **Unchanged.** D2 moves the moment codes are issued behind the password check. It changes neither their generation, storage, number, use nor display |
| FD-24 (APPROVED, conditional) | No change to recovery-code generation authorized | Respected: generation is untouched |
| MRD-28 (b), CL-9 (APPROVED; IMP-28 not authorized) | A step-replay ledger on every TOTP verification, including patient sign-in | **Not implemented and not affected.** D2 adds no TOTP verification; `enable` is unchanged |
| OD-004 (FINAL); FD-21 (APPROVED, policy only) | Staff MFA mandatory for every non-patient role, patient MFA optional; rollout / grace period required first; **no code change authorized** | **No conflict.** D2 changes no enforcement, grace period or role scope. It applies one enrolment requirement to every role that can reach the route, which is the owner's stated scope. No grace-period logic exists in code (VERIFIED: none in `backend/src`) |
| Roadmap 2026-10-30 note | With `twoFactorRequired` on, an unenrolled user cannot sign in to enrol ("a product decision") | Unaffected: that path has no session and so never reaches setup. D2 neither opens nor closes it |
| MRR-12; spec §3 item 3 | An administrator who loses every factor has no self-service recovery ("setup refused, re-enrolment needs TOTP, admin disable refused") | Unchanged: setup still refuses an enrolled account before any password check |
| Spec §5.4 | `/me/*` is refused to recovery tokens | Unchanged |
| Spec §6.1 "Password-only is never sufficient" | Applies to recovery-session issuance | Not engaged: D2 issues no session. The password is an **additional** precondition on a route that already needed a session |
| MRD-15, matrix 3.6, IMP-06 | Recovery enrolment without the current TOTP (`/auth/mfa-recovery/enrolment`) | **Different route, not built, not touched.** D2 is not extended to it |
| A-2 (APPROVED) | Recovery completion re-checks the password | Consistent in direction. Not implemented here (recovery flow) |
| MRD-04 (i)(a), FD-22 | Patient recovery out of scope; separate track | Unaffected. D2 is patient *enrolment*, not recovery |
| IMP-17 | "Patient app: no application change unless MRD-04 changes patient policy" | IMP-17 bounds what the **recovery** design needs from the patient app. D2 is a separate owner decision that names the patient-app setup screen explicitly; IMP-17 is not modified and is not invoked |
| Spec §12.3 | Never log codes, secrets, passwords or OTPs | Applied: the password is compared with the stored Argon2id hash only, never stored, logged or echoed |

**Lockout on the new check.** D2 adds a password check. The `CredentialLockoutService` invariant above requires
every password check to spend from the shared counter, D1 records that the owner holds to that invariant, and the
owner's B4 asks the web client to "handle incorrect passwords and **lockout responses**" at enrolment. So the setup
check uses the same re-authentication primitive as D1, the lock screen and re-enrolment step 1. This creates no
counter, threshold or reset rule: it is the existing one.

### 2.3 First-time enrolment routes (owner B4: "identify every relevant first-time enrollment route")

| Route | First-time enrolment? | D2 |
|---|---|---|
| `POST /me/2fa/setup` | Yes: every role with a session (`@Authenticated()`; route matrix `ADRLPTN`) | **Applied** |
| `POST /me/2fa/enable` | Completes setup; proves a code. Issues no secret and no codes | Unchanged. A secret created by `setup` after D2 exists only after a password check. A pending secret created **before** D2 is not covered: known limitation §5.2 |
| `POST /auth/admin-invitations/accept` (ADR-035 §5) | Yes, for every invitable role: **`admin`, `reception`, `laboratory` and `pharmacy`** (`INVITABLE_ROLES`, `admin-invitation.schema.ts`; ADR-035 §5 "Invitable roles are `admin`, `reception`, `laboratory` and `pharmacy`") | **Excluded; exception confirmed by the owner (§5.1).** The account does not exist before this request, and the invitee **sets** the password in the same body, so there is no previously established password to verify. Unchanged; see §5.1 for the sequence and the limits of the exception |
| `POST /me/2fa/reenroll`, `/reenroll/confirm` | No (re-enrolment, Q7 / R4) | Out of scope; unchanged |
| `POST /auth/mfa-recovery/enrolment*` | No (recovery; not built) | Out of scope |

### 2.4 Conflicts and ambiguities found

None that stop either decision. Two points are recorded so that nothing is silently resolved:

1. **The owner's message of 07:14Z describes MRD-19 as "recovery-code handling".** In the recovered register MRD-19
   is "Numeric limits — As listed" (owner decisions §2), and recovery-code handling is R1–R5. Both were checked;
   neither is changed by D1 or D2.
2. **D1 at the lockout threshold ends the caller's session.** That is the established lock-screen behaviour the
   owner told D1 to follow (`reauthentication.service.ts`: the locking guess revokes the session, and so does a
   request made while the account is already locked). On `/me/password` and `/me/2fa/disable` this is new
   behaviour for those two routes, and it is the intended consequence of reusing the flow rather than a new rule.

---

## 3. Approved scope, as implemented

### 3.1 D1

For `POST /me/password` and `POST /me/2fa/disable`, the current-password check is `ReauthenticationService.verify`,
the lock screen's check, unchanged:

| Case | Behaviour (existing, reused) |
|---|---|
| Account already locked | Refusal audited (`auth.reauthenticate_failed`, `locked`); **this session revoked**; 429 `rate_limited` with `Retry-After` |
| Wrong password below the limit | Counter +1 (atomic); refusal audited; **401 `invalid_credentials`** (the code both routes already answered) |
| Wrong password reaching the limit | Account locked for `lockoutMinutes`; refusal audited; **this session revoked**; 429 `rate_limited` |
| Correct password | Counter cleared (the existing reset-on-success rule); `auth.reauthenticate` audited; the route then proceeds exactly as before |

Unchanged: thresholds, durations, reset semantics, the single counter, the administrator refusal on disable (still
first), F31's `revokeAllFor` after a successful disable, `revokeOtherSessions` after a successful change, the
"new password must differ" rule, and every response on success.

### 3.2 D2

`POST /me/2fa/setup` takes `{ password }` (non-empty, the `min(1)` rule every other password-confirmation body uses).
Order inside the route:

1. Account lookup.
2. **409** if 2FA is already enabled (Q7 / R4 refusal, before the password, so it spends nothing).
3. **The password check of §3.1** (same counter, same outcomes).
4. Only then: secret generated, secret and recovery codes stored, audit `auth.two_factor_setup`, response
   `{ otpauthUrl, secret, recoveryCodes }`.

A request with no body or no password is **422 `validation_failed`** and generates nothing. A wrong password
generates nothing and stores nothing.

Roles: every role that can reach the route, which is the owner's list (patients, doctors, administrators, pharmacy
and every other staff role). Clients: the web security settings enrolment dialog and the patient-app setup screen
both ask for the current password before the call, show no secret or code until the server answers, and handle a
wrong password and a lockout.

### 3.3 Not changed (explicit)

MFA recovery flows and controls; admin and patient recovery; Break-Glass and BG-B; PRE-05, DB-11, IMP-01, IMP-30;
OD-004 rollout / grace; re-enrolment; recovery-code lifecycle; TOTP verification; invitation acceptance and activation
for all four invitable roles; `POST /me/2fa/enable`; stored TOTP secrets; Prisma
schema, migrations, seeds or any database structure; deployment, Vercel, CI/CD. No ACC record is accepted. No v1.2.1
status changes: IMP-10, IMP-28 and every other IMP item stay as the dependency table records them.

---

## 4. Relation to the v1.2.1 status tables

| v1.2.1 item | Effect of this addendum |
|---|---|
| Owner decisions "Current status (2026-11-13)" row **AUTHORIZED FOR IMPLEMENTATION: None** | Still true **for the MFA Recovery design**. D1 and D2 are authorized under this addendum, outside that register |
| MRR-09, NR-1, NR-2, NR-3 | Unchanged, OPEN / NOT ACCEPTED. D1 is not the mitigation any of them names |
| Every MRD, FD, CL, R, A item | Unchanged |

---

## 5. Owner clarifications after the review (2026-11-14)

Recorded after the owner's review of the read-only security findings. Both are recorded as the owner gave them; neither
changes the implementation of §3.

### 5.1 Invitation-based enrolment exception — APPROVED

**Scope: invitation acceptance only, for the four invitable roles `admin`, `reception`, `laboratory` and `pharmacy`.**
The D2 password requirement does not apply to `POST /auth/admin-invitations/accept`.

**Why there is no password to verify.** The sequence, from ADR-035 §5 and `admin-invitation.service.ts` (unchanged by
this addendum):

1. Someone holding `roles.manage` creates the invitation (`POST /auth/admin-invitations`). An invitation is the
   authority to create an account and exists before the account does. No password exists yet.
2. **Phase 1, acceptance** (`POST /auth/admin-invitations/accept`, public): the single-use invitation token is the
   proof. In one request the invitee **chooses** the password (checked against the password policy), and in one
   transaction the account is created **INACTIVE** with that password's hash and a provisioned TOTP secret and
   recovery codes; the token is claimed conditionally so it cannot be accepted twice. The enrolment material is
   returned and **no session** is issued.
3. **Phase 2, activation** (`POST /auth/admin-invitations/activate`, public): a code from the phase-1 secret is
   verified; only then is the account `ACTIVE` with `two_factor_enabled = true`. Still no session: the invitee signs in
   through `POST /auth/login`.

The password D2 would check is the one being created in step 2. Before step 2 there is none.

**Why the exception is narrow.**

- It covers only the acceptance of a valid, unused, unexpired, unrevoked invitation token, i.e. an account that does
  not yet exist and has never had a password.
- It does **not** cover ordinary first-time enrolment by these roles. An existing `admin`, `reception`, `laboratory`
  or `pharmacy` account, invited or not, that enrols through `POST /me/2fa/setup` must give its current password
  (§3.2).
- It does not cover re-enrolment, recovery or any other route.
- Invitation behaviour is not changed: no password check was added to it, and `admin-invitation.service.ts`,
  `admin-invitation.controller.ts` and `admin-invitation.schema.ts` are unchanged.

### 5.2 Known limitation: pending secrets created before D2 — RECORDED, NOT RESOLVED

**Status: ACCEPTED AS A KNOWN, UNRESOLVED LIMITATION** for this change (the owner chose not to widen the scope).
**Remediation requires a separate owner decision.** No risk-acceptance record (ACC) is created or accepted by this
entry.

**Finding.** Before D2, `POST /me/2fa/setup` stored a TOTP secret and recovery codes for any session holder without a
password. An account on which setup was run before D2, and `POST /me/2fa/enable` was never called, still holds that
pending secret. `enable` checks only a code from the stored secret, with no password. So whoever obtained that secret
before D2 can still turn two-factor on for the account with a session and a code, without the password check D2
introduces.

**Security implication.** In the scenario D2 addresses, a session holder without the password (a borrowed
workstation, a stolen token) who ran setup **before** D2 can still bind the account to their own authenticator after
D2, and holds the recovery codes from that response. The exposure is limited to accounts with such a pending secret,
and to whoever already held it; no new secret can be minted without the password.

**Not done, by owner instruction:** stored secrets are not cleared, migrated or overwritten; no password check is
added to `POST /me/2fa/enable`; enablement, re-enrolment, recovery and other authentication flows are unchanged.

### 5.3 Other items recorded, not implemented

| Item | Status |
|---|---|
| Route-specific audit metadata. Password failures on `/me/password`, `/me/2fa/disable` and `/me/2fa/setup` are recorded as `auth.reauthenticate_failed`, and successes as `auth.reauthenticate`, with no route field, so they cannot be told apart from the lock screen | **Potential improvement only.** Not implemented; needs its own decision |
| Session termination at the lockout limit revokes the session row (refresh family); the access token already issued stays valid for up to `JWT_ACCESS_TTL` (900 s). While locked, every password-checking route answers 429 | Pre-existing (MRR-01; PRE-01 not authorized). Unchanged |
| Web clients, change-password and 2FA-disable: the server's lockout answer (429 **with** the envelope code `rate_limited`) now says the account is temporarily locked and the session has ended, and ends the session here exactly once. A 429 without that code (a proxy's or an edge firewall's) is not treated as the lockout and keeps the existing generic message, without sign-out | **Fixed** (owner-approved UI correction); no API or policy change. Relies on a verified fact: neither route carries `@RateLimited`, so the per-client limiter, which shares the code, never answers them |
| Web enrolment (`TwoFactorEnrolDialog`, D2) and re-enrolment (`TwoFactorReenrollDialog`, pre-existing) dialogs still treat **any** 429 as the lockout (status only) | **Open.** Outside the approved two-flow correction; needs an owner decision. The backend answers neither route's 429 except through the lockout |

