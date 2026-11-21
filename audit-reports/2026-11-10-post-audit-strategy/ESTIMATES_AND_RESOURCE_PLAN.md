# Medora — Estimates and Resource Plan

| | |
| --- | --- |
| Date | 2026-11-10 |
| Source | Every figure is computed by script from the task index in `MASTER_REMEDIATION_BACKLOG.md` §3 (83 tasks, validated: no broken dependency, no cycle, all 57 findings covered). Change the index and re-run; do not edit these numbers by hand. |
| Nature | Pre-investigation estimates. They are for sizing and sequencing, not commitments. |

---

## 1. Assumptions

### 1.1 What an engineer-day is

- One engineer who already knows this codebase, doing implementation and tests for one
  task.
- **Excluded from the task figures:** code review, waiting for CI, deployment, meetings,
  incident work, onboarding, decision latency, vendor lead times, store review,
  public holidays.
- Ranges are low–high. The low end assumes no surprises; the high end assumes one
  significant surprise per task (a hidden dependency, a failing migration, a flaky
  suite). Nothing here is a "most likely" figure; the mid-point is used only for
  scheduling.

### 1.2 How calendar time was derived

- A list scheduler assigns each task to its owner lane (A, B, C, D), starting it when its
  task dependencies are merged, its decisions are made, and its lane is free; among ready
  tasks it prefers the earliest start, then the higher priority.
- **Focus factor 0.7**: 70 % of a working day goes to planned task work; the rest covers
  review, CI waits, meetings and interruptions. One engineer-day of task effort therefore
  takes about 1.43 working days.
- Five working days per week. No holidays (the mid RS-1 window crosses the year-end
  break; add one to two weeks if the team takes it).
- Penetration-test vendor time is not modelled; only the internal 2–4 days of R-SEC-13.

### 1.3 Decision calendar assumed

| Available from working day | Decisions |
| ---: | --- |
| 5 (end of week 1) | D-7 |
| 10 (end of week 2) | D-1, D-4, D-6′, D-9, D-10, D-14 |
| 20 (end of week 4) | D-2, D-3, D-5, D-8, D-11, D-12 |

### 1.4 Out of scope of every figure

- **The multi-hospital programme** (DR-01 … DR-13: Phases 20–31 in `docs/work-phases/`).
  Only the R-DB-02 sequencing spike and, if chosen, its expand migration are counted.
- Patient-facing AI (RS-4), beyond writing its charter.
- Clinical, legal, procurement and product time (section 6).
- External costs: hosting, processors, penetration test, store accounts.

---

## 2. Totals

### 2.1 By phase

| Phase | Tasks | Low | High |
| --- | ---: | ---: | ---: |
| 0 Repository stabilisation | 18 | 11 | 20.5 |
| 1 Critical security and data integrity | 14 | 28 | 51 |
| 2 Backend and database correctness | 12 | 29.5 | 55.5 |
| 3 Patient app and web functionality | 18 | 74 | 130 |
| 4 AI integration and safety | 7 | 23.5 | 45.5 |
| 5 Quality and reliability | 7 | 18.5 | 31.5 |
| 6 Release readiness (mandatory) | 4 | 8 | 14 |
| **Mandatory total** | **80** | **192.5** | **348** |
| 6 Optional (R-WEB-05, R-DOC-06, R-BE-13) | 3 | 11 | 22 |
| All tasks | 83 | 203.5 | 370 |

### 2.2 By release scenario (cumulative)

| Scenario | Tasks | Low | High |
| --- | ---: | ---: | ---: |
| **RS-1** clinician pilot with real patient data | 55 | **93** | **170.5** |
| **RS-1 + RS-2** public patient release | 73 | **169** | **302.5** |
| — of which patient messaging (only if D-3 keeps it) | 2 | 10 | 16 |
| RS-3 increment (AI clinician assistant) | 6 | 22.5 | 43.5 |
| RS-4 charter only | 1 | 1 | 2 |

`169 + 22.5 + 1 = 192.5` and `302.5 + 43.5 + 2 = 348`: the scenarios partition the
mandatory total.

### 2.3 By workstream (mandatory)

| Workstream | Tasks | Low | High |
| --- | ---: | ---: | ---: |
| GIT Repository | 10 | 5 | 9.5 |
| SEC Security and authentication | 13 | 30.5 | 57 |
| BE Backend and API | 12 | 45 | 83 |
| DB Database | 4 | 8 | 13.5 |
| MOB Patient app | 6 | 18 | 28 |
| WEB Web | 4 | 16 | 29 |
| AI | 6 | 22.5 | 44 |
| QA | 13 | 22.75 | 38 |
| OPS Infrastructure | 7 | 20 | 38 |
| DOC Documentation and release | 5 | 4.75 | 8 |

### 2.4 By owner profile

