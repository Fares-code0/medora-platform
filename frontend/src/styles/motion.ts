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
    /*
     * The interaction scale: how long a surface takes to open or close,
     * by how far it travels. Not for hover or press feedback — that stays
     * on fast/base.
     */
    /** Small popovers, tooltips, the collapsed rail's flyout. */
    popover: 0.25,
    /** Dropdown, select and context menus; the navbar search panel. */
    menu: 0.35,
    /** Drawers, side panels and modals. */
    panel: 0.6,
    /** Sidebar groups and the floating dashboard customize panel. */
    expand: 0.7,
  },
  /** Per-item entrance delay, in seconds. */
  stagger: 0.05,
  /** Items past this index share the last delay. */
  staggerCap: 8,
} as const;

/** Default easing — entrances start fast and settle gently (DS §9.3). */
export const EASE_OUT: [number, number, number, number] = [0, 0, 0.2, 1];

/**
 * Emphasized easing for the interaction scale: leaves quickly and settles
 * over a long tail, so a 700ms panel still answers the click at once.
 * Mirrors `--ease-emphasized`.
 */
export const EASE_EMPHASIZED: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** Exit curve: accelerates away (DS §9.3 ease-in). */
export const EASE_IN: [number, number, number, number] = [0.4, 0, 1, 1];

/** Entrance delay for the item at `index`, capped per `motionTokens.staggerCap`. */
export function staggerDelay(index: number): number {
  return Math.min(Math.max(index, 0), motionTokens.staggerCap) * motionTokens.stagger;
}
