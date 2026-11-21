# Medora — MFA Recovery: Implementation Dependencies (v1.2.1)

**Status:** planning. **Every item below is BLOCKED** at least on gate G4 (implementation authorization), with one
exception:

- **IMP-30 is BLOCKED / NOT IMPLEMENTED**. FD-18 (b) carved it out of G2, but the owner's scope correction of 2026-11-13
  (decision log L-005) says **do not implement IMP-30 or IMP-01**.
- Blockers: (1) IMP-01 is an unauthorized prerequisite; (2) no acceptance criteria are defined in spec §17. See `IMP-30_INTERIM_HARDENING_SCOPE_RECORD.md`.
- **No item in this table is authorized for implementation.**

**Must not be built under any current authorization (CL-1):** PRE-05, DB-11, and the BG-B part of IMP-15.
**Deferred with P2 (MRD-29 OPEN):** no P2 task exists in this table; P2 needs its own specification first.

**Corrections in v1.2.1:**

| Finding | Correction |
|---|---|
| I-1 | Dependency cycle removed by splitting IMP-11 into IMP-11a, IMP-11b and IMP-11c |
| I-3 | MRD-01 added to DB-01, IMP-08 and IMP-15 |
| I-9 | MRD-19 added to IMP-20 |

**Baseline:** `origin/backend` `cce25437`; cited paths re-checked unchanged at `452dd006`.

**Base branches (`CLAUDE.md`):**

| Work | Base branch |
|---|---|
| `backend/` | `backend` |
| Schema, migrations, seed | `Database` |
| `frontend/` | `frontend` |
| `patient-app/` | `patient-app` |

**Change types:** Owner, Doc, BE (backend), FE (frontend), PA (patient app), DB (database).

**Gates** (v1.0 §14):

| Gate | Meaning |
|---|---|
| G1 | Owner decisions (PRE-02) |
| G2 | Design sign-off, including the acceptance records required before G2 |
| G3 | Database impact proposal approved |
| G4 | Implementation authorization |
| G6 | Security review and CI |
| G7 / G8 / G9 | Push or PR / merge / deploy, each separately |

---

## 1. Prerequisites

| ID | Prerequisite | Type | Status | Depends on |
|---|---|---|---|---|
| PRE-01 | Per-request session validation (spec §5.1) | BE | APPROVED as policy (I4, O-13); implementation BLOCKED on G4 | C-12 (if cached) |
| PRE-02 | Owner decisions MRD-01 to MRD-28 | Owner | **APPROVED** (recorded 2026-11-13; decision log L-001). MRD-25 DEFERRED (it is the FD-20 review); **MRD-29 OPEN** (P2 deferred) | — |
| PRE-03 | Phase 21 hospital and employment model; OD-07 tiers; M-13 admin mapping; ADR-042 approved | Owner + DB + BE | BLOCKED (ADR-042 is a draft) | ADR-042; MRD-05 |
| PRE-04 | Documentation baseline: owner-decision register (I2, I4, O-13, C-12, MRD answers) on `backend`'s lineage; recovery ADR; ADR-035 §7 amendment | Doc | BLOCKED | PRE-02; docs-branch merge path |
| PRE-05 | External append-only evidence store, shared with OD-006 restores. **Only for BG-B** | Owner + infrastructure + BE | **NOT TO BE BUILT (CL-1)**. BG-B stays inactive even after PRE-05, unless MRD-03 is decided again | MRD-26 |

---

## 2. Implementation tasks

"**Before PRE-03?**" means the task needs neither the tenant model nor any database change that depends on it.
**Every task also depends on G4**, which is not repeated in the table.

