# Medora — Branch Reconciliation Plan

| | |
| --- | --- |
| Date | 2026-11-10 |
| Covers | Tasks R-GIT-01 … R-GIT-10 in `MASTER_REMEDIATION_BACKLOG.md`; findings MED-ARCH-001, MED-ARCH-005, MED-ARCH-006, MED-REL-001, MED-REL-002, MED-MOB-002, MED-DB-003, MED-SEC-011, MED-SEC-012, MED-SEC-014, MED-OPS-004 |
| Method | Read-only Git only: `rev-list`, `log`, `cherry`, `diff`, `show`, `ls-tree`, `merge-base`, and `merge-tree --trivial-merge` (which writes nothing; the object count was compared before and after and was unchanged). Conflicts for the uncommitted files were predicted with `git merge-file` on copies outside the repository. **No fetch, checkout, merge, commit or push was performed.** |
| Freshness | Remote-tracking refs as last fetched (`FETCH_HEAD` 2026-11-10 07:35, by a process other than this analysis). The integration tips are the same SHAs the audit recorded on 2026-11-09. Re-measure before acting (R-GIT-02). |

Every command in section 9 is a **proposal for an authorised person to run later**. None
has been run.

---

## 1. Answer first

**A single trunk can be established safely, and it is far less work than the audit
estimated.** Simulated merges show:

| Merge into `origin/main` | Files changed on both sides | Conflict hunks | Verdict |
| --- | ---: | ---: | --- |
| `origin/backend` | 1 (`backend/docs/BACKEND_API_CONTRACT.md`) | **0** | Clean |
| `origin/frontend` | 0 | **0** | Clean |
| `origin/patient-app` | 2 (`ci.yml`, `PATIENT_FRONTEND_CHECKLIST.md`) | 2 | Small, mechanical |
| `origin/patient-app` after `frontend` has landed | 4 (adds `patient-app/package.json` and `package-lock.json`) | 5 | Mechanical: take the `patient-app` side of both manifests |
| `origin/docs/medora-owner-decisions-2026-11-06` | 0 | **0** | Clean |
| `origin/Ai` | 2 changed + 31 added on both | 41 | **Do not merge.** Nothing unique to keep |
| `origin/Database` | 1 (`CLAUDE.md`) | 0 | Do not merge `CLAUDE.md`; decide `database/` separately (D-13) |

The reason is that the branches diverged by *tree*, not by *file*. `main`'s 255 commits
beyond the `backend` merge base changed no backend source at all (847 of the 1,063 files
are under `frontend/src`). `main`'s 431 commits beyond the `patient-app` merge base
touched `patient-app/` in one file. The audit's "high uncertainty, 3–6 days" was a
reasonable prior from commit counts; the content says otherwise. The work is now
dominated by **verification** (running the full backend e2e suite and the patient-app
release build on the merged result), not by conflict resolution.

**`main` is the right base for the trunk, but it is not the source of truth for every
tree.** For `backend/`, `origin/backend` is strictly newer: `main` has made no backend
change since their merge base. For `patient-app/`, `origin/patient-app` is newer than
both `main` and `frontend`. `main` is correct for `frontend/` and `docs/`. The trunk is
therefore composed, not chosen.

**Three changes outside every integration branch must not be lost**: the owner-decision
record and two copies of an OTP security fix (section 5).

**Waiting is the risk.** `main` today carries a cross-patient data exposure
(MED-SEC-014) that is already fixed on `backend`, and its web client calls four
authentication routes that only `backend` serves (MED-ARCH-006).

---

## 2. Measured state

### 2.1 Tips

| Ref | SHA | Date | Subject |
| --- | --- | --- | --- |
| `origin/main` | `58b229e9` | 2026-11-07 | Merge PR #201 from `frontend` |
| `origin/frontend` | `ad4c6a8d` | 2026-11-07 | Merge PR #205 (patient-app SDK 58 on Jest 29) |
| `origin/backend` | `0c95b7d3` | 2026-11-07 | Merge PR #200 (`claude/backend-roadmap-next`) |
| `origin/patient-app` | `2ecc9071` | 2026-11-07 | Merge PR #206 (Node 22 for SDK 58) |
| `origin/Ai` | `6454bc49` | 2026-10-21 | Merge PR #75 |
| `origin/Database` | `7833bda2` | 2026-10-21 | Merge PR #74 |
| local `HEAD` (`claude/emr-visual-redesign`) | `ad4c6a8d` | — | equal to `origin/frontend`, plus 106 uncommitted paths |
| local `main` | `0e3ee9f5` | 2026-11-04 | **31 behind** `origin/main`, 0 ahead |
| local `patient-app` | `4bc1d7ee` | — | **11 behind** `origin/patient-app`, 0 ahead |

