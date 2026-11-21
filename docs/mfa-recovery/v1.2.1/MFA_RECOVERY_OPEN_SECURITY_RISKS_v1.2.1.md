# Medora — MFA Recovery: Open Security Risks (v1.2.1)

**Supersedes** `../mfa-recovery-v1.2/MFA_RECOVERY_OPEN_SECURITY_RISKS.md` (preserved unchanged).
**Companion to:** `MFA_RECOVERY_SECURITY_SPEC_v1.2.1.md` and `MFA_RECOVERY_OWNER_DECISIONS_v1.2.1.md`.
**Baseline:** `origin/backend` `cce25437`; NR-1 to NR-8 evidence at `452dd006`.

**v1.2.1 changes (2026-11-13), all recorded in the decision log (L-003):**

- **No risk is accepted.** Every ACC record is **NOT ACCEPTED**.
- **ACC-12** (P2 residual) added as a record only.
- **NR-1 to NR-8** added as risk records only, status **OPEN / NOT ACCEPTED** (§4).
- **Owner process decision FD-20 (a):** ACC-01 to ACC-12 are reviewed **individually during design approval**.
  Each will be accepted, rejected, or given more controls. This is a process decision; it accepts nothing.
- MRR acknowledgement (ballot, 2026-11-13) is **not** acceptance.
- §1 below is the v1.2 register unchanged. The decisions taken since are in §1A.

**Fields:**

| Field | Values |
|---|---|
| **Severity** | The risk **before** mitigation: High, Medium or Low |
| **Status** | Exactly one. **VERIFIED**: the risk exists in the code today (evidence cited). **OPEN**: a design risk whose mitigation waits on an owner decision. **BLOCKED**: the mitigation cannot proceed until a prerequisite exists |
| **Mitigation** | Always **RECOMMENDED** (none is approved), with the governing decision |
| **Acceptance** | An acceptance record (ACC-xx, §3) is required wherever a residual remains. Every record is **OPEN** until the owner signs it (MRD-25) |

---

## 1. Register

