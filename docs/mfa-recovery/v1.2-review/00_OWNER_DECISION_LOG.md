# MFA Recovery v1.2: Owner Decision Log (audit trail)

**Purpose:** the authoritative record of owner decisions on MFA Recovery v1.2.

**Rules of this log:**

1. A decision becomes **APPROVED** only when the owner's explicit answer is quoted here verbatim, with date and
   scope.
2. A recommendation, silence, or "looks fine" without a named option is **not** approval.
3. Entries are append-only. A change is a new entry that supersedes the earlier one; nothing is deleted.
4. Approval of a decision is **not** implementation authorization. G4 stays closed until the owner separately
   authorizes implementation.
5. Residual risks are accepted only through MRD-25, record by record (ACC-01 to ACC-11).

**Design reviewed:** `scratchpad/mfa-recovery-v1.2/` (hashes in `01_INITIAL_VERIFICATION.md`).

**Evidence baseline:**

| Branch | Commit |
|---|---|
| `origin/backend` | `452dd006` (v1.2 cited `cce25437`; cited paths unchanged) |
| `origin/frontend` | `c20cf560` |
| `origin/patient-app` | `bb80009b` |

---

## Status snapshot of 2026-11-12 (historical; superseded by "Current status (2026-11-13)" below)

| ID | Title | Status | Review group | Owner answer |
|---|---|---|---|---|
| MRD-01 | Admin tier naming (Platform Admin; no Support) | OPEN | 7 | — |
| MRD-02 | Interim mapping of `admin` | OPEN | 2 (with MRD-20) | — |
| MRD-03 | Platform Admin recovery (BG-A / BG-B) | OPEN | 7 | — |
| MRD-04 | Patient policy (recovery; disable) | OPEN | 7 | — |
| MRD-05 | Tenant for non-doctor staff | OPEN | 7 | — |
| **MRD-06** | **Identity-verification procedure** | **OPEN — presented** | **1** | — |
| MRD-07 | Administrator-initiated request; initiator may approve? | OPEN | 7 (coupled to Group 1) | — |
| MRD-08 | Suspension lifecycle | OPEN | 5 | — |
| MRD-09 | User self-cancel | OPEN | 7 | — |
| MRD-10 | Status-only re-issue while pending | OPEN | 7 | — |
| MRD-11 | API keys at recovery start | OPEN | 7 | — |
| MRD-12 | Rejection, cancellation, abuse thresholds | OPEN | 7 | — |
| MRD-13 | Platform Admin authority over staff recovery (OD-07 scope) | OPEN | 7 | — |
| MRD-14 | 24 h deadline scope | OPEN | 5 | — |
| MRD-15 | No ordinary session at completion | OPEN | 7 | — |
| MRD-16 | Lost authenticator with codes remaining | OPEN | 7 | — |
| MRD-17 | Permission identifiers | OPEN | 7 | — |
| MRD-18 | R3 email onto the outbox | OPEN | 7 | — |
| MRD-19 | Numeric limits | OPEN | 7 | — |
| MRD-20 | Interim period before Phase 21 | OPEN | 2 | — |
| MRD-21 | Password reset during recovery | OPEN | 3 | — |
| MRD-22 | Owner cancellation with proof | OPEN | 4 | — |
| **MRD-23** | **Approver-to-holder binding** | **OPEN — presented** | **1** | — |
| MRD-24 | Approval re-validation; employment changes | OPEN | 7 | — |
| MRD-25 | Residual-risk acceptance (ACC-01 to ACC-11) | OPEN | 8 (last) | — |
| MRD-26 | BG-B evidence store and operator records | OPEN | 7 | — |
| MRD-27 | `/auth/otp/recovery` contract | OPEN | 6 | — |
| MRD-28 | TOTP replay-protection scope | OPEN | 7 | — |

**Approved: 0. Open: 28.**
**Acceptance records signed: 0 of 11.**
**Implementation authorization: none.**

---

## Entries

*(Placeholder of 2026-11-12 replaced by the entries below. No earlier entry existed.)*

### Entry L-001: Ballot v1.2 answers (FD-01 to FD-16, part 1)

