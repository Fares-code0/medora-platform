# Medora — Audit Coverage and Evidence

This report records what was actually inspected, by what method, and what was not. It
is written so that another engineer can reproduce the investigation and judge how far
each conclusion can be trusted.

**The whole project was not audited line by line.** Sections 5 and 6 say precisely where
the audit was deep, where it sampled, and where it did not look.

## 1. Engagement boundary

Audit only. During the audit:

- No tracked file was modified, created, deleted, renamed or formatted.
- No branch, commit, tag, stash, merge, rebase, checkout, reset or push was performed.
- No dependency was installed, upgraded or removed.
- No migration, seed, reset or database command was run; no database was contacted.
- Nothing was deployed and no deployment, hosting, CI or environment setting was touched.
- No email, notification or message was sent; no external account was changed.
- The contents of `frontend/.env.local` (git-ignored) were not read. No `.env` file
  exists in `backend/` or `patient-app/`.

The only files written inside the repository are the nine reports in
`audit-reports/2026-11-09-full-system-audit/`. That directory did not exist beforehand,
is not tracked and is not ignored. Section 9 lists the git-ignored build artefacts that
the executed checks regenerated.

Network access was used once, read-only: `npm audit`, which sends dependency names and
versions to the public npm advisory service.

## 2. Repositories and roots discovered

| Item | Value |
| --- | --- |
| Repository root | `<repo-root>` |
| Remote | `origin` → `github.com/Fares7324/smart-healthcare-assistant-system.git` |
| Worktrees | One (the root) |
| Submodules / nested repositories | None (`.gitmodules` absent) |
| Workspace manager | None; three independent npm packages |
| Project roots | `backend/`, `frontend/`, `patient-app/`, plus `docs/`, `scripts/`, `.github/` |
| Commits on `HEAD` | 1,179 |

## 3. Repository state at start and end

### Start (2026-11-09, before any inspection)

| Item | Value |
| --- | --- |
| Branch | `claude/emr-visual-redesign` |
| `HEAD` | `ad4c6a8d26c421fb2c123caab6fd9f017566e634` — "Merge pull request #205 from Fares7324/fix/patient-app-sdk58-jest29" (2026-11-07) |
| Relation to remotes | Identical to `origin/frontend`; 4 commits ahead of and 1 behind `origin/main` (`58b229e9`) |
| Staged changes | 0 |
| Modified (unstaged) | 92 |
| Deleted (unstaged) | 1 — `frontend/src/features/auth/components/AuthThemeToggle.tsx` |
| Untracked | 13 |
| Stashes | 0 |
| `git diff --stat` | 93 files changed, 3,652 insertions, 1,076 deletions |
| SHA-1 of `git diff` output | `0a68145318f4f4a80cb629de573d4737e04ab02e` |
| SHA-1 of `git status --porcelain=v1` output | `cac707131a77fe5ed0006e56db5f8727c6fbefc7` |

**Pre-existing user changes, protected throughout.** By area: `frontend/` 98 paths,
`backend/` 4, `docs/` 2, `patient-app/` 2. The full list was saved outside the repository
at the start and compared at the end. These changes were read where relevant (for
example the route-matrix snapshot) and never written to.

### End

Inspected again on 2026-11-10 at 00:13 local time, after the last command.

| Item | Value | Same as start? |
| --- | --- | --- |
| Branch | `claude/emr-visual-redesign` | Yes |
| `HEAD` | `ad4c6a8d26c421fb2c123caab6fd9f017566e634` | Yes |
| Local branch tips | `frontend` `ad4c6a8d`, `main` `0e3ee9f5`, `patient-app` `4bc1d7ee`, `update-frontend` `69a55bb6` | Yes |
| Staged changes | 0 | Yes |
| Stashes | 0 | Yes |
| Worktrees | 1 | Yes |
| `git diff --stat` | 93 files changed, 3,652 insertions, 1,076 deletions | Yes |
| SHA-1 of `git diff` output | `0a68145318f4f4a80cb629de573d4737e04ab02e` | **Identical** |
| `git status` entries other than the audit directory | 106 | **Identical**, line for line |
| New untracked entries | The nine files in `audit-reports/2026-11-09-full-system-audit/` | Expected |

The byte-identical `git diff` hash shows that no tracked file changed during the audit,
including the 93 files that already carried uncommitted work.

## 4. Project inventory

Tracked files: **2,510**.

