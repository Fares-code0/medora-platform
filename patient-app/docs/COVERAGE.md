# Test coverage — Medora Patient App

**Checklist row:** U-10 · **Measured:** 2026-09-13 on `patient-app`
**Threshold:** **none, deliberately.** See §3.

> **Re-measured 2026-09-13, at the end of the day's work.** **94.02%**
> statements (2818 / 2997), **87.75%** branches (1483 / 1690), 91.22%
> functions, 94.94% lines, from **1845 tests in 107 suites**. The earlier measurements this file carried are folded into the
> table below rather than stacked as more block quotes — a document whose
> history is longer than its content stops being read.
>
> | Measured | Statements | Branches | Tests |
> |---|---:|---:|---:|
> | 2026-09-07 `aa965d9` | 65.87% | 55.73% | 488 |
> | 2026-09-07 integrated | 71.05% | 59.87% | 588 |
> | 2026-09-07 after the auth screens | 75.73% | 63.50% | 652 |
> | 2026-09-08 (first pass) | 88.12% | 78.40% | 1040 |
> | 2026-09-08 (second pass) | 89.28% | 81.18% | 1156 |
> | 2026-09-08 (third pass) | 90.07% | 82.61% | 1195 |
> | 2026-09-08 | 90.92% | 83.18% | 1227 |
> | 2026-09-13 (first pass) | 92.95% | 86.72% | 1675 |
> | **2026-09-13** | **94.02%** | **87.75%** | **1845** |
>
> The denominator grew by about 500 statements between the last two lines —
> visit summaries, announcements, the session revoke, mark-read — so the
> percentage moving up is the useful part rather than the arithmetic. Most of
> the new tests are not coverage work at all: four sweeps over every screen (two
> for i18n leaks, one for headings, one for the service seam) and the fixes they
> found. The deliberate coverage work was the transport layer, where §2 has
> always said a regression is silent and expensive — query parameters that drop
> an array or stringify an object to `[object Object]`, a 401 that arrives
> before anything has wired a refresh, and the query client's own defaults,
> every one of which is a single word a tidy-up could remove without failing
> anything.

---

## 1. The number

```
npm --prefix patient-app run test:coverage
```

| | |
|---|---|
| Statements | **94.02%** (2818 / 2997) |
| Branches | **87.75%** (1483 / 1690) |
| Functions | **91.22%** (967 / 1060) |
| Lines | **94.94%** (2630 / 2770) |

Produced by 1959 tests in 108 suites. CI runs the suite **with** coverage in
one pass rather than twice, so the summary lands in the patient-app job's
log where a reviewer already is.

---

## 2. Where it is thin, which is the useful part

A single percentage is the least actionable thing a coverage report
produces. These are the areas a reader can do something about, by
statements:

| Area | Statements | Why |
|---|---:|---|
| `features/*/model` | **0%** | Type declarations. There is nothing to execute, and `collectCoverageFrom` keeps them in the denominator rather than hiding the fact |
| `features/messages` | 32.0% → **92.1%** | Fixture-backed and structurally blocked (BE-13, M-01…M-08). The screens exist; the behaviour they would have has no server. Two things moved it and neither needed the endpoint: **M-04**, where mark-read is client behaviour the missing route does not decide and the five cases are about *when* the write happens rather than what it returns; and the conversation list finally getting a suite of its own — which thread a row opens, and whether the unread count reaches a screen reader, are questions BE-13 has no bearing on |
| `features/auth/fixtures` | **46.2%** | The fixture adapter's unused branches — a mock's own error paths, which no screen reaches |
| `features/health/fixtures` | **50.0%** | The same, for Phase J |
| `features/clinic` | **62.5%** | Three of four rows wait on BE-11 |
| `features/profile` | 63.3% → **67.6%** | The fixture adapter and the three methods `httpProfileService` refuses by name (RA-030.2, BE-10). The screens above it are covered; this is the seam |
| ~~`features/support/screens`~~ | 69.2% → **100%** | **Closed**, 2026-09-13. Its untaken paths were the two W-11 states a deployment can be in, and the test that stood there covered whichever one the *build* happened to be in: it read the contact button and returned if it was absent. The screen takes the address as a prop now, the way `ConsentScreen` takes its documents, and the third state — a phone where `Linking.openURL` rejects — is covered too |
| `features/*/fixtures` | **46–86%** | A fixture's own error paths, which no screen reaches. Raising this would mean testing the stand-in rather than the app |
| ~~`accessibility`~~ | 66.7% → **85.7%** | **Closed**, 2026-09-08: `a11y.test.ts` covers `announce`, `focusOn`'s null guard and `labelWithHint`'s Android join — the only places this tree touches the platform's assistive APIs, where a regression is silent |
| `bootstrap/App.tsx` | **0%** | The provider stack. Exercised by every other test *through* its parts, and rendering the whole tree to assert that React nests children would be asserting React. Its **order** is a different thing and is now covered — `app-composition.test.ts` asserts the six nestings that are decisions rather than arrangement, against the source. A percentage will not move for it, which is the point |
| ~~`bootstrap/ErrorBoundary.tsx`~~ | **100%** | **Closed**, 2026-09-07. See §4 |
| ~~`features/appointments/screens`~~ | 46.7% → **higher** | **Closed**, 2026-09-08: `appointments-screen.test.tsx` covers both segments, both empty states, the failure and the refresh |
| ~~`features/emergency/screens`~~ | 42.9% branches → **higher** | **Closed**, 2026-09-08: `emergency-configured.test.tsx` covers the half a real deployment takes |

