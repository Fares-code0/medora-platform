# Medora RS-1 — Phase 0 Follow-up: Test Reliability and Exception Closure

| | |
| --- | --- |
| Date | 2026-11-10, 18:29–19:22 (+0200) |
| Instruction | "Phase 0 only: test reliability & exception closure" (owner) |
| Supersedes | Nothing. `PHASE_0_FINAL_VERIFICATION_REPORT.md` stays as the record of 17:20–18:20; this file records what changed afterwards. Its acceptance matrix is restated in §8 with every changed row marked |
| Final status | **PHASE 0 VERIFIED WITH EXCEPTIONS — not PHASE 0 COMPLETE. The patient-app and backend-unit failures are fixed and verified; the Docker shutdown is explained. Remaining: backend e2e BLOCKED (database authorisation), the frontend HEAD baseline FAILS on time limits that the user's pending slice addresses, all fixes and slices uncommitted (commit authorisation), hosting PENDING, CI fail-open out of scope** |
| Phase 1 | **Not started.** No remediation finding was implemented; CI was not modified; MED-SEC-014 was not promoted |

Logs: `<session-scratchpad>\phase0c\`.
All commands ran on Node 22.23.4 through the same per-process `PATH` wrapper as before.

---

## 1. Starting state (18:29:43) — matched the final report

Branch `claude/emr-visual-redesign`, HEAD `ad4c6a8d`; 0 staged, 0 stashes; `git diff` SHA-1
`c81df70b…`; 106 status entries identical to the backup's `status.txt`; four worktrees
(`backend-slice3` `86fc0288` clean, `patient-app-slice4` `7f1b159e` clean, `frontend-base` `ad4c6a8d`
in state W); original backup 228/228, reception backup 339/339; five `medora-p0-*` containers healthy,
seven pre-existing containers exited and untouched; Node 24.18.0 and 22.23.4 present
(`start-state.txt`). No material difference, so work continued.

## 2. Changes made

All changes are **uncommitted** edits inside the disposable worktrees, preserved as patches in the
new directory `<backup-root>\2026-11-10-phase0c-test-reliability\`. Neither earlier
backup and nothing in the main working tree was changed in this follow-up.

| Path (worktree) | Change | Patch |
| --- | --- | --- |
| `patient-app/src/features/appointments/appointments-screen.test.tsx` | `settled()` and the "that is all" wait (was line 405) poll with a plain presence check; the original `toBeNull()` assertion runs once after each wait | `patient-app-waitfor-settle-checks.patch` (3 files, applies on `7f1b159e`, `git apply --check` exit 0) |
| `patient-app/src/features/health/documents-prescriptions.test.tsx` | one `settled(view, testID)` helper used by `renderDocuments` and `renderPrescriptions`, same pattern | same |
| `patient-app/src/features/health/health-records.test.tsx` | `renderRecords` polls the four skeletons with a presence check and asserts all four `toBeNull()` afterwards | same |
| `backend/src/modules/ai/ai-containment.spec.ts` | `relative(SRC, path).split(sep).join('/')` — POSIX separators on every platform | `backend-ai-containment-posix-paths.patch` (1 file, applies on `86fc0288`, exit 0) |

No timeout was raised, no assertion removed or weakened, no test skipped (the diff adds no `skip`,
`todo` or `only`), no Jest or Vitest configuration changed, no application code changed. The four
fixed files are byte-identical on `origin/patient-app`, `origin/backend`, HEAD and `origin/main`, so
each patch applies unchanged on every base. A temporary diagnostic test
(`src/features/health/zz-diag-timing.test.tsx`) was created for measurement and deleted; the
worktree's status shows only the three intended files.

## 3. Patient app

### 3.1 Root cause — established by measurement

The three suites waited for their screens with
`waitFor(() => expect(queryByTestId('…-loading')).toBeNull(), { timeout: 10_000 })`. A diagnostic
render of `HealthRecordsScreen` with all four services resolving immediately showed:

| Step | Wall | CPU |
| --- | ---: | ---: |
| First render | 1.1 s | 1.2 s |
| Skeletons gone, polled with a plain check | +0.1 s | +0.06 s |
| Same wait through `waitFor(expect(…).toBeNull())` — first round, 3 polls | **+5.0 s** | **+6.5 s** |
| Same wait, rounds 2 and 3 (1 poll each, no failure) | +0.03 s | +0.06 s |

The data had landed in about 100 ms; the time went into the **failed polls**. A failing `toBeNull()`
on a React test instance builds its message by pretty-printing the instance — the whole fiber graph
(the logs show `Received: {"_fiber": {"_debugHookTypes": …`) — about 2 s of CPU per poll, which
`waitFor` then discards. Every test paid it, and Jest's parallel workers competing for CPU pushed the
slowest tests past the 10 s wait and the 20–30 s test limits. The measured per-test durations were
bimodal (≈5 s, or ≈70 ms for a test that happened not to fail a poll), which is how the mechanism was
found. Of the candidate causes the instruction lists: not insufficient timeouts, not unawaited work,
not unresolved timers (retries are off, reduce-motion stops the skeleton animation), not shared state
— **CPU spent formatting discarded assertion failures, amplified by worker concurrency**.

### 3.2 Results

| Run | Command | Exit | Result | Duration |
| --- | --- | ---: | --- | ---: |
| Before — full suite, quiet (17:57) | `npm run test` | 1 | 11 failed, 4 skipped, 2,172 passed (2,187); 3 suites failed | 260 s |
| Before — the three suites alone | `npx jest <file>` | 0 | 28 / 17 / 35 passed | 71 / 107 / 139 s |
| After — the three suites alone (18:38) | `npx jest <file>` | 0 | 28 / 17 / 35 passed; `notifications` 23 | **11 / 9 / 11 s**; 11 s |
| After the first edit — full runs 1–3 (default workers, 7) | `npm run test` | 1, 0, 0 | run 1: 1 failed (`appointments-screen` "says 'that is all'…", the unconverted wait at line 405 — same mechanism, under RNTL's default 1 s ceiling); runs 2–3: 2,183 passed, 4 skipped, 0 failed | 80 / 84 / 74 s |
| After converting line 405 — suite alone | `npx jest src/features/appointments/appointments-screen.test.tsx` | 0 | 28/28 | 11 s |
| **After — full runs 4–8 (default workers)** | `npm run test` | **0 ×5** | **2,183 passed, 4 skipped, 0 failed (2,187), 116 of 117 suites (1 skipped), every run** | 79 / 65 / 77 / 63 / 63 s |
| typecheck / lint / build (`expo export`) | `npm run …` | 0 / 0 / 0 | clean; lint reports no problems | 12 / 27 / 36 s |

The 4 skipped tests and 1 skipped suite are pre-existing conditional skips (`web-interchange`,
`bundle-budget` — runs only when an export exists, which is why the earlier count was 8 —
`dev-only-boundary`, `parity`).

**Patient-app status: PASS** — the full suite passes reproducibly (5/5) at the default worker count,
the fix is deterministic, and nothing was weakened. It is uncommitted (§2).

## 4. Backend

| Item | Before | After | Classification |
| --- | --- | --- | --- |
| `ai-containment.spec.ts` | 1 failed / 30 passed, deterministic on Windows | **31/31 passed**, exit 0 | **FIXED** |
| `redis-permission-cache.spec.ts` alone | 9/9 (passed alone earlier) | 9/9, exit 0 | **PASS** |
| `npx vitest run src` (all 92 unit spec files; no database needed) | — (1 failure in the full run) | **92/92 files, 1,135/1,135 tests, exit 0 — twice** (43 s, 37 s) | **PASS** |
| typecheck / lint / build | 0 / 0 / 0 | 0 / 0 / 0 | **PASS** |
| 112 e2e files needing `medora_test` | failed, P1003 | not run | **BLOCKED — database authorisation required** |
| 4 self-migrating e2e specs (`admin-bootstrap`, `envelope-key-rotation`, `-hardening`, `-safety`) | `spawnSync npx ENOENT` | not run (they `CREATE DATABASE`, migrate and `DROP DATABASE`) | **BLOCKED — database authorisation required**; the Windows `npx` failure is an **environment limitation** with an identified fix |
| Redis after the runs | 0 keys | 0 keys | — |

**Portable invocation, identified and checked, not applied.** The four specs call
`execFileSync('npx', ['prisma', 'migrate', 'deploy'])`; on Windows `npx` is a `.cmd` shim that
`execFileSync` cannot start without a shell. Running the CLI's own entry point through the current
Node — `execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate',
'deploy'], …)` — needs no shell and no `PATH` lookup. Checked with a harmless call in the backend
worktree: `npx prisma --version` → `ENOENT`; `node <resolved entry> --version` → `prisma 7.10.1`
(no database contacted). The specs were **not** changed, because the change could only be proven by
running them, which creates databases and runs migrations.

## 5. Frontend HEAD baseline (quiet)

The `frontend-base` worktree was returned to HEAD content by file copies (`to-head.sh`): HEAD
content written to the 88 tracked paths; the 12 files that do not exist at HEAD **moved** (not
deleted) to `<worktrees>\_frontend-base-held-untracked\`; `git status` then
showed 0 changes.

| Step | Exit | Result |
| --- | ---: | --- |
| typecheck | 0 | clean |
| lint | 0 | 0 errors, 20 warnings (the accepted ceiling) |
| test, run 1 (19:02:33, 433 s) | **1** | 1 file failed / 284 passed / 1 skipped (286); **5 failed** / 2,981 passed / 4 skipped (2,990). All five in `ThemePlaygroundPage.test.tsx`, all "Test timed out in 5000ms" |
| test, run 2 (19:12:52, 399 s) | **1** | 2 files failed / 283 passed / 1 skipped (286); **6 failed** / 2,980 passed / 4 skipped (2,990): the same 5 ThemePlayground time limits, plus `SystemLogsSection.test.tsx` › filtering and pivot › "tells an over-filtered investigator how to widen it" — a `findByText` that gave up at its default 1 s (the test took 3.1 s) |
| `SystemLogsSection.test.tsx` alone, twice | 0, 0 | 34/34 both (39 s, 40 s) |
| `ThemePlaygroundPage.test.tsx` alone, twice | 0, 0 | 9/9 both; per-test 1.1–3.6 s against a 5 s limit |
| build | 0 | succeeded |

**Comparison.** HEAD has 2,990 tests; state I 3,134; state W 3,155 — the user's uncommitted work
adds 144 then 21 tests, and all of them passed in the quiet I and W runs. The one reproducible
difference is `ThemePlaygroundPage.test.tsx`: at HEAD its tests run with Vitest's 5 s default and
take up to 3.6 s alone, so they exceed it under full-suite load; the user's uncommitted slice 1F
changes that file to `describe('Theme Playground', { timeout: 15_000 }, …)`, which is why I and W
pass. The HEAD file was not changed here: the main tree's copy is the user's work, and the user's
slice already addresses it. Whether the suite also has a deterministic cost like the patient app's
was not investigated.

The worktree was then restored to state W: the user's 100 slice-1 files copied back from the live tree; the worktree's `git diff -- frontend docs` SHA-1 `c7451d260920a289f9575f169f639f63e85ccf62` again equals the user tree's; 100 changed paths. Nothing was deleted: the 12 held files remain in `_frontend-base-held-untracked\` (byte-identical to the restored copies) and the HEAD copy of `AuthThemeToggle.tsx`, which state W deletes, was moved to `<worktrees>\_frontend-base-held-head-copies\`.

## 6. Docker and ClamAV

**The 17:11 shutdown is explained** (Docker Desktop's `com.docker.backend.exe.log`):

| UTC | Local | Log entry |
| --- | --- | --- |
| 15:11:30.218 | 17:11:30 | `analytics.tracker sending event: uiAction` — a Docker Desktop GUI action |
| 15:11:30.356 | 17:11:30 | `apiproxy usage ContainerStopOthersLinux + 1` — the standalone `medora-p0-clamav` |
| 15:11:32.446 | 17:11:32 | client `Docker-Desktop/4.97.0 (Windows; x64; GUI)`: `POST /compose/bulk/:action` for `<local-env>\docker-compose.yml` |
| 15:11:34–35 | 17:11:34–35 | 12 × `ContainerStopComposeLinux` |
| 15:17:00 | 17:17:00 | `idle: stopping VM` (Resource Saver: no running containers) → 15:17:06 `VM stopped` |
| 15:20:30 | 17:20:30 | `idle: starting VM` (this session's CLI commands) → 15:20:45 `VM started` (hence the 65 s uptime measured at 17:22) |

So the stack was **stopped through the Docker Desktop GUI**, then Resource Saver stopped the idle
VM. It was not a crash, an OOM kill, or a command from this session (every command here went through
the CLI). Who performed the GUI action cannot be read from the log. Resources: 8 CPUs, 4 GB
(`docker info`).

**Monitoring.** Container health was sampled every minute from 18:55 through the backend, frontend
and patient-app runs: every sample shows all five `medora-p0-*` containers healthy
(`stack-health.log`; 27 samples from 18:55 to 19:21, 0 unhealthy).

**ClamAV re-test, 18:54:44:** `ClamAV 1.4.3/28179`; clean file `OK` (exit 0); EICAR
`Eicar-Test-Signature FOUND` (exit 1); both temporary files removed (`ls` → no such file). No image
was pulled, pruned or removed.

## 7. Integrity at the end (19:21:57)

| Check | Result |
| --- | --- |
| Branch / HEAD | `claude/emr-visual-redesign` / `ad4c6a8d26c421fb2c123caab6fd9f017566e634`; 0 staged; 0 stashes |
| Main working tree | `git diff` SHA-1 `c81df70b14846fa707e83120644ff88948bfa953` (unchanged since the final report); 106 status entries identical to the backup's `status.txt`. **Not modified by this follow-up** |
| Original backup | 228/228 OK; 0 files newer than 2026-11-10 12:38 |
| Reception backup | 339/339 OK; 0 files newer than its `SHA256SUMS` |
| New directory | `<backup-root>\2026-11-10-phase0c-test-reliability\` (two patches) |
| Local branches | Unchanged: `claude/backend-tsconfig-paths-without-baseurl` `86fc0288`, `claude/emr-visual-redesign` `ad4c6a8d`, `claude/patient-app-test-act-flush` `7f1b159e`, `frontend`, `main`, `patient-app`, `update-frontend`; neither slice branch on any remote |
| Worktrees | All four present: `backend-slice3` (1 uncommitted file — the fix), `patient-app-slice4` (3 — the fix), `frontend-base` (100 — state W, as at the start) |
| Lockfiles | `e02b3a1f…`, `3d99aa82…`, `b430bfb8…` — unchanged since `npm ci` |
| Local database | `medora, postgres, template0, template1`; 0 application tables; `_prisma_migrations` absent; Redis 0 keys. No migration run, no database created by this follow-up (no e2e spec was run) |
| Containers | Five `medora-p0-*` healthy; the seven pre-existing containers exited and untouched; no image pulled, pruned or removed |
| Remote | Nothing pushed, merged, deployed; no PR; no remote ref changed |

## 8. Acceptance matrix (restated; changed rows marked ◆)

| # | Acceptance item | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Original backup intact | **PASS** | §7 |
| 2 | Reception backup intact | **PASS** | §7 |
| 3 | HEAD + A = `full/I`; `full/I` + B = `full/W` | **PASS** | Final report §10 (unchanged inputs; checksums re-verified §7) |
| 4 | Patch order enforced | **PASS** | Final report §11 |
| 5 | Blob match; the one difference explained | **PASS** | Final report §10 |
| 6 | Backend slice 2 applies and merges cleanly | **PASS** | Final report §11 |
| 7 | User changes preserved | **PASS** | §7 |
| 8 | No push, merge, PR, deploy, branch deletion, destructive Git | **PASS** | §7 |
| 9 | Owner decisions recorded accurately | **PASS** | Unchanged |
| 10 | Two new findings in the plan, not implemented | **PASS** | Unchanged |
| 11 | `DESIGN_SYSTEM.md` sidebar text corrected | **PASS** | Unchanged |
| 12 | Hosting-dependent tasks documented | **PASS** | Unchanged |
| 13 | Docker engine and images | **PASS** | §6 |
| 14 | Five local services healthy | **PASS** | §6 monitoring |
| ◆15 | Docker stack stability — *was FAIL (unexplained shutdown)* | **PASS** | §6: the shutdown was a Docker Desktop GUI stop followed by Resource Saver; stable throughout this follow-up |
| 16 | ClamAV 28179, clean OK, EICAR detected, files removed | **PASS** | §6 |
| 17 | Local database empty, no migration, Redis empty | **PASS** | §7 |
| 18 | No remote/shared/production/real-patient database | **PASS** | §7 |
| 19 | Node 22 and 24 | **PASS** | §1 |
| 20 | `npm ci`, lockfiles unchanged | **PASS** | §7 |
| 21 | Frontend state I gates | **PASS** | Final report §4 |
| 22 | Frontend state W gates | **PASS** | Final report §5 |
| 23 | No I→W regression | **PASS** | Final report §5 |
| ◆24 | Frontend HEAD baseline, quiet — *was NOT RUN* | **FAIL** | §5: 5 ThemePlayground time-limit failures; pass alone; addressed by the user's pending slice 1F, not by HEAD |
| 25 | Patient app typecheck / lint / build | **PASS** | §3.2 |
| ◆26 | Patient app full suite — *was FAIL* | **PASS** | §3.2: 5/5 full runs, 0 failed, after the deterministic fix (uncommitted) |
| 27 | Patient app suites in isolation | **PASS** | §3.2 |
| 28 | Backend typecheck / lint / build | **PASS** | §4 |
| ◆29 | Backend unit specs — *was FAIL* | **PASS** | §4: 92/92 files, 1,135 tests, twice; `ai-containment` FIXED (uncommitted) |
| 30 | Backend e2e | **BLOCKED** | Database authorisation required (`medora_test`) |
| ◆30a | Self-migrating specs on Windows | **BLOCKED** | Database authorisation required; portable invocation identified (§4), not applied |
| 31 | Slices committed | **BLOCKED** | Not authorised |
| ◆31a | Follow-up fixes committed | **BLOCKED** | Not authorised ("commit … without separate authorization" excluded); preserved as patches |
| 32 | Hosting decision | **BLOCKED** | Owner: PENDING |
| 33 | CI fail-open | **NOT RUN** | Out of scope by instruction (Phase 1) |

Totals: **28 PASS, 1 FAIL, 5 BLOCKED, 1 NOT RUN** (35 rows; before this follow-up: 25 PASS, 3 FAIL, 3 BLOCKED, 2 NOT RUN over 33 rows).

## 9. Remaining exceptions and what each needs

| Item | Status | Needs |
| --- | --- | --- |
| Backend e2e (116 files) | BLOCKED | Owner authorisation for a local, disposable, migrated `medora_test` |
| Self-migrating specs' `npx` call | BLOCKED | That authorisation, then the identified portable invocation, applied and run |
| Frontend HEAD baseline | FAIL (HEAD only) | Lands with the user's slice 1F (`{ timeout: 15_000 }`); or a separate decision to investigate ThemePlayground's per-test cost |
| Slices 1A–1G, 1H, 2 and the two follow-up patches | BLOCKED | Owner authorisation to create task branches and commit |
| Hosting | BLOCKED | Owner decision (PENDING) |
| CI fail-open (MED-CI-001) | NOT RUN | Phase 1 authorisation |
| MED-SEC-014 promotion | Not attempted | Separate authorisation (R-GIT-04) |
| D-15 (API keys), A3 annotation, closing `claude/otp-absolute-ten-minute-expiry` | Owner decisions | Owner |

**STOP.** Phase 1 has not started. Waiting for explicit owner authorisation.