| ID | Risk | Severity | Status | Mitigation (RECOMMENDED) | Decision | Residual after mitigation | Acceptance |
|---|---|---|---|---|---|---|---|
| MRR-01 | A revoked session's access token stays valid up to 900 s (`access-token.guard.ts:21-24`; `env.schema.ts:122`) | High | VERIFIED | PRE-01 per-request validation | I4 / O-13 (APPROVED as policy); C-12 | Staleness bounded by C-12 if cached | ACC-01 |
| MRR-02 | Password + old authenticator signs in normally during recovery | High | OPEN | Persisted suspension (spec §9) | MRD-08 | None | — |
| MRR-03 | Session re-issue degrades to password-only | High | OPEN | IV-1 + IV-2 (+ IV-4) (spec §6) | MRD-06 | Depends on mailbox security (MRR-05) | ACC-02 |
| MRR-04 | A Platform Admin with no factors is unrecoverable, or recovered by one person | High | BLOCKED | BG-A; BG-B only with an ADR exception and PRE-05 | MRD-03, MRD-26 | Two-person collusion | ACC-03 |
| MRR-05 | The verified email is the only out-of-band channel; a compromised mailbox weakens IV-2 and hides warnings | Medium | OPEN | Reset refused while suspended (MRR-17); IV-3 + IV-4 at every approval; phone verification later (OD-004 SMS work) | MRD-21, MRD-23 | Medium until a second verified channel exists | ACC-04 |
| MRR-06 | Approver deadlock in small hospitals | Medium | OPEN | Under MRD-13(a) the request waits and expires (no bypass). (b) only through an OD-07 clarification | MRD-13, MRD-07 | Recovery may be impossible in hospitals with fewer than 2 (or 3) eligible admins | ACC-05 |
| MRR-07 | Two colluding approvers | Medium | OPEN | Initiator exclusion, IV-4 binding, attestations, re-validation, abuse thresholds, tier-above notifications | MRD-12, MRD-23, MRD-24 | Inherent to two-person control | ACC-06 |
| MRR-08 | Repeated rejection or cancellation as harassment or DoS | Medium | OPEN | Reasons required; thresholds counting rejections + cancellations; rejecter excluded; two-approver cancel after APPROVED | MRD-12 | Low | — |
| MRR-09 | Non-admin staff can disable 2FA with the password alone and re-enrol, bypassing Q7/R4 (`two-factor.service.ts:191-226`) | Medium | VERIFIED | Staff disable needs a code (spec §13); refused under OD-004 enforcement | MRD-04 (patients) | Low | — |
| MRR-10 | The disable contract change breaks deployed clients | Medium | OPEN | Additive rollout (spec §14.4) | MRD-04 | Low | — |
| MRR-11 | Approvers rubber-stamp attestations | Medium | OPEN | Mandatory method, reference, `reference_matched` and `subject_confirmed_initiation` per approval; sampled retrospective review | MRD-06, MRD-23 | Procedural | ACC-07 |
| MRR-12 | An administrator who loses the authenticator and all codes has no self-service recovery (`two-factor.service.ts:117-128, 191-207, 258-276`) | High (operational) | VERIFIED | This design once delivered; DOC-05 interim runbook | MRD-20 | Unchanged until delivery | ACC-08 |
| MRR-13 | `api_keys.created_by` is not ownership | Low | VERIFIED | MRD-11(a) after OD-003 | MRD-11 | Low (no route accepts keys today, RA-M24.1) | — |
| MRR-14 | Notifications leak state to a mailbox attacker | Low | OPEN | Generic content; no names, codes or counts (spec §6.3, §15) | MRD-06 | Low | — |
| MRR-15 | A cached session lookup serves stale validity | Medium | OPEN | I2; C-12 bound; invalidate on revoke | C-12 | Bounded by C-12 | ACC-01 |
| **MRR-16** | **Interim: the approved last-code policy is unenforced; password + last code gives full ordinary access** (`step-up.service.ts:189`) | High | VERIFIED | MRD-20(b) hardened interim | MRD-20 | Medium under (b); High under (a) | **ACC-09 (required whatever MRD-20 says)** |
| **MRR-17** | **Mailbox-only takeover through password reset, plus a reset that revokes recovery sessions (DoS)** (`password-recovery.service.ts:57-86`) | High | OPEN | Reset refused while suspended; re-issue requires a password that predates the request (spec §11) | MRD-21 | Low under (a) | — |
| **MRR-18** | **An attacker with password + last code locks the owner out** | High | OPEN | Cancel-with-proof (spec §10); `subject_denied` rejection (spec §6.4) | MRD-22, MRD-23 | Owner without the device waits for administrators | ACC-10 |
| **MRR-19** | **Approvers verify the real person but not the session holder** | High | OPEN | Recovery Reference / Handover Code; explicit initiation confirmation (spec §6.4) | MRD-23 | Coercion of the real person | ACC-11 |
| MRR-20 | Stale approvals count after an approver's eligibility ends; a target employment change mid-request | Medium | BLOCKED | Re-validation; OD-12 hooks (spec §7.5); hooks need PRE-03 | MRD-24 | Low once delivered | — |
| MRR-21 | Email-link prefetch, replay or enumeration | Medium | OPEN | POST confirmation; single use; binding; uniform answers (spec §6.3) | MRD-06, MRD-19 | Low | — |
| MRR-22 | A client mis-parses the changed `/auth/otp/recovery` response, or shows a generic error for a new code (VERIFIED: SPA `toAuthError` returns a raw `ApiError` for unknown codes, `frontend/src/api/endpoints/auth.ts:196-213`) | Medium | OPEN | Discriminated response, release order, client unions, regression tests (spec §14) | MRD-27 | Low | — |
| MRR-23 | TOTP replay inside the ±1-step window (~90 s), on cancel-with-proof and on today's login (`totp.service.ts:31, 94`) | Medium | VERIFIED | Step ledger (DB-10) | MRD-28 | Low | — |
| MRR-24 | Suspension state drifts from request state | Medium | OPEN | Single-transaction transitions; CHECKs; sweeper consistency check (spec §9.4) | MRD-08 | Low | — |
| MRR-25 | A recovery token on an ordinary route floods the audit log | Low | OPEN | Sampled or rate-limited refusal audit (spec §15) | — | Low | — |

---

## 1A. Decision status per risk (v1.2.1)

**Mitigation decisions APPROVED (2026-11-13), not implemented:**

| Risks | Governing decision |
|---|---|
| MRR-02, MRR-24 | MRD-08 (a) |
| MRR-03, MRR-11, MRR-21 | MRD-06 |
| MRR-05, MRR-17 | MRD-21 (a) |
| MRR-06 | MRD-13 (a) |
| MRR-07 | MRD-12 + A-12, MRD-23, MRD-24 |
| MRR-08 | MRD-12 + A-12 |
| MRR-10 | MRD-04 |
| MRR-14 | R-1 generic notifications |
| MRR-18 | MRD-22 (a), MRD-23 |
| MRR-19 | MRD-23 (a) |
| MRR-20 | MRD-24; hooks BLOCKED on PRE-03 |
| MRR-22 | MRD-27 (a) |
| MRR-23 | MRD-28 (b) |

**Each of these risks still exists until its mitigation is built.**

