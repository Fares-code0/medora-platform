/**
 * The colour-token catalogue the Theme Playground edits.
 *
 * Every entry is a real `--color-*` variable declared in
 * `src/styles/tokens.css` — `presets.test.ts` fails if this list plus
 * `COPIED_TOKENS` and the stylesheet ever disagree, in either direction.
 * `patient` is the matching key of `ColorPalette` in
 * `patient-app/src/theme/tokens.ts`; `null` marks the web-only roles the
 * patient app does not have (the sidebar, fill and component roles of
 * ADR-0005 among them).
 *
 * Only INDEPENDENT roles are editor rows. A token that tokens.css declares
 * as a plain reference to another (`--color-secondary: var(--color-primary)`)
 * is a copy: it is listed in `COPIED_TOKENS`, follows its source in the
 * preview and the exports, and has no value of its own to edit.
 *
 * Naming differs only by convention: kebab-case CSS variables here
 * (`--color-text-primary`), camelCase object keys there (`textPrimary`).
 *
 * Keys are the FULL variable name, exactly as tokens.css spells it, so a
 * search for `--color-primary` finds it in a preset as well as in the
 * stylesheet. (It also keeps `styles/theme-utilities.test.ts` from reading
 * a bare `'text-primary'` string as a misspelt Tailwind class.)
 */

export type TokenGroup = 'brand' | 'neutral' | 'sidebar' | 'components' | 'ai' | 'status' | 'chart';

export const WEB_TOKENS = [
  '--color-primary',
  '--color-primary-hover',
  '--color-primary-subtle',
  '--color-background',
  '--color-surface',
  '--color-surface-sunken',
  '--color-surface-overlay',
  '--color-text-primary',
  '--color-text-secondary',
  '--color-text-tertiary',
  '--color-text-placeholder',
  '--color-text-disabled',
  '--color-text-inverse',
  '--color-border',
  '--color-border-strong',
  '--color-focus-ring',
  '--color-scrim',
  '--color-control-knob',
  '--color-scrollbar-track',
  '--color-sidebar',
  '--color-sidebar-raised',
  '--color-sidebar-hover',
  '--color-sidebar-border',
  '--color-sidebar-text',
  '--color-sidebar-text-muted',
  '--color-sidebar-active',
  '--color-sidebar-active-text',
  '--color-primary-fill',
  '--color-primary-fill-hover',
  '--color-primary-pressed',
  '--color-primary-fill-text',
  '--color-tab-active-text',
  '--color-tab-indicator',
  '--color-accent',
  '--color-accent-subtle',
  '--color-ai-badge',
  '--color-ai-badge-text',
  '--color-ai-launcher',
  '--color-ai-launcher-border',
  '--color-ai-launcher-icon',
  '--color-success',
  '--color-success-subtle',
  '--color-warning',
  '--color-warning-subtle',
  '--color-error',
  '--color-error-hover',
  '--color-error-subtle',
  '--color-info',
  '--color-info-subtle',
  '--color-chart-1',
  '--color-chart-1-edge',
  '--color-chart-2',
  '--color-chart-2-edge',
  '--color-chart-3',
  '--color-chart-3-edge',
  '--color-chart-4',
  '--color-chart-4-edge',
  '--color-chart-5',
  '--color-chart-5-edge',
] as const;

export type WebToken = (typeof WEB_TOKENS)[number];

/** One full mode of the theme — every editable token, as a colour string. */
export type Palette = Readonly<Record<WebToken, string>>;

export interface TokenMeta {
  readonly name: WebToken;
  readonly group: TokenGroup;
  readonly label: string;
  /** What it paints — so an edit can be aimed without reading the source. */
  readonly usage: string;
  /** The `ColorPalette` key in the patient app, or `null` if web-only. */
  readonly patient: string | null;
}