The stale local refs are harmless if no one branches from them. Anyone cutting a branch
must cut from `origin/<branch>`, not from the local name (RK-05).

### 2.2 Divergence from `origin/main`

| Branch | Merge base | Behind | Ahead (all) | Ahead (non-merge) | Patch already on `main` (`git cherry` −) |
| --- | --- | ---: | ---: | ---: | ---: |
| `frontend` | `1fd53d71` (2026-11-07) | 1 | 4 | 3 | 0 |
| `backend` | `03182bef` (2026-11-03) | 255 | 19 | 13 | 0 |
| `patient-app` | `2ac62e4c` (2026-10-20) | 431 | 17 | 10 | 0 |
| `Ai` | `033e1d8a` (2026-10-04) | 423 | 18 | 11 | 3 |
| `Database` | `3f0436eb` (2026-09-05) | 735 | 5 | 2 | 1 |

### 2.3 Patient-app toolchain by ref

| Ref | Expo | React Native | React | `engines.node` |
| --- | --- | --- | --- | --- |
| `origin/main` | ~57.0.30 | 0.86.3 | 19.2.3 | >=20 |
| `origin/frontend`, `HEAD` | ~58.0.23 | 0.88.1 | 19.3.0 | >=20 |
| `origin/patient-app` | ~58.0.23 | 0.88.1 | 19.3.0 | **>=22.13.0** |
| `origin/backend` | ~52.0.0 | 0.76.9 | 18.3.1 | >=20 |

`origin/backend`'s SDK 52 is not a change it made. Its merge base `03182bef` is a
`backend` PR merge that `main` later absorbed while `main`'s own patient-app history
stood at 57; `backend` simply never received the upgrade. Because `backend` did not touch
`patient-app/`, the merge takes `main`'s version without conflict.

---

## 3. Commit-level inventory

Classification: **Keep** (unique content, must reach the trunk), **Duplicate** (same
change exists by another route), **Superseded** (content on `main` is newer),
**No-op**, **Archive** (keep reachable, do not merge).

### 3.1 `origin/backend` — 13 non-merge commits, all **Keep**

| Commit | Date | Content | Why it matters |
| --- | --- | --- | --- |
| `031948c1` | 11-05 | Refuse an `SMTP_HOST` carrying a port | Configuration safety |
| `537395c9` | 11-05 | Replace the removed `minio/minio` image | **Fixes MED-OPS-004**: `docker compose up` fails on `main` |
| `4c6458d9` | 11-05 | Ten roadmap tasks, including the idempotency interceptor and migration `20261105100000_idempotency_records` | The trunk gains **one migration**; booking idempotency for R-BE-08 |
| `94297dde` | 11-05 | M1 gate, M25, M31; ClamAV scanner adapter; M20.4 attachment binding fix | **Fixes the code half of MED-BE-001** |
| `f28a5ee1` | 11-05 | Response compression with BREACH and SSE exclusions | Performance |
| `c7fdeab4` | 11-05 | k6 load suite, synthetic dataset, nightly perf workflow | Needed by R-DB-03, R-QA-12; adds `.github/workflows/perf-nightly.yml` |
| `10c8f47f` | 11-05 | Run k6 on PRs that change it | CI |
| `aac93e9a` | 11-05 | Audit pivot counted over the filtered set, page one only | Correctness of the audit-ledger view |
| `e3dbe9bf` | 11-05 | *[withheld: security-sensitive]* | **Fixes MED-SEC-014 (P0)**. *[withheld: security-sensitive]* |
| `d4768205` | 11-05 | `Cache-Control: no-store` by default | Prevents caching of PHI responses |
| `fc88df41` | 11-05 | M32 performance results; nightly health check | Docs and CI |
| `8992a208` | 11-06 | Recovery codes redeemable and stored as keyed HMAC digests; 2FA re-enrolment requires password and current factor; `setup` refuses when enabled | **Fixes MED-SEC-011 and MED-ARCH-006**; satisfies owner R1, R5, Q7/R4 |
| `bbe6d36a` | 11-07 | Envelope-key rotation | New env variables `DATA_ENCRYPTION_KEY_PREVIOUS`, `DATA_ENCRYPTION_WRITE_FORMAT` |

