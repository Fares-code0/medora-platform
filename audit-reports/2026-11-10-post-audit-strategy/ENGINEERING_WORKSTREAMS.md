# Medora — Engineering Workstreams

| | |
| --- | --- |
| Date | 2026-11-10 |
| Task source | `MASTER_REMEDIATION_BACKLOG.md` §3. Effort figures are the sum of each workstream's mandatory tasks, in engineer-days; optional tasks are listed but not summed. |
| Team model | Four engineers (profiles A–D below) plus non-engineering owners. Lane assignments are in the backlog's `Own` column and in `IMPLEMENTATION_ROADMAP.md`. |

| Workstream | Tasks (mandatory) | Effort | Primary owner | Gates it closes |
| --- | ---: | ---: | --- | --- |
| 1 Repository and Git architecture | 10 | 5–9.5 | A | G-11 (one trunk, honest CI) |
| 2 Security and authentication | 13 | 30.5–57 | A | G-01, G-03, G-10 |
| 3 Backend and API | 12 | 45–83 | B, A | G-02, G-05, G-06 |
| 4 Database and data integrity | 4 | 8–13.5 | B | G-04 |
| 5 Patient mobile application | 6 | 18–28 | C, D | G-06, G-11 (RS-2) |
| 6 Web frontend and admin dashboard | 4 | 16–29 | C | G-08 (viewer), G-11 |
| 7 AI integration and healthcare safety | 6 | 22.5–44 | A, with a clinician | G-07 |
| 8 QA and automated testing | 13 | 22.75–38 | C, B, D | G-11 |
| 9 Infrastructure, backup and reliability | 7 | 20–38 | D | G-05, G-09, G-12 |
| 10 Documentation and release engineering | 5 | 4.75–8 | A, C | The sign-off record across all gates |
| **Total** | **80** | **192.5–348** | | |

Gate IDs refer to `RELEASE_GATES.md`.

---

## 1. Team composition

### 1.1 Engineering profiles

| Code | Profile | Must have | Load (all mandatory) | Load (RS-1 only) |
| --- | --- | --- | ---: | ---: |
| A | Lead engineer, backend security | NestJS, authentication protocols, Git at scale, security review | 63.25–115.5 | 23.75–42.5 |
| B | Backend and database engineer | PostgreSQL (constraints, migrations, `EXPLAIN`), Prisma, NestJS | 48.5–92.5 | 24.5–47 |
| C | Client engineer and test automation | React, React Native/Expo, browser and device test automation, GitHub Actions | 51.75–87 | 18.75–33 |
| D | Platform engineer | Cloud hosting, managed PostgreSQL, backups and restore, TLS, observability, CI | 29–53 | 26–48 |

Lane A carries the most work overall and is the bottleneck once RS-2 starts. Lane D
front-loads: most of its work is in RS-1. Lane C has slack during RS-1 and is fully
loaded in RS-2, when web and mobile work coincide.

### 1.2 Non-engineering owners the plan cannot proceed without

| Role | Decides | Blocks if absent |
| --- | --- | --- |
| Project owner | D-1, D-9, D-10, D-14; confirms the owner-decision record | R-GIT-03, R-GIT-05, R-SEC-08, the reception slice of R-GIT-01 |
| Product owner | D-3, D-6′ (with architecture) | R-BE-04, R-BE-05, R-BE-08, R-BE-12, Phase 4 |
| Clinical owner (D-11) | Emergency content, results release (D-12), cancellation policy (D-2), AI intended use and evaluation | R-BE-09, R-BE-10, R-BE-11, R-AI-01, R-AI-03 |
| Security owner | D-4 remainder; signs G-01, G-03, G-10 | R-SEC-06, R-SEC-07, RS-1 sign-off |
| Legal and compliance | D-5, D-8; processor agreements; privacy terms | R-SEC-12, R-BE-07, R-AI-02, R-OPS-06, store listings |
| Engineering lead | D-7, D-13 | The whole of workstream 9 |

---

## 2. Workstreams

### WS-1 Repository and Git architecture

