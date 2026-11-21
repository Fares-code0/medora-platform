# Branch audit and cleanup — 2026-09-08

Measured at `main` = `fff93bf`, `patient-app` = `357eb57`. Every branch was
audited by **commit ancestry and file content**, never by name, date or PR
state alone. The read-only audit completed before anything was deleted.

## Method

Three independent proofs were used, in this order:

1. **Ancestry** — `git merge-base --is-ancestor origin/<branch> origin/<survivor>`.
   A branch that is a strict ancestor carries, by definition, zero unique
   commits. This cleared 46 branches.
2. **Patch equivalence** — `git cherry` against the survivor, to catch work that
   reached the survivor as a rebase, cherry-pick or squash with a different SHA.
   Zero `+` lines for all 46 ancestor-proven branches.
3. **Content comparison** — blob-hash equality per file, plus a field-level diff
   of the shared checklist. This was needed for the three branches whose pull
   request was *closed* rather than merged, and is the only thing that proved
   them redundant.

Ahead/behind counts were deliberately **not** used as a deletion criterion.
"Behind `main`" is normal for an integration branch and is not a defect.

## Summary

| Category | Count |
| --- | ---: |
| Total remote branches audited | 59 |
| Protected / important — KEEP | 9 |
| Unique unmerged work — KEEP | 1 |
| Safe to delete (ancestry-proven) | 46 |
| Safe to delete (superseded, content-proven) | 3 |
| Manual review required | 0 |
| Stale but kept | 0 |

There were **no open pull requests** at audit time, so no branch carried an
active PR dependency.

## 1. KEEP — protected and important

| Branch | Role | Why it stays |
| --- | --- | --- |
| `main` | Default, protected | Production/integration trunk |
| `frontend` | Integration | Doctor/admin SPA domain branch |
| `backend` | Integration | Backend domain branch |
| `Database` | Integration | Database domain branch — **also holds unique work** (below) |
| `Ai` | Integration | AI/ML domain branch |
| `patient-app` | Integration | Patient mobile branch (ADR-032); 106 commits ahead of `main` |
| `archive/Ai-orphan-37fe5b0` | Archive | Orphan history, no common ancestor with `main` |
| `archive/backend-orphan-37fe5b0` | Archive | Orphan history, no common ancestor with `main` |
| `archive/frontend-orphan-37fe5b0` | Archive | Orphan history, no common ancestor with `main` |

`frontend`, `backend` and `Ai` all currently point at `3f0436e` and are strict
ancestors of `main` — fully merged down, 25 behind. That is the healthy resting
state for an integration branch, not a reason to delete one.

`Database` is **not** an ancestor of `main`: it carries `f8c9b76`, which adds
`database/schema.sql`, `database/medora.dbml` and `database/seed.sql` — 3,717
lines that exist nowhere else. PR #94 was closed unmerged. `schema.sql` still
has the documented ordering defect (`patient_medications` references
`prescriptions` ~570 lines before it is created), so the file must be fixed
before `database/` is proposed to `main` again. The branch is the only copy.

The three `archive/*` branches all point at `37fe5b0` and contain only
`.gitignore` and `README.md`. They have **no common ancestor with `main`**, so
the ancestor test can never clear them — which is exactly why they are the only
surviving reference to the pre-2026-08-27 orphan history. Do not delete them.

## 2. KEEP — unique unmerged work

### `claude/medora-dev-auth-access-gz7soi`

- **Tip:** `f3edb3c` (2026-09-06) · 3 ahead of `main`, 8 behind
- **PR:** #109 merged an *earlier* state of this branch; two commits were pushed
  afterwards and have never been merged anywhere.
- **Unique commits:**
  - `dd3c30b` chore(frontend): give the Vercel build a working environment
  - `f3edb3c` fix(frontend): make the demo-access stub unconditional, and assert it ran
- **Why it matters:** it removes the `mode === 'production'` condition from the
  demo-access Vite plugins because the deployment host disagreed about the mode
  and the demo sign-in shipped to production. The stub now records what it
  replaced and the scan **fails the build** when that record is empty. `main`
  still carries the conditional version, so this is an unshipped fix for a leak
  that has already recurred twice.
