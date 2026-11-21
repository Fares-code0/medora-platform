# ADR-0001 — Token revaluation: clinical legibility over marketing aesthetics

- **Status:** Accepted (Wave 1a applied) · colour palette and elevation rule
  superseded by [ADR-0005](0005-emr-visual-language.md)
- **Date:** 2026-08-19
- **Scope:** `frontend/src/styles/tokens.css`, `frontend/tailwind.config.ts`
- **Supersedes:** the colour, elevation and radius values in `DESIGN_SYSTEM.md` §12.1
- **Related:** `FRONTEND_CHECKLIST.md` (Waves 1b–1c, 2)

## Context

The interface read as generic and low-contrast, and was tiring over long
sessions. The initial diagnosis was architectural — bypassed tokens,
hardcoded utility classes, pages that fetch and render. An audit found the
opposite: **zero** hardcoded Tailwind palette classes across 589 source
files, 58 primitives with near-total adoption, and no `useQuery` in any
`.tsx`. The architecture was not the problem.

The problem was in the token **values**, and it had one cause.

### Every brand colour was an unmodified Tailwind default

| Token | Value | Is exactly |
| --- | --- | --- |
| `--color-primary` | `#2563eb` | `blue-600` |
| `--color-secondary` | `#0d9488` | `teal-600` |
| `--color-accent` | `#7c3aed` | `violet-600` |
| `--color-success` | `#16a34a` | `green-600` |
| `--color-warning` | `#d97706` | `amber-600` |
| `--color-error` | `#dc2626` | `red-600` |
| `--color-info` | `#0284c7` | `sky-600` |
| neutrals | — | stock `slate` ramp |

No palette decision had been made; the defaults had been adopted. Saturation
ran 83–100%. `--color-accent` was the violet that reads as "AI interface" on
sight. Primary (hue 221) and info (hue 199) were 22° apart — two blues
competing for the same interactive meaning.

Three further findings shaped the change:

1. **`--color-text-tertiary` was the most-used text colour in the app** —
   345 sites against `text-primary`'s 246 — at 4.55:1, three points above
   the AA floor. Most of the app's text was rendered in its faintest colour.
2. **Ten shadow values** made every surface float. Dark mode had already
   abandoned this, overriding four of them to lead with
   `0 0 0 1px var(--color-border)`; the decision was half-made in the code.
3. **Seven radius values**, with four mid-range steps (6/8/12/16px) carrying
   228 uses under no discernible rule.

## Decision

### 1. An intentional palette, ~40% less saturated

One desaturated slate-blue primary (`#2c5282`, 49% saturation). Saturated
colour is reserved for clinical semantics: red critical, amber warning,
green normal, blue informational. Everything else is neutral.

Slate-blue rather than deep teal, because teal collides with green=normal
in the clinical set.

Each semantic base is now dark enough to serve as **body text** (≥4.5:1 on
surface *and* on its own `-subtle` background). The old `-text` duplicates
existed only because the bases were too light to read; they survive as
aliases and are deleted in Wave 1b.

### 2. Elevation is a border, not a shadow

Ten shadow values become three:

| Token | Role |
| --- | --- |
| `--shadow-md` → popover | transient overlays only |
| `--shadow-lg` → modal | modals and drawers only |
| `--shadow-focus` | **not elevation** — the keyboard focus indicator, retained |

`--shadow-xs` and `--shadow-sm` are revalued to
`0 0 0 1px var(--color-border)`. All 40 card and panel sites became bordered
with no component edits.

**This decision has a hard dependency.** At the old `--color-border`
(`#e2e8f0`, 1.23:1 against surface) the border was effectively invisible;
removing shadows first would have dissolved every card into the page. The
border is darkened to `#d3dae3` in the same change. It is now load-bearing —
it *is* the edge of every surface. Do not lighten it.

### 3. Three radii

4px controls, 8px surfaces, pill. `--radius-lg/xl/2xl` collapse onto 8px,
correcting 251 sites at once.

### 4. Two new type steps

`--text-metric` (20px/26px) for large numerals, and `--text-micro`
(10px/14px) as the dense-data floor for chart axis ticks. These are the two
rungs the scale was missing, which is why 13 `text-[Npx]` one-offs had
escaped it.

`--text-metric` is 20px rather than snapping to `h1`: 24px numerals are too
loud in a dense clinical layout and overflow the PieChart centre label.

**Nothing a clinician must read may use `--text-micro`.**

### 5. Text roles — a usage rule, not a value

Darkening tertiary treats the symptom. The disease is that tertiary is used
more than primary. The rule:

> **Primary** is what the reader came to find — names, doses, readings,
> results, statuses, table cell values, **and every identifier they match
> character by character** (MRN, patient ID, licence number, ICD code,
> appointment reference). **Secondary** is supporting copy they read
> deliberately once they have found it — descriptions, helper text, empty
> states, policy notes, descriptive attributes like a department or job
> title. **Tertiary is glanceable metadata only** — timestamps, units, axis
> labels, counts, icon tints. If a clinician would ever read it character by
> character, it is not tertiary.
>
> **Within a data cell, hierarchy is carried by size and weight, never by
> fading the colour.** Fading is reserved for metadata.

*(Rule corrected in Wave 1d: it originally placed identifiers in
**secondary**, which contradicted the card-list reference this same ADR
names as correct — the card list renders MRN at `text-primary`. Identifiers
are primary. See §10.)*

Healthy ratio is roughly 2:1 primary over tertiary. Today it is inverted at
0.71:1.

### 6. AI provenance is a safety requirement, not decoration

`--color-accent` is **retained** against the general reduction. In a medical
system, distinguishing AI-generated content from clinician-entered content
is a provenance requirement that the AI Safety Review panel depends on; a
neutral AI layer would erase that signal.

