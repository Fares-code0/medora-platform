# Medora — MFA Recovery: Owner Decisions (v1.2.1)

**Supersedes** `../mfa-recovery-v1.2/MFA_RECOVERY_OWNER_DECISIONS_v1.2.md` (preserved unchanged).

**Recorded:** 2026-11-13. The formal record, with the owner's verbatim answers, is
`../mfa-recovery-v1.2-review/00_OWNER_DECISION_LOG.md`, entries **L-001 to L-005**. This register summarises
those entries. Where the two differ, the log governs.

**Companion:** `MFA_RECOVERY_SECURITY_SPEC_v1.2.1.md` (§ references point there); risks in
`MFA_RECOVERY_OPEN_SECURITY_RISKS_v1.2.1.md`; tasks in `MFA_RECOVERY_IMPLEMENTATION_DEPENDENCIES_v1.2.1.md`.

## Status vocabulary

| Status | Meaning |
|---|---|
| **APPROVED** | Owner decision explicitly confirmed. **Never implies implementation or risk acceptance** |
| **DEFERRED** | The owner explicitly postponed it |
| **OPEN** | Still unresolved |
| **AUTHORIZED FOR SPECIFICATION** | A specification may be written. Nothing may be built |
| **AUTHORIZED FOR IMPLEMENTATION** | Only a specifically approved scope. **Today: none.** IMP-30 is BLOCKED / NOT IMPLEMENTED (L-005) |
| **NOT ACCEPTED** | A residual risk that has not been accepted |
| **IMPLEMENTED** | Verified in source code and tests |

## Naming note