export const GROUPS: readonly { readonly id: TokenGroup; readonly label: string }[] = [
  { id: 'brand', label: 'Brand & Primary' },
  { id: 'neutral', label: 'Neutral Colors' },
  { id: 'sidebar', label: 'Sidebar' },
  { id: 'components', label: 'Components' },
  { id: 'ai', label: 'AI Components' },
  { id: 'status', label: 'Status Colors' },
  { id: 'chart', label: 'Charts' },
];

/** `--color-text-primary` → `textPrimary`, the patient app's key for the same role. */
const camel = (name: string) =>
  name.slice('--color-'.length).replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());

function meta(
  name: WebToken,
  group: TokenGroup,
  label: string,
  usage: string,
  patient: string | null = camel(name),
): TokenMeta {
  return { name, group, label, usage, patient };
}

export const TOKEN_META: readonly TokenMeta[] = [
  meta('--color-primary', 'brand', 'Primary', 'The interactive blue as TEXT: links, secondary/ghost button labels, active nav label, selected-row text'),
  meta('--color-primary-hover', 'brand', 'Primary Hover', 'Link hover'),
  meta('--color-primary-subtle', 'brand', 'Primary Subtle', 'Selected/active backgrounds: nav item, table row, select and menu option'),
  meta('--color-background', 'neutral', 'Background', 'The page; zebra rows; read-only fields; patient nav headers'),
  meta('--color-surface', 'neutral', 'Surface', 'Cards, navbar, inputs, table body; patient tab bar'),
  meta('--color-surface-sunken', 'neutral', 'Surface Sunken', 'Hover backgrounds, table header, disabled controls, skeletons'),
  meta('--color-surface-overlay', 'neutral', 'Surface Overlay (Elevated)', 'Modals, drawers, dropdowns, select lists, toasts, bottom sheets'),
  meta('--color-text-primary', 'neutral', 'Text Primary', 'Headings and body copy; tooltip background (inverted)'),
  meta('--color-text-secondary', 'neutral', 'Text Secondary', 'Secondary copy, inactive nav items and tabs'),
  meta('--color-text-tertiary', 'neutral', 'Text Tertiary', 'Metadata — the most-used text colour'),
  meta('--color-text-placeholder', 'neutral', 'Text Placeholder', 'Placeholder text in inputs and selects (web only)', null),
  meta('--color-text-disabled', 'neutral', 'Text Disabled', 'Disabled text; web input hover border; patient placeholders'),
  meta('--color-text-inverse', 'neutral', 'Text Inverse', 'Text on destructive, AI and status fills and count badges — dark in dark mode'),
  meta('--color-border', 'neutral', 'Border', 'Edge of every card, panel and divider'),
  meta('--color-border-strong', 'neutral', 'Border Strong', 'Boundary of inputs, checkboxes, secondary buttons; the scrollbar thumb copies it'),
  meta('--color-focus-ring', 'neutral', 'Focus Ring', 'Keyboard focus indicator'),
  meta('--color-scrim', 'neutral', 'Scrim', 'Backdrop behind modals, drawers and sheets'),
  meta('--color-control-knob', 'neutral', 'Control Knob', 'Switch knob when off or disabled — light in both modes'),
  meta('--color-scrollbar-track', 'neutral', 'Scrollbar Track', 'Scrollbar gutter (web only)', null),
  meta('--color-sidebar', 'sidebar', 'Sidebar', 'The application sidebar — dark in both modes (web only)', null),
  meta('--color-sidebar-raised', 'sidebar', 'Sidebar Raised', 'Sidebar brand header and user footer band (web only)', null),
  meta('--color-sidebar-hover', 'sidebar', 'Sidebar Hover', 'Hovered sidebar item (web only)', null),
  meta('--color-sidebar-border', 'sidebar', 'Sidebar Border', 'Dividers inside the sidebar (web only)', null),
  meta('--color-sidebar-text', 'sidebar', 'Sidebar Text', 'Sidebar item labels and the user name (web only)', null),
  meta('--color-sidebar-text-muted', 'sidebar', 'Sidebar Text Muted', 'Sidebar section headings, icons, captions (web only)', null),
  meta('--color-sidebar-active', 'sidebar', 'Sidebar Active', 'The current sidebar item (web only)', null),
  meta('--color-sidebar-active-text', 'sidebar', 'Sidebar Active Text', 'Label on the current sidebar item (web only)', null),
  meta('--color-primary-fill', 'components', 'Primary Button Fill', 'Primary button; checked checkbox, radio and switch (web only)', null),
  meta('--color-primary-fill-hover', 'components', 'Primary Button Hover', 'Primary button on hover (web only)', null),
  meta('--color-primary-pressed', 'components', 'Primary Button Pressed', 'Primary button while pressed'),
  meta('--color-primary-fill-text', 'components', 'Primary Button Label', 'Label on the primary button, checkbox tick, checked switch knob (web only)', null),
  meta('--color-tab-active-text', 'components', 'Tab Active Label', 'Label of the selected tab (web only)', null),
  meta('--color-tab-indicator', 'components', 'Tab Indicator', 'Underline of the selected tab (web only)', null),
  meta('--color-accent', 'ai', 'AI Accent', 'AI provenance: the filled AI buttons, AI rules and labels, AI badge outline'),
  meta('--color-accent-subtle', 'ai', 'AI Accent Subtle', 'AI panel and chat tint'),
  meta('--color-ai-badge', 'ai', 'AI Badge', 'Fill of the AI badge (web only)', null),
  meta('--color-ai-badge-text', 'ai', 'AI Badge Text', 'Label of the AI badge (web only)', null),
  meta('--color-ai-launcher', 'ai', 'AI Launcher', 'Fill of the Medora AI button in the navbar — fixed in both modes (web only)', null),
  meta('--color-ai-launcher-border', 'ai', 'AI Launcher Border', 'Edge of the Medora AI button in the navbar (web only)', null),
  meta('--color-ai-launcher-icon', 'ai', 'AI Launcher Icon', 'Icon of the Medora AI button, on its white fill — fixed in both modes (web only)', null),
  meta('--color-success', 'status', 'Success', 'Success alerts, badges, toasts'),
  meta('--color-success-subtle', 'status', 'Success Subtle', 'Success alert/badge background'),
  meta('--color-warning', 'status', 'Warning', 'Warning alerts, badges, toasts'),
  meta('--color-warning-subtle', 'status', 'Warning Subtle', 'Warning alert/badge background'),
  meta('--color-error', 'status', 'Error', 'Destructive buttons, invalid fields, error alerts, unread dots'),
  meta('--color-error-hover', 'status', 'Error Hover', 'Destructive button hover'),
  meta('--color-error-subtle', 'status', 'Error Subtle', 'Error alert/badge background'),
  meta('--color-info', 'status', 'Info', 'Info alerts, badges, toasts'),
  meta('--color-info-subtle', 'status', 'Info Subtle', 'Info alert/badge background'),
  meta('--color-chart-1', 'chart', 'Chart 1', 'First categorical series'),
  meta('--color-chart-1-edge', 'chart', 'Chart 1 Edge', 'Outline/line of series 1'),
  meta('--color-chart-2', 'chart', 'Chart 2', 'Second categorical series'),
  meta('--color-chart-2-edge', 'chart', 'Chart 2 Edge', 'Outline/line of series 2'),
  meta('--color-chart-3', 'chart', 'Chart 3', 'Third categorical series'),
  meta('--color-chart-3-edge', 'chart', 'Chart 3 Edge', 'Outline/line of series 3'),
  meta('--color-chart-4', 'chart', 'Chart 4', 'Fourth categorical series (pale — relies on its edge)'),
  meta('--color-chart-4-edge', 'chart', 'Chart 4 Edge', 'Outline/line of series 4'),
  meta('--color-chart-5', 'chart', 'Chart 5', 'Fifth categorical series (pale — relies on its edge)'),
  meta('--color-chart-5-edge', 'chart', 'Chart 5 Edge', 'Outline/line of series 5'),
];

