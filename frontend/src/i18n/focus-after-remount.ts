/**
 * Focus across a language change (DEC-009).
 *
 * Changing the language remounts the routed tree (`LocaleRemount`), which
 * would drop keyboard focus to <body> just after the reader chose an option
 * in the language picker. The picker asks for its focus back here; the
 * remount honours it once the new tree is in the DOM.
 */

let pending = false;

/** The picker calls this as it changes the language. */
export function requestSwitcherFocus(): void {
  pending = true;
}

/** Returns whether a request was pending, and clears it. */
export function takeSwitcherFocusRequest(): boolean {
  const was = pending;
  pending = false;
  return was;
}

/** Marks the element the restored focus lands in. */
export const LOCALE_SWITCHER_ATTRIBUTE = 'data-locale-switcher';
