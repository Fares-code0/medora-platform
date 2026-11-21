# DX F1 — Doctor Dashboard Foundations Implementation Plan

> **Historical implementation plan — not a task register** (labelled 2026-10-26). The work this plan describes has landed. Its checkboxes are the plan's steps as written and were never ticked, so they record nothing about what is done or open. Current status of DX-01…DX-06: [`frontend/FRONTEND_CHECKLIST.md`](../../../frontend/FRONTEND_CHECKLIST.md) §10.1.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the Doctor Overview from 2.61 to ≤1.5 screens of scroll in its default state by reordering it around clinical urgency and putting analytics and activity behind discoverable collapsible sections, on one consolidated motion-token layer with a recorded bundle baseline.

**Architecture:** A new controlled `Collapsible` primitive in `components/ui/` (CSS-grid height animation, no JS measurement) is driven by a persistence hook in the dashboard feature, keeping the primitive domain-agnostic. The local `Reveal` in `OverviewPage.tsx` is promoted to `components/patterns/` and paired with a `Stagger` that owns index arithmetic so duplicate animation indexes become unrepresentable. Motion values live once in `styles/motion.ts`, mirroring the CSS custom properties already in `tokens.css`.

**Tech Stack:** React 18.3.1 · TypeScript strict · Vite 6 · Tailwind 3.4 · framer-motion 11 (LazyMotion `strict`) · Vitest 3 + Testing Library · lucide-react

**Spec:** [`docs/superpowers/specs/2026-08-18-dx-f1-dashboard-foundations-design.md`](../specs/2026-08-18-dx-f1-dashboard-foundations-design.md)

---

## Global Constraints

Every task's requirements implicitly include this section.

- **`m.*` only, never `motion.*`.** `MotionProvider` wraps the app in `LazyMotion({ strict })`; a `motion.*` component throws at runtime, not at build time.
- **`services/preferences.ts` is the ONLY sanctioned localStorage access in the app** (its own file header, FRONTEND_ARCHITECTURE §7/§12.5). Never call `localStorage` directly. New persisted UI state is added to `PreferenceSchema`.
- **Never hardcode a duration or easing.** Use the Tailwind token classes (`duration-moderate`, `ease-out`) in markup and `styles/motion.ts` in TS.
- **Heading levels never skip** (DS §3.4, checklist F-17). `Collapsible` takes `headingAs`, defaulting to `h2` beneath the page `h1`.
- **No alert may live inside a collapsible section** (§10.6). Only Analytics and Activity collapse; `NotificationsWidget` stays always-visible. This is asserted by a test, not by convention.
- **Data values are never animated** (DS §9.4). DX-03 is dropped, not implemented.
- **Target: ≤1.5 screens at 1280×720 in the default state**, measured as `main.scrollHeight / main.clientHeight`. Opening a section may exceed it; that is expected and explicitly out of scope for the target.
- **Do not touch** `features/admin/**`, `features/shared-domain/**`, or `src/routes/index.ts` — a concurrent session owns those on `claude/adm-06b-communications`.
- Gates after every task: `npm --prefix frontend run typecheck` · `lint` · `test` all green.

---

## Three corrections to the spec, found while planning

Implement the plan, not the spec, where they differ. All three were verified against the code.

**1. Persistence must go through the preferences service.** Spec §3.5 proposed a raw `localStorage` key `medora.doctor.dashboard.sections.v1`. That violates `services/preferences.ts:1-6`, which declares itself the only sanctioned localStorage access. The `.v1` keys the spec cited as precedent are mock **data stores** in `features/admin/*/*.api.ts`, not UI preferences. The correct precedent is `sidebarCollapsed` in `PreferenceSchema` (`preferences.ts:37`) — a persisted collapse preference that already exists. Using the service also buys per-user namespacing (`medora.<userId>.dashboardSections`) and automatic clearing on logout, both of which are correct for this state.

**2. Animate with CSS grid rows, not a Framer `height` animation.** Spec §3.4 proposed `m.div` height animation. Framer's `reducedMotion: "always"` disables **transform and layout** animations but still runs `height`, so the Framer route would need bespoke reduced-motion handling. `globals.css:69-76` already collapses every CSS transition to `0.01ms` for **both** `prefers-reduced-motion` **and** the app's `html[data-reduce-motion='on']` switch. Implementing the animation in CSS therefore satisfies DX-05 by construction and needs zero new reduced-motion code.

**3. DX-05 is mostly already done.** The app-level override at `globals.css:69` predates this work and already excludes spinners per DS §9.5. DX-05 becomes a verification-and-test row (Task 5) rather than a build row.

---

## File Structure

| File | Responsibility |
|---|---|
| `frontend/src/styles/motion.ts` | **Create.** Single TS source for durations, easing curves, stagger constants. Mirrors `tokens.css`. |
| `frontend/src/styles/tokens.css` | **Modify** (~line 120). Add `--duration-entrance`, `--motion-stagger`. |
| `frontend/tailwind.config.js` | **Modify** (~line 132). Add `entrance: '300ms'` to `transitionDuration`. |
| `frontend/src/components/patterns/Reveal.tsx` | **Create.** One widget's entrance (fade + 12px rise). |
| `frontend/src/components/patterns/Stagger.tsx` | **Create.** Sequences `Reveal`s; owns index arithmetic. |
| `frontend/src/components/patterns/Stagger.test.tsx` | **Create.** Delay math, cap, no-duplicate-index guarantee. |
| `frontend/src/components/patterns/index.ts` | **Modify.** Export both. |
| `frontend/src/components/ui/Collapsible.tsx` | **Create.** Controlled disclosure; no storage, no domain knowledge. |
| `frontend/src/components/ui/Collapsible.test.tsx` | **Create.** ARIA contract, discoverability affordances, focus containment. |
| `frontend/src/components/ui/index.ts` | **Modify.** Export it. |
| `frontend/src/services/preferences.ts` | **Modify.** Add `dashboardSections` to `PreferenceSchema` + its default. |
| `frontend/src/features/doctor/dashboard/hooks/useDashboardSections.ts` | **Create.** Reads/writes the preference; the only place the dashboard knows about storage. |
| `frontend/src/features/doctor/dashboard/hooks/useDashboardSections.test.ts` | **Create.** Defaults, round-trip, corrupt-value fallback. |
| `frontend/src/features/doctor/dashboard/pages/OverviewPage.tsx` | **Modify.** Rebuild band order; delete local `Reveal`. |
| `frontend/src/features/doctor/dashboard/pages/OverviewPage.test.tsx` | **Create.** Band order, default-closed, alerts-outside-collapsible. |
| `frontend/vite.config.ts` | **Modify.** `manualChunks` + visualizer. |
| `frontend/package.json` | **Modify.** `rollup-plugin-visualizer` devDependency. |
| `frontend/FRONTEND_CHECKLIST.md` | **Modify, last commit only.** Tick rows, record measurements, mark DX-03 superseded. |

---

## Task 1: Motion tokens, `Reveal`, and `Stagger` (DX-02)