| Field | Value |
|---|---|
| Date recorded | 2026-11-13 |
| Source | Owner message "MFA Recovery — Owner Ballot Response and Controlled Decision Processing", 2026-11-13T08:08:09.492Z |
| Recording authorized by | L-004 (owner question 1 / FD-17: "Recording all chat-confirmed decisions FD-01 through FD-16 verbatim in the formal decision log") |
| Scope | Group 1 strategic direction; MRD-01 to MRD-29 answers; amendments A-1 to A-13; MRR acknowledgement; ACC deferral; findings I-1 to I-9; L-1, L-2 |
| Statuses | **APPROVED:** strategic direction; MRD-01…24, 27, 28; A-1…A-13 (individually; validated in the CL round). **DEFERRED:** MRD-25, MRD-26. **OPEN:** MRD-29. MRR-01…25: acknowledged, **not** accepted. ACC-01…11: deferred, **NOT ACCEPTED** |
| Authorizes | Documentation only. **No implementation** |
| Related | FD-01 … FD-16; MRD-01 … MRD-29; A-1 … A-13; MRR-01 … MRR-25; ACC-01 … ACC-11; I-1 … I-9 |

**Verbatim:**

> 1. Previously approved strategic direction
> The following Group 1 strategic decisions are already approved:
>
> * Identity verification must be conducted in person or through conditional live video.
> * Callback verification is temporarily removed until reliable phone-change auditing exists.
> * A Recovery Reference Code must bind the verified person to the recovery request/session.
> * Two independent approvers are required to grant access.
> * One eligible approver may immediately stop a suspicious recovery request.
> * Strategic approval does not automatically approve every technical amendment.
>
> Do not reinterpret or weaken these decisions.
> 2. Proposed owner answers
> Group 1 — Identity and approver binding
>
> * MRD-06: Approve, subject to individual sub-item decisions.
> * 6.A: Approve.
> * 6.B: Approve.
> * 6.C(i): Approve.
> * 6.C(ii): Approve conditionally under A-5.
> * 6.C(iii): Remove callback.
> * 6.D: Approve.
> * 6.E: Approve.
> * MRD-23: Option (a), Recovery Reference + Handover Code.
> * 23.A: Approve.
> * 23.B: Approve.
> * 23.C: Approve, subject to MRD-07.
> * 23.D: Approve.
>
> Proposed amendments
> Approve A-1 through A-13 individually, subject to validating that each amendment is consistent with the corresponding decision and does not introduce an undocumented contradiction.
> Remaining decisions
>
> * MRD-01: (a) Yes.
> * MRD-02: (a) None; wait for PRE-03.
> * MRD-03: BG-A only. Do not activate BG-B.
> * MRD-04(i): (a) Out of scope.
> * MRD-04(ii): (a) Password.
> * MRD-05: (a) One active employment.
> * MRD-07: (a) No; three people.
> * MRD-08: (a) As spec §9.
> * MRD-09: (a) Any time.
> * MRD-10: (a) No.
> * MRD-11: (a) Owned keys once OD-003 exists.
> * MRD-12: Amend with A-12.
> * MRD-13: (a) Hospital Admins only.
> * MRD-14: (a) Yes.
> * MRD-15: (a) Yes.
> * MRD-16: Option 3, R-A and R-B as an option.
> * MRD-17: As proposed.
> * MRD-18: Yes.
> * MRD-19: As listed.
> * MRD-20: (b) Hardened interim.
> * MRD-21: (a) Refuse password reset while suspended.
> * MRD-22: (a) Public cancel-with-proof.
> * MRD-24: Accept.
> * MRD-25: Defer formal residual-risk acceptance.
> * MRD-26: Defer BG-B until PRE-05 exists.
> * MRD-27: (a) Discriminated 200 response on the same route.
> * MRD-28: (b) Every TOTP verification.
> * MRD-29: P2, credential re-establishment variant.
>
> 3. Risk acknowledgement — MRR-01 to MRR-25
> Acknowledge all 25 risk records as reviewed.
> IMPORTANT:
> Acknowledgement is NOT acceptance of residual risk.
> Do not convert any MRR acknowledgement into an ACC acceptance.
> 4. Risk acceptance — ACC-01 to ACC-11
> Defer all 11 acceptance records.
> No residual risk is formally accepted at this stage.
> These records require a separate review and explicit owner authorization.
> ACC-09 remains a mandatory blocker for G2 until formally resolved.
> 5. Document findings — I-1 to I-9
> Acknowledge all nine findings and retain their findings and severity classifications.
> Proposed document-level decisions:
>
> * L-1: Yes, create MRD-29.
> * L-2: Later, after this ballot has been processed.
>
> Do not authorize v1.2.1 changes yet.

