# Theme customization — Web + Patient App

How to change Medora's colours yourself, in both clients, by hand or with the
development-only Theme Playgrounds.

> **The one rule.** A colour is changed in a **token file**, never in a
> component. Every component reads tokens, so one edit repaints every place
> that role appears. The two token files are:
>
> | App | Token file | Light | Dark |
> |---|---|---|---|
> | Web (`frontend/`) | `frontend/src/styles/tokens.css` | `:root { … }` (line 28) | `.dark { … }` (line 273) |
> | Patient (`patient-app/`) | `patient-app/src/theme/tokens.ts` | `lightColors` (line 92) | `darkColors` (line 158) |

---

## 1. Manual editing — change a HEX, save, see it

### Web

1. `npm --prefix frontend run dev` → <http://localhost:5173>
2. Open `frontend/src/styles/tokens.css`, change a value, e.g.
   line 40 `--color-primary: #2c5282;` → `--color-primary: #0b5cad;`
3. Save. Vite hot-reloads the stylesheet; every primary button, link, active
   nav item, checkbox and tab indicator changes at once — no reload.
4. Change the **dark** value too (line 276), or the two modes drift.
5. Toggle light/dark from the avatar menu to check both.

### Patient app

1. `npm --prefix patient-app run start`, then press `a` (Android) or `i` (iOS).
   No backend needed — `EXPO_PUBLIC_ENABLE_MOCKS=true` is the default.
2. Open `patient-app/src/theme/tokens.ts`, change a value, e.g.
   line 93 `primary: '#2c5282',` → `primary: '#0b5cad',`
3. Save. Fast Refresh repaints; `useTheme()` is the only way any component
   reads a colour, so all of them follow.
4. Change the dark value too (line 159).
5. Profile → Preferences → Theme to switch Light / Dark / System.

### Revert

```bash
git diff frontend/src/styles/tokens.css patient-app/src/theme/tokens.ts   # see what you changed
git restore frontend/src/styles/tokens.css                                 # undo one file
```

### Rules the token files hold (the tests enforce them)

- **6-digit hex** for opaque colours. The contrast tests parse `#rrggbb`;
  `rgba()` is fine for the translucent `*-subtle`, `scrim` and dark-mode tints
  that already use it.
- **Dark mode is not inverted light mode.** Filled tones (primary, error,
  accent, success, warning) are *light* in dark mode, so `text-inverse` /
  `textInverse` must be *dark* there (`#0d0d0f`), or every filled button is
  unreadable.
- **Don't rename or delete a token.** A missing CSS variable renders as no
  colour with no error.
- After editing, run the contrast tests:
  `npm --prefix frontend run test -- src/styles src/features/status-encoding.test.ts`
  and `npm --prefix patient-app run test -- src/theme`.

---

## 2. "If I want to change this, edit this"

Line numbers are for light / dark.

| What I want to change | Web: `frontend/src/styles/tokens.css` | Patient: `patient-app/src/theme/tokens.ts` | Example |
|---|---|---|---|
| **Main brand colour** | `--color-primary` (40 / 276) + `--color-focus-ring` (122 / 352) | `primary` (93 / 159) + `focusRing` (127 / 193) | `#0b5cad` / `#8cbcf0` |
| Primary hover / pressed | `--color-primary-hover`, `-pressed` (41–42 / 277–278) | `primaryHover`, `primaryPressed` (94–95 / 160–161) | `#094a8c`, `#073a6e` |
| Selected / active background | `--color-primary-subtle` (43 / 279) | `primarySubtle` (96 / 162) | `#e8f1fb` |
| **Background** (page) | `--color-background` (75 / 314) | `background` (113 / 179) | `#f4f7fb` / `#0b0f15` |
| **Cards** & panels | `--color-surface` (76 / 315), `--color-border` (82 / 320) | `surface` (114 / 180), `border` (117 / 183) | `#ffffff` / `#151b24` |
| Modals, menus, sheets | `--color-surface-overlay` (78 / 317) | `surfaceOverlay` (116 / 182) | `#1f2733` (dark) |
| **Text** | `--color-text-primary` / `-secondary` / `-tertiary` (86 / 87 / 92 · 325 / 326 / 329) | `textPrimary` / `textSecondary` / `textTertiary` (120–122 / 186–188) | `#0b1726` |
| **Buttons** | Values: primary tokens above, `--color-error` (68 / 289), `--color-accent` (57 / 283). Which token each variant uses: `frontend/src/components/ui/internal/styles.ts:25` | Values: same roles. Mapping: `patient-app/src/components/Button.tsx` | — |
| **Navigation** | Sidebar & navbar = `--color-surface`; active item = `--color-primary-subtle` + `--color-primary` | Header = `background` + `textPrimary`; tab bar = `surface` + `border`, active `primary`, inactive `textTertiary` (`patient-app/src/navigation/AppTabs.tsx`) | — |
| **Inputs** | Fill `--color-surface`, boundary `--color-border-strong` (85 / 324), placeholder `--color-text-placeholder` (108 / 333). Recipe: `styles.ts:135` | Fill `surface`, boundary `borderStrong` (118 / 184), **placeholder `textDisabled`** (123 / 189) | `#7b8798` |
| **Charts** | `--color-chart-1` … `--color-chart-5-edge` (154–163 / 367–376) | `chart1` … `chart5Edge` (130–139 / 196–205) — no patient chart yet | — |
| Status | `--color-success/-warning/-error/-info` + `-subtle` (64–72 / 285–293) | `success` … `infoSubtle` (103–111 / 169–177) | Keep — clinical meaning |
| **Dark mode** | the whole `.dark { }` block (273–383) | the whole `darkColors` object (158–206) | — |
| **Add a new preset** | `frontend/src/features/theme-playground/model/presets.ts` | `patient-app/src/features/theme-playground/model/presets.ts` | see §5 |

