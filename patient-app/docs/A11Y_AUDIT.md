# Accessibility audit — Medora Patient App

**Checklist row:** S-09 · **Date:** 2026-09-07, with findings added 2026-09-08 and 2026-09-12 · **Tree:** `patient-app/` at `patient-app` + the S-08 branch
**Depends on:** S-01…S-08
**Status:** **Complete for everything that can be checked without a device.** Three checks need a phone and are named in §6 with the row that blocks them.

---

## 0. What this is, and what it is not

This is the pre-release sweep S-09 asks for: every row of Phase S walked
against the code, with each finding either **fixed** or **triaged to a named
row**. It is not a substitute for a VoiceOver and TalkBack walkthrough on
hardware — §6 says exactly which claims are still waiting on one, rather than
letting them pass unremarked.

Two rules were followed while writing it.

**Nothing is recorded as verified because it looks verified.** Every ✅ below
either points at an executing test or names the scan that produced it. Where
the evidence is a judgement rather than a measurement, it says so.

**Findings are listed even where they were fixed in the same pass.** A clean
audit with no findings usually means the audit was not run. Four defects came
out of this one, and they are the most useful part of the document. Two more
have been added since, each by the work that walked past them.

---

## 1. Method

| Kind of check | How |
|---|---|
| Touch targets | Read every interactive primitive for `minHeight`/`minWidth` against `theme.minTouchTarget` |
| Labels and roles | Scanned every `Pressable`/`Touchable` for `pressableA11y` or an explicit label; scanned every screen for a heading |
| Contrast | Computed WCAG relative-luminance ratios for both palettes from `theme/tokens.ts` |
| Dynamic type | Read the scale function and its ceiling; checked `allowFontScaling` handling |
| Focus order | `components/form/form-focus.test.tsx` |
| Reduced motion | `accessibility/useReducedMotion.ts` and its callers |
| Live regions | Scanned for `accessibilityLiveRegion` and `announce()` |
| RTL | `accessibility/rtl.test.tsx`, including three source scans |

Everything above runs in the suite except the contrast computation, which is
reproduced in `theme/theme.test.tsx` as thresholds rather than as printed
numbers; §4 records the numbers.

---

## 2. Findings

Seven. All seven are fixed; none was triaged away. F-1 to F-4 came out of the
2026-09-07 sweep; **F-5 came out of reading the same file again a day later**
for the C-09 migration, **F-6 out of work that was not an accessibility pass at
all**, and **F-7 out of asking what an existing guard actually proves** — which
is the honest argument for re-reading rather than for trusting a completed
audit.

### F-1 — Seven disclosure chevrons pointed the wrong way in Arabic · **fixed** (S-08)

`ListItem`, `Section`, `WelcomeScreen`, `DoctorCard`, `DiscoverScreen`,
`HomeScreen` and `AppointmentCard` hard-coded `chevronRight` for a chevron
that means **forward**. Forward is left in a right-to-left layout, so in
Arabic every one of them pointed back — the mirrored-icon error S-08 names,
seven times.

Fixed by giving `Icon` semantic `forward`/`back` names resolved from
`I18nManager.isRTL`, and by a source scan that fails the build on a bare
`chevronRight` outside `Icon.tsx`.

### F-2 — An inset divider did not flip · **fixed** (S-08)

`Divider` used `marginLeft`. An inset rule is indented from where the row's
content *begins*, which in Arabic is the right edge, so the rule would have
floated away from the content it belongs to. Now `marginStart`, with a scan
forbidding physical margins anywhere in the tree.

### F-3 — `ThreadScreen` had no heading · **fixed** (this pass)

Twenty-six of twenty-seven screens carry a `headingA11y` element. The thread
screen did not, so a screen-reader rotor had nothing to jump to and the only
thing naming the screen was the navigator's generic "Conversation" — which
does not say *whose* thread it is. It now opens with the clinician's name,
the same fact a sighted user reads off the bubbles.

### F-4 — The unread tab badge was announced to nobody · **fixed** (O-02)

`tabBarBadge` is not read by either VoiceOver or TalkBack. A count that
exists only as a badge does not exist for a screen-reader user. The count is
now carried in the tab's accessibility label, and it says the real number
even where the badge says `99+` — the cap exists because of tab width, and a
screen reader has none.

