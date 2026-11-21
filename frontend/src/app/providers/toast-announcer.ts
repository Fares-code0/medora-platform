import type { ToastVariant } from '@/components/feedback/Toast';

/**
 * The toast announcer's rules (F-18), kept apart from `ToastProvider` so
 * they can be tested on their own and the provider module exports only
 * components and hooks.
 */

/** How long an announcement node stays before it is removed (silently). */
export const ANNOUNCEMENT_TTL_MS = 7_000;

/**
 * Marks the announcer regions. `src/test/setup.ts` excludes it from
 * Testing Library's text queries, because the announcer repeats every
 * toast's text by design and a `findByText` aimed at the visible toast
 * would otherwise find two. Its own tests query it by this attribute.
 */
export const ANNOUNCER_ATTRIBUTE = 'data-live-announcer';

export type Politeness = 'polite' | 'assertive';

/** Errors interrupt — what the old per-toast `role="alert"` meant. */
export function politenessOf(variant: ToastVariant): Politeness {
  return variant === 'error' ? 'assertive' : 'polite';
}

/** What is read out: the title and description, never the controls. */
export function announcementText(options: {
  readonly title: string;
  readonly description?: string | undefined;
}): string {
  const title = options.title.trim();
  const description = options.description?.trim() ?? '';
  if (description === '') return title;
  return /[.!?…:]$/.test(title) ? `${title} ${description}` : `${title}. ${description}`;
}
