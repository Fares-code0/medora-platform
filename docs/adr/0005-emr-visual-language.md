# ADR-0005 — The EMR visual language: clinical blue, charcoal sidebar, white cards

- **Status:** Accepted (foundation applied — PR 1 of 4)
- **Date:** 2026-11-08
- **Scope:** `frontend/src/styles/tokens.css`, `frontend/tailwind.config.ts`,
  `frontend/src/styles/globals.css` (high-contrast overrides),
  `frontend/src/features/auth/layout/BrandPanel.css`, the shared Button,
  Checkbox, Radio, Switch, Tabs and Badge and the two error pages' buttons
  (component roles, §8), the Theme Playground catalogue, presets, export and
  storage, the palette, contrast and parity suites, and their description
  in `frontend/DESIGN_SYSTEM.md` (§2 Color, §5/§6 as implemented, §8.1,
  §8.16–8.18, §12)
- **Supersedes:** ADR-0001's **colour palette** (the six slate-blue values) and
  its "only overlays cast a shadow" elevation rule. ADR-0001's type scale,
  radius roles, chart-ramp rule (§9) and text-role reasoning stand.

## Context

The product direction is a professional hospital-management / EMR dashboard:
a dark charcoal sidebar, a light-gray application ground, white content cards,
one clinical blue for interaction, compact density, minimal borders and soft
shadows. The design brief supplied a starting palette and asked that it be
adjusted where needed to stay cohesive and WCAG AA.

ADR-0001 had deliberately narrowed the web palette to six slate-blue values,
with `palette.test.ts` forbidding any other colour. That palette cannot
express the brief: it has no saturated blue, no neutral grays, and no
charcoal. The mechanism — every theme colour built from a short list of
approved primitives, enforced by test — is sound, and is kept. The list is
what changes.

Measured against the roles they would paint, several brief values fail AA:

| Brief value | Intended role | Measured | Verdict |
| --- | --- | ---: | --- |
| `#7b8794` | secondary text | 3.66 on white, 3.34 on page | fails 4.5 |
| `#9aa5b1` | muted text | 2.50 on white | fails 4.5 |
| `#b7c0ca` | disabled text | 1.84 on white | fails the 3:1 this codebase holds disabled text to |
| `#1677c8` | link / active-label text | 4.25 on page, 4.11 on `#e8f2fc` | fails 4.5 |
| `#1677c8` | primary button fill under white | 4.66 | passes |

## Decision

### 1. One approved palette, three families

`tokens.css` declares seventeen primitives, named by family and step
(`--palette-blue-600`), and every `--color-*` role is a reference to one or a
`color-mix(in srgb, …)` of two. The status tones remain the one literal
exception.

| Family | Primitives | Used for |
| --- | --- | --- |
| Blue | 700 `#1268ad`, 600 `#1677c8`, 400 `#5aa6ea`, 200 `#d8eafb`, 100 `#e8f2fc` | interaction, fills, selection, dark-theme brand, chart |
| Neutral | white, 50 `#f5f7fa`, 100 `#f1f5f8`, 200 `#e5eaf0`, 300 `#a5afba`, 400 `#7e8b99`, 600 `#5f6b78`, 900 `#202832` | the light application: page, cards, borders, text |
| Ink | 950 `#0b0d0f`, 900 `#111519`, 800 `#1b252e`, 700 `#25303b` | the sidebar, the auth brand panel, the dark theme's grounds |

### 2. AA corrections to the brief

- **Secondary/tertiary text** is `#5f6b78` (5.44 on white, 4.96 on the page).
- **Blue as text** — `--color-primary`, which paints links, active labels,
  secondary-button text, tab indicators and checked controls — is `#1268ad`
  (5.82 on white, 5.31 on the page, 5.14 on its own selection tint).
