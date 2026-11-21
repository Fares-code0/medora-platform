# Medora branding — logo and entrance

The official Medora logo is a **lockup** (the word *Medora*) whose `d·o`
ligature doubles as the standalone **mark**. Both are drawn from one set of
vectorised outlines, so there is no separate symbol to keep in sync.

## Files

| File | Purpose |
| --- | --- |
| `medoraLogoPaths.ts` | Logo geometry, vectorised from the approved artwork. Outlines for `M`, `e`, the `d·o` ligature, `r`, `a`, plus the three centrelines the entrance traces. **Generated data — don't hand-edit.** |
| `Logo.tsx` | The static logo for normal use (nav, auth, splash, error pages). Paints with `currentColor`. |
| `MedoraAiLogo.tsx` + `assets/medora-ai-logo.png` | **Medora AI**, the assistant's identity (heart, ECG trace, circuit traces) — the supplied artwork with its background removed. Full colour, shaped as a `LucideIcon` so it fills any `icon` / `leadingIcon` slot. Use it for every assistant entry point instead of a generic sparkles icon. |
| `MedoraIntro.tsx` | The entrance overlay. |
| `MedoraIntro.css` | The whole timeline as CSS variables. |
| `intro-session.ts` | `shouldPlayMedoraIntro()`, `markMedoraIntroPlayed()`, `prefersReducedMotion()` and `MEDORA_INTRO_TIMING`. |

## Usage

```tsx
import { Logo } from '@/shared/components/branding';

<Logo />                          // md lockup, inherits currentColor (theme-aware)
<Logo size="lg" color="light" />  // fixed white, e.g. on a coloured panel
<Logo size="sm" label="Medora" /> // exposed to AT as an image named "Medora"
<Logo variant="mark" size="sm" /> // the d·o ligature alone
```

This is the **single** source for the logo — never re-draw the wordmark or set
"Medora" as styled text anywhere else.

## Props

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `size` | `"sm" \| "md" \| "lg"` | `"md"` | Heights ≈ 18 / 24 / 34 px; width scales automatically. |
| `variant` | `"lockup" \| "mark"` | `"lockup"` | `mark` renders the `d·o` ligature alone. Same artwork, tighter crop — a mark standing alone fills its box, so at a given `size` it draws a little larger than the ligature does inside the word. |
| `color` | `"dark" \| "light" \| "primary"` | — (inherit) | Fixed brand colour. Omit to inherit `currentColor` (adapts to light/dark theme). |
| `className` | `string` | — | Layout/positioning only. |
| `label` | `string` | — | Accessible name → `role="img"` + `aria-label`. Omit ⇒ decorative (`aria-hidden`). Pass on clickable home links. |
| `icon` | `ReactNode` | — | Leading slot with prepared spacing, for pairings the lockup cannot express. The Medora symbol is `variant="mark"`, not something to pass here. |

Give it a size; the width follows. Omit `label` wherever the product name is
already in the DOM next to it, so assistive tech doesn't hear "Medora" twice.

## Colours

Brand values (used by the `color` prop and the static assets):

- Primary `#111111` · Dark `#000000` · Light `#FFFFFF`

In-app the default (`currentColor`) is preferred so the mark stays theme-aware.

## The mark

Filled outlines, not strokes, so the weight holds at every size instead of
thinning as it scales down. Its signature is the **`d·o` ligature**: the two
letters merge into one continuous figure-eight, the left loop reading as the
`d` bowl and the right as the `o`, the two ribbons passing behind each other at
the crossing with the ascender rising out of it.

## The entrance

Mounted once, at the composition root (`app/App.tsx`), beside the provider tree
rather than inside it — it has to cover the app while the app is still
mounting. The routed content renders at full opacity beneath it, and the
overlay's own fade is the reveal (DEC-012).

```tsx
const [playIntro] = useState(shouldPlayMedoraIntro);

{playIntro ? <MedoraIntro /> : null}
<AppProviders>…</AppProviders>
```

Four things worth knowing:

- **Never start the content underneath transparent.** It used to wear a
  `medora-app-reveal` wrapper that faded in from opacity 0 as the overlay left.
  Chrome does not report a paint at opacity 0 as contentful, so every first
  visit had no Largest Contentful Paint — 0 entries, and no Lighthouse
  performance score. The overlay is opaque and painted in the same
  `--color-background` as `<html>`, so content painted beneath it is not seen
  until the overlay fades. The exit still looks like the approved crossfade:
  the overlay's `mi-exit` keyframes carry the old app fade as well as its own,
  as opacity `1 − a(t)·(1 − o(t))` sampled at 41 stops, so each frame shows the
  page exactly as much as the two fades together did (NEW-22,
  FRONTEND_CHECKLIST §19). A skip has its own 220ms keyframes; under reduced
  motion the overlay cuts out instead (below). `MedoraIntro.test.tsx` fails if anything outside
  `.medora-intro` starts at `opacity: 0` in `MedoraIntro.css`, and recomputes
  every exit stop from the easing curve.

- **It plays once per browsing session.** `shouldPlayMedoraIntro()` reads
  `sessionStorage` — per tab, so a route change, a refresh, or a Vite HMR
  update never replays it, and a sign-out that clears preferences doesn't
  resurrect it. Clear `medora.intro-played` to see it again.
