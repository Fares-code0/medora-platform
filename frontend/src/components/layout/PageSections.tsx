import { Stack, type StackGap, type StackProps } from './Stack';

/**
 * PageSections — the vertical rhythm between a page's top-level sections.
 *
 * The counterpart to `PageContainer`, which owns the page's outer edges: this
 * owns the space *between* the bands inside it. Together they are the whole of
 * a page's spacing, and neither is a decision an individual page should make.
 *
 * ── Why this exists ─────────────────────────────────────────────────
 * It was a decision every page made, and they disagreed four ways: `gap-8`
 * (32px) on the list pages, `gap-6` (24px) on the detail pages, `gap-5` (20px)
 * across the whole admin area, `gap-4` (16px) on the Doctor Overview. Twenty
 * pages, four rhythms, no rule — so moving between two screens of the same
 * product changed how far apart its sections sat, and the admin area was on a
 * step no doctor page used.
 *
 * ── Why 16px ────────────────────────────────────────────────────────
 * It is the Doctor Overview's, which is the only one of the four that was ever
 * measured against anything: the density target of <=1.5 screens at 1280x720
 * (FRONTEND_CHECKLIST §10.1, DX-01). The other three were picked per page. It is also
 * the step the grids *inside* a band already use, so a page now has one
 * spacing value rather than an outer rhythm and an inner one that disagree.
 *
 * A page that genuinely needs its own may still pass `gap` — but it is now a
 * visible exception with a reviewer attached, rather than the default nobody
 * chose.
 */
export interface PageSectionsProps extends Omit<StackProps, 'direction'> {
  /** Override the page rhythm. Needs a reason; see the note above. */
  gap?: StackGap;
}

export function PageSections({ gap = 4, ...rest }: PageSectionsProps) {
  return <Stack gap={gap} {...rest} />;
}