It moves off `#7c3aed` to `#7d4f86` — a desaturated plum (26% vs 83%
saturation) sitting **≥73° from primary and from all four clinical
semantics**, so it cannot be misread as a status colour.

Because colour must not be the sole carrier of meaning (WCAG 1.4.1), the
accent is paired with a structural marker: a left rule plus an explicit
"AI-generated" label on AI surfaces. *Treatment proposed; not yet built.*

### 7. One palette, one meaning per column

Reducing the palette exposed a collision the old high-saturation values had
masked. `StatusBadge` offers six variants for fourteen status kinds, and the
appointments worklist spent them twice — once on Status and again on
Priority, in adjacent columns:

| Status | Priority | Shared colour |
| --- | --- | --- |
| Confirmed | Normal | green |
| Pending | High | amber |
| Cancelled | Urgent | red |
| Completed | Low | neutral |

A row reading "Confirmed · Normal" showed the same green twice, and a reader
could not tell which column a colour belonged to. Separately, `rescheduled`
was mapped to `awaiting`, painting it the same amber as Pending — though
Pending needs a decision and Rescheduled is already handled.

Resolved feature-locally, without touching the platform-wide map:

- **`rescheduled` → `scheduled`** (blue). A rescheduled appointment is not
  waiting on anyone.
- **Priority marks only the exceptional.** Normal and Low — most rows — are
  quiet tertiary text. Colour in that column now always means "out of the
  ordinary".
- **Priority uses an icon on bare ground, not a filled pill.** Urgent and
  High still share red and amber with the status vocabulary, because both
  columns genuinely mean "needs attention" and inventing hues for priority
  would undo the reduction. Form carries what hue cannot — and it takes
  priority off colour alone (WCAG 1.4.1).

**Rule:** within one row, a hue may carry only one meaning. Where two
columns must share a hue, they must differ in form.

### 8. Wave 1a.1 — the double edge (Set A)

Revaluing `--shadow-xs` / `--shadow-sm` to `0 0 0 1px var(--color-border)`
assumed those sites had no border of their own. **Twenty-nine of the
thirty-eight did**, so they rendered the token border *and* a same-coloured
1px ring — a ~2px edge where the design specifies a 1px hairline, on
`ui/Card` and `admin/primitives`'s Panel among others, i.e. most surfaces in
the app. That is the "surfaces read too heavy" complaint this ADR exists to
fix, reintroduced by its own mechanism.

The redundant `shadow-xs` / `shadow-sm` class was removed from all 29. It is
a class deletion only — no token changed, and the sites keep the exact
border they already declared:

| Area | Sites |
| --- | --- |
| Shared primitives | `components/ui/Card.tsx:81`, `components/patterns/MetricStrip.tsx:45`, `components/feedback/EmptyState.tsx:54` |
| Admin primitives | `features/admin/components/primitives.tsx:111` (Panel), `:151` (MetricTile) |
| Admin screens | `doctors/DoctorDocumentsTab.tsx:160`, `doctors/DoctorProfilePage.tsx:458`, `patients/PatientProfilePage.tsx:387`, `sections/AnnouncementsSection.tsx:170`, `sections/DepartmentsSection.tsx:121`, `sections/HolidaysSection.tsx:114`, `sections/PoliciesSection.tsx:114`, `sections/ResourcesSection.tsx:204`, `sections/RoomsSection.tsx:119` & `:139`, `sections/StaffSection.tsx:271`, `sections/TemplatesSection.tsx:97`, `sections/WaitingRoomSection.tsx:130` |
| Doctor screens | `appointments/components/calendar/CalendarAppointmentCard.tsx:58`, `dashboard/pages/OverviewPage.tsx:69`, `messaging/pages/MessagesPage.tsx:153`, `reports/components/InsightsPanel.tsx:30` & `:60`, `reports/components/SavedReportsRail.tsx:125`, `reports/components/ScheduledReportsPanel.tsx:60`, `settings/components/ProfileCompletionWidget.tsx:22`, `settings/components/SettingsCard.tsx:37`, `settings/pages/SettingsPage.tsx:131`, `settings/sections/SecuritySection.tsx:77` |

Computed-style proof after the change (light theme, `border-top-width` +
any 0-offset ring spread):

| Surface | Border | Ring | Total edge | Colour |
| --- | --- | --- | --- | --- |
| `ui/Card` | 0.8px | **0** | **0.8px** | `rgb(211,218,227)` = `--color-border` |
| admin `Panel` | 0.8px | **0** | **0.8px** | same |
| admin `MetricTile` | 0.8px | **0** | **0.8px** | same |
| `DataGrid` surface (StaffSection) | 0.8px | **0** | **0.8px** | same |

(0.8px is the device-pixel rounding of a 1px border at this DPR, not a
sub-pixel border in the source.)

**This wave also disproved the assumption that Wave 1b is entirely
zero-diff.** 1a.1 is 1b's visible slice, extracted and shipped separately;
what remains of 1b genuinely is zero-diff.

### 9. Wave 1c — the chart ramp

**A chart series must never borrow a clinical colour by accident.**
`ORDERED_TONES` sequenced all seven semantic tones, so auto-assignment made
the second category success-green, the fourth warning-amber and the seventh
error-red. Measured on the live Reports page before the change:

| Slice | Token | Rendered | The claim it made |
| --- | --- | --- | --- |
| Cardiology | `fill-primary` | `#2c5282` | — |
| Internal Medicine | `fill-success` | `#136c35` | "healthy" |
| **Paediatrics** | **`fill-accent`** | `#7d4f86` | **"AI-generated"** |
| Orthopedics | `fill-warning` | `#8a5600` | "needs attention" |
| Neurology | `fill-info` | `#0c6291` | — |

Paediatrics wearing the AI-provenance accent (§6) is the sharpest case: two
independent meanings collided on one slice.

