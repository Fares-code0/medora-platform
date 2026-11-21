# DX F1 — Doctor Dashboard foundations, IA and density

**Date:** 2026-08-18
**Checklist rows:** DX-01, DX-02, DX-04, DX-05, DX-06 (§10.1) · absorbs D-03 · closes F-11 · **DX-03 dropped**
**Branch:** `claude/doctor-dashboard-phase-3-7daec4`
**Scope:** `features/doctor/dashboard/`, `components/ui/Collapsible`, `components/patterns/{Reveal,Stagger}`, `styles/`, `vite.config.ts`
**Out of scope:** F2 anatomy (DX-07…DX-14), F3 3D (DX-15…DX-21), F4 quick actions (DX-22/23), everything in §3.2–§3.13

---

## 1. Why this tranche, now

§7 schedules F1 as "Now — in parallel with Phase B/C" for two reasons that still hold:

1. **DX-02's motion tokens and DX-06's bundle baseline are prerequisites.** Every later tranche animates something or claims a performance result. Doing F1 late means a rework pass over F2/F3.
2. **Zero file overlap with the concurrent admin work.** Verified against `claude/adm-06b-communications`, whose 20-file diff touches only `features/admin/communications/**`, `features/admin/administration.meta.ts`, `features/shared-domain/conversations/seed.ts` and one line of `src/routes/index.ts`. Nothing in `features/doctor/dashboard/` imports `shared-domain` at all.

The single shared file is `frontend/FRONTEND_CHECKLIST.md`, which both sessions edit to tick their own rows. Written once, at the end, in its own commit.

---

## 2. Two corrections to the checklist, found while designing

These change what the work is. Both are recorded here rather than silently absorbed.

### 2.1 DX-03 is dropped as superseded

DX-03 asks to "animate a number only when its value changes." `DESIGN_SYSTEM.md` §9.4 forbids exactly this, by name:

> Never animate: … data values changing (a lab number must never "count up" — misleading in clinical context).

`KpiWidget` already encodes the prohibition in its own doc comment ("Values … never animate (DS §9.4)"). The dashboard also renders static `MOCK_KPIS`, so no value ever changes and the code would be unreachable today regardless.

**Resolution: DX-03 is marked ➖ superseded by DS §9.4** in the checklist, with this spec as the citation. It is not deferred — it is a row that should not be built. A change-acknowledgment alternative (settling the *card*, never the digits) was considered and also rejected: with no changing data it has nothing to acknowledge, and it would be built on speculation about a DP-04 future.

F1 is therefore **five rows: DX-01, DX-02, DX-04, DX-05, DX-06.**

### 2.2 The motion token layer already partly exists

DX-02 reads as though no motion tokens exist. `styles/tokens.css:117-123` already defines:

```css
--duration-fast: 100ms;   --duration-base: 150ms;
--duration-moderate: 200ms; --duration-slow: 250ms;
--ease-out: cubic-bezier(0, 0, 0.2, 1);
--ease-in: cubic-bezier(0.4, 0, 1, 1);
--ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
```

DX-02 is therefore an **extension plus a consolidation**, not a new layer. Adding a parallel set of duration names would create the exact "two conventions in the repo" that §10.0(5) warns against.

---

## 3. DX-01 — Information architecture rebuild

### 3.1 The measured problem

Measured live at 1280×720, signed in as `doctor@medora.health`:

| Metric | Value |
|---|---|
| Scroll container | `main.relative.flex-1.overflow-y-auto` |
| `scrollHeight` | 1742px |
| `clientHeight` | 668px |
| **Screens of scroll** | **2.61** |

The audit recorded 2.5; the live figure is 2.61. Target is **≤ 1.5, measured the same way**.

### 3.2 Band order

`OverviewPage.tsx` currently renders four `Grid` bands in analytics-then-activity order, with notifications buried in a side rail at index 5. The rebuild orders by *decision urgency*:

| # | Band | Contents | Treatment |
|---|---|---|---|
| 1 | Hero | Greeting, date, decision count | Always visible |
| 2 | **Alerts** | `NotificationsWidget` | Always visible — **promoted out of the side rail** |
| 3 | **Today** | `ScheduleWidget` + `QuickActionsWidget` | Always visible |
| 4 | KPIs | `MOCK_KPIS` × `KpiWidget` | Always visible |
| 5 | Analytics | `PracticePulseWidget`, `AppointmentsTrendWidget` | **Collapsible, default closed** |
| 6 | Activity | `RecentActivityWidget`, `AiAssistantWidget`, `SatisfactionWidget` | **Collapsible, default closed** |

