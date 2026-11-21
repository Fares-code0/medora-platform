/**
 * App constants — FRONTEND_ARCHITECTURE.md §2 (constants/).
 * Status→badge metadata maps land here with their features (P8 vocabulary).
 */

/**
 * P1 table page-size options (DS §8.26). Ten rows by default, so a worklist
 * opens on a screenful a clinician can read without scrolling; the larger
 * sizes are an explicit choice. 100 is the ceiling on purpose — there is no
 * "show all", because an unbounded page would render every row a doctor has
 * ever had in one pass.
 */
export const PAGE_SIZES = [10, 20, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 10;

/** Search debounce (DS §8.28). */
export const SEARCH_DEBOUNCE_MS = 300;

/** Loading-state threshold: show nothing under this (DS §8.32). */
export const LOADING_DELAY_MS = 300;

/** Product name — the document-title suffix and the <title> fallback. */
export const APP_NAME = 'Medora';

/** App release identity (Settings → About; single source for version text). */
export const APP_VERSION = '0.1.0';
export const APP_RELEASE_CHANNEL = 'Demo environment';
export const APP_RELEASE_DATE = 'July 2026';
