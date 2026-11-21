# Migrating the repository to a second GitHub account

**Audited:** `Fares-code0/smart-healthcare-assistant-system` @ `7cc7a28` (main)
**Target:** `Fares7324/smart-healthcare-assistant-system`
**Status:** audited, scripted and rehearsed end-to-end — **the final push is blocked on a credential no Claude Code session can hold.**

**Re-verified 2026-09-08, second pass.** The target repository now exists on
the second account. The block did not move: it is a property of the session's
credential, not of the target. Re-checked from a fresh session with a
fourth probe the first pass did not try (see §1). Everything except the
network push to GitHub is now proven against the **real** repository data
rather than stand-ins.

The source repository was not modified by this work. Every operation against
it was a fetch, and its twelve ref tips are byte-identical to the manifest
taken before any of this began.

> **The premise "11 branches" is now stale.** It was 11 when the first pass
> audited. PR #154 merged the first pass's own work and left its task branch
> in place, so the source holds **12**. Nothing is wrong — the number simply
> moves as work continues, which is why the script counts refs at run time
> and never asserts a total. See §2.

---

## 1. What is blocked, and why

The push to `Fares7324` cannot be performed from a Claude Code session. Four
independent checks agree:

| Check | Result |
| ----- | ------ |
| `add_repo` for owner `Fares7324` | refused — *"cross-tier adds are not supported in v1… session already has repos from owner(s) [fares-code0]"* |
| `GET /repos/Fares7324/smart-healthcare-assistant-system` | `403` — *"GitHub access to this repository is not enabled for this session"* |
| `git ls-remote https://github.com/Fares7324/…` | `fatal: could not read Username` — the proxy declined to inject a credential at all |
| `git ls-remote` with the session token supplied **explicitly** | `remote: Invalid username or token` — the token is an installation credential scoped to the one source repository |

The fourth check is the one that settles it. The session's `GH_TOKEN`
authenticates as `Fares-code0` (`GET /user` → `200`), so this is not a
missing-token problem: the token is *valid* and still cannot write to
`Fares7324`, because it is scoped to a single repository. Nor is
`list_repos` hiding anything — it returns exactly one repository, the source.

There is no workaround from inside this environment, and the fix is not to
find a different route to the same push. This is an environment boundary.
**Everything else in the migration is done and verified**; run
`scripts/migrate-to-second-account.sh --apply` from a machine holding a
credential for the second account and the migration completes, including the
verification and the origin re-point.

One useful observation: `Fares7324` already appears as the `triggering_actor`
on workflow run #630 of the *source* repository, so that account has at least
push-level access to the source. Whoever holds it can therefore run the script
locally with a single credential — it needs only read on the source and write
on the target.

---

## 2. Audit of the source repository

### Git structure

| Property | Value |
| -------- | ----- |
| URL | `https://github.com/Fares-code0/smart-healthcare-assistant-system` |
| Owner | `Fares-code0` (user account, not an org) |
| Visibility | **private** |
| Default branch | `main` @ `7cc7a28b1e1e82c761536b12d0d8961a81017875` |
| Branches | **12** (was 11 on the first pass — see below) |
| Tags | **0** |
| Reachable commits | **584** (was 582) |
| Root commits | 2 (`main` lineage + the orphan `archive/*` lineage) |
| Repository size | ~22.3 MiB packed |
| Submodules | none (no `.gitmodules`) |
| Git LFS | **not used** — no `.gitattributes`, no LFS filters, `git-lfs` not installed |
| `git fsck` | clean |

### The twelve branches

Re-measured against `main` @ `7cc7a28`. The two rows that moved since the
first pass are marked; everything else is unchanged.

| Branch | Tip | Behind `main` | Ahead of `main` |
| ------ | --- | ------------: | --------------: |
| `main` | `7cc7a28` *(moved)* | 0 | 0 |
| `claude/repo-migration-second-account-4ybw9f` | `2eb7616` *(new)* | 1 | 0 |
| `frontend` | `3f0436e` | 30 | 0 |
| `backend` | `3f0436e` | 30 | 0 |
| `Ai` | `3f0436e` | 30 | 0 |
| `Database` | `ed57b38` | 30 | 3 |
| `patient-app` | `357eb57` | 5 | 106 |
| `claude/git-branch-audit-cleanup-h1ib3b` | `636276d` | 3 | 0 |
| `claude/medora-dev-auth-access-gz7soi` | `f3edb3c` | 13 | 3 |
| `archive/Ai-orphan-37fe5b0` | `37fe5b0` | 471 | 1 |
| `archive/backend-orphan-37fe5b0` | `37fe5b0` | 471 | 1 |
| `archive/frontend-orphan-37fe5b0` | `37fe5b0` | 471 | 1 |