The pattern is not an accident and is worth stating plainly: **the
low-coverage areas are almost exactly the 🟨 rows.** A screen built over a
fixture behind the service seam has little behaviour to test until its
endpoint lands: the port refuses, the adapter is a mapping, and the screen
renders four states that are the same four everywhere. Coverage in this tree
is therefore closer to a *map of what the backend has not built* than to a
measure of test discipline.

By contrast the platform layers — `api/`, `theme/`, `types/`, `storage/`,
`accessibility/` — sit at or near 100%, and those are the modules where a
regression is silent and expensive.

---

## 3. Why there is no threshold

The row says it: *"Reported; the threshold is the owner's call."*

A number invented here would be a gate nobody agreed to. It would fail an
honest pull request the first time someone deletes a well-covered file, or
removes a dead branch and takes the ratio down with it — and the usual
response to that is to write a test that raises the number rather than one
that catches a defect.

`src/test/coverage-config.test.ts` asserts the absence, so adding a
threshold has to be deliberate: the test names this document and the
checklist row as the two places to record the decision alongside it.

**If the owner wants one**, the honest starting point is the current
figure rounded *down* — a ratchet that cannot be met on the day it is set
is a ratchet nobody keeps.

---

## 4. What is worth covering next

Ordered by what a gap would actually cost, not by what would move the
percentage most:

1. ~~**`bootstrap/ErrorBoundary.tsx`** — 0%.~~ **Done, 2026-09-07.** It was
   the screen a patient sees when everything else has failed and nothing
   had ever rendered it; R-05 called it done on the strength of the code
   existing. `src/bootstrap/error-boundary.test.tsx` now drives a real
   render crash through it — the fallback replaces the tree, Try again
   recovers, and the thrown message reaches neither the screen nor a log
   sink. **100%** statements, branches and functions.

   Two things the tests found, both now fixed or written down:

   - The fallback was not announced. Every other error surface in this app
     is a `polite` live region with a combined label; this one was three
     loose `Text`s. It is now a grouped live region, with Try again
     deliberately *outside* the group — `accessible` on a View collapses
     its subtree on iOS, and that would have made the only way off the
     crash screen unfocusable.
   - `errorMessage` never reached a sink and the comment above it said it
     did. `errormessage` contains `message`, which is on the redaction
     deny-list, so `redact()` replaces it. That is the safe reading and it
     is now the documented one — a render crash message is not reliably
     developer-authored (`Unknown severity for allergen Penicillin` is the
     shape they take in a records screen). Widening it is an owner
     decision; the test is where it would have to be argued.

2. ~~**Branch coverage, at 55.7%**~~ — **78.4%**, and still the lowest of the
   four, which is the point: the untaken branches in this tree are error paths,
   and error paths are what a PHI client is judged on. Two were closed on
   2026-09-08 by taking that sentence literally rather than by looking for cheap
   percentage:

   - **`features/appointments/screens`**, at 46.7% of statements. Both
     segments, both empty states, the failed load, the retry and
     pull-to-refresh were unexercised — every one of them a state a patient
     reaches by doing something ordinary. `AppointmentCard` was at 25%, so
     five of the eight status badges had never rendered.
   - **`features/emergency/screens`**, at 42.9% of branches, on the one
     screen where a wrong render is a safety problem rather than a bug. The
     shipped state — unconfigured, no number invented — was well covered; the
     *configured* half, which is what a real deployment renders, was not. It
     now asserts the same guarantees on the other side of the condition: the
     operator's numbers verbatim, the two-step gate in front of each, and a
     configuration that fails to load leaving the screen whole.

   Four more followed the same rule rather than the percentage:
   `features/auth/schemas.ts` (0% branches — every validation rule had
   been exercised by something passing and none by something failing),
   `features/doctors/screens` (the debounce, the server-side search and
   the recently-viewed privacy rule), `accessibility/useReducedMotion.ts`
   (0% branches, where the branches *are* the design), and the primitives'
   own state combinations in `component-states.test.tsx`.

   Three screens followed: `PreferencesScreen` (28.6% → 100%, alongside
   the language switcher it gained), `SecurityScreen` (10% → 90% — the one
   screen a patient opens *because* they are worried), and
   `ThemeProvider` (33% → higher, where the interesting branch is the OS
   answering `null` on the first frames and a dark default flashing a
   dark screen on a light phone). The sign-in screen's *sign-out notice*
   was covered too: `session.test.tsx` proved the session ends with the
   right reason, and nothing proved a patient is ever told it.

   `accessibility/a11y.ts` went with them — 50% → 85.7% of statements — for
   the same reason: it is the module every control in this app takes its
   props through, and a regression there is silent. The app renders, and a
   screen reader stops saying something.

   The platform layer went last, because a regression there is silent and
   expensive: the keychain adapter's accessibility class, the preference
   store's key handling, `randomId`'s Hermes fallback, and the logger's
   sink plumbing — the seam that makes `redact()` unavoidable for a crash
   reporter. `AppTabs` too: four of its five stacks had never been
   mounted, so a stack whose `screenOptions` forgot the Emergency header
   would have failed N-01 with nothing to catch it.

   What is left is mostly the fixture adapters' own unused branches, which
   are a mock's error paths that no screen reaches.
3. Everything else follows its endpoint. Once U-06's per-list state tests
   land, most of what can honestly be tested in `features/health`,
   `features/messages` and `features/clinic` before their endpoints exist
   will have been.

---

## 5. Reproducing this

```bash
npm ci --prefix patient-app
npm --prefix patient-app run test:coverage
```

`coverage/` is git-ignored. `text-summary` prints the table in §1;
`json-summary` writes `coverage/coverage-summary.json`, which is what the
per-area figures in §2 were computed from; `lcov` is for a local browser.

---

*Re-measure when the figure is quoted, not when it is convenient. The
numbers above are `patient-app` at `aa965d9` and will move the moment any
open pull request lands.*
