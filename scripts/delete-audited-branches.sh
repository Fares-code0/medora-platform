#!/usr/bin/env bash
#
# Delete the 49 remote branches cleared by the 2026-09-08 branch audit.
# See docs/BRANCH_AUDIT_2026-09-08.md for the evidence behind each one.
#
# This script re-proves redundancy immediately before every deletion and
# refuses to touch a protected branch, so it is safe to re-run. It deletes
# branches one at a time — no wildcards, no xargs — so each removal is
# auditable in the output.
#
# Usage:   bash scripts/delete-audited-branches.sh          # dry run
#          bash scripts/delete-audited-branches.sh --apply  # actually delete

set -uo pipefail
APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

PROTECTED="main
frontend
backend
Database
Ai
patient-app
archive/Ai-orphan-37fe5b0
archive/backend-orphan-37fe5b0
archive/frontend-orphan-37fe5b0
claude/medora-dev-auth-access-gz7soi"

git fetch origin --prune

# branch<TAB>proof<TAB>survivor
read -r -d '' BRANCHES <<'EOF'
claude/fix-frontend-production-mock-guard	ancestor	main
claude/medora-auth-refactor-e7aq7m	ancestor	main
claude/medora-git-cleanup-xwuq7w	ancestor	main
claude/medora-mobile-next-task-3myifr	ancestor	main
claude/patient-app-A-08-datetime-coverage	ancestor	patient-app
claude/patient-app-D-06-entry-auth-screens	ancestor	patient-app
claude/patient-app-E-02-durable-preferences	ancestor	patient-app
claude/patient-app-E-04-permission-rows-accuracy	ancestor	patient-app
claude/patient-app-F-01-home-screen-tests	ancestor	patient-app
claude/patient-app-G-02-doctor-pagination	ancestor	patient-app
claude/patient-app-G-04-doctor-profile-tests	content	patient-app
claude/patient-app-H-01-clinic-screen-tests	content	patient-app
claude/patient-app-I-06-appointment-detail-tests	content	patient-app
claude/patient-app-I-08-action-conflict-recovery	ancestor	patient-app
claude/patient-app-J-02-health-records-tests	ancestor	patient-app
claude/patient-app-J-06-release-state-tests	ancestor	patient-app
claude/patient-app-M-05-thread-screen-tests	ancestor	patient-app
claude/patient-app-O-02-unread-tab-badge	ancestor	patient-app
claude/patient-app-P-03-edit-profile-tests	ancestor	patient-app
claude/patient-app-P-08-profile-screen-tests	ancestor	patient-app
claude/patient-app-R-05-error-boundary-tests	ancestor	patient-app
claude/patient-app-S-08-rtl-verification	ancestor	patient-app
claude/patient-app-S-09-a11y-audit	ancestor	patient-app
claude/patient-app-U-06-feature-state-tests	ancestor	patient-app
claude/patient-app-U-10-coverage-reporting	ancestor	patient-app
claude/patient-app-W-01-app-identity	ancestor	patient-app
claude/patient-app-W-12-documentation-sweep	ancestor	patient-app
claude/patient-app-auth-screens-coverage	ancestor	patient-app
claude/patient-app-bundle-budget	ancestor	patient-app
claude/patient-app-deprecation-header	ancestor	patient-app
claude/patient-app-docs-reconciliation	ancestor	patient-app
claude/patient-app-forced-upgrade-gate	ancestor	main
claude/patient-app-form-focus-order	ancestor	main
claude/patient-app-group-a-render-coverage	ancestor	patient-app
claude/patient-app-http-auth-adapter-tests	ancestor	patient-app
claude/patient-app-i18n-foundation	ancestor	patient-app
claude/patient-app-live-appointment-reads	ancestor	patient-app
claude/patient-app-live-doctor-discovery	ancestor	patient-app
claude/patient-app-live-notifications	ancestor	patient-app
claude/patient-app-live-profile-read	ancestor	patient-app
claude/patient-app-onboarding-carousel	ancestor	patient-app
claude/patient-app-optimistic-updates	ancestor	main
claude/patient-app-phi-app-switcher-privacy	ancestor	main
claude/patient-app-recently-viewed	ancestor	main
claude/patient-app-release-runbook	ancestor	patient-app
claude/patient-app-store-privacy	ancestor	patient-app
claude/patient-app-support-route	ancestor	patient-app
claude/patient-app-task-implementation-y4vrly	ancestor	main
claude/patient-app-two-factor	ancestor	patient-app
EOF

# Files whose content proves the three superseded branches redundant.
proof_file() {
  case "$1" in
    claude/patient-app-G-04-doctor-profile-tests)     echo patient-app/src/features/doctors/doctor-profile.test.tsx ;;
    claude/patient-app-H-01-clinic-screen-tests)      echo patient-app/src/features/clinic/clinic-screen.test.tsx ;;
    claude/patient-app-I-06-appointment-detail-tests) echo patient-app/src/features/appointments/appointment-detail.test.tsx ;;
  esac
}

deleted=0; skipped=0
while IFS=$'\t' read -r branch proof survivor; do
  [ -z "$branch" ] && continue

  if grep -qxF "$branch" <<<"$PROTECTED"; then
    echo "REFUSED   $branch — protected"; skipped=$((skipped+1)); continue
  fi
  if ! git show-ref --verify --quiet "refs/remotes/origin/$branch"; then
    echo "ABSENT    $branch — already gone"; continue
  fi

  sha=$(git rev-parse "origin/$branch")

  if [ "$proof" = ancestor ]; then
    if ! git merge-base --is-ancestor "origin/$branch" "origin/$survivor"; then
      echo "REFUSED   $branch — no longer an ancestor of $survivor"; skipped=$((skipped+1)); continue
    fi
    if [ -n "$(git cherry "origin/$survivor" "origin/$branch" | grep '^+')" ]; then
      echo "REFUSED   $branch — has unpatched commits"; skipped=$((skipped+1)); continue
    fi
  else
    f=$(proof_file "$branch")
    if [ "$(git rev-parse "origin/$survivor:$f" 2>/dev/null)" != "$(git rev-parse "origin/$branch:$f")" ]; then
      echo "REFUSED   $branch — $f differs on $survivor"; skipped=$((skipped+1)); continue
    fi
  fi

  if [ $APPLY -eq 1 ]; then
    if git push origin --delete "$branch"; then
      echo "DELETED   $branch ($sha)"; deleted=$((deleted+1))
    else
      echo "FAILED    $branch — push rejected"; skipped=$((skipped+1))
    fi
  else
    echo "WOULD DEL $branch ($sha) — verified redundant vs $survivor"; deleted=$((deleted+1))
  fi
done <<<"$BRANCHES"

echo
[ $APPLY -eq 1 ] && echo "Deleted $deleted, skipped $skipped." \
                 || echo "Dry run: $deleted would be deleted, $skipped skipped. Re-run with --apply."
