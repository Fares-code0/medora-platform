# Phase 13 — Enterprise UI Polish & UX Refinement

## Overview

A presentation-only pass on top of the Phase 12 layouts: one more very
slight typography step for headings, richer interaction feedback, subtly
zebra-striped tables, identity-toned premium empty states, an executive
hero band on the dashboard, and an accent-washed AI workspace. No route,
feature, hook, provider, query, or mock-data change; the canonical
5-entity dataset is untouched.

## Goals

- Headings very slightly smaller; hierarchy from whitespace, not size.
- Tables easier to scan at a glance.
- Feedback states (empty / error / press / hover) feel designed, not default.
- Dashboard reads as a command center; AI reads as a different kind of surface.

## Files Modified

- `src/styles/tokens.css` — heading scale only: display 44→40px,
  h1 28→26px, h2 22→20px, h3 18→17px (body/caption sizes unchanged for
  readability; line heights adjusted to match).
- `src/components/ui/internal/styles.ts` — buttons gain press feedback
  (`active:scale-[0.98]`, suppressed when disabled) with a transform-aware
  transition.
- `src/components/ui/Card.tsx` — interactive cards also strengthen their
  border on hover (`border-strong`) alongside the existing lift + shadow.
- `src/components/ui/Sidebar.tsx` — thin scrollbar on the nav scroll area.
- `src/components/ui/DataTable.tsx` — very subtle zebra striping
  (`even:bg-background`, one step below hover so hover always reads),
  sorted-column headers stay high-contrast while sorted, selected rows
  keep the inset primary bar.
- `src/components/feedback/EmptyState.tsx` — premium two-ring icon badge
  with a module-tone tint (`tone` prop: primary/secondary/success/warning/
  error/info/ai/neutral), tightened rhythm.
- `src/components/feedback/ErrorState.tsx` — error icon in a tinted
  chip, retry button matched to the current button spec (32px, press
  feedback).
- Module empty states now carry their identity tone:
  `LabsPage` (info), `PharmacyPage` (success), `MedicalRecordsPage`
  (secondary), `PatientsPage` (primary), `NotificationsPage` (error),
  `AppointmentsPage` (warning), `AiAssistantPage` (ai).
- `src/features/doctor/dashboard/pages/OverviewPage.tsx` — the greeting
  sits in an executive hero band (primary-subtle → surface gradient,
  bordered, shadow-xs).
- `src/features/doctor/ai/pages/AiAssistantPage.tsx` — the whole
  conversation workspace sits on an accent gradient wash (accent-subtle →
  background), visually separating the AI surface from clinical modules
  (UX 1.5 provenance rule).
- `PHASE13_ENTERPRISE_UI_POLISH.md` (this document).

## Design Decisions

- **Whitespace over size**: only display/h1/h2/h3 stepped down; body,
  body-sm, and caption were left alone so no reading-size regressions.
- **Zebra one step below hover**: `background` (#f8fafc) vs `surface`
  (#ffffff) is the smallest token-pair contrast available, so striping
  aids scanning without competing with hover (`surface-sunken`) or
  selection (`primary-subtle` + inset bar). Dark mode inherits the same
  relationship from the token layer.
- **Identity tones reused, not invented**: empty states, hero bands, and
  the AI wash all use the existing module tone map — no new colors, no
  raw hex.
- **Press feedback via transform**: a 2% scale on `:active` gives tactile
  button feedback without new dependencies; disabled buttons opt out.

## UI Improvements

Heading hierarchy, card hover borders, zebra tables, sorted-header
emphasis, toned empty-state badges, tinted error chips, dashboard hero
band, AI accent wash, thin sidebar scrollbar.

## UX Improvements

Buttons acknowledge presses; sortable columns show their active state
persistently; large tables scan row-by-row via striping; empty states
explain themselves with module-colored iconography and a clear action;
retry affordances look like the rest of the system; the AI surface is
instantly distinguishable from clinical data surfaces.

## Responsive Improvements

No breakpoint behavior changed. The hero band and AI wash use fluid
padding (`px-4 md:px-5`, `p-3 md:p-4`); the AI workspace keeps its
lg two-column / mobile drawer split; zebra striping and empty states are
breakpoint-independent.

## Verification

- `npm run typecheck`, `npm run lint`, `npm run build` — all green
  (0 errors; the 14 pre-existing accepted react-refresh warnings remain).
- Manual browser pass as `doctor@medora.health`: dashboard hero band,
  labs zebra table + sorted header, pharmacy panels, empty states via a
  no-match search, AI accent wash. Browser-pane screenshots time out in
  this environment; verification used DOM/computed-style inspection.

## Known Limitations

- Chart widgets remain placeholders (chart wrappers are future work), so
  "executive analytics" is represented by layout and the Practice-pulse
  panel rather than live charts.
- Screenshot capture is unavailable in the verification environment;
  visual checks were DOM-based.
- Zebra striping relies on the `background`/`surface` token pair; themes
  that equalize those two tokens would hide the striping (both bundled
  themes keep them distinct).