| Risk | v1.2.1 status |
|---|---|
| MRR-01, MRR-15 | Policy FINAL (I4, O-13); PRE-01 not authorized; C-12 OPEN |
| MRR-04 | BG-A only (MRD-03); BG-B inactive (CL-1); ≥ 4 Platform Admins operating rule (FD-25 (a)). Still BLOCKED on PRE-03 |
| MRR-09 | VERIFIED; staff scope clarified by FD-21 (every non-patient role), enforcement needs a rollout first; no code change authorized; see NR-3 |
| MRR-12 | VERIFIED; unchanged; DOC-05 runbook not written |
| MRR-13 | MRD-11 (a) after OD-003 |
| **MRR-16** | MRD-20 (b) chosen; **IMP-30 BLOCKED / NOT IMPLEMENTED** (blockers: (1) IMP-01 is an unauthorized prerequisite; (2) no acceptance criteria are defined in spec §17). Severity stays **High** until IMP-30 ships (Medium after) |
| MRR-25 | Unchanged |

## 2. Severity summary

| Severity | Count | IDs |
|---|---:|---|
| High | 9 | MRR-01, 02, 03, 04, 12, 16, 17, 18, 19 |
| Medium | 13 | MRR-05, 06, 07, 08, 09, 10, 11, 15, 20, 21, 22, 23, 24 |
| Low | 3 | MRR-13, 14, 25 |

---

## 3. Acceptance records (all OPEN / NOT ACCEPTED; reviewed individually at design approval, FD-20)

**No residual risk is accepted by this design.** Each record needs, from the owner:

- an accept or reject decision;
- the date;
- any compensating control the owner requires.

| Record | Risk(s) | Residual to accept | Compensating controls proposed | Owner decision |
|---|---|---|---|---|
| ACC-01 | MRR-01, MRR-15 | Session-validity staleness up to the C-12 bound | PostgreSQL authoritative; invalidate on revoke | OPEN — **NOT ACCEPTED** |
| ACC-02 | MRR-03 | Re-issue security rests on password + mailbox + reference/handover | MRD-21(a); MRD-23(a) | OPEN — **NOT ACCEPTED** |
| ACC-03 | MRR-04 | Two colluding Platform Admins, or operators, can recover a Platform Admin | External evidence; retrospective review; notify all Platform Admins | OPEN — **NOT ACCEPTED** (explicitly not accepted, CL-6) |
| ACC-04 | MRR-05 | Single verified channel (email) | IV-3 + IV-4 at approval; future phone verification | OPEN — **NOT ACCEPTED** |
| ACC-05 | MRR-06 | Recovery may be impossible in very small hospitals (under MRD-13(a)) | Escalation notice to Platform Admins (information only) | OPEN — **NOT ACCEPTED** (explicitly not accepted, CL-6) |
| ACC-06 | MRR-07 | Two-person collusion | Audit, thresholds, retrospective review | OPEN — **NOT ACCEPTED** |
| ACC-07 | MRR-11 | Procedural quality of attestations | Sampled review; approver training | OPEN — **NOT ACCEPTED** |
| ACC-08 | MRR-12 | Administrator lockout until delivery | DOC-05 runbook | OPEN — **NOT ACCEPTED** |
| **ACC-09** | **MRR-16** | **The approved last-code policy is unenforced until Phase 21** (High under MRD-20(a), Medium under (b)) | MRD-20(b) | **OPEN — NOT ACCEPTED — required before Gate 2** |
| ACC-10 | MRR-18 | An owner without the device waits for administrator action | Cancel-with-proof for owners with the device; `subject_denied` path | OPEN — **NOT ACCEPTED** |
| ACC-11 | MRR-19 | Coercion of the real account holder | Two independent approvers; abuse thresholds | OPEN — **NOT ACCEPTED** |
| **ACC-12** (new, v1.2.1) | MRD-29 P2 (no MRR yet; P2 is not specified) | The residual of the P2 path once it is specified. Known components: P2 removes the password requirement at session issuance; the initiator delivers the whole Handover Code (jointly with a second independent verifier, FD-19); an insider initiator combined with a compromised mailbox is the main threat (decision package FD-19). **Separately recorded:** the owner's 2026-11-13 decision that users who lose both password and authenticator stay locked out until P2 is approved (finding I-5). That is a design consequence, **not** an acceptance of this record | Three independent people (CL-5); email link required (R-3); joint, audited Handover delivery (FD-19); new password + new authenticator together (CL-5); security expert review authorized (FD-30 / §8) | OPEN — **NOT ACCEPTED**. Created as a record only (FD-19, R-7). P2 DEFERRED |

---

## 4. New risk records NR-1 to NR-8 (added 2026-11-13, FD-17 / owner question 19)

