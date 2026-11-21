#!/usr/bin/env bash
#
# Migrate this repository to a second GitHub account, preserving every
# branch, every commit and the full history. See
# docs/MIGRATION_TO_SECOND_ACCOUNT.md for the audit this script implements.
#
# The source repository is never written to. Every operation against it is
# a fetch. The script refuses to overwrite anything on the target that it
# has not been told about, and it never force-pushes.
#
# Usage:   bash scripts/migrate-to-second-account.sh          # dry run
#          bash scripts/migrate-to-second-account.sh --apply  # actually push
#
# Requires: git, and a credential for the TARGET account (see below). The
# source only needs read access.
#
# Branch and commit counts are DISCOVERED at run time, never asserted. The
# source gains branches as work continues (it held 11 when this script was
# written and 12 by the next day), so any hardcoded count would be a lie
# waiting to happen. The correctness argument is the manifest diff in step 5:
# whatever the source has, the target must match exactly.

set -uo pipefail

# Overridable so the script can be rehearsed against local stand-in
# repositories before it is pointed at the real ones. The defaults are the
# real migration.
SOURCE_URL="${SOURCE_URL:-https://github.com/Fares-code0/smart-healthcare-assistant-system.git}"
TARGET_URL="${TARGET_URL:-https://github.com/Fares7324/smart-healthcare-assistant-system.git}"
WORKDIR="${TMPDIR:-/tmp}/shas-migration-$$"

APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

# Where the caller's working clone lives, resolved BEFORE we cd into the
# mirror. Step 6 re-points its origin, but only once the migration has been
# verified. Empty if the script is not being run from inside a clone.
CALLER_REPO=$(git rev-parse --show-toplevel 2>/dev/null || true)

say()  { printf '%s\n' "$*"; }
step() { printf '\n=== %s ===\n' "$*"; }
die()  { printf '\nABORT: %s\n' "$*" >&2; exit 1; }

if [ "$APPLY" -eq 0 ]; then
  say "DRY RUN — nothing will be pushed. Re-run with --apply to migrate."
else
  say "APPLY MODE — the target repository will be written to."
fi
say "source: $SOURCE_URL  (read-only)"
say "target: $TARGET_URL"

# ---------------------------------------------------------------------------
# 1. Mirror-clone the source.
#
# --mirror is the only clone mode that takes every ref and the complete
# history. A plain clone would take the default branch's history and the
# branches you happen to ask for; a shallow clone would take neither.
# ---------------------------------------------------------------------------
step "Mirror-cloning the source"
mkdir -p "$WORKDIR" || die "cannot create $WORKDIR"
trap 'rm -rf "$WORKDIR"' EXIT
git clone --mirror "$SOURCE_URL" "$WORKDIR/mirror.git" || die "clone failed"
cd "$WORKDIR/mirror.git" || die "cannot enter the mirror"

# A shallow mirror would silently migrate a truncated history. There is no
# recovering from that after the source is gone, so check rather than trust.
[ -f shallow ] && die "the mirror is shallow — history would be truncated"

step "Verifying object integrity of the mirror"
git fsck --no-progress --no-dangling || die "the mirror failed fsck"

# ---------------------------------------------------------------------------
# 2. Drop refs/pull/*.
#
# A mirror clone of a GitHub repository picks up refs/pull/<n>/head — one
# per pull request ever opened. They are GitHub-generated and READ-ONLY:
# GitHub rejects any push to refs/pull/*, so `git push --mirror` with them
# present fails outright. They are also not history — every commit they
# reach that matters is already reachable from a branch.
#
# Deleting them here touches the local mirror only. The source is untouched.
# ---------------------------------------------------------------------------
step "Dropping read-only refs/pull/* from the local mirror"
PULL_REFS=$(git for-each-ref --format='%(refname)' refs/pull | wc -l | tr -d ' ')
say "refs/pull/* present: $PULL_REFS"
if [ "$PULL_REFS" -gt 0 ]; then
  git for-each-ref --format='delete %(refname)' refs/pull | git update-ref --stdin \
    || die "could not drop refs/pull/*"
fi