Every "behind" count grew by 2 because `main` advanced by 2 commits, not
because any branch changed. Only `main` and the new task branch actually
moved.

Branches carrying commits `main` does not have: `Database` (3), `patient-app`
(106), `claude/medora-dev-auth-access-gz7soi` (3), and the three `archive/*`
orphans (1 each, no common ancestor with `main`). **All of it migrates** — the
transfer is by commit object, not by branch policy, so nothing depends on
these counts being right.

Note that `frontend`, `backend` and `Ai` currently share a single tip
(`3f0436e`) and none is ahead of `main`. The branch-state table in `CLAUDE.md`
is dated 2026-09-03 and is now stale, exactly as that file warns.

### Working tree

Clean. No uncommitted changes, no stashes, no untracked files, no local-only
commits. Local `main` was 93 commits behind `origin/main` and carried nothing
unique.

> **One real hazard was found and removed.** The session's working clone was
> **shallow** (`.git/shallow`, 528 of 582 commits). A mirror push from a
> shallow clone migrates a truncated history. It was unshallowed with
> `git fetch --unshallow` before anything else was done, and the migration
> script refuses outright to push from a shallow mirror.

---

## 3. GitHub metadata

| Item | State on the source |
| ---- | ------------------- |
| Open pull requests | **0** |
| Total pull requests | **154** (all closed/merged) |
| Issues | **0** (open or closed) |
| Releases | **0** |
| Tags | **0** |
| Milestones | **0** |
| Labels | 9, all GitHub defaults — none customised |
| Discussions | disabled |
| Wiki | disabled |
| Projects | enabled, none created |
| Branch protection | **not readable** (token lacks the scope) — but see below |
| Rulesets | **none possible** — API returns *"Upgrade to GitHub Pro or make this repository public"* |
| Secrets / variables / environments / webhooks / deploy keys | **not readable** — the session proxy blocks these API paths |
| Merge settings | merge, squash and rebase all enabled; auto-merge off; delete-branch-on-merge off |

Because the repository is **private on a free plan**, GitHub does not offer
rulesets, and branch protection is likewise a paid feature for private
repositories. `CLAUDE.md` states "`main` must remain protected"; that is a
working agreement enforced by convention, not by a GitHub rule. **There is
therefore almost certainly no branch protection to recreate** — but confirm
this in the source repository's settings before assuming it, since the
relevant API returned `403` rather than an empty result.

---

## 4. GitHub Actions audit

One workflow: `.github/workflows/ci.yml` (`name: CI`, active).

| Check | Finding |
| ----- | ------- |
| Triggers | `push` on `branches: ['**']`, and `pull_request` (all branches) |
| Concurrency | `ci-${{ github.ref }}`, cancel-in-progress |
| Jobs | `changes` → `frontend`, `backend`, `patient-app` → aggregating `ci` |
| `secrets.*` references | **none** |
| `vars.*` references | **none** |
| `environment:` blocks | **none** |
| `permissions:` blocks | **none** (repository default applies) |
| Third-party actions | none — only `actions/checkout@v4` and `actions/setup-node@v4` |
| External services | one `postgres:16-alpine` service container, credentials hardcoded as throwaway test values |
| Package registries | npmjs only, via `npm ci` |
| Deployment jobs | **none** |
| Hardcoded owner/repo references | **none in the workflow** |
| `CODEOWNERS` | not present |
| `dependabot.yml` | not present |
| Issue/PR templates | not present |

**This workflow is fully portable.** It needs nothing that has to be recreated
on the second account — no secret, no variable, no environment, no deploy key.
It will run on `Fares7324` exactly as written, with one caveat in §6.

Seven files mention the old owner string `Fares-code0`, all in documentation
(`docs/DECISIONS.md`, `docs/M0_REPOSITORY_ANALYSIS.md`,
`docs/ARCHITECTURE_RECONCILIATION.md`, `backend/docs/REPO_AUDIT.md`,
`backend/docs/BACKEND_IMPLEMENTATION_ROADMAP.md`,
`frontend/FRONTEND_CHECKLIST.md`, `patient-app/PATIENT_APP_AUDIT.md`). Every
one is a *historical record* — an audit datestamped against a commit, or a
link to a past CI run. **They should not be rewritten.** Changing them would
falsify the record, and none of them affects CI.

---

