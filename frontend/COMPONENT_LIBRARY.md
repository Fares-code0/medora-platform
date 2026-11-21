# Medora Component Library

**Version 1.0.0 — Phase 1 deliverable**
**Depends on:** `DESIGN_SYSTEM.md` v1.0.0 · `UX_ARCHITECTURE.md` v1.0.0 · `FRONTEND_ARCHITECTURE.md` v1.0.0

This library is the **only** source of UI components for the Medora application. Feature code
composes these components; it never re-implements primitives, hardcodes colors/spacing/typography,
or invents new status-color pairings. Every visual value resolves to a design token
(`src/styles/tokens.css` → `tailwind.config.ts`).

---

## 1. Structure & Import Rules

| Folder | Tier | Import path | Contents |
|---|---|---|---|
| `src/components/ui` | 1 — atoms | `@/components/ui` | DS §8 primitives: buttons, fields, overlays, navigation, table |
| `src/components/feedback` | 1 — atoms | `@/components/feedback` | Alert, Toast, Progress, Spinner, Skeleton, EmptyState, ErrorState |
| `src/components/patterns` | 2 — patterns | `@/components/patterns` | UX §1.4 assemblies: StatusBadge, KPI/statistic cards, SearchBar, FilterBar, DashboardWidget |
| `src/components/layout` | — | `@/components/layout` | Layout primitives: PageContainer, Section, Stack, Grid, ContentHeader |

**Binding rules (FRONTEND_ARCHITECTURE §8):**

1. Tier 1–2 components are **pure**: no data fetching, no router imports, no domain types.
   Navigation is expressed as `href` strings / `onClick` callbacks supplied by the caller.
2. Import from the barrel (`@/components/ui`), never from `internal/` — those are private
   implementation modules (shared style builders, field chrome, menu list).
3. Variants come from component props. If a variant doesn't exist, propose it through DS
   governance (DS §13) — do not fork a component or override its classes with raw values.
4. Promotion by rule of three: feature components move into `patterns/` (domain-free) or
   `shared-domain` (domain-aware) when a third feature needs them. Never copy-paste a variant.
5. One component per file; colocated tests/stories are the acceptance artifact
   (placeholders: `src/components/__tests__/`, `src/components/__stories__/` until
   Vitest/Storybook are installed).

**Shared internals (no duplication):** `ui/internal/styles.ts` (button/input class builders),
`ui/internal/Field.tsx` (label/helper/error anatomy for all form fields),
`ui/internal/MenuList.tsx` (WAI-ARIA menu shared by Dropdown & ContextMenu),
`ui/internal/InlineSpinner.tsx` (current-color button spinner).

---

## 2. Foundation

### Button — `@/components/ui`
DS §8.1. `variant`: `primary` (one per view) · `secondary` · `ghost` · `destructive` ·
`destructive-secondary` · `ai` (AI-triggering actions only). `size`: `sm` 32px · `md` 40px ·
`lg` 48px. Props: `loading`, `fullWidth`, `leadingIcon`, `trailingIcon` + all native button attrs.
- **Loading:** spinner replaces the leading icon, label persists, width stable, `aria-busy` +
  `aria-disabled`, clicks suppressed.
- **A11y:** real `<button>`; `type` defaults to `"button"`; focus ring from the global
  `:focus-visible` rule.
- **Rules:** never two adjacent destructive buttons; full-width only in mobile sheets/auth forms.

### IconButton — `@/components/ui`
Icon-only button; **`aria-label` is required by the type**. `variant` adds `neutral` (default —
gray toolbar/table style). Sizes are squares (32/40/48). Pair with `Tooltip` for pointer users;
icon-only is allowed solely for universally understood actions (DS §7.2).

### LinkButton — `@/components/ui`
An `<a>` with full Button styling for navigation that reads as an action. `href` required;
`disabled` removes the href and sets `aria-disabled`. Router-agnostic — pass generated paths.