Promoting notifications above the KPI row is what satisfies §10.6's rule that *critical alerts must never live behind a closed disclosure* — the rule is met by construction, because the only two collapsible bands contain no alerts.

### 3.3 Why both collapsibles default closed

Defaulting Analytics open would make the ≤1.5-screen target conditional on Activity being closed — an acceptance criterion that only passes in one of two default states is not a criterion. With both closed, the target is unconditional and measurable on first paint.

The cost is real and accepted: a doctor's first load shows no charts. Three things mitigate it — the KPI row already carries sparklines and deltas, each section header states what is inside, and the open/closed state persists, so a doctor who wants analytics opens it once.

### 3.4 New primitive: `components/ui/Collapsible.tsx`

None of the 30 existing UI primitives is a disclosure (`Tabs`, `Drawer`, `Modal`, `Dropdown` — no accordion). `hooks/useDisclosure.ts` supplies open/close state only, with no persistence and no animation.

Contract:

```tsx
<Collapsible
  id="analytics"                 // used for aria-controls and the storage key
  title="Analytics"
  caption="Practice pulse and appointment trend"
  defaultOpen={false}
  storageKey="medora.doctor.dashboard.sections.v1"
>
  {children}
</Collapsible>
```

- Header is a real `<button aria-expanded aria-controls>`, not `<details>` — the design tokens and the height animation both need real elements.
- Animation follows the recipe `DESIGN_SYSTEM.md` §9.4 already prescribes for accordions: *height auto-animate 200ms ease-out with content fade*. Implemented with `m.div` (`strict` LazyMotion — `m.*` only, never `motion.*`).
- Heading level is a prop defaulting to `h2`, honoring the F-17 heading contract.
- Content is **kept mounted** when closed rather than unmounted, so opening is instant and no query refires. Closed state is `height: 0` + `overflow: hidden`, plus `inert` so nothing inside can take focus while invisible.
  **A closed section is genuinely hidden from assistive technology, and that is the point of a disclosure** — the accessible affordance is the `aria-expanded` button that names what is inside, not permanent exposure of the contents. Where the browser supports it, `hidden="until-found"` lets `Ctrl+F` open the section and scroll to the match; where it does not, the button is still the route in. This is why §3.2 keeps every alert outside a collapsible: anything a doctor must not miss cannot rely on them opening a section.

### 3.5 Persistence

One key, `medora.doctor.dashboard.sections.v1`, holding `{ analytics: boolean, activity: boolean }`. The `medora.<area>.<thing>.v1` shape matches all 13 existing keys. Corrupt or absent JSON falls back to defaults without throwing.

---

## 4. DX-02 — Motion token layer

### 4.1 Tokens

Added to `styles/tokens.css` beside the existing seven:

```css
--duration-entrance: 300ms;   /* entrance band, DS §9.3 */
--motion-stagger: 50ms;       /* resolves the §10.0(5) conflict */
```

`src/styles/motion.ts` becomes the single TS mirror, so no component hard-codes a number:

```ts
export const motionTokens = {
  fast: 0.1, base: 0.15, moderate: 0.2, slow: 0.25, entrance: 0.3,
  stagger: 0.05, staggerCap: 8,
  easeOut: [0, 0, 0.2, 1],
} as const;
```

### 4.2 The 30ms vs 40–60ms conflict — resolved at 50ms

§10.0(5) records that `OverviewPage`'s local `Reveal` uses a **30ms** stagger while the upgrade brief asks for **40–60ms**, and requires DX-02 to pick one.

**Decision: 50ms**, the brief's midpoint, with the existing 200ms duration and 12px rise unchanged. 8 items × 50ms = 400ms before the last widget starts, +200ms to settle = 600ms total — each item stays inside the 300–500ms entrance band, and the sequence reads deliberate rather than twitchy. Because only the delay constant changes, the visual character of each widget's arrival is untouched.

The value is **not** overridable per-surface. §10.0 warns against leaving two conventions in the repo; an overridable stagger is how a codebase ends up with five.

### 4.3 Promotion

`Reveal` is deleted from `OverviewPage.tsx:28-47` and re-homed as `components/patterns/Reveal.tsx` and `components/patterns/Stagger.tsx`, exported from `patterns/index.ts`. `<Stagger>` owns the index arithmetic so callers stop passing `index` by hand — the current file passes `index={8}` twice ([`OverviewPage.tsx:121,124`](../../../frontend/src/features/doctor/dashboard/pages/OverviewPage.tsx)), a bug that the manual API invites and the new one makes impossible.

---

## 5. DX-04 — Mobile priority order

At `<md`, required order: alerts → today's appointments → KPI summary → patient actions → analytics → activity.