### Entry L-002: Clarifications CL-1 to CL-9 (FD-01 to FD-16, part 2)

| Field | Value |
|---|---|
| Date recorded | 2026-11-13 |
| Source | Owner message "MFA Recovery — Owner Clarifications CL-1 to CL-9", 2026-11-13T08:57:10.434Z |
| Scope | CL-1 … CL-9 |
| Statuses | **APPROVED:** CL-1, CL-3 (conditions; delivery settled in L-003), CL-4, CL-5 (direction only; MRD-29 OPEN), CL-6 (noted; ACC-03 / ACC-05 NOT ACCEPTED), CL-7, CL-8, CL-9. **CL-2 as worded here ("NOT CONFIRMED YET") is superseded by L-003** |
| Authorizes | Documentation only |
| Related | MRD-03, 07, 16, 17, 20, 22, 23, 26, 28, 29; ACC-03, 05, 09 |

**Verbatim:**

> CL-1 — BG-B
> CONFIRM.
> BG-B must remain inactive even after PRE-05 exists, unless I explicitly approve MRD-03 again.
> Do not build PRE-05, DB-11, or the BG-B portion of IMP-15 under the current authorization.
> CL-2 — Interim recovery exception
> NOT CONFIRMED YET — REQUIRE FURTHER ANALYSIS.
> My strategic direction requires two independent approvers to grant access through the administrator recovery-request process.
> MRD-20(b) appears to permit an ordinary session using the last recovery code without dual approval.
> Before I decide, explain:
>
> 1. The exact timeline of PRE-03, Phase 21, and MRD-20(b).
> 2. Exactly when this exception starts and ends.
> 3. Whether it can be disabled without creating an unrecoverable account lockout.
> 4. Whether the existing notification/outbox mechanism can deliver the required user notification without changing the API response contract.
> 5. The exact residual risk and controls during this period.
>
> Do not interpret this clarification as acceptance of ACC-09.
> Keep MRD-20 and ACC-09 OPEN pending my decision.
> CL-3 — Handover Code
> APPROVE WITH CONDITIONS.
> Proposed requirements:
>
> * Bound to one recovery request.
> * Valid only during that request’s lifetime.
> * Required for every applicable session issuance and re-issuance.
> * Re-issuances count toward MRD-19’s limit.
> * Store only a keyed HMAC.
> * Never expose the code through email or SMS.
> * Transfer it through a trusted identity-verification channel.
>
> Clarify exactly who receives the code, who communicates it to the account holder, and how this works without allowing the initiator to bypass the independent identity verification process.
> CL-4 — Initiation permission
> CHOOSE OPTION (i), WITH SAFEGUARDS.
> Use accounts.approveMfaRecovery as the authorization prerequisite for initiating the request.
> However:
>
> * The initiator must never approve their own request.
> * The initiator must be excluded from the required independent approvers.
> * The three-person requirement remains unchanged.
> * Apply the correct tenant and account-class restrictions.
> * Hospital Admin recovery remains within the Platform Admin authority defined by MRD-13.
> * Do not introduce new privileged authority through this clarification.
>
> Document the initiation permission explicitly, even if it uses the existing permission identifier.
> CL-5 — MRD-29 P2
> CONFIRM P2 AS THE PREFERRED DESIGN DIRECTION, SUBJECT TO THE FOLLOWING CONTROLS.
>
> * Treat P2 as a separately specified exception to the normal password requirement at recovery-session issuance.
> * Require three independent people for the identity verification process.
> * Bind the verified person and recovery session through the Recovery Reference and Handover Code.
> * Require the new password and new authenticator together at completion.
> * The Handover Code deliverer must not be the initiator, unless two independent people jointly perform the delivery and the audit records both.
> * Notify all relevant channels.
> * Create a separate risk-acceptance record for P2.
>
> Do not treat this as acceptance of the P2 residual risk.
> Keep MRD-29 OPEN until its detailed specification and acceptance record are presented for review.
> CL-6 — Minimum headcounts
> CONFIRM NOTED.
> I acknowledge the minimum staffing requirements and the possibility of recovery deadlock where insufficient eligible administrators exist.
> This acknowledgement does not accept ACC-03 or ACC-05.
> No BG-B fallback is authorized.
> CL-7 — Scope of dual approval
> CONFIRM.
> The two-approver requirement applies to administrator-mediated recovery-request grants.
> It does not prohibit self-service recovery or re-enrolment when the account holder proves possession of an existing valid factor, including:
>
> * MRD-16 R-A.
> * MRD-22 cancel-with-proof.
>
> These paths must retain their existing security requirements and must not become alternative administrator-approval bypasses.
> CL-8 — Findings I-1 to I-9
> CHOOSE OPTION 1 FOR EACH FINDING.
> I agree with the findings and their recorded severity classifications.
> Correct the agreed findings in v1.2.1 after the ballot has been processed and separately authorized.
> Do not modify v1.2 now.
> CL-9 — Patient TOTP replay protection
> CONFIRM.
> MRD-28(b) applies to every TOTP verification, including patient sign-in.
> Include patient-app compatibility and regression testing in the relevant future implementation scope.
> Patient recovery policy under MRD-04 remains unchanged.

