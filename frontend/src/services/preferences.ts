/**
 * Typed preferences service — FRONTEND_ARCHITECTURE.md §7 / §12.5.
 * The ONLY sanctioned localStorage access in the app. UI preferences only —
 * never PHI, tokens, or clinical drafts. Namespaced per user and cleared
 * on logout via `clearUserPreferences`.
 */

/**
 * Interface (appearance + accessibility) settings applied to the document
 * root. Global like `theme` because the no-flash boot script must apply
 * them before React mounts. UI-only — never PHI.
 */
export interface InterfaceSettings {
  density: 'comfortable' | 'compact';
  /** Root font-size percentage, 90–130. */
  textScale: number;
  reduceMotion: boolean;
  highContrast: boolean;
  focusRings: 'default' | 'high';
  /** Show focus outlines for pointer users too, not only keyboard nav. */
  keyboardNav: boolean;
}

export const DEFAULT_INTERFACE_SETTINGS: InterfaceSettings = {
  density: 'comfortable',
  textScale: 100,
  reduceMotion: false,
  highContrast: false,
  focusRings: 'default',
  keyboardNav: false,
};

/**
 * A customizable Overview's widget selection: the ids of the widgets the user
 * chose, in the order they chose them. Empty by default — the Overview is a
 * dashboard the user composes, not a fixed set of cards — so a missing value
 * and an empty one mean the same thing. The Doctor and Admin Overviews keep
 * theirs under separate keys, since their catalogues share no widget.
 *
 * Plain strings rather than the dashboard's widget-id union: this service may
 * not import a feature (FRONTEND_ARCHITECTURE §3.4), so the dashboard narrows
 * on read and drops any id it no longer ships. Per-user, like
 * `sidebarCollapsed` — but, unlike it, KEPT on logout (`KEPT_ON_LOGOUT`): a
 * dashboard the user composed is theirs, and signing out and back in must
 * not hand them an empty one. It is a list of widget ids, never PHI.
 *
 * It replaced `dashboardSections`, the open/closed state of the fixed
 * Overview's two collapsible bands. Those bands no longer exist; a value a
 * browser still holds under that key is never read, and goes with the rest of
 * the user's namespace at the next logout.
 */
export type DashboardWidgetSelection = readonly string[];

interface PreferenceSchema {
  theme: 'light' | 'dark' | 'system';
  /** UI language — global so the auth surface can localize before sign-in. */
  locale: string;
  sidebarCollapsed: boolean;
  /** Appearance + accessibility, applied to <html> before first paint. */
  interface: InterfaceSettings;
  /** The widgets the doctor placed on their Overview, in order. */
  dashboardWidgets: DashboardWidgetSelection;
  /** The widgets the administrator placed on their Overview, in order. */
  adminDashboardWidgets: DashboardWidgetSelection;
}

/** The preference keys that hold a dashboard's widget selection. */
export type DashboardSelectionKey = 'dashboardWidgets' | 'adminDashboardWidgets';

const GLOBAL_KEYS: readonly (keyof PreferenceSchema)[] = ['theme', 'locale', 'interface'];
const PREFIX = 'medora';

function storageKey(key: keyof PreferenceSchema, userId?: string): string {
  // Theme is global (needed before auth for the no-flash boot script);
  // everything else is namespaced per user.
  if (GLOBAL_KEYS.includes(key)) return `${PREFIX}.${key}`;
  return userId ? `${PREFIX}.${userId}.${key}` : `${PREFIX}.anonymous.${key}`;
}

export function getPreference<K extends keyof PreferenceSchema>(
  key: K,
  userId?: string,
): PreferenceSchema[K] | null {
  try {
    const raw = localStorage.getItem(storageKey(key, userId));
    return raw === null ? null : (JSON.parse(raw) as PreferenceSchema[K]);
  } catch {
    return null;
  }
}

export function setPreference<K extends keyof PreferenceSchema>(
  key: K,
  value: PreferenceSchema[K],
  userId?: string,
): boolean {
  try {
    localStorage.setItem(storageKey(key, userId), JSON.stringify(value));
    return true;
  } catch {
    // Storage unavailable (private mode / quota) — preferences degrade
    // silently. The `false` lets a caller that promised the user a save
    // (the dashboard's Done) say it did not happen; others may ignore it.
    return false;
  }
}

/**
 * Per-user preferences that outlive a logout. A dashboard's widget selection
 * is the user's own composition: wiping it on sign-out sent every returning
 * user back to an empty Overview. It stays in the user's namespace, so it is
 * only ever read for the same user id — another account signing in on this
 * browser reads its own key and never this one.
 */
const KEPT_ON_LOGOUT: readonly DashboardSelectionKey[] = [
  'dashboardWidgets',
  'adminDashboardWidgets',
];

/**
 * Wipes a user's namespaced preferences on logout (§6.4). Theme survives,
 * and so do the keys in `KEPT_ON_LOGOUT`.
 */
export function clearUserPreferences(userId: string): void {
  try {
    const prefix = `${PREFIX}.${userId}.`;
    const kept = new Set(KEPT_ON_LOGOUT.map((key) => storageKey(key, userId)));
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix) && !kept.has(key)) doomed.push(key);
    }
    doomed.forEach((key) => localStorage.removeItem(key));
  } catch {
    // Storage unavailable — nothing to clear.
  }
}