### Input — `@/components/ui`
DS §8.2. Props: `label`, `helperText`, `error`, `size` (`md` 40px / `lg` 48px patient-facing),
`leadingIcon`, `trailingIcon` (decorative), `trailingElement` (interactive slot),
`containerClassName` + native input attrs. 16px text (prevents iOS zoom).
- **Error state:** red border, alert-circle icon in-field, message replaces helper with
  `role="alert"` + `aria-describedby` + `aria-invalid`. Messages state *how to fix*.
- **Rule:** every input has a visible `label` — placeholders are never labels.

### PasswordInput — `@/components/ui`
Input with a visibility toggle (`aria-pressed`, labelled Show/Hide). Defaults to
`autoComplete="current-password"`.

### SearchInput — `@/components/ui`
Input with leading search icon, `type="search"`, labelled clear button when non-empty
(`onClear`), Escape clears. Debounce belongs to the `SearchBar` pattern, not this atom.

### Textarea — `@/components/ui`
DS §8.3. Min-height 96px (3 rows), vertical resize only. `showCount` + `maxLength` renders the
character counter (error-red when exceeded with `enforceMaxLength={false}`). Same field anatomy
and error contract as Input.

### Select — `@/components/ui`
DS §8.4, WAI-ARIA select-only combobox. Props: `options` (`{value,label,disabled?,group?}`),
`value: string | null`, `onChange`, field props (`label`/`helperText`/`error`/`required`),
`placeholder`, `size`, `name` (hidden input for forms), `aria-label` (required when no label).
- **Keyboard:** ArrowUp/Down navigate, Enter/Space select, Esc/Tab close, Home/End jump,
  printable characters type-ahead (500ms buffer).
- **A11y:** `role="combobox"` + `aria-expanded` trigger; `role="listbox"`/`option` menu with
  `aria-activedescendant`; selected option shows check + `aria-selected`.
- **Rule:** use Select above 5 options; radios for 2–5.

### Checkbox — `@/components/ui`
DS §8.5. 18×18, radius xs, primary fill when checked; `indeterminate` for select-all headers.
Props: `label`, `description`, `error` + native attrs. Label is clickable; focus ring on the box.

### RadioGroup / Radio — `@/components/ui`
DS §8.6. `RadioGroup` renders `fieldset`+`legend` and provides name/value via context;
`Radio` items (20px circle, inner dot). `orientation="horizontal"` only for ≤3 short options.
Arrow-key movement is native. `Radio` throws if used outside a `RadioGroup`.

### Switch — `@/components/ui`
DS §8.7. 44×24 track, `role="switch"` + `aria-checked`. With `label`, renders the settings-row
layout (label left, switch right). Controlled only (`checked`, `onCheckedChange`).
- **Rule:** switches apply immediately; use Checkbox when a save action follows. Never for
  destructive/clinical-impact settings without confirmation.

---

## 3. Data Display

### Card — `@/components/ui`
DS §8.18. Surface + radius lg + border + shadow-sm. `padding`: `default` 24px · `compact` 16px ·
`none`. Optional header (`title` h3-styled, `subtitle`, `headerAction`) and `footer` (top border).
`interactive` + `onClick`: hover shadow-md + translateY(-1px), `role="button"`, tabIndex 0,
Enter/Space activate — and the card must then be its **only** interactive element. Never nest cards.

### Surface — `@/components/ui`
Themed container primitive. `variant`: `default` · `sunken` · `overlay`; `bordered`, `radius`
(`none`/`md`/`lg`/`xl`), `shadow` (`none`–`lg`), `as` (`div`/`section`/`article`/`aside`).

### Divider — `@/components/ui`
1px hairline (`border` token). `orientation` horizontal/vertical; optional centered `label`.
Proper `role="separator"`/`aria-orientation` semantics.