**The ramp.** Five categorical slots, hue alternating blue (≈209–213) and
indigo (≈246–250), laddered by luminance at a constant **1.58×** so adjacent
series separate in greyscale and under every colour-vision deficiency, not
by hue alone. It sits ≥40° from every alarm hue and from the accent;
proximity to `primary`/`info` is deliberate — those are brand and
informational, not alarms.

| Slot | Light | Edge | Dark | Edge |
| --- | --- | --- | --- | --- |
| chart-1 | `#264a77` | `#0e233e` | `#cedef1` | `#8cadd4` |
| chart-2 | `#6a5caf` | `#44358f` | `#b2aada` | `#877eb6` |
| chart-3 | `#578dc1` | `#2a659c` | `#538fc7` | `#9dbad5` |
| chart-4 | `#afaad3` | `#8078ca` | `#685fb5` | `#908bbb` |
| chart-5 | `#caddea` | `#4e96ca` | `#27506d` | `#467495` |

Verified: every adjacent pair ≥1.5 and every non-adjacent pair ≥1.3; slots
1–3 clear 3:1 against the surface unaided; **slots 4 and 5 are deliberately
pale (2.21:1 and 1.40:1 light) and are carried by their edge** (3.85:1 and
3.21:1) — the tradeoff approved on the stated condition that the stroke
exists. In dark the edge direction flips per slot: slots 1–2 are already
near-white so their edge goes *darker*, slots 3–5 go *lighter*. In both
cases the edge moves toward more contrast against the surface.

**The premise was restored first.** The approval assumed `TONE_CLASSES`
already carried that stroke; it existed on `LineAreaChart` only. All four
remaining chart types now draw it — `BarChart` and `PieChart` as an SVG
stroke, `DistributionBars` and `ChartLegend` as an inset/outset ring, since
those are CSS marks whose width encodes the value. `PieChart`'s outline was
`stroke-surface`, a white separator that carved slices apart but did nothing
for a pale fill.

**`stroke` and `edge` are separate roles**, found when the two disagreed:

- `stroke` is **the line** in a line/area chart, drawn in the tone's own
  colour. For chart slots it resolves to the darker edge, because a 1.40:1
  line would be invisible.
- `edge` is **the outline of a solid mark**. Chart slots → the darker
  same-hue edge (load-bearing). Semantic tones → `stroke-surface`, the
  neighbour separator, since they have no darker variant and clear 4.5:1
  unaided.

Conflating them made semantic pie slices stroke themselves, silently losing
the separator between neighbours.

**Semantics are preserved where colour IS the message.** Lab status keeps
green / blue / amber / red / teal, satisfaction keeps its good→bad scale,
and Completed-vs-Cancelled keeps red for cancelled. Migrated to the ramp:
specialty mix, weekday, age distribution, drug class, messages, AI usage,
records, doctor volume, rating distribution, platform activity, and the
executive trend — where Revenue had been success-green regardless of which
way the line pointed.

**`KpiDatum`, `Insight` and `CategoryMeta` were narrowed to `SemanticTone`**,
so a chart slot cannot leak into a KPI chip and a KPI colour cannot be
chosen by list position. That is now a compile error rather than a
convention.

**Eight tests lock the invariant** (`palette.test.ts`) — asserted on meaning,
not hex values, so they survive a re-tone: auto-assignment never reaches a
reserved tone at any index (past the modulo wrap); chart slots always carry a
`-edge` outline; semantic tones always carry the separator; `stroke` stays
distinct from `edge`; no chart slot references a semantic token.

**Cost:** five categorical slots is the ceiling. A sixth category wraps and
repeats, which is a signal to group the data, not to add a hue — adding one
would mean re-entering the space the alarm colours occupy.

### 10. Wave 1d — text-role reclassification

**The count was wrong, and the first classifier was the reason.** Wave 1a
reported 157 mis-roled sites (134 body copy + 23 primary data) from a
line-based classifier. Re-auditing structurally — parsing each JSX element
and reading what it actually *renders* — puts the genuinely mis-roled count
at **88**. The gap is not sites that were fixed quietly; it is sites the
first pass mislabelled. Reported as a correction, not a silent adjustment.

The structural re-audit of all 344 sites:

| Role | Sites | Verdict |
| --- | --- | --- |
| Icon tint / icon button | 31 | correct — decorative |
| Field caption / overline | 25 | correct — **sampled 25/25 genuine** |
| Timestamp / duration | 66 | correct as timestamps |
| Static literal prose | 67 | sentences → **secondary**; single words stay |
| Renders an expression | 150 | mixed — identifiers → **primary**, prose props → secondary, labels/counts stay |

**Sampling gate (Amendment 2).** The "correct metadata" bucket holds up:
captions 25/25 genuine, timestamps correct as timestamps. One real finding
though — **~30% of timestamp lines bundle a data value into the same
tertiary span** (`{document.filename} · uploaded {date}`,
`{role} · {requestedAt}`). Those need the span split, not the line
reclassified; logged as DEBT-1d-01 rather than fixed by halves.

**What moved:**

| Group | Sites | Change |
| --- | --- | --- |
| Shared primitives — `Field` helper, `Radio`/`Checkbox`/`Switch` description, `Card` subtitle, admin `Panel` description/hint, `DataGrid` empty | 9 | → secondary. Smallest edit count, widest reach. |
| **Identifiers** — patient ID, MRN (×5 surfaces), licence number, appointment reference (×2), log target, ICD-10 code (×2) | 13 | → **primary** |
| Descriptive attributes — department, job title, audit actor/target | 4 | → secondary |
| Prose sentences in markup | 50 | → secondary |
| Prose arriving through a **prop** | 13 | → secondary |

**Two classifier failures worth recording**, both instances of the Set B
lesson:

1. Word-counting the markup missed prose delivered through props —
   `{option.description}` is one token in the JSX and a sentence on screen.
   Thirteen sites, including every Settings row, were invisible to the first
   pass. Fixed by classifying on what the prop *means*, not what the markup
   contains.