- **Verdict: KEEP.** All four touched files differ from `main`.

## 3. SAFE TO DELETE — work fully integrated

Risk assessment **LOW** for every entry: unique commits remaining = **0**,
verified twice (ancestry + `git cherry`).

| Branch | Merged into | Pull request |
| --- | --- | --- |
| `claude/fix-frontend-production-mock-guard` | `main` | #102 MERGED → main |
| `claude/medora-auth-refactor-e7aq7m` | `main` | #111/#112/#113 MERGED → main |
| `claude/medora-git-cleanup-xwuq7w` | `main` | #104 MERGED → main |
| `claude/medora-mobile-next-task-3myifr` | `main` | #103 MERGED → patient-app |
| `claude/patient-app-A-08-datetime-coverage` | `patient-app` | #141 MERGED → patient-app |
| `claude/patient-app-D-06-entry-auth-screens` | `patient-app` | #145 MERGED → patient-app |
| `claude/patient-app-E-02-durable-preferences` | `patient-app` | #129 MERGED → patient-app |
| `claude/patient-app-E-04-permission-rows-accuracy` | `patient-app` | #151 MERGED → patient-app |
| `claude/patient-app-F-01-home-screen-tests` | `patient-app` | #138 MERGED → patient-app |
| `claude/patient-app-G-02-doctor-pagination` | `patient-app` | #128 MERGED → patient-app |
| `claude/patient-app-I-08-action-conflict-recovery` | `patient-app` | #144 MERGED → patient-app |
| `claude/patient-app-J-02-health-records-tests` | `patient-app` | #148 MERGED → patient-app |
| `claude/patient-app-J-06-release-state-tests` | `patient-app` | #142 MERGED → patient-app |
| `claude/patient-app-M-05-thread-screen-tests` | `patient-app` | #143 MERGED → patient-app |
| `claude/patient-app-O-02-unread-tab-badge` | `patient-app` | #127 MERGED → patient-app |
| `claude/patient-app-P-03-edit-profile-tests` | `patient-app` | #146 MERGED → patient-app |
| `claude/patient-app-P-08-profile-screen-tests` | `patient-app` | #137 MERGED → patient-app |
| `claude/patient-app-R-05-error-boundary-tests` | `patient-app` | #135 MERGED → patient-app |
| `claude/patient-app-S-08-rtl-verification` | `patient-app` | #132 MERGED → patient-app |
| `claude/patient-app-S-09-a11y-audit` | `patient-app` | #133 MERGED → patient-app |
| `claude/patient-app-U-06-feature-state-tests` | `patient-app` | #131 MERGED → patient-app |
| `claude/patient-app-U-10-coverage-reporting` | `patient-app` | #134 MERGED → patient-app |
| `claude/patient-app-W-01-app-identity` | `patient-app` | #130 MERGED → patient-app |
| `claude/patient-app-W-12-documentation-sweep` | `patient-app` | #136 MERGED → patient-app |
| `claude/patient-app-auth-screens-coverage` | `patient-app` | #139 MERGED → patient-app |
| `claude/patient-app-bundle-budget` | `patient-app` | #126 MERGED → patient-app |
| `claude/patient-app-deprecation-header` | `patient-app` | #115 MERGED → patient-app |
| `claude/patient-app-docs-reconciliation` | `patient-app` | #121 MERGED → patient-app |
| `claude/patient-app-forced-upgrade-gate` | `main` | no PR — merged directly (W-06) |
| `claude/patient-app-form-focus-order` | `main` | #107 CLOSED (wip) — merged directly instead |
| `claude/patient-app-group-a-render-coverage` | `patient-app` | #152 MERGED → patient-app |
| `claude/patient-app-http-auth-adapter-tests` | `patient-app` | #140 MERGED → patient-app |
| `claude/patient-app-i18n-foundation` | `patient-app` | #122 MERGED → patient-app |
| `claude/patient-app-live-appointment-reads` | `patient-app` | #118 MERGED → patient-app |
| `claude/patient-app-live-doctor-discovery` | `patient-app` | #117 MERGED → patient-app |
| `claude/patient-app-live-notifications` | `patient-app` | #119 MERGED → patient-app |
| `claude/patient-app-live-profile-read` | `patient-app` | #120 MERGED → patient-app |
| `claude/patient-app-onboarding-carousel` | `patient-app` | #123 MERGED → patient-app |
| `claude/patient-app-optimistic-updates` | `main` | no PR — merged directly (R-07) |
| `claude/patient-app-phi-app-switcher-privacy` | `main` | no PR — merged directly (T-09) |
| `claude/patient-app-recently-viewed` | `main` | #108 MERGED → main |
| `claude/patient-app-release-runbook` | `patient-app` | #125 MERGED → patient-app |
| `claude/patient-app-store-privacy` | `patient-app` | #124 MERGED → patient-app |
| `claude/patient-app-support-route` | `patient-app` | #114 MERGED → patient-app |
| `claude/patient-app-task-implementation-y4vrly` | `main` | #106 MERGED → main |
| `claude/patient-app-two-factor` | `patient-app` | #116 MERGED → patient-app |

