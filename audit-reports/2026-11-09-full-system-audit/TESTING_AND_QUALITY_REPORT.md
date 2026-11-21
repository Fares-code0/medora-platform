# Medora — Testing and Quality Report

Audit date 2026-11-09. This report separates what was **executed** from what was only
**read**. Anything not listed under "Checks executed" was not run.

## 1. Execution environment

| Item | Value |
| --- | --- |
| Machine | Windows 11, Git Bash |
| Node.js | **v24.18.0** (CI uses Node 20; `origin/patient-app` requires ≥ 22.13) |
| npm | 11.16.0 |
| Tree under test | Working tree of `claude/emr-visual-redesign` at `ad4c6a8d`, **including 92 modified, 1 deleted and 13 untracked files** |
| Dependencies | Existing `node_modules` in all three packages; nothing installed, upgraded or removed |
| PostgreSQL / Redis / object store | **Not available.** The Docker daemon was not running; no service listened on 5432 or 6379; none was started. |
| Concurrency | The first web and patient-app test runs overlapped with each other and with the backend run. This matters; see section 4. |

Two consequences follow. The results describe the **uncommitted working tree**, not a
commit, except where a clean export of `HEAD` is named. And they come from a Node major
that neither CI nor the project's declared engines target.

Every command was checked beforehand for side effects. None modifies a tracked file:
`tsc --noEmit`, ESLint without `--fix`, Vitest, Jest, and a Vite build that writes only
to the git-ignored `frontend/dist`. No `--fix`, `format`, `install`, `db:*`, `expo
export` or deploy command was run.

## 2. Checks executed

### 2.1 Backend

| # | Command (from `backend/`) | Exit | Result |
| --- | --- | ---: | --- |
| B1 | `npm run typecheck` (`tsc --noEmit`) | 0 | Clean |
| B2 | `npm run lint` (`eslint .`) | 0 | Clean, no warnings printed |
| B3 | `npx vitest run src` — the `src/**/*.spec.ts` subset only | 1 | 76 files: 72 passed, 4 failed. 959 tests: 941 passed, 1 failed, 17 skipped. 46 s. |

B3 is **not** the project's gate. `npm run test` also runs `test/**/*.e2e-spec.ts` (104
files), which boot the real application against PostgreSQL and Redis and were not run.

Failures in B3:

| File | Cause | Classification |
| --- | --- | --- |
| `src/modules/ai/ai-containment.spec.ts` — "only shared/ai and config read the provider credential" | The spec filters paths with `startsWith('shared/ai/')`; on Windows the collected paths are `shared\ai\…`, so three legitimate files are reported as offenders | **MED-TEST-002** — test portability defect. Expected to pass on Linux CI (not observed). |
| `src/shared/authz/redis-permission-cache.spec.ts` (9 skipped) | `ECONNREFUSED ::1:6379` in `beforeAll`, 10 s timeout | **MED-TEST-003** — needs a live Redis |
| `src/shared/rate-limit/redis-rate-limiter.spec.ts` (4 skipped) | same | MED-TEST-003 |
| `src/shared/jobs/bullmq-job-queue.spec.ts` (4 skipped) | same | MED-TEST-003 |

The 17 skipped tests are exactly those three files. No genuine logic failure was
observed in the 941 passing tests.

### 2.2 Web frontend

| # | Command (from `frontend/`) | Exit | Result |
| --- | --- | ---: | --- |
| F1 | `npm run typecheck` (`tsc -b --noEmit`) | 0 | Clean |
| F2 | `npm run lint` (`eslint . && node scripts/check-retired-tokens.mjs`) | 0 | 0 errors, **20 warnings** (all `react-refresh/only-export-components`); token check passed |
| F3 | `npm run test` (`vitest run`), full suite, overlapping other runs | 1 | 294 files: 286 passed, **8 failed**. 3,155 tests: 3,142 passed, **10 failed**, 3 skipped. 748 s. |
| F4 | `npx vitest run <the 8 failed files>`, nothing else running | 1 | 8 files: 7 passed, 1 failed. 38 tests: 37 passed, **1 failed**. 49 s. |
| F5 | `npx vitest run src/features/doctor/medical-records/pages/NewMedicalRecordPage.test.tsx` | 1 | 10 tests: 9 passed, 1 failed (same test) |
| F6 | The same file from a clean `git archive HEAD frontend` export in the scratch directory | 1 | 10 tests: 9 passed, 1 failed (same test, same error) |
| F7 | `npm run build` (`tsc -b && vite build`) | 0 | Built in 27 s. Entry chunk 318 kB (95 kB gzip); React vendor chunk 202 kB (66 kB gzip); per-route chunks; source maps emitted |

