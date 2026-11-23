import Feather from '@expo/vector-icons/Feather';
import { I18nManager } from 'react-native';

import { decorative } from '@/accessibility/a11y';
import { useTheme } from '@/theme';
import type { ColorToken } from '@/theme/tokens';

/**
 * The icon vocabulary.
 *
 * A closed map rather than an open `name: string`, for two reasons. It
 * keeps the set small enough to stay coherent — the web app uses
 * lucide-react and Feather is its closest available sibling, so the two
 * clients read as one product — and it makes an icon that carries meaning
 * impossible to add without naming that meaning here.
 *
 * Icons are `decorative` by default: colour and shape are never the only
 * carrier of information (WCAG 1.4.1), so every icon in this app sits
 * beside a text label that says the same thing. An icon that is genuinely
 * alone must be passed `label`.
 */
const GLYPHS = {
  home: 'home',
  calendar: 'calendar',
  clock: 'clock',
  search: 'search',
  user: 'user',
  users: 'users',
  message: 'message-circle',
  bell: 'bell',
  heart: 'heart',
  activity: 'activity',
  fileText: 'file-text',
  folder: 'folder',
  pill: 'thermometer',
  lab: 'droplet',
  phone: 'phone',
  phoneCall: 'phone-call',
  mapPin: 'map-pin',
  alert: 'alert-triangle',
  alertCircle: 'alert-circle',
  info: 'info',
  check: 'check',
  checkCircle: 'check-circle',
  x: 'x',
  chevronRight: 'chevron-right',
  chevronLeft: 'chevron-left',
  chevronDown: 'chevron-down',
  plus: 'plus',
  refresh: 'refresh-cw',
  settings: 'settings',
  lock: 'lock',
  logOut: 'log-out',
  shield: 'shield',
  eye: 'eye',
  eyeOff: 'eye-off',
  wifiOff: 'wifi-off',
  inbox: 'inbox',
  edit: 'edit-2',
  moon: 'moon',
  sun: 'sun',
  smartphone: 'smartphone',
  globe: 'globe',
  briefcase: 'briefcase',
  star: 'star',
  download: 'download',
  send: 'send',
  paperclip: 'paperclip',
  helpCircle: 'help-circle',
  // The assistant surfaces (Phase K/L). `cpu` rather than a sparkle or a
  // wand: the one thing a patient must never be in doubt about on those
  // screens is that they are talking to a machine, and the iconography
  // is the first thing that says so.
  cpu: 'cpu',
  camera: 'camera',
  image: 'image',
  trash: 'trash-2',
  list: 'list',
} as const;

/**
 * Icons that mean a *direction of travel* rather than a side of the
 * screen — checklist S-08.
 *
 * A disclosure chevron points the way the reader moves forward, so in a
 * right-to-left layout it points **left**. Writing `chevronRight` into a
 * screen hard-codes an assumption about the reading direction, and a
 * screen full of them is the "mirrored-icon error" S-08 names. `forward`
 * and `back` say the meaning instead, and this resolves it.
 *
 * ── Why `I18nManager.isRTL` and not `useIsRtl()` ─────────────────────
 *
 * They disagree in exactly one window and the disagreement matters. A
 * patient who picks Arabic has chosen an RTL *language*, but React
 * Native cannot re-lay-out the native view hierarchy until the app
 * restarts — `LocaleProvider` documents this, and `restartRequired` is
 * how the switcher explains it. Until that restart the screen is still
 * laid out left-to-right.
 *
 * A chevron must agree with the **layout**, not with the chosen
 * language: pointing it left on a left-to-right screen would produce the
 * exact defect this row is about, in the name of fixing it. `isRTL` is
 * what the native layer is actually doing, so that is what this reads.
 *
 * It also means `Icon` needs no locale context, which keeps a platform
 * component free of a provider that `components.test.tsx` does not mount.
 */
const DIRECTIONAL = {
  forward: { ltr: 'chevronRight', rtl: 'chevronLeft' },
  back: { ltr: 'chevronLeft', rtl: 'chevronRight' },
} as const;

export type IconName = keyof typeof GLYPHS | keyof typeof DIRECTIONAL;

/**
 * Glyphs that keep their name but are drawn MIRRORED in a right-to-left
 * layout — S-08.
 *
 * Feather's `send` is a paper plane flying up and to the right: "away
 * from me, in the reading direction". In Arabic the reading direction is
 * leftward, so the plane flies the wrong way unless it is flipped. There
 * is no left-pointing twin to swap to, as there is for a chevron, so the
 * glyph is mirrored with a horizontal flip instead. Same `I18nManager`
 * rule as `DIRECTIONAL`: it follows the layout, not the chosen language.
 */
const MIRRORED_IN_RTL: ReadonlySet<IconName> = new Set<IconName>(['send']);

/** Exported for `rtl.test.tsx`. */
export function mirrorsInRtl(name: IconName, isRtl: boolean): boolean {
  return isRtl && MIRRORED_IN_RTL.has(name);
}

const MIRROR_STYLE = { transform: [{ scaleX: -1 }] } as const;

/** Exported for `rtl.test.tsx`, which asserts both directions. */
export function resolveGlyph(name: IconName, isRtl: boolean): string {
  if (name in DIRECTIONAL) {
    const pair = DIRECTIONAL[name as keyof typeof DIRECTIONAL];
    return GLYPHS[isRtl ? pair.rtl : pair.ltr];
  }
  return GLYPHS[name as keyof typeof GLYPHS];
}

export interface IconProps {
  readonly name: IconName;
  readonly size?: number;
  readonly color?: ColorToken;
  /** Supply only when the icon is the sole carrier of its meaning. */
  readonly label?: string;
}

export function Icon({ name, size = 20, color = 'textSecondary', label }: IconProps) {
  const theme = useTheme();
  return (
    <Feather
      name={resolveGlyph(name, I18nManager.isRTL) as keyof typeof Feather.glyphMap}
      size={size}
      color={theme.colors[color]}
      {...(mirrorsInRtl(name, I18nManager.isRTL) ? { style: MIRROR_STYLE } : {})}
      {...(label === undefined
        ? decorative
        : { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: label })}
    />
  );
}
