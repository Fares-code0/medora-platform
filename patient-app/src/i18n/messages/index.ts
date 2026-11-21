import type { Locale } from '../locales';

import { ar } from './ar';
import { en } from './en';

/**
 * The catalogues.
 *
 * `MessageKey` is derived from the English object, so it is the single
 * source of truth for what a key is. `Messages` is then
 * `Record<MessageKey, string>` — total, which is what makes a missing
 * translation a compile error and removes the runtime fallback chain
 * entirely. If it compiles, the string exists in every language.
 *
 * `catalogues` is typed `Record<Locale, Messages>`, so adding a locale to
 * `LOCALE_CODES` without adding its catalogue also fails to typecheck.
 * Both directions are closed.
 */

export type MessageKey = keyof typeof en;

export type Messages = Record<MessageKey, string>;

export const catalogues: Record<Locale, Messages> = { en, ar };

export { en, ar };