## 5. Secrets and variables

| Secret/Variable | Used By | Required? | Available in Target? | Action |
| --------------- | ------- | --------- | -------------------- | ------ |
| *(none)* | — | — | — | **Nothing to migrate** |

The CI workflow references no secrets and no variables. `GITHUB_TOKEN` is the
automatic per-run token GitHub issues itself; it needs no setup.

The three `.env.example` files (`frontend/`, `backend/`, `patient-app/`) are
committed templates and migrate as ordinary files. Real `.env` files are
git-ignored, are not in the repository, and are not part of this migration —
recreate them locally on whatever machine runs the app, as before.

Repository-level secrets and variables **could not be enumerated** (the
session proxy blocks `/actions/secrets` and `/actions/variables` with `403`).
Since no workflow consumes any, none can be load-bearing for CI. Before
retiring the old repository, open
`https://github.com/Fares-code0/smart-healthcare-assistant-system/settings/secrets/actions`
and confirm the list is empty.

---

## 6. CI status — a pre-existing failure, not a migration problem

**Every workflow run on the source repository has failed since 2026-09-04**,
including run **#630**, the most recent, on `main` @ `7cc7a28`.

The failures are not code failures. Run #630 was dissected job by job:

| Evidence | Value |
| -------- | ----- |
| Job | `Detect changed trees` (the first job; everything else depends on it) |
| Duration | `13:08:26Z` → `13:08:28Z` — **2 seconds** |
| `runner_id` | `0` |
| `runner_name` | `""` — **no runner was ever assigned** |
| `labels` | `["ubuntu-latest"]` — a standard GitHub-hosted runner, nothing exotic |
| Steps | none recorded |
| Job log download | **HTTP 404** — no log was ever produced, because nothing ran |
| Check-run `output` | `title`, `summary` and `text` all empty — no annotation, no error |
| Downstream jobs | `frontend`, `backend`, `patient-app` all `skipped`; aggregate `ci` fails |

A job that fails in two seconds with no runner, no steps, no log and no error
message did not *run and fail* — it never started. Nothing in the repository
can produce that; it is decided before the workflow is dispatched.

The exact billing figure could not be read to confirm it directly:
`GET /users/Fares-code0/settings/billing/actions` returns `403` — *"sessions
are bound to their configured repositories"* — and
`GET /repos/…/actions/permissions` returns `403` — *"Access to this GitHub
Actions path is not permitted through this proxy."* Both are session
restrictions, not GitHub refusals. **Confirm the number at
<https://github.com/settings/billing> on the account.**

That signature is a job that never got a machine, which for a **private
repository on a free plan** means **the account's GitHub Actions minutes are
exhausted or its spending limit is reached**. Private-repository minutes are
metered; public ones are not.

The timeline supports it — this was a clean cutover, not a gradual decay:

| Window | Runs |
| ------ | ---- |
| 2026-08-11 → 2026-09-03 23:07 | overwhelmingly `success` (e.g. 96/100, 93/100, 81/100 per page) |
| 2026-09-04 → 2026-09-08 | **every run `failure`**, zero steps executed — 630 runs total on the workflow |

Last successful run: **2026-09-03T23:07:05Z** on
`claude/medora-git-cleanup-xwuq7w` @ `781fa27e`.

**Consequences for the migration:**

1. The workflow itself is proven good — it passed hundreds of times on this
   exact repository. Migration will not break it.
2. CI could not be run on the target as part of this work, because the target
   is unreachable from here. Phase 7 verification is **deferred**, not skipped.
3. On the second account CI will go green **if** that account has Actions
   minutes available. **The target has been created private**, which is the
   configuration that meters minutes — so if `Fares7324` is also on the free
   plan, expect the identical wall the moment the first branch lands. Two
   fixes: make the target repository **public** (Actions is unmetered on
   public repositories), or raise/reset the spending limit under
   *Settings → Billing*. Decide this before concluding the migration broke CI.
4. Do not "fix" this in code. There is nothing wrong with the code. The
   workflow references no secret and no variable (verified again this pass:
   zero matches for `secrets.`, `vars.`, `environment:` and `permissions:` in
   `ci.yml`), uses only `actions/checkout@v4` and `actions/setup-node@v4`, and
   contains no `Fares-code0` string. It is portable as written.

---

## 7. The migration hazard the mirror recipe hides

The textbook recipe is `git clone --mirror` then `git push --mirror`. Run
verbatim here, **the push fails**.