There is no dedicated sidebar, navbar or input-background token on either side:
those reuse `surface`. To change *only* the sidebar, edit its class in
`frontend/src/components/ui/Sidebar.tsx:46` — that is component styling, not a
theme change.

### Naming: the same role, two spellings

| Web (CSS variable) | Patient (`ColorPalette` key) |
|---|---|
| `--color-text-primary` | `textPrimary` |
| `--color-surface-overlay` | `surfaceOverlay` |
| `--color-chart-1-edge` | `chart1Edge` |

The rule is mechanical: drop `--color-`, camelCase the rest. Three web roles
have no patient key: `--color-text-placeholder` (the patient app uses
`textDisabled` for placeholders), `--color-scrollbar-thumb` and
`--color-scrollbar-track`.

---

## 3. Web Theme Playground

**Open:**

```bash
cp frontend/.env.example frontend/.env     # once — sets VITE_APP_ENV=development
npm --prefix frontend run dev              # then http://localhost:5173/dev/theme-playground
```

No sign-in needed. It is not in any navigation.

**When it exists — exactly:**

| How Medora is running | Playground |
|---|---|
| `npm run dev` (Vite dev server) with `VITE_APP_ENV=development` | **Available** |
| `npm run dev` with `VITE_APP_ENV` unset, `staging` or `production` | Not registered (404) |
| `npm run build` (production) | Excluded from the bundle |
| `npm run build:demo` (the public Vercel demo) | Excluded from the bundle |
| any other `vite build`, whatever `--mode` or `VITE_APP_ENV` | Excluded from the bundle |

The gate is `import.meta.env.MEDORA_THEME_PLAYGROUND`, a compile-time constant
`frontend/vite.config.ts` sets from `themePlaygroundEnabled()` in
`frontend/scripts/theme-playground-boundary.ts`: dev server **and** development
mode **and** `VITE_APP_ENV=development`. It is deliberately **not**
`import.meta.env.DEV` — `build:demo` sets `NODE_ENV=development`, which makes
`DEV` true on the public demo (DEPLOYMENT.md, "Demo posture"). Every build also
runs `themePlaygroundBoundaryPlugin`, which fails the build if any module from
`src/features/theme-playground/` — or any of the playground's marker strings —
reaches an emitted chunk.

What it does:

- **Presets:** Original Medora (read live from `tokens.css` — edit the file and
  this follows), Medical Blue, Midnight Purple, Emerald Green, Custom Theme.
- **Editor:** every one of the 45 tokens, grouped (Brand, Backgrounds,
  Typography, UI, Status, Data visualization), each with swatch, native colour
  picker, HEX/rgba field, copy, and reset-to-default. Edit Light and Edit Dark
  are separate.
- **Live preview:** the project's real components — navbar, sidebar, buttons,
  cards, inputs, select, textarea, checkbox, switch, radio, tabs, badges,
  alerts, toasts, modal, dropdown, data table, bar/donut/area charts,
  spinner, progress, skeleton, empty state — in Light, Dark or side by side.
- **Accessibility:** every edit re-runs the checks the contrast tests enforce
  (text 4.5:1; borders, focus ring, chart edges 3:1; label on filled buttons;
  status text on its tint) plus hue-distance warnings (AI accent vs primary,
  primary vs error/warning/success). A failure shows the ratio, the tokens, and
  a suggested value you can apply with one click. **Nothing is changed for
  you.**
- **Export:** CSS (paste into `tokens.css`), TypeScript (paste into
  `patient-app/src/theme/tokens.ts`), JSON (`medora-theme@1`, loads into
  either playground). Copy or download.