**Files:**
- Create: `frontend/src/styles/motion.ts`
- Create: `frontend/src/components/patterns/Reveal.tsx`
- Create: `frontend/src/components/patterns/Stagger.tsx`
- Test: `frontend/src/components/patterns/Stagger.test.tsx`
- Modify: `frontend/src/styles/tokens.css` (after line 123), `frontend/tailwind.config.js` (`transitionDuration`, ~line 132), `frontend/src/components/patterns/index.ts`

**Interfaces:**
- Consumes: nothing — this is the base task.
- Produces:
  - `motionTokens` (const object), `EASE_OUT: [number, number, number, number]`, `staggerDelay(index: number): number` from `@/styles/motion`
  - `Reveal({ index?: number, className?: string, children: ReactNode })` from `@/components/patterns`
  - `Stagger({ items: readonly StaggerItem[], startIndex?: number, className?: string })` and `interface StaggerItem { readonly key: string; readonly className?: string; readonly content: ReactNode }` from `@/components/patterns`

**Context an implementer needs.** `OverviewPage.tsx:28-47` currently defines a private `Reveal` using a **30ms** stagger. `FRONTEND_CHECKLIST.md` §10.0(5) records that this conflicts with the upgrade brief's 40–60ms and requires DX-02 to pick one number and delete the local copy. **The decision is 50ms**, the brief's midpoint, with the existing 200ms duration and 12px rise unchanged. The value is deliberately not overridable per-surface.

`OverviewPage.tsx:121` and `:124` both pass `index={8}`, so two widgets animate in simultaneously. `Stagger` exists to make that unrepresentable: callers never write an index. The `items`-array shape mirrors the repo's own `Tabs` primitive (`Tabs.tsx:15-22`, `TabItem { value, label, content?: ReactNode }`), so this is the established convention, not a new one.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/patterns/Stagger.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { motionTokens, staggerDelay } from '@/styles/motion';

import { Stagger } from './Stagger';

/**
 * Stagger owns the entrance index so callers cannot repeat one — the defect
 * it replaces, where OverviewPage passed index={8} to two different widgets
 * and they animated in together.
 */
describe('staggerDelay', () => {
  it('spaces items by one stagger token', () => {
    expect(staggerDelay(0)).toBe(0);
    expect(staggerDelay(1)).toBeCloseTo(motionTokens.stagger);
    expect(staggerDelay(3)).toBeCloseTo(motionTokens.stagger * 3);
  });

  it('caps the delay so a long list never crawls in', () => {
    const capped = staggerDelay(motionTokens.staggerCap);

    expect(staggerDelay(20)).toBe(capped);
    expect(staggerDelay(9)).toBe(capped);
  });

  it('resolves the 30ms vs 40-60ms conflict at 50ms', () => {
    expect(motionTokens.stagger).toBe(0.05);
  });
});

