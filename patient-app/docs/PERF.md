# Performance budgets

**Checklist row:** W-08 (P0) · **Depends on:** B-07
**Status:** **partial.** One of the three budgets is measured and enforced; the
other two need a device this repository does not have.

---

## 0. Why a partial budget is worth writing

W-08's acceptance is *"budgets recorded and met on a low-end Android device"*,
and there is no device here. The tempting responses are both wrong: recording
numbers nobody measured, or recording nothing until someone has a phone.

So this document records **the one budget that can be measured from a build**,
enforces it with a test, and names the other two as blocked with the method
written down so whoever has the device does not have to invent it. A budget
nobody can check is a wish; a budget with a number and a check is a gate.

---

## 1. Bundle size — measured and enforced

| | |
|---|---|
| **Measured** | **3,216,658 bytes (3.22 MB)** on 2026-11-22 — the Android Hermes bytecode bundle, `dist/_expo/static/js/android/*.hbc` |
| **Budget** | **3.40 MB** (3.20 MB until 2026-11-22; see "Raised to 3.40 MB" below) |
| **Enforced by** | `src/test/bundle-budget.test.ts` |
| **Method** | `npm run build` (which is `expo export --platform android`), then the test reads the `.hbc` |

### Why 3.20 MB (the original ceiling)

About 10% of headroom over the current bundle. That is deliberately loose enough
that ordinary feature work never trips it, and tight enough that **one
substantial library cannot arrive unnoticed** — a charting package, a date
library with its locale data, or an i18n runtime would each show up here
immediately.

The margin is worth watching rather than trusting. This budget was written at
2.84 MB when it was measured against `patient-app` alone; integrating PRs
#114–#124 — three live HTTP adapters, the i18n catalogues, the onboarding
carousel, two-factor enrolment, the support screen and the deprecation banner —
moved it to **2.90 MB**, about 60 KB for eleven features' worth of code. At that
rate the ceiling is many features away, but the next one to consume real space
will be a dependency rather than a feature, which is precisely what the guard is
for.

E-02 then added the first dependency since that was written —
`@react-native-async-storage/async-storage`, for preferences that survive a cold
start. Measured on the same tree with and without it: **2,897,035 →
2,913,800 bytes**, so the module costs **16,765 bytes**, about 16 KB. Both
figures are exact rather than rounded, which is what the ceiling above should
have been recorded as from the start and is from here on.

It says the opposite of what the paragraph above feared: a small, single-purpose
native module is cheap in JavaScript, because almost all of it is native. The
dependency still worth watching is the one that ships a *table* — a date library
with its locale data, or an i18n runtime.

**Two corrections to the line above, both found by re-measuring rather than by
reading.** The figure was **2,913,800 bytes** when E-02 measured it and was not
re-measured as the tree grew; the number in the table is now what the last build
produced. And the headroom sentence is stale with it: 3,034,162 against a
3,200,000-byte ceiling is **165,838 bytes, about 5.2%**, not the "about 10%" the
budget was set with. The ceiling is not raised here — raising it is a decision
with a reason, and this is not one — but the next dependency has half the room
the paragraph above implies, and that is worth knowing before it is spent.

The figure went **down** for the first time on 2026-09-12, by **19,256 bytes**
(3,047,756 → 3,028,500; the locale and timezone work since took it to 3,034,162): three runtime dependencies that were declared and never
imported came out, and two that were pinned five majors ahead of the SDK were
corrected to the versions it ships. `docs/DEPENDENCIES.md` §2 has the list. It is
the direction this number is supposed to move.

§3's windowing accounts for **2,571 bytes** of the current figure — measured on
the same tree with and without the change, 3,045,185 → 3,047,756. It is cheap
because `FlatList` was already in the bundle: every `ScrollView` in the app
pulls in the same `VirtualizedList` module, so moving three screens onto it
costs the new component and nothing else.

**Re-measured 2026-09-13: 3,050,216 bytes.** The day added three screens (visit
summaries and their detail, the announcements section on Home), a
session-revoke control, an Emergency affordance that had been written and never
rendered, four catalogue blocks in two languages and six test sweeps, and cost
**16,054 bytes** — about 16 KB for a day's features, which is the rate the
paragraphs above describe and the reason the ceiling is watched rather than
trusted. Headroom is now **149,784 bytes, about 4.7%**.

Worth separating: **the six sweeps cost nothing**, because a test is not in the
bundle. Everything in that 16 KB is code a patient runs.