Interpretation of the failures:

- **Nine of the ten F3 failures were load-induced timeouts.** All reported
  `Test timed out in 5000ms` or `15000ms`, and all nine passed in F4. The files were
  `live-oversight.test.tsx`, `GeneralPanels.test.tsx`, `live-notifications-page.test.tsx`,
  `AddPatientDialog.test.tsx`, `PrescriptionNotesSection.test.tsx`,
  `ThemePlaygroundPage.test.tsx` and `src/i18n/logical-properties.test.ts`.
- **One failure is deterministic on this machine:**
  `NewMedicalRecordPage.test.tsx` › "a record created without its note says so and goes
  to it, rather than inviting a duplicate". It fails identically in the working tree
  (F4, F5) and in a clean export of `HEAD` (F6), so it is **not** caused by the
  uncommitted changes. The run reports
  `TypeError: RequestInit: Expected signal ("AbortSignal {}") to be an instance of AbortSignal`,
  raised in `@remix-run/router` `createClientSideRequest` when React Router constructs a
  `Request` during navigation. That is Node 24's built-in `fetch` rejecting jsdom's
  `AbortSignal`. The navigation never happens, so the assertion on the destination
  heading fails. Whether it passes on CI's Node 20 was not observed. Recorded under
  **MED-TEST-004** and **MED-CI-003**.

### 2.3 Patient application

| # | Command (from `patient-app/`) | Exit | Result |
| --- | --- | ---: | --- |
| P1 | `npm run typecheck` (`tsc --noEmit`) | 0 | Clean |
| P2 | `npm run lint` (`eslint .`) | 0 | Clean |
| P3 | `npm run test` (`jest`), full suite, overlapping other runs | 1 | 111 suites: 107 passed, **4 failed**. 2,104 tests: 2,049 passed, **55 failed**. 2,296 s. |
| P4 | `npx jest <the 4 failed suites>`, nothing else running | — | Stopped after 19 minutes without finishing. One suite had reported: `appointments-screen.test.tsx` failed again, 10 tests, 779 s. |
| P5 | `npx jest src/features/home/recent-activity.test.tsx`, alone | 0 | 7 of 7 passed in 6.5 s |
| P6 | `timeout 540 npx jest src/features/appointments/appointments-screen.test.tsx`, alone | 124 | **Did not finish** within 9 minutes; no result printed |

Failing suites in P3: `src/features/home/recent-activity.test.tsx`,
`src/features/appointments/appointments-screen.test.tsx`,
`src/features/health/documents-prescriptions.test.tsx`,
`src/features/health/health-records.test.tsx`. Every failure has the same shape: a
`waitFor` asserting that a loading indicator has gone
(`…-list-loading`, `health-<section>-loading`) expired, with explicit timeouts of up to
10 s. The suite's wall-clock time (38 minutes, against the "about nine seconds" the CI
workflow comment describes) shows the run was badly starved.

**What P4 to P6 show.** The `recent-activity` failures in P3 were load-induced: the
suite passes alone in seconds. `appointments-screen.test.tsx` is different. It failed
again when run with only three other suites, and did not complete at all when run
alone under a nine-minute limit. The two health suites use the same "query has
settled" helper and failed the same way in P3; they were not re-run alone, so their
classification is open.

**The cause was not determined.** The CI workflow comment says this whole suite takes
"about nine seconds", and commit `09a8c538` moved it to Jest 29 specifically "to clear
the PR #198 timeouts", so slow or hanging runs have a history here. The audit machine
runs Node 24 on Windows, a runtime the project does not target (Node 20 in CI at
`HEAD`, ≥ 22.13 on `origin/patient-app`). This is therefore **not evidence of a product
defect**, and equally not evidence that the suite is healthy. It needs a re-run on a
supported runtime (MED-TEST-004, MED-CI-003, MED-MOB-002).

The four-suite run left nine Jest worker processes behind when it was stopped; they
were ended by process id. No Jest process was running at the end of the audit.

### 2.4 Supply chain

