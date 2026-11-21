/**
 * Medora entrance — session state and timing.
 *
 * Split out of `MedoraIntro.tsx` deliberately: a module that exports both a
 * component and a plain function breaks Fast Refresh's module boundary
 * (`react-refresh/only-export-components`), and editing the overlay is exactly
 * when you want HMR to work.
 */

/**
 * Mirrors the timeline in MedoraIntro.css. `reveal` is the moment the overlay
 * starts fading — the app underneath is already painted at full opacity, so
 * nothing fades in (DEC-012); `total` is when the overlay is gone and can be
 * unmounted. Change `--mi-exit-delay` or
 * `--mi-exit-dur` there and these two have to move with them — it is the one
 * place JS has to agree with the stylesheet.
 *
 * `full` was 1420/1720: the lockup finished assembling and left immediately,
 * which read as a flash rather than an entrance. It now holds a second longer,
 * which is also the window the mark's loop runs in (it settles at 2620ms, as
 * the overlay starts to fade). The reduced timeline is unchanged — there is
 * nothing to perceive there, so a longer hold would only be a longer wait.
 */
export const MEDORA_INTRO_TIMING = {
  full: { reveal: 2620, total: 2920 },
  reduced: { reveal: 520, total: 760 },
} as const;

/**
 * Per-tab, not per-user, so it is `sessionStorage` rather than the preferences
 * service (§12.5): "has this tab already seen the entrance" must not outlive
 * the tab, must not be namespaced per user (it plays before sign-in), and must
 * not survive a sign-out that clears preferences.
 */
const SESSION_KEY = 'medora.intro-played';

/**
 * True the first time a browsing session loads the app. Use it to seed state
 * so a route change, a refresh, or a Vite HMR update never replays the intro.
 */
export function shouldPlayMedoraIntro(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(SESSION_KEY) === null;
  } catch {
    return true; // storage blocked — playing once is the safer failure.
  }
}

export function markMedoraIntroPlayed(): void {
  try {
    window.sessionStorage.setItem(SESSION_KEY, '1');
  } catch {
    /* storage blocked — nothing to remember. */
  }
}

/**
 * Both reduced-motion signals the app honours: the OS preference, and the
 * in-app Accessibility toggle that the boot script writes onto `<html>`.
 * MedoraIntro.css keys its shortened timeline off the same two.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  if (document.documentElement.dataset.reduceMotion === 'on') return true;
  if (!window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