describe('Stagger', () => {
  it('renders every item once, in order', () => {
    render(
      <Stagger
        items={[
          { key: 'a', content: <p>First</p> },
          { key: 'b', content: <p>Second</p> },
          { key: 'c', content: <p>Third</p> },
        ]}
      />,
    );

    const paragraphs = screen.getAllByText(/First|Second|Third/);
    expect(paragraphs.map((node) => node.textContent)).toEqual(['First', 'Second', 'Third']);
  });

  it('applies each item’s own layout class to its wrapper', () => {
    render(
      <Stagger
        items={[
          { key: 'wide', className: 'lg:col-span-2', content: <p>Wide</p> },
          { key: 'narrow', content: <p>Narrow</p> },
        ]}
      />,
    );

    expect(screen.getByText('Wide').parentElement).toHaveClass('lg:col-span-2');
    expect(screen.getByText('Narrow').parentElement).not.toHaveClass('lg:col-span-2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm --prefix frontend run test -- Stagger
```

Expected: FAIL — `Cannot find module '@/styles/motion'`.

- [ ] **Step 3: Create the motion token module**

Create `frontend/src/styles/motion.ts`:

```ts
/**
 * Motion tokens — DS §9.3/§9.4, mirroring the custom properties in
 * tokens.css so stylesheets and TS callers cannot drift apart.
 *
 * Durations are SECONDS because that is what Framer Motion takes; the CSS
 * tokens carry the same values in milliseconds.
 *
 * The stagger resolves the conflict FRONTEND_CHECKLIST §10.0(5) records:
 * the shipped Reveal used 30ms, the upgrade brief asked for 40-60ms. 50ms
 * is the brief's midpoint. 8 items x 50ms = 400ms before the last widget
 * starts, +200ms to settle, so every item stays inside the 300-500ms
 * entrance band. It is deliberately not overridable per surface — §10.0
 * warns against leaving two conventions in the repo.
 */
export const motionTokens = {
  duration: {
    fast: 0.1,
    base: 0.15,
    moderate: 0.2,
    slow: 0.25,
    entrance: 0.3,
  },
  /** Per-item entrance delay, in seconds. */
  stagger: 0.05,
  /** Items past this index share the last delay. */
  staggerCap: 8,
} as const;

/** Default easing — entrances start fast and settle gently (DS §9.3). */
export const EASE_OUT: [number, number, number, number] = [0, 0, 0.2, 1];

/** Entrance delay for the item at `index`, capped per `motionTokens.staggerCap`. */
export function staggerDelay(index: number): number {
  return Math.min(Math.max(index, 0), motionTokens.staggerCap) * motionTokens.stagger;
}
```

- [ ] **Step 4: Add the matching CSS tokens**

In `frontend/src/styles/tokens.css`, immediately after the `--ease-in-out` declaration (line 123), add:

```css
  --duration-entrance: 300ms;
  /* Per-item entrance delay — see styles/motion.ts for the rationale. */
  --motion-stagger: 50ms;
```

In `frontend/tailwind.config.js`, add `entrance` to the existing `transitionDuration` block (~line 132) so it reads:

```js
      transitionDuration: {
        fast: '100ms',
        base: '150ms',
        moderate: '200ms',
        slow: '250ms',
        entrance: '300ms',
      },
```

- [ ] **Step 5: Create `Reveal`**

Create `frontend/src/components/patterns/Reveal.tsx`:

```tsx
import type { ReactNode } from 'react';

import { m } from 'framer-motion';

import { EASE_OUT, motionTokens, staggerDelay } from '@/styles/motion';

/**
 * Reveal — one widget's entrance (UX §4.2): fade + 12px rise.
 * Promoted out of OverviewPage so the whole app shares one entrance.
 * Prefer <Stagger> over passing `index` by hand; it owns the arithmetic.
 *
 * `m.div`, never `motion.div` — MotionProvider's LazyMotion is `strict`.
 * Reduced motion is handled globally by MotionConfig, not here.
 */
export interface RevealProps {
  /** Position in the entrance sequence. Delays cap at motionTokens.staggerCap. */
  index?: number;
  className?: string | undefined;
  children: ReactNode;
}

export function Reveal({ index = 0, className, children }: RevealProps) {
  return (
    <m.div
      className={className}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: motionTokens.duration.moderate,
        ease: EASE_OUT,
        delay: staggerDelay(index),
      }}
    >
      {children}
    </m.div>
  );
}
```

- [ ] **Step 6: Create `Stagger`**

Create `frontend/src/components/patterns/Stagger.tsx`:

```tsx
import type { ReactNode } from 'react';

import { Reveal } from './Reveal';

/**
 * Stagger — sequences a band of widgets into one entrance.
 *
 * It owns the index arithmetic, which is the point: callers never write an
 * index, so two siblings cannot share one. The previous hand-indexed API
 * let OverviewPage pass index={8} to two widgets, which animated in
 * together. The `items` shape mirrors the Tabs primitive.
 */
export interface StaggerItem {
  readonly key: string;
  /** Layout classes for this item's wrapper (e.g. a grid-column span). */
  readonly className?: string;
  readonly content: ReactNode;
}

export interface StaggerProps {
  items: readonly StaggerItem[];
  /** Index the first item starts at, continuing an earlier band's sequence. */
  startIndex?: number;
  className?: string;
}

export function Stagger({ items, startIndex = 0, className }: StaggerProps) {
  return (
    <div className={className}>
      {items.map((item, offset) => (
        <Reveal key={item.key} index={startIndex + offset} className={item.className}>
          {item.content}
        </Reveal>
      ))}
    </div>
  );
}
```

- [ ] **Step 7: Export both from the patterns barrel**

In `frontend/src/components/patterns/index.ts`, add these entries, keeping the file's alphabetical ordering:

```ts
export { Reveal, type RevealProps } from './Reveal';
export { Stagger, type StaggerItem, type StaggerProps } from './Stagger';
```

- [ ] **Step 8: Run the tests**

```bash
npm --prefix frontend run test -- Stagger
```

Expected: PASS, 5 tests.

- [ ] **Step 9: Typecheck and lint**

```bash
npm --prefix frontend run typecheck && npm --prefix frontend run lint
```

Expected: 0 errors. Warning count must not exceed the 17-warning baseline recorded in checklist §7.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/styles/motion.ts frontend/src/styles/tokens.css frontend/tailwind.config.js frontend/src/components/patterns/
git commit -m "feat(dx-02): one motion token layer with Reveal and Stagger

Resolves the 30ms vs 40-60ms stagger conflict at 50ms, the brief's
midpoint, and puts it in one place. Stagger owns the entrance index so
siblings cannot share one, which is how OverviewPage ended up animating
two widgets in together on index 8.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: `Collapsible` primitive (DX-01)

**Files:**
- Create: `frontend/src/components/ui/Collapsible.tsx`
- Test: `frontend/src/components/ui/Collapsible.test.tsx`
- Modify: `frontend/src/components/ui/index.ts`

**Interfaces:**
- Consumes: nothing from Task 1 — independent.
- Produces: `Collapsible({ id, title, caption?, summary?, open, onOpenChange, headingAs?, className?, children })` from `@/components/ui`, with `interface CollapsibleProps`.

**Context an implementer needs.** None of the 30 existing UI primitives is a disclosure — `Tabs`, `Drawer`, `Modal` and `Dropdown` exist, no accordion. `hooks/useDisclosure.ts` is open/close state only, with no persistence and no animation.

**This component is controlled and storage-free**, matching `Tabs` (`value` + `onValueChange`). `components/ui/index.ts:1-5` requires these primitives to be "prop-driven, token-styled, router- and domain-agnostic", so persistence belongs to the caller (Task 3), not here.

**Animate with CSS grid rows, not Framer.** The `grid-template-rows: 0fr → 1fr` technique animates to auto height with no JS measurement. This matters for reduced motion: Framer's `reducedMotion: "always"` disables transform and layout animations but **still runs `height`**, whereas `globals.css:69-76` already collapses every CSS transition to `0.01ms` for both `prefers-reduced-motion` and the app's own `html[data-reduce-motion='on']` switch. CSS gets DX-05 for free.

**Closed content uses `visibility: hidden`, not `inert`.** React 18.3 has no `inert` prop typing. `visibility: hidden` removes the subtree from the tab order and the accessibility tree, and it transitions discretely — staying visible through a close animation, flipping visible immediately on open — which is exactly the behavior wanted. The subtree stays **mounted** so opening is instant and no query refires.

**The user's five discoverability requirements are implemented by these props and asserted in Step 1's tests:** the header is always rendered as a bordered, always-visible surface (never a bare line of text); `caption` states what the section contains; `summary` carries a count so a closed section advertises that content exists; the chevron rotates with state; and `aria-expanded` makes the state programmatic, not just visual. A closed section must read as *closed*, never as *absent or broken*.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/ui/Collapsible.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Collapsible } from './Collapsible';

function Harness({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible
      id="analytics"
      title="Analytics"
      caption="Practice pulse and appointment trend"
      summary="2 charts"
      open={open}
      onOpenChange={setOpen}
    >
      <a href="/doctor/reports">Inside link</a>
    </Collapsible>
  );
}

describe('Collapsible', () => {
  it('exposes its state through aria-expanded', async () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: /Analytics/ });

    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('points aria-controls at the panel it actually controls', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: /Analytics/ });

    const panelId = trigger.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    expect(document.getElementById(panelId as string)).toBeInTheDocument();
  });

  // The four discoverability requirements: a closed section must read as
  // closed, never as absent or broken.
  it('keeps title, caption and summary visible while closed', () => {
    render(<Harness />);

    expect(screen.getByText('Analytics')).toBeVisible();
    expect(screen.getByText('Practice pulse and appointment trend')).toBeVisible();
    expect(screen.getByText('2 charts')).toBeVisible();
  });

  it('keeps closed content mounted so opening is instant', () => {
    render(<Harness />);

    // Present in the DOM...
    expect(screen.getByText('Inside link')).toBeInTheDocument();
  });

  it('renders the title at the requested heading level', () => {
    render(<Harness />);

    // Regex, not an exact string: the heading wraps the trigger button, so
    // its accessible name is title + caption + summary concatenated.
    expect(screen.getByRole('heading', { level: 2, name: /Analytics/ })).toBeInTheDocument();
  });

  it('opens on click and reports the change once', async () => {
    const onOpenChange = vi.fn();
    render(
      <Collapsible id="activity" title="Activity" open={false} onOpenChange={onOpenChange}>
        <p>Body</p>
      </Collapsible>,
    );

    await userEvent.click(screen.getByRole('button', { name: /Activity/ }));

    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('is operable from the keyboard', async () => {
    render(<Harness />);

    await userEvent.tab();
    expect(screen.getByRole('button', { name: /Analytics/ })).toHaveFocus();

    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: /Analytics/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm --prefix frontend run test -- Collapsible
```

Expected: FAIL — `Failed to resolve import "./Collapsible"`.

- [ ] **Step 3: Implement the component**

Create `frontend/src/components/ui/Collapsible.tsx`:

```tsx
import { useId } from 'react';
import type { ReactNode } from 'react';

import { ChevronDown } from 'lucide-react';

import { cn } from '@/utils/cn';

/**
 * Collapsible — a titled disclosure section (DS §9.4: "height auto-animate
 * 200ms ease-out with content fade").
 *
 * Controlled, like Tabs: it holds no state and knows nothing about storage,
 * so a caller decides whether the choice persists.
 *
 * A closed section must read as *closed*, never as absent or broken, so the
 * header is an always-visible bordered surface carrying the title, an
 * optional caption naming the contents, and an optional summary advertising
 * how much is inside.
 *
 * Height animates through `grid-template-rows: 0fr -> 1fr` rather than
 * Framer, for a reason: Framer's `reducedMotion: "always"` still runs height
 * animations, while globals.css already collapses every CSS transition for
 * both `prefers-reduced-motion` and the app's own reduce-motion switch.
 *
 * Closed content stays mounted (opening is instant, nothing refires) but is
 * `visibility: hidden`, which takes it out of both the tab order and the
 * accessibility tree. Anything a doctor must not miss therefore belongs
 * outside a Collapsible — see FRONTEND_CHECKLIST §10.6.
 */
export interface CollapsibleProps {
  /** Stable id; the panel derives its DOM id from it. */
  id: string;
  title: string;
  /** Names what is inside. Stays visible when closed. */
  caption?: string | undefined;
  /** How much is inside, e.g. "2 charts". Stays visible when closed. */
  summary?: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Heading element, h2 by default; never skip levels (DS §3.4). */
  headingAs?: 'h2' | 'h3' | 'h4';
  className?: string;
  children: ReactNode;
}

export function Collapsible({
  id,
  title,
  caption,
  summary,
  open,
  onOpenChange,
  headingAs: Heading = 'h2',
  className,
  children,
}: CollapsibleProps) {
  const baseId = useId();
  const panelId = `${baseId}-${id}-panel`;
  const triggerId = `${baseId}-${id}-trigger`;

  return (
    <section className={cn('rounded-xl border border-border bg-surface', className)}>
      <Heading>
        <button
          type="button"
          id={triggerId}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => {
            onOpenChange(!open);
          }}
          className={cn(
            'flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left',
            'transition-colors duration-fast ease-out hover:bg-surface-sunken',
          )}
        >
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'size-5 shrink-0 text-text-secondary',
              'transition-transform duration-moderate ease-out',
              open ? 'rotate-0' : '-rotate-90',
            )}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-h5 font-semibold text-text-primary">{title}</span>
            {caption ? (
              <span className="mt-0.5 block text-body-sm text-text-secondary">{caption}</span>
            ) : null}
          </span>
          {summary ? (
            <span className="shrink-0 rounded-full bg-surface-sunken px-2 py-0.5 text-caption font-medium text-text-secondary tabular-nums">
              {summary}
            </span>
          ) : null}
        </button>
      </Heading>

      <div
        className={cn(
          'grid transition-[grid-template-rows,visibility] duration-moderate ease-out',
          open ? 'visible grid-rows-[1fr]' : 'invisible grid-rows-[0fr]',
        )}
      >
        <div id={panelId} role="region" aria-labelledby={triggerId} className="overflow-hidden">
          <div className="px-4 pb-4 pt-1">{children}</div>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run the tests**

```bash
npm --prefix frontend run test -- Collapsible
```

Expected: PASS, 7 tests.

If `toBeVisible()` fails on the summary/caption assertions, the header markup has been nested inside the animating grid by mistake — the header must be a sibling of the panel, never a child.

- [ ] **Step 5: Export from the ui barrel**

In `frontend/src/components/ui/index.ts`, insert between the `Chip` and `ConfirmationDialog` exports to keep alphabetical order:

```ts
export { Collapsible, type CollapsibleProps } from './Collapsible';
```

- [ ] **Step 6: Typecheck and lint**

```bash
npm --prefix frontend run typecheck && npm --prefix frontend run lint
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/ui/Collapsible.tsx frontend/src/components/ui/Collapsible.test.tsx frontend/src/components/ui/index.ts
git commit -m "feat(dx-01): add a Collapsible disclosure primitive

The app had no accordion — Tabs, Drawer, Modal and Dropdown, but nothing
that opens in place. Controlled and storage-free like Tabs, so the caller
decides whether the choice persists.

Height animates via grid-template-rows rather than Framer: Framer's
reducedMotion still runs height animations, while globals.css already
collapses CSS transitions for both the media query and the app toggle.
Closed content stays mounted but visibility:hidden, so it leaves the tab
order and the a11y tree without unmounting.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Persisted section state (DX-01)

**Files:**
- Modify: `frontend/src/services/preferences.ts`
- Create: `frontend/src/features/doctor/dashboard/hooks/useDashboardSections.ts`
- Test: `frontend/src/features/doctor/dashboard/hooks/useDashboardSections.test.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1–2.
- Produces:
  - `interface DashboardSections { analytics: boolean; activity: boolean }` and `DEFAULT_DASHBOARD_SECTIONS` from `@/services/preferences`
  - `useDashboardSections(): { sections: DashboardSections; setSection: (key: keyof DashboardSections, open: boolean) => void }` from `../hooks/useDashboardSections`

**Context an implementer needs.** `services/preferences.ts:1-6` declares itself "The ONLY sanctioned localStorage access in the app". Never call `localStorage` directly. `getPreference` already swallows parse errors and returns `null` (`preferences.ts:52-62`), and `setPreference` already swallows quota/private-mode failures (`:64-74`), so the hook needs no try/catch of its own.

Keys not in `GLOBAL_KEYS` are namespaced per user (`preferences.ts:45-50`), which is correct here — a collapse choice is one doctor's, and `clearUserPreferences` wipes it on logout. `sidebarCollapsed` is the existing precedent for exactly this kind of persisted UI collapse state.

**Both sections default to closed.** Defaulting Analytics open would make the ≤1.5-screen target conditional on Activity being closed, and an acceptance criterion that passes in only one of two default states is not a criterion.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/features/doctor/dashboard/hooks/useDashboardSections.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useDashboardSections } from './useDashboardSections';

afterEach(() => {
  localStorage.clear();
});

describe('useDashboardSections', () => {
  it('starts with both sections closed so the density target is unconditional', () => {
    const { result } = renderHook(() => useDashboardSections());

    expect(result.current.sections).toEqual({ analytics: false, activity: false });
  });

  it('remembers a section the doctor opened', () => {
    const { result, unmount } = renderHook(() => useDashboardSections());

    act(() => {
      result.current.setSection('analytics', true);
    });
    expect(result.current.sections.analytics).toBe(true);
    unmount();

    const remounted = renderHook(() => useDashboardSections());
    expect(remounted.result.current.sections.analytics).toBe(true);
    expect(remounted.result.current.sections.activity).toBe(false);
  });

  it('falls back to the defaults when the stored value is corrupt', () => {
    localStorage.setItem('medora.anonymous.dashboardSections', '{not json');

    const { result } = renderHook(() => useDashboardSections());

    expect(result.current.sections).toEqual({ analytics: false, activity: false });
  });

  it('fills in a key missing from an older stored shape', () => {
    localStorage.setItem('medora.anonymous.dashboardSections', JSON.stringify({ analytics: true }));

    const { result } = renderHook(() => useDashboardSections());

    expect(result.current.sections).toEqual({ analytics: true, activity: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm --prefix frontend run test -- useDashboardSections
```

Expected: FAIL — `Failed to resolve import "./useDashboardSections"`.

- [ ] **Step 3: Extend the preference schema**

In `frontend/src/services/preferences.ts`, add this interface and default immediately after the `DEFAULT_INTERFACE_SETTINGS` block (after line 31):

```ts
/**
 * Which Doctor Overview sections are expanded. Both closed by default so the
 * dashboard's density target holds on first paint (FRONTEND_CHECKLIST DX-01).
 * Per-user, like sidebarCollapsed, and cleared on logout.
 */
export interface DashboardSections {
  analytics: boolean;
  activity: boolean;
}

export const DEFAULT_DASHBOARD_SECTIONS: DashboardSections = {
  analytics: false,
  activity: false,
};
```

Then add the key to `PreferenceSchema` (after line 39, inside the interface):

```ts
  /** Expanded/collapsed Doctor Overview sections. */
  dashboardSections: DashboardSections;
```

Leave `GLOBAL_KEYS` unchanged — this preference is per-user by design.

- [ ] **Step 4: Write the hook**

Create `frontend/src/features/doctor/dashboard/hooks/useDashboardSections.ts`:

```ts
import { useCallback, useState } from 'react';

import {
  DEFAULT_DASHBOARD_SECTIONS,
  getPreference,
  setPreference,
  type DashboardSections,
} from '@/services/preferences';

/**
 * Persisted expand/collapse state for the Doctor Overview's two optional
 * sections. The only place the dashboard knows storage exists — Collapsible
 * itself is controlled and storage-free.
 *
 * Reads are merged over the defaults rather than trusted wholesale, so a
 * value written by an older build that lacked a key still yields a complete
 * object. getPreference already returns null for corrupt JSON.
 */
function readSections(): DashboardSections {
  const stored = getPreference('dashboardSections');
  if (stored === null || typeof stored !== 'object') return DEFAULT_DASHBOARD_SECTIONS;
  return { ...DEFAULT_DASHBOARD_SECTIONS, ...stored };
}

export function useDashboardSections(): {
  sections: DashboardSections;
  setSection: (key: keyof DashboardSections, open: boolean) => void;
} {
  const [sections, setSections] = useState<DashboardSections>(readSections);

  const setSection = useCallback((key: keyof DashboardSections, open: boolean) => {
    setSections((previous) => {
      const next = { ...previous, [key]: open };
      setPreference('dashboardSections', next);
      return next;
    });
  }, []);

  return { sections, setSection };
}
```

- [ ] **Step 5: Run the tests**

```bash
npm --prefix frontend run test -- useDashboardSections
```

Expected: PASS, 4 tests.

If the corrupt-value test fails, confirm `getPreference` is being used rather than a direct `JSON.parse` — the service is what swallows the parse error.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
npm --prefix frontend run typecheck && npm --prefix frontend run lint
```

```bash
git add frontend/src/services/preferences.ts frontend/src/features/doctor/dashboard/hooks/
git commit -m "feat(dx-01): persist Doctor Overview section state

Goes through the preferences service rather than raw localStorage — that
service is the app's only sanctioned localStorage access, and it brings
per-user namespacing and clearing on logout, both correct for a per-doctor
UI choice. sidebarCollapsed is the existing precedent.

Stored values are merged over the defaults, so a shape written by an older
build that lacked a key still yields a complete object.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Rebuild the Overview page (DX-01, DX-04)

**Files:**
- Modify: `frontend/src/features/doctor/dashboard/pages/OverviewPage.tsx` (full rewrite of the component body; delete the local `Reveal` at lines 28-47)
- Test: `frontend/src/features/doctor/dashboard/pages/OverviewPage.test.tsx`

**Interfaces:**
- Consumes: `Reveal`, `Stagger`, `StaggerItem` from `@/components/patterns` (Task 1); `Collapsible` from `@/components/ui` (Task 2); `useDashboardSections` from `../hooks/useDashboardSections` (Task 3).
- Produces: nothing consumed by later tasks.

**Context an implementer needs.** The page currently renders four `Grid` bands in analytics-then-activity order with `NotificationsWidget` buried in a side rail at index 5. The rebuild orders by clinical urgency:

| # | Band | Contents | Treatment |
|---|---|---|---|
| 1 | Hero | Greeting, date, decision count | Always visible |
| 2 | **Alerts** | `NotificationsWidget` | Always visible — **promoted out of the side rail** |
| 3 | **Today** | `ScheduleWidget` + `QuickActionsWidget` | Always visible |
| 4 | KPIs | `MOCK_KPIS` → `KpiWidget` | Always visible |
| 5 | Analytics | `PracticePulseWidget`, `AppointmentsTrendWidget` | Collapsible, default closed |
| 6 | Activity | `RecentActivityWidget`, `AiAssistantWidget`, `SatisfactionWidget` | Collapsible, default closed |

Promoting alerts above the KPI row is what satisfies §10.6 — the two collapsible bands contain no alerts, so "critical alerts never live behind a closed disclosure" holds by construction rather than by care.

**DX-04's mobile order** (alerts → today's appointments → KPI summary → patient actions → analytics → activity) is already this DOM order, with one exception: `QuickActionsWidget` sits beside the schedule at `lg` and must fall directly beneath it at base. A single-column-at-base grid gives that for free, so no `order-*` utilities are needed. Verify rather than assume.

Keep `PageContainer width="2xl"`, the hero band markup, and `greetingForHour` exactly as they are — this task changes composition, not chrome.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/features/doctor/dashboard/pages/OverviewPage.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { AppProviders } from '@/app/providers';

import { OverviewPage } from './OverviewPage';

afterEach(() => {
  localStorage.clear();
});

/**
 * MemoryRouter wraps AppProviders, not the other way round: AppProviders
 * composes AuthProvider and DoctorProfileProvider, and a provider reaching
 * for a router hook outside a Router throws.
 */
function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/doctor/overview']}>
      <AppProviders>
        <OverviewPage />
      </AppProviders>
    </MemoryRouter>,
  );
}