### Badge — `@/components/ui`
DS §8.8, non-interactive. `variant`: `success` · `warning` · `error` · `info` · `neutral` · `ai`.
`dot` or `icon` — status never relies on color alone. 22px pill, subtle bg + status text tokens
(correct in both themes). **CountBadge**: filled error circle, `max` (default 99 → "99+"),
hidden at 0.

### Chip — `@/components/ui`
DS §8.9, interactive. `onSelect` → toggle button with `aria-pressed` and leading check when
`selected`; `onRemove` → trailing × with its own `aria-label` ("Remove filter: …");
Delete/Backspace removes. Selectable + removable renders sibling buttons (no nesting).

### Avatar — `@/components/ui`
DS §8.10. `size`: `xs` 24 · `sm` 32 · `md` 40 · `lg` 64 · `xl` 96. Image with initials fallback
(max 2, on the neutral sunken token). `roleRing`: `doctor` (teal) / `staff` (blue). `status="online"`
dot (success, surface-ringed). `decorative` sets `alt=""` when the name is rendered adjacent.
> Known gap: the DS's deterministic 8-hue fallback palette is not defined in the token file;
> adding it is a DS-governance token change (DS §13), not a component change.

### AvatarGroup — `@/components/ui`
Overlap −8px, `max` visible (default 4) + "+N" overflow. Group exposes all names via
`aria-label`; member avatars are decorative.

### StatisticCard — `@/components/patterns`
DS §8.18 metric variant. `label` (overline), `value` (pre-formatted string, tabular figures,
**never animated** per DS §9.4), `delta` (`direction` up/down/flat, `tone`
positive/negative/neutral → success/error/neutral badge, `comparison` for the screen-reader
suffix), `icon`, `caption`, `loading` (skeleton).

### KPIWidget (`KpiWidget`) — `@/components/patterns`
UX P5. StatisticCard + optional 32px `sparkline` (primary token, `aria-hidden`) + `href` that
makes the whole card a link (`linkLabel` for its accessible name).

---

## 4. Navigation

### Sidebar / SidebarSection / SidebarItem — `@/components/ui`
DS §8.16, presentational. `collapsed` switches 264px ↔ 64px rail; items then show right-placed
tooltips and a dot for badge counts. `header`/`footer` slots (bottom-pinned settings/help/user
card). `SidebarSection` renders overline group labels. `SidebarItem`: `icon` (required), `label`,
`active` (primary-subtle bg + 3px left bar + `aria-current="page"`), `badgeCount` (CountBadge,
"99+"), `href` or `onClick`. Landmark: `<nav aria-label="Main">`.
> The Phase 3 `layouts/Sidebar` wraps this with the role-based `NavigationConfig`; this component
> knows nothing about roles, routes, or permissions.

### TopNavbar — `@/components/ui`
DS §8.17, presentational. 64px (56px mobile), `start`/`center` (search, 480px max)/`end` slots,
`elevated` adds shadow-sm once content scrolls beneath, sticky by default (`z-sticky`).
Primary page actions never live here.

### Breadcrumb — `@/components/ui`
DS §8.27. `items: {label, href?, onClick?}[]`; last item is `aria-current="page"` text.
Beyond `maxVisible` (4) the middle collapses behind an expandable ellipsis button.
`<nav aria-label="Breadcrumb">` + `<ol>` semantics. Phase 3 feeds this from route handles.

### Tabs — `@/components/ui`
DS §8.20. `variant`: `line` (sliding 2px primary underline via Framer Motion layout animation) ·
`enclosed` (sunken segmented control). `items: {value,label,count?,disabled?,content?}`;
controlled (`value`, `onValueChange`); `aria-label` required.
- **Keyboard:** roving tabindex; Left/Right/Home/End with automatic activation.
- **Rules:** max 6 tabs, overflow scrolls; tabs switch views, never trigger actions.

