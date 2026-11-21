# Medora RS-1 — Phase 0 Final Verification Report

| | |
| --- | --- |
| Phase | 0 — Repository stabilisation, protection and environment preparation |
| Date | 2026-11-10, final verification 17:20–18:20 (+0200) |
| Instructions | "Phase 0 Final Authorization & Completion Instructions"; "Phase 0 Final Verification & Completion"; the continuation instruction of 17:34 |
| Verdict | **Phase 0 verification is complete. Phase 0 itself is INCOMPLETE and must not be represented as fully complete: the patient-app full-suite gate FAILS on time limits (no regression), one backend unit spec FAILS on Windows path separators, the backend e2e suite is BLOCKED (no migrated test database may be created), the Docker stack shut down once unexplained, and the preserved slices are not yet committed (no authorisation). Hosting remains PENDING.** |
| Phase 1 | **Not started and not authorised.** No remediation finding was implemented |
| Companions | `PHASE_0_COMPLETION_REPORT.md` (first pass, §1–§20, and the completion addendum §21–§27), `OWNER_DECISION_REGISTER.md` |

Every result below was produced in this session on this machine and is backed by a log.
Logs are under the session scratchpad
`<session-scratchpad>\gates\`
(named in each section). All runs used **Node 22.23.4** unless stated.

---

## 1. Executive summary

Phase 0 protected the user's 106 uncommitted paths, recorded the owner's decisions, added two
security findings to the plan, split and preserved the reception work, and brought up a local,
synthetic test environment on a supported runtime. All of that is verified (§10–§12).

The quality gates were run on each tree's real base with Node 22.23.4:

- **Frontend:** state I and state W each pass typecheck, lint (0 errors, 20 accepted warnings) and
  build, and each passes the **full test suite on a quiet machine with zero failures** (I: 3,131
  passed; W: 3,152 passed). There is no regression from the reception change. Earlier failures
  were time limits under load and passed in isolation.
- **Patient app:** typecheck, lint and `expo export` pass. The full test suite **fails** — 11 tests in
  3 suites on a quiet machine — and every failure is a time limit. All four previously failing
  suites pass when run alone (103/103), and failures fall from 11 to 1 when Jest's worker count is
  reduced. Slice 4 does not touch the failing suites. The gate is still not met.
- **Backend:** typecheck, lint and build pass. Of 118 failing test files, 112 need a migrated
  `medora_test` database and 4 try to create and migrate databases themselves (and fail on Windows
  `npx`): all **BLOCKED** by the no-migration rule. One unit spec fails deterministically on Windows
  path separators; one Redis timeout passes in isolation. No application defect was demonstrated,
  and none could be ruled out by e2e.
- **ClamAV** now serves signatures 28179, detects EICAR and passes a clean file.
- **Infrastructure:** five local services healthy. An unexplained shutdown of the Docker VM at 17:11
  is recorded, not explained.

The database statement is corrected (§9): a local synthetic PostgreSQL was contacted; it holds no
application tables; no migration ran; four test specs briefly created and dropped throwaway
databases on it.

**Phase 1 has not started.** Nothing was pushed, merged, deployed or migrated.

## 2. Phase 0 scope completed

| Item | Result |
| --- | --- |
| Original backup re-verified | 228/228 checksums OK; complete-history bundle OK; no file in it newer than 12:37 (§10) |
| Owner decisions recorded | OTP 10 min absolute; MFA rules; tenant key mandatory gate; reception option (a); hosting pending (§12) |
| Two new findings added to the planning documents | MED-DB-004 (P1), MED-SEC-015 (P3); tasks R-DB-05, R-SEC-14; gates G-08 8.8–8.9, G-02 2.8. **Not implemented** |
| Reception split | Lossless split of the 10 reception files out of slice 1, preserved outside the repository with exact file lists; backend slice 2 reviewed and preserved (§11) |
| Docker | Engine healthy; five images pulled and recorded by digest; five local services healthy on loopback ports (§8) |
| ClamAV | Active signatures 28179; clean file OK; EICAR detected (§7) |
| Node 22 | 22.23.4 installed beside 24.18.0; `npm ci` succeeded in three worktrees, lockfiles unchanged (§3–§6) |
| Quality gates | Run for the three trees on their real bases (§3–§6) |
| `DESIGN_SYSTEM.md` collapsed-sidebar text | Corrected (one line, owner-authorised documentation fix) |
| 18 hosting-blocked tasks | Listed with the decision each needs, dependencies and possible local work (`MASTER_REMEDIATION_BACKLOG.md` §6.5) |
| CI fail-open (MED-CI-001) | Recorded as a Phase 1 item; CI not modified |

## 3. Patient app test results

Worktree `<worktrees>\patient-app-slice4`, branch
`claude/patient-app-test-act-flush` (`7f1b159e`, slice 4) on its real base `origin/patient-app`
(`2ecc9071`). `npm ci` exit 0 (918 s); `package-lock.json` SHA-1 `3d99aa82…` unchanged.

| Step | Command | Exit | Result | Log |
| --- | --- | ---: | --- | --- |
| typecheck | `npm run typecheck` | 0 | clean | `pa-slice4-typecheck.log` |
| lint | `npm run lint` | 0 | no problems reported | `pa-slice4-lint.log` |
| test (full, parallel with other pipelines) | `npm run test` (= `jest`) | 1 | **Suites 4 failed, 1 skipped, 112 passed (117). Tests 49 failed, 8 skipped, 2,130 passed (2,187)**. Signals: 10 Jest per-test timeouts (20 s / 30 s), 7 "not configured to support act" warnings | `pa-slice4-test.log` |
| build | `npm run build` (= `expo export`) | 0 | Metro bundle exported | `pa-slice4-build.log` |

**Isolated reruns and diagnosis.**

| Run | Command | Exit | Result | Log |
| --- | --- | ---: | --- | --- |
| The 4 suites together, 17:00, **while the state-I frontend suite was running** | `npx jest <4 files>` | 1 | 3 failed / 1 passed suites; 33 failed / 70 passed (103). `notifications` passed (11.8 s); the others took 248–564 s | `pa-slice4-rerun.log` |
| `notifications.test.tsx` alone, quiet, 17:50:41 | `npx jest src/features/notifications/notifications.test.tsx` | 0 | 23/23 passed, 52 s | `pa-ind-notifications.test.log` |
| `appointments-screen.test.tsx` alone, 17:51:34 | `npx jest src/features/appointments/appointments-screen.test.tsx` | 0 | 28/28 passed, 71 s | `pa-ind-appointments-screen.test.log` |
| `documents-prescriptions.test.tsx` alone, 17:52:46 | `npx jest src/features/health/documents-prescriptions.test.tsx` | 0 | 17/17 passed, 107 s | `pa-ind-documents-prescriptions.test.log` |
| `health-records.test.tsx` alone, 17:54:33 | `npx jest src/features/health/health-records.test.tsx` | 0 | 35/35 passed, 139 s | `pa-ind-health-records.test.log` |
| **Full suite, quiet machine, 17:57:13** (default workers: 7 on 8 logical CPUs) | `npm run test` | **1** | **Suites 3 failed, 1 skipped, 113 passed (117). Tests 11 failed, 4 skipped, 2,172 passed (2,187)**. Failed: `appointments-screen`, `documents-prescriptions`, `health-records` | `pa-slice4-test-quiet.log` |
| Diagnostic: full suite with 2 workers, 18:09:04 | `npx jest --maxWorkers=2` | 1 | Suites 1 failed, 1 skipped, 115 passed; tests **1 failed**, 4 skipped, 2,182 passed: `documents-prescriptions.test.tsx:183` "gives every status of the vocabulary a word a patient can read" — `Exceeded timeout of 30000 ms` | `pa-slice4-test-w2.log` |

**Root cause (established).** Every failure signal in every run is a time limit, none an assertion
about behaviour: in the quiet full run, 14 are `waitFor(() => expect(queryByTestId('…-loading')).toBeNull(), { timeout: 10_000 })`
— the suites' "query has settled" helper giving up after 10 s — and 8 are per-test limits of
20 s (`jest.config.js:64`, `testTimeout: 20_000`) or 30 s. The four suites pass alone (103/103 — the
same 103 tests commit `09a8c538` reports for them). Failures scale with Jest's own concurrency on
a quiet machine: 11 at the default 7 workers, 1 at 2 workers, 0 alone; the remaining test is one of
the five named in `09a8c538` as the PR #198 time-limit failures. These screen suites run close to
their time budgets on this machine, and worker contention pushes them over. **No regression:** slice
4 changes only `session.test.tsx` and `notifications.test.tsx`, both of which pass; the three
failing suites are untouched by it. **Unresolved:** the full-suite gate as defined in `CLAUDE.md`
(`npm run test`, zero failures) is **not met** on this machine; fixing it (time budgets or worker
count, R-QA-07) is Phase 1 work and was not done — no timeout, assertion or configuration was
changed.

## 4. Frontend — state I (slice 1 without reception)

Worktree `<worktrees>\frontend-base` (detached at `ad4c6a8d`), `npm ci` exit 0
(858 s), lockfile unchanged. State I = HEAD + `slice-1-frontend-without-reception.patch`, laid
down by file copies: 93 changed paths, matching the patch's 93 entries; the 10 reception paths
compared equal to `full/I`.

| Step | Exit | Result | Log |
| --- | ---: | --- | --- |
| typecheck | 0 | clean | `fe-stateI-typecheck.log` |
| lint | 0 | **0 errors, 20 warnings** — the accepted ceiling, equal to the HEAD baseline (20) | `fe-stateI-lint.log` |
| test, first run (parallel with backend and patient-app pipelines) | 1 | 9 files failed / 285 passed (294); 26 tests failed / 3,105 passed / 3 skipped; 42 failure signals, all "Test timed out" (5 s / 15 s) | `fe-stateI-test.log` |
| **test, quiet machine (17:43:54, 387 s)** | **0** | **294/294 files passed; 3,131 passed, 3 skipped, 0 failed (3,134)** | `fe-stateI-test-quiet.log` |
| build | 0 | `vite build` succeeded | `fe-stateI-build.log` |

## 5. Frontend — state W (state I + reception = the user's working tree)

State W was laid down by copying the 10 reception files from the user's tree. Check: the
worktree's `git diff -- frontend docs` SHA-1 `c7451d260920a289f9575f169f639f63e85ccf62` equals the
user's tree's — **identical**. (The worktree states were laid down from the live tree after the
one-line `DESIGN_SYSTEM.md` fix, so both sides carry it; in that one documentation file the
worktree's states differ from `full/I` and `full/W`, which preserve the user's original. No test
reads it.)

| Step | Exit | Result | Log |
| --- | ---: | --- | --- |
| typecheck | 0 | clean | `fe-stateW-typecheck.log` |
| lint | 0 | **0 errors, 20 warnings** (ceiling, unchanged) | `fe-stateW-lint.log` |
| test, first run (frontend pipeline only) | 1 | 4 files failed / 290 passed (294); 8 tests failed / 3,144 passed / 3 skipped (3,155); 12 signals, all "Test timed out" | `fe-stateW-test.log` |
| the 4 failing files in isolation | 0 | 4/4 files, 84/84 tests passed | `fe-stateW-rerun.log` |
| **test, quiet machine (17:34:38, 471 s)** | **1** | **3 files failed / 291 passed; 3 tests failed / 3,149 passed / 3 skipped (3,155)**. All three are per-test time limits: `rate-limited.test.tsx` › signup (5 s), `OverviewPage.test.tsx` › never puts the notifications widget behind a collapsible section (5 s), `ThemePlaygroundPage.test.tsx` › Copy › explains the fallback… (15 s) | `fe-stateW-test-quiet.log` |
| those 3 files in isolation | 0 | 3/3 files, 54/54 tests passed | `fe-stateW-rerun2.log` |
| **test, quiet machine, second full run (18:01:38, 402 s)** — state W restored by copying the user's 10 reception files; worktree `git diff -- frontend/src docs` SHA-1 `daa71bdf…` = the user's tree's | **0** | **294/294 files passed; 3,152 passed, 3 skipped, 0 failed (3,155)** | `fe-stateW-test-quiet2.log` |
| build | 0 | `vite build` succeeded | `fe-stateW-build.log` |

**State I vs state W.** W adds 21 tests (3,155 vs 3,134) — the reception tests — and all of them
passed in every W run. The three W failures are in files the reception patch does not touch
(the patch changes exactly the 10 files in `slice-1H-reception-paths.txt`), they are time limits
rather than assertions, and each passes in isolation. The same three files also timed out on the
HEAD baseline. Failures fell as load fell (baseline under three pipelines 13 files; W with one
pipeline 4; W quiet 3; isolated 0), and the second quiet full run of W passed with 0 failures. **Conclusion: no regression
between state I and state W.** The intermittent time-limit failures are the known timing-sensitive
suites (MED-TEST-004, R-QA-07); they are not caused by the reception change.

**Frontend HEAD baseline (for reference).** typecheck 0; lint 0 (20 warnings); test 1 under load
(13 files / 44 tests failed, 79 of 84 signals timeouts); build 0. Not rerun quietly.

## 6. Backend test results

Worktree `<worktrees>\backend-slice3`, branch
`claude/backend-tsconfig-paths-without-baseurl` (`86fc0288`, slice 3) on its real base
`origin/backend` (`cce25437`). `npm ci` exit 0 (936 s; Prisma Client 7.10.1 generated); lockfile
unchanged.

| Step | Command | Exit | Result | Log |
| --- | --- | ---: | --- | --- |
| typecheck | `npm run typecheck` | 0 | clean | `be-slice3-typecheck.log` |
| lint | `npm run lint` | 0 | clean | `be-slice3-lint.log` |
| test | `npm run test` (Vitest over `src/**/*.spec.ts` and `test/**/*.e2e-spec.ts`) | 1 | **Files 118 failed, 94 passed, 2 skipped (214). Tests 192 failed, 1,198 passed, 2,012 skipped (3,402)**; 510 s | `be-slice3-test.log` |
| build | `npm run build` | 0 | built | `be-slice3-build.log` |

Every one of the 118 failing files was classified from its first error:

| Class | Files | Evidence | Status |
| --- | ---: | --- | --- |
| **Missing `medora_test` database** | 112 (111 shown directly; 1 inferred) | `test/setup-env.ts:25` sets `DATABASE_URL` *[withheld: security-sensitive]*; errors "Database `medora_test` does not exist on the database server" (Prisma P1003) at the first query, e.g. `test/support/auth-app.ts:196`, `test/support/clinic-fixture.ts:29`. The follow-on "Cannot read properties of undefined (reading 'reset' / 'close' / 'prisma' / 'patientId' / 'userId')" errors are teardown after that failed setup. Includes `authz-matrix.e2e-spec.ts` (500s from the same missing database), `database.e2e-spec.ts`, `seed-reference-data.e2e-spec.ts` (Prisma error where a rollback marker was expected), the `schema-*` specs | **BLOCKED** — needs a migrated `medora_test`; creating or migrating it is excluded |
| **Self-migrating harness, Windows `npx` ENOENT** | 4 | `admin-bootstrap`, `envelope-key-rotation`, `-hardening`, `-safety`: each runs `CREATE DATABASE` on the local server (e.g. `admin-bootstrap.e2e-spec.ts:100-101`), then `execFileSync('npx', ['prisma', 'migrate', 'deploy'])` (:105), which fails on Windows with `spawnSync npx ENOENT` (`npx` is a `.cmd` shim and `execFileSync` uses no shell); teardown drops the database (`:127`, `DROP DATABASE … WITH (FORCE)`) | **BLOCKED** — and **not rerun**: these specs create, migrate and drop databases by design |
| **Windows path-separator portability** | 1 | `src/modules/ai/ai-containment.spec.ts` › "only shared/ai and config read the provider credential": received `shared\ai\unconfigured-ai-gateway.ts`, `config\config.service.ts`… against a `/`-separated allowlist. Reproduced in isolation: exit 1, 1 failed / 30 passed (`be-rerun-ai-containment.spec.log`). Known MED-TEST-002 | **FAIL** (test portability, not an application defect) |
| **Redis command timeout under load** | 1 | `src/shared/authz/redis-permission-cache.spec.ts` › returns what was set: "Command timed out" (ioredis). In isolation against the healthy local Redis: exit 0, 9/9 passed (`be-rerun-redis-permission-cache.spec.log`) | Not reproducible in isolation |
| Independently reproducible application defect | **0** | None found among the 118 | — |

Count: 112 + 4 + 1 + 1 = **118**. 111 files print "Database `medora_test` does not exist" or P1003
directly; the 112th, `seed-reference-data.e2e-spec.ts`, fails with a `PrismaClientKnownRequestError`
whose message the log folds (`…(7)`) while running against the same `DATABASE_URL`, so its
classification is **inferred**, not shown.

**What was not rerun, and why.** The 116 database-dependent files cannot pass without a migrated
`medora_test`, which would need database creation and migration — excluded. The four
self-migrating specs were deliberately not rerun because they create and drop databases. Only the
two `src` specs, which need no schema, were rerun.

**Backend verdict.** typecheck PASS, lint PASS, build PASS; unit tests: 1 deterministic,
Windows-only portability failure (`ai-containment`), 1 load-only timeout; e2e **BLOCKED**. No
application defect was demonstrated — but none was ruled out by e2e either, because e2e did not run.

## 7. ClamAV verification

Container `medora-p0-clamav`, image `clamav/clamav:1.4.3`
(`sha256:75fb5fd95fcbe1d7e6d240c369c1572b686ee2c95949d1042b5148de8eddebb4`), port
`127.0.0.1:3310`.

| Time (+0200) | Check | Result |
| --- | --- | --- |
| 16:14 | First start; `zVERSION` | `ClamAV 1.4.3/27927` (signatures bundled in the image); EICAR found, clean file OK |
| 16:14 | freshclam | downloaded daily 28179 to disk (`database.clamav.net`) |
| 16:25–16:29 (container log, UTC 14:25–14:29) | clamd SelfCheck | "Database modification detected. Forcing reload" → "Database correctly reloaded (3628258 signatures)" → "Activating the newly loaded database" |
| 17:11:32 | container stopped (exit 143) with the rest of the stack — §8 | — |
| 17:22 | restarted (`docker start medora-p0-clamav`, existing configuration) | healthy |
| 17:22:24 | `zVERSION` | **`ClamAV 1.4.3/28179/Tue Nov 10 06:26:51 2026`**; on disk `daily.cvd` 28179, `main.cvd` 63, `bytecode.cvd` 339; freshclam "up-to-date" for all three |
| 17:22:39 | clean synthetic file, `clamdscan --stream` | `OK`, exit 0 |
| 17:22:39 | EICAR generated inside the container, `clamdscan --stream` | **`Eicar-Test-Signature FOUND`**, exit 1 |
| 17:22:39 | test files removed | `/tmp/e.txt`, `/tmp/clean.txt`: "No such file or directory"; the host-side copy from 16:14 was removed by Windows Defender (absent) |

Scanning and detection settings were not changed. Evidence: `<session-scratchpad>\clamav-final.txt`.

## 8. Docker and local infrastructure

Docker Desktop (engine and CLI 29.9.2, Compose v5.6.1, `docker-desktop` WSL 2 VM). Stack from a
scratch copy of `origin/backend`'s compose file at `<local-env>\`, differing
from it only by binding every port to `127.0.0.1`; project name `medora-p0` so it cannot reuse the
pre-existing `medora` project's containers or volumes.

| Image | Digest |
| --- | --- |
| `postgres:16-alpine` (PostgreSQL 16.15) | `sha256:aa6cb33cf4c19c765cefcf48d96176258800870a9a1e930ad126200f9d825139` |
| `redis:7-alpine` (Redis 7.4.12) | `sha256:7b1753b4c5ad8458906c272a8132b8c15f5557b000379eb115fb239706a384b7` |
| `pgsty/minio:RELEASE.2026-08-04T00-00-00Z` | `sha256:b6bfe7239bfc83fb90d31612d9704d86039dd714f7904b3f1ad68f211e602372` |
| `mailhog/mailhog:v1.0.1` | `sha256:8d76a3d4ffa32a3661311944007a415332c4bb855657f4f6c57996405c009bea` |
| `clamav/clamav:1.4.3` | `sha256:75fb5fd95fcbe1d7e6d240c369c1572b686ee2c95949d1042b5148de8eddebb4` |
| `minio/minio:RELEASE.2024-09-13T20-26-02Z` (HEAD's compose) | **does not exist** — "pull access denied … repository does not exist"; not substituted in the repository (MED-OPS-004 reproduced) |

**Unexplained shutdown.** At 17:11:32 all five `medora-p0` containers stopped together with SIGTERM
(exit 143; `OOMKilled=false`). Docker Desktop's processes had been running since 16:07 and did not
restart; the engine kept no events for the window; at 17:22 the VM reported an uptime of 65 s, so
the Docker VM itself was down between about 17:11 and 17:21. Nothing in this session issued a stop.
**The cause remains unexplained.** The containers were restarted at 17:21–17:22 with their existing
configuration.

**Final check, 18:14:11:**

| Container | Image | Status |
| --- | --- | --- |
| `medora-p0-postgres-1` | `postgres:16-alpine` | Up, healthy |
| `medora-p0-redis-1` | `redis:7-alpine` | Up, healthy |
| `medora-p0-minio-1` | `pgsty/minio:RELEASE.2026-08-04T00-00-00Z` | Up, healthy (`/minio/health/live` 200) |
| `medora-p0-mailhog-1` | `mailhog/mailhog:v1.0.1` | Up, healthy (UI 200) |
| `medora-p0-clamav` | `clamav/clamav:1.4.3` | Up, healthy (`ClamAV 1.4.3/28179`) |

No other container was started. **Side effect to record:** pulling `postgres:16-alpine` and
`redis:7-alpine` moved those tags to newer images, so the pre-existing `medora-postgres-1`,
`medora-audit-pg` (image `0cefaabd882e`, created 2026-10-21) and `medora-redis-1`,
`medora-audit-redis` (`6ba19c50b567`, 2026-10-26) now show bare image IDs. Those containers and
their images are intact and unchanged; a `docker image prune` would delete the images, so none
should be run.

The seven pre-existing containers (`medora-postgres-1`, `medora-minio-1` on the unofficial
`kukuruser/minio` image, `medora-mailhog-1`, `medora-redis-1`, `medora-audit-pg`,
`medora-audit-redis`, `medora-audit-mail`) were exited before this session and were not started,
modified or removed; neither were the volumes `medora_postgres-data`, `medora_redis-data`,
`medora_minio-data`.

## 9. Database safety verification

**Corrected statement.** A local synthetic PostgreSQL instance (`medora-p0-postgres-1`) was queried
for health and schema verification. The database list was `medora`, `postgres`, `template0`,
`template1`. There were zero application tables, the Redis keyspace was empty, and no migration was
run. No remote, shared, production or real-patient database was accessed.

Two further facts the record must carry:

- The backend test suite *connected* to that local server (§6), and four of its specs ran
  `CREATE DATABASE` for a throwaway database before failing at `migrate deploy`; their teardown runs
  `DROP DATABASE`. No such database remains, and no migration was applied — `migrate deploy` never
  started (`spawnSync npx ENOENT`).
- `PHASE_0_COMPLETION_REPORT.md` §18 ("No database was contacted") was true for the first pass, when
  no database existed; it is **superseded** by this section for the completion work.

**Final check, 18:14:11:** databases `medora, postgres, template0, template1`; tables outside
`pg_catalog`/`information_schema`: **0**; `public._prisma_migrations` exists: **false**; Redis
`DBSIZE` **0** (the isolated Redis spec's keys were removed by its own teardown; 0 before and
after).

## 10. Backup integrity

| Backup | Check | Result |
| --- | --- | --- |
| Original `<backup-root>\2026-11-10-phase0\` | `sha256sum -c SHA256SUMS` | **228/228 OK** at 17:22:56 and again at 18:14:11 |
| | Files modified after creation | **0** files newer than 2026-11-10 12:38 (newest 12:37, the backup's creation) |
| | `git bundle verify all-refs.bundle` | "okay", "complete history", 28 refs |
| | 106 protected paths in `MANIFEST.tsv` (92 M, 1 D, 13 ??) | present |
| Reception `<backup-root>\2026-11-10-phase0b-reception-split\` | `sha256sum -c SHA256SUMS` | **339/339 OK** at 17:24:46 and again at 18:14:11; 340 files including `SHA256SUMS` |
| | SHA256SUMS provenance | Created **17:24:46** today by this verification (339 entries). The directory's README had listed it before it existed; it was added, nothing was overwritten |
| | Equivalence, from a fresh `git archive HEAD` | export (88 files) = `full/H`; **HEAD + `slice-1-frontend-without-reception.patch` = `full/I`** (`diff -r` exit 0); **`full/I` + `slice-1H-frontend-reception.patch` = `full/W`** (exit 0) |
| | Blob check, `full/W` vs the live tree (99 present files) | **0 mismatches at the time of the split** (16:2x). Now 1: `frontend/DESIGN_SYSTEM.md`, by design — `full/W` keeps the user's original and the live file carries the authorised doc fix; backup copy + `slice-1-docfix-…patch` = live file exactly (2 changed lines in the diff = 1 line replaced, line 524) |

## 11. Git and patch integrity

| Check | Result |
| --- | --- |
| Branch / HEAD | `claude/emr-visual-redesign` / `ad4c6a8d26c421fb2c123caab6fd9f017566e634` (unchanged) |
| Staged / stashes | 0 / 0 |
| `git status` (excluding `audit-reports/`) | 106 entries, **identical line for line** to the backup's `status.txt` |
| Live files vs `MANIFEST.tsv` | 104 identical; 1 different (`frontend/DESIGN_SYSTEM.md`, the authorised fix); the deleted `AuthThemeToggle.tsx` still absent |
| `git diff` SHA-1 | was `0a68145318f4f4a80cb629de573d4737e04ab02e`; now `c81df70b14846fa707e83120644ff88948bfa953` — the change is exactly the one-line doc fix |
| Refs vs the backup's `refs.txt` | Added: `claude/backend-tsconfig-paths-without-baseurl` (`86fc0288`) and `claude/patient-app-test-act-flush` (`7f1b159e`), the first pass's local slice commits. Removed or moved: none. No remote branch contains either commit (not pushed) |
| Worktrees | 4: the main tree plus `<worktrees>\{backend-slice3, patient-app-slice4, frontend-base}` (disposable, outside the repository) |
| Reception patch order, exit codes captured directly | Reception patch on HEAD (wrong order) `git apply --check`: **exit 1** ("patch failed: frontend/src/layouts/Sidebar/AppSidebar.test.tsx:583"). Without-reception patch on HEAD: check 0, apply 0. Reception patch on HEAD + A: check 0, apply 0. Result vs `full/W`: `diff -r` exit 0. *(The earlier "exit=0" printed for the wrong-order case came from a pipeline and was wrong; this supersedes it)* |
| Backend slice 2 vs its bases | Applies on HEAD `ad4c6a8d` (`git apply --check` and apply exit 0) and reproduces the three live files; onto `origin/backend` `cce25437` both tracked files merge with `git merge-file`: 0 conflicts, equal to the preserved copies |

**Changes made by Phase 0 in the main repository:** `frontend/DESIGN_SYSTEM.md` line 524 (authorised
doc fix); new and amended reports under the untracked `audit-reports/` (listed in
`PHASE_0_COMPLETION_REPORT.md` §27). **Pre-existing user changes:** the other 105 of the 106 paths,
verified unchanged by hash. Nothing was overwritten or discarded.

## 12. Owner decisions (as recorded; unchanged here)

| Decision | Recorded value |
| --- | --- |
| OTP lifetime | **10 minutes, absolute from issuance, never extended** (the earlier 5 minutes marked superseded; merged on `backend` in PR #207, `cce25437`; not yet on `main`) |
| Staff MFA | Mandatory for staff |
| Invited administrators | MFA completed before activation; **no** grace period |
| New staff | **14-day** enrolment period **beginning at account activation** |
| Last recovery code | Forces account recovery / re-enrolment; access **blocked until recovery is completed** |
| Hospital/tenant key | Must be **implemented and tested before any real patient data**; mandatory architectural and release gate (G-02 2.6); a later multi-hospital migration is not a substitute |
| Reception | Queue and Waiting Room belong to the **Reception workspace**, not the Admin sidebar |
| Hosting | **PENDING** — no provider selected or assumed |
| MED-SEC-014 (P0) | Remains a **critical release blocker** until its fix (`e3dbe9bf`, on `origin/backend` only) is promoted and verified |
| MED-DB-004, MED-SEC-015 | Explicit backlog findings (R-DB-05, R-SEC-14); not implemented |

## 13. Remaining blockers

| # | Blocker | Kind | Needed to clear it |
| --- | --- | --- | --- |
| 1 | Patient-app full suite fails on time limits (11 tests, 3 suites) | Test reliability (MED-TEST-004, RK-06) | Phase 1 / R-QA-07: stabilise those suites' time budgets, or run the gate with a worker count proven to pass — an owner/engineering decision, not taken here |
| 2 | Backend e2e cannot run: no migrated `medora_test` | Authorisation | Owner approval to create and migrate a **local, disposable** test database (R-QA-01) |
| 3 | Four backend specs create, migrate and drop databases themselves; on Windows they fail at `npx` | Test-harness portability and safety | Run them only where database creation is authorised; make the `npx` call work on Windows (R-QA-04) |
| 4 | `ai-containment.spec.ts` fails on Windows path separators | Test portability (MED-TEST-002) | R-QA-04 |
| 5 | Slices 1A–1G, 1H and 2 preserved but not committed | Authorisation | Owner approval to create task branches and commit them (R-GIT-01) |
| 6 | Hosting (D-7) | Owner decision, **PENDING** | 18 tasks stay blocked (`MASTER_REMEDIATION_BACKLOG.md` §6.5) |
| 7 | MED-SEC-014 (P0) | Release blocker | Its fix `e3dbe9bf` promoted to `main` and verified (R-GIT-04, R-QA-06) |
| 8 | D-15 (API-key issuance); A3 annotation on `b978a6cc`; closing `claude/otp-absolute-ten-minute-expiry` | Owner decisions | Owner |
| 9 | Docker VM shut down unexpectedly at 17:11 | Environment, unexplained | Watch for recurrence; review Docker Desktop resource settings (4 GB VM) |
| 10 | CI fail-open (MED-CI-001) | Phase 1 item | R-QA-03 |

## 14. Phase 0 acceptance matrix

| # | Acceptance item | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Original backup exists, 228/228 checksums, unmodified, complete-history bundle | **PASS** | §10 |
| 2 | Reception backup exists, 339/339 checksums, unmodified since its checksums were made | **PASS** | §10 (checksums created 17:24:46 by this verification) |
| 3 | HEAD + patch A = `full/I`; `full/I` + patch B = `full/W` | **PASS** | §10, §11 (`diff -r` exit 0) |
| 4 | Patch order enforced (B alone on HEAD fails) | **PASS** | §11: `git apply --check` exit 1, captured directly |
| 5 | 0 blob mismatches over 99 files at split time; the one present difference explained | **PASS** | §10 (`DESIGN_SYSTEM.md` = backup + doc-fix patch) |
| 6 | Backend slice 2 applies on HEAD and merges onto `origin/backend` with 0 conflicts | **PASS** | §11 |
| 7 | User changes preserved (105 unchanged by hash, 106 status entries identical, nothing discarded) | **PASS** | §11 |
| 8 | No push, merge, PR, deployment, branch deletion or destructive Git command | **PASS** | §11 (refs: only the two local first-pass branches added; neither on a remote) |
| 9 | Owner decisions recorded accurately | **PASS** | §12; `OWNER_DECISION_REGISTER.md` |
| 10 | MED-DB-004 and MED-SEC-015 in backlog, graph, roadmap, gates and strategy; not implemented | **PASS** | `MASTER_REMEDIATION_BACKLOG.md` §2.2, §3; `PHASE_0_COMPLETION_REPORT.md` §24 |
| 11 | `DESIGN_SYSTEM.md` collapsed-sidebar text corrected (documentation only) | **PASS** | Line 524 |
| 12 | 18 hosting-dependent tasks documented | **PASS** | `MASTER_REMEDIATION_BACKLOG.md` §6.5 |
| 13 | Docker engine healthy; images pulled by digest; no unverified substitution | **PASS** | §8 |
| 14 | Five local services healthy | **PASS** | §8, 18:14:11 |
| 15 | Docker stack stable for the session | **FAIL** | §8: unexplained VM shutdown 17:11–17:21 |
| 16 | ClamAV active signatures 28179; clean OK; EICAR detected; test files removed | **PASS** | §7 |
| 17 | Local database: zero application tables, no migration, Redis empty | **PASS** | §9 |
| 18 | No remote, shared, production or real-patient database accessed | **PASS** | §9 (only `127.0.0.1` services) |
| 19 | Node 22.23.4 installed beside Node 24.18.0; both verified | **PASS** | `PHASE_0_COMPLETION_REPORT.md` §23 |
| 20 | `npm ci` in three worktrees; lockfiles unchanged | **PASS** | §3–§6 |
| 21 | Frontend state I: typecheck / lint / test / build | **PASS** | §4 (quiet full suite 294/294 files, 0 failed) |
| 22 | Frontend state W: typecheck / lint / test / build | **PASS** | §5 (second quiet full suite 294/294 files, 0 failed; the first quiet run's 3 time-limit failures passed in isolation) |
| 23 | No regression between state I and state W | **PASS** | §5 |
| 24 | Frontend HEAD baseline full suite on a quiet machine | **NOT RUN** | Run only under load (13 files failed, timeouts) |
| 25 | Patient app: typecheck / lint / build | **PASS** | §3 |
| 26 | Patient app: full test suite | **FAIL** | §3: 11 failed (time limits); not a regression |
| 27 | Patient app: the four suites in isolation | **PASS** | §3: 103/103 |
| 28 | Backend: typecheck / lint / build | **PASS** | §6 |
| 29 | Backend: unit specs (`src`) | **FAIL** | §6: `ai-containment` (Windows paths), deterministic |
| 30 | Backend: e2e specs | **BLOCKED** | §6: need a migrated `medora_test`; four specs self-migrate |
| 31 | Slices committed on task branches | **BLOCKED** | Not authorised (slices 3 and 4 were committed locally in the first pass) |
| 32 | Hosting decision | **BLOCKED** | Owner: PENDING |
| 33 | CI fail-open fixed | **NOT RUN** | Phase 1 item by instruction |

## 15. Recommended next actions

1. **Do not accept Phase 0 as fully complete.** It can be accepted as *verified, with exceptions*
   — items 15, 24, 26, 29, 30, 31 and 32 above — if the owner finds those exceptions acceptable.
2. Owner decisions: approve committing the preserved slices (R-GIT-01); approve a local,
   disposable, migrated test database for backend e2e (the only way to get e2e evidence); D-15;
   the A3 annotation; hosting when ready.
3. When Phase 1 is authorised, start with test reliability so later phases can produce clean
   evidence: R-QA-01 (scripted disposable environment), R-QA-04 (Windows-portable specs, including
   the `npx` harness call), R-QA-07 (patient-app time budgets), R-QA-03 (CI fail-open) — then
   R-GIT-04 to bring MED-SEC-014's fix to `main`.
4. Leave the `medora-p0` stack, the worktrees and Node 22 in place for Phase 1; do not prune Docker
   images (§8).

**Phase 0 verification: complete. Phase 0: incomplete (exceptions above). Phase 1: not started.**

---

## Follow-up — 2026-11-10, 18:29–19:22

This report is kept as written. A later, owner-authorised Phase 0 pass ("test reliability &
exception closure") is recorded in `PHASE_0_FOLLOWUP_TEST_RELIABILITY.md` (this directory). In
summary: the patient-app timeouts were traced to a deterministic cause and fixed in the test
helpers (full suite 5/5 clean); `ai-containment.spec.ts` was fixed (backend unit specs 92/92 files,
twice); the 17:11 Docker shutdown was identified as a Docker Desktop GUI stop followed by Resource
Saver; the frontend HEAD baseline ran quietly and fails on ThemePlayground time limits that the
user's pending slice 1F addresses. Matrix rows 15, 26 and 29 moved to PASS and row 24 from NOT RUN to
FAIL; new BLOCKED rows record the self-migrating specs and the uncommitted fixes. Status after the
follow-up: **PHASE 0 VERIFIED WITH EXCEPTIONS**. Phase 1 has not started.