| Lane | RS-1 | All mandatory |
| --- | ---: | ---: |
| A Lead, backend security | 23.75–42.5 | 63.25–115.5 |
| B Backend and database | 24.5–47 | 48.5–92.5 |
| C Client and CI | 18.75–33 | 51.75–87 |
| D Platform | 26–48 | 29–53 |

---

## 3. Schedule results

### 3.1 Four-person team

| Plan | Low | Mid | High |
| --- | ---: | ---: | ---: |
| RS-1, RS-1 work only | 9.1 wk | **13.2 wk** | 17.3 wk |
| RS-1 + RS-2 (with patient messaging) | 15.4 | **22.0** | 27.9 |
| RS-1 + RS-2 (without patient messaging) | 14.9 | 21.2 | 27.9 |
| RS-1 + RS-2 + RS-3 | 17.8 | **25.1** | 32.4 |
| RS-1 sign-off if RS-2 work competes for lanes | — | 20.3 | — |
| Sequential, one phase at a time (all mandatory) | — | 48.3 | — |

### 3.2 Critical paths (unlimited staffing)

| Scenario | Chain | Length |
| --- | --- | ---: |
| RS-1 | R-QA-01 → R-GIT-04 → R-SEC-05 → R-SEC-06 → R-SEC-07 → R-QA-13 → R-SEC-13 → R-DOC-05 | 17.5–32 ed |
| RS-2 | R-QA-01 → R-GIT-04 → R-QA-06 → R-DB-01 → R-BE-08 → R-BE-09 → R-MOB-01 | 21.5–34 ed |
| RS-3 | R-AI-01 → R-AI-02 → R-AI-03 → R-AI-05 | 19.5–38 ed |

The RS-1 calendar (13.2 weeks mid) is much longer than its dependency chain (about 7
weeks at mid effort and 0.7 focus): **RS-1 is capacity-bound**. RS-2 is **chain- and
decision-bound** — which is why extra people help it little (section 4.3).

### 3.3 Sensitivity

| Change from the base case | RS-1 (mid) | RS-1 + RS-2 (mid) |
| --- | ---: | ---: |
| Base: focus 0.7, decisions per §1.3 | 13.2 wk | 22.0 wk |
| Focus 0.6 | 15.4 | 25.6 |
| Focus 0.8 | 11.6 | 19.2 |
| Every decision two weeks late | 13.7 | 22.0 |
| Every decision four weeks late | 15.7 | 22.2 |
| Every decision six weeks late | 17.7 | 24.2 |

A two-week slip is mostly absorbed because other work fills the lanes. Beyond that, RS-1
moves almost week for week, driven by D-7: hosting gates the whole infrastructure lane.

### 3.4 Where the uncertainty is

The five widest ranges account for 43 ed of the 155.5 ed spread between the mandatory
low and high totals:

| Task | Range | Why it is wide |
| --- | ---: | --- |
| R-AI-03 safety layer and evaluation | 15–30 | Depends on clinician availability and on what the evaluation reveals |
| R-BE-05 staff role workflows | 5–15 | Scope depends on D-3 |
| R-WEB-02 remaining admin sections | 8–15 | Volume; route shapes depend on D-6′ |
| R-OPS-03 backups and OD-006 restore | 6–12 | Managed versus self-hosted; approval-store design |
| R-SEC-12 export and retention requirements | 5–10 | Completeness of the data-category inventory |

Two further risks are not in any range: R-BE-06 may find defects that become new tasks
(MED-SEC-014 was found in exactly this kind of module), and R-DB-02 option (b) may turn
out larger than its 3–5 days once the expand migration is designed.

---

## 4. Resource plan

### 4.1 The four profiles

See `ENGINEERING_WORKSTREAMS.md` §1.1. Two of the four (A and B) must be strong backend
engineers; the plan cannot run with one backend engineer and three client engineers.

### 4.2 Load shape

| Window | A | B | C | D |
| --- | --- | --- | --- | --- |
| RS-1 (weeks 1–14 mid) | Full | **Full, gating** | ~5 weeks slack | Full, front-loaded |
| RS-2 (after RS-1) | **Full, gating** | Full | Full (web and mobile together) | Light after store pipeline |
| RS-3 (if in scope) | **Full** (safety layer) | Light | Light | Light |

### 4.3 Is a fifth engineer worth it?

| Fifth engineer takes | RS-1 + RS-2 (mid) | Saving |
| --- | ---: | ---: |
| No fifth engineer | 22.0 wk | — |
| Mobile tasks (R-MOB-01 … R-MOB-06, R-QA-09) | 21.2 | 0.8 wk |
| Phase 3 backend tasks (R-BE-07, R-BE-10, R-BE-11, R-BE-12, R-SEC-09) | 21.0 | 1.0 wk |

The model says no, not for schedule: RS-2 is bound by its dependency chain and by
decisions. A fifth engineer is still worth considering for **resilience**, because each of
the four lanes is a single point of failure, and lane A carries 63–115 ed of the most
security-sensitive work. A second engineer able to review authentication changes is the
better hire than a fifth pair of hands.

