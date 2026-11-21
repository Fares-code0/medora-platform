# Medora RS-1 — Phase 0 Completion Report

| | |
| --- | --- |
| Phase | 0 — Repository stabilisation and protection |
| Date | 2026-11-10, 11:41–13:30 (+0200) |
| Verdict | **Phase 0 partly complete.** Protection, reconciliation analysis, decision register and environment assessment are done. Two of four slices are committed locally; the frontend slice is held because it contains the held reception decision; the local environment is blocked on two authorisations. **Phase 1 should not start** until §20's prerequisites are met. |
| Companion | `OWNER_DECISION_REGISTER.md` (this directory) |

---

## 1. Phase objective

Protect the 106 uncommitted paths; reconcile the repository with the approved branch
plan against current refs; preserve the three changes outside integration branches;
document owner decisions without resolving any by assumption; establish what the local
test environment needs. No push, no deployment, no real data.

## 2. Tasks attempted

R-GIT-01, R-GIT-02, R-GIT-05 (status check), R-QA-01 (readiness), R-QA-02 (runtime
analysis), plus the mandated document review, backup, decision register and
environment assessment.

## 3. Tasks completed

| Task / item | Result | Evidence |
| --- | --- | --- |
| Repository state recorded | Branch `claude/emr-visual-redesign`, HEAD `ad4c6a8d26c421fb2c123caab6fd9f017566e634`, 0 staged, 0 stashes, 1 worktree, no Git hooks, `core.autocrlf=true` | §19 |
| 106 paths accounted for and classified | 92 modified, 1 deleted, 13 untracked: `frontend/` 98, `backend/` 4, `docs/` 2, `patient-app/` 2 | Backup `status.txt`, `MANIFEST.tsv` |
| External backup | `<backup-root>\2026-11-10-phase0\` | §19 |
| Backup integrity | 105/105 working-tree copies and 93/93 HEAD copies match the manifest by SHA-256 / blob id; the archive restored 105/105 byte-exactly; the patch rebuilt 93/93 tracked changes on a clean `git archive HEAD` export; `git bundle verify`: complete history of all 27 refs + HEAD; `sha256sum -c SHA256SUMS`: 228 files OK | §19 |
| Recovery procedure | `RECOVERY.md` in the backup directory | — |
| **R-GIT-02** re-measure | Fetched (`--no-prune`; no remote ref removed). Divergence, simulated merges and unabsorbed branches re-computed against current refs; object store unchanged by the simulations | §4 |
| Owner decision register | Four mandated decisions plus carried decisions; two resolved by owner evidence today | `OWNER_DECISION_REGISTER.md` |
| Slice 3 committed (local) | `86fc0288` on `claude/backend-tsconfig-paths-without-baseurl` (base `origin/backend` `cce25437`) | §8 |
| Slice 4 committed (local) | `7f1b159e` on `claude/patient-app-test-act-flush` (base `origin/patient-app` `2ecc9071`) | §8 |
| Runtime analysis (R-QA-02, analysis half) | Node ≥ 22.13 is accepted by every installed package in all three trees; Node 20 is refused in all three | §11.3 |
| Design-rule check of the redesign | No hover labels on the collapsed rail; no new coloured card edges; one existing set of `border-l-*` accents removed | §12 |

### Document review

The nine audit reports (2026-11-09) were re-read in full from disk at the start of the
strategy engagement earlier this session. The eight strategy documents were written in
this session. Their content is in this session's working context; their files were last
modified at 08:11 and are recorded by hash in the backup (`audit-reports/`). For Phase 0,
the governing sections were re-read: the backlog's Phase 0 task details and decision
table, the branch reconciliation plan, and the release gates. I did not re-read all
~400 KB end to end a second time.

## 4. Branch reconciliation result (current refs)

### 4.1 What changed since the strategy (2026-11-10 08:11)

Another process fetched at 12:23, after the owner merged **PR #207** into `backend`:

| Commit | Content |
| --- | --- |
| `21c4b3bd` | OTP lifetime 10 minutes, absolute from issue (the fix for MED-SEC-012) |
| `fc100523` | Restores the OD-001…OD-006 roadmap banner (clarification C-13) |
| `7e88f041` | ADR-025: the OTP challenge window is 10 minutes, absolute — "owner-approved (A3 as clarified by C-11)" |
| `bb84fe30` | ADR-007 and ADR-035: the approved amendment text (OD-004, OD-005) |
| `059d0ec1` | ADR-035 §7: the owner's 2026-11-10 2FA decisions |
| `cce25437` | Merge of PR #207 (Fares Ahmed, 12:23) |

A new docs-only branch also appeared: `origin/claude/backend-readiness-audit-2026-11-05`
(`020365db`), a 491-line backend audit from 2026-11-05, never merged.

### 4.2 Divergence from `origin/main` (`58b229e9`)

| Branch | Tip | Behind | Ahead | Ahead (non-merge) |
| --- | --- | ---: | ---: | ---: |
| `frontend` | `ad4c6a8d` | 1 | 4 | 3 |
| `backend` | **`cce25437`** (was `0c95b7d3`) | 255 | **25** (was 19) | **18** (was 13) |
| `patient-app` | `2ecc9071` | 431 | 17 | 10 |
| `Ai` | `6454bc49` | 423 | 18 | 11 |
| `Database` | `7833bda2` | 735 | 5 | 2 |

### 4.3 Simulated merges (reproduced; `git merge-tree --trivial-merge`, writes nothing)

| Source → target | Changed in both | Conflict hunks | Strategy said | Reproduced? |
| --- | ---: | ---: | --- | --- |
| `backend` → `main` | 1 (`BACKEND_API_CONTRACT.md`) | **0** | 1, 0 | Yes, including the 5 new commits |
| `frontend` → `main` | 0 | **0** | 0, 0 | Yes |
| `patient-app` → `main` | 2 (`ci.yml`, `PATIENT_FRONTEND_CHECKLIST.md`) | 2 | 2, 2 | Yes |
| `patient-app` → `main` after `frontend` | 4 (adds `package.json`, `package-lock.json`) | 5 | 4, 5 | Yes |
| `Ai` → `main` | 2 + 31 added-in-both | 41 | do not merge | Yes |
| `Database` → `main` | 1 (`CLAUDE.md`) | 0 | archive, D-13 | Yes |
| owner-decision record → `main` | 0 | **0** | 0 | Yes |

### 4.4 Changes outside every integration branch

| Branch | Content | Status now |
| --- | --- | --- |
| `docs/medora-owner-decisions-2026-11-06` (`b978a6cc`) | The 309-line FINAL owner-decision record | **Still unmerged.** Preserved in the bundle. Needs owner confirmation plus an A3 annotation (DEC-02) before R-GIT-03 |
| `claude/otp-ten-minute-lifetime` (`21c4b3bd`) | OTP fix | **Now absorbed** into `backend` by the owner (PR #207) |
| `claude/otp-absolute-ten-minute-expiry` (`c3c4f045`) | The duplicate OTP fix on an older base | Unmerged, superseded. Close only with owner approval |
| `claude/backend-readiness-audit-2026-11-05` (`020365db`) | 2026-11-05 backend audit | **New.** Unmerged, docs only. Two findings in it are not in the backlog (§14) |

Nothing was merged, retired or deleted in Phase 0.

### 4.5 MED-SEC-014 on current refs

*[Withheld from the published copy: security-sensitive content.]*
Independent
verification of the fix, its test and the related endpoints is Phase 1 work and needs
the local environment.

## 5. The four engineering slices

| Slice | Paths | Base → PR target | Status |
| --- | --- | --- | --- |
| **1 Frontend** | 98 `frontend/` + 2 `docs/adr/` | `claude/emr-visual-redesign` → `frontend` | **HELD — not committed.** Contains the frontend half of D-10 and at least five other unrelated changes |
| **2 Backend reception access** | `administration.controller.ts`, `administration.controller.authz.spec.ts` (new), `authz-route-matrix.snapshot.txt` | from `origin/backend` → `backend` | **HELD for DEC-04**, as instructed. Not committed |
| **3 Backend tsconfig** | `backend/tsconfig.json` | from `origin/backend` → `backend` | **Committed locally:** `86fc0288` |
| **4 Patient-app tests** | `session.test.tsx`, `notifications.test.tsx` | from `origin/patient-app` → `patient-app` | **Committed locally:** `7f1b159e` |

All 106 paths remain in the working tree unchanged, including those of slices 3 and 4.
Committing those two on separate branches copied their changes; nothing was removed from
the working tree.

### 5.1 Why slice 1 cannot be committed as planned

The strategy treated `frontend/` + `docs/` as one slice. Phase 0 inspection shows it is
not one logical change, and that it implements the held reception decision:

| Proposed sub-slice | Content | Representative paths |
| --- | --- | --- |
| 1A EMR visual language and tokens | ADR-0005; token, palette and contrast changes; component restyling; the removal of `border-l-*` status accents from `RoomsSection` | `docs/adr/0005-emr-visual-language.md`, `docs/adr/0001-…`, `DESIGN_SYSTEM.md`, `styles/tokens.css`, `styles/globals.css`, `tailwind.config.ts`, `components/ui/*`, `components/patterns/*`, `components/feedback/CriticalNotice.tsx`, dashboard and banner components, `utils/export.ts`, `index.html` |
| 1B Floating menus | Portalled, flip-aware dropdown positioning | `components/ui/internal/floating.ts` (+test), `Dropdown.tsx`, `Select.tsx`, `features/admin/logs/SavedViewsMenu.tsx` |
| 1C Sidebar and navigation redesign | Charcoal rail; click flyouts on the collapsed rail; new navigation entries and their i18n keys | `components/ui/Sidebar.tsx`, `layouts/Sidebar/AppSidebar.tsx`, `layouts/navigation.ts`, `i18n/messages/*.ts` |
| 1D Theme switch relocation | Theme pill moved to the sidebar foot and sign-in screens; `AuthThemeToggle` deleted; avatar-menu pill removed | `layouts/ThemeSwitch.tsx` (+test), `Navbar/AvatarMenu.tsx` (+test), `features/auth/*`, `layouts/index.ts` |
| 1E Permission-gated authoring routes | `RequirePermission` on new-record and new-prescription routes; "New prescription" hidden without `prescriptions.create` | `features/doctor/medical-records/routes.tsx`, `features/doctor/pharmacy/routes.tsx`, `PharmacyPage.tsx`, two new `*-permissions.test.tsx` |
| 1F Theme playground model | Development tool changes | `features/theme-playground/**` (13 files) |
| 1G Frontend tsconfig | Removes `baseUrl` (same pattern as slice 3) | `tsconfig.app.json` |
| **1H Reception workspace (D-10)** | Queue and Waiting Room in a reception workspace; removed from the admin sidebar | Wholly: `app/router/staff-workspaces.test.tsx`, `features/admin/routes.tsx`, `layouts/active-item.test.ts`, `routes/index.ts`. **Mixed** with other sub-slices: `app/router/index.tsx` (1 of 2 hunks), `features/admin/routes.test.tsx` (1 of 2), `features/admin/live-posture.test.tsx` (1 of 2), `layouts/navigation.ts` (2 of 5), `layouts/navigation.test.ts` (2 of 3), `layouts/Sidebar/AppSidebar.test.tsx` (1 of 9) |

The assignment is by inspection and must be confirmed hunk by hunk. Six files mix 1H
with other sub-slices, so splitting needs hunk-level staging (`git apply --cached` of
reviewed partial patches). Each intermediate state then needs its own typecheck, lint and
test run, because 1C, 1D and 1E probably depend on one another (the theme switch sits in
the sidebar foot; the sidebar shows the permission-gated entries).

**Proposal for approval.** Commit in dependency order on the existing task branch:
1A → 1B → 1C + 1D (one commit if they cannot build apart) → 1E (security-relevant, own
review) → 1F → 1G, verifying each step on Node 22. Keep 1H uncommitted with slice 2
until DEC-04. If DEC-04 is answered first, 1H and slice 2 become one reviewable change
across two PRs (`frontend` and `backend`).

## 6. Related audit finding IDs

MED-REL-001, MED-ARCH-001, MED-ARCH-005, MED-SEC-012, MED-SEC-014, MED-CI-003,
MED-MOB-002, MED-TEST-004, MED-OPS-004, MED-DB-003; new proposals MED-DB-004 and
MED-SEC-015 (§14).

## 7. Modified file inventory

| Location | Change |
| --- | --- |
| Tracked files in the repository | **None changed.** `git diff` SHA-1 `0a68145318f4f4a80cb629de573d4737e04ab02e` before and after |
| Untracked files in the repository | New: `audit-reports/2026-11-10-rs1-implementation/PHASE_0_COMPLETION_REPORT.md`, `OWNER_DECISION_REGISTER.md`. Appended: an execution-status section in `audit-reports/2026-11-10-post-audit-strategy/MASTER_REMEDIATION_BACKLOG.md` |
| Git refs | Two new local branches (§8). Remote-tracking refs updated by fetch (no ref removed; `origin/backend` had already moved before it) |
| Outside the repository | `<backup-root>\2026-11-10-phase0\` (backup). Temporary worktrees under `<worktrees>\` were created, used and removed; the directory no longer exists |
| Ignored build artefacts | None regenerated in Phase 0 (no build run) |

## 8. Local commits

| Commit | Branch | Base | Files | Verification |
| --- | --- | --- | --- | --- |
| `7f1b159e` test(patient-app): flush pending updates inside act() in two suites | `claude/patient-app-test-act-flush` | `origin/patient-app` `2ecc9071` | 2 (+21 −5) | Changed lines byte-identical to the original. Both suites pass 42/42 on the tree the change was written against. **Not verified on the `patient-app` base:** a run there through a linked `node_modules` failed 1/42 with 16 "environment not configured to support act" warnings, an artefact of React resolved through two paths; a real `npm ci` is needed |
| `86fc0288` chore(backend): drop baseUrl from tsconfig; paths resolve from the file | `claude/backend-tsconfig-paths-without-baseurl` | `origin/backend` `cce25437` | 1 (+1 −2) | TypeScript 5.9.3 parses the result with no errors and `@/*` still mapped. Backend typecheck and lint exit 0 on the tree it was written against. **Not verified on the `backend` base**, which adds the `compression` dependency |

Neither commit was pushed. Both branches were created with upstream tracking to their
base remote branch; a push would still have to name the branch explicitly.

## 9. Database changes

None. No database exists locally (Docker daemon stopped); none was contacted.

## 10. Tests executed

| # | Command | Runtime | Exit | Result |
| --- | --- | --- | ---: | --- |
| T1 | `npx jest src/features/auth/session.test.tsx src/features/notifications/notifications.test.tsx` in the slice-4 worktree (linked `node_modules`) | Node 24.18.0 | 1 | 2 suites: 1 passed, 1 failed; 42 tests: 41 passed, 1 failed; 16 act-environment warnings. Classified **environmental (linked dependencies)** |
| T2 | Same command in the main working tree | Node 24.18.0 | 0 | 2 suites passed; 42/42; 0 act-environment warnings |
| T3 | `npm --prefix backend run typecheck` (main tree) | Node 24.18.0 | 0 | Clean |
| T4 | `npm --prefix backend run lint` (main tree) | Node 24.18.0 | 0 | Clean |
| T5 | TypeScript `parseJsonConfigFileContent` on the slice-3 result | TS 5.9.3 | — | 0 errors; `baseUrl` none; `paths` `{"@/*":["./src/*"]}`; `include` keeps `perf/**/*.ts` |

Node 24 is not the project's supported runtime; these results are not release evidence.

## 11. Results and analysis

### 11.1 Backup

As in §3. Restore paths are documented in `RECOVERY.md`.

### 11.2 Local environment readiness

| Requirement | State | Blocker |
| --- | --- | --- |
| Docker | CLI 29.9.2 and Compose 5.6.1 present; Docker Desktop installed (`%LOCALAPPDATA%\Programs\DockerDesktop`); WSL distro `docker-desktop` **Stopped**; daemon unreachable | **Authorisation to start Docker Desktop and pull images** |
| Compose file | `main`'s `backend/docker-compose.yml` pulls `minio/minio`, which no longer exists (MED-OPS-004). `origin/backend`'s uses `pgsty/minio:RELEASE.2026-08-04T00-00-00Z`. Neither defines a ClamAV service | Use `origin/backend`'s file; add a clamd service for Phase 1 (`CLAMAV_HOST`, `CLAMAV_PORT`, `CLAMAV_TIMEOUT_MS` exist on `backend`) |
| Ports 5432, 6379, 9000, 9001, 1025, 8025, 3310, 3000, 5173 | Free | — |
| PostgreSQL / Redis binaries outside Docker | None | Docker is the only route |
| Node | 24.18.0 only; no version manager | **Authorisation to install Node 22 (≥ 22.13)** |
| Dependencies | `node_modules` present for all three trees at `HEAD`'s lockfiles | Branch bases with different lockfiles need `npm ci` (authorisation) |
| Environment files | `frontend/.env.local` exists and was **not read or modified**; no `.env` in `backend/` or `patient-app/`. Backend tests supply their own synthetic environment (`backend/test/setup-env.ts`) | — |
| Disk | 74 GB free on C: | — |
| Test data | Synthetic only: the seed's demo roster and test fixtures | — |

### 11.3 Runtime evidence for the Node decision (R-QA-02)

`engines.node` of every installed package, checked with `semver.satisfies`:

| Tree (packages) | Node 20.19 | Node 22.12 | Node 22.13 / 22.20 | Node 24.18 |
| --- | ---: | ---: | ---: | ---: |
| backend (849) | **2 refuse**: `@prisma/streams-local` (≥22), `file-type@22.0.1` (≥22) | 1 refuses (`eslint-visitor-keys`) | 0 | 0 |
| frontend (607) | 1 refuses (`rollup-plugin-visualizer`, ≥22) | 1 | 0 | 0 |
| patient-app (1,356) | **46 refuse** (Metro, Expo CLI tooling, …) | 47 | 0 | 0 |

`file-type` is a **production** dependency of the backend, pinned by an override, so the
backend container (`FROM node:20-alpine`) runs a runtime package outside its supported
engine range. CI runs all three jobs on Node 20 on `HEAD`, `main` and `backend` (the
`patient-app` branch moves its job to 22).

**Conclusion:** pin **Node 22, minimum 22.13**, everywhere (CI, Dockerfile, `engines`,
`.nvmrc`). Node 24 also satisfies every package, but one web test fails deterministically
on it (MED-TEST-004), so it is not the first choice. Implementing the pin changes CI and
the Dockerfile and needs authorisation; it is not done.

## 12. Security verification evidence

| Check | Result |
| --- | --- |
| MED-SEC-014 present on `HEAD` and `main` | Yes (code unchanged; see strategy §3) |
| Fix located | `e3dbe9bf`, inside `origin/backend`, unchanged by PR #207 |
| Collapsed-sidebar rule (no hover labels) in the uncommitted redesign | Respected: `aria-label` only when collapsed; groups open as click flyouts with focus management; source comments state the rule |
| No-decorative-card-edges rule | Respected: no new coloured edge utilities; `CriticalNotice` uses a neutral border and an icon; `RoomsSection` **removes** four `border-l-*` status accents |
| `frontend/DESIGN_SYSTEM.md` | Still describes the collapsed sidebar as "icons + tooltips" — pre-existing text that contradicts the standing rule. Reported, not changed |

## 13. Regression risks

| Risk | Mitigation |
| --- | --- |
| Slices 3 and 4 not verified on their bases | Verify after `npm ci` on Node 22 before any PR |
| Slice 1's sub-slices may not build apart | Per-step typecheck, lint and tests in the approved split |
| The held D-10 change is interleaved with redesign hunks in six files | Hunk-level review; never commit those six files whole until DEC-04 |
| Remote refs move without notice (another process fetched at 12:23) | Re-measure (R-GIT-02) immediately before every merge |
| Two new local branches track remote bases | No push without explicit authorisation |

## 14. Remaining defects and new inputs

All P0/P1 findings remain open; Phase 0 fixes none. In particular **MED-SEC-014 (P0) is
still present on `main` and `HEAD`.**

Proposed additions, from the 2026-11-05 backend audit, for triage at the start of Phase 1
(not yet estimated or added to the task index):

| Proposed ID | Severity (proposed) | Finding | Evidence cited by that audit |
| --- | --- | --- | --- |
| MED-DB-004 | P2 (P1 if DEC-03 allows multi-hospital data in one database) | *[withheld: security-sensitive]* | *[withheld: security-sensitive]* |
| MED-SEC-015 | P3 | API keys are issued without a hospital, which OD-003 prohibits; no route accepts a key, so no exposure today | `api-key.service.ts:28-34` |

## 15. Owner decisions required

See `OWNER_DECISION_REGISTER.md`. Summary:

| ID | Decision | Status |
| --- | --- | --- |
| DEC-01 (D-7) | Hosting architecture | **OPEN** — blocks 18 tasks |
| DEC-02 (D-9) | OTP lifetime | **RESOLVED** by the owner: 10 minutes, absolute. The unmerged owner record still says five minutes and needs an approved annotation |
| DEC-03 (D-6′) | Real data before the tenant key | **OPEN** |
| DEC-04 (D-10) | Reception access to queue and waiting room | **OPEN** — note the frontend half removes the entries from the administrator sidebar |
| D-14 | 2FA clarifications | **PARTLY RESOLVED** today (ADR-035 §7, owner-merged) |

## 16. Updated dependency status

| Task | Before | Now |
| --- | --- | --- |
| R-GIT-01 | Not started | **Partly done:** backup verified; slices 3 and 4 committed; slice 2 held (DEC-04); slice 1 held (split approval + DEC-04) |
| R-GIT-02 | Not started | **Done** (re-measured; merge freeze is the owner's to announce) |
| R-GIT-03 | Not started | Not started — owner confirmation and the A3 annotation needed |
| R-GIT-04 | Not started | Not started — needs R-QA-01; simulation still clean with the new commits |
| R-GIT-05 | Blocked on D-9 | **Done by the owner** (PR #207) |
| R-SEC-04 | Blocked on D-9 | **Delivered on `backend`**; reaches `main` with R-GIT-04 |
| R-DOC-03 | Not started | **Partly done on `backend`** (ADR-007, -025, -035 amendments, owner-merged) |
| R-QA-01 | Not started | **Blocked** — Docker Desktop start and image pulls need authorisation |
| R-QA-02 | Not started | Analysis done (§11.3); implementation needs Node 22 installed and CI/Dockerfile change authorisation |
| R-GIT-06 … R-GIT-10, R-QA-03 … R-QA-06, R-DOC-01, R-DOC-02 | Not started | Not started |

The execution-status section appended to `MASTER_REMEDIATION_BACKLOG.md` (§6 there)
carries the same table.

## 17. Deployment

No deployment occurred. No deployment workflow was triggered. Nothing was pushed.

## 18. Real patient data

No real patient data was accessed. No database was contacted. `frontend/.env.local` was
not read.

## 19. Protected user changes

| Check | Start of Phase 0 | End of Phase 0 |
| --- | --- | --- |
| Branch / HEAD | `claude/emr-visual-redesign` / `ad4c6a8d` | Same |
| `git diff` SHA-1 | `0a68145318f4f4a80cb629de573d4737e04ab02e` | Same |
| `git status` (excluding `audit-reports/`) | 106 entries; SHA-1 `cac707131a77fe5ed0006e56db5f8727c6fbefc7` | Identical, line for line, to the backup's `status.txt` |
| Working-tree files | 105 present + 1 deleted | All 105 re-hashed equal to the manifest |
| Installed dependencies | `patient-app/node_modules` 643 entries | 643 entries after the temporary link was removed |
| Backup | — | `<backup-root>\2026-11-10-phase0\`, checksums verified |

## 20. Recommendation for Phase 1

**Do not start Phase 1 yet.** It cannot produce valid evidence without the environment.
Prerequisites, in order:

1. **Authorise starting Docker Desktop and pulling the compose images** (PostgreSQL 16,
   Redis 7, `pgsty/minio`, mailhog, and ClamAV for the scanner work).
2. **Authorise installing Node 22 (≥ 22.13)** alongside Node 24, and `npm ci` in isolated
   worktrees where a branch's lockfile differs.
3. **Decide DEC-04**, or approve committing slice 1 without its reception hunks (§5.1).
4. **Decide DEC-01** (hosting) — not needed to start Phase 1's code work, but it gates
   the backup and scanner deployment tasks there.
5. Confirm the owner-decision record and the A3 annotation (DEC-02), so R-GIT-03 can land.

Once 1 and 2 are authorised, Phase 1 should start with: R-QA-01 (environment), the
MED-SEC-014 reproduction against `main`'s code, then R-GIT-04 (promote `backend` into a
local integration branch, verified by the full backend suite), then the independent
MED-SEC-014 verification and the remaining Phase 1 security work.

---

# Part II — Phase 0 completion (2026-11-10, 16:05–18:xx)

Done under the owner's "Phase 0 Final Authorization & Completion Instructions" and verified under
"Phase 0 Final Verification & Completion". §1–§20 above are the first pass and are kept as
written; where they differ, Part II and `PHASE_0_FINAL_VERIFICATION_REPORT.md` win. **§18
("No database was contacted") is superseded** by the final report §9: a local synthetic
PostgreSQL was contacted (health/schema queries, and the backend test suite connected to it); no
migration ran and no remote, shared, production or real-patient database was accessed.

## 21. Reception split and slice preservation

The 10 reception files were split out of slice 1 losslessly and preserved, with backend slice 2,
in the **new** directory `<backup-root>\2026-11-10-phase0b-reception-split\`
(README, exact file lists, SHA256SUMS). The original backup was not touched.

- **Correction to §5:** of the six files called "mixed", three (`app/router/index.tsx`,
  `features/admin/routes.test.tsx`, `features/admin/live-posture.test.tsx`) are reception-only —
  their "other" hunk is the import of `clinicOperationsLoaders`. Seven files are reception-only;
  three are genuinely mixed (`layouts/navigation.ts`, `layouts/navigation.test.ts`,
  `layouts/Sidebar/AppSidebar.test.tsx`).
- Patch A (slice 1 without reception, 93 files) applies on HEAD; patch B (reception, 10 files)
  applies on HEAD + A and **not** on HEAD (exit 1). HEAD + A = state I, I + B = the user's tree —
  proven with `diff -r` from a fresh `git archive HEAD`.
- 1H depends on sub-slice 1C (the sidebar test helpers and the no-tooltip collapsed rail).
- Slice 2 reviewed: `@Roles('admin', 'reception')` on exactly the two GET routes; writes keep the
  class-level `@Roles('admin')`; snapshot diff is exactly those two rows; the new spec asserts
  reception reaches these two reads and nothing else. Applies on HEAD and merges onto
  `origin/backend` with 0 conflicts.
- The owner's decision (DEC-04 option (a)) matches what the uncommitted work already does, so
  "applying the decision" required **no code change**. Nothing was committed: no branch or commit
  was authorised for slices 1A–1G, 1H or 2.

## 22. Docker and ClamAV

See the final report §7–§8: engine healthy; five images by digest; `medora-p0` stack on loopback
ports; HEAD's `minio/minio` image does not exist (MED-OPS-004 reproduced); clamd active signatures
28179, EICAR detected; the unexplained VM shutdown at 17:11 and the restart at 17:21.

## 23. Node 22 and the quality gates

Node 22.23.4 (official zip, SHA-256 checked against nodejs.org `SHASUMS256.txt`) in
`<node-runtimes>\node-v22.23.4-win-x64\`; system Node 24.18.0 in
`C:\Program Files\nodejs\` unchanged and still first on `PATH`. Each worktree command ran through a
wrapper that puts Node 22 first on `PATH` for that process only. `npm ci` (no `npm install`): backend
936 s, patient-app 918 s, frontend 858 s, all exit 0, all three lockfiles' SHA-1 unchanged. Gate
results: final report §3–§6.

## 24. Planning documents updated

`MASTER_REMEDIATION_BACKLOG.md` (§1.5 decisions, §2.2 findings, §2.4 counts, §3 index, §4 details,
§6.4–§6.6 status, hosting list and recomputed totals), `RELEASE_GATES.md` (G-01 1.10–1.11, G-02
2.6 mandatory and 2.8, G-03 3.5, G-08 8.8–8.9), `REMEDIATION_DEPENDENCY_GRAPH.md` (§8–§9
regenerated, §10), `IMPLEMENTATION_ROADMAP.md` (§4), `POST_AUDIT_STRATEGY.md` (§10),
`ESTIMATES_AND_RESOURCE_PLAN.md` (§7), and dated addenda to the audit's
`SECURITY_AND_PRIVACY_AUDIT.md` and `FEATURE_TRACEABILITY_MATRIX.md`. Superseded text was struck
through or marked, not deleted.

## 25. CI fail-open

MED-CI-001 *[withheld: security-sensitive]* is recorded as a **Phase 1
item** (R-QA-03). `.github/workflows/ci.yml` was not modified.

## 26. Hosting-blocked tasks

The 18 tasks, each with the hosting decision it needs, its dependencies and what local work could
proceed without it, are in `MASTER_REMEDIATION_BACKLOG.md` §6.5. Hosting remains **PENDING**.

## 27. File inventory of Part II

| Location | Change |
| --- | --- |
| `frontend/DESIGN_SYSTEM.md` (protected path) | Line 524 only: "64px collapsed (icons + tooltips)" → icons only, no hover tooltips or `title` labels, `aria-label` kept, groups such as Pharmacy open on click. Backup copy + `slice-1-docfix-…patch` reproduces it |
| `audit-reports/` (untracked) | The eight planning documents, two audit reports and this directory's two reports amended; `PHASE_0_FINAL_VERIFICATION_REPORT.md` added |
| Outside the repository | `<backup-root>\2026-11-10-phase0b-reception-split\` (new); `<worktrees>\` (three worktrees); `<node-runtimes>\`; `<local-env>\` (scratch compose copy) |
| Git | No commit, branch, merge, push, stash or reset in Part II. Three worktrees added (`git worktree add`) |