Two entries deserve a note, because their PR state alone would mislead:

- **`claude/patient-app-form-focus-order`** — PR #107 was **closed** with the
  title *"wip … S-05 focus order — INCOMPLETE, not verified"*. The branch is
  nonetheless a strict ancestor of `main`: the work landed through the direct
  merges `0ab3878` ("Merge S-05 into patient-app") and `04b664b` ("record S-05
  against the code that now exists"). A closed PR did not mean lost work here,
  and equally does not mean the branch holds any.
- **`claude/patient-app-forced-upgrade-gate`**, **`-optimistic-updates`** and
  **`-phi-app-switcher-privacy`** have no pull request at all. They were merged
  by direct merge commits (W-06, R-07, T-09). Ancestry, not PR records, is what
  clears them.

## 4. POSSIBLY DUPLICATE / SUPERSEDED — resolved

Three branches had their pull request **closed, not merged**. Name and PR state
would suggest abandoned work; content proves the opposite.

**Surviving implementation: `claude/patient-app-group-a-render-coverage` (PR #152,
merged into `patient-app` at `24e76a9`)** — the "Group A" batch that gathered
render coverage for the doctor, appointment and clinic screens into one pull
request, replacing the three single-task PRs.

| Superseded branch | Closed PR | Test file it added | Status of that file on `patient-app` |
| --- | --- | --- | --- |
| `claude/patient-app-G-04-doctor-profile-tests` | #147 | `patient-app/src/features/doctors/doctor-profile.test.tsx` | **byte-identical** |
| `claude/patient-app-H-01-clinic-screen-tests` | #150 | `patient-app/src/features/clinic/clinic-screen.test.tsx` | **byte-identical** |
| `claude/patient-app-I-06-appointment-detail-tests` | #149 | `patient-app/src/features/appointments/appointment-detail.test.tsx` | **byte-identical** |

Each branch retained one commit that `git cherry` reported as unique. That
commit touches exactly two files: the test suite — proven identical above by
blob hash — and the shared `patient-app/PATIENT_FRONTEND_CHECKLIST.md`, which
differs only because `patient-app` has moved on. A field-level diff of every
affected checklist row shows `patient-app` holds the **same or a better**
version:

- **G-04, I-07** — identical but for an added full stop.
- **I-06** — same sentence, relocated to the correct cell.
- **A-05, Q-03** — rows are byte-identical.
- **H-02** — `patient-app` is a strict improvement: it corrects the cited path
  from `features/clinic/links.ts`, *a file that has never existed*, to the real
  `features/emergency/dial.ts`, and adds the explanation of why the row is 🟨.

`patient-app`'s checklist also already cites all three test files (2, 6 and 2
citations respectively) and marks rows G-04, A-05, H-02, Q-03, I-06 and I-07
against them. Nothing is lost by deleting these three branches.

## 5. MANUAL REVIEW

**None.** Every one of the 59 branches resolved conclusively to KEEP or to
SAFE TO DELETE under the three proofs above.

## 6. Stale branches