### F-5 — The loading state announced nothing · **fixed** (S-02, S-07)

`Skeleton.tsx`'s own docblock said the container "announces *Loading* once via
`LoadingState`". There was no `LoadingState` in the tree and `SkeletonList`
carried no label, so every list screen's loading state was six `Skeleton`
views each individually `accessibilityElementsHidden` — that is, **silence**.
A screen-reader user got nothing at all between tapping a tab and the data
arriving, which reads as a screen that did not respond.

Found while migrating the feedback primitives onto the catalogue (C-09): the
missing string was the reason there was no key to migrate. `SkeletonList` is
now one `accessible` element labelled from `a11y.loading`, which is the
sentence the docblock had been describing.

The general lesson is the one F-3 taught in a different shape: **a docblock
describing behaviour is not the behaviour**, and this one had been read past
by the audit that produced F-1 to F-4.

### F-6 — Paging announced nothing · **fixed** (S-07, W-08)

Found while windowing the three growing lists. Pressing **Show more** moves no
focus and reads nothing: twenty rows appear *above* the button, and the only
feedback a sighted user gets — the button's spinner, then more rows — has no
audible counterpart. A screen-reader user pressed a control and, as far as the
screen reader was concerned, nothing happened.

`api/paged.ts` had described `loadedPages` as *"the count a live region
announces"* since it was extracted. Nothing announced it. This is F-5's lesson
for the third time — **a docblock describing behaviour is not the behaviour** —
and it is why the fix lives in the one component all three lists now share
rather than in three screens: `PagedList` announces, politely and once per page,
either the new count (`a11y.pageLoaded`) or the list's own "that is all" when
the page that arrived was the last, because that case also takes the button
away. The first page is silent — it arrives with the screen and is read anyway —
and so are a pull-to-refresh and a segment switch, neither of which brings a
page in. `components/paged-list.test.tsx` holds all five cases.

### F-7 — Four screens had a heading only after their data arrived · **fixed** (S-02)

F-3 found the one screen of 27 with no heading and closed it with a guard in
`src/test/a11y-audit.test.ts`: a **source scan** that fails any screen file not
mentioning `headingA11y`. That is a weaker claim than it reads as, and four
screens were exploiting the gap without anyone choosing to.

`AppointmentDetailScreen`, `DoctorProfileScreen`, `ThreadScreen` and
`VisitDetailScreen` each put their *only* heading **inside** an
`AsyncBoundary`, keyed off the loaded record — the appointment's date, the
doctor's name, the clinician's name, the visit's title. The file mentions
`headingA11y`, so the scan passed; but a screen reader landing on any of the
four while the query was running, or after it failed, or on an empty result,
found no heading at all. That is F-3's defect in the state a patient on a slow
connection meets **first**, and on `ThreadScreen` in a state a patient reaches
on purpose: a conversation with no messages yet renders an empty state and
nothing named the screen.

The heading now renders on every path. Three of them hoist it out of the
boundary and fall back to the screen's own name until there is a record to name
it; `DoctorProfileScreen` keeps its heading in the avatar block — moving it
would change the screen a patient sees — and renders a separate fallback while
there is nothing to name.

`src/test/screen-headings.test.tsx` is the guard, and it is a **render** rather
than a scan: it mounts all 26 screens and asserts, *without flushing*, that
something carries `accessibilityRole="header"`. The first commit is the loading
state, so no stubbing is needed to reach it. It was watched to fail on exactly
those four.

The general lesson is F-5's and F-6's a third time, one level up: **a guard is
only as strong as the thing it actually inspects.** A scan that asks whether a
file mentions a helper cannot answer whether a patient hears one.

---

## 3. Phase S, row by row