2. Word-counting also produced false positives where the "words" were a data
   readout (`{gb} GB of {total} GB used`) or a structural container. Fifteen
   were hand-vetted out of the automated pass and left tertiary.

**The ratio moved but did not reach 2:1** — exactly the caveat raised when
the rule was written:

| | Before | After |
| --- | --- | --- |
| `text-primary` | 243 | **256** |
| `text-secondary` | 164 | **240** |
| `text-tertiary` | 346 | **258** |
| primary : tertiary | 0.70 : 1 | **0.99 : 1** |

The remaining 258 are, by structural audit, genuine metadata: 31 icon tints,
25 captions, 65 timestamps, 27 short labels, and ~103 label/count/unit
expressions. **2:1 was a heuristic; composition is the real test, and the
composition is now correct.** Pushing to 2:1 from here would mean promoting
genuine metadata, which is the opposite of the goal.

**Enforced structurally** (`styles/text-roles.test.ts`): no patient or
clinical identifier may render in `text-tertiary` — asserted by parsing every
`.tsx`, not by a file allowlist, so it fails when a *new* identifier is
introduced faint. That is how the original mis-roling accumulated.

### 11. Wave 1b — mechanical cleanup, zero visual diff

The aliases Wave 1a created so that 1b could delete them are gone, and the
scales are named for **role instead of size**. `--radius-lg` implied a size in
a range of six; `--radius-surface` names the one decision there actually was.

| Retired | Replacement |
| --- | --- |
| `--radius-xs`, `-sm` | `--radius-control` (4px) |
| `--radius-md`, `-lg`, `-xl`, `-2xl` | `--radius-surface` (8px) |
| `--radius-full` | `--radius-pill` |
| `--shadow-xs`, `-sm` | *deleted* — no consumers survived Set B |
| `--shadow-md` | `--shadow-popover` |
| `--shadow-lg`, `-xl` | `--shadow-modal` |
| `--color-success-text` | `--color-success` |
| `--color-warning-text` | `--color-warning` |
| `--color-text-link` | `--color-primary` |
| `--text-body-lg` | `--text-h4` |

**173 files, ~340 call sites.** Directional forms (`rounded-l-xl`,
`rounded-bl-md`, `rounded-t-sm`) were migrated too — a naive
`rounded-lg → rounded-surface` sweep would have missed all six.

**`--radius-pill` was dead before this.** `borderRadius` never declared
`full`, so `rounded-full`'s 87 uses were resolving to Tailwind's *built-in*
9999px and the token was decorative. Declaring `pill` puts them on the token.

#### Zero visual diff — measured, not asserted

Every element's rendered `border-radius`, `box-shadow`, `color`,
`background-color`, `font-size`, `line-height` and border was fingerprinted
as an order-independent multiset hash, before and after:

| Screen | Theme | Elements | Distinct | Hash before | Hash after | |
| --- | --- | --- | --- | --- | --- | --- |
| Overview | dark | 655 | 62 | 454490683 | 454490683 | ✅ |
| Appointments | dark | 1596 | 58 | 3574919417 | 3574919417 | ✅ |
| Settings › Notifications | dark | 403 | 34 | 4290290006 | 4290290006 | ✅ |
| Reports | dark | 1045 | 74 | 3505230049 | 3505230049 | ✅ |
| Reports | light | 1045 | 74 | 1322641218 | 1322641218 | ✅ |

Exact hash equality — not "looks the same". Post-migration the page yields
only four radius values (0 / 4 / 8 / 9999px), confirming nothing fell through
to a Tailwind default.

*One measurement initially disagreed* (Reports dark, 75 distinct). It
reproduced as a **mid-transition artifact** — `DistributionBars` animates
width on `duration-slow`, so a fingerprint taken during the animation catches
an extra state. Re-measured after settling, twice, it matched exactly. Worth
recording because the instinct on a red result is to hunt for a regression
that was never there.

#### Guard against regression

`scripts/check-retired-tokens.mjs`, wired into `npm run lint`. It fails on any
retired name outside a comment. This matters because **the failure mode is
silent**: a `var(--radius-lg)` that no longer resolves renders with no radius
and raises nothing, and `rounded-lg` outside our theme quietly falls back to
Tailwind's own scale — the wrong value, no warning. Verified by planting a
violation and confirming a non-zero exit, then removing it.

It complements the existing `theme-utilities.test.ts`, which compiles Tailwind
and asserts every class emits CSS. That guard earned its keep here: it caught
a bare `shadow-xs` inside one of my own comments.

#### One item NOT done — the type-scale collapse

**Wave 1a's claim that `h4`/`body-lg` and `h5`/`body` were duplicates was
wrong.** They share a font size and differ in line height:

| | Size | Line height |
| --- | --- | --- |
| `h4` | 14px | **21px** |
| `body-lg` | 14px | **23px** |
| `h5` | 13px | **19px** |
| `body` | 13px | **20px** |

Collapsing them changes leading on 11 + 19 + 327 sites — a visible change,
which contradicts this wave's acceptance criterion. **Not done**, and the
conflict is reported rather than resolved unilaterally.

What *was* collapsible: `--text-body-lg` had a single consumer, a flex-centred
`h-6` glyph where line height is inert, so it folded into `h4` at genuine zero
diff and the token is gone.

## Consequences

### Nine WCAG failures resolved

| # | Failure | Was | Now |
| --- | --- | --- | --- |
| 1 | `border-strong` — boundary of **every input, checkbox and secondary button** (1.4.11 needs 3:1), light | 1.48 | **3.44** |
| 2 | `border-strong`, dark | 1.93 | **3.38** |
| 3 | `primary` as body text, dark | 3.98 | **7.28** |
| 4 | `secondary` as body text, light | 3.74 | **6.61** |
| 5 | `success` as body text, light | 3.30 | **6.51** |
| 6 | `warning` as body text, light | 3.19 | **6.16** |
| 7 | `info` as body text, light | 4.10 | **6.62** |
| 8 | `border` as the (now load-bearing) surface edge, light | 1.23 | 1.41 |
| 9 | `border`, dark | 1.41 | 1.37 → carried by `surface`/`bg` separation |