The §3.2 band order already *is* this order, so the desktop rebuild delivers the mobile requirement with no reordering utilities — except `QuickActionsWidget`, which sits beside the schedule at `lg` and must fall directly under it at base. Handled with `order-*` on the existing `Grid` children; no second component tree, no duplicated markup.

Verified at 375px by reading the rendered DOM order, not by eyeballing the screenshot.

---

## 6. DX-05 — Reduced-motion coverage beyond Framer

`MotionConfig` governs `m.*` components only. Two non-Framer paths need auditing:

1. `globals.css:97-107` — the `progress-sweep` keyframe (1.2s linear infinite). Checked against the existing `prefers-reduced-motion` block at `globals.css:112`.
2. The new `Collapsible` height animation.

The binding rule, mirroring [`MotionProvider.tsx:25`](../../../frontend/src/app/providers/MotionProvider.tsx): **the in-app `settings.reduceMotion` toggle must win even when the OS setting is off.** A CSS media query alone cannot express this, so `Collapsible` reads `useInterfaceSettings()` and drops to an instant show/hide when either source asks for reduced motion.

`DESIGN_SYSTEM.md` §9.5 supplies the degradation contract: translate/scale choreography removed, entrances become plain 100ms opacity fades, shimmer static, spinners keep rotating (progress indication is functional).

---

## 7. DX-06 — Performance baseline (closes F-11)

`vite.config.ts` has no `manualChunks`, no visualizer and no budget. Adding:

- `rollup-plugin-visualizer` as a **devDependency** — the only dependency F1 adds, and not a runtime one, so it is not a §10.6 one-way door.
- `manualChunks` splitting vendor, framer-motion and charts.

Recorded **before and after**, committed into checklist §10.1:

| Metric | How measured |
|---|---|
| Entry chunk (gzipped) | `vite build` output |
| Dashboard route chunk | same |
| Largest chunk | same |
| Dashboard LCP / TTI | browser, 1280×720 |
| Longest task | Performance API |
| Screens of scroll | `scrollHeight / clientHeight` on `main`, 1280×720 |

No row in F2 or F3 may claim a performance result unless this table exists first.

---

## 8. Testing

Vitest + Testing Library, matching the existing 52-test setup (`src/test/setup.ts`).

| Unit | Cases |
|---|---|
| `Collapsible` | toggles; `aria-expanded` tracks state; `aria-controls` resolves; content stays mounted but `inert` when closed; persists to and rehydrates from `localStorage`; corrupt JSON falls back to defaults; instant branch under `reduceMotion` |
| `Reveal` / `Stagger` | delay = index × 50ms; capped at 8; reduced-motion no-op |
| `OverviewPage` | band order matches §3.2; both collapsibles closed on first render; alerts render outside any collapsible (the §10.6 rule, asserted rather than assumed) |

The last case is the one that matters most: it is a regression test against someone later tidying `NotificationsWidget` back into a collapsed section.

---

## 9. Files touched

| File | Change |
|---|---|
| `src/components/ui/Collapsible.tsx` | new |
| `src/components/ui/Collapsible.test.tsx` | new |
| `src/components/ui/index.ts` | export |
| `src/components/patterns/Reveal.tsx`, `Stagger.tsx` (+ tests) | new |
| `src/components/patterns/index.ts` | export |
| `src/styles/motion.ts` | new |
| `src/styles/tokens.css` | +2 tokens |
| `src/styles/globals.css` | reduced-motion audit |
| `src/features/doctor/dashboard/pages/OverviewPage.tsx` | rebuild; delete local `Reveal` |
| `src/features/doctor/dashboard/pages/OverviewPage.test.tsx` | new |
| `vite.config.ts` | visualizer + `manualChunks` |
| `package.json` | devDependency |
| `frontend/FRONTEND_CHECKLIST.md` | tick rows, record measurements, mark DX-03 superseded |

None appears in `claude/adm-06b-communications`.

---

## 10. Definition of done

- [ ] Screens of scroll at 1280×720 **≤ 1.5**, measured with both sections closed, number recorded
- [ ] Alerts and today's schedule above the fold; no alert inside a collapsible
- [ ] Collapse state survives a full page reload
- [ ] One stagger constant in the repo; no local `Reveal` remains; `grep` for `motion.` finds no non-`m` usage
- [ ] Mobile DOM order verified at 375px
- [ ] Reduced motion honored via the app toggle with the OS setting off
- [ ] Bundle before/after table committed into §10.1
- [ ] `typecheck` · `lint` · `test` · `build` all green
- [ ] DX-03 marked ➖ superseded with the DS §9.4 citation