| Row | Claim | Verdict | Evidence |
|---|---|---|---|
| **S-01** | Touch targets ≥ 44×44 pt | ✅ | `Button` takes `minHeight: max(size, theme.minTouchTarget)` and its smallest size is already 44. `ListItem`, `Input` and `Checkbox` set `minHeight: theme.minTouchTarget`. `Chip` is 32 tall and clears the floor through `hitSlop`; the whole `ListItem` row is the target, not the chevron |
| **S-02** | Labels and roles on every control | ✅ | Every `Pressable` in the tree either spreads `pressableA11y` — whose signature *requires* a label, so the type system asks the question a review would have to remember to — or is the `BottomSheet` scrim, which is deliberately `accessibilityElementsHidden`. All 27 screens carry a heading, **on every path** — F-3 was the file that had none, and F-7 the four that had one only after their data arrived; `screen-headings.test.tsx` renders all 26 mountable screens and asserts a header on the first commit, which is the loading state. All 44 `<Icon>` uses are decorative and sit beside a text label, which is why none passes `label`. `SkeletonList` is labelled too since F-5 — a loading state that is hidden from assistive technology in every one of its parts is a screen that says nothing while it waits. **Both halves of this row are render sweeps since 2026-09-13**, not only the heading one: `screen-headings.test.tsx` also walks all 26 screens for anything announcing itself as a control with neither a label nor any text, which is the case the `<Pressable>` scan cannot see — a `Card` with `onPress`, a `ListItem`, a computed label that arrived empty. It found none; the detector is exercised against trees built to be wrong, because a detector that reports zero because it is broken looks identical from outside to one that reports zero because the app is clean |
| **S-03** | Dynamic type without clipping | ⚠️ **structural only** | The scale reads `PixelRatio.getFontScale()` with a **1.6 ceiling**, and `Text` sets `allowFontScaling={false}` so the OS does not scale a second time on top. No component sets a fixed width on anything holding text (asserted in `rtl.test.tsx`). **Whether the largest size clips is a measurement and needs a device** — see §6 |
| **S-04** | Contrast ≥ WCAG AA in both themes | ✅ | Computed, not assumed. §4 has the numbers; `theme.test.tsx` fails the build below the thresholds |
| **S-05** | Focus order and keyboard navigation | ✅ | `useFieldChain` walks the form — Next on every field but the last, Done on the last, `submitBehavior: 'submit'` between them so the keyboard does not close and reopen. `form-focus.test.tsx` drives all six auth forms. Modal focus trapping is the platform's (`accessibilityViewIsModal`), deliberately not hand-rolled |
| **S-06** | Reduced motion honoured | ✅ | `useReducedMotion` reads `AccessibilityInfo.isReduceMotionEnabled` and holds an "unknown, so do not animate" state until it answers — the safe default, and the reason the test setup can leave the promise unresolved |
| **S-07** | Live-region announcements | ✅ | `announce()` on booking success and failure, and on every page a "Show more" brings in (F-6); `Toast` and the thread composer's failure line carry `accessibilityLiveRegion`. A screen-reader user gets what a sighted user gets from a toast — and now from a list that just grew |
| **S-08** | RTL verified in Arabic | 🟨 **half** | Mirrored icons fixed and guarded (F-1, F-2); overflow guarded structurally. C-09 landed on 2026-09-08, so the screens now have Arabic in them and `auth-i18n.test.tsx` / `shell-i18n.test.tsx` render them in it. What is left is **not translation**: whether a longer string overflows at the largest text size is a measurement, and it needs the device §6 names |

---

## 4. Contrast, measured

Computed from `theme/tokens.ts` with the WCAG 2.1 relative-luminance formula.
AA is 4.5:1 for body text and 3:1 for control boundaries (1.4.11).

| Pair | Light | Dark | Needs |
|---|---:|---:|---|
| `textPrimary` on `surface` | **17.85** | **15.63** | 4.5 |
| `textPrimary` on `background` | **16.77** | — | 4.5 |
| `textSecondary` on `surface` | — | **10.42** | 4.5 |
| `textTertiary` on `surface` | — | **6.38** | 4.5 |
| `textInverse` on `primary` | **7.97** | **9.04** | 4.5 |
| `error` on `errorSubtle` | **5.27** | — | 4.5 |
| `borderStrong` on `surface` | **3.44** | **3.40** | 3.0 |

Every pair passes. The two control-boundary ratios are the tightest in the
system at ~3.4 against a floor of 3.0, which is worth knowing before anyone
lightens a border: there is about 0.4 of headroom there and 13 points
elsewhere.

---

## 5. What the audit did **not** find

Recorded because absence of a finding is itself a result, and because a
future reader should know these were looked at rather than skipped.