### Dropdown — `@/components/ui`
DS §8.13 action menu. `trigger` (focusable element — Button/IconButton; cloned with
`aria-expanded`/`aria-haspopup`), `entries: MenuEntry[]` (`{id,label,icon?,destructive?,disabled?,
onSelect}` or `{type:'separator',id}`), `align` start/end.
- **Keyboard:** arrows cycle, Home/End, type-ahead, Esc closes and refocuses the trigger.
- **Rules:** destructive items error-colored, separated, always last; one nesting level max
  (this implementation supports none — prefer none).

### ContextMenu — `@/components/ui`
Right-click variant of the same menu pattern. Opens at the pointer (viewport-clamped, portaled),
closes on outside click/scroll/Esc, restores focus to the previously focused element.

---

## 5. Feedback

### Alert — `@/components/feedback`
DS §8.22 inline banner. `variant`: `info` · `success` · `warning` · `error` (icon + tinted
surface + status-colored title). `title`, body children, `actions`, `onDismiss`.
`critical` disables dismissal (critical clinical alerts are never dismissible and sit at the top
of the content area). `role="alert"` for error/warning, `role="status"` otherwise.

### Toast — `@/components/feedback` + `useToast()` from `@/app/providers`
DS §8.23. Fire via `useToast().toast({variant, title, description?, action?})`.
Host: top-right (top-center mobile), stack max 3, `aria-live="polite"` region, entrance fade +
rise, exit fade + height collapse. Success/info 5s, warning 8s, **errors persist**; timers pause
on hover/focus. Optional single `action` (e.g. Undo). Never put critical clinical information in
a toast — use Alert or Modal.

### Progress / CircularProgress — `@/components/feedback`
DS §8.24. Linear: `value` 0–100 (omit → indeterminate 1.2s sweep), `slim` 4px, `label`/`showValue`.
Circular: `size` 16/24/48, determinate ring or indeterminate rotation; `aria-label` required.
Both expose `role="progressbar"` + `aria-valuenow` (absent when indeterminate). Prefer
determinate whenever the total is knowable. Progress animations stay active under reduced motion
(functional indication, DS §9.5).

### Spinner — `@/components/feedback`
DS §8.24 circular indeterminate (sm/md/lg), `role="status"` + label. For user-triggered inline
actions only; initial loads use skeletons.

### Skeleton — `@/components/feedback`
DS §8.25. Shape-mirror placeholder; pass radius/size via `className` to match the element it
stands in for. Use for initial loads > 300ms; wrap loading regions in `aria-busy`.

### EmptyState — `@/components/feedback`
DS §8.31. Icon-in-circle + h5 title (what is empty) + description (why / what next) + action slot.
Three flavors by copy: first-use (with CTA), cleared (no CTA), no-results ("Clear search" action).

### ErrorState — `@/components/feedback`
DS §8.33 section/widget error: `role="alert"`, cause if known, **Retry** callback. One failed
widget never takes down the page.

### Modal — `@/components/ui`
DS §8.14 on native `<dialog>` (focus trap, Esc, inert background, focus-return are platform
behavior). `size`: `sm` 400 · `md` 560 · `lg` 720. `title` (h3 style) + `description` +
scrollable body (max 70vh) + `footer` (right-aligned: primary rightmost, cancel to its left).
`dismissible={false}` blocks Esc/scrim for explicit-choice dialogs. `initialFocusRef` overrides
initial focus. Entrance fade + scale 0.96→1 (250ms). Never stack more than two modals.

### Drawer — `@/components/ui`
DS §8.15. Right side panel on native `<dialog>`; `size`: `sm` 400 · `md` 480 · `lg` 640;
full-width below `sm`. Slides in 250ms; attached edge radius 0; same header/body/footer anatomy
and focus rules as Modal. Use when the underlying page context must stay visible.

### ConfirmationDialog — `@/components/ui`
UX P4 base / DS §8.14 confirmation rules. Consequence-stating `title`, verb-labelled
`confirmLabel` (never "OK"/"Yes"), `tone` destructive/primary, `loading` busy-confirm,
`role="alertdialog"`, Esc/scrim disabled, initial focus on the least-destructive action.
The reason-capture variant (P4 with Select + Textarea) is composed by features from this +
Select/Textarea in Phase 5+.