**Source:** `../mfa-recovery-benchmark/MEDORA_BENCHMARK_VALIDATION_AND_GAP_REVIEW.md` §5 (stage-2 review). Code
evidence is at `origin/backend` `452dd006`. The original identifiers and descriptions are preserved.

**Every record is OPEN and NOT ACCEPTED.** The owner's authorization to add a record is not acceptance of it.
None has an ACC record yet. If one is needed, it is decided in the FD-20 individual review.

| ID | Risk (original description) | Severity (pre-mitigation) | Evidence | Related | Related owner decision (2026-11-13) | Status |
|---|---|---|---|---|---|---|
| **NR-1** | Recovery-code guessing has **no account-level failure cap**: per challenge only; password success clears the lockout; IP limiter off by default | Medium | `otp-challenge.service.ts:96-169`; `login.service.ts:191`; `env.schema.ts:375` | MRR-23, R1–R5 | **FD-23 (b)**: account-wide progressive delay + alert, reset only after a successful second factor. **Not implemented**; specification only | OPEN — NOT ACCEPTED |
| **NR-2** | Step-up failure accounting **inconsistent** (re-enrol counts toward lockout; sign-in does not) | Low | `two-factor.service.ts:273-278` | NR-1 | FD-23 (b) (same counter) | OPEN — NOT ACCEPTED |
| **NR-3** | Codes not replaced after use; **non-admin password-only 2FA disable** = downgrade path (all non-admin roles, including staff unless `twoFactorRequired` is on) | Medium | `two-factor.service.ts:191-226`; `login.service.ts:205`, `:219` | OD-004, MRD-04 (ii), MRD-20, MRR-09 | **FD-21**: staff MFA covers every non-patient role, enforcement only after a rollout (no code change authorized). **FD-22**: patients keep password-only disablement (MRD-04 (ii)(a)), and the owner asked for this risk to be recorded, not accepted | OPEN — NOT ACCEPTED |
| **NR-4** | Patient permanent lockout (P-c: authenticator + all codes lost; P-f: email + authenticator / codes lost) | High (availability) | Composition of verified facts (stage-2 §3.1) | MRD-04 | **FD-22**: separate staged patient-recovery track, after legal / privacy review. **FD-19**: temporary lockout when both factors are lost, until P2 (a design consequence, not acceptance) | OPEN — NOT ACCEPTED |
| **NR-5** | Platform Admin lockout below the BG-A quorum; no independent last resort | High | Verified facts + CL-1 | MRR-04, MRR-12, ACC-03 | **FD-25 (a)**: ≥ 4 active Platform Admins (operating rule); sealed individual emergency identities studied later; no shared credentials; BG-B inactive (CL-1) | OPEN — NOT ACCEPTED |
| **NR-6** | No phishing-resistant authenticator, which blocks EPA-2 and conflicts with CISA guidance for privileged users | Medium | No WebAuthn / passkey code (`git grep`) | OD-004, D-8 | **FD-30**: expert review authorized (to arrange); a prerequisite for FD-25's future study | OPEN — NOT ACCEPTED |
| **NR-7** | Alerting is not independent of administrators (outbox only) | Medium | No external alert channel found in the reviewed paths (completeness unverified) | EPA, A-4, A-10 | **FD-27**: AUTHORIZED FOR SPECIFICATION (independent external channel that administrators cannot suppress) | OPEN — NOT ACCEPTED |
| **NR-8** | Misuse of clinical Break-Glass by accounts in recovery or emergency identities | Medium (design-time) | Design analysis; OD-04 not built | OD-04, MRD-08 | **FD-26 (a)**: suspended / in-recovery accounts, administrators and emergency identities excluded; OD-04 is never account recovery; legal review if HIPAA applies | OPEN — NOT ACCEPTED |

**Correction carried with these records (not a risk):** the stage-1 statement "40-bit recovery codes fall below
NIST" is **classification-dependent**.

- In their current role (second-factor look-up secret at sign-in), today's 40-bit codes are not a confirmed
  weakness.
- The 64-bit requirement attaches to a recovery use (R-A); FD-24 handles it, conditionally.

---

## 5. Totals (v1.2.1)

| Records | Count | Status |
|---|---:|---|
| MRR-01 … MRR-25 | 25 | Acknowledged (not accepted); per §1 / §1A |
| NR-1 … NR-8 | 8 | OPEN — NOT ACCEPTED |
| ACC-01 … ACC-12 | 12 | OPEN — NOT ACCEPTED; reviewed individually at design approval (FD-20). ACC-09 required before G2; ACC-03 and ACC-05 explicitly not accepted (CL-6) |
| **Accepted** | **0** | — |