### 3.2 `origin/patient-app` — 10 non-merge commits

| Commit | Date | Content | Class |
| --- | --- | --- | --- |
| `e196c79a` | 11-01 | Notification preferences over `/me/notification-preferences` | Keep |
| `789efed4` | 11-01 | Bound the contract error's issue list | Keep |
| `79d31133` | 11-04 | Development-only theme playground | Keep |
| `50362ffa` | 11-06 | Recovery-code sign-in, 2FA status, authenticator re-enrolment | Keep (pairs with `8992a208`) |
| `78619b18` | 11-06 | Checklist notes | Keep |
| `3977a5db` | 11-06 | Step-up wording; open only `otpauth:` links | Keep |
| `bd930861` | 11-06 | Checklist notes | Keep |
| `1da6fc3d` | 11-07 | Name an expired 2FA challenge as expired | Keep |
| `137eafd9` | 11-07 | SDK 58 upgrade and Jest 29 fix "brought over from frontend" | **Duplicate** of the `frontend` route; resolve in its favour (section 4.3) |
| `a94d6b39` | 11-07 | Require Node 22 for SDK 58; CI job to Node 22 | Keep (closes MED-MOB-002) |

### 3.3 `origin/frontend` — 3 non-merge commits

| Commit | Author | Content | Class |
| --- | --- | --- | --- |
| `e8474ae8` | Fares-code0 | "Update frontend" — changes only `patient-app/package.json`, `package-lock.json`, `app.json` (SDK 58) | **Duplicate**, mis-named, wrong integration branch (MED-REL-002) |
| `69a55bb6` | copilot-swe-agent | "Apply remaining changes" — 16 `patient-app/src` files | Duplicate (the same 16 files merge cleanly against `137eafd9`) |
| `09a8c538` | Claude | Patient-app suite on Jest 29 | Duplicate of part of `137eafd9` |

All three land on `main` with R-GIT-06 because they are already in `frontend`'s history
and cannot be removed without rewriting a shared branch. R-GIT-07 then reconciles the
manifests once.

### 3.4 `origin/Ai` — 11 non-merge commits: **nothing to keep**

| Evidence | Result |
| --- | --- |
| `docs/multi-hospital/AI_*.md` on `Ai` vs `main` | Byte-identical |
| Newest commit per sampled document | `main` newer for `docs/work-phases/README.md` (10-26 vs 10-10), `BACKEND_CHECKLIST.md` (10-19 vs 10-10), `clinic-isolation.md` (10-26 vs 10-10), `CLAUDE.md` (10-29 vs 10-21) |
| `f3b64538` "Up000" and `dc4ed813` "remove000" | Insert and remove the same line: a net no-op |
| Files on `Ai` absent from `main` | Old files `main` has since moved or removed (`envelope.service.ts` under `auth/`, `logging-outbox.ts`, anatomy assets and ADRs) |

Class: **Superseded** and **No-op**. Retire with a tag (R-GIT-08).

### 3.5 `origin/Database` — 2 non-merge commits

| Commit | Content | Class |
| --- | --- | --- |
| `f8c9b764` | `database/schema.sql`, `seed.sql`, `medora.dbml` (3,717 lines; absent from `main`) | **Archive** — the authoritative schema is `backend/prisma/`; `CLAUDE.md` records that `schema.sql` does not load (MED-DB-003, not re-verified); migration `20261030130000_db_branch_additive_columns` already absorbed the `medora.dbml` lifecycle columns |
| `2eb3f883` | `CLAUDE.md` rule removal | Already on `main` (`git cherry` −) |

D-13 decides between moving the three files under `docs/reference/database/` with a
"not loadable" banner, or tag-and-retire.

---

## 4. Simulated merge results and resolutions

### 4.1 `backend` → `main`

One file changed on both sides, `backend/docs/BACKEND_API_CONTRACT.md`; the three-way
merge resolves without markers. **Semantic checks still required** after the merge,
because a clean text merge says nothing about behaviour:

| Check | Why |
| --- | --- |
| `npm run db:check` and `db:deploy` on a clean PostgreSQL 16 | One new migration |
| Full backend suite including e2e | 13 commits of behaviour change; RK-02 |
| Frontend suite | Parity specs read backend sources; the web client's 2FA calls start receiving real responses |
| Production env template | New required variables (`CLAMAV_HOST` in production; key-rotation variables) |

### 4.2 `frontend` → `main`

No conflict. `main`'s one extra commit is the PR #201 merge of `frontend` itself; the
three `frontend`-only commits are the patient-app SDK 58 work.

### 4.3 `patient-app` → `main` (after `frontend` has landed)

| File | Predicted conflict | Resolution |
| --- | --- | --- |
| `patient-app/package.json` | `engines.node` | Take `patient-app` (`>=22.13.0`). The two sides are otherwise identical |
| `patient-app/package-lock.json` | Lockfile hunks | Take `patient-app`. The two sides differ by one line; regenerate nothing, verify with `npm ci` |
| `.github/workflows/ci.yml` | `patient-app` predates the Redis service on `main`; it changed only `node-version` | Keep `main`'s file; set `node-version: '22'` in the patient-app job (R-QA-02 later pins all jobs) |
| `patient-app/PATIENT_FRONTEND_CHECKLIST.md` | Summary-table counts (rows O, P, Q and the total: 122/53/8/25/3/211 vs 123/52/8/31/3/217) | Recount from the rows; do not pick a side |

Verification on Node 22: `npm ci`, typecheck, lint, test with coverage, `expo export`,
bundle budget. The appointments-screen suite must be watched (RK-06).

### 4.4 Composition check

`backend` and `patient-app` do not overlap except in `ci.yml`, and the order in section
8 lands `backend` first, so `patient-app` meets `main`'s `ci.yml` only once.

---

## 5. Branches outside the integration model

| Branch | Absorbed by | Unique content | Action |
| --- | --- | --- | --- |
| `origin/docs/medora-owner-decisions-2026-11-06` | **none** | `b978a6cc`: +309 lines to `docs/multi-hospital/OWNER_DECISIONS.md` — FINAL OD-001…OD-006 and the 2026-11-06 implementation decisions (MED-ARCH-005) | **R-GIT-03**: owner confirms, merge to `main` (0 conflicts) |
| `origin/claude/otp-ten-minute-lifetime` | **none** | `21c4b3bd`: OTP deadline absolute from issue; resend no longer extends it; 10-minute constant; e2e coverage (MED-SEC-012) | **R-GIT-05**: settle D-9, then one PR to `backend` |
| `origin/claude/otp-absolute-ten-minute-expiry` | **none** | `c3c4f045`: the same change on a pre-#186 base; `21c4b3bd` is its re-application ("cherry picked from commit c3c4f045") | Close after R-GIT-05, with owner approval |

**The D-9 conflict.** The owner register records **A3 = B, "Standardize affected OTP
validity to five minutes"**, with clarification **C-11** open on absolute-vs-renewable.
Commit `21c4b3bd` states "Owner decision (A3 / C-11): the OTP validity is ten minutes".
Either the owner answered C-11 later and changed the value, or the commit misquotes the
register. Only the owner can say which; the code must not merge until that is written
down.

---

## 6. Protecting the uncommitted work

The working tree on `claude/emr-visual-redesign` holds 106 paths. Three of them are also
changed on unmerged branches:

| Path | Also changed on | Predicted result (`git merge-file`, line endings normalised) |
| --- | --- | --- |
| `backend/tsconfig.json` | `origin/backend` (`c7fdeab4` adds `perf/**/*.ts` to `include`) | Clean |
| `backend/test/authz-route-matrix.snapshot.txt` | `origin/backend` (adds 12 routes, e.g. `GET /me/2fa`, `POST /auth/otp/recovery`) | Clean as text — **but it is generated**: regenerate it after merging, then review it as an authorization change |
| `patient-app/src/features/auth/session.test.tsx` | `origin/patient-app` | Clean |

`core.autocrlf` is `true` on this machine; an un-normalised comparison reports
whole-file conflicts that are only line endings. Use `git merge` (which normalises), not
manual file copying.