### 4.4 Non-engineering time the plan needs

These are planning allowances, not estimates of anyone's work; adjust with the people
concerned.

| Role | When | What |
| --- | --- | --- |
| Project owner | Weeks 1–2 | D-1, D-9, D-10, D-14; confirm the decision record (R-GIT-03); approve branch deletions |
| Engineering lead | Week 1 | D-7 hosting; D-13 |
| Product owner | Weeks 1–4 | D-3, D-6′ (with architecture) |
| Clinical owner | From week 4; heavy in RS-2 and RS-3 | ADR-033, ADR-031, emergency content, AI intended use and evaluation sign-off; observing the end-to-end runs (G-11) |
| Security owner | Throughout; heavy at RS-1 sign-off | D-4 remainder; review of authentication PRs; gates G-01, G-03, G-10 |
| Legal and compliance | Weeks 2–6 and at each sign-off | D-5, D-8; processor agreements; patient terms; breach-notification obligations |
| Penetration-test vendor | Booked in week 1, testing around week 12 (mid) | R-SEC-13 |

### 4.5 External costs to budget (not estimated here)

Managed PostgreSQL with PITR, object storage with versioning, compute for API and clamd,
error tracking, push and SMS providers, a model provider for RS-3, the penetration test,
Apple and Google developer accounts, and an Expo/EAS plan.

---

## 5. Comparison with the audit's estimate

| | Audit (2026-11-09) | This plan | Why it moved |
| --- | ---: | ---: | --- |
| Total | 140–265 ed | 192.5–348 ed mandatory | See below |
| Reconciliation (T-0.1 / promotions) | 3–6 ed | 2.25–4 ed | Simulated merges: 0, 0 and 2 conflicted files |
| Session policy (T-1.5) | 3–5 ed, or 0.5 to remove | 5.5–11 ed (R-SEC-06, R-SEC-07) | OD-005 is FINAL; removal is no longer an option; three trees and activity classification |
| Revocation (T-1.9) | 1–2 ed, optional | 3–5 ed, mandatory (R-SEC-05) | O-13 and I4 are FINAL; per-request validation |
| Staff 2FA | not planned | 8–14 ed (R-SEC-08, R-SEC-09) | OD-004 (new MED-SEC-013) |
| Backups (T-1.6) | 3–6 ed | 6–12 ed (R-OPS-03) | OD-006 approvals and external evidence |
| Evidence and verification | not planned | 6.5–11 ed (R-QA-01, R-QA-05, R-QA-06, R-QA-13) | No environment existed; nothing had been verified on a deployed stack |
| Module review | not planned | 4–6 ed (R-BE-06) | MED-SEC-014 was in a sampled module |
| Tenancy sequencing | not planned | 3–5 ed (R-DB-02) | DR-01 and Tenant Isolation are FINAL |
| Patient API (T-3.1) | 30–50 ed | 39–62 ed | A published-slot model (DR-10, OD-08) that does not exist |

The plan is larger mainly because the owner's FINAL decisions, which the audit could not
see, add work that the audit treated as optional or did not list.

---

## 6. How to keep these numbers honest

1. **Re-estimate each task when it starts**, after a short investigation, and record the
   new range in the backlog index. Re-run the scheduler.
2. **Track actuals against the range**, not against the mid-point.
3. **Re-plan at each phase exit**, and whenever a decision in §1.3 slips by more than one
   week.
4. **Treat new findings from R-BE-06 as new tasks**, not as overruns of R-BE-06.

## 7. Phase 0 completion amendment (2026-11-10)

The figures in §2–§5 were computed from the 83-task index and are kept as a record. The
index now has **85 tasks** (R-DB-05, R-SEC-14 added; R-DB-02 re-scoped from 3–5 to 6–12 ed
after the owner made the tenant key mandatory before real data). Re-run as §6 requires; the
current totals are in `MASTER_REMEDIATION_BACKLOG.md` §6.6 and supersede §2–§3 here:

| | Before | Now |
| --- | --- | --- |
| RS-1 effort | 93–170.5 ed | **101–187.5 ed** |
| RS-1 + RS-2 effort | 169–302.5 ed | **177–319.5 ed** |
| All mandatory | 192.5–348 ed | **200.5–365 ed** |
| Owner B, RS-1 | 24.5–47 ed | **30.5–60 ed** — the most loaded profile now; see `IMPLEMENTATION_ROADMAP.md` §4 |
| RS-1 four-engineer finish (mid) | 13.2 weeks | **15.9 weeks** |

Decision assumptions changed: D-6′, D-9 and D-10 are available on day 0 (resolved); D-15 on
day 10; **D-7 still assumed by day 5 although it is pending** — every week it slips delays
the 18 hosting-dependent tasks.