Every text and background pair was verified in **both** themes: body text on
surface, page background and sunken; every semantic as text, as a badge on
its own `-subtle`, and as a fill under white; control boundaries and the
focus ring at 3:1. All pass.

`--color-text-disabled` remains at 2.45:1 and is *not* counted as a failure —
WCAG 1.4.3 exempts disabled controls.

### Costs and open risks

- **`--color-border` at 1.41:1 is deliberately below 3:1.** A 3:1 border on
  every card reads as a wireframe. Container edges are informative, not
  interactive; only control boundaries are held to 1.4.11. This is a
  judgement call, and the one most worth revisiting.
- **Aliased keys must stay aliased.** `success-text`, `warning-text`,
  `text-link`, `radius-sm`, `radius-lg/xl/2xl`, `shadow-xs`, `shadow-xl` are
  deliberately identical to their successors so Wave 1b can delete them with
  zero visual diff. Restoring variety to any of them silently breaks that.
- **The token count is 28, not the ≤24 originally targeted.** The overage is
  `accent` (+2, kept for provenance) and the `primary-pressed` / `error-hover`
  interaction states, which are low-usage but not redundant. Deleting a
  hover state because few components need it would be a false economy.
- **The chart ramp — ✅ DONE (Wave 1c, §9).** Both the missing strokes and the
  ramp rewrite have shipped; the five-slot ramp replaced categorical use of
  the semantic tones.
- **A sixth chart category has nowhere to go.** `toneAt` wraps at five, so a
  chart with six categories repeats slot 1. That is deliberate — the free hue
  space between the alarm colours and the AI accent fits five separable
  slots. Six categories is a signal to group the data.
- **DEBT-1b-01 — the heading/body type tiers still overlap.** `h4`/`body-lg`
  and `h5`/`body` share a font size and differ only in line height (21 vs 23,
  19 vs 20). Two steps that differ by 1–2px of leading are not two decisions;
  they are an unresolved one. Collapsing them is a *visible* change affecting
  ~360 sites, so it could not ride in a zero-diff wave — it needs its own
  wave, and a decision about which leading survives.
- **DEBT-1d-01 — mixed timestamp spans.** Roughly 30% of the timestamp sites
  bundle a data value into the same tertiary span:
  `{document.filename} · uploaded {date}`,
  `{GRANTEE_ROLE_LABEL[...]} · {requestedAt}`,
  `{session.location} · {lastActiveAt}`. The timestamp is correctly tertiary;
  the filename, role and location beside it are not. The fix is to split the
  span so each half takes its own role — roughly 20 sites, all cosmetic
  rather than legibility-critical, so it was left out of 1d rather than done
  by halves.
- **The patients card list was NOT correct**, despite the appointments card
  list being named the 1d reference. `PatientCardList` and
  `PatientSummarySidebar` both rendered `MRN {mrn} · {id}` in tertiary. The
  "card list is the reference" finding held for the *appointments* card list
  only; it did not generalise, and assuming it would have left the MRN defect
  in place on the patients surface.
- **`Surface` is dead code.** Exported from `components/ui`, zero call sites
  (found during Set B). Its elevation map was made alias-independent rather
  than deleted; removal belongs with the Wave 2 primitive consolidation.
- **`REPORT_CATEGORIES` still colours navigation chips semantically** —
  Laboratory is `error`-red, Pharmacy `warning`-amber. These are category
  chips, never chart marks (verified: `category.tone` reaches no chart), and
  they are now typed `SemanticTone`. Whether a *navigation* chip should wear
  an alarm colour is a live question, but it is a navigation decision, not a
  chart one, so Wave 1c left it alone.
- **`--color-secondary` survives Wave 1a on borrowed time.** Its 17 sites
  move to primary or the chart ramp in 1b.
