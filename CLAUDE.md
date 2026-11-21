# Working agreement

## Repository

This is **`Fares-code0/medora-platform`**, a private repository. It is
independent of `Fares-code0/smart-healthcare-assistant-system`: it was created
on 2026-11-21 from that repository's `main` at `9243b6c` as a fresh history, not
a fork, and the two share no remote, branch or pull request. Do not push to,
open pull requests against, or otherwise change the original repository from
here.

| Tree                         | What it is                                         |
| ---------------------------- | -------------------------------------------------- |
| `backend/`                   | NestJS 10 API, PostgreSQL 16 via Prisma            |
| `frontend/`                  | Doctor/admin web SPA (React)                       |
| `patient-app/`               | Patient mobile client (React Native + Expo)        |
| `docs/`                      | Decisions (`docs/DECISIONS.md`), ADRs and planning |
| `audit-reports/`, `scripts/` | Dated audit records; repository scripts            |

**The database is `backend/prisma/` and nothing else**: the Prisma schema
(`prisma/schema/*.prisma`), the migrations (`prisma/migrations/`) and the seeds
(`prisma/seed*`). This repository has no standalone `database/` SQL or DBML
copy; the one the original repository carried was deliberately left out.
Comments elsewhere that cite `database/medora.dbml` or `database/seed.sql`
refer to the original repository's old `Database` branch design and are
historical. Never edit a migration that has been applied anywhere; add a new
one, and keep `npm --prefix backend run db:check` reporting no difference.

## Git branch and pull request workflow

`main` is the only long-lived branch. It is protected: do not develop on it or
push to it directly. Every independent task gets its own task branch cut from
the latest `main` and its own pull request back into `main`.

```text
main → claude/<short-task-description> → Pull Request → main
```

### Branch naming

`claude/<short-task-description>` — for example `claude/fix-login-page`,
`claude/add-dashboard`, `claude/update-user-schema`.

Never reuse an old task branch for an unrelated task, and never mix unrelated
tasks into one pull request.

### The loop

```text
Task
 ↓ create task branch from the latest main
 ↓ implement
 ↓ run the relevant tests and checks
 ↓ push the task branch
 ↓ open a pull request against main
 ↓ review
 ↓ merge into main
```

### Before starting any task

Check the git state first. Verify, in order:

1. Which branch is checked out
2. Whether the working tree is clean
3. Whether `main` is up to date with `origin/main`
4. Whether uncommitted work exists that must not be overwritten

Never blindly reset, check out over, delete, or overwrite existing work.

### Never

- Push to or develop on `main`
- Reuse an unrelated task branch
- Mix unrelated tasks into one pull request
- Force-push unless explicitly instructed
- Delete someone else's branch
- Reset or discard uncommitted work without explicit approval

### Always

- One dedicated task branch per independent task
- Branch from the latest `main`
- Keep each pull request focused on one task
- Run the relevant checks before opening or updating a pull request
- Report the branch name, base branch, commits, test results, and PR status

### Explicit override

If asked directly to work on a specific branch, follow that instruction for
that task. Otherwise use the task-branch workflow above.

### ADR numbers — check the register before allocating

ADR numbers have collided before, when two branches allocated the same number
without seeing each other. The rule that settled it still applies:

> **`main` keeps the number; the unmerged branch renumbers.** A number on `main`
> is published and may already be cited; a number on a branch is not.

Before allocating a number, check `main`'s register and any open branch that
edits it:

```bash
git grep -h '^## ADR-' origin/main -- docs/DECISIONS.md | sort -u
```

The register's highest entry is **ADR-044**. ADR-040 to ADR-043 are not in the
register but are cited across `docs/` (ADR-042 is a draft at
`docs/multi-hospital/ADR-042-DRAFT.md`), so treat them as taken. The register itself
names the next unallocated number (`docs/DECISIONS.md`, near the top; ADR-045
as of 2026-11-21). ADR-031 and ADR-033 are *proposed*, not accepted.

## Quality gates

Run the suite for the tree you touched before opening or updating a pull
request. The gate is zero errors (the 20 pre-existing `react-refresh` warnings
on the frontend are accepted). It was 21 until the dead `features/auth/i18n/`
re-export shims were deleted — one of them was a warning site. The number is a
ceiling, not a target: it should only ever go down.

```bash
npm --prefix frontend run typecheck && npm --prefix frontend run lint && npm --prefix frontend run test && npm --prefix frontend run build
```

```bash
npm --prefix backend run typecheck && npm --prefix backend run lint && npm --prefix backend run test && npm --prefix backend run build
```

