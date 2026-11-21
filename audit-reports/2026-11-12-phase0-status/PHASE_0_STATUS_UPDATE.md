# Medora RS-1 — Phase 0 Status Update

| | |
| --- | --- |
| Date | 2026-11-12 |
| Measured against | `origin/main` `726f1cbf`, `origin/frontend` `c20cf560`, `origin/backend` `452dd006`, `origin/patient-app` `bb80009b` (fetched 2026-11-12) |
| Nature | Status record. It does not change any earlier report; it records what has changed since they were written |
| Supersedes | Nothing. Read it alongside the dated reports in `2026-11-09-full-system-audit/`, `2026-11-10-post-audit-strategy/` and `2026-11-10-rs1-implementation/` |
| **Phase 0 status** | **Not complete.** The roadmap's exit criteria are not met (§4) |
| **Phase 1** | **Not started.** It is backend, database, operations and security work. The current authorisation is frontend-only, so Phase 1 is outside it |

## 1. How to read the earlier reports

The reports dated 2026-11-09 and 2026-11-10 are historical records. They describe the repository as it
was when each one was written, and they are published unchanged in substance. Statements such as
"#212 is open", "MED-SEC-014 is not on `main`" or "the OTP fix is not on `main`" were true on their
date and are superseded by §2 below. The earlier reports were not edited to reflect later events.

**Local paths were replaced before publication.** Machine-specific paths in the historical reports were
replaced with neutral placeholders. Only the path text changed; findings, dates and conclusions did not.

| Placeholder | Stands for |
| --- | --- |
| `<repo-root>` | The local clone of this repository |
| `<backup-root>` | The directory outside the repository that held the Phase 0 backups (the backup set names after it are unchanged) |
| `<worktrees>` | The directory outside the repository that held the temporary Git worktrees (the worktree names after it are unchanged) |
| `<node-runtimes>` | The directory where the Node 22 runtime was installed beside the system Node |
| `<local-env>` | The scratch directory holding a copy of the backend compose file |
| `<session-scratchpad>` | The agent session's temporary directory, where command logs were written |

**Security-sensitive content was excluded before publication.** Where a published report
described how a security weakness works or where it is, that passage was removed and
replaced with one of two fixed notices: *[Withheld from the published copy:
security-sensitive content.]* in text, or *[withheld: security-sensitive]* in a table cell.
Finding IDs, severities and statuses were kept. Nothing was reworded.

Six reports from the same series are **not published** because they could not be
published safely without changing their meaning. They are held for the owner's review:

- `2026-11-09-full-system-audit/SECURITY_AND_PRIVACY_AUDIT.md`
- `2026-11-09-full-system-audit/RELEASE_READINESS_CHECKLIST.md`
- `2026-11-09-full-system-audit/REMEDIATION_ROADMAP.md`
- `2026-11-10-post-audit-strategy/MASTER_REMEDIATION_BACKLOG.md`
- `2026-11-10-post-audit-strategy/POST_AUDIT_STRATEGY.md`
- `2026-11-10-post-audit-strategy/RELEASE_GATES.md`

Published reports still refer to them by name. Those references point to documents that
are not in this repository.

## 2. What has changed since the last report (2026-11-10)

| Item | Earlier record said | Status on 2026-11-12 | Evidence |
| --- | --- | --- | --- |
| PR #212 (EMR visual redesign; Reception owns Queue and Waiting Room) | Open (closure report) | **Merged** into `frontend` 2026-11-10 18:41 UTC | merge commit `f4631b9a` |
| PR #219 (MED-SEC-014 frontend: session isolation and worklist data protection) | Not yet written | **Merged** into `frontend` 2026-11-11 20:54 UTC. **On `frontend` only — not on `main`** | merge commit `b8791384`; head `0b52a06b` is not an ancestor of `origin/main` |
| PR #220 (promote `backend` to `main`) | MED-SEC-014 and the 10-minute OTP "not on `main`" | **Merged** into `main` 2026-11-12 06:48 UTC. The backend MED-SEC-014 fix `e3dbe9bf` and the absolute 10-minute OTP lifetime are now on `main` | merge commit `726f1cbf`; `e3dbe9bf` is an ancestor of `origin/main`; `OTP_CHALLENGE_TTL_SECONDS = 10 * 60` on `main` |
| PR #221 (Waiting Room mobile layout; Theme Playground test stability) | Not yet written | **Merged** into `frontend` 2026-11-12 09:17 UTC | merge commit `99055738` |
| PR #222 (System Logs responsive horizontal scrolling) | Not yet written | **Merged** into `frontend` 2026-11-12 10:17 UTC. **On `frontend` only — not on `main`; not deployed** | merge commit `c20cf560`; head `7f3ea53e` |