- **DEBT-1a-03 — Set B — ✅ RESOLVED (Wave 1a.2). Wave 1b is unblocked.**
  Revaluing `--shadow-xs` / `--shadow-sm` to a 1px ring assumed those sites
  carried no border. Twenty-nine did (Set A, §8). The inverse risk was the
  nine sites whose *only* edge was the ring: deleting the alias in 1b would
  have dissolved them.

  **No site consumes `--shadow-xs` or `--shadow-sm` any more.** Each was
  given an explicit, alias-independent treatment chosen on measured
  evidence, not by reflex:

  | Site | Resolution | Why |
  | --- | --- | --- |
  | `ui/Surface.tsx:35,36` | `ring-1 ring-border` | **Dead code** — `Surface` is exported but has zero call sites. Made alias-independent rather than deleted; removal belongs to Wave 2. |
  | `ui/Switch.tsx:61` | `ring-1 ring-border` | Edge **kept**, against the initial instinct to drop it: white on the dark-theme checked track is **2.15:1**, under the 3:1 WCAG 1.4.11 asks of a control boundary. The other three states clear it on fill alone (7.97 / 3.44 / 4.62), so the hairline exists for exactly one state. `ring` not `border` — a border would eat 2px of a 20px knob. |
  | `ui/Tabs.tsx:119` | `ring-1 ring-border` | The edge is **entirely load-bearing**: `bg-surface` on `bg-surface-sunken` is **1.11:1** light, **1.14:1** dark. Without it the selected tab is invisible. |
  | `ui/TopNavbar.tsx:37` | `shadow-md` | The one true elevation here. The header is full-bleed with `border-b`, so the aliased `shadow-sm` was ringing all four sides — three off-screen — instead of lifting it. Scroll elevation is what `--shadow-md` is reserved for. |
  | `messaging/MessageBubble.tsx:103` | `border` on **both** branches | This was **also a missed Set A double edge**: the received branch already declared `border`, in a different string from the shadow, so the script did not pair them. The sent branch had no border and `primary-subtle` on the page background is **1.06:1** — invisible without one. Matches the `failed` state, which already used a border. |
  | `settings/AppearanceSection.tsx:64` | `ring-1 ring-border` | Ring not border: the swatch **is** the content, and a border would paint over 1px of it on every side. |
  | `calendar/CalendarAppointmentCard.tsx:59` | `hover:shadow-sm` **removed** | `hover:border-primary` is the whole affordance; the ring added a second border-coloured edge outside the primary one — a muddy double edge, not a lift. |
  | `layouts/Navbar/AvatarMenu.tsx:87` | `hover:ring-1 hover:ring-border` | Keeps the hover affordance without changing a circular avatar's box. |

  **Acceptance verified by simulating the deletion**: injecting
  `--shadow-xs: none; --shadow-sm: none` at runtime and re-measuring every
  site's computed edge (border width + ring spread + blur), in both themes.
  Every site is byte-identical before and after — nothing depends on the
  aliases any more:

  | Site | Edge before | Edge after deletion | Pass |
  | --- | --- | --- | --- |
  | Appearance swatch | 1px ring | 1px ring | ✅ |
  | TopNavbar (resting) | 1px `border-b` | 1px `border-b` | ✅ |
  | TopNavbar (elevated) | 6px blur | 6px blur | ✅ |
  | Switch thumb (checked) | 1px ring | 1px ring | ✅ |
  | Switch thumb (unchecked) | 1px ring | 1px ring | ✅ |
  | Tabs active (enclosed) | 1px ring | 1px ring | ✅ |
  | MessageBubble (sent) | 0.8px border | 0.8px border | ✅ |
  | MessageBubble (received) | 0.8px border | 0.8px border | ✅ |

  `ring-1 ring-border` was confirmed to resolve to a real value
  (`rgb(47,59,74) 0 0 0 1px` in dark, `rgb(211,218,227)` in light), and the
  `hover:ring-*` variants were confirmed to have compiled rules.

  **The general lesson for 1b:** the Set A script paired `border` and
  `shadow` only within a single class string, and MessageBubble hid a double
  edge across a ternary. Any remaining sweep must reason about the whole
  `cn()` call, not one literal.

- **DEBT-1a-01 — `rescheduled` renders blue in the worklist and amber
  everywhere else.** Wave 1a remapped `rescheduled` from the `awaiting`
  kind to `scheduled` in
  `features/doctor/appointments/model/types.ts` only, to break the amber
  collision with Pending. The decision is correct and should propagate, but
  it was made feature-locally to avoid repainting every screen, so the same
  status now carries two colours in two places. **Reconcile in Wave 2**,
  with the `Badge` filled/outline dimension below: once terminal and live
  states are separable by form, `awaiting` can keep amber for genuine
  waiting states and `rescheduled` can take blue platform-wide. Until then,
  do not "fix" the inconsistency by reverting the worklist — that restores
  the defect.
- **DEBT-1a-04 — `Breadcrumb` link is a 52×18 target.** Measured at 375px,
  it is the only interactive element on the mobile appointments surface
  below 24×24. It plausibly qualifies for 2.5.8's *inline* exception, but a
  breadcrumb is navigation rather than prose, so the exception is arguable.
  `Breadcrumb` is shared, so this fails on every screen that renders one.
  Fix with the same `::before` overlay technique used for the checkbox and
  sort handles; batch it with the Wave 2 primitive work.

- **The card list is the reference implementation for the text-role rule
  (Wave 1d).** `AppointmentCardList` renders **every** value —
  patient name, MRN, appointment ID, date, duration, type, department — as
  `text-primary`, and reserves `text-tertiary` for field captions, age/sex
  and priority. The desktop table's identity blocks render the same MRN as
  `text-tertiary` at 11px. **Wave 1d migrates the table toward the card, not
  the reverse.** No reclassification pass is needed on the card list itself.

- **Breakpoint correction: tablet-portrait is the dense table, not the card
  list.** `isMd` is `min-width: 768px`, so at exactly 768px
  `AppointmentsPage` renders `DataTable`; `AppointmentCardList` appears only
  *below* 768px. Any reasoning about "the tablet surface" must target the
  table. This is what made DEBT-1a-02 urgent rather than theoretical.

- **`StatusBadge`'s shared map still collides platform-wide.** `cancelled`
  and `rejected` both resolve to error; `completed` and `archived` both to
  neutral. Six variants cannot separate fourteen kinds by hue alone. The
  worklist fix above was applied feature-locally because the map is under DS
  governance and changing it repaints every screen. The durable fix is a
  second dimension on `Badge` — filled for live states, outline for terminal
  ones — which belongs in Wave 2 alongside the primitive consolidation.

