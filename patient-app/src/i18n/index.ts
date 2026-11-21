/**
 * i18n — PUBLIC API (C-09).
 *
 * A platform layer, not a feature: it imports nothing from `features/`,
 * so any feature may use it without crossing the layering rule in
 * `docs/ARCHITECTURE.md` §3.
 *
 * The whole surface is three things:
 *
 * ```tsx
 * const t = useT();                        // t('action.retry')
 * const { locale, setLocale } = useLocale();
 * const rtl = useIsRtl();                  // only for what layout cannot do
 * const { formatDateTime } = useDateFormat();
 * ```
 *
 * The fourth arrived on 2026-09-12 and closed a gap the first three
 * hid: every screen read its words from the catalogue and its **dates**
 * from the device, so a patient on Arabic with an English phone read
 * Arabic headings above English dates.
 *
 * To add a language: add its code to `LOCALE_CODES`, its metadata to
 * `LOCALES`, and a catalogue under `messages/`. The typechecker names
 * every string still missing — there is no runtime "untranslated" state
 * to discover on a device.
 *
 * ── Every screen is on it now (C-09) ────────────────────────────────
 *
 * The state components went first — they are what a patient reads when
 * something has gone wrong, which is the worst moment to be facing a
 * language you do not speak, and they carry no clinical content. The
 * entry stack, the shell and the four content trees followed.
 *
 * `no-inline-copy.test.ts` is what keeps it that way: a source scan over
 * every rendering file, failing on a user-facing prop whose value is a
 * bare English literal, with a per-file allow-list of the decisions
 * below.
 *
 * ── Three exclusions, each a decision rather than a gap ─────────────
 *
 * - **The emergency feature and the affordances that lead to it.**
 *   Clinically reviewed material (N-07, W-10). Whether the label on the
 *   way IN is inside that review is the W-10 owner's call, not a
 *   translator's; `docs/A11Y_AUDIT.md` §6 carries it as an open
 *   question.
 * - **The clinical vocabulary the record is written in** — allergy
 *   severity, medication and prescription status, lab flags. This was
 *   the reason the row said the rest of C-09 "is not a mechanical
 *   change", and it was right about exactly this part: an Arabic
 *   rendering of a lab flag needs the review the English got. So the
 *   screens around those badges are translated and the badges are not.
 * - **Zod schema messages.** A module-level schema cannot read a hook,
 *   and moving them needs a decision about whether schemas take a `t`
 *   or forms map issue codes.
 *
 * `ErrorBoundary` keeps its own copy for a different reason: it is the
 * one screen that has to render when the tree below it has just failed,
 * and giving it a context dependency for its own words is the wrong
 * trade.
 *
 * ── Two things to know before writing a test ────────────────────────
 *
 * - A component using `useT` **throws** without a `LocaleProvider` above
 *   it — deliberately, because a silent English fallback is how a screen
 *   ships half-translated. `test/render.tsx` mounts one and takes a
 *   `locale`; a bespoke tree (see `navigation.test.tsx`) adds its own.
 * - A test that asserts wording should assert the KEY where it can. The
 *   mapping functions — `ErrorState`'s `present`, `authErrorKey`,
 *   `statusPresentation`, `deprecationMessage` — all return keys for
 *   that reason: they stay callable without a provider, and a rule about
 *   two messages being distinct then holds in every language rather than
 *   in whichever one the test rendered.
 */

export {
  LocaleProvider,
  useLocale,
  useIsRtl,
  useT,
  interpolate,
  applyNativeDirection,
  type LocaleContextValue,
  type MessageParams,
  type TranslateFn,
} from './LocaleProvider';

export {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_CODES,
  directionOf,
  isLocale,
  localeMeta,
  type Direction,
  type Locale,
  type LocaleMeta,
} from './locales';

export { catalogues, type MessageKey, type Messages } from './messages';

export { useDateFormat, type DateFormatters } from './useDateFormat';