### Entry L-003: Owner clarifications preserved in the consolidation round (CL-2, CL-3 delivery, R-1 to R-5, R-8)

| Field | Value |
|---|---|
| Date recorded | 2026-11-13 |
| Source | Owner message "Medora MFA Recovery — Final Decision Consolidation & Closure", §2, 2026-11-13T09:36:43.903Z |
| Statuses | **APPROVED:** CL-2 = MRD-20 (b) Hardened Interim (supersedes L-002's CL-2 wording; **ACC-09 NOT ACCEPTED**); CL-3 delivery = the whole code by the initiator, **no split-code design** (the split-knowledge proposal of the CL round is **rejected**); R-1, R-2, R-3, R-4, R-5, R-8 |
| Authorizes | Documentation only |
| Related | MRD-12, 13, 20, 23, 29; FD-03, FD-15 |

**Verbatim:**

> 2. Preserve all previous owner decisions and constraints
> Treat the following as existing owner instructions and preserve them:
>
> * CL-1: BG-B remains inactive. PRE-05, DB-11, and the BG-B portion of IMP-15 must not be implemented without a new explicit decision.
> * CL-3: The whole Handover Code is delivered by the initiator; do not revert to a split-code design.
> * CL-4: The initiator requires accounts.approveMfaRecovery, cannot approve their own request, is excluded from independent approvers, and the three-person rule remains.
> * CL-5: P2 is the preferred direction, but MRD-29 remains open pending detailed specification and separate risk acceptance.
> * CL-6: Minimum headcounts are acknowledged; ACC-03 and ACC-05 are not accepted; no BG-B fallback.
> * CL-7: The two-approver rule applies to admin-mediated recovery grants, not R-A or cancel-with-proof. These paths do not bypass suspended-account controls.
> * CL-8: Agree with correcting I-1 through I-9 in a future v1.2.1, only after separate authorization.
> * CL-9: MRD-28(b) applies to every TOTP verification, including patient sign-in. Patient-app regression tests are required for future implementation.
> * CL-2: MRD-20(b), Hardened Interim.
> * R-1: Generic notifications; show the count only in 2FA settings.
> * R-3: Email link required in P2.
> * R-4: Email request reference plus Handover Code for admin-mediated recovery/P2.
> * R-5: If the Handover Code is lost, cancel the request and start a new one.
> * R-2: Platform Admin recovers Hospital Admins under §7.2 / OD-07; Platform Admins do not recover Staff under MRD-13(a).
> * R-8: Initiator may perform security cancellation only; cannot approve their own request; is counted toward abuse thresholds.
>
> Important: These are owner clarifications supplied in conversation. They are not necessarily formally recorded in the v1.2 documents. Preserve their status as chat-confirmed, not formally recorded.
> No risk acceptance has been granted. ACC-01 through ACC-11 remain deferred/open unless the source documents explicitly show otherwise.

### Entry L-004: Final decision package answers (FD-17 to FD-31) and recording authorization

| Field | Value |
|---|---|
| Date recorded | 2026-11-13 |
| Source | Owner message "Medora MFA Recovery — Final Decision Recording & v1.2.1 Documentation Update", 2026-11-13T10:07:11.318Z |
| Scope | The 19 questions of `MEDORA_MFA_RECOVERY_FINAL_DECISION_PACKAGE.md` and the NIST assurance clarification |

**Statuses:**

| ID | Decision | Status | Authorizes |
|---|---|---|---|
| FD-17 | Record FD-01 … FD-16; prepare v1.2.1 | APPROVED | Documentation |
| FD-18 | (b) IMP-30 carved out of G2; ACC-09 OPEN | APPROVED | **AUTHORIZED FOR IMPLEMENTATION**, IMP-30 scope only (BLOCKED: `../mfa-recovery-v1.2.1/IMP-30_INTERIM_HARDENING_SCOPE_RECORD.md`) |
| FD-19 | P2 joint handover; no split code; P2 excluded from first approval; temporary both-lost lockout until P2; ACC-12 a record only | APPROVED; MRD-29 OPEN; ACC-12 NOT ACCEPTED | Documentation |
| FD-20 | (a) ACC-01 … ACC-12 reviewed individually at design approval | APPROVED (process) | Nothing accepted |
| FD-21 | Staff MFA = every non-patient role; rollout / grace period first | APPROVED (policy) | No code change |
| FD-22 | Staged patient recovery direction; separate track; legal / privacy review; MRD-04 (ii)(a) kept; NR-3 NOT ACCEPTED | APPROVED (direction) | Specification after legal / privacy review |
| FD-23 | (b) account-wide progressive delay + alert | APPROVED (preferred; not implemented) | Specification |
| FD-24 | (a) ≥ 64-bit new sets before R-A, conditional on NIST verification | APPROVED (conditional) | Nothing now |
| FD-25 | (a) ≥ 4 active Platform Admins; sealed identities studied later; no shared credentials | APPROVED (operating policy) | Study only |
| FD-26 | (a) covering clinician + rota; exclusions; OD-04 is never recovery | APPROVED | Procedure; legal review if HIPAA applies |
| FD-27 | (a) independent external alert channel | AUTHORIZED FOR SPECIFICATION | Specification only |
| FD-29 | Jurisdiction (Option D) not determined; NIST SP 800-63B-4 AAL2 = design target only | Target APPROVED; jurisdiction OPEN | No conformance claim |
| FD-30 / FD-31 / §8 | Qualified expert review | AUTHORIZED (to arrange) | Review not yet held |
| ACC-12, NR-1 … NR-8 | Added as records only | NOT ACCEPTED | — |

**Recorded note (no silent resolution):** FD-19's wording "The owner accepts temporary patient/user lockout when
both password and authenticator are lost until a future P2 design is approved" is recorded verbatim, as a **design
consequence of deferring P2**. FD-20 requires every ACC record to be reviewed individually, and the owner
instructed "No risk is accepted by this instruction". So it is **not** recorded as acceptance of ACC-12, NR-4 or
any other record.

**Verbatim (NIST clarification):**

> The owner has answered all 19 questions in MEDORA_MFA_RECOVERY_FINAL_DECISION_PACKAGE.md, including the final NIST assurance-level clarification:
>
> * Target standard: NIST SP 800-63B-4.
> * Target assurance level: AAL2.
> * AAL2 is a design target, not a claim of current conformance or certification.
> * Patient recovery remains a separate policy and design track.

**Verbatim (authorization and decisions):**

> 2. Formal recording authorization
> The owner explicitly authorized:
>
> * Recording all chat-confirmed decisions FD-01 through FD-16 verbatim in the formal decision log.
> * Preparing MFA Recovery v1.2.1 to correct findings I-1 through I-9.
> * Incorporating confirmed amendments, but only where the owner’s answers establish a final decision.
> * Creating ACC-12 as a risk record only.
> * Adding NR-1 through NR-8 to the risk register as records only.
> * Creating a separate record for the authorized IMP-30 interim hardening scope.
>
> Record the source and status of each decision. Do not label a proposal, preference, or deferred item as approved.
>
> 3. Owner decisions to record
> Use the following as authoritative owner decisions.
> A. Existing decisions and recovery policy
> Preserve the previously confirmed decisions, including:
>
> * BG-B remains inactive, including after PRE-05, unless a new explicit MRD-03 decision is made.
> * Do not implement PRE-05, DB-11, or the BG-B part of IMP-15.
> * MRD-20(b): Hardened Interim. ACC-09 remains open and unaccepted.
> * The initiator delivers the complete Handover Code. No split-code design.
> * The Handover Code is request-bound, lifetime-limited, required for every issuance/re-issuance, counts toward MRD-19, uses keyed HMAC only, and is never delivered by email or SMS.
> * The initiator must have accounts.approveMfaRecovery, cannot approve their own request, and is excluded from the two independent approvers.
> * Maintain the three-person rule and applicable tenant/class constraints. Do not introduce new authority.
> * MRD-29 remains OPEN. P2 is excluded from the first design approval and requires a separate detailed specification and risk decision.
> * Minimum headcounts are acknowledged; ACC-03 and ACC-05 are not accepted. No BG-B fallback.
> * Dual approval applies to admin-mediated recovery grants, not R-A or cancel-with-proof. These paths do not bypass suspended-account controls.
> * MRD-28(b) applies to every TOTP verification, including patient sign-in.
> * Recovery-code rules already implemented in PR #186 must be documented accurately; do not claim new implementation.
> * Recovery-code use count is displayed only in 2FA settings.
> * Notifications are generic.
> * Platform Admin recovery authority follows §7.2 / OD-07. Platform Admins do not recover Staff under MRD-13(a).
> * Email link is required in P2.
> * For admin-mediated recovery/P2, use email request reference plus Handover Code. Recovery Reference is the last-code path.
> * If the Handover Code is lost, cancel the request and start a new one.
> * Initiator may perform security cancellation only, never approval, and counts toward abuse thresholds.
>
> B. Group 1 strategic decisions
> Record the approved strategic direction:
>
> * Identity verification in person or conditional live video.
> * Temporarily remove callback until reliable phone-change auditing exists.
> * Recovery Reference Code binds the verified person to the recovery request/session.
> * Two independent approvers grant access in admin-mediated recovery.
> * One eligible approver may immediately stop a suspicious request.
>
> Do not interpret this strategic approval as blanket approval of every technical amendment.
> C. FD-18 — IMP-30 interim hardening
> The owner selected Option B:
>
> * Carve IMP-30 out of G2.
> * Authorize interim hardening as a separate, stand-alone hardening task.
> * ACC-09 remains OPEN and is NOT accepted.
> * Keep the work strictly isolated from unrelated G2 work.
>
> Document the exact authorized IMP-30 scope from the existing source documents. Do not invent additional controls or expand the scope.
> This is the only specifically authorized implementation-related work in this decision package. Do not implement unrelated recovery features.
> If the exact IMP-30 scope, branch, or acceptance criteria cannot be established from the existing documents, record the blocker and stop before code changes.
> D. FD-19 — P2 handover and patient recovery
> Record:
>
> * P2 only: the initiator delivers the whole Handover Code jointly with a second independent verifier; both actions are audited.
> * No split-code design.
> * P2 is excluded from first design approval and remains deferred pending separate specification.
> * The owner accepts temporary patient/user lockout when both password and authenticator are lost until a future P2 design is approved.
> * Create ACC-12 for P2 residual risk as a record only. Do not accept it.
>
> E. FD-20 — risk acceptance process
> Record Option A:
>
> * ACC-01 through ACC-12 must be reviewed individually during design approval.
> * Each record must ultimately be accepted, rejected, or require additional controls.
> * This is a process decision only.
> * No risk is accepted by this instruction.
>
> F. FD-21 — staff MFA scope
> Record:
>
> * OD-004 mandatory Staff MFA applies to every non-patient role, including Admin, Doctor, Pharmacy, and any other staff role.
> * A rollout/grace period is required before enforcement.
> * Do not suddenly lock out staff who have not enrolled.
> * This policy decision does not authorize immediate MFA enforcement changes in code.
>
> G. FD-22 — patient recovery and disablement
> Record:
>
> * Patient recovery direction: staged recovery using email + password + cooling-off period (illustrative range 24–72 hours), cancellation and notifications, followed later by clinic in-person re-proofing.
> * This requires legal/privacy review.
> * It must be specified separately from staff/admin MFA recovery.
> * Keep password-only patient MFA disablement under MRD-04(ii)(a).
> * Record the associated security risk. Do not mark it accepted.
>
> H. FD-23 — second-factor throttling
> Record Option B:
>
> * Account-wide progressive delay and alert after repeated incorrect second-factor attempts across sign-ins.
> * Reset the counter only after a successful second factor.
> * This is a preferred security improvement, not an implemented control.
> * Do not claim it is implemented.
> * Do not add proxy-dependent per-IP enforcement unless separately verified and authorized.
>
> I. FD-24 — recovery-code entropy
> Record Option A:
>
> * New Recovery Code sets must be at least 64 bits before R-A is built.
> * This is conditional on verification against the primary NIST source.
> * Do not implement R-A or change existing recovery-code generation as part of this task.
> * Do not describe the existing 40-bit recovery codes as a confirmed weakness in their current second-factor lookup role unless the source evidence establishes that conclusion.
>
> J. FD-25 — Platform Admin emergency capacity
> Record Option A:
>
> * Adopt at least four active Platform Admins as an interim operating rule.
> * Study individual sealed emergency identities in a future design only after prerequisites are met: phishing-resistant MFA, independent alerting, custody controls, tests, and security review.
> * Shared credentials are not recommended.
> * This is an operating policy decision, not code authorization.
>
> K. FD-26 — clinical continuity
> Record Option A:
>
> * Adopt clinical continuity through a covering-clinician and approver rota.
> * Explicitly exclude suspended/in-recovery accounts, administrators, and emergency identities from this mechanism.
> * OD-04 remains a clinical Break-Glass mechanism, not an account-recovery mechanism.
> * Legal review is required if HIPAA applies.
>
> L. FD-27 — independent external alerting
> Record Option A:
>
> * Authorize specification of an independent external alert channel for recovery, emergency, and BG-A events.
> * Administrators must not be able to suppress this channel.
> * This authorizes specification only, not implementation.
>
> M. FD-29 — jurisdiction and NIST target
> Record:
>
> * Jurisdiction: Option D. Target jurisdiction is not yet determined; Medora may target multiple markets.
> * Do not assume Turkey, Cyprus, the United States, HIPAA applicability, or any other jurisdiction.
> * Target standard: NIST SP 800-63B-4.
> * Assurance target: AAL2.
> * Treat AAL2 as a design target only.
> * Do not claim conformance, certification, or compliance.
> * Primary-source verification and qualified expert/legal review are prerequisites before making any conformance claim.
> * Patient recovery remains a separate policy track; do not silently apply the staff/admin assurance decision to patient recovery.
>
> N. Qualified expert review
> Record authorization for qualified healthcare-security and legal experts to review the issues listed in §8 of the final decision package, including:
>
> * P2.
> * Video identity verification.
> * SMS primary authentication.
> * Session lifetimes.
> * Passkeys.
> * Recovery-code storage and generation.
> * Throttling.
> * Emergency Platform Admin custody.
> * Jurisdiction and HIPAA applicability.
> * Clinical access.
> * Patient re-proofing.
> * Retention.
> * NIST conformance.
>
> This authorizes arranging/specifying expert review. It does not imply the review has occurred.
> O. Proposed risks
> Add NR-1 through NR-8 to the risk register as formal risk records.
> For each risk:
>
> * Preserve its original identifier and description.
> * Include its source and related decision.
> * Record its status as OPEN / NOT ACCEPTED.
> * Do not infer acceptance from the owner’s authorization to add the record.

### Entry L-005: Scope correction, IMP-30 not to be implemented (supersedes the FD-18 implementation authorization in L-004)

| Field | Value |
|---|---|
| Date recorded | 2026-11-13 |
| Source | Owner message "Important scope correction", sent during the v1.2.1 recording round (2026-11-13) |
| Statuses | **IMP-30: BLOCKED / NOT IMPLEMENTED.** **IMP-01: not authorized.** The FD-18 (b) carve-out of IMP-30 from G2 stays recorded as a decision (L-004), but **no implementation is authorized**. ACC-09 stays OPEN, NOT ACCEPTED |
| Blockers recorded | (1) **IMP-01 is an unauthorized prerequisite** of IMP-30; (2) **IMP-30 has no defined acceptance criteria in spec §17** |
| Authorizes | Documentation validation only. No application code, database, migration or infrastructure change |
| Related | FD-18, MRD-20, IMP-01, IMP-30, MRR-16, ACC-09; `../mfa-recovery-v1.2.1/IMP-30_INTERIM_HARDENING_SCOPE_RECORD.md` |
| Fact | No IMP-30 or IMP-01 code was written, and no branch was created, before or after this correction |

**Verbatim:**

> Important scope correction:
> Do NOT implement IMP-30.
> Your findings establish that IMP-30 depends on IMP-01, which has not been authorized, and that §17 does not define acceptance criteria. The fact that the notification can be implemented without a database change does not remove the dependency or authorize implementation.
> Proceed with the remaining documentation validation only.
> Required actions:
>
> 1. Mark IMP-30 as BLOCKED / NOT IMPLEMENTED.
> 2. Record both blockers explicitly:
>
>    * IMP-01 is an unauthorized prerequisite.
>    * IMP-30 has no defined acceptance criteria in §17.
> 3. Do not implement IMP-01 or IMP-30.
> 4. Do not modify application code, database files, migrations, or infrastructure.
> 5. Complete the v1.2.1 document integrity, ID, cross-reference, and table validation.
> 6. Confirm that all owner decisions and risk statuses are represented accurately.
> 7. Confirm v1.2 remains byte-identical.
> 8. Report the exact files created and modified, the validation results, and the final Git status.
>
> No commit, push, PR, merge, or deployment.

---

## Current status (2026-11-13)

| Status | Items |
|---|---|
| APPROVED | Group 1 strategic direction; MRD-01 … MRD-24, MRD-27, MRD-28 (26); A-1 … A-13 (13); CL-1 … CL-9; R-1 … R-5, R-8; FD-17 … FD-26 |
| DEFERRED | MRD-25 (its process is FD-20); MRD-26 (BG-B inactive, CL-1); P2 |
| OPEN | MRD-29; jurisdiction (FD-29); C-12 |
| AUTHORIZED FOR IMPLEMENTATION | **None.** IMP-30 is **BLOCKED / NOT IMPLEMENTED** (L-005): IMP-01 is an unauthorized prerequisite, and there are no acceptance criteria in §17 |
| AUTHORIZED FOR SPECIFICATION | FD-27 independent alerting; FD-22 patient track (after legal / privacy review); FD-23 throttling |
| NOT ACCEPTED | ACC-01 … ACC-12 (12); NR-1 … NR-8 (8). **Acceptance records signed: 0 of 12** |
| IMPLEMENTED | Nothing new. Pre-existing R1–R5 (PR #186) only |

**Approved: 26 MRD (+ 13 amendments). Deferred: 2. Open: 1 (MRD-29).**
**G2 design sign-off: not passed.** It needs the individual ACC-01 … ACC-12 review (FD-20), with ACC-09 required.

