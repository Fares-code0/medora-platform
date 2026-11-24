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
 * ── No exclusions left (W-10 translation approval, 2026-11-23) ──────
 *
 * There used to be three, each a decision: the emergency feature and
 * the affordances leading to it, the clinical vocabulary the record is
 * written in, and Zod schema messages. The owner approved translating
 * ALL application-controlled copy on 2026-11-23, so:
 *
 * - **Emergency and clinical copy** are catalogue keys (`emergency.*`,
 *   `crash.*`, `support.urgent.*`, `health.allergy.severity.*`,
 *   `health.labs.flag.*` …). The approval covers translating only: the
 *   W-10 clinical sign-off is still NOT given, and the Arabic of those
 *   keys is an engineering draft awaiting the named clinical reviewer
 *   (`docs/SIGNOFF.md`, `docs/A11Y_AUDIT.md` §6).
 * - **Zod messages** stay English in `features/auth/schemas.ts`, where
 *   they mirror the backend DTOs, and `./validation.ts` maps each one to
 *   its `validation.*` key at render.
 *
 * What is NOT translated is data: patient-entered text, names, doctor
 * names, the clinic's records, server-supplied notification text, and
 * operator-configured emergency number labels.
 *
 * `ErrorBoundary` reads its words through `useOptionalT`: it is the one
 * screen that has to render when the tree below it has just failed, so it
 * uses the provider's locale when there is one and the stored preference
 * when there is not, rather than throwing for want of a context.
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
  useOptionalT,
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

export { translateValidation, useValidationMessage, validationMessageKey } from './validation';