| Field | Detail |
| --- | --- |
| Scope | Protect the uncommitted work; reconcile `backend`, `frontend` and `patient-app` into `main`; land the owner-decision record and the OTP fix; retire `Ai` and settle `Database`; prune absorbed branches; adopt a branch model that prevents re-divergence |
| Tasks | R-GIT-01, R-GIT-02, R-GIT-03, R-GIT-04, R-GIT-05, R-GIT-06, R-GIT-07, R-GIT-08, R-GIT-09, R-GIT-10 |
| Findings | MED-ARCH-001, MED-ARCH-005, MED-ARCH-006, MED-REL-001, MED-REL-002, MED-MOB-002, MED-DB-003, MED-DOC-002; delivers the fixes for MED-SEC-014, MED-SEC-011, MED-OPS-004 and the code half of MED-BE-001 |
| Depends on | WS-8 (R-QA-01 integration environment; R-QA-02 Node 22) |
| Unblocks | Almost everything in WS-2, WS-3, WS-4 |
| Ownership | A, with C for R-GIT-10 |
| Deliverables | One trunk; tagged retired branches; a written branch model; a drift-check and path-guard CI job |
| Exit criteria | `backend`, `frontend`, `patient-app` report `0 0` against `main`; the full suite green on the trunk (R-QA-05); the owner-decision record on `main`; the uncommitted work committed in four reviewed slices |
| Detail | `BRANCH_RECONCILIATION_PLAN.md` |

### WS-2 Security and authentication

| Field | Detail |
| --- | --- |
| Scope | Refresh-token delivery; fail-closed production profile; rate limiting; OTP lifetime; per-request session validation and immediate revocation; role-based idle timeouts and absolute session lifetime; password-expiry decision; mandatory staff 2FA with SMS and passkeys; dependency gate; web transport and CSP; data export; independent penetration test |
| Tasks | R-SEC-01 … R-SEC-13 |
| Findings | MED-SEC-001 … MED-SEC-013 (except MED-SEC-005, in WS-9), MED-CI-002, MED-AI-004, MED-BE-006 |
| Depends on | WS-1 (R-GIT-04); WS-9 (R-OPS-01 for proxy topology and storage); owner decisions OD-004, OD-005, O-13, I1–I7, A3; D-4, D-5, D-9, D-14 |
| Unblocks | RS-1 sign-off; R-AI-05 (needs R-SEC-03) |
| Ownership | A for authentication and sessions; B for R-SEC-03 and R-SEC-12; C for R-SEC-10 and R-SEC-11; external vendor for R-SEC-13 |
| Deliverables | Fixed and tested auth paths; a production-profile contract in `env.schema.ts`; session validation with a measured latency cost; enforced OD-005 limits across three trees; mandatory 2FA; a passing dependency gate; a penetration-test report |
| Exit criteria | G-01, G-03 and G-10 in `RELEASE_GATES.md` pass with evidence; no open critical or high penetration-test finding |
| Risk to watch | R-SEC-05 and R-SEC-06 are on the hot path of every request and change both clients. Ship behind configuration with a staged rollout on staging. Agree the activity-classification contract (I3) with WS-5 and WS-6 before coding |

### WS-3 Backend and API

| Field | Detail |
| --- | --- |
| Scope | Scanner-gated downloads; readiness; guard-level write capability; `501` routes; staff role workflows; focused review of the sampled modules; push and SMS adapters; the patient API surface (published slots and booking, cancellation and rescheduling, health records, clinic and emergency, messaging) |
| Tasks | R-BE-01 … R-BE-12 (R-BE-13 optional) |
| Findings | MED-BE-001 … MED-BE-005, MED-MOB-001, MED-ARCH-002, MED-SEC-014 (class review), RK-01, RK-03 |
| Depends on | WS-1; WS-4 (R-DB-01, R-DB-02); WS-9 (R-OPS-05); D-2, D-3, D-6′, D-10, D-11, D-12 |
| Unblocks | WS-5 (every mobile integration), WS-6 (messaging), RS-2 |
| Ownership | B for data-heavy work (R-BE-01 … R-BE-08, R-BE-11); A for authorization-sensitive routes (R-BE-09, R-BE-10, R-BE-12) |
| Deliverables | Live patient routes with cross-patient isolation tests; a module review report with scope-equivalence tests per list and export route; regenerated, reviewed route-matrix snapshots |
| Exit criteria | No route in scope answers `501`; every list and export route has a scope-equivalence test; the patient routes RS-2 needs pass e2e on staging |
| Risk to watch | Every new capability is an authorization change; review the route-matrix diff as one. Do not implement DR-05 before R-BE-03 |

### WS-4 Database and data integrity

