# i18n — how the web app is localized

The public API is `src/i18n/index.ts`; its docblock is the one-screen summary.
This file is the working guide for the Arabic localization, which is delivered
in phases: the **foundation** (this module, the shared components, the shells,
auth, the shared clinical vocabularies and every route title) first, then one
pull request per feature area.

## Decision: Arabic complete, French/Persian/Turkish partial (2026-11-23)

F-19 typed every catalogue as total (`Record<MessageKey, string>`): a key added
to English failed to compile until all four translations had it. That was right
for the ~250-key shell, and it is what blocks the owner's requirement now —
*every* user-facing, application-controlled string must appear in Arabic, which
means roughly 3,000 more keys, and holding each one back until French, Persian
and Turkish also have it would hold Arabic back with it.

So, by owner decision on 2026-11-23:

| Catalogue        | Type              | A key it lacks …                          |
| ---------------- | ----------------- | ----------------------------------------- |
| `en.ts`          | the source        | does not exist                            |
| `ar.ts`          | `Messages`        | is a **compile error**                    |
| `fa.ts`, `fr.ts`, `tr.ts` | `PartialMessages` | renders the **English** text, per key |

French, Persian and Turkish users therefore see what they already saw for every
untranslated feature interior: English, never a raw key. Their existing
translations are untouched and still checked (non-empty, placeholders kept,
not copied English, Persian letters). The fallback is resolved per key in
`messages/index.ts#messageFor`, which also reports which catalogue answered so
a plural is chosen by *English* rules for an English sentence.

One rule follows from that: **replacing an already-translated string with a
new key must not regress these three languages.** When a string they
translated (directly or by concatenating translated keys) moves to a new key,
give the new key their translation too — as the unread-count keys
(`shell.unreadCount`, `shell.notificationsUnread`,
`shell.unreadNotificationsBadge`) do; `i18n.test.tsx` checks those.

This reverses a documented decision; an ADR entry in the repository's
`docs/DECISIONS.md` should record it (not done from the frontend tree).

## Adding a string

1. Add the key to `messages/en.ts`, namespaced by surface (`photo.*`,
   `dashboard.*`, `admin.section.*`, `route.*`, `lab.*`, `rx.*`, …).
2. Add the Arabic to `messages/ar.ts`. `npm run typecheck` fails until you do.
3. Leave `fa.ts`/`fr.ts`/`tr.ts` alone unless you have a real translation.
4. Render it with `t('key')` from `useT()`. Outside a component, take a
   `TranslateFn` parameter (see `administration.meta.ts#adminSectionOptions`)
   or call `translate(locale, key)`.

Rules that `i18n.test.tsx` enforces:

- Arabic differs from English on every key except those listed by name in
  `AR_IDENTICAL_ALLOWED` (a sample email, the product name).
- Every `{placeholder}` English declares survives in each translation.
- Interpolate, never concatenate: `t('ui.removeFilter', { label })`, not
  `'Remove filter: ' + label`. Word order is the translator's.
- Patient and doctor names, anything a patient or provider typed, and mock/seed
  data are **data**, not copy: pass them as parameters, never translate them.
- Digits stay Latin and the calendar Gregorian in every locale (DEC-009); format
  dates and numbers only through `format.ts`.

## Plurals

A plural message is an object of CLDR forms, chosen with `Intl.PluralRules`:

```ts
// en.ts
'ui.resultCount': { one: '{count} result', other: '{count} results' },
// ar.ts — all six categories, enforced by i18n.test.tsx (the type requires only `other`)
'ui.resultCount': {
  zero: 'لا توجد نتائج', one: 'نتيجة واحدة', two: 'نتيجتان',
  few: '{count} نتائج', many: '{count} نتيجة', other: '{count} نتيجة',
},
```

```tsx
t('ui.resultCount', { count: rows.length });
```

Arabic: 0 → zero, 1 → one, 2 → two, 3–10 → few, 11–99 → many, 100+ → other.
The forms together must use English's placeholders, but a single form need
not (`one`/`two` usually say the number in the word). A missing category or a
missing `count` falls back to `other`. Replace every `n === 1 ? 'x' : 'xs'`
with a plural key — never build a plural by appending an `s`.

## Sentences around elements: `useTx`

When a sentence wraps an element — a bold name, a link, a badge — translate
the whole sentence and slot the element in, so the translator controls order:

```tsx
const tx = useTx();
// en: 'Suspending {name} cancels {count} appointments.'
tx('admin.suspend.impact', { name: <strong>{doctor.name}</strong>, count });
```

`interpolateNodes` is the hook-free form. With only strings and numbers it
returns a plain string, identical to `t`. Do not split one sentence into
several keys around the element.

## Validation messages (zod)

A module-level schema cannot call a hook, so schemas carry **keys** as their
messages (`z.string().min(1, 'validation.enterEmail')`) and the form renders
them with `translateIfKey(t, errors.email?.message, params)`. A message that
is not a key (a server's field error) passes through unchanged.

## Route titles

Every route names itself with `handle: { titleKey: 'nav.patients' }`.
`useRouteTitle()` (document title and route announcer) and `AppBreadcrumb`
translate it; a literal `crumb` is only the fallback for routes outside the
catalogue. Admin section titles live in `SECTION_META` as `labelKey` /
`descriptionKey`, and `administration.meta.test.ts` keeps each route's
`titleKey` equal to its section's `labelKey`.

## Label maps shared with untranslated model code

Where a label map is read both by components and by model code that has no
translator yet (filter-chip builders, exports), the entry carries both:
`{ label: 'Active', labelKey: 'rx.status.active' }`. Components render
`t(meta.labelKey)`; `features/shared-domain/labels.test.ts` proves each
`labelKey` renders the same English as `label`. Drop `label` once the last
model caller takes a translator.

## The hard-coded-copy ratchet

`hardcoded-copy.test.ts` counts, per file, the English a component still
writes inline (JSX text, user-facing attributes and props, prop defaults,
validation messages, toasts) and compares it with
`hardcoded-copy.baseline.json`:

- a file whose count **rises**, or a new file with any hit, **fails**;
- a file whose count **falls** also fails until the baseline is rewritten, so
  each reduction becomes the new ceiling in the pull request that earned it.

After localizing a feature area, from `frontend/`:

```sh
# the worklist for one area
COPY_REPORT=features/doctor/labs npx vitest run src/i18n/hardcoded-copy.test.ts
# lock in the reduction
UPDATE_COPY_BASELINE=1 npx vitest run src/i18n/hardcoded-copy.test.ts
```

The baseline is the remaining-untranslated inventory. Excluded by design:
tests, stories, the test harness, mock and seed data, the theme playground and
the catalogues. It is a syntax heuristic, so it also counts a few strings that
are deliberately not translated — the brand name «Medora» in `AuthFooter`,
`BrandPanel` and `AppSidebar` — which simply stay in the baseline.

What it counts as copy: JSX text and children literals; the attributes and
props `title`, `label`, `aria-label` (and the other `aria-*` text), `placeholder`,
`alt`, `description`, `helperText`, `caption`, `message`, `text`, `content`,
`successMessage`, `errorMessage`, `emptyLabel`, `confirmText` and friends, in JSX
or in object literals; prop defaults; zod messages, toasts and `setError`.
`name` counts only for a multi-word capitalised value (`name="Clinic Policies"`)
— a form field's `name="firstName"` or a person's name is not copy. A
`label`/`title` beside a `labelKey`/`titleKey` is exempt only when that key is
a real key of `en.ts`.

A second ratchet in the same file, `paired-label-reads.baseline.json`, counts
the `.tsx` reads of a paired label map's English (`PATIENT_STATUS_META[s].label`)
that a component renders instead of `t(meta.labelKey)`. It ratchets the same
way and is regenerated by the same command.

## Phase plan for the feature areas

One pull request per area, largest first by the baseline: admin sections and
settings, doctor settings, patients, medical records, pharmacy, appointments,
labs, admin doctors/patients, reports, notifications, appointments oversight,
communications, AI assistant, dashboards, messaging, logs, staff, clinic. Per
area: move the copy to keys (en + ar), convert plural sites, move label maps to
keys (or pair them while model code catches up), fix any date that is not
formatted through `format.ts`, and regenerate the baseline.

`features/auth/dev/DemoAccessPanel.tsx` is the one deliberate exception to the
shared catalogue: its copy is the marker set `scripts/demo-access-boundary.ts`
looks for in production bundles, and the English catalogue ships in every
bundle, so the panel keeps its own English and Arabic in its own file.
