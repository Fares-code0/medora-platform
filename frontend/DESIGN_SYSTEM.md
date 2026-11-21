# Medora Design System

**Version 1.0.0 — Foundation Release**
**Status:** Draft for approval · **Owners:** Design Platform Team
**Applies to:** Medora Healthcare Platform (Web) — React · TypeScript · Vite · TailwindCSS

---

## Table of Contents

1. [Brand Identity](#1-brand-identity)
2. [Color System](#2-color-system)
3. [Typography](#3-typography)
4. [Spacing System](#4-spacing-system)
5. [Border Radius](#5-border-radius)
6. [Elevation](#6-elevation)
7. [Iconography](#7-iconography)
8. [Component Standards](#8-component-standards)
9. [Motion System](#9-motion-system)
10. [Responsive System](#10-responsive-system)
11. [Accessibility](#11-accessibility)
12. [Design Tokens](#12-design-tokens)
13. [Governance](#13-governance)

---

# 1. Brand Identity

## 1.1 Brand Personality

Medora is a clinical-grade healthcare platform that must earn trust in seconds and sustain it across years of daily use. The brand personality is defined by five attributes, in priority order:

| Attribute | Meaning in the product | What it rules out |
|---|---|---|
| **Trustworthy** | Predictable layouts, conservative color use, zero surprises in destructive flows | Playful gimmicks, aggressive gradients, novelty interactions |
| **Calm** | Generous whitespace, muted surfaces, restrained motion | Dense "trading terminal" layouts, flashing indicators |
| **Precise** | Exact numbers, clear units, unambiguous labels, tabular figures | Vague copy ("a few results"), decorative data viz |
| **Human** | Warm neutrals, rounded corners, plain-language copy | Cold pure-grays, jargon-first labeling |
| **Intelligent** | AI features feel assistive and clearly labeled, never magical or hidden | Unexplained automation, AI output presented as clinical fact |

## 1.2 Design Philosophy

Four principles govern every design decision. When principles conflict, the earlier one wins.

1. **Safety over speed.** In healthcare, a mis-click can have clinical consequences. Destructive and clinical-impact actions always require confirmation, are never placed adjacent to routine actions, and never rely on color alone.
2. **Clarity over density.** Doctors and receptionists work under time pressure. Every screen has one primary action, information hierarchy is enforced through the type scale, and progressive disclosure hides complexity until requested.
3. **Consistency over novelty.** A component behaves identically everywhere. A patient sees the same date format, the same status colors, and the same button behavior as an administrator.
4. **Accessibility is a requirement, not a feature.** WCAG 2.1 AA is the minimum bar for every component before it ships. Patients include elderly users, low-vision users, and users on low-end mobile devices.

## 1.3 Medical Trust Signals

- **Color discipline:** Red is reserved exclusively for errors, destructive actions, and critical clinical alerts. It is never decorative.
- **Status is triple-encoded:** every clinical status (e.g., "Abnormal result") is conveyed by color + icon + text label, so no state depends on color perception.
- **Data provenance:** AI-generated content is always visually distinguished (accent color, sparkle icon, "AI-generated" label) from clinician-entered data.
- **Legibility floor:** No interactive text below 14px; no clinical data below 14px; body default is 16px.

## 1.4 Accessibility Goals

| Goal | Target |
|---|---|
| WCAG conformance | 2.1 AA (2.2 AA where feasible) |
| Text contrast | ≥ 4.5:1 normal text, ≥ 3:1 large text |
| Non-text contrast (icons, borders, focus) | ≥ 3:1 |
| Touch targets | ≥ 44 × 44 px on mobile, ≥ 24 × 24 px pointer |
| Keyboard | 100% of functionality operable without a mouse |
| Motion | Full `prefers-reduced-motion` support |

---

# 2. Color System

> **Source of truth: `src/styles/tokens.css`.** This section describes it; when the two disagree, the token file wins and this section is the bug. `src/styles/palette.test.ts` and `src/styles/contrast.test.ts` enforce what is written here. The palette is ADR-0005's (`docs/adr/0005-emr-visual-language.md`), which replaced ADR-0001's six slate-blue values.

## 2.1 Architecture

Two layers, and application code only ever touches the second:

```
Primitive  →  --palette-blue-600, --palette-gray-200 …   the 17 approved colours, declared once in :root
Semantic   →  --color-surface, --color-primary …          what a colour is FOR; re-pointed per theme
```

Components consume the semantic layer through Tailwind (`bg-surface`, `text-text-secondary`, `border-border-strong`, `bg-sidebar`). A semantic token resolves to a primitive, or to a `color-mix(in srgb, …)` of two primitives when a role needs a step between them. `.dark` re-points the semantic tokens and never redeclares a primitive. The one place outside the token files that reads primitives directly is the auth brand panel (`BrandPanel.css`), which holds one look in both themes on purpose; `globals.css` reads them for the high-contrast overrides.

## 2.2 The Palette

The 17 primitives are the whole visual identity. Don't add one for looks: `palette.test.ts` fails on any primitive, or any colour literal in application code, that is not in this table.

**Blue — interaction**

| Primitive | HEX | Light theme | Dark theme |
|---|---|---|---|
| `--palette-blue-700` | `#1268AD` | `primary` (blue as text), `primary-fill-hover`, chart edges | — |
| `--palette-blue-600` | `#1677C8` | `primary-fill` (brand blue behind white ink), `focus-ring`, `sidebar-active`, chart 1 | Mixed into selection and chart 5 |
| `--palette-blue-400` | `#5AA6EA` | Chart 3 | `primary`, `primary-fill`, `focus-ring` |
| `--palette-blue-200` | `#D8EAFB` | Chart 5 | Chart 1 edge |
| `--palette-blue-100` | `#E8F2FC` | `primary-subtle` (selection) | Mixed into hover |

**Neutral — the light application**

| Primitive | HEX | Role |
|---|---|---|
| `--palette-white` | `#FFFFFF` | `surface`, `surface-overlay`, `text-inverse`, `primary-fill-text`, `control-knob`, `sidebar-active-text`, `ai-launcher` |
| `--palette-gray-50` | `#F5F7FA` | `surface-sunken`; `sidebar-text`; dark `text-primary` and AI accent |
| `--palette-gray-100` | `#F1F5F8` | `background` (the page) |
| `--palette-gray-200` | `#E5EAF0` | `border` (separator), `accent-subtle` |
| `--palette-gray-300` | `#A5AFBA` | `sidebar-text-muted`; dark `text-secondary`/`tertiary`; chart 4 |
| `--palette-gray-400` | `#7E8B99` | `border-strong` (and `scrollbar-thumb`, its copy), `text-disabled` |
| `--palette-gray-600` | `#5F6B78` | `text-secondary`, `text-tertiary` |
| `--palette-gray-900` | `#202832` | `text-primary`, `accent` (AI), chart 2 |

**Ink — the sidebar and the dark theme**

| Primitive | HEX | Role |
|---|---|---|
| `--palette-ink-950` | `#0B0D0F` | `sidebar`; `ai-launcher-border`; shadows and scrim |
| `--palette-ink-900` | `#111519` | `sidebar-raised`; dark `background`, dark `text-inverse` |
| `--palette-ink-800` | `#1B252E` | `sidebar-hover`, `sidebar-border`; dark `surface` |
| `--palette-ink-700` | `#25303B` | Dark `surface-overlay`, dark `accent-subtle` |

### Two blues: `primary` and `primary-fill`

`#1677C8` is the brand blue. It holds 4.66:1 under white ink, so it is the **fill** of a primary button (`bg-primary-fill`, hover `bg-primary-fill-hover`). It measures only 4.25:1 on the page and 4.11:1 on its own selection tint, so it cannot be the colour of a link or an active label. That role, `primary`, is `#1268AD`: 5.82:1 on the card, 5.31:1 on the page, 5.14:1 on `primary-subtle`. In the dark theme both roles are blue 400.

### Brief values that are not in the palette

ADR-0005's brief also proposed `#7B8794` (secondary text, 3.34:1 on the page; replaced by `#5F6B78`), `#9AA5B1` (muted text, 2.50:1), `#B7C0CA` (disabled text, 1.84:1, short of the 3:1 this system holds disabled text to) and `#EDF0F3` (a divider with no role distinct from `border`). None is a primitive.

### Exception: clinical status

Success, warning, error and info keep their red/amber/green/blue (light `#136C35` / `#8A5600` / `#C0271F` / `#0C6291`; dark `#6FC48D` / `#E0B055` / `#F0908A` / `#6FB6DD`). They carry clinical meaning, not brand, so they are the only literal colours in `tokens.css` outside the palette block, and they are the one part of the palette the patient app must share (`patient-parity.test.ts`). Status is never carried by colour alone: every status badge also carries an icon or dot and a label (`status-encoding.test.ts`).

## 2.3 Semantic Tokens

Ratios are against the card (`surface`) unless stated.

| Token | Light | Dark | Notes |
|---|---|---|---|
| `background` | gray-100 | ink-900 | Page |
| `surface` | white | ink-800 | Cards, panels, inputs |
| `surface-sunken` | gray-50 | ink-900 · 50% + ink-800 | Table headers, hovered rows, wells |
| `surface-overlay` | white | ink-700 | Menus, dropdowns, modals, drawers |
| `border` | gray-200 | ink-700 · 70% + gray-600 | Separator, 1.21:1 / 1.51:1 — held **below** 3:1 on purpose |
| `border-strong` | gray-400 | gray-300 · 35% + gray-600 | Every control boundary: ≥3:1 on every ground (light 3.17–3.48; dark 3.48–4.75 incl. overlay) |
| `text-primary` | gray-900 | gray-50 | 14.88:1 / 14.49:1 |
| `text-secondary` | gray-600 | gray-300 | 5.44:1 / 6.99:1; 4.96:1 / 8.24:1 on the page |
| `text-tertiary` | gray-600 | gray-300 | Same value as secondary. Metadata only (ADR-0001 §10) |
| `text-placeholder` | gray-600 · 85% + gray-400 | gray-300 · 70% + gray-600 | Quieter than tertiary, still ≥4.5:1 on every ground (light 4.61–5.05) |
| `text-disabled` | gray-400 | gray-300 · 35% + gray-600 | 3.48:1 / 4.03:1 — ≥3:1 and <4.5:1: never a text role |
| `text-inverse` | white | ink-900 | Ink on a filled tone: destructive, AI and status fills, count badges |
| `primary` | blue-700 | blue-400 | Blue as **text**: links, active labels, secondary/ghost button text, selected-row text |
| `primary-hover` | blue-700 · 70% + gray-900 | blue-400 · 50% + blue-100 | Link hover. Light darkens; dark lightens |
| `primary-pressed` | blue-700 · 45% + gray-900 | blue-400 · 70% + blue-600 | The primary button while pressed (its only consumer): label 7.81:1 / 5.96:1 |
| `primary-subtle` | blue-100 | blue-600 · 22% + ink-800 | Selected and active backgrounds |
| `primary-fill` | blue-600 | blue-400 | Blue as a **fill**: the primary button and every checked checkbox, radio and switch. 4.66:1 / 5.98:1 against the card |
| `primary-fill-hover` | blue-700 | blue-400 · 50% + blue-100 | Label 5.82:1 / 10.87:1 |
| `primary-fill-text` | white | ink-900 | Ink **on** the fill: button label, checkbox tick, checked switch knob. 4.66:1 / 7.05:1 |
| `tab-active-text` | gray-900 | gray-50 | Selected tab label, 14.88:1 / 14.49:1 |
| `tab-indicator` | blue-700 | blue-400 | Selected tab underline, 5.82:1 / 5.98:1 against the card |
| `accent` (AI) | gray-900 | gray-50 | Told apart by its left rule and "AI-generated" label, not by hue |
| `accent-subtle` | gray-200 | ink-700 | AI panel and chat tint |
| `ai-badge` / `ai-badge-text` | gray-200 / gray-900 | ink-700 / gray-50 | The AI badge, 12.30:1 / 12.51:1 |
| `ai-launcher` / `ai-launcher-border` | white / ink-950 | white / ink-950 | The navbar Medora AI button — identical in both themes. Boundary: the edge 19.47:1 on the light navbar, the fill 15.55:1 on the dark one |
| `focus-ring` | blue-600 | blue-400 | 4.66:1 / 5.98:1 |
| `scrim` | ink-950 at 55% | ink-950 at 72% | |
| `scrollbar-thumb` | = `border-strong` | = `border-strong` | A **copy** (see below). ≥3:1 on every ground including the overlay |
| `sidebar` | ink-950 | ink-950 | The rail. **All `sidebar-*` roles are identical in both themes** |
| `sidebar-raised` | ink-900 | ink-900 | Brand header / user footer band |
| `sidebar-hover` | ink-800 | ink-800 | Hovered item; `sidebar-border` shares it |
| `sidebar-text` | gray-50 | gray-50 | 18.14:1 on the rail, 14.49:1 hovered |
| `sidebar-text-muted` | gray-300 | gray-300 | Section labels, icons: 8.75:1, 6.99:1 hovered |
| `sidebar-active` | blue-600 | blue-600 | Current item; 4.18:1 against the rail (1.4.11) |
| `sidebar-active-text` | white | white | 4.66:1 on `sidebar-active` |
| `chart-1 … 5` | blue-600, gray-900, blue-400, gray-300, blue-200 | blue-400, gray-50, blue-600, gray-600, blue-600 · 40% + ink-800 | Blue alternates with neutral, so adjacent series differ in hue and luminance; every mark draws its `-edge` (≥4.66:1 light, ≥5.98:1 dark) |

**Copies.** `secondary`, `secondary-hover` and `secondary-subtle` (a retired role scheduled for removal) and `scrollbar-thumb` are not roles with values of their own: `tokens.css` declares each once, in `:root`, as `var(--color-primary)`, `var(--color-primary-hover)`, `var(--color-primary-subtle)` and `var(--color-border-strong)`, so each always equals its source in both themes. The Theme Playground lists them as copies, not editor rows (ADR-0005 §9).

**Component roles** (`primary-fill-text`, `tab-*`, `ai-badge*`) exist so a component can be re-themed without moving a shared role. Their defaults equal what the component already painted. Components without one reuse the shared roles: secondary and ghost buttons and links take `primary`/`primary-hover`; destructive buttons `error`/`error-hover` with `text-inverse`; selected rows and menu options `primary-subtle`; the nine filled AI buttons `accent`.

High contrast (`html[data-contrast='high']`, `globals.css`) moves borders and secondary/tertiary text one more step along the ladder (light: border gray-400, border-strong gray-600, text gray-900, placeholder gray-600; dark: border gray-600, border-strong gray-300, text gray-50, placeholder gray-300).

## 2.4 Interaction State Rules

| State | Light | Dark |
|---|---|---|
| **Hover** | Fills darken (`primary-fill-hover`, `primary-hover`); neutral controls take `surface-sunken` | Fills lighten toward blue-100 |
| **Pressed** | `primary-pressed` (blue-700 toward gray-900) | blue-400 toward blue-600 |
| **Disabled** | `surface-sunken` fill, `text-disabled`, `border`; no hover | Same tokens |
| **Focus** | 2px ring in `focus-ring`, 2px offset in `surface` | Same |
| **Selected** | `primary-subtle` background + `primary` text or indicator | Same |

Colour is never the only carrier (WCAG 1.4.1): underline a link in body copy, give a selected item an indicator or a check, and give a status an icon and a label.

---

# 3. Typography

## 3.1 Font Families

| Role | Stack | Rationale |
|---|---|---|
| **UI & Content** | `Inter, "Segoe UI", system-ui, -apple-system, sans-serif` | Inter is engineered for screens: tall x-height, open apertures, and disambiguated characters (I/l/1, 0/O) — critical for dosages, IDs, and lab values. Variable font keeps the payload to one file. |
| **Data / Mono** | `"JetBrains Mono", "Cascadia Code", Consolas, monospace` | Patient IDs, prescription codes, API keys, timestamps in logs. Fixed-width prevents misreading adjacent digits. |

**Numerals:** All tables, vitals, and lab data use Inter's **tabular figures** (`font-variant-numeric: tabular-nums`) so columns of numbers align vertically.

Load Inter as a self-hosted variable font (weights 400–700) with `font-display: swap`. Do not load display-only fonts — one family keeps the platform fast on hospital networks.

## 3.2 Type Scale

A 1.25-ratio scale anchored at 16px. All values in px with rem equivalents (root = 16px).

| Token | Size | Line height | Weight | Letter spacing | Usage |
|---|---|---|---|---|---|
| `display` | 60px / 3.75rem | 64px (1.07) | 700 | -0.025em | Marketing/landing hero only — never inside the app |
| `h1` | 36px / 2.25rem | 44px (1.22) | 700 | -0.02em | Page titles (one per page) |
| `h2` | 30px / 1.875rem | 38px (1.27) | 600 | -0.015em | Major section titles |
| `h3` | 24px / 1.5rem | 32px (1.33) | 600 | -0.01em | Card group titles, modal titles |
| `h4` | 20px / 1.25rem | 28px (1.4) | 600 | -0.005em | Card titles, drawer titles |
| `h5` | 18px / 1.125rem | 26px (1.44) | 600 | 0 | Sub-sections, table group headers |
| `h6` | 16px / 1rem | 24px (1.5) | 600 | 0 | Minor headings, form section labels |
| `body-lg` | 18px / 1.125rem | 28px (1.56) | 400 | 0 | Patient-facing reading content |
| `body` | 16px / 1rem | 24px (1.5) | 400 | 0 | Default body, form values, table cells |
| `body-sm` | 14px / 0.875rem | 20px (1.43) | 400 | 0 | Secondary text, dense tables, form labels |
| `caption` | 12px / 0.75rem | 16px (1.33) | 400 | +0.01em | Timestamps, meta, helper text |
| `overline` | 11px / 0.6875rem | 16px | 600 | +0.08em, uppercase | Eyebrow labels, table column headers |
| `button` | 14px / 0.875rem | 20px | 600 | +0.01em | Button labels (md); lg buttons use 16px |
| `code` | 14px / 0.875rem | 20px | 450 (mono) | 0 | IDs, codes |

**As implemented (`src/styles/tokens.css`).** The table above is the v1.0.0 baseline. The app ships the enterprise-dense scale Phase 17 adopted for data-heavy clinical screens, and that scale is what the tokens hold:

| Token | Size | Line height | Note |
|---|---|---|---|
| `h1` | 24px | 32px | One per page |
| `h2` | 18px | 26px | |
| `h3` | 16px | 23px | |
| `h4` | 14px | 21px | |
| `h5` | 13px | 19px | |
| `h6` | 12px | 17px | |
| `body` | 13px | 20px | |
| `body-sm` | 12px | 18px | |
| `caption` | **11px with a mouse · 12px on touch** | 16px | DEC-017: `@media (pointer: coarse)` sets `--text-caption` to 12px — the same query as DEC-008's touch targets |

The caption rule is the one place the two tables meet: with a fine pointer it stays at the dense 11px; on a finger-driven screen it is this section's 12px, which is also where Lighthouse's mobile legibility audit draws its line. Change a size in `tokens.css`, never per component.

## 3.3 Weights

| Weight | Value | Use |
|---|---|---|
| Regular | 400 | Body, captions |
| Medium | 500 | Emphasized body, table values, input text |
| Semibold | 600 | Headings h2–h6, buttons, labels, badges |
| Bold | 700 | h1, display, key metrics |

Never use weights below 400 (thin weights fail legibility on low-DPI hospital monitors). Never bold entire paragraphs.

## 3.4 Rules

- Body line length: 45–75 characters (`max-width: 65ch` for prose).
- Minimum interactive/clinical text size: **14px**. 12px is meta-information only.
- Headings step down without skipping levels (h1 → h2 → h3) for screen-reader document structure.
- Patient-facing reading surfaces (instructions, consent, AI explanations) default to `body-lg` 18px.

---

# 4. Spacing System

## 4.1 The 4px Grid

All spacing, sizing, and positioning snap to a **4px base grid**. Rationale: divisible across common screen densities, maps 1:1 to Tailwind's default scale (`1` = 4px), and keeps vertical rhythm aligned with line heights (all multiples of 4).

## 4.2 Spacing Scale

| Token | px | rem | Typical use |
|---|---|---|---|
| `space-0` | 0 | 0 | Reset |
| `space-0.5` | 2 | 0.125 | Icon-to-badge micro gaps |
| `space-1` | 4 | 0.25 | Icon–label gap (tight), badge padding-y |
| `space-1.5` | 6 | 0.375 | Chip padding-y |
| `space-2` | 8 | 0.5 | Icon–label gap, inline element gaps |
| `space-3` | 12 | 0.75 | Input padding-y, gaps inside compact components |
| `space-4` | 16 | 1 | **Default component padding**, form field gap |
| `space-5` | 20 | 1.25 | Card padding (compact) |
| `space-6` | 24 | 1.5 | **Card padding (default)**, gaps between cards |
| `space-8` | 32 | 2 | Section-internal spacing, modal padding |
| `space-10` | 40 | 2.5 | Large grouping gaps |
| `space-12` | 48 | 3 | Section separation (mobile) |
| `space-16` | 64 | 4 | **Section separation (desktop)** |
| `space-20` | 80 | 5 | Page-level top/bottom padding |
| `space-24` | 96 | 6 | Hero/landing sections |

## 4.3 Container Widths

| Token | Width | Use |
|---|---|---|
| `container-sm` | 640px | Auth forms, focused single-task flows |
| `container-md` | 768px | Reading content, settings pages |
| `container-lg` | 1024px | Standard forms with sidebars |
| `container-xl` | 1280px | **Default app container** (dashboards) |
| `container-2xl` | 1440px | Data-dense admin tables, analytics |
| `container-prose` | 65ch | Long-form text |

Containers center with `margin-inline: auto` and gutter padding: 16px (mobile), 24px (tablet), 32px (desktop).

## 4.4 Layout Spacing Rules

- **Between unrelated sections:** `space-16` desktop / `space-12` mobile.
- **Between cards in a grid:** `space-6` (24px).
- **Inside cards:** `space-6` padding; `space-4` between internal elements.
- **Form fields:** `space-4` between fields, `space-1.5` (6px) label-to-input, `space-8` between form sections.
- **Related < unrelated:** the gap between related items must always be visibly smaller than the gap to the next group (Gestalt proximity).

---

# 5. Border Radius

Radii communicate component hierarchy: the larger the surface, the larger the radius. Nested elements use a radius ≤ parent radius − padding (prevents "corner collision").

| Token | Value | Applied to |
|---|---|---|
| `radius-none` | 0 | Full-bleed surfaces, table containers inside cards |
| `radius-xs` | 4px | Checkboxes, mini-tags, code inline |
| `radius-sm` | 6px | Badges (rectangular), tooltips, menu items |
| `radius-md` | 8px | **Buttons, inputs, selects, textareas, dropdown panels** |
| `radius-lg` | 12px | **Cards, alerts, popovers, table containers** |
| `radius-xl` | 16px | **Modals, drawers (attached edge = 0), large panels** |
| `radius-2xl` | 24px | Feature/hero cards, AI assistant panel |
| `radius-full` | 9999px | Pills, chips, avatars, switch, circular icon buttons |

**Component assignments:** Buttons `md` · Inputs `md` · Cards `lg` · Dialogs `xl` · Badges `full` (pill) or `sm` (rectangular count badges) · Tables `lg` on the wrapping container, 0 on cells.

**As implemented (`src/styles/tokens.css`).** The table above is the v1.0.0 baseline. Wave 1b (ADR-0001 §11) reduced the ladder to the three decisions it actually encoded, and those are the only radius tokens the app has:

| Token | Value | Applied to |
|---|---|---|
| `radius-control` (`rounded-control`) | 4px | Small controls inside a larger one: field icon actions, menu items, tooltips, select options |
| `radius-surface` (`rounded-surface`) | 8px | Buttons, inputs, selects, cards, panels, menus, popovers, modals, drawers, toasts |
| `radius-pill` (`rounded-pill`) | 9999px | Badges, chips, avatars, switch, spinners, circular icon buttons |

`check-retired-tokens.mjs` (part of `npm run lint`) fails on any use of the retired `xs`…`2xl` names.

---

# 6. Elevation

> **Source of truth: `src/styles/tokens.css`** (the Elevation block). Wave 1b (ADR-0001) replaced the v1.0.0 five-step shadow scale with named roles; ADR-0005 added `shadow-card`. The retired `shadow-xs`…`shadow-xl` names fail `npm run lint` (`check-retired-tokens.mjs`).

## 6.1 Shadow Philosophy

Elevation is carried by a **1px border first**. A shadow names the thing that lifts or floats, and there are only three: a card's hairline lift, a transient overlay, and a modal. In light mode shadows are cast in `--palette-ink-950` (the palette's darkest value) at low opacity; in dark mode they are neutral black, because nothing in the palette is darker than the page they fall on, and overlays add a 1px `border` ring for separation.

## 6.2 Shadow Tokens

| Token (Tailwind) | Light value | Dark value | Used for |
|---|---|---|---|
| `shadow-card` | `0 1px 2px` ink-950 at 6% | `0 1px 2px rgba(0,0,0,0.3)` | A resting card or panel, **under** its 1px `border` — so a white card separates from the gray page (ADR-0005). Never a substitute for the border |
| `shadow-popover` | `0 2px 6px` ink-950 12% + `0 1px 2px` ink-950 8% | 1px `border` ring + `0 2px 6px rgba(0,0,0,0.4)` | Dropdowns, selects, tooltips, popovers; an interactive card on hover |
| `shadow-modal` | `0 8px 28px` ink-950 18% + `0 2px 8px` ink-950 10% | 1px `border` ring + `0 8px 28px rgba(0,0,0,0.5)` | Modals and drawers (with `scrim`), toasts |
| `shadow-focus` | `0 0 0 2px surface, 0 0 0 4px focus-ring` | same | Keyboard focus ring (double-ring). Not elevation |

## 6.3 Elevation Assignments

| Layer | Elevation | z-index token |
|---|---|---|
| Canvas / page | none | — |
| Cards, panels (resting) | 1px `border` + `shadow-card` | — |
| Interactive cards (hover) | `border-strong` + `shadow-popover` + translateY(-1px) | — |
| Sticky headers / navbar | 1px bottom `border`; no shadow | `sticky` (100) |
| Dropdowns, selects, tooltips, popovers | `shadow-popover` | `dropdown` (1000) |
| Drawers | `shadow-modal` + scrim | `drawer` (1100) |
| Modals | `shadow-modal` + scrim | `modal` (1200) |
| Toasts | `shadow-modal` | `toast` (1300) |

Rules: a resting card never reaches for `shadow-popover` or `shadow-modal` (only an interactive card, on hover, takes `shadow-popover`); non-interactive cards do **not** change elevation on hover; if a new surface seems to need a shadow, first name which of the three roles it serves.

---

# 7. Iconography

## 7.1 Icon System

**Library: Lucide** (already in stack). Outline style, geometric, consistent 24px grid — matches the clinical, precise brand tone better than filled icons.

| Property | Standard |
|---|---|
| Style | Outline (stroke-based); no filled variants except status dots |
| Stroke width | **1.75px** at 24px (Lucide default 2 is slightly heavy next to Inter 400; 1.75 optically matches). Use 2px at ≤16px sizes to keep legibility. |
| Corner style | Rounded caps and joins (Lucide default) |
| Grid sizes | `16px` (inline with body-sm, table meta) · `20px` (buttons, inputs, menus) · `24px` (navigation, section headers) · `32px` (empty states, feature intros) |
| Color | Inherit `currentColor`; functional icons use `text-secondary`, decorative use `text-tertiary` |
| Touch target | Icon-only buttons wrap icons in ≥ 40×40px (44 on mobile) hit areas |

## 7.2 Usage Rules

- Icons **accompany** labels; icon-only is allowed solely for universally understood actions (close ×, search, chevrons) and always carries `aria-label` + tooltip.
- One icon per concept platform-wide (e.g., `calendar-days` = appointments everywhere; never mix with `calendar-clock` for the same concept).
- Directional icons flip in RTL; medical icons never flip.

## 7.3 Medical Icon Guidelines

| Concept | Lucide icon | Notes |
|---|---|---|
| Appointments | `calendar-days` | |
| Patients | `users` / `user-round` | Never use bed/wheelchair icons to represent patients generically |
| Doctors / staff | `stethoscope` | |
| Medical records | `file-text` / `folder-heart` | |
| Prescriptions | `pill` | |
| Vitals | `activity` (waveform) | |
| Lab results | `flask-conical` | |
| Emergency / critical | `triangle-alert` | Paired with error color; reserved for clinical severity |
| AI assistant | `sparkles` | Always in accent violet — the AI signature |
| Messaging | `message-square` | |
| Heart rate / cardio | `heart-pulse` | `heart` alone is reserved for favorites |

Prohibitions: no red crosses (protected symbol — Geneva Conventions; use `cross` glyphs only in neutral colors if at all), no skulls/biohazard for error states, no religious or culturally specific symbols, no humorous icons in clinical contexts.

---

# 8. Component Standards

Every component must define: **anatomy, variants, sizes, states (default / hover / pressed / focus / disabled / loading / error where applicable), keyboard behavior, and ARIA contract.** Below are the binding standards.

> **Colour, radius and shadow in this section.** The behaviour, anatomy and ARIA contracts below are binding. Colour, radius and shadow are governed by §2, §5 "As implemented" and §6: where a spec here still names a v1.0.0 value (a Tailwind step such as `slate-100` or `primary-600`, a hex such as `#BAE6FD`, a radius such as `md`/`lg`, a shadow such as `shadow-md`), read it as the semantic role the shipped component uses (`surface-sunken`, `primary`, `rounded-surface`, `shadow-popover` …). §8.1, §8.16, §8.17 and §8.18 have been restated in role names (ADR-0005).

## 8.1 Buttons

**Variants**

| Variant | Fill | Text | Border | Use |
|---|---|---|---|---|
| Primary | `primary-fill` (#1677C8; hover `primary-fill-hover`, pressed `primary-pressed`) | `primary-fill-text` (white, 4.66:1) | none | The one main action per view |
| Secondary | `surface` | `primary` | 1px `border-strong` | Supporting actions |
| Tertiary / Ghost | transparent | `primary` | none | Low-emphasis, toolbars, table rows |
| Destructive | `error` (hover `error-hover`) | `text-inverse` | none | Delete, cancel appointment |
| Destructive-secondary | `surface` | `error` | 1px `error` | Less prominent destructive |
| AI | `accent` | `text-inverse` | none | AI-triggering actions only |

**Sizes**

| Size | Height | Padding-x | Text | Icon |
|---|---|---|---|---|
| `sm` | 32px | 12px | 14px/600 | 16px |
| `md` (default) | 40px | 16px | 14px/600 | 20px |
| `lg` | 48px | 20px | 16px/600 | 20px |

**States:** hover = the variant's `-hover` fill (or a `surface-sunken` wash for secondary/ghost); pressed = `primary-pressed` / `border` wash; focus = `shadow-focus` ring; disabled = `surface-sunken` fill / `text-disabled` text / `border`, `cursor: not-allowed`; loading = spinner replaces icon, label persists (never spinner-only), button keeps its width and is `aria-disabled`.

**Rules:** radius `md` (8px); one primary button per view; icon-to-label gap 8px; never two adjacent destructive buttons; min touch target 44px on mobile (sm buttons get invisible hit-area extension). Full-width buttons only in mobile sheets and auth forms.

## 8.2 Inputs (Text Field)

**Anatomy:** Label (14px/500, `text-secondary`, 6px above input) - Field - optional leading/trailing icon (20px) - Helper text or error (12px, 6px below) - optional required mark `*` in `error-600`.

| Property | Value |
|---|---|
| Height | 40px (md, default) - 48px (lg, patient-facing) |
| Padding | 12px horizontal; with icon: 40px on icon side |
| Border | 1px `border-strong` (#CBD5E1); radius `md` |
| Background | `surface` |
| Text | 16px/400 `text-primary` (16px prevents iOS auto-zoom); placeholder `slate-400` |

**States:** hover border `slate-400`; focus border `primary-600` + focus ring; error border `error-600` + `alert-circle` icon + error text (replaces helper, `role="alert"`); disabled fill `slate-100`, text `slate-400`; read-only fill `slate-50`, no border change on focus.

**Rules:** every input has a visible `<label>` — placeholders are never labels. Error messages state *how to fix* ("Enter a date in DD/MM/YYYY format"), not just "Invalid".

## 8.3 Textarea

Inherits all input styling. Min-height 96px (3 rows), vertical resize only, padding 12px. Optional character counter bottom-right (caption, `text-tertiary`; turns `error-600` when exceeded). Auto-grow variant capped at 8 rows then scrolls (used in messaging and AI chat).

## 8.4 Select

Trigger matches input styling exactly (40px, radius `md`) with trailing `chevron-down` 20px `text-secondary` (rotates 180deg when open). Menu: `surface-overlay`, radius `md`, `shadow-md`, max-height 320px scroll, 4px padding. Options: 36px height, 8px 12px padding, radius `sm`; hover `slate-100`; selected `primary-subtle` bg + trailing `check` icon + `primary-600` text. Supports type-ahead, option groups (overline headers), and a searchable variant (search input pinned at top) when more than 10 options. Keyboard: Up/Down navigate, Enter/Space select, Esc close, Home/End jump. ARIA: `role="combobox"` + `aria-expanded` + listbox/option pattern.

## 8.5 Checkbox

18x18px box, radius `xs` (4px), 2px border `border-strong`. Checked: `primary-fill` fill and border, 2px check stroke in `primary-fill-text`. Indeterminate: `primary-fill` fill with minus mark. Label 14-16px, 8px gap, clickable. Focus ring on the box only. Disabled: `slate-100` fill, `slate-300` border. Touch target extends to 44px. Motion: 120ms check-draw.

## 8.6 Radio

20x20px circle, 2px border. Selected: `primary-fill` border with 10px inner dot in `primary-fill`. Grouped in `fieldset` + `legend`; vertical stack with 12px gap (horizontal allowed for 3 or fewer short options). Arrow keys move selection within the group (roving tabindex). Use radios for 2-5 options; use Select above 5.

## 8.7 Switch

Track 44x24px `radius-full`; thumb 20px white circle, 2px inset, `shadow-xs`. Off: `border-strong` track, `control-knob` thumb (3.48:1 / 3.86:1). On: `primary-fill` track with a `primary-fill-text` thumb (4.66:1 / 7.05:1); a disabled switch keeps the light thumb. Thumb slides 150ms ease-out. Switches apply **immediately** (no submit) — use a checkbox if a save action follows. Label sits left, switch right, in settings rows. ARIA `role="switch"` + `aria-checked`. Never used for destructive or clinical-impact settings without confirmation.

## 8.8 Badge

Static status descriptor (non-interactive). Height 22px, padding 2px 10px, 12px/600 text, radius `full`. Subtle style: 50-step background + 700-step text + optional 8px status dot. Semantic mapping (platform-wide, fixed): **Confirmed/Normal** = success; **Pending/Expiring** = warning; **Cancelled/Critical** = error; **Scheduled/Info** = info; **Completed/Neutral** = slate; **AI-generated** = `ai-badge` fill with `ai-badge-text` (outline: `accent` ring). Always dot-or-icon + text; never color alone. Count badges: `error-600` filled circle, min-width 18px, white 11px/700 text.

## 8.9 Chip

Interactive sibling of Badge (filters, selections, tags). Height 32px, padding 6px 12px, radius `full`, 14px/500 text, 1px `border-strong`. Selected: `primary-subtle` bg, `primary-600` border and text, optional leading check. Removable: trailing x-icon inside a 16px hit area with its own `aria-label` ("Remove filter: Cardiology"). Keyboard: Enter/Space toggles, Delete/Backspace removes.

## 8.10 Avatar

Circle (`radius-full`). Sizes: 24 (tables) - 32 (nav, comments) - 40 (lists, default) - 64 (profile headers) - 96 (profile pages). Fallback: initials (max 2) on a deterministic color from a fixed 8-hue muted palette (never status colors), white text at 4.5:1 minimum. Role ring variant: 2px ring — teal = doctor, blue = staff, none = patient. Status dot bottom-right (25% of avatar size, 2px surface border): success = online. Groups overlap -8px, max 4 visible + "+N" overflow. Images always carry `alt` with the person's name, or `alt=""` when the name is rendered adjacent.

## 8.11 Tooltip

Non-interactive text hint only (max 1 sentence; no links or buttons — use Popover for those). `slate-900` bg (light mode) / `slate-700` (dark), white 12px/500 text, padding 6px 10px, radius `sm`, `shadow-md`, max-width 240px, 6px arrow. Delay: 300ms in, 0ms out; also shown on keyboard focus (WCAG 1.4.13: dismissible with Esc, hoverable, persistent). Never hide essential information (dosage, warnings) inside tooltips.

## 8.12 Popover

Interactive floating panel (filters, mini-forms, event details). `surface-overlay`, radius `lg`, `shadow-lg`, 1px `border`, padding 16px, max-width 360px. Opens on click, closes on Esc, outside click, or explicit close button. Focus moves into the popover on open and returns to the trigger on close. Anchor-positioned with 8px offset; auto-flips at viewport edges.

## 8.13 Dropdown (Menu)

Action menus (row actions, profile menu). Panel: `surface-overlay`, radius `md`, `shadow-md`, 1px `border`, 4px padding, min-width 180px. Items: 36px, radius `sm`, 14px text, optional 20px leading icon; hover `slate-100`. Destructive items: `error-600` text, separated by a divider, always last. Group dividers: 1px `border` with 4px vertical margins. Keyboard: full menu pattern (arrows, Home/End, type-ahead, Esc). ARIA `role="menu"` / `menuitem`. Maximum one level of nesting; prefer none.

## 8.14 Modal (Dialog)

**Sizes:** `sm` 400px (confirmations) - `md` 560px (forms, default) - `lg` 720px (rich content) - full-screen bottom sheet on mobile (radius 16px top corners only). Radius `xl`, `shadow-xl`, scrim `rgba(2,6,23,0.55)`.

**Anatomy:** Header (h3 title + close button, padding 24px, optional 1px divider) - Body (padding 24px, scrolls independently, max-height 70vh) - Footer (right-aligned actions: primary rightmost, cancel to its left; padding 16px 24px).

**Behavior:** focus trapped; initial focus = first field or the least-destructive action; Esc and scrim click close (except confirmation dialogs, which require an explicit choice); focus returns to the trigger on close; background is inert and scroll-locked. Destructive confirmations: the title states the consequence ("Cancel this appointment?") and the destructive button is labeled with the verb ("Cancel appointment") — never "OK"/"Yes". ARIA: `role="dialog"` (or `alertdialog`), `aria-modal="true"`, `aria-labelledby` pointing at the title. Never stack more than two modals; prefer zero stacking.

## 8.15 Drawer

Side panel for context-preserving detail (patient summary, filters, notifications). Widths: 400px (sm) - 480px (md, default) - 640px (lg); mobile = full-width or bottom sheet. Slides from the right (LTR) in 250ms ease-out, with scrim. Attached edge has radius 0. Same header/body/footer anatomy and focus rules as Modal. Use a drawer when the user needs the underlying page context; a modal when the task is self-contained; a page when the task exceeds roughly two screens of content.

## 8.16 Sidebar (App Navigation)

Width 264px expanded - 64px collapsed (icons only: no hover tooltips or `title` labels on the collapsed rail; every icon keeps its accessible name via `aria-label`, and a group such as Pharmacy opens its menu on click) - overlay drawer below 1024px. **Colour (ADR-0005):** the rail is charcoal in both themes — `sidebar` background, `sidebar-raised` brand/footer bands, `sidebar-border` dividers, `sidebar-text` labels, `sidebar-text-muted` section labels and icons, `sidebar-hover` on hover; the active item is `sidebar-active` (#1677C8) with `sidebar-active-text` (white) plus an indicator bar — the bar ensures the active state survives color-blindness. *The shell still paints the rail in `surface` / `primary-subtle` until the sidebar redesign adopts these roles.* Items: 40px height, 20px icon + 14px/500 label, 12px horizontal padding, 4px between items. Sections separated by overline group labels. Role-based menus (patient, doctor, receptionist, admin) share identical structure and ordering logic. Bottom-pinned: settings, help, the light/dark switch (`ThemeSwitch`: sun and moon halves, no visible label, stacked vertically on the collapsed rail), then the user card. The same switch sits in the header of the sign-in screens. Landmark `<nav aria-label="Main">`; collapse state persists per user.

## 8.17 Navbar (Top Bar)

Height 64px desktop / 56px mobile, `surface` bg, 1px bottom `border`, no shadow (§6.3). Contents (LTR): sidebar toggle - breadcrumb / page context - global search (centered, 480px max) - notifications bell (count badge) - AI assistant entry (`ai-launcher`: white tile, 1px `ai-launcher-border` edge, both themes) - avatar menu. Z-index layer `sticky`. Never place primary page actions in the navbar — they belong in the page header.

## 8.18 Card

The base content container. `surface` bg, radius `surface`, 1px `border` + `shadow-card` (ADR-0005; *the shared Card adopts `shadow-card` in the component pass — until then it is border-only*), padding 24px (16px compact). Anatomy: optional header (h4 title + caption subtitle + trailing action or menu) - body - optional footer (top border, padding 16px 24px). Interactive cards (whole card clickable): hover `border-strong` + `shadow-popover` + translateY(-1px) over 150ms, focus ring on the card, and exactly **one** interactive element (the card itself) — inner buttons require a non-clickable card instead. Metric/KPI variant: overline label + 30px/700 value + delta badge. Never nest cards.

## 8.19 Table

For dense clinical and admin data. Semantic `<table>` markup always — never div-based table lookalikes.

| Element | Spec |
|---|---|
| Container | Card-style wrapper: radius `lg`, 1px border, `surface` |
| Header row | `surface-sunken` bg, overline 12px/600 uppercase `text-secondary`, height 44px, sticky on scroll |
| Rows | 52px default (44px dense), 1px bottom `border`; hover `slate-50`; selected `primary-subtle` |
| Cells | padding 12px 16px, 14px text; numbers right-aligned with `tabular-nums`; IDs in mono where scannability matters |
| Row actions | Ghost icon button (`more-vertical`) opening a Dropdown, last column, always visible (not hover-only) |
| Sorting | Clickable header with 16px arrow icon; `aria-sort` on the active column |
| Selection | 48px checkbox column; header checkbox = select-all with indeterminate state |
| Overflow | Horizontal scroll within the container with sticky first column; never squash columns below readable widths |

Empty, loading, and error states render inside the table body area (see 8.31-8.33). Pagination attaches below (8.26). Mobile: tables with more than 4 columns collapse to stacked key-value cards.

## 8.20 Tabs

Line style (default): 44px height, 14px/500 labels in `text-secondary`; active = `tab-active-text` + 2px `tab-indicator` underline (slides between tabs in 200ms); hover = `text-primary`. Enclosed style (segmented control) for tight toggles: `slate-100` track with radius `md`, active segment white + `shadow-xs`. Optional count badges. Keyboard: Left/Right arrows move focus (roving tabindex) with automatic activation. ARIA tablist/tab/tabpanel. Maximum 6 tabs; overflow scrolls horizontally with an edge fade — never wrap to two rows. Tabs switch views; they never trigger actions.

## 8.21 Accordion

Progressive disclosure (FAQ, record sections). Header row 56px: h6 title left, `chevron-down` right (rotates 180deg over 200ms); hover `slate-50`. Panel: body text, padding 0 16px 16px, height animates 200ms ease-out. Items divided by 1px `border`; container radius `lg` when card-wrapped. Header is a `<button>` with `aria-expanded` + `aria-controls`. Single-open mode for wizards; multi-open for records. Never hide critical clinical warnings inside collapsed sections.

## 8.22 Alert (Inline Banner)

Persistent contextual message in the page flow. Radius `lg`, padding 16px, 1px border. Layout: 20px icon + title (14px/600) + body (14px) + optional actions + optional dismiss button.

| Variant | Background | Border | Icon and title color |
|---|---|---|---|
| Info | `#F0F9FF` | `#BAE6FD` | `info`, `#0369A1` |
| Success | `#F0FDF4` | `#BBF7D0` | `check-circle`, `#15803D` |
| Warning | `#FFFBEB` | `#FDE68A` | `triangle-alert`, `#B45309` |
| Error | `#FEF2F2` | `#FECACA` | `alert-circle`, `#B91C1C` |

Critical clinical alerts (allergy conflicts, abnormal vitals) use the Error variant, are **not dismissible**, and sit at the top of the content area. Error and warning alerts use `role="alert"`; info and success use `role="status"`.

## 8.23 Toast

Transient feedback for completed async actions. Position: top-right on desktop (stack max 3, newest on top), top-center on mobile. Width 360px, `surface-overlay` bg, radius `lg`, `shadow-lg`, padding 16px. Leading status icon, title + optional one-line detail, optional single action (e.g., "Undo"), dismiss button. Duration: success/info 5s, warning 8s, **errors persist until dismissed**. Timer pauses on hover and focus. Announced via an `aria-live="polite"` region (`assertive` for errors). Never put critical clinical information in a toast — it can be missed; use Alert or Modal instead.

## 8.24 Progress

**Linear bar:** 8px height (4px slim variant), track `slate-200`, radius `full`, fill `primary-600`; label + percentage above when space allows; `role="progressbar"` with `aria-valuenow`. **Circular:** 16/24/48px, 3px stroke — uploads and AI processing. **Steps (wizard):** numbered 32px circles joined by 2px connectors; completed = `primary-600` fill + check, current = 2px primary ring, upcoming = `slate-300`; labels beneath. Indeterminate variants sweep the fill at 1.2s linear infinite. Prefer determinate whenever the total is knowable.

## 8.25 Skeleton

Loading placeholder that mirrors the final layout (prevents layout shift). Base `slate-200` (light) / `slate-700` (dark); radius matches the element it stands in for (text lines = `sm`, avatars = `full`, cards = `lg`). Animation: 1.6s shimmer sweep; under reduced motion, static. Text lines 12px tall; the last line is 60% width. Use skeletons for initial loads over 300ms; use spinners only for user-triggered inline actions. Wrap loading regions in `aria-busy="true"`; do not announce each skeleton.

## 8.26 Pagination

Attached below tables and lists. Left: "Showing 1-25 of 312". Right: prev/next icon buttons + page numbers (36px square ghost buttons; current = `primary-subtle` + `primary-600` + `aria-current="page"`), ellipsis for gaps, optional page-size select (10/25/50). Prev is disabled on the first page — never hidden. Mobile: prev/next + "Page 3 of 13" only. Infinite scroll is prohibited on clinical data tables — users must be able to cite "page 3 of the results".

## 8.27 Breadcrumb

Location trail in the page header. 14px `text-secondary` links (hover: `text-primary` + underline) separated by 16px `chevron-right` in `slate-400`; current page is `text-primary`/500, not a link, with `aria-current="page"`. Wrapped in `<nav aria-label="Breadcrumb">` + `<ol>`. Collapse middle items to an ellipsis dropdown beyond 4 levels. Mobile: show only a "Back to parent" link.

## 8.28 Search

**Global search (navbar):** input with leading `search` icon, placeholder "Search patients, appointments...", a `Ctrl+K` shortcut hint chip; expands into a command-palette overlay (modal pattern) with grouped results (Patients / Appointments / Records), keyboard navigation, recent searches, and highlighted match substrings. **Contextual search (tables/lists):** standard input variant, debounced 300ms, result count announced via `aria-live` ("14 results"), clear button when non-empty. Empty results always render the Empty State pattern echoing the query, with a "Clear search" action.

## 8.29 Date Picker

Input (trailing `calendar-days` icon) + calendar popover (`shadow-lg`, radius `lg`, padding 16px). **Typed entry is always allowed** (localized format in the placeholder, e.g. DD/MM/YYYY) — never force pointer-only date entry. Range variant: two inputs, one calendar, range highlighted with `primary-subtle` and 600-filled endpoints. Time selection: appended select with 15-minute intervals. Constraints: disabled dates (past dates, doctor unavailability) are `slate-300` and `aria-disabled`; booking flows mark available days with a subtle success dot. Keyboard: arrows move by day, PgUp/PgDn by month, Home/End to week bounds, Enter selects; ARIA grid pattern.

## 8.30 Calendar (Scheduling View)

Full-page month/week/day views for appointment management. Grid: 1px `border` cells on `surface`; today = `primary-subtle` wash + bold date; weekends `surface-sunken`. Events: chips with a 4px left bar colored by **appointment status** (confirmed = primary, pending = warning, cancelled = slate + strikethrough, urgent = error) — the same semantic mapping as Badges. Overflow: "+3 more" opens a popover. Week/day views: 30-minute slot rows with a current-time indicator (2px `error-500` line); drag-to-reschedule always ends in a confirmation modal (a drag alone never commits a clinical change). Every event chip is focusable and opens a detail popover.

## 8.31 Empty States

Rendered when a container has no data. Anatomy (centered, max-width 400px, padding 64px 24px): 32-48px icon inside a 96px `slate-100` circle, then h5 title (what is empty), then body-sm `text-secondary` (why, and what to do), then a primary or secondary action. Three flavors: **first-use** ("No appointments yet" + "Book appointment" CTA), **cleared** ("No unread notifications" — neutral, no CTA), **no-results** ("No patients match 'Smyth'" + "Clear filters"). Tone: helpful, never blaming; no humor in clinical contexts.

## 8.32 Loading States

Decision table:

| Situation | Pattern |
|---|---|
| Initial page or section load | Skeleton mirroring the final layout |
| User-triggered button action | Button loading state (spinner + persistent label) |
| Background refresh of visible data | Keep stale data + subtle 2px top progress bar; never blank the screen |
| Full-app bootstrap | Centered logo + circular indeterminate progress |
| AI generation | Accent-colored shimmer + streaming text; always cancellable |

Show nothing for operations under 300ms (avoids flicker); skeletons appear past that threshold. All async regions set `aria-busy`; completion of significant loads is announced politely.

## 8.33 Error States

| Scope | Pattern |
|---|---|
| Field | Inline error under the input (8.2) — appears on blur or submit, clears on fix |
| Form | Error Alert at top summarizing issues with anchor links to fields; focus moves to the alert |
| Section / widget | In-place card: `alert-circle` icon, "Couldn't load vitals", cause if known, **Retry** button — one failed widget never takes down the page |
| Page (404/403/500) | Full page: large icon, h2 title, plain-language body, "Go to dashboard" + "Contact support" |
| Async action | Error toast (persistent) with retry where safe |

Copy rules: state what happened, why (if known), and what to do next. Never expose raw stack traces; error codes may appear as a secondary caption for support. Never blame the user ("Invalid input" becomes "Enter a valid phone number"). Errors are announced with `role="alert"`.

---

# 9. Motion System

## 9.1 Principles

Motion in Medora is **functional**: it directs attention, explains spatial relationships, and confirms actions. It is never decorative in clinical workflows. Fast, small, and interruptible.

## 9.2 Duration Tokens

| Token | Value | Use |
|---|---|---|
| `duration-instant` | 0ms | State swaps that must feel immediate (pressed states) |
| `duration-fast` | 100ms | Hover color/opacity changes, toggles |
| `duration-base` | 150ms | Buttons, inputs, checkboxes, small fades |
| `duration-moderate` | 200ms | Dropdowns, tooltips, tab indicator, accordion |
| `duration-slow` | 250ms | Drawers, modals, page-level transitions |
| `duration-slower` | 400ms | Large surface choreography, empty-state illustrations |

Rule of thumb: the larger the element and the farther it travels, the longer the duration — but nothing in-app exceeds 400ms.

## 9.3 Easing Tokens

| Token | Curve | Use |
|---|---|---|
| `ease-out` | `cubic-bezier(0, 0, 0.2, 1)` | **Default.** Entrances — start fast, settle gently |
| `ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | Exits only |
| `ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | Elements moving on-screen (tab indicator, reordering) |
| `ease-spring` | Framer Motion `{ type: "spring", stiffness: 380, damping: 30 }` | Playful patient-facing confirmations (booking success) — never in clinical dashboards |

## 9.4 Standard Transitions

| Pattern | Recipe |
|---|---|
| Hover (buttons, rows, cards) | background/shadow, 100-150ms ease-out |
| Dropdown / popover / tooltip in | opacity 0 to 1 + translateY(4px) + scale 0.98 to 1, 200ms ease-out; exit 150ms ease-in |
| Modal in | scrim fades 200ms; panel opacity + scale 0.96 to 1, 250ms ease-out; exit 200ms |
| Drawer in | translateX(100%) to 0, 250ms ease-out; scrim in parallel |
| Toast in | translateY(-8px) + fade, 200ms; exit fade + height collapse 150ms |
| Accordion | height auto-animate 200ms ease-out with content fade |
| Page transition | outgoing fades 100ms, incoming fades + translateY(8px) 200ms — subtle, no slides between routes |
| Loading | skeleton shimmer 1.6s linear infinite; spinners 0.8s linear rotation |

Never animate: `width`/`height`/`top`/`left` on large layouts (use transform/opacity — GPU-composited); focus indicators (must appear instantly); data values changing (a lab number must never "count up" — misleading in clinical context).

## 9.5 Reduced Motion

Under `prefers-reduced-motion: reduce`:
- All translate/scale choreography is removed; entrances become plain 100ms opacity fades.
- Skeleton shimmer becomes a static block; spinners keep rotating (progress indication is functional) but nothing else loops.
- Auto-playing/looping decorative animation is disabled entirely.
- Framer Motion: wrap the app in `MotionConfig reducedMotion="user"` so this is enforced globally, not per-component.

---

# 10. Responsive System

## 10.1 Breakpoints

Mobile-first; tokens match Tailwind defaults so no config drift.

| Token | Min-width | Target device | Layout behavior |
|---|---|---|---|
| (base) | 0 | Phones portrait (360-639) | Single column, bottom navigation |
| `sm` | 640px | Phones landscape / small tablets | Single column, wider gutters |
| `md` | 768px | Tablets | 2-column grids, sidebar as overlay |
| `lg` | 1024px | Laptops | Persistent sidebar (collapsed), multi-column dashboards |
| `xl` | 1280px | Desktops | **Reference design size.** Sidebar expanded, full grids |
| `2xl` | 1536px | Large desktops | Content capped at `container-2xl` (1440px), whitespace grows |

Design and QA priority: 375px (mobile), 768px (tablet), 1280px (laptop), 1440px (desktop).

## 10.2 Grid

12-column fluid grid inside the container. Gutters: 16px (base), 24px (md+), 32px (xl+). Common patterns:

| Content | base | md | lg | xl |
|---|---|---|---|---|
| Dashboard KPI cards | 1 col | 2 cols | 4 cols | 4 cols |
| Card lists | 1 | 2 | 3 | 3-4 |
| Form + summary panel | stacked | stacked | 8 + 4 cols | 8 + 4 |
| Detail page (content + meta) | stacked | stacked | 9 + 3 | 9 + 3 |

## 10.3 Navigation Behavior

| Breakpoint | Sidebar | Navbar | Tables |
|---|---|---|---|
| base / sm | Hidden; bottom tab bar (max 5 items, 56px, icons + 11px labels) + hamburger for overflow | 56px, condensed; search collapses to icon | Collapse to stacked key-value cards |
| md | Overlay drawer via hamburger | 64px | Horizontal scroll with sticky first column |
| lg | Persistent, collapsed to 64px icon rail by default | 64px, full search | Full table |
| xl+ | Persistent, expanded 264px (user-collapsible) | Full | Full table |

## 10.4 Responsive Rules

- Touch targets 44px minimum below `lg`; hover-revealed actions become always-visible (touch has no hover).
- Modals become full-width bottom sheets below `md`; drawers become full-screen.
- Type scale steps down one notch below `md` for h1-h3 only (h1: 36 to 30px); body never shrinks below 16px.
- Multi-step forms go one-field-group-per-screen on mobile with the step indicator pinned.
- Test all clinical flows at 200% browser zoom (WCAG 1.4.4/1.4.10 reflow at 320px equivalent).

---

# 11. Accessibility

## 11.1 Conformance Target

**WCAG 2.1 Level AA** across the platform, adopting WCAG 2.2 AA criteria (focus appearance, target size 24px, dragging alternatives) as build requirements. Healthcare platforms may additionally fall under Section 508 / EN 301 549 procurement rules — AA conformance covers these.

## 11.2 Contrast Requirements (enforced by the palette)

| Element | Minimum | System guarantee |
|---|---|---|
| Body text | 4.5:1 | `text-primary` 17.8:1, `text-secondary` 7.5:1, `text-tertiary` 5.4:1 |
| Large text (24px+ / 19px bold) | 3:1 | All heading tokens pass 4.5:1 anyway |
| UI component boundaries | 3:1 | `border-strong` on `surface`; input borders never lighter than slate-300 |
| Icons carrying meaning | 3:1 | Functional icons use `text-secondary` or darker |
| Focus indicators | 3:1 against adjacent colors | Double-ring technique works on any background |
| Status colors as text | 4.5:1 | Always use the 700 step on light / 400 on dark, per Section 2 |

Every new color pairing must be contrast-checked before it enters the token file; no raw hex in application code makes this enforceable by lint.

## 11.3 Keyboard Navigation

- **Everything operable by keyboard.** Tab order follows visual order; no `tabindex` greater than 0.
- Skip link ("Skip to main content") is the first focusable element on every page.
- Composite widgets (menus, tabs, radio groups, calendar grids) use **roving tabindex**: one Tab stop per widget, arrows navigate inside.
- Standard keys everywhere: `Esc` closes the topmost layer; `Enter/Space` activates; `Ctrl+K` opens global search.
- Focus is **never lost**: closing any overlay returns focus to its trigger; deleting a list item moves focus to the next item (or the empty state heading).

## 11.4 Focus Management

- Universal indicator: `shadow-focus` double ring (2px surface gap + 2px `focus-ring` color), applied via `:focus-visible` so pointer clicks don't paint rings.
- Route changes move focus to the new page's `h1` (or main landmark) and update `document.title` — announced by screen readers.
- Modals/drawers trap focus while open; background gets `inert`.
- Multi-step forms: on step change, focus the step heading. On validation failure, focus the error summary.

## 11.5 Screen Reader Support

- **Landmarks:** one `main` per page; `nav` (labeled "Main" / "Breadcrumb"), `header`, `search`, `contentinfo`.
- **Headings** form a logical outline (single h1, no skipped levels) — the primary SR navigation mechanism.
- **Live regions:** polite region for toasts/async completions; assertive only for errors and critical clinical alerts; result counts announced after filtering.
- **Forms:** programmatic label for every control; errors linked via `aria-describedby`; required via `required`/`aria-required`, plus visible indicator.
- **Data tables:** real `th` with `scope`; `caption` (visually hidden if needed) describing the table; sort state via `aria-sort`.
- **AI content:** prefixed with a visually-hidden "AI-generated:" text so the provenance survives screen-reader linearization.

## 11.6 ARIA Recommendations

1. **No ARIA is better than bad ARIA** — use native elements first (`button`, `a`, `select`, `table`, `dialog`).
2. Follow WAI-ARIA Authoring Practices patterns exactly for: combobox, menu, tabs, dialog, switch, grid (calendar) — all specified per-component in Section 8.
3. Icon-only controls always have `aria-label`. Decorative icons get `aria-hidden="true"`.
4. State is communicated with ARIA, not just style: `aria-expanded`, `aria-selected`, `aria-checked`, `aria-current`, `aria-busy`, `aria-invalid`.
5. Automated checks (axe-core) run in CI; manual screen-reader passes (NVDA + VoiceOver) are part of the definition-of-done for every new component.

---

# 12. Design Tokens

Tokens are the single source of truth, defined as CSS custom properties and mapped into Tailwind. Theme switching = swapping the semantic layer on `:root` / `.dark`; components never reference primitives directly.

## 12.1 Token CSS (semantic layer, abbreviated)

An excerpt of `src/styles/tokens.css`, with the values it ships. §2.3 has every colour role, §3.2 the full type scale, §6 every shadow.

```css
:root {
  /* ── Palette: the 17 approved values (§2.2, ADR-0005) ── */
  --palette-blue-700: #1268ad;  --palette-blue-600: #1677c8;  --palette-blue-400: #5aa6ea;
  --palette-blue-200: #d8eafb;  --palette-blue-100: #e8f2fc;
  --palette-white: #ffffff;     --palette-gray-50: #f5f7fa;   --palette-gray-100: #f1f5f8;
  --palette-gray-200: #e5eaf0;  --palette-gray-300: #a5afba;  --palette-gray-400: #7e8b99;
  --palette-gray-600: #5f6b78;  --palette-gray-900: #202832;
  --palette-ink-950: #0b0d0f;   --palette-ink-900: #111519;   --palette-ink-800: #1b252e;
  --palette-ink-700: #25303b;

  /* ── Color: semantic roles — a sample; §2.3 has the full table ── */
  --color-background:   var(--palette-gray-100);
  --color-surface:      var(--palette-white);
  --color-border:       var(--palette-gray-200);
  --color-text-primary: var(--palette-gray-900);
  --color-primary:      var(--palette-blue-700);  /* blue as text */
  --color-primary-fill: var(--palette-blue-600);  /* blue as a fill */
  --color-secondary:    var(--color-primary);     /* a copy — declared once, here */
  --color-sidebar:      var(--palette-ink-950);   /* not redeclared in .dark */
  /* Status is the one literal family — see §2.2 "Exception". */
  --color-error:        #c0271f;

  /* ── Typography (the dense scale, §3.2 "As implemented") ── */
  --font-sans: 'Open Sans Variable', 'Segoe UI', system-ui, -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', 'Cascadia Code', Consolas, monospace;
  --text-h1: 1.5rem;        --leading-h1: 2rem;
  --text-h2: 1.125rem;      --leading-h2: 1.625rem;
  --text-body: 0.8125rem;   --leading-body: 1.25rem;
  --text-caption: 0.6875rem; --leading-caption: 1rem;  /* 0.75rem on a coarse pointer */

  /* ── Spacing (4px grid) ───────────────────────── */
  --space-1: 0.25rem;  --space-2: 0.5rem;   --space-3: 0.75rem;
  --space-4: 1rem;     --space-5: 1.25rem;  --space-6: 1.5rem;
  --space-8: 2rem;     --space-10: 2.5rem;  --space-12: 3rem;
  --space-16: 4rem;    --space-20: 5rem;    --space-24: 6rem;

  /* ── Radius (§5 "As implemented") ────────────── */
  --radius-control: 4px;  --radius-surface: 8px;  --radius-pill: 9999px;

  /* ── Elevation (§6) ───────────────────────────── */
  --shadow-card: 0 1px 2px color-mix(in srgb, var(--palette-ink-950) 6%, transparent);
  --shadow-popover: /* two ink-950 layers */;
  --shadow-modal:   /* two ink-950 layers */;
  --shadow-focus: 0 0 0 2px var(--color-surface), 0 0 0 4px var(--color-focus-ring);

  /* ── Motion ───────────────────────────────────── */
  --duration-fast: 100ms;  --duration-base: 150ms;
  --duration-moderate: 200ms; --duration-slow: 250ms;
  --ease-out: cubic-bezier(0, 0, 0.2, 1);
  --ease-in: cubic-bezier(0.4, 0, 1, 1);
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);

  /* ── Z-index ──────────────────────────────────── */
  --z-sticky: 100; --z-dropdown: 1000; --z-drawer: 1100;
  --z-modal: 1200; --z-toast: 1300; --z-splash: 1400;
}

.dark {
  --color-background:   var(--palette-ink-900);
  --color-surface:      var(--palette-ink-800);
  --color-border:       color-mix(in srgb, var(--palette-ink-700) 70%, var(--palette-gray-600));
  --color-text-primary: var(--palette-gray-50);
  --color-primary:      var(--palette-blue-400);
  --color-primary-fill: var(--palette-blue-400);
  --color-error:        #f0908a;
  /* Shadows go neutral black; overlays add a 1px border ring (§6.2). */
  --shadow-card: 0 1px 2px rgba(0, 0, 0, 0.3);
}
```

## 12.2 Tailwind Mapping Strategy

Tailwind is configured to read the CSS variables, so the theme (including dark mode) switches without class changes. Each colour goes through a small `token()` helper that wraps `var(--color-…)` in `color-mix()` when an opacity modifier is used, so `bg-primary/40` works on a single-valued token.

```ts
// tailwind.config.ts (excerpt — `token(name)` resolves var(--color-<name>))
export default {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: token('primary'),            // text-primary, border-primary …
          hover: token('primary-hover'),
          pressed: token('primary-pressed'),
          subtle: token('primary-subtle'),
          fill: token('primary-fill'),           // bg-primary-fill
          'fill-hover': token('primary-fill-hover'),
          'fill-text': token('primary-fill-text'), // text-primary-fill-text
        },
        secondary: { DEFAULT: token('secondary'), hover: token('secondary-hover'), subtle: token('secondary-subtle') },
        accent: { DEFAULT: token('accent'), subtle: token('accent-subtle') },
        'ai-badge': { DEFAULT: token('ai-badge'), text: token('ai-badge-text') },
        'ai-launcher': { DEFAULT: token('ai-launcher'), border: token('ai-launcher-border') }, // the navbar AI button
        tab: { 'active-text': token('tab-active-text'), indicator: token('tab-indicator') },
        success: { DEFAULT: token('success'), subtle: token('success-subtle') },
        warning: { DEFAULT: token('warning'), subtle: token('warning-subtle') },
        error: { DEFAULT: token('error'), hover: token('error-hover'), subtle: token('error-subtle') },
        info: { DEFAULT: token('info'), subtle: token('info-subtle') },
        chart: { 1: { DEFAULT: token('chart-1'), edge: token('chart-1-edge') } /* … 2–5 */ },
        background: token('background'),
        surface: { DEFAULT: token('surface'), sunken: token('surface-sunken'), overlay: token('surface-overlay') },
        border: { DEFAULT: token('border'), strong: token('border-strong') },
        text: {
          primary: token('text-primary'),
          secondary: token('text-secondary'),
          tertiary: token('text-tertiary'),
          placeholder: token('text-placeholder'),
          disabled: token('text-disabled'),
          inverse: token('text-inverse'),
        },
        sidebar: {                               // bg-sidebar, text-sidebar-text, bg-sidebar-active …
          DEFAULT: token('sidebar'),
          raised: token('sidebar-raised'),
          hover: token('sidebar-hover'),
          border: token('sidebar-border'),
          text: token('sidebar-text'),
          'text-muted': token('sidebar-text-muted'),
          active: token('sidebar-active'),
          'active-text': token('sidebar-active-text'),
        },
        'control-knob': token('control-knob'),
        'focus-ring': token('focus-ring'),
        scrim: token('scrim'),
      },
      borderRadius: { control: 'var(--radius-control)', surface: 'var(--radius-surface)', pill: 'var(--radius-pill)' },
      boxShadow: {
        card: 'var(--shadow-card)',
        popover: 'var(--shadow-popover)',
        modal: 'var(--shadow-modal)',
        focus: 'var(--shadow-focus)',
      },
      zIndex: { sticky: '100', dropdown: '1000', drawer: '1100', modal: '1200', toast: '1300' },
    },
  },
} satisfies Config;
```

The Theme Playground (`src/features/theme-playground/`, local dev only) edits exactly these colour roles: its catalogue (`model/tokens.ts`) lists every independent `--color-*` role as an editor row, in seven groups (Brand & Primary, Neutral Colors, Sidebar, Components, AI Components, Status Colors, Charts), and every copy in `COPIED_TOKENS`; together they must equal what `tokens.css` declares, no more and no fewer, and each copy must be declared there as a plain reference to its source (`presets.test.ts`).

**Enforcement:** application code uses only semantic Tailwind classes (`bg-surface`, `text-text-secondary`, `border-border`, `bg-primary hover:bg-primary-hover`). Raw palette classes (`bg-blue-600`) and arbitrary values (`bg-[#2563EB]`) are blocked by ESLint rule + code review. This is what makes dark mode, theming, and future rebranding a token-file change instead of a codebase migration.

---

# 13. Governance

- **Versioning:** the design system is versioned semantically. Token value changes = minor; token renames/removals = major with migration notes.
- **Contribution:** new components enter through a proposal (use case, anatomy, states, a11y contract), review by design + engineering, then documented here before first use in product.
- **Definition of done for any component:** all states designed (default/hover/pressed/focus/disabled/loading/error), both themes, keyboard + screen reader verified, contrast checked, reduced-motion behavior defined.
- **Next steps after approval:** (1) implement `tokens.css` + `tailwind.config.ts` exactly as Section 12; (2) build primitives in order — Button, Input, Card, Badge, Modal — validating the token layer; (3) stand up a component workbench (Storybook or Ladle) before any application page is built.

---

*Medora Design System v1.0.0 — no application pages, dashboards, or business logic are defined by this document. Page design begins only after this foundation is approved.*