| Field | Detail |
| --- | --- |
| Scope | Database-enforced appointment exclusivity; the tenancy sequencing spike; index review on realistic data; the AI message lifecycle status |
| Tasks | R-DB-01, R-DB-02, R-DB-03, R-DB-04 |
| Findings | MED-DB-001, MED-ARCH-003, MED-DB-002, MED-AI-005 |
| Depends on | WS-1 (R-GIT-04 brings the idempotency migration and the perf dataset); WS-8 (R-QA-06 failing tests); D-6′ |
| Unblocks | R-BE-08, R-AI-04, R-WEB-02 |
| Ownership | B |
| Deliverables | A `btree_gist` exclusion constraint with a pre-flight overlap report; the D-6′ decision paper (and, if option b is chosen, an expand migration adding `hospital_id` with one default hospital); measured index additions |
| Exit criteria | G-04 passes; `db:check` clean; each migration rehearsed on a populated copy with a written rollback |
| Rules | Expand-then-contract migrations only; `CREATE INDEX CONCURRENTLY` on populated tables; enum additions in their own migration; never auto-delete conflicting rows |

### WS-5 Patient mobile application

| Field | Detail |
| --- | --- |
| Scope | Replace each `unavailableService` with a live adapter as its route lands; push; store-release prerequisites |
| Tasks | R-MOB-01 … R-MOB-06 |
| Findings | MED-MOB-001, MED-MOB-003, MED-MOB-004, MED-BE-003 |
| Depends on | WS-3 route by route; WS-1 (R-GIT-07 for SDK 58 and Node 22); D-3, D-8 |
| Unblocks | RS-2 |
| Ownership | C (adapters and screens), D (R-MOB-06 build and store pipeline) |
| Deliverables | Live booking, records, clinic and emergency, messaging if scoped, push; internal store builds |
| Exit criteria | Every RS-2 row of the traceability matrix reads "Implemented" with a device E2E test (R-QA-09); no fixture reachable in a production build (already enforced by `configs/env.ts` — keep it) |
| Preserve | The app's honest refusal pattern (`EndpointNotImplementedError`), the PHI sweep, keychain storage, and the rule that no emergency number is hard-coded |

### WS-6 Web frontend and admin dashboard

| Field | Detail |
| --- | --- |
| Scope | Audit-ledger viewer; remaining admin sections; staff messaging; a live deployment distinct from the demo; lint hygiene |
| Tasks | R-WEB-01, R-WEB-02, R-WEB-03, R-WEB-04 (R-WEB-05 optional) |
| Findings | MED-FE-001, MED-FE-002, MED-ARCH-002, MED-FE-003 |
| Depends on | WS-1 (R-GIT-06); WS-2 (R-SEC-11 CSP); WS-3 (R-BE-01 for attachments); D-3, D-6′ |
| Unblocks | G-08 (administrators can read the audit ledger) |
| Ownership | C |
| Deliverables | Live admin sections with adapter contract tests; a live web project with the CSP |
| Exit criteria | `LIVE_SECTIONS` covers every section with a server route; no `localStorage` store in a live build |
| Design constraints | No decorative coloured card edges; no hover labels on the collapsed sidebar; keep accessible names and click menus. The uncommitted redesign (R-GIT-01 frontend slice) is reviewed against these before merge |

### WS-7 AI integration and healthcare safety

| Field | Detail |
| --- | --- |
| Scope | Scope and intended use; data-processing decision; output-safety layer and evaluation harness; hospital-scoped context; provider adapter; patient-facing AI charter |
| Tasks | R-AI-01 … R-AI-06 (R-DB-04 in WS-4) |
| Findings | MED-AI-001, MED-AI-002, MED-AI-003, MED-AI-004 (via R-SEC-03) |
| Depends on | D-3, D-8, D-11; R-DB-02 (DR-12); R-SEC-03 |
| Unblocks | RS-3 |
| Ownership | A, with a named clinician for R-AI-03; legal for R-AI-02 |
| Deliverables | A signed intended-use statement; a processor agreement; an evaluation dataset and regression runner; a clinician-signed evaluation report; the adapter behind an owner-controlled flag |
| Exit criteria | G-07 passes |
| Preserve | The containment design (no tools, no chart write, server-side context re-resolved on every send) and its structural spec; the patient app's `connected: false` until R-AI-06 concludes |

### WS-8 QA and automated testing