- **A tap or key press skips it**, cutting to a 220ms fade. Pass
  `allowSkip={false}` to disable.
- **It sits at `--z-splash`**, the top of the z scale by definition. Nothing
  else may claim that token.

### The timeline

Everything lives in variables at the top of `MedoraIntro.css`. Edit there;
nothing downstream hardcodes a duration.

| Beat | Starts | Runs | Variables |
| --- | --- | --- | --- |
| Lockup fades up from 0.94 scale | 0ms | 300ms | `--mi-appear-dur` |
| Both ribbons draw outward from the crossing | 120ms | 620ms | `--mi-draw-delay`, `--mi-draw-dur` |
| Ascender descends to meet the loop | 400ms | 340ms | `--mi-stem-delay`, `--mi-stem-dur` |
| Mask opens fully (safety net, invisible) | 760ms | 140ms | `--mi-seal-delay`, `--mi-seal-dur` |
| Mark settles to full scale and opacity | 740ms | 320ms | `--mi-settle-delay`, `--mi-settle-dur` |
| Wordmark uncovered outward from the mark | 860ms | 460 / 400ms | `--mi-word-delay`, `--mi-word-dur-left`, `--mi-word-dur-right` |
| Overlay fades out, revealing the already-painted app | 2620ms | 300ms | `--mi-exit-delay`, `--mi-exit-dur` |

Change `--mi-exit-delay` or `--mi-exit-dur` and `MEDORA_INTRO_TIMING` in
`intro-session.ts` has to move with them — it is the one place JS has to agree
with the stylesheet.

The left wipe runs longer than the right on purpose: it has 989 units to cover
against the right side's 733, so matching durations would make the two edges
travel at visibly different speeds.

### How the mark reveal works

The logo is never redrawn, re-proportioned, or split into fake halves. The
artwork's own skeleton was traced to get the centreline the designer's stroke
follows, and that centreline is stroked in white inside an SVG mask, 62 units
wide — enough to uncover the full outline, narrow enough that neither ribbon
bleeds across the crossing into the other. Animating `stroke-dashoffset` to 0
on both halves at once makes the ribbons grow out of the crossing and wrap into
their loops, and because the real outline is underneath, the over/under at the
crossing is the one the artwork already has.

Each centreline carries its own measured length in `MEDORA_TRACE_LENGTHS`,
handed to CSS as `--mi-trace-len`. The obvious alternative, `pathLength="1"`,
is not honoured everywhere — a renderer that ignores it paints the whole mark
on the first frame — so the lengths are stated outright. Re-simplify a
centreline and its length has to be remeasured with it.

At 760ms a full-bleed rectangle inside the mask fades in over 140ms. By then
the strokes already cover the outline, so it changes nothing visually; it
exists so a rounding difference can never leave a sliver of the logo missing
after the intro ends.

### Reduced motion

Both signals the app honours are wired: the OS `prefers-reduced-motion` media
query, and the in-app Accessibility toggle (`html[data-reduce-motion='on']`,
written by the boot script in `index.html`). Either one shows the finished
lockup at once and cuts the overlay away at 520ms — nothing travels, nothing
draws, nothing fades. The cut is the global rule's doing: `globals.css` sets
every `animation-duration` to `0.01ms !important` under both signals, which no
duration in `MedoraIntro.css` can outrank, so this file sets only the shorter
delay. (It used to declare a 240ms reduced exit fade; the browser measured it
at 0.01ms, so it was removed rather than left to mislead — FRONTEND_CHECKLIST
§19. The lockup's `mi-appear-static` keeps its nominal 260ms: it runs in
0.01ms too, but its `forwards` fill is what puts the lockup in its end state.) `prefersReducedMotion()` reads the same two
signals; the JS timeline unmounts the inert overlay at 760ms.

The overlay is `aria-hidden`, carries no text, and traps nothing; every
animation uses `forwards` fill, so the end state is static and no idle loop is
left running behind the interface.

## Export variants (`./assets`)

| File | Colour | Use |
| --- | --- | --- |
| `medora-wordmark-dark.svg` | `#111111` | Light / grey backgrounds (vector). |
| `medora-wordmark-light.svg` | `#FFFFFF` | Dark / coloured backgrounds (vector). |
| `medora-mark-dark.svg` | `#111111` | Ligature alone, light backgrounds. |
| `medora-mark-light.svg` | `#FFFFFF` | Ligature alone, dark backgrounds. |
| `medora-wordmark-*.png` | as above | Transparent raster, 1148×274 — email, external. |
| `medora-mark-*.png` | as above | Transparent raster, 600×392. |

SVGs are the source of truth; PNGs are derived from them at the same ratios.

`public/favicon.svg` and `public/apple-touch-icon.png` are the mark squared up
for browser chrome — the favicon carries its own `prefers-color-scheme` rule,
and the touch icon is opaque because iOS composites it onto an unknown ground.

## Where it renders

Login / register / forgot-password (auth card + brand panel), sidebar, mobile
navbar, Administration rail, loading splash, error pages, and the root error
boundary — all through this one component. (No email templates exist in the
codebase yet.)
