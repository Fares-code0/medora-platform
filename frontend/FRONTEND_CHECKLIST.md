# Medora Frontend — Build & Gap Checklist

**Audited build:** `C:\Users\User\Desktop\Medora_System` @ `f68366c` (Phase 19 — Performance, Security & Platform Consistency)
**Audited on:** 2026-08-09 — static read of `src/**` + live run of the dev server (`admin@medora.health` and `doctor@medora.health`, mock auth)
**Source of truth for scope:** [`UX_ARCHITECTURE.md`](UX_ARCHITECTURE.md) §2 (Doctor) and §3 (Administrator), [`FRONTEND_ARCHITECTURE.md`](FRONTEND_ARCHITECTURE.md), [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md)
**Size:** ~52,000 LOC across `src/` · 13 feature modules · 15 doctor pages · 15 administration sections
**Re-verified:** 2026-09-03 — every route driven in Chromium at three viewports, two themes and five locales, then swept again by *state*: every tab, unresolvable ids, junk parameters, a client-side navigation and an injected crash. Sixteen defects found and fixed. Method, findings and limits in [§11](#11-the-verification-sweep--2026-09-03).
**Completion pass:** 2026-10-21 — five unintegrated API routes connected (each with adapter contract tests, a mock twin and UI tests): mark-all-read in one write, propose other times on a request, the medication monograph (D-18's monograph half), prescription notes, and the upcoming time-off list with cancel. A scripted audit of every success/info toast in `src/` found 19 (16 success, 3 info) that fired before their write resolved, plus one fabricated "Restore complete"; all fixed and pinned by tests. Details on the rows below; method and limits in [§12](#12-completion-pass--2026-10-21).
**Completion pass 2:** 2026-10-21, branch `claude/frontend-completion-pass-2` — two live-mode defects fixed (a data-error report that announced delivery to a queue nobody reads; a prescribing strip that drew "current medications" from the prescriber's own list), F34's three unnamed sign-in refusals named in five locales, and five more served routes connected (record report-issue; patient alerts, history, emergency contacts add and correct; the patient medication tab for the prescribing strip). The canonical task register with the owner's status vocabulary is [§13](#13-master-task-register--2026-10-21); open owner decisions are [§14](#14-decision-log--dec-xxx).
**Completion pass 3:** 2026-10-22, on `frontend` @ `a0142ea` (detached, uncommitted working tree) — NEW-06/07 built, and the browser checks the earlier passes owed were run: every `IMPLEMENTED_UNVERIFIED` row was driven on a mock-mode bundle (two remain below `COMPLETE_VERIFIED` by rule, not by gap). Six defects found that way and fixed: a report export that announced a file it never wrote, staff accounts captioned "MD, FACP", a 20 px in-field button failing WCAG 2.2 2.5.8, `aria-required` on a bare fieldset, a heatmap a keyboard could not scroll, and four row actions that dropped their patient. Q-01/Q-02 measured — Q-02 found a +55 % initial-JS regression since DX-06. Method, figures and limits in [§15](#15-completion-pass-3--2026-10-22).
**Completion pass 4:** 2026-10-22, branch `claude/frontend-completion-pass-3` from `frontend` @ `a0142ea` — the owner's four approved decisions executed: the toast host announces through persistent polite/assertive regions instead of nested ones (F-18); a controlled-medication demo prescription in `pending-approval` lets Cancel be driven in the browser (NEW-10); the initial-JS regression is fixed at its three sources (NEW-21: eager JS 207.36 → 170.33 kB gzip, a signed-in doctor's cold load 308.70 → 234.71 kB); and the work is on a PR. Found on the way: the brand intro suppresses LCP on every fresh session, which is why Lighthouse could never score performance (NEW-22, DEC-012 proposed). Method and figures in [§16](#16-completion-pass-4--2026-10-22).
**DEC-012:** 2026-10-23, branch `claude/dec-012-intro-reveal` — option B implemented: the app paints at full opacity beneath the brand intro and the overlay's own fade is the reveal. A first visit now has a Largest Contentful Paint (fresh-session runs with an LCP entry: 0 of 28 before, 28 of 28 after), and Lighthouse scores `/login` for the first time (desktop 100, mobile 84–86 on the deployed demo bundle). Method, figures and limits in [§17](#17-dec-012--the-intro-reveals-a-painted-page--2026-10-23).
**Final completion audit:** 2026-10-23, branch `claude/medora-frontend-checklist-audit-am0xys` — every row re-checked against the code; the register is **not** complete: 48 of 76 rows done, 28 not (20 blocked, 6 awaiting an owner decision, 1 partial, 1 open), plus the 14 blocked multi-hospital rows. Built: UX §3.9's per-role member list. Verified: no dead buttons (AST scan of `src/` plus a browser click sweep), every dashboard widget and quick action, and Lighthouse on authenticated routes (desktop 96–99, mobile 78–86). Found and recorded: custom roles are now served by the API (DEC-013), caption text is 11 px against the DS's 12 px (DEC-017), and seven stale rows corrected. Detail in [§18](#18-final-completion-audit--2026-10-23).
**Completion pass 5:** 2026-10-24, same branch, local commits only. DEC-013, DEC-015, DEC-016 and DEC-017 are resolved and built. DEC-014's stories are done: 190, covering every public shared component, rendered in both themes with axe. NEW-05 is done, and NEW-22's exit now matches the approved frames. The axe sweep found three accessibility defects, all fixed. The register stands at 54 of 76 rows complete, with none awaiting frontend work alone ([§19](#19-completion-pass-5--2026-10-24)).
**Reconciliation:** 2026-10-25, branch `claude/backend-contracts-checklist-reconcile` — the register recounted from its rows (**55 of 76** `COMPLETE_VERIFIED`; §13.1 still said 54 after the BR-DEC follow-ups, PRs #102–#105), eleven checkbox/status and stale-text contradictions corrected, and `backend` read at `7ed7e4d` against `main` at `f4a9e8d`: 124 routes are served only on `backend`, nothing BR-DEC is on `main`. Contracts by branch in [`docs/handoff/BACKEND_FRONTEND_CONTRACTS.md`](../docs/handoff/BACKEND_FRONTEND_CONTRACTS.md); method and limits in [§20](#20-reconciliation--2026-10-25). Then built, on `claude/notifications-organize-preferences`: **NEW-24**, notification archive/favourite/pin, clear-read and preferences over the API (routes on `backend` only) — the register stands at **56 of 77**.
**Completion sprint:** 2026-10-25, stacked task branches from `frontend` @ `02dd6fe` (PRs #106/#107 merged) — the backend-only, doctor-own routes §20.5 named eligible, connected one at a time: the Overview's trend, satisfaction and recent activity over RM M27 (§3.1 pulse, PR #108); Settings → Privacy and Integrations (read and disconnect; connect waits on the server) over RM M22 (§3.12, PR #109); Reports & Analytics over RM M21 — analytics, and saved and scheduled reports as far as the server goes, with two pre-existing schedule defects fixed (§3.11, PR #111). The PRs first filed this work under new IDs (NEW-25…29); every one duplicated an existing row and is retired (§13.1 *Retired IDs*, rule in §8). Method, evidence and limits in [§21](#21-completion-sprint--2026-10-25).
**Completion batch:** 2026-10-25, branch `claude/frontend-checklist-batch-overview` from `frontend` @ `38822d0` (PRs #117–#119 merged) — the register re-read, every route `backend` and `main` serve compared with every path the web client calls, and the one frontend-doable gap that comparison found built: **NEW-30**, the Overview's Row-0 critical alerts banner (UX §2.1, RM M27.3). The register stands at **58 of 78**. Method, evidence and limits in [§22](#22-completion-batch--2026-10-25).
**Governance:** 2026-10-26, branch `claude/medora-frontend-checklist-71a9wr` — multi-hospital frontend tasks have one status register, [`CLIENTS_CHECKLIST.md`](../docs/multi-hospital/CLIENTS_CHECKLIST.md) (WEB-1…WEB-16). ORG-01 and ORG-02/03 move out of the register to §13.6, which maps every overlapping row and ⚠ note to its WEB row and keeps no status of its own. No task changed state: the register stands at **58 of 76** (78 less the two rows now counted only as WEB-1/2 and WEB-14/15). Rule in §8 (rule 9), method in §13.1.
**Realigned:** 2026-10-06 — to the owner's multi-organization decision: Medora is a multi-hospital / multi-clinic platform; a doctor may belong to several organizations and works in one **active organization** at a time; administration splits into **organization admin** and **platform admin**; clinical data is **organization-scoped** by default. Affected rows carry a dated ⚠ **Multi-organization realignment** note naming the action (Rewrite · Split · Replace · Future · Blocked · Keep) and the API it depends on; the API dependencies are [§9.1](#91-multi-organization-api-dependencies--2026-10-06) (API-W01…W14). Nothing in this realignment is implemented — it records what the frontend will need from the Backend and Database teams. The tenancy decision is not yet recorded in `docs/DECISIONS.md`, where ADR-018 §1 (single clinic) still reads as accepted until it is superseded (next free number: ADR-042).

> ⚠ **Superseded in part — 2026-10-07.** The owner's FINAL decisions replace the 2026-10-06 multi-organization model: the **Hospital** is the isolation boundary, a doctor has **one active hospital employment** and **no organization switcher**, and administration is **Hospital Admin + Platform Admin**. Cross-hospital access is a purpose-limited, category-limited, audited **grant** or audited emergency **Break-Glass**. Where a ⚠ *Multi-organization realignment* note below conflicts with them, the decisions win: [`docs/multi-hospital/OWNER_DECISIONS.md`](../docs/multi-hospital/OWNER_DECISIONS.md), with the phase plan in [`docs/work-phases/`](../docs/work-phases/README.md). The row notes are not rewritten here.

---

## Status codes

| Code | Meaning                                                                                    |
| ---- | ------------------------------------------------------------------------------------------ |
| ✅   | **Done** — built, wired, and behaves as specified                                          |
| 🟡   | **Partial** — the screen exists but a specified capability is missing or is a stub         |
| 🔷   | **Planned** — specified in `UX_ARCHITECTURE.md` but no code exists                         |
| ❌   | **Missing / broken** — required by the spec or by basic usability, and absent or defective |
| ➖   | **Out of scope** — deliberately deferred (Patient / Receptionist experiences)              |

Severity on gap rows: **P0** blocks real use · **P1** the product feels incomplete · **P2** polish.

**Ownership.** Every unmarked row is frontend work you can start today with the mock data already in the repo. Rows marked 🔗 **depend on someone else** — the UI is yours, the data or enforcement behind it is not. There are ten of them, listed together in §9 so you can hand them off rather than get blocked on them. The multi-organization realignment (2026-10-06) adds fourteen more, in §9.1 — each an API the Backend team provides and, where noted, data the Database team must model first.

---

## 0. Executive summary — the three real problems

1. ~~**The Admin Dashboard specified in `UX_ARCHITECTURE.md` §3 was never built.**~~ **CLOSED.** At the time of the audit, eight of its nine sections did not exist and `/admin/*` redirected to `/doctor/administration` — an admin got the **Doctor Administration Center** (clinic operations: queue, rooms, shifts, staff), a different product for a different job. **All nine are now live**: §3.1 overview (ADM-01, and it is what `/admin` lands on), §3.2/§3.3 doctors, §3.4 patients, §3.5 appointment oversight, §3.6 communication monitoring, §3.7 system logs, §3.8 reports (ADM-08, the last one) and §3.9 settings, with §1.5 PHI governance underneath them. The Administration Center survives as clinic operations at `/admin/clinic` and below, which is problem 2.

2. ~~**Ten of fifteen administration sections are read-only tables with zero actions.**~~ **CLOSED by Phase B** — AC-02…AC-13 each have their write path (§5, all ✅; §7 step 6). *(Reconciled 2026-10-25, §20.)* The original text follows. Staff, Departments, Rooms, Resources, Schedule, Holidays, Shifts, Queue, Waiting Room contain no `onClick` and no `useMutation` anywhere. "Staff Management — Clinic team, roles, availability and permissions" renders five rows and offers no way to add, edit, deactivate, or assign anyone. This is the "admin page has a lot of missing things" you described.

3. **Core clinical write paths are missing on the doctor side.** **Partly closed: `pharmacy` and `labs` now have them.** D-17/D-19 built the prescription authoring flow, its blocking fail-closed safety screen, and the pharmacy module's first mutations (sign, save-as-draft, renew, cancel-with-reason), and the Overview's "New prescription" button now opens that flow instead of the prescriptions list. D-10…D-14 then built the lab review loop — the Inbox, mark-reviewed (fail-closed on a critical value, bulk-restricted to Normal), the critical-unreviewed chip, analyte trends, and attach-to-record behind an identity check — so a doctor can now clear a result queue and file a report onto a chart. D-21 then closed the records side — authoring, note signing (fail-closed, and only over your own note) and amend-not-edit — so all three modules UX §2.3/§2.6/§2.7 give a doctor write access in now have it. **What remains: `dashboard` has no mutations of its own, and nothing anywhere can *order* a lab** — the labs module reviews results, it does not raise requests. See DX-22/DX-23 (§10). *(Reconciled 2026-10-25, §22.)* Stale: DX-23 built lab ordering in the labs feature (`/doctor/labs/new`, `POST /lab-orders`), linked from the dashboard's quick actions (§10.4); the dashboard still has no mutations of its own, by DX-23's rule.

Everything else in this document hangs off those three.

---

## 1. Foundations & tooling

| #    | Item                                                           | Status | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | -------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-01 | Vite + React 18 + TypeScript strict                            | ✅     | `tsc -b` clean                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| F-02 | Tailwind + design tokens (`styles/tokens.css`)                 | ✅     | Light/dark, semantic token layer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| F-03 | TanStack Query + query-key factory                             | ✅     | `src/api/query-keys.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| F-04 | React Router v6 with lazy feature chunks                       | ✅     | Per-feature `routes.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| F-05 | Zod-validated env (`configs/env.ts`)                           | ✅     |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| F-06 | ESLint + Prettier, zero warnings                               | ✅     |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| F-07 | 🔗 `ApiClient` transport with 401 refresh hook                 | 🟡     | Class exists and is imported by every feature's `api/` layer, but **every call resolves against local mock data** — no endpoint is live. `src/api/endpoints/` contains only `.gitkeep`. **Stale — corrected by the 2026-10-23 audit (§18):** the transport is done and live builds call the API; FE-10 records 27 features Connected and 10 wired but Blocked ([`docs/FE-10-INTEGRATION-STATUS.md`](../docs/FE-10-INTEGRATION-STATUS.md)), and later passes connected more (§12.1). §13.2 F-07 is the current reading (`COMPLETE_VERIFIED`, G-1 applies).                                                                                                                                                                                                                                                                                                                                         |
| F-08 | **Test runner**                                                | ✅     | **Phase A.** Vitest 3 + jsdom + Testing Library, `vitest.config.ts`, `src/test/setup.ts`, scripts `test` / `test:watch` / `test:coverage`. 52 tests across 10 files: `ApiClient` (transport, error normalization, single-flight 401 refresh), route guards (all 5 branches × 4 guards), the patients query layer, and the Phase A a11y fixes.                                                                                                                                                                                   |
| F-09 | **Component workshop / Storybook**                             | ✅     | **Every public component has stories, 2026-10-24 (§19.2)** — 190 stories, both themes, axe-checked; the text below is the 2026-09-01 harness. **Stood up, 2026-09-01.** The row was never about writing stories — `__stories__/README.md` recorded that no framework had been chosen, so no story could be committed without failing `tsc -b`. That decision is now made and measured in [ADR-0004](../docs/adr/0004-component-workbench.md), the ADR-0002 method: both candidates installed into a throwaway project rather than estimated. **Storybook 9 + `@storybook/react-vite` adds 171 packages / 159 MB against Ladle's 419 / 132 MB** — it adds fewer than half the packages, which inverts the usual reputation and broke the tie. It reuses the app's own Vite config, so a story resolves aliases, PostCSS and Tailwind exactly as production does; `@storybook/addon-a11y` gives §8.2's axe requirement and runs on every story. **Zero cost to the app bundle** — dev dependencies only, `npm run build` unchanged. 15 stories over Button · Badge · Input · Alert · StatusBadge · the loading/empty/error trio, with the matrices **generated from the union types and presentation maps rather than hand-listed**, so a seventh button variant or fifteenth status kind appears the moment it is declared. Theme is applied the way `ThemeProvider` applies it, so a story shows what the app renders. Verified: `build-storybook` succeeds and **15 of 15 stories render with zero page errors**, in both themes. **Not done, deliberately:** five components of ~45 have stories — the row is the harness and the pattern, not a claim that §8.2's acceptance artifact exists for every Tier 1–2 component; the rest are mechanical against this pattern and belong with the next touch of each. Hover/focus are named in the Button story as states a reviewer must exercise by hand rather than omitted. Not wired into CI — whether a failing axe check blocks a merge is the owner's policy call. |
| F-10 | CI pipeline (typecheck + lint + test on push)                  | ✅     | **Phase A.** [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs typecheck · lint · test · build on every branch and PR, scoped to `frontend/`. **Verified green on GitHub** — [run 31331946364](https://github.com/Fares-code0/smart-healthcare-assistant-system/actions/runs/31331946364), all four steps passing. No longer blocked on anyone else.                                                                                                                                                               |
| F-11 | Bundle budget / route-chunk analysis                           | ✅ P2  | **Closed by DX-06 (§10.1).** `vite.config.ts` now has opt-in `ANALYZE=1` visualizer output and `manualChunks` (`react`, `query`); the before/after chunk table is recorded. *(Reconciled 2026-10-25, §20.)* An earlier revision listed a `motion` chunk; DX-06 tried it, measured a 23 % regression and reverted it, and `vite.config.ts` says so beside the config.                                                                                                                                                                                                                                                                                                                                          |
| F-12 | Feature flags                                                  | ✅ P2  | ~~`aiAssistant: false` while the routes and sidebar entry mount regardless.~~ **Closed with D-08.** The row called it dead code; it was not, and that was the defect — it had exactly one reader, `AppNavbar`, where it hid the Sparkles shortcut while the route mounted unconditionally and the sidebar and bottom tab bar both showed the entry on `ai.use`. One module, three doors, two rules. The flag is gone and the navbar reads `ai.use` like its siblings, so the three cannot drift. `billing` stays — `false` is *accurate* there (no widget exists) — but its doc now says out loud that **nothing reads it**, so whoever builds the revenue tiles must call `isFeatureEnabled` rather than assume flipping it does something. |
| F-13 | Error boundaries + 403/404/route-error pages                   | ✅     | `app/error-boundary/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| F-14 | Accessibility: reduced-motion, focus rings, ARIA on primitives | ✅     | **Audited, 2026-09-01.** The row's stated gaps were F-15…F-18, and all four are done, so it was closed by measurement rather than by assertion: `axe-core` 4 at **WCAG 2.1 A/AA** (`wcag2a wcag2aa wcag21a wcag21aa`) against the **production build** on 19 routes — 10 doctor, 7 admin (each area signed in as its own role), plus `/login` unauthenticated. Result: **19 of 19 clean, zero violations**. One real defect was found and fixed on the way: `DistributionBars` carried `role="img"` on a `<ul>` so a screen reader would hear one labelled figure instead of N bars — the right intent, but the role overrode the list semantics and orphaned its own `<li>` children (axe `listitem`, *serious*, ×4 on `/doctor/reports`). The elements now match the role; `DistributionBars.test.tsx` pins the general rule so it cannot return. **Not covered, and therefore not claimed:** axe finds roughly half of WCAG issues and nothing here is a substitute for a screen-reader pass or keyboard walkthrough of every flow; Lighthouse separately reports **touch targets below the recommended size on `/login`** (a best-practice audit, not A/AA), which this row does not fix. **Measured 2026-10-21 (§12):** at 375 px, five `/login` targets are under 24 px and all five pass WCAG 2.5.8's spacing exception (nearest neighbour 50–196 px centre-to-centre), so **zero AA failures**. Against DS §1's own *"≥ 44 × 44 px on mobile"*, nine fall short — including the full-width Sign in at 32 px tall — because every control primitive is compact (`md` = 32 px). That is a conflict between the design system and its primitives, not a page defect, and it is recorded rather than fixed: the fix DS §8 names (an invisible hit-area extension below `lg`) changes click behaviour on every screen and can overlap adjacent targets, which is an owner decision. (The old "§10.3.2" pointer is stale — §10.3 was retired with F3.) **Resolved 2026-10-21 by DEC-008 (B):** on a coarse pointer every control now owns a 44 × 44 px target and no two targets overlap — measured in Chromium with touch emulation against a mock-mode demo bundle, 505 controls at 375 px and 734 at 1024 px, zero short, zero intercepted; axe WCAG 2.1 A/AA re-run clean on 10 routes in both layouts. Desktop unchanged. Not verified on a physical device or in WebKit/iOS Safari. Detail in §14.1 DEC-008. |
| F-15 | **Skip-to-content link**                                       | ✅     | **Phase A.** [`SkipToContent`](src/layouts/SkipToContent.tsx) is the first focusable element in **both** shells (`AppShell` and `AdministrationLayout`), targets the shared `MAIN_CONTENT_ID`, and `<main>` took `tabIndex={-1}` so focus actually lands there. Verified live: activating it moves `document.activeElement` to `main`.                                                                                                                                                                                          |
| F-16 | **Per-page document titles**                                   | ✅     | **Phase A.** [`useDocumentTitle`](src/hooks/useDocumentTitle.ts) + [`useRouteTitle`](src/layouts/useRouteTitle.ts) derive the name from the same `handle.crumb` the breadcrumb reads, so naming a page stays a route-config change. The Administration Center mounts a descendant `<Routes>` (invisible to `useMatches`), so it derives its title from the URL via `sectionTitleFromPath`. Verified live: `Overview · Medora`, `Patients · Medora`, `Labs · Medora`, `Staff Management · Medora`, `Platform Settings · Medora`. |
| F-17 | **Heading hierarchy**                                          | ✅     | **Phase A.** Root cause was two hardcoded `<h3>` title elements: `Card` (platform) and `Panel` (admin). Both now take a `headingAs` prop mirroring the one `Section` already had — `Card` defaults to `h2`, `Panel` to `h3` (correct beneath a `SectionShell` h2), and the four Clinic Overview panels that sit directly under the page `h1` pass `h2`. Verified live: zero skips on every page checked, both portals.                                                                                                          |
| F-18 | **Live-region announcements for async results**                 | ✅     | **Phase D (D-17).** The prescription safety screen is the first async result whose outcome a user must not miss, and it now owns one polite live region for the whole progress→outcome narration ([`SafetyScreen.tsx`](src/features/doctor/pharmacy/components/authoring/SafetyScreen.tsx)): "Checking interactions…" then the verdict, with the warning count and how many are critical. One region rather than per-alert `aria-live`, so the stack does not replay itself on every re-render; the failure banner additionally interrupts as `role="alert"` via `Alert`'s error variant. Asserted by test (`NewPrescriptionPage.test.tsx`) and verified live. **Scope of the claim:** the pattern and the one surface that needed it most are shipped; toasts elsewhere in the app are still unaudited, and each async surface adopting it is a small follow-on rather than new design work. **Toasts (2026-10-22, pass 4):** rebuilt on persistent polite/assertive announcers instead of nested live regions — see §13.2 F-18; screen-reader verification outstanding. |
| F-19 | **App-wide i18n / RTL**                                        | ✅     | **Arabic is a target, so this was the cross-cutting rewrite the old row said it would be — done as the rewrite, not as a translation pass.** `features/auth/i18n/` was promoted to **`src/i18n/`**, a platform layer (added to the §1.2 restricted-paths zone so it cannot drift back); the auth paths are re-export shims, so every existing `t('login.title')` call site is unchanged. **Five locales are live and typed**: English, العربية, Türkçe, فارسی, Français. `Locale` became a **union** rather than `string`, and `catalogues` is `Record<Locale, Record<MessageKey, string>>` — **total in both directions**, so a key added to `en.ts` without its four translations does not compile and a language cannot ship half-translated. The predecessor was `Partial<Record<string, …>>`, which is exactly how that happens. **Direction is set once, on `<html>`, by `LocaleProvider`** — `lang` and `dir` together, both on every change, including back to `ltr` on the way out. No `dir` prop is threaded anywhere and **no component has an RTL variant**: `dir` inherits, so logical CSS mirrors the whole app for free. **The RTL audit converted ~270 physical utilities to logical ones** across 84 files (`ml/mr`→`ms/me`, `pl/pr`→`ps/pe`, `left/right`→`start/end`, `text-left/right`→`text-start/end`, `border-l/r`→`border-s/e`, `rounded-l/r`→`rounded-s/e`), and `src/i18n/logical-properties.test.ts` scans all of `src/` and fails on a new one — a stray `ml-4` looks correct in English and quietly breaks a corner of two languages nobody on the team reads. **Directional icons mirror through one CSS rule**: lucide stamps each icon with its own class, so `[dir='rtl'] .lucide-chevron-right` covers all 56 call sites at once. `arrow-up-right` is deliberately excluded — it means *trending up*, a chart convention that reads the same in every script, and mirroring it would turn growth into decline. The genuine exceptions, each an explicit `rtl:` variant: `transform` is physical in both directions (the `Switch` knob would slide out of its own track; a centring `-translate-x-1/2` under a `start-1/2` lands a full width off; the mobile drawer would cross the screen to enter), and gradient direction. Latin-only runs (version string, demo credentials) are pinned `dir="ltr"`, because the bidi algorithm renders `© 2026 Medora · v0.1.0` as `Medora · v0.1.0 2026 ©` inside an RTL paragraph. **Translated in full: the shell** — navigation (`label` became a typed `labelKey`, so a nav entry pointing at a missing message is a compile error), breadcrumbs, global search, notifications, avatar and theme menus, skip link, mobile drawer, bottom tab bar, and the shared `Pagination` · `Modal` · `Drawer` · `Alert` · `FlowStepper` controls — plus all of auth. 199 keys × 5 locales. `LocaleSwitcher` is now one control shared by login and Settings → Appearance; the old copy appended " (RTL)" to Arabic, a label an Arabic reader neither needs nor reads. 21 tests, including that each catalogue is <10% identical to English (the check a type system cannot make: a catalogue satisfying `Record<MessageKey, string>` by pasting the English in), that every `{placeholder}` survives translation, and that Persian uses ک/ی rather than their near-identical Arabic lookalikes ك/ي — which no reviewer catches by eye. **Verified in the browser in all five**: correct `lang`/`dir`, the sidebar mirroring to x=1136 in Arabic and Persian, translated navigation, no horizontal overflow at 1360px, no console errors. **Not done, and named in [`docs/handoff/i18n.md`](../docs/handoff/i18n.md):** ~2,045 user-facing literals inside the feature interiors are still English (354 in `admin/sections`, 178 in `doctor/settings`, 163 in `doctor/pharmacy`, …). They are not blocked — the mechanism is in place and the pattern is one line per string — and they are deliberately **not machine-translated**: this is clinical software, and a plausible-looking wrong rendering of "contraindication" or "review before signing" is more dangerous than a screen that is visibly still in English. While they remain English the RTL locales show bidi reordering inside them ("appointments 5" for "5 appointments"); that is not a layout bug and has no layout fix, and a blanket `dir="auto"` would be worse — it would also flip genuinely Arabic text beginning with a Latin patient name. Also absent: `Intl` number/date formatting against the active locale (Arabic still shows Latin digits), plural rules (Arabic has six forms), and any translator-facing extraction format. |

---

## 2. Auth & session (UX §1.4)

| #    | Screen                                            | File                                | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---- | ------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A-01 | Login                                             | `features/auth/pages/LoginPage.tsx` | ✅ **F34 closed (2026-10-21, pass 2):** `account_inactive`, `two_factor_required` and `rate_limited` each have their own message, in the server's words, in all five locales (`login.error.{inactive,twoFactorRequired,rateLimited}`), instead of "Something went wrong". `LoginPage.test.tsx` fails on the old page. The four non-English strings want a native speaker's review like the rest of the auth catalogue.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| A-02 | Signup                                            | `SignupPage.tsx`                    | ✅                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| A-03 | Forgot password                                   | `ForgotPasswordPage.tsx`            | ✅                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| A-04 | Reset password                                    | `ResetPasswordPage.tsx`             | ✅                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| A-05 | Verify email                                      | `VerifyEmailPage.tsx`               | ✅                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| A-06 | Verify OTP                                        | `VerifyOtpPage.tsx`                 | ✅                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| A-07 | Lock screen                                       | `LockScreenPage.tsx`                | ✅                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| A-08 | Role guards (`RequireAuth` / `RequireRole`)       | `app/router/guards.tsx`             | ✅ ⚠ **Multi-organization realignment (2026-10-06) · Rewrite.** Guards and route trees must distinguish **doctor**, **organization admin** and **platform admin**, not only `doctor \| admin`; navigation offers only what the role may use. The server stays the boundary. Depends on API-W01 (§9.1). |
| A-09 | Auth i18n + language selector                     | `src/i18n/` (was `features/auth/i18n/`) | ✅ — and no longer auth-only: **F-19 promoted this module to a platform layer** and extended it to five locales with RTL. `features/auth/i18n/` is a re-export shim, so auth's call sites are unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| A-10 | ~~"Remember me" checkbox has no accessible name~~ | `LoginPage.tsx`                     | ➖ **Withdrawn — false positive.** The original audit read `checkbox "on"` from the browser's accessibility-tree tool. A Phase A test proved the association is correct: `Checkbox` and `Input` both wire `label htmlFor` ↔ `input id`, and `getByRole('checkbox', { name: 'Remember me' })` resolves. The tool was reporting the input's _value_, not its name. Regression tests kept at [`Checkbox.test.tsx`](src/components/ui/Checkbox.test.tsx). |
| A-11 | Idle auto-lock after 10 min (UX §1.5.5) | `app/providers/AuthProvider.tsx` | ✅ **Correction — the original audit was wrong here.** The idle timer *does* exist: `AuthProvider` arms it while authenticated, resets it on user activity, and tears it down on unmount, using `sessionPolicy.idleLockMs` (10 min, `configs/session.ts`). Confirmed by observing a real session lock itself after idling. |
| A-12 | 🔗 Real auth backend                              | `features/auth/service.ts`          | ✅ **The seam ships.** `env.enableMocks` now selects between `mock/mock-auth-service.ts` and `api/endpoints/auth.ts` behind one port (`types/auth/auth-service.ts`); `AuthProvider` imports neither adapter. Proven end to end against the live API: registered, verified, signed in, landed on the dashboard, and watched four concurrent 401s collapse into **one** rotation. Mocks unchanged — `doctor@medora.health` / `Medora123!` still signs in with zero network calls. Twelve contract mismatches found and fixed on the frontend; pattern + mismatch table in [`docs/handoff/auth-seam.md`](../docs/handoff/auth-seam.md). **Not yet real:** the lock screen re-auth (no backend endpoint — see that doc §4) and every non-auth feature (DP-02). ⚠ **Multi-organization realignment (2026-10-06) · Split → ORG-01.** The session carries no organization: `SessionUser.clinicId` is issued only by the mock. The session adapter must read the active organization and memberships from the server, re-issue the session on a switch, clear the query cache, and render states for *no active membership* and *membership revoked*. Depends on API-W01 (§9.1). |
| ORG-01 | 🔗 Organization context in the session and shell | `types/auth/`, `app/providers/AuthProvider.tsx`, shell | ↗ **Status: WEB-1, WEB-2 (with WEB-4, WEB-5)** in [`CLIENTS_CHECKLIST.md`](../docs/multi-hospital/CLIENTS_CHECKLIST.md) (2026-10-26, §13.6). *Was:* 🔷 **Planned — blocked on API-W01 (§9.1).** Added by the multi-organization realignment (2026-10-06). The shell names the active organization; a switcher appears only for a doctor with more than one membership; every organization-scoped query key includes the organization id; a switch clears cached data and refetches. Replaces the mock-only `clinicId` (D-27b). |

---

## 3. Doctor Dashboard (UX §2)

### 3.1 Overview — UX §2.1 ✅

`features/doctor/dashboard/` · 17 source files · 1,755 LOC (comments included)

> **The Overview is a dashboard the doctor composes (2026-10-04).** It is no longer a fixed arrangement. A first visit shows no widgets, only an empty state inviting the doctor to customize; "Customize dashboard" opens a Drawer listing the catalogue, one Switch per widget, applied live; a widget is removed from its own ⋯ menu (with an Undo toast) or from the drawer, and is available to add again at once. The page renders whatever `useDashboardWidgets` holds, through `DashboardWidgetGrid` — a wrapping flex row where each widget asks for a preferred width by size (`compact` / `standard` / `wide`) and a share of the leftover, so every row fills edge to edge whatever is in it and order stays the doctor's. The catalogue is `model/widgets.ts`; adding a widget is one entry there. The selection persists per user through the preferences service (`dashboardWidgets`), in this browser only, and is cleared on logout with the rest of the user's namespace — following a doctor across devices needs a server-side preference that does not exist yet. Verified in Chromium at 375 / 768 / 1024 / 1280 / 1440 / 1920 px, light and dark: every row flush at both edges, 16px gaps, no overlap, no horizontal overflow, no clipped button, zero console errors. *(Superseded in part 2026-11-03, §37.2: the drawer now edits a draft — one Checkbox per widget, applied only on **Done**; Cancel, close, Escape and the scrim discard it. The header button reads "Customize".)*
>
> The items below are the catalogue now — each one is a widget a doctor may add, not a band the page always draws. All of them still render the dashboard's own fixtures (`model/mock-data.ts`), and the drawer marks each as **Sample data** from the catalogue's `source` field (DX-10's rule: the marker is data, so it disappears when the source changes). Quick actions and the AI Assistant carry no data.

- [x] Greeting header with day context. The decision count left the caption: it was a figure the doctor had not chosen, and "Pending requests" is a widget now
- [x] Metrics, one widget each: today's appointments · pending requests · active patients · completed this week
- [x] Today's schedule timeline with status badges
- [x] Notifications widget (critical / request / message / confirmed)
- [x] Practice pulse metrics + appointments trend chart
- [x] Recent activity feed · AI assistant entry · patient satisfaction
- [x] ~~Recent activity rows had no padding~~ — `first:pt-0 last:pb-0` sat on each row's only child, so every row matched both and lost its padding. Moved to the `<li>`
- [x] ~~**D-01 · P1 — Quick actions are navigations, not actions.**~~ **Half closed (D-17).** "New prescription" now opens the real four-step authoring flow at `/doctor/pharmacy/new` — it *links* to the flow the pharmacy feature owns rather than forking a second one inside the dashboard (DX-23's rule). Verified live from the dashboard button. **"Message a patient" is unchanged** and still navigates to the messages list: there is no compose flow to open (D-24, §3.9), and relabelling it is DX-22a's call, not this task's. "Open AI Assistant" and "Open schedule" were always honest navigations. → remainder tracked in **DX-22, §10.4**
- [x] ~~**D-02 · P2 — Metric reading order.** In Practice pulse the delta chip precedes the value in the DOM, so the accessible name reads _"Avg. consultation duration, 2 min down vs last month, 24 min"_. Visually fine; announced backwards. Move the value before the delta.~~ **Closed.** The metric row is a two-column grid instead of a two-child flex row, so the DOM runs label → value → delta (matching `StatisticCard`) while the value still paints right-aligned and centred against both rows. Now announced _"Avg. consultation duration, 24 min, 2 min down vs last month"_. Pinned by `PracticePulseWidget.test.tsx`.
- [x] ~~**D-03 · P2 — 2.5 screens of vertical scroll** at 1280×720 with no in-page anchor or section collapse.~~ **Absorbed by DX-01, §10** — closed there: 2.61 → 1.43 screens with both sections collapsed by default.
- [x] **Appointments trend, patient satisfaction and recent activity over the API (2026-10-25, §3.1 pulse; recorded briefly as NEW-25, retired).** Live builds said "Not available yet" for all four analytics widgets. `backend` serves three of them as independent routes (RM M27.2, `GET /dashboard/doctor/{trends,satisfaction,recent-activity}`, `records.view`, each scoped to the caller's own `doctors` row). The HTTP adapter now loads them beside the core sections but apart from them: a 404 — what an API built from `main` answers — keeps "Not available yet", any other failure fails that widget alone with Retry, and the KPIs, schedule and decision list still render. **Practice pulse is unchanged:** no route on any branch serves consultation length, response time or no-show rate. **Branch:** `backend` only (`docs/handoff/BACKEND_FRONTEND_CONTRACTS.md` §B.3).
- [x] **Row 0 — the critical alerts banner (2026-10-25, NEW-30).** UX §2.1 puts a full-width, non-dismissible banner above everything else on the Overview: unreviewed critical lab results, allergy conflicts on today's patients and urgent reschedules, each with one resolving action. It was never built, and no row tracked it — the notifications widget carries "critical" items, but a doctor may leave that widget off. It is now `CriticalAlertsBanner`, above the grid and the empty state alike, on its own query so it neither waits on the overview nor fails with it. Live builds read `GET /dashboard/doctor/critical-alerts` (RM M27.3, **`backend` only**): a 404 (`main`) says nothing because nothing was checked; any other failure says *"Couldn't check for critical alerts"* with Check again — never silence, which would read as "nothing critical". The demo lists what the Labs page's "Critical unreviewed" chip counts, from the same store. Evidence on the register row (§13.3 NEW-30).
- ⚠ **Multi-organization realignment (2026-10-06) · Rewrite — blocked on API-W02 (§9.1).** Every widget renders the active organization's data only, and its query key carries the organization id. Composition and layout are unchanged. ↗ **Status: WEB-3, WEB-4** in [`CLIENTS_CHECKLIST.md`](../docs/multi-hospital/CLIENTS_CHECKLIST.md) (2026-10-26; this note keeps no box of its own, §13.6).

> **The dashboard experience upgrade (motion system, information density, real quick actions) is specified in [§10](#10-doctor-dashboard--experience-upgrade-dx) and scheduled as Phase F in [§7](#7-recommended-order-of-work).** ~~Nothing in §10 has been started.~~ F1 shipped and F4 is done; F2 and F3 are retired (§10). *(Reconciled 2026-10-25, §20.)*

### 3.2 Patients — UX §2.2 ✅

`features/doctor/patients/` · 31 files · 3,799 LOC · 1 mutation file

- [x] P1 table with filters, search, row actions, card list at <md
- [x] Pagination, bulk selection, export
- [x] Shared patient-identity roster (`features/shared-domain/patient-identity/`)
- ⚠ **Multi-organization realignment (2026-10-06) · Rewrite — blocked on API-W02 (§9.1).** The list shows the patients of the active organization and **that organization's** record number — an MRN is a hospital's number, not Medora's. No client-side merging of a person across organizations. ↗ **Status: WEB-3** in [`CLIENTS_CHECKLIST.md`](../docs/multi-hospital/CLIENTS_CHECKLIST.md) (2026-10-26; this note keeps no box of its own, §13.6).

### 3.3 Patient Profile — UX §2.3 🟡

- [x] Identity header, summary sidebar, summary cards
- [x] **Record an allergy (2026-10-21, second pass).** `POST /patients/:id/allergies` (API §4.6) from the Allergies tab. Severity has **no default** — a pre-selected "mild" would be a clinical judgement nobody made; an allergen already on record is refused (the server's 409, mirrored case-insensitively in the mock and checked in the dialog before it round-trips); pessimistic, and the mutation settles only after the chart refetches, so "recorded" is never announced over a table still reading "No known allergies" (caught in the browser, fixed, re-verified). No edit or remove — correcting an allergy is its own clinical act. **Why it waited:** in mock mode the chart read the static seed while the prescribing flow picks its patient from the directory's session store, so an allergy written to the chart would have been invisible to the safety screen. `shared-domain/patient-identity/mock-directory.ts` now owns identity and allergies in mock mode and the chart resolves from it; `features/allergy-safety-coherence.test.ts` drives chart → directory → `screenPrescription` and fails on the old code. Two defects closed on the way: a patient registered through "Add patient" opened as **"Patient not found"** in the demo, and the demo screen matched allergy classes **case-sensitively**, so a recorded "penicillin" slipped past the Penicillin-class block. Verified in Chromium: recorded on Khaled Nassar's chart, shown severe in the prescribing flow's pinned patient strip in the same session.
- [x] **Record vital signs (2026-10-21, second pass).** `POST /patients/:id/vitals` (API §4.6) from the Overview tab's vitals card — the chart is where the API stores vitals, which is why the record-authoring flow omits them live. All eight readings required, validated against the server's `createVitalsSchema` bounds kept as data (`model/vitals.ts`): a typo (720 bpm, Fahrenheit) is refused, an alarming reading is accepted. BMI is the server's, never entered. Verified in Chromium at 1440 and 375 px.
- [x] **Raise a clinical alert · add a history event · add and correct emergency contacts (2026-10-21, pass 2).** `POST /patients/:id/alerts`, `POST …/history`, `POST`/`PATCH …/emergency-contacts` (API §4.5–4.6). Overview → **Raise alert** (severity has no default; 300-character cap) and the Emergency contacts card (**Add**, per-contact **Edit**; the server's phone rule; marking one primary says beforehand that it demotes the current one, which is what the server does); History → **Add event** (kind has no default; the date picker's maximum is the latest day the server accepts near midnight). All pessimistic: announced after the chart refetches with the change on it; a failure keeps the form. The profile now carries the full contact list and the sidebar derives the primary from it, so the two cannot disagree. Mock twin refuses what the API's schema refuses. **Not built, pending DEC-003:** resolving an alert, removing a history event, removing a contact. Also fixed: the history timeline's icon used a physical `-left` offset and sat on the wrong side of the spine in Arabic and Persian. Tests: `chart-writes.test.tsx` (7), `mock-profile-service.test.ts` (7), `http-profile-service.test.ts` (+6).
- [x] 🔗 **Patient-chart notes — write, correct, sign (2026-10-21, DEC-001).** *(Reconciled 2026-10-25, §20.)* Ticked to match §13.3 (`COMPLETE_VERIFIED`, 2026-10-24): the author rule this row was waiting on, BR-DEC-001, is enforced server-side on **`backend`** (`acc2c7e`, PR #89 — 403 `not_note_author` on edit and sign). It is **not on `main`**, so an API built from `main` still accepts a colleague's edit; production release waits on `backend` → `main` (DEC-001's release gate). The text below is the 2026-10-21 state. `POST /patients/:id/notes`, `PATCH …/notes/:noteId`, `POST …/notes/:noteId/sign`. Notes tab → **Write note** (saved unsigned); **Edit** and **Sign** appear only on the signed-in user's own unsigned notes (`canActOnNote`: the note's `author` — `users.public_id` — equals `SessionUser.id`; never by display name). Signing is confirmed and freezes the note; pessimistic throughout; the server's 409 is shown in its words. **These are display rules, not authorization:** the API's edit and sign do not check the author (`patient-tabs.repository.ts`), so any clinician who can reach the chart can edit or sign an unsigned note by calling the API. **Release-gated on BR-DEC-001** (§14.1); the mock twin deliberately matches the API's current behaviour so the demo cannot imply a protection the backend lacks. Tests: `chart-notes.test.tsx` (6), adapter (+3), mock (+2).
- [x] Tabs: Overview · History · Medications · Allergies · Notes · Appointments · Documents · Lab results · Imaging
- [x] ~~**D-04 · P1 — Documents tab actions are placeholder toasts**~~ **The fabricated file is gone; the tab says what it cannot do, and a port is waiting for M25.** The row's own description understated it: the actions were not toasts, they *worked*. `PatientProfilePage` passed `openPdfPreview(patientDocumentDataset(…))` and `exportPdf(…)`, so pressing Download on "Referral letter — cardiology.pdf" downloaded a real PDF, under that exact filename, containing three fields — document name, patient, assigned doctor — and none of the referral. The failure was silent and the artefact left the browser. Same defect class as the Imaging "View report" D-05 removed, and resolved the same way.

  **What shipped.** A documents port (`patients/model/patient-documents-service.ts`), typed from `backend/src/shared/files/file-storage.types.ts` rather than from a mock: `resolve()` answers a **signed URL, not bytes** (the backend's own rule — "streaming every attachment through the API turns the app into a file server"), and `scan-pending` / `infected` are ordinary answers because API §17.2 gates download on the malware scan. Its one adapter is `unconfigured-documents-service.ts`, the mirror of the backend's `UnconfiguredFileStorage`, and **there is deliberately no `mockDocumentsService`** — inventing bytes to stand in for a scan of a patient's insurance card is not a mock, it is a forged clinical document, and no seam flag should be able to turn it on. `service.test.ts` asserts on the answer rather than the wiring so that stays true.

  **Storage state is asked once, not per click.** `/health` already reports a storage indicator (API §20.1, `unconfigured` today), so the tab is told before it renders whether there is anything to press. Asking per click would put "there is no storage in this build" behind a button the doctor had already trusted — D-16's shape exactly. While unconfigured the actions column is absent (not greyed: a disabled button still advertises the capability) and one notice covers every row; the rows themselves stay, because the metadata is real. The column returns intact the moment the indicator reads `available` — no UI edit on integration day.

  **Tests assert the negative,** since "the button is gone" would pass against a version that greys it out and exports on Enter: `usePatientDocumentAccess.test.tsx` drives the real hook against the real service and watches anchor creation — the referral letter's filename never reaches a file — and `PatientProfilePage.test.tsx` re-checks it through the mounted record, because the exporter lived in the *page*, not the tab.

  **Still owed, and not faked:** the upload half of this row. There is no upload dialog, and building one over storage that answers 503 would be D-18's "fake completeness". `patientDocumentDataset` was deleted rather than left unused. → the 🔗 stays open on the **service**, not on the UI.
- [x] 🔗 **D-04b · P2 — Uploading a document.** **The frontend half is built; the store still refuses.** `upload()` joins the port, typed from the backend's `put()` (`kind: 'patient_document'`, one of API §17.1's seven), and the unconfigured adapter answers 503 like every other operation — deliberately, because a resolved upload would put a row in the tab for a file that reached no store, and the next session, which keeps nothing, would find a consent form that does not exist. The backend's own stub makes the argument: a `put()` that resolves without writing "would hand the caller a file id for bytes that do not exist, and the failure would surface later as a broken download rather than a failed upload." (2026-11-14: reconciled with §13.3 — COMPLETE_VERIFIED, pass 23)

  The control follows the read side's rule — **absent until storage answers `available`** — for the same reason the actions column is: an upload button over a 503 invites a doctor to hand the app a consent form it will drop. It is a plain `<input type="file">` behind a button, not a drag-and-drop dialog with a progress bar and a type filter, because the parts worth building — accepted types, size caps, per-kind rules — are **M25's to define**, and guessing them here would ship a form that disagrees with the store it finally talks to. The category picker is deferred on the same grounds.

  `PatientDocument` still has no `mimeType` or scan status: nothing produces one yet, and both are already in the port's vocabulary (`ResolvedDocument` carries `scan-pending` and `infected`). → still 🔗 on the service.

  **Pass 16 (2026-11-01, §33): the HTTP adapter exists, so the frontend half of D-04 and D-04b is complete.** Live builds now select `http/http-documents-service.ts`. It reads storage from `GET /health`, opens a document through its chart (`GET /patients/{id}/documents/{documentId}/download`), and uploads in two calls, `POST /files` then `POST /patients/{id}/documents`. The plain file input became `UploadDocumentDialog`, which asks for the category with no default; every upload used to be filed as `referral`. The mock build still connects nothing. This box stays open: the adapter has not been run against a store, and `/health` reports `storage: unconfigured` even when one is configured, because the backend registers no storage indicator. So the live tab still hides its actions (DEC-018).
- [x] ~~**D-05 · P1 — Lab/imaging tabs are placeholder cards**~~ **Lab results is real; imaging has no source and now says so.** The tab reads the patient's actual orders through a new `features/shared-domain/lab-studies/`, which is where the laboratory model, its seeded corpus **and its session store** moved — the `conversations/` move, for the same reason (§3.4 forbids `patients` importing `labs`, whose public API is one route export). **Moving the seed alone would not have closed it:** D-11 made review state mutable in a `Map` private to the labs adapter, so the profile would have projected the unreviewed original for ever. One store means a result reviewed on the Labs screen stops saying "Awaiting review" here — asserted by a test that was checked by re-splitting the store and watching it fail (`mock/store-agreement.test.ts`). The labs feature was left otherwise untouched: `model/types.ts` re-exports the shared model, so all 36 of its importers are unchanged, and the StatusBadge meta maps moved with the model rather than being copied, because two copies is how the profile calls an order "Processing" that the Labs screen calls "Collected". **The tab lists; it does not read** — each row links to `/doctor/labs/:labId` rather than rendering values, since the report viewer, the trend and the review flow all belong to the feature that owns them.

  **Imaging is not closed, and is not pretended to be.** There is no radiology feature, no PACS adapter and no imaging dataset anywhere in `src/` — only the profile's own generated study list. Its "View report" opened a PDF built from the patient's name and assigned doctor: a document that looks like a radiology report and contains none of one, the same defect class as D-16's success toast. The action is gone and the tab carries a notice saying no imaging service is connected. Closing it properly needs an imaging source, which is a 🔗 row nobody has opened yet.
- [x] ~~**D-06 · P1 — "Print / export patient summary (PDF)"** not implemented.~~ **Stale row — it was already built**, and this task only verified it rather than writing it. `patientSummaryDataset` (`model/patient-export.ts`) feeds "Print summary" and "Export as PDF" on the profile's More-actions menu through the shared export engine. Verified in the browser, not from the code: the menu item downloads `medora-patient-pt-1001.pdf`, 1,070 bytes, starting `%PDF-`.
- [x] ~~**D-07 · P2 — "Flag data error → routed to admin"** (UX §2.3) not implemented; there is no admin queue to route it to (see §4.1).~~ **Both halves of that were wrong, and the second one had gone stale.** It *was* implemented, after a fashion: the profile's More menu carried "Report an issue with this record" and it opened a **`mailto:records@medora.health`** with the patient's name and MRN in the subject line. Three defects in one action — nothing was recorded, so no one could tell whether a report had ever been made; nothing reached an administrator, because a mailbox is not a queue and that address is a fixture; and it pushed **PHI into whatever mail client the machine has configured**, which is patient data leaving the application by the front door. And "no admin queue to route it to" stopped being true when Phase C shipped ADM-01's action queue.

  **No new admin screen was needed, because the vocabulary was already there.** `SupportFlagKind` has always included `'data-correction'` — seeded on a couple of accounts, with nothing producing one. The doctor's report now becomes exactly that flag on the patient's admin account, so it reaches `openWorkCount` and through it the queue's existing **"Accounts with open issues"** row and its `/admin/patients?flag=open` destination. One count, already wired, that cannot disagree with the list it lands on.

  **The store is `shared-domain/data-error-reports/`** — the doctor writes, admin reads, neither imports the other (§3.3/§3.4), the arrangement D-14 uses for lab attachments. Session-lifetime and in memory, never `localStorage`, because a report names a patient and quotes a doctor about them. Append-only apart from resolution.

  **Two things the round-trip test caught that reading the code would not.** Folding reports in at `expand()` looked right and was silently dead: `DEFAULT_PATIENTS` is built once at module load, so a report filed afterwards never appeared. And persisting a merged document would have baked the reports into `localStorage`, where resolving one could not remove it and the next merge would duplicate it. So `load` merges on the way out, `persist` stores only the administrator's own decisions, and the reports stay owned by the one store that can resolve them. Scope is deliberately the **demographic and identity** fields: the admin patients area is "account support … never clinical review" by its own description, and a clinical correction belongs to D-21's amend path, not to people whose remit excludes acting on it.

  **Live builds (2026-10-21, pass 2) — the entry is absent.** Everything above is mock mode, where the admin patients area reads the same store. A live build has no patient-level report route (API §6.9's `report-issue` is per medical record) and its admin patients area is "Not connected yet", yet the dialog filed into the demo store and toasted *"It is now on this patient's account in the administrators' queue"* — a report nobody could read. Filing now goes through a seam (`shared-domain/data-error-reports/service.ts`) whose live side is unavailable and refuses, and the More menu omits the entry when it is unavailable. `live-data-error-report.test.tsx` fails on the old header.

- ⚠ **Multi-organization realignment (2026-10-06) · Rewrite — blocked on API-W02; cross-organization items on API-W04 (§9.1).** The tabs render only what the API returns for the active organization and never present it as the patient's complete history. When a future, clinically approved rule shares allergies, active medications or chronic conditions from another organization, those items carry a source-organization label and are read-only. ↗ **Status: WEB-3, WEB-8; cross-hospital items WEB-11 (API-W04 is withdrawn, DR-03)** in [`CLIENTS_CHECKLIST.md`](../docs/multi-hospital/CLIENTS_CHECKLIST.md) (2026-10-26; this note keeps no box of its own, §13.6).

### 3.4 Appointments — UX §2.4 ✅

`features/doctor/appointments/` · 25 files · 3,096 LOC · 1 mutation file

- [x] Table + card list + **calendar day / week / month views**
- [x] Add appointment dialog · reschedule dialog · reason dialog (cancel/decline)
- [x] Details drawer, row actions, filters drawer, summary cards
- [x] Detail route `/doctor/appointments/:appointmentId`
- [x] **Propose other times (2026-10-21).** A pending request can now be answered with up to three alternatives (`POST /appointments/:id/propose-slots`, API §5.8) instead of only approved or declined. The server had offered `propose-slots` in `availableActions` all along and the adapter dropped it "rather than offering a dead button"; the flow now exists, so the action is kept. Slots are picked across days through `SlotPicker`, shared with the reschedule dialog rather than copied; the request's own slot is excluded from the conflict check exactly as the server excludes it; the API's cap of three is the dialog's (`MAX_PROPOSED_SLOTS`); the commit goes through a confirmation and the toast follows the server's answer. The mock refuses a proposal on anything but a pending request, as the API does. Verified in Chromium on the demo bundle: menu → two slots → review → send → "Proposed 2 times to …", zero page errors.
- [x] **Upcoming time off (2026-10-21).** Blocking time was write-only: a block booked by mistake could not be seen or taken back. "Upcoming time off" lists the doctor's unfinished blocks (`GET /me/time-off`) and cancels one behind a confirmation (`DELETE /me/time-off/:id`) that states what it does not undo — appointments a resolution already cancelled or moved stay that way. Pessimistic: a refused cancel keeps the block on screen with the failure named. A failed load is an error, never "no upcoming time off".
- [ ] ⚠ **Multi-organization realignment (2026-10-06) · Rewrite — blocked on API-W02, API-W03 (§9.1).** Location on rows, cards and detail; a location picker on create **only** when the organization has more than one location — the organization itself is never chosen in a form, it is the session's; times shown in the location's timezone. ↗ **Status: WEB-1, WEB-3 for the hospital and location shown** in [`CLIENTS_CHECKLIST.md`](../docs/multi-hospital/CLIENTS_CHECKLIST.md) (2026-10-26). The location picker on create and the location-timezone display are named by no WEB row, so this box stays open here until one is approved (§13.6).

_The strongest module in the build — use it as the reference implementation for the ones below._

### 3.5 AI Medical Assistant — UX §2.5 🟡

`features/doctor/ai/` · 20 files · 2,678 LOC

- [x] Chat surface, patient binding, mock streaming responses
- [x] ~~**D-08 · P1** — `featureFlags.aiAssistant === false` yet the module is fully mounted (see F-12). Decide which is true.~~ **Decided: the module is true, the flag was not.** The row (and F-12) assumed the flag was dead code. It had exactly one reader — `AppNavbar`, hiding the navbar's Sparkles shortcut — while `ai/`'s route mounted unconditionally and the sidebar and bottom tab bar both offered the entry, gated on the `ai.use` permission. So the assistant had three doors answering to two rules, and the flag's door was the one claiming a built, reachable feature did not exist.

  **Wiring it was the wrong half of "either wire it or delete it."** A flag switches work that is *incomplete*; `features/doctor/ai/` is not — turning it on would have restored a shortcut to a page already one click away in the sidebar. So the flag went, and the navbar now reads `ai.use` like its two siblings. A flag would have needed keeping in sync with a permission for ever; three readers of one permission cannot drift, which is what the tests assert. Whether a deployment should be able to disable the assistant is a real question — it belongs to `ai.use` and to D-09's model service, not to a build constant.
- [ ] 🔗 **D-09 · P0** — No model backend; all responses are canned (`ai/mock/`). **The frontend half is now closed as far as it can be: the seam is built and the adapter is behind it.** §9 row 4 already recorded the surface as done, and it is — chat, streaming render, token rendering, error/retry. What was *not* done was the seam: `api/useAiQueries.ts` and `hooks/useChatSession.ts` imported `mock/mock-ai-service` **directly**, the one thing `docs/handoff/auth-seam.md` §1 rule 3 forbids, and the exact defect that document was written about (`AuthProvider` hard-importing `mock/mock-auth-service`). Every consumer now goes through `ai/service.ts`, so a model service arrives as one adapter plus a `selectService` call rather than an edit to the chat.

  **The port is typed as an assistant API would answer, not as the mock happens to behave** (rule 2). `generateReply` returns a **whole answer**, because the token animation is a render-time affordance over text the hook already holds — calling it a stream in the port would promise a transport nothing implements, and a real SSE adapter should add a method rather than silently redefine this one. `attempt` is on the input because a real backend needs to know it is seeing a retry. Conversation CRUD stays on the port even though it is in memory today (S1, §43 — it was `localStorage`), so server-side conversations need no new call sites.

  **A type does not keep a seam closed** — the old code typechecked perfectly while reaching past it — so `service.test.ts` asserts the rule over the source tree, and asserts that every reply still carries the disclaimer naming it as demo output. That last one matters more than it looks: the canned prose is realistic clinical Markdown with drug doses, ICD codes and a critical sodium, and it is only safe to render while every reply says what it is (`model/responses.ts` appends it; `ChatPanel` repeats it under the composer). **Still blocked on the model service itself** — nothing here invents one.

  **2026-11-22 (§43).** *Production bundles ship this mock assistant:* `scripts/mock-boundary.ts` exempts `features/doctor/ai/mock/` and `model/store.ts` ("D-09 — disclosed mock assistant until Phase 28"), so `npm run build` keeps it. Whether it should ship to production at all is an **owner decision, recorded and not taken here**. *S1 is fixed:* conversations — which carry a patient's name once opened from a patient — are no longer written to the global `medora.ai.conversations.v1` key; they live in memory and end on sign-in, logout, lock and a refused refresh, settings moved under the per-user `medora.<userId>.` prefix, and the legacy global keys are deleted on first load.

### 3.6 Lab Systems — UX §2.6 🟡 → the review loop is built; annotation is not

`features/doctor/labs/` · 48 files · 7,112 LOC · **1 mutation file** · 65 tests (with `shared-domain/record-attachments`)

- [x] Results table, filters drawer, summary cards, card list, detail route + report viewer
- [x] **D-10 — Inbox / All results tabs.** `?tab=` owns them like every other list param. **Inbox is "results needing review", not "everything completed"** — an order still in the lab is nobody's outstanding work, so `reviewState` has three values and only `unreviewed` reaches the queue. Both tabs read one array through one `summarizeLabTests` call, so the tab counts, the critical chip and the rows cannot disagree. The Inbox self-sorts (`sortInbox`: critical → abnormal → longest-waiting) and an explicit column sort still wins. `/doctor/labs` opens on Inbox; a `?patient=` deep link opens on All results, because the four screens that link here mean "show me this patient's results" and an Inbox would answer a different question. The toolbar gained the two filters §2.6 names and the build never had — **result flag** and **review status** — with `flag` replacing the old `critical` boolean (`?critical=1` still reads as `flag=critical`).
- [x] **D-11 — Mark reviewed, and it fails closed.** `model/review.ts` borrows the pharmacy's shape: `assessReviewability` is the **only** producer of `ReviewableTest`, that type carries a module-private symbol, and the mutation and the adapter both demand one (`assertReviewable` re-checks it at runtime). So a critical value with an unticked box, a tick with no note, an order with nothing released and a result already reviewed all reach the same place — **there is no value to submit**, which is a stronger property than a disabled button, and the tests assert the absence of the write rather than the presence of an attribute. Bulk review is the same rule from the other side (`partitionForBulkReview`, UX §2.6's "bulk allowed only for Normal"): anything abnormal — not merely critical — is refused, and the refused rows are **listed by name with the reason** and stay selected, because a bulk action that silently skips them leaves the doctor believing the queue is clear. **Both mutations are pessimistic**, declining DP-05 optimism for the reason §2.6 states: a row that leaves the Inbox before the write lands has already told the doctor, wrongly, that it is handled. A failure keeps the dialog open, names what failed, and leaves the result in the Inbox.
- [x] **D-12 — "Critical unreviewed: N" pinned above the tabs.** Counts the whole dataset rather than the page, so a filter cannot hide the fact that a critical value exists; its action narrows the list to exactly what it counts, as **one** URL write (three `setSearchParams` calls in a handler all read the same router state and the last wins — the test caught it). Renders nothing at zero.
- [x] **D-13 — Analyte trend, with the reference band.** "View trend" sits on each numeric analyte row, not once above the table. Up to three analytes overlay with distinct `chart*` tones; points carry their own flag hue and a native tooltip; a table toggle is the P6 equivalent. Two model rules: the y-window is derived from the data and the band (`trendDomain`) and **never anchored at zero** — a potassium range of 3.5–5.1 charted from zero is unreadable, which is also why this is a feature-local chart rather than the shared `LineAreaChart` bent out of shape — and `trendBand` returns **null** when overlaid series do not share one reference range, with the drawer saying so, rather than shading whichever range came first. The mock dataset grew a history for this: four prior generations of each panel per patient, and Omar Farouk's potassium is a deliberate series — 4.4 → 4.7 → 5.0 → 5.6 → the critical 6.1 the dashboard alert names.
- [x] **D-14 — Attach report to patient record, with the identity check.** The check is structural, not a dialog: the encounter list is scoped to the result's own patient, the confirmation carries **the identity it confirmed** rather than a boolean (so changing the encounter voids it by construction), and `assessAttachability` is the only producer of the `AttachableReport` the store demands. Patient id and MRN are compared independently — a matching id with a differing MRN is refused, because it means one of the two records is wrong about who this is. **The attachment lands in `features/shared-domain/record-attachments`, which the medical record renders from**, so the Labs screen cannot claim an attachment the record does not carry; the record's Attachments section lists them with a link back to the result. Pessimistic, like the review: nothing says "attached" before it is.
- [x] ~~**D-15 · P2 — No annotate-result action.**~~ **Built**, on the row menu and the detail page through the same `useLabReviewActions` hook the review and attach flows use, so the two surfaces cannot drift. `assessAnnotation` is the only producer of the value `LabService.annotate` accepts, so an empty note is unrepresentable rather than merely refused by a disabled button — D-11's shape applied to a much smaller rule — and `assertAnnotatable` refuses a forged one at runtime too. The port exposes **no edit and no delete**: rewriting what a named clinician said about a patient's result is a compile error, not a missing button.

  **A note is not a timeline event, and is stored apart from one.** The timeline is the audit of what the laboratory did to the specimen; an annotation is a clinician's opinion about the finding, often from someone other than the orderer. Folding them together would let a reader mistake a colleague's interpretation for something the lab asserted. Notes carry their own disclosure string on the record and the UI renders it verbatim, so a real service drops the caveat by answering differently (the DX-10 contract).

  **Scoping is offered because it changes the meaning**: "consistent with the diuretic" says something different pinned to the potassium than floating over a metabolic panel, so a multi-analyte result gets an analyte picker that defaults to the order as a whole rather than guessing. An analyte that is not on the order is refused rather than silently re-scoped. A browser check caught the dialog withholding its refusal reason for a whitespace-only note — the trimmed "have they started typing" test read spaces as nothing typed, leaving a dead Save button with no explanation, which is the exact failure the dialog exists to prevent. 8 tests. **Not persisted beyond the session**, like the review beside it: the store is in memory because `services/preferences.ts` is the app's only sanctioned storage and it is never for PHI.
- [x] ~~**D-16 · P2 — Export/print are `toast({variant:'success'})` with no artifact.**~~ **Stale row — closed by `utils/export.ts` + `ExportButton`**, which calls `runExport` *before* the toast, so the toast now reports something that happened. Verified in the browser: the Labs export downloads `medora-labs.csv`, 924 bytes, header `ID,Patient,Test,Code,Category,Department,Status,Priority,…`.
- ⚠ **Multi-organization realignment (2026-10-06) · Rewrite — blocked on API-W02 (§9.1).** Inbox and All results consume organization-scoped responses; empty states say "in this organization"; a result from another organization (future sharing only) carries a source label. ↗ **Status: WEB-3; cross-hospital results WEB-11** in [`CLIENTS_CHECKLIST.md`](../docs/multi-hospital/CLIENTS_CHECKLIST.md) (2026-10-26; this note keeps no box of its own, §13.6).

### 3.7 Pharmacy — UX §2.7 🟡 → the core flow is built; the medication database is not

`features/doctor/pharmacy/` · 48 files · **the module's first write path**

- [x] Prescriptions table, filters, summary cards, detail route + viewer
- [x] ~~**D-17 · P0 — The 4-step "New prescription" flow does not exist.**~~ **Built.** Patient → Medication → Dosage → Review & sign at `/doctor/pharmacy/new`, deep-linkable from a patient context (`?patient=`), from a saved or renewal draft (`?draft=`), and from a cold start. Steps validate individually, cannot be skipped forward past an invalid one, and preserve entered data on the way back.

  **Fail closed, and how it is enforced.** Signing is not a disabled button — it is *unrepresentable*. `assessSignability` is the only producer of `SignablePrescription`, that type carries a module-private symbol nothing else can name, and `PrescriptionService.sign` accepts nothing else (`model/safety-check.ts`). A thrown check, a timed-out check, a check that never ran, a verdict for a *different* medication or dosage, and a result the client cannot positively read as a warning list all reach the same place: no value exists to sign with, and `assertSignable` refuses a forged one at runtime too. `runSafetyCheck` never rejects — a failure is a *variant of the verdict*, because an exception is something a `catch` can quietly turn into an optimistic default.

  A fourth fail-closed case was found while building and is now covered: an **unloaded** current-medication list is not an empty one, so screening before the prescriptions query answers would have reported "no interactions" for a patient who has several. The check now refuses to run without that context.

  **What is real and what is demo.** The stepper, the blocking screen, the severity-graded stack, acknowledgment-with-reason, the fail-closed paths and the write path are real. The **verdicts are not**: they are computed from `catalogue.ts`'s five-medication demo formulary and its canned notes. Every warning and every verdict carries `source: 'demo-formulary'`, and the UI renders its marker from that field (the DX-10 contract), so the label cannot be deleted while the content stays fake and it disappears by itself when a real service answers. Patient allergies and current medications are the app's own coherent mock roster, not invented.

  `?simulate=error|timeout|unreadable|slow` (mocks only) faults the check so the fail-closed path can be watched in the live app, not only in a test.
- [ ] 🔗 **D-18 · P0 — No "Medication database" tab** (typeahead + monograph drawer). UI is yours; the drug reference data is not. **Monograph half built (2026-10-21):** the server serves `GET /medications/:id/monograph` (API §7.2), so the medication step offers "View monograph" for the selected entry and a drawer renders indications, contraindications, standard dosing, warnings, side effects and pregnancy category — each section the formulary does not record says *"Not recorded in the formulary."* in words, because a blank Contraindications reads as "none". A 404 is "No monograph on file", a failure is an error with retry. **Live builds only**: `capabilities.monographs` is false for the demo formulary, which holds no monographs, and inventing prescribing prose for real drugs would be fabricated clinical reference — the control is absent there (verified in the demo bundle: 0 controls). The drawer is mounted only when opened, so nothing is fetched for a monograph nobody asked for. **Typeahead built (pass 15, 2026-10-31, §32):** the medication picker searches `GET /medications?q=`. **Still blocked:** only the drug reference dataset it searches, which is external content, not code.
- [x] ~~**D-19 · P1 — No renew, no cancel-with-reason, no save-as-draft, no sign & send.**~~ **Built**, on the row menu (`PrescriptionRowActions`) and the detail page (`PrescriptionQuickActions`) alike, through one shared `usePrescriptionLifecycle` so the two cannot drift. Renew pre-fills a draft from an existing prescription and re-runs the safety screen before it can be signed. Cancel-with-reason takes a reason category plus optional detail and writes both to the timeline; it was built **optimistic with rollback** (DP-05) and made **pessimistic** on 2026-10-22 (see DEC-002), as `FRONTEND_ARCHITECTURE.md` §10 requires of prescription writes. Sign & send is deliberately **pessimistic** — a prescription must never appear to have succeeded before it has. Drafts survive navigation for the session; they are held in memory, **not** `localStorage`, because `services/preferences.ts` is the app's only sanctioned storage and is for UI preferences, "never PHI, tokens, or clinical drafts".
- [x] **Prescription notes (2026-10-21).** The Notes section was read-only; "Add note" now appends one (`POST /prescriptions/:id/notes`, API §7.10). Append-only by construction — the port has no edit or delete — and pessimistic: the note joins the list from the server's answer, a failure keeps the typed text with the reason beside it. The 1–4,000 character bound is the API's, and the mock refuses what the API would. Verified in Chromium on the demo bundle.
- [x] **The prescribing strip lists every medication on record (2026-10-21, pass 2).** The pinned strip's "Current medications" came from `GET /prescriptions`, which is **the caller's own list** (API §7.3), so live it showed nothing another clinician prescribed or the patient reported, and read "No active prescriptions on file" for a patient on someone else's warfarin. The server's safety screen was never affected — it screens its own records and re-screens at signing — but the strip is what the doctor reads. It now reads `GET /patients/:id/medications` (active entries) through `listCurrentMedications`, names each entry's source, and shows a failed load as an error with retry; the old strip also showed a failed load as "none". In mock mode the method answers the same running courses the demo engine screens. Tests: `PatientContextStrip.test.tsx` (4), adapter (+2), mock (+2). **Still open, demo-only:** the patient profile's mock regimen is generated separately from the pharmacy store (§12.4) — NEW-05 in §13.
- [x] ~~**D-20 · P2 — Export/print toasts produce no file.**~~ **Stale row — closed by the shared export engine.** Verified in the browser: `medora-prescriptions.csv`, 565 bytes, header `ID,Patient,Medication,Dosage,Frequency,Status,Doctor,Start,End`.
- ⚠ **Multi-organization realignment (2026-10-06) · Rewrite; the cross-organization half blocked on API-W04 (§9.1).** The safety screen states whose data it screened ("allergies and medications recorded at this organization"). A cross-organization safety summary appears only when API-W04 exists under an approved clinical rule; until then the screen must not imply it checked other hospitals. ↗ **Status: WEB-8; the cross-hospital half WEB-11 (API-W04 is withdrawn, DR-03)** in [`CLIENTS_CHECKLIST.md`](../docs/multi-hospital/CLIENTS_CHECKLIST.md) (2026-10-26; this note keeps no box of its own, §13.6).

### 3.8 Medical Records — UX §2.3/§2.6 adjacency 🟡 → it can record now

`features/doctor/medical-records/` · 50 files · 6,580 LOC · **1 mutation file** · 59 tests

**Scope note.** `UX_ARCHITECTURE.md` has no Medical Records section — §2.1–§2.11 does not contain one, and `PHASE6_MEDICAL_RECORDS.md`'s own "Out of scope" reads *"No editing, no backend, no AI logic."* D-21 was therefore derived from **UX §2.3's Visits and Notes tabs** ("note status signed/unsigned"; "unsigned notes carry a warning badge… requiring review + sign"; "Unsaved note navigation triggers a confirm dialog"), which is the only written guidance that exists. Where §2.3 was silent the choices are recorded below rather than left implicit.

- [x] Records table, filters, detail route, sectioned record viewer
- [x] **D-21 — Create, sign, and amend.** A four-step flow at `/doctor/medical-records/new` (patient → encounter → clinical → review), reachable from the records list, the dashboard quick actions (closing DX-23's record half) and any `?patient=` deep link. The step machine is pure and lives in `model/authoring.ts`, so "can I reach Review?" is answered in a unit test rather than in component state.

  **Creating and signing are two acts.** The flow ends at "Create record", which produces a **draft** encounter whose note is **unsigned**; signing happens on the record, where the note can be read in the context it belongs to and where the author check applies. A single "Sign & file" button would let a doctor attest to a clinical statement they had only ever seen in a form.

  **Signing fails closed and is unforgeable.** `assessNoteSignability` is the only producer of `SignableNote`, that type carries a module-private symbol, and the mutation and the adapter both demand one (`assertSignableNote` re-checks at runtime) — the shape D-17 and D-11 already use. An empty note, an already-signed note, an archived record and **a note written by someone else** all reach the same place: there is no value to submit. The author rule is clinical, not a permission to grant — a signature says *this clinician* stands behind the words, so signing another's note is a different act (an addendum, under your own name), and the Sign control is simply absent on their notes rather than disabled.

  **Amend, never edit.** There is no `editNote` on the port at all, so rewriting a signed note is a compile error rather than a missing button; `amendRecord` appends an addendum that stands beside it under its own author and timestamp. Addenda are offered only once something on the record is signed — before that the unsigned note is still the working draft.

  **Status is a map, not a free-for-all.** `RECORD_STATUS_TRANSITIONS` gives `draft → active → completed → archived` and nothing backwards; a draft offers no transition at all until a note on it is signed, and the service refuses an illegal one independently of the control that offered it.

  **Two smaller correctness choices.** BMI is *derived* from the height and weight beside it and never entered, so the two cannot disagree. Vitals are optional (a telemedicine follow-up records none) but bounded — the bounds catch 720 bpm and a temperature typed in Fahrenheit while letting a genuinely alarming reading through without comment, because reading it is the doctor's job and not the form's.

  **Not done:** notes are **plain text**, not the rich text §2.3 names. No sanitizer exists in this codebase and `dangerouslySetInnerHTML` is banned (§12.4) with no audited exception file present, so HTML notes would mean adding and auditing new security surface — a separate piece of work, tracked as D-29 below rather than smuggled in here. The flow also does not collect an HPI, examination or treatment plan; those fields are left **empty** rather than filled with plausible prose, because a demo record that reads like a real one is the failure mode this module is being fixed for.
- [x] ~~**D-29 · P2 — Rich-text clinical notes.**~~ **Built — and it needed neither the sanitizer nor the security exception the row assumed.** The row read "rich-text" as an HTML pipeline: a sanitizer to keep patched, plus the §12.4 audited `dangerouslySetInnerHTML` exception no file in `src/` holds. It does not have to mean that. The AI assistant already had a **dependency-free markdown renderer that parses to React nodes** — every leaf a string child React escapes — so there is no HTML string anywhere in the path, nothing to sanitize, and no exception to grant. Notes are authored in markdown with a formatting toolbar and a live preview, and rendered through that same renderer, so what the author previewed is what the next clinician reads. **What it gives up, plainly:** the doctor types `**bold**` rather than pressing Ctrl-B and seeing bold. In a clinical record, no sanitizer to keep patched is worth more than a toolbar that bolds on click. The renderer was **promoted to `components/patterns/RichText`** — clinical notes were its second consumer, and §8.2.1 forbids copy-pasting a variant while §3.4 forbids importing another feature, so promotion was the only legal move. Headings start at `##` by design: the page owns its `h1` and a note emitting one would break the outline F-17 fixed. 5 tests pin the security property, including one that reads the module's own source (comments stripped, so it fails on code rather than on its own documentation). Verified live: `<script>alert(1)</script>` typed into a note renders as those characters, with **no script element in the DOM**, while the heading, bold and list render properly. |
- [x] **Report an issue on a record (2026-10-21, pass 2).** `POST /medical-records/:id/report-issue` (API §6.9) from the detail page's More menu. Read access suffices, as the server intends — the clinician who spots a wrong laterality is often not the author. The record is untouched (the dialog says so; the author corrects by addendum); 1–2,000 characters; pessimistic, a failure keeps the text. The toast promises only what the server does — the report is kept against the record and listed in the reporter's activity log — because nothing in this client reads reports back. Tests: `ReportRecordIssue.test.tsx` (3), adapter (+3), mock (+2). **Version trail:** built with DEC-004 (below).
- [x] **Edit a draft record, and its edit history (2026-10-21, DEC-004 A).** `PATCH /medical-records/:id`, `GET …/versions`. **Edit record** is offered only while the record is `draft` with nothing signed (`canEditRecord`) — stricter than the server, which also edits `active` records; after the first signature corrections are addenda and signed content is never edited. The dialog edits visit date, type and department, the three narrative fields and the diagnoses (add, remove, make primary — the authoring flow's own helpers); it sends **only the changed fields**, because the server refuses a no-op (`no_effective_change`), and names the server's `record_not_editable`. Pessimistic. The detail page's **Edit history** lists each version — who, when, and the before/after values exactly as the server recorded them, never re-derived — with loading, error-with-retry and "no edits recorded" states. **Not offered to "the author only"**: the record carries a name and a doctor-table id, neither of which is the session's user id, and matching by name is refused (DEC-001's rule) — any doctor with a care assignment may edit a draft, which is the server's rule. **Production-gated on BR-DEC-004** (server-side author/role check; a persisted reason per edit). Not in the form: treatment plan, medications, allergies, follow-up date. Also fixed: the record timeline's icon used a physical `-left` offset (wrong side in RTL). Tests: `EditRecord.test.tsx` (3), lifecycle (+2), adapter (+3), mock (+3).
- [x] ~~🔗 **D-22 · P1 — "Share" row action** has no target or permission model. Needs a sharing policy defined server-side before the UI can be designed.~~ **Closed as copy-link by DEC-016 A (2026-10-24, §19.3)** — Share copies the record's address and says when it could not; sharing grants no access. *(Reconciled 2026-10-25, §20.)*
- [x] ~~**D-23 · P2 — Export/print toasts produce no file.**~~ **Stale row — closed by the shared export engine.** Verified in the browser: `medora-records.csv`, 493 bytes, header `ID,Patient,Visit date,Visit type,Department,Doctor,Status,Priority`.
- ⚠ **Multi-organization realignment (2026-10-06) · Rewrite — blocked on API-W02 (§9.1).** Records list and detail show the active organization's encounters; a new record is stamped with the organization by the server from the session, never by a field in the flow. ↗ **Status: WEB-3** in [`CLIENTS_CHECKLIST.md`](../docs/multi-hospital/CLIENTS_CHECKLIST.md) (2026-10-26; this note keeps no box of its own, §13.6).

### 3.9 Messages — UX §2.8 ✅

`features/doctor/messaging/` · 17 files · 2,668 LOC · 1 mutation file

- [x] Conversation list + thread route, composer, persistence in `localStorage`
- [x] ~~**D-24 · P1 — No "new conversation" entry point** from outside the module.~~ **Built.** `NewMessageDialog` already existed *inside* `MessagesPage`; what was missing was any way to reach it from elsewhere. The entry point is a **URL contract, not an export** — `routes.doctor.composeMessage()` for the picker and `composeMessage({ patientId })` for one patient — because §3.4 forbids the dashboard or the patient profile importing this feature, and the app already speaks this language (`?patient=` on pharmacy, labs, records). Both params are **consumed once and stripped**: composing is an action, not a view, and leaving them in place reopened the dialog on every back-navigation (caught live). The re-entry guard is a ref rather than the param, because opening a thread is async and the effect otherwise re-ran on the render caused by its own `setSearchParams`, starting a second conversation.

  **A patient with no portal messaging falls back to the picker rather than opening a thread.** Not every patient has a contact, and a thread with someone who cannot receive it is the same false-success this checklist keeps filing. The bridge is `findContactForPatient` in shared-domain, a lookup on a new explicit `Contact.patientId` — **not** reconstructing `ct-pt-1002` from `PT-1002`, which would make the PHI-safe id convention load-bearing for navigation; a test pins that distinction. Verified live: dashboard → picker with 5 contacts; PT-1002 → the real Mona Adel thread; PT-1001 → picker, no thread invented.
- ⚠ **Multi-organization realignment (2026-10-06) · Blocked — API-W09 (§9.1).** The recipient picker lists only colleagues the API returns; threads carry an organization label. The messaging API exists on the `backend` branch (M20) but not on `main`, and is single-tenant. ↗ **Status: WEB-3** in [`CLIENTS_CHECKLIST.md`](../docs/multi-hospital/CLIENTS_CHECKLIST.md) (2026-10-26; this note keeps no box of its own, §13.6).

### 3.10 Notifications — UX §2.9 ✅

`features/doctor/notifications/` · 19 files · 3,066 LOC · 1 mutation file

- [x] List page, filters, mark-read / clear, live delivery simulation, navbar bell + badge
- [x] **Archive, favourite, pin and "Clear read" over the API (2026-10-25, NEW-24).** Live builds offered read and unread only, because API §11 on `main` serves nothing else. `backend` serves the rest (RM M19.3): `POST /notifications/:id/{archive,favorite,pin}` with an explicit `{ value }` — never a toggle, so the optimistic patch (DP-05) can be rolled back exactly — and `POST /notifications/clear-read`, which answers how many it moved. The HTTP adapter now sends them, and `capabilities.remove` is split: **delete** stays absent live (no route on any branch), **clear-read** is offered. A refused write is **said**: the list still rolls itself back, and now a toast names the failure, where before a row that came back did so silently; the bell's "Clear read" does the same. **Branch:** these routes are on `backend`, not `main` — against an API built from `main` they answer 404, which the screens report as a failed write and change nothing (`docs/handoff/BACKEND_FRONTEND_CONTRACTS.md` §B.3).
- [x] **Mark all as read is one write (2026-10-21).** The bell fanned out one `POST …/read` per unread id the list happened to hold — six at a time — so a notification delivered since the last poll was missed and a half-applied fan-out left the badge disagreeing with the rows. It is now `POST /notifications/read-all`, whose server rule (unread **and unarchived**) the optimistic patch mirrors, with exact rollback on failure (DP-05). Verified in Chromium: the bell's "Notifications (1 unread)" becomes "Notifications" and the page's Unread card reads 0.

### 3.11 Reports & Analytics — UX §2.10 ✅

`features/doctor/reports/` · 19 files · 2,893 LOC · 1 mutation file

- [x] KPI row, analytics grid, insights panel, saved-reports rail, scheduled reports, export dialog, filter bar
- [x] Hand-rolled SVG chart library (`components/charts/`: Bar, LineArea, Pie, Heatmap, DistributionBars, Legend)
- [x] ~~**D-25 · P2 — Export is not a real file.**~~ **Stale row.** `ExportDialog` calls `runExport(format, buildReportDataset(snapshot))` on the same engine as the four above. ~~Read from the code path, not clicked.~~ **Clicked (2026-10-22, pass 3):** `medora-report.csv`, 623 bytes, header `Section,Label,Value`, 28 rows, matching the page. Clicking it also found **NEW-16**: opened before the analytics loaded (or after they failed) the dialog toasted "Exported as CSV" with no file written, and a refused export said nothing — both fixed (§13.3).
- [x] **Analytics, saved and scheduled reports over the API (2026-10-25, §3.11; saved/scheduled recorded briefly as NEW-28 and the two defects as NEW-29, both retired).** The reports seam had no HTTP adapter; `backend` now serves RM M21 (`/reports/analytics`, `/insights`, `/saved`, `/scheduled`), and live builds read and write it. Only what the server applies is sent or offered: category, range and custom bounds, gender and age band — department, status, medication and lab test are not analytics parameters, so the drawer omits them and says so, and a URL value for one draws no chip. Revenue without billing shows the server's own alternate (its notice and the top visit types), never a revenue chart. Saved reports save, duplicate and delete; schedules create, pause/resume and delete; **rename and favourites are not offered** (no routes), and **schedules say they are not sent** (the executor is registered blocked, M30.2). Export stays the client's engine over the snapshot on screen. **Branch:** `backend` only — against `main` the page shows "Couldn't load analytics" with Retry.
- ⚠ **Multi-organization realignment (2026-10-06) · Rewrite — API-W02 (§9.1).** Wire to `GET /reports/analytics` (live on `main`, FE-10 finding F40), scoped to the active organization once API-W02 scopes it; the seeded analytics keep their "illustrative demo analytics" footnote until then. ↗ **Status: WEB-3** in [`CLIENTS_CHECKLIST.md`](../docs/multi-hospital/CLIENTS_CHECKLIST.md) (2026-10-26; this note keeps no box of its own, §13.6).

### 3.12 Doctor Settings — UX §2.11 ✅

`features/doctor/settings/` · 29 files · 3,879 LOC · 1 mutation file

- [x] All 11 sections: Profile · Account · Security · Privacy · Notifications · Appearance · Preferences · Accessibility · Integrations · Activity · About
- [x] **Availability — weekly working hours (2026-10-21, DEC-005 A).** A twelfth section, doctors only (`/me/availability` answers 404 without a `doctors` row, so the admin's Settings omits it — `PRACTITIONER_SETTINGS_SECTIONS` — and the staff list never had it). Seven days, each open or closed; up to six working windows and six breaks a day; default appointment length 15/20/30/45/60; buffer 0–60. The server's rules are restated in `appointments/model/availability.ts` (`validateWeek`) and checked before sending; the server's 422 `fieldErrors` (`week[i]…`) are mapped back onto the day. **Before saving**, the doctor's whole book is re-read (`GET /appointments`, all pages) and every live upcoming appointment the new week no longer covers — closed day, outside the windows, inside a break, past midnight (booking rules 1–2) — is listed with a link to its drawer's Reschedule action. Saving moves, cancels and notifies nobody, and says so; stranded appointments stay on screen after the save. If the book cannot be read the review says the check did not run ("Save without checking"), never "none affected". **Limit:** the server compares in the clinic's timezone, which no endpoint serves; the check uses the device's, and the review says so (BR-DEC-005). No clinic-hours check (RA-005.1 undecided, no data source). Tests: `availability.test.ts` (16), `http-availability-service.test.ts` (5), `mock-availability-service.test.ts` (2), `AvailabilitySection.test.tsx` (8), route tree (+2).
- [x] **Notification preferences over the API (2026-10-25, NEW-24).** Live builds said "Notification preferences — not connected yet", because no route on `main` stores them. `backend` does (RM M19.4, `GET`/`PUT /me/notification-preferences`): the web client's `NotificationPreferences` is the server's document field for field. Preferences now go through the notifications port — this browser in the demo, the server live — and both Settings → Notifications and the Notifications page's drawer read them from it (the drawer only while open). Each switch writes the **whole** document computed from the screen, optimistically; the writes are serialised (`useMutation` `scope`), so a later document never lands before an earlier one, and only the newest answer reconciles the screen. A refused write restores the previous value and says so. A failed load is an error with Retry, never a set of default switches. `categories.security` stays locked on, and the server refuses it too (`z.literal(true)`). **Branch:** `backend` only; an API built from `main` answers 404 and the section shows the load error.
- [x] **Privacy and Integrations over the Settings Center (2026-10-25, §3.12; recorded briefly as NEW-26/NEW-27, retired).** Live builds said "Not connected yet" for both, because no route on `main` keeps them. `backend` does (RM M22, `GET /me/settings`, `PATCH /me/settings/privacy`, `POST /me/integrations/:id/disconnect`). The consents are now the server's, saved whole with the version they were read at; a stale save (409) is named, nothing is kept, and the stored values return to the screen. Integrations show the server's connections and can be disconnected; **Connect is not offered live** — the server answers 501 until an OAuth client is configured per provider (RA-M22.1). The demo's "Delete my account" no longer appears live: no route deletes an account. The Settings Center loads apart from the `/me/*` routes, so a server without it (404) or a failure of it leaves every other section working. **Branch:** `backend` only.
- [x] Dirty-state save, unsaved guard, photo editor, tag-list editor
- [ ] ⚠ **Multi-organization realignment (2026-10-06) · Replace — blocked on API-W03 (§9.1).** The free-text **hospital** field (`settings/schemas.ts`, `ProfileSection`) gives way to a read-only **affiliations** list — organization, location, department, membership status. Live builds already hide the field (FE-10.9); the mock build still offers it. Availability is edited per location. ↗ **Status: WEB-6 for the employment record that replaces the field (DR-02)** in [`CLIENTS_CHECKLIST.md`](../docs/multi-hospital/CLIENTS_CHECKLIST.md) (2026-10-26). Per-location availability is named by no WEB row, so this box stays open here until one is approved (§13.6).

### 3.13 Doctor shell (UX §1.2, §5)

- [x] `AppShell` with xl expanded sidebar / lg icon rail / md drawer / <md bottom tab bar, persisted collapse, `Ctrl+B`
- [x] Navbar: breadcrumb, notification bell, avatar menu, theme toggle
- [x] Route transition (fade + 8px rise, reduced-motion aware)
- [x] ~~**D-26 · P1 — Global search is a dead input.**~~ **The doctor shell has an index; the panel is keyboard-complete and stops claiming things it cannot know.** The row was half stale and half understated. Stale: `GlobalSearch` gained a panel, a query and navigation when the admin search moved into the shared shell, so the component was not the problem. Understated: it reads `ShellSearchContext`, and **only the admin shell ever mounted a provider** — on every doctor page the context fell back to its default `search: () => []`, so typing a patient's name opened a panel that said **"No matches for 'Khaled'"** about a patient in the roster two routes away. Not a dead input: a confidently wrong one, which is worse, and the same defect class as D-04's fabricated PDF.

  **The placeholder was the specification.** The navbar has always read _"Search patients, appointments, records…"_ — a promise the app never kept — so `useDoctorSearchIndex` is built from exactly those three, plus every sidebar item and settings section, which makes `Ctrl+K` a command palette rather than only a lookup. Patients match on **name, MRN and id**, because an MRN is what a doctor reads off a wristband and it is not on screen to copy from; appointments and records match on their patient's name and MRN too, since "Khaled" is how a clinician looks for last Tuesday's encounter. Destinations are gated through the same `requiredPermission` the sidebar honours, so search can never be a back door to a page the nav is deliberately withholding. It reads the **queries, not the seed modules**: a patient added through "Add patient" is findable immediately, where `MOCK_PATIENTS` would have indexed the roster the app booted with.

  **Ranking is load-bearing, not cosmetic** — the shell renders seven rows, so a patient must not be pushed off the panel by the appointments that merely mention them. Prefix beats word-start beats substring; ties break on how much of the term the query covered, which is what stops a "Lab review" appointment outranking the **Labs** destination for "lab" (a real bug, caught by its own test rather than by reading the code).

  **Two things the shell was getting wrong**, both fixed here because this is the change that put them in front of a doctor: the panel asserted "No matches" over an index still loading, so `ShellSearchValue` gained a `pending` flag and the panel says _"Searching…"_ until the evidence is in; and `Ctrl+K` put the caret in the field then abandoned it — results were pointer-only. ↑/↓/Enter now complete the interaction, and the ARIA is a real combobox→listbox with `aria-activedescendant`, replacing a `listbox` whose options were `<button>`s (invalid, and the reason a click test had to reach past the option to its child). 15 tests.

  **Two follow-ups, both from a parallel implementation of this row (#63) that landed after mine merged.** They are ported rather than re-derived, and both fix real defects in what shipped:

  · **The head of the results is capped per domain.** Searching a patient's name returned the patient and then *six of seven slots* filled with that same patient's appointments, so their labs, prescriptions and records never reached the panel. My own browser run printed exactly that and I read past it. Results are now round-robined across domains **within a score band** — the band being rank *and* match tightness, not rank alone, since keying on rank by itself silently discarded the tie-break and let a "Lab review" appointment outrank the **Labs** destination — then capped at three per domain in the head. Nothing is dropped; the overflow is deferred. `kha` now returns patient · appointment · lab · prescription · record · appointment · lab.

  · **The index fetches nothing until the field is engaged.** It mounts on every doctor page, and five datasets behind mock latency is five round trips spent on a control most page views never touch. `ShellSearchValue` gained `onActivate`, the five query hooks gained an optional `enabled` defaulting to true, and `pending` only reports once activated — an index nobody asked for is idle, not loading. Verified in a browser: **zero requests while idle on the dashboard.**

  Lab orders and prescriptions **are** indexed now, which the first pass declined; with the per-domain cap they earn their place instead of crowding the panel.
- [x] ~~**D-27 · P1 — Doctors lost clinic operations.**~~ **Settled on the second option, because the first is not buildable — and the doctor-facing half of the row was a 403.** The row offered two: give doctors a scoped view, or move the sections out of the `/doctor` namespace.

  **The move was already done.** Phase B put queue, waiting room, rooms and shifts at `/admin/*`; nothing clinic-operational remains under `/doctor` but the legacy redirect itself. That half of the row was stale.

  **A scoped view cannot be built on the current model, and pretending otherwise would be the worst option available.** None of the four entities can be attributed to a doctor: `QueueEntry` and `WaitingPatient` carry a `patientName` **string** and no doctor and no patient id; `Room` carries a `departmentId`; `ShiftAssignment` is the only one with a person (`staffId`) and the signed-in doctor is not on that roster — the demo doctor is **Dr. Amelia Chen** and the admin staff roster's physician is **Dr. Lena Hart**, two disjoint sets with no identity link. So a "doctor's queue" would have to show every doctor the whole clinic's board, which reads as *your* patients and is worse than no board at all, or invent an attribution. Joining the waiting room to the doctor's own appointments on name + time was considered and rejected for the same reason D-14 refuses it: two patients share a name, and a wrong join here puts the wrong person in front of a clinician.

  **What actually shipped is the defect nobody had named.** A doctor's old `/doctor/administration/queue` bookmark redirected to `/admin/queue`, where `RequireRole` answered **403 — "Your account doesn't include permission to view this area… contact your administrator."** Wrong twice: it blames the doctor's permissions for a deliberate product decision, and it tells them to escalate something no administrator can grant. Administrators are still redirected; a doctor now gets told the area moved and is pointed at their appointments calendar, which is the one doctor-scoped view of the clinic day the app really has (UX §2.4). Not a silent redirect — a bookmark that quietly lands somewhere unrelated teaches nothing and gets tried again tomorrow.
- [x] ~~**D-27b · P2 — A doctor-scoped clinic board.**~~ ✅ **DONE** — `/doctor/my-clinic`, under Clinical in the doctor sidebar. **The block was answered by product, not worked around**: Medora is multi-clinic, one doctor has one primary clinic, and a doctor may reach their own clinic's data and no other's. That decision made the missing attribution specifiable, so it was added — `QueueEntry` and `WaitingPatient` now carry `clinicId`, `doctorId` and a patient **id** beside the display name, and `SessionUser` carries the doctor's `clinicId`, issued with the session rather than read from a route param (a scope the URL can set is a scope the URL can widen). `features/shared-domain/clinic-scope/` holds the three filters — `visibleToScope`, `ownedByDoctor`, `isInScope` — and **fails closed**: an unattributed row is excluded, not included, and a clinic named `''` never collapses into `null`'s "spans every clinic". Verified live in the browser as two different doctors: Amelia sees 3 of the 5 seeded queue entries and 3 of 4 check-ins, Julian sees the other 2 and 1, and neither sees the other's. Colleagues' patients are reduced to a **count** rather than hidden — "1 patient is waiting for other clinicians in your clinic" carries no identity and stops an empty board reading as a bug. 5 page tests + 8 scope tests + 5 roster tests.

  **The frontend is not the boundary, and the page says so on screen.** Everything filtered here was still sent to this browser; a client can unfilter anything it filters. [`docs/handoff/clinic-isolation.md`](../docs/handoff/clinic-isolation.md) is the backend's half — scope every read *and* every write from the session, never from a request parameter; 404 rather than 403 on another clinic's id (a 403 confirms the id exists); stamp the clinic on create from the session; enforce at the data-access layer rather than per-controller; audit denials; test the negative per resource.

  **Structural cost, paid deliberately.** The clinic-operations model, store and query hooks moved to `features/shared-domain/clinic-operations/` — the D-05 remedy again, and for the same reason: two features read it now (§3.4 forbids doctor→admin), and the state is *mutable*, so moving only the seed would have given the two boards separate queues. `features/admin/api/administration.{api,types}.ts` and `useAdministrationQueries.ts` are re-export shims, so admin's ~30 importers are untouched, and the query keys keep their `administration` prefix on purpose — a second namespace is exactly the divergence the move exists to prevent. One method stayed behind: `getAuditEvents`, which projects rows through ADM-07's taxonomy, is admin code, so the store exposes `getAuditRows` and the admin layer composes. It composes with `Object.assign`, not a spread, so both sides share **one** service object — a copy would give each its own closures and let a stub on one silently miss the other.

  **Not done, and named in the handoff.** Doctor identity still does not resolve against the staff roster: `staff` is a clinic roster (`stf-doc`, "Dr. Lena Hart") with no account behind it, while a queue entry must name the account a doctor actually signs in with, so `CLINIC_DOCTORS` is a seeded stand-in for that join with a test in `features/auth/` (the only zone that may import both) asserting the two lists agree. Only **one** clinic is seeded, so a real cross-clinic leak cannot be observed in the browser — the multi-clinic cases are exercised against synthetic rows in `clinic-scope.test.ts`. And every other doctor surface is still unscoped: appointments, patients, records, labs, pharmacy and messaging read stores with no `clinicId` at all. The order there matters — attribute, then enforce server-side, then reflect in the client. Reflecting first would be security theatre.

  ⚠ **Multi-organization realignment (2026-10-06) — superseded in part · Rewrite, blocked on API-W01 and API-W05 (§9.1).** Two statements above no longer hold. *"One doctor has one primary clinic"*: a doctor may hold memberships in several organizations and works in one **active organization** at a time. *"An administrator is not clinic-scoped"* (the handoff's §1): administration splits into **organization admin**, scoped to one organization, and **platform admin**. The board's future source is the API's queue and waiting room for the doctor's active organization and location (the Administration Center API on `backend`, M23, once scoped); `SessionUser.clinicId` gives way to ORG-01. Everything else here stands: the client filters stay display-only and fail closed, and the frontend is still not the boundary.
- [x] ~~**D-28 · P2 — Naming.**~~ **Stale row — done by AC-19 in Phase B** (§7 step 4 records it; the row was never ticked). The area is `features/admin/` at `/admin/*`.

---

## 4. Administrator Dashboard (UX §3) — ~~**the main gap**~~ **closed**

`routes.admin.*` is fully declared in [`src/routes/index.ts`](src/routes/index.ts). Phase B moved the area to `/admin` and Phase C mounted the dashboard screens themselves. **Every §3 screen is live**: ADM-09 settings, ADM-10 PHI governance, ADM-05 appointment oversight, ADM-02/03 doctors, ADM-04 patients, ADM-01 the overview itself, ADM-07 system logs, ADM-06 communication monitoring and — as of ADM-08 — §3.8 reports. Nothing in `routes.admin.*` is declared-but-unmounted any more.

> **The Admin Overview is a dashboard the administrator composes (2026-10-05).** ADM-01 below describes what each of its widgets shows; the page no longer shows all of them to everyone. It now behaves exactly as the Doctor Overview does (§3.1): a first visit shows no widgets, only an empty state inviting the administrator to customize; "Customize dashboard" opens the same Drawer, one Switch per widget, applied live; a widget is removed from its own ⋯ menu (with an Undo toast) or from the drawer. The catalogue (`features/admin/overview/widgets.ts`) is the eleven widgets the fixed page drew, with the KPI row split into its four tiles — nothing was added to fill it. The security-alerts banner is deliberately **not** a widget (§3.1 makes it undismissable, and a widget can be switched off), and neither is the fresh-deployment onboarding card (a state of the platform, not a view); both stay pinned above the dashboard. Nothing was copied from the doctor feature: the layout, drawer, empty state and ⋯ menu moved to `components/patterns/dashboard/`, and the selection and editing behaviour to `hooks/useDashboardWidgetSelection.ts` and `hooks/useDashboardEditor.ts`, with the doctor's files now thin bindings over them. The selection persists per user through the preferences service under its own key (`adminDashboardWidgets`), in this browser only, cleared on logout. Verified in Chromium at 375 / 768 / 1024 / 1280 / 1440 px, light and dark: every row flush at both edges, no overlap, overflow, clipped control or truncated title, zero console errors, and the Doctor Overview unchanged. *(Superseded in part 2026-11-03, §37.2: same draft → Done workflow as the Doctor Overview — the drawer is shared.)*
>
> ⚠ **Multi-organization realignment (2026-10-06) — the admin area is transitional.** Every screen below was built for one platform-wide administrator over one clinic. The approved model separates organization administration from platform administration; the proposed UI is two consoles: an **organization console** (one organization: its members, operations, patients, appointments, communications, logs, reports and settings) and a **platform console** (organizations registry, licence verification, platform users, roles and the permission matrix, platform settings, integrations, jobs, platform logs). Each row keeps what it built and its note names where each part goes. New rows ORG-02 and ORG-03 close the table.

| #      | UX § | Screen                                                                                                                               | Route (declared)           | Status                                                                                                                                                                                                                                                                                                                                                        |
| ------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADM-01 | §3.1 | **Admin Overview** — platform health, security alerts, admin action queue, activity + signup feeds                                   | `/admin`                   | ✅ **DONE (Phase C)** — `features/admin/overview/`, mounted as the admin area index. **Nothing on it is fetched that another screen already knows**: the KPI row, the security-alerts banner, the four-row action queue, the appointment funnel and the signups feed are all *derived* from the ADM-02 / ADM-04 / ADM-05 documents already in the query cache, so a verification approved on ADM-03 changes the Home count on the next render with no refetch and no chance of the count disagreeing with the page it links to. Each queue row carries its destination with the filter already applied — pending verifications → `/admin/doctors?tab=pending`, licences expiring → `?expiring=soon`, flagged accounts → `/admin/patients?flag=open`, stuck appointments → `/admin/appointments?flag=stuck-pending` — and all four were checked live against the row counts on the far side. **A fifth row, flagged conversations → `/admin/communications?tab=flags&status=open`, was wired ahead of ADM-06's own route existing** and is live now that this task has mounted it; both it and the Safety flags tab's own count filter the same `flags` array on `status === 'open'`, so the two cannot disagree. The security-alerts banner (failed sign-ins · impossible travel · PHI-access bursts · critical audit events) routes each alert through an `alertDestination` map to the doctor's Activity tab or the audit panel. **Platform Overview was absorbed**: `/admin/platform` now redirects here, the `platform` slug is retired from the section union, and Clinic Overview moved to `/admin/clinic` as its own sidebar item. Row 3 puts **Storage & Usage** where §3.1 puts Revenue, which is §3.1's own fallback for a deployment without billing. The signups feed and the audit feed run every identifier through ADM-10 — a seeded audit event that carried a patient name beside their ID was found and the *data* fixed, with a read-path test that fails if any seeded target contains one. Fresh-deployment empty state, gated on the accounts query having settled. 66 tests. **Not done:** the Revenue widget (no billing flag exists to switch on); ~~"Investigate" points at the nearest real destination rather than `/admin/logs`, which arrives with ADM-07~~ *(stale — the impossible-travel alert now links to `/admin/logs?type=impossible-travel`, pinned by `AdminOverviewSection.test.tsx`, and was followed in the 2026-10-23 sweep, §18)*; §3.1's KPI **deltas** (`MetricTile` has no delta affordance and three of the four KPIs have no historical series to compute one from — the tile captions carry the secondary figure instead); and the activity chart, service health and storage are **mock-served**, because no telemetry backend exists to serve them. ⚠ **Multi-organization realignment (2026-10-06) · Split — blocked on API-W05, API-W13 (§9.1).** Organization console overview (that organization's KPIs and queue) and platform console overview (platform health, organizations, verification backlog). |
| ADM-02 | §3.2 | **Doctors Management** — list, `?q=&specialty=&verification=&status=`                                                                | `/admin/doctors`           | ✅ **DONE (Phase C)** — sub-tabs All · Pending · Active · Suspended, where **Pending counts only decisions an admin can act on** (`docs-requested` is waiting on the doctor and stays out of the badge). Search over name, email and licence; specialty / verification / status / joined-range filters; CSV export; Invite doctor. Row `⋯`: view profile, review verification, send access reset, suspend / reactivate. Suspension states its consequence first — the count of upcoming appointments it would strand, read live from the ADM-05 store, with a link into `/admin/appointments?doctor=<id>`. ⚠ **Multi-organization realignment (2026-10-06) · Split — blocked on API-W06, API-W13 (§9.1).** Organization console: the organization's **members** — invite, approve, suspend *in this organization*. Platform console: the **licence verification queue**. A verified doctor is a member of no organization until one approves them. |
| ADM-03 | §3.3 | **Doctor Profile (admin view)** — tabs: profile / documents / activity / appointments / statistics; verification decisions           | `/admin/doctors/:id`       | ✅ **DONE (Phase C)** — identity header (verification + status badges, joined, licence expiry, last active) over five tabs, the tab held in `?tab=`. **Documents** is the verification workflow: per-document three-check list (authentic / current / matches identity), preview drawer, approve — inert until all three are ticked and refused again in the service — reject with reason, expiry warnings, and a "Complete verification" that names what is blocking it. **Activity** is counts plus sign-in history with impossible-travel flagging; **Appointments** reads this doctor's slice of the ADM-05 store with patients masked; **Statistics** is P6 widgets plus the attributed administrative history. Only the two administrative fields §3.3 names are editable. ⚠ **Multi-organization realignment (2026-10-06) · Split** with ADM-02: verification documents and decisions go to the platform console; membership status, appointments and statistics stay per organization. |
| ADM-04 | §3.4 | **Patients Management** — account lifecycle, unlock, credential reset, deactivate, **medical-access permission grid**                | `/admin/patients` + `/:id` | ✅ **DONE (Phase C)** — `features/admin/patients/`: a masked P1 list (summary strip · search over name / patient ID / phone / email · status, registered, doctor and activity filters) and a three-tab account view. **It is an account screen, not a clinical one** — no column, tab or route carries a condition, result or risk level, so an administrator resolving a lockout has nothing clinical to look at. Lifecycle: unlock, credential reset, deactivate (P4 + reason), reactivate. **The Permissions tab is the medical-access grid**: pending requests quoted in the requester's own words, active access with scope / granted-by / since, and an access *history* keeping every revoked grant with its reason and the administrator who withdrew it. An administrator never sets a password — `resetCredentials` takes no such argument, so that rule is a type error rather than a policy. The list's "open issues" column and its ordering share one `openWorkCount` helper, after a browser check caught them disagreeing. The export omits every direct identifier. 38 tests. **Not done:** the grid governs the mock store only — real least-privilege needs the server to withhold the record — and access requests arrive seeded, because the clinician-side "request access" flow is a doctor-area screen. ⚠ **Multi-organization realignment (2026-10-06) · Blocked — API-W07 (§9.1).** The masked directory lists the patients **enrolled with the admin's organization**, not the platform's; reveal stays audited, within that organization. `GET /patients` (masked) is live on `main` and is currently platform-wide; the missing capability is the account-governance API (M10.7), which is not built. |
| ADM-05 | §3.5 | **Appointment oversight** — cross-doctor table, age-in-state, nudge, reassign, administrative cancel                                 | `/admin/appointments`      | ✅ **DONE (Phase C)** — `features/admin/appointments/`: KPI strip (today · pending > 24h · cancellation & no-show 7d over one denominator), toolbar filters (status · doctor · department · range · flag), the optional hour × weekday heatmap, and a cross-doctor table keyed on **age-in-state**. Three interventions, each behind its capability: templated **nudge** (bulk-capable, 60-min cooldown), **reassign** (same-specialty picker showing live capacity, consumes a slot, notifies all three parties) and **administrative cancel** (closed category + reason + apology template). The P3 drawer carries the full transition history with an actor per line, the linked complaint, and per-party delivery receipts. Patient identifiers go through ADM-10 everywhere, including the export, which omits them. 52 tests. **Not done:** a failed reassignment is provably atomic in the mock service, but real rollback semantics belong to the server. ⚠ **Multi-organization realignment (2026-10-06) · Rewrite — API-W08 (§9.1).** Own organization only; the reassign picker offers only same-organization doctors the API returns. `/admin/appointments` is live on `main` but platform-wide today. |
| ADM-06 | §3.6 | **Communication Monitoring** — metadata table + gated content access with justification categories and watermarked read-only view    | `/admin/communications`    | ✅ **DONE (Task 13, Phase C)** — `features/admin/communications/`, mounted at `/admin/communications` under a new Governance nav entry, with the viewer nested as `/admin/communications/:conversationId` so `useMatches()` builds "Communication Monitoring › Conversation" the way Doctors and Patients do. **Three tabs are one derived document**: `buildOverview`, the metadata rows and the safety-flag queue are all computed once from the same conversations, so Overview's flag rate and Safety flags' open-flag count cannot disagree — and that same count is what ADM-01's overview fifth queue row (flagged conversations) already read, closing the cross-link ADM-01 shipped ahead of this route existing. Conversation logs names the doctor and masks the patient through ADM-10, the same rule ADM-04's list uses; `patientName` never reaches a filter or a search index. **Content access is gated, not implicit**: a justification category plus a reason of at least 20 characters opens a 10-minute grant, audit-logged *before* the grant is set — a write that fails can never produce silent access — and the grant lives only in `useState`, never persisted, so a reload or a return visit re-denies. `ContentAccessProvider` wraps the section *and* its viewer child at the route level, not inside either one, so a grant taken on the metadata table survives the navigation into the viewer; a second request while one grant is still live closes the first as `'incomplete'` rather than orphaning it. The viewer is watermarked and read-only — no composer, no reply — and renders nothing at all, not even a shell, without a live grant re-checked on every render; its access-log ref surfaces in ADM-07's log as a "Read message content" row. **Safety-flag detection is a keyword heuristic, not a classifier, and its recall on phrasing it has not already been given is measured to be poor**: a review round widened `emergency-language` until it caught all 13 phrasings a previous reviewer had named, and the next reviewer's 22 fresh emergency wordings then tripped exactly 1 — the Safety flags tab carries that caveat on screen so the queue is never mistaken for a triage path. **This is retrospective governance, not triage**: a message that fails to flag is still sitting, unflagged, in the doctor's own inbox, in front of the clinician it was actually sent to. Three of the four categories are seeded (harassment is not — no inoffensive seed exists for it and this corpus doubles as the doctor's inbox); resolving a flag (dismiss / warn / escalate) moves it out of the default open filter. Overview's five aggregate figures export to CSV, logged the same way ADM-07's own export logs itself. 116 tests. **Not done:** second-admin approval on a content-access grant — one administrator's own justification is sufficient to open it; export of conversation content itself (only the aggregate figures export); participant-visible transparency logs — a patient or doctor has no way to see that their conversation was read; and the harassment category, which has detection but no seeded instance to demonstrate it. ⚠ **Multi-organization realignment (2026-10-06) · Rewrite — blocked on API-W09 (§9.1).** Own organization only. The oversight API exists on `backend` (M20.7), not on `main`, and is single-tenant. |
| ADM-07 | §3.7 | **System Logs** — investigation table, actor/type/severity/IP filters, saved views, CSV/JSON export, read-only for everyone          | `/admin/logs`              | ✅ **DONE (Phase C)** — `features/admin/logs/`, mounted under Governance. **The log is aggregated, not stored**: its rows are projected from trails the other modules already keep — doctor sign-ins (the only source carrying a real IP and device), verification and account history, appointment transitions, PHI reveals, patient account events — so a suspension performed on ADM-02 is in the log the moment it happens. Only **System** is seeded, because nothing in a frontend can observe a service degrading. The service is shaped as a paginated API (`list({filters, sort, offset, limit}) → {rows, total}`) with filtering and counting on the far side of the seam and `total` a post-filter count independent of `limit`; the page holds 50 rows, never the log. Six structured filters plus search, and **pivot** — clicking an IP, actor or event type filters by it, verified live narrowing 50 rows to the 1 carrying that address. **Two rules are enforced in types rather than policy**: `logsApi` exposes no mutation on an event at all, so editing one is a compile error rather than a missing button; and `exportEvents` appends its own `data-export` row *before* writing the file, so the export appears in the log it came from — confirmed in the browser, where the CSV export became the table's top row. Exports honour the active filters, asserted against the actual file bytes. Saved views persist to `localStorage`, seeded with §3.7's own two. **`getAuditEvents()` is now a projection of the log** through an explicit `AUDIT_FEED_TYPES` allowlist rather than a second store — an allowlist and not a category filter, because selecting by category dropped the seeded backup (a job result) and a doctor's export (a user action), two rows ADM-01's feed and ADM-09's panel render today, and would have quietly narrowed the PHI regression test that iterates whatever the projection returns. A clock bug found in review is fixed: the table renders **local** wall clock built on the same helper the `datetime-local` filters use, so the timestamp an investigator copies off a row is the value the From field accepts — previously the column was UTC and the filter local, silently shifting the window by the reader's offset. 92 tests. **Not done:** correlated events, before/after diffs and incident bookmarks (cut by scope, and the aggregation would support the first two); virtual scrolling (§3.7 asks for it at 100k+ rows — the paginated interface makes it unnecessary at this corpus size and is already the shape a real server needs); alert-rule configuration stays a link to §3.9; the `other` classification fallback exists because `AdminAuditEntry.action` and `AuditEvent.action` are plain strings rather than unions, with a test asserting it is never reached; the `To` bound is minute-resolution and **exclusive of the rest of its minute**, so a `To` typed from a row's own timestamp excludes that row; and the log records only what this client can observe — a server's log would be larger. ⚠ **Multi-organization realignment (2026-10-06) · Split — blocked on API-W10 (§9.1).** Organization logs in the organization console, platform logs in the platform console. The audit read API exists on `backend` (M28), not on `main`. |
| ADM-08 | §3.8 | **Admin Reports** — cross-doctor analytics, scheduled reports                                                                        | `/admin/reports`           | ✅ **DONE (Phase C)** — `features/admin/reports/`, the last §3 screen, mounted under Overview / Clinic Overview because it answers the same "how is the platform doing" question at a longer horizon than either. Four report tabs (Growth · Utilization · Clinical operations · System performance) over one range picker (7d / 30d / 90d / 12m) and a compare switch. **Nothing here is stored**: every figure is derived from the ADM-02 / ADM-04 / ADM-05 / ADM-07 documents on each read, so the no-show rate on this page and the no-show rows on §3.5 are the same appointments counted once, and the platform total matches the roster the management pages hold (asserted in `reports.api.test.ts`). The peak-hours grid goes through **ADM-05's own `buildHeatmap`** rather than a second copy, so the two screens cannot report different peaks. **One projection per widget**: `datasetOf(visual)` builds the table and the export file from the object the chart is drawn from, so §3.8's "view as table" and "per-widget export" cannot disagree with the chart — a test asserts every ready widget's dataset is rectangular and that a bar's annotation columns reach the table. Drill-downs land filtered (`?status=no-show` → §3.5, `?severity=critical` → §3.7); seeding `?status=` on ADM-05 was added for it. **`availability` is three-valued**, which the spec's state list is not: `empty` means widen the range, `unavailable` means no source exists in this client and names what would supply it — used for **lab turnaround** (D-10…D-14's inbox holds the timestamps, but it is a doctor-area store the admin area may not read — this needs a laboratory service both sides share) and **AI usage & latency** (needs the model service, §9 row 4). Four widgets carry a range-override chip because their window is not the page's (capacity vs demand is today, retention is six months, prescription volume is the window each doctor's activity record covers, storage is current), and the compare switch withholds a delta from all four — a browser check caught prescription volume printing "0% vs previous period" on a figure the range cannot move. Both exports (per-widget CSV, whole-tab PDF deck) write a `data-export` row to §3.7's log **before** the file, the ADM-06B/ADM-10 ordering, and are gated on `logs.export` while reading is not. Scheduled reports persist to `localStorage` with a create dialog pre-filled from the tab on screen; §3.8's "scheduled-report failures notify the admin" is a standing banner plus a row-level reason rather than a toast, because a five-day-old failed delivery is a condition and not an event. 80 tests. **Not done:** geographic distribution (§3.8's own "if multi-clinic" — this deployment models one clinic, so it is deliberately absent and the report says so); stacked areas (the shared chart library draws overlaid series, and pre-summing would make every tooltip report a running total, so volume-by-specialty is overlaid lines); latency **percentiles** (the log carries individual p95 samples, not a distribution — the column reports the worst logged sample and says so); a true error **rate** (no request count is emitted anywhere, so the trend is absolute counts); storage **growth** (one instantaneous figure, no history); and nothing delivers a schedule — the dialog says so on screen. Service health, uptime and storage stay mock-served, the caveat ADM-01 already carries. ⚠ **Multi-organization realignment (2026-10-06) · Rewrite — blocked on API-W11 (§9.1).** Cross-doctor analytics **within the admin's organization**. The "geographic distribution (if multi-clinic)" omission above comes into scope once organizations and locations exist. |
| ADM-09 | §3.9 | **Admin Settings** — system, **roles & permission matrix editor**, security policy, notifications, appearance, integrations          | `/admin/settings/:section` | ✅ **DONE (Phase B)** — the permission-matrix editor landed at `/admin/settings/roles` as the 17th panel: 22 capabilities × 5 roles, grouped per §3.9, with locked cells, affected-user preview, review-before-save, unsaved guard, and the concurrent-edit merge dialog. Verified persisting through `adminSettingsApi` and surviving a full page reload. **Not done:** custom role creation from a base template (§3.9) — see remaining items. **2026-10-23 audit (§18):** the API serves it (`POST /roles` `{ code, label, baseRole }`, API §15.4, on `main`), so it is no longer blocked on the backend; it is held on **DEC-013**, because the client knows only the five roles in `ROLES` and a user given a custom role would have no workspace (DEC-006's defect again). §3.9's **per-role member list** is done: the matrix links each role to Users filtered by `?role=` (§13.4 "ADM-09 members"). ⚠ **Multi-organization realignment (2026-10-06) · Split — API-W12, API-W13 (§9.1).** Platform panels, including the roles & permission matrix, move to the platform console; the **organization** panel becomes organization settings — profile, locations, booking policy. The permission matrix is platform configuration; whether organization admins get any role customization is not decided. |
| ADM-10 | §1.5 | 🔗 **PHI governance** — masked-by-default identifiers with audit-logged reveal, permission-gated elevation, per-access justification | —                          | ✅ **DONE (Phase C)** — `utils/phi-mask.ts` (pure maskers), `features/admin/phi/` (elevation provider, justification prompt, `MaskedIdentifier`), and an append-only `phiAccessLog` on `administrationApi` that surfaces in the ADM-09 audit feed. Applied to every admin surface that printed a patient name: Queue, Waiting Room, Clinic Overview. A reveal needs the capability **and** a categorised reason **and** a successful audit write; grants are in-memory and lapse after 15 min. **Server-side enforcement is still absent** (frontend-only, as scoped). ⚠ **Multi-organization realignment (2026-10-06) · Keep.** Mechanics unchanged; masking and reveal apply within the admin's organization. |
| ADM-11 | §5   | Admin bottom tab bar: Overview · Doctors · Appointments · Logs · More                                                                | —                          | ✅ **DONE** — the config existed since AC-19; the four slots were simply still the Phase B clinic set (`overview · queue · waiting-room · staff`), chosen when those were the only admin screens there were. With ADM-02/04/05/07 live those slots were *wrong*, not missing: a phone-sized admin got the clinic's live-operations board and no route to doctors, appointments or the audit log. Now `overview · doctors · appointments · logs`; clinic operations stay one tap away under "More". Verified at 375px signed in as `admin@medora.health` — the bar reads **Overview · Doctors · Appointments · System Logs**, and all four resolve (`/admin`, `/admin/doctors`, `/admin/appointments`, `/admin/logs`). ⚠ **Multi-organization realignment (2026-10-06) · Rewrite.** One tab set per console. |
| ORG-02 | —    | 🔗 **Locations** — an organization's sites: address, timezone, opening hours, holidays | `/admin/locations` (proposed) | ↗ **Status: WEB-14** in [`CLIENTS_CHECKLIST.md`](../docs/multi-hospital/CLIENTS_CHECKLIST.md) (2026-10-26, §13.6). *Was:* 🔷 **Planned — blocked on API-W05, API-W12 (§9.1).** Added by the multi-organization realignment (2026-10-06). Organization console only. Opening hours and holidays move here from AC-07 / AC-08, one set per location. |
| ORG-03 | —    | 🔗 **Platform console** — organizations registry, licence verification queue, platform users, roles & matrix, platform settings, integrations, jobs, platform logs | `/platform/*` (proposed) | ↗ **Status: WEB-15 (role guards WEB-16)** in [`CLIENTS_CHECKLIST.md`](../docs/multi-hospital/CLIENTS_CHECKLIST.md) (2026-10-26, §13.6). *Was:* 🔷 **Planned — blocked on API-W13 (§9.1).** Added by the multi-organization realignment (2026-10-06). Takes the platform halves of ADM-01 / 02 / 03 / 07 / 09 and AC-14. Clinical-record access is not part of the approved platform-admin scope; any such access needs an explicit owner decision. |

---

## 5. Administration Center (what was built instead)

`features/doctor/administration/` · 38 files · 7,926 LOC — the largest module in the app. Not in `UX_ARCHITECTURE.md`; it came from `PHASE17_*` and `PHASE18_*`.

Keep it — clinic operations are genuinely useful. But **10 of 15 sections are display-only**, which is why it reads as unfinished.

> ⚠ **Multi-organization realignment (2026-10-06).** These sections are one clinic's operations over one localStorage store. Each belongs to an **organization**, and the operational ones to a **location** within it. Their future source is the Administration Center API — on `backend` (M23), not on `main`, and single-tenant until the Backend team scopes it (API-W05, §9.1). The note on each row says which.

| #     | Section                       | CRUD present?               | Status                                                                                                                                |
| ----- | ----------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| AC-01 | Clinic Overview               | n/a (dashboard)             | ✅ — moved from `/admin` to `/admin/clinic` by ADM-01, which took the area index. Still its own sidebar item, second after Overview. ⚠ **Multi-organization realignment (2026-10-06) · Rewrite — blocked on API-W05 (§9.1).** Organization overview, filterable by location. |

> **Phase B foundation.** Every admin collection was a `readonly` const with no write path anywhere. There is now one localStorage-backed clinic store (`medora.admin.clinic.v1`, merged over the seeded baseline) with generic id-based CRUD, and a mutation hook per collection that seeds the query cache with the full patched collection rather than refetching. The six sections still marked ❌ below need only their UI — the data layer is done and tested.
| AC-01b | Platform Overview | n/a (dashboard) | ➖ **Retired (Phase C / ADM-01)** — the Phase B page at `/admin/platform` was the placeholder for a real §3.1. ADM-01 absorbed it: `/admin/platform` redirects to `/admin`, the `platform` slug is gone from the section union and the sidebar. Nothing it showed was lost. |
| AC-02 | Queue | ✅ call next · reprioritise · reorder · remove | ✅ **Phase B** — was a queue you could only watch. Call-next pops the head, per-row priority select, move up/down persists the order, remove behind a confirmation. ⚠ **Multi-organization realignment (2026-10-06) · Rewrite — blocked on API-W05 (§9.1).** Per location, with a location selector. |
| AC-03 | Waiting Room | ✅ check in · advance · check out | ✅ **Phase B** — check-in drawer, the waiting → called → in-room progression as one button per card, check-out behind a confirmation. ⚠ **Multi-organization realignment (2026-10-06) · Rewrite — blocked on API-W05 (§9.1).** Per location, with a location selector. |
| AC-04 | Staff | ✅ add · edit · presence · remove | ✅ **Phase B** — the flagship complaint. Add/edit drawer with validation (name, title, valid email, phone, department), inline presence change per row, remove behind a confirmation. ⚠ **Multi-organization realignment (2026-10-06) · Rewrite — blocked on API-W05 (§9.1).** Owned by the organization. |
| AC-05 | Departments | ✅ add · edit · delete | ✅ **Phase B** — card grid with a create/edit drawer (name, description, head, status, staff count) and delete behind a confirmation. ⚠ **Multi-organization realignment (2026-10-06) · Rewrite — blocked on API-W05 (§9.1).** Owned by the organization; department names unique within it, not across Medora. |
| AC-06 | Shifts | ✅ assign · toggle day · remove | ✅ **Phase B** — each day cell is a button that toggles that person’s assignment; a planner is edited by clicking the grid, not through a form. Assign-shift drawer picks person, type and days. ⚠ **Multi-organization realignment (2026-10-06) · Rewrite — blocked on API-W05 (§9.1).** Per location, with a location selector. |
| AC-07 | Working Schedule | ✅ edit each weekday in place | ✅ **Phase B** — seven fixed weekdays are not a collection you add to, so there is no create/delete: a switch opens or closes each day and the times and break are inline inputs, saved per weekday via `setDay`. ⚠ **Multi-organization realignment (2026-10-06) · Rewrite — blocked on API-W05 (§9.1).** The seven-weekday editor stays, once **per location** — a site's hours, not the platform's — and moves under ORG-02. |
| AC-08 | Holidays | ✅ add · edit · delete | ✅ **Phase B** — closure calendar with date, public/clinic type and a recurring switch. ⚠ **Multi-organization realignment (2026-10-06) · Rewrite — blocked on API-W05 (§9.1).** Per location; moves under ORG-02. |
| AC-09 | Rooms | ✅ status per room | ✅ **Phase B** — turning a room over is what the board is for, so status is editable on the card itself. ⚠ **Multi-organization realignment (2026-10-06) · Rewrite — blocked on API-W05 (§9.1).** Per location, with a location selector. |
| AC-10 | Resources | ✅ add · edit · delete · ± quantity | ✅ **Phase B** — one-tap quantity adjustment, and **stock status is derived** from quantity vs reorder level rather than being a field someone must remember to update. ⚠ **Multi-organization realignment (2026-10-06) · Rewrite — blocked on API-W05 (§9.1).** Per location, with a location selector. |
| AC-11 | Announcements | ✅ create · edit · pin · archive | ✅ **Phase B** — rewired off local `useState` onto the store. Verified: pinning survives navigating away and back, which it never did before. ⚠ **Multi-organization realignment (2026-10-06) · Rewrite — blocked on API-W05 (§9.1).** Owned by the organization. |
| AC-12 | Clinic Policies | ✅ publish · revise · retire | ✅ **Phase B** — the last-updated date is stamped on save rather than typed, so the register’s dates stay trustworthy. ⚠ **Multi-organization realignment (2026-10-06) · Rewrite — blocked on API-W05 (§9.1).** Owned by the organization. |
| AC-13 | Document Templates | ✅ duplicate · archive | ✅ **Phase B** — rewired off local `useState` onto the store. Verified: a duplicate survives navigating away and back. ⚠ **Multi-organization realignment (2026-10-06) · Rewrite — blocked on API-W05 (§9.1).** Owned by the organization. |
| AC-14 | Platform Settings (16 panels) | ✅ full form envelope       | ✅ ⚠ **Multi-organization realignment (2026-10-06) · Split — API-W12, API-W13 (§9.1).** Platform panels go to the platform console (ORG-03); the organization panel becomes organization settings. |
| AC-15 | My Settings                   | ✅ (reuses doctor Settings) | ✅                                                                                                                                    |
| AC-16 | My Profile                    | ✅                          | ✅                                                                                                                                    |

### Administration Center UX issues

- [x] **AC-17 · ✅ DONE (Phase B).** The rail packed 16 items into a 560px scroll box with no scroll affordance, hiding Settings and Profile below the fold. Closed by AC-19: the shell sidebar scrolls properly and Platform Settings moved to its pinned footer. Verified: no overflowing panel at 1440×900.
- [x] **AC-18 · ✅ DONE (Phase B).** The Overview stacked a clinic-operational band on a platform band — two unrelated questions on one page, **4.7 screens of scroll** at 375px. Split into `ClinicOverviewSection` (`/admin`) and `PlatformOverviewSection` (`/admin/platform`), each a sidebar item, cross-linked from Clinic Overview’s quick actions. Measured after: **2.4 and 2.2 screens**. _Superseded by ADM-01_: the platform half is now the real §3.1 overview at `/admin` and Clinic Overview moved to `/admin/clinic`.
- [x] **AC-19 · ✅ DONE (Phase B).** The admin area ran its own rail + command bar + search outside `AppShell`. Consolidated onto `AppShell` + an `adminNavigation` config, exactly as `FRONTEND_ARCHITECTURE.md` §4 intends. `AdministrationLayout`, `AdminRail`, `AdminCommandBar` and the feature-local `GlobalSearch` are deleted; search survives via a domain-free `ShellSearchContext`. The area gained breadcrumbs and per-page titles it never had.
- [x] **AC-21 · ✅ DONE (Phase B).** _Found during AC-18._ 14 of 16 admin pages had **no `h1`** — `SectionShell` rendered the page title as `h2` while doctor pages use `h1` via `ContentHeader`. `SectionShell` now owns the page `h1` and `Panel` defaults to `h2`, so both portals share one heading contract. Verified: every admin page has exactly one `h1` and zero level skips.
- [x] **AC-22 · ✅ DONE (Phase B).** _Introduced by AC-19, caught while verifying AC-18._ The sidebar highlighted **two items at once** — `/admin` prefixes every admin route, so “Clinic Overview” stayed lit everywhere. The old rail handled this with `end`; the shared sidebar did not. A new `isItemActive` helper (most-specific match wins, plus explicit `end` for an area index) is now shared by the sidebar and the bottom tab bar. Verified: exactly one item per route, both portals.
- [x] **AC-20 · ➖ Moot (Phase C / ADM-01).** The dead-end "Manage users" and "Manage" (licences) links lived on the Platform Overview page that ADM-01 retired. "Manage users" is gone from `src/` entirely. "Manage" survives on the overview's Storage & Usage card (`overview/StorageUsageCard.tsx`) — but it is no longer a dead end: it links to `/admin/settings/integrations`, a page that exists. Every link on the ADM-01 overview goes to a real destination with its filter applied.

---

## 6. Data & persistence

| #     | Item                                               | Status    | Notes                                                                                                                                                                                                                                          |
| ----- | -------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DP-01 | Every feature has an `api/` layer with query hooks | ✅        | Consistent, well-factored                                                                                                                                                                                                                      |
| DP-02 | 🔗 **Every one resolves mock data**                | 🔷 **P0** | 20 files write to `localStorage`; 6 `mock/` directories. **Auth now talks to a real server**; nothing else does, and nothing else can — the backend implements auth, `/health`, `/ready` and `/me/*`, and no clinical endpoint exists yet. Not a defect you can fix alone. **Stale in part (2026-10-23 audit, §18):** clinical endpoints now exist on `main` and FE-10 connected the doctor workspace to them; the surfaces still on mocks are the `MOCK_ONLY` rows of §13, each blocked on a route the API does not serve. ⚠ **Multi-organization realignment (2026-10-06) · Rewrite.** Wire the remaining mock surfaces **only** against organization-scoped routes; until then they keep their "Not connected yet" state. Wiring them to today's single-tenant routes would bake the single-clinic model into the client. |
| DP-03 | 🔗 Backend contract exists                         | ✅        | `MEDORA_BACKEND_HANDOFF.md`, `BACKEND_MASTER_CONTEXT.md`, and the API contract on `claude/healthcare-backend-analysis-16b5ee`. Read it before designing the DP-04 seams so your types match the envelope. *(Reconciled 2026-10-25, §20.)* That branch no longer exists on the remote. The contract lives at `backend/docs/BACKEND_API_CONTRACT.md` — `backend`'s copy is ahead of `main`'s — and the by-branch reading is [`docs/handoff/BACKEND_FRONTEND_CONTRACTS.md`](../docs/handoff/BACKEND_FRONTEND_CONTRACTS.md).                                      |
| DP-04 | Swap plan: mock → HTTP behind `env.enableMocks`    | 🟡 P0 — 1 of 13 | **Auth is done and is the template.** The flag is now read in exactly one place (`selectService`, `api/seam.ts`) and really does select the adapter. Copy the five rules and the file layout from [`docs/handoff/auth-seam.md`](../docs/handoff/auth-seam.md) §1 — note especially that the port belongs in `types/`, because `src/api` may not import a feature (§1.2). Twelve features to go, and they are blocked on endpoints, not on this design: the API implements auth, health and `/me/*` only. **Stale (2026-10-23 audit, §18):** FE-10 put the doctor features behind this seam with HTTP adapters ([`docs/FE-10-INTEGRATION-STATUS.md`](../docs/FE-10-INTEGRATION-STATUS.md)); what is left on mocks is listed per row in §13 (`MOCK_ONLY`, `BLOCKED_BACKEND`). |
| DP-05 | Optimistic updates + rollback on failure           | ✅        | **Audited and settled, 2026-09-01 — and the row's own claim was wrong.** It said optimism was "present in notifications/messaging"; neither had it. Both only did `onSettled: invalidate`, and across 22 mutation modules exactly **one** used `onMutate` (the pharmacy's cancel-with-reason). **Now implemented where it belongs**: `useUpdateNotificationsMutation` (read · archive · favourite · pin) patches the list *and* the badge cache under `onMutate`, cancels in-flight refetches first so a late response cannot overwrite the patch, and `onError` restores the exact previous value rather than refetching — a failed write is invisible instead of a flicker. The badge is patched alongside the list because sidebar, bottom tab bar and navbar bell share that entry; patching only the list leaves the unread count contradicting the rows beneath it. **The register of deliberate refusals, which is the substance of this row**: signing a prescription, marking a lab result reviewed (single and bulk), attaching a report to a record, annotating a result, and signing a medical record are all **pessimistic on purpose**, each recorded at its own call site. Ending a prescription (cancel or discontinue) joined them on 2026-10-22: it was the one optimistic write in the pharmacy, contrary to `FRONTEND_ARCHITECTURE.md` §10's ban on optimism for prescriptions. Rollback is the weaker guarantee — it restores the row *after* the failure is known, and in the window before that the Inbox has already dropped it and the critical-unreviewed chip has already counted down, telling a doctor that something is handled when it is not. UX §2.6 says so in as many words. The rule this settles on: **optimism where a failure costs a row reappearing, never where it costs a false clinical claim.** 4 tests. |
| DP-06 | Real export (CSV/PDF) instead of success toasts    | ✅        | **Stale row, closed by `utils/export.ts`** — CSV, Excel, a hand-built PDF, JSON and print behind one `runExport`, called by `ExportButton` before its toast. Four of the five call sites were downloaded in a browser and checked for size and header (see D-16, D-20, D-23, D-06); D-25 was read from the code path only. |

---

## 7. Recommended order of work

**Phase A — stop shipping blind** ✅ **DONE** (2026-08-09, one commit on `claude/doctor-lab-system-phase-7-c1f15a`)

1. ✅ F-08 test runner + tests on `guards`, `ApiClient`, and the patients query layer — 52 tests, 10 files
2. ✅ F-10 CI live and green on GitHub Actions (typecheck · lint · test · build)
3. ✅ F-15 skip link · ✅ F-16 page titles · ✅ F-17 heading levels · ➖ A-10 withdrawn as a false positive

Gates after Phase A: `typecheck` 0 errors · `lint` 0 errors / 20 warnings (unchanged baseline, corrected from an earlier "17" — verified against clean HEAD; the new code added none) · `test` 52/52 · `build` green.

**Phase B — make the admin area honest (2–3 sprints)**

4. ✅ AC-19 consolidate onto `AppShell` + `adminNavigation` — **done**; also closed AC-17, ADM-11, D-28
5. ✅ AC-18 split Clinic Overview from Platform Overview — **done**; also closed AC-21, AC-22
6. ✅ AC-02…AC-13 CRUD for every admin section — **done**; store plus all twelve sections, including the two that only looked editable
7. ✅ ADM-09 permission-matrix editor — **done**; `permissions.ts` (catalog + safety rules + diff/preview, pure), `PermissionMatrixPanel.tsx`, `useUnsavedChangesGuard`, and a revisioned `savePermissions` on `adminSettingsApi`

**Phase C — build the real Admin Dashboard (3–4 sprints)** ✅ **DONE** — all nine §3 screens are live; ADM-08 was the last.

8. ✅ ADM-10 PHI masking + elevation gate — **done**; the gate every later admin table goes through. `MaskedIdentifier` is the only sanctioned way to render a patient identifier in the admin area.
9. ✅ ADM-05 appointment oversight — **done**; the first real Administrator Dashboard screen. `features/admin/appointments/` (pure rules, mock service with an atomic write path, five components), mounted at `/admin/appointments` as an admin section.
10. ✅ ADM-02 / ADM-03 doctors + verification queue — **done**; `features/admin/doctors/` — the list, the profile with five tabs, and the verification state machine. Cross-links both ways with ADM-05: suspension counts the appointments it would strand, the Appointments tab reads the oversight store, and `/admin/appointments?doctor=<id>` arrives filtered.
11. ✅ ADM-04 patients + medical-access grid — **done**; `features/admin/patients/` (pure rules, mock service with a reason-checked write path, list, three-tab account view, access grid). Every identifier goes through ADM-10, including in the control labels, and the export leaves them out entirely.
12. ✅ ADM-07 system logs as a real investigation page — **done**; `features/admin/logs/` aggregates the trails ADM-02/04/05/10 already keep into one paginated, filterable, pivotable stream, seeding only the System category. Read-only by construction (no event mutation exists on the service) and the export logs itself. `getAuditEvents()` becomes a filtered projection of the log rather than a second store.
13. ✅ ADM-01 admin overview wired to the above — **done** (taken out of order, ahead of ADM-07); `features/admin/overview/` derives every KPI, alert and queue count from the documents ADM-02/04/05 already hold, mounts at `/admin` as the area index, absorbs Platform Overview (`/admin/platform` redirects, Clinic Overview moves to `/admin/clinic`), and leaves the "Investigate" links pointing at the nearest real destination until ADM-07 lands.
14. ✅ ADM-06 communication monitoring — **done** (Task 13); see §4 for what shipped.
15. ✅ ADM-08 admin reports — **done**; the last §3 screen, so **Phase C is complete**. `features/admin/reports/` derives four report tabs from the ADM-02/04/05/07 documents rather than storing a corpus, reuses ADM-05's heatmap derivation, and builds each widget's table and export file from the same object its chart is drawn from. See §4 for what shipped and what it deliberately does not claim.

**Known gaps carried out of Phase C**

- The ADM-09 matrix does **not** yet drive live session permissions: `useCan()` still reads the bundle the mock auth backend issues at sign-in (`features/auth/mock/users.ts`), so a matrix save changes the declared policy but not the current session. Binding the two is an auth-layer change, and the real one belongs on the server.
- PHI enforcement is frontend-only. `MaskedIdentifier` never renders a value without a logged justification, but the clear value is still delivered to the client. Real least-privilege needs the server to withhold it until the elevation is presented.
- §3.9 also specifies **custom role creation from a base template**; the matrix ships with the five platform roles fixed. *(2026-10-23: the API now serves `POST /roles`; held on DEC-013, §14.)*
- The ADM-01 overview's **platform telemetry, service health and storage are mock-served** (`overview.api.ts`). Nothing behind them measures anything: there is no telemetry backend, no uptime probe and no usage meter, so the activity chart, the service list and the licence/storage figures are invented numbers in the shape the real ones will take. Everything else on that page is derived from real stores and is therefore honest; these three are not, and no operational decision should be made from them until DP-04 gives them a source. **ADM-08's System performance tab reads the same three** and carries the same caveat on the page; its notification-delivery widget is the one figure on that tab measured from a real store.
- ADM-08 leaves **four §3.8 figures unservable from the admin area** — lab turnaround, AI usage and latency, latency percentiles, and a true error rate. The first two render as `unavailable` widgets naming what would supply them; the last two are stated on the widgets that stand in for them. Only lab turnaround has data anywhere in the client: D-10…D-14's inbox carries the timestamps, but §3.4 forbids the admin area reading a doctor feature's store, so it needs a shared laboratory service rather than a wider range. The other three need the model service and a metrics backend.

**Phase D — close the doctor's clinical loop (2–3 sprints)** 16. D-17 / D-18 prescription authoring + safety screen + medication database — **D-17 / D-19 done; D-18 still blocked on drug reference data** 17. ✅ D-21 medical-record authoring — **done**; create, sign and amend, with the scope derived from UX §2.3 because no Medical Records section exists. See §3.8 18. ✅ D-10 … D-14 lab inbox, mark-reviewed, trends, attach-to-record — **done** (taken ahead of D-21); see §3.6 for what shipped and what did not 19. D-26 global search · D-01 real quick actions · D-04 / D-05 / D-06 patient profile gaps

**Phase E — leave the mocks behind** (gated on the backend — start the seams now, finish when it lands)

20. DP-04 endpoint swap, feature by feature, behind `env.enableMocks`
21. DP-06 real exports · 🔗 A-12 real auth
22. ~~F-19 app-wide i18n **only if** Arabic is a target~~ — **decided and done.** Arabic is a target; five locales (en · ar · tr · fa · fr) ship with RTL. The warning was right: it touched every screen built before it, and ~2,045 feature-interior strings still await a clinical translator (`docs/handoff/i18n.md`).

**Phase F — Doctor Dashboard experience upgrade (§10)** — split into four tranches with different best-times, _not_ one block of work:

| Tranche  | Rows          | Best time                                                                       | Why then                                                                                                                                                                                                                                                                                                                                                            | Size   |
| -------- | ------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **F1**   | DX-01 … DX-06 | **Now — in parallel with Phase B/C**                                            | Touches only `features/doctor/dashboard/`, `components/patterns/`, and `vite.config.ts`. Phase B/C live in `features/doctor/administration/` and `features/admin/`. Zero file overlap, so it can run beside them without merge pain. DX-02's motion tokens and DX-06's bundle baseline are prerequisites for everything after, so doing them late costs a rework pass. | 3–5 d  |
| **F2**   | DX-07 … DX-14 | **Retired** | Built, then removed with the feature it delivered. See §10.2. | — |
| **F3**   | DX-15 … DX-21 | **Retired** | Built, then removed with the feature it delivered. See §10.2. | — |
| **F4**   | DX-22, DX-23  | **Rides Phase D — same sprint as D-17 / D-21, not before**                       | A "real" quick action needs a real flow behind it. Until D-17 (prescription authoring) and D-21 (record authoring) exist there is nothing to open, so the honest interim is DX-22a: relabel the buttons. Do not build a second authoring flow inside the dashboard.                                                                                                    | 1–2 d  |

Phases A–D are entirely yours except for the ten 🔗 rows in §9. None of those ten block a phase: in every case the component, states, and interactions are frontend work you can build and demo against mock data first. Phase F added two more 🔗 rows (§9 rows 11–12); both are retired.

---

## 8. How to keep this file honest

Re-run the audit the same way it was produced:

```bash
npm --prefix "C:/Users/User/Desktop/Medora_System" run dev
```

Sign in with `admin@medora.health` / `Medora123!` (or `doctor@medora.health`), then check each ❌ row against the running app. Two greps carry most of the weight:

```bash
grep -rc "onClick" src/features/doctor/administration/sections/*.tsx
```

```bash
for d in src/features/doctor/*/; do echo "$d $(grep -rl useMutation "$d" | wc -l)"; done
```

A section with `0` in either is still read-only.

### No duplicate IDs — this file is the single source of truth (2026-10-25)

Every frontend task lives here, once. Audits, PRs and test runs record progress **on the existing row**; detailed execution history goes in the dated sections (§11–§21) or a report, never in a second checklist.

1. **Search before allocating.** Before creating any ID, search this whole file (register §13, narrative §1–§10, §9 dependencies, §14 decisions), the handoff documents and the implementation for a row that already covers the requirement — by its Feature cell, its Remaining cell and the narrative under its section.
2. **Reuse the ID** when one exists: update its status, evidence, notes and verification. More work, a failed test, missing verification, an unresolved backend dependency, a bug fix, responsive/accessibility/regression checks within its acceptance, or the same gap found by another audit — none of these is a new row.
3. **A new `NEW-*` row only for a genuinely distinct requirement,** recorded with: the requirement, why it is needed, why no existing ID covers it, acceptance criteria, dependencies, and how it will be verified.
4. **Never renumber, never reuse a retired ID.** A retired ID stays listed with the row that absorbed it (§13.1 *Retired IDs*), so old commits and PRs still resolve.
5. **Do not split a row automatically.** A row's scope is its Feature cell; gaps outside it that the row already tracks stay in its Remaining cell. Split only for a documented scope distinction.
6. **Backend gaps on an existing row go to the §9 dependency register** under that row's ID, not into a new register row.
7. **Before finishing, check the work for duplicates it introduced** and reconcile them without losing evidence, references or dependencies.
8. **Counts come from the rows** (`node scripts/count-checklist-register.mjs`). Report the main register (§13.2–§13.5) and the §9 dependency rows separately; never add them together. Multi-hospital tasks are counted only in [`CLIENTS_CHECKLIST.md`](../docs/multi-hospital/CLIENTS_CHECKLIST.md) (WEB-*); §13.6 is a map, not a count *(2026-10-26; until then this rule also reported §13.6's fourteen rows)*.
9. **One status per task across the frontend registers.** A row or ⚠ note here that tracks the same work as a WEB-* row in [`CLIENTS_CHECKLIST.md`](../docs/multi-hospital/CLIENTS_CHECKLIST.md) names that WEB row and keeps no status of its own: register rows move to §13.6 (never deleted, never renumbered), and a ⚠ note loses its box. Only the part of a row that is outside every WEB row keeps a status here, and says so. A WEB row that is missing is reported to the owner, not added here *(2026-10-26)*.

---

## 9. Dependency register — the 🔗 rows

Scope note: this document is a **frontend** checklist. Every screen, state, component, interaction, and accessibility item in §1–§8 is frontend work. The rows below are the only places where something outside the frontend is required, and in most of them the visible part is still yours.

| #   | Row    | What you own                                                                          | What you're waiting on                        | Who to ask            |
| --- | ------ | ------------------------------------------------------------------------------------- | --------------------------------------------- | --------------------- |
| 1   | F-07   | `ApiClient`, error normalization, refresh interceptor                                 | ~~Live endpoints to point it at~~ **Stale (2026-10-23):** live endpoints exist and FE-10 uses them; what remains is G-1, a run against a live API (§13) | Backend               |
| 2   | A-12   | ✅ Done — the seven screens, **and** the mock→HTTP seam, the typed HTTP service, and the 401→refresh→replay wiring | Nothing for sign-in: verified end to end against the live API. Still owed: a **re-authentication endpoint** for the lock screen, which has none ([seam doc](../docs/handoff/auth-seam.md) §4) | Backend |
| 3 | D-04 | ✅ Read side done — the port (typed from `shared/files`), the unconfigured adapter, and a tab that states what it cannot do instead of exporting a stand-in. **Still owed: upload.** Not started deliberately — an upload dialog over storage that answers 503 is fake completeness | `backend/src/modules/files` is a registered module with four empty directories. Signed download + the §17.2 scan gate, i.e. **M25** *(Reconciled 2026-10-25, §20.)* Stale on `backend`: M25 built `POST /files`, signed downloads and the scan gate there (not on `main`), but no object store is configured (M25.2 partial) and no scanner is bound (M25.3 partial), so every upload is held at 403 `scan_pending`. Still blocked, for that reason **Re-checked 2026-10-31 (§32):** the `/files` routes exist on `backend`, but `GET /patients/:id/documents` serves no `fileId` (`PatientDocumentView`) and no route links an upload to a patient as a document, so neither read nor upload can be wired. NEW-13 (profile photo): the upload is built; `PUT /me/profile/photo` saves the storage key as `photoUrl`, so a browser cannot display the result — the view needs a signed URL. **Pass 16 (2026-11-01, §33):** the link and per-document download routes (backend PR #158) are now on `frontend`, and the adapter over them is written. What is still owed is infrastructure plus one backend indicator: an object store (M25.2), a scanner that scans (M25.3), and a `storage` probe for `/health` (DEC-018). | Backend |
| 4   | D-09   | ✅ Surface **and seam** done — chat, streaming render, retry states, plus the port and adapter selection they now go through. A model service lands as one adapter, not an edit to the chat | A model service. No assistant endpoint exists in `backend/src/modules`; the canned replies each carry a disclaimer naming themselves as demo output until one does | AI/backend |
| 5   | D-17   | ✅ Done — stepper, blocking screen, severity alert stack, acknowledgment + **the fail-closed path**, and the module's first mutations | **Only the real verdicts.** The frontend half is built and proven; what is outstanding is a clinical interaction/allergy service to replace the demo formulary's canned notes. The seam is ready for it: `checkSafety` already returns `unknown` and the client refuses anything it cannot read as a warning list, so a real adapter cannot fail open by mis-parsing a body | Clinical data service |
| 6 | D-18 | Typeahead + monograph drawer — **not started, deliberately.** D-17's step 2 is a picker over the five-item demo formulary, labelled as such from the data; a typeahead over five rows would be fake completeness | Drug reference dataset **2026-10-31 (§32):** the typeahead is built over `GET /medications?q=` (on `main`); what remains is only the dataset it searches. | Clinical data service |
| 7   | D-22   | Share dialog and recipient picker                                                     | A sharing/permission policy to design against | Product + backend     |
| 8   | ADM-10 | Masking component, reveal interaction, justification modal — **the bulk of the work** | Server-side enforcement + audit write         | Backend + security    |
| 9   | DP-02  | —                                                                                     | Any live API at all                           | Backend               |
| 10  | DP-03  | Matching your types to the envelope                                                   | The contract is already written — go read it  | —                     |
| 11  | DX-11  | ➖ Retired with F2 (§10.2) | — | — |
| 12  | DX-18  | ➖ Retired with F3 (§10.2) | — | — |
| 13  | D-11 / D-14 | ✅ **The whole frontend half.** The review loop, the fail-closed acknowledgment, bulk review, the trend view, and attach-to-record with its identity check — all built, tested and mock-resolved behind `features/doctor/labs/service.ts`, the same seam shape auth and pharmacy use | *(Reconciled 2026-10-25, §20.)* Stale: these routes are served on `main` as `/lab-orders…` and FE-10 connected them (§13.3 D-10…D-14). The text below is the 2026-08 handoff. **Four endpoints, and no more.** `GET /labs`, `GET /labs/:id`, `POST /labs/:id/review` (body: acknowledged critical result ids + note; must reject a review that omits any critical value on the result, because the client's guarantee is only as strong as the server's), and `POST /records/:recordId/attachments` (body: lab id + confirmed patient id and MRN; must reject a mismatch server-side). Until they exist a review lives in memory and dies with the tab, and the timeline event says so in words rather than claiming it was filed. Note for the mobile client: nothing above is web-specific — the port in `model/lab-service.ts` is the contract both should share | Backend |

| 14  | D-21   | ✅ **The whole frontend half.** Authoring flow, the fail-closed signature, amend-not-edit, the status map, drafts and the unsaved guard — all built, tested and mock-resolved behind `features/doctor/medical-records/service.ts`, the same seam shape auth, pharmacy and labs use | **Five endpoints.** `GET /records`, `GET /records/:id`, `POST /records` (create; must return the first note **unsigned**), `POST /records/:id/notes/:noteId/sign` and `POST /records/:id/notes` (addendum). Two rules the server must re-enforce rather than trust the client on: **only a note's own author may sign it**, and **a signed note is immutable** — there must be no update-note endpoint at all, or the amend-not-edit guarantee is client-side decoration. Status changes need the same transition map server-side. Until they exist an authored record dies with the tab, and the timeline event says so in words. Note for the mobile client: the port in `model/record-service.ts` is the contract both should share | Backend |

| 15  | §3.1 pulse | ✅ Trend, satisfaction and activity connected (M27, `backend` only); the practice-pulse widget shows the no-show rate counted from `GET /appointments` `totalItems` (2026-11-15, §42) and draws no other metric | A route for consultation length and request response time — none on any branch (the appointment view has no actual visit times); optionally a no-show aggregate to replace the four count calls | Backend |
| 16  | §3.12  | ✅ Integrations panel reads the server's state and disconnects (M22, `backend` only); Connect withheld live | An OAuth client per provider so `POST /me/integrations/:id/connect` stops answering 501 (RA-M22.1) | Backend |
| 17  | §3.11  | ✅ Analytics, saved reports (save, duplicate, delete) and schedules (create, pause/resume, delete) over M21, `backend` only; rename, favourites and delivery withheld | A rename and a favourite route for saved reports; a delivery path for `reports.scheduled-run` (attachments on the mail port, or a bound scan engine) | Backend |
| 18  | NEW-30 | ✅ The banner, its failure state and its links (M27.3, `backend` only) | An `allergy-conflict` alert names the patient but carries no patient id, so its action opens the day's book (`/doctor/appointments`) rather than the patient's chart. `CriticalAlertsRepository.todaysCriticalAlerts` selects only the alert's id, its message and the patient's name; adding the patient's public id to the view would let the action open the chart | Backend |

*(Reconciled 2026-10-25, §20.)* Rows 13 and 14 are historical: every endpoint they list is served on `main` and connected (§13.3 D-10…D-14, D-21). One of row 14's two rules holds as written — a signed record note has no update route and only its author may sign it (`RecordService.signNote`, 403 `not_note_author`). `PATCH /medical-records/:id` edits a record's fields, not its notes, and is author-only on `backend` (BR-DEC-004).

**Practical read (§9):** nine of the first ten have a frontend half you can build today against mocks. Only DP-02 is purely someone else's. Rows 11 and 12 are retired with the tranches that raised them (§10.2). Rows 13 and 14 are the same story again: D-11/D-14 and D-21 shipped complete against their seams, and what the backend owes is nine endpoints listed precisely enough to build from — including, for records, two rules the server must enforce rather than trust the client on. Nothing in this checklist is a reason to sit idle.

### 9.0 Backend requirements from owner decisions — 2026-10-21

| Req | From | What the backend must do | Blocks | Status — `backend` `7ed7e4d`, read 2026-10-25 (none is on `main`) |
| --- | --- | --- | --- | --- |
| **BR-DEC-001** | DEC-001 | `PATCH /patients/:id/notes/:noteId` and `POST …/notes/:noteId/sign` refuse any caller who is not the note's author — for direct API requests, not only the UI — as `POST /medical-records/:id/notes/:noteId/sign` already does | Production release of chart-note editing and signing | **Implemented** (`acc2c7e`, PR #89), verified by the backend's HTTP e2e; consumed (§13.3 notes) |
| **BR-DEC-004** | DEC-004 | `PATCH /medical-records/:id` checks author/role server-side (today any doctor with a care assignment to the patient may edit), and accepts and persists a reason for each edit in its version row | Production release of record editing | **Implemented** (`2eb3b87`, PR #90) — author only, optional reason; consumed (NEW-12). Mandatory reason and other roles: owner **Found 2026-10-25:** the route accepts `department` and applies nothing (`scalarsOf` and `diffOf` in `record.service.ts` omit it, on `main` and `backend`) — so the client no longer offers it; to make it editable the service must resolve and write it, or the schema refuse it |
| **BR-DEC-005** | DEC-005 | `PUT /me/availability` reports (or, by policy, refuses) a week that leaves live future appointments outside the new hours, returning the affected appointment ids — the server is the only place this can be exact, since it alone knows the clinic timezone; until then, the clinic timezone readable by a doctor (`platform_settings.localization.timezone`) so the client check can compare in the right zone. Separately, decide **RA-005.1** (may a doctor's hours fall outside clinic opening hours?) and, if they may not, enforce it server-side and serve clinic hours to the client | Exact stranded-appointment warnings; any clinic-hours rule | **Implemented, report mode** (`8d9b655`, PR #94); consumed (NEW-08). Refuse-vs-report and RA-005.1: owner |
| **BR-DEC-006** | DEC-006 / 006a | Laboratory: a technician scoping model (which orders a `laboratory` account may reach — department, site or worklist), and lab-role access to `/lab-orders` list/detail, `…/transition`, `…/results`, `…/attachments` without `requireDoctor`. Pharmacy: a pharmacy capability set and routes to list, view and dispense prescriptions (none exists; all of `/prescriptions/*` requires `prescriptions.create`). Reception: booking, cancelling and rescheduling **on behalf of** a doctor (today `/appointments/*` is `requireDoctor`), and check-in / waiting-room routes (the `administration` module is an empty scaffold). All three: staff messaging (`messaging` module is an empty scaffold) | The unavailable halves of the Reception, Laboratory and Pharmacy workspaces | **Part 4 only** — staff messaging verified for the three roles (`69e4a2c`, PR #98). Parts 1–3 (lab scoping, pharmacy, reception booking/check-in) **not implemented**. The web client still cannot message: no recipient lookup, participant rule open (API-W09) |
| **BR-DEC-002** | DEC-002 | A route to discard an unsigned prescription draft. Today `/cancel` and `/discontinue` refuse a draft (409 `draft_not_discontinuable`, D-13.1: the `signed_at` CHECK forbids a withdrawn draft from leaving `draft`) and nothing else removes one, so an abandoned draft can only be left | Discarding drafts from the client | **Implemented** (`17ddda2`, PR #91, ADR-044); consumed (NEW-10) |
| **BR-DEC-003** | DEC-003 | A versioned history-correction route; a persisted mandatory reason on history correction and removal (and on contact removal and alert resolution); actor, timestamp, target and before/after values in an audit trail that cannot be silently overwritten; a read returning removed/superseded history entries marked as such; server-side authorization on all of it | History edit and remove (NEW-04b); reasons on contact removal and alert resolution | **Partial** (`0ee2a79`, PR #101) — reasons persisted, mandatory on history removal; consumed (NEW-04a/b). Correction route (point 1) and removed-entry read (point 4) **not implemented**; point 5 is the owner's |

Full text of each in §14.1. The status column is a reading of `backend` source and `backend/docs/FRONTEND_DECISION_REQUIREMENTS.md`, not a live run (G-1) *(Reconciled 2026-10-25, §20.)*.

### 9.1 Multi-organization API dependencies — 2026-10-06

Added by the multi-organization realignment. The contracts are the frontend's **proposal** for the Backend team to confirm or change; none of them is implemented, and none is frontend work. Every organization-scoped route takes the organization from the session, never from a client parameter, and answers **404** for another organization's id. Where a row needs data that does not exist yet, the Database team is named. "On `backend`" means the route is built on the `backend` branch but has not reached `main`; whether and when it does is the owner's integration decision.

| #   | API     | Rows                          | What you own                                                                 | What you're waiting on | Who to ask |
| --- | ------- | ----------------------------- | ---------------------------------------------------------------------------- | ---------------------- | ---------- |
| 15  | API-W01 | A-08, A-12, ORG-01            | Role-aware guards, organization switcher, organization-aware query keys, *no membership* / *revoked* states | `GET /auth/session` adds `activeOrganization {id, name, type} \| null`, `memberships [{organization {id, name}, role, status}]` and `platformRole`; `POST /auth/session/organization {organizationId}` re-issues the session; error codes for an inactive or revoked membership. **Not built.** Data: organizations, memberships | Backend + Database |
| 16  | API-W02 | §3.1–§3.8, §3.11              | Rendering organization-scoped responses, source labels, "in this organization" empty states | The existing doctor routes (`/patients`, `/appointments`, `/medical-records`, `/lab-orders`, `/prescriptions`, `/dashboard/doctor`, `/reports`) scoped on the server to the active organization; rows gain `organization {id, name}`, appointments gain `location`. **Live on `main`, not scoped.** The identified authorization gap covers medical records, lab orders/results/trends, and the patient history, notes, vitals, documents and studies tabs: today these are scoped by care relationship only and require eventual organization-scoped authorization. The prescription list is already prescriber-scoped and is not part of this identified authorization gap, but it still requires organization context. Data: organization ownership on clinical rows | Backend + Database |
| 17  | API-W03 | §3.4, §3.12                   | Affiliations list, availability editor per location, location picker          | `GET /me/profile` adds `affiliations [{organization, location, department, status}]`; `/me/availability?locationId=`. **Live on `main` without them.** Data: memberships, locations | Backend + Database |
| 18  | API-W04 | §3.3, §3.7                    | Source-organization labels; safety-screen wording                            | A shared safety summary — allergies, active medications, chronic conditions from other organizations, each with its source — under an approved clinical rule. **Blocked on a clinical owner** | Clinical owner, then Backend |
| 19  | API-W05 | D-27b, AC-01…AC-13, ADM-01, ORG-02 | Organization / location selectors over the existing sections            | `/administration/*` scoped to organization and location, plus locations CRUD. **On `backend` (M23), single-tenant** | Backend + Database |
| 20  | API-W06 | ADM-02, ADM-03                | Members table; invite, approve, suspend                                      | The members of the admin's organization. **Not built** — `/doctors` and `/admin/users` are platform-wide | Backend + Database |
| 21  | API-W07 | ADM-04                        | Masked enrolled-patient directory                                            | Patients enrolled with the admin's organization, masked, with audited reveal. `GET /patients` (masked) is live on `main` and is currently platform-wide; the missing capability is the account-governance API (M10.7), which is not built. | Backend + Database |
| 22  | API-W08 | ADM-05                        | Same-organization reassign picker                                            | `/admin/appointments` scoped to the admin's organization. **Live on `main`, platform-wide** | Backend |
| 23  | API-W09 | ADM-06, §3.9                  | Organization labels, recipient picker                                        | `/admin/conversations` and `/conversations` scoped; a participant rule for staff messaging. **On `backend` (M20), single-tenant** | Backend |
| 24  | API-W10 | ADM-07                        | Two log views                                                                | `/audit-events` with an organization view and a platform view. **On `backend` (M28)** | Backend |
| 25  | API-W11 | ADM-08                        | Organization analytics                                                       | Cross-doctor analytics for the admin's organization. **Not built** | Backend |
| 26  | API-W12 | ADM-09, ORG-02                | Organization settings and locations UI                                       | Organization profile, locations, booking policy. **Not built** — today a single `organization` settings slice, on `backend` | Backend + Database |
| 27  | API-W13 | ORG-03, AC-14                 | Platform console                                                             | Organizations registry, licence verification queue, platform users; plus roles / matrix (**live on `main`**), platform settings, integrations, jobs (**on `backend`**). Backup routes exist on `backend`; create/restore currently answer 501. | Backend + Database |
| 28  | API-W14 | D-26                          | Organization-scoped search results                                           | `/search` scoped to the active organization. **On `backend` (M26)** | Backend |

**Status of the work these block — 2026-10-26.** The rows above are API dependencies, not frontend tasks, and carry no task status. The frontend work each one blocks is a WEB row in [`CLIENTS_CHECKLIST.md`](../docs/multi-hospital/CLIENTS_CHECKLIST.md), which holds its status; §13.6 maps each API-W row to its WEB rows.

**Superseded wording — reconciled 2026-10-25.** The table above is the 2026-10-06 proposal; `docs/multi-hospital/OWNER_DECISIONS.md` (2026-10-07, FINAL) wins where they disagree, and the rows are left as written so the history stays readable. Read them this way:

- **API-W01** — no `memberships[]` and **no** `POST /auth/session/organization`: a doctor has one active hospital employment (DR-02) and there is no switcher of any kind (DR-08). The session needs the **active hospital** (and clinic/location where relevant), server-derived. `docs/multi-hospital/CLIENTS_CHECKLIST.md` WEB-1/WEB-2.
- **API-W03** — `affiliations[]` gives way to a read-only **employment** record and its history (DR-02, WEB-6).
- **API-W04** — the cross-organization shared safety summary is withdrawn (DR-03). Cross-hospital data arrives only through a purpose-bound, category-limited **grant** or audited **Break-Glass** (DR-06, OD-04), UI in WEB-10…WEB-13c.
- **"Organization"** reads as **Hospital** throughout (DR-01); "organization admin" as **Hospital Admin** (OD-07).
- **Branch state** (`backend` `7ed7e4d`, `main` `f4a9e8d`): every route marked "On `backend`" above is still **not on `main`**, and every one is still single-tenant (`docs/multi-hospital/AUDIT_FINDINGS.md` AF-34). New on `backend` since this table: **`POST /patients/:id/reveal`** (M7.3, PR #87) — the audited server-side reveal API-W07 and ADM-10 need, still platform-wide. No API-W row is unblocked: none of the fourteen has a hospital-scoped route on any branch.

---

## 10. Doctor Dashboard — experience upgrade (DX)

**Added:** 2026-08-09 · **Status: F1 shipped (2026-08-25). F2 and F3 retired (§10.2). F4 not started.**
**Scope:** `features/doctor/dashboard/` — modern clinical dashboard, consistent motion language, lower information density, honest quick actions, measured performance.
**Scheduled as:** Phase F in §7, four tranches (F1 done · F2 and F3 retired · F4 rides Phase D).

### 10.0 What the audit found before planning this

Read before starting — three of these change what the work is:

1. **A motion system already exists; do not add one.** `framer-motion@^11.15.0` is a dependency, [`MotionProvider`](src/app/providers/MotionProvider.tsx) wraps the app in `LazyMotion({ features: () => import('./motion-features'), strict })` so the animation bundle is already out of the entry chunk, and `MotionConfig reducedMotion` is `"always"` when the doctor enables Reduce Motion in Accessibility settings, `"user"` otherwise. **`strict` means `motion.*` is forbidden — only `m.*` compiles.** The DX motion work is a _token layer + shared components_ on top of this, not a new library.
2. **There is no chart library.** Charts are hand-rolled SVG in `src/components/charts/` (Bar, LineArea, Pie, Heatmap, DistributionBars, Legend).
3. **Nothing on this dashboard is measured.** [`vite.config.ts`](vite.config.ts) has no `manualChunks`, no visualizer, no budget (this is F-11, still 🔷). "Before" numbers do not exist yet, so DX-06 must land before any optimization claim can be made.
4. **The dashboard renders pure mock data.** `MOCK_KPIS` / `MOCK_SCHEDULE` from [`model/mock-data.ts`](src/features/doctor/dashboard/model/mock-data.ts); there are no query hooks in this feature yet.
5. **The entrance animation is already implemented once, locally.** [`OverviewPage.tsx:28-47`](src/features/doctor/dashboard/pages/OverviewPage.tsx) defines a private `Reveal` (fade + 12px rise, 200ms, **30ms** stagger, cap 8 items). The upgrade brief asks for 40–60ms. These disagree; DX-02 must pick one number, put it in the token file, and delete the local copy — not leave two conventions in the repo.

### 10.1 F1 — Foundations, information architecture, density (no new dependencies)

| #     | Item                                                                                                                                                                                                                                                                                                                                                                        | Sev | Status |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------ |
| DX-01 | **Information architecture rebuild** (absorbs D-03). Regroup the four `Grid` bands in `OverviewPage.tsx` around _decisions first_: alerts + today's schedule above the fold, analytics behind a tab or a collapsed section, activity last. Use progressive disclosure (tabs / drawers / collapse), **not** smaller type. **Target: ≤ 1.5 screens at 1280×720, measured.** ✅ **DONE** — 2.61 → 1.43 screens with both sections closed (default state); alerts render outside both collapsible sections and above the fold. Reaching ≤1.5 needed one layout change beyond the original plan, beyond `Collapsible` itself: at `lg` the alerts band and the Today band sit side by side (alerts 1 share, Today 2 shares), and inside Today the schedule and quick actions sit side by side rather than stacked — stacked measured 1.66, side by side measured 1.43. Nothing was hidden and no type was shrunk. | P1  | ✅     |
| DX-02 | **Motion token layer.** One module (`src/styles/motion.ts` or tokens in `tokens.css`) exporting the four categories: micro 150–200ms · UI transition 200–300ms · entrance 300–500ms · stagger 40–60ms capped. Promote `Reveal` out of `OverviewPage` into `components/patterns` as `<Reveal>` / `<Stagger>`. Resolve the 30 vs 40–60ms conflict in §10.0(5). `m.*` only. ✅ **DONE** — token layer landed, `Reveal`/`Stagger` promoted to `components/patterns`, the 30ms vs 40–60ms conflict resolved in favor of the token file. | P2  | ✅     |
| DX-03 | ~~KPI value transitions.~~ **➖ Superseded by DESIGN_SYSTEM.md §9.4**, which forbids animating changing data values by name ("a lab number must never 'count up' — misleading in clinical context"). `KpiWidget` already encodes the prohibition in its own doc comment, and with static `MOCK_KPIS` no value ever changes, so the code would be unreachable. Recorded in the F1 design spec rather than deferred — this is a row that should not be built. | P2  | ➖     |
| DX-04 | **Mobile priority order.** At <md the dashboard must reorder, not stack: alerts → today's appointments → KPI summary → patient actions → analytics → activity. Verify at 375px. ✅ **DONE** — shipped order at 375px is hero → alerts → schedule → quick actions → **KPI row** → analytics → activity, verified live. Note this differs from the row's original wording above in one deliberate way: the KPI row sits *after* the schedule and quick actions rather than before them, because the schedule is the decision surface and the KPIs are context for it. The requirement text above is the pre-implementation brief and is superseded on that point by the design spec's §3.2 band table. | P1  | ✅     |
| DX-05 | **Reduced-motion coverage beyond Framer.** `MotionConfig` covers `m.*` components only. Audit CSS keyframes in `styles/globals.css` and every future canvas/rAF loop against `prefers-reduced-motion` **and** the in-app `settings.reduceMotion` toggle — the app toggle must win even when the OS setting is off, matching `MotionProvider`. ✅ **DONE** — verified live with OS `prefers-reduced-motion` **false** and the in-app toggle **on**: the panel's `transition-duration` drops from `0.2s` to `0.00001s`, i.e. the app toggle wins over the OS setting, matching `MotionProvider`. A closed panel also computes `visibility: hidden`, and `.focus()` on a control inside it leaves `document.activeElement` on `BODY`. | P2  | ✅     |
| DX-06 | **Performance baseline (closes F-11).** Add bundle analysis to `vite.config.ts`, record **before** numbers: entry chunk, dashboard route chunk, largest chunk, dashboard TTI/LCP, longest task. Commit the numbers into this file. Nothing in F2/F3 may claim a performance result without this row existing first. ✅ **DONE** — `ANALYZE=1` visualizer + `manualChunks` (`react`, `query`) added; before/after table recorded below. **Initial JS is essentially unchanged (133.43 → 134.03 kB gzip)** — the split buys attribution and vendor cacheability, not weight. A `motion` chunk was tried, measured a 23% regression because it eagerly preloaded framer-motion and defeated LazyMotion, and was reverted. Runtime figures are dev-server-only and are labelled as such. | P2  | ✅     |

#### DX-06 baseline — recorded 2026-08-25

| Metric | Before | After |
| --- | --- | --- |
| Screens of scroll @1280×720 (default state) | 2.61 | **1.43** |
| **Total initial JS (gzip)** — the number that matters | **133.43 kB** (one `index` chunk) | **134.03 kB** (`index` 54.15 + `react` 66.26 + `query` 13.62) |
| Entry chunk (gzip) | `index-BuyUhn0X.js` — 422.21 kB / gzip 133.43 kB | `index-Dl5CTcJU.js` — 176.04 kB / gzip 54.15 kB |
| `react` chunk (gzip) | n/a — unsplit | `react-BaMsm6ep.js` — 202.10 kB / gzip 66.26 kB |
| `query` chunk (gzip) | n/a — unsplit | `query-BkNuLMrR.js` — 44.14 kB / gzip 13.62 kB |
| framer-motion (gzip) | `motion-features-Cd2OYk5O.js` — 96.38 kB / gzip 31.12 kB, **lazy** (LazyMotion) | `motion-features-xvfeTb59.js` — 96.45 kB / gzip 31.15 kB, **still lazy** — unchanged, and deliberately so |
| Dashboard route chunk (gzip) | `OverviewPage-C_yRrXFX.js` — 11.84 kB / gzip 3.92 kB | `OverviewPage-*.js` — 14.65 kB / gzip 4.92 kB |
| Largest chunk (gzip) | `index-BuyUhn0X.js` — 422.21 kB / gzip 133.43 kB (same as entry) | `react-BaMsm6ep.js` — 202.10 kB / gzip 66.26 kB |
| Dashboard LCP | not captured (see note) | **2728 ms · dev server only** |
| Longest task | not captured (see note) | **377 ms · dev server only**, 7 long tasks |
| DOMContentLoaded | not captured (see note) | 1225 ms · dev server only |

**What the chunk split did and did not buy.** Initial JS is **essentially unchanged** — 133.43 →
134.03 kB gzip, +0.6 kB. `manualChunks` did not make the app lighter and was never going to: the
same modules load either way. What it bought is *attribution* (DX-06's actual ask) and cacheable
vendor chunks, so a React or TanStack Query upgrade no longer invalidates the whole entry bundle.
Read the entry chunk's 133.43 → 54.15 kB drop as redistribution, not saving.

**A `motion: ['framer-motion']` manualChunk was tried and reverted — do not reintroduce it.**
Naming framer-motion as a chunk entry makes Vite `modulepreload` it, dragging the whole library
into the eager initial graph and defeating the LazyMotion boundary in `MotionProvider` that §10.0(1)
describes. Measured while it was in place: initial JS **164.42 kB gzip, a 23% regression**, with
framer-motion eagerly preloaded. After reverting, `motion-features` is a lazy chunk again, absent
from `dist/index.html`'s preload list. `vite.config.ts` carries a comment saying so. The check, if
anyone changes chunking again, is `grep -oE '(src|href)="/assets/[^"]+\.js"' dist/index.html`.

Method: `ANALYZE=1 npm run build` for chunks, using vite's own reported gzip figures for both
columns so they are comparable; `main.scrollHeight / main.clientHeight`
at 1280×720 signed in as `doctor@medora.health` for density (measured and supplied outside
this session). "Before" chunk figures come from a build of `26bd832`, the commit immediately
preceding this tranche, built in a throwaway worktree (`git worktree add … 26bd832`, `npm install`,
`npm run build`), which predates `vite.config.ts`'s `manualChunks`/visualizer — so the whole app
ships as one `index` chunk and there is no split `motion` chunk to report.

**Read the runtime rows with care — they are dev-server figures, not production ones.** LCP,
longest task and DOMContentLoaded were captured on `vite dev` (unminified, unbundled ES modules
served per-file), so they run several times slower than the shipped build and **must not be
quoted as production performance**. They are recorded only as a like-for-like baseline: F2/F3 may
compare against them if and only if they measure the same way. No "before" runtime figure exists,
because the runtime numbers were not part of the pre-tranche audit.

A production-preview measurement was attempted at the time and could not be taken; the cause
recorded here was that the repo has no `.env`, so `VITE_ENABLE_MOCKS` would be undefined in a
production build and the mock auth backend would not run.

> **Correction (DP-04 auth seam, 2026-08-28) — that diagnosis was wrong, and the blocker does not
> exist.** `configs/env.ts` defaults `VITE_ENABLE_MOCKS` to `'true'`, so an undefined variable
> selects the mock backend rather than disabling it; and before the seam landed `AuthProvider`
> imported the mock directly, so the flag could not have gated sign-in either way. Tested rather
> than reasoned about: `npm run build` with **no `.env` present**, then `vite preview`, then a real
> browser sign-in as `doctor@medora.health` — reaches the dashboard (`Good evening, Dr. Amelia
> Chen`), zero page errors. The same test was then run against a build of `2a34b39`, the commit
> *before* this work, in a throwaway worktree: it also signs in. So the production bundle was
> always signable, and **no production performance measurement was ever blocked by this**. What
> the original attempt actually hit was not established; it is not reproducible now.
>
> `.env` is git-ignored (`.gitignore` line 6, `.env` and `.env.*` with `!.env.example`), so a
> committed `.env` was never available as a fix. The durable fix is the defaults in
> `configs/env.ts`, which is where it already was. `.env.example` has been corrected on a
> genuinely load-bearing point: the API base URL must carry the `/api/v1` prefix, because the
> refresh cookie is scoped `Path=/api/v1/auth` and a base URL of `/api` means the browser never
> sends it. Lighthouse and a production-preview run are therefore **unblocked** and remain
> unmeasured only because no tranche has claimed them.

None of this gates the tranche: DX-01's `screens ≤ 1.5` and the chunk-weight table above are what
F-11/DX-06 actually require, and both are measured from real builds.

Also verified live at 1280×720 signed in as `doctor@medora.health`:
with Analytics opened the page is 2.28 screens — expected and correct, since the ≤1.5 target
governs only the default (both-closed) state; and at 375px the page is 4.1 screens, which is
not in scope for the target since it is specified at 1280×720 only.

Further checks made against the running app rather than inferred from the diff: alerts render
outside both collapsible panels and above the fold; the page has exactly one `h1` and no
heading-level skips; opening Analytics and reloading keeps it open, stored per-user under
`medora.<userId>.dashboardSections`; a closed panel computes `visibility: hidden` and calling
`.focus()` on a control inside it leaves `document.activeElement` on `BODY`; and with the OS
`prefers-reduced-motion` **false** and the in-app toggle **on**, the panel's `transition-duration`
drops from `0.2s` to `0.00001s` — the app toggle beating the OS setting, which is DX-05's actual
requirement and the reason `Collapsible` animates in CSS rather than through Framer.

### 10.2 F2 and 10.3 F3 — retired

> **Retired.** Both tranches built the Anatomy feature (a 2D body map, then a 3D
> viewer and atlas). It was removed from the product on 2026-10-04 and its
> assets, build tooling and records on 2026-10-07. DX-07 … DX-21 are closed as
> not applicable. Two of their rules outlived the feature, because code
> elsewhere was written to them and still cites them:

- **DX-10 — the honesty rule.** Demo data carries a visible "Demo data" marker,
  and the line is drawn between *reference data* (rendered: indicator names,
  published reference ranges) and *patient data* (never invented). A badge beside
  a fabricated value does not satisfy it: the badge is a label a reader can miss,
  the number is one a doctor can quote. The marker is rendered from the data's own
  `source`, not hand-placed, so it cannot be deleted while the content stays fake
  and disappears by itself when the backend answers `'clinical'`.
- **DX-13 — one control per thing.** A text alternative never adds a second,
  parallel control for the same item: a second control per item is how a
  screen-reader user hears everything twice with no way to tell which copy does
  what.

### 10.4 F4 — Quick actions (rides Phase D)

| #     | Item                                                                                                                                                                                                                                                                                                    | Sev | Status |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------ |
| DX-22 | **Real quick actions (closes D-01).** ~~"New prescription" opens the D-17 authoring flow~~ ✅ and ~~"Message a patient" opens the messages list~~ ✅ **done (D-24)** — it now opens the compose picker through `routes.doctor.composeMessage()`, and the same contract gives the patient profile's "Send message" a patient-scoped thread. Every quick action on the dashboard now performs the thing it names or links to the flow that owns it; none of them is a bare navigation dressed as an action. | P1  | ✅     |
| DX-23 | **"Order lab" and "Add medical record" actions.** ✅ **DONE.** "Add medical record" was already linked to D-21's flow. "Order lab" had **nothing to link to** — D-10…D-14 built the review half and left ordering unbuilt, exactly as §0 said ("a doctor still cannot order a lab"), so the row's gate was satisfied without its dependency ever existing. The flow is now built **in the labs feature that owns it** and merely linked from the dashboard, per this row's own rule. Three steps (Patient → Tests → Details) rather than the prescription's four, because there is no safety screen to run: ordering is not signing. `assessOrder` is the only producer of the value `LabService.orderLabs` accepts, so an order with no patient, no test or no clinical indication cannot be constructed; the indication is **required** because the laboratory reads it to decide add-on and reflex testing. A test code the catalogue does not carry is **refused, not filtered** — silently dropping it would place an order for fewer tests than the doctor selected with nothing on screen saying so. **One `LabTest` per test, not one per request**, because the worklist, the review loop and the patient profile are all keyed on a single test and UX §2.6 reviews results one at a time. Orders arrive unresulted, so they cannot enter the review Inbox until the lab releases something. No fake success toast: the write is pessimistic and the toast follows the service. 12 tests. **This became the third consumer of the authoring stepper**, so §8.2.1's rule of three fired and it was promoted to `components/patterns/FlowStepper` — the pharmacy and record copies had already drifted on two behaviours, both settled there. Verified live end to end: dashboard → `/doctor/labs/new`, step 3 locked until a patient is chosen, Place disabled until an indication is written, and two orders landing in the worklist as **Ordered**. |

### 10.5 Definition of done for Phase F

Do not tick any of these on the strength of "it looks right in the browser." Each needs a named file, a verification method, and a result.

Ticked rows below name their evidence. The unticked ones are unticked because nobody has produced that evidence yet — **not** because the thing is known to be wrong. Several were closed by the §11 sweep, some by *fixing* what the sweep found rather than by confirming it.

- [x] Reduced motion honored for Framer and CSS · [x] Full keyboard operation · [ ] ~~Mobile layout reorders per DX-04~~ **moot since 2026-10-04** — the Overview now shows only the widgets the doctor chose, in the doctor's order, so there is no fixed band order left to verify · [x] Light and dark verified — reduced motion measured: no computed animation or transition over 100 ms on any of five routes under `prefers-reduced-motion: reduce`. Keyboard: every tab stop on 13 routes has an accessible name, a non-zero box and a focus indicator. Light/dark: computed contrast per text node on every route in both themes, zero failures. **DX-04's reorder is not verified** — the sweep proved no horizontal overflow, no occlusion behind the sticky tab bar and no undersized targets at 375 px, which is not the same as proving the *order* matches DX-04.
- [x] Every existing widget still works (*2026-10-23, §18.2: every catalogue widget switched on through "Customize dashboard" — doctor 12/12, admin 11/11 — each renders its content at 1440 and 375 px, no error state, no horizontal overflow, zero page or console errors*) · [x] Quick actions act or say where they go (*§18.2: all six clicked — New prescription → `/doctor/pharmacy/new`, New record → `/doctor/medical-records/new`, Order lab → `/doctor/labs/new`, Open AI Assistant → `/doctor/ai`, Message a patient → `/doctor/messages` with the New message picker open, Open schedule → `/doctor/appointments`; each lands on its flow's own `h1`*) · [x] No dead buttons (*§18.2 / Q-03: an AST scan of every `<Button>`/`<IconButton>`/`<button>` in `src/` finds none without an action, and a browser sweep clicked every enabled button in `<main>` on the admin routes and their tab states with no inert result*) · [x] No fake success states (*one more found and fixed in pass 3 — NEW-16, a toast inside `onSuccess` of a mutation that succeeded with nothing to export*) — **closed for toasts by §12's audit (2026-10-21):** every `variant: 'success' | 'info'` toast in `src/` was traced to the write it reports; 19 (16 success, 3 info) fired on the line after `mutate()` — before, and regardless of, the outcome — and one ("Restore complete — platform data verified") had no write at all. All fixed; three regression tests fail on the old code and pass on the new. ~~The other three boxes stay unticked: §11 clicked every enabled `<button>` in `<main>` on 21 routes and none crashed, which is evidence for them but not proof.~~ The other three were ticked by the 2026-10-23 audit on the evidence named in each (§18).
- [x] Bundle before/after recorded (*pass 3, Q-02 — and it is a +55 % regression, NEW-21*) · [x] Lighthouse run *(Reconciled 2026-10-25, §20.)* (*ticked to match §13.5 Q-01 `COMPLETE_VERIFIED`: authenticated routes scored desktop and mobile, §18.4. Historical note:* *partial: `/login` and four authenticated routes audited — accessibility and best practices 100; since DEC-012 `/login` has a performance score (desktop 100, mobile 84–86, §17); the authenticated routes' performance score has not been run yet — Q-01*) · [x] a11y audit run · [x] responsive matrix run — The a11y audit and responsive matrix are §11; pass 3 re-ran axe at WCAG 2.2 AA (F-14).
- [x] `typecheck` · `lint` · `test` · `build` all green · [x] This checklist updated with the measurements

### 10.6 Risks worth naming up front

- **The `strict` LazyMotion boundary.** Any motion code that reaches for `motion.*` instead of `m.*` will throw at runtime, not at build time.
- **Density vs. discoverability.** Tabs and collapses fix DX-01's scroll length but can hide clinically relevant information. Critical alerts must never live behind a closed disclosure. *(2026-10-04: the Overview has no disclosures left — it shows exactly the widgets the doctor chose, so DX-01's density target and its collapsed sections are retired with the fixed layout. The notifications widget renders in full wherever it is placed, and `OverviewPage.test.tsx` still asserts it is never inside a collapsible. A doctor may now leave it off the Overview; critical alerts do not depend on it, because the shell's notifications badge is on every page.)*
- **The dashboard sits on mocks.** F1 will look finished while showing invented numbers. That gap is DP-04's to close, and DX-10's labelling is what keeps the dashboard honest until it does.

---

## 11. The verification sweep — 2026-09-03

**What this is.** §8 says to re-run the audit by signing in and checking each
row against the running app. This is that, done by measuring the rendered
DOM rather than by looking at it — a browser driving every route and reading
computed styles, geometry and the accessibility tree back out, then driving
the *states* those routes reach when something is wrong.

The reason to write it down is §10.5's own rule: *"Do not tick any of these on
the strength of 'it looks right in the browser.'"* Nine defects were found this
way, and **every one of them was invisible to reading the code** — each is a
property of the composed page (a heading level relative to its ancestors, a
colour after alpha compositing, a box's rendered height) that no file states on
its own.

### 11.1 Method

Chromium via Playwright, signed in as `doctor@medora.health` and
`admin@medora.health` on the mock backend.

| Axis | Coverage |
| --- | --- |
| Routes | ~56 route-states: 13 doctor sections, 5 doctor detail routes, 3 authoring flows, 22 admin sections, 3 admin detail routes, 10 public/auth/error pages |
| Tabs | Every `role="tab"` on every route that has one, clicked and re-measured — two defects appear **only** on a non-default tab |
| Viewports | 1440×900 · 768×1024 · 375×812 |
| Themes | light · dark |
| Locales | en · ar · tr · fa · fr, including `dir="rtl"` for the two RTL ones |
| Motion | `prefers-reduced-motion: reduce` as well as the default |

Per route-state it checked: the heading outline (exactly one `h1`, opens at
`h1`, no skipped level); every interactive element's accessible name; document
horizontal overflow, with the offending boxes named; rendered target size
against WCAG 2.5.8, including the spacing exception measured centre-to-centre;
and **computed contrast per text node** against 1.4.3. Separately: a keyboard
walk of up to 70 tab stops per route checking each is named, visible and paints
a focus indicator; an interaction pass opening every enabled button in `<main>`
and checking the resulting dialog for an accessible name, `aria-modal`, focus
entry, Escape, and focus restoration; a scroll-to-end pass checking nothing is
stranded behind the sticky mobile tab bar.

Then a second pass over the states a loaded page does not have:

| Pass | What it drove |
| --- | --- |
| Tabs | every `role="tab"` on every route, clicked and re-measured |
| Bad deep links | ids that cannot resolve, on seven detail routes |
| Junk parameters | `?tab=garbage`, `?view=nonsense`, `?page=-1&pageSize=99999`, a missing `?draft=`, unknown settings and admin sections |
| Titles and announcements | `document.title` per route, and the live region after each client-side navigation |
| Tables | scroll geometry, keyboard reachability of the scroller, and `th[scope=row]` per row |
| Forms | empty and invalid submits, checking `aria-invalid`, `aria-describedby` resolution and live regions |
| Crash | a render error injected into a feature, checking what survives it |

### 11.2 What it found

Sixteen defects, in nine commits (rows for routes since removed from the
product are omitted below). All are fixed and pinned by tests, except
the two the second pass deliberately declined (§11.4, and the admin row
headers noted in `features/doctor/table-row-identity.test.tsx`).

The first pass swept **loaded pages**. A second pass swept the states a loaded
page does not have — every non-default tab, every id that does not resolve,
every junk query parameter, a client-side navigation, and an injected render
crash — and found seven more. That split is the reusable lesson: the defects
below the first line are all in states a route only reaches when something is
wrong or when the user moves, which is exactly where nobody looks.

| Class | Where | Was |
| --- | --- | --- |
| Heading outline | `/doctor/messages` | no `h1` at all — a full-height workspace with no `ContentHeader` band |
| | `/doctor/settings/:section` | **two** `h1` |
| | `/admin/departments`, `/admin/announcements`, `/admin/templates` | `h1 → h3` |
| | `/admin/patients/:id` (all three tabs) | `h1 → h3`; seven panels carried `headingAs="h3"` |
| | `/admin/doctors/:id?tab=documents` | `h1 → h3`, **and out of order** — three cards preceded the `h2` they looked like children of |
| Target size | `ChartLegend` | 20 px tall toggles, on the dashboard and every reports chart |
| Contrast | every input, textarea and select | placeholders at **3.23:1** light / **3.84:1** dark, in a token held at 3:1 for *non-text* |

The second pass, by state rather than by route:

| Class | Where | Was |
| --- | --- | --- |
| Heading outline | `/admin/patients/:id` (all three tabs) | `h1 → h3`; seven panels carried `headingAs="h3"` under a tab strip, which is buttons, not a heading |
| | `/admin/doctors/:id?tab=documents` | `h1 → h3`, **and out of order** — three cards preceded the `h2` they looked like children of |
| | the **not-found** state of seven detail routes | no `h1` at all: the heading is the record's name, and there is no record |
| Page title | all ten public pages | one shared title, "Medora" — WCAG 2.4.2, and two open tabs indistinguishable |
| Navigation | every client-side navigation | nothing announced it; `document.title` changing without a page load is not reliably read |
| Table | all five clinical worklists | the scroller hid 107–450 px of columns and could not be scrolled without a pointer; no row carried its patient as `<th scope="row">` |
| Resilience | any feature crash | caught, but it took the sidebar, navbar and breadcrumb with it |

Two of those are worth separating from the rest, because they are not "a page
got it wrong":

- **The placeholder colour was a design-system defect**, not a page defect: one
  class in `ui/internal/styles.ts` painted every field in the app. It surfaced
  through `Select` only, which renders its placeholder as a real element; the
  `<input>` and `<textarea>` cases have no text node to measure and were
  invisible to the sweep. That is why the fix carries a test that computes the
  ratios from `tokens.css` instead — where every case is visible at once.
- **Two of the fixes were capabilities the codebase already had.**
  `DataTable`'s `rowHeader` was built in wave 2c-a with two tests and then used
  by **nothing**, so five 12-to-14-column clinical worklists announced
  "Completed" with no way to hear whose result it was. And
  FRONTEND_ARCHITECTURE §2's "route-level boundaries catch feature errors
  first" described an intention rather than the code — there was one
  `errorElement`, on the outermost route. Neither was a missing idea; both were
  a written idea nobody had connected to the pages that needed it, which is a
  thing to go looking for rather than to wait for.

### 11.3 What it checked and dismissed

Recorded because "the checker was wrong" is the more common outcome and a
finding nobody re-checks becomes folklore:

- **`/admin/logs` "Clear filters" at 3.23:1** — a `disabled` button. WCAG 1.4.3
  exempts text in an inactive component. Not a defect.
- **18×18 row checkboxes, 18 px breadcrumb links** — under 24 px, but they pass
  WCAG 2.5.8's *spacing* exception. Measured rather than assumed: nearest other
  target 58.5 px and 50.5 px centre-to-centre, against the 24 px required.
- **Confirmation dialogs ignore Escape** — deliberate. `dismissible={false}`,
  DS §8.14: a confirmation requires an explicit choice, and Cancel is the
  keyboard escape route, so 2.1.2 holds. Same for the PHI justification prompt.
- **Content behind the mobile tab bar** — an artefact of scrolling one inner
  container. With every scroller at its end, nothing is occluded on any route.
- **Empty states** — a no-match query on five list pages renders a full-width
  row with a title, an explanation and a "Clear search & filters" action; the
  patients one quotes the query back. The first version of this check counted
  that row as data.

**Four checkers were wrong before they were right**, and each was wrong in a
way that would have produced confident nonsense. Contrast without alpha
compositing reported an active nav pill as 1.00:1. A dialog check that did not
filter to *visible* dialogs reported every page as having an unlabelled,
focus-less dialog it could not close — these are native `<dialog>` elements, and
a closed one is still in the DOM at 0×0. The touch-target check counted a
`sr-only` skip link as a 1×1 target. And the spacing-exception check measured a
scrolling card against *fixed and sticky chrome*, which overlays content rather
than sitting beside it: a doctor card read as 21 px from the bottom tab bar's
"Doctors" item, at one scroll position, for one viewport height. Excluding
positioned chrome, every undersized target in the app passes.

The pattern in all four is the same, and it is the argument for re-deriving a
finding before acting on it: a measurement that ignores how the browser
actually composites, positions or mounts things does not produce *no* answer,
it produces a confident wrong one.

**The production bundle was swept too**, not just the dev server: `vite
preview` over `dist/`, thirteen doctor routes in both themes, zero findings.
Minification and code-splitting change none of it.

### 11.4 One specified thing that could not be built as specified

> **Built, 2026-10-24 (DEC-015 C, §19.3).** The narrative below is the history of the reverted attempt; the shipped version does not use `background: inherit`.

DS §8.19's overflow row asks for *"horizontal scroll within the container with
sticky first column"*. The scroll is there; the sticky column is not, and an
attempt to add it was **reverted rather than shipped**. The reason is worth
recording, because it is not "nobody got to it".

Pinning a cell while its row scrolls needs the pinned cell to be opaque —
otherwise the columns sliding past show straight through it. The natural way to
get that is `background: inherit`, since every background on these tables lives
on the `<tr>`: zebra, hover, selection, and `getRowClassName`'s critical-result
tint. It works in light mode and **fails in dark**, because the two are not
built the same way:

| | light | dark |
| --- | --- | --- |
| `--color-error-subtle` | `#fcefee` | `rgba(240, 144, 138, 0.16)` |
| `--color-primary-subtle` | `#eef2f8` | `rgba(143, 180, 224, 0.16)` |

A pinned cell on a critical lab row in dark mode inherits 16% alpha and the
scrolling columns read straight through the patient's name. Rendered and
photographed before the revert: the first row of `/doctor/labs` showed
"Complete Blood Count (CBC)" superimposed on "Mona Adel".

Neither fix is a component prop:

- **Make the dark `*-subtle` tokens opaque.** They tint every subtle surface in
  the app, so this is a design decision about the whole dark ramp.
- **Express row tints as a layer the cell can inherit whole** (`background`
  shorthand plus a `background-image`, rather than a `background-color` class).
  That changes `getRowClassName`'s contract everywhere it is used.

So the row stays unbuilt with the blocker named. What the same problem's
*accessible* half needed was different and is done: the scroller is a named,
focusable region, and every worklist marks the patient as its `rowHeader`, so
a screen-reader user hears whose row they are in without any of this.

### 11.5 What it does not cover

- **Lighthouse.** Not run. §10.5's row stays open.
- **DX-04's mobile reorder.** The sweep proves the mobile layout does not
  overflow, occlude or under-size; it does not prove the section *order*.
- **Anything about what a write did.** A click sweep sees that a button opened
  a dialog, not that the mutation behind it was honest. §10.5's "no fake success
  states" stays open for that reason.
- **The ~2,045 untranslated feature-interior strings** (`docs/handoff/i18n.md`
  §6). The sweep confirms RTL *layout* holds in Arabic and Persian — no
  overflow at any width, `dir` and `lang` both set — which is a different claim
  from the interface being translated.

---

## 12. Completion pass — 2026-10-21

**Scope.** `frontend/` only, on `frontend` at `6b54b37`. Nothing in `backend/`, `patient-app/`, Prisma or deployment configuration was changed; every route connected below was read from its backend controller, DTO and service before a line of client code was written.

### 12.1 Routes connected

Each has an HTTP adapter with contract tests (method, path, body, response mapping, refusals), a mock twin that refuses what the API refuses, and UI tests. **None was exercised against a running API** — this container has no Medora database, the limit FE-10.V recorded (F39) — so "connected" here means *contract-tested*, as it does for FE-10's rows.

| Route | API | Surface | Notes |
| --- | --- | --- | --- |
| `POST /notifications/read-all` | §10 | bell "Mark all as read" | Replaces a per-id fan-out; optimistic with rollback |
| `POST /appointments/:id/propose-slots` | §5.8 | appointments row menu + drawer | Up to 3 alternatives; was dropped by the adapter |
| `GET /medications/:id/monograph` | §7.2 | prescription step 2 drawer | Live builds only (`capabilities.monographs`) |
| `POST /prescriptions/:id/notes` | §7.10 | prescription detail → Notes | Append-only, pessimistic |
| `GET /me/time-off`, `DELETE /me/time-off/:id` | §3.9 | appointments → "Upcoming time off" | Pessimistic cancel |

### 12.2 The fake-success audit

A script listed every `variant: 'success'` and `variant: 'info'` toast outside tests (123 success, plus info) and flagged any not preceded, within its call, by an `onSuccess`, an `await`, a `.then(` or an export. Each flag was then read by hand. **Doctor area: none** — every flag was an `ExportButton.onExported` (fires after `runExport`), a dialog's `onCreated`/`onEnabled` callback, or the privacy section's local file download (gated live). **Admin clinic sections: 19** (16 success, 3 info) — Announcements (×4: post, update, pin, archive), Departments, Holidays, Policies, Queue (×2), Resources, Rooms, Schedule, Shifts, Staff (×2), Templates (×2: duplicate, archive), Waiting Room (×2) — each `mutate(x); toast(…)` on consecutive lines. Each now toasts in `onSuccess`, reports a failure in `onError`, and a confirmation dialog stays open until the write answers (which also makes its existing `loading={…isPending}` reachable for the first time). **Platform settings → Recovery points**: "Restore" ended in *"Restore complete — Platform data verified against the … snapshot"* with no write behind it and a server restore that answers 501. The action is removed and the panel says restore is not available from this client.

`admin/sections/write-confirmation.test.tsx` pins the class: a failed delete reports the failure, claims nothing and keeps the dialog open; a delete that lands is announced only after it lands; calling the next patient announces nothing when the write fails. All three were run against the pre-fix `DepartmentsSection`/`QueueSection` and **fail** there.

### 12.3 Verification

- Gate: `typecheck` · `lint` (0 errors, the accepted `react-refresh` warnings — 19 measured on 2026-11-22, §43; the figure is a ceiling) · `test` · `build`, run on the final tree — figures in the session report.
- Browser: Chromium via Playwright against a **mock-mode production bundle** (`VITE_ENABLE_MOCKS=true npm run build:demo`, `vite preview`), signed in as `doctor@medora.health`: propose two times → toast; add a prescription note → rendered; monograph control absent on the demo formulary; bell 1 unread → 0. Zero page errors.
- `/login` targets at 375 px: see F-14.

### 12.4 Not done, and why

- ~~**Patient allergy writes**~~ — **done in the second pass** (§3.3): the mock directory store now owns allergies, so the chart and the safety screen read one list. **Vitals** — done too. Still not built: **alerts, history, emergency contacts** (no blocker beyond time; each needs the same mock-ownership check first) and **chart notes**, whose sign route does not check the author (§3.3).
- **Current medications in mock mode** are the same two-store shape the allergies were: the chart lists a generated regimen while the prescribing flow's interaction screen reads the pharmacy store (observed in the browser — Khaled Nassar's chart shows Lisinopril, Amlodipine and Metformin; the prescribing strip shows Glucophage only). Demo-only — live, both come from the server — but the interaction screen is the one that matters, so fixing it means the chart reading the pharmacy store, not the reverse.
- **Profile photo** (`PUT /me/profile/photo`) — the route answers 503 until file storage (M25) is configured; same rule as D-04b.
- **AI assistant** (`/ai/*`) — Phase 28 owns it and requires hospital isolation before wiring.
- **Doctor reports** (`GET /reports/analytics`) — serves one category (visit-type counts); the rest of §12 is M21. The page stays footnoted demo analytics.
- **Availability editor** (`GET/PUT /me/availability`) — built as one weekly grid by DEC-005 (§3.12); the realignment will move availability per location (API-W03), which is when the grid gains a location picker.
- **Locale-aware number/date formatting** — `docs/handoff/i18n.md` §7 records it as a display decision (Arabic-Indic vs Latin digits), not a mechanical change.


---

## 13. Master task register — 2026-10-21

**Why this section exists.** §1–§12 grew row by row over eleven passes, each with its own emoji vocabulary. This register is the one place every task is listed in the owner's status vocabulary, with evidence, what is left, and whether an owner answer is needed. The rows above stay the narrative; **where they disagree, this register is the newer reading** and the row above should be corrected. Re-verify, do not trust: each row names the test or the route it rests on.

**Statuses.** `COMPLETE_VERIFIED` — acceptance criteria met and verified by automated tests plus, for UI, a browser check (mock-mode bundle). `IMPLEMENTED_UNVERIFIED` — built and unit/component-tested, but the named verification has not been run. `PARTIAL` — part of the specified capability exists. `MOCK_ONLY` — works only against demo data; live builds say "Not connected yet". `BLOCKED_BACKEND` — needs an endpoint or a server rule that does not exist. `BLOCKED_DECISION` — needs an owner answer (§14). `NOT_STARTED`. `DEFERRED` — deliberately postponed, with the reason.

**One global caveat, G-1, applies to every row that talks to the API: no row has been run against a live API in this container** (FE-10 finding F39 — no Medora database). "Verified" for an HTTP adapter means contract-tested against captured or contract-derived bodies. Production readiness additionally needs a live run of every connected row.

### 13.1 Totals

| Status | Before (session start) | After (this pass) | After pass 3 (2026-10-22) | After pass 4 (2026-10-22) | After DEC-012 (2026-10-23) | After the audit (2026-10-23) | After pass 5 (2026-10-24) | Recount 2026-10-25 | After NEW-24 (2026-10-25) | After NEW-25 (2026-10-25) | After NEW-26/27 (2026-10-25) | After §3.11, NEW-28/29 (2026-10-25) | After the ID reconciliation (2026-10-25) | After NEW-30 (2026-10-25) | After the WEB/PA governance (2026-10-26) | After NEW-31 (2026-10-26) | After NEW-32/33 (2026-10-26) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| COMPLETE_VERIFIED | 26 | 25 | 43 | 45 | 46 | 49 | 54 | 55 | 56 | 57 | 58 | 60 | 57 | 58 | 58 | 59 | 61 |
| IMPLEMENTED_UNVERIFIED | 3 | 14 | 4 | 4 | 4 | 4 | 5 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 |
| PARTIAL | 4 | 4 | 5 | 4 | 4 | 2 | 1 | 2 | 2 | 2 | 3 | 4 | 3 | 3 | 3 | 3 | 3 |
| MOCK_ONLY | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 4 | 4 | 4 | 4 | 4 |
| BLOCKED_BACKEND | 11 | 11 | 11 | 11 | 11 | 10 | 10 | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 7 | 7 | 7 |
| BLOCKED_DECISION | 0 | 0 | 0 | 1 | 0 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| NOT_STARTED | 16 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| DEFERRED | 0 | 4 | 2 | 2 | 2 | 2 | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| **Rows** | **65** | **65** | **71** | **72** | **72** | **76** | **76** | **76** | **77** | **78** | **80** | **82** | **77** | **78** | **76** | **77** | **79** |

**Pass 3 (2026-10-22), counted by the same script** — the last status in each row's status cell; run against the previous revision of this file it reproduces the "After (this pass)" column exactly. Six rows are new: five defects pass 3 found and fixed (NEW-16…NEW-20, `COMPLETE_VERIFIED`) and one it found and did not start (NEW-21, the bundle regression). Of the 65 existing rows: 12 moved to `COMPLETE_VERIFIED` (NEW-01, 02, 03, 04a, 06, 07, 08, 09, 11, 12, 14, D-25, plus Q-02 from `DEFERRED`); Q-01 moved `DEFERRED` → `PARTIAL`. The four still `IMPLEMENTED_UNVERIFIED` are each held by something a browser run cannot supply: chart notes (DEC-001's release gate on BR-DEC-001), NEW-10 (the Cancel path is unreachable in the demo), ADM-02/03/05 and the roles matrix (F33 — a seeded admin TOTP for a live run).

**Pass 4 (2026-10-22), same script.** One row added: NEW-22 (`BLOCKED_DECISION`, DEC-012). NEW-10 `IMPLEMENTED_UNVERIFIED` → `COMPLETE_VERIFIED` (its Cancel path now browser-driven); NEW-21 `NOT_STARTED` → `COMPLETE_VERIFIED`; F-18 `PARTIAL` → `IMPLEMENTED_UNVERIFIED` (the toast host is built and tested, but its acceptance — each outcome announced once — needs a screen reader, which was not run). The four `IMPLEMENTED_UNVERIFIED` rows are now F-18 (NVDA/VoiceOver), chart notes (DEC-001's gate on BR-DEC-001), ADM-02/03/05 and the roles matrix (F33). Nothing is `NOT_STARTED`.

**DEC-012 (2026-10-23).** One row moved: NEW-22 `BLOCKED_DECISION` → `COMPLETE_VERIFIED` (unit test plus browser LCP and Lighthouse runs, §17). Q-01 stays `PARTIAL` — `/login` is now scored, the authenticated routes' performance score is not yet run. Nothing is `BLOCKED_DECISION`. Counted by hand from that one move, not by the script, which is not in the repository. *(2026-10-23: it is now — `scripts/count-checklist-register.mjs` — and confirms this column.)*

**The audit (2026-10-23)**, counted by `node scripts/count-checklist-register.mjs` (new; it reads the last status in each row's status cell of §13.2–§13.5 and reproduces the DEC-012 column exactly when run on the previous revision of this file: 72 rows, 46 · 4 · 4 · 5 · 11 · 0 · 0 · 2). Four rows added: ADM-09 members (`COMPLETE_VERIFIED`), ADM-09 custom roles and §11.4 (`BLOCKED_DECISION`, untracked until now — each was a "not done" sentence inside another row), and NEW-23 (`BLOCKED_DECISION`, found by Q-01). Moved: Q-01 and Q-03 `PARTIAL` → `COMPLETE_VERIFIED`; D-22 `BLOCKED_BACKEND` → `BLOCKED_DECISION` (DEC-016 now asks the product question it was waiting on). Nothing else changed status; §18 says what was re-verified and what was not.

**Pass 5 (2026-10-24)**, same script. No row added. Moved: F-09 `PARTIAL` → `COMPLETE_VERIFIED`; §11.4, D-22 and NEW-23 `BLOCKED_DECISION` → `COMPLETE_VERIFIED`; NEW-05 `DEFERRED` → `COMPLETE_VERIFIED`; ADM-09 custom roles `BLOCKED_DECISION` → `IMPLEMENTED_UNVERIFIED` (never live: F33). `COMPLETE_VERIFIED` 49 → 54. Evidence in §19.

**Recount (2026-10-25)**, same script, no row added and no status changed by this reconciliation. The BR-DEC follow-ups (PRs #102–#105, 2026-10-24) moved two rows without updating this table: §3.3 notes `IMPLEMENTED_UNVERIFIED` → `COMPLETE_VERIFIED` and NEW-04b `BLOCKED_BACKEND` → `PARTIAL`. The column records the result; §20 the method. **After NEW-24**, same script: one row added (NEW-24, `COMPLETE_VERIFIED`, §20.6); nothing else moved.

**After NEW-25 (2026-10-25)**, same script: one row added — NEW-25, `COMPLETE_VERIFIED`, split out of §3.1 pulse, which stays `MOCK_ONLY` for the practice-pulse statistics alone (§21).

**After NEW-26/27 (2026-10-25)**, same script: two rows added — NEW-26 (Settings → Privacy, `COMPLETE_VERIFIED`) and NEW-27 (Settings → Integrations, `PARTIAL`: connect waits on a server OAuth flow), both split out of §3.12's "still MOCK_ONLY live" remainder (§21.3).

**After §3.11, NEW-28/29 (2026-10-25)**, same script: §3.11 `DEFERRED` → `COMPLETE_VERIFIED` (analytics over RM M21); two rows added — NEW-28 (saved and scheduled reports, `PARTIAL`: no rename or favourite route, delivery blocked server-side) and NEW-29 (two pre-existing schedule defects, `COMPLETE_VERIFIED`). Nothing is `DEFERRED` now (§21.4).

**After the ID reconciliation (2026-10-25)**, same script: NEW-25…NEW-29 each duplicated a row that already existed, so all five are retired and their evidence moved, unchanged, onto those rows (§8, *No duplicate IDs*). §3.1 pulse `MOCK_ONLY` → `PARTIAL` (three of its four widgets connected); §3.12 stays `COMPLETE_VERIFIED` (its scope is its Feature cell; privacy and integrations always lived in its Remaining cell, which now holds only integration Connect); §3.11 stays `COMPLETE_VERIFIED`, absorbing saved and scheduled reports and the two defect fixes, with the server's missing routes and delivery in its Remaining cell. 82 → 77 rows; `COMPLETE_VERIFIED` 60 → 57 — fewer rows counted, no task undone. Against the sprint's start (77 rows, 56 complete): §3.1 pulse and §3.11 moved forward; nothing moved back.

**After NEW-30 (2026-10-25)**, same script: one row added — NEW-30, the Overview's Row-0 critical alerts banner (UX §2.1, RM M27.3), `COMPLETE_VERIFIED`. No existing row covered it: §3.1 widgets is the KPIs, today and the decision list, §3.1 pulse the analytics widgets, and the banner is neither a widget nor optional (§8 rule 3). Nothing else moved (§22).

**After the WEB/PA governance (2026-10-26)**, same script: two rows leave the count and no status changed. ORG-01 (§13.2) and ORG-02/ORG-03 (§13.4) track the same work as WEB-1/WEB-2 and WEB-14/WEB-15 in [`CLIENTS_CHECKLIST.md`](../docs/multi-hospital/CLIENTS_CHECKLIST.md), the status register for multi-hospital tasks, so they move to §13.6 with their cells unchanged and point there (§8 rule 9). `BLOCKED_BACKEND` 9 → 7, rows 78 → 76; the two are still open, now counted once, as WEB rows. Fewer rows counted, no task done.

**After NEW-31 (2026-10-26)**, same script: one row added — NEW-31, the query cache that outlived the session, `COMPLETE_VERIFIED`. No existing row covered it: F-07 is the transport and its 401 refresh, A-02…A-11 are the auth pages and the idle lock, and WEB-4 is the hospital-keyed half. No status changed. This pass's multi-hospital work (WEB-2 and WEB-8 done; WEB-4 and WEB-5 partial; PA-1 verified) is registered only in `CLIENTS_CHECKLIST.md` (§23).

**After NEW-32/33 (2026-10-26)**, same script: two rows added, both `COMPLETE_VERIFIED`: NEW-32 (clinical values reordered on RTL pages) and NEW-33 (phone numbers truncated in the patient summary cards). No existing row covered either. F-19 is the translation of English strings and stays `PARTIAL`; §11's five-locale sweep did not record it. No status changed (§24).

**Pass 8 (2026-10-27)**, same script: no row added and no count changed. NEW-32 reopened (`PARTIAL`) and closed again (`COMPLETE_VERIFIED`) within the pass, because its pass-7 acceptance claimed more screens than pass 7 had checked (§25).

**Retired IDs — never reuse.** Each resolves to the canonical row that holds its evidence; commit messages and PR titles that cite it stay valid through this list. NEW-25 → §3.1 pulse (PR #108). NEW-26, NEW-27 → §3.12 (PR #109). NEW-28, NEW-29 → §3.11 (PR #111). NEW-30 is allocated (§22). NEW-31 is allocated (§23); NEW-32 and NEW-33 (§24). NEW-34, NEW-35 and NEW-36 are allocated (§36). NEW-37, NEW-38 and NEW-39 are allocated (§38); NEW-40 (§39); NEW-41 and NEW-42 (§40); NEW-43…NEW-46 (§41). The next free ID is **NEW-37**.

Counted from the rows of §13.2–§13.5 by script (recounted after DEC-006a, when the previous total, MOCK_ONLY 4, proved an undercount by one row; 65 rows since DEC-003 split NEW-04 into NEW-04a/b); a grouped row (e.g. "F-01…F-17") counts once, and the fourteen multi-hospital rows (§13.6) are not included — since 2026-10-26 §13.6 holds no status at all; multi-hospital tasks are counted as WEB rows in `docs/multi-hospital/CLIENTS_CHECKLIST.md`. "Before" is the session-start state read in this vocabulary — gaps this pass discovered (NEW-xx) count as NOT_STARTED, and a row that was marked done while hiding a defect (A-01, D-07, NEW-09) counts by its marking.

### 13.2 Foundations, auth, shell

| ID | Feature | Before → After | Evidence | Remaining / dependency | Acceptance | Input? |
| --- | --- | --- | --- | --- | --- | --- |
| F-01…F-06, F-08, F-10, F-11, F-13, F-15…F-17 | Tooling, tokens, query layer, router, env, lint, tests, CI, bundle analysis, error pages, skip link, titles, headings | COMPLETE_VERIFIED → COMPLETE_VERIFIED | §1 rows; CI `ci.yml`; gate §13.9 | — | Per §1 row | No |
| F-07 | ApiClient transport, 401 refresh | COMPLETE_VERIFIED → COMPLETE_VERIFIED | `client.test.ts` (15), `http.test.ts` (14); §1's "every call resolves mock" is **stale** — 34 features are live (FE-10) | G-1 | Single-flight refresh, normalized errors | No |
| F-09 | Component workbench | PARTIAL → PARTIAL → **COMPLETE_VERIFIED** (pass 5, 2026-10-24) | **Pass 5:** 51 story files (45 new), 190 stories — every public component in `ui`, `feedback`, `patterns`, `patterns/dashboard`, `charts` and `layout` has one; only `ui/internal/` (Field, MenuList, InlineSpinner) has none of its own and renders through Input, Dropdown/ContextMenu and Button. Every story rendered in light and dark with axe: 380 renders, 0 page errors, 0 violations beyond the three page-level rules an isolated component cannot meet. The sweep found three real defects, fixed with tests (§19.2). `build-storybook` had been failing since `50d9807`; fixed in the workbench config only. CI unchanged — DEC-014's CI half is the owner's (§19.4). *Before:* 15 stories / ~45 components. **Recounted 2026-10-23:** 6 story files covering 9 of 59 Tier 1–2 components (Alert, Badge, Button, Input, StatusBadge; EmptyState, ErrorState, Skeleton, Spinner) (`ui` 30, `feedback` 7, `patterns` 17 + `patterns/dashboard` 5) | Whether Storybook's axe runs in CI, advisory or blocking — **DEC-014**, CI half | §8.2 story per Tier 1–2 component | CI policy only |
| F-12 | Feature flags | COMPLETE_VERIFIED → COMPLETE_VERIFIED | §1 F-12 | — | — | No |
| §11.4 | Sticky first column on wide tables (DS §8.19) | — → **BLOCKED_DECISION** (audit, 2026-10-23) → **COMPLETE_VERIFIED** (pass 5, DEC-015 C) | **Pass 5:** pinned only while the table overflows (the first column, plus the selection column when selectable); the cell is `bg-surface` with the row's tint as an image of `--row-bg`, which every row state sets (zebra, hover, selected, focus, `getRowClassName`) — DEC-015's option C. `DataTable.test.tsx` +6, `lab-row-tint.test.ts` (2). Browser: the pinned cell's pixels unchanged across a horizontal scroll in light/dark × en/ar × 1024/768 on doctor and admin tables; dark critical-row colour within 1/255 of the unpinned cells; the selection bar kept. *Before:* recorded only in §11.4's narrative until now: built, reverted because dark-mode row tints are 16 % alpha and the pinned cell shows the scrolling columns through it. Scroll, a focusable named scroller and `rowHeader` are done | — (a new row tint must set `--row-bg` too; `lab-row-tint.ts` shows how) | Pinned cell opaque in both themes, every row tint | No |
| F-14 | A11y (axe AA, 19 routes) + 44 px touch targets | COMPLETE_VERIFIED → COMPLETE_VERIFIED (pass 3: re-measured at WCAG **2.2** AA — axe 4.14, 27 routes over five roles at 1440 and 375 px: 0 `target-size`, 0 critical after NEW-18/19/20; the only remaining hit is the experimental `label-content-name-mismatch` on the avatar menu, checked and dismissed in §15.3) | DEC-008 B: `touch-targets.test.tsx` (16), `styles/touch-targets.test.ts` (4); browser audit on the mock-mode demo bundle with touch emulation — 505 controls at 375 px, 734 at 1024 px, 0 below 44 × 44, 0 intercepted; desktop computed styles unchanged; axe AA clean on 10 routes × 2 layouts | Physical-device and WebKit (iOS Safari) check not run | 44 × 44 on a coarse pointer, no overlapping hit areas, desktop unchanged | No |
| F-18 | Live regions for async results | PARTIAL → PARTIAL → **IMPLEMENTED_UNVERIFIED** (pass 4) | SafetyScreen region (D-17). **Toast host rebuilt (pass 4):** two persistent, visually hidden announcers — `aria-live="polite"` for success/info/warning, `"assertive"` for errors (what the old per-toast `role="alert"` meant) — exist from mount and receive each toast's title and description as a node of its own (`aria-relevant="additions"`), so quick successive toasts are all read and a repeated message is read again; nodes expire silently after 7 s. The visual stack is no longer a live region, so nothing is nested, the dismiss and action labels are never read, and dismissal is silent. Dismiss: translated name (`shell.dismissNotification`, five locales), described by its toast's title, Alert's 44 px touch target (DEC-008). `app/providers/ToastProvider.test.tsx` (14; 11 fail on the old host); the test setup excludes the announcer from text queries (it repeats each toast by design — measured: 12 `findByText` calls in 7 files became ambiguous without it). Browser: one polite announcement for a success, none assertive, no nested live region, dismiss operable by Enter — 1440 and 375 px; axe with a toast on screen: 0 violations at both widths | **Screen-reader pass outstanding:** NVDA and VoiceOver not run; jsdom and axe check the ARIA structure, not what is spoken | Each async outcome announced once | No |
| F-19 | i18n / RTL | PARTIAL → PARTIAL | 5 locales, RTL layout verified; **DEC-009 done** — one formatting module (`i18n/format.ts`), Latin digits in all five languages, words and order localised; `i18n/format.test.ts` (24), `app/LocaleRemount.test.tsx` (1); browser scan: 0 native digits on 83 page states across 5 languages; ~2,045 feature strings still English | Clinical translator (not machine translation); calendar Gregorian (DEC-010) and separators `1 234.5` (DEC-011) settled | `docs/handoff/i18n.md` §6–7 | No |
| A-01 | Login | COMPLETE_VERIFIED (defective: F34) → COMPLETE_VERIFIED (pass 13: a session the server ended is named, §30.3); pass 14: on the shared error map, §31.1; **pass 17: two defects in the `returnTo` guard, §34.2** | `LoginPage.test.tsx` (5), fails on old page; **pass 13:** `LoginPage.test.tsx` +3, `AuthProvider.test.tsx` +3; **pass 14:** the login suite unchanged and passing; **pass 17:** `resolveDestination.test.tsx` +2 (backslash target, undecodable value), `useInternalLinkNavigation.test.tsx` (4, new) — 4 of the 6 watched failing on the old code | Native review of 4 new locale strings | Each refusal named | No |
| A-02…A-07, A-09, A-11 | Signup, reset, verify, OTP, lock, i18n, idle lock | COMPLETE_VERIFIED → COMPLETE_VERIFIED (pass 9, 2026-10-30: a throttled request is named, §26; pass 11: the lock screen names why an unlock failed, and a failed resend is not called a dead link, §28); pass 13: one shared error mapping, §30.2; pass 14: the lock screen tells an unenrolled 2FA account to contact its administrator, §31.1 | §2 rows, `AuthProvider.test.tsx`; **pass 9:** `rate-limited.test.tsx` (9; 8 fail on the old pages); **pass 11:** `LockScreenPage.test.tsx` (6; 5 fail on the old page), `rate-limited.test.tsx` +2 (1 fails on the old page); **pass 13:** `error-message.test.ts` (4), with the page suites as the regression check; **pass 14:** `LockScreenPage.test.tsx` (case changed for backend `cd123ff`) | Native review of `common.rateLimited` in 4 locales | Each refusal named | No |
| A-08 | Role guards | COMPLETE_VERIFIED → COMPLETE_VERIFIED | `guards.test.tsx` | Hospital-admin / platform-admin split — WEB-16 in `docs/multi-hospital/CLIENTS_CHECKLIST.md` (was ORG-01/03) | — | No |
| A-12a | Lock-screen re-authentication | BLOCKED_BACKEND → BLOCKED_BACKEND → **IMPLEMENTED_UNVERIFIED** (pass 21, 2026-11-06, §38.2) → **COMPLETE_VERIFIED** (pass 23, 2026-11-07: live run against a local API built from `origin/backend` `bbb5377`, Chromium, §40) | **Pass 21:** unlock is `POST /me/password/verify` (backend `4c6458d9`, `backend` only): 204 resumes the held session, no second session minted, a two-factor account unlocks in place; 401 `invalid_credentials` spends no refresh (M39.4); the lockout 429 — which revokes the session server-side — drops the token and the page replaces the password field with *Sign in again* (`ReauthLockoutError`); a 404 (an API built from `main`) falls back to the old `POST /auth/login` spend. `auth.test.ts` +5, `LockScreenPage.test.tsx` +2 | **Pass 23:** verified live — idle lock, a wrong password named with no `/auth/*` call, unlock through `/me/password/verify`, and a two-factor account unlocking in place (§40.2). Still open: Live run against a `backend`-built API (G-1); the `/auth/login` fallback goes when `backend` reaches `main`; native review of 2 new strings in 4 locales | Unlock verifies against server | No |
| D-26 | Global search | COMPLETE_VERIFIED → COMPLETE_VERIFIED | 15 tests | API-W14 for hospital scope — WEB-3 in `docs/multi-hospital/CLIENTS_CHECKLIST.md` | — | No |
| D-27, D-27b, D-28 | Clinic ops moved; My Clinic board; naming | COMPLETE_VERIFIED → MOCK_ONLY (D-27b) | My Clinic is "Not connected yet" live | API-W05 | — | No |
| NEW-17 | Staff sidebar captioned with a physician's credentials | — → **COMPLETE_VERIFIED** (pass 3) | Found driving NEW-14: mock mode seeds the practitioner profile for every account and `AppSidebar` read it for all roles, so reception, lab, pharmacy and admin showed "MD, FACP". The footer now takes the avatar menu's rule (name, photo and credentials only for a doctor; otherwise the account name and role) and the role's avatar ring. `layouts/Sidebar/AppSidebar.test.tsx` (4) — 3 fail on the pre-fix footer; browser: no "MD, FACP" on any staff page. Live builds were already right (staff fetch no profile) | — | A non-practitioner never shows practitioner credentials | No |
| NEW-18 | In-field action button below WCAG 2.5.8 | — → **COMPLETE_VERIFIED** (pass 3) | Lighthouse `target-size` on `/login`: "Show password" was 20 × 20 px on a fine pointer, and 2.5.8's spacing exception cannot apply — its 24 px circle lands on the field it sits in (F-14's 2026-10-21 measurement checked only neighbouring controls). `FIELD_ACTION_CLASSES` is now 24 × 24 with the inset moved 12 → 10 px so the icon does not move; DEC-008's touch sizing unchanged. `touch-targets.test.tsx` (+1); Lighthouse a11y 96 → 100; axe `target-size` 0 on 27 routes | — | ≥ 24 × 24 px on every pointer | No |
| NEW-19 | `aria-required` on a bare fieldset | — → **COMPLETE_VERIFIED** (pass 3) | axe `aria-allowed-attr` (critical) on the prescribing flow's patient step: `RadioGroup` put `aria-required`/`aria-invalid` on a `fieldset` (role `group`, where ARIA allows neither). It is now `role="radiogroup"`, which HTML-ARIA permits on a fieldset and which allows both; the legend still names it. `Radio.test.tsx` (4, new); three `NewPrescriptionPage.test.tsx` queries moved from `group` to `radiogroup`; axe re-run clean | — | Required/invalid stated on a role that allows them | No |
| NEW-20 | Heatmap not keyboard-scrollable | — → **COMPLETE_VERIFIED** (pass 3) | axe `scrollable-region-focusable` at 375 px on `/doctor/reports`: the activity heatmap scrolls sideways below 420 px and could not take focus (WCAG 2.1.1). DataTable's measured rule applied — a named, focusable region only while it overflows; the figure stays the inner `img`. `charts/Heatmap.test.tsx` (2, new); axe re-run clean at 375 px | — | A scrolling region is reachable by keyboard; no idle tab stop on wide screens | No |
| NEW-31 | Query cache outlived the session | — → **COMPLETE_VERIFIED** (pass 6, 2026-10-26) | Found auditing `CLIENTS_CHECKLIST.md` WEB-4. FRONTEND_ARCHITECTURE §6.3 and §12.5 require a full `queryClient.clear()` on logout and on lock. `QueryProvider` and the provider root both say Auth does it, and nothing did. A second account signing in on the same tab inside `staleTime` was served the first account's cached data without a request. `AuthProvider` now clears the cache on logout, on a refused refresh (also how an ended employment reaches the tab, OD-12) and on lock. `AuthProvider.test.tsx` +4 over a real `QueryClient`; three of them fail on the old provider. Browser: §23.2 | The hospital id in the keys is WEB-4's, in `CLIENTS_CHECKLIST.md`, not this row's | Nothing cached survives the session | No |
| NEW-32 | Clinical values reordered on RTL pages | — → COMPLETE_VERIFIED (pass 7, 2026-10-26) → PARTIAL (pass 8: surfaces pass 7 never reached) → **COMPLETE_VERIFIED** (pass 8, 2026-10-27) | **Pass 8:** pass 7's acceptance was overstated. It came from screenshots of five screens, and a DOM scan of every route in Arabic found the same defect elsewhere. Worst were the lab results: "0.5 10³/µL" read "µL/0.510³", and reference ranges printed backwards ("17.0g/dL –12.0" for 12.0–17.0 g/dL). Also: prescription strength, dosage and duration; lab turnaround and specimen volume; ages in the summary cards; the `61 · M` cells; the picker lines; durations, waits and file sizes; and `65+`. All are pinned now, with `isolateLtr` (`src/i18n/bidi.ts`) wherever the value is a string prop, and `Select`'s typeahead ignores the isolate controls. The scan, re-run, finds no unpinned value; what remains is F-19's English phrases. Tests: lab `latin-values` 2, appointments `latin-values` 2, pharmacy +2, `Select` +1 and `bidi` 2. All but `bidi` fail on the old code (§25). **Pass 7:** Found by pass 7's Arabic screenshots. A Latin-only value that starts with a digit or a sign, or ends in one, is reordered by the bidi algorithm on an RTL page. Before: blood group `O+` read "+O" and `O-` read "-O"; `+20 100 214 3387` read "3387 214 100 20+"; doses read "mg 250", durations "days 7", and vitals "bpm 68", "min/ 13", "C° 36.8". Each standalone value is now an inline `dir="ltr"` isolate, the rule `docs/handoff/i18n.md` §5 already set for codes. That covers the patients table and cards, the chart sidebar, Overview vitals, the medications tab, the record, lab and prescription summary cards, record vitals, the prescriptions table, the appointment drawer, and admin doctor and staff phones. A value inside a Latin-only sentence is pinned with the whole sentence: the identity line and the drawer's age/gender/phone line. Isolating the value alone carried `O+` to the far end of the line, and a dose after a drug name was already in order, so it is left unpinned (§24.2). Tests: `patients/components/latin-values.test.tsx` 2, `pharmacy/components/latin-values.test.tsx` 2, `OverviewTab.test.tsx` +1 and `PatientIdentityHeader.test.tsx` 1, each failing on the old code. Browser: §24.2 | The ~2,045 English strings still reorder at their trailing numbers until translated (F-19) — the documented, accepted case | Each value reads as written in all five languages | No |
| NEW-34 | Password strength meter English-only in Settings | — → **COMPLETE_VERIFIED** (pass 19, 2026-11-03) | Found in pass 19's coverage run, where `components/patterns/PasswordStrengthMeter.tsx` had no test. Settings → Account rendered that shared meter, which wrote "Password strength: Fair" in English. The auth pages rendered a private copy in `features/auth/components/` that read `strength.label` and `strength.0…4` from the catalogue. Both used the same scorer (`utils/password.ts`), so only the language differed. The shared meter now reads the same keys, which all five catalogues already carried. The auth barrel re-exports it by its direct path (not the patterns barrel, NEW-21), and the copy is removed. Tests: `PasswordStrengthMeter.test.tsx` (4; the Arabic case fails on the old meter, checked), `features/auth/components/strength-meter.test.ts` (1). Browser (mock-mode dev server, Chromium, Arabic, 1440 and 375 px): Settings → Account reads "قوة كلمة المرور: ضعيفة جدًا" with no English "Password strength" left, `dir=rtl`, no horizontal overflow; the sign-up meter is unchanged; 0 page errors | The rest of Settings is still English under Arabic. That is F-19's remainder, not this row's | The meter speaks the reader's language on every page that shows it | No |
| NEW-36 | Avatar menu theme switch: a sun/moon pill | — → **COMPLETE_VERIFIED** (pass 19, 2026-11-03) | Answers §36.4's owner question: the owner asked for a pill and specified it. **Design:** a rounded track (`surface-sunken`) with the sun on the left (light) and the moon on the right (dark). A circular knob indicator (`control-knob`, as `Switch` uses) slides behind the active icon (`transform`, 200 ms, collapsed by the global reduced-motion rules). The active sun is the `warning` amber (about 6:1 on the knob, where a bright yellow would fail WCAG 1.4.11), the active moon is `primary`, and the inactive icon is tertiary grey. Targets are 32 px with a mouse and 44 px on touch (DEC-008). **Semantics:** a `group` named by its visible *Theme* label, holding two `menuitemradio` with `aria-checked`. That is WAI-ARIA's pattern for exclusive choices inside `role="menu"`, where a `radiogroup` or `switch` is not a valid child. The items are named *Light theme* / *Dark theme* in the five catalogues already present, the icons are `aria-hidden`, and the indicator is the non-colour cue. Up/Down reach the pill in the menu's roving focus, Left/Right move within it, and Enter/Space choose. Choosing keeps the menu open. The track is `dir="ltr"`, so the sun stays left in Arabic and Farsi. Synchronised with `ThemeProvider` and its persistence; checked follows the *resolved* theme. **Shared change:** `MenuList` gains a `segmented` entry; ordinary items behave as before. **Tests:** `AvatarMenu.test.tsx` (9, replacing NEW-35's four toggle tests): light start, dark start, light → dark, dark → light, indicator position (`data-position` and `translateX`), ARIA, persistence across a remount, `system` preference, keyboard. `Dropdown.test.tsx` (4, new). Story `UI/Dropdown/Segmented` (DEC-014). **Browser** (mock-mode dev server, Chromium; 1440 px, 375 px with touch, Arabic 1440 px): checked state and indicator centred on the active icon in both themes; sun left of moon in all three; choice stored as `medora.theme` and kept across a reload; keyboard Down/Left/Space with a visible focus ring; the menu inside the viewport and no horizontal scroll; **axe** (WCAG 2.0 A/AA–2.2 AA) on the open menu: 0 violations in light, dark and Arabic; 0 page errors | The auth pages' `AuthThemeToggle` (one cycling icon button, light → dark → system) is a different control and was not in scope. The *System* choice is no longer offered from the avatar menu, as since PRs #160/#161; Settings → Appearance still offers it | Clicking the sun sets light, clicking the moon sets dark; a screen reader hears which is current | No |
| NEW-37 | Sign in with a recovery code (owner decision R1) | — → **IMPLEMENTED_UNVERIFIED** (pass 21, 2026-11-06, §38.3) → **COMPLETE_VERIFIED** (pass 23, 2026-11-07: live run against a local API built from `origin/backend` `bbb5377`, Chromium, §40) | The two-factor step offers *Use a recovery code instead*: `POST /auth/otp/recovery { otpToken, recoveryCode }` (backend `8992a208`, `backend` only), the same challenge and attempt budget as `/auth/otp/verify`. Port `AuthService.redeemRecoveryCode`, both adapters, `AuthProvider.redeemRecoveryCode`; the code is sent trimmed and otherwise as typed (the server normalises). A wrong code is named as wrong, a throttle as a throttle, a 404 as a failure to verify. 7 new strings in 5 locales. `VerifyOtpPage.test.tsx` (5, new), `auth.test.ts` +3 | **Pass 23:** verified live — a replaced code refused, a new code signing in case-insensitively, the count dropping 10 → 9, the holder mailed (R3) (§40.2). Still open: Live run (G-1); native review of 7 strings in 4 locales; the patient app's sign-in is a separate tree and not touched; the process for a lost authenticator **and** lost codes is the owner's (clarification C-1) | A pending sign-in completes with one recovery code | No |
| NEW-38 | Recovery codes left, and replacing the authenticator (owner decisions R2, Q7 / R4) | — → **IMPLEMENTED_UNVERIFIED** (pass 21, 2026-11-06, §38.4) → **COMPLETE_VERIFIED** (pass 23, 2026-11-07: live run against a local API built from `origin/backend` `bbb5377`, Chromium, §40) | Settings → Security reads `GET /me/2fa` → `recoveryCodesRemaining` (`backend` only; `null` on a 404 or a failed read, never 0) and, for an enrolled account on a server that serves it, shows the count (warning ≤ 2, error at 0) and *Replace authenticator app*: `POST /me/2fa/reenroll` (password + a code from the **current** app) → new key → `POST /me/2fa/reenroll/confirm` (a code from the **new** app) → the new recovery codes, once. Nothing changes until the confirm; an expired enrolment (`token_invalid`) restarts from step 1; the lockout 429 (session revoked) says so and signs out. `/me/2fa/setup`'s new 409 for an enrolled account surfaces through the existing conflict mapping. `http-settings-service.test.ts` +5, `TwoFactorDialogs.test.tsx` +5, `service.test.ts` (port list) | **Pass 23:** verified live in the doctor workspace — a real enrolment (count 10), re-enrolment with password + current TOTP then a new TOTP, ten new codes shown once (§40.2); the administrator and reception workspaces by `security-recovery.test.tsx`. Still open: Live run (G-1); the admin's own settings screen (`AdminProfileSection`) is a separate surface and not touched; **pass 22 (§39.2):** the Security rows now have rendering tests of their own, over the HTTP adapter, in the doctor, administrator and reception workspaces (`security-recovery.test.tsx`, 13) | The count is the server's, and the factor is replaced only with the current one proved | No |
| NEW-39 | `Idempotency-Key` on prescribing (RM M39.3, ADR-014) | — → **IMPLEMENTED_UNVERIFIED** (pass 21, 2026-11-06, §38.5) → **COMPLETE_VERIFIED** (pass 24, 2026-11-07, §41.2) | `RequestOptions.idempotencyKey` → `Idempotency-Key` header, kept on the 401 → refresh → replay. The prescribing flow holds one key per intent (create / renew, then sign) for as long as it holds the server draft, so a retry after a lost response sends the same key and a `backend`-built API replays instead of creating a second draft or signing twice; an API without the interceptor ignores the header. `client.test.ts` +2, `http-prescription-service.test.ts` +2 | **Pass 24:** verified live — API: same key replays (`Idempotency-Replayed: true`), no duplicate, a new key independent, 422 `idempotency_key_reused` / malformed key, a replayed sign returns the signed prescription where a keyless retry meets 409 (9/9); UI: the first *Sign & issue* executed with its answer dropped, the retry replayed, one prescription, both attempts on one key, the draft created once (7/7). Not keyed (by design): appointment create, lab orders. Before: Live replay against a `backend`-built API (G-1). **Not keyed, on purpose:** appointment create and lab orders hold no client-side intent identity, and a fresh key per call protects nothing; identical lab orders are clinically legitimate, so a body-derived key would wrongly merge them. Conversation create and message send stay unwired (DP-02). `X-Client-Type` is the patient app's (M41.1): the web client is the default and sends none | A retried write replays, never duplicates | No |
| NEW-40 | CSV export evaluates formula-leading text (CSV injection) | — → **IMPLEMENTED_UNVERIFIED** (pass 22, 2026-11-06, §39.4; PR #189) → **COMPLETE_VERIFIED** (pass 24, 2026-11-07, §41.3) | Found comparing the client exports with the server's `common/http/csv-export.ts`. `utils/export.ts` quoted a comma, quote or newline but let a cell starting with `=`, `+`, `-`, `@`, tab or CR reach a spreadsheet as a formula — free text (a name, a chief complaint, an indication) opened by a clinician on a PHI workstation. Such text is now prefixed with `'`, the server's rule; numbers stay numeric; a CR is quoted; headers too. `utils/export.test.ts` (11, new; 9 fail on the old serialiser) | **Pass 24:** verified on a real export — patients named `=HYPERLINK(…)`, `+SUM(1;2)`, `-2+3`, `@SUM(1;1)` and one with an embedded CR, exported through the Patients page and opened in LibreOffice with formula evaluation on: 0 formulas, the CR value one record (the unguarded control: 1 formula). Tab is covered by `export.test.ts` only (a leading tab cannot be stored in these fields). Before: Not opened in a real spreadsheet; the `.xls` (HTML) export is unchanged and not checked for the same behaviour | A cell an export writes is never evaluated | No |
| NEW-41 | Server-supplied URLs followed with any scheme | — → **COMPLETE_VERIFIED** (pass 23, 2026-11-07, §40.4; PR #192) | The signed document URL is followed by an anchor click in this origin and `otpauthUrl` was an `<a href>` (React 18 renders `javascript:`). Documents now follow only `https:` (`http:` in a development build, for MinIO); the enrolment link renders only for `otpauth://` (`utils/otpauth.ts`). `http-documents-service.test.ts` +7, `otpauth.test.ts` (9), `TwoFactorDialogs.test.tsx` +2; live: the MinIO `http:` URL followed in the development build (§40.3) | A production build against an `https:` store not run | No server-supplied link runs script or leaves its expected scheme | No |
| NEW-42 | The OTP step promised a code that is never sent, and showed the demo code live | — → **COMPLETE_VERIFIED** (pass 23, 2026-11-07, §40.4; PR #192) | The factor is an authenticator app's TOTP; `/auth/otp/resend` extends the window and delivers nothing (backend `StepUpService`). *Resend code* → *Need more time?* (5 locales); *Demo code: 123456* only when mocks are on. `VerifyOtpPage.test.tsx` +3; live: no demo code and *Need more time?* on a real sign-in (§40.2). The patient app's copy is fixed in PR #191 | Native review of 2 strings in 4 locales; the wording goes back when RM M19 adds email/SMS delivery | The step says what the factor is | No |
| NEW-43 | Excel (`.xls`) export evaluates formula-leading text | — → **COMPLETE_VERIFIED** (pass 24, 2026-11-07, §41.3; PR #194) | Found by NEW-40's live check: the `.xls` export (an HTML table) turned a patient named `=HYPERLINK(…)` into a live formula in LibreOffice; the CSV did not. LibreOffice ignores Excel's `mso-number-format` text hint and honours the leading quote, so `.xls` cells take the CSV's `neutralised()` rule (`toExcelHtml`). `export.test.ts` +7; live: re-exported through the UI, 0 formulas | Microsoft Excel itself not run (no licence here) | A cell an export writes is never evaluated | No |
| NEW-44 | An expired two-factor challenge was called a wrong code | — → **COMPLETE_VERIFIED** (pass 24, 2026-11-07, §41.5; PR #195) | The server answers an expired challenge with the same `401 otp_invalid` as a wrong code (deliberately). Live: a valid code at 5 min 20 s read *That code is incorrect*. Past `OTP_CHALLENGE_TTL_SECONDS` (restarted by *Need more time?*, as `StepUpService.resend` does) the page now says *This sign-in has expired* with *Back to sign in*, for both code kinds; 5 locales. `VerifyOtpPage.test.tsx` +5; live: the fixed page shows the message at 5 min 20 s. The patient app is fixed the same way (PR #197) | Native review of 1 string in 4 locales | A dead challenge is never presented as a typo | No |
| NEW-45 | *1 doctor are waiting on a verification decision* | — → **COMPLETE_VERIFIED** (pass 24, 2026-11-07, §41.4; PR #196) | Found in the live admin run. `pendingSentence` in `doctors.ts` (no new react-refresh warning). `DoctorsSection.test.tsx` +2 | — | The verb agrees with the count | No |
| NEW-46 | A doctor cannot submit verification documents | — → **BLOCKED_BACKEND** (pass 24, 2026-11-07, §41.4) → **IMPLEMENTED_UNVERIFIED** (pass 25, 2026-11-15, §42.3: route and screen built; a live upload needs an object store) | Found in the live admin run. `POST /doctors/:id/verify` answers 409 until every required document is approved, and the admin Documents tab enforces the same; but **no route on any branch creates a `doctor_verification_documents` row** (only the generated Prisma client mentions the table), so a doctor who registers can never reach *Verified*. The frontend side (the admin review, the three-check approval, *Complete verification*) is built and contract-tested. **Pass 25 (§42.3):** backend `GET/POST /me/verification-documents` (API §3.6a) files an upload of the caller's own; Settings → **Verification** (practitioner workspaces only) lists the documents with the reviewer's decision and reason, names the required kinds still missing, and submits through `POST /files` then the filing call, discarding the upload if filing fails. Backend e2e 24/24 — including the acceptance, a registered doctor filed, approved and **verified over HTTP alone** (in-memory storage); web 25 new tests; Chromium on the demo bundle and live against a local API (list 200, storage-down 503 named) | **Still owed:** a live upload against an object store (the local stack has none; the e2e uses in-memory storage). Status changes on a resubmission after `docs_requested` are the state machine's (API §3.6), unchanged | A registered doctor can be verified end to end | No |

*ORG-01 moved to §13.6 on 2026-10-26: its status is WEB-1/WEB-2's (§8 rule 9).*

### 13.3 Doctor clinical modules

| ID | Feature | Before → After | Evidence | Remaining / dependency | Acceptance | Input? |
| --- | --- | --- | --- | --- | --- | --- |
| §3.1 widgets | Overview KPIs, today, decisions | COMPLETE_VERIFIED → COMPLETE_VERIFIED (2026-10-25: "Completed this week" gains its week-on-week comparison where the server serves it — an update to this row, not a new one) | `http-dashboard-service.test.ts` (7). **2026-10-25:** the tile's catalogue entry promises "against last week" and live builds drew no comparison. When `GET /dashboard/doctor/kpis` (M27.2, `backend` only) answers, the tile's value **and** delta are that route's (`completedWeek`, signed `completedWeekDelta` → "2 down vs last week", tone by direction, "0" flat), so both describe one week; on a 404 (`main`), a failure or an unreadable body the tile keeps `/appointments/summary`'s figure with no comparison — never a delta invented beside a figure from another computation, and not a failed widget, since the figure is still the server's. Tests: adapter (+6: value and delta from one route, a 500 and an unreadable body fall back, three wordings; the request list now includes `/kpis`); removing the wiring fails the first (checked). Browser (live bundle, API stubbed): served → "9 · 2 down vs last week"; `main`-shaped 404 → "7", no comparison; axe 0 violations; 0 page errors | G-1; the comparison needs `backend`. **Found 2026-10-25 (§22), not built:** UX §2.1 asks for Accept / Propose time / Reject *inline* on a request in the decision list; each request links to its appointment, where those actions are. Inline, the dashboard would need the appointments feature's flows, which §3.4 keeps it from importing — a design question (expose them through `routes`, as `bookAppointment` does, or a shared domain), not a quick fix | — | No |
| §3.1 pulse | Practice pulse, trend, satisfaction, activity | MOCK_ONLY → MOCK_ONLY → **PARTIAL** (2026-10-25: trend, satisfaction and recent activity connected over RM M27; practice pulse has no route. Briefly tracked as NEW-25, retired — §13.1 *Retired IDs*) · 2026-11-15: the no-show rate is now sourced from the doctor's own book (§42); consultation length and response time still have no source, so the row stays partial | **Trend, satisfaction, recent activity (2026-10-25):** The HTTP adapter reads `GET /dashboard/doctor/trends` (14 days completed/cancelled), `…/satisfaction` (five rating buckets) and `…/recent-activity` (signed notes, issued prescriptions, released labs; instants formatted on the client) and loads them **apart from the core**: a 404 is no source ("Not available yet", no Retry), any other failure or an unreadable body fails that widget alone (`failedSections`) with Retry. All five buckets kept, five stars first; a month with no responses and an empty feed each say so. Each activity row opens the module that owns its kind — the feed's ids are internal row ids, not routable. The demo fixtures speak the server's vocabulary (`model/pulse.ts`, shared). Tests: adapter (+9: each route once with no parameters, trend labels, buckets and tones, an empty month, activity time and links, one widget failing alone, an unreadable body, a core failure still failing the whole), widgets (+7), page (+1); the four isolation tests fail with the per-section error removed (checked). Browser (Playwright + Chromium, live bundle, API stubbed at the network layer) 31/31: served — chart, five buckets, server's activity text, "25 min ago", note row → `/doctor/medical-records`; `main`-shaped 404s — three "Not available yet", no Retry, KPIs intact; satisfaction 500 — only that widget fails, Retry asks again; 375 px no horizontal scroll; axe WCAG 2.2 AA 0 violations in all four states; demo bundle shows the new vocabulary; 0 page errors **Practice pulse (2026-11-15, §42):** live, the widget shows the **no-show rate alone** — four exact counts from `GET /appointments?from=…&to=…[&status=no-show]&pageSize=1` (`totalItems`; the doctor's own book, scoped by `doctorId` server-side), last 30 days against the 30 before, with the administrator's `noShowRate7d` definition (no-shows over every appointment that started in the window). The denominator is the caption ("3 of 72 appointments"); an empty window is "—" with the reason; the delta is in percentage points and drawn only when both windows hold ≥ 10. Loaded apart from the core (`failedSections: 'pulse'`, Retry); a 404 is no source. Consultation length and response time are never drawn. Tests: `model/pulse.test.ts` (+11), adapter (+5, one updated: the "no fixture figures" test now expects only `no-show-rate`), widget (+4), page (+2); the slot's and the adapter's isolation each fail with the change reverted (checked). Not browser-driven this pass; the demo's figures are still marked Sample data | **Practice pulse: two of three metrics have no source** — M27's `GET /dashboard/doctor/kpis` carries counts only, and nothing serves a consultation length (the appointment view carries the booked `durationMin`, not `checkedInAt`/`completedAt`) or a request response time (§9 row 15). The no-show rate is counted client-side from two `totalItems`; a server aggregate would replace four calls with one. The three connected widgets: live run (G-1); routes on `backend`, not `main`; "today" is the server's UTC day | Each widget drawn from its route; one failing widget never blanks another; an unserved route never offers a Retry that cannot succeed; practice pulse says it has no source | No |
| NEW-30 | Row-0 critical alerts banner (UX §2.1) | — → **COMPLETE_VERIFIED** (2026-10-25, §22; RM M27.3 on `backend`) | UX §2.1 specifies a full-width Row 0, error variant and non-dismissible, listing unreviewed critical lab results, allergy conflicts on today's patients and urgent reschedules, each with one resolving action; no row tracked it and nothing rendered it. `backend` serves `GET /dashboard/doctor/critical-alerts` (M27.3), designed to fail loud — "an empty banner is indistinguishable from a safe one". **Built:** `CriticalAlertsBanner` above the grid and the empty state, its own query (`useCriticalAlertsQuery`: staleTime 0, re-checked every 60 s), never a widget a doctor can leave off. Over HTTP: a strict parse (an unknown kind or an unreadable instant fails the whole answer rather than dropping an alert); a 404 is `main` — nothing checked, nothing said; any other failure is "Couldn't check for critical alerts" with Check again, in the same error variant, with the last alerts kept beneath it. Links are rebuilt from the app's route table per kind, never taken from the body; an unknown path falls back to the kind's list. `since` is worded per kind (a lab's order age; a moved appointment's new time; nothing for a conflict, whose instant is only the answer's). Demo: from the shared lab store with the server's predicate, so it lists exactly what the Labs page's "Critical unreviewed" chip counts and a review there clears it. Tests: adapter (+10), `critical-alerts.test.ts` (13), `CriticalAlertsBanner.test.tsx` (6), `OverviewPage.test.tsx` (+4), `features/critical-alerts-coherence.test.ts` (2); each of three mutations — no 404 branch, the body's path followed as given, the banner unmounted — fails them (checked). Browser 28/28: live bundle with the API stubbed (served, `main`-shaped 404, 500) at 1440 and 375 px, demo bundle against the Labs chip; axe 0 violations in every state; 0 page errors | G-1; the route is on `backend`, not `main`. The demo derives the lab source only: clinical alerts and appointments live in feature-private mocks (§3.4). A conflict links to the day's book: the server sends no patient id (§9 row 18) | Visible on every Overview visit when something is critical; a failure is said, never silence; cannot be dismissed | No |
| D-01 / DX-22 / DX-23 | Quick actions | COMPLETE_VERIFIED → COMPLETE_VERIFIED | §10.4 | — | — | No |
| §3.2 | Patients directory, registration | COMPLETE_VERIFIED → COMPLETE_VERIFIED | `http-directory.test.ts` (10) | G-1 | — | No |
| §3.3 chart | Profile bundle + 10 tabs | COMPLETE_VERIFIED → COMPLETE_VERIFIED | `http-profile-service.test.ts` (22) | G-1 | — | No |
| §3.3 allergy, vitals | Record allergy, record vitals | COMPLETE_VERIFIED → COMPLETE_VERIFIED | PR #76 | — | — | No |
| NEW-01 | Raise clinical alert | NOT_STARTED → IMPLEMENTED_UNVERIFIED → **COMPLETE_VERIFIED** (pass 3) | `chart-writes.test.tsx`; Browser (pass 3): refused without a severity, "Warning raised" announced, banner on the chart — 1440 and 375 px (§15.2) | G-1 | No default severity; announced after refetch | No |
| NEW-02 | Add history event | NOT_STARTED → IMPLEMENTED_UNVERIFIED → **COMPLETE_VERIFIED** (pass 3) | `chart-writes.test.tsx`; Browser (pass 3): no default kind, future date refused, on the timeline after the announcement (§15.2) | G-1 | No default kind; no future date | No |
| NEW-03 | Emergency contacts add / correct | NOT_STARTED → IMPLEMENTED_UNVERIFIED → **COMPLETE_VERIFIED** (pass 3) | `chart-writes.test.tsx`, mock + adapter tests; Browser (pass 3): phone rule refused "call me", add and correct announced and shown (§15.2) | G-1 | One primary; server phone rule | No |
| NEW-04a | Resolve alert · remove contact | NOT_STARTED → IMPLEMENTED_UNVERIFIED → **COMPLETE_VERIFIED** (pass 3) → **COMPLETE_VERIFIED, with reasons** (2026-10-24, BR-DEC-003) | `chart-writes.test.tsx` (+4, +2 for reasons), adapter (+3, +1 for reasons), mock (+2, +2 for reasons); DEC-003 approved (D); Browser (pass 3): both confirmed, resolve says it does not delete, alert leaves the banners (§15.2). **2026-10-24:** the server persists a reason on both (`backend` `0ee2a79`, PR #101), so contact removal **requires** one (DEC-003 item 3: "if the backend can record it") and alert resolution offers an **optional** one (item 1 asks for a confirmation, not a reason); sent trimmed in the `DELETE` body / beside `active: false`, never sent empty. Browser (mock-mode dev server, 1440 px): an empty contact reason refused before send; removal announced with the reason kept | G-1; the BR-DEC-003 routes are on `backend`, not `main` | Confirmed; record kept; primary warning; pessimistic; reason kept server-side | No |
| NEW-04b | Correct / remove a history event with a mandatory reason | NOT_STARTED → BLOCKED_BACKEND → **PARTIAL** (2026-10-24: removal built; correction still blocked) | **Remove:** `DELETE /patients/:id/history/:eventId` now requires `{ reason }` and keeps it on the soft-deleted row (`backend` `0ee2a79`). Each timeline entry has *Remove history event: …*; the dialog requires a reason (≤300, the server's ceiling), says the entry is not erased, and says plainly that removed events cannot be shown yet and that correction is unavailable. Pessimistic: the entry leaves only after the History tab refetches. Mock twin refuses an empty reason (422) and hides the removed event from every read, as the server does. Tests: `chart-writes.test.tsx` (+3), adapter (+2), mock (+1), `client.test.ts` (+1, `DELETE` with a body). Browser (mock-mode dev server): empty reason refused; 6 → 5 events after removal; dialog fits 375 px with no horizontal scroll; 0 page errors | **Correct:** no `PATCH …/history` (BR-DEC-003 point 1). **Mark removed entries:** no read returns them (point 4). **Who may:** unchanged — `patients.view` + care reach (point 5, owner's). G-1 | Removal: mandatory reason, persisted, original kept. Correction and marking: not built | No |
| §3.3 notes | Chart notes create / edit / sign | BLOCKED_BACKEND → IMPLEMENTED_UNVERIFIED (unchanged, pass 3) → **COMPLETE_VERIFIED** (2026-10-24, BR-DEC-001 on `backend`) | `chart-notes.test.tsx` (+1); DEC-001 approved (C); Browser (pass 3): write → edit own → sign (confirmed, says it freezes) → no Edit/Sign on the signed note (§15.2); repeated 2026-10-24 on the mock-mode dev server, 0 page errors. **BR-DEC-001 implemented** (`backend` `acc2c7e`, PR #89): edit and sign refuse anyone but the author with 403 `not_note_author`, verified by the backend's e2e over HTTP. The chart now names that refusal ("Only the note's author can edit or sign it. Nothing was changed.") instead of "try again" — a 403 reaches the client with no detail; the mock twin enforces the same rule, so the port's `updateNote`/`signNote` carry who is acting (ignored over HTTP, as `addNote`'s author is) | G-1; the release gate's backend half is on `backend`, not yet `main` | Own unsigned notes only offer Edit/Sign; sign freezes; a non-author is refused server-side | No |
| D-04 / D-04b | Documents read / upload | BLOCKED_BACKEND → BLOCKED_BACKEND (pass 15, 2026-10-31: re-checked; the blocker is the patient-document link, §32) → **IMPLEMENTED_UNVERIFIED** (pass 16, 2026-11-01: the HTTP adapter and the category picker are built; not run against a store, §33) → **COMPLETE_VERIFIED** under DEC-018 option A (pass 23, 2026-11-07: live against MinIO + ClamAV 1.4.3, §40.3; DEC-018 itself stays OPEN) | Port + unconfigured adapter; **pass 15:** stale "skeleton" comments corrected in `patients/service.ts` and the port. **Pass 16:** `http/http-documents-service.ts` (storage from `/health`, chart-scoped download, `POST /files` → `POST /patients/:id/documents`), `UploadDocumentDialog` (category required, no default), the hook refetches the Documents tab after a filed upload; `http-documents-service.test.ts` (16), `DocumentsTab.test.tsx` (+3, 2 rewritten for the dialog), `usePatientDocumentAccess.test.tsx` (+3) | **Pass 23:** verified live — `/health` storage `up` opens the tab; a PDF upload is filed, refused as `scan_pending` until ClamAV clears it, then opens a signed MinIO URL (`X-Amz-Signature`, `X-Amz-Expires`) whose bytes match the upload; a forged `.pdf` is refused 422 by the server's signature check and the refusal shown. Not live: an infected document (EICAR cannot pass the PDF signature check), covered by recorded responses. Before: **Integration 2026-10-31 (`backend` → `frontend` merge):** the backend half of this blocker is now on this branch — `POST /patients/:id/documents` links a `POST /files` upload (kind `patient_document`) to the chart, and `GET /patients/:id/documents/:documentId/download` answers `{ url, expiresInSeconds }` behind care scope and the M25.3 scan gate (backend PR #158, API §4.7). `PatientDocumentView` still carries no `fileId`; the per-document route is the alternative named here. Still owed: the frontend adapter (not written; `patients/service.ts` and the port's comments describe the pre-integration backend), an object store (M25.2) and a scanner that scans (M25.3). Status unchanged until the adapter exists and is run against storage. Before: Backend: `fileId` on `PatientDocumentView` (or a per-document download route), and a route that links an uploaded file to a patient as a document. Then infra: an object store (M25.2) and a scanner that scans (M25.3; the bound one "scans nothing") | — | No |
| D-05 imaging | Imaging reports | BLOCKED_BACKEND → BLOCKED_BACKEND | Notice on tab | Imaging/PACS source | — | No |
| D-06 | Patient summary PDF | COMPLETE_VERIFIED → COMPLETE_VERIFIED | Browser download | — | — | No |
| D-07 | Flag a data error | COMPLETE_VERIFIED (live fake success) → COMPLETE_VERIFIED | `live-data-error-report.test.tsx` fails on old header; mock test | Patient-level report route if wanted live | Absent live; mock routes to admin queue | No |
| NEW-06 | "Schedule appointment" carries the patient | NOT_STARTED → **COMPLETE_VERIFIED** (pass 3) | `routes.doctor.bookAppointment({ patientId })` → `?book=`, consumed once and stripped by `AppointmentsPage`; `AddAppointmentDialog` `initialPatientId` (applied once the directory holds the patient). `book-for-patient.test.tsx` (7), `PatientRowActions.test.tsx` (8) — 11 of 14 fail on the pre-fix code (checked). Browser (pass 3): header and row → dialog with Khaled Nassar chosen, param gone, back does not reopen. Patients-list "New appointment" now opens the dialog too | G-1 | Opens booking with patient preselected | No |
| NEW-07 | Row "Send message" uses patient compose | NOT_STARTED → **COMPLETE_VERIFIED** (pass 3) | Patient row (inline + menu), appointment row menu and appointment drawer use `composeMessage({ patientId })`. Same file, same defect class: the row's labs link used `?patientId=` (nothing reads it), prescriptions carried no patient, "Open medical record" went to the profile's History tab — all now `?patient=`, the header's contract. `PatientRowActions.test.tsx`. Browser (pass 3): PT-1002 → its thread; PT-1001 (no portal contact) → picker, no thread invented | G-1 | Same contract as the header (D-24) | No |
| §3.4 | Appointments: book, transitions, propose, time off | COMPLETE_VERIFIED → COMPLETE_VERIFIED (pass 12, 2026-10-30: a link to an appointment the book does not hold says so, §29) (pass 13: a change refreshes the Overview and the chart, §30.4); pass 14: a refused transition re-reads, §31.2 | `http-appointment-service.test.ts`, PR #76; **pass 12:** `AppointmentsPage.test.tsx` +4; **pass 13:** `cross-feature-invalidation.test.tsx` (5); **pass 14:** `refresh-on-refusal.test.tsx` (appointments) | G-1 | A deep link either opens its appointment or says it is not in the book | No |
| NEW-08 | Weekly availability editor | NOT_STARTED → IMPLEMENTED_UNVERIFIED → **COMPLETE_VERIFIED** (pass 3; Browser (pass 3): invalid week refused before send; closing Monday listed 1 stranded appointment with its reschedule link, "does not move, cancel or notify anyone", timezone limit disclosed, save confirmed) → **COMPLETE_VERIFIED, clinic timezone and server report** (2026-10-24, BR-DEC-005) | DEC-005 A: Settings → Availability; `availability.test.ts` (16), adapter (5), mock (2), `AvailabilitySection.test.tsx` (8), route tree (+2) **2026-10-24 — BR-DEC-005 (`backend` `8d9b655`, PR #94):** `GET`/`PUT /me/availability` carry `clinicTimezone`, and the `PUT` answers with `stranded[]`. The preview now reads appointments in the clinic's zone (the server's own rule — same civil day, inside a window, clear of breaks, a visit ending at midnight read as 24:00) and the review names the zone; after a save the **server's report** is what stays on screen — names joined from the book the preview read, the server's handle otherwise — and an empty report clears a preview warning. A server that sends neither field reads as unknown (`null`), never as UTC or as "nothing stranded", and the old device-zone caveat and preview-only aftermath return. The list adds the clinic's time beside the device's where they differ. Tests: `availability.test.ts` (+6), adapter (+3), mock (+1 assertion), `AvailabilitySection.test.tsx` (+3), `StrandedAppointmentsList.test.tsx` (3, new). Browser (mock-mode dev server, device in Europe/London; a clinic zone and a report injected by patching the service in the page, since the demo has neither): device caveat without a zone; "compared in the clinic's time zone, Africa/Cairo" with one; after saving, the server's report with "Patient PT-4242" and "(10:00 clinic time)"; no horizontal scroll at 375 px; 0 page errors | Live run (G-1); BR-DEC-005 is on `backend`, not `main`; the demo has no clinic zone and makes no report, deliberately (its admin localization value is page copy, and a report in the device's zone would claim the server's exactness); refuse-vs-report and RA-005.1 remain the owner's; per-location grid is API-W03 | Seven-day grid, server rules before send, 422 per day; stranded appointments listed with reschedule links, nothing moved | No |
| D-08 | AI flag | COMPLETE_VERIFIED → COMPLETE_VERIFIED | §3.5 | — | — | No |
| D-09 | AI assistant model | BLOCKED_BACKEND → BLOCKED_BACKEND | `/ai/*` served (`backend/src/modules/ai`: conversations, messages, prompts, model, `me/ai-settings`). Production bundles ship the disclosed mock assistant (`scripts/mock-boundary.ts` exemption) — owner decision, open. S1 fixed 2026-11-22: conversations in memory only, settings per user, legacy global keys removed (§43) | The routes exist; the blockers are the AI provider/gateway binding (no provider configured, `/health` → `ai: unconfigured`) and the hospital binding (Phase 28, WEB-9) | — | No |
| D-10…D-14 | Lab inbox, review, trends, attach | COMPLETE_VERIFIED → COMPLETE_VERIFIED (pass 10, 2026-10-30: trends over API §8.8, §27) (pass 13: provisional values are not presented as released, §30.1); pass 14: the worklist flag and tint follow release, and a refused review re-reads, §31 | `http-lab-service.test.ts` (13; **pass 10:** +5 for `GET /patients/:id/lab-trends`); `AnalyteTrendDrawer.test.tsx` (4) and `trends.test.ts` (+3), 6 of them failing on the old code; **pass 13:** `preliminary-results.test.tsx` (8), `http-patient-studies.test.ts` +1; **pass 14:** `preliminary-results.test.tsx` +2, `lab-row-tint.test.ts` +1, `refresh-on-refusal.test.tsx` (labs) | G-1 | The trend plots the patient's released history as served, not the loaded slice | No |
| D-15 | Lab annotations | MOCK_ONLY → MOCK_ONLY | "Notes are not available" live | No annotation endpoint | — | No |
| D-16, D-20, D-23, DP-06 | Exports | COMPLETE_VERIFIED → COMPLETE_VERIFIED | Browser downloads | — | — | No |
| D-25 | Reports export | IMPLEMENTED_UNVERIFIED → **COMPLETE_VERIFIED** (pass 3) | Browser (pass 3): `medora-report.csv`, 623 bytes, header `Section,Label,Value`, 28 rows, a KPI row (`KPI,Revenue,324000`) matching the page. **Defect found and fixed (NEW-16):** opened before the analytics loaded or after they failed, the dialog toasted "Exported as CSV" with no file; a refused export said nothing. `ExportDialog.test.tsx` (4) — 3 fail on the pre-fix dialog | — | File matches table | No |
| NEW-16 | Report export announced a file it never wrote | — → **COMPLETE_VERIFIED** (pass 3) | `ExportDialog`: the header's Export is enabled while analytics load and after they fail; the dialog then skipped `runExport` but still toasted "Exported as …". Export now waits for the snapshot and says why; a refused export reports "No file was created"; the format choices expose `aria-pressed`. `ExportDialog.test.tsx` (4) — 3 fail on the pre-fix dialog; browser download in D-25. §12.2's audit missed it because the toast *is* inside `onSuccess` — of a mutation that succeeds whether or not there is anything to export | — | No success claim without a file | No |
| §3.11 | Doctor reports analytics | MOCK_ONLY → DEFERRED → **COMPLETE_VERIFIED** (2026-10-25, RM M21 on `backend`; saved and scheduled reports, which this row's Remaining cell already named, briefly tracked as NEW-28 and two defects as NEW-29 — both retired; §13.1 *Retired IDs*) | **Analytics:** `http/http-reports-service.ts`: `GET /reports/analytics` (`category`, `range`, custom `from`/`to`, `gender`, `ageBand` — nothing else) and `GET /reports/insights` (the period only); every series, slice, heatmap, KPI and insight parsed strictly (an unknown tone or kind is a failure, not a chart); KPI icons by id on the client; the revenue alternate (`alternate: 'top-visit-types'`) read as its own document. `capabilities.advancedFilters` = age, gender: the drawer offers only those and says the server filters by nothing else; chips and the active count ignore an unapplied URL value. The "illustrative demo analytics" footnote is demo-only; live says the figures are the server's and its days UTC; the trend subtitle names the series present. Tests: adapter (+9 analytics: query params, custom bounds on both routes, snapshot and insights mapping, revenue alternate, three malformed bodies refused, a 404 surfaced), `live-reports.test.tsx` (3 of 6), seam test (+`capabilities`). Capabilities flipped to the demo's → 5 tests fail (checked). Browser (live bundle, API stubbed) 35/35 across this row and NEW-28/29: query carries `gender=female` and no department, server KPI drawn, server footnote, no department chip, revenue → "Top visit types" with the notice, drawer says age and gender only, `main`-shaped 404 → "Couldn't load analytics" with Retry; CSV export from the live snapshot (`KPI,Patients,42`); axe WCAG 2.2 AA 0 violations on every live state, 1440 and 375 px; 0 page errors **Saved and scheduled reports (2026-10-25):** Save posts the whole filter set (`POST /reports/saved`); duplicate is a real create carrying the source's filters; delete by id; a schedule posts only the server's fields, pause/resume reads the status first because `PATCH` sets rather than flips; no user or owner id is ever sent; every write answers the re-read document. A never-opened report is dated by its creation (`lastViewedAt: null`). `capabilities`: rename and favourites withheld (both reject `not_connected` without a request if called), `scheduleDelivery: false` — the panel says "Schedules are saved on the Medora server, but reports are not sent yet… Nothing will arrive by email", each row "Due … · not sent while delivery is unavailable", and the dialog says the same. Every rail and panel write now names its failure (all were silent). Tests: adapter (+8), `live-reports.test.tsx` (3 of 6). Browser: save → POST with `gender: female`, menu "Duplicate \| Delete" only, schedule created and paused (`PATCH { status: 'paused' }`) at 375 px **Defects fixed on the way (bug fixes to this row):** Found reading the panel for NEW-28, both modes: the caption used `{''}` where spaces were meant, rendering "Weekly ·PDF· 1recipient" and "Last sent<date>" — now one joined string, "Weekly · PDF · 1 recipient"; the new-schedule dialog pre-filled `amelia.chen@medora.health` for every user — now the signed-in user's own email (in a live build a schedule would otherwise have gone to an address that is not theirs, had delivery existed). `live-reports.test.tsx` (2 of 6). Browser: live caption and pre-fill; demo caption matches `^(Daily\|Weekly\|Monthly) · ` | Live run (G-1); `backend` only. Hospital scope (API-W02) — the ⚠ box below stays open. Days are the server's UTC days **Saved reports:** no rename or favourite route on any branch. **Scheduled reports:** delivery blocked server-side — `reports.scheduled-run` is registered blocked (mail port has no attachments, ADR-025; a link would hit the M25.3 scan gate) (§9 row 17) | Every figure the server's; only applied filters offered; no revenue chart without billing; nothing offered that is not kept; a schedule never implies it is sent | No |
| D-17, D-19 | Prescribing flow, lifecycle | COMPLETE_VERIFIED → COMPLETE_VERIFIED (pass 13: signing or ending refreshes the chart's medications, §30.4); pass 14: a signature refused as stale re-reads, §31.2 | `http-prescription-service.test.ts`; **pass 13:** `cross-feature-invalidation.test.tsx` (signing, discontinuing); **pass 14:** `refresh-on-refusal.test.tsx` (signing, and a safety refusal left alone) | G-1 | — | No |
| NEW-09 | Prescribing strip's current medications | COMPLETE_VERIFIED (live defect) → IMPLEMENTED_UNVERIFIED → **COMPLETE_VERIFIED** (pass 3) | `PatientContextStrip.test.tsx`, adapter + mock tests; Browser (pass 3): loaded, each entry names its source (`Glucophage 850 mg · Three times daily · Prescription RX-200001`) | G-1 | Every source; error ≠ none | No |
| NEW-10 | Discontinue vs cancel | NOT_STARTED → IMPLEMENTED_UNVERIFIED → **COMPLETE_VERIFIED** (pass 4) → **COMPLETE_VERIFIED, plus discard** (2026-10-24, BR-DEC-002) | DEC-002 A: `endActFor` — pending-approval → Cancel (`/cancel`), active/dispensed → Discontinue (`/discontinue`), draft → neither; `end-prescription.test.tsx` (26), adapter (+2), demo service (8). **Pass 4 fixture:** `RX-200006`, Tramadol 50 mg — controlled (the only way the server produces `pending-approval`, `prescription-status.machine.ts`), high-alert, for Amira (PT-1003), **not** on `MEDICATION_CATALOGUE` so authoring cannot offer it, no interaction note or allergy class invented; appended last, so the first five seeded prescriptions are byte-identical (checked). `model/pending-approval-fixture.test.ts` (11). Browser, 1440 and 375 px, through the normal UI (26/26 each): the fixture offers Cancel only; the four active rows Discontinue only; the expired row neither; the dialog says it has not taken effect and withdraws before therapy starts; confirm blocked until a reason; after the answer list and detail read discontinued, the timeline says `cancel: Prescribed in error`, no end act remains, other rows unchanged **2026-10-24 — discard (BR-DEC-002, `backend` `17ddda2`, PR #91):** where a draft showed the disabled note, both menus now offer **Discard draft**, which opens a confirmation ("never signed and dispenses nothing… It is not erased") and calls `DELETE /prescriptions/{id}` — pessimistic; the row leaves only after the list refetches, and the detail page returns to the list. 409 `prescription_not_draft` and 404 are named (`PRESCRIPTION_NOT_DRAFT` / `PRESCRIPTION_NOT_FOUND`). The HTTP adapter forgets a refused signature's remembered draft once it is discarded, so a retry creates a new one instead of signing a deleted row. Tests: `end-prescription.test.tsx` (+8: Discard on a draft in both menus, none once signed — 3 statuses × 2 menus, confirm-then-discard never cancels or discontinues, refusal named), adapter (+3), demo service (+4). Browser (mock-mode dev server; a draft placed with `__putMockPrescription`, since the demo never produces one): Cancel and Discontinue absent, Discard confirmed, back on `/doctor/pharmacy` with the draft gone and no not-found flash, 0 page errors | Live run (G-1); BR-DEC-002 is on `backend`, not `main` | Each status offers only its act, in the row menu and on the detail page; the dialog names the act; a reason is required; the act decides the endpoint; an unsigned draft is discarded, never cancelled or discontinued | No |
| D-18 | Medication database / typeahead | BLOCKED_BACKEND → BLOCKED_BACKEND → **PARTIAL** (pass 15, 2026-10-31: the typeahead is built; the dataset is not, §32) | Monograph half done; **pass 15:** typeahead over `GET /medications?q=` (`searchMedications` on the port, both adapters), `medication-search.test.tsx` (6), `http-prescription-service.test.ts` +3 | A drug reference dataset for the formulary to hold (content, not code). The whole formulary is still loaded for the picker; with a large dataset that load becomes the next frontend change. G-1 | — | No |
| §3.7 notes, monograph | Prescription notes; monograph | COMPLETE_VERIFIED → COMPLETE_VERIFIED | PR #76 | — | — | No |
| NEW-05 | Demo chart regimen = pharmacy store | NOT_STARTED → DEFERRED → **COMPLETE_VERIFIED** (pass 5) | **Pass 5:** the prescriptions moved (`git mv`, byte-identical) to `shared-domain/prescriptions` with one in-memory store; the pharmacy's demo service writes it and the chart's demo adapter projects the patient's prescriptions from it as `GET /patients/:id/medications` does (drafts excluded; running → active, discontinued → discontinued, else completed). `medication-coherence.test.ts` (8): each seeded patient's active chart medications equal the strip's list; a discontinuation in the pharmacy shows on both; a new prescription appears and is counted. Browser: chart and strip list the same prescriptions for PT-1001/1002/1003. Production build: no prescription seed in any chunk. *Before:* demo-only; needs pharmacy store moved to `shared-domain` | — | Chart and strip show one regimen | No |
| D-21, D-29 | Records authoring, sign, amend, rich text | COMPLETE_VERIFIED → COMPLETE_VERIFIED (pass 14: a write the server refuses as stale re-reads the record, §31.2) | `http-record-service.test.ts`; **pass 14:** `refresh-on-refusal.test.tsx` (records) | G-1 | — | No |
| NEW-11 | Report an issue on a record | NOT_STARTED → IMPLEMENTED_UNVERIFIED → **COMPLETE_VERIFIED** (pass 3) | `ReportRecordIssue.test.tsx`, adapter + mock tests; Browser (pass 3): empty report refused, toast promises only what the server does, record unchanged | G-1 | Record unchanged; honest toast | No |
| NEW-12 | Edit draft record fields + version history | NOT_STARTED → IMPLEMENTED_UNVERIFIED → **COMPLETE_VERIFIED** (pass 3; Browser (pass 3): a new unsigned draft offers Edit; the change shows; Edit history lists the version with before and after; signing the note withdraws Edit; the seeded MR-10002, a draft with a signed note, correctly offers none) → **COMPLETE_VERIFIED, with reasons** (2026-10-24, BR-DEC-004) | `EditRecord.test.tsx` (3, +2), `record-lifecycle.test.ts` (+2), adapter (+3, +2), mock (+3, +1); DEC-004 approved (A). **2026-10-24:** BR-DEC-004 is implemented on `backend` (`2eb3b87`, PR #90): `PATCH /medical-records/:id` refuses anyone but the record's author with 403 `not_record_author` and keeps an optional `reason` (≤300) on the version row, served by `GET …/versions`. The dialog offers *Reason for the change (optional)* — sent trimmed, never empty; the edit history shows *Reason: …* on the versions that have one; the author refusal is named ("Only the doctor who wrote this record can edit it. Add an addendum to correct it.") rather than "try again". Browser (mock-mode dev server, 1440 px): edit with a reason → toast says the reason is kept → *Reason: …* on Version 1 beside the before/after; no horizontal scroll at 375 px; 0 page errors **2026-10-25 — treatment plan and follow-up date (served on `main`):** the dialog edits the plan as ordered steps (add, reword, move up/down, remove; ≤50 steps of ≤500 characters, the server's bounds; focus follows the step a control acted on) and the follow-up date (set or cleared — sent as `YYYY-MM-DD` or `null`; refused before the visit day). An unchanged plan is never sent, because the server names every list it receives in the version row. **Fixed on the way:** (1) the dialog offered Department, which the server ignores — a department-only edit drew "already holds these values", a mixed edit dropped it under a success toast; it is now shown read-only. (2) Over HTTP the edit history printed the server's `children` key as "children — Changed"; it now reads *Lists replaced: Diagnoses, Treatment plan*. (3) The mock stored an edited visit day as a bare `YYYY-MM-DD` (read as UTC, so the previous day west of Greenwich); it now stores local midnight, as `readDay` does. Tests: `model/record-edit.test.ts` (14, new), `EditRecord.test.tsx` (+5: plan add/reorder/remove with focus, blank step and early follow-up refused with nothing sent, follow-up set then cleared, department read-only, `children` named), adapter (+2: plan trimmed in order, `followUpDate: null`), mock (+3); the `children` test fails with the history change reverted (checked). Browser (Playwright + Chromium, mock bundle via `vite preview`) 12/12: authored a draft (MR-90001) through New Record; Department not offered; a new step's field takes focus; step moved up and saved in that order; history lists Treatment plan and Follow-up date; follow-up set then cleared ("Not scheduled"); no horizontal scroll at 375 px with the dialog open; axe WCAG 2.2 AA 0 violations at 1440 and 375 px (a run taken mid open-animation flags contrast on fading labels and is clean once settled); 0 page errors | G-1; the BR-DEC-004 route is on `backend`, not `main`. The mock does not mirror the author check (it knows the editor only by name, and DEC-001 refuses name matching). Owner: whether the reason is mandatory, and which roles besides the author may edit. **Not in the edit form, deliberately (2026-10-25):** medications (prescribing goes through the pharmacy flow and its safety check, which a free-text list would bypass) and allergies (the chart's list is the one the allergy banner reads; a second copy could disagree). **Department is not editable:** `PATCH /medical-records/:id` accepts it and applies nothing on `main` or `backend` (`scalarsOf` writes no department) — backend handoff, §9.0 | Draft with nothing signed only; changed fields only; history shows who/when/before/after and the reason; a non-author is refused server-side | No |
| D-22 | Share a record | BLOCKED_BACKEND → BLOCKED_BACKEND → **BLOCKED_DECISION** (audit, 2026-10-23) → **COMPLETE_VERIFIED** (pass 5, DEC-016 A) | **Pass 5:** closed as copy-link. `copyText` (`utils/clipboard.ts`) is the one clipboard path — it rejects when the API is missing or refuses — and `useShareLink` says so: "Link copied" with the access note, or "Could not copy the link" with the address to copy by hand. Every other copy (code blocks, chat, API key, logs) reports failure the same way. Tests: `clipboard.test.ts` (4), `useShareLink.test.tsx` (3). Browser: granted — the clipboard holds the record's URL; denied — the toast carries it. *Before:* copies a link today (`useShareLink`); the recipient still needs their own access | — (share-with-colleague would need a sharing policy and an endpoint — not asked for) | Copy succeeds or says it did not, with the link | No |
| D-24, §3.9 | Messaging | MOCK_ONLY → MOCK_ONLY | M20 on `main` — `backend/src/modules/messaging`, registered in `modules/index.ts` *(corrected 2026-11-22, §43; was "on `backend`, not `main`")* | API-W09. Also: no route lists whom a user may message (`POST /conversations` takes user UUIDs the client cannot obtain), and the module is single-tenant (AF-34). BR-DEC-006 part 4 verified staff access on `backend` (PR #98); it does not supply a recipient lookup *(2026-10-25, §20)*. **`POST /conversations` has no participant or patient validation (backend security gap); the client stays mock until that is fixed** — `ConversationService.create` checks only that each participant is an `ACTIVE` user (any role), and `patientId` is stored unchecked: no care relationship, no existence check *(verified read-only in `backend/src/modules/messaging`, 2026-11-22, §43)* | — | No |
| §3.10 | Notifications, mark-all-read | COMPLETE_VERIFIED → COMPLETE_VERIFIED | PR #76 | Delete: no route on any branch. Archive, favourite, pin and clear-read: connected by NEW-24 (served on `main` — corrected 2026-11-22; was "on `backend`, not `main`") | — | No |
| NEW-24 | Notification flags, clear-read and preferences over the API | — → **COMPLETE_VERIFIED** (2026-10-25) | The HTTP adapter sends `POST /notifications/:id/{archive,favorite,pin}` `{ value }`, `POST /notifications/clear-read` (`{ archived }`), `GET`/`PUT /me/notification-preferences` (whole document, strict parse: every channel and category a boolean, quiet hours `HH:MM`); `capabilities` gains `clearRead`, and live `organize`/`clearRead`/`preferences` are on while `remove` (delete) stays off. Preferences moved behind the port (demo: per user in this browser, as before); writes serialised by a mutation scope, newest answer wins, a refusal restores the previous value with an error toast; refused flag and clear-read writes now toast too (page and bell). Tests: adapter (+10: each flag's route and body, no request for an empty patch, a 404 surfaces as `not_found`, clear-read count and malformed body, preferences read, whole-document write, missing channel/category and bad time refused), `live-preferences.test.tsx` (6, rewritten — the old file asserted "not connected"), `live-notifications-page.test.tsx` (4, new), `live-actions.test.tsx` (+1, rewritten for the live menu), seam (+2 methods). Checked against the change removed: without the mutation scope the ordering test fails (two PUTs in flight); without the new `onError` the refused-archive test fails. Browser (Playwright + Chromium): demo bundle 7/7 — SMS change survives a reload, Security locked, drawer reads the stored value, Archive removes the row, no overflow at 375 px, 0 page errors; live bundle with the API stubbed at the network layer 13/13 — switches from the server's document, one `PUT` of the whole document, a refused save restores the switch and names itself, a 404 load (what `main` answers) shows the error and no switches, archive sends `{"value":true}`, a 404 archive names itself and the row returns, no Delete, no overflow at 375 px, 0 page errors. axe WCAG 2.2 AA on both screens (drawer open) at 1440 and 375 px: 0 violations | Live run (G-1); the routes are on `main` *(corrected 2026-11-22; was "on `backend`, not `main`")* | Every switch drawn from the server's document; a refused write never looks kept; nothing offered that no route serves | No |
| §3.12 | Settings: profile, account, security, activity | COMPLETE_VERIFIED → COMPLETE_VERIFIED (2026-10-25: privacy and integrations, tracked in this row's Remaining cell, connected over RM M22 — briefly tracked as NEW-26/NEW-27, retired; §13.1 *Retired IDs*) | `http-settings-service.test.ts`. **Privacy (2026-10-25):** The HTTP adapter reads `GET /me/settings` beside the `/me/*` routes but apart from them — the document carries `settingsCenter`: `served`, `unserved` (404, "Not connected yet", no Retry) or `failed` (Retry on Privacy and Integrations only; every other section renders). A save is `PATCH /me/settings/privacy` `{ updatedAt, value }` — the whole slice, with the version of the latest read; a 409 is `SettingsConflictError`: "Your privacy settings changed elsewhere", nothing saved, the document re-read and the draft **replaced** with what is stored (a plain refetch kept the unsaved edit when the stored values were unchanged — found by the browser run, fixed, pinned). "Delete my account" is absent live (`capabilities.accountDeletion` — no route on any branch); "Download my data" stays (client-side, what the client holds). Tests: adapter (+9: served/404/500/unreadable body, whole-slice write with the read version, latest version after a re-read, 409 → conflict, no write without a read), `live-settings-center.test.tsx` (6 privacy: switches from the server's document, PATCH body and success only after it, 409 named + stored value back + save bar gone, no deletion, 404 "Not connected yet", 500 Retry). Mutations checked: capabilities flipped or the 409 mapping removed → 5 tests fail; the draft reset removed → the 409 test fails. Browser (live bundle, API stubbed) 18 privacy checks of 32: switch drawn from the server (off), PATCH carries `2026-10-20T08:00:00.000Z` and four fields, 409 named with no success toast and the stored value back, `main`-shaped 404 "Not connected yet" at 375 px; axe WCAG 2.2 AA 0 violations; 0 page errors **Integrations (2026-10-25):** Read from `GET /me/settings` (`integrations`, all four always listed); disconnect is `POST /me/integrations/:id/disconnect` after confirmation, the refetched state shown, a refusal named ("Could not disconnect — It is still connected"; the demo's connect and disconnect gained the same error toasts). Connect is **not offered** live (`capabilities.integrationConnect: false`): each unconnected tool reads "Connecting is not available yet". Tests: adapter (+3: disconnect route, connect answered by the server's 501, capabilities), `live-settings-center.test.tsx` (3). Browser: server account shown, no Connect, three "not available" notes, disconnect POSTed and the account gone after the refetch, 375 px; axe 0; demo still offers Connect | Notification preferences: connected by NEW-24 (served on `main`). Privacy and integrations: connected (served on `main`, §21) *(corrected 2026-11-22; both said "`backend` only")*. **Still open: integration Connect** — not offered live; `POST /me/integrations/:id/connect` answers 501 `not_implemented` until an OAuth client is configured per provider (RA-M22.1, §9 row 16). Live run (G-1); `backend` only. The server's `preferences`, `appearance` and `accessibility` slices are not read — those stay per browser, as before (a product choice this row does not make) | Every consent drawn from the server; a save never looks kept unless the server kept it; a stale save shows what is stored; nothing offered that the server refuses | No |
| NEW-13 | Profile photo | BLOCKED_BACKEND → BLOCKED_BACKEND → **PARTIAL** (pass 15, 2026-10-31: the upload is built and refuses honestly; not live-run, §32) → **COMPLETE_VERIFIED** for upload and display (pass 23, 2026-11-07: live, §40.3) | `PUT /me/profile/photo` answers 503; **pass 15:** `putProfilePhoto` (multipart `photo`), live upload in Settings → Profile (no removal: no route), `apiClient` sends `FormData`; `doctor-profile-wire.test.ts` +4, `ProfileSection.photo.test.tsx` (5), `client.test.ts` +1, `data-url.test.ts` (3) | **Pass 23:** verified live — crop → *Save photo* → `PUT /me/profile/photo` 200; after the scan the avatar renders from a signed store URL serving `image/png`. Still no removal: no route on any branch. Before: **Integration 2026-10-31 (`backend` → `frontend` merge):** the `photoUrl`-is-a-key half is fixed on this branch — every doctor-photo response is a signed URL or `null` (backend PR #157, M9.2), which `displayablePhoto()` already accepts, so no client change is needed. Signed URLs expire; a cached profile can outlive one (unverified). Still owed: an object store, without which nothing is stored to sign. Status unchanged. Before: Infra: an object store (until then the route answers 503, which the section reports as such). Backend: `photoUrl` is the storage key, not a URL, so a stored photo is not displayed (the client shows initials). G-1 | — | No |
| NEW-33 | Phone number truncated in the patient summary cards | — → **COMPLETE_VERIFIED** (pass 7, 2026-10-26) | Found in the same screenshots. The chart sidebar and the record and lab summary cards set `Fact`'s value with `truncate`, so a phone number in a half-width column showed as "+20 100 214 33…" at 1440 px in English and "…00 214 3387" in Arabic, with no way to read the rest. `Fact` takes `truncate={false}` (default `true`, so the 183 other uses are unchanged); every phone fact in a narrow card passes it and wraps at its spaces. Workbench story `ReadWhole`. Tests: `FactList.test.tsx` 2. Browser: §24.2 | — | A phone number is always shown in full | No |

### 13.4 Administration

| ID | Feature | Before → After | Evidence | Remaining / dependency | Acceptance | Input? |
| --- | --- | --- | --- | --- | --- | --- |
| ADM-02, ADM-03, ADM-05 | Doctors, verification, oversight | IMPLEMENTED_UNVERIFIED → IMPLEMENTED_UNVERIFIED → **COMPLETE_VERIFIED** (pass 24, 2026-11-07, §41.4; F33 resolved by the real bootstrap) | Adapters contract-tested; never live (F33) | **Pass 24:** verified live as an administrator created by `admin:bootstrap` and its mailed invitation (password + TOTP on the web page): ADM-02 list, filters and counts; ADM-03 document blockers, *Request documents*, *Suspend* → *Reactivate*; ADM-05 the cross-doctor table, identity withheld in table and drawer, *Reassign* naming why no one can take it, *Cancel administratively*. **Not live, and why:** completing a verification — no route lets a doctor submit verification documents (NEW-46); a nudge — pending requests come only from patient booking (RA-033.1). Before: Seeded admin TOTP (F33) | — | No |
| ADM-09 roles | Roles matrix | IMPLEMENTED_UNVERIFIED → IMPLEMENTED_UNVERIFIED (2026-10-25: the review uses the server's dry run; still never run live) → **COMPLETE_VERIFIED** (pass 24, 2026-11-07, §41.4) | F33, F36. **2026-10-25 — the review is the server's dry run (`POST /roles/matrix/preview`, served on `main`):** "Review & save" asks the access service what saving would do, against the matrix as stored now — changes after locks, the active accounts each changed role holds, PHI grants, and capabilities no role would hold — and the dialog shows that answer, not the editor's diff. Apply waits for it: while checking it is disabled; a failed check says so ("Couldn't check this change … Nothing has been saved") with *Check again*; an orphan or a change set emptied by locks withholds it. When the answer includes cells this editor never touched, another administrator saved meanwhile, and the dialog says applying would undo their change before Apply rather than after (the 409 merge dialog still follows). The success toast quotes the server's counts. The demo adapter computes the same answer locally (`localMatrixPreview`). Tests: adapter (+2: whole grid sent and the answer read field for field; an unknown capability or role is a malformed answer), live panel (+3: server's counts shown and no `PUT` until Apply, then `confirm: true` on revision 4; a failed check withholds Apply and *Check again* recovers; an orphan withholds Apply), `permissions.test.ts` (+2: a locked cell drops out; reach and orphan counted). Panel tests changed because their premise changed: the review now resolves asynchronously, and in the two concurrent-edit tests the dry run correctly lists undoing the other administrator's cell ("Apply 2 changes", with the new warning asserted). Mutation check: feeding the dialog the editor's own diff fails 2 of the 3 live tests. Backend parity specs that read `permissions.ts` (`permission-catalogue.spec.ts`, `seed-parity.spec.ts`) 21/21 and backend `typecheck` clean. Browser (Playwright + Chromium, mock bundle, signed in as `admin@`) 9/9: granted *View medical records* to Reception → review shows the dry run's reach and the PHI call-out, Apply enabled once it is in; no horizontal scroll at 375 px; axe WCAG 2.2 AA 0 violations at 1440 and 375 px; saved; 0 page errors | **Pass 24:** verified live — a cell changed, *Review & save* calls the server dry run (`POST /roles/matrix/preview`) and writes nothing, *Apply* writes (`PUT /roles/matrix`), the change survives a reload, the revert restores the baseline. Before: Live run (F33) | — | No |
| ADM-09 members | Per-role member list (UX §3.9) | — → **COMPLETE_VERIFIED** (audit, 2026-10-23) | Found untracked by the audit: §3.9 names it, nothing built it. The matrix now carries an "Accounts by role" strip — one link per role, `Doctor · N active` → `/admin/settings/users?role=doctor` — and the Users panel's role filter lives in `?role=` (an unknown value reads as "All roles"; choosing "All roles" removes the parameter). The member list is the existing Users panel filtered, not a second copy. `PermissionMatrixPanel.test.tsx` (+1), `live-access.test.tsx` (+3; 2 fail on the pre-change code, the third guards the fallback). Browser (demo bundle, 1440 and 375 px): five links with the right targets, Laboratory → only Laboratory accounts with the filter showing it, All roles → query removed; axe WCAG 2.2 AA on the panel 0 violations; zero page errors (§18.3) | G-1 (live `GET /admin/users?role=` is contract-tested, not run) | Each role reaches its accounts; the filter survives reload and back | No |
| ADM-09 custom roles | Custom role from a base template (UX §3.9) | — → **BLOCKED_DECISION** (audit, 2026-10-23) → **IMPLEMENTED_UNVERIFIED** (pass 5, DEC-013) | **Pass 5:** the roles panel lists every role from `GET /roles` (platform and custom, base role, member counts) and creates one through `POST /roles` — name, code, base role with no default, the server's rules checked first (`role-rules.ts`), its 409 shown in its words; custom roles are labelled in the Users panel but not offered for assignment. Sign-in names a role the client cannot place (`UnsupportedRoleError`, five locales) and signs the server session out, on login, OTP and restore. Tests: role-rules 6, demo adapter +3, live adapter +4, `RolesSection` 4, login page +1, auth adapter +2. Browser (demo): created "Ward clerk" from Reception; axe clean. Unverified by rule: never run live (F33). *Before:* was recorded only in ADM-09's narrative as "not done". The API serves it — `POST /roles` `{ code, label, baseRole }` (API §15.4, `roles.controller.ts`, on `main`) — so the backend is not the blocker. The client is: `ROLES`, the guards, the workspaces and the sign-in adapter know five roles, so a custom role assigned to anyone would be refused at sign-in or land with no workspace — DEC-006's defect | Live run (F33); a custom-role account's web workspace needs the session to name its base role — backend, §19.5 | Create from a base; the list shows it | No |
| ADM-01, ADM-04, ADM-06, ADM-07, ADM-08, ADM-10, ADM-11, AC-01…AC-16 | Overview, patients, communications, logs, reports, PHI, clinic sections | MOCK_ONLY → MOCK_ONLY | "Not connected yet" live | API-W05…W13. On `backend`, single-tenant: `/administration/*` (M23, 50 routes), `/audit-events` (M28), `/admin/conversations` and `/admin/message-flags` (M20.7), and **`POST /patients/:id/reveal`** (M7.3, PR #87 — the audited server half of ADM-10, atomic with its audit row). None is hospital-scoped, so none is wired (DP-02's rule) *(2026-10-25, §20)* | — | No |
| NEW-14 | Invitation dialog roles that cannot sign in (F42) | NOT_STARTED → IMPLEMENTED_UNVERIFIED → **COMPLETE_VERIFIED** (pass 3; Browser (pass 3): each of the three signs in to its own home and h1, states what is unavailable, shows only its navigation, a masked directory with no reveal, Forbidden on the doctor area, the admin area and another workspace, `/settings/profile` → Account; reception has no administrative cancel; the lab catalogue lists tests. **Defect found and fixed (NEW-17):** each was captioned "MD, FACP" in the sidebar) | DEC-006a: `/reception`, `/laboratory`, `/pharmacy` workspaces — `app/router/staff-workspaces.test.tsx` (sign-in, role navigation, guards, settings filter, no admin cancel), `features/staff/directory/masked-directory.test.tsx`, `LabCataloguePage.test.tsx`, `routes/workspaces.test.ts`, `app/router/staff-permissions.test.ts`, auth adapter accepts the three roles | Live run (G-1); orders, dispensing and booking wait on BR-DEC-006 | A valid staff account signs in, lands in its own workspace, and is offered nothing the server refuses it | No |
| NEW-15 | Admin "My Settings → Profile" 404 (F41) | NOT_STARTED → COMPLETE_VERIFIED | DEC-007 A: `profile` added to `PRACTITIONER_SETTINGS_SECTIONS`; My Settings opens on Account; `staff-workspaces.test.tsx` (+3, and the DEC-005 admin case now expects Account) — the admin case fails with the fix removed (checked); browser on the mock-mode demo bundle: admin `/admin/preferences/profile` → `/account`, Profile absent from the nav, `/admin/preferences` → `/account`, `/admin/profile` unchanged, doctor keeps Profile | Live run (G-1) | An admin is never offered the practitioner profile form; a doctor still is | No |
| F35 | Oversight "complaint" flag | BLOCKED_BACKEND → BLOCKED_BACKEND | Backend flag never fires | Backend source of truth | — | No |

*ORG-02/ORG-03 moved to §13.6 on 2026-10-26: their status is WEB-14/WEB-15's (§8 rule 9).*

### 13.5 Quality (§10.5)

| ID | Feature | Before → After | Evidence | Remaining | Input? |
| --- | --- | --- | --- | --- | --- |
| Q-01 | Lighthouse run | NOT_STARTED → DEFERRED → PARTIAL (pass 3) → PARTIAL (pass 4: authenticated routes audited; performance blocked by NEW-22) → PARTIAL (DEC-012: `/login` scored) → **COMPLETE_VERIFIED** (audit, 2026-10-23: authenticated routes scored, desktop and mobile) | Pass 3: `/login` a11y 100. Pass 4: headed Chromium under Xvfb over a persistent context, so the demo session ("Remember me" → `localStorage`) reaches the tab Lighthouse opens — the pass-3 attempt used an isolated context, which is why it was bounced to `/login`. On the production-mode mock build, before → after NEW-21, simulated throttling, desktop: `/doctor/overview` FCP 1.8 → 1.4 s, `/doctor/appointments` 1.8 → 1.7 s, `/doctor/medical-records` 1.9 → 1.6 s; accessibility 100 and best practices 100 on every one, both builds; CLS 0. Performance score and LCP were not obtained; the cause was NEW-22. **DEC-012 (2026-10-23):** `/login` on the deployed demo bundle (`build:demo`), a fresh profile so the intro plays, Lighthouse 12.8.2, simulated throttling, three runs each — desktop **100 / 100 / 100**, LCP 0.7 s; mobile **84 / 85 / 86**, LCP 3.4–3.5 s; CLS 0. The same runs on the pre-fix bundle: `NO_LCP` and no score, all six (§17). **Audit (2026-10-23, §18.4):** pass 4's method — Lighthouse 12.8.2 over CDP into a headed Chromium (Xvfb) whose persistent context holds the remembered demo session, storage reset off, so each audit's fresh tab is signed in and the intro plays — on the production-mode mock build served **gzip-compressed** (as Vercel serves; a first run without compression scored mobile 60–64 and was discarded as a harness artefact), simulated throttling, 3 runs per cell. Desktop: `/doctor/overview` **99/99/99**, `/doctor/appointments` 96/96/96, `/doctor/medical-records` 97/98/98, `/doctor/patients` 97/97/97; LCP 0.8–1.1 s; CLS ≤ 0.010. Mobile: overview **83–86** (LCP 3.4–3.8 s), appointments 78–79 (4.2–4.3 s), medical records 78–82 (4.0 s), patients 82–83 (3.8 s); TBT ≤ 171 ms; CLS ≤ 0.089 (records, 2 of 3 runs — under the 0.1 threshold). Accessibility **100** on all 24. Best practices 100, except **96** on mobile appointments and patients: `font-size`, caption text at 11 px — NEW-23, DEC-017 | No performance budget exists in any project document, so these are recorded, not judged (§18.5); caption size is NEW-23 | — |
| NEW-23 | Caption text below the DS size | — → **BLOCKED_DECISION** (audit, 2026-10-23) → **COMPLETE_VERIFIED** (pass 5, DEC-017 C) | **Pass 5:** `--text-caption` is 12 px under `(pointer: coarse)`, 11 px with a mouse; DS §3.2 now records the implemented scale. `caption-size.test.ts` (3). Browser: 11 px over 75 captions with a mouse, 12 px over 114 under touch emulation; Lighthouse mobile best practices **100** on `/doctor/appointments` and `/doctor/patients` (96 before), a11y 100. *Before:* found by Q-01's mobile run: Lighthouse `font-size` fails on mobile `/doctor/appointments` and `/doctor/patients` — `.text-caption` is 11 px and 46.67 % of the text on the patients list, leaving 48 % at ≥ 12 px against the audit's 60 %. `DESIGN_SYSTEM.md` §3.2 specifies 12 px; `tokens.css` sets 11 px deliberately ("enterprise-dense") and the DS was never amended. Not a WCAG failure (WCAG sets no minimum size) | — | DS and token agree; mobile best practices 100 | No |
| Q-02 | Bundle before/after | NOT_STARTED → DEFERRED → **COMPLETE_VERIFIED** (pass 3; figures updated pass 4) | Method (both passes): `npm run build`; eager JS = the entry `<script>` plus every `<link rel="modulepreload">` in `dist/index.html`, gzip level 9 per file. Pass 3 found eager JS 207.40 kB gzip against DX-06's 134.03 (+55 %); pass 4 reproduced it (207.36) and NEW-21 brought it to **170.33 kB** (entry 127.58 → 90.54). Full table in §16.3 | — | No |
| Q-03 | "No dead buttons" | PARTIAL → PARTIAL (pass 3: narrower) → **COMPLETE_VERIFIED** (audit, 2026-10-23) | §11 click sweep; NEW-06/07 found here. Pass 3 swept every `navigate(routes.doctor.*)` that has a patient in hand and drops it: fixed the patient row (message, schedule, labs `?patientId=`, prescriptions, record), the appointment row and drawer (message) and the patients-list "New appointment" (opened the book, not the dialog); every other record/lab/prescription quick action already carried `?patient=`. **Audit (§18.2):** a TypeScript-AST scan of all 437 non-test `.tsx` files finds no `<Button>`, `<IconButton>` or `<button>` without an action (21 candidates, all `Dropdown` triggers, which `cloneElement` wires) and no empty or "coming soon" handler; the per-surface admin review the row asked for is a browser sweep that clicked every enabled button in `<main>` and judged each by URL, DOM, download or popup change — see §18.2 for route and click counts — 0 inert, zero page or console errors | — | No |
| NEW-21 | Initial-JS regression (+55 % since DX-06) | — → NOT_STARTED (pass 3) → **COMPLETE_VERIFIED** (pass 4) | Three causes fixed at source: feature barrels re-exported things that reach a service (`AvailabilitySection`, `LabCataloguePage`, `useAttachableRecordsQuery`), so the services' top-level side effects kept them in the entry — now a lazy component (Settings' section skeleton as fallback), a route loader and a query that imports the service when it runs; the doctor's search provider imported the index on every doctor page — now the index's code waits for the field's first engagement, as its data already did (D-26), with `pending` reported meanwhile; and all five locale catalogues loaded — now English only, the rest on demand behind a `Record<Locale, loader>` that keeps them total, with `main.tsx` loading a stored language before first render. Eager JS **207.36 → 170.33 kB gzip (−17.9 %)**; JS actually requested on a cold load: signed-in `/doctor/overview` **308.70 → 234.71 kB (−24.0 %)**, `/login` 253.44 → 216.44 (−14.6 %) — §16.3. Tests: `DoctorShellSearchProvider.test.tsx` (3), catalogue tests on the async loader; full suite green. Browser (14/14): runtime language switch (each catalogue fetched once, focus kept, survives reload), deferred search with Enter to a result, lazy Availability, attach-to-record with the lazily loaded record service, lab catalogue | Remaining eager weight is the shell's genuine dependencies (§16.3) | Material improvement on a reproduced baseline, measured by what the browser downloads | No |
| NEW-22 | Brand intro suppresses LCP | — → BLOCKED_DECISION (found in pass 4; DEC-012) → **COMPLETE_VERIFIED** (DEC-012, 2026-10-23) | Was: the app faded in from opacity 0 beneath `MedoraIntro`, and Chrome does not report a paint at opacity 0 as contentful — 0 LCP entries on a fresh session. **Fixed (DEC-012 B):** the app renders at full opacity under the overlay, whose own fade is the reveal; `App.tsx` no longer wraps it, and `MedoraIntro.css` no longer has `medora-app-reveal`. `MedoraIntro.test.tsx` fails if anything outside `.medora-intro` starts at `opacity: 0` (checked against the pre-fix stylesheet: it fails, naming `.medora-app-reveal`). Browser: fresh-session runs with an LCP entry, `/login` and `/doctor/overview` at 1280 × 800 and 375 × 812, 7 each — **0 / 28 before, 28 / 28 after**, medians 236–304 ms, matching the intro-already-played control. Lighthouse `/login`: `NO_LCP` → desktop 100, mobile 84–86 (§17) | Owner's sign-off on the reveal frames (§17.3) | No |
| NEW-35 | Live components no test had rendered | — → **COMPLETE_VERIFIED** (pass 19, 2026-11-03) | Found by pass 19's coverage run (85.5 % of lines overall). Three shipped components where a silent regression would reach a patient or mislead a doctor now have tests. **`ReasonDialog`** (6.5 % before) is the confirm for rejecting a request or cancelling a visit, which notifies the patient. Its 6 tests pin: no send without a reason; the chosen reason and typed details are sent once; *Keep appointment* sends nothing; an in-flight write cannot be dismissed or confirmed again. **`SafetyWarningsSection`** (13.8 %) shows the prescription's server-sent safety checks. Its 3 tests pin: a critical warning is an alert with no dismiss control (DS §8.22); every warning names its check; info is a status; the server's order is kept; "no warnings" appears only for an empty list. **`AvatarMenu`'s theme toggle** (PRs #160/#161, never tested; `AppNavbar.test.tsx` stubs the menu) has 4 tests over the real `ThemeProvider`: one item showing the theme on screen, flipping it and back, and a stored `system` preference flipping against the OS. Tests only; no component changed. *(2026-11-03: NEW-36 replaced the toggle with a pill, and with it these four tests, which now pin the pill — see NEW-36. The `ReasonDialog` and `SafetyWarningsSection` tests are unchanged.)* Browser (mock-mode dev server, Chromium): the toggle reads *Light theme*, a click sets `html.dark`, and it then reads *Dark theme*; 0 page errors | Other live components still have no test, among them `CommunicationCenter`, `ChatWorkspace`/`MessageComposer` (messaging, `MOCK_ONLY`), `SecuritySection`, `AccountSection`, `AccessibilitySection`, `PreferencesSection`, the calendar views, `UtilizationHeatmap`, and the record, lab and patient export builders. They are recorded here and not built. Stale and unchanged: `SafetyWarningsSection`'s header still calls its warnings "canned placeholders", though live builds read them from the server | No |

### 13.6 Multi-hospital realignment rows

**No status is kept here — 2026-10-26.** Multi-hospital frontend tasks have one status register, [`CLIENTS_CHECKLIST.md`](../docs/multi-hospital/CLIENTS_CHECKLIST.md), rows WEB-1…WEB-16. Every row and ⚠ note in this file that tracks the same work names its WEB row below and keeps no status of its own (§8 rule 9), so a WEB row closing needs no edit here. Nothing in this section is counted in §13.1, and no total in this file includes a WEB row.

*Until 2026-10-26:* "The fourteen ⚠ rows in §3–§5 (API-W01…W14) are **BLOCKED_BACKEND** before and after, owned by `docs/work-phases/` Phases 21–26. They are not counted again above." ORG-01 (§13.2) and ORG-02/ORG-03 (§13.4) were counted in the register.

**Moved from the register**, cells unchanged except Status, so the IDs cited by older commits, PRs and §18–§22 still resolve (§8 rule 4):

| ID | Feature | Status | Evidence | Remaining / dependency | Acceptance | Input? |
| --- | --- | --- | --- | --- | --- | --- |
| ORG-01 | Hospital context in session | ↗ **WEB-1, WEB-2** (with WEB-4, WEB-5). *Was, in §13.2:* `BLOCKED_BACKEND → BLOCKED_BACKEND` | §9.1 API-W01 | Phase 22 | Per §9.1 | No |
| ORG-02, ORG-03 | Locations; platform console | ↗ **WEB-14** (locations), **WEB-15** (platform console). *Was, in §13.4:* `BLOCKED_BACKEND → BLOCKED_BACKEND` | §9.1 | Phase 26 | — | No |

**The §9.1 dependencies and the §3 ⚠ notes, by WEB row.** §9.1 stays the list of what the API must provide; the frontend work each dependency blocks is the WEB row's. Rows that stay in §13.2–§13.5 — A-08, D-26, D-27/27b/28 and the ADM-0x / AC-xx rows — keep their own status for their own Feature cell; only their hospital-scoping remainder is the WEB row's.

| §9.1 | Frontend work it blocks in this file | Status in `CLIENTS_CHECKLIST.md` |
| --- | --- | --- |
| API-W01 | ORG-01; A-08's hospital-admin / platform-admin split | WEB-1, WEB-2, WEB-4, WEB-5, WEB-16 |
| API-W02 | §3.1, §3.2, §3.3, §3.4, §3.6, §3.8, §3.11 ⚠ notes | WEB-3, WEB-4 |
| API-W03 | §3.4, §3.12 ⚠ notes | WEB-6 (employment replaces affiliations, DR-02) — **per-location availability and the location picker / timezone: no WEB row** (below) |
| API-W04 | §3.3, §3.7 ⚠ notes | Withdrawn (DR-03). This hospital's record: WEB-8; cross-hospital data only under a grant or Break-Glass: WEB-10, WEB-11 |
| API-W05 | D-27b, AC-01…AC-13, ADM-01, ORG-02 | WEB-14 |
| API-W06 | ADM-02, ADM-03 | WEB-14 |
| API-W07 | ADM-04 | WEB-14 ("oversight" — by reading; to confirm) |
| API-W08 | ADM-05 | WEB-14 |
| API-W09 | §3.9 ⚠ note; ADM-06 | WEB-3 (doctor messaging); WEB-14 (oversight — by reading; to confirm) |
| API-W10 | ADM-07 | WEB-14 (hospital logs), WEB-15 (platform logs) |
| API-W11 | ADM-08 | WEB-14 |
| API-W12 | ADM-09, ORG-02 | WEB-14 |
| API-W13 | ORG-03, AC-14 | WEB-15 |
| API-W14 | D-26 | WEB-3 |

**WEB rows no §9.1 dependency names — added 2026-11-22.** Listed so each is explicit here; the status is `CLIENTS_CHECKLIST.md`'s, and none is counted in this file. Verified read-only on `backend/src` and `backend/prisma`: no grant, consultation or Break-Glass route exists (the ADR-010 `PatientAccessGrant` table has no route, and is single-hospital), and no slot-publishing route exists (`/me/availability` is working hours; `propose-slots` is per appointment).

| WEB row | Frontend work it names | Status in `CLIENTS_CHECKLIST.md` |
| --- | --- | --- |
| WEB-7 | Publish and withdraw online slots (capacity 1), separate from working hours | Blocked — Phase 24: no slot-publishing route |
| WEB-12 | Hospital Admin: incoming access queue; approve, reject, revoke; access-event log | Blocked — Phase 22A: no grant route |
| WEB-13 | Doctor: cross-hospital consultation workspace | Blocked — Phase 22A: no consultation or grant route |
| WEB-13a | Doctor: Break-Glass start, countdown banner, early end | Blocked — Phase 22A: no Break-Glass route |
| WEB-13b | Hospital Admin: Break-Glass notifications, revoke, post-event review | Blocked — Phase 22A: no Break-Glass route |

**Named by no WEB row — reported 2026-10-26, not added.** Per-location availability (§3.12 ⚠ note, API-W03) and the location picker on create with location-timezone display (§3.4 ⚠ note). Those two notes keep their open box in §3 until the owner approves a WEB row or drops the requirement; a new WEB row is not this file's to add (§8 rule 9).

### 13.9 Verification of this pass

Gate on `5084ee4`: `typecheck` 0 errors · `lint` 0 errors, 20 accepted warnings · `test` 199 files / 2,100 tests passed (baseline 192 / 2,055) · `build` passed. The D-07 live test and the F34 login test were each run against the pre-fix code and fail there. **No browser check was run in this pass** (time-boxed by the owner), so NEW-01/02/03/09/11 stay `IMPLEMENTED_UNVERIFIED` until a mock-mode browser run of each flow; NEW-06/07 were found and not started.

**DEC-001/003/004/006a gate (2026-10-21, branch `claude/frontend-owner-decisions`):** `typecheck` 0 errors · `lint` 0 errors, 20 accepted warnings · `test` 206 files / 2,168 tests passed · `build` passed.

**DEC-008 gate (2026-10-21, same working tree):** `typecheck` 0 errors · `lint` — **correction (2026-10-22):** ESLint passed with 0 errors and the 20 accepted warnings, but the second half of `npm run lint`, `scripts/check-retired-tokens.mjs`, **failed** after DEC-008 and the report missed it (the run was read through a filter that showed only ESLint's summary). Its field-width check read the icon inside `PasswordInput`/`SearchInput`'s `trailingElement` (`h-5 w-5`) as a width on `<Input>` once the in-field button's literal `className` became `FIELD_ACTION_CLASSES`. Fixed in the DEC-009 pass by making the scanner read only the tag's top-level `className`; it still flags a real `<Input className="w-44">` (checked) · `test` 212 files / 2,221 tests passed · `build` passed.

**DEC-009 gate (2026-10-22, same working tree):** `typecheck` 0 errors · `lint` exit 0 — ESLint 0 errors, 20 accepted warnings; token check clean · `test` 214 files / 2,246 tests passed · `build` passed.

**DEC-005 gate (2026-10-21, same working tree):** `typecheck` 0 errors · `lint` 0 errors, 20 accepted warnings · `test` 210 files / 2,201 tests passed · `build` passed. No browser run and no live run for these decisions; their rows stay `IMPLEMENTED_UNVERIFIED`.

**Pull-request gate — `claude/frontend-design-system-i18n` (DEC-008–DEC-011 on `frontend` alone, 2026-10-22):** `typecheck` 0 errors · `lint` exit 0 — ESLint 0 errors, 20 accepted warnings; token check clean · `test` 203 files / 2,152 tests passed · `build` passed. Each of the branch's three code commits passed the same gate on its own. No browser or live run on this branch; the browser checks recorded in §14.1 were made on the combined tree.

**Pull-request gate — `claude/frontend-staff-workspaces-settings` (DEC-005–DEC-007, stacked on `claude/frontend-design-system-i18n`, 2026-10-22):** `typecheck` 0 errors · `lint` exit 0 — ESLint 0 errors, 20 accepted warnings; token check clean · `test` 212 files / 2,225 tests passed · `build` passed. Each of the branch's three code commits passed the same gate on its own. No browser or live run on this branch; the DEC-007 browser check in §14.1 was made on the combined tree. The backend suite, which CI also runs because `frontend/src/types/auth/` changed here, could not be run locally.

**Pull-request gate — `claude/frontend-clinical-records-prescriptions` (DEC-001–DEC-004, stacked on `claude/frontend-staff-workspaces-settings`, 2026-10-22):** `typecheck` 0 errors · `lint` exit 0 — ESLint 0 errors, 20 accepted warnings; token check clean · `test` 215 files / 2,288 tests passed · `build` passed. Each of the branch's three code commits passed the same gate on its own. No browser or live run on this branch. Passing tests do not make the server enforce anything: BR-DEC-001 to BR-DEC-004 are unimplemented, and DEC-001 is blocked for production release until BR-DEC-001 is implemented and verified.

**Pass 3 gate (2026-10-22, `frontend` @ `a0142ea`, uncommitted working tree):** `typecheck` 0 errors · `lint` exit 0 — ESLint 0 errors, 20 accepted warnings; token check clean · `test` **221 files / 2,318 tests passed** (baseline on the untouched commit: 215 / 2,288) · `build` passed. Browser: 128 scripted checks on the mock-mode demo bundle (§15.2), 127 passed and zero page errors; the one failure is a wrong expectation in the script, not the app (§15.2). Not run: a live API (G-1), a screen reader, WebKit/Firefox, a physical device.

**Pass 4 gate (2026-10-22, branch `claude/frontend-completion-pass-3`, the tree of the pull request):** `typecheck` 0 errors · `lint` exit 0 — ESLint 0 errors, 20 accepted warnings; token check clean · `test` **224 files / 2,346 tests passed** · `build` passed. Browser on the mock-mode demo bundle: chart 27/27 at 1440 and 375 px, pharmacy and records 20/20, record edit 7/7, staff/availability/reports 48/48, NEW-10 cancel + toast 26/26 at both widths, lazy paths 14/14 — zero page errors; axe WCAG 2.2 A/AA on 27 routes at both widths, plus a page with a toast on screen at both widths: no violation beyond the experimental avatar `label-content-name-mismatch` dismissed in §15.3. Not run: a live API (G-1), a screen reader, WebKit/Firefox, a physical device.


---

## 14. Decision log — DEC-xxx

Asked 2026-10-21. Each records the question, the options, the recommendation, and — once given — the owner's answer, which then governs. An unanswered decision blocks only the rows that cite it.

| ID | Question | Options | Recommended | Rows | Answer |
| --- | --- | --- | --- | --- | --- |
| DEC-001 | Chart notes: the server's edit and sign do not check the author | A wait for backend · B create + edit-unsigned now, sign later · C all, client-side author rule | B | §3.3 notes | **APPROVED — C, with conditions** (2026-10-21; see §14.1) |
| DEC-002 | Prescriptions: Discontinue (stop therapy) vs Cancel (withdraw) | A status picks the act · B both, doctor chooses · C discontinue only | A | NEW-10 | **APPROVED — A** (2026-10-22; implemented, see §14.1) |
| DEC-003 | Resolving an alert, removing a history event, removing a contact | A all three, confirmation · B alert + contact only · C reason kept in session only | A | NEW-04 | **APPROVED — D (custom)** (2026-10-21; see §14.1). History edit/remove BLOCKED on BR-DEC-003 |
| DEC-004 | Editing a medical record (`PATCH`, versioned) | A drafts only, amend after · B draft or active · C amend only | A | NEW-12 | **APPROVED — A** (2026-10-21; see §14.1) |
| DEC-005 | Weekly availability editor | A build, warn about stranded appointments · B build, no warning · C wait for backend | A | NEW-08 | **APPROVED — A** (2026-10-21; implemented, see §14.1) |
| DEC-006 | Invitation roles that cannot use the web client | A remove until they have a workspace · B keep with warning · C build workspaces | A | NEW-14 | **APPROVED — C**, scope **DEC-006a — A** (2026-10-21; implemented, see §14.1) |
| DEC-007 | Admin "My Settings → Profile" | A hide for non-practitioners · B read-only · C keep as is | A | NEW-15 | **APPROVED — A** (2026-10-22; implemented and browser-verified, see §14.1) |
| DEC-008 | Mobile touch targets (DS 44 px vs 32 px primitives) | A keep 32 px · B invisible 44 px hit area on touch · C 44 px controls | B | F-14 | **APPROVED — B**, with safety requirements (2026-10-21; implemented and browser-verified under emulation, see §14.1) |
| DEC-009 | Digits and dates in Arabic / Persian | A Latin digits everywhere · B native digits in interface text only · C native digits everywhere | A | F-19 | **APPROVED — A** (2026-10-22; implemented and browser-verified, see §14.1) |
| DEC-010 | Calendar system for Persian (and Arabic) | A Gregorian everywhere · B Solar Hijri for Persian · C both side by side | A | F-19 | **APPROVED — A, closed** (2026-10-22; no code change, see §14.1) |
| DEC-011 | Decimal and grouping separators (French, Turkish) | A keep `1,234.5` · B dot decimal, thin-space thousands `1 234.5` · C each language's own | B | F-19 | **APPROVED — B** (2026-10-22; implemented and browser-verified, see §14.1) |
| DEC-012 | The brand intro suppresses LCP on every fresh session (NEW-22) | A keep as is, accept no first-visit LCP · B keep the intro, reveal the page's content immediately beneath it (no opacity-0 start) · C play it only on the sign-in page · D remove it | B | NEW-22, Q-01 | **APPROVED — B** (2026-10-23; implemented and browser-verified, see §14.1 and §17) |
| DEC-013 | Custom roles from a base template (UX §3.9) — the API serves `POST /roles`, the client knows five roles | A defer to the platform console (ORG-03) · B create in the matrix, a custom role signs in with its base role's workspace (needs the session to carry the base role — backend) · C create in the matrix, but never offer a custom role for assignment until B exists | A | ADM-09 custom roles | **RESOLVED — C, plus a named sign-in refusal** (2026-10-24, pass 5 under the owner's instruction to resolve it; see the record and §19.3) |
| DEC-014 | Component stories (F-09) and whether axe blocks CI | A keep "next touch" for stories, axe stays local · B write the remaining Tier 1–2 stories now in one pull request, run Storybook's axe in CI as advisory · C B, and make axe failures block the merge | B | F-09 | **Stories done** (2026-10-24, pass 5); **CI half open** — the owner's policy (§19.4) |
| DEC-015 | Sticky first column on wide tables (DS §8.19; §11.4) | A leave unbuilt — the scroller and `rowHeader` already carry the patient · B make the dark `*-subtle` tokens opaque · C express row tints as an inheritable background layer (`getRowClassName` contract) | A | §11.4 | **RESOLVED — C** (2026-10-24, pass 5; see the record and §19.3) |
| DEC-016 | Record "Share" (D-22) | A close D-22 as "copy link" — the recipient still needs their own access, which the server enforces · B design a share-with-colleague flow (needs a sharing policy and an endpoint) | A | D-22 | **RESOLVED — A** (2026-10-24, pass 5; see the record and §19.3) |
| DEC-017 | Caption text is 11 px; DS §3.2 says 12 px, and Lighthouse fails mobile "legible font sizes" on it | A keep 11 px, amend DS §3.2 · B 12 px everywhere, as the DS says · C 12 px on a coarse pointer, 11 px with a mouse (DEC-008's pattern) | C | Q-01, NEW-23 | **RESOLVED — C** (2026-10-24, pass 5; see the record and §19.3) |
| DEC-018 | Documents: what the live tab does while `/health` cannot report storage (the backend registers no storage indicator, so it reads `unconfigured` even with a store configured) | A gate on `/health`, as built: no actions until the backend adds the indicator · B offer the actions in every live build, and report a 503 on each click · C a build-time flag the deployment sets | A, plus the backend indicator | D-04 / D-04b | **OPEN** (asked 2026-11-01, pass 16; A is implemented; see the record and §33) |
| DEC-019 | `react-router-dom@6.30.4` carries three advisories, one of them an **open redirect leading to XSS** (GHSA-jjmj-jmhj-qwj2, CVSS 6.9, `C:H`, range `>=6.30.2 <=6.30.5`). The client's own `returnTo` guard is fixed (§34.2), but the router is still the version named | A **patch bump inside 6.30.x** — 6.30.6 leaves the XSS advisory's range and is the smallest change that clears the worst of the three · B upgrade to **7.18+**, which is the only version clear of all three (the backslash and SSR-hydration advisories run `<7.18.0`) — a major, and v7 changes the router's API · C stay on 6.30.4 and rely on the client-side guards alone | **A now, B scheduled.** A is a patch within the installed minor; the remaining two advisories need `<Link>`/`useNavigate` to be handed an off-site target, which §34.2 now refuses at both of this app's entry points | A-01, §34 | **RESOLVED — A** (2026-11-03, owner authorized the patch bump; built in pass 18, §35. B, the 7.18+ major, stays scheduled and is not started. Asked 2026-11-01, pass 17) |

### 14.1 Decision records

*Split for review (2026-10-22).* These records were written against one combined working tree, `claude/frontend-owner-decisions`. The work was then split into three stacked pull requests into `frontend`: design system and internationalisation (DEC-008–DEC-011); availability, staff workspaces and admin settings (DEC-005–DEC-007); clinical records and prescription actions (DEC-001–DEC-004). Test counts, gate lines and browser checks inside a record were measured on that combined tree; each pull request's own gate is in §13.9. Where a record mentions a screen from another pull request — the DEC-008 audit measured the availability editor and the chart dialogs, for instance — it describes the combined tree.

#### DEC-001 — Patient chart notes: create, edit, sign · **APPROVED** (2026-10-21)

- **Question.** The chart's Notes tab is read-only. The backend serves create, edit-unsigned and sign (`/patients/:id/notes`), but its edit and sign do not check the author (`patient-tabs.repository.ts` `updateUnsignedNote` / `signNote` match only `patientId` and `signed: false`). Build now, partly, or wait?
- **Selected.** Option C, as a development plan: Medora is not deployed and will not be until the backend is complete.
- **Agreed behaviour.**
  1. The frontend builds create, edit-unsigned and sign for chart notes.
  2. Edit and Sign are offered only where the available data says the current user may act: the note is unsigned **and** its `author` equals the signed-in user's id. Both are `users.public_id` live (`session-user.service.ts` issues `id: user.publicId`; `toNoteView` returns `author: row.author.publicId`), so the comparison is exact rather than by display name. Everyone else's notes show neither control.
  3. The UI and code state plainly that these restrictions are display rules, **not** authorization.
- **Mandatory backend requirement (BR-DEC-001).** `PATCH /patients/:id/notes/:noteId` and `POST …/notes/:noteId/sign` must refuse a caller who is not the note's author, for direct API requests as well as the UI — as `POST /medical-records/:id/notes/:noteId/sign` already does ("Author only"). Not implemented in this frontend task; backend code is out of scope.
- **Release gate.** Chart-note editing and signing is **not production-ready** until BR-DEC-001 is implemented and verified against a running API. §13 keeps the row below `COMPLETE_VERIFIED` until then.
- **Dependencies and risks.** Until BR-DEC-001 lands, any clinician who can reach a chart can edit or sign a colleague's unsigned chart note through the API; the frontend cannot prevent that. Acceptable only because nothing is deployed.
- **Status.** APPROVED (frontend) · BLOCKED for production on BR-DEC-001.
- **Update 2026-10-24.** BR-DEC-001 is implemented on `backend` (`acc2c7e`, PR #89): edit and sign answer 403 `not_note_author` to anyone but the author. The chart names that refusal, and the mock enforces it. The release gate's backend half is met on `backend`; it reaches production with `backend` → `main`. Register row §3.3 notes.

#### DEC-002 — Cancel vs Discontinue for prescriptions · **APPROVED** (2026-10-22)

- **Question.** ADR-002 §4: `POST /prescriptions/{id}/cancel` ("withdraw") and `…/discontinue` ("stop an active therapy") both write `discontinued`; the audit event (`prescription.cancel` / `prescription.discontinue`) and the timeline (`cancel: …` / `discontinue: …`) record which act it was. The client offered one "Cancel with reason" that always called `/cancel` — stopping a running therapy was audited as a withdrawal — and offered it on drafts, which the server always refuses.
- **Selected.** Option A — the status decides the act.
- **Agreed behaviour.**
  1. `pending-approval` → **"Cancel prescription"**, `/cancel`; the dialog says it is withdrawn before therapy takes effect.
  2. `active`, `dispensed` → **"Discontinue"**, `/discontinue`; the dialog says the active therapy is being stopped.
  3. Unsigned `draft` → neither; the menu says it dispenses nothing and can be left. The missing discard-draft route is **BR-DEC-002**; no backend change here.
  4. The same in the row menus and the detail page's quick actions.
  5. The HTTP adapter and the demo service support the existing `/discontinue`; no new endpoint, no contract change.
  6. A reason is required for either act; the existing vocabulary (`CANCELLATION_REASONS`) and validation are unchanged.
- **Backend contract — checked, no conflict.** Both routes take `{ reason }` (1–300 characters, trimmed); both accept any open, signed status and refuse a draft (409 `draft_not_discontinuable`) or an ended prescription. That the client offers `/cancel` only before therapy starts and `/discontinue` only after is the client's display rule; the server would accept either.
- **Implementation.** `model/selectors.ts` — `endActFor(prescription)`, `END_ACT_LABEL`, `DRAFT_END_NOTE`, replacing `isCancellable` (which had wrongly listed `draft`). `components/end-menu-entries.ts` — the one menu entry both menus use: the act, the disabled draft note, or nothing once ended. The port gains `discontinue(input)`; the HTTP adapter posts each act to its own route with the same stated reason; the demo service mirrors the server — `discontinued`, refills removed, timeline `${act}: ${reason}`, 409 `draft_not_discontinuable` for a draft, 409 `invalid_status_transition` once ended. `useEndPrescriptionMutation` takes the act, and is **pessimistic** (changed 2026-10-22 from optimistic-with-rollback): the row and detail keep their status until the server confirms, a refusal leaves them unchanged with the dialog open and an error toast, and success sets the detail from the server's answer and refetches every prescription query; `usePrescriptionLifecycle` opens the dialog only for the act the status allows; `EndPrescriptionDialog` (was `CancelPrescriptionDialog`) words the title, consequence, record line and confirm button for the act. A test hook, `__putMockPrescription`, lets tests place a prescription in a status the demo cannot reach (no catalogue entry is controlled, so nothing signs into `pending-approval`).
- **Verification.**
  - *Automated tests passed.* `components/end-prescription.test.tsx` (20) — `endActFor` for all seven statuses; for each of the row menu and the detail menu, pending-approval offers only Cancel, active and dispensed only Discontinue, a draft neither (and shows the disabled note), an ended one nothing; confirming a pending one shows the withdrawal wording, keeps the button disabled until a reason is chosen, and calls `cancel` and never `discontinue`; confirming an active or dispensed one shows the stop-therapy wording and calls `discontinue` and never `cancel`. `http-prescription-service.test.ts` (+2) — `/discontinue` is posted (not `/cancel`) with the stated reason; a 409 surfaces as a conflict. `mock-prescription-service.test.ts` (8, rewritten) — each act's status, refills and timeline wording; drafts refused for both acts and left unchanged; ended refused.
  - *Pessimistic ending (2026-10-22, pre-PR fix).* `components/end-prescription.test.tsx` (+6, now 26) — for `/cancel` and for `/discontinue`, over a fake server whose answer the test holds back: the row (list query) and detail (detail query) keep their status while the request is in flight; a refusal leaves both unchanged, shows "Could not cancel/discontinue the prescription — It is unchanged", and keeps the dialog open; a grant changes both to `discontinued` only after the server answers. Checked against an optimistic variant of the mutation: the in-flight and grant cases fail under it.
  - *Not verified.* No browser run and no live run for this decision.
- **Gate (2026-10-22).** `typecheck` 0 errors · `lint` exit 0 — ESLint 0 errors, 20 accepted warnings; token check clean · `test` 215 files / 2,279 tests passed · `build` passed.
- **Gate after the pessimistic fix (2026-10-22).** `typecheck` 0 errors · `lint` exit 0 — ESLint 0 errors, 20 accepted warnings; token check clean · `test` 215 files / 2,288 tests passed · `build` passed.
- **Status.** APPROVED · IMPLEMENTED_UNVERIFIED (automated tests pass; no browser or live run).
- **Update 2026-10-24.** BR-DEC-002 is implemented on `backend` (`17ddda2`, PR #91, ADR-044): `DELETE /prescriptions/{id}` soft-deletes the prescriber's own unsigned draft (204; 409 `prescription_not_draft` past draft; 404 for anyone else's). Item 3 changes accordingly: an unsigned draft now offers **Discard draft** — confirmed, pessimistic, no reason (the server takes none, and a draft dispenses nothing) — instead of the disabled note. Cancel and Discontinue are unchanged. Register row NEW-10.

#### DEC-003 — Resolving alerts; correcting and removing history events; removing contacts · **APPROVED** (2026-10-21)

- **Question.** The chart can add alerts, history events and emergency contacts but not take them back. Which retractions are allowed, and with what safeguards?
- **Selected.** Option D (custom).
- **Agreed behaviour.**
  1. **Clinical alerts.** An authorized clinician may *resolve* an active alert through a confirmation dialog that says resolving removes it from the active banners and does **not** delete its record. Alerts are never permanently deleted.
  2. **Medical history events.** *Edit* (correct an inaccurate event) and *Remove* (an event added in error), each with a **mandatory reason**, preserving the original and its audit history — versioned correction or soft deletion, never irreversible deletion — and marking corrected or removed entries where the data model supports it.
  3. **Emergency contacts.** An authorized clinician may remove a contact through a confirmation dialog that prevents accidental removal and respects the at-most-one-primary rule. A reason is required **if** the backend can record it; otherwise it is part of BR-DEC-003.
  4. All writes pessimistic; no reason is ever described as saved unless the server stores it.
- **What the existing API supports (inspected 2026-10-21, `backend/src/modules/patients`).**

  | Need | Route | Supported? |
  | --- | --- | --- |
  | Resolve an alert, keep its record | `PATCH /patients/:id/alerts/:alertId` `{ active: false }`; the row is kept and `GET …/alerts?includeResolved=true` lists it | **Yes** — no reason field; audit records actor, time and changed field names (`patient.alert_update`) |
  | Edit a history event | — | **No.** `patient-tabs.controller.ts` serves `GET`, `POST`, `DELETE` on `history` and no `PATCH` |
  | Remove a history event with a reason | `DELETE /patients/:id/history/:eventId` | **Partly.** Soft delete with actor and time, but **no body** — a reason cannot be stored — and the global soft-delete filter (`shared/database/soft-delete.ts`) hides removed rows from every read, so a removed entry cannot be shown as removed |
  | Remove a contact | `DELETE /patients/:id/emergency-contacts/:contactId` | **Yes**, soft delete with actor and time; no reason field. Removing the primary leaves no contact primary — the server does not promote another |

- **Frontend outcome.** Built: resolve alert; remove contact (confirmation; warns when the contact is the primary). **BLOCKED on BR-DEC-003, not built:** history edit and history removal — a mandatory reason the server discards would be a faked record, and an edit has no route.
- **Backend requirement BR-DEC-003 (mandatory before history correction ships).**
  1. A history-correction route (e.g. `PATCH /patients/:id/history/:eventId`) that writes a **new version** rather than overwriting, keeping the original readable.
  2. A **mandatory `reason`** on history correction and removal, and an optional-or-mandatory `reason` on contact removal and alert resolution, persisted with the record — not only in a log line.
  3. For every correction, removal and resolution: **actor, timestamp, target record, and before/after values**, in an audit trail that cannot be silently overwritten.
  4. A read that can return removed and superseded history entries, **marked as such**, for clinicians permitted to see them.
  5. **Server-side authorization** on all of the above (who may correct, remove, resolve), effective for direct API calls, not only the UI.
- **Dependencies and risks.** History correction is unavailable until BR-DEC-003. Contact removal and alert resolution record who and when but not why.
- **Status.** APPROVED · alert resolution and contact removal implementable now · history edit/remove BLOCKED (BR-DEC-003).
- **Update 2026-10-24.** BR-DEC-003 is **partly** implemented on `backend` (`0ee2a79`, PR #101): reasons are persisted on history removal (mandatory, 422 without), contact removal and alert resolution (optional server-side). Built: history removal with a mandatory reason; a required reason on contact removal (item 3); an optional reason on alert resolution. Still blocked: history **correction** (no route, point 1) and showing removed entries as removed (no read, point 4). Who may (point 5) is unchanged and remains the owner's. Register rows NEW-04a, NEW-04b.

#### DEC-004 — Editing a medical record after creation · **APPROVED** (2026-10-21)

- **Question.** Records are amend-only. The API's `PATCH /medical-records/:id` edits visit details, narrative and structured fields while the record is `draft` or `active` (`assertEditable`), writes a version row per edit (`GET …/versions`: version, time, actor, summary, `{ field: { before, after } }`), takes no reason, and checks only care scope. How much of that should the client use?
- **Selected.** Option A.
- **Agreed behaviour.**
  1. A record is editable **only while it is `draft` and nothing on it is signed**. After the first signature, corrections are addenda; signed content is never edited. The client offers Edit only on such records — stricter than the server, which also accepts `active`.
  2. The record shows its **version history** — who changed it, when, and before/after values where the server supplies them.
  3. Notes are never edited through this path (they have their own sign/amend flow).
- **What the client cannot do, and why.** It cannot offer Edit to "the record's author only": the record carries the doctor's name and a doctor-table id, neither of which is the session's user id, and a name match would be the attribution-by-name the project refuses (DEC-001). Any doctor with a care assignment to the patient may edit a draft — the server's rule — and that is what the UI reflects.
- **Backend requirement BR-DEC-004.** Server-side author/role authorization on `PATCH /medical-records/:id` (effective for direct API calls), and a reason accepted and persisted with each version row. Not implemented here.
- **Dependencies and risks.** Until BR-DEC-004, edits are attributable (actor, time, before/after) but not justified, and not restricted to the author.
- **Status.** APPROVED · implementable now within the stated limits · production-gated on BR-DEC-004.
- **Update 2026-10-24.** BR-DEC-004 is implemented on `backend` (`2eb3b87`, PR #90): author-only edits (403 `not_record_author`) and an optional, persisted reason per version. The dialog takes an optional reason, the edit history shows it, and the author refusal is named. Edit is still offered to any doctor who can see the draft, because the client cannot tell the author (above); the server's refusal is what enforces the rule. Two points stay the owner's: whether the reason is mandatory, and which roles besides the author may edit. Register row NEW-12.

#### DEC-005 — Weekly availability editor · **APPROVED** (2026-10-21)

- **Question.** `GET`/`PUT /me/availability` serves a seven-day grid (windows and breaks, at most six each a day; default length 15/20/30/45/60; buffer 0–60; overlapping ranges and a break outside every window refused 422 per day; each save audited). The server neither bounds the grid by clinic hours (ADR-005 RA-005.1, undecided; no endpoint serves clinic hours) nor checks existing bookings when the grid narrows. Build it, and how?
- **Selected.** Option A, using the owner's exact decision.
- **Agreed behaviour.**
  1. A weekly availability editor in the doctor's Settings, built on the feature's data-service seam (mock and HTTP behind one port).
  2. All seven days, working windows, breaks, and the server-supported default durations and buffer.
  3. The backend's validation rules, matched, with useful per-day errors.
  4. Before a changed week is saved, upcoming appointments the proposed hours would no longer cover are identified from the doctor's existing appointment data.
  5. They are shown, each linked to its existing rescheduling workflow.
  6. Nothing is cancelled or rescheduled automatically; a save never implies existing bookings were resolved.
  7. Where reliable appointment data is unavailable, the limitation is disclosed rather than the check claimed complete.
  8. BR-DEC-005 records server-side protection against stranded appointments and the open clinic-hours policy RA-005.1.
  9. No clinic hours are invented and no clinic-hour restriction is enforced without an approved policy and an authoritative source.
- **Implementation notes.** Model, port and both adapters live in `features/doctor/appointments` (it owns scheduling and the book); the section is exported from that feature's public API and mounted by Settings as **Availability**, doctors only. The stranded check re-reads the whole book (`GET /appointments`, every page — a book over the page cap fails rather than truncates) and applies the server's booking rules 1–2 to live statuses (`scheduled`, `confirmed`, `pending`, `rescheduled`, `awaiting-patient`) starting after now, marking those the current week did not cover either. Links go to `/doctor/appointments/:id`, whose drawer offers Reschedule (or, for a pending request, Propose other times) as the status machine allows.
- **Known limit (disclosed in the UI).** The server applies working hours in the clinic's timezone (`platform_settings.localization.timezone`), which no client-reachable endpoint serves. The check reads times in the device's timezone — as every appointment screen does — and the review says that, where the two differ, the list can be wrong. Exactness needs BR-DEC-005.
- **Backend requirement BR-DEC-005.** See §9.0. Not implemented here.
- **Dependencies and risks.** Until BR-DEC-005, a doctor outside the clinic's timezone can get an inaccurate list, and a save made through the API directly strands bookings with no warning at all. Per-location availability (API-W03) will reshape the grid.
- **Status.** APPROVED · IMPLEMENTED_UNVERIFIED (unit, component and route-tree tests pass; no browser run, no live run).
- **Update 2026-10-24.** BR-DEC-005 is implemented on `backend` for criteria 1–3, in report mode (`8d9b655`, PR #94): the clinic timezone is served on `GET`/`PUT /me/availability`, and every `PUT` answers with the live appointments the saved week strands, computed in that zone. The known limit above is lifted where the server sends the zone: the preview compares in it and the review names it; after a save the server's report is shown in place of the preview's list. Without the fields (an older server, or the demo) the editor behaves exactly as before and says so. Refuse-vs-report and RA-005.1 remain the owner's. Register row NEW-08.

#### DEC-007 — The admin's "My Settings → Profile" · **APPROVED** (2026-10-22)

- **Question.** `/admin/preferences/profile` reused the doctor's professional-profile form. `GET /me/profile` reads for every role (ADR-036: an admin gets `{ account, patient: null, doctor: null }`), but `PATCH` answers 404 without a `doctors` row, so an admin's save always failed (FE-10 F41) — and it was where My Settings opened. What does an admin see there?
- **Selected.** Option A — the practitioner Profile section is not offered to an administrator.
- **Agreed behaviour.** Profile joins the doctor-only settings sections, the same filter DEC-005 introduced for Availability. My Settings opens on Account. An admin who opens `/admin/preferences/profile` by URL is redirected to Account by the settings page's existing rule (a section it does not offer redirects to the first one it does). Doctors keep the professional profile. The separate `/admin/profile` ("My Profile") page is unchanged.
- **Implementation.** `routes/index.ts` — `PRACTITIONER_SETTINGS_SECTIONS = ['profile', 'availability']`, documented. `app/router/index.tsx` — the My Settings index redirects to `/admin/preferences/account`. No other file changed; no profile or account behaviour beyond that.
- **Verification.**
  - *Automated tests passed.* `app/router/staff-workspaces.test.tsx` (+3): an admin opening the profile URL lands on Account and the settings nav lists no Profile; an admin opening My Settings lands on Account; a doctor still gets the Profile section. The DEC-005 admin case now expects Account. With `profile` taken out of the list, the first test fails (checked, then restored).
  - *Browser-verified.* Chromium against the mock-mode demo bundle, signed in as the demo admin and the demo doctor: `/admin/preferences/profile` → `/admin/preferences/account`; nav: Account, Security, Privacy, Notifications, Appearance, Preferences, Accessibility, Integrations, Activity log, About; `/admin/preferences` → `/admin/preferences/account`; `/admin/profile` still renders "My Profile"; `/doctor/settings/profile` renders Profile with Profile and Availability in the nav.
  - *Not verified.* A live run against the API (G-1). The F41 failure needed the form to be submitted; the form is no longer reachable for an admin.
- **Gate (2026-10-22).** `typecheck` 0 errors · `lint` exit 0 — ESLint 0 errors, 20 accepted warnings; token check clean · `test` 215 files / 2,282 tests passed · `build` passed.
- **Status.** APPROVED · implemented · automated tests pass · browser-verified on the demo bundle. NEW-15 COMPLETE_VERIFIED; F41 resolved.

#### DEC-008 — Touch targets on touch devices · **APPROVED** (2026-10-21)

- **Question.** DS §1/§7.1 asks for 44 × 44 px targets on mobile; every control primitive is compact (28 / 32 / 36 px; fields 32 px; switches 24 px). The app passes WCAG 2.2 AA (24 px or spacing) but not the design system's own rule.
- **Selected.** Option B — invisible hit-area enlargement on touch — with the owner's safety and usability requirements: aim for 44 × 44 on touch; keep the visual appearance where practical; detect the input device, not the viewport; never let a hidden hit area overlap or intercept a neighbour (increase spacing or enlarge the visible control instead); keep the confirmations on Sign, Delete, Remove, Cancel, Resolve and Save, and never rely on size to prevent an accidental clinical action; keep keyboard access, focus rings and accessible names; change no business logic or authorization.
- **How it works.**
  - **Detection.** `@media (pointer: coarse)` — the primary pointer is a finger — exposed to Tailwind as the `touch:` variant (`tailwind.config.ts`). A narrow desktop window keeps mouse-sized controls; a tablet wider than `lg` gets 44 px targets.
  - **Compact controls keep their look** (`.touch-target`, `styles/globals.css`). A control states its gutter, (44 − its size) / 2, as `--touch-y` / `--touch-x`; on a coarse pointer it reserves that as **margin**, and an invisible `::after` fills exactly the margin box. Margin is layout space, so no neighbour can be laid out under another control's hit area: **overlap is prevented by construction**, not by tuning. Applied in the shared builders (`buttonClasses`, `iconButtonClasses`) and to Switch, Checkbox, Radio, Chip remove, Alert dismiss, Modal/Drawer close, Pagination numbers, enclosed Tabs, Breadcrumb, DataTable sort handles, the avatar menu, the PHI reveal glyph, the Settings back link, "Forgot password?" and the security banner's Investigate links.
  - **Controls that must not reserve space grow instead.** An `<input>` takes no pseudo-element, so single-line fields and select triggers are 44 px tall on touch. Stacked rows (menu items, select options, sidebar items, Settings navigation) would overlap if extended, so they are 44 px tall. An in-field button (show password, clear search) becomes the field's last 44 × 44 px. A text button narrower than 44 px widens to it.
  - **Absolutely positioned controls are excluded** from the margin rule (`:not(.absolute):not(.fixed)`) — margin would move them — and handled where placed.
- **Fixed on the way.** Icon buttons shrank to 22–24 px wide in tight flex rows at 375 px (now `shrink-0`). **Collapsed-sidebar links had no accessible name** — only the tooltip described them (the `<button>` branch had `aria-label`, the `<a>` branch did not). At 375 px the availability editor's time fields clipped "PM" to "P" and its remove buttons wrapped under the fields; both corrected.
- **Clinical safety.** No confirmation was removed or weakened; Sign note, Resolve alert, Remove contact, Cancel appointment and the availability review keep their dialogs, and their dialog buttons were measured too. No business logic, authorization or desktop behaviour changed.
- **Verification — three separate statuses.**
  - *Implemented.* As above, on branch `claude/frontend-owner-decisions`.
  - *Automated tests passed.* `components/ui/touch-targets.test.tsx` (16) — each primitive's size plus twice its gutter equals 44; fields, in-field actions, stacked rows; the collapsed-sidebar name. `styles/touch-targets.test.ts` (4) — every `.touch-target` rule and `touch:` utility compiles inside `@media (pointer: coarse)` and nowhere else, and the hit area is inset by exactly the reserved margin. jsdom runs no media queries, so these test the contract, not rendered geometry.
  - *Browser-verified, under emulation.* Chromium (Playwright) with `hasTouch`/`isMobile` against a **mock-mode demo bundle** (`vite build --mode development`, `VITE_ENABLE_MOCKS=true`, `vite preview`). For every visible control, points sampled over the 44 × 44 square centred on it must resolve to it, and points on its visible box must not resolve to a neighbour's hidden area. **375 × 812: 505 controls on 22 screens and states** (login; doctor overview, patients, chart overview and notes, appointments, records, labs, pharmacy, availability, account; admin overview, oversight, staff; reception home and directory; the Resolve-alert, Write-note, Sign-note and availability-review dialogs; two row-action menus) — **0 below 44 × 44, 0 intercepted.** **1024 × 768 touch: 734 controls — 0 and 0.** Baseline before the change: 408 of 502 short. **Desktop (1280, fine pointer):** no gutter margin, no touch pseudo-element, fields 32 px, small buttons 28 px. **axe WCAG 2.1 A/AA: clean on 10 routes in both touch layouts.**
  - *Not verified.* A physical touch device; WebKit / iOS Safari and Firefox for Android (only Chromium was available); every route of the app (22 screens and states were measured, not all). One inline link inside a sentence ("Create one" on the login page) is left at text size under WCAG's inline exception.
- **Dependencies and risks.** On touch, dense tables and toolbars take more room (rows grow by up to 12 px; compact controls gain margin). A new control that hand-rolls its own small hit area outside the primitives will not get a gutter unless it uses `.touch-target`; the 375 px audit is the check for that.
- **Status.** APPROVED · implemented · automated tests pass · browser-verified under Chromium touch emulation on the demo bundle; device and WebKit verification outstanding.

#### DEC-009 — Digits and dates in Arabic and Persian · **APPROVED** (2026-10-22)

- **Question.** Formatting ignored the app's language: ~33 files either hard-coded `'en'`/`'en-US'` or used the browser's language. Once formatting follows the app's language, `Intl` answers Arabic and Persian in native digits (٠١٢٣ / ۰۱۲۳). Which digits, where?
- **Selected.** Option A — Latin digits (0–9) everywhere, in all five languages.
- **Agreed behaviour.** Dates and numbers follow the selected language — month and weekday names, date order — with every digit Latin: dates, times, counts, pagination, doses, lab results, vitals, MRNs, IDs, phone numbers and every other number. Displayed values stay consistent with the server's data and with what inputs accept. One shared formatting module replaces the ad-hoc formatters. **Calendar system and decimal separators are not changed** — separate decisions (DEC-010, DEC-011).
- **Implementation.**
  - `src/i18n/format.ts` — `formatDate`, `formatTime`, `formatDateTime`, `formatDateWith(value, options)`, `formatNumber(value, options)`. Every date formatter is built for the active language with `numberingSystem: 'latn'` and `calendar: 'gregory'` (plus `-u-ca-gregory-nu-latn`). Numbers used the app's existing separators (`1,234.5`) in every language — superseded by DEC-011 (`1 234.5`). Formatters are cached per language and options.
  - The active language is held by the module and set by `LocaleProvider`, because most callers are plain functions (columns, selectors, export builders). A language change remounts the routed tree (`app/LocaleRemount.tsx`) so no string keeps the old language, invalidates cached queries (one demo service builds chart labels at fetch time), and returns focus to the language picker. Session, query cache and theme survive; unsaved on-screen state (a half-typed form) does not.
  - All 50 formatting call sites, in 32 files, now go through the module (`utils/dates.ts` re-exports it). The only remaining `Intl` call outside it reads the device time zone, which is not formatting.
  - Six catalogue strings carried native digits (the 30-minute reset link and two 6-digit code prompts, in Arabic and Persian); now Latin.
- **Behaviour changes worth knowing.** English output is byte-identical wherever a call site passed options. Where a call site passed none (CSV export dates, two toasts, the demo booking message), dates now read `Mar 12, 2026` / `Mar 12, 2026, 14:30` instead of the browser's numeric `3/12/2026` — unambiguous, and the same in exports as on screen. Three integer counts that followed the browser's language now use the app's grouping. Times keep each call site's existing 12/24-hour choice.
- **Verification — three separate statuses.**
  - *Implemented.* As above, on branch `claude/frontend-owner-decisions`.
  - *Automated tests passed.* `i18n/format.test.ts` (24) — for each of the five languages no formatter output contains a native digit, the date is Gregorian with Latin digits, times are `14:30`, numbers keep `1,234.5` / `2.5`; month names are localised (`March`, `mars`, `Mart`, `مارس`); a control case shows bare `Intl` for Persian really does produce native digits and a Solar Hijri year; no catalogue message in any language contains a native digit; and a source scan fails if any file other than `format.ts` formats with `Intl` or `toLocale*String`. `app/LocaleRemount.test.tsx` (1) — a date formatted by a plain function re-renders in Arabic with Latin digits after a switch, caches are invalidated once, focus returns to the picker; it fails with the remount removed (checked).
  - *Browser-verified.* Chromium against the mock-mode demo bundle, the language chosen through the login page's picker: **0 native digits** on 13 doctor screens in each of the five languages (65 states, including the appointments week view) and on 9 admin screens in Arabic and Persian (18 states); month words in the active language wherever a dated value is shown; focus kept on the picker after each of the four switches.
  - *Not verified.* WebKit / Safari and Firefox (Chromium only); every route. Native `<input type="time">` / `type="number"` render per the browser and operating system, not the app — they show Latin digits in Chromium and are outside what CSS or `Intl` controls.
- **Dependencies and risks.** DEC-010 (calendar) and DEC-011 (separators) stay open. RTL pages still reorder untranslated English strings around numbers (i18n handoff §6) — a translation matter, not a formatting one.
- **Status.** APPROVED · implemented · automated tests pass · browser-verified in Chromium.

#### DEC-010 — Calendar system · **APPROVED, closed** (2026-10-22)

- **Question.** Iran's civil calendar is Solar Hijri and parts of the Arab world use Hijri; the server, the native date pickers and the exports are Gregorian. Which calendar does the interface show?
- **Selected.** Option A — the Gregorian calendar in all five languages, including Arabic and Persian.
- **Agreed behaviour.** Month and weekday names and date order follow the selected language; digits stay Latin (DEC-009). Date displays, date pickers, appointment scheduling, medical records, filters and CSV exports stay consistent with the Gregorian dates the backend stores. No Solar Hijri or Hijri conversion in this release.
- **Implementation.** None needed — DEC-009 already pins it. `src/i18n/format.ts` builds every date formatter with `calendar: 'gregory'` (and `-u-ca-gregory`), which is what stops Persian `Intl` from switching to Solar Hijri on its own. No other calendar is referenced anywhere in `src/`. The 26 native `<input type="date">` / `datetime-local` pickers always carry a Gregorian `YYYY-MM-DD` value by the HTML standard, whatever the browser displays, so what is sent and stored is Gregorian.
- **Verification.** Regression run 2026-10-22: `i18n/format.test.ts` — every language yields the year `2026`, and the control case shows bare Persian `Intl` would give a Solar Hijri year — and `app/LocaleRemount.test.tsx`: 25 tests pass. The DEC-009 browser scan (Chromium, five languages) showed Gregorian month names throughout.
- **Not verified.** How Safari or another browser *displays* a native date picker under a non-Gregorian operating-system calendar — the value submitted is Gregorian regardless.
- **Revisit.** If Persian- or Arabic-speaking staff need their own calendar, dual display (Gregorian with the local date beside it) is the safe next step; a non-Gregorian date beside a Gregorian picker is the risk this decision avoids.
- **Status.** APPROVED · closed · no code change.

#### DEC-011 — Decimal and thousands separators · **APPROVED** (2026-10-22)

- **Question.** French writes `1 234,5`, Turkish `1.234,5`; after DEC-009 the shared number formatter showed `1,234.5` in every language, and a French or Turkish reader can take that comma for a decimal point. Which separators?
- **Selected.** Option B — a dot decimal in all five languages; thousands grouped with U+202F NARROW NO-BREAK SPACE, the SI thin space: `1 234.5`, `12 345`, `0.75`.
- **Agreed scope.** Only the shared number formatter changes (`formatNumber` in `src/i18n/format.ts`) — its 17 call sites (summary-card counts, the report-issue character counter, report KPIs, insights, percentages, the `$…k` revenue figures, admin report axes) and the formatting tests that assert them. **Not changed:** raw clinical values, doses, laboratory results (`shared-domain/lab-studies/corpus.ts` keeps its own fixed-decimal formatting), vitals, file sizes, chart axes; number-input parsing, validation and precision; the server's storage. All of these already use a dot and no grouping. Percent, currency and fraction-digit options keep their meaning — only the group separator differs.
- **Implementation.** `formatNumber` formats with `Intl.NumberFormat('en-u-nu-latn', …)` and replaces each `group` part from `formatToParts` with `THOUSANDS_SEPARATOR` (`'\u202F'`, exported). U+202F does not break across lines, and its bidi class (CS) keeps a number one left-to-right run inside right-to-left text.
- **Verification — three separate statuses.**
  - *Implemented.* As above, on branch `claude/frontend-owner-decisions`.
  - *Automated tests passed.* `i18n/format.test.ts` (31, of which 7 new or rewritten for DEC-011): in each of the five languages `1234.5 → 1 234.5`, `12345 → 12 345`, `0.75`, `2.5`; the separator is exactly U+202F; negatives and millions group correctly; `maximumFractionDigits`, `minimumFractionDigits` and `style: 'percent'` keep their output; no formatted number in any language contains a comma. `admin/reports/reports.test.ts` count expectation updated to `1 234`.
  - *Browser-verified.* Chromium, demo bundle, in English, Arabic and Persian pages: the formatter's output placed in left-to-right and right-to-left paragraphs, in the app's font, inside a 1 px-wide box — every sample reads in order, none breaks across lines, the thin space renders at 1.7 px against 3.4 px for a normal space at the 13 px base size; screenshot of Arabic RTL: "المجموع: 1 234.5 مريض". No admin page in the demo data shows a number ≥ 1,000, so no grouped number appears on screen there; none shows a comma-grouped number either.
  - *Not verified.* WebKit / Safari and Firefox (Chromium only).
- **Gate (2026-10-22).** `typecheck` 0 errors · `lint` exit 0 — ESLint 0 errors, 20 accepted warnings; token check clean · `test` 214 files / 2,253 tests passed · `build` passed.
- **Status.** APPROVED · implemented · automated tests pass · browser-verified in Chromium.

#### DEC-006 — Reception, Laboratory and Pharmacy accounts · **APPROVED** (2026-10-21) · scope settled by DEC-006a

- **Question.** The invite dialog creates `reception`, `laboratory` and `pharmacy` accounts; the web client has shells only for `doctor` and `admin`, so those users are refused at sign-in with "Incorrect email or password" (`api/endpoints/auth.ts`, F42).
- **Selected.** Option C — build minimal, functional web workspaces so these staff can sign in and use Medora. Conditions: no invented permissions, workflows or endpoints; reuse existing modules; role-specific guards and navigation; the backend remains the boundary; tests; no backend changes.
- **What the current backend lets each role do (inspected 2026-10-21).**

  | Capability (seeded, `permission-catalogue.ts`) | Route it opens | Usable by the role? |
  | --- | --- | --- |
  | `patients.view` (all three) | `GET /patients` | **Yes — the masked directory only.** Clear charts need a care relationship, and `PatientScopeService.canReach` is false for every non-doctor role by design (`lab-order.service.ts` header, D-14.2). `POST /patients` answers 403 "Only a practitioner can register a patient" |
  | `appointments.manageOwn` (reception) | `/appointments/*` | **No.** Every method starts with `requireDoctor` → 404 "No doctor profile for this account" |
  | `appointments.reassign` (reception) | `GET /admin/appointments`, `…/summary`, `POST …/:id/nudge`, `…/:id/reassign` | **Yes.** The oversight service checks the capability only (patient identity withheld in the payload). Cancel-administratively needs a capability reception lacks |
  | `records.view`, `labs.review` (laboratory) | `/lab-orders/*`, `/patients/:id/labs`, `…/lab-trends` | **No** order is reachable: `requireDoctor` and the care scope stop a technician (D-14.2 — "what scopes a technician … is an authorization design decision"). `GET /lab-tests/catalogue` (authenticated) works |
  | — (pharmacy holds no prescription capability) | `/prescriptions/*`, `/medications/*` all require `prescriptions.create` | **No.** Pharmacy cannot list, view or dispense a prescription |
  | `messages.send` (all three) | — | **No.** `backend/src/modules/messaging` is an empty scaffold |
  | (authenticated) | `/me/account`, `/me/password`, `/me/2fa/*`, `/me/sessions`, `/me/devices`, `/me/login-history`, `/me/activity`, `/notifications/*` | **Yes**, for any signed-in account. `/me/profile` is practitioner-only |

- **Consequence.** Reception can have a genuinely useful workspace today (directory + appointment oversight with nudge and reassign). Laboratory and Pharmacy have no clinical workflow the server will serve; the scope question is DEC-006a.
- **Status.** APPROVED · scope settled by DEC-006a.

#### DEC-006a — What Laboratory and Pharmacy get while the backend has no workflow for them · **APPROVED** (2026-10-21)

- **Selected.** Option A — honest minimal workspaces for all three roles now, plus backend requirement BR-DEC-006.
- **Agreed scope.**
  - **All three:** sign in (no more "Incorrect email or password" for a valid staff account); a role-specific shell, navigation and route guards; Account, Security, Appearance, Accessibility, Activity and About settings (the practitioner Profile and doctor landing-page Preferences are not offered — `/me/profile` is practitioner-only); the notifications bell; the **masked** patient directory (`GET /patients` — identifiers masked server-side, no reveal: none of the three holds `patients.revealIdentity`).
  - **Reception:** appointment oversight — list, summary KPIs, reminders (nudge) and reassignment (`/admin/appointments`, capability `appointments.reassign`). No administrative cancel (capability not held), no booking (BR-DEC-006).
  - **Laboratory:** the read-only test catalogue (`GET /lab-tests/catalogue`). A plain statement that lab orders, result entry and order transitions are unavailable until the backend supports a technician's access (BR-DEC-006).
  - **Pharmacy:** shared features only. A plain statement that viewing and dispensing prescriptions is unavailable until the backend supports it (BR-DEC-006).
- **Rules.** No invented endpoints, no client-granted permission, no simulated clinical operation. Frontend guards are navigation, not security — every route above is authorized server-side by the capability named.
- **Implemented** (2026-10-21, on branch `claude/frontend-owner-decisions`). `types/auth` `ROLES` gains the three roles; `routes/workspaces.ts` replaces the shell's role ternaries; `features/staff` holds the home pages and the masked directory; Reception oversight reuses the admin `AppointmentOversightSection`, whose row actions are already filtered by the caller's capabilities; the lab catalogue is `features/doctor/labs/pages/LabCataloguePage.tsx`; Settings takes a section allow-list (`STAFF_SETTINGS_SECTIONS`). Demo accounts `reception@`, `lab@`, `pharmacy@medora.health` carry the seeded bundles, held to the admin matrix by `app/router/staff-permissions.test.ts`.
- **Status.** APPROVED · IMPLEMENTED_UNVERIFIED (unit, component and route-tree tests pass; no browser run, no live run).
- **Update 2026-10-25.** BR-DEC-006 part 4 is implemented and verified on `backend` (`69e4a2c`, PR #98): reception, laboratory and pharmacy reach `/conversations`. The workspaces still say messaging is unavailable, and that stays true for the web client — no route lists whom a user may message, and the staff participant rule (API-W09) is open. Parts 1–3 (lab scoping, pharmacy list/view/dispense, reception booking and check-in) are not implemented on any branch. The DEC-006 table above ("`messaging` is an empty scaffold") describes `main`, where it is still true.
- **Update 2026-11-15 — hardening, no new scope.** The workspaces' *routes* now require the capability their navigation already required, so a deep link stops working the moment an administrator revokes it, instead of only the menu item disappearing: reception `/reception/appointments` → `appointments.reassign`, laboratory `/laboratory/catalogue` → `labs.review`, and the masked directory of all three → `patients.view` (`RequirePermission` in `app/router/index.tsx`). The home cards are filtered by the same capabilities. Reception's home no longer says the server has no waiting-room service: the queue and waiting room are not connected to live data yet, are read-only for reception where they are shown (the server admits `admin` and `reception` to the reads), and changing them stays administrator-only — so `QueueSection` and `WaitingRoomSection` now show their write controls to administrators only, matching the server's admin-only write routes. A `patient` account refused at sign-in is pointed to the Medora patient mobile app (`login.error.patientRole`, all five locales); nurse and custom roles keep the generic refusal. Tests: `app/router/staff-workspaces.test.tsx` (each gated route rendered with the capability and refused without it, home cards, the reception copy, reception vs administrator controls) and `features/auth/pages/LoginPage.test.tsx` (patient and nurse refusals).
  - **Still not on the web, by decision rather than omission:** `nurse` (ADR-017 §6 and ADR-029 — no capability bundle, not invitable; a nurse workspace needs an owner decision on its capabilities) and `patient` (ADR-030/ADR-032 — patients use `patient-app/`; web access would need a new ADR). Both stay outside `Role`.

#### DEC-012 — The brand intro and Largest Contentful Paint · **APPROVED** (2026-10-23)

- **Question.** `MedoraIntro` (`App.tsx`) plays once per tab (`sessionStorage`), on whatever route a fresh session opens, and the app fades in beneath it from opacity 0. Chrome does not report a paint at opacity 0 as contentful, so a first visit has **no LCP at all**: on `/login`, Chrome's own `largest-contentful-paint` entries number 0 with the intro and one at 220 ms without it. Lighthouse therefore cannot score performance (`NO_LCP`; each audit opens a fresh tab), and real-user monitoring would record nothing for the visit that matters most. Should the intro change?
- **Options.**
  - **A — keep as is.** No first-visit LCP, no Lighthouse performance score; nothing to build.
  - **B — keep the intro, but paint the page's content at full opacity beneath it** and let the overlay's own exit do the reveal. LCP then records the real content; the look should be close to today's crossfade. Needs a visual check against the approved animation.
  - **C — play it only on the sign-in page**, so a deep link into the app (bookmark, notification link) is not covered. Fewer first visits without LCP; a returning user's first screen loses the intro.
  - **D — remove it.** Simplest; drops approved branding work.
- **Recommended.** B — it keeps the branding and makes the page measurable; the change is CSS and timing in `MedoraIntro`/`App.tsx`.
- **Selected.** Option B (2026-10-23): keep the Medora brand intro, render the page fully visible beneath it, so the intro's exit reveals the already-rendered page. Preserve the approved branding and animation.
- **Implementation.** `app/App.tsx` drops the `medora-app-reveal` wrapper and the `revealed` state that drove it; the routed tree renders directly beside `MedoraIntro`. `MedoraIntro.css` drops the `.medora-app-reveal` rules and records why the content underneath is deliberately unstyled. The overlay — lockup, timeline, `mi-exit` fade, skip, reduced motion, `aria-hidden` — is unchanged; so is `MEDORA_INTRO_TIMING`. `onReveal` stays on the component, documented as not a cue to fade content in.
- **Verification — three separate statuses.**
  - *Implemented.* As above, on branch `claude/dec-012-intro-reveal`.
  - *Automated tests passed.* `MedoraIntro.test.tsx` +2: no rule outside `.medora-intro` in `MedoraIntro.css` sets `opacity: 0`, and the check catches the removed wrapper. Run against the pre-fix stylesheet, the first fails, naming `.medora-app-reveal`. Full frontend gate green (§17.4).
  - *Browser-verified.* LCP present on every fresh session, both routes, both widths; Lighthouse scores `/login`; layout, click targets, focus and axe unchanged (§17).
- **Status.** APPROVED · COMPLETE_VERIFIED. One judgment is the owner's: the last 300 ms look slightly different (§17.3).

#### DEC-013 — Custom roles from a base template · **RESOLVED — C, plus a named sign-in refusal** (2026-10-24)

- **Question.** UX §3.9 asks for "custom role creation from a base template". The API serves it — `POST /roles` `{ code, label, baseRole }` (API §15.4, `backend/src/modules/users/controllers/roles.controller.ts`, on `main`), copying the base role's capability bundle. The client is built on five roles: `ROLES` (`types/auth`), the route guards, the workspaces (`routes/workspaces.ts`) and the sign-in adapter, which throws `invalid_credentials` for any other role (`api/endpoints/auth.ts`). Should the client create them, and what does a user holding one get?
- **Options.**
  - **A — defer.** Keep the five roles; build creation with the platform console (ORG-03), where the multi-hospital plan puts roles and the matrix, and where whether a hospital admin may customise roles is still undecided (§4 ADM-09 note). Nothing to build now.
  - **B — create, and sign a custom role in with its base role's workspace.** The session would have to say which base role a custom role derives from; `GET /auth/session` carries only `role`, so this needs a backend change first.
  - **C — create, but never offer a custom role for assignment** until B exists. The matrix gains columns nobody can hold — configuration with no effect, which reads as a defect.
- **Recommended.** A. B is the real feature and needs the backend; C ships a control whose result cannot be used.
- **Rows.** §13.4 "ADM-09 custom roles".
- **Resolution (2026-10-24, pass 5).** The owner's pass instruction asked for unknown roles handled gracefully, role metadata read from the server, and tests — not for option A. Built: the role list and creation (option C's half), and the sign-in refusal named (`UnsupportedRoleError`) with the server session signed out. Custom roles are labelled but never offered for assignment, so the UI cannot create an account that cannot sign in. The recommendation's objection to C stands and is said in the product: the panel and dialog state that a custom role's holders cannot use the web app yet and that it has no matrix column. B still needs the backend (§19.5). Status `IMPLEMENTED_UNVERIFIED` (F33).

#### DEC-014 — Component stories and axe in CI (F-09) · **Stories done; CI half open** (2026-10-24)

- **Question.** `COMPONENT_LIBRARY.md` §1 rule 5 makes colocated stories the acceptance artifact for every Tier 1–2 component. Six story files cover nine of 59 (`components/ui` 30, `feedback` 7, `patterns` 17 plus 5 in `patterns/dashboard`). F-09 deferred the rest to "the next touch of each" and left axe-in-CI to the owner.
- **Options.** A keep "next touch"; axe stays a local Storybook check · B write the remaining stories in one dedicated pull request on the existing generated-matrix pattern; add `build-storybook` plus the a11y addon's checks to CI as an **advisory** job · C B, with axe failures **blocking** the merge.
- **Recommended.** B. The rule is the library's own; advisory first, because a blocking job on day one would hold unrelated pull requests on findings in components they did not touch.
- **Rows.** §13.2 F-09.
- **Resolution (2026-10-24, pass 5).** B's stories, without B's CI job: the pass instruction forbade changing CI. 45 story files; all 190 stories rendered in both themes with axe (§19.2). Whether `build-storybook` and axe run in CI, advisory or blocking, is still the owner's call.

#### DEC-015 — Sticky first column on wide tables · **RESOLVED — C** (2026-10-24)

- **Question.** DS §8.19 asks for a sticky first column on horizontally scrolling tables; §11.4 records why it was reverted — in dark mode the row tints are 16 % alpha, so a pinned cell shows the scrolling columns through it.
- **Options.** A leave it unbuilt: the scroller is a named, focusable region and every clinical worklist marks the patient as `rowHeader` · B make the dark `*-subtle` tokens opaque (a change to the whole dark ramp) · C express row tints as an inheritable background layer (changes `getRowClassName` everywhere).
- **Recommended.** A, and amend DS §8.19 to match; B or C only if users report losing their place in wide tables.
- **Rows.** §11.4.
- **Resolution (2026-10-24, pass 5).** C, against the recommendation (A), because the pass instruction asked for the dark transparency fixed: the pinned cell paints `bg-surface` and the row's tint over it as an image of `--row-bg`, which each row state sets. No token changed. Browser-verified (§19.3).

#### DEC-016 — Sharing a medical record (D-22) · **RESOLVED — A** (2026-10-24)

- **Question.** D-22 asks for a share flow with a recipient picker and a permission model. Today "Share" on a record copies its in-app address (`useShareLink`, `MedicalRecordRowActions.tsx`); a colleague who opens it still needs their own access, which the server enforces by care relationship.
- **Options.** A close D-22 as "copy link" — no new permission is granted by sharing, which is the safe default for clinical records · B design share-with-colleague (who may share, with whom, for how long, audited) — a sharing policy and an endpoint first.
- **Recommended.** A, unless there is a clinical need to grant access by sharing; that need would also be an input to the cross-hospital grant model (`docs/multi-hospital/OWNER_DECISIONS.md`).
- **Rows.** §13.3 D-22.
- **Resolution (2026-10-24, pass 5).** A: copy-link, with a failure that says so and hands over the address. No permission is granted by sharing (§19.3).

#### DEC-017 — Caption size · **RESOLVED — C** (2026-10-24)

- **Question.** `DESIGN_SYSTEM.md` §3.2 specifies `caption` as 12 px (`--text-caption: 0.75rem`, DS line 878). `src/styles/tokens.css` sets it to 11 px (`0.6875rem`) on purpose — its comment calls the scale "enterprise-dense … tightened from the DS §3.2 baseline" — and the DS was never amended. Lighthouse's mobile "legible font sizes" audit (≥ 60 % of text at ≥ 12 px) fails because of it: on `/doctor/patients`, `.text-caption` is 46.67 % of the page's text, leaving 48 % legible, so best practices scores 96 on mobile `/doctor/patients` and `/doctor/appointments` (§18.4). WCAG sets no minimum font size, so this is not an AA failure.
- **Options.** A keep 11 px and amend DS §3.2 to the dense scale · B 12 px everywhere, as the DS says (desktop loses density on every table and caption) · C 12 px on a coarse pointer and 11 px with a mouse, through the `touch:` variant DEC-008 introduced.
- **Recommended.** C — desktop keeps the density the token was tightened for, a phone reads at the DS size. Any option needs the DS and the token to agree afterwards.
- **Rows.** §13.5 Q-01.
- **Resolution (2026-10-24, pass 5).** C, the recommendation: 12 px under `(pointer: coarse)`, 11 px with a mouse; DS §3.2 records the implemented scale. Mobile best practices 100 (§19.3).

#### DEC-018 — Documents while `/health` cannot report storage · **OPEN** (asked 2026-11-01)

- **Checklist.** §13.3 D-04 / D-04b; §9 row 3. **Status:** implemented under A and awaiting the answer. Nothing else waits on it.
- **What was inspected.** `backend/src/modules/health/`: `HealthService` reports `unconfigured` for any key without an indicator, and `indicators/` holds only `database.indicator.ts`. `backend/src/shared/files/file-storage.module.ts` binds `S3FileStorage`. Also read: the port's `DocumentStorageState` comment, and `DocumentsTab`'s rule that actions appear only when storage is `available`.
- **Problem.** The port decides whether to offer *View*, *Download* and *Upload* before anyone presses them, and API §20.1's `services.storage` is the published answer. But nothing probes storage, so `/health` reports `unconfigured` in every deployment, including one with a working object store.
- **Why a decision is needed.** It changes what a doctor sees in a live build. A wrong "available" means controls that fail on each click. A wrong "unconfigured" means a working feature that stays hidden.
- **Option A (built).** Gate on `/health`; only `up` reads `available`. *For:* it follows the port's documented design and cannot show a control that will fail. *Against:* the live tab offers nothing until the backend adds a storage indicator. That change is small (one `HealthIndicator`), but it belongs to the backend team.
- **Option B.** Treat storage as available in every live build, and let each 503 say "no document service is connected" when a button is pressed. *For:* it works the day a store is configured. *Against:* it is the per-click discovery the port was written to avoid (D-16).
- **Option C.** A `VITE_` flag the deployment sets. *For:* no backend change. *Against:* the flag can disagree with the server, and adding it changes Vercel environment configuration, which needs separate authorisation.
- **Recommended.** A, plus a backend storage indicator in `/health` (an `up` / `down` probe of the bucket). Switching to B later is a one-line change in `storageState()`.
- **Decision required.** Keep A and ask the backend team for a `/health` storage indicator, or switch to B?
- **Work completed.** The adapter, the category picker and the tab refresh (§33). Tests: `http-documents-service.test.ts` pins `up` → available, and `unconfigured` / `down` → unconfigured.
- **Dependencies.** Backend: a storage `HealthIndicator`. Infrastructure: an object store (M25.2) and a scanner (M25.3). Until a scanner is bound, every file stays `scan_pending`, so even a configured store opens nothing.
- **Remaining work.** Under A, none on the frontend. Under B, change `storageState()` and its three tests.

---

## 15. Completion pass 3 — 2026-10-22

**Scope.** `frontend/` only, on `frontend` at `a0142ea` (checked out detached; the working tree was clean at the start and nothing was committed). Nothing in `backend/`, `patient-app/`, Prisma, the AI service or deployment configuration was touched. No endpoint, response shape or owner decision was invented; every change uses a contract the client already had (`composeMessage`, `?patient=`, the existing `AddAppointmentDialog`) or a pattern already in the codebase (DataTable's measured scroller, the avatar menu's role rule).

### 15.1 What was built and fixed

| Row | Change | Files |
| --- | --- | --- |
| NEW-06 | `routes.doctor.bookAppointment({ patientId? })` → `?book=`; the book consumes and strips it and opens `AddAppointmentDialog` with the patient chosen | `routes/index.ts`, `appointments/pages/AppointmentsPage.tsx`, `appointments/components/AddAppointmentDialog.tsx`, `patients/components/profile/PatientIdentityHeader.tsx`, `patients/pages/PatientsPage.tsx` |
| NEW-07 + Q-03 | Every patient/appointment "Send message" opens the patient's thread; the row's labs, prescriptions and record links carry `?patient=` | `patients/components/PatientRowActions.tsx`, `appointments/components/AppointmentRowActions.tsx`, `appointments/components/AppointmentDetailsDrawer.tsx` |
| NEW-16 | Report export: no success without a file; failures reported; `aria-pressed` on formats | `reports/components/ExportDialog.tsx` |
| NEW-17 | Sidebar account card shows practitioner details for doctors only | `layouts/Sidebar/AppSidebar.tsx` |
| NEW-18 | In-field action buttons 24 × 24 px on a fine pointer | `components/ui/internal/styles.ts` |
| NEW-19 | `RadioGroup` is a `radiogroup` | `components/ui/Radio.tsx` |
| NEW-20 | Heatmap scroller focusable while it overflows | `components/charts/Heatmap.tsx` |

New tests: `book-for-patient.test.tsx` (7), `PatientRowActions.test.tsx` (8), `ExportDialog.test.tsx` (4), `AppSidebar.test.tsx` (4), `Radio.test.tsx` (4), `Heatmap.test.tsx` (2), `touch-targets.test.tsx` (+1). For NEW-06/07, NEW-16 and NEW-17 the new tests were run against the pre-fix source and fail there (11 of 14, 3 of 4, 3 of 4); a first attempt at a NEW-17 test inside the router suite passed against the old code too — jsdom never renders the desktop sidebar — and was removed rather than kept as false assurance.

### 15.2 Browser verification

Playwright 1.56 driving Chromium against `VITE_ENABLE_MOCKS=true npm run build:demo` served by `vite preview`. Scripts navigate **client-side** after the first load: the demo's clinical stores are in memory by design (no PHI in `localStorage`), so a full reload restores the seed — a first run that used `page.goto` after a write reported the pharmacy detail page "still offering Discontinue", which was that reload, not the app.

| Scenario | Checks | Result |
| --- | ---: | --- |
| Chart: NEW-06/07, NEW-01, 02, 03, 04a, chart notes — 1440 px | 27 | 27 passed |
| Same at 375 px | 27 | 27 passed |
| Pharmacy and records: NEW-09, NEW-10, NEW-11, NEW-12 (seeded) | 19 | 18 passed — the failure expected Edit on MR-10002, a draft whose note is signed; DEC-004 correctly withholds it |
| NEW-12 positive path: create an unsigned draft, edit, history, sign | 7 | 7 passed |
| NEW-14 (three workspaces), NEW-08, D-25 | 48 | 48 passed |
| axe 4.14, WCAG 2.0/2.1/2.2 A/AA, 27 routes × 5 roles, 1440 and 375 px | — | 0 critical, 0 `target-size`, 0 `scrollable-region-focusable`; 27 × `label-content-name-mismatch` (§15.3) |

Zero page errors and zero console errors in every run.

### 15.3 Checked and dismissed

- **axe `label-content-name-mismatch` on the avatar menu (every page).** The button's name is "Account — {name}"; its visible content is the avatar's initials, which are `aria-hidden` (the avatar is `decorative`). WCAG 2.5.3 concerns a visible *text label*; a monogram is a picture of a name, and the rule is tagged experimental in axe. Not changed.
- **A peer session's report of three bugs** (pharmacy detail still offering Discontinue; strip missing source labels; "Report an issue" not in the menu) — all three came from my first script: the full-reload artefact above, a text-window regex, and the dialog's title used as the menu item's label. Each was re-checked against the app and passes.

### 15.4 Not done, and why

- **NEW-21** (initial JS +55 %) — measured and attributed, not fixed: the fix changes which modules the shell imports eagerly, and deserves its own change with before/after numbers.
- **F-18** toast announcements — needs a screen reader to judge (§13.2).
- **Q-01** performance — Lighthouse cannot compute LCP in this container; authenticated routes need a runner that carries the demo session.
- **NEW-10** Cancel path — no demo state reaches `pending-approval`; adding one would mean a demo-only catalogue change for a test.
- **F-09** stories, **F-19** feature strings (clinical translation, never machine), **NEW-05** demo regimen (structural move) — unchanged; their reasons in §13 still hold.
- Everything 🔗 / `BLOCKED_BACKEND` / `MOCK_ONLY` — unchanged; §9, §9.0 and §9.1 still name the owner of each dependency.

---

## 16. Completion pass 4 — 2026-10-22

**Scope.** The owner's four approved decisions: fix toast accessibility (A), make NEW-10's Cancel browser-verifiable with demo data (B), fix the initial-JS regression with measured before/after (C), and open a pull request into `frontend`. `frontend/` only. Branch `claude/frontend-completion-pass-3`, cut from `frontend` @ `a0142ea` (the remote tip; unchanged since pass 3), carrying pass 3's work as its first two commits. No backend, Prisma, AI, patient-app or deployment file was touched, and nothing was deployed.

### 16.1 Toasts (F-18, decision A)

`app/providers/ToastProvider.tsx`, `app/providers/toast-announcer.ts`, `components/feedback/Toast.tsx`, `test/setup.ts`. The behaviour, per case:

| Case | Announced by | Read out |
| --- | --- | --- |
| Success, info, warning | the persistent `aria-live="polite"` announcer | title + description |
| Error | the persistent `aria-live="assertive"` announcer | title + description |
| Several in quick succession | each its own node (`aria-relevant="additions"`) — none overwrites another; a repeat is read again | each in turn |
| Dismissal | nothing | — |
| Dismiss / action controls | never part of an announcement; dismiss is named from the catalogue and described by its toast's title | — |

**Limit, stated plainly:** NVDA and VoiceOver were not run. The tests and axe check the ARIA structure a screen reader acts on, not what it says.

### 16.2 NEW-10 fixture (decision B)

`model/mock-data.ts` gains `PENDING_APPROVAL_FIXTURE_SPEC` and a sixth `SEED_PLAN` entry; nothing else in the seed moves (the first five prescriptions were dumped before and after and compared byte for byte). It was first given to Layla and broke four authoring tests that rely on her having nothing running — a fixture choice, corrected to Amira, not a test changed. No guard changed: the fixture adds a state, and every refusal around it is the existing one.

### 16.3 Bundle (NEW-21, decision C)

**Eager JS** — `npm run build` (production mode, mocks off, `VITE_APP_ENV` default), then the entry `<script>` plus every `<link rel="modulepreload">` in `dist/index.html`, each file gzipped at level 9 (`measure-eager.mjs`). The before figure was rebuilt on this branch before any change, reproducing pass 3's measurement.

| | Before (reproduced) | After | Change |
| --- | ---: | ---: | ---: |
| Entry chunk | 424.87 kB / **127.58 kB gzip** | 302.12 kB / **90.54 kB gzip** | −29.0 % |
| `react` + `query` chunks (unchanged) | 79.79 kB gzip | 79.79 kB gzip | — |
| **Total eager JS** | 671.11 kB / **207.36 kB gzip** | 548.36 kB / **170.33 kB gzip** | **−37.0 kB, −17.9 %** |
| Deferred route chunks | 206 chunks, 517.52 kB gzip | 224 chunks, 567.78 kB gzip | +18 chunks (the moved code, now on demand) |

**JS actually requested on a cold load** — the honest check, because a smaller entry means nothing if the same code is fetched at once through another chunk. Production-mode builds with mocks (`VITE_APP_ENV=staging VITE_ENABLE_MOCKS=true vite build`) of the commit before decision C (`596c68d`, exported with `git archive`) and of the final tree, served side by side; Playwright loads each URL in a fresh context and every `.js` response until the network is idle is counted, sized from disk the same way. Every page rendered its own heading, with zero page errors, on both builds.

| Cold load | Before | After | Change |
| --- | ---: | ---: | ---: |
| `/login` (English) | 253.44 kB | 216.44 kB | −14.6 % |
| `/login`, Arabic stored | 253.44 kB | 220.67 kB | −12.9 % (Arabic and right-to-left from first paint) |
| `/doctor/overview`, signed in | 308.70 kB | 234.71 kB | **−24.0 %** |
| `/doctor/appointments` | 321.45 kB | 254.45 kB | −20.8 % |
| `/doctor/labs` | 326.20 kB | 262.53 kB | −19.5 % |
| `/doctor/medical-records/MR-10002` | 310.49 kB | 248.22 kB | −20.1 % |
| `/doctor/settings/availability` | 335.56 kB | 273.20 kB | −18.6 % |
| `/laboratory/catalogue`, lab user | 252.64 kB | 225.68 kB | −10.7 % |

A first cut that fixed only the barrels and the catalogues brought the entry down but left signed-in doctor pages at −2.4 %: the lazily mounted search provider fetched the same services the moment it mounted. That is what moved the search index's code behind the field's first engagement.

**What stays eager, and why** (per-module gzip from `rollup-plugin-visualizer`'s raw data, ranked): framer-motion's core (`LazyMotion` keeps its features lazy; the shell's route transition and the toasts use `m`), the shared UI primitives, zod (`configs/env.ts` validates the environment at boot), lucide icons in the shell's navigation, tailwind-merge, the English catalogue, the notifications query behind the bell's unread count (on every page), and each feature's route config (≤ 0.5 kB apiece). Splitting any of these would trade correctness or first paint for bytes.

**Not reached:** DX-06's 134.03 kB. The difference is mostly what the shell has gained since — internationalisation, design-system primitives, the toast and dashboard infrastructure — not misplaced route code.

### 16.4 Lighthouse and the intro (Q-01, NEW-22)

Authenticated routes are auditable now (a persistent context shares the "Remember me" session with Lighthouse's tab); accessibility and best practices score 100 on every audited route on both builds. A performance score is still missing, and the reason is in the app, not the container: `MedoraIntro` suppresses LCP on a fresh session (0 entries with it, 220 ms without). DEC-012 asks what to do; nothing was changed.

### 16.5 Not done, and why

- **F-18 screen-reader pass** — no NVDA or VoiceOver here.
- **DEC-012** — the owner's decision.
- **F-09** stories, **F-19** clinical translation (never by guessing), **NEW-05** demo regimen — unchanged; the reasons in §13 stand.
- Every `BLOCKED_BACKEND` and `MOCK_ONLY` row — unchanged; §9, §9.0 and §9.1 name the owner of each dependency.

---

## 17. DEC-012 — the intro reveals a painted page — 2026-10-23

**Scope.** DEC-012 option B, approved by the owner. `frontend/` only: `app/App.tsx`, `shared/components/branding/MedoraIntro.{css,tsx,test.tsx}`, the branding README, and this file. Branch `claude/dec-012-intro-reveal`. Nothing deployed.

### 17.1 Method

Both builds are the bundle Vercel deploys — `build:demo` with `vercel.json`'s `VITE_APP_ENV=staging`, `VITE_ENABLE_MOCKS=true` — built **from the same directory**. `build:demo` is a development-mode build that embeds absolute source paths, and a first attempt built from two checkouts differed by 38 kB for that reason alone; built in one place, the entry chunk is 434,767 → 434,430 B. Each build is served by `serve -s` and driven by Playwright 1.56.1 (headless Chromium 1194), no CPU or network throttling, same machine, run back to back. **Every run is a fresh browser context**, so `sessionStorage` is empty and the intro plays; a control set marks `medora.intro-played` first. LCP is Chrome's own `largest-contentful-paint` entries (buffered `PerformanceObserver` from an init script), read 4.5 s after navigation — after the overlay has gone — with no input, since input ends LCP. `/doctor/overview` runs with a remembered demo session (`doctor@medora.health`). Desktop 1280 × 800; mobile 375 × 812, DPR 2, touch.

### 17.2 LCP, before → after

Seven runs per cell. "Runs with LCP" counts runs where Chrome reported any entry at all.

| Viewport | Route | Intro | Before: runs with LCP | Before: median (range) | After: runs with LCP | After: median (range) |
| --- | --- | --- | ---: | --- | ---: | --- |
| Desktop | `/login` | playing | **0 / 7** | — | **7 / 7** | 268 ms (256–308) |
| Desktop | `/login` | already played | 7 / 7 | 260 ms (228–312) | 7 / 7 | 284 ms (232–316) |
| Desktop | `/doctor/overview` | playing | **0 / 7** | — | **7 / 7** | 304 ms (272–372) |
| Desktop | `/doctor/overview` | already played | 7 / 7 | 292 ms (268–348) | 7 / 7 | 296 ms (268–332) |
| Mobile | `/login` | playing | **0 / 7** | — | **7 / 7** | 236 ms (220–316) |
| Mobile | `/login` | already played | 7 / 7 | 236 ms (204–260) | 7 / 7 | 236 ms (200–292) |
| Mobile | `/doctor/overview` | playing | **0 / 7** | — | **7 / 7** | 260 ms (256–284) |
| Mobile | `/doctor/overview` | already played | 7 / 7 | 256 ms (244–284) | 7 / 7 | 288 ms (264–552) |

The LCP element is the same with and without the intro: the demo-access note on `/login` (a `<p>`), and the dashboard's intro paragraph on `/doctor/overview`. With the intro playing, the after build now matches the already-played control within run-to-run noise. **The LCP is now the page's content painting beneath the overlay, at ~0.3 s — not when the user first sees it (~2.6–2.9 s, as the overlay fades).** That is how Chrome defines LCP — it does not account for occlusion — and it is what option B chose.

**Lighthouse 12.8.2, `/login`**, fresh profile (the intro plays), simulated throttling, three runs each, same two bundles:

| | Before | After |
| --- | --- | --- |
| Desktop preset | `NO_LCP`, no performance score (×3); FCP 0.6–0.7 s | **100 / 100 / 100**; LCP 0.7 s; FCP 0.6–0.7 s; TBT 0 ms; CLS 0 |
| Mobile (default) | `NO_LCP`, no performance score (×3); FCP 3.1–3.2 s | **84 / 85 / 86**; LCP 3.4–3.5 s; FCP 3.1–3.2 s; TBT 50–70 ms; CLS 0 |

These scores are for the development-mode demo bundle Vercel serves, not a production-mode build, and for `/login` only.

### 17.3 Regression checks

Same harness, both builds, `/login` and `/doctor/overview`, desktop and mobile:

- **Layout.** After the intro, settled screenshots (animations disabled, focus blurred, two runs per build): `/login` pixel-identical at both widths; `/doctor/overview` mobile pixel-identical; desktop differs in 15 pixels, every one by a single 1/255 channel step on the antialiased corner of one card — the old wrapper's opacity transition gave it its own compositing layer. No geometry moved. Each build is identical to itself between runs. CLS 0 in every Lighthouse run.
- **Click interception.** During the intro, the centre of the screen hits the overlay (by design: a tap skips it); after it, a click on the email field (`/login`) and the first `main` control (`/doctor/overview`) reaches that element, and no ancestor has opacity below 1. Unchanged.
- **Focus.** First Tab after the intro: the email field on `/login`, "Skip to main content" on `/doctor/overview`, on both builds. No focus trap was added. The overlay is `aria-hidden` on both builds. Pre-existing and unchanged: `/login` autofocuses the email field while the intro plays — content under the intro was already focusable and in the accessibility tree, since opacity never hid it from assistive technology.
- **Accessibility.** axe-core (WCAG 2.0/2.1 A/AA, 2.2 AA) after the intro: 0 violations on all four route × width cells, both builds. No page errors.
- **The look.** Frames captured with every animation paused at the same timeline position: identical from 0 to 2620 ms, the whole lockup sequence, and identical once the overlay has gone (2920 ms). In between, during the overlay's 300 ms exit, the page is more visible at each instant than before: it is now fully painted under one fading layer, where before it also faded in under a fading layer (in the before frames that app-side fade is set by hand, linearly, which approximates its `cubic-bezier(0.4, 0, 0.2, 1)` easing). The lockup, timing and easing are untouched. **Owner sign-off on this 300 ms is the one open judgment.**

### 17.4 Gate

`npm --prefix frontend run typecheck && lint && test && build` on the branch: typecheck clean; lint 0 errors, 20 warnings (the accepted `react-refresh` ceiling, unchanged); **224 test files, 2348 tests passed** (2346 before, +2 above); build OK.

### 17.5 Not done, and why

- **Authenticated routes' Lighthouse performance score.** LCP on `/doctor/overview` is measured above with Chrome's own entries; a Lighthouse score there needs pass 4's headed, persistent-context setup, which was not repeated. Q-01 stays `PARTIAL`. *(Closed by the 2026-10-23 audit, §18.4.)*
- **Real devices and real networks.** Emulated mobile only; no CPU throttling in the Playwright runs.
- **A live deployment measurement.** Nothing was deployed.

---

## 18. Final completion audit — 2026-10-23

**Scope.** Every item in this file, checked against the code on branch `claude/medora-frontend-checklist-audit-am0xys`, cut from `frontend` @ `7769fb5` (identical to `origin/frontend` at the start; clean tree). `frontend/` only — nothing in `backend/`, `patient-app/`, Prisma, the AI service, `vercel.json` or any deployment setting was changed, nothing was deployed, and nothing was pushed. PR #85 (`frontend` → `main`) was merged by the owner while this audit ran; that merge is **not** evidence for any row below (§18.8).

### 18.1 Method

- **Every row's evidence re-checked, not re-asserted.** All 67 test files the checklist cites exist; where a row states a test count, the count was compared — seven that a static count disputed were run and match (`it.each` cases a grep cannot see). The register was recounted by `scripts/count-checklist-register.mjs` (added by this audit), which reproduces §13.1's DEC-012 column exactly on the previous revision of this file.
- **Gate on the untouched tree first:** `typecheck` 0 errors · `lint` 0 errors, 20 accepted warnings, token check clean · `test` **224 files / 2,348 tests** · `build` passed — exactly §17.4.
- **Browser**, Playwright 1.56.1 + Chromium 1194 against mock-mode bundles built from this tree (`build:demo` settings for the demo; production mode with mocks for Lighthouse), served with an SPA fallback.
- **Not re-run:** the scenario scripts of passes 3 and 4 (§15.2, §16) — their rows are unchanged and their tests pass; a screen reader, WebKit, Firefox and a physical device (none available in this container); a live API (G-1: no Medora database here).

### 18.2 Dead buttons, widgets, quick actions — Q-03 and §10.5

| Check | Result |
| --- | --- |
| Static: every `<Button>`, `<IconButton>`, `<button>` in the 437 non-test `.tsx` files of `src/` (TypeScript AST) without `onClick`, a submit/reset `type`, `form` or spread props | 21 candidates, **all** `Dropdown` triggers (`Dropdown` adds the handler with `cloneElement`) — 0 inert. No empty handler, no "coming soon" |
| Browser pass 1: every enabled button, tab and menu item in `<main>` on 42 admin routes (every sidebar section, every settings panel, a doctor and a patient detail, My Profile, My Settings), each click judged by URL, DOM, download or popup change | **518 clicks, 0 inert**, 0 page or console errors |
| Browser pass 2: the admin tab states pass 1 only switched to (reports, doctors list, doctor and patient detail tabs, communications tabs), the roles panel with §18.3's links, and 18 doctor routes including record, prescription and patient detail | Admin: 15 states, **243 clicks**; doctor: 18 routes, **349 clicks**. 0 inert, 0 page or console errors. Three flags, all dismissed on reading: on the doctors list's Pending, Active and Suspended states the flagged control is *that state's own, already-selected tab* — activating a selected tab is a no-op by the WAI-ARIA tabs pattern, and every other control in those states acted. **Both passes: 75 route-states, 1,110 clicks, no dead button**. Controls past the 45th on a route were not clicked (the logs table's per-row pivots, the roles grid's switches beyond the first 45, and rows a write removed mid-sweep) |
| Dashboards: every catalogue widget switched on through "Customize dashboard", 1440 and 375 px | doctor **12/12**, admin **11/11** render their content; no error state, no horizontal overflow, 0 page errors |
| Quick actions, each clicked | New prescription → `/doctor/pharmacy/new` · New record → `/doctor/medical-records/new` · Order lab → `/doctor/labs/new` · Open AI Assistant → `/doctor/ai` · Message a patient → `/doctor/messages` with the New message picker open · Open schedule → `/doctor/appointments` |

One checker artefact dismissed (the §11.3 lesson again): Playwright reported the "Remember me" checkbox's own 24 px hit area intercepting its clicks. The wrapper sits inside the `<label>`, and a real mouse click at the box's centre toggles it both ways.

### 18.3 Built: the per-role member list (UX §3.9)

`PermissionMatrixPanel.tsx` gains an "Accounts by role" strip — one link per role, `Doctor · N active` → `/admin/settings/users?role=doctor`; `AccessPanels.tsx`'s role filter moves from component state into `?role=` (an unknown value reads as "All roles"; "All roles" removes the parameter; `replace`, so the filter is not a history entry per change). The Users panel already listed, searched and edited accounts by role; the member list is that panel filtered, not a second copy. Tests: `PermissionMatrixPanel.test.tsx` +1, `live-access.test.tsx` +3 — the two behaviour tests failed before the change. Browser: the five links and their targets at 1440 and 375 px; Laboratory → only Laboratory accounts, filter showing it; All roles → query gone; axe WCAG 2.2 AA on the panel 0 violations. Size: 24 px tall with a mouse (2.5.8 met directly — the first cut was 17 px and relied on the spacing exception, which two wrapped rows at 375 px would not have met), and under touch emulation every point of each 44 × 44 square resolves to the link (0 / 49 misses at 375 and 1024 px).

### 18.4 Lighthouse on authenticated routes — Q-01

Method in §13.5 Q-01. Three runs per cell; production-mode mock build served gzip-compressed.

| Route | Desktop performance | Desktop LCP | Mobile performance | Mobile LCP | Best practices (mobile) |
| --- | --- | --- | --- | --- | --- |
| `/doctor/overview` | 99 / 99 / 99 | 0.8 s | 86 / 83 / 86 | 3.4–3.8 s | 100 |
| `/doctor/appointments` | 96 / 96 / 96 | 1.0–1.1 s | 79 / 78 / 78 | 4.2–4.3 s | **96** |
| `/doctor/medical-records` | 97 / 98 / 98 | 0.9–1.0 s | 78 / 82 / 80 | 4.0 s | 100 |
| `/doctor/patients` | 97 / 97 / 97 | 1.0 s | 83 / 82 / 83 | 3.8 s | **96** |

Accessibility 100 on all 24 runs; desktop best practices 100; CLS ≤ 0.010 desktop, ≤ 0.089 mobile. **A first run without compression scored mobile 60–64 and is discarded**: Lighthouse estimated 533–551 KiB of savings from text compression alone, i.e. it measured the test server. The two 96s are `font-size` (NEW-23, DEC-017). No project document sets a performance budget, so the mobile figures are recorded rather than judged; the remaining mobile opportunities Lighthouse names are render-blocking CSS (~450 ms), unused CSS (~70 KiB of 88) and unused JS in the entry chunk (zod and the admin route config on a doctor page).

### 18.5 Questions for the owner

| ID | Question | Recommended | Blocks |
| --- | --- | --- | --- |
| DEC-013 | Custom roles: the API serves `POST /roles`, the client knows five roles | A — defer to the platform console | ADM-09 custom roles |
| DEC-014 | Write the remaining Tier 1–2 stories now; does axe block CI? | B — one pull request, axe advisory | F-09 |
| DEC-015 | Sticky first column on wide tables | A — leave unbuilt, amend DS §8.19 | §11.4 |
| DEC-016 | Close D-22 as "copy link"? | A | D-22 |
| DEC-017 | Caption 11 px vs DS 12 px | C — 12 px on touch | NEW-23 |
| §17.3 | Sign-off on DEC-012's 300 ms exit frames | — | NEW-22 |

Not decisions, but owner calls: whether to set a performance budget (§18.4), and whether to take NEW-05 (a structural move of the pharmacy demo store into `shared-domain`, demo-only) as its own pull request.

### 18.6 Stale text corrected

§1 F-07 and §9 row 1 ("no endpoint is live"); §6 DP-02 and DP-04 ("nothing else talks to a server"); ADM-01's "Investigate … arrives with ADM-07" (it links to `/admin/logs?type=impossible-travel` now); ADM-09's custom-role note (the API now serves it); F-09's story count (6 files covering 9 of 59 components, not "15 stories / ~45"); §10.5's three unticked boxes. One claim could not be reproduced and is left with a pointer rather than repeated: §13.2 F-07's "34 features are live" — `docs/FE-10-INTEGRATION-STATUS.md` records 27 Connected and 10 wired but Blocked.

### 18.7 Every item, in the audit's vocabulary

DONE = implemented and its required verification complete. "Required verification" is the register's own acceptance (tests plus a mock-mode browser check); **G-1 applies to every DONE row that talks to the API** — none has run against a live API.

| Status | Count | Items |
| --- | ---: | --- |
| DONE | 48 | Every §13 `COMPLETE_VERIFIED` row except NEW-22 |
| PARTIAL | 1 | F-18 — built and tested; its acceptance (each outcome announced once) needs NVDA / VoiceOver, unavailable here |
| OPEN | 1 | NEW-05 — the demo chart's regimen and the prescribing strip read different stores |
| BLOCKED | 20 | Backend: A-12a, ORG-01, NEW-04b (BR-DEC-003), §3.3 notes (BR-DEC-001), D-04/D-04b (M25), D-05 imaging, D-09, D-18, NEW-13, F35, ORG-02/ORG-03, §3.11 (M21). Mock-only, no route: D-27/D-27b/D-28, §3.1 pulse, D-15, D-24/§3.9, ADM-01/04/06/07/08/10/11 + AC-01…AC-16. Live verification blocked by F33 (no seeded admin second factor): ADM-02/03/05, ADM-09 roles. External: F-19 (a clinical translator) |
| DECISION REQUIRED | 6 | NEW-22 (§17.3 sign-off), F-09 (DEC-014), D-22 (DEC-016), ADM-09 custom roles (DEC-013), §11.4 (DEC-015), NEW-23 (DEC-017) |
| **Register total** | **76** | §13.2–§13.5 |
| BLOCKED (multi-hospital) | 14 | §13.6 — API-W01…W14, owned by `docs/work-phases/` Phases 21–26 |
| NOT APPLICABLE | 6 | A-10 (withdrawn: a false positive, disproved by test) · AC-01b (retired into ADM-01) · AC-20 (moot: the page it lived on is gone; the surviving link resolves) · DX-03 (forbidden by DS §9.4) · DX-04 and §10.5's reorder box (moot since the Overview became composable) · DX-07…DX-21 (retired with the Anatomy feature) |
| **All items** | **96** | |

**Is the checklist 100 % complete? No.** 48 of 76 register rows are DONE; 28 are not, and 14 multi-hospital rows sit outside the register, all blocked. Of the 28, the frontend can finish one without anyone else (NEW-05), and the six DECISION REQUIRED rows move as soon as the owner answers §18.5 (some by building, some by closing); the rest wait on the backend, a screen-reader pass, a clinical translator, or a live API.

### 18.8 PR #85

`frontend` → `main`, head `ef9dcf5`, merged by the owner at 2026-10-23 09:15 UTC as `f4a9e8d`. CI on the head: Frontend, Backend and Patient-app suites and the `CI` summary job all **success**; the push run on `main` after the merge (run 185) **success**. No reviews were recorded. The merge moves `main` to the state of `frontend` before this audit; it does not change any status above — the rows that were open on `frontend` are open on `main`. `frontend` is now 7 commits behind `main` (PR #85's merge and its two documentation commits), which is normal for an integration branch. Merging into `main` triggers a Vercel production build by design (PR #85 §3); this audit did not look at, change or trigger any deployment.

### 18.9 Gate after the audit

On this branch after the audit's changes: `typecheck` 0 errors · `lint` exit 0 — ESLint 0 errors, 20 accepted warnings; token check clean · `test` **224 files / 2,352 tests passed** (2,348 before, +4 from §18.3) · `build` passed. `prettier --check` clean on every changed file, this one included. Not run: the backend and patient-app suites (nothing in their trees, or in the cross-tree paths CI's filter names, changed), a screen reader, WebKit/Firefox, a physical device, a live API.

## 19. Completion pass 5 — 2026-10-24

**Scope.** The owner's "maximum completion pass": resolve DEC-013–DEC-017 and NEW-22's open point where the evidence allowed, do every other frontend-only item, and verify in the browser. Same branch as §18, `claude/medora-frontend-checklist-audit-am0xys`, on top of the audit (`401a879`). `frontend/` only — nothing in `backend/`, `patient-app/`, Prisma, the AI service, CI, `vercel.json` or any deployment setting changed. Nothing was pushed, opened as a pull request, merged or deployed; every commit below is local.

### 19.1 Method

Each change was test-first where it had behaviour: the new tests were run against the code before the change and failed there. The browser runs used Playwright 1.56.1 and Chromium against three bundles built from this tree: the demo (`VITE_ENABLE_MOCKS=true`, development mode); production mode with mocks (for Lighthouse, served gzip-compressed); and plain production (for bundle weight). Storybook was built statically and every story was loaded on its own. Not available here, so not run: a screen reader, WebKit, Firefox, a physical device, a live API (G-1).

### 19.2 The component workbench (F-09, DEC-014)

- **Coverage.** 45 new story files; 51 in all, 190 stories. All 72 public components are rendered by a story: `ui` 30, `feedback` 7, `patterns` 17, `patterns/dashboard` 5, `charts` 6 and `layout` 7. Only `ui/internal/` has no stories of its own: `Field`, `MenuList` and `InlineSpinner`, which render through `Input`, `Dropdown`/`ContextMenu` and `Button`. The stories cover each component's states as its props define them, including loading, empty, error, disabled and invalid. A shared component's variants are generated from its union types wherever it exports one. Interactive components get controlled wrappers.
- **Verification.** Each story was loaded alone in light and in dark (`globals=theme:dark`), with axe-core run on the page: **380 renders, 0 page errors, the `dark` class correct on every one, and 0 violations** once three rules are set aside. Those three are page-level: a `main` landmark, an `h1`, and `region`. An isolated component cannot meet them, and the app's shell supplies them.
- **What the sweep found.** Three real defects, each fixed with a test that fails on the old code:
  - **Badge.** In dark mode, a status badge on a selected or tinted table row fell to 3.8–4.6:1. The badge's 16 %-alpha tint compounded with the row's own. The tint is now painted as an image over an opaque `bg-surface`, so the badge reads 5.2–6.3:1 on any row. Light mode is unchanged, because its `*-subtle` tokens are opaque. In the app, the patients table in dark with three rows selected shows 0 contrast violations. `Badge.test.tsx` (7).
  - **ChartLegend.** A hidden series used `text-disabled`, 3.4:1, but it is still the control that turns the series back on. It is now `text-tertiary`, struck through. `ChartLegend.test.tsx` (2).
  - **FilterBar.** "Clear all" sat inside `role="list"`, which axe flags as `aria-required-children` (critical). It is now the list's sibling. On `/doctor/patients` with two filters applied, the list holds two list items and axe is clean, and the row looks the same. `FilterBar.test.tsx` (3).
- **`build-storybook` was broken** from `50d9807` onwards. The demo-access check fails any build in which the stub replaced nothing, and a workbench build never imports `features/auth/dev/`. The fix drops only that assertion, and only in `.storybook/main.ts`. The app's `npm run build` still runs it.
- **Not done:** CI. The pass instruction forbade changing it; whether the workbench runs in CI, and whether axe blocks a merge, stays DEC-014's open half (§19.4).

### 19.3 The decisions, built

| Item | What was built | Tests | Browser |
| --- | --- | --- | --- |
| DEC-016 / D-22 — Share | `copyText` is the one clipboard path; Share reports success with the access note, or failure with the address. Every other copy in the app reports failure the same way | `clipboard.test.ts` 4, `useShareLink.test.tsx` 3 | Clipboard granted: holds `/doctor/medical-records/MR-10002`'s URL, toast "Link copied". Refused: toast "Could not copy the link — Copy it from here: …" |
| DEC-017 / NEW-23 — Caption | `--text-caption` 12 px under `(pointer: coarse)`, 11 px otherwise; DS §3.2 records the implemented scale | `caption-size.test.ts` 3 | Mouse: 11 px on 75 captions. Touch emulation: 12 px on 114. Lighthouse mobile best practices **100** on `/doctor/appointments` and `/doctor/patients` (96 at the audit) |
| NEW-22 — Intro exit (§17.3) | The overlay's exit keyframes carry the old crossfade, `1 − a(t)·(1 − o(t))`, in 41 linear stops; skip has its own 220 ms set | `MedoraIntro.test.tsx` — every stop recomputed; reduced-motion behaviour asserted | Paused mid-exit through the Web Animations API, 10 samples: normal and skip within **0.01/255** of the approved curve (skip's intended last stop excluded). The page beneath stays at opacity 1, so LCP is unaffected |
| NEW-22 — reduced motion | The two reduced-motion exit fades added by `9e86690` could never run. `globals.css` collapses every animation to 0.01 ms `!important` under `prefers-reduced-motion`, and the 240 ms fade this file declared before had never applied either. Removed, and the comment, README and test now describe the actual behaviour: a cut at 520 ms | The test fails on the previous stylesheet | Measured: the exit runs 0.01 ms under `reducedMotion: 'reduce'` |
| DEC-015 / §11.4 — Sticky first column | Pinned only while the table overflows; `bg-surface` plus the row's tint as an image of `--row-bg`, which each row state sets | `DataTable.test.tsx` +6, `lab-row-tint.test.ts` 2 | The pinned cell's pixels are unchanged across a horizontal scroll in light/dark × en/ar × 1024/768, on doctor and admin tables. Dark critical rows are within 1/255 of the unpinned cells. The selection bar is kept |
| DEC-013 / ADM-09 custom roles | Role list (`GET /roles`) and creation (`POST /roles`), validated client-side and showing the server's 409. Custom roles are labelled, never offered for assignment. Sign-in names a role it cannot place and signs the server session out | role-rules 6, demo adapter +3, live adapter +4, `RolesSection` 4, login page +1, auth adapter +2 | Demo: "Ward clerk" created from Reception and listed with its base, "0 accounts · 0 active" and the no-workspace note. axe clean |
| NEW-05 — One regimen | Prescriptions moved to `shared-domain/prescriptions` (byte-identical, `git mv`) with one store. The chart's demo adapter projects from it | `medication-coherence.test.ts` 8 | PT-1001, 1002, 1003: the chart's prescription ids equal the prescribing strip's (`RX-200001`; `RX-200002`; `RX-200003` + `RX-200006`) |

### 19.4 Still open, by class

**A — frontend, doable now:** none known. Every row this pass could finish without someone else is finished.

**B — backend:**
- A-12a: re-authentication endpoint.
- ORG-01, ORG-02/03 and the fourteen API-W rows: Phases 21–26.
- NEW-04b: BR-DEC-003.
- §3.3 notes: BR-DEC-001.
- D-04/D-04b and NEW-13: M25 file storage.
- D-05 imaging: no imaging source.
- D-09: Phase 28.
- D-18: drug reference data.
- §3.11: M21.
- D-15, §3.1 pulse, D-24/§3.9, D-27/D-27b/D-28 and ADM-01/04/06/07/08/10/11 + AC-01…AC-16: no routes.
- F35: the flag never fires.
- ADM-09 custom roles, workspace half: the session must name the base role.

**C — owner decision:**
- DEC-014's CI half: whether the workbench and axe run in CI, advisory or blocking.
- A performance budget: none is set, so mobile performance is recorded, not judged.
- Long-lived `Cache-Control` for hashed `/assets/*`. `vercel.json` sets none, so Lighthouse's cache audit fails. It is a deployment setting, which this pass was not to touch.

**D — needs something this container lacks:**
- F-18: a screen reader.
- F-19: a clinical translator.
- ADM-02/03/05, ADM-09 roles and custom roles: a live run, which needs F33's seeded admin second factor.
- G-1: a live API.
- WebKit, Firefox and a physical device.

**E — deferred:** none beyond §3.11, which is a backend dependency.

The §17.3 sign-off no longer needs an answer: the exit now reproduces the approved frames rather than approximating them (§19.3).

### 19.5 Backend handoffs

- **Custom roles need a workspace.** `GET /auth/session` names `role` and `permissions`, not the base role a custom role copied. Until it names one (or a workspace), a custom-role account is refused at sign-in with a named message. Owner of the change: backend, `auth` module.
- **The role list needs `roles.manage`.** That is correct for the admin panel. Note that the client cannot learn a custom role's label in any other context.

### 19.6 Performance

Production build, gzip, against the audit (`401a879`):
- Eager JS: **165.76 → 165.99 kB** (+0.23 kB).
- All JS: 720.16 → 724.11 kB (+3.95 kB, the roles UI and the clipboard paths).
- CSS: 23.30 → 24.08 kB.

The prescription seed is in no production chunk. On the demo bundle, cold loads of seven routes change by −1.31 to +0.35 kB. The exception is the patient chart's medication tab, at +5.37 kB (+1.6 %): that is NEW-05's demo adapter, which loads the shared store.

Lighthouse, one run per cell, production mode with mocks:

| Route | Mobile | Desktop | Mobile best practices |
| --- | --- | --- | --- |
| `/doctor/overview` | 86 | 99 | 100 |
| `/doctor/appointments` | 80 | 96 | 100 |
| `/doctor/patients` | 82 | 97 | 100 |

Accessibility is 100 on all six. These match §18.4's medians within run-to-run noise.

Mobile LCP (3.5–4.2 s) is the price of a client-rendered app: about 166 kB of eager JS under simulated slow 4G. Fonts use `swap` and do not gate it. Moving it materially needs prerendering or a further split, not a tweak. No threshold was changed and no audit suppressed.

### 19.7 Gate

**Frontend**, on this branch at `7a60f14` plus this file:
- `typecheck`: 0 errors.
- `lint`: exit 0, with 0 errors and the 20 accepted warnings; the token check is clean.
- `test`: **234 files, 2,415 tests passed**, against 224 files and 2,352 tests after the audit.
- `build`: passed.

Also passed:
- `storybook build`, which failed at the audit's commit (§19.2).
- The demo build and the production-with-mocks build.
- `prettier --check` on every changed file.

**Backend**, run because `frontend/src/types/auth/` changed. CLAUDE.md requires it: `test/auth-frontend-contract.e2e-spec.ts` reads that directory. The database was a throwaway local PostgreSQL 16, prepared as CI does (`db:check` "No difference detected", `db:deploy`, `db:seed`):
- `typecheck` and `lint`: passed.
- `build`: passed.
- `test`, first run: 88 of 91 files passed. 26 tests failed in `auth-recovery`, `users-account` and `lab-review`, on cleanup foreign keys and a connection reset under parallel load. Run alone, those three plus the contract spec passed, 92 of 92.
- `test`, second full run: **91 files, 1,893 tests passed**.
- Nothing under `backend/` differs from `origin/frontend`. The first run's failures match the row contention PR #95 fixed on `backend`, and that fix is not yet on `frontend`.

**Patient app:** not run. No path its filter names (`01-enums.prisma`, `auth/dto/`) changed.

### 19.8 Commits (local, not pushed)

- `fdf8cef`: DEC-016.
- `b581170`: DEC-017.
- `fc6858e`: cherry-pick of `main`'s `a9aacf4`, the intro-session comment.
- `9e86690`: NEW-22.
- `28f17f3`: DEC-015.
- `579d615`: DEC-013.
- `0c3e7d8`: NEW-05.
- `e829cd6`: `build-storybook`.
- `946d607`: the three axe findings.
- `685c6d6`: stories.
- `7a60f14`: the intro's reduced-motion correction.
- This section and the register in the commit that adds them.

**Is the checklist 100 % complete? No.** 54 of 76 register rows are `COMPLETE_VERIFIED`. The other 22, and the 14 multi-hospital rows, wait on the backend, on an owner's CI or deployment call, or on verification this container cannot do (§19.4). None waits on frontend work alone.

## 20. Reconciliation — 2026-10-25

**Scope.** Frontend documentation only, on branch `claude/backend-contracts-checklist-reconcile` from `frontend` @ `f798830` (clean tree, identical to `origin/frontend`). Nothing in `backend/`, `patient-app/`, Prisma, the AI service, CI or deployment configuration changed. Nothing was merged or deployed.

### 20.1 Method

- **The whole file was read**, every section, table and nested checkbox, and each row's status cell compared with its narrative row above and with the code it cites.
- **The register was recounted** by `node scripts/count-checklist-register.mjs` (last status in each §13.2–§13.5 status cell).
- **Every checkbox** was compared with its canonical status: 92 list checkboxes (79 ticked, 13 not) plus 10 inline boxes in §10.5.
- **`backend` was read, not summarised.** Route inventories were extracted per branch from the controller decorators. `main` serves 162 routes, the same as `frontend`'s `backend/` tree. `backend` serves 286, matching the M34.2 snapshot. Each backend PR merged since PR #81 was read as a diff. The result is [`docs/handoff/BACKEND_FRONTEND_CONTRACTS.md`](../docs/handoff/BACKEND_FRONTEND_CONTRACTS.md).
- **Not done here:** a live API run (G-1), a screen reader, WebKit, Firefox, a physical device. No status was raised by this reconciliation; it corrects text, boxes and totals only.

### 20.2 Contradictions corrected

| Where | Was | Now |
| --- | --- | --- |
| §13.1 totals, header line 14 | 54 · 5 · 1 · 5 · 10 · 0 · 0 · 1 | **55 · 4 · 2 · 5 · 9 · 0 · 0 · 1** (76). PRs #102–#105 moved §3.3 notes and NEW-04b without recounting |
| §3.3 chart-notes box | Unticked, and "the API's edit and sign do not check the author" | Ticked to match §13.3 `COMPLETE_VERIFIED`; the author rule is on `backend`, **not `main`** — production waits on `backend` → `main` |
| §3.8 D-22 box | Unticked, "needs a sharing policy" | Ticked and struck: closed as copy-link by DEC-016 A |
| §10.5 "Lighthouse run" box | Unticked, "authenticated routes not run" | Ticked: Q-01 is `COMPLETE_VERIFIED` (§18.4) |
| §0 problem 2 | "Ten of fifteen administration sections are read-only" | Struck: Phase B closed it (AC-02…AC-13 ✅) |
| §1 F-11 | `manualChunks` (`react`, `motion`, `query`) | `react`, `query` — the `motion` chunk was reverted (DX-06; `vite.config.ts`) |
| §3.1 note | "Nothing in §10 has been started" | F1 shipped, F4 done, F2/F3 retired |
| §6 DP-03 | Contract on `claude/healthcare-backend-analysis-16b5ee` | That branch is gone; the contract is `backend/docs/BACKEND_API_CONTRACT.md` |
| §9 rows 3, 13, 14 | M25 "four empty directories"; lab and record endpoints "owed" | M25 built on `backend` but held by the scan gate; lab and record routes served on `main` |
| §9.0 | No status per requirement | Status column from `backend` source: 001, 002, 004 implemented; 005 report mode; 003 partial; 006 part 4 only |
| §9.1 | API-W01 switcher and memberships, W03 affiliations, W04 shared summary | Marked superseded by OWNER_DECISIONS DR-02, DR-03, DR-06, DR-08; reveal (M7.3) noted on `backend` |
| §13.3 §3.1 pulse, D-04, D-24, §3.10, §3.12, NEW-13, §3.11; §13.4 admin row | "No route", or "M25", "M27", "M21" | Each names what `backend` now serves and why it is or is not wired |
| §14.1 DEC-006a | No note on BR-DEC-006 | Part 4 implemented on `backend`; parts 1–3 not |

**Kept deliberately, as history:** §18.7's and §19.4's lists (they describe their dates), §19.8's "local, not pushed" commits (they merged with PR #95), and the ⚠ 2026-10-06 notes in §3–§5 (the header's 2026-10-07 caveat already says the owner decisions win).

### 20.3 The register now — 76 rows

| Bucket | Rows | IDs |
| --- | ---: | --- |
| `COMPLETE_VERIFIED` | 55 | F-01…F-17 group, F-07, F-09, F-12, §11.4, F-14, A-01, A-02…A-11 group, A-08, D-26, NEW-17…20, §3.1 widgets, D-01/DX-22/DX-23, §3.2, §3.3 chart, allergy/vitals, NEW-01…03, NEW-04a, §3.3 notes, D-06, D-07, NEW-06, NEW-07, §3.4, NEW-08, D-08, D-10…D-14, exports, D-25, NEW-16, D-17/D-19, NEW-09, NEW-10, §3.7 notes/monograph, NEW-05, D-21/D-29, NEW-11, NEW-12, D-22, §3.10, §3.12, ADM-09 members, NEW-14, NEW-15, Q-01, NEW-23, Q-02, Q-03, NEW-21, NEW-22 |
| `IMPLEMENTED_UNVERIFIED` | 4 | F-18 · ADM-02/03/05 · ADM-09 roles · ADM-09 custom roles |
| `PARTIAL` | 2 | F-19 · NEW-04b |
| `MOCK_ONLY` | 5 | D-27/27b/28 · §3.1 pulse · D-15 · D-24/§3.9 · ADM-01…AC-16 group |
| `BLOCKED_BACKEND` | 9 | A-12a · ORG-01 · D-04/D-04b · D-05 imaging · D-09 · D-18 · NEW-13 · F35 · ORG-02/03 |
| `BLOCKED_DECISION` · `NOT_STARTED` | 0 · 0 | — |
| `DEFERRED` | 1 | §3.11 |

Of the 55, every one that talks to the API is contract-tested, not live-run (G-1). Five of them use a route or field served only on `backend`: §3.3 notes (the author refusal), NEW-04a (reasons), NEW-08 (clinic timezone and stranded report, with a fallback when absent), NEW-10 (discard) and NEW-12 (reason, author refusal). So does NEW-04b's removal, which is `PARTIAL`.

**The 21 rows that are not complete, by what holds them.** A row can sit in several columns, and each is counted once in the table above.

| Row | Status | Backend | Only on `backend` | Hospital isolation | Owner | External verification | Note |
| --- | --- | :-: | :-: | :-: | :-: | :-: | --- |
| F-18 | IMPLEMENTED_UNVERIFIED | | | | | ● | NVDA / VoiceOver |
| F-19 | PARTIAL | | | | | ● | Clinical translator |
| A-12a | BLOCKED_BACKEND | ● | | | | | No re-auth route on any branch |
| ORG-01 | BLOCKED_BACKEND | ● | | ● | | | Now "active hospital in the session"; no switcher (DR-08) |
| D-27/27b/28 | MOCK_ONLY | | ● | ● | | | `/administration/queue` single-tenant |
| §3.1 pulse | MOCK_ONLY | | ● | | | | M27 served on `backend`; doctor-own data — **eligible next** |
| NEW-04b | PARTIAL | ● | | | ● | | Correction route, removed-entry read; who-may is the owner's |
| D-04/D-04b | BLOCKED_BACKEND | ● | ● | | | | No object store, no scanner |
| D-05 imaging | BLOCKED_BACKEND | ● | | | | | No source |
| D-09 | BLOCKED_BACKEND | | | ● | | | Phase 28 |
| D-15 | MOCK_ONLY | ● | | | | | No annotation route |
| §3.11 | DEFERRED | | ● | | | | M21 on `backend` — **eligible next** |
| D-18 | BLOCKED_BACKEND | | | | | ● | Drug reference dataset |
| D-24/§3.9 | MOCK_ONLY | ● | ● | ● | | | No recipient lookup; API-W09 |
| NEW-13 | BLOCKED_BACKEND | ● | ● | | | | M25.2/M25.3 |
| ADM-02/03/05 | IMPLEMENTED_UNVERIFIED | | | | | ● | F33 — seeded admin second factor |
| ADM-09 roles | IMPLEMENTED_UNVERIFIED | | | | | ● | F33 |
| ADM-09 custom roles | IMPLEMENTED_UNVERIFIED | ● | | | | ● | Session must name the base role; F33 |
| ADM-01…AC-16 | MOCK_ONLY | | ● | ● | | | M23/M28/M20.7/M7.3 single-tenant |
| F35 | BLOCKED_BACKEND | ● | | | | | Flag never fires |
| ORG-02/03 | BLOCKED_BACKEND | ● | | ● | | | Phase 26 |

Column totals: backend 11 · only on `backend` 8 · hospital isolation 7 · owner 1 · external verification 6.

### 20.4 Outside the register

- **Multi-hospital rows: 14** (API-W01…W14, §9.1 and §13.6), all `BLOCKED_BACKEND`. No hospital-scoped route exists on any branch. Ten of them carry an unticked ⚠ box in §3, which agrees.
- **Nested sub-tasks: 92 list checkboxes** (79 ticked, 13 unticked) and **10 inline boxes** in §10.5 (9 ticked; DX-04's reorder box is moot). They are the narrative under the register rows, not separate rows. After this pass every unticked box is a row that is still open: the ten ⚠ boxes, D-04b, D-09 and D-18.
- **Not applicable: 6** (as §18.7).

### 20.5 What `backend` now serves that the frontend can use

By the repository's practice since PRs #102–#105, a frontend change may consume a route that exists only on `backend`, provided it says so and fails visibly against a `main`-built API. On that basis, the per-user, tenant-neutral routes are eligible now:

- notification **archive, favourite, pin and clear-read** (§3.10) — **built, NEW-24** (§20.6);
- notification **preferences** (§3.12) — **built, NEW-24** (§20.6);
- then the doctor's own **dashboard pulse** (M27, §3.1 pulse) and **reports** (M21, §3.11).

Everything hospital-shaped stays unwired until a hospital-scoped route exists (DP-02's rule): administration, audit, oversight, messaging and search. The decision is the owner's integration call on `backend` → `main`, not this file's.

### 20.6 Built: NEW-24 — notification flags, clear-read and preferences over the API

Branch `claude/notifications-organize-preferences`, stacked on this reconciliation. Evidence is on the register row (§13.3 NEW-24). What a reviewer should know:

- **It depends on `backend`.** Every route it adds a call to is served only there (RM M19.3, M19.4). Against an API built from `main`: a flag or clear-read write answers 404, the list rolls back and a toast names the failure; preferences fail to load and the section says so. That is the shape PRs #102–#105 already shipped (`DELETE /prescriptions/{id}`), not a new kind of dependency.
- **Two silent failures fixed on the way**, both pre-existing in shape: a refused read/archive/favourite/pin rolled the row back with no message, and a refused "Clear read" (page and bell) said nothing. In the demo neither could fail, so neither was visible.
- **Tests changed because their premise changed, not to pass:** `live-preferences.test.tsx` asserted "not connected" and `live-actions.test.tsx` asserted no Archive. Both now assert the live behaviour, and the parts still unserved (Delete, messaging) are still asserted absent and send nothing.
- **Gate** (this branch): `typecheck` 0 errors · `lint` 0 errors, 20 accepted warnings, token check clean · `test` **236 files / 2,482 tests passed** · `build` passed. Eager JS 169,690 → 169,746 bytes gzip (+56 B, `dist/index.html`'s entry and preloads, gzip −9), measured against a build of `origin/frontend`.
- **axe** (axe-core, WCAG 2.0/2.1 A/AA and 2.2 AA tags) on the demo bundle: Settings → Notifications and the Notifications page with the preferences drawer open, at 1440 and 375 px — **0 violations** on all four.
- **Not run:** a live API (G-1), a screen reader, WebKit, Firefox.

## 21. Completion sprint — 2026-10-25

**Scope.** Frontend only. Each task is its own branch, stacked in order on `frontend` @ `02dd6fe` (PR #106 merged at `cd7ea13`, PR #107 at `02dd6fe`), each with its own pull request into `frontend`. Nothing in `backend/`, `patient-app/`, Prisma, the AI service, CI or deployment configuration changed. Nothing was merged or deployed.

### 21.1 Method

- **The register was re-read and recounted** before any change (`node scripts/count-checklist-register.mjs`: 56 · 4 · 2 · 5 · 9 · 0 · 0 · 1 = 77, matching §13.1's last column). §19.4 class A ("frontend, doable now") was empty; §20.5 named the per-user, tenant-neutral routes on `backend` as the next eligible work. Those are what this sprint built, in that order.
- **`backend` was read from source** at `7ed7e4d` (unchanged since §20), in a detached worktree outside the repository: the controller, service and schema of each module consumed. `main` at `f4a9e8d` still serves only `GET /dashboard/doctor/action-queue` under `/dashboard/doctor` — none of the routes below.
- **The repository's rule for backend-only routes (§20.5) was kept:** a call is made only where it fails visibly against a `main`-built API, and every row says which branch serves it.
- **Browser checks** ran on two bundles served by `vite preview`: a live bundle (`VITE_ENABLE_MOCKS=false`) whose API host Playwright intercepts — unmatched routes answer 404, as `main` does for a route it lacks — and the demo bundle (`build:demo`'s settings). axe-core 4 from `frontend/node_modules`, tags `wcag2a wcag2aa wcag21a wcag21aa wcag22aa`.
- **Not run:** a live API (G-1), a screen reader, WebKit, Firefox, a physical device.

### 21.2 §3.1 pulse — the Overview's trend, satisfaction and recent activity (RM M27; filed as NEW-25, retired)

Branch `claude/dashboard-m27-widgets`. Evidence on the register row (§13.3 §3.1 pulse). What a reviewer should know:

- **Independence is the design.** The server built per-widget routes so that "one slow or failing widget cannot blank the first screen a doctor sees" (`doctor-dashboard.controller.ts`). The client keeps that property: the three load in parallel with the core, never reject, and report per section. The core (summary, today's book, action queue, directory) still fails as one, as before.
- **A 404 is not a failure here.** These routes take no parameters, so a 404 can only mean the route is not served — the `main` case. Showing it as "Couldn't load … Retry" would offer a retry that can never succeed; it reads as "Not available yet". Any other status, or a body that does not parse, is a failure of that widget.
- **What did not change:** practice pulse (no route on any branch), the four KPI tiles (still `/appointments/summary`; M27's `/kpis` would add a week-on-week delta but is backend-only, and the tiles are a `COMPLETE_VERIFIED` row that works against `main` today), and the catalogue.
- **Gate** (this branch): `typecheck` 0 errors · `lint` 0 errors, 20 accepted warnings, token check clean · `test` **236 files / 2,498 tests passed** (baseline on `02dd6fe`: 236 / 2,482) · `build` passed · `prettier --check` clean on the feature.

### 21.3 §3.12 — Settings → Privacy and Integrations (RM M22; filed as NEW-26/NEW-27, retired)

Branch `claude/settings-privacy-m22`, stacked on `claude/dashboard-m27-widgets`. Evidence on the register row (§13.3 §3.12). What a reviewer should know:

- **Same independence rule as §3.1 pulse.** `GET /me/settings` cannot take the Account, Security or Activity sections down with it; the two sections it feeds carry their own state.
- **Concurrency is the server's, and the client honours it.** The `updatedAt` sent is the one from the latest read, kept in the adapter per user (the cache always holds that read's document). A 409 is not "try again" — retrying would fail the same way — it is "changed elsewhere", followed by the stored values.
- **A defect found by the browser run, not the unit tests.** After a 409 the re-read document equalled the first, so `useEditableSection` saw no change and kept the unsaved edit on screen under a toast claiming the stored values were shown. Fixed by replacing the draft from the re-read; the live test now asserts the switch reverts and the save bar leaves, and fails without the fix (checked).
- **Nothing is offered that the server refuses.** Connect (501) is withheld with a sentence in its place; the demo-only account deletion is withheld live.
- **Harness note.** On a fresh session the brand intro (DEC-012) covers the page for its duration and takes clicks; the browser scripts wait for `.medora-intro` to detach before interacting. Expected behaviour, recorded so a later run does not chase it.
- **Gate** (this branch): `typecheck` 0 errors · `lint` 0 errors, 20 accepted warnings, token check clean · `test` **237 files / 2,517 tests passed** · `build` passed · `prettier --check` clean on the feature. Browser 32/32 (privacy served, 409, `main` at 375 px, integrations served and at 375 px, demo), axe 0 violations in every live state.

### 21.4 §3.11 — Reports & Analytics (RM M21; saved/scheduled filed as NEW-28, defects as NEW-29, both retired)

Branch `claude/reports-m21-http`, stacked on `claude/settings-privacy-m22`. Evidence on the register row (§13.3 §3.11). What a reviewer should know:

- **The server's snapshot is the client's type.** `backend` transcribed `AnalyticsSnapshot`, `CATEGORY_VIEW` and the KPI ids, so the adapter is a strict parse, not a translation. Two deliberate departures are handled: no KPI icon on the wire (chosen by id), and revenue while billing is off is a different document.
- **What is withheld, and why each is honest.** Four filters the server does not apply; rename and favourites with no route; schedule delivery that the backend itself registers as blocked. Each is a `capabilities` flag the screens read, and each says so on screen where a doctor would otherwise expect it. The demo keeps all of them.
- **Export unchanged in shape.** The dialog's engine builds every format from the snapshot on screen; over HTTP `runExport` does no server work. The server's `POST /reports/export` serialises the same snapshot as CSV and answers 501 for PDF and Excel, so calling it would add a round trip and lose formats.
- **Found on the way** (bug fixes to §3.11), pre-existing in both modes: a run-together schedule caption and a hard-coded demo address as every user's default recipient. Also pre-existing and fixed: every saved-report and schedule write was silent on failure.
- **Gate** (this branch): `typecheck` 0 errors · `lint` 0 errors, 20 accepted warnings, token check clean · `test` **239 files / 2,540 tests passed** · `build` passed · `prettier --check` clean on the feature. Browser 35/35 plus a live CSV export; axe 0 violations on every live state.

### 21.5 The register after the sprint

`node scripts/count-checklist-register.mjs` (main register, §13.2–§13.5): **77 rows — 57** `COMPLETE_VERIFIED` · 4 `IMPLEMENTED_UNVERIFIED` · 3 `PARTIAL` · 4 `MOCK_ONLY` · 9 `BLOCKED_BACKEND` · 0 `BLOCKED_DECISION` · 0 `NOT_STARTED` · 0 `DEFERRED`. Before the sprint: 77 rows, 56 complete. Tracked separately, not added in: 14 multi-hospital rows (§13.6, all `BLOCKED_BACKEND`), and the §9 dependency register (17 rows; 15–17 added by this sprint under existing IDs).

**What is still open, and what holds it** (each counted once above):

| Row | Status | Held by |
| --- | --- | --- |
| F-18 | IMPLEMENTED_UNVERIFIED | A screen reader (NVDA / VoiceOver) |
| ADM-02/03/05 · ADM-09 roles · ADM-09 custom roles | IMPLEMENTED_UNVERIFIED | A live run with F33's seeded admin second factor; custom roles also need the session to name the base role (backend) |
| F-19 | PARTIAL | A clinical translator (~2,045 strings) |
| NEW-04b | PARTIAL | BR-DEC-003 points 1 and 4; who-may is the owner's |
| §3.1 pulse | PARTIAL | Practice pulse: no route on any branch (§9 row 15) |
| D-15 · D-24/§3.9 · D-27/27b/28 · ADM-01…AC-16 | MOCK_ONLY | No annotation route (D-15); recipient lookup and API-W09 (messaging); hospital-scoped routes (the rest) |
| A-12a · ORG-01 · ORG-02/03 · D-04/D-04b · D-05 · D-09 · D-18 · NEW-13 · F35 | BLOCKED_BACKEND | As §20.3 — unchanged by this sprint |

Remainders inside `COMPLETE_VERIFIED` rows, by the register's convention in their Remaining cells: §3.12 integration Connect (§9 row 16); §3.11 saved-report rename and favourites, and schedule delivery (§9 row 17).

**After the sprint (2026-10-25), on the existing row §3.1 widgets:** the "Completed this week" tile's week-on-week comparison over M27's `/kpis` (evidence on the row; no new ID — the tile is that row's).

**Frontend work doable now, without the backend, an owner or external verification: none known.** The routes this sprint consumed are on `backend` only; production readiness of §3.1 pulse, §3.12's privacy and integrations and §3.11 waits on `backend` → `main` and a live run (G-1).

## 22. Completion batch — 2026-10-25

**Scope.** Frontend only, one task branch, `claude/frontend-checklist-batch-overview`, from `frontend` @ `38822d0` (PRs #117 NEW-12, #118 ADM-09 dry run and #119 toast timers merged, none recreated or reverted). Nothing in `backend/`, `patient-app/`, Prisma, the AI service, CI or deployment configuration changed. Nothing was merged or deployed.

### 22.1 Method

- **The register was re-read and recounted** before any change: 77 rows, 57 · 4 · 3 · 4 · 9 · 0 · 0 · 0, matching §13.1's last column. §21.5 recorded no frontend-doable work.
- **`backend` was re-read for movement since §20:** it is at `c93c233`, ten commits past `7ed7e4d`, and adds no route (security, Zod 4 and seed fixes only).
- **Routes against calls, rather than rows against rows.** Every controller route on `main` (162) and `backend` (286) was listed from the decorators. That list was compared with every path literal in non-test, non-mock `frontend/src`, and each unmatched route was read by hand: most were paths assembled from variables, and the rest were already accounted for (§20.5's rule for hospital-shaped routes, D-09's Phase 28 gate, `/me/data-export`'s 501).
- **The register cannot show a gap that no row records**, so each served-but-unused route was checked against the UX spec. One was a spec requirement with no row: `GET /dashboard/doctor/critical-alerts` is UX §2.1's Row 0, which nothing rendered. Built as **NEW-30**.
- **Browser checks** ran on two bundles served by `vite preview`: a live bundle (`VITE_ENABLE_MOCKS=false`) whose API host Playwright intercepts, with unmatched routes answering 404 as `main` does, and a demo bundle. axe-core 4 came from `frontend/node_modules`, tags `wcag2a wcag2aa wcag21a wcag21aa wcag22aa`.
- **Not run:** a live API (G-1), a screen reader, WebKit, Firefox, a physical device.

### 22.2 NEW-30 — the Overview's Row-0 critical alerts banner (RM M27.3)

Evidence is on the register row (§13.3 NEW-30). What a reviewer should know:

- **Silence is the failure it exists to prevent.** The server answers 5xx rather than `[]` when a source query fails, because "an empty banner is indistinguishable from a safe one" (`critical-alerts.service.ts`). The client keeps that: its own query, never a widget, not dismissible. A failure is said in the same error variant, and the last alerts stay listed beneath it. Only a 404 says nothing, because there nothing was checked (`main`).
- **Strict, but never lossy.** An alert of an unknown kind, or one with an unreadable instant, fails the whole answer, which the doctor sees as "Couldn't check"; dropping that one alert would show a banner that lies by omission. Links work the other way: a path the client does not recognise must not cost the alert, so it falls back to the kind's list, and the body never chooses where an action goes.
- **Found by the browser run, not the unit tests:** at 375 px the action kept its line and squeezed each summary into a one-word column. The action now wraps beneath its text.
- **Gate** (this branch): `typecheck` 0 errors · `lint` 0 errors, 20 accepted warnings, token check clean · `test` **243 files / 2,613 tests passed** (baseline on `38822d0`: 240 / 2,578) · `build` passed · `prettier --check` clean on the feature. Eager JS 170,783 → 170,766 bytes gzip (hash-name noise): the banner is in the lazy Overview chunk.
- **Browser 28/28:** live served at 1440 and 375 px (three kinds, rebuilt links, no overflow, no dismiss control, Review result opens the lab report), `main`-shaped 404 (no banner), 500 at both widths (the failure and Check again), and the demo against the Labs chip ("Critical unreviewed: 2", two rows). axe found 0 violations in every state, and there were 0 page errors. A dark-scheme screenshot was checked by eye.

### 22.3 Found, recorded, not built

- **Inline request decisions on the Overview (UX §2.1)** go in the §3.1 widgets Remaining cell. The decision list links each request to its appointment, where Accept, Propose time and Reject live. Doing it inline is a cross-feature design question (§3.4), not a defect.
- **A conflict alert carries no patient id** (§9 row 18, backend), so its action opens the day's book rather than the chart.
- **§0 problem 3 was stale:** lab ordering exists (DX-23). Corrected in place.

### 22.4 The register after the batch

`node scripts/count-checklist-register.mjs` (main register, §13.2–§13.5): **78 rows — 58** `COMPLETE_VERIFIED` · 4 `IMPLEMENTED_UNVERIFIED` · 3 `PARTIAL` · 4 `MOCK_ONLY` · 9 `BLOCKED_BACKEND` · 0 `BLOCKED_DECISION` · 0 `NOT_STARTED` · 0 `DEFERRED`. Tracked separately, not added in: 14 multi-hospital rows (§13.6, all `BLOCKED_BACKEND`) and the §9 dependency register (18 rows; row 18 added here). The 20 rows still open are §21.5's list, unchanged. Each is held by a backend route, a hospital-scoped API, an owner, or a verification this container cannot run.

**Frontend work doable now, without the backend, an owner or external verification: none known.** That holds after the route-against-call comparison above, not just by the register's own account. Production readiness of NEW-30 waits on `backend` → `main` and a live run (G-1).

## 23. Completion pass 6 — 2026-10-26

**Scope.** The owner's "complete the maximum frontend checklist tasks without duplicates" pass, on the `frontend` branch as the session designated, on top of `38d2e52`. Every checklist was re-read against the code first. §22 held: no register row could move on frontend work alone. The open frontend work was in [`docs/multi-hospital/CLIENTS_CHECKLIST.md`](../docs/multi-hospital/CLIENTS_CHECKLIST.md), which is authoritative for WEB/PA. Nothing in `backend/`, `patient-app/`, Prisma, the AI service, CI, `vercel.json` or any deployment setting changed.

### 23.1 What was done

| Item | What changed | Tests |
| --- | --- | --- |
| NEW-31; WEB-4, account half | `AuthProvider` clears the TanStack Query cache on logout, on a refused refresh and on lock, as FRONTEND_ARCHITECTURE §6.3 and §12.5 require. Before, nothing called `clear()` | `AuthProvider.test.tsx` +4; three of them fail on the old provider |
| WEB-5 (partial) | `useClinicScope` fails closed. A doctor whose session has no `clinicId` gets `null`; before, that fell through to the admin's "every clinic". My Clinic renders "Your session does not name a clinic" and does not fetch the board. Signed out is `null` as well. `docs/handoff/clinic-isolation.md` is updated to match | `MyClinicPage.test.tsx` +2; both fail on the old hook |
| WEB-8 | The safety screen's subtitle and its clean result say "this hospital's record of the patient". The patient Overview opens with "This hospital's record of the patient: what this hospital has recorded, not their history at other providers." | `SafetyScreen.test.tsx` (2, new), `OverviewTab.test.tsx` +1 |
| WEB-2 | No code existed to remove. `src/app/no-hospital-switcher.test.ts` now pins the rule: no route and no control (comments stripped) worded as a hospital, organization, clinic, tenant or workspace switcher. A third case proves the pattern catches one | 3, new |

### 23.2 Browser verification

Playwright with Chromium against the mock-mode dev server, at 1440 × 900, on this tree (`38d2e52` plus this pass). Each check signs in as `doctor@medora.health` and opens `/doctor/patients/PT-1001` by client-side navigation; a reload would drop the cache and prove nothing. The check then signs out through the avatar menu, signs back in, and opens the chart the same way.

- **New code:** the chart's skeleton shows after re-login. The chart was fetched again.
- **Old `AuthProvider`, same run:** no skeleton. The chart came from the previous session's cache, which is NEW-31.
- The Overview's provenance line renders above the summary, with "Raise alert" beside it.
- The demo doctor's session names a clinic, so My Clinic renders the board. The no-clinic state was not reachable through the browser, because every seeded doctor has a clinic; it is covered by the unit tests only.
- No page errors were raised.

Not run: 375 px, dark theme and RTL for the new caption. A screen reader, WebKit and Firefox were unavailable.

### 23.3 Gate

`frontend`, on this tree:
- `typecheck`: 0 errors.
- `lint`: exit 0, with 0 errors and the 20 accepted warnings; the token check is clean.
- `test`: **245 files, 2,625 tests passed**. This pass adds 2 test files and 12 tests: no-switcher 3, `SafetyScreen` 2, `AuthProvider` 4, `MyClinicPage` 2 and `OverviewTab` 1.
- `build`: passed.

The backend and patient-app suites were not run. Nothing under `frontend/src/types/auth/` changed, and no path the patient-app filter names changed.

### 23.4 Still open

The same classes as §19.4 and §22. WEB-1, WEB-3, WEB-6, WEB-7, WEB-9…WEB-16 and the rest of WEB-4/WEB-5 wait on Phases 21–28. `CLIENTS_CHECKLIST.md` § Status — 2026-10-26 lists each with its blocker.

## 24. Completion pass 7 — 2026-10-26

**Scope.** "Complete the remaining frontend work", on task branch `claude/frontend-live-verification` from `frontend` @ `d30a432`, delivered as one pull request into `frontend`. Every non-`COMPLETE_VERIFIED` row was re-read first: §19.4 and §22 held, and no row could move on frontend work alone. The pass therefore did the verification the earlier passes left open, and it fixed what that verification found. Nothing in `backend/`, `patient-app/`, Prisma, the AI service, CI, `vercel.json` or any deployment setting changed.

### 24.1 Considered and not done

- **A live admin run for ADM-02/03/05, ADM-09 roles and custom roles (F33).** PostgreSQL 16 and Redis are present in this container, so the backend could have been run locally. The seed writes no password and no TOTP for any account, and that is deliberate (`backend/prisma/seed/demo.ts`). A live admin session would therefore have needed a credential and a TOTP secret written straight into the database. That would invent authentication state outside the system's own flows, and FE-10's validation lists it as a line not crossed ("No TOTP secret injection"). It stays blocked on a seeded admin second factor, which is a backend decision.
- **The AI assistant over `/ai/*`.** The routes exist, but D-09 holds the assistant until Phase 28's hospital isolation (WEB-9). The seam's comment said no endpoint existed. That is corrected, with no change in behaviour.
- **WEB-4 and WEB-5.** Re-checked against `backend` and `main`: there is still no session hospital or employment (`CLIENTS_CHECKLIST.md`, § Status).

### 24.2 The sweep, and what it found

**Method.** Playwright 1.63 with Chromium against a mock-mode demo build served locally by `vite preview` (nothing deployed), with axe-core 4.13 at WCAG 2.0/2.1/2.2 A and AA:
- **Coverage:** 45 routes across all five seeded roles (doctor, admin, reception, laboratory, pharmacy). That is each section's main page, the twelve doctor settings sections and one patient chart. Not visited: the legacy `/doctor/administration` redirect, and detail routes other than the chart, which the record shots below reach.
- **Combinations:** light and dark × English and Arabic × 1440 and 375 px, so **360 page states**.
- **Each page:** axe violations, horizontal overflow of the document, page errors, and whether it landed on its own route.
- **Sanity checks:** in the dark Arabic run the document was `dir="rtl"`, `lang="ar"` and carried `dark`, and an `<img>` without `alt` planted on the page was reported (`image-alt`).

**Result, before this pass's fixes:** 0 axe violations, 0 overflow, 0 page errors and 0 redirects on all 360. Pass 6's open browser checks — its caption at 375 px, in dark and in RTL — are covered by this.

**After the fixes, on the final build:** the same 360 page states, still with 0 axe violations, 0 overflow, 0 page errors and 0 redirects. That build was formatted by Prettier afterwards: three files, whitespace only, and the gate below ran on the formatted tree.

**What axe cannot see.** Screenshots of the Arabic patients list, pharmacy list and patient chart showed clinical values in the wrong order: NEW-32. They also showed phone numbers cut short in the summary cards, in both languages: NEW-33. After the fixes, the same screens read:
- `O+`, `O-` and `AB+`;
- `+20 100 214 3387`;
- `250 mg` and `7 days`;
- `68 bpm`, `13 /min` and `36.8 °C`;
- `MRN 4411-27 · PT-1001 · 52 y · Male · Blood O+`;
- `Glucophage 850 mg`, which is unchanged;
- the full phone number, wrapped onto two lines.

The first version of NEW-32 isolated the blood group inside the identity line and the dose after the drug name. The screenshots showed both regress ("O+ MRN … Blood", "850 mg Glucophage"). Both were corrected before commit, and the rule is now in `docs/handoff/i18n.md` §5.

### 24.3 Documentation corrected

- `docs/FE-10-INTEGRATION-STATUS.md` — a dated note on its "Still Mock" table. Four rows (Overview widgets, reports, privacy and integrations, notification preferences) have been connected since 2026-10-05, and F40 is resolved for reports and superseded by D-09 for the AI. The record itself is left as written.
- `features/doctor/ai/service.ts` — the comment now says what holds the assistant back (D-09, Phase 28), not that no endpoint exists.
- `docs/handoff/i18n.md` §5 — clinical values, and the two refinements of the `dir="ltr"` rule.
- `docs/multi-hospital/CLIENTS_CHECKLIST.md` — the dated re-check above. No status changed.

### 24.4 Gate

`frontend`, on the final tree:
- `typecheck`: 0 errors.
- `lint`: exit 0, with 0 errors and the 20 accepted warnings; the token check is clean.
- `test`: **249 files, 2,633 tests passed**, against 245 and 2,625 after pass 6. That is 4 new files and 8 new tests: `latin-values` ×2 (2 + 2), `PatientIdentityHeader` 1, `OverviewTab` +1 and `FactList` 2. All of NEW-32's tests fail on the old code.
- `build`: passed.
- `build-storybook`: passed, with the new `ReadWhole` story.
- `prettier --check`: clean on every changed file. To get there, Prettier re-laid three existing blocks in `DoctorTabs.tsx`, layout only: line breaks and indentation, with no prop or text changed.

### 24.5 Not run

A screen reader (F-18), WebKit, Firefox, a physical device, a live API (G-1), and the backend and patient-app suites. No file their path filters name changed.

## 25. Completion pass 8 — 2026-10-27

**Scope.** "Continue after PR #124", on task branch `claude/frontend-rtl-clinical-values`, cut from `frontend` @ `cb4f298` (PR #124's merge). Every non-`COMPLETE_VERIFIED` row and every open box in this file and in `CLIENTS_CHECKLIST.md` was re-read: all still wait on the backend, a screen reader, a translator, F33, or an owner decision (§19.4, §22, §24.1). The one frontend gap this pass found was in NEW-32 itself. Nothing in `backend/`, `patient-app/`, Prisma, the AI service, CI, `vercel.json` or any deployment setting changed.

### 25.1 Why NEW-32 reopened

Pass 7 closed NEW-32 from screenshots of five screens (§24.2) and wrote its acceptance as "each value reads as written in all five languages". This pass took Arabic screenshots of a lab report and a prescription. Both showed the same defect on screens pass 7 never looked at, and the lab one is the most dangerous instance so far:

| Shown in Arabic | Meant |
| --- | --- |
| "µL/0.510³" | `0.5 10³/µL` |
| "17.0g/dL –12.0" | the range `12.0–17.0 g/dL`, printed backwards |
| "50.0% –36.0" | `36.0–50.0 %` |
| "mg 250", "days 7" | `250 mg`, `7 days` on the prescription |

### 25.2 Method: a DOM scan, not a sample

A Playwright script signed in as each of the five seeded roles, with Arabic set, against a mock-mode demo build served locally. It visited:
- every main page;
- the twelve doctor settings sections;
- two patient charts and every chart tab;
- two lab reports, two records and two prescriptions;
- the first step of the new-record, new-prescription and new-lab-order flows.

On every page it collected each element under `main` whose own text has a digit and no Arabic, sits in a computed `direction: rtl`, and starts with a digit or sign alongside a Latin letter or unit, or ends with a sign.

**Before:** 277 hits in 79 text shapes. Each was classified by the bidi rules, not by eye:

- **Values, fixed (§25.3):** measurements with a unit, lab results and ranges, durations, waits, file sizes, ages, the `61 · M` cells, the picker lines and `65+`.
- **English phrases, accepted:** "4 on record", "2 days ago", "1 of 3 remaining" and the like. That is F-19's documented case (`docs/handoff/i18n.md` §6), fixed by translation, not layout.
- **Not defects** (`i18n.md` §5 now lists them):
  - `12.4%`: the per cent sign binds to the number.
  - Heatmap hours (`8a`).
  - `143 · 15%`: two separate numbers laid out right to left, which an RTL reader takes in order.
  - "850 mg" after a drug name: the scan sees the dose span alone, but the line reads correctly.

**After:** 161 hits in 46 shapes, all in the last two groups. No value shape remains.

### 25.3 What was pinned

- **`<span dir="ltr">`:**
  - lab result value and unit, reference range and unit, turnaround and specimen volume;
  - prescription strength, dosage and duration, on the detail page and in the review step;
  - age in the lab, record and prescription summary cards;
  - the age · sex line in the patients, appointments, labs, pharmacy and records lists;
  - appointment duration in the table, the cards and the drawer;
  - My Clinic's time · area line;
  - the oversight table's and drawer's age in state;
  - file sizes on the documents tab and the record and lab attachments.
- **`isolateLtr()`** (new, `src/i18n/bidi.ts`), for string props where no span can go:
  - the new-record and new-prescription picker lines (radio descriptions);
  - My Clinic's wait badge;
  - the appointment-duration and slot-length select options;
  - the `65+` age band in the Reports filter and chart. It is isolated at the feature, not inside the shared `DistributionBars`, whose labels may be words.
- **`Select`:** typeahead matches through `withoutIsolates()`, so typing "3" still lands on "30 min".

### 25.4 Verification

- **Tests:**
  - `labs/components/detail/latin-values.test.tsx` 2: every seeded analyte with a unit and a range, plus turnaround and volume.
  - `appointments/components/latin-values.test.tsx` 2.
  - `pharmacy/components/latin-values.test.tsx` +2: strength, dosage, duration and the patient cell.
  - `components/ui/Select.test.tsx` +1: typeahead on isolated labels.
  - `i18n/bidi.test.ts` 2.
  - Every new test except `bidi`'s fails on the code before this pass.
- **Browser:**
  - Arabic screenshots after the fix read `0.5 10³/µL`, `4.0–11.0 10³/µL`, `12.0–17.0 g/dL`, `250 mg`, `7 days`, `29 years`, `1 d`, `30 min`, `61 · M` and `65+`.
  - The DOM scan above was re-run.
  - An axe-core 4.13 regression sweep (WCAG 2.2 A/AA) covered 45 routes × {light Arabic 1440, dark Arabic 375, light English 1440}: **135 page states, 0 violations, 0 overflow, 0 page errors, 0 redirects**.
- **Scope of formatting:** Prettier was applied to the changed files except `admin/appointments/AppointmentDetailDrawer.tsx`. That file was already unformatted on `frontend`, and formatting it would have re-indented about 110 unrelated lines around a two-line change. It is left as it was.

### 25.5 Gate

`frontend`, on the final tree:
- `typecheck`: 0 errors.
- `lint`: exit 0, with 0 errors and the 20 accepted warnings; the token check is clean.
- `test`: **252 files, 2,642 tests passed**, against 249 and 2,633 at `cb4f298`. That is 3 new files and 9 new tests.
- `build`: passed.
- `build-storybook`: passed.
- `prettier --check`: clean on every changed file except `AppointmentDetailDrawer.tsx` (§25.4).

### 25.6 Not run

A screen reader (F-18), WebKit, Firefox, a physical device, a live API (G-1), and the backend and patient-app suites. No path their CI filters name changed.

## 26. Completion pass 9 — 2026-10-30

**Scope.** "Implement the remaining frontend work", on task branch `claude/frontend-auth-rate-limited`, cut from `frontend` @ `4b4c8d1`. Every non-`COMPLETE_VERIFIED` row was re-read against what `backend` added since pass 7's check: the only frontend-visible contract changes are M37.2's `429 rate_limited` on the public credential routes, M41.2's optional `pushToken` on `POST /me/devices` (the patient app's), and M38.1's `GET /metrics` (operations). Nothing in `backend/`, `patient-app/`, Prisma, the AI service, CI, `vercel.json` or any deployment setting changed.

### 26.1 Built: a throttled credential request is named (A-02…A-07)

M37.2 (`cd19bdb`) puts one per-client allowance across ten routes: register, login, OTP verify and resend, forgot and reset password, verify email, verification resend, and invitation accept and activate. Past it each answers `429 rate_limited` with `Retry-After`. `api/endpoints/auth.ts` already mapped that to `AuthError('rate_limited')`, but only the sign-in page (A-01, F34) had a message for it. Before this pass:

- signup, OTP verify and resend, forgot and reset password, and invitation accept and activate said "please try again", which cannot help inside the window;
- email verification said the link was "invalid or has expired", for a throttled verify and for a throttled resend. That invites the user to ask for another link, which is throttled too.

Now each of those paths shows one shared string, `common.rateLimited` ("Too many attempts. Wait a few minutes, then try again."), in all five locales. A dead verification link still says it is dead. Every other refusal is unchanged.

### 26.2 Found, recorded, not built

- **F33 has a legitimate path now.** M38.4 (`0277796`) adds `npm run admin:bootstrap -- --email … --confirm [--print-link]`. It issues an administrator invitation that the invitee completes through this client's existing `/accept-invitation` page: a password, then TOTP. The link path matches `auth-mail.service.ts`. That is a live admin session without writing a credential or TOTP secret into the database, which is the line §24.1 would not cross. The run needs a local database created, migrated and seeded from `backend`. `CLAUDE.md` § Strict Execution Scope (5) requires explicit authorization for that, so ADM-02/03/05, ADM-09 roles and custom roles stay `IMPLEMENTED_UNVERIFIED` until the owner authorizes it.
- **Bootstrap invitations have no inviter** (`admin_invitations.invited_by` is nullable). This client never reads the inviter, so nothing breaks.

### 26.3 Gate

`frontend`, on the final tree:
- `typecheck`: 0 errors.
- `lint`: exit 0, with 0 errors and the 20 accepted warnings; the token check is clean.
- `test`: **253 files, 2,651 tests passed**, against 252 and 2,642 at `4b4c8d1`. That is 1 new file and 9 new tests. 8 of them fail on the old pages; the ninth, a dead link still called dead, passes on both.
- `build`: passed.
- `prettier --check`: clean on every changed file except `AcceptInvitationPage.tsx`, which was already unformatted on `frontend`. Its two added lines follow the file's layout.

### 26.4 Not run

A live API (G-1), a browser sweep (the change is message text on existing alert slots), a screen reader (F-18), and the backend and patient-app suites. No path their CI filters name changed.

## 27. Completion pass 10 — 2026-10-30

**Scope.** "Cross-branch audit, then implement what it unlocks", on task branch `claude/frontend-lab-trends-api`, cut from `frontend` @ `5fea146` (PR #135's merge). Nothing in `backend/`, `patient-app/`, Prisma, the AI service, CI, `vercel.json` or any deployment setting changed.

### 27.1 Branches and pull requests

- **Fetched every remote branch.** `backend` is at `9ac0fcf`, the same tip §26 read. PRs #129–#134 are all merged into `backend`, and none has reached `main`. `Database` (5 ahead of `main`) holds only `database/schema.sql`, the SQL transcription `CLAUDE.md` says does not load. `Ai` (18 ahead) holds documentation only. `patient-app` is level with `main`. No pull request is open.
- **Routes against calls, re-run.** 287 controller routes on `backend` were compared with the frontend's path literals, and each unmatched route was read by hand, as in §22.1. Every unmatched route was already accounted for except two:
  - `GET /patients/:id/lab-trends` (RM M14.6, API §8.8, on `main`). Built here, §27.2.
  - `PATCH /patients/:id` (API §4.8: status, risk level and contact details, on `main`). No UX section asks a doctor to edit these; UX §3's patient-account editing is the admin's and waits on hospital scoping. **Recorded, not built.** Whether the doctor workspace should offer it is the owner's call.

### 27.2 Built: the analyte trend reads the patient's history from the server (D-13)

Before this pass, the trend drawer derived its points from whatever orders the screen behind it had loaded. That had three faults:
- **It counted values nobody had released.** It did not check order status, so a result on an order still in the lab could be plotted. API §8.8 serves completed orders only.
- **It was a slice.** On the lab detail page it was a single order until the list arrived, and it was only ever the orders that screen happened to load.
- **It called a live build a demo.** Its footnote read "this demo dataset. No laboratory system is connected", in live builds too.

Now:
- The port has `getTrends(patientId, analytes)`. The HTTP adapter calls `GET /patients/{id}/lab-trends?analytes=…` with strict readers, refusing an answer that echoes another patient or carries a flag outside the result vocabulary. The mock answers from its corpus through `trendsFromTests`, under the same rule.
- The chips still come from the loaded orders, now only completed ones. The plotted series are the server's.
- A series keeps its colour slot when another selected analyte has nothing to plot.
- The drawer has a loading state, a failure with Retry that plots nothing, and names an analyte with no released numeric result.
- The footnote follows `capabilities.transmits`.

Two `LabDetailPage.test.tsx` assertions now wait (`findBy`) for the series the port loads. What they assert is unchanged.

### 27.3 Gate

`frontend`, on the final tree:
- `typecheck`: 0 errors.
- `lint`: exit 0, with 0 errors and the 20 accepted warnings; the token check is clean.
- `test`: **254 files, 2,663 tests passed**, against 253 and 2,651 at `5fea146`.
- `build`: passed.
- `prettier --check`: clean on the files that were clean before. `AnalyteTrendDrawer.tsx`, `mock-lab-service.ts`, `trends.ts`, `trends.test.ts` and `LabDetailPage.test.tsx` were already unformatted on `frontend` and are left that way; the added lines follow each file's layout.

### 27.4 Not run

A live API (G-1: no database in the container, and creating one needs the owner's authorization, §26.2), a browser sweep, a screen reader, and the backend and patient-app suites. No path their CI filters name changed.

## 28. Completion pass 11 — 2026-10-30

**Scope.** "Continue from PRs #135 and #136", on task branch `claude/frontend-lock-screen-refusals`, cut from `frontend` @ `0e12a1f` (PR #136's merge). Nothing in `backend/`, `patient-app/`, Prisma, the AI service, CI, `vercel.json` or any deployment setting changed.

### 28.1 Re-checked first

- **State.** PRs #135 and #136 are merged into `frontend`, and no pull request is open. `backend` is still at `9ac0fcf` (§27.1), so no route has appeared since.
- **Every named workstream was re-checked against `backend` and found unchanged:**
  - Lab annotations (D-15) and lock-screen re-authentication (A-12a): no route.
  - File upload and profile photo (D-04b, NEW-13): `/files` and `PUT /me/profile/photo` answer 503 until an object store is configured (M25.2).
  - Messaging, My Clinic and the administration sections: routes on `backend` only, single-tenant (DP-02).
  - The AI assistant: held by D-09 until Phase 28.
- **The graph cache** (`origin/graphify-cache`) is at `frontend` @ `4b4c8d1`, two merges behind. The pass touched only `features/auth` and `i18n`, which were read directly, so the cache was not rebuilt.

### 28.2 Built: the lock screen says why an unlock failed (A-07)

Unlocking spends `POST /auth/login`, because no re-authentication route exists (A-12a). Since M37.2 that route is also rate-limited. The page answered **every** failure "Incorrect password. Please try again.":
- a 429;
- an account with two-factor sign-in, where the password is right but the lock screen has no field for a code (`otp_required`, the documented limit in `api/endpoints/auth.ts`);
- a suspended account;
- a network or server failure.

Telling someone who typed the right password that it is wrong sends them into more attempts, towards the lockout.

Now:
- a wrong password still says so;
- a throttle uses `common.rateLimited`;
- two-factor says the lock screen cannot complete it and to log out and sign in again (`lock.error.twoFactor`);
- an inactive account reuses `login.error.inactive`;
- anything else says the unlock could not be completed (`lock.error.generic`).

### 28.3 Built: a failed verification resend is not called a dead link (A-05)

A resend that failed for any reason except a throttle showed "This verification link is invalid or has expired". That includes a network or server failure. It now says the email could not be sent (`verifyEmail.error.resend`). The adapter's own `token_invalid`, meaning no address to send to, keeps the link message.

### 28.4 Gate

Three new keys, in all five locales.

`frontend`, on the final tree:
- `typecheck`: 0 errors.
- `lint`: exit 0, with 0 errors and the 20 accepted warnings; the token check is clean.
- `test`: **255 files, 2,671 tests passed**, against 254 and 2,663 at `0e12a1f`. That is 1 new file and 8 new tests; 6 of them fail on the old pages, and the other two are controls (a wrong password, and no address to send to) that pass on both.
- `build`: passed.
- `prettier --check`: clean on every changed source file; each was clean on `frontend` before this pass.

### 28.5 Not run

A live API (G-1), a browser sweep (the change is message text in existing alert slots), a screen reader, and the backend and patient-app suites. No path their CI filters name changed. Native review of the three new strings in four locales is outstanding, as for every F-19 string.

## 29. Completion pass 12 — 2026-10-30

**Scope.** "Implement as much frontend work as possible", on task branch `claude/frontend-appointment-link-not-found`. The branch is stacked on PR #137's branch, because #137 is not yet merged and both passes append to this file. Once #137 merges, this pull request's diff is this pass alone. Nothing in `backend/`, `patient-app/`, Prisma, the AI service, CI, `vercel.json` or any deployment setting changed.

### 29.1 Built: a link to an appointment the book does not hold says so (§3.4)

`/doctor/appointments/:appointmentId` opens that appointment's drawer. An id the loaded book does not contain opened nothing and said nothing: the book rendered as if the link had not been followed. Such ids come from a stale notification or critical alert, a removed appointment, someone else's, or a typo, and the silence read as a broken link. The lab, record, prescription, patient and admin doctor detail pages already say when an id does not resolve.

Now a warning above the book reads "This appointment is not in your book" and names the id. Dismissing it returns to the book's own URL. Two cases show no notice:
- while the book is loading, because a pending list is not an absent appointment;
- when the load fails, because the error state already reports that.

Tests: `AppointmentsPage.test.tsx` +4 (resolves, unresolved, dismiss, failed load). The second and third fail on the old page.

### 29.2 Checked and not built

- **Allergy correction and removal.** `PATCH` and `DELETE /patients/:id/allergies/:allergyId` are on `main`, and the frontend does not call them. The port leaves them out deliberately ("correcting an allergy is a clinical act with its own audit, not a form field", `model/profile-service.ts`). The server's `DELETE` takes no reason, while history removal was made to require one (BR-DEC-003). Whether and how a doctor may correct or remove an allergy is a clinical-rule decision for the owner, alongside BR-DEC-003.
- **Messaging, My Clinic, administration, the AI assistant, uploads, the profile photo, lab annotations and re-authentication** are unchanged from §28.1. Messaging also has a contract gap beyond hospital scope: `POST /conversations` takes user UUIDs that no route lets the client look up.
- **Shared sweeps that found nothing to fix:**
  - every `useMutation` file updates the cache (invalidate, set or refetch);
  - every other param-driven detail page has a not-found branch;
  - unknown `?patient=` / `?book=` presets fall back to an empty patient step, which is visible rather than silent.

### 29.3 Gate

`frontend`, on the final tree:
- `typecheck`: 0 errors.
- `lint`: exit 0, with 0 errors and the 20 accepted warnings.
- `test`: **255 files, 2,675 tests passed**, against 255 and 2,671 on PR #137's branch. That is 4 new tests; 2 fail on the old page.
- `build`: passed.
- `prettier --check`: clean on `AppointmentsPage.test.tsx`. `AppointmentsPage.tsx` was already unformatted on `frontend` and is left that way; the added lines follow its layout.

### 29.4 Not run

A live API (G-1), a browser sweep, a screen reader, and the backend and patient-app suites.

## 30. Completion pass 13 — 2026-10-30

**Scope.** "A high-volume implementation sprint", on task branch `claude/frontend-sprint-results-session-cache`, cut from `frontend` @ `71e0ad2` (PRs #137 and #138 merged, so no stacking is needed). Nothing in `backend/`, `patient-app/`, Prisma, the AI service, CI, `vercel.json` or any deployment setting changed. The blocked areas listed in §28.1 and §29.2 were not re-investigated: nothing on `backend` has moved since `9ac0fcf`.

### 30.1 Provisional lab values are not presented as released (D-10…D-14)

The laboratory enters values while an order is **processing** and releases them by **completing** it (the server's `assertResultable`; the release notification fires on completion). The frontend read "has results" as "released", so a processing order's provisional values:
- joined the review queue and the bulk-review set;
- matched the critical, abnormal and normal flag filters;
- counted on the Critical summary card;
- counted towards the chart's "awaiting review", abnormal and critical figures, in both the mock and the live (`GET /patients/:id/labs`) readers;
- and, on the detail page, sat under a critical banner reading "Flagged to the ordering team" before any notification existed.

Now:
- `hasReleasedResults` requires `status === 'completed'`, and `hasPreliminaryResults` names the other case. The queue, the bulk partition, the flag filters, the Critical card and the chart counts all use the same rule.
- The results section labels provisional values "Preliminary", says they may change and are not yet in the review queue, and its critical banner says the ordering team is notified on release.

**Backend finding (recorded, not changed):** the server's `assessReviewability` and its `reviewStatus` filter also count result rows rather than release, which contradicts its own comment ("an order still in the analyser is in nobody's inbox"). So does `GET /patients/:id/labs`'s `resultCount`. The frontend is now stricter than the server here, as it already is for record editing (NEW-12).

### 30.2 One error mapping for the auth pages (A-02…A-07)

PRs #135 and #137 each fixed pages that had not mapped a code another page did. Each page had its own `isAuthError(…) && code === …` chain. `features/auth/error-message.ts` (`authErrorKey`) now maps a failure to a message key. A page lists only the codes it words its own way, and **a throttle is named by default**, so a page can no longer forget it.

Signup, forgot and reset password, the OTP page (verify and resend), invitation acceptance and the lock screen use it. Login keeps its own map, because it redirects on two codes and words a throttle as a sign-in. The page suites were the regression check: 107 auth tests, unchanged and passing.

### 30.3 A session the server ended is named on the sign-in page (A-01)

A refused refresh (expired, revoked from another device, a suspended account) ended the session, and the route guard dropped the user on the sign-in page with nothing to say why. `AuthProvider` now records `sessionEnded`:
- set only by a refused refresh;
- cleared by the next sign-in and by an explicit logout.

The sign-in page shows "Your session has ended. Sign in again to continue." until a new attempt's own message replaces it. The new string is in all five locales.

### 30.4 A change refreshes every screen that reads it (§3.4, D-17/D-19)

**Appointments.** An approve, reject, cancel, reschedule, booking or time-off resolution refreshed only the Appointments book. The Overview (KPIs, today's schedule, the decision list) and the chart's Appointments tab kept the old state for their 30-second stale time. That is exactly the trip Overview → request → approve → back makes. `invalidateAfterAppointmentChange` now refreshes the book, the Overview and patient details.

**Prescriptions.** Signing, cancelling or discontinuing a prescription refreshed the pharmacy's keys but not the chart's Medications tab and profile bundle, which read the medication list the pharmacy maintains. They now refresh patient details too.

Lab writes, chart writes and allergy writes were checked and already refresh what they affect.

### 30.5 Gate

`frontend`, on the final tree:
- `typecheck`: 0 errors.
- `lint`: exit 0, with 0 errors and the 20 accepted warnings.
- `test`: **258 files, 2,699 tests passed**, against 255 and 2,675 at `71e0ad2`. That is 3 new files and 24 new tests:
  - 10 of them fail on the old code;
  - two are login-page controls that pass on both;
  - the 12 in `preliminary-results.test.tsx` and `error-message.test.ts` import symbols the old code does not have.
  - One of the 10, "logout never sets it", fails on the old provider only because the field did not exist, so it guards the future rather than proving a defect.
- `build`: passed.
- `prettier --check`: clean on every changed file that was clean on `frontend`. `AcceptInvitationPage.tsx` and `review.ts` were already unformatted and are left that way; the added lines follow their layout.

### 30.6 Not run

A live API (G-1), a browser sweep, a screen reader, and the backend and patient-app suites. The new string (`login.sessionEnded`) awaits native review in four locales, as for F-19.

## 31. Completion pass 14 — 2026-10-31

**Scope.** "An extended feature completion sprint", on task branch `claude/frontend-refresh-on-refusal`, cut from `frontend` @ `220fc44` (PR #140's merge). Nothing in `backend/`, `patient-app/`, Prisma, the AI service, CI, `vercel.json` or any deployment setting changed. `backend` moved to `46e8753` since §30. Its one frontend-visible change is `cd123ff` (§31.1); its other commits are tests, documentation and log hygiene, and add no route.

### 31.1 Auth: one rule for an unenrolled two-factor account, and the last per-page map (A-01, A-02…A-07)

- **Backend `cd123ff`:** with the 2FA policy on, an account that never enrolled is now refused `403 two_factor_required` at sign-in instead of being challenged for a code it cannot produce. That can now happen to a doctor, not only an administrator.
- **Lock screen.** It mapped that code to "uses two-factor sign-in… log out, then sign in again", which is wrong on both counts: the account has no second factor, and signing in again fails the same way. It now uses the sign-in page's "requires two-factor authentication. Contact your administrator." `otp_required`, an enrolled account the lock screen cannot challenge, keeps its own message.
- **Login** now uses `authErrorKey` (§30.2) too, after its two redirects. No auth page maps codes by hand any more.

### 31.2 A refused write re-reads what it refused (D-10…D-14, D-21/D-29, §3.4, D-17/D-19)

Several 409s mean the screen is out of date, and every one of them refreshed only on success. So the screen kept showing the state the server had just refused, and the retry the message invites failed again.

- **Records** (`stale_write`, `note_already_signed`, on sign, amend, status and edit). The server's own message is "reload and try again". The record and the lists are now re-read on a conflict.
- **Lab review.** A single review a colleague did first now re-reads the order and the worklist. The bulk 409 is sent *after* the server's transaction committed the rest ("N of these were reviewed by someone else… try the remainder"), so the worklist now re-reads on any outcome.
- **Appointment transitions.** A transition refused because the appointment moved on (the patient cancelled, a colleague acted) left the row offering the old state's actions. The book, the Overview and the chart now re-read on any outcome.
- **Prescription signing.** Only `conflict` (signed by someone else) and `invalid_status_transition` re-read the prescriptions and drafts. The safety refusals (an allergy conflict, an unacknowledged warning, a check that could not run) are reported by the flow and leave the cache alone, as a test pins.

A failure that says nothing about the data, such as a network error, leaves the cache alone (tested on records).

### 31.3 The worklist follows the release rule too (D-10…D-14)

§30.1 made release mean "completed" for the queue, filters, cards and chart. Two worklist surfaces still read raw results:
- **The flag column** showed "Critical high" and "1 of 1 abnormal" for a processing order. It now shows a "Preliminary" badge and "Not yet released".
- **The row tint** coloured a processing order's provisional critical value as an "unreviewed critical". It now uses `isCriticalUnreviewed`, which reads the release rule.

`lab-row-tint.test.ts`'s fixture gained `status: 'completed'`: the tint now reads status, and the fixture's premise, an unreviewed critical result, is a released one. The assertion is unchanged, and a processing case was added.

The backend inconsistency in §30.1 stands: the server's reviewability rule and `GET /patients/:id/labs` still count rows rather than release.

### 31.4 Checked and not changed

- Appointment dialogs: the time-off window refuses an end before its start, reschedule offers only available slots, and a past window is the server's to refuse. No rule was added.
- Prescription end (cancel or discontinue) already refreshed on any outcome.

### 31.5 Gate

`frontend`, on the final tree:
- `typecheck`: 0 errors.
- `lint`: exit 0, with 0 errors and the 20 accepted warnings.
- `test`: **259 files, 2,709 tests passed**, against 258 and 2,699 at `220fc44`. That is 1 new file and 10 new tests.
  - 8 behaviour tests fail on the old code: 5 refusal re-reads, the processing tint, the Preliminary flag, and the lock screen's two-factor case.
  - The controls pass on both: a network failure, a safety refusal, and a released flag.
- `build`: passed.
- `prettier --check`: clean on every changed file.

### 31.6 Not run

A live API (G-1), a browser sweep, a screen reader, and the backend and patient-app suites.

## 32. Completion pass 15 — 2026-10-31

**Scope.** D-18, D-04/D-04b and NEW-13 from the dependency audit (the three it classed FE-PARTIAL), on task branch `claude/frontend-medication-search-photo-upload`, cut from `frontend` @ `dc60300` (PR #141's merge). Nothing in `backend/`, `patient-app/`, Prisma, the AI service, CI, `vercel.json` or any deployment setting changed. Nothing was live-run (G-1).

### 32.1 D-18 — the medication typeahead → PARTIAL

`GET /medications` takes `q`, a case-insensitive substring on brand or generic name, 20 per page by default (on `main` and `backend`, `medication.schema.ts`). The client loaded the whole formulary and never sent it.

- **Port.** `searchMedications(query)` is new. The HTTP adapter sends `q`, `page=1` and `pageSize=20`; the mock applies the same rule to the demo formulary.
- **Step 2 of the prescribing flow:**
  - a search box, debounced, from the second character;
  - a "type at least 2 characters" hint;
  - a searching state;
  - a no-match line naming the term;
  - and a match count announced by `SearchBar`.
- **Failure.** A failed search filters nothing, says so, and offers Retry.
- **Selection.** A selected medication stays on screen when the search does not match it.
- **Wording.** The demo notice now says search covers this formulary only.

What remains is the dataset itself, which is content, not code. The status is PARTIAL, not complete.

### 32.2 D-04/D-04b — re-checked; still BLOCKED_BACKEND, and the audit's class was wrong

The audit classed D-04/D-04b FE-PARTIAL. Reading the contract closely says otherwise:
- `GET /patients/:id/documents` serves no `fileId` (`PatientDocumentView`), so a row cannot be resolved to `/files/:id/download`.
- `POST /files` creates a file that belongs to nothing: no route makes it a patient's document.
- An adapter would therefore open nothing and "store" uploads the tab never shows, the fake success this register refuses. None was written.

The two code comments that still called `backend/src/modules/files` an empty skeleton now state the real blocker. The correct class is **FE+BE**.

### 32.3 NEW-13 — the profile photo upload → PARTIAL

`PUT /me/profile/photo` (on `main` and `backend`) takes the multipart part `photo`: JPEG, PNG or WebP, at most 5 MB, doctors only. It answers the saved profile, a 422 on `photo`, or a 503 while storage is unconfigured.

- **Transport.** `apiClient` sends a `FormData` body as it is, so the browser sets the boundary.
- **Upload.** `putProfilePhoto` sends the cropped PNG.
- **Live Settings → Profile** offers the upload to a doctor:
  - a success is announced only after the server answers;
  - a 422 shows the server's words;
  - a 503 says no file storage is connected;
  - "Remove" is not offered, because there is no route.
- **Display.** The server saves the object-store **key** as `photoUrl` (`setDoctorPhoto(doctorId, stored.key, …)`). `displayablePhoto` therefore keeps only an `https:` or `data:image/` value, the avatar falls back to initials, and the success toast says a stored photo cannot be displayed yet.

### 32.4 FE+BE rows re-checked: nothing more to build

- **A-12a:** no re-auth route.
- **§3.1 pulse:** needs an aggregate endpoint. Its data now exists: the lifecycle columns from `0d5e082`.
- **ADM-09 custom roles:** needs `baseRole` in the session. The roles API needs `roles.manage`, which such an account lacks.

### 32.5 Gate

`frontend`, on the final tree:
- `typecheck`: 0 errors.
- `lint`: 0 errors, the 20 accepted warnings.
- `test`: **262 files, 2,731 tests passed**, against 259 and 2,709 at `dc60300`. That is 4 new files and 22 new tests:
  - the multipart client test fails on the old client;
  - the rest exercise symbols the old code does not have.
  - Two existing wording tests gained a `QueryClientProvider`, because the step now runs a query; their assertions are unchanged.
- `build`: passed.
- `prettier --check`: clean on every changed file that was clean before. Files that were already unformatted gained no new drift.

**Register:** 79 rows, **61** `COMPLETE_VERIFIED` · 4 `IMPLEMENTED_UNVERIFIED` · **5** `PARTIAL` · 4 `MOCK_ONLY` · **5** `BLOCKED_BACKEND` (D-18 and NEW-13 moved from blocked to partial).

### 32.6 Not run

A live API (G-1), an object store, a browser sweep, a screen reader, and the backend and patient-app suites.

## 33. Completion pass 16 — 2026-11-01

**Scope.** D-04/D-04b, the one row the 2026-10-31 `backend` → `frontend` integration (PR #159) unblocked on the frontend side. Task branch `claude/frontend-patient-documents-live`, cut from `frontend` @ `52dfc86`. Nothing in `backend/`, `patient-app/`, Prisma, the AI service, CI, `vercel.json` or any deployment setting changed. Nothing was live-run (G-1).

### 33.1 Re-checked first

Every other open row was checked against the integrated backend. None is unblocked:
- **A-12a:** still no re-auth route. `StepUpService` is the sign-in OTP, not a password re-check.
- **NEW-04b:** still no history-correction route (`PATCH history/:id`).
- **D-15:** still no annotation route.
- **D-24:** still no recipient lookup.

### 33.2 Built: D-04/D-04b over API §4.7 → IMPLEMENTED_UNVERIFIED

- **Adapter.** `http/http-documents-service.ts` is selected for live builds. The mock build keeps `unconfiguredDocumentsService`, because a mock that served files would be forging documents.
  - *Storage:* read from `GET /health` → `services.storage`. Only `up` reads `available` (DEC-018).
  - *Open:* `GET /patients/{id}/documents/{documentId}/download` → `{ url, expiresInSeconds }`. Refusals map as follows: 403 `scan_pending` → scan pending; 503 → no document service; 404 → no longer on the record; any other 403 → no access. Anything else rejects, and the hook reports it.
  - *Upload:* `POST /files` (multipart; `kind=patient_document` before the `file` part), then `POST /patients/{id}/documents` `{ fileId, category }`.
    - A 422 shows the server's words, and a 413 is named.
    - A refused link is reported as *uploaded but not filed*, never as filed. The unlinked file is left for the orphan sweep.
- **Port.** `resolve(patientId, documentId)`: a document is opened through its chart. `ready` carries `expiresInSeconds` instead of a name and MIME type the route does not serve. The scan-pending wording no longer says "try again in a moment", because with no scanner bound it never clears.
- **Upload dialog.** `UploadDocumentDialog` requires a category and has no default. The old input filed every upload as `referral`. The dialog stays open on a refusal.
- **Refresh.** A filed upload refetches the chart's Documents tab before the toast. The toast says the file opens once the scan clears it.

**Why IMPLEMENTED_UNVERIFIED and not complete:**
- The adapter is contract-tested only. Bodies are transcribed from `patient-tabs.controller.ts`, `files.service.ts`, `scan-gate.ts` and `health.types.ts`.
- In a real deployment the actions stay hidden, because `/health` cannot report storage (DEC-018).
- Even with a store, nothing opens until a scanner is bound (M25.3).

**Not distinguished:** an infected file. The scan gate refuses it with the same code as a pending one (`scan_pending`), and the normalized error keeps the code, not the message. Both read as "has not cleared the malware scan", which is true of both. A distinct server code would let the port's `infected` branch fire.

### 33.3 Decision asked

**DEC-018** (§14): keep the `/health` gate and ask the backend for a storage indicator (recommended), or offer the actions in every live build.

### 33.4 Gate

`frontend`, on the final tree:
- `typecheck`: 0 errors.
- `lint`: 0 errors, the 20 accepted warnings.
- `test`: **263 files, 2,753 tests passed**, against 262 and 2,731 in §32. That is 1 new file and 22 new tests:
  - `http-documents-service.test.ts`: 16;
  - `DocumentsTab.test.tsx`: +3 net (two upload tests rewritten for the dialog, three added);
  - `usePatientDocumentAccess.test.tsx`: +3.
  - In `service.test.ts`, one wording assertion now follows the reworded scan message.
- `build`: passed.
- `prettier --check`: clean on every new file and every changed file that was clean before.

**Register:** 79 rows, 61 `COMPLETE_VERIFIED` · **5** `IMPLEMENTED_UNVERIFIED` · 5 `PARTIAL` · 4 `MOCK_ONLY` · **4** `BLOCKED_BACKEND` (`node scripts/count-checklist-register.mjs`; D-04/D-04b moved from blocked).

### 33.5 Not run

A live API (G-1), an object store, a scanner, a browser sweep, a screen reader, and the backend and patient-app suites. No backend or patient-app file changed.

---

## 34. Completion pass 17 — 2026-11-01

**Scope.** The npm dependency audit, which this checklist had never recorded, and
the two defects looking for its one runtime advisory turned up in this app's own
code. Task branch `claude/frontend-dependency-audit-record`, cut from `frontend`
@ `e19d2c0`. Nothing in `backend/`, `patient-app/`, Prisma, the AI service, CI,
`vercel.json` or any deployment setting changed, and **no dependency was added,
removed or upgraded**. Nothing was live-run (G-1).

### 34.1 The audit, measured — and why it is recorded here at all

This checklist tracks 79 rows and had **no row for npm advisories**: there is no
`frontend/docs/DEPENDENCIES.md`, and a `git grep` for `npm audit`, `advisory`,
`vulnerab`, `CVE` and `GHSA` over this file returned only F-09's unrelated
"advisory CI job". The patient app has carried that record since 2026-09-12
(`patient-app/docs/DEPENDENCIES.md`, T-12); the web client never did. So this was
measured rather than assumed.

`npm audit` in `frontend/` — **35 advisories: 3 critical, 8 high, 24 moderate.**

The count is not the finding. Measured against `package.json` rather than read
off the tree, exactly **two** of the 35 attach to a runtime dependency:

| Runtime package    | Severity     | Own advisories | Ships in the bundle?                  |
| ------------------ | ------------ | -------------- | ------------------------------------- |
| `zod`              | high         | 1              | Yes — but see below                   |
| `react-router-dom` | moderate     | 1 (+2 on `react-router`) | **Yes** — the finding       |

**All 3 criticals and 7 of the 8 highs are build and test tooling** —
`storybook`, `vitest`, `tinypool`, `vite`, `postcss`, `browserslist`, `js-yaml`,
`nanoid`, `source-map-js`, `brace-expansion`. Each was checked with
`npm ls --omit=dev`: none is in the production tree. A malicious package there
would run with the developer's privileges during `npm ci` or `npm run build`,
which is a real risk and a different one; it does not reach a browser.

**`zod` is not reachable in this client, unlike in the patient app.** Here zod
validates **forms only** — the seven `features/auth/schemas/*`,
`features/doctor/settings/schemas.ts` and `configs/env.ts`. There is **no zod in
`src/api/`**: responses are parsed by the hand-rolled readers in
`api/http.ts` (`readData`, `asRecord`, `readString`, …), which never accumulate a
per-element issue list, and `fetchAllPages` already caps a collection at
`maxPages = 20` × `MAX_PAGE_SIZE = 100`. The advisory
([GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)) needs
a large untrusted array; all four `z.array` sites in this tree are
`.max(8)`/`.max(12)` fields fed from local form state. **The same advisory *is*
live in `patient-app/`, where zod parses every server response** — that is
T-12's, and it is handled on its own branch.

So the one runtime advisory that matters here is the router, and it is §34.2's.

### 34.2 Built: the `returnTo` guard refuses a backslash, and no longer throws

`react-router-dom@6.30.4` carries
[GHSA-wrjc-x8rr-h8h6](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6) —
*open redirect via backslash in `<Link>` and `useNavigate`*. That advisory needs
an off-site target to reach `navigate()`, so the question is whether anything in
this tree hands it one. Every dynamic `navigate()` call was traced:

- Notification and alert destinations are built client-side from
  `routes.doctor.*` constants with only an id interpolated; `related` carries ids
  and no href, and `critical-alerts.ts` already allow-lists with a fallback.
- `GlobalSearch` navigates to paths produced by a client-side search.
- **`resolveDestination(params.get('returnTo'), role)` was the one untrusted
  sink** — read in `LoginPage` twice and during render in `RequireGuest`.

It held two defects, both found by test and both fixed:

1. **Backslash open redirect.** The guard was
   `!decoded.startsWith('/') || decoded.startsWith('//')`. A browser reads `/\`
   in a URL as `//`, so `returnTo=%2F%5Cevil.example.com` starts with `/`, does
   not start with `//`, and passed. For a **doctor** — who "may return anywhere
   outside the other roles' workspaces" — it was then returned verbatim and
   handed to `navigate()`. Measured, not inferred:
   `resolveDestination('/\evil.example.com', DOCTOR)` returned
   `'/\evil.example.com'`. A backslash appears in no route this app declares, so
   it is now refused outright — refused rather than stripped, because repairing
   the path means guessing what a hostile author meant.
2. **An undecodable `returnTo` crashed the page.** `decodeURIComponent` throws
   `URIError` on malformed percent-encoding (`%ZZ`, a bare `%`, a truncated
   `%E0%A4%A`). The value comes from a query string anyone can craft, and it is
   read **during render** in `RequireGuest`, so `/login?returnTo=%ZZ` opened by
   an authenticated user threw inside render rather than dropping the parameter.
   `decodeSafely` now refuses what it cannot decode, which is what every other
   unusable `returnTo` already got. §11's sweep claims junk parameters were
   driven; this shape was missed, and the row is corrected rather than re-ticked.

**Also hardened, as depth rather than a live fix:**
`useInternalLinkNavigation` — the app-wide anchor interceptor mounted in
`AppShell` — guarded on `href.startsWith('/')` alone, which admits `//host` and
`/\host`, and passed both to `navigate()`. Both are now left to the browser
instead: the anchor already says where it goes, and letting it through keeps the
address bar honest rather than laundering an off-site target through the router.
**No live sink feeds it** — nothing in this tree renders a server-supplied
`href` — so this is not presented as a vulnerability closed, only as the same
rule applied at this app's other `navigate()` entry point.

The router itself is **not** upgraded: that is a dependency change and needs the
owner's authorization — **DEC-019** (§14), where a 6.30.6 patch bump is
recommended, since 6.30.4 sits inside the XSS advisory's
`>=6.30.2 <=6.30.5` range.

### 34.3 Decision asked

**DEC-019** (§14): bump `react-router-dom` to 6.30.6 now (recommended), schedule
7.18+, or stay on 6.30.4 behind the client-side guards.

### 34.4 Gate

`frontend`, on the final tree:
- `typecheck`: 0 errors.
- `lint`: 0 errors, the 20 accepted warnings.
- `test`: **264 files, 2,759 tests passed**, against 263 and 2,753 in §33. That
  is 1 new file and 6 new tests:
  - `useInternalLinkNavigation.test.tsx`: 4 (new);
  - `resolveDestination.test.tsx`: +2.
  - **4 of the 6 were watched failing on the old code** — the two
    `resolveDestination` cases, and the interceptor's protocol-relative and
    backslash cases.
- `build`: passed.
- `prettier --check`: clean on the new file and on the changed files that were
  clean before.

**Register:** unchanged at 79 rows (61 `COMPLETE_VERIFIED` · 5
`IMPLEMENTED_UNVERIFIED` · 5 `PARTIAL` · 4 `MOCK_ONLY` · 4 `BLOCKED_BACKEND`,
`node scripts/count-checklist-register.mjs`). **No row was added**: the audit is
not a deliverable this checklist owes, and both fixes are defects inside A-01's
existing surface, which is where they are recorded.

### 34.5 Not run

A live API (G-1), a browser sweep of the crafted `returnTo` URLs (the fix is
covered by unit tests at the function and the listener), a screen reader, and the
backend and patient-app suites. No backend or patient-app file changed. The 33
build-tooling advisories are accepted and recorded, not fixed: none reaches a
browser, and upgrading them is a dependency change.

---

## 35. Completion pass 18 — 2026-11-03

**Scope.** DEC-019 option A, authorized by the owner on 2026-11-03. Task branch
`claude/dec-019-react-router-6-30-6`, cut from `frontend` @ `b9c0faf`. Only
`frontend/package.json` and `frontend/package-lock.json` changed. Nothing in
`backend/`, `patient-app/`, Prisma, the AI service, CI, `vercel.json` or any
deployment setting changed. Nothing was live-run (G-1); the owner declined a live
run against a local database in this pass.

### 35.1 Re-checked first

All three checklists were re-read against `frontend` @ `b9c0faf`, `backend` @
`03182be`, `patient-app` @ `c6bb966` and `main` @ `a493117`.

- **`backend` serves no new route.** Its 11 commits ahead of `frontend` are tests,
  a roadmap note and one record-service fix (`aa9c983`, an appointment link must be
  the record's own patient's). No controller gained a route. So every
  `BLOCKED_BACKEND` row above stays blocked for the reason it names.
- **Still no hospital model.** A `git grep` for `activeHospital`, `hospitalId`,
  `employment` and `break.glass` over `backend/src` and `backend/prisma` on
  `backend` finds only the three auth comments. No WEB or PA row in
  `CLIENTS_CHECKLIST.md` moved.
- **D-04/D-04b** was already built (pass 16, PR #162). A local checkout that had
  not been fast-forwarded showed it as unbuilt; measure against `origin/frontend`,
  not the local branch.

### 35.2 Built: `react-router-dom` 6.30.4 → 6.30.6 (DEC-019 A)

- `package.json`: `^6.28.0` → `^6.30.6`. The floor is raised so that a fresh
  resolve cannot land back inside the vulnerable range.
- Lockfile: `react-router-dom` 6.30.4 → 6.30.6, `react-router` 6.30.4 → 6.30.6,
  `@remix-run/router` 1.23.3 → 1.23.4. No other package moved.
- **Cleared:** GHSA-jjmj-jmhj-qwj2 (open redirect leading to XSS, range
  `>=6.30.2 <=6.30.5`). `npm audit` no longer lists it.
- **Still open, as DEC-019 recorded:** GHSA-wrjc-x8rr-h8h6 and GHSA-337j-9hxr-rhxg
  on `react-router`, both `<7.18.0`. Only option B clears them. They need an
  off-site target handed to `<Link>` or `useNavigate`, which §34.2 refuses at this
  app's two entry points.
- `npm audit` still reports 35, because it counts packages and not advisories:
  `react-router-dom` is still listed, now only through `react-router`.

### 35.3 Gate

`frontend`, on the final tree:
- `typecheck`: 0 errors.
- `lint`: 0 errors, the 20 accepted warnings.
- `test`: **264 files, 2,759 tests passed**.
- `build`: passed. The chunking notices it prints name app modules, not the router.

**Register:** unchanged. 79 rows: 61 `COMPLETE_VERIFIED` · 5
`IMPLEMENTED_UNVERIFIED` · 5 `PARTIAL` · 4 `MOCK_ONLY` · 4 `BLOCKED_BACKEND`
(`node scripts/count-checklist-register.mjs`). DEC-019 is a decision, not a
register row.

### 35.4 Not run

A live API (G-1), a browser sweep, a screen reader, and the backend and
patient-app suites. No backend or patient-app file changed.

---

## 36. Completion pass 19 — 2026-11-03

**Numbering.** §35 is DEC-019's (PR #174, merged 2026-11-03). This pass is §36:
it was written on a branch cut before #174 merged, and numbered past it so the
two could not collide.

**Scope.** A second frontend-only pass over all three checklists, looking for
frontend work that can be delivered without the parts that are blocked. Task
branches cut from `frontend` @ `b9c0faf`, one per task. Nothing in `backend/`,
`patient-app/`, Prisma, the AI service, CI, `vercel.json` or any deployment
setting changed. No database was started and nothing was live-run (G-1).

### 36.1 Re-checked first

- **Every route `backend` serves was diffed against every path the web client
  calls.** The served routes it does not call fall into three groups:
  - The single-tenant families: `/administration/*`, `/admin/*`, `/audit-events`,
    `/conversations` and `/messages/search`. These stay unwired under DP-02's
    rule (§6): a mock surface is wired only to a hospital-scoped route.
  - The AI routes. D-09 is blocked on Phase 28.
  - Routes the client already reaches through helpers that build the path.
    Those are false gaps in a literal-path diff.
- **No other row is unblocked.** Every open row in §13 still waits on a route, a
  piece of infrastructure, an owner decision, a live run or a screen reader.
- **The patient-app rows with no backend dependency are held elsewhere:**
  - B-07, S-08 and W-08 need a device.
  - N-07, W-02 and W-10 need clinical or owner sign-off.
  - W-03 and W-09 need store credentials.
  - M-05's affordance is built and tested, but its screen runs on fixtures.
- **A coverage run** (`vitest run --coverage`, 85.5 % of lines) found live
  components that no test had ever rendered. NEW-34 came out of it.

### 36.2 Built: NEW-34 — one translated password strength meter

The row is in §13.2.

### 36.3 Gate (NEW-34's branch, `claude/settings-password-meter-locale`)

- `typecheck`: 0 errors.
- `lint`: 0 errors, the 20 accepted warnings.
- `test`: **266 files, 2,764 tests passed**. Against `frontend` @ `b9c0faf`
  (264, 2,759), that is 2 new files and 5 new tests.
- `build`: passed.

**Register:** 80 rows: **62** `COMPLETE_VERIFIED` · 5 `IMPLEMENTED_UNVERIFIED` ·
5 `PARTIAL` · 4 `MOCK_ONLY` · 4 `BLOCKED_BACKEND`
(`node scripts/count-checklist-register.mjs`). One row was added, NEW-34. No
other status moved.

### 36.4 Built: NEW-35 — tests for three live components no test had rendered

The row is in §13.5. The branch is `claude/cover-untested-clinical-components`,
stacked on NEW-34's branch so the two register edits do not conflict.

**Not changed, and asked instead.** The theme toggle's label names the theme
now on screen, and choosing the item switches to the other one. A screen reader
therefore hears "Dark theme" for an action that turns the theme light. PR #160
chose this design explicitly ("the item's icon and label show the active
theme"), so it is pinned as built rather than redesigned. Giving it a name that
says what it does, or a checked state, is the owner's call.

**Answered 2026-11-03:** the owner asked for a sun/moon pill with toggle
semantics and a selected state. It is built as NEW-36 (§36.7).

### 36.5 Gate (the stacked branch, NEW-34 and NEW-35)

- `typecheck`: 0 errors.
- `lint`: 0 errors, the 20 accepted warnings.
- `test`: **269 files, 2,777 tests passed**. Against `frontend` @ `b9c0faf`
  (264, 2,759), that is 5 new files and 18 new tests.
- `build`: passed.

**Register:** 81 rows: **63** `COMPLETE_VERIFIED` · 5 `IMPLEMENTED_UNVERIFIED` ·
5 `PARTIAL` · 4 `MOCK_ONLY` · 4 `BLOCKED_BACKEND`
(`node scripts/count-checklist-register.mjs`). Two rows were added, NEW-34 and
NEW-35. No other status moved.

### 36.6 Not run

A live API (G-1), a screen reader, the backend and patient-app suites, and an
axe sweep beyond the screens above. No backend or patient-app file changed.

### 36.7 Built: NEW-36 — the avatar menu theme pill

The row is in §13.2. The branch is `claude/avatar-menu-theme-pill`, stacked on
NEW-35's branch, because it replaces NEW-35's toggle tests and follows its
register edits.

**Gate** (the stacked branch, NEW-34, NEW-35 and NEW-36):
- `typecheck`: 0 errors.
- `lint`: 0 errors, the 20 accepted warnings.
- `test`: **270 files, 2,786 tests passed**. Against NEW-35's tree (269, 2,777),
  that is 1 new file and 9 new tests: `Dropdown.test.tsx` 4, and
  `AvatarMenu.test.tsx` 4 → 9.
- `build`: passed.

**Register:** 82 rows: **64** `COMPLETE_VERIFIED` · 5 `IMPLEMENTED_UNVERIFIED` ·
5 `PARTIAL` · 4 `MOCK_ONLY` · 4 `BLOCKED_BACKEND`. One row was added, NEW-36. No
other status moved.

**Not run:** a screen reader (VoiceOver, NVDA), the Storybook build, and a
bundle measurement (Q-02's method) for the `MenuList` addition.

---

## 37. Completion pass 20 — 2026-11-03

**Numbering.** §35 (DEC-019, PR #174) and §36 (pass 19, PRs #175/#176/#177) merged
into `frontend` while this pass's PR (#178) was open; it was written as §35 and is
renumbered here, the unmerged branch giving way as §36 did.

**Scope.** Three frontend-only changes requested together: the dashboard
Customize control, the widget-customization workflow (a defect), and the Medora AI
identity. Task branch `claude/dashboard-customize-medora-ai`, cut from `frontend`
@ `b9c0faf`. Nothing in `backend/`, `patient-app/`, Prisma, the AI service, CI,
`vercel.json` or any deployment setting changed; **no dependency was added,
removed or upgraded**; no database was started or touched. Nothing was live-run
against the API (G-1) — the browser checks below ran on the seeded mock backend.

### 37.1 The Customize control → COMPLETE_VERIFIED

Both customize buttons (the greeting's, and the empty state's) read **Customize**
— the word "dashboard" is gone from the button — and their icon is the supplied
widget-plus mark instead of `SlidersHorizontal`:
`components/patterns/dashboard/DashboardWidgetAddIcon.ts`, drawn on lucide's 24px
grid with lucide's own `createLucideIcon`, so it takes the `leadingIcon` slot and
`currentColor` like every other icon. Variant, size, radius, padding, hover and
focus are the `Button`'s, untouched. The drawer's own title stays "Customize
dashboard" (not in scope). The removal toast now points at "Customize".

### 37.2 Widget customization applies only on Done (defect) → COMPLETE_VERIFIED

**Root cause.** The drawer's switches called `selection.add`/`remove` directly —
`useDashboardEditor.toggle` → `useDashboardWidgetSelection.update`, which set the
dashboard's state *and* wrote `localStorage` on every toggle. Done only closed the
drawer. That was deliberate (DS §8.7, "switches apply immediately"), and it is the
behaviour that was reported wrong.

**Now.** Two configurations while the drawer is open:

- **saved** — `selection.activeIds`, what the Overview renders and storage holds;
- **draft** — copied *by value* from saved when the drawer opens, edited by the
  checkboxes and "Remove all", never written to storage.

**Done** is the only path that commits: one new `selection.replace(draft)`
sanitises the ids (unknown dropped, duplicates collapsed, order kept), writes
storage, then sets state — batched with the drawer closing, so the dashboard and
the drawer change in one render. The draft is held in a ref as well as state, so a
second Done in the same tick finds nothing to commit. **Cancel** (new, in the
footer), the close button, Escape, a scrim click and unmounting the page all drop
the draft. `setPreference` now returns whether the write landed; when storage
refuses, the dashboard shows the choice for the visit and a **warning** toast says
it was not saved, rather than letting a reload undo it silently.

The switches became **Checkboxes** — DS §8.7: "use a checkbox if a save action
follows". The ⋯ menu's "Remove from dashboard" (with Undo) is unchanged: it acts on
the dashboard itself, not inside the drawer. Shared by the Doctor and Admin
Overviews (`components/patterns/dashboard/`, `hooks/`), so both are fixed.

### 37.3 Medora AI logo → COMPLETE_VERIFIED

`shared/components/branding/MedoraAiLogo.tsx` + `assets/medora-ai-logo.png`, the
**supplied raster**, not a redrawing: its white page was removed by flood fill from
the edges only (the white ECG line inside the heart is untouched), edge pixels
un-blended from white, cropped square, resampled to 256×256. It is shaped as a
`LucideIcon` (forwardRef `<svg>` wrapping the image), so it drops into existing
`icon`/`leadingIcon` slots without changing their APIs. Replaces `Sparkles` at every
assistant entry point: sidebar item, navbar button, AI page header, AI workspace
greeting and "New chat", chat assistant avatars (message and streaming), dashboard
widget + its catalogue entry + its button, Quick actions' button, patient header,
record/lab/prescription "Ask AI" buttons, the lab and prescription row-menu items,
and the `ai` notification category. **Left alone, on purpose:** `StatusBadge`'s
`ai` provenance badge ("AI-generated", not the product), the reports `Bot` icon,
the insights panel, the profile-completion widget and the sign-in benefit bullet.

### 37.4 "AI Assistant" → "Medora AI" → COMPLETE_VERIFIED

Locale keys, all five locales (en/ar/fa/fr/tr): `nav.assistant` = `Medora AI`
everywhere (a product name, not translated); `shell.openAssistant` = "Open Medora
AI" / "فتح Medora AI" / "گشودن Medora AI" / "Ouvrir Medora AI" / "Medora AI’ı
aç". Hard-coded English labels in the doctor feature (which does not use the
message catalogue): route crumb and page title, AI page h1 + breadcrumb, the
widget title and "Open Medora AI", Quick actions, patient header button, the `ai`
notification category label. **Not renamed:** `admin/permissions.ts` ("Use the AI
assistant" — mirrored by the backend parity spec), `AI_MODEL_NAME` (model
configuration), "Ask AI" / "AI analysis" / "AI medication review" (action labels,
not the product name), internal identifiers, routes and API contracts.

### 37.5 Gate

`frontend`, on the final tree:
- `typecheck`: 0 errors.
- `lint`: 0 errors, the 20 accepted warnings.
- `test`: **272 files, 2,806 tests passed** on the tree merged with `frontend` @
  `25934cf`, against 270 and 2,786 in §36.7 — 2 new files, 20 new tests:
  - `OverviewPage.test.tsx`: +13 (12 draft→Done workflow — open, select, deselect,
    run of changes, Done applies + persists in order, Cancel / close / Escape each
    discard and reopen on the saved set, unmount mid-edit, Remove all, storage
    refusal; 1 Customize control);
  - `useDashboardEditor.test.tsx`: 4 (new — by-value draft, single commit under
    repeated Done, cancel, edits with no draft);
  - `MedoraAiLogo.test.tsx`: 3 (new);
  - existing dashboard, admin-overview and navbar specs updated for the new label,
    checkboxes and name; two `toBeVisible` checks now wait out the widgets'
    entrance fade, which starts on Done instead of during toggling.
- `build`: passed.

**Browser (Chromium, mock backend):** 33/33 scripted checks, zero console or page
errors — scenarios 1–5 (select without Done, deselect without Done, several then
Done, Cancel/close/Escape then reopen, reload after Done); the label, icon and
logo in light and dark; Arabic `dir=rtl` with "Medora AI" intact; the chat still
sends and streams a reply; no horizontal overflow and the drawer footer fits at
1440, 820 and 390 px. **axe-core (WCAG 2 A/AA, 2.1 AA): 0 violations** on the empty
Overview, the open drawer, the populated Overview and the Medora AI page; Space
toggles a checkbox, Enter on Done applies, focus returns to Customize.

**Register:** unchanged at 82 rows (`node scripts/count-checklist-register.mjs`,
after §36's NEW-34, NEW-35 and NEW-36). No row was added: the control and workflow sit
inside §3.1's / ADM-01's existing surface, the branding across rows already
recorded.

### 37.6 Not run

A live API (G-1), a screen reader, Safari/Firefox, and the backend and patient-app
suites — no backend or patient-app file changed.

## 38. Completion pass 21 — 2026-11-06

**Scope.** A frontend-only pass over what `backend` gained since §37: PRs #183–#186
(17 commits on `origin/backend` that neither `main` nor `frontend` holds). One task
branch, `claude/frontend-auth-recovery-reauth`, cut from `frontend` @ `7184d86`.
Nothing in `backend/`, `patient-app/`, Prisma, the AI service, CI, `vercel.json` or
any deployment setting changed. No database was started and nothing was live-run
(G-1). Every route consumed below is served **only** by an API built from
`backend`, and each one says what it does against a `main`-built API — the
practice since PRs #102–#105 (§20.5).

### 38.1 Re-checked first

What `backend` now serves that a frontend row was waiting on, read from the
controllers and services on `origin/backend` @ `bbb5377`, not from prose:

| Backend capability | Route | Commit | Frontend row |
| --- | --- | --- | --- |
| Lock-screen re-authentication, sharing sign-in's lockout | `POST /me/password/verify` → 204 | `4c6458d9` | A-12a |
| Recovery-code sign-in (R1) | `POST /auth/otp/recovery` | `8992a208` | NEW-37 |
| Two-factor status (R2) | `GET /me/2fa` → `{ enabled, recoveryCodesRemaining }` | `8992a208` | NEW-38 |
| Authenticator re-enrolment (Q7 / R4); `/me/2fa/setup` 409 when enrolled | `POST /me/2fa/reenroll`, `…/reenroll/confirm` | `8992a208` | NEW-38 |
| `Idempotency-Key` on seven POSTs (ADR-014) | appointment create, prescription create/sign/renew, lab-order create, conversation create, message send | `4c6458d9` | NEW-39 (RM M39.3) |
| Storage health indicator in `/health`; M25 complete (S3 + ClamAV) | `GET /health` → `services.storage` | `94297dde` | D-04/D-04b, NEW-13 |
| Clinical list exports, record-issue queue | `GET /…/export`, `/admin/record-issues` | `4c6458d9` | not taken — below |

CORS (`applyCors`) names no `allowedHeaders`, so the `cors` package reflects the
requested ones: the new `Idempotency-Key` header passes a preflight against both a
`main`- and a `backend`-built API, as `X-Correlation-Id` already does.

### 38.2 A-12a → IMPLEMENTED_UNVERIFIED

The row in §13.2. `httpAuthService.reauthenticate` (`api/endpoints/auth.ts`) and
`LockScreenPage`; the new `ReauthLockoutError` (`types/auth/auth-error.ts`) is a
client class, not an `AuthErrorCode`, for `UnsupportedRoleError`'s reason.
`docs/handoff/auth-seam.md` §4 item 1 is marked answered.

### 38.3 NEW-37 — sign in with a recovery code

The row in §13.2. Mock path: the demo accepts one recovery code,
`0a1b2-c3d4e`, normalised as the server does (`mock-auth-service.ts`).

### 38.4 NEW-38 — recovery codes left; replacing the authenticator

The row in §13.2. `SecuritySettings.recoveryCodesRemaining` (`number | null`) is
new on the settings document; the mock seeds `null`. The port gains
`beginTwoFactorReenrollment` / `confirmTwoFactorReenrollment`; the mock adapter
refuses both (its `twoFactorEnrolment` capability is off, so no screen offers them).
Settings strings stay English, as the rest of Settings does (F-19).

### 38.5 NEW-39 — `Idempotency-Key`

The row in §13.2. RM M39.3's verify step ("a replayed POST with the same key
returns the original result") is a server behaviour, proven on `backend` by its
interceptor spec; here the client is proven to send the same key on a retry of the
same intent and a new key for a new one. The roadmap box is `backend`'s file and
was not ticked from here.

### 38.6 Checked and not changed

- **D-04/D-04b and NEW-13.** DEC-018's recommendation — option A plus a storage
  `HealthIndicator` — is now met on `backend`: `StorageHealthIndicator` reports
  `up` / `down` / `unconfigured` under `services.storage`, which is exactly what
  `http-documents-service.ts`'s `storageState()` reads, and M25 binds ClamAV, so a
  file can leave `scan_pending`. No frontend change is needed for either row. Both
  stay where they are until a run against a real store; DEC-018 itself remains the
  owner's to close.
- **Server CSV exports** (`GET /patients/export` and three more). The "exports" row
  is `COMPLETE_VERIFIED` on the client's own export; moving it to the audited,
  scope-matched server export is a behaviour change to a finished feature and was
  not made without being asked. Recorded as the next eligible item.
- **`/admin/record-issues`** — `/admin/*` is single-tenant; DP-02's rule keeps it
  unwired.

### 38.7 Gate

`claude/frontend-auth-recovery-reauth`, on the final tree:
- `typecheck`: 0 errors.
- `lint`: 0 errors, the 20 accepted warnings.
- `test`: **280 files passed, 1 skipped; 2,912 tests passed, 4 skipped.**
- `build`: passed.
- **Backend suite** (because `frontend/src/types/auth/` changed — CLAUDE.md's
  cross-tree rule): `typecheck` and `lint` clean; the two specs that read
  `frontend/src/types/auth`, `permission-catalogue.spec.ts` and
  `search.dto.spec.ts`, pass (16). The full `vitest run` fails 190 tests in 102
  files, every one an e2e or Redis spec unable to reach PostgreSQL (135 × "Can't
  reach database server") or Redis (`ECONNREFUSED`) in this environment; no
  `backend/` file changed.

**Register:** 82 → 85 rows (`node scripts/count-checklist-register.mjs`):
`COMPLETE_VERIFIED` 64, `IMPLEMENTED_UNVERIFIED` 9 (+4: A-12a, NEW-37, NEW-38,
NEW-39), `PARTIAL` 5, `MOCK_ONLY` 4, `BLOCKED_BACKEND` 3 (−1: A-12a).

### 38.8 Not run

A live API (G-1), a browser session, a screen reader, and the patient-app suite —
no patient-app file changed.

## 39. Completion pass 22 — 2026-11-06

**Scope.** A continuation of §38 while PR #187 is open and unreviewed (CI running,
no comments). Nothing it built was redone. Three task branches, one per task:
`claude/frontend-admin-2fa-coverage` **stacked on #187's branch** (it tests #187's
code and extends this file's §38), `claude/frontend-csv-formula-guard` from
`frontend` (PR #189), and `claude/patient-app-2fa-recovery` from `patient-app` (PR
#188). Nothing in `backend/`, Prisma, the AI service, CI, `vercel.json` or any
deployment setting changed. No database, API or device was run: every test below is
over mocked or recorded responses (G-1).

### 39.1 Re-checked first

- **`backend` is unchanged since §38** (`bbb5377`); `main`, `frontend` and
  `patient-app` have not moved either. The re-audit of §20.3's open rows against its
  controllers found **no row newly unblocked**: no lab-annotation route (D-15), no
  recipient lookup (D-24/§3.9, API-W09), no hospital-scoped route (ORG-01…03,
  D-27/27b/28, ADM-01…AC-16), no imaging source (D-05), AI still Phase 28 (D-09), and
  `POST /lab-orders/:id/attachments` is the technician workflow BR-DEC-006 holds.
- **Admin.** The administrator's own *My Settings* (`/admin/preferences/:section`)
  and the staff workspaces mount the doctor `SettingsPage`, and the OTP step and the
  lock screen are shared. So #187's recovery-code sign-in, lock re-authentication,
  count and re-enrolment already reach every role; nothing admin-specific was missing
  but proof (§39.2). The admin *My Profile* page's Security panel shows whether
  the platform enforces 2FA and the session and device counts; it is unchanged.

### 39.2 NEW-38 — rendered for every workspace

`features/doctor/settings/security-recovery.test.tsx` (13): the Security section over
the HTTP adapter, mounted as the router mounts it for the doctor, the administrator
(sections minus `PRACTITIONER_SETTINGS_SECTIONS`) and reception
(`STAFF_SETTINGS_SECTIONS`). Each shows the count and *Replace…*, warns at none, and
offers neither when the count is unserved (404) or 2FA is off; the administrator's
re-enrolment runs both routes and re-reads the count (1 → 10). This closes the gap
§38's NEW-38 row recorded. Status unchanged: still not live-run.

### 39.3 D-04/D-04b and NEW-13 — re-checked against M25

Read on `origin/backend`: `files.controller.ts` (`POST /files`, multipart `kind` +
`file`), `file-policy.ts` (patient documents PDF/JPEG/PNG/WebP up to 25 MB; profile
photo JPEG/PNG/WebP up to 5 MB), the download route (`{ url, expiresInSeconds }`; 404
→ 403 `scan_pending` → 503, an infected file answering `scan_pending` too),
`ClamAvMalwareScanner` (fails closed) and `StorageHealthIndicator`. **The contracts
`http-documents-service.ts` and `putProfilePhoto` were written against are unchanged**,
and the indicator answers under the key the adapter reads, so both rows need no code
change — only the adapter's comment, which still said no indicator existed, is
corrected. DEC-018 stays **OPEN**.

**The live verification both rows still need**, unrunnable here (no Docker daemon,
so no MinIO or clamd): an API built from `backend` with `STORAGE_*` pointed at a
bucket and `CLAMAV_HOST` set; `/health` reporting `services.storage: up`; then, as a
doctor — upload a PDF to a chart, see it `scan_pending`, see it open after the scan
clears, see an EICAR file refused at download; upload a profile photo and see the
signed URL render, then expire.

### 39.4 CSV exports — the assessment, and NEW-40

| | Client (`utils/export.ts`) | Server (`GET /…/export`, `backend` only) |
| --- | --- | --- |
| Lists | patients, records, labs, prescriptions, reports, admin logs | patients, records, prescriptions, lab orders |
| Formats | CSV, Excel (`.xls`), PDF, JSON, print | CSV |
| Rows | exactly what the screen shows, sorted and selected | the list's query filters, ≤ 5,000 (409 above) |
| Scope | what the client already fetched | the caller's care scope; admin gets the masked directory |
| Audit | none | `*.export` at warning, with row count and filter names |
| Formula text | **evaluated** (before PR #189) | neutralised |

**Not migrated.** The client exports work and are `COMPLETE_VERIFIED`; replacing them
would drop four formats, change "file matches table" to "file matches the query",
and — the substantive difference — put bulk PHI exports on the server's audit trail.
That last point is a policy choice, not a frontend one. **Question for the owner:**
should a clinical list export be audited server-side (and therefore be the server's
CSV), keeping the client formats only for non-PHI reports? The one defect found —
formula injection — is fixed on the client regardless (NEW-40, PR #189).

### 39.5 The patient app (PR #188)

Recovery-code sign-in on the OTP step (R1), the 2FA status and remaining codes on
Security (R2), and authenticator re-enrolment (Q7 / R4), over the same `backend`-only
routes; recorded on `PATIENT_FRONTEND_CHECKLIST.md` D-07 and D-16 with no status or
count change. **Not built:** unlocking the biometric lock in place with
`POST /me/password/verify` — D-15 specifies that the password path signs out, so
changing it is the owner's call.

### 39.6 Gate

`claude/frontend-admin-2fa-coverage` (this branch, on #187): `typecheck` 0 ·
`lint` 0 errors, 20 accepted warnings · `test` 281 files passed, 1 skipped; 2,925
passed, 4 skipped · `build` passed. `claude/frontend-csv-formula-guard`: `typecheck` 0 ·
`lint` 0 errors, 20 accepted warnings · `test` 280 files passed, 1 skipped; 2,894
passed, 4 skipped · `build` passed. `patient-app` (PR #188): `typecheck` 0 · `lint` 0 ·
`test` 115 suites passed, 1 skipped; 2,166 passed, 8 skipped · `build` (`expo export`)
passed.

**Register:** 85 → 86 rows (NEW-40, `IMPLEMENTED_UNVERIFIED`); no other status moved.

### 39.7 Not run

A live API, a real object store or scanner, a browser, a screen reader, a device,
and a spreadsheet opening an export.

## 40. Completion pass 23 — 2026-11-07

**Scope.** PR #187 merged into `frontend` (`4674cb2`); #188–#190 open, mergeable,
no reviews. This pass: a frontend security audit, a cross-application check, and
the first **live run** of the auth and storage rows. Branches:
`claude/frontend-auth-security-hardening` from `frontend` (PR #192, code),
`claude/patient-app-otp-honesty` on #188 (PR #191), and this record, on #190 (merge
#190 and #192 first). Nothing in `backend/`, Prisma, the AI service, Docker files,
CI, `vercel.json` or any deployment setting changed.

### 40.1 Evidence vocabulary

| Kind | Means | Rows in this pass |
| --- | --- | --- |
| Mocked / recorded responses | Vitest or Jest over stubbed `fetch` with shapes transcribed from the controllers | every new test |
| **Real API** | The SPA in Chromium (Playwright 1.63) with `VITE_ENABLE_MOCKS=false`, against `node dist/main.js` built from unmodified `origin/backend` `bbb5377`, on PostgreSQL 16, Redis 7, MailHog — **local containers, not a deployment** | §40.2 |
| **Real storage** | The same, plus MinIO (`pgsty/minio:RELEASE.2026-08-04T00-00-00Z`) and clamd (`clamav/clamav:1.4.3`, bundled signatures 27927) | §40.3 |
| Browser | Chromium only; no Safari/Firefox | §40.2–40.3 |
| Native device | none | — |

### 40.2 Live: authentication (19/19)

Account created through the real flow (`POST /auth/register` → mailed link → `POST /auth/verify-email`).
Idle lock after 10 min (Playwright clock) · a wrong password named, with no `/auth/*`
call · unlock through `POST /me/password/verify` · real TOTP enrolment, ten codes
shown once, *10 left* from `GET /me/2fa` · re-enrolment (password + current TOTP →
new key → new TOTP) with ten new codes · sign-out · a 2FA challenge at sign-in · no
demo code and *Need more time?* on the live step · a replaced recovery code refused ·
a new one, upper-cased, signing in · *9 left* · a two-factor account unlocking in
place · the holder mailed *A recovery code was used on your Medora account* (R3) · no
page errors. The run's own two script defects (a read before render, a fake clock
carried across a page load) were fixed and the run repeated from a reset account.

### 40.3 Live: documents and profile photo (14/14)

`/health` → `services.storage: "up"` (DEC-018 option A's prerequisite, now met on a
`backend`-built API) · the Documents tab offers its actions · a PDF uploaded
(`POST /files`, `kind=patient_document`) and filed · *View* refused as `scan_pending`
before the every-minute sweep · after ClamAV's `clean`, *View* follows a signed URL
under `http://localhost:9000/medora-files/patient_document/…` carrying
`X-Amz-Signature` and `X-Amz-Expires`, whose bytes equal the upload · a `.pdf` whose
bytes are the EICAR string is **refused 422 at upload** by the server's leading-
signature check (`shared/files/file-signature.ts`), with the refusal shown · crop →
*Save photo* → `PUT /me/profile/photo` 200 · after the scan the avatar renders from a
signed `profile_photo/…` URL serving `image/png` · no page errors.

**Not live:** an *infected* document. EICAR matches only at offset 0, and a file
starting with it is not a PDF, so the signature check refuses it before any scan; the
infected branch of the download gate (`scan_pending`, same code) stays covered by
recorded responses. The backend's own `storage-live.e2e-spec.ts` judged EICAR
`infected` through a plain-text message attachment.

### 40.4 Security audit

| Area | Finding | Action |
| --- | --- | --- |
| Signed download URLs | Followed by an anchor click in this origin with no scheme check | **Fixed** — NEW-41 (PR #192) |
| 2FA enrolment link (web) | `otpauthUrl` rendered as `<a href>`; React 18 renders `javascript:` | **Fixed** — NEW-41 (PR #192) |
| 2FA enrolment link (patient app) | `Linking.openURL(otpauthUrl)` with any scheme | **Fixed** — PR #191 |
| OTP step (web, patient app) | Promised a delivered code; TOTP delivers nothing | **Fixed** — NEW-42 (PR #192), PR #191 |
| OTP step (web) | *Demo code: 123456* shown on live sign-ins | **Fixed** — NEW-42 (PR #192) |
| CSV export | Formula-leading text evaluated | Fixed in PR #189 (NEW-40) |
| Lock screen / re-auth | 401 discrimination, lockout ends the session | Verified live (§40.2) |
| Recovery codes | Shown once; web keeps them in the mutation cache until `queryClient.clear()` (logout, lock, refused refresh — NEW-31); patient app in component state only | No change |
| File upload validation | Types and sizes are the server's; it also checks leading signatures | Verified live (§40.3); no client pre-check, by design |
| Signed URL leakage | `rel="noopener noreferrer"` already set | No change |
| Role-based UI | `guards.test.tsx`, `staff-workspaces.test.tsx` | No change |
| Console logging of PHI | No `console.log/info/debug` in `src` outside tests | No change |
| Open redirect (`returnTo`) | Fixed in pass 17 (§34.2) | No change |

### 40.5 Cross-application consistency

| Workflow | Web (doctor · admin · reception) | Patient app | State |
| --- | --- | --- | --- |
| Recovery-code sign-in | Shared OTP page | OTP screen | Same route, same refusals; wrong code named as a *recovery* code in both |
| 2FA status and count | One Security section in all three workspaces | Security screen | Both read `GET /me/2fa`; both assert nothing on a 404 |
| Re-enrolment | Dialog | Inline flow | Same three steps, same expired-token restart, same lockout sign-out |
| Lock screen | Password, in place | Biometric; *Use your password instead* signs out (D-15) | Different by approved design — not changed |
| OTP wording | *Need more time?* | *I need more time* | Both now name the authenticator app |
| Enrolment link | `otpauth://` only | `otpauth://` only | Consistent |

### 40.6 The whole register, re-read

Every open row was re-read against `origin/backend` @ `bbb5377`, which has not moved.
**No row is newly unblocked.** What holds the 17 rows that are not
`COMPLETE_VERIFIED`:

- **Backend (route missing on every branch):** D-15 lab annotations · D-24/§3.9
  recipient lookup (API-W09) · D-05 imaging source · F35 the complaint flag · the
  technician side of lab attachments (BR-DEC-006) · NEW-04b the correction route and
  the removed-entry read · NEW-13 photo removal.
- **Hospital scope (DP-02, multi-hospital):** ORG-01…03 · D-27/27b/28 ·
  ADM-01…AC-16 · D-09 (Phase 28).
- **External verification:** F-18 a screen reader · F-19 a clinical translator ·
  ADM-02/03/05 and ADM-09 a seeded admin second factor (F33) · NEW-39 a live
  idempotent replay · NEW-40 a spreadsheet opening an export.
- **Owner:** DEC-018 (documents gate; option A is now verified live, the decision is
  still open) · server-audited exports (§39.4) · the patient lock's in-place password
  unlock (D-15) · recovery after losing both the app and the codes (C-1).

### 40.7 Reproducing the live run

From the repository root, on a machine with Docker. Nothing below edits a tracked
file; configuration is environment variables only.

```bash
git worktree add ../wt-backend origin/backend
docker run -d --name medora-pg -p 5432:5432 -e POSTGRES_USER=medora -e POSTGRES_PASSWORD=medora -e POSTGRES_DB=medora postgres:16-alpine
docker run -d --name medora-redis -p 6379:6379 redis:7-alpine
docker run -d --name medora-minio -p 9000:9000 -e MINIO_ROOT_USER=medora -e MINIO_ROOT_PASSWORD=medora-dev-secret pgsty/minio:RELEASE.2026-08-04T00-00-00Z server /data
docker exec medora-minio sh -c 'mc alias set local http://localhost:9000 medora medora-dev-secret && mc mb --ignore-existing local/medora-files'
docker run -d --name medora-clamav -p 3310:3310 clamav/clamav:1.4.3
docker run -d --name medora-mailhog -p 1025:1025 -p 8025:8025 mailhog/mailhog:v1.0.1
```

Then, in `../wt-backend/backend`, export the variables of `backend/.env.example`
with `CLAMAV_HOST=127.0.0.1`, `S3_BUCKET=medora-files`, `RATE_LIMIT_ENABLED=false`
and a throwaway `JWT_SECRET`, and run `npm ci && npx prisma generate && npm run
db:deploy && npm run db:seed && npx nest build && node dist/main.js`. In
`frontend/`: `VITE_APP_ENV=development VITE_ENABLE_MOCKS=false
VITE_API_BASE_URL=http://localhost:3000/api/v1 npx vite --port 5173`. Expect
`GET /api/v1/health` → `storage: "up"`. Register a doctor at `/signup`, open the
link MailHog shows at `http://localhost:8025`, and follow §40.2–40.3.

**Still owed on a real deployment:** an `https:` store with a production build (the
`http:` allowance is development-only), signature freshness (freshclam needs egress),
and a mail provider.

### 40.8 Gate

`claude/frontend-auth-security-hardening` (PR #192): `typecheck` 0 · `lint` 0 errors,
20 accepted warnings · `test` 281 files passed, 1 skipped; 2,932 passed, 4 skipped ·
`build` passed. `patient-app` (PR #191): `typecheck` 0 · `lint` 0 · `test` 116 suites
passed, 1 skipped; 2,180 passed, 4 skipped · `expo export` passed. This branch adds
documentation only.

**Register:** 86 → 88 rows (NEW-41, NEW-42). `COMPLETE_VERIFIED` 64 → 71 (A-12a,
NEW-37, NEW-38, D-04/D-04b, NEW-13, NEW-41, NEW-42), `IMPLEMENTED_UNVERIFIED` 10 → 6,
`PARTIAL` 5 → 4, `MOCK_ONLY` 4, `BLOCKED_BACKEND` 3.

### 40.9 Not run

A deployment, Safari/Firefox, a screen reader, a phone or simulator, a spreadsheet,
and a live idempotent replay.

## 41. Completion pass 24 — release readiness — 2026-11-07

**Scope.** PRs #187–#193 are merged (`frontend` @ `805f356`, `patient-app` @
`8cf07a1`); `backend` has not moved (`bbb5377`). This pass closes every verification
gap the local live stack can reach, and fixes what that turned up. Branches, one
task each: `claude/frontend-xls-formula-guard` (PR #194),
`claude/frontend-otp-challenge-expiry` (PR #195),
`claude/frontend-doctors-pending-agreement` (PR #196),
`claude/patient-app-otp-challenge-expiry` (PR #197), and this record. Nothing in
`backend/`, Prisma, the AI service, Docker files, CI, `vercel.json` or any deployment
setting changed; nothing was deployed.

### 41.1 Method

The §40.7 stack (API from unmodified `origin/backend`, PostgreSQL, Redis, MinIO,
ClamAV, MailHog in local containers), the SPA with `VITE_ENABLE_MOCKS=false`, Chromium
through Playwright. **Real API, real storage, Chromium only.** Two throwaway-database
interventions, both stated: the dev seed's password-less `admin@medora.health` was
soft-deleted so the real `admin:bootstrap` could run, as it would on a production
database (which seeds no administrator); and the test account's lockout counter was
cleared after the lockout test.

### 41.2 NEW-39 — `Idempotency-Key`, live (API 9/9, UI 7/7)

The UI run drops the answer to the first *Sign & issue* after the server has signed
(`route.fetch()` then `abort`): the page reports a failure, not success; the retry
succeeds; the chart holds **one** prescription; both sign requests carried the same
key and the draft was created once.

### 41.3 CSV and Excel exports, opened in a spreadsheet

LibreOffice (headless, formula evaluation on) over files downloaded through the
Patients page: the **CSV holds 0 formulas** (an unguarded control holds 1). The
**`.xls` held a live `=HYPERLINK` formula** — fixed as NEW-43, re-exported, 0
formulas. The leading quote stays visible in LibreOffice; that is the accepted cost of
this guard and the server's CSV behaves the same. Microsoft Excel was not available.

### 41.4 F33 closed: the administrator rows, live

`npm run admin:bootstrap -- --email live.admin@medora.test --confirm` → the mailed
link → the web *Accept your invitation* page (password, then a TOTP enrolment with
recovery codes shown once) → sign-in with TOTP. Then ADM-02 (6 doctors, filters,
counts), ADM-03 (blockers named, *Request documents*, *Suspend*/*Reactivate*), ADM-05
(table and drawer withhold the patient, *Reassign*, *Cancel administratively*), ADM-09
(dry run, apply, reload, revert). Scripted results: ADM-03 5/5 and ADM-09 4/4 in one
run; ADM-05 6/6 in a second run — its first attempt failed two checks on the script's
own wrong assumptions (it looked for the patient's name, which the oversight view
withholds by design, and for a nudge on a *scheduled* appointment); ADM-02 by reading
the live list after the first selector used the doctor-side display name. The
invitation, enrolment and TOTP sign-in are evidenced by every later sign-in as that
administrator. Found: NEW-45 (fixed) and NEW-46 (backend). Also observed and **not** changed: *Reassign* matches specialty by
exact string on both sides, and sign-up takes specialty as free text (`cardiology` ≠
`Cardiology`), while a `specialties` reference table exists — a backend contract and
sign-up product question.

### 41.5 Authentication, re-checked live

| Check | Result |
| --- | --- |
| Lock re-auth, recovery codes, enrolment, re-enrolment | §40.2, unchanged code; not repeated |
| Lock-screen lockout (5 wrong) | Session revoked; *Too many incorrect attempts … signed out*; only *Sign in again* |
| Sign-in throttle (`RATE_LIMIT_AUTH_MAX=3`) | 3 × *Incorrect email or password*, then *Too many sign-in attempts* |
| OTP challenge expiry | **Defect** — a valid code at 5 min 20 s read *incorrect*; fixed as NEW-44, re-run: *This sign-in has expired* |
| *Sign out others* | The other session's **access token keeps working until it expires (≤ 15 min)**: revocation acts at the next refresh. This is the master guide's design (§11: stateless JWT ≤ 15 min); recorded for the owner because OD-12 asks for immediate revocation on employment end |

### 41.6 Accessibility and layout (Chromium)

axe-core, WCAG 2.0/2.1/2.2 A–AA, **0 violations** on: the OTP step and recovery mode
(1440 and 375 px), Settings → Security with recovery codes, the re-enrolment dialog,
the live Documents tab, admin doctors, oversight and roles (375 px). Keyboard: Tab
reaches *Use a recovery code instead*, Enter opens it with focus in the field; the
re-enrolment dialog takes focus and returns it to *Replace…* on Escape; refusals are
`role="alert"`. No horizontal overflow at 375 px. A first axe run reported 5
contrast nodes in the dialog: measured at 0 ms and 800 ms, they exist only during
the entrance fade (0 after it). **Not run:** Firefox and WebKit (only Chromium is
installed and installing browsers is not permitted here), a screen reader (F-18).

### 41.7 Patient app

PRs #188/#191 are merged. This pass adds the expiry fix (D-07 annotated). Gate on the
branch: `typecheck` 0 · `lint` 0 · `test` 116 suites passed, 1 skipped; **2,183
passed, 4 skipped** · `expo export` (Android) passed. **Not run:** a device or
simulator — the export targets Android only and none is available; the D-15 lock is
unchanged by design.

### 41.8 Backend dependency report (confirmed on `bbb5377`)

| Row | Missing capability, confirmed in code |
| --- | --- |
| D-15 lab annotations | No annotation route in any controller |
| D-24/§3.9 recipient lookup | No doctor-reachable directory; `GET /administration/staff` is admin-only, single-tenant (API-W09) |
| D-05 imaging | No imaging module or route |
| F35 complaint flag | Nothing creates a `message_flags` row, so the flag cannot fire |
| Lab technician upload (BR-DEC-006) | `POST /lab-orders/:id/attachments` is behind `@Can('labs.review')` and the doctor rule; no technician scope |
| NEW-04b history correction | `GET`/`POST`/`DELETE …/history` only; no `PATCH`, no removed-entry read |
| NEW-13 photo removal | No `DELETE /me/profile/photo` |
| NEW-46 verification documents | Built in pass 25 (§42.3); a live upload needs an object store |
| ADM-09 custom roles | The session does not name a custom role's base role |
| ORG-01…03, D-27/27b/28, ADM-01…AC-16 | No hospital-scoped route (DP-02) |
| D-09 AI | Routes exist (`/ai/conversations`); blocked on Phase 28 hospital isolation, and no provider is configured (`/health` → `ai: unconfigured`) |
| §3.1 pulse, D-18 | Pulse sources only on `backend`'s M27; D-18 needs a drug reference dataset (external) |

### 41.9 Owner decisions — unchanged, unresolved

DEC-018 (option A now verified live, still open) · server-side audit of exports ·
the patient lock's in-place password unlock (D-15) · recovery after losing both the
app and the codes (C-1). New questions: immediate session revocation (§41.5);
specialty as free text (§41.4).

### 41.10 Manual verification still owed

- **Firefox, Safari/WebKit:** repeat §40.2, §41.5 and §41.6 with the §40.7 stack;
  watch the OTP cells' autofill, `<dialog>` focus return, and `a[download]` for the
  exports.
- **Screen reader (F-18):** NVDA + Firefox and VoiceOver + Safari on the OTP step
  (both modes), the re-enrolment dialog and a toast — each refusal announced once.
- **Patient app on a device:** an Android build from `expo export`; sign in to a 2FA
  account, *Use a recovery code instead*, Security → status, count, *Replace my
  authenticator app*, the `otpauth://` hand-off to an authenticator, and the expiry
  message after five minutes.
- **Microsoft Excel:** open both exports from §41.3.

### 41.11 Gate

Web, PRs #194–#196 merged together locally (unpushed): `typecheck` 0 · `lint` 0
errors, 20 accepted warnings · `test` 283 files passed, 1 skipped; **2,970 passed, 4
skipped** · `build` passed; each branch alone: `typecheck` 0, `lint` 0 errors and the
20 warnings. Patient app (PR #197): §41.7. This branch is documentation only.

**Register:** 88 → 92 rows (NEW-43…NEW-46). `COMPLETE_VERIFIED` 71 → 78 (NEW-39,
NEW-40, ADM-02/03/05, ADM-09 roles, NEW-43, NEW-44, NEW-45), `IMPLEMENTED_UNVERIFIED`
6 → 2 (F-18, ADM-09 custom roles), `PARTIAL` 4, `MOCK_ONLY` 4, `BLOCKED_BACKEND` 3 → 4
(NEW-46).

## 42. Completion pass 25 — frontend first, then patient app, then backend — 2026-11-15

**Scope.** Built on `claude/eager-feynman-nnhegs` (PR #240's branch, merged to `main`
at `beceb2e` while this pass was in progress). Order as instructed: every feasible
frontend task, then the patient app, and backend work only once neither had a feasible
task left — and then only to unblock a register row. No Prisma schema or migration
change, no CI, `vercel.json` or deployment change; nothing was deployed.

### 42.1 Re-audit

`node scripts/count-checklist-register.mjs` before this pass: **78 of 92**
`COMPLETE_VERIFIED` (2 `IMPLEMENTED_UNVERIFIED`, 4 `PARTIAL`, 4 `MOCK_ONLY`,
4 `BLOCKED_BACKEND`). Every open row was re-checked against this branch's controllers
and Prisma schema. One row had frontend work the existing API supports: **§3.1
pulse's no-show rate** (§42.2). The patient app had none (§42.4). That opened the
backend gate, and **NEW-46** was the one blocker that is a missing route with no owner
decision in it (§42.3). After: **78 / 3 / 4 / 4 / 3 = 92** — NEW-46 moves
`BLOCKED_BACKEND` → `IMPLEMENTED_UNVERIFIED`.

### 42.2 §3.1 pulse — the no-show rate, live

`GET /appointments` (`@Can('appointments.manageOwn')`, scoped by `doctorId` in the
`WHERE`) filters `startsAt` by `from` (≥) and `to` (<) and returns an exact
`totalItems`. Four `pageSize=1` reads give the no-shows and all appointments for the
last 30 days and the 30 before; the rate is their ratio, as the administrator's
`noShowRate7d` is. Evidence on the register row.

- **A client-side ratio of two server counts**, no rows read — the adapter's rule
  ("every figure shown is one the server returned or one counted from rows it
  returned") holds. A server aggregate would be cleaner; none exists.
- **Consultation length and response time are not drawn**, not shown as "—": nothing
  serves them, and the widget never falls back to the fixture.
- **The row stays `PARTIAL`.**

### 42.3 NEW-46 — a doctor files verification documents

**Backend** (`modules/doctors`, API §3.6a): `GET /me/verification-documents` and
`POST /me/verification-documents { fileId, kind, expiresOn? }`.

- **Whose:** the session's own `doctors` row — no route parameter or body field can
  name another doctor (a `doctorId` in the body is ignored, tested). Any account
  without a doctor profile gets 404, as `/me/availability` answers.
- **Which file:** the caller's own `verification_document` upload, live and stored,
  claimed under a row lock — another account's, another kind, or an unknown id is one
  422 on `fileId`; an upload already filed is 409. The type, size and signature rules
  stay on `POST /files` (PDF or image, 10 MB).
- **Review is unchanged:** approve, reject and verify stay `doctors.verify` (403 to a
  doctor on their own documents, tested); filing never moves `verificationStatus`.
- **Evidence kept:** `DELETE /files/:id` on a filed verification document answers
  409 `verification_document_filed` — before this route nothing could be filed, so
  the hole was not reachable. Unfiled uploads stay deletable.
- **Audit:** `doctor.verification_document_upload`, document id and kind, no filename.
- **Found and fixed while testing:** an `expiresOn` with a time returned 500 (zod runs
  refinements after a failed regex); one refine that cannot throw now answers 422.

Backend e2e `doctor-verification-documents.e2e-spec.ts`: 24 tests, including the
acceptance (a registered doctor filed, approved and verified over HTTP alone, with
in-memory storage). Removing the ownership filter, or the delete guard, fails its
test (checked). The route matrix gains two rows; `docs/openapi.json` and the contract
(3.6a, 17.3) are updated.

**Web** (Settings → **Verification**, `PRACTITIONER_SETTINGS_SECTIONS` only):

- The filed documents, newest first, each with the reviewer's decision in words
  (the admin side's own labels — "Awaiting review", "Identity document") and a
  rejection's reason; the required kinds still missing (none filed, or only
  rejected ones); empty, loading and error-with-Retry states.
- Submit: type, file, optional expiry → `POST /files`, then the filing call. The
  button is disabled while it runs. Server refusals are shown in its words; a 503
  names the missing file storage. **If filing fails, the upload is deleted** — the
  orphan sweep collects only soft-deleted files, so an unfiled upload would otherwise
  stay in storage.
- Never says "verified": the copy says an administrator *can complete* verification
  once the three required documents are approved. A document is valid through its
  expiry day and reads "Expired" from the next one.
- Live and mock adapters behind the seam; the mock keeps a session's documents in
  memory.

Tests: adapter 15, section 11, mock +2, service method list +2. The upload cleanup
and the expiry-day rule each fail their test when reverted (checked). Chromium,
demo bundle: submit → the row reads "Medical licence · Expires June 30, 2028 ·
Awaiting review"; 0 px horizontal scroll at 1280, 820 and 375 px in light and dark;
axe WCAG 2.2 AA 0 violations; 0 page errors. Live, against a local API built from this
branch: the list is read (200), and a submit with no object store shows the 503's
message and files nothing.

**Why `IMPLEMENTED_UNVERIFIED`:** a live *successful* upload needs an object store, and
the local stack has none. Owed with the §41.10 manual list. Strings are English, as
every Settings section but Appearance is (F-19).

### 42.4 Patient app

`PATIENT_FRONTEND_CHECKLIST.md` recounted from its rows: **123 ✅ / 52 🟨 / 8 🔴 / 25 ⬜ /
3 ➖ = 211**, as published. No 🟨/🔴/⬜ row is completable over a route a patient may
call: patients hold no capabilities (ADR-030 §6), so `/conversations`
(`messages.send`), `/ai/*` (`ai.use`) and `/patients/:id/labs` (`labs.review`) refuse
them; `/me/appointments` is read-only; `/public/*`, `/me/health/*`, slots and push
registration do not exist; `PUT /me/profile/photo` answers 503. No status changed.
Six comments that called served routes missing were corrected.

### 42.5 Open rows left, and why

| Row | Why it was not built here |
| --- | --- |
| §3.1 pulse (two metrics) | Consultation length and response time need a definition and an aggregate; the list view carries no actual visit times |
| NEW-04b | Correction route and removed-entry read wait on BR-DEC-003's "who may" (owner) |
| D-15 | Needs a schema column and its access rule |
| D-24/§3.9 | A doctor-reachable directory is a scoping decision (API-W09, multi-hospital) |
| F35 | A patient complaint source; patients cannot reach messaging (ADR-030 §6) |
| ADM-09 custom roles | Base role in the session payload — an auth contract change shared with the patient app |
| D-27/27b/28, ADM-01…AC-16, ORG-* | No hospital model or scoped routes (DP-02) |
| D-05, D-18 | No imaging source; drug reference data is content |
| D-09 | Phase 28 isolation; no AI provider configured |
| F-18, F-19 (not backend) | A screen-reader pass (NVDA / VoiceOver); a clinical translator |

### 42.6 Gate

Run on the final tree before delivery: web, patient app and backend
(typecheck, lint, the full suites — backend against PostgreSQL 16 and Redis as CI
runs them — the builds, `db:check`, `openapi:check` and the route-matrix snapshot).
The counts are in the delivery commit and report, not here, so this file is part of
the tree they were measured on.

## 43. Audit findings pass — security and transport — 2026-11-22

Client-only fixes from the 2026-11-22 audit, on branch `claude/frontend-checklist-completion`
(base `main` `db1db742`). `backend/` was read, never edited. Gate figures are in the delivery
report, not here, so this file is part of the tree they were measured on.

| ID | Finding | Status | Evidence | Remaining |
| --- | --- | --- | --- | --- |
| S1 | AI conversations persisted PHI in `localStorage` under global keys (`medora.ai.conversations.v1`, `medora.ai.settings.v1`) that no logout cleared; a patient-context chat holds the directory patient's name (context, title, greeting) | NEW → **COMPLETE_VERIFIED** (unit) | `ai/model/store.ts`: conversations in memory only. Settings per user (`medora.<userId>.ai.settings.v1`) and **kept on logout** (`KEPT_FEATURE_KEYS_ON_LOGOUT` in `services/preferences.ts`), as before S1 and like a composed dashboard. That is safe because `sanitizeAiSettings` reduces them, on every read and write, to numbers, booleans, enum members and ids from the fixed `AI_PROMPTS` catalogue: favourite prompts are catalogue ids, never free text, so no field can hold a patient's name. `ai/model/session-storage.ts` (no seed or mock imports) holds `clearAiSessionData`/`removeLegacyAiStorage`; the store registers its reset there, so `AuthProvider` — in the `/login` entry chunk — no longer pulls the seeded demo conversations into it. `clearAiSessionData` runs on sign-in, logout, lock and a refused refresh; `removeLegacyAiStorage` on first load. Tests: `AuthProvider.test.tsx` +6 (A → logout → B sees nothing of A; no patient name or `medora.ai.*` key in storage; lock; a sign-in with no preceding session end; refused refresh; legacy keys removed), `ai/model/store.test.ts` (7, new: memory-only, reset, settings kept over logout, free text dropped on write, a planted payload sanitized on read, signed-out writes nothing, legacy keys) | **Owner-visible trade-off (deliberate, fail-closed):** chats are now in memory only, so they are lost on reload, on idle lock and unlock, and a `?c=<id>` link to an old chat shows "not found". The owner may revisit this by choosing per-user encrypted or server-side storage. Whether production ships the mock assistant is also the owner's (D-09). Not browser-checked |
| S2 | `VITE_API_BASE_URL` accepted any URL, so a production build could talk to the API over plain http | NEW → **COMPLETE_VERIFIED** (unit) | `configs/env.ts` `resolveApiBaseUrl`: with `VITE_APP_ENV=production`, `https:` only, plain `http:` only to `localhost`/`127.0.0.1`; other environments unchanged. The demo build (`vercel.json`: `staging`, mocks on, URL unset) is untouched. `env.test.ts` +6 | — |
| D2 | `put`/`patch`/`delete` took no `RequestOptions`; the 30 s timeout was fixed | NEW → **COMPLETE_VERIFIED** (unit) | `api/client.ts`: every verb takes the same `RequestOptions`; new `timeoutMs` override; `UPLOAD_TIMEOUT_MS` = 120 s (10 MB at 1 Mbit/s is ~84 s) on `PUT /me/profile/photo` and both `POST /files` callers. Error semantics unchanged (a timeout is still a `network` `ApiError`). `client.test.ts` +7; the timeout is pinned on each upload caller: `doctor-profile-wire.test.ts` +1, `http-documents-service.test.ts` +1, `http-settings-service.verification.test.ts` +1 | — |
| D3 | `useClinicScope` gave every non-doctor role the admin's unscoped ("every clinic") view | NEW → **COMPLETE_VERIFIED** (unit) | Only `admin` is `UNSCOPED`; reception, laboratory and pharmacy get `null`, as a doctor without a clinic does. The one caller, `MyClinicPage`, mounts under `RequireRole role="doctor"`, so no staff screen changes. `useClinicScope.test.tsx` +3 | Retiring the hook for the active hospital stays WEB-5 |
| S3 | No hashed-script Content-Security-Policy: `vercel.json` sends only `frame-ancestors 'none'`, and `index.html` has one inline boot script that a `script-src` would need to hash | NEW → **NOT_STARTED** | — | Needs authorization to change Vercel/deploy configuration; not done in this pass |
| D1 | Client-side paging over whole collections: `fetchAllPages` (`api/http.ts`) caps at 20 pages × 100 = 2,000 items, then errors; 15 call sites in 11 adapters | NEW → **NOT_STARTED** | — | An L-size UX/design change (server-side paging, sorting and filtering). Recommended follow-up, starting with patients and appointments |
| T1 | Node 24 brand-checks `Request`'s `signal`; jsdom's `AbortSignal` failed it, so a data-router navigation died in tests (`NewMedicalRecordPage.test.tsx`, "a record created without its note…") | NEW → **COMPLETE_VERIFIED** | `test/setup.ts`: a `Request` subclass mirrors a foreign signal with a native one and forwards its abort. `test/request-signal.test.ts` (4, new) | Test environment only; no app change |
| T2 | The whole-tree scanners (`scripts/mock-boundary.test.ts` "reaches every seam…", `i18n/logical-properties.test.ts` "uses no physical direction utility…") overran the 5 s default under full-suite load; ~1 s alone | NEW → **COMPLETE_VERIFIED** | Those two tests only get a 30 s timeout, with the reason in the file; no assertion changed | — |
| S1-F | Mock messaging threads and drafts persist under the global `medora.messaging.v1` key (`features/shared-domain/conversations/store.ts`), which no logout clears — the same pattern as S1 | NEW → **NOT_STARTED** (recorded only) | — | Lower risk while messaging is MOCK_ONLY (D-24). Recommended follow-up: apply the S1 treatment (memory or per-user, cleared at the session boundary, legacy key removed) before messaging is wired live |

**Lint warnings.** Measured on this tree: 0 errors, **19** `react-refresh` warnings. Earlier
gate lines in this file that say "20 accepted warnings" record what was measured on their own
date and are left as written; the ceiling is now 19. `CLAUDE.md` still says 20 — stale, and not
this file's to edit.