### Tooltip — `@/components/ui`
DS §8.11. Text-only hint (`content: string` — no interactive content by design). 300ms in / 0ms
out; shows on hover **and** keyboard focus; Esc dismisses (WCAG 1.4.13). `placement`
top/bottom/left/right. Wires `aria-describedby` onto the child. Never hide essential clinical
information (dosages, warnings) in a tooltip.

---

## 6. Data Components

### DataTable — `@/components/ui`
DS §8.19, generic over the row type. Props: `columns: DataTableColumn<T>[]`
(`{id, header, cell(row), sortable?, align?, numeric?` (right + tabular-nums)`, mono?, width?}`),
`rows`, `getRowId`, `caption` (visually hidden, required), `sort`/`onSortChange` (controlled,
`aria-sort` announced), `selectable`/`selectedIds`/`onSelectionChange` (48px checkbox column,
select-all with indeterminate), `onRowClick`, `dense` (44px rows), `stickyHeader`, `loading`
(skeleton rows), `error` (in-body ErrorState + Retry), `emptyState`.
- Semantic `<table>`/`th scope` markup always; horizontal scroll within the container.
- Row actions: give the consumer a column whose cell renders `Dropdown` +
  `IconButton icon={EllipsisVertical}` — always visible, never hover-only.
- The stacked-card mobile collapse (>4 columns) is a P1 page-pattern concern (Phase 5).

### Pagination — `@/components/ui`
DS §8.26. "Showing X–Y of Z" + prev/next + windowed page numbers (36px targets, current =
primary-subtle + `aria-current="page"`), optional page-size Select (`PAGE_SIZES` from
`@/constants`). Prev/next disabled at bounds — never hidden. Mobile shows "Page X of Y".
Infinite scroll is prohibited on clinical tables.

### SearchBar — `@/components/patterns`
DS §8.28 contextual search. Controlled `value`/`onValueChange` + `onDebouncedChange` (300ms,
`SEARCH_DEBOUNCE_MS`). `resultCount` announces "N results" via a visually hidden `aria-live`
region. Consumers render the no-results EmptyState echoing the query.

### FilterBar — `@/components/patterns`
UX P1 toolbar. `filters: {id,label}[]` render as removable Chips ("Remove filter: …");
"Clear all" appears at ≥2 filters; `search` slot (SearchBar) + `actions` slot (filter button,
view switch, primary action).

### StatusBadge — `@/components/patterns`
UX P8 vocabulary — the **only** status→color mapping in the platform:
`confirmed`/`active`/`normal` → success · `pending`/`awaiting`/`expiring` → warning ·
`cancelled`/`rejected`/`critical` → error · `scheduled`/`info` → info ·
`completed`/`archived` → neutral · `ai` → accent (sparkles icon). Dot + text always.
Extend the `StatusKind` union here (via DS governance); features never call `Badge` with an
ad-hoc variant for a domain status.

---

## 7. Layout

### PageContainer — `@/components/layout`
DS §4.3 / UX §1.2. `width`: `xl` 1280 default · `2xl` 1440 (data-dense) · `lg` · `md` (settings/
reading) · `sm` (auth/focused) · `prose` 65ch. Centered, gutters 16/24/32px (`padded={false}`
to opt out).

### Section — `@/components/layout`
Titled grouping (`title` h2 by default — never skip heading levels, `headingAs` to adjust),
`caption`, `actions` slot. Separate unrelated sections with `Stack gap={12}` (mobile) / `16`
(desktop) in the parent.

### Stack — `@/components/layout`
1-D flex on the 4px grid. `direction`, `gap` (DS spacing steps only), `align`, `justify`, `wrap`,
`as`. This is how siblings get spaced — no ad-hoc margins.