### 6.1 Slicing (R-GIT-01)

| Slice | Paths | Base → target | Note |
| --- | --- | --- | --- |
| Frontend visual redesign | 98 under `frontend/`, plus `docs/adr/0005-emr-visual-language.md` and the `docs/adr/0001-…` edit | existing `claude/emr-visual-redesign` → `frontend` | Review against the two standing design rules (no decorative card edges; no hover labels on the collapsed sidebar) |
| Reception access to queue and waiting room | `administration.controller.ts`, `administration.controller.authz.spec.ts` (new), `authz-route-matrix.snapshot.txt` | new branch from `origin/backend` → `backend` | **Hold the merge for D-10.** Changes who can reach two routes (`GET /administration/queue`, `/waiting-room`) |
| `backend/tsconfig.json` | 1 | separate small PR, or drop | Unrelated to the slice above; removes `baseUrl` and leaves `"@/*"` mis-indented. Installed TypeScript is 5.9.3, where `baseUrl` is still accepted |
| Patient-app test stabilisation | `session.test.tsx`, `notifications.test.tsx` | new branch from `origin/patient-app` → `patient-app` | Adds an `act()` flush; relevant to MED-TEST-004 |

**Before any Git operation on the working tree**, take a recoverable copy: for example
`git diff --binary > ../medora-wip.patch` plus a copy of the 13 untracked files outside
the repository. That costs one minute and removes the only unrecoverable risk in Phase 0.

---

## 7. Branch inventory after reconciliation

| Branch | After | Evidence to re-check before acting |
| --- | --- | --- |
| `main` | Trunk | — |
| `frontend`, `backend`, `patient-app` | Fast-forwarded to `main`; kept as integration branches per D-1 | `rev-list --left-right --count` = `0 0` |
| `Ai` | Tagged `archive/Ai-2026-11` and retired | Section 3.4 |
| `Database` | Per D-13 | Section 3.5 |
| `claude/frontend-auth-security-hardening`, `-doctors-pending-agreement`, `-live-verification-pass`, `-release-readiness-pass`, `-xls-formula-guard`, `claude/global-palette-refactor`, `claude/theme-playground-web` | Delete — ancestors of `main` and `frontend` today | `git merge-base --is-ancestor <b> origin/main` |
| `claude/backend-roadmap-next` | Delete after R-GIT-04 — ancestor of `backend` today | as above |
| `claude/patient-app-otp-challenge-expiry` | Delete after R-GIT-07 — ancestor of `patient-app` today | as above |
| `update-frontend` | Delete — ancestor of `frontend` | as above |
| `docs/medora-owner-decisions-2026-11-06` | Delete after R-GIT-03 | as above |
| `claude/otp-ten-minute-lifetime` | Delete after R-GIT-05 merges | as above |
| `claude/otp-absolute-ten-minute-expiry` | Close after R-GIT-05 | superseded, not an ancestor |

Every deletion needs owner approval: `CLAUDE.md` forbids deleting someone else's branch.

---

## 8. Ordered plan

| Step | Task | Action | Entry condition | Verification | Rollback |
| ---: | --- | --- | --- | --- | --- |
| 0 | R-GIT-01 | Patch backup of the working tree; commit the four slices; open four PRs | — | `git status` clean; path list matches | The patch file |
| 1 | R-GIT-02 | Fetch; re-measure sections 2 and 4; announce a merge freeze | Step 0 | Numbers match this plan, or the plan is updated first | Lift the freeze |
| 2 | R-GIT-03 | Merge the owner-decision record to `main` | Owner confirms the record, including D-9 status | File present on `main` | Revert the merge commit |
| 3 | R-GIT-04 | Merge `main` into a branch from `origin/backend`; full backend suite on the integration environment (R-QA-01); PR to `main` | R-QA-01 ready | Section 4.1 checks; *[withheld: security-sensitive]* | Revert the merge commit on `main`; no data at risk (no production database) |
| 4 | R-GIT-06 | PR `frontend` → `main` | Step 3 merged | Frontend and patient-app suites | Revert |
| 5 | R-GIT-07 | Merge `main` into a branch from `origin/patient-app`; resolve section 4.3; Node 22 verification; PR to `main` | Step 4 merged; R-QA-02 for Node 22 | `npm ci`, suite, `expo export`, bundle budget | Revert |
| 6 | R-GIT-05 | One OTP PR to `backend`, then promote | D-9 decided; step 3 merged | `auth-two-factor.e2e-spec.ts` | Revert |
| 7 | R-GIT-08 | Fast-forward integration branches; tag and retire `Ai`; D-13 for `Database`; prune section 7 | Steps 3–6 | All integration branches `0 0` | Tags preserve every tip |
| 8 | R-QA-05 | Baseline every suite on the trunk | Step 7 | Dated baseline, zero unexplained failures | — |
| 9 | R-GIT-09, R-DOC-02 | Adopt D-1; add the drift and path-guard CI jobs; regenerate `CLAUDE.md`'s branch table | D-1 decided | Drift job green | Revert |

