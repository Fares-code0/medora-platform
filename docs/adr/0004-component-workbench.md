# ADR-0004 — Component workbench: Storybook

**Status:** Accepted · **Date:** 2026-09-01 · **Row:** F-09

## Context

`FRONTEND_ARCHITECTURE.md` §8.2.4 makes workbench stories the acceptance
artifact for Tier 1–2 components: every design-system state (hover, focus,
disabled, loading, error), light and dark, with axe checks. `DESIGN_SYSTEM.md`
§13 goes further — "component workbench before any application page".

Neither existed. `src/components/__stories__/` held a README saying so:

> Storybook/Ladle is not yet a dependency, so colocated `*.stories.tsx` files
> are intentionally **not** committed (they would fail `tsc -b` without the
> framework types).

So F-09 was never a matter of writing stories. It was an unmade
dependency decision, blocking them, and this repository settles those by
measuring both candidates rather than estimating.

## Candidates, measured

Each installed into a throwaway project (not this repo, so a rejected
candidate leaves nothing behind) on 2026-09-01, Node 22, npm 10:

| | Packages added | `node_modules` | Install |
| --- | --- | --- | --- |
| `@ladle/react` | 419 | **132 MB** | 21 s |
| `storybook` + `@storybook/react-vite` | **171** | 159 MB | 15 s |

The result inverts the usual reputation: Storybook 9 adds **fewer than half**
the packages Ladle does, for 27 MB more on disk. Ladle's pitch is that it is
the lightweight option, and by package count in 2026 it is not.

## Decision

**Storybook, with `@storybook/react-vite` and `@storybook/addon-a11y`**, as
dev dependencies.

1. **It reuses the app's own Vite config.** A story resolves aliases, PostCSS
   and Tailwind exactly as production does. A workbench that builds its
   subject differently from the app is a workbench that can lie about it.
2. **Fewer packages, and §8.2 names it first.** Both were acceptable to the
   architecture doc; the measurement broke the tie.
3. **`addon-a11y` gives §8.2's axe requirement directly**, configured to run
   on every story rather than opt-in per component.

Installed cost to the **application** bundle: **zero**. These are
`devDependencies`; `npm run build` output is unchanged, and nothing under
`src/` imports Storybook except `*.stories.tsx` files, which the app build
never reaches.

## What shipped

`.storybook/main.ts`, `.storybook/preview.tsx` and `.storybook/ThemedStory.tsx`
(the theme wrapper is a separate file because a module exporting both a
component and config breaks fast refresh — the lint rule is right), plus
`npm run storybook` and `npm run build-storybook`.

Fifteen stories across five components: Button (variant × size, every
interaction state, full width), Badge (variant × emphasis), Input (states,
sizes), Alert (every variant, dismissible vs the non-dismissible critical of
DS §8.22), StatusBadge (every kind), and the loading/empty/error trio.

**The matrices are generated from the union types and the presentation maps,
not hand-listed.** A seventh button variant or a fifteenth status kind appears
in the workbench the moment it is declared. A hand-written list silently omits
it, which is how a workbench stops being an acceptance artifact and becomes
decoration.

Theme is applied the way `ThemeProvider` applies it — a `dark` class on the
documentElement — rather than through a Storybook-specific mechanism, so what
a story shows is what the app renders.

## What this does not do

**Five components of about forty-five have stories.** F-09's row is about the
harness existing and the pattern being set; it is not a claim that §8.2's
acceptance artifact now exists for every Tier 1–2 component. The remaining
components are each a small, mechanical addition against the pattern these
five establish, and should be written as those components are next touched
rather than in one sweep.

Hover and focus cannot be asserted by a static story. The Button story names
them explicitly as states a reviewer must exercise with a pointer and with
Tab, rather than omitting them and implying the matrix is complete.

The workbench is **not** wired into CI. Doing so means deciding whether a
failing axe check blocks a merge, which is a policy question for the owner,
not a consequence of choosing a tool.
