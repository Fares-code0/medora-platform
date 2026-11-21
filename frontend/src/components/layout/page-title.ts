/**
 * The page title's typography — the one `h1` a screen is allowed (DS §3.4).
 *
 * ── Why this is a shared constant ────────────────────────────────────
 * Because four components render a page title and they had drifted to three
 * sizes. `ContentHeader` owns it for every ordinary page (16px/600), but the
 * three IDENTITY headers — a person's name standing in for the title, beside
 * their avatar — each wrote their own:
 *
 *   doctor patient record   text-h3 md:text-h2 font-bold   18px / 700
 *   admin doctor profile    text-h4 font-semibold          14px / 600
 *   admin patient account   text-h4 font-semibold          14px / 600
 *
 * Same job, same rank in the hierarchy, three answers — so the title changed
 * size as you moved between two records of the same product, and neither
 * admin one matched the pages either area's own list screens use.
 *
 * The identity headers keep their own LAYOUT (avatar, status badges, the
 * allergy strip); only the title's type is shared, which is the part that
 * had no reason to differ.
 *
 * The 16px step is deliberately off the `h4`/`h3` ladder — 14px is too quiet
 * for a page title and 16px (`h3`) carries the wrong line height here. It is
 * one of the declared exceptions in `scripts/check-retired-tokens.mjs`;
 * moving it here means there is now ONE exception rather than four sites that
 * would each have needed their own.
 */
export const PAGE_TITLE_CLASS =
  'text-h4 font-semibold tracking-tight text-text-primary md:text-[16px] md:leading-6';