export const META_BY_TOKEN: Readonly<Record<WebToken, TokenMeta>> = Object.fromEntries(
  TOKEN_META.map((entry) => [entry.name, entry]),
) as Record<WebToken, TokenMeta>;

/** Tokens are keyed by their full CSS variable name, so this is the identity — kept for readability. */
export const cssVar = (token: WebToken): string => token;

/**
 * Copies: tokens.css declares each, once in `:root`, as `var(<source>)`, so it
 * always equals its source in both themes. They are not editor rows. The
 * preview re-declares the same reference on its scope (a reference declared
 * on `:root` is resolved there, with the APP's colours, and would ignore the
 * playground's); the CSS export writes the reference; the patient export
 * writes the source's value under the copy's `ColorPalette` key.
 * `presets.test.ts` asserts each relationship against tokens.css itself.
 */
export interface CopiedToken {
  readonly source: WebToken;
  readonly label: string;
  readonly patient: string | null;
}

export const COPIED_TOKENS = {
  '--color-secondary': { source: '--color-primary', label: 'Secondary', patient: 'secondary' },
  '--color-secondary-hover': { source: '--color-primary-hover', label: 'Secondary Hover', patient: 'secondaryHover' },
  '--color-secondary-subtle': { source: '--color-primary-subtle', label: 'Secondary Subtle', patient: 'secondarySubtle' },
  '--color-scrollbar-thumb': { source: '--color-border-strong', label: 'Scrollbar Thumb', patient: null },
} as const satisfies Readonly<Record<string, CopiedToken>>;