**2026-09-13, second pass: 3,050,216 → 3,060,777 bytes**, so the merged
defect branch cost **10,561 bytes**, about 10 KB. Most of it is catalogue
entries in two languages — the clinic's closures, the thread's closed state,
the booking note, and seventeen `capability.*` names that used to be English
strings in the service layer. That is the shape this document keeps
predicting: the strings are the table, and they scale with the number of
languages rather than the number of screens.

It leaves **4.4% of headroom**. The ceiling was set with "about 10%" and that
sentence is now two re-measurements out of date; the next change that needs
room should raise the ceiling deliberately, with the argument written here,
rather than discover it in a failing build.

The number is a ceiling, not a target, and the same rule the lint gate follows
applies: **it should only ever go down.** Raising it is a decision with a reason,
written in the pull request that raises it.

That rule and the 4.7% above are in tension, and it is worth saying so rather
than leaving it to be discovered: at 15 KB a day the ceiling is about ten
working days away, and the honest options when it arrives are to spend the
headroom deliberately or to raise the ceiling with an argument — not to
discover it in a red CI run. Whoever spends the next 100 KB should say which.

### Raised to 3.40 MB (2026-11-22)

This is the deliberate raise the paragraphs above asked for, with the
measurements. Both bundles were built on the same machine with `expo export
--platform android`:

| Tree | Bundle | Against 3,200,000 |
|---|---|---|
| `main` at `db1db742` | **3,193,622 bytes** | 6,378 bytes of headroom (0.2%) |
| The session-restore and checklist branch | **3,216,658 bytes** (CI measured 3,216,521) | 16,658 bytes over |

The branch costs **23,036 bytes** and adds **no dependency**. It is about ten
features' worth of code: the session-unconfirmed screen and its stack, the
refresh-outcome rules, keychain-failure handling, the reset-link parser, the
unlinked-account state, the auth-error mapping, and their catalogue entries in
two languages. That is the rate this section has recorded all along (about 60 KB
for eleven features). `main` had already spent the headroom down to 0.2%, so the
ceiling was going to be reached by whichever feature landed next.

**The choice is to raise it, not to spend features to stay under it.** The
guard exists to catch a substantial library arriving unnoticed, and a 22 KB
increase spread across ten features with no new package is not that. The new
ceiling, 3,400,000 bytes, leaves **183,342 bytes (5.7%)** above today's figure.
That is the same margin this section accepted on 2026-09-12 (5.2%). It is tight
enough that a date library with its locale data, or an i18n runtime, still
fails the build. The rule above is unchanged: the number should only go down,
and the next raise needs its own argument here.

### What the size means

Hermes bytecode is what ships inside the app, so this number is the closest
proxy available for "how much JavaScript does a patient download and parse".
It is **not** the download size on a store listing — that includes native code,
assets and per-architecture splits, and it is measurable only from a real build
(⛔ W-03).

### The check gates CI since 2026-09-09

It did not before, and the paragraph here used to explain why and name the fix
rather than make it. `.github/workflows/ci.yml` runs the patient-app job as
Typecheck → Lint → Test → **Build**; the budget check lives in the test suite,
so it ran *before* the build that produces the thing it measures, found no
`dist/`, and **skipped loudly**. The consequence was worth stating plainly: a
P0 budget was enforced only on whichever machine happened to run `build` then
`test` in that order, which is a gate nobody is holding.

The job now has a fifth step, `Bundle budget`, which re-runs that one file
after Build. Re-running rather than reordering: Test has to stay before Build,
so that a failing suite does not pay for a two-minute bundle first, and the one
file costs under a second.

**A skip is only honest when nobody was promised a measurement.** In the main
pass there is legitimately nothing to read; in the new step there is supposed
to be a bundle, and a guard answering "skipped" to a build that produced
nothing would be a green tick over an unmeasured budget. The step therefore
sets `PATIENT_APP_BUNDLE_REQUIRED=1`, which turns that absence into a failure.
Unset — every local run, and the main CI pass — the behaviour is exactly as it
was.

The main suite still reports three skips when run from a clean tree, and that
is still correct. It is the fifth step, not the third, that has teeth.

---

## 2. Cold start — ⛔ BLOCKED, needs a device

**Budget: to be set on the reference device**, not guessed here.

The method, so it is not re-derived:

1. Build a release profile (⛔ W-03 — signing).
2. On the reference low-end Android device, `adb shell am start -W` against the
   launcher activity, ten runs, discard the first (cold caches), take the median
   of `TotalTime`.
3. Record the number here, then set the budget above it with headroom.