- **Blue as a fill** is the brief's `#1677c8`, under white ink (4.66). This
  is a new role, `--color-primary-fill` / `--color-primary-fill-hover`
  (hover `#1268ad`, the brief's own hover value). The primary button and
  every checked checkbox, radio and switch paint it (§8).
- **Control boundary / disabled / scrollbar** is `#7e8b99`, the lightest gray
  that holds 3:1 on the page (3.17). The brief gave no value for it.
- **Placeholder** is a 85/15 mix of 600 and 400 (`#64707d`): above 4.5 on all
  three grounds, still quieter than tertiary.
- **Not adopted:** `#9aa5b1` (muted text), `#b7c0ca` (disabled text) and
  `#edf0f3` (divider). The first two cannot be text roles at those values; the
  divider has no role distinct from `--color-border` today. Each can return
  the day a role needs it and clears its bar.

### 3. The sidebar has its own roles, and they do not flip

`--color-sidebar`, `-raised`, `-hover`, `-border`, `-text`, `-text-muted`,
`-active`, `-active-text`. They are declared in `:root` only, so the rail is
the same charcoal in both themes. Contrast: text 18.14 on the rail, muted text
8.75 (6.99 hovered), active label 4.66 on `#1677c8`, the active pill 4.18
against the rail. The shell adopts them in PR 2.

### 4. Cards may carry a hairline shadow

`--shadow-card` (`0 1px 2px` ink-950 at 6%) is the one lift a surface may
add, under its 1px border, so a white card separates from the gray page. The
border is still the edge; the shadow is never a substitute for one. Overlays
and modals keep their own shadows.

### 5. The dark theme

Re-based on the ink ladder: page 900, card 800, overlay 700, text gray 50 and
300, brand blue 400 for both the interactive tone and the fill (with ink-900
labels, 7.05), selection on a deep blue tint. Every pair the light theme
asserts is asserted here too.

### 6. Web and patient palettes may differ — status tones may not

`patient-parity.test.ts` held `tokens.css` and
`patient-app/src/theme/tokens.ts` identical for every shared token. The web
now takes the EMR language; the patient app keeps its own palette, and no
patient-app file is changed. The Original-palette check is narrowed to the
nine clinical status tones (success, warning, error + hover, info, and their
subtle tints, both modes), which carry meaning rather than brand and must stay
identical. The check asserts that all nine are found, so it cannot pass
vacuously. The curated playground presets still agree value for value.

### 7. The Theme Playground carries the new roles

The catalogue gains the new roles, the three curated presets gain values for
them, and the contrast checker gains their pairs, so a palette tried there is
judged by the same rules as the shipped one. The editor is organised in seven
groups: Brand & Primary, Neutral Colors, Sidebar, Components, AI Components,
Status Colors and Charts. Its development-only build boundary is unchanged.

### 8. Component roles, only where a shared role cannot serve

Re-theming a shared role re-paints every component that reads it. A
component gets roles of its own only where that coupling is the problem, and
each starts at the value the component already painted:

| Role | Light / dark | Why it cannot be shared |
| --- | --- | --- |
| `primary-fill-text` | white / ink-900 | The ink on the fill — button label, checkbox tick, checked switch knob. It shared `text-inverse` with destructive, AI and status fills; a fill re-themed light needs a dark label without darkening those. |
| `tab-active-text` | gray-900 / gray-50 | It was `text-primary`: a blue tab label would have turned all body text blue. |
| `tab-indicator` | blue-700 / blue-400 | It was `primary`, which also paints every link. |
| `ai-badge`, `ai-badge-text` | gray-200, gray-900 / ink-700, gray-50 | `accent-subtle` and `accent` also tint and label every other AI surface. |

Everything else reuses a shared role: the primary button's fill, hover and
pressed states are `primary-fill`, `primary-fill-hover` and `primary-pressed`
(the button is the pressed role's only consumer); secondary and ghost buttons
and links take `primary`/`primary-hover`; destructive buttons `error`,
`error-hover` and `text-inverse`; checkbox, radio and switch `primary-fill`;
selected rows and menu options `primary-subtle`; the nine filled AI buttons
`accent`. Cards get no accent-edge role.

### 9. Copies are references, not values

`secondary`, `secondary-hover`, `secondary-subtle` (the retired role) and
`scrollbar-thumb` always equalled another role. `tokens.css` now declares
each once, in `:root`, as `var(<source>)`, so it cannot drift, and the Theme
Playground lists them in `COPIED_TOKENS` rather than as editor rows. Because
a reference declared on `:root` is resolved there, the playground preview
re-declares the same reference on its own scope, the CSS export writes it,
and the patient export writes the source's value under the copy's
`ColorPalette` key. `presets.test.ts` checks every copy against the
stylesheet; `palette.test.ts` accepts a reference only to a role that is
itself built from the primitives.

Experiments saved by an earlier catalogue still load. A missing role split
out of another takes that token's saved value; one that did not exist (the
sidebar) takes the shipped value; a saved copy value is superseded by its
source; every such change is shown on the page. Stored entries that cannot
be read are kept, never overwritten.

### 10. The switch knob follows its track

The dark theme drew a white knob on the blue-400 checked track: 2.60:1, below
1.4.11's 3:1 (1.85:1 before this decision). The checked knob now takes
`primary-fill-text` — 4.66:1 light, 7.05:1 dark — and the unchecked or
disabled knob keeps `control-knob` (3.48:1 / 3.86:1 on the unchecked track).
`Switch.test.tsx` and `contrast.test.ts` hold both.

### 11. The navbar AI button

The navbar's Medora AI button is a white tile with a black edge in both
themes: `--color-ai-launcher` (white) and `--color-ai-launcher-border`
(ink-950), in the **AI Components** group, declared in `:root` only. Its
boundary is the edge on the light navbar (19.47:1) and the fill on the dark
one (15.55:1); `contrast.test.ts` asserts one of the two holds 3:1. The
other nine `variant="ai"` controls keep `accent`.

## Consequences

- The whole application re-tones at once: every component reads roles, not
  values. The sidebar stays light until PR 2 adopts its roles.
- `--color-primary` and `--color-primary-fill` are distinct in light, equal in
  dark. A new primary-filled control should use the fill.
- `patient-app/src/theme/tokens.ts` still describes `tokens.css` as its source
  of truth in a header comment. That is no longer true of brand values; it is
  left for a patient-app change to correct, since this decision changes no
  patient-app file.
- ADR-0001's AI-accent note still applies: the accent is the ink end of the
  neutral ladder, close to the blue in hue, and AI provenance is carried by
  the left rule and label rather than by colour.

## Alternatives considered

- **Keep `--color-primary` at `#1677c8`.** Fails AA for every link and active
  label on the page and on selection tints.
- **Make `--color-primary` `#1268ad` and stop there.** Passes, but the primary
  button would never be the brief's brand blue.
- **Rename `text-primary` usages to a new text token.** Touches roughly
  eighty call sites for no visual gain over splitting the fill out instead.
- **Update the patient app to match.** Out of scope for a frontend task, and
  a mobile client has no sidebar to justify the change.