BRANCHES=$(git for-each-ref --format='%(refname)' refs/heads | wc -l | tr -d ' ')
TAGS=$(git for-each-ref --format='%(refname)' refs/tags | wc -l | tr -d ' ')
COMMITS=$(git rev-list --all --count)
say "branches: $BRANCHES   tags: $TAGS   reachable commits: $COMMITS"
[ "$BRANCHES" -gt 0 ] || die "the mirror has no branches — refusing to continue"

git for-each-ref --format='%(objectname)	%(refname)' refs/heads refs/tags \
  | sort -k2 > "$WORKDIR/source-manifest.txt"
step "Source manifest"
cat "$WORKDIR/source-manifest.txt"

# A fingerprint of the whole reachable commit set, not just the ref tips.
# Two repositories can share every branch tip and still differ in history if
# one of them was grafted or shallow-truncated; comparing the sorted set of
# every reachable commit id catches that, and matching tips cannot.
SOURCE_COMMITS=$(git rev-list --all | sort | git hash-object --stdin)
SOURCE_ROOTS=$(git rev-list --all --max-parents=0 | wc -l | tr -d ' ')
say "commit-set fingerprint: $SOURCE_COMMITS  ($COMMITS commits, $SOURCE_ROOTS root commits)"

# ---------------------------------------------------------------------------
# 3. Inspect the target BEFORE writing to it.
#
# The dangerous case is a target that already has commits: `push --mirror`
# deletes any ref the source does not have. An empty target (or one holding
# only a fresh README commit the user is happy to lose) is fine; anything
# else stops here for a human to look at.
# ---------------------------------------------------------------------------
step "Inspecting the target"
if ! TARGET_REFS=$(git ls-remote "$TARGET_URL" 2>&1); then
  say "$TARGET_REFS"
  die "cannot read the target. Create the repository on the second account
       (empty — no README, no .gitignore, no licence) and make sure your
       credential for that account is available to git, then re-run."
fi

if [ -z "$TARGET_REFS" ]; then
  say "target is EMPTY — safe to migrate."
  TARGET_EMPTY=1
else
  TARGET_EMPTY=0
  say "target is NOT empty. It currently holds:"
  printf '%s\n' "$TARGET_REFS"
  say ""
  say "Refusing to push. A mirror push deletes target refs the source does"
  say "not have, so this would destroy the above. Either empty the target,"
  say "or migrate into a differently-named repository."
  [ "$APPLY" -eq 1 ] && die "target not empty"
fi

# ---------------------------------------------------------------------------
# 4. Push.
#
# Explicit refspecs rather than --mirror. --mirror would also try to push
# any leftover ref namespace and would delete on the target; naming
# refs/heads/* and refs/tags/* migrates exactly what a repository is, and
# nothing is deleted. No --force anywhere: against an empty target every
# update is a fast-forward create, so a rejection here means an assumption
# was wrong and the push SHOULD stop.
# ---------------------------------------------------------------------------
step "Pushing branches and tags"
if [ "$APPLY" -eq 0 ]; then
  say "(dry run) would run:"
  say "  git push $TARGET_URL 'refs/heads/*:refs/heads/*' 'refs/tags/*:refs/tags/*'"
  git push --dry-run "$TARGET_URL" 'refs/heads/*:refs/heads/*' 'refs/tags/*:refs/tags/*' \
    || say "(dry-run push could not reach the target — expected without a target credential)"
else
  [ "$TARGET_EMPTY" -eq 1 ] || die "target not empty"
  git push "$TARGET_URL" 'refs/heads/*:refs/heads/*' 'refs/tags/*:refs/tags/*' \
    || die "push failed — the target has NOT been fully written; nothing on the source changed"
fi