| Area | Tracked files | Source measured (tracked `.ts`/`.tsx`/`.prisma`/`.sql`) |
| --- | ---: | --- |
| `frontend/` | 1,257 | `src/`: 1,182 files, about 184,000 lines (284 test files) |
| `backend/` | 803 | `src/`: 529 files, about 76,400 lines (75 unit specs). `test/`: 111 files, about 46,900 lines (104 e2e specs). `prisma/`: 55 files, about 11,900 lines |
| `patient-app/` | 355 | `src/`: 325 files, about 58,200 lines (111 test suites) |
| `docs/` | 87 | Markdown |
| Other | 8 | `README.md`, `CLAUDE.md`, `.gitignore`, `.github/workflows/ci.yml`, two shell scripts, `.claude/launch.json`, `.superpowers/sdd/progress.md` |

Other counts: 150 Markdown files, 3 lockfiles, 14 binary image or font assets, 111
Prisma models, 80 enums, 31 migrations, 289 API routes, 19 backend domain modules.

Not reviewed line by line, by design: `node_modules/` (third-party), `backend/src/generated/`
(generated Prisma client, git-ignored), `dist/` outputs, lockfile contents (used through
`npm audit`), binary assets, `.history/` (local editor history, git-ignored).

## 5. Coverage matrix

Depth key — **Full**: every relevant file read. **Targeted**: key files read in full,
the rest covered by structured search. **Sampled**: representative files and searches
only. **Inventory**: listed and sized, contents not reviewed. **None**: not inspected.

### Backend

| Area | Depth | Method | Evidence produced |
| --- | --- | --- | --- |
| Bootstrap, root module (`main.ts`, `app.module.ts`) | Full | Read | Architecture map |
| Configuration (`config/env.schema.ts`, security headers, body limits) | Full | Read | MED-SEC-002, -003 |
| Error handling, logging, redaction (`common/`) | Targeted | Read filter and redaction lists | Sound-controls table |
| Authentication (`modules/auth`) | Targeted | Controllers, cookie, token, refresh, session, login gates read; invitation, recovery, 2FA services searched | MED-SEC-001, -007, -008 |
| Authorization kernel (`shared/authz`) | Full | Guard, resolver, scope services, catalogue, repositories read | Isolation analysis |
| Route authorization table | Full | Read all 289 rows of the generated snapshot | MED-BE-004, feature matrix |
| Patients (`modules/patients`) | Targeted | Controller rationale; scope-call enumeration in both services; `create` read | Isolation analysis |
| Appointments | Targeted | Booking path, conflict checker, repository create, patient controller read; schema model read | MED-DB-001, MED-MOB-001 |
| Files and storage kernel | Targeted | Access service, upload service, scan gate, policy, module bindings read | MED-BE-001 |
| AI (`modules/ai`, `shared/ai`) | Full | All service, controller, port and module files read | MED-AI-001 to -005 |
| Platform settings | Sampled | Backup service read; integration probe and SSRF guard searched | MED-OPS-001 |
| Search, health, rate limit | Targeted | Scope logic, indicator wiring, guard and limiter read | MED-BE-002, MED-SEC-003 |
| Jobs kernel | Sampled | Configuration and file listing | MED-BE-006 |
| Labs, pharmacy, medical records, messaging, notifications, reports, doctors, users, dashboard, administration, audit, settings | **Sampled** | Route table, targeted searches (`501`, raw SQL, policy consumers), individual excerpts | MED-BE-003, -005; **defects in these modules could have been missed** |
| e2e specs (`backend/test`, 104 files) | Inventory + 1 read | File list; `auth-mobile-client.e2e-spec.ts` read in part | Test-gap evidence |
| Dockerfile, compose, seed | Full | Read | MED-OPS-002, MED-SEC-002 |

### Database

| Area | Depth | Method |
| --- | --- | --- |
| Prisma schema (13 files) | Targeted | `07-scheduling.prisma` read; all files parsed by script for models, relations, indexes, soft delete |
| Migrations (31, about 5,300 lines of SQL) | **Sampled** | Directory listing; search for exclusion constraints; not read in full; not applied |
| Seeds | Targeted | Guards and structure read; data files not reviewed |
| Raw SQL call sites (19) | Full | Each located and classified |
| Live database | **None** | No database available |

### Web frontend

| Area | Depth | Method |
| --- | --- | --- |
| Manifest, Vite/Vitest/ESLint/TS configuration, `vercel.json` | Full | Read |
| Environment and seam (`configs/env.ts`, `api/seam.ts`) | Full | Read |
| HTTP client (`api/client.ts`) | Targeted | Searched for token, timeout, refresh behaviour |
| Auth provider and route guards | Targeted | Idle lock, guards read |
| Every `selectService` call site | Full | Enumerated by search |
| Admin routing and live/demo gating | Full | Read |
| AI seam | Full | Read |
| Feature pages and components (`features/doctor` 508 files, `features/admin` 195, `components/` 150+) | **Sampled** | Pattern scans across all non-test source; individual files not read |
| Accessibility, responsive behaviour, RTL, visual consistency | **None by observation** | The application was not rendered; existence of automated tests noted |
| Design constraints (card edges, collapsed sidebar) | Search only | No rendering; see `FULL_TECHNICAL_AUDIT.md` §3 |

