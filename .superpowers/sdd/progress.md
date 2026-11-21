# DX F1 — Doctor Dashboard foundations · progress ledger

Plan: docs/superpowers/plans/2026-08-18-dx-f1-dashboard-foundations.md
Branch: claude/doctor-dashboard-phase-3-7daec4
Base (before Task 1): 26bd832

## Tasks
- [x] Task 1: Motion tokens, Reveal, Stagger (DX-02)
- [x] Task 2: Collapsible primitive (DX-01)
- [x] Task 3: Persisted section state (DX-01)
- [x] Task 4: Overview page rebuild (DX-01, DX-04)
- [x] Task 5: Reduced-motion verification (DX-05)
- [x] Task 6: Bundle baseline + density measurement (DX-06)

## Pre-flight plan corrections (applied before Task 1)
- Task 2 heading test used an exact name; the heading wraps the trigger button
  so its accessible name is title+caption+summary. Changed to a regex.
- Task 5 asserted focus containment in jsdom, where Tailwind CSS never loads,
  so visibility:hidden is not computed and the test would prove nothing.
  Split: jsdom asserts data-state/class, the browser step at Task 6 verifies
  real focus containment. Added data-collapsible-panel as the stable hook.

## Minor findings (for final review triage)
- Lint baseline in FRONTEND_CHECKLIST §7 says 17 warnings; actual on clean HEAD is 20,
  all pre-existing. Task 6 updates the checklist — correct the number there.
- Plan says `tailwind.config.js`; the repo file is `tailwind.config.ts`. Harmless,
  but later tasks referencing it should use .ts.
- patterns/index.ts is not fully alphabetical (pre-existing StatisticCard/StatusBadge
  drift). Left alone deliberately.

## Log

Task 1: complete (commits fb7e246..0188c24, review clean — spec ✅, quality approved)
Task 2: complete (commits 0188c24..f8acf60, review clean — spec ✅, quality approved)
Task 3: complete (commits f8acf60..f798b24, 1 Important fixed — preference was landing
  in the anonymous namespace, shared across doctors and surviving logout; re-review clean)
Task 4: complete (commits f798b24..3a3d2b8, review clean — spec ✅, quality approved)
  Flaky-test claim adjudicated: admin/logs/SystemLogsSection passes 34/34 in isolation
  (individual cases 1-2.5s); it only times out under full-suite parallel load. Pre-existing,
  unrelated to this tranche. Logged as a Minor for final triage.
Task 5: complete (commits 3a3d2b8..8073f8c, review clean — no production change needed)

## Browser verification (controller-measured, dev server on port 5199)
NOTE: port 5173 is held by ANOTHER worktree's dev server. Measuring there gives the
pre-tranche page (verified: its OverviewPage still has the local Reveal). A
`medora-dev-f1` entry on port 5199 was added to .claude/launch.json for this worktree.

Density at 1280x720, both sections closed (DX-01 acceptance test):
  baseline before tranche ......... 2.61 screens (1742 / 668)
  after Task 4 .................... 1.90 screens (1270 / 668)  MISS
  after 285b6e0 (alerts beside schedule) .. 1.66 screens (1110 / 668)  MISS
  after 5dea50e (schedule|quick side by side) .. 1.43 screens (955 / 668)  MEETS <=1.5
Analytics open: 2.28 screens — expected and allowed (target is default state only).

Also verified live:
- alerts outside both collapsibles, above the fold; 1 h1; no heading-level skips
- persistence: opened Analytics, reloaded, stayed open; stored per-user under
  medora.usr_doctor_amelia.dashboardSections
- focus containment: closed panel computes visibility:hidden, .focus() on an inner
  control leaves activeElement on BODY
- DX-05: with OS prefers-reduced-motion FALSE and the in-app toggle ON, panel
  transition-duration goes 0.2s -> 0.00001s (the app toggle wins, as required)
- DX-04 at 375px, document order: HERO, ALERTS, SCHEDULE, QUICK, ANALYTICS, ACTIVITY
- mobile is 4.1 screens at 375px (not in the target, which is specified at 1280x720)
Task 6: complete (commit bc7e209). Gates all green: typecheck 0, lint 0 errors/20 warnings,
  test 574/574 across 48 files, build green. Chunk figures independently confirmed against
  the build output. LCP/longest-task recorded as dev-server only; production preview could
  not sign in (no .env -> VITE_ENABLE_MOCKS undefined) — recorded in the checklist.

## Final whole-branch review (opus) — findings and disposition
FIXED (commit d6a35a6):
- IMPORTANT: `motion: ['framer-motion']` manualChunk regressed initial JS 133.43 -> 164.42 kB
  gzip (+23%) by eagerly modulepreloading framer-motion, defeating LazyMotion. Reverted;
  now 134.03 kB (+0.6 kB vs baseline). Checklist reframed: the split buys attribution and
  vendor cacheability, NOT weight. The "65% entry chunk win" was redistribution.
- IMPORTANT: alerts regression guard iterated `[role="region"]` without asserting a match —
  vacuous if the selector ever stopped matching. Now asserts 2 panels via data-collapsible-panel.
- IMPORTANT: reduced-motion test did not assert the CSS transition (its whole point), and
  claimed to prove focus containment jsdom cannot. Renamed + transition asserted.
- MINOR: Stagger.startIndex untested -> new Stagger.delays.test.tsx (mocks the motion layer).
- MINOR: motion.ts "cannot drift apart" claim unenforced -> new motion.test.ts enforces it.
- MINOR: DX-04 note omitted the KPI band and left superseded brief wording unmarked.

NOT FIXED — logged for the team, none blocking:
- Spec §3.4 promised `inert` + `hidden="until-found"`; shipped `visibility: hidden` alone.
  Equivalent for focus/a11y (browser-verified) but Ctrl+F no longer reaches closed content.
- Collapsible keeping content mounted while closed is free only because the five collapsed
  widgets have no queries/effects today. DP-04's query hooks change that calculus.
- Collapsible.test.tsx has a trailing-off comment ("// Present in the DOM...").
- OverviewPage inlines the kpi grid classes instead of `Grid preset="kpi"`.
- Admin suite (features/admin/logs) is slow enough to time out under parallel load; passed
  in the last two full runs (587/587) but remains fragile.

Final gates: typecheck 0 · lint 0 errors/20 warnings · test 587/587 across 50 files · build green.
Live re-verified after the fixes: 1.43 screens, 2 panels closed, alerts outside both.