Two things this app already does that a cold-start measurement will reflect, and
which should not be "optimised" away without reading why they exist:

- **The session restore is a network call.** `SessionProvider` refreshes on boot
  so a returning patient does not see a login flash (D-05). That costs a round
  trip on every cold start, and removing it would trade a real guarantee for a
  number.
- **Emergency content is bundled, not fetched** (N-01). It is part of the reason
  the bundle is the size it is, and it is the one thing that must render with no
  network at all.

## 3. List scroll — the lists window; the **number** is ⛔ BLOCKED

**Budget: 60 fps sustained on the reference device**, verified with the Perfetto
/ `dumpsys gfxinfo` frame timings — not by eye, which cannot tell 60 from 45.
That measurement still needs a device and a release build (⛔ W-03), so this
section still has no number in it.

What it no longer has is the defect it was waiting to measure.

The lists worth measuring, in order of how long they can get: notifications, the
appointment list, doctor search results.

### The condition this section named has fired

The paragraph here used to read:

> "**the doctor list renders a page of twenty and has no windowing**
> (`DiscoverScreen` maps over `data.items`). Twenty cards is well within what a
> `View` can handle, so this is not a defect today — but it is the first thing
> that will matter if G-02's paging control lands and the list grows."

G-02 landed on 2026-09-07, and I-01 and O-01 followed. All three of the lists
above now have a "Show more" that accumulates pages, and all three were still
`data.items.map(…)` inside `Screen` — a `ScrollView`, which mounts every child
it is given and keeps it mounted. A patient with two years of appointments could
tap until every card was mounted at once, and the notification feed is the
longest list in the app.

So the windowing is here rather than waiting for the device. `PagedList`
(`src/components/layout/PagedList.tsx`) is a `FlatList` that carries the paging
decisions the three screens already shared, and the three screens are its
callers — `NotificationsScreen`, `AppointmentsScreen`, and `DoctorResults`,
which serves both Discover and Department. Its numbers:

| Prop | Value | Why |
|---|---|---|
| `initialNumToRender` | **20** | One server page. Every paginated route in the contract returns twenty rows, and a patient who asked for a page should be able to scroll it without cells blanking. The memory this bounds is pages two onward |
| `windowSize` | **5** | Viewports, not rows: roughly two screens of rows either side of the visible one stay mounted. The default is 21, which is most of a long list |
| `maxToRenderPerBatch` | **10** | Half a page per frame batch, so scrolling fast does not block the JS thread on a burst of card renders |
| `onEndReached` | **absent, deliberately** | The list pages on a button. A list that fetches because a thumb moved spends a patient's data without asking, and has no end a screen-reader user can reach |

Three things this does **not** claim. It is not a measurement: whether the
result holds 60 fps on the reference device is still the open question above.
It does not change what a patient sees — the header content scrolls with the
rows as the list's header, and the four states, the "Show more" and the "that
is all" are the same components in the same order. And it is not a licence to
stop caring about row cost: `NotificationRow` is memoised and takes stable
callbacks precisely because a windowed list re-renders its visible cells
whenever the screen's state moves.

`src/test/list-virtualisation.test.ts` is what keeps it true. The regression
here is not a failing assertion, it is a *new* screen written in the old shape,
and no render test can see a list that would one day be long — so it reads the
source and fails on a paged result rendered with `.map`, on a paging screen that
is not on the windowed container, and on a `PagedList` nested inside a scrolling
`Screen`. `src/components/paged-list.test.tsx` pins the four numbers above.

One list is deliberately exempt and the test records why: the booking flow's
doctor step renders one page and offers no control that asks for another, so it
cannot grow.

---

## 4. What is not budgeted, and why

| Not budgeted | Why |
|---|---|
| Memory | No leak-prone surface yet — PHI is swept on a timer (T-11) and there is no image cache |
| Network volume | The client makes one request per screen; the server owns pagination |
| Battery | No background work, no location, no push |
| Time to interactive | Needs the same device as §2, and the same measurement run |

---

## 5. When this document must be revisited

| Change | Effect |
|---|---|
| Any new runtime dependency | §1 — the budget is the check that notices |
| A device becomes available | §2 and §3 stop being blocked |
| G-02 paging, or any long list | §3 — **this fired.** G-02, I-01 and O-01 all paged; §3 records what was done and what is still blocked |
| Images or documents on screen (P-04, BE-15) | Adds a memory budget to §4 |

---

*One budget measured and enforced; two named with their method and blocked on a
device — one of which no longer has a known defect waiting underneath it.
Numbers here were measured, not estimated.*