No branch qualified as stale-and-abandoned. The oldest non-archive refs are the
integration branches at 2026-09-05, three days before this audit; the
`archive/*` refs are 2026-06-24 by design and are retained deliberately. Every
old-looking branch was checked for unique commits rather than judged by date —
`Database` (2026-09-05) is precisely the case where an older, behind, closed-PR
branch turned out to hold the only copy of 3,717 lines.

## 7. Recovery ledger

Deleting a branch ref does not delete its commits immediately. Every deleted
branch can be restored for as long as the objects survive GitHub's reflog:

```bash
git push origin <sha>:refs/heads/<branch-name>
```

| Deleted branch | Tip SHA |
| --- | --- |
| `claude/fix-frontend-production-mock-guard` | `25c6d1fe54e6c1dda19de8c700ed31374d52277a` |
| `claude/medora-auth-refactor-e7aq7m` | `c9a51583f34453fbd90a53fa93e9068b443b1a5f` |
| `claude/medora-git-cleanup-xwuq7w` | `781fa27e7488fd6e9b32f71942487d41dbb335c2` |
| `claude/medora-mobile-next-task-3myifr` | `bba8e8b6b6c93a8a57d90b07b61529f80b94b014` |
| `claude/patient-app-A-08-datetime-coverage` | `fd45dda47e00597bd184ca6cc4044287c89d1195` |
| `claude/patient-app-D-06-entry-auth-screens` | `a22eab5a2a7614d850066b9f081eb9598f4dcc41` |
| `claude/patient-app-E-02-durable-preferences` | `6251840180f0c0d3f64350401cfdca346f3e5d22` |
| `claude/patient-app-E-04-permission-rows-accuracy` | `efddbcdc740bfda285ca120246fbfa1dc9e06ceb` |
| `claude/patient-app-F-01-home-screen-tests` | `558ad7ee880492ddf435c0613e44eb1fd8c0fef1` |
| `claude/patient-app-G-02-doctor-pagination` | `d76dbe1700b1296acaf34359b93fb490ceb7c254` |
| `claude/patient-app-G-04-doctor-profile-tests` | `a26294ab7605ab730829aaefd382ec9e739088ee` |
| `claude/patient-app-H-01-clinic-screen-tests` | `7f8809315b897c345a2e4c3b68ee733ca7441a41` |
| `claude/patient-app-I-06-appointment-detail-tests` | `ba7b3e6bb08857244ff8d06c6a0863a60c52619f` |
| `claude/patient-app-I-08-action-conflict-recovery` | `d5953adf82fed912ee0dd1ec622c1efce2553d11` |
| `claude/patient-app-J-02-health-records-tests` | `aba371171c9909eacfc38b7cf1691e3f4f5d1ab2` |
| `claude/patient-app-J-06-release-state-tests` | `b156abd64229a67912a73f33bcfbf987e662ff56` |
| `claude/patient-app-M-05-thread-screen-tests` | `8a6ab9a67ba0d898d30da83f86954ab2af34686b` |
| `claude/patient-app-O-02-unread-tab-badge` | `81882cde76bd3234590ca9b9db75b80cc084790e` |
| `claude/patient-app-P-03-edit-profile-tests` | `0dfa8cbc9865e3db1d3a33483a656ae7bb559dbe` |
| `claude/patient-app-P-08-profile-screen-tests` | `0e9bfd36eda93579d17fb23d5ac0b1f922192a31` |
| `claude/patient-app-R-05-error-boundary-tests` | `514fedcffde25c6d0c38330423987d456d4db250` |
| `claude/patient-app-S-08-rtl-verification` | `7624376e2e8ad67273f74690ebc6ddf8d8931216` |
| `claude/patient-app-S-09-a11y-audit` | `3dc1c6df7feeb818f36a5a2dfea79aa466ce97ea` |
| `claude/patient-app-U-06-feature-state-tests` | `6fc29053c1da45c7580c0050271dbb79c104259a` |
| `claude/patient-app-U-10-coverage-reporting` | `1c79ddd3f80ea53f9da9c9540458e7eaa482a056` |
| `claude/patient-app-W-01-app-identity` | `1743ba0d03d719cf62f331a5bdd336cb70a7dce3` |
| `claude/patient-app-W-12-documentation-sweep` | `c4b5c631090a4763cf654243697a4c3a7f96887c` |
| `claude/patient-app-auth-screens-coverage` | `c5a1c017ad93baf60837c627e910a8d427c601eb` |
| `claude/patient-app-bundle-budget` | `ceabe39f60c5cc5a1f9b89f089dedda6708fcf4b` |
| `claude/patient-app-deprecation-header` | `9a8d90c9a592ac7edede0bfd8b51ee57e573b9a3` |
| `claude/patient-app-docs-reconciliation` | `459b835d670bb59161bd7127e6fa74b6481a4959` |
| `claude/patient-app-forced-upgrade-gate` | `35abee90deaa77bde859333fb3e3a8854d3d081a` |
| `claude/patient-app-form-focus-order` | `77c61fb7000066b347c8b56a453cb18386b6c9d4` |
| `claude/patient-app-group-a-render-coverage` | `b1b5b5e98931ddc1849daa1261d81cd8debcad6a` |
| `claude/patient-app-http-auth-adapter-tests` | `6ba9bd5bb47c0c18917d5701f1103c9360758cbb` |
| `claude/patient-app-i18n-foundation` | `4982e0a18be38c2877aebcda2da226681d45d233` |
| `claude/patient-app-live-appointment-reads` | `3c206e065567d486bb38af9fc5d92ca23aa6d9d9` |
| `claude/patient-app-live-doctor-discovery` | `bc31a7268087f04ae66f7c27c96cef1dd513c284` |
| `claude/patient-app-live-notifications` | `12532423b55aeb651b7fb08e6d8f564a7a73bf91` |
| `claude/patient-app-live-profile-read` | `4923710d9c7b5569c126e5428fb1ebc72750d1a2` |
| `claude/patient-app-onboarding-carousel` | `56f91db662fb4d9448f779c4bf5656eda1989cfc` |
| `claude/patient-app-optimistic-updates` | `e07b0aaa4de880ec62db4042d79dfa297fecf3e1` |
| `claude/patient-app-phi-app-switcher-privacy` | `18d4a7548a41b599425bc43c2cbea528b1e0b1e2` |
| `claude/patient-app-recently-viewed` | `7e10a41d738b7180732d68f1e03e23c6795191be` |
| `claude/patient-app-release-runbook` | `909ae561f999e5629756e188f36533651efcce4b` |
| `claude/patient-app-store-privacy` | `a440af2d4274ab0eca963688c68b209453f8f0ac` |
| `claude/patient-app-support-route` | `ad51cd7c699ab3b7dc895c9545272b8c209ad2dc` |
| `claude/patient-app-task-implementation-y4vrly` | `6e1828e6b0e0a0bcf6368438e2c9024921381af7` |
| `claude/patient-app-two-factor` | `5a951030478ddcf645ecbef399f8eafebf6edc27` |

## 8. Execution status — deletion blocked by session policy

The audit is complete and the deletion set is verified, but **no branch was
deleted**: this session's egress policy forbids ref deletion by both available
routes.

```text
$ git push origin --delete claude/patient-app-two-factor
error: RPC failed; HTTP 403 curl 22 The requested URL returned error: 403

$ curl -X DELETE .../git/refs/heads/claude/patient-app-two-factor
HTTP 403
{"message":"Write access to this GitHub API path is not permitted through this proxy."}
```

The block is specific to deletion, not to writing: `git push` of a new branch
in the same session succeeded. The proxy recorded no relay failures, so the
denial is policy, not transport — it was not retried or routed around.

Run the cleanup from an environment with delete rights:

```bash
bash scripts/delete-audited-branches.sh          # dry run — prints all 49
bash scripts/delete-audited-branches.sh --apply  # delete them
```

The script re-proves every branch redundant at run time rather than trusting
this document, refuses the ten protected branches by name, skips refs that are
already gone, and deletes one branch per command so each removal is auditable.
It is safe to re-run. A dry run against the state at audit time reports
`49 would be deleted, 0 skipped`.

No local branches need deleting: the clone holds only `main` and the audit
branch.