| ID | Task | Type | Base | Depends on | Before PRE-03? |
|---|---|---|---|---|---|
| IMP-01 | Transaction-aware `SessionService` (`start`, `revoke`, `revokeAllFor` on a caller's transaction) | BE | `backend` | G2 | Yes |
| IMP-02 | Token types: `typ:'access'` with a one-TTL rollout window; recovery token issuer and verifier (`rid`, `sid`, capped `exp`) | BE | `backend` | G2 | Yes (`access` part) |
| IMP-03 | Recovery guard: the access guard refuses recovery tokens (403); `@RecoveryRoute()` opt-in; no refresh credential for recovery sessions | BE | `backend` | PRE-01, IMP-02, DB-03 | No |
| IMP-04 | Last-code transition (spec §12.1): expire-before-use, conflict roll-back, request + reference, suspension, revoke all, recovery session, audit, outbox, recovery response | BE | `backend` | IMP-01, IMP-03, IMP-05, IMP-12, IMP-19, IMP-20, IMP-25, IMP-29, DB-01, DB-03, DB-09, MRD-02, MRD-27 | No |
| IMP-05 | Request service: state machine, 24 h deadline, allowlisted routes (spec §5.4) | BE | `backend` | DB-01, MRD-14 | No |
| IMP-06 | Recovery enrolment and atomic completion (spec §8.5); attempt and restart caps; no ordinary session | BE | `backend` | IMP-05, IMP-19, IMP-22, MRD-15, MRD-19 | No |
| IMP-07 | Login, OTP verify and OTP recovery refuse while suspended (403 `mfa_recovery_pending` / `mfa_recovery_required`); refusals logged | BE | `backend` | IMP-19, IMP-25, DB-09, MRD-08 | No |
| IMP-08 | Approver routes: view, approve, reject, cancel; eligibility at action time; two-approver cancellation after APPROVED for non-security reasons; single-approver security cancellation (A-12, R-8); thresholds; MRD-13 (a): no Platform Admin substitution for staff | BE | `backend` | PRE-03, IMP-05, IMP-20, IMP-22, DB-02, DB-04, MRD-01, MRD-12, MRD-13, MRD-17 | No |
| IMP-09 | Q7/R4 re-enrolment accepts a recovery code as the current factor (MRD-16 R-A) | BE + FE | `backend`, then `frontend` | G2, MRD-16; **FD-24: new code sets ≥ 64 bits first**, conditional on NIST verification | Yes |
| IMP-10 | `/me/2fa/disable` additive contract; staff require a code (patients keep password only, MRD-04 (ii)(a)) | BE | `backend` | G2, MRD-04; staff scope per FD-21 (rollout / grace period first) | Yes |
| IMP-11a | Frontend: capability union and metadata for the `accounts.*` permissions (**frontend first**, before DB-04) | FE | `frontend` | G2, MRD-17 | Yes |
| IMP-11b | Frontend: disable code field | FE | `frontend` | IMP-10, MRD-04 | Yes |
| IMP-11c | Frontend: approver and recovery-admin screens | FE | `frontend` | IMP-08, IMP-11a, MRD-17 | No |
| IMP-12 | Notifications: outbox topics and notification rules; dead-letter alert routing; R3 email onto the outbox | BE | `backend` | early: G2, MRD-18; rest: IMP-05 | Partly (early = R3 email onto the outbox; rest = recovery topics and rules) |
| IMP-13 | Session re-issue with IV-1 + IV-2 (+ Handover Code); email link with POST confirmation and link proof (spec §6.3); password predates the request | BE | `backend` | IMP-03, IMP-05, IMP-18, IMP-20, DB-06, MRD-06, MRD-10, MRD-19, MRD-21 | No |
| IMP-14 | Void outstanding password-reset tokens at recovery start | BE | `backend` | IMP-04, IMP-18 | No |
| IMP-15 | Platform Admin recovery: **BG-A only** in the approver routes. ~~BG-B server-side command~~: **not to be built (CL-1)** | BE + Doc | `backend` | PRE-03, IMP-08, MRD-01, MRD-03 (BG-B part: PRE-05, DB-11, DOC-01, MRD-26; **inactive**) | No |
| IMP-16 | Test suites: v1.0 §12, v1.1 §15, v1.2 §17; route-table enumeration of the recovery-token allowlist | BE | with each task | The task under test (each IMP item carries its own tests) | Per task |
| IMP-17 | Patient app: no application change unless MRD-04 changes patient policy | PA | `patient-app` | MRD-04 | Yes |
| IMP-18 | Password reset gating while suspended (spec §11); informational email; future email-change guard | BE | `backend` | IMP-19, DB-09, MRD-21 | No |
| IMP-19 | Suspension lifecycle service (spec §9): states, transitions, consistency check | BE | `backend` | IMP-05, DB-09, MRD-08, MRD-16 | No |
| IMP-20 | Recovery Reference (keyed HMAC, A-9), Handover Code (CL-3: whole code, initiator delivers, keyed HMAC, never by email or SMS), and per-approval evidence (A-13) (spec §6.4) | BE | `backend` | IMP-05, DB-01, DB-02, MRD-06, MRD-19, MRD-23 | No |
| IMP-21 | Public cancel-with-proof (spec §10) | BE | `backend` | IMP-12, IMP-19, IMP-28, IMP-29, DB-10, MRD-19, MRD-22 | No |
| IMP-22 | Approval re-validation; OD-12 employment hooks (spec §7.5) | BE | `backend` | PRE-03, IMP-05, DB-02, MRD-24 | No |
| IMP-23 | Administrator-initiated request with Handover Code (MRD-07) | BE | `backend` | IMP-05, IMP-08, IMP-19, IMP-20, MRD-07 | No |
| IMP-24 | Self-cancel through the recovery session (MRD-09) | BE | `backend` | IMP-03, IMP-05, IMP-19, MRD-09 | No |
| IMP-25 | `/auth/otp/recovery` discriminated response (additive `kind:"session"` first) and backend error-code list additions | BE | `backend` | G2, MRD-27 | Yes (additive part); enabling the recovery kind waits for IMP-04 and the IMP-26 release |
| IMP-26 | Doctor SPA: `kind` branch in `redeemRecoveryCode`; `AuthErrorCode` and `AUTH_CODES` additions; LoginPage and VerifyOtpPage handling; recovery-session screens | FE | `frontend` | early: IMP-25, MRD-27; rest: IMP-05 | Partly (early = union and `kind` branch; rest = recovery screens) |
| IMP-27 | Patient-app regression tests: `kind:"session"` parse, generic error path, unchanged flows | PA (tests only) | `patient-app` | IMP-25, MRD-04 | Yes |
| IMP-28 | TOTP step-replay ledger on the verifications MRD-28 selects | BE | `backend` | DB-10, MRD-28 | Yes |
| IMP-29 | Expire-before-use helper, sweeper job and consistency check (spec §8.4, §9.4) | BE | `backend` | IMP-05, IMP-19, MRD-14 | No |
| IMP-30 | Interim hardened last-code behaviour (MRD-20 (b); generic messages, R-1); retired by IMP-04. **BLOCKED / NOT IMPLEMENTED**: carved out of G2 (FD-18 (b)); implementation withdrawn by the owner's scope correction (L-005) | BE | `backend` | IMP-01 (**not authorized**: blocker), MRD-20 | Yes |

---

## 3. Database changes (separate from implementation; each needs G3; base `Database`)

| ID | Change | Constraints | Depends on | Before PRE-03? |
|---|---|---|---|---|
| DB-01 | `mfa_recovery_requests`: user, `hospital_id`, `account_class`, state, initiator, `created_at`, `expires_at` (written once), terminal reason, `version`, counters (enrolment attempts and restarts, re-issues, links issued, reference failures), `reference_hash`, `handover_hash` | Partial unique `(user_id) WHERE state IN (non-terminal)` (**state only, no time**); CHECK `hospital_id IS NULL ⇔ account_class = 'platform_admin'`; CHECK `account_class <> 'patient'`; CHECK state; CHECK terminal-reason consistency | DB-07, MRD-01 | No |
| DB-02 | `mfa_recovery_approvals`: request, approver, decision, reason, attestation method and reference, `reference_matched`, `subject_confirmed_initiation`, `voided_at` and reason, denormalised target and initiator | Unique `(request_id, approver_id)`; CHECK approver ≠ target and ≠ initiator; CHECK `subject_confirmed_initiation = false ⇒ decision = 'reject'` | DB-01 | No |
| DB-03 | `sessions.kind`; `sessions.mfa_recovery_request_id` | CHECK `kind = 'mfa_recovery' ⇔ request id NOT NULL`; `refresh_token_hash` nullable for recovery sessions only (CHECK) | DB-01 | No |
| DB-04 | Permission rows `accounts.*` and bundles | `permissions.code varchar(60)` | IMP-11a (frontend first) | No |
| DB-05 | `audit_events.hospital_id` (C6) | — | DB-07 | No |
| DB-06 | `TokenKind` value `MFA_RECOVERY_REISSUE` (and the link-proof kind if stored) | Enum | — | Yes |
| DB-07 | Phase 21 hospital and employment model; admin tiers (owned by Phase 21) | — | ADR-042 (PRE-03) | — (it is PRE-03) |
| DB-08 | `api_keys` owner and hospital (OD-003) | — | DB-07 | No |
| DB-09 | `mfa_factor_suspensions`: `user_id`, state (`SUSPENDED` / `RECOVERY_REQUIRED`), `request_id`, `suspended_at`, `reason`, `cleared_at`, `cleared_by_route`, cancel-attempt counter and window start | Partial unique `(user_id) WHERE cleared_at IS NULL` (no time); CHECK state; CHECK state/request consistency | DB-01 | No |
| DB-10 | `user_credentials.totp_last_used_step` (bigint, nullable) | Conditional update decides acceptance | — | Yes |
| DB-11 | **NOT TO BE BUILT (CL-1).** Operator approval representation for BG-B: `approver_id` nullable, `operator_ref` and signature fields | CHECK exactly one of `approver_id` / `operator_ref`; operator rows only on `platform_admin` requests | DB-02, MRD-26 | No |

**Deliberately not needed:**

- No pending-secret column: the pending secret travels in a signed token.
- No correlation or outcome columns: they go in `payload`.
- No column for the hardened interim: the audit row is the record.

---

## 4. Documentation tasks

| ID | Task | Depends on |
|---|---|---|
| DOC-01 | Recovery ADR (number allocated only after checking every branch's register; highest seen ADR-044); ADR-035 §7 amendment; ADR-017 §3 exception if BG-B | PRE-02 |
| DOC-02 | Record the MRD answers and acceptance records (ACC-01 to ACC-12) in `OWNER_DECISIONS.md`; mark C-1 and C-2 answered. **The MFA Recovery decision log is updated (2026-11-13). The repository's `OWNER_DECISIONS.md` is not**: that is a repository change and needs its own authorization | PRE-02 |
| DOC-03 | API contract: `/auth/mfa-recovery/*` routes; approver routes; `/auth/otp/recovery` discriminated response; `/me/2fa/disable`; five new error codes | MRD-27, MRD-04 |
| DOC-04 | Roadmap entries for PRE-01 and the recovery milestone | PRE-02 |
| DOC-05 | Interim runbook for administrator lockout (MRR-12), using existing capabilities only | — |
| DOC-06 | Client release notes and order: backend additive → SPA → enable recovery kind | MRD-27 |

---

## 5. Order

**Regenerated mechanically for v1.2.1 from the "Depends on" columns of §1–§3** (the BG-B clause of IMP-15 is excluded because it is inactive), so the diagram and the tables cannot
disagree. `X ⇐ Y` means X needs Y. Every IMP item also needs G4, and G3 for any DB item it uses.

```text
G1  PRE-02 owner decisions (MRD-01…28, recorded 2026-11-13) ──► G2 design sign-off (ACC-01…ACC-12 reviewed
    individually, FD-20; ACC-09 required) ──► G3 (DB) / G4 (implementation)
    IMP-30: carved out of G2 (FD-18 (b)) but BLOCKED / NOT IMPLEMENTED (needs unauthorized IMP-01; no §17 criteria).
    Not to be built (CL-1): PRE-05, DB-11, BG-B part of IMP-15. P2 (MRD-29) has no task: DEFERRED.

Track A — no Phase 21 dependency ("Before PRE-03?" = Yes, or the early part of Partly):
    PRE-01  ⇐ —
    DB-06   ⇐ —
    DB-10   ⇐ —
    IMP-01  ⇐ —   [decisions: G2]
    IMP-02  ⇐ —   [decisions: G2]
    IMP-09  ⇐ —   [decisions: FD-24, MRD-16, G2]
    IMP-10  ⇐ —   [decisions: FD-21, MRD-04, G2]
    IMP-11a ⇐ —   [decisions: MRD-17, G2]
    IMP-11b ⇐ IMP-10   [decisions: MRD-04]
    IMP-12  ⇐ —   [decisions: MRD-18, G2]   (early part)
    IMP-17  ⇐ —   [decisions: MRD-04]
    IMP-25  ⇐ —   [decisions: MRD-27, G2]
    IMP-26  ⇐ IMP-25   [decisions: MRD-27]   (early part)
    IMP-27  ⇐ IMP-25   [decisions: MRD-04]
    IMP-28  ⇐ DB-10   [decisions: MRD-28]
    IMP-30  ⇐ IMP-01   [decisions: MRD-20]

Track B — after PRE-03 (Phase 21, OD-07 tiers, M-13, ADR-042):
    PRE-03  ⇐ —   [decisions: MRD-05]
    DB-01   ⇐ DB-07   [decisions: MRD-01]
    DB-02   ⇐ DB-01
    DB-03   ⇐ DB-01
    DB-04   ⇐ IMP-11a
    DB-05   ⇐ DB-07
    DB-07   ⇐ PRE-03
    DB-08   ⇐ DB-07
    DB-09   ⇐ DB-01
    DB-11   ⇐ DB-02   [decisions: MRD-26]
    IMP-03  ⇐ DB-03, IMP-02, PRE-01
    IMP-04  ⇐ DB-01, DB-03, DB-09, IMP-01, IMP-03, IMP-05, IMP-12, IMP-19, IMP-20, IMP-25, IMP-29   [decisions: MRD-02, MRD-27]
    IMP-05  ⇐ DB-01   [decisions: MRD-14]
    IMP-06  ⇐ IMP-05, IMP-19, IMP-22   [decisions: MRD-15, MRD-19]
    IMP-07  ⇐ DB-09, IMP-19, IMP-25   [decisions: MRD-08]
    IMP-08  ⇐ DB-02, DB-04, IMP-05, IMP-20, IMP-22, PRE-03   [decisions: MRD-01, MRD-12, MRD-13, MRD-17]
    IMP-11c ⇐ IMP-08, IMP-11a   [decisions: MRD-17]
    IMP-12  ⇐ IMP-05   (remaining part)
    IMP-13  ⇐ DB-06, IMP-03, IMP-05, IMP-18, IMP-20   [decisions: MRD-06, MRD-10, MRD-19, MRD-21]
    IMP-14  ⇐ IMP-04, IMP-18
    IMP-15  ⇐ IMP-08, PRE-03   [decisions: MRD-01, MRD-03]
    IMP-16  ⇐ (runs with each task; its prerequisites are that task's)
    IMP-18  ⇐ DB-09, IMP-19   [decisions: MRD-21]
    IMP-19  ⇐ DB-09, IMP-05   [decisions: MRD-08, MRD-16]
    IMP-20  ⇐ DB-01, DB-02, IMP-05   [decisions: MRD-06, MRD-19, MRD-23]
    IMP-21  ⇐ DB-10, IMP-12, IMP-19, IMP-28, IMP-29   [decisions: MRD-19, MRD-22]
    IMP-22  ⇐ DB-02, IMP-05, PRE-03   [decisions: MRD-24]
    IMP-23  ⇐ IMP-05, IMP-08, IMP-19, IMP-20   [decisions: MRD-07]
    IMP-24  ⇐ IMP-03, IMP-05, IMP-19   [decisions: MRD-09]
    IMP-26  ⇐ IMP-05   (remaining part)
    IMP-29  ⇐ IMP-05, IMP-19   [decisions: MRD-14]
```

**Critical path:** PRE-02 (decided 2026-11-13) → PRE-03 → DB-07 → DB-01 → DB-09 → IMP-19 → IMP-29 → IMP-04 → G6.

**Most valuable early items** (Track A, each needing its own G4 authorization):

- PRE-01 closes MRR-01 platform-wide;
- IMP-28 with DB-10 closes MRR-23 (also for today's login);
- IMP-30 would reduce MRR-16 (MRD-20 (b) chosen). It is BLOCKED / NOT IMPLEMENTED: IMP-01 is unauthorized, and
  there are no §17 acceptance criteria (L-005).