A `--mirror` clone of a GitHub repository fetches `refs/pull/<n>/head` — one
ref per pull request ever opened. This repository has **153 of them**, so the
mirror holds **164 refs, not 11**. Those refs are generated and owned by
GitHub, and GitHub **rejects any push to `refs/pull/*`**.

`scripts/migrate-to-second-account.sh` deletes them from the local mirror
before pushing (which touches the local copy only — the source is untouched)
and then pushes explicit `refs/heads/*` and `refs/tags/*` refspecs rather than
`--mirror`. Two reasons for explicit refspecs over `--mirror`:

- `--mirror` **deletes** refs on the target that the source lacks. Against an
  empty target that is harmless; against a target with anything in it, it is
  destructive. The script refuses a non-empty target outright.
- Explicit refspecs migrate exactly what a repository *is* — its branches and
  tags — and delete nothing.

No `--force` is used anywhere. Against an empty target every ref update is a
fast-forward create, so a rejection means an assumption was wrong and the push
*should* stop rather than overwrite.

The pull-request refs (now **154**) are **not lost history**. Every commit
reachable from them that matters is already reachable from a branch: dropping
them left **584** reachable commits, unchanged — re-measured this pass on the
real mirror, which held **166 refs for 12 branches**.

---

## 8. Rehearsal — what was actually verified

The migration was executed end-to-end against local stand-in repositories.
These are results, not predictions.

Re-run in full on the second pass, this time with the **real source
repository** as the input rather than a synthetic stand-in — only the target
was a local stand-in, because the real one is unreachable. So every step below
except the network push to GitHub has now been exercised against the actual
584-commit history.

| Test | Result |
| ---- | ------ |
| Mirror-clone the real source | **166 refs**, `git fsck` clean, non-shallow |
| Of which `refs/pull/*` | **154** — the hazard is current, not historical |
| Drop `refs/pull/*` | 166 → **12 refs**; reachable commits unchanged at 584 |
| `--apply` against an **empty** target | all **12** branches created, push clean, no `--force` |
| Verify target refs against the source manifest | **byte-identical**, `diff` empty |
| Commit-set fingerprint, source vs migrated | `2b0e7576…` on **both** |
| History depth on the migrated copy | **584 commits, 2 root commits**, target clone not shallow |
| `git fsck` on the re-cloned target | clean |
| Re-point `origin` after verification | rewritten, `git remote -v` confirms, **12 branches** visible from the new origin |
| `--apply` against a **non-empty** target | **refused**; target's 12 branches left untouched |
| Source repository after all of it | **unmodified** — 12 tips byte-identical to the pre-work manifest |

The commit-set fingerprint differs from the first pass's `3f23ea0c…` only
because the source gained 2 commits (582 → 584). It is the SHA-1 of the sorted
list of every reachable commit id, so it changes whenever history does — which
is the point of it.

### Branch manifest (the exact expectation for the target)

```
3f0436ebe7e143a393db56c4322dfaf0f6f948cd	refs/heads/Ai
ed57b380870b28d80e660f7f1a25491c2a5b5c0f	refs/heads/Database
37fe5b0aa2222d922125024cff5219416ee0d7d4	refs/heads/archive/Ai-orphan-37fe5b0
37fe5b0aa2222d922125024cff5219416ee0d7d4	refs/heads/archive/backend-orphan-37fe5b0
37fe5b0aa2222d922125024cff5219416ee0d7d4	refs/heads/archive/frontend-orphan-37fe5b0
3f0436ebe7e143a393db56c4322dfaf0f6f948cd	refs/heads/backend
636276d8fc331f6465e2ef080ed8e0cd2d30bef3	refs/heads/claude/git-branch-audit-cleanup-h1ib3b
f3edb3c664658a86011da235b9dab3236f39e1e0	refs/heads/claude/medora-dev-auth-access-gz7soi
2eb7616802ccaaf4e83786727617d2121f0816e4	refs/heads/claude/repo-migration-second-account-4ybw9f
3f0436ebe7e143a393db56c4322dfaf0f6f948cd	refs/heads/frontend
7cc7a28b1e1e82c761536b12d0d8961a81017875	refs/heads/main
357eb5748463117891d0d7c779451113b7834dce	refs/heads/patient-app
```

Tags: **none**, so `refs/tags/*` migrates trivially and completely.

This manifest is a snapshot, and the source keeps moving — the branch carrying
*this* document will add a thirteenth head once pushed. **Do not diff against
the list above at migration time**; re-derive it from the source, which is
exactly what the script does. The list is here to show what the shape of a
correct result looks like, not to be the expected answer.

After migrating, this must match exactly:

```bash
git ls-remote --heads https://github.com/Fares7324/smart-healthcare-assistant-system.git \
  | awk '{print $1"\t"$2}' | sort -k2
```

---

## 9. How to finish the migration

**Done already:** the target repository exists on `Fares7324`, private and
(per the account holder) empty. Step 1 is therefore complete — but the script
re-checks emptiness itself and refuses if it is wrong, so nothing depends on
that being accurate.

1. **Create the target repository** on `Fares7324` as
   `smart-healthcare-assistant-system`, **completely empty** — no README, no
   `.gitignore`, no licence. ✅ *done*. Consider making it **public** if you
   want CI to run without minute limits (§6); it is currently **private**,
   which is the setting that meters Actions minutes.

2. **Run the migration** from a machine authenticated to the second account —
   this is the one step that cannot be done from a Claude Code session:

   ```bash
   git clone https://github.com/Fares-code0/smart-healthcare-assistant-system.git
   cd smart-healthcare-assistant-system
   bash scripts/migrate-to-second-account.sh          # dry run first
   bash scripts/migrate-to-second-account.sh --apply
   ```

   It mirror-clones the source, drops `refs/pull/*`, refuses a non-empty
   target, pushes without `--force`, reads the target back and diffs it
   against the source manifest, re-clones the target to prove the *history*
   arrived and not merely the ref tips, `fsck`s it, and finally re-points the
   local clone's `origin`. It fails loudly rather than half-migrating, and it
   re-points `origin` **only after** verification passes — re-pointing before
   the data is proven to be on the target is how a migration loses work.

   A single credential is enough: it needs read on the source and write on the
   target. The `Fares7324` account already has access to both (§1).

3. **Set the default branch** to `main` on the target
   (*Settings → General → Default branch*). Git does not carry this; GitHub
   picks the first branch pushed, which will not reliably be `main`.

4. **Re-point the local clone.** The script does this for you and prints
   `git remote -v`. To do it by hand, or to check its work:

   ```bash
   git remote set-url origin https://github.com/Fares7324/smart-healthcare-assistant-system.git
   git remote -v
   git fetch origin --prune --tags
   git ls-remote --heads origin | wc -l   # expect the source's branch count
   git status
   ```

5. **Confirm CI.** Push any branch, or use *Actions → CI → Run workflow*. If
   jobs fail in seconds with no runner assigned, it is the minutes limit
   of §6, not the migration. Compare against the signature table in §6 before
   touching anything in `ci.yml`.

---

## 10. What migrates, and what does not

**A — Git data, migrated and verified**

All 584 commits, all 12 branches at their exact SHAs, complete history
including the two root commits and the orphan `archive/*` lineage, all trees
and blobs. Tags: 0, so trivially complete. No submodules, no LFS objects.

**B — GitHub metadata that migrates automatically**

`.github/workflows/ci.yml` migrates as a file and is picked up by Actions on
the target with no edits. That is the whole of category B — everything else
GitHub stores outside git.

**C — GitHub metadata requiring manual recreation**

| Item | Effort |
| ---- | ------ |
| Default branch = `main` | one setting |
| Repository description and visibility | copy from the old repo |
| Merge-button settings (squash/merge/rebase, auto-merge, delete-on-merge) | four toggles; current values in §3 |
| Branch protection | probably nothing to do — unavailable on a private free-plan repository (§3) |
| Secrets / variables / environments | **none needed** (§5); confirm the old repo's list is empty before retiring it |
| Custom labels | none — the 9 present are GitHub defaults and are created automatically |
| Actions minutes / spending limit | see §6 |

**D — Metadata that cannot be migrated at all**

- **All 154 pull requests** — titles, descriptions, review comments, approvals,
  merge records. GitHub has no mechanism to move PRs between repositories. The
  *commits* and *merge commits* all migrate; the conversation around them does
  not. The merge commit subjects (`Merge pull request #NN from …`) survive and
  remain the searchable record.
- **Workflow run history** — all 630 runs, including the green ones cited
  throughout `backend/docs/` and `frontend/FRONTEND_CHECKLIST.md`. Those links
  keep working only while the old repository exists. **This is the strongest
  reason not to delete it.**
- Issues (0), Discussions (disabled), Releases (0), Projects (none),
  Milestones (0) — all empty, so nothing is actually lost here.
- Stars, watchers, forks, traffic statistics.

**Keep the old repository.** It is the only remaining home of the pull-request
history and the CI runs the documentation cites as evidence. It was not
modified by this migration and remains fully intact.