- **No colour-only signalling.** Every `Badge` carries a text label, and
  `StatusBadge` adds an icon for the tones a patient must not misread. The
  unread state in the notification centre is carried by a dot, a tinted
  surface *and* a "New" badge, not by font weight — which is invisible at
  large accessibility sizes, where everything is already heavy.
- **No icon is the sole carrier of meaning.** All 44 are decorative and sit
  beside text. `Icon` supports a `label` for the case where one is not, and
  nothing currently needs it.
- **No unlabelled emergency control.** The header affordance is an icon *and*
  the word "Emergency", in error tone — an icon-only emergency control is one
  a patient has to have learned before the emergency.
- **No swipe-to-dismiss on notifications.** A swipe is a gesture a phone
  performs in a pocket, and it is also the gesture a screen-reader user
  cannot easily produce.

---

## 6. What still needs a device, and what blocks it

Four claims cannot be settled here. Each is named with the row that would
unblock it rather than being quietly counted as passed. The fourth is not a
measurement — it was a decision; the owner made the translation half of it on
2026-11-23, and the clinical sign-off half is still not given. A fifth row
records the digit decision made with it.

| Check | Blocked by | Why it cannot be done here |
|---|---|---|
| VoiceOver / TalkBack walkthrough of the P0 flows | **B-07**, **W-03** | Needs a build on hardware. Jest asserts that labels and roles *exist*; only a screen reader shows whether the resulting narration is usable |
| Largest dynamic-type size on every P0 screen | **B-07** | Clipping is a layout measurement. The ceiling, the scale and the absence of fixed widths are asserted; the pixels are not |
| RTL laid out in Arabic | **B-07** | The layout direction is asserted and, since C-09 landed on 2026-09-08, the content is genuinely Arabic — the two suites above render it. Overflow at the largest text size is still a measurement on hardware, not a test |
| Whether the **Emergency affordance** is translated | **W-10** (clinical sign-off) | **Translation approved by the owner on 2026-11-23** — all application-controlled copy, including the Emergency affordances, the emergency guidance, urgent-help lines, AI disclaimers and the clinical vocabulary (lab flags, allergy severity, medication and prescription status, history kinds). It is now in the catalogue in both languages (`emergency.*` and the namespaces listed in `i18n.test.tsx`), and `auth-i18n.test.tsx`, `shell-i18n.test.tsx` and the emergency suites pin the Arabic in Arabic and the unchanged English in English. **The W-10 clinical and legal sign-off is still not given**: the Arabic emergency and clinical wording is an engineering draft awaiting the named clinical reviewer (`docs/SIGNOFF.md`). What stays open is that review, not the translation |
| Interpolated numbers in Arabic | — (decision recorded 2026-11-23) | **Western digits (0-9).** A count, a step or a phone number interpolated into an Arabic sentence is written with Western digits, and phone numbers are bidi-isolated (LRI…PDI) so they read left-to-right. This matches what `Intl` produces for `ar` in current CLDR, which is what every date on screen already uses (`useDateFormat`), so a screen does not mix two digit systems. Some static Arabic sentences written earlier spell a digit in Arabic-Indic form (`٦` in "the 6-digit code"); that is copy, not formatting. Whether a device's ICU agrees with CLDR for `ar` is part of the B-07 device check |

None of the four is a defect. Three are unverified claims and one is an open
decision, and the difference from a defect matters: this document does not
assert them.

---

## 7. Sign-off

| | |
|---|---|
| **Audit performed** | 2026-09-07, against `patient-app` + S-08; F-5 added 2026-09-08 |
| **Findings** | 5, all fixed |
| **Open, triaged** | S-08's remaining half is a device measurement, not a translation (C-09 closed 2026-09-08); the Emergency affordance's language — translation approved 2026-11-23, clinical review of the Arabic → W-10; three device checks → B-07 / W-03 |
| **Owner sign-off** | ⛔ **not given.** W-10 is the row that carries it, and it also covers the emergency copy and the AI disclaimers |

**No build ships to a store on this document alone.** It records the state of
the code; W-10 records a person's name against it.

---

*Re-run this before each release. The four findings above were all invisible
to the suite until someone went looking, which is the argument for the row.*