### Grid — `@/components/layout`
DS §10.2 responsive grids. `preset="kpi"` (1→2→4) and `preset="cards"` (1→2→3), or explicit
`columns={{base,md,lg,xl}}`. Default gap 6 (24px between cards).

### ContentHeader — `@/components/layout`
UX §1.2 page header: single `h1` (steps down below `md`), `caption`, `breadcrumb` slot, `actions`
(max 1 primary + 2 secondary; overflow into a Dropdown — review-enforced).

### DashboardWidget — `@/components/patterns`
UX P6 shell: Card with title header, `actions` slot (range select, "View all") and `menu`
(⋯ Dropdown: export, view as table…). Owns widget-level `loading` (skeleton), `error` (in-place
ErrorState + Retry) and `empty` states so all dashboard widgets behave identically. Chart bodies
plug in via `components/charts` wrappers (Phase 5+).

---

## 8. Accessibility Contract (applies to every component)

- **Focus:** universal double-ring `:focus-visible` indicator (globals.css); focus is never lost —
  overlays return focus to their trigger; ConfirmationDialog focuses the least-destructive action.
- **Keyboard:** every interaction is keyboard-operable; composite widgets (Select, Dropdown,
  ContextMenu, Tabs) use roving tabindex/activedescendant per WAI-ARIA APG; Esc closes the
  topmost layer.
- **Color:** status is always triple-encoded (color + icon/dot + text); text tokens guarantee
  AA contrast in both themes.
- **Announcements:** errors use `role="alert"`; toasts/result counts use polite live regions;
  loading regions set `aria-busy`; icons are `aria-hidden` unless they are the control's label.
- **Touch:** on a coarse pointer (`@media (pointer: coarse)`, the `touch:` variant — the input
  device, not the viewport width) every control meets a 44 × 44px target (DEC-008). Compact
  controls keep their look and reserve the difference as margin, which an invisible
  `::after` fills (`.touch-target`, `globals.css`), so two hit areas can never overlap; fields,
  menu rows, select options and sidebar rows are simply 44px tall. Desktop is unchanged.
- **Reduced motion:** all Framer Motion choreography is globally governed by
  `MotionConfig reducedMotion="user"`; CSS animations freeze except spinners/progress (functional).

## 9. Theming

All components are theme-aware with **zero** component-level theme code: they reference semantic
Tailwind utilities (`bg-surface`, `text-text-secondary`, `border-border`, `shadow-sm`…), and the
`.dark` class on `<html>` (ThemeProvider) swaps the token layer. Dark-mode elevation via surface
lightening + border is encoded in the shadow tokens themselves.

## 10. Known Gaps / Deferred (tracked, not forgotten)

| Item | Why deferred | Lands |
|---|---|---|
| DatePicker, Calendar, Accordion, Popover (DS §8.12/8.21/8.29/8.30) | Not in the Phase 1 component list | Phase 2 completion / Phase 5 with their first consumers |
| Avatar 8-hue fallback palette | Hues are not defined in the DS token file; adding raw hex in components is banned | DS governance token addition |
| Colocated `*.test.tsx` / `*.stories.tsx` | Vitest/Storybook not yet in `package.json`; placeholder files would break `tsc -b` | With the workbench/test toolchain (see `src/components/__tests__/README.md`) |
| Modal/Drawer exit animations | Native `<dialog>` closes synchronously; entrance-only animation keeps the a11y guarantees | Revisit if/when a focus-trap portal replaces `<dialog>` |
| Dropdown viewport auto-flip | Anchored positioning without a floating-ui dependency | Add if real layouts clip menus |

---

*Every component: strict TypeScript (no `any`, `exactOptionalPropertyTypes`), token-only styling,
both themes, keyboard + screen-reader support, loading/disabled/error states where applicable.
Verified: `npm run typecheck` (0 errors) · `npm run lint` (0 errors) · `npm run build` (success).*
