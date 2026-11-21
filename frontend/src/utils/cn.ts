import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Merge Tailwind class lists with conflict resolution.
 *
 * ── Why this is configured rather than `twMerge` bare ────────────────
 * `text-*` is two Tailwind utilities wearing one prefix: a font size
 * (`text-body-sm`) and a text colour (`text-text-inverse`). tailwind-merge
 * tells them apart by matching the value against Tailwind's *stock* type
 * scale — `xs`, `sm`, `base`, `lg`… — and this project replaced that scale
 * wholesale with named DS steps (DESIGN_SYSTEM.md §3.2). So it recognised
 * neither `text-body-sm` nor `text-text-inverse` as a size, filed BOTH as
 * colours, decided they conflicted, and kept only the last one written.
 *
 * That silently deleted a class in every `cn()` call that carried both, in
 * whichever direction the caller happened to order them:
 *
 *   'bg-primary text-text-inverse … text-body-sm'  → lost the COLOUR
 *   'text-h5 font-semibold text-text-primary'      → lost the SIZE
 *
 * Which is to say every Button in the app rendered with an inherited text
 * colour instead of its variant's — the primary button measured 1.96:1 in
 * dark mode — and headings built through `cn` fell back to the body size.
 * Nothing reported it: the class list is well-formed, it is just short one
 * entry, and both halves of the pair are real DS tokens.
 *
 * Naming the type scale here is what separates the two groups again.
 * Colours need no list: anything under `text-` that is not one of these is
 * a colour, which is exactly the default behaviour.
 *
 * Keep in step with `tailwind.config.ts`'s `fontSize` — a step added there
 * and not here starts silently deleting colours again. `cn.test.ts` asserts
 * the two agree.
 */
const FONT_SIZES = [
  'display',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'body',
  'body-sm',
  'caption',
  'metric',
  'micro',
] as const;

const twMerge = extendTailwindMerge({
  override: {
    classGroups: {
      'font-size': [{ text: [...FONT_SIZES] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Exported for the drift check in `cn.test.ts`; not part of the public API. */
export const DS_FONT_SIZES: readonly string[] = FONT_SIZES;