# ---------------------------------------------------------------------------
# 5. Verify by reading the target back.
#
# The push reporting success is not proof. Comparing the target's actual
# ref SHAs against the source manifest is.
# ---------------------------------------------------------------------------
if [ "$APPLY" -eq 1 ]; then
  step "Verifying the target against the source manifest"
  git ls-remote --heads --tags "$TARGET_URL" \
    | awk '{print $1"\t"$2}' | grep -v '\^{}$' | sort -k2 > "$WORKDIR/target-manifest.txt"
  if diff -u "$WORKDIR/source-manifest.txt" "$WORKDIR/target-manifest.txt"; then
    say "VERIFIED: every branch and tag on the target matches the source exactly."
    say "          branches: $BRANCHES   tags: $TAGS"
  else
    die "MISMATCH — the target does not match the source. The source is
         untouched; investigate before relying on the target."
  fi

  # Matching tips prove the refs arrived. They do not prove the HISTORY behind
  # them arrived, so clone the target back from scratch and re-derive the same
  # commit-set fingerprint. This is the check that would catch a truncated
  # push, and it is the whole reason for doing it after the push rather than
  # trusting the push's own exit status.
  step "Re-cloning the target and comparing full history"
  git clone --mirror "$TARGET_URL" "$WORKDIR/verify.git" >/dev/null 2>&1 \
    || die "could not clone the target back for verification"
  TARGET_COMMITS=$(git -C "$WORKDIR/verify.git" rev-list --all | sort | git hash-object --stdin)
  TARGET_COUNT=$(git -C "$WORKDIR/verify.git" rev-list --all --count)
  TARGET_ROOTS=$(git -C "$WORKDIR/verify.git" rev-list --all --max-parents=0 | wc -l | tr -d ' ')
  say "source: $SOURCE_COMMITS  ($COMMITS commits, $SOURCE_ROOTS roots)"
  say "target: $TARGET_COMMITS  ($TARGET_COUNT commits, $TARGET_ROOTS roots)"
  [ -f "$WORKDIR/verify.git/shallow" ] && die "the target clone is shallow — history did NOT migrate intact"
  if [ "$SOURCE_COMMITS" = "$TARGET_COMMITS" ]; then
    say "VERIFIED: history is preserved — identical commit sets on both sides."
  else
    die "HISTORY MISMATCH — the target's reachable commit set differs from the
         source's. The source is untouched; do not retire it."
  fi
  git -C "$WORKDIR/verify.git" fsck --no-progress --no-dangling \
    || die "the target failed fsck"

  # ---------------------------------------------------------------------------
  # 6. Re-point the local clone.
  #
  # Only after verification. Re-pointing origin before the data is proven to be
  # on the target is how a migration loses work: the clone stops tracking the
  # only complete copy.
  # ---------------------------------------------------------------------------
  step "Re-pointing the local clone at the target"
  if [ -n "${CALLER_REPO:-}" ] && git -C "$CALLER_REPO" rev-parse --git-dir >/dev/null 2>&1; then
    OLD_URL=$(git -C "$CALLER_REPO" remote get-url origin 2>/dev/null || echo '(none)')
    git -C "$CALLER_REPO" remote set-url origin "$TARGET_URL" \
      || die "could not re-point origin in $CALLER_REPO"
    git -C "$CALLER_REPO" fetch origin --prune --tags >/dev/null 2>&1 \
      || say "WARNING: origin re-pointed but the fetch failed — check credentials."
    say "origin: $OLD_URL"
    say "    ->  $(git -C "$CALLER_REPO" remote get-url origin)"
    git -C "$CALLER_REPO" remote -v
    say ""
    say "branches visible from the new origin:"
    git -C "$CALLER_REPO" ls-remote --heads origin | wc -l
  else
    say "(no local clone detected — skipping. Re-point yours by hand:)"
    say "   git remote set-url origin $TARGET_URL"
    say "   git fetch origin --prune --tags"
  fi

  step "Next steps that git cannot do for you"
  say "  1. Set the default branch on the target to 'main' (GitHub settings)."
  say "  2. GitHub Actions minutes: if the target is PRIVATE on a free plan,"
  say "     CI will fail exactly as it does on the source — no runner assigned."
  say "     Make it public, or raise the spending limit. See §6 of the doc."
  say "  3. See docs/MIGRATION_TO_SECOND_ACCOUNT.md for the settings that do"
  say "     not migrate with git (Actions, labels, PR history)."
fi

step "Done"
say "The source repository was not modified."