describe('OverviewPage', () => {
  it('opens with both optional sections collapsed', () => {
    renderPage();

    expect(screen.getByRole('button', { name: /Analytics/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByRole('button', { name: /Activity/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  /**
   * FRONTEND_CHECKLIST §10.6: critical alerts must never live behind a closed
   * disclosure. This is the regression guard against someone later tidying
   * the notifications widget into a collapsed section.
   */
  it('keeps alerts outside every collapsible section', () => {
    const { container } = renderPage();

    const alerts = screen.getByTestId('dashboard-alerts');
    expect(alerts).toBeInTheDocument();

    const collapsiblePanels = container.querySelectorAll('[role="region"]');
    collapsiblePanels.forEach((panel) => {
      expect(panel.contains(alerts)).toBe(false);
    });
  });

  it('orders the bands by clinical urgency, alerts before analytics', () => {
    renderPage();

    const alerts = screen.getByTestId('dashboard-alerts');
    const analytics = screen.getByRole('button', { name: /Analytics/ });

    // Node.DOCUMENT_POSITION_FOLLOWING === 4
    expect(alerts.compareDocumentPosition(analytics) & 4).toBeTruthy();
  });

  it('names what is inside each collapsed section', () => {
    renderPage();

    expect(screen.getByRole('button', { name: /Analytics/ })).toHaveTextContent(/chart/i);
    expect(screen.getByRole('button', { name: /Activity/ })).toHaveTextContent(/update|item/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm --prefix frontend run test -- OverviewPage
```

Expected: FAIL — no element with test id `dashboard-alerts`, and no Analytics/Activity buttons.

`AppProviders` is exported from `src/app/providers/index.tsx:20` and composes Locale → Theme → InterfaceSettings → Query → Auth → DoctorProfile → Motion → Toast. The page needs `DoctorProfileProvider` (for `useDoctorProfile`) and `MotionProvider` (for the `m.*` components inside `Reveal`), so use the whole barrel rather than hand-picking providers.

- [ ] **Step 3: Rebuild the page**

Replace the whole body of `frontend/src/features/doctor/dashboard/pages/OverviewPage.tsx` with:

```tsx
import { ContentHeader, Grid, PageContainer, Stack } from '@/components/layout';
import { KpiWidget, Stagger, type StaggerItem } from '@/components/patterns';
import { Collapsible } from '@/components/ui';
import { useDoctorProfile } from '@/app/providers';

import { AiAssistantWidget } from '../components/AiAssistantWidget';
import { AppointmentsTrendWidget } from '../components/AppointmentsTrendWidget';
import { NotificationsWidget } from '../components/NotificationsWidget';
import { PracticePulseWidget } from '../components/PracticePulseWidget';
import { QuickActionsWidget } from '../components/QuickActionsWidget';
import { RecentActivityWidget } from '../components/RecentActivityWidget';
import { SatisfactionWidget } from '../components/SatisfactionWidget';
import { ScheduleWidget } from '../components/ScheduleWidget';
import { useDashboardSections } from '../hooks/useDashboardSections';
import { MOCK_KPIS, MOCK_SCHEDULE } from '../model/mock-data';

/**
 * Doctor Overview (UX §2.1) — mission control for *today*.
 *
 * Ordered by clinical urgency (DX-01): alerts and today's schedule are
 * always visible, analytics and activity sit behind collapsed sections that
 * remember the doctor's choice. Both start closed so the density target
 * (<=1.5 screens at 1280x720) holds on first paint without depending on
 * which section happens to be open.
 *
 * No alert may move into a Collapsible — see FRONTEND_CHECKLIST §10.6, and
 * the covering test in OverviewPage.test.tsx.
 *
 * All data is frontend mock (model/mock-data.ts); DP-04 swaps in query hooks
 * without changing this composition.
 */

function greetingForHour(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function OverviewPage() {
  const { profile } = useDoctorProfile();
  const { sections, setSection } = useDashboardSections();

  const today = new Intl.DateTimeFormat('en', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date());
  const pendingCount = MOCK_KPIS.find((kpi) => kpi.id === 'pending-requests')?.value ?? '0';

  const todayItems: readonly StaggerItem[] = [
    { key: 'schedule', className: 'lg:col-span-2', content: <ScheduleWidget /> },
    { key: 'quick-actions', content: <QuickActionsWidget /> },
  ];

  const kpiItems: readonly StaggerItem[] = MOCK_KPIS.map((kpi) => ({
    key: kpi.id,
    content: (
      <KpiWidget
        label={kpi.label}
        value={kpi.value}
        icon={kpi.icon}
        tone={kpi.tone}
        delta={kpi.delta}
        caption={kpi.caption}
        sparkline={kpi.sparkline}
        href={kpi.href}
      />
    ),
  }));

  return (
    <PageContainer width="2xl" className="py-5 md:py-6">
      <Stack gap={6}>
        {/* ── Welcome (executive hero band) ──────────────────────── */}
        <div className="rounded-xl border border-border bg-gradient-to-r from-primary-subtle via-surface to-surface px-4 py-4 shadow-xs md:px-5">
          <ContentHeader
            title={`${greetingForHour(new Date().getHours())}, ${profile.fullName || 'Doctor'}`}
            caption={`${today} · ${String(MOCK_SCHEDULE.length)} appointments today · ${pendingCount} ${
              pendingCount === '1' ? 'request needs' : 'requests need'
            } your decision`}
          />
        </div>

        {/* ── Alerts — never inside a disclosure (§10.6) ──────────── */}
        <div data-testid="dashboard-alerts">
          <NotificationsWidget />
        </div>

        {/* ── Today: schedule beside the action rail ─────────────── */}
        <Stagger
          items={todayItems}
          startIndex={1}
          className="grid grid-cols-1 gap-4 lg:grid-cols-3"
        />

        {/* ── KPI row (P5) ───────────────────────────────────────── */}
        <Stagger items={kpiItems} startIndex={3} className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4" />

        {/* ── Analytics — collapsed by default (DX-01) ────────────── */}
        <Collapsible
          id="analytics"
          title="Analytics"
          caption="Practice pulse and appointment trend"
          summary="2 charts"
          open={sections.analytics}
          onOpenChange={(open) => {
            setSection('analytics', open);
          }}
        >
          <Grid columns={{ base: 1, lg: 3 }} gap={4}>
            <PracticePulseWidget className="h-full" />
            <div className="lg:col-span-2">
              <AppointmentsTrendWidget />
            </div>
          </Grid>
        </Collapsible>

        {/* ── Activity — collapsed by default (DX-01) ─────────────── */}
        <Collapsible
          id="activity"
          title="Activity"
          caption="Recent activity, AI assistant and patient satisfaction"
          summary="3 updates"
          open={sections.activity}
          onOpenChange={(open) => {
            setSection('activity', open);
          }}
        >
          <Grid columns={{ base: 1, lg: 3 }} gap={4}>
            <div className="lg:col-span-2">
              <RecentActivityWidget />
            </div>
            <Stack gap={4}>
              <AiAssistantWidget />
              <SatisfactionWidget />
            </Stack>
          </Grid>
        </Collapsible>
      </Stack>
    </PageContainer>
  );
}
```

Note the `Grid preset="kpi"` has been inlined as explicit classes because `Stagger` renders its own wrapper. If you prefer to keep `preset="kpi"`, give `Stagger` the preset's resolved classes — `PRESETS.kpi` is `{ base: 1, md: 2, lg: 4 }` (`Grid.tsx:61-62`), which is what the inline string above reproduces.

- [ ] **Step 4: Run the tests**

```bash
npm --prefix frontend run test -- OverviewPage
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Confirm the local `Reveal` is gone**

```bash
grep -n "function Reveal" frontend/src/features/doctor/dashboard/pages/OverviewPage.tsx
```

Expected: no output. One `Reveal` in the repo, in `components/patterns/`.

```bash
grep -rn "motion\." frontend/src/components/patterns/ frontend/src/components/ui/Collapsible.tsx
```

Expected: no output — `m.*` only, per the LazyMotion `strict` boundary.

- [ ] **Step 6: Run the full suite**

```bash
npm --prefix frontend run test
```

Expected: PASS. Total must be ≥ 52 + the 20 added by Tasks 1–4; no previously-passing test may fail.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
npm --prefix frontend run typecheck && npm --prefix frontend run lint
```

```bash
git add frontend/src/features/doctor/dashboard/pages/
git commit -m "feat(dx-01,dx-04): reorder the Doctor Overview around urgency

Alerts move out of the side rail to sit directly under the hero, above the
KPI row. Analytics and activity move behind collapsed sections that
remember the doctor's choice. Both start closed, so the density target
holds on first paint rather than depending on which section is open.

Because the only two collapsible bands hold no alerts, §10.6's rule that
critical alerts never sit behind a closed disclosure now holds by
construction — with a test asserting it.

The local Reveal is deleted; the page uses the shared Stagger, which ends
the duplicate index={8} that animated two widgets in together.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Reduced-motion verification (DX-05)

**Files:**
- Test: `frontend/src/components/ui/Collapsible.test.tsx` (append)
- Modify: `frontend/src/styles/globals.css` — **only if** Step 2 finds a gap

**Interfaces:**
- Consumes: `Collapsible` (Task 2).
- Produces: nothing.

**Context an implementer needs.** This is largely a verification row. `globals.css:69-76` already collapses every CSS transition to `0.01ms` under **both** `html[data-reduce-motion='on']` (the in-app toggle, set by `InterfaceSettingsProvider:43`) and `@media (prefers-reduced-motion: reduce)` (`globals.css:112`), and both already exclude `.animate-spin` / `.animate-progress-sweep` because progress indication is functional (DS §9.5).

The requirement DX-05 actually names — *the app toggle must win even when the OS setting is off* — is met by the `html[data-reduce-motion='on']` selector, which does not consult the media query at all. Task 2 deliberately chose a CSS animation so `Collapsible` falls under this umbrella.

**Do not add a `motion-reduce:` Tailwind variant.** `OverviewKpiRow.tsx:31-34` explains why: that variant only knows about `prefers-reduced-motion`, so it would silently miss the app toggle.

- [ ] **Step 1: Append the covering test**

Add to `frontend/src/components/ui/Collapsible.test.tsx`:

**First**, add a stable hook to `Collapsible.tsx` — do not select on escaped Tailwind class names. On the animating grid wrapper, add `data-collapsible-panel` and reflect the state:

```tsx
      <div
        data-collapsible-panel
        data-state={open ? 'open' : 'closed'}
        className={cn(
          'grid transition-[grid-template-rows,visibility] duration-moderate ease-out',
          open ? 'visible grid-rows-[1fr]' : 'invisible grid-rows-[0fr]',
        )}
      >
```

Then append to `frontend/src/components/ui/Collapsible.test.tsx`:

```tsx
describe('Collapsible under reduced motion', () => {
  it('marks the closed panel hidden, so it leaves the tab order and the a11y tree', async () => {
    const { container } = render(<Harness />);
    const panel = container.querySelector('[data-collapsible-panel]');

    expect(panel).toHaveAttribute('data-state', 'closed');
    expect(panel).toHaveClass('invisible');

    await userEvent.click(screen.getByRole('button', { name: /Analytics/ }));

    expect(panel).toHaveAttribute('data-state', 'open');
    expect(panel).toHaveClass('visible');
  });
});
```

**Why this asserts classes rather than focus behaviour.** jsdom does not load the Tailwind stylesheet, so `visibility: hidden` is never computed and `userEvent.tab()` would happily focus a link inside a closed panel — a focus-order test here would pass or fail for reasons unrelated to the component. The real behaviour is therefore verified in the browser at Step 2, where the CSS actually applies. Asserting the class in jsdom and the behaviour in the browser is the honest split; do not write a jsdom test that appears to prove focus containment.

- [ ] **Step 2: Verify in the browser, both switches**

Start the dev server if it is not already running:

```bash
npm --prefix frontend run dev
```

Sign in at `http://localhost:5173` as `doctor@medora.health` / `Medora123!`. Then, **with the OS reduced-motion setting OFF**, turn on Settings → Accessibility → Reduce motion and run in the console:

```js
JSON.stringify({
  appToggle: document.documentElement.dataset.reduceMotion,
  osPrefers: matchMedia('(prefers-reduced-motion: reduce)').matches,
  panelTransitionMs: getComputedStyle(
    document.querySelector('[data-collapsible-panel]') ?? document.body,
  ).transitionDuration,
  spinnerStillAnimates: getComputedStyle(
    document.querySelector('.animate-progress-sweep') ?? document.body,
  ).animationDuration,
})
```

Expected: `appToggle: "on"`, `osPrefers: false`, `panelTransitionMs: "0.01ms"` — the app toggle winning with the OS setting off, which is the DX-05 requirement. Any `.animate-progress-sweep` element must keep its `1.2s`.

Record the output in the commit message. If `panelTransitionMs` is not `0.01ms`, the global override is not reaching the element — fix the selector in `globals.css`, do not add a per-component variant.

- [ ] **Step 3: Run the tests**

```bash
npm --prefix frontend run test -- Collapsible
```

Expected: PASS, 9 tests.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ui/Collapsible.test.tsx frontend/src/styles/globals.css
git commit -m "test(dx-05): cover reduced motion for the new disclosure

Mostly a verification row: the app-level override in globals.css predates
this work and already covers both prefers-reduced-motion and the in-app
html[data-reduce-motion='on'] switch, excluding spinners per DS §9.5.
Choosing a CSS animation for Collapsible in DX-01 is what puts it under
that umbrella — Framer's reducedMotion would not have stopped a height
animation.

Verified in the browser with the OS setting off and the app toggle on:
panel transition 0.01ms, progress sweep still 1.2s.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Performance baseline and density verification (DX-06, closes F-11)

**Files:**
- Modify: `frontend/vite.config.ts`, `frontend/package.json`
- Modify: `frontend/FRONTEND_CHECKLIST.md`

**Interfaces:**
- Consumes: the finished dashboard from Task 4.
- Produces: the recorded baseline every later tranche cites.

**Context an implementer needs.** `vite.config.ts` currently has no `manualChunks`, no visualizer and no budget — this is checklist row F-11, still 🔷. No row in F2 or F3 may claim a performance result unless this table exists first (§10.1 DX-06).

`rollup-plugin-visualizer` is a **devDependency** — the only dependency F1 adds, and not a runtime one, so it is not one of the §10.6 one-way doors.

**The density verification in Step 4 is the acceptance test for this whole tranche.** The baseline is 2.61 screens, measured on this branch before any of this work.

- [ ] **Step 1: Install the visualizer**

```bash
npm --prefix frontend install --save-dev rollup-plugin-visualizer
```

Confirm it landed in `devDependencies`, not `dependencies`:

```bash
node -e "const p=require('./frontend/package.json');console.log('dev:',!!p.devDependencies['rollup-plugin-visualizer'],'| runtime:',!!p.dependencies['rollup-plugin-visualizer'])"
```

Expected: `dev: true | runtime: false`.

- [ ] **Step 2: Configure chunking and analysis**

Replace `frontend/vite.config.ts` with:

```ts
import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig } from 'vite';

/**
 * Bundle analysis is opt-in via ANALYZE=1 so a normal build stays fast and
 * writes no stray artifacts:
 *   ANALYZE=1 npm run build   ->  dist/stats.html
 *
 * manualChunks exists so the DX-06 baseline can attribute weight rather than
 * report one opaque number, and so framer-motion's cost stays visible as
 * later tranches add motion (FRONTEND_CHECKLIST §10.1).
 */
export default defineConfig({
  plugins: [
    react(),
    ...(process.env['ANALYZE'] === '1'
      ? [visualizer({ filename: 'dist/stats.html', gzipSize: true, brotliSize: true })]
      : []),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    sourcemap: true,
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          motion: ['framer-motion'],
          query: ['@tanstack/react-query'],
        },
      },
    },
  },
});
```

All four package names were verified present in `dependencies` when this plan was written (`react`, `react-dom`, `react-router-dom`, `framer-motion`, `@tanstack/react-query`). If a later change removes one, drop that entry rather than inventing a replacement.

- [ ] **Step 3: Build and record the chunk numbers**

```bash
ANALYZE=1 npm --prefix frontend run build
```

Expected: build succeeds and prints a gzipped size per chunk. Record: entry chunk, the dashboard route chunk (the one naming `OverviewPage` / `dashboard`), the largest chunk overall, and the `motion` chunk.

- [ ] **Step 4: Measure density and runtime — the acceptance test**

```bash
npm --prefix frontend run dev
```

Sign in as `doctor@medora.health` / `Medora123!`, land on `/doctor/overview`, set the viewport to exactly 1280×720.

**Confirm focus containment here**, where the stylesheet actually applies (Task 5 covers only the class in jsdom): with Analytics closed, Tab from the Analytics trigger and verify focus skips every control inside the closed panel —

```js
document.querySelector('[data-collapsible-panel][data-state="closed"] a, [data-collapsible-panel][data-state="closed"] button')?.focus();
document.activeElement.tagName + ' / ' + document.activeElement.className
```

Expected: focus does **not** land inside the closed panel — `document.activeElement` stays `<body>` or the trigger.

Then run:

```js
const main = document.querySelector('main');
JSON.stringify({
  viewport: [innerWidth, innerHeight],
  scrollHeight: main.scrollHeight,
  clientHeight: main.clientHeight,
  screens: +(main.scrollHeight / main.clientHeight).toFixed(2),
  lcp: performance.getEntriesByType('largest-contentful-paint').at(-1)?.startTime ?? null,
  longestTask: Math.max(0, ...performance.getEntriesByType('longtask').map((t) => t.duration)),
}, null, 1)
```

**Pass condition: `screens` ≤ 1.5, with both sections closed (the default state).** Baseline was 2.61.

If it comes in above 1.5, do not shrink type to get there — DX-01 forbids it. Reduce the always-visible band count instead, and report the number honestly if it still misses.

Then confirm the collapsed sections behave, and record the results:
- Click "Analytics" → it expands; the page growing past 1.5 screens here is expected and correct.
- Reload → Analytics is still open (persistence).
- Collapse it, reload → closed.
- Resize to 375px → DOM order reads alerts → schedule → quick actions → KPIs → Analytics → Activity (DX-04).

- [ ] **Step 5: Record everything in the checklist**

In `frontend/FRONTEND_CHECKLIST.md` §10.1, set DX-01, DX-02, DX-04, DX-05, DX-06 to ✅ with a one-line note each, and replace the DX-03 row's status with:

```
| DX-03 | ~~KPI value transitions.~~ **➖ Superseded by DESIGN_SYSTEM.md §9.4**, which forbids animating changing data values by name ("a lab number must never 'count up' — misleading in clinical context"). `KpiWidget` already encodes the prohibition in its own doc comment, and with static `MOCK_KPIS` no value ever changes, so the code would be unreachable. Recorded in the F1 design spec rather than deferred — this is a row that should not be built. | P2 | ➖ |
```

Add the measurement table under §10.1:

```markdown
#### DX-06 baseline — recorded <DATE>

| Metric | Before | After |
| --- | --- | --- |
| Screens of scroll @1280×720 (default state) | 2.61 | <measured> |
| Entry chunk (gzip) | <measured> | <measured> |
| Dashboard route chunk (gzip) | <measured> | <measured> |
| `motion` chunk (gzip) | n/a — unsplit | <measured> |
| Largest chunk (gzip) | <measured> | <measured> |
| Dashboard LCP | <measured> | <measured> |
| Longest task | <measured> | <measured> |

Method: `ANALYZE=1 npm run build` for chunks; `main.scrollHeight / main.clientHeight`
at 1280×720 signed in as `doctor@medora.health` for density. "Before" chunk figures
come from a build of the commit preceding this tranche.
```

Also mark **F-11** ✅ in §1 (DX-06 closes it) and strike **D-03** in §3.1 as absorbed.

Replace every `<measured>` with a real number. A placeholder left in this table is a failed task.

- [ ] **Step 6: Full gate**

```bash
npm --prefix frontend run typecheck && npm --prefix frontend run lint && npm --prefix frontend run test && npm --prefix frontend run build
```

Expected: all four green.

- [ ] **Step 7: Commit**

```bash
git add frontend/vite.config.ts frontend/package.json frontend/package-lock.json frontend/FRONTEND_CHECKLIST.md
git commit -m "feat(dx-06): bundle baseline and density measurement, closes F-11

Adds opt-in bundle analysis (ANALYZE=1) and manualChunks so weight can be
attributed rather than reported as one opaque number, and records the
before/after table F2 and F3 are required to cite.

Density: 2.61 -> <measured> screens at 1280x720 in the default state.

DX-03 is marked superseded rather than deferred: DESIGN_SYSTEM §9.4
forbids animating changing data values by name.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage.** Spec §3 (IA) → Tasks 2, 3, 4. §4 (motion tokens) → Task 1. §5 (mobile order) → Task 4 Step 3 + Task 6 Step 4. §6 (reduced motion) → Task 5. §7 (baseline) → Task 6. §8 (testing) → tests in Tasks 1–5. §9 (files touched) → File Structure. §10 (definition of done) → Task 6 Steps 4–6. Spec §2.1 (DX-03 dropped) → Task 6 Step 5.

**Corrections carried.** Three deviations from the spec are stated up front with their evidence, so an implementer reading spec and plan side by side is not left guessing which wins.

**The user's five Analytics requirements.** (1) discoverable → `Collapsible`'s always-visible bordered header; (2) communicates content exists → `caption` + `summary` props, asserted in Task 2 Step 1 and Task 4 Step 1; (3) opening may exceed 1.5 screens → stated in Global Constraints and Task 6 Step 4; (4) never appears absent or broken → header renders identically open or closed, content stays mounted, Task 2's doc comment states the rule; (5) explicit 1280×720 verification → Task 6 Step 4, the tranche's acceptance test.

**Type consistency.** `StaggerItem` uses `key`/`className`/`content` in Tasks 1 and 4. `DashboardSections` uses `analytics`/`activity` in Tasks 3 and 4. `setSection(key, open)` matches between Task 3's hook and Task 4's call sites. `Collapsible`'s `open`/`onOpenChange` matches Task 2's definition and Task 4's usage. `staggerDelay`/`motionTokens`/`EASE_OUT` are defined in Task 1 Step 3 and used in Task 1 Steps 1 and 5.

**Known softness, flagged rather than hidden.** Task 5 Step 1's escaped Tailwind class selector may be brittle; the step names a `data-collapsible-panel` attribute as the preferred stabler alternative. Task 4 Step 1 assumes `AppProviders` is the provider barrel's export name and tells the implementer where to check.