- **Saved experiments:** stored in this browser under
  `medora.dev.theme-playground.*` only. Your real theme (`medora.theme`) and
  every other preference are never read or written.

**Isolation:** the preview declares every token inline on its own container,
so it never touches `<html>`; the rest of the app keeps your real theme.

**Resets:** per token (the ↺ button), per mode ("Reset light palette"), or
everything ("Reset all changes", asks first). The first edit to a preset forks
a Custom Theme; editing another preset while a Custom Theme exists asks before
replacing it.

---

## 4. Patient App Theme Playground

**Open:** run the app (`npm --prefix patient-app run start`), sign in with the
development demo button on the login screen, then **Profile → Preferences →
Developer → Open Theme Playground**.

**Development only.** The Developer section renders behind `__DEV__`, which
Metro compiles to `false` in a release bundle, so a production patient cannot
reach it. It is a full-screen modal, not a route, so deep links can't reach it.

What it does:

- Presets: the same five, with the same HEX values as the web.
- Colour editing: HEX/rgba field per token, quick-pick swatches (that token's
  value in each preset plus a neutral/brand ramp), reset per token, per mode,
  or all. **No colour-picker dependency** — none was installed, so none was
  added.
- Native preview, using the real components under `ThemePreviewProvider`:
  dashboard card, emergency card, text roles, all button tones, inputs
  (including error and disabled), checkbox, chips, a native Switch, badges and
  status badges, alert-style cards, toasts, a bottom sheet, loading indicator,
  skeleton, empty state. The header and bottom tab bar are **replicas** that
  use the same tokens React Navigation is given, because those can't mount
  outside a navigator.
- Light, Dark, or Device appearance; the **status bar** follows the preview so
  you can check its icons. Widths: 320 / 375 / 428 / fill.
- The Android system navigation bar can't be recoloured without
  `expo-navigation-bar`, which isn't installed.
- The same accessibility checks, with suggestions you choose to apply.
- Export TypeScript / CSS / JSON through the system Share sheet; import JSON
  from either playground.
- **Nothing is persisted.** Close it and the experiment is gone, so export to
  keep it. `medora.theme-mode` is never read or written.

---

## 5. Add a new preset (both apps)

1. **Web:** in `frontend/src/features/theme-playground/model/presets.ts`, copy
   one `const …: ThemePreset` block, give it a new `id` / `label` /
   `description`, set every value, add the id to `PresetId`, and add it to the
   `buildPresets` list. Keep `...STATUS_LIGHT` / `...STATUS_DARK`.
2. **Patient:** same block, same values, in
   `patient-app/src/features/theme-playground/model/presets.ts` (camelCase
   keys), plus `PresetId` and `PRESETS`.
3. Run:
   ```bash
   npm --prefix frontend run test -- src/features/theme-playground
   npm --prefix patient-app run test -- src/features/theme-playground
   ```
   `presets.test.ts` checks that every token is present and passes contrast in
   both modes. `patient-parity.test.ts` checks that the two copies hold the
   same values.

A preset lives in the playgrounds only. To make it what Medora *ships*, export
CSS into `tokens.css` and TypeScript into `tokens.ts`. Making presets
user-selectable at runtime would be a new feature: a `data-palette` attribute
layered like the existing high-contrast override in
`frontend/src/styles/globals.css`, plus a new preference. It's deliberately
not part of this tooling.

---

## 6. Keeping the two apps in sync

There is no shared package, so equivalence is kept by tests:

| Check | Command | Fails when |
|---|---|---|
| Original web ⇄ patient | `npm --prefix frontend run test -- patient-parity` | a shared token differs between `tokens.css` and `tokens.ts` |
| Playground presets web ⇄ patient | same test | a preset value differs between the two `presets.ts` |
| Web contrast | `npm --prefix frontend run test -- src/styles` | a text/boundary role drops below threshold |
| Patient contrast | `npm --prefix patient-app run test -- src/theme` | same, mobile palette |

The parity test skips (it doesn't fail) on a checkout without `patient-app/`,
because the two trees live on separate integration branches.

The easiest way to keep them equal is to make the change in one playground,
export **both** CSS and TypeScript, and paste each into its token file.

---

## 7. Testing checklist after a colour change

- [ ] Both modes, both apps (web avatar menu; patient Preferences → Theme).
- [ ] Web Settings → Accessibility → High contrast still reads (overrides in `globals.css:44-65`).
- [ ] Contrast tests pass (§1).
- [ ] Status colours still mean what they meant: confirmed is green, pending amber, error red.
- [ ] The AI accent is still distinguishable from primary (Ask AI button, AI badge).
- [ ] Charts: pale series 4 and 5 still have a visible edge.
- [ ] Login brand panel (`frontend/src/features/auth/layout/BrandPanel.css`) is a fixed dark canvas by design; it doesn't follow tokens.
