import { useT } from '@/i18n';

/**
 * Skip link — WCAG 2.1 §2.4.1 "Bypass Blocks".
 * Both shells render a long navigation region before the outlet, so a
 * keyboard user would otherwise tab through every nav item on every route
 * change. Rendered as the first focusable element in the shell; visually
 * hidden until focused, never removed from the accessibility tree.
 */

/** The id the skip link targets — the shell's `<main>` must carry it. */
export const MAIN_CONTENT_ID = 'main';

export function SkipToContent() {
  const t = useT();

  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-toast focus:rounded-surface focus:border focus:border-border focus:bg-surface focus:px-4 focus:py-2 focus:text-body-sm focus:font-medium focus:text-text-primary focus:shadow-popover"
    >
      {t('shell.skipToContent')}
    </a>
  );
}