- **DEBT-2a-01 — `SystemLogsSection.test.tsx` is load-sensitive, and fails
  intermittently only when the suite runs in parallel.** Pre-existing;
  **not introduced by Wave 2a**, which touches this file only to rename a
  query-hook import.

  Measured at this checkpoint, both halves of the same run:

  | Run | Result |
  | --- | --- |
  | Full suite, parallel (46 files) | **1 failed** / 562 passed — `SystemLogsSection.test.tsx:330`, a `waitFor` timeout on the severity-filter assertion |
  | `SystemLogsSection.test.tsx` alone | **34 passed** / 34, 37.4s |

  The file passes in isolation and fails under contention, so the defect is
  in the *time budget*, not in the component or the assertion's logic.

  Two distinct under-budgeted shapes live here, and they share a cause:

  1. **`waitFor` timeouts** (the observed failure, `:330` and ~20 siblings).
     Each renders the full logs section, settles a query and re-filters.
     With the default 5s window these are comfortable idle and marginal
     when the machine is running dozens of environments at once — this
     suite spends 263s in `environment` alone.
  2. **A wall-clock window** (`:780`). `elapsed = Date.now() - field.value`
     is asserted within `7 days ± 60s`, but the field is a
     `datetime-local` value, so `toDateTimeLocalValue` truncates the seed
     to the minute — consuming **0–59.999s of the 60s budget** before the
     test does any work. What remains is the entire allowance for render
     and settle. It is already given `20_000`ms of test timeout, which
     does nothing for a window measured against the real clock.

  **Deliberately not fixed in Wave 2a.** Widening the windows would make
  this wave green by editing the evidence rather than the defect. The
  honest repairs are (1) raise the per-assertion `waitFor` timeout or
  reduce this file's render cost, and (2) for `:780`, subtract the
  truncation explicitly — floor both sides to the minute, or assert
  against the same anchor the seed used (`SEED_ANCHOR_MS`,
  `logs/api/logs.api.ts:83`) — not buy more slack. Both belong with the
  owner of the log seed design, not with a token revaluation.

  **Confirmed pre-existing during Wave 2b, and wider than first logged.**
  `filtering and pivot > narrows the table by severity` (`:330`) and
  `tells an over-filtered investigator how to widen it` also fail
  intermittently, now in ISOLATION rather than only under parallel load.
  Measured on the same machine, same single test, four runs each:

  | Build | Result |
  | --- | --- |
  | Wave 2b working tree | 2 of 3 failed |
  | `HEAD` (Badge/StatusBadge reverted) | 2 of 4 failed |

  The rates match, so 2b neither caused nor worsened it — the first
  comparison run suggested otherwise and a single sample was simply not
  evidence. The mechanism is the same time budget: `queryByText` *throws*
  on multiple matches, so a table that has not re-rendered inside the 5s
  window retries until timeout and reports "Found multiple elements"
  rather than a filter fault.

  **The family is wider than one file.** Three consecutive full-suite runs
  at the close of Wave 2b:

  | Run | Result |
  | --- | --- |
  | 1 | **610 / 610** |
  | 2 | 608 / 610 — `SystemLogsSection` severity filter, `GeneralPanels` defaultSection |
  | 3 | 609 / 610 — `SystemLogsSection` severity filter |

  Every failure is a `waitFor`/timeout in a file Wave 2b does not touch, and
  run 1 shows the whole suite passes when it wins the races. Treat the gate
  as green with a named intermittent set rather than as 610/610: the number
  varies run to run for reasons that have nothing to do with the code under
  test. `GeneralPanels.test.tsx` joins this entry.

### 12. Wave 2b — emphasis, and the glyph as a third channel

Hue alone could not separate fourteen status kinds across six variants. Wave
2b adds a second dimension and, sparingly, a third.

**Layer 1 — `Badge`.** `emphasis?: 'filled' | 'outline'`, default `filled`.
Filled means live/actionable; outline means terminal/settled. `ai` is
provenance and stays off the axis. `dot` and `icon` became mutually
exclusive, expressed as a union so the illegal pairing cannot compile — it
caught the one existing offender immediately (`DoctorProfilePage`, which was
spending 28px of an 18px pill on chrome).

Outline paints `ring-1 ring-inset`, not `border`: a border would add 2px to
the box and eat a pixel of padding on every side, undoing density Wave 1
fought for. **No new colour tokens were needed** — measured against
`--color-surface` and `--color-surface-sunken` in both themes, the five hue
defaults clear 1.4.11's 3:1 as a boundary with room to spare (light
5.91–6.62, dark 6.20–7.82). `--color-border` does *not* (1.27–1.57), so
neutral uses the strong border token (3.09–3.85). Adding per-hue alias keys
onto values that already pass would have rebuilt the alias debt Wave 1b just
finished paying down.

**Layer 2 — the mapping.** The glyph is spent only where hue+emphasis leaves
two *co-occurring* kinds identical: `pending` (Clock), `cancelled` (Ban),
`rejected` (UserRoundX), `completed` (CheckCheck), `archived` (Archive), and
`ai` (Sparkles). It replaces the dot rather than joining it — the dot is
`bg-current`, so it repeats the hue and carries nothing a reader can decode,
which is how DS §1.3's "never colour alone" was satisfied on paper while
every status badge stayed colour-plus-text in practice.

**The acceptance criterion is contextual, not global.** Distinct meanings
that can co-occur in one visual context must be separable at scan speed;
uniqueness across all fourteen kinds is not required. `confirmed` and
`active` deliberately share success-filled — no surface renders both, and
glyphing them would put chrome on the two most common badges on the platform
for no scanning benefit. `completed` was **not** moved to filled to win its
collision with `archived`: finished is finished, and the glyph does that work
without trading a correct meaning for a tidy table.

**AI provenance.** Five sites were spending the accent violet as a sixth
decorative hue — a clinic holiday, a template kind, an evening shift, a
rescheduled appointment and a patient complaint. All five are corrected. The
regression guard targets the defect class (a domain map typed `BadgeVariant`
resolving to `'ai'`) rather than the literal string, because nine hand-written
`variant="ai"` sites on genuine AI surfaces are the token doing its job.

**Pharmacy High-risk** stays outside `StatusKind` — it is an attribute of the
drug, not a lifecycle state — but it shared amber with Pending approval and
Due in the same row. It keeps the caution hue and separates by outline +
`TriangleAlert`.