```bash
npm --prefix patient-app run typecheck && npm --prefix patient-app run lint && npm --prefix patient-app run test && npm --prefix patient-app run build
```

The patient app's `build` is `expo export`, which runs the same Metro bundle a
release build does — so a module that resolves under Jest but not under Metro
fails at the gate rather than in a store submission.

CI (`.github/workflows/ci.yml`) runs on every branch and pull request and
path-filters the three suites, so a backend-only change does not report green
having run the frontend suite.

Two cross-tree exceptions to the path filter, both because a parity spec in one
tree loads another tree's source directly:

- `frontend/src/types/auth/`, `features/admin/permissions.ts` and
  `utils/phi-mask.ts` also run the **backend** suite;
- `backend/prisma/schema/01-enums.prisma` and `backend/src/modules/auth/dto/`
  also run the **patient-app** suite, whose `src/test/parity.test.ts` reads them
  to prove the status vocabularies and the password policy have not drifted.

## Strict Execution Scope and User Authorization

These rules govern how a task is executed. They do not replace the branch
workflow or quality gates above; where an action those sections describe
(creating a task branch, pushing, opening a pull request) is not explicitly
authorized for the task at hand, the authorization rule below applies first.

### 1. Exact scope only

- Execute only what the user explicitly requests.
- Never expand the task, introduce additional improvements, or make independent
  decisions that change the requested scope.
- Do not fix unrelated bugs, refactor code, reorganize files, rename unrelated
  variables, or modify unrelated components.
- If an unrelated issue is discovered, report it without fixing it.

### 2. Minimal changes

- Make the smallest possible change that fully satisfies the request.
- For color or theme changes, modify only the specifically requested existing
  color names, values, or tokens.
- Preserve existing architecture, layouts, component behavior, functionality,
  and styling outside the requested scope.
- Never redesign or rebuild an existing system when a targeted edit is
  sufficient.

### 3. Brief pre-execution assessment

- Before editing, identify the exact task, target files, intended changes, and
  necessary verification.
- For simple tasks, keep this assessment brief and proceed without unnecessary
  investigation.
- Ask for clarification before proceeding if the task is ambiguous or cannot be
  completed within the authorized scope.
- Do not inspect unrelated areas of the repository without a specific technical
  reason.

### 4. Efficient execution

- Treat small tasks as small tasks.
- Avoid unnecessary searches, repeated file inspections, broad audits, full
  builds, and complete test suites when a focused check is sufficient.
- For simple, localized changes, aim for approximately 1–5 minutes when
  technically feasible.
- If an unexpected obstacle prevents efficient completion, explain the obstacle
  and ask before expanding the scope.
- Never sacrifice correctness merely to meet a time target.

### 5. Explicit authorization required

Unless the user explicitly authorizes the relevant action, do not:

- Create, switch, rename, or delete Git branches.
- Commit, push, or modify remote repositories.
- Create, edit, or merge pull requests.
- Deploy or trigger deployments.
- Modify CI/CD, GitHub Actions, Vercel configuration, or environment variables.
- Install, remove, or upgrade dependencies.
- Change databases, schemas, migrations, or stored data.
- Modify backend or AI functionality when the task is limited to the frontend.
- Perform broad automated rewrites or formatting.
- Delete, reset, stash, or overwrite user changes.

### 6. Preserve existing instructions and user work

- Preserve the entire existing `CLAUDE.md` content.
- Do not replace, rewrite, shorten, or remove existing instructions.
- Add new sections only, making the smallest necessary documentation change.
- Avoid duplicating an equivalent section if it already exists; inspect it and
  report the situation before deciding whether an update is necessary.
- Respect all existing repository instructions and applicable higher-priority
  instructions.

### 7. Stop at completion

- Once the explicitly requested task is complete and appropriately verified,
  stop immediately.
- Do not continue into another task, milestone, checklist item, refactor, or
  improvement without authorization.
- Do not invent extra work to make the task appear more comprehensive.

### 8. Honest reporting

After completion, report:

- The exact files changed.
- The sections or code changed.
- Whether existing content was preserved.
- The verification performed and its actual result.
- Any unresolved issue.

Never claim verification succeeded unless it was actually performed.

### 9. Deployment restriction

No deployment is authorized by default. Do not deploy anything unless the user
explicitly requests and authorizes the deployment.

### 10. Core rule

The user's explicit instructions define the authorized scope. Your judgment
alone is not permission to perform additional work. If an action falls outside
the requested scope, do not perform it; ask first.