| Field | Detail |
| --- | --- |
| Scope | The integration environment; runtime pin; an honest CI gate; test classification; a baseline on the trunk; failing tests first; stabilisation; web and mobile E2E; secret scanning and SAST; Action pins; performance baseline; release-candidate verification |
| Tasks | R-QA-01 … R-QA-13 |
| Findings | MED-TEST-001 … MED-TEST-004, MED-CI-001, MED-CI-003, MED-CI-004, MED-OPS-004; RK-02, RK-06 |
| Depends on | WS-1 for anything that runs on the trunk |
| Unblocks | Evidence for every other workstream |
| Ownership | C (client tests, CI hygiene, perf), B (backend classification, baseline, failing tests), D (environment, runtime, release candidate) |
| Deliverables | A one-command integration environment; a dated baseline; browser and device smoke suites in CI; a release-candidate evidence pack |
| Exit criteria | G-11 passes; every suite green three times under load on Node 22 |

### WS-9 Infrastructure, backup and reliability

| Field | Detail |
| --- | --- |
| Scope | Hosting decision; deployment and migration release; backups and OD-006 restore; encryption and TLS evidence; scanner service; observability and incident runbooks; secrets and key rotation |
| Tasks | R-OPS-01 … R-OPS-07 |
| Findings | MED-OPS-001, MED-OPS-002, MED-OPS-003, MED-SEC-005, MED-BE-001 (service half) |
| Depends on | D-7, D-8; WS-1 (key-rotation code arrives with R-GIT-04) |
| Unblocks | R-SEC-03, R-BE-01, R-SEC-12, R-QA-13, RS-1 |
| Ownership | D |
| Deliverables | An approved infrastructure design; a migration image and release runbook with a rehearsed rollback; PITR and a dated restore drill under OD-006 with evidence outside the database; a data-protection statement; alerts observed firing; incident and breach runbooks; an on-call rota; a rehearsed key rotation |
| Exit criteria | G-05, G-09 and G-12 pass |
| Risk to watch | This workstream contains the RS-1 critical path's infrastructure links and depends entirely on D-7. A late hosting decision delays RS-1 day for day |

### WS-10 Documentation and release engineering

| Field | Detail |
| --- | --- |
| Scope | A truthful README; a regenerated branch table; ADR amendments required by FINAL decisions; one status page and one ADR system; the release runbook and sign-off record |
| Tasks | R-DOC-01 … R-DOC-05 (R-DOC-06 optional) |
| Findings | MED-DOC-001, MED-DOC-002, MED-ARCH-005, MED-FE-002 (labelling), MED-AI-001 (claims) |
| Depends on | WS-1 for the branch table; owner approval for ADR amendments (A1: only approved clauses) |
| Ownership | C for the README and status page; A for ADRs and the sign-off record |
| Deliverables | README matching the traceability matrix; amended ADR-035 §7 and ADR-007; a sign-off template filled for RS-1 |
| Exit criteria | Every capability named in public documents is implemented; the sign-off record carries each gate's evidence and approver |

---

## 3. Working rules across workstreams

1. **One task, one branch, one PR**, cut from the integration branch for the tree, as
   `CLAUDE.md` requires. Backend tasks branch from the latest verified `origin/backend`
   (owner decision P1) until R-GIT-07 completes.
2. **Failing test first** for every defect (TESTING_AND_QUALITY_REPORT §7).
3. **Independent human review for security-labelled PRs** (anything touching `auth/`,
   `shared/authz/`, `config/env.schema.ts`, migrations, or the permission catalogue). The
   reviewer is not the author, and an automated agent cannot be the only reviewer
   (RK-04).
4. **Authorization changes are reviewed as the route-matrix diff**, line by line.
5. **Cross-tree changes run all three suites at one commit.** The permission catalogue's
   source of truth is `frontend/src/types/auth`; a change there is never frontend-only.
6. **Owner decisions are implemented as written.** Where a decision and the code
   disagree, stop and ask (as with D-9). A1: amend only the approved ADR clauses.
7. **No deployment, CI change or dependency change without explicit authorisation**,
   per `CLAUDE.md`. Tasks R-QA-02, R-QA-03, R-QA-10, R-QA-11, R-SEC-10, R-WEB-04 and all of
   WS-9 need it.
8. **Weekly promotion** of every integration branch to `main` (or trunk-based, per D-1),
   and promotion within one working day of any security fix.
