#!/usr/bin/env bash
#
# Vercel "Ignored Build Step" — deploy only when frontend/ actually changed.
#
#   exit 0     → Vercel SKIPS the build, and no deployment is created.
#   exit != 0  → Vercel PROCEEDS with the build.
#
# Vercel runs this from the project's Root Directory, which is `frontend`
# (DEPLOYMENT.md § Project settings), so the `.` pathspec below means
# `frontend/` and nothing else. That is also precisely the build's input:
# Root Directory scopes the checkout the build sees, and `installCommand`
# resolves `frontend/package-lock.json`. A commit that leaves `frontend/`
# untouched therefore cannot change the artifact this project publishes —
# building it produces the same bytes and republishes them.
#
# This is layered UNDER the `git.deploymentEnabled` branch filter in
# vercel.json, which still decides which branches may deploy at all. Branch
# filter first, then this path check. Neither replaces the other.

set -uo pipefail

# Fail OPEN. Every case this script cannot resolve returns "build", never
# "skip": building a commit that changed nothing wastes a build, whereas
# skipping one that did change the app leaves a stale site deployed.
build() { echo "$1"; exit 1; }
skip()  { echo "$1"; exit 0; }

git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || build "No git checkout to compare against — building."

# `VERCEL_GIT_PREVIOUS_SHA` is the last successful deployment for this
# branch, so it spans a push that carried several commits. `HEAD~1` spans
# only one — correct for the merge commits `main` actually receives, wrong
# for a multi-commit push. Prefer the former; a shallow clone may not
# contain it, hence the reachability check before trusting it.
if [ -n "${VERCEL_GIT_PREVIOUS_SHA:-}" ] \
   && git cat-file -e "${VERCEL_GIT_PREVIOUS_SHA}^{commit}" 2>/dev/null; then
  BASE="$VERCEL_GIT_PREVIOUS_SHA"
else
  BASE="$(git rev-parse --verify --quiet 'HEAD~1^{commit}' || true)"
fi

[ -n "${BASE:-}" ] || build "No usable base commit — building."

# `git diff --quiet` exits 0 for "no differences" and 1 for "differences",
# which maps onto Vercel's skip/proceed contract without negation. Any
# other exit status is an error and falls through to build.
if git diff --quiet "$BASE" HEAD -- .; then
  skip "No changes under frontend/ since ${BASE} — skipping this deployment."
fi

build "frontend/ changed since ${BASE} — building."