| # | Command | Result |
| --- | --- | --- |
| S1 | `npm audit --omit=dev --json` in each package | `backend`: 3 moderate. `frontend`: 1 high, 2 moderate. `patient-app`: 1 high, 5 moderate. |
| S2 | `npm audit --json` in each package | `backend`: 32 (8 high). `frontend`: 28 (3 critical, 8 high). `patient-app`: 29 (1 high). |

`npm audit` queries the public npm advisory service and sends dependency names and
versions; it changes nothing. Package names are in MED-CI-002. Individual advisories
were not triaged.

### 2.5 Static analyses run by script

| # | Analysis | Result |
| --- | --- | --- |
| A1 | Foreign-key fields without a leading index, over `backend/prisma/schema/*.prisma` | 75 of 187 (MED-DB-002) |
| A2 | Unsafe HTML sinks in `frontend/src` (non-test) | 0 |
| A3 | `any`, `@ts-ignore`, `eslint-disable` in `frontend/src` (non-test) | 6, 0, 7 |
| A4 | `TODO`/`FIXME`/`HACK`/`XXX` | `backend/src` 1; `frontend/src` 0; `patient-app/src` 0 |
| A5 | Secret patterns in tracked files; env or key files ever added on any ref | none found |
| A6 | Branch divergence (`git rev-list --left-right --count`) | see MED-ARCH-001 |

## 3. Checks not executed

| Check | Why not | What it would establish |
| --- | --- | --- |
| Backend e2e suite (104 specs) | Needs PostgreSQL 16 and Redis 7; starting services was outside the audit boundary | Server behaviour, authorization matrix, isolation, every status machine |
| `npm run db:check`, `db:deploy`, `db:seed` | Migration and seed commands were prohibited; also need a database | Schema/migration agreement; that migrations apply |
| `npm --prefix backend run build` (`nest build`) | Writes `backend/dist`, which already existed; typecheck was judged sufficient | Build reproducibility |
| The three `test:*-safety` 100%-coverage scripts | Time; they are subsets of B3's passing specs | Coverage thresholds on safety-critical modules |
| `npm --prefix patient-app run build` (`expo export --clear`) | Long-running; clears the Metro cache; not needed to support any finding | That the release bundle builds; bundle-budget test |
| Coverage reports | Would double the run time; coverage percentage was not needed for any finding | Line and branch coverage |
| Storybook build | Not part of the gate | Component workbench |
| Any run on Node 20 or 22 | Only Node 24 was installed | Whether F5 and P3 failures reproduce on supported runtimes |
| Any device, simulator or browser run | No environment | Real rendering, accessibility, platform behaviour |
| GitHub Actions results | Not observable from the working copy | Whether CI is green on `ad4c6a8d` |

## 4. Existing automated test suites

| Package | Runner | Files | Scope | Notes |
| --- | --- | ---: | --- | --- |
| `backend` unit | Vitest + SWC | 75 tracked `*.spec.ts` (76 run, one untracked) | Pure logic, guards, resolvers, schemas, structural rules | Three need Redis |
| `backend` e2e | Vitest + Supertest | 104 `*.e2e-spec.ts` | Real Nest application, real PostgreSQL, real Redis | Includes a generated route-by-role authorization snapshot and a module-boundary test |
| `frontend` | Vitest + Testing Library + jsdom | 284 tracked test files (294 run) | Components, pages, HTTP adapters against captured bodies, design-token and contrast rules, i18n | Roughly one test file per three source files |
| `patient-app` | Jest (`jest-expo`) + RN Testing Library | 111 suites | Screens, adapters, security and store-privacy rules, parity with backend sources, documentation consistency | |
| Cross-tree parity | In each client's suite | — | Client vocabularies and password policy versus backend sources read from disk | Skips silently when the other tree is absent (`describe.skip`) |

### Quality of the tests, by reading

Strengths observed:

- The backend's e2e approach tests the shipped configuration: the harness applies the
  same header, CORS and body-limit functions as `main.ts`.
- The authorization snapshot (`backend/test/authz-route-matrix.snapshot.txt`) turns
  "who can reach what" into a reviewable diff.
- Client tests assert failure behaviour, not only success: a failed load must render as
  a failure, never as an empty list.
- Structural tests guard decisions that code review tends to miss: AI containment, the
  mock/live seam, "no fixture in production", "no emergency number hardcoded".

Weaknesses observed:

| Weakness | Evidence | Finding |
| --- | --- | --- |
| No test crosses a client and the real API | No Playwright, Cypress, Detox or Maestro configuration | MED-TEST-001 |
| Client contract tests use captured bodies that can drift from the server | `docs/FE-10-INTEGRATION-STATUS.md`, "captured bodies"; branches at different commits | MED-TEST-001, MED-ARCH-001 |
| A security test exercises the vulnerable path and asserts nothing about it | *[withheld: security-sensitive]* | MED-SEC-001 |
| No concurrency test for booking | `backend/test/appointments-book.e2e-spec.ts` | MED-DB-001 |
| Timing-dependent assertions | F3, P3 | MED-TEST-004 |
| Path-separator assumption makes a structural guard vacuous on Windows | `ai-containment.spec.ts:234-256` | MED-TEST-002 |
| Redis-dependent specs in the unit glob | section 2.1 | MED-TEST-003 |
| No AI behaviour tests | Only prompt-string and structure specs | MED-AI-002 |
| No coverage threshold on the patient app | `ci.yml:310-312`, deliberate | informational |
| Conditional skips can hide a whole suite | `describe.skipIf` / `describe.skip` in `s3-live.e2e-spec.ts`, `patient-parity.test.ts`, `bundle-budget.test.ts`, `parity.test.ts` | informational; the bundle-budget skip is guarded in CI by `PATIENT_APP_BUNDLE_REQUIRED` |

No `.only` was found in any test file.

## 5. CI/CD quality gates

Source: `.github/workflows/ci.yml` at `HEAD`. Read, not executed.

| Gate | Present | Notes |
| --- | --- | --- |
| Path-filtered suites per tree | Yes | Plain `git diff`, no marketplace action |
| Cross-tree triggers for parity sources | Yes | `ci.yml:105-132` |
| Lockfile-exact install | Yes | `npm ci` |
| Backend: drift check, `migrate deploy`, seed, typecheck, lint, test, build | Yes | PostgreSQL 16 and Redis 7 service containers |
| Frontend: typecheck, lint, test, build | Yes | |
| Patient app: typecheck, lint, test with coverage, export build, bundle budget | Yes | Node 20 at `HEAD`; Node 22 on `origin/patient-app` |
| Single required check | Yes, **but defective** | MED-CI-001: *[withheld: security-sensitive]* |
| Dependency audit | **No** | MED-CI-002 |
| Secret scanning, SAST | **No** | MED-CI-002 |
| End-to-end stage | **No** | MED-TEST-001 |
| Performance stage | Only on `origin/backend` (`perf-nightly.yml`) | Not on `HEAD` or `main` |
| Deployment from CI | None | Web hosting is configured in `frontend/vercel.json`, `main` only, mock demo build |
| Push CI on `frontend` | Deliberately absent | `ci.yml:15-21`; pull requests still run every suite |
| Runtime pin | **No** | MED-CI-003 |
| Actions pinned by SHA | No (tags) | MED-CI-004 |

Whether the documented release policy matches the workflow: the policy in `CLAUDE.md`
(task branch → integration branch → `main`, with the three quality gates) is reflected in
the workflow. The policy's assumption that integration branches are periodically caught
up to `main` is not being met (MED-ARCH-001), and branch-protection settings could not
be inspected.

## 6. Build and type-check issues

None. All three packages typecheck cleanly, the web production build succeeds, and lint
reports zero errors in all three. The 20 web lint warnings equal the documented ceiling.

## 7. Recommended acceptance criteria for future fixes

A fix should not be accepted as done unless all of the following hold.

1. **A failing test first.** The defect is reproduced by an automated test that fails
   before the change and passes after. For MED-SEC-001 and MED-DB-001 the exact tests are
   specified in the roadmap.
2. **Run on the supported runtime.** Results are quoted from the pinned Node version,
   not from whatever is installed locally (T-5.2).
3. **Run alone and in the full suite.** A test that only passes in isolation, or only
   under no load, is not passing.
4. **Server-side fixes carry an e2e spec** against real PostgreSQL, and any
   authorization change includes the reviewed diff of the route-matrix snapshot.
5. **Schema changes** pass `db:check`, apply with `migrate deploy` to an empty database
   and to a populated copy, and come with a stated rollback.
6. **Client-visible fixes** include the failure path: what the user sees when the
   request fails.
7. **Cross-tree changes** run all three suites at one commit.
8. **No new lint warnings**; the web ceiling of 20 only goes down.
9. **The claim matches the evidence.** "Verified" in a pull request means a named
   command with its output, on a named commit.
