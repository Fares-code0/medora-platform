# Medora — MFA Recovery: v1.2 → v1.2.1 Changelog

**Date:** 2026-11-13.

**Authority:** the owner's explicit decisions of 2026-11-13, recorded in
`../mfa-recovery-v1.2-review/00_OWNER_DECISION_LOG.md` (L-001 to L-005).

**v1.2 is preserved unchanged** in `../mfa-recovery-v1.2/`; its SHA-256 hashes were checked before and after.

**No repository file, schema, migration, contract, branch or commit was changed.**

## 1. Files

| v1.2.1 file | Derived from | Nature of change |
|---|---|---|
| `MFA_RECOVERY_SECURITY_SPEC_v1.2.1.md` | Spec v1.2 | New §0A (decisions in force) and §18–§19; decided statuses in place of OPEN; amendments incorporated; conflicts noted |
| `MFA_RECOVERY_OWNER_DECISIONS_v1.2.1.md` | Register v1.2 | Rewritten as a record of decisions: MRD-01…29, FD-17…31, CL, R, A, I dispositions |
| `MFA_RECOVERY_OPEN_SECURITY_RISKS_v1.2.1.md` | Risks v1.2 | §1A decision status; ACC rows marked NOT ACCEPTED; ACC-12 and NR-1…NR-8 added |
| `MFA_RECOVERY_IMPLEMENTATION_DEPENDENCIES_v1.2.1.md` | Dependencies v1.2 | I-1, I-3, I-9 corrections; IMP-30 BLOCKED / NOT IMPLEMENTED; CL-1 "not to be built"; order regenerated |
| `MFA_RECOVERY_COMPATIBILITY_MATRIX_v1.2.1.md` | Matrix v1.2 | IMP-11 references split; rows 8.08, 8.27, 8.28, 8.32 and 8.33 updated |
| `IMP-30_INTERIM_HARDENING_SCOPE_RECORD.md` | New | IMP-30 scope, affected code, proposed (unapproved) acceptance criteria, two blockers; BLOCKED / NOT IMPLEMENTED |
| `MFA_RECOVERY_V1.2.1_CHANGELOG.md` | New | This file |

## 2. Decisions recorded (status vocabulary per the decision log)

| Group | Items | Recorded status |
|---|---|---|
| Strategic direction (Group 1) | 6 points | APPROVED |
| MRD | MRD-01 to MRD-24, MRD-27, MRD-28 | APPROVED |
| MRD | MRD-25, MRD-26 | DEFERRED |
| MRD | MRD-29 | OPEN (P2 DEFERRED from the first design approval) |
| Amendments | A-1 to A-13 | APPROVED individually (A-2's P2 clause not in force) |
| Clarifications | CL-1 to CL-9; R-1 to R-5, R-8 | APPROVED; R-6 resolved by FD-18; R-7 resolved by FD-19 |
| FD-17 to FD-26 | Recording; IMP-30 carve-out; P2; risk process; staff scope; patient track; throttling; code length; Platform Admin capacity; clinical continuity | APPROVED |
| FD-18 | IMP-30 | Carve-out from G2 recorded; **BLOCKED / NOT IMPLEMENTED** (owner scope correction L-005: IMP-01 unauthorized; no §17 acceptance criteria) |
| FD-27 | External alerting | AUTHORIZED FOR SPECIFICATION |
| FD-29 | NIST SP 800-63B-4 AAL2 | **Design target only**; jurisdiction OPEN (not determined) |
| FD-30, FD-31, §8 | Expert review | AUTHORIZED to arrange; **not yet held** |

## 3. Findings I-1 to I-9

| ID | Change |
|---|---|
| I-1 | IMP-11 → IMP-11a / 11b / 11c; DB-04 ⇐ IMP-11a; cycle check passes |
| I-2 | Register "Blocks" regenerated from the dependency table |
| I-3 | MRD-01 added to DB-01, IMP-08, IMP-15 |
| I-4 | MRD-06 and MRD-23 decided item by item |
| I-5 | **Documented limitation, not corrected** (needs P2; temporary lockout recorded as a decision consequence) |
| I-6 | Resolved by R-1 (generic message; no response-shape change) |
| I-7 | MRD-06 no longer claims IMP-05, 06, 07 |
| I-8 | MRD-11 no longer claims IMP-04 |
| I-9 | IMP-20 names MRD-19 |

## 4. Risks

| Change | Detail |
|---|---|
| Added | ACC-12 (P2 residual) and NR-1 to NR-8, **records only** |
| Status | **Every ACC record NOT ACCEPTED**: ACC-09 required before G2; ACC-03 and ACC-05 explicitly not accepted |
| Process | FD-20: ACC-01 to ACC-12 reviewed individually at design approval |
| **Accepted** | **0** |

## 5. Conflicts recorded rather than silently resolved

Spec §19 records each of these:

- v1.2 §3 "no codes remain" message vs R2 / R-1;
- CL-3 vs CL-5 on P2;
- the "temporary lockout accepted" wording vs FD-20;
- OD-004 vs code;
- IMP-30's IMP-01 dependency;
- extract-only NIST evidence.

## 6. Correction carried from the stage-2 review

Today's 40-bit recovery codes are **not** recorded as a weakness in their current second-factor look-up role. The
64-bit requirement is tied to the future R-A use (FD-24, conditional on primary NIST verification).

## 7. New fact surfaced while scoping IMP-30 (read-only)

`auth.recovery_code_used` is already classified `warning` (`audit-taxonomy.ts:117` at `452dd006`), with
`remaining` in its metadata (`step-up.service.ts:176`). v1.2 §3 did not note this. It bears on IMP-30's proposed
criterion AC-3.