- **DEBT-2b-01 — `expiring` is overloaded as the generic mid severity.
  RESOLVED as a boundary, not as a mapping.**

  Eight domain maps reached for it to mean High priority, Urgent, Moderate,
  Important or Medium risk; exactly one (refill Due) means literal time
  expiry. That is why `expiring` carries no glyph — an AlarmClock would be
  wrong at seven sites out of eight — and why `pending` took the Clock.

  The resolution is to name the distinction rather than paper over it.
  **Severity is an ordinal ramp** (low → critical, where the ordering *is*
  the information); **lifecycle is a set of states a thing moves between**.
  They are different shapes, and a ramp squeezed into lifecycle kinds loses
  its ordering. So the five severity-shaped maps — log severity, alert
  severity, queue priority, announcement priority, resource stock — stay on
  `BadgeVariant` **deliberately**, and a test now enforces that boundary in
  both directions: each must remain typed `Record<…, BadgeVariant>`, and
  none may name a lifecycle kind. A severity vocabulary is Layer 3 work and
  must not be improvised inside `StatusBadge`.

- **Wave 2b migrated only the lifecycle-shaped consumers.** Sixteen render
  sites across nine maps now resolve through `StatusKind`: appointment
  oversight status, doctor verification and account, patient account status,
  the signup feed, notification delivery, document decisions, login results,
  room status and staff presence. Taxonomy chips (`SHIFT_VARIANT`,
  `SCOPE_VARIANT`), attribute markers (`FLAG_VARIANT`, Pharmacy High-risk),
  counts, deltas and static warnings stay on plain `Badge` — a badge that
  names a category is not making a lifecycle claim, and migrating it would
  have encoded one.

  Two mappings were corrected by the separability guard rather than by
  review. `LOGIN_RESULT` landed cleanly because every value is already
  terminal — Ban for blocked, UserRoundX for failed, CheckCheck for success.
  `VERIFICATION.verified` had to move from `confirmed` to `normal`: the
  profile header renders verification and account standing side by side, and
  `confirmed` and `active` share success-filled, so "Verified" and "Active"
  were one treatment in the one place they are read together. `normal` is
  also the truer reading — verification is a finished process at rest.

- **DEBT-2b-02 — `rejected` is doing double duty.** It covers a patient
  no-show (appointments, high traffic) and a refused application (admin
  verification, low traffic). The UserRoundX glyph is tuned for the
  collision that actually occurs — Cancelled vs No-show in one column — and
  reads only loosely on a rejected verification. Splitting the kind is the
  honest repair; it was not forced here because the two never co-occur.

- **DEBT-2d-01 — `cn` silently drops custom font sizes.** `tailwind-merge`
  is configured with its own defaults, which do not include this project's
  type scale. It therefore classifies `text-metric`, `text-caption`,
  `text-body-sm` and friends as *colours*, finds a real colour beside them
  (`text-text-primary`, `text-text-tertiary`) in the same conflict group, and
  drops the size. Nothing errors; the element simply inherits.

  Found three times, in three waves, each by measuring rather than by review:

  | Wave | Site | Cost |
  | --- | --- | --- |
  | 2c-b | `DataTable` body cells lost `text-body-sm` | 2px per row, masked by `h-10` |
  | 2d-a | `StatisticCard` value lost `text-metric` | rendered at the inherited size |
  | 2d-a | `StatisticCard` label lost `text-caption` | 16px → 20px, 4px of card |

  It is also why `MetricTile`'s own `Overline` renders at 20px rather than
  the 16px the caption step specifies (Wave 2d-b, §13).

  Each site is worked around with a plain template string and a comment. The
  real fix is to pass the project's `fontSize` keys to `twMerge` via
  `extendTailwindMerge`, which is a one-file change with repository-wide blast
  radius — every `cn` call would begin resolving these correctly, including
  wherever the current behaviour has been unknowingly designed around. It
  needs its own wave, with a before/after sweep of every `cn` call that mixes
  a text size with a text colour.

### Verification

- 552 tests across 44 files pass; `tsc -b` clean.
- Doctor Appointments rebuilt as the proof screen: rows **53px → 43px**,
  fully-visible rows at 1440×900 **9 → 13**.
- **The density target was measured against 24 seeded appointments.**
  `MOCK_APPOINTMENTS` generated 5, which cannot demonstrate a 12-row target;
  it was raised to 24 and kept, five being unrealistic seed data for a
  worklist. Re-measure against 24 if the target is ever revisited.
- **Touch targets meet WCAG 2.5.8 outright, without the spacing exception.**
  Checkboxes and sort handles measured 18×18 and 20px tall — passing only
  via spacing, which was not good enough for two reasons: the dense table
  renders at ≥768px, i.e. a portrait tablet held by someone standing at a
  bedside, and the row checkbox sits inside a row that *navigates* on click,
  so a near-miss does not merely fail to select — it opens the wrong
  patient's record. Both were given a 24×24 target via a transparent
  `::before` overlay, visual boxes unchanged:

  | Element | Visual | Target | 2.5.8 |
  | --- | --- | --- | --- |
  | Row / select-all checkbox | 18×18 | **24×24** | pass |
  | Sort handles (×5) | 35–93 × 20 | 35–93 × **24** | pass |
  | Row action buttons | 28×28 | 28×28 | pass |

  Zero visual diff: the overlays are transparent, borderless and absolutely
  positioned, so no rendered pixel and no row or header height changes
  (row 43px, header 32px, unchanged). The overlay hangs on the span that
  wraps the box — not on the `<label>`, so a checkbox with visible caption
  text does not centre a 24px target on the whole caption — and not on the
  `<input>`, because `::before` does not render on replaced elements.

- **12 visible rows was accepted over 13, deliberately.** The view-tab band
  was briefly merged into the filter row, which bought 56px and a 13th row.
  It was reverted: a view switch is navigation, and the merge filed it among
  tools (Refresh / Export / Filters) 830px from the field it shared a row
  with, reclassifying it in the user's mental model. The target is 12; the
  extra row is not worth the demotion. **Chrome-height optimisation stops
  here** — further compression trades against usability, not whitespace.
