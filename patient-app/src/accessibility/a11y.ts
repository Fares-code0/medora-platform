import {
  AccessibilityInfo,
  Platform,
  type AccessibilityProps,
  type HostInstance,
} from 'react-native';

/**
 * Accessibility helpers.
 *
 * Accessibility is not a cleanup pass here (§24 of the brief). It is
 * built into the primitives: `Button`, `ListItem`, `Chip` and the
 * feedback components all take their props through the builders below, so
 * a control cannot be added without a label and a role — the omission
 * that produces "button, button, button" under VoiceOver.
 */

/**
 * The props every pressable needs. `accessibilityLabel` is required by
 * the signature, which is the whole point: the type system asks the
 * question a review would have to remember to ask.
 */
export function pressableA11y(options: {
  label: string;
  hint?: string;
  disabled?: boolean;
  busy?: boolean;
  selected?: boolean;
  role?: 'button' | 'link' | 'tab' | 'checkbox' | 'radio' | 'switch';
}): AccessibilityProps {
  return {
    accessible: true,
    accessibilityRole: options.role ?? 'button',
    accessibilityLabel: options.label,
    ...(options.hint === undefined ? {} : { accessibilityHint: options.hint }),
    accessibilityState: {
      disabled: options.disabled ?? false,
      busy: options.busy ?? false,
      ...(options.selected === undefined ? {} : { selected: options.selected }),
    },
  };
}

/** A heading, so a screen reader's rotor can jump between sections. */
export function headingA11y(label: string): AccessibilityProps {
  return {
    accessible: true,
    accessibilityRole: 'header',
    accessibilityLabel: label,
  };
}

/**
 * Decorative content, hidden from assistive technology.
 *
 * Use it only for something that carries no information a sighted user
 * gets — a divider, an icon whose meaning is already in the adjacent
 * label. An icon that is the ONLY carrier of meaning is never decorative.
 */
export const decorative: AccessibilityProps = {
  accessible: false,
  importantForAccessibility: 'no-hide-descendants',
  accessibilityElementsHidden: true,
};

/**
 * Announces an outcome that has no visual focus change — a booking
 * confirmed, a retry failed, an AI red-flag routing (checklist S-07).
 * Without this a screen-reader user gets silence where a sighted user
 * gets a toast.
 */
export function announce(message: string): void {
  AccessibilityInfo.announceForAccessibility(message);
}

/**
 * Moves screen-reader focus, e.g. onto an error summary after a failed submit.
 *
 * Takes the host ref itself. `findNodeHandle` + `setAccessibilityFocus(tag)`
 * is the pre-Fabric path, deprecated in React Native 0.86 in favour of this
 * call, which the renderer routes for a Fabric or a legacy handle alike.
 */
export function focusOn(ref: HostInstance | null): void {
  if (ref !== null) {
    AccessibilityInfo.sendAccessibilityEvent(ref, 'focus');
  }
}

/**
 * Android's TalkBack reads `accessibilityLabel` and ignores
 * `accessibilityHint` on some element types; iOS reads both. Joining them
 * for Android is the pragmatic fix and is what this returns.
 */
export function labelWithHint(label: string, hint: string): string {
  return Platform.OS === 'android' ? `${label}. ${hint}` : label;
}