- **R-1…R-8** are the ballot follow-up clarifications from 2026-11-13.
- They are unrelated to the FINAL recovery-code decisions **R1–R5** (2026-11-06, implemented in PR #186).

---

## 1. Decided inputs (FINAL before this round; unchanged)

| Item | Status | Source |
|---|---|---|
| v1.0 policy table (last code, revoke all, recovery session 15 min, request 24 h, dual approval, rejection terminal, disable rule) | APPROVED | Spec v1.0 §1 |
| OD-07 admin hierarchy and Platform Admin remit | APPROVED (FINAL) | `docs/multi-hospital/OWNER_DECISIONS.md` |
| OD-004 staff MFA mandatory, patient MFA optional. **Scope of "staff" clarified 2026-11-13 by FD-21** | APPROVED (FINAL) | Same |
| OD-12; DR-02; OD-04 (clinical Break-Glass, cross-hospital, not built) | APPROVED (FINAL) | Same |
| I2, I4, O-13 (per-request session validation as policy; PRE-01) | APPROVED (FINAL), docs branch only | `OWNER_DECISIONS.md:648-654` |
| Q7 / R4; R1–R5 recovery-code rules | APPROVED (FINAL); **R1–R5 IMPLEMENTED in PR #186** (10 codes × 40 bits, `randomBytes(5)`; keyed HMAC-SHA-256 inside the envelope-encrypted column; single use; count only in `GET /me/2fa`) | `OWNER_DECISIONS.md`; code evidence at `452dd006` |

---

## 2. Decisions MRD-01 to MRD-29

**"Blocks" column:** regenerated mechanically from the v1.2.1 dependency table, transitively (finding **I-2**). It
replaces v1.2's hand-written column, which over-claimed for MRD-01, 02, 06, 11 and 19 and under-claimed for
MRD-04, 17, 21 and 27 (also I-7, I-8). The BG-B clause of IMP-15 is excluded because BG-B is inactive.

| ID | Subject | Owner choice | Status | FD | Blocks (implementation tasks, transitive) |
|---|---|---|---|---|---|
| MRD-01 | Admin tier naming | (a) Platform Admin is the tier above; no Support role | APPROVED | FD-05 | IMP-03, 04, 05, 06, 07, 08, 11c, 12, 13, 14, 15, 18, 19, 20, 21, 22, 23, 24, 26, 29 (via DB-01, I-3) |
| MRD-02 | Interim mapping of `admin` | (a) None; wait for PRE-03 | APPROVED | FD-05 | IMP-04, IMP-14 |
| MRD-03 | Platform Admin recovery | BG-A only; BG-B not activated | APPROVED (BG-A); BG-B inactive | FD-13 | IMP-15 |
| MRD-04 | Patient policy | (i)(a) out of scope; (ii)(a) password-only disable | APPROVED. Patient recovery is a separate track (FD-22) | FD-14 | IMP-10, 11b, 17, 27 |
| MRD-05 | Tenant for non-doctor staff | (a) one active employment | APPROVED | FD-05 | Same 20 tasks as MRD-01 (via PRE-03) |
| MRD-06 | Identity-verification procedure | Approve by sub-item: 6.A, 6.B, 6.C(i), 6.D, 6.E approve; 6.C(ii) conditional under A-5; 6.C(iii) callback removed | APPROVED | FD-01 | IMP-04, 08, 11c, 13, 14, 15, 20, 23 (I-7: not IMP-05, 06, 07) |
| MRD-07 | Initiator as approver | (a) No: three people. Initiation needs `accounts.approveMfaRecovery` (CL-4) | APPROVED | FD-04 | IMP-23 |
| MRD-08 | Suspension lifecycle | (a) as spec §9 | APPROVED | FD-07 | IMP-04, 06, 07, 13, 14, 18, 19, 21, 23, 24, 29 |
| MRD-09 | User self-cancel | (a) any time | APPROVED | FD-07 | IMP-24 |
| MRD-10 | Status-only re-issue while pending | (a) No | APPROVED | FD-07 | IMP-13 |
| MRD-11 | API keys at recovery start | (a) owned keys once OD-003 exists | APPROVED | FD-12 | None in the table. The future API-key step of IMP-04 needs DB-08 (I-8: v1.2 wrongly listed IMP-04) |
| MRD-12 | Rejection, cancellation, abuse | Amended by A-12 (single-approver security cancellation); R-8 | APPROVED (as amended) | FD-06 | IMP-08, 11c, 15, 23 |
| MRD-13 | Platform Admin authority over staff recovery | (a) Hospital Admins only (R-2) | APPROVED | FD-05 | IMP-08, 11c, 15, 23 |
| MRD-14 | 24 h scope | (a) the whole request | APPROVED | FD-07 | 19 tasks (IMP-04…08, 11c, 12…15, 18…24, 26, 29) |
| MRD-15 | No ordinary session at completion | (a) yes | APPROVED | FD-07 | IMP-06 |
| MRD-16 | Lost authenticator, codes remaining | R-A, with R-B as an option. R-A needs ≥ 64-bit codes first (FD-24, conditional) | APPROVED | FD-08 | IMP-04, 06, 07, 09, 13, 14, 18, 19, 21, 23, 24, 29 |
| MRD-17 | Permission identifiers | As proposed (`accounts.*`) | APPROVED | FD-04 | IMP-08, 11a, 11c, 15, 23 |
| MRD-18 | R3 email onto the outbox | Yes | APPROVED | FD-11 | IMP-04, 12, 14, 21 |
| MRD-19 | Numeric limits | As listed | APPROVED | FD-07 | IMP-04, 06, 08, 11c, 13, 14, 15, 20, 21, 23 (I-9: now named by IMP-20) |
| MRD-20 | Interim period | (b) Hardened Interim, with generic messages (R-1). **ACC-09 OPEN, NOT ACCEPTED** | APPROVED | FD-15, FD-18 | IMP-30 |
| MRD-21 | Password reset during recovery | (a) refuse while suspended | APPROVED. Known gap I-5 (both factors lost) remains until P2 | FD-08 | IMP-13, 14, 18 |
| MRD-22 | Cancel-with-proof | (a) public cancel-with-proof | APPROVED | FD-08 | IMP-21 |
| MRD-23 | Approver-to-holder binding | (a) Recovery Reference + Handover Code; 23.A, 23.B, 23.C (CL-3), 23.D | APPROVED | FD-02, FD-03 | IMP-04, 08, 11c, 13, 14, 15, 20, 23 |
| MRD-24 | Approval re-validation | Accept | APPROVED | FD-06 | IMP-06, 08, 11c, 15, 22, 23 |
| MRD-25 | Residual-risk acceptance | Defer; **review ACC-01…ACC-12 individually at design approval (FD-20 (a))** | **DEFERRED** (process APPROVED) | FD-20 | None (gates G2) |
| MRD-26 | BG-B evidence store | Defer BG-B until PRE-05; **BG-B stays inactive even after PRE-05** (CL-1) | **DEFERRED** | FD-13 | None (BG-B inactive) |
| MRD-27 | `/auth/otp/recovery` contract | (a) discriminated 200 | APPROVED | FD-10 | IMP-04, 07, 14, 25, 26, 27 |
| MRD-28 | TOTP replay scope | (b) every TOTP verification, including patient sign-in (CL-9) | APPROVED | FD-09 | IMP-21, 28 |
| MRD-29 | Password and authenticator both lost | P2 preferred (CL-5). **Excluded from the first design approval**; P2 handover jointly by the initiator and a second independent verifier (FD-19); email link required (R-3); ACC-12 created (record only) | **OPEN** (P2 DEFERRED) | FD-19 | None (no P2 task until specified) |

**Counts:**

| Status | Count | IDs |
|---|---:|---|
| APPROVED | 26 | MRD-01 to MRD-24, MRD-27, MRD-28 |
| DEFERRED | 2 | MRD-25, MRD-26 |
| OPEN | 1 | MRD-29 |

---

## 3. Final decision package FD-01 to FD-31

| FD | Subject | Status (2026-11-13) | Authorizes |
|---|---|---|---|
| FD-01 … FD-16 | Chat-confirmed decisions (MRD answers above, A-1 to A-13, CL-1, CL-3 to CL-9, CL-2, R-1 to R-5, R-8, findings, MRR acknowledgement) | **APPROVED** (recorded verbatim, L-001 / L-002) | Documentation only |
| FD-17 | Recording and v1.2.1 | **APPROVED**: record FD-01 to FD-16; prepare v1.2.1 | Documentation |
| FD-18 | IMP-30 vs G2 | **APPROVED (b)**: carve IMP-30 out of G2; ACC-09 OPEN, NOT ACCEPTED | Carve-out recorded. **IMP-30 BLOCKED / NOT IMPLEMENTED**: the owner's scope correction (L-005) says do not implement IMP-30 or IMP-01; blockers: (1) IMP-01 is an unauthorized prerequisite; (2) no acceptance criteria are defined in spec §17 |
| FD-19 | P2 | **APPROVED**: P2-only joint handover; no split code; P2 excluded from first approval; temporary lockout when both factors are lost, until P2; ACC-12 created as a record only | Documentation; MRD-29 stays OPEN |
| FD-20 | Risk acceptance process | **APPROVED (a)**: ACC-01 to ACC-12 reviewed individually at design approval | Process only; **no risk accepted** |
| FD-21 | Staff MFA scope | **APPROVED**: every non-patient role; rollout / grace period required first | Policy only; **no code change** |
| FD-22 | Patient recovery | **APPROVED (direction)**: staged email + password + cooling-off (24–72 h illustrative) with cancellation and notifications, later clinic re-proofing; separate track; legal / privacy review required; MRD-04 (ii)(a) kept; risk NR-3 NOT ACCEPTED | Specification of a separate patient track, after legal / privacy review |
| FD-23 | Second-factor throttling | **APPROVED (b)**: account-wide progressive delay and alert; reset only on a successful second factor; **not implemented**; no per-IP enforcement without separate verification and authorization | Specification |
| FD-24 | Recovery-code length | **APPROVED (a)**: ≥ 64-bit new sets before R-A is built, conditional on primary NIST verification | Nothing now |
| FD-25 | Platform Admin capacity | **APPROVED (a)**: ≥ 4 active Platform Admins (interim operating rule); sealed individual emergency identities studied later after prerequisites; no shared credentials | Operating policy; study only |
| FD-26 | Clinical continuity | **APPROVED (a)**: covering clinician + approver rota; suspended / in-recovery accounts, administrators and emergency identities excluded; OD-04 is never account recovery; legal review if HIPAA applies | Procedure |
| FD-27 | Independent alerting | **AUTHORIZED FOR SPECIFICATION**: external channel for recovery, emergency and BG-A events; administrators cannot suppress it | Specification only |
| FD-28 | Session revocation | Already FINAL (I4 / O-13); C-12 OPEN elsewhere; ACC-01 NOT ACCEPTED | — |
| FD-29 | Jurisdiction and target | **Jurisdiction OPEN** (Option D: not determined; multiple markets possible; nothing assumed). **Target APPROVED: NIST SP 800-63B-4 at AAL2, as a design target only**; no conformance, certification or compliance claim; primary-source and expert / legal review first. Not applied to patient recovery | Target statement only |
| FD-30 | Authentication policy review (SMS, lifetimes, passkeys) | **Expert review AUTHORIZED** (to arrange); OD-004 / OD-005 unchanged | Arranging review |
| FD-31 | Video identity assurance | **Expert review AUTHORIZED** (to arrange); A-5 condition stands | Arranging review |

---

## 4. Clarifications CL-1 to CL-9 and R-1 to R-8

| ID | Recorded content | Status |
|---|---|---|
| CL-1 | BG-B inactive even after PRE-05 unless MRD-03 is decided again; PRE-05, DB-11, BG-B part of IMP-15 not built | APPROVED |
| CL-2 | MRD-20 (b) Hardened Interim; ACC-09 not accepted | APPROVED |
| CL-3 | Handover Code conditions; **the initiator delivers the whole code; no split-code design** | APPROVED |
| CL-4 | Initiation permission and safeguards | APPROVED |
| CL-5 | P2 the preferred direction under controls; MRD-29 OPEN; separate acceptance record | APPROVED (direction); MRD-29 OPEN |
| CL-6 | Minimum headcounts noted; ACC-03 and ACC-05 NOT ACCEPTED; no BG-B fallback | APPROVED |
| CL-7 | Dual approval scope (not R-A or cancel-with-proof; no suspension bypass) | APPROVED |
| CL-8 | Correct I-1 to I-9 in v1.2.1 | APPROVED; **done in v1.2.1** |
| CL-9 | MRD-28 (b) includes patient sign-in; patient-app regression tests in future scope | APPROVED |
| R-1 | Generic notifications; count only in 2FA settings | APPROVED |
| R-2 | Platform Admins recover Hospital Admins (§7.2 / OD-07); not staff (MRD-13 (a)) | APPROVED |
| R-3 | Email link required in P2 | APPROVED (applies when P2 is specified) |
| R-4 | Administrator-mediated path and P2: email request reference + Handover Code; Recovery Reference = last-code path | APPROVED |
| R-5 | Lost Handover Code: cancel the request and start a new one | APPROVED |
| R-6 | The G2 / ACC-09 circular gate | **Resolved by FD-18 (b)** |
| R-7 | ACC-12 for P2 | **Resolved by FD-19**: created as a record only, NOT ACCEPTED |
| R-8 | Initiator: security cancellation only; never approves; counts toward abuse thresholds | APPROVED |

---

## 5. Amendments A-1 to A-13

**All APPROVED individually** (ballot 2026-11-13; validated in the CL round; recorded L-001). Text: ballot v1.2
§"PROPOSED amendments". Incorporated: spec v1.2.1 §0A.3.

**Limitation:** A-2's clause on "the newly set [password] on the MRD-29 P2 path" is **not in force** while P2 is
DEFERRED.

---

## 6. Findings I-1 to I-9: disposition in v1.2.1

| ID | Finding (from `01_INITIAL_VERIFICATION.md` §3) | Disposition |
|---|---|---|
| I-1 | Dependency cycle IMP-08 ⇐ DB-04 ⇐ IMP-11 ⇐ IMP-08 | **Corrected.** IMP-11 split into IMP-11a (capability union, before DB-04), IMP-11b (disable field) and IMP-11c (screens, after IMP-08). DB-04 ⇐ IMP-11a. Mechanical cycle check: none |
| I-2 | Register "Blocks" disagreed with the dependency table | **Corrected.** §2 "Blocks" column regenerated from the v1.2.1 table |
| I-3 | MRD-01 named by no task, though DB-01, IMP-08 and IMP-15 depend on the tier model | **Corrected.** MRD-01 added to DB-01, IMP-08 and IMP-15 |
| I-4 | Approving MRD-06 "as written" would silently approve MRD-23 (a) | **Resolved.** Both decided item by item (L-001); the spec states it (§6) |
| I-5 | Forgotten password + lost authenticator has no way forward (invariant 12) | **Not corrected: documented limitation.** It can only be fixed by MRD-29 P2, which is DEFERRED. The owner's 2026-11-13 decision records temporary lockout until P2 (spec §11, §19). Correcting it otherwise would invent policy |
| I-6 | MRD-20 (b) "message to the user" vs MRD-27 response shape | **Resolved by R-1.** The message is a generic email / in-app notification through existing paths; no response-shape change; count only in settings (spec §3) |
| I-7 | MRD-06 over-claimed IMP-05, 06, 07 | **Corrected** (§2) |
| I-8 | MRD-11 claimed IMP-04 | **Corrected** (§2) |
| I-9 | MRD-19 not named by IMP-20 | **Corrected.** IMP-20 now depends on MRD-19 |

---

## 7. Carried, owned elsewhere

| Item | Status |
|---|---|
| C-12 (cache staleness bound for PRE-01) | OPEN, project register |
| Recovery ADR number | Allocated at DOC-01 after checking every branch's register (CLAUDE.md) |
| Repository `OWNER_DECISIONS.md` (DOC-02) | Not updated: that is a repository change, not authorized by this round |