Merges are ordinary merge commits. No rebase, no force-push, no history rewrite at any
step.

---

## 9. Commands for the authorised operator (not executed)

```bash
# Step 0 — backup before touching the working tree
git diff --binary > ../medora-wip-$(date +%F).patch
git ls-files --others --exclude-standard -z | xargs -0 tar -czf ../medora-untracked-$(date +%F).tgz

# Step 1 — re-measure
git fetch origin
for b in frontend backend Database Ai patient-app; do
  printf '%-12s ' "$b"; git rev-list --left-right --count origin/main...origin/$b
done
for b in backend patient-app frontend; do
  mb=$(git merge-base origin/main origin/$b)
  git merge-tree --trivial-merge "$mb" origin/main origin/$b | grep -c '^+<<<<<<<'
done

# Step 3 — backend into main, via a task branch cut from origin/backend
git switch -c claude/reconcile-backend-into-main origin/backend
git merge --no-ff origin/main
npm --prefix backend ci && npm --prefix backend run db:check && npm --prefix backend run db:deploy \
  && npm --prefix backend run db:seed && npm --prefix backend run typecheck \
  && npm --prefix backend run lint && npm --prefix backend run test && npm --prefix backend run build
# then: push, open PR → main

# Step 5 — patient-app into main (after frontend has landed)
git switch -c claude/reconcile-patient-app-into-main origin/patient-app
git merge --no-ff origin/main
# Keep the patient-app side of both manifests. In this merge "ours" is the
# patient-app side, because the branch was cut from origin/patient-app.
git checkout --ours -- patient-app/package.json patient-app/package-lock.json
git add patient-app/package.json patient-app/package-lock.json
git diff --cached origin/main -- patient-app/package.json   # expect "node": ">=22.13.0"
# Resolve .github/workflows/ci.yml and PATIENT_FRONTEND_CHECKLIST.md by hand (§4.3).
```

---

## 10. After reconciliation: the branch model (D-1)

| Option | For | Against |
| --- | --- | --- |
| **A. Keep per-tree integration branches, promote weekly and on every security fix** (recommended for continuity) | Matches `CLAUDE.md` and ADR-032; path-filtered CI already exists | Requires a promotion owner and a drift check |
| B. Trunk-based: task branches from `main`, PRs to `main` | Removes the divergence class entirely | Changes the documented workflow; needs strong required checks |

Whichever is chosen, add two CI jobs (R-GIT-09): a **drift check** that fails when an
integration branch is more than an agreed number of commits behind `main`, and a **path
guard** that fails a PR into `frontend` touching `patient-app/` (and vice versa), which
would have stopped MED-REL-002.

## 11. What this plan does not cover

- It does not establish that the merged result works; R-QA-05 does.
- It does not verify GitHub branch protection (R-GIT-10).
- It does not decide D-1, D-9, D-10 or D-13.
- Any commit pushed to a remote after 2026-11-10 07:35 is not reflected here.

## 12. Status amendment (2026-11-12)

Sections 1–11 are kept as written; their branch measurements date from 2026-11-10 and are
superseded. Measured on 2026-11-12 against `origin/main` `726f1cbf`:

| Branch | Behind `main` | Ahead of `main` | Note |
| --- | ---: | ---: | --- |
| `backend` | 269 | 0 | Promoted by PR #220 (R-GIT-04 done) |
| `frontend` | 38 | 6 | Carries #219, #221 and #222; R-GIT-06 not done |
| `patient-app` | 478 | 22 | R-GIT-07 not done |

Steps after the backend promotion in §8 have not been executed.