### Integration is not deployment

PR #220 put the backend MED-SEC-014 fix on `main`. That is **branch integration only**:

- **Not deployed.** No environment has been verified to run it, and no deployment was performed or authorised by this work.
- **Frontend half not on `main`.** That half (PR #219) is on `frontend` only.
- **Not runtime-verified on `main`.** Runtime evidence for the fix is its e2e regression spec passing in CI on the `backend` lineage. No runtime verification on `main`, and none in any hosted environment, is recorded.

**MED-SEC-014 is therefore not operationally closed.** It should stay a release blocker for any
environment that could hold real patient data until it is deployed and verified there.

No migration was executed and no deployment was triggered by the work this report records.

## 3. Phase 0 tasks — current position

| Task | Position on 2026-11-12 |
| --- | --- |
| R-GIT-01 Protect the uncommitted working tree in slices | **Done** — slices committed and merged (#208–#212) |
| R-GIT-02 Re-measure remotes | **Done** (2026-11-10); counts re-measured here (§4) |
| R-GIT-03 Owner-decision record on `main` | **Partly done** — `docs/multi-hospital/OWNER_DECISIONS.md` is on `main`; the A3 annotation (OTP five minutes superseded by ten) is on an unmerged branch and needs owner confirmation |
| R-GIT-04 Promote `backend` to `main` | **Done** (#220); `backend` is 0 commits ahead of `main` |
| R-GIT-05 Consolidate the OTP-lifetime branches | **Done** (#207), and now on `main` via #220 |
| R-GIT-06 Promote `frontend` to `main` | **Not done** — `frontend` is 6 ahead, 38 behind `main` |
| R-GIT-07 Promote `patient-app` to `main` | **Not done** — `patient-app` is 22 ahead, 478 behind `main` |
| R-GIT-08 to R-GIT-10 Re-sync branches, adopt the branch model, verify protection | **Not done** |
| R-QA-01 Disposable integration environment | **Not verified** |
| R-QA-02 Pin one Node runtime | **Not done** — CI runs Node 20; local verification used Node 22; the frontend suite has a known failure on Node 24 (`NewMedicalRecordPage`, a jsdom `AbortSignal` incompatibility) |
| R-QA-03 Honest required CI check | **Not done** |
| R-QA-04 Portable backend specs | **Partly done** (#209) |
| R-QA-05 Baseline every suite on the reconciled trunk | **Not done** — depends on R-GIT-06/07 |
| R-QA-06 Failing tests first | **Partly** — an e2e regression spec exists for MED-SEC-014; the others are not verified here |
| R-DOC-01 README | **Not done** — `README.md` on `main` last changed 2026-09-02 |
| R-DOC-02 `CLAUDE.md` branch table and ADR facts | **Not done** |

## 4. Remaining Phase 0 blockers

| Blocker | Dependency |
| --- | --- |
| `frontend` promotion to `main` (R-GIT-06) | Owner authorisation; it carries #219, #221 and #222 |
| `patient-app` promotion (R-GIT-07) | Owner authorisation; R-QA-02 |
| Branch reconciliation and protection (R-GIT-08 to R-GIT-10) | The promotions; repository-admin access for protection |
| Owner record A3 annotation (R-GIT-03) | Owner confirmation |
| Test environment, Node pinning, CI reliability (R-QA-01 to R-QA-03) | Authorisation for Docker and CI changes |
| README and `CLAUDE.md` refresh (R-DOC-01, R-DOC-02) | Best done after the promotions, so the facts are final |
| Hosting (D-7) and backup verification | Hosting: owner decision, last recorded as PENDING — **not re-verified for this report**. Backups: **not re-verified for this report** |
| Full-suite load-timeout reliability | The frontend suite intermittently times out 1–3 tests under parallel load (a different set each run; each passes in isolation). Planned as R-QA-07 (roadmap Phase 5) |

Exit criteria from `IMPLEMENTATION_ROADMAP.md` §1 that are **not met**:

- `backend`, `frontend` and `patient-app` at `0 0` against `main`;
- full suite green on the trunk on Node 22 with zero unexplained failures.

## 5. What this report does not claim

- Nothing in it was deployed or migrated.
- It does not verify hosting, backups, production configuration or any hosted environment.
- It does not mark MED-SEC-014 closed (§2).
- It does not mark Phase 0 complete.