### Patient application

| Area | Depth | Method |
| --- | --- | --- |
| Manifest, `app.json`, `eas.json`, `.env.example` | Full | Read |
| Environment validation | Full | Read |
| API seam and client | Targeted | Seam read; client searched |
| Every feature service selection | Full | Enumerated and read |
| Appointment HTTP adapter, AI availability, emergency service | Full | Read |
| Secure storage | Targeted | Read |
| Screens, components, navigation, i18n | **Sampled** | File listing and searches |
| Device behaviour (permissions, deep links, offline, lifecycle) | **None by observation** | No device or simulator |
| Expo SDK / React Native compatibility against upstream | **None** | Versions recorded; not checked against release notes |

### Cross-cutting

| Area | Depth | Method |
| --- | --- | --- |
| CI workflow | Full | Read all 363 lines |
| Branch topology | Full | Measured by command for all remote integration branches |
| Other branches' content | Targeted | `git show` / `git diff` on named files only |
| Documentation (150 files) | **Sampled** | Root README, `CLAUDE.md`, the first 140 lines of `docs/FE-10-INTEGRATION-STATUS.md`, file listing. The multi-hospital plan, phase documents, API contract and roadmap were **not** read. |
| Secrets | Targeted | Pattern scan of tracked files; names of files ever added on any ref |
| Dependencies | Executed | `npm audit`, both production-only and full |

## 6. Areas inspected only partially, and exclusions

| Area | Why | Risk left open |
| --- | --- | --- |
| Twelve backend domain modules (about 35,000 lines) | Time; prioritised authentication, authorization, AI, files and booking | Business-logic and authorization-usage defects inside those modules |
| Migrations | Not applied; not read in full | Ordering, reproducibility, trigger correctness |
| Web and mobile UI code | Volume (about 240,000 lines) | Rendering, state, accessibility and UX defects |
| Documentation corpus | Volume | Further contradictions beyond those reported |
| `origin/backend`, `origin/patient-app` trees | Compared by file list and named files only | Defects introduced or fixed there |
| Full git-history secret scan | No dedicated scanner run | A secret committed and later removed |
| Third-party dependency internals | Out of scope by design | Covered only through advisories |
| Generated code, build outputs, binary assets | Excluded by design | None material |

## 7. Commands executed

All from Git Bash. Read-only unless noted. Outputs are summarised; raw logs were kept in
a session scratch directory outside the repository.

### Repository state and inventory

| Command | Result |
| --- | --- |
| `git rev-parse --show-toplevel`, `git branch --show-current`, `git rev-parse HEAD`, `git log -1` | Section 3 |
| `git worktree list`; test for `.gitmodules` | One worktree; no submodules |
| `git status --porcelain=v1 --untracked-files=all`; `git diff --stat`; `git diff --cached --name-only`; `git stash list` | Section 3 |
| `git ls-files` with counts by directory | Section 4 |
| `git branch -a --format=…` | 5 local branches, 19 remote branches |
| `git rev-list --left-right --count A...B` for each integration branch | MED-ARCH-001 |
| `git diff --stat` / `--name-only HEAD...origin/backend` | 177 files, +18,768 / −328 |
| `git log --oneline origin/main..origin/<branch>` | Branch contents |
| `git show <ref>:<path>` on `auth.controller.ts`, `file-storage.module.ts`, `health.module.ts`, `package.json` files, `ci.yml` | Cross-branch comparison |
| `git log --all --diff-filter=A --name-only` filtered for env and key files | Only `.env.example` files |
| `git grep -nIE <secret patterns>` | No match |
| `git shortlog -sn HEAD`, `git rev-list --count HEAD` | Authorship counts |
| `git archive HEAD frontend \| tar -x` into the scratch directory | Clean export used for one test (section 9) |

### Inspection

Files were read with a file viewer and with `grep`, `sed -n`, `wc`, `ls`. One Node
script parsed the Prisma schema for unindexed foreign keys. `node -e` read the three
`package.json` files. `docker ps`, `docker --version`, `netstat` and `node -v` established
the environment.

### Verification