export type CopiedTokenName = keyof typeof COPIED_TOKENS;

export const COPIED_TOKEN_NAMES = Object.keys(COPIED_TOKENS) as CopiedTokenName[];

/**
 * Tokens a `medora-theme@1` document saved by an EARLIER catalogue may lack,
 * and how each is filled — deterministically, never by guessing:
 *
 * - `from`: the token it was split out of. The saved theme painted this role
 *   with that token's value, so taking it keeps the experiment looking the
 *   way it did when it was saved.
 * - `original`: a role that did not exist before (the charcoal sidebar). It
 *   takes the shipped tokens.css value for that mode.
 *
 * Anything missing that is NOT listed here is still a hard error: a palette
 * missing `--color-chart-4-edge` was never valid, and filling it would hide
 * a damaged file.
 */
export type LegacyFill = { readonly from: WebToken } | { readonly original: true };

export const LEGACY_FILLS: Readonly<Partial<Record<WebToken, LegacyFill>>> = {
  // ADR-0005, PR 1 — the fill split out of primary.
  '--color-primary-fill': { from: '--color-primary' },
  '--color-primary-fill-hover': { from: '--color-primary-hover' },
  '--color-primary-fill-text': { from: '--color-text-inverse' },
  // Component roles split out of the shared roles they painted with.
  '--color-tab-active-text': { from: '--color-text-primary' },
  '--color-tab-indicator': { from: '--color-primary' },
  '--color-ai-badge': { from: '--color-accent-subtle' },
  '--color-ai-badge-text': { from: '--color-accent' },
  // The sidebar had no roles before ADR-0005.
  '--color-sidebar': { original: true },
  '--color-sidebar-raised': { original: true },
  '--color-sidebar-hover': { original: true },
  '--color-sidebar-border': { original: true },
  '--color-sidebar-text': { original: true },
  '--color-sidebar-text-muted': { original: true },
  '--color-sidebar-active': { original: true },
  '--color-sidebar-active-text': { original: true },
  // The navbar AI button had no roles of its own before ADR-0005 §11.
  '--color-ai-launcher': { original: true },
  '--color-ai-launcher-border': { original: true },
  '--color-ai-launcher-icon': { original: true },
};