| Command | Exit | Summary |
| --- | ---: | --- |
| `npm --prefix backend run typecheck` | 0 | Clean |
| `npm --prefix backend run lint` | 0 | Clean |
| `(cd backend && npx vitest run src)` | 1 | 941 passed, 1 failed, 17 skipped |
| `npm --prefix frontend run typecheck` | 0 | Clean |
| `npm --prefix frontend run lint` | 0 | 0 errors, 20 warnings |
| `npm --prefix frontend run test` | 1 | 3,142 passed, 10 failed, 3 skipped |
| `npx vitest run <8 files>` (frontend) | 1 | 37 passed, 1 failed |
| `npx vitest run …/NewMedicalRecordPage.test.tsx` (working tree, then clean `HEAD` export) | 1, 1 | Same single failure both times |
| `npm --prefix frontend run build` | 0 | Built |
| `npm --prefix patient-app run typecheck` | 0 | Clean |
| `npm --prefix patient-app run lint` | 0 | Clean |
| `npm --prefix patient-app run test` | 1 | 2,049 passed, 55 failed |
| `npx jest <4 suites>` (patient-app) | — | Stopped after 19 minutes; one suite had failed again |
| `npx jest …/recent-activity.test.tsx` (alone) | 0 | 7 passed |
| `timeout 540 npx jest …/appointments-screen.test.tsx` (alone) | 124 | Did not finish |
| `npm audit --omit=dev --json`, `npm audit --json` in each package | 0 | MED-CI-002 |

`TESTING_AND_QUALITY_REPORT.md` has the full results and the list of checks not run.

## 8. Missing access and environmental limitations

| Limitation | Effect |
| --- | --- |
| No PostgreSQL, Redis or object store; Docker daemon not running | API never started; e2e suite, migrations, drift check not run; no dynamic reproduction |
| Node 24.18 only (project targets 20 and 22.13) | One web test failure, and possibly the patient-app failures, may be runtime-specific |
| Windows | One backend spec fails for a path-separator reason |
| No GitHub API or repository-settings access | Branch protection, required checks and CI run history not observed |
| No deployed environment | Hosting, TLS, headers as served, backups not observable |
| No device, simulator or browser session | No visual, accessibility or platform verification |
| Model knowledge of package versions | Expo 58, React Native 0.88, React 19.3, Prisma 7, Zod 4 and others were recorded from manifests; their upstream compatibility and advisory details were not independently verified |

## 9. Side effects of the executed checks

Disclosed for completeness. None touches a tracked file.

| Path | Git status | What happened |
| --- | --- | --- |
| `frontend/dist/` | Ignored; existed before | **Regenerated** by `npm run build`. If the previous contents were a demo build (`build:demo`), re-run that command to restore them. |
| `frontend/tsconfig.app.tsbuildinfo`, `frontend/tsconfig.node.tsbuildinfo` | Ignored; existed before | Updated by `tsc -b` |
| Test-runner and bundler caches under each `node_modules/` | Ignored | Updated |
| `backend/dist/`, `patient-app/dist/`, `patient-app/.expo/` | Ignored | Untouched (timestamps predate the audit) |
| Session scratch directory outside the repository | Not in the repository | Logs, the saved status baseline, a temporary export of `HEAD:frontend`. A directory junction to `frontend/node_modules` was created there for one test run and removed with `rmdir`; `frontend/node_modules` was confirmed intact afterwards (454 entries, as before). |

## 10. Findings that require human validation

| Finding | What a human should do |
| --- | --- |
| MED-SEC-001 | Reproduce on a local stack (security report §9, step 1) before and after the fix |
| MED-DB-001 | Reproduce with concurrent requests; run the pre-flight overlap query on any existing data |
| MED-SEC-005 | Supply and review the hosting design |
| MED-DB-002 | Validate each candidate index with query plans on realistic data |
| MED-TEST-004 | Re-run the web and patient-app suites on Node 20 and Node 22 to separate runtime effects from genuine failures |
| MED-CI-002 | Triage each advisory for reachability |
| MED-BE-004, MED-FE-001 | Confirm intended scope per role and per admin section |
| All "VERIFIED (static)" checklist items | Re-confirm on a deployed stack |
| Design constraints | Visually review the uncommitted UI work against the two standing rules |
| Clinical and legal matters | AI intended use, emergency content, retention, processors — outside an engineering audit |
| CI status of `ad4c6a8d` | Check GitHub Actions |
| Unsampled backend modules | A focused review of labs, pharmacy, medical records and messaging is recommended before release |

## 11. Unexpected changes

None in the repository. The only differences between the start and end states are the
nine new report files, which were intended.

Two things happened outside the repository's tracked state that are worth knowing:

1. `frontend/dist/` and two `*.tsbuildinfo` files (all git-ignored) were regenerated by
   the build and typecheck commands, as section 9 describes.
2. A background re-run of four patient-app suites was stopped before finishing and left
   nine Jest worker processes running. They were identified by process id and command
   line and ended. A later single-suite run was ended by its own time limit. A final
   process listing showed no Jest process remaining.
