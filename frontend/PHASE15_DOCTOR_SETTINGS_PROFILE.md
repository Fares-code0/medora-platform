# Phase 15 — Doctor Settings & Profile Center

An enterprise-grade Settings Center for the doctor role, replacing the previous
`/doctor/settings` placeholder and the Profile placeholder. Built to feel like a
professional SaaS account settings surface (Stripe / Linear / GitHub): a sticky
left navigation, a scrollable content column of grouped cards, section anchors
via the URL, and a sticky save bar for batched edits.

- **Route:** `/doctor/settings/:section` (bare `/doctor/settings` → `profile`)
- **Feature:** `src/features/doctor/settings/`
- **Branch:** `claude/doctor-lab-system-phase-7-c1f15a` (the canonical phase line
  carrying Phases 0–14; Phase 15 was committed here, consistent with Phases 9–14).

---

## 1. Sections (10)

Grouped in the left nav under **Account**, **Workspace**, and **System**:

| Section | Group | What it does |
| --- | --- | --- |
| **Profile** | Account | Professional identity — photo, name, title, specialty, license, employee ID, department, hospital, years of experience, languages, biography, contact info. RHF + Zod validation, live **Profile Completion** widget, sticky save bar. |
| **Account** | Account | Email / username / phone (sticky save bar) + change-password form (current/new/confirm, strength meter, show/hide, success state, wrong-current-password error). |
| **Security** | Account | Security-posture status card, two-factor toggle (confirm on disable), trusted devices, active sessions (revoke one / sign out others), recent login history. |
| **Privacy** | Account | Data-sharing / analytics / cookies / AI-usage toggles (sticky save bar), **Download my data** (client-side JSON export), **Delete account** confirmation dialog. |
| **Notifications** | Workspace | Delivery channels, quiet hours, per-category opt-ins. **Reuses the notifications feature's `useNotificationPreferences`** — no duplicated model. Applies immediately. |
| **Appearance** | Workspace | Theme (light/dark/system), accent-color preview, density, font size, language (RTL/LTR ready). Applies live. |
| **Preferences** | Workspace | Default landing page, default patient/records tabs, auto-save drafts, date/time format, timezone (sticky save bar). |
| **Accessibility** | Workspace | Reduce motion, high contrast, keyboard navigation, focus indicators, text-scaling slider. Applies live. |
| **Integrations** | System | Google Calendar, Outlook, Zoom, Teams — connect/disconnect with connected status. |
| **Activity log** | System | Reverse-chronological feed of account actions; every mutation in the Center appends an entry. |

---

## 2. Architecture

Follows the existing feature conventions (TanStack Query · mock service · store ·
selectors · hooks · routes · shared components).

```
src/features/doctor/settings/
  index.ts                     # public API: settingsRoutes, getDoctorLandingPath
  routes.tsx                   # lazy /doctor/settings/:section
  schemas.ts                   # Zod: profile, account, password
  landing.ts                   # resolves the default-landing-page preference to a route
  model/
    types.ts                   # SettingsDocument + section metadata
    mock-data.ts               # SEED_SETTINGS (one doctor; every list ≤5 rows)
    store.ts                   # per-user localStorage (medora.<userId>.settings.v1)
    selectors.ts               # profile completion, security posture, formatters
  mock/
    mock-settings-service.ts   # Promise-based API seam; each mutation logs activity
  api/
    useSettingsQueries.ts      # query + mutations (cache-seeding onSuccess)
  hooks/
    useEditableSection.ts      # draft/dirty tracking for the sticky save bar
  components/
    SettingsNav.tsx            # sticky grouped rail + mobile Select
    SettingsCard.tsx           # grouped-card container
    SettingsRow.tsx            # label/description + control row
    StickySaveBar.tsx          # bottom-pinned Save/Cancel bar
    OptionCards.tsx            # radiogroup tiles (theme, density, landing page, …)
    ProfileCompletionWidget.tsx
  pages/
    SettingsPage.tsx           # shell: header + nav + section router
  sections/                    # one file per section (10)
```

### Persistence

- **Account document** (`medora.<userId>.settings.v1`) — profile, account,
  security, privacy, workflow, integrations, activity. Namespaced per user, so
  the auth provider's `clearUserPreferences` wipes it on logout (§6.4), same as
  notifications preferences.
- **Appearance + accessibility** — global `interface` key in the typed
  preferences service (`src/services/preferences.ts`), applied to `<html>` before
  first paint by the no-flash boot script in `index.html`, kept in sync by the new
  `InterfaceSettingsProvider`.
- **Notification preferences** — untouched; owned by the notifications feature and
  reused here.

### Data-layer contract

Every mutation threads `userId`, persists through the store, appends an activity
entry, and returns the full patched `SettingsDocument`, which the mutation writes
straight into the query cache (`setQueryData`) — so the completion widget,
security posture, and activity log update without a refetch. No navigation is
gated on mutation callbacks (StrictMode-safe, per the Phase 10 lesson).

---

## 3. Cross-cutting integration

| Touch point | Change |
| --- | --- |
| `src/routes/index.ts` | `DoctorSettingsSection` union updated to the 10 real sections. |
| `src/app/router/index.tsx` | Mounts `settingsRoutes`; removed the settings placeholder. |
| `src/app/router/placeholders.tsx` | `RootRedirect` honors the doctor's default-landing-page preference via `getDoctorLandingPath`. |
| `src/app/providers/` | New `InterfaceSettingsProvider` (mounted above `MotionProvider`); `MotionProvider` escalates to `reducedMotion="always"` when Reduce Motion is on. |
| `src/services/preferences.ts` | Added the global `interface` settings blob + `DEFAULT_INTERFACE_SETTINGS`. |
| `index.html` | Boot script also applies density / contrast / focus / motion / text-scale before first paint. |
| `src/styles/globals.css` | `[data-density]`, `[data-contrast]`, `[data-focus]`, `[data-keyboard-nav]`, `[data-reduce-motion]` rules + `--font-scale` on `html`. |
| `src/utils/password.ts` | **New platform util** — password policy + strength scoring, shared by auth and settings without a cross-feature import. |
| `src/features/auth/schemas/password.ts`, `components/password-strength.ts` | Now re-export from `@/utils/password` (single source of truth). |
| `src/components/patterns/PasswordStrengthMeter.tsx` | **New platform pattern** — token-based strength meter used by the Account section. |
| `src/features/doctor/notifications/index.ts` | Exposes `useNotificationPreferences` + channel/category meta for reuse. |
| `src/features/doctor/dashboard/.../ScheduleWidget.tsx` | "Set availability" link repointed to the Preferences section. |

---

## 4. Design & quality

- **Enterprise SaaS feel:** left nav + scrollable grouped cards + sticky save bar
  + section anchors; deliberately distinct from the dashboard modules.
- **Responsive:** desktop shows the sticky rail (`lg:grid-cols-[220px_1fr]`);
  tablet/mobile collapse the rail to a Select; rows stack their controls.
- **Tokens only:** no inline styles for color, no hardcoded hex; the only inline
  style is the dynamic `--font-scale` value (same pattern as `Progress`).
- **Applies-immediately vs. save-bar:** switches that are safe to apply live
  (notifications, appearance, accessibility, security actions) apply immediately
  per DS §8.7; batched forms (profile, account, privacy, preferences) use the
  sticky save bar with Cancel/Save.

### Mock data

One seeded doctor (**Dr. Amelia Chen**, the demo auth account). Every list is ≤5
rows: 3 trusted devices, 3 active sessions, 5 login events, 4 integrations, 5
activity entries. No fabricated enterprise volume.

### Verification

| Gate | Result |
| --- | --- |
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 errors (17 accepted `react-refresh/only-export-components` warnings) |
| `npm run build` | success (SettingsPage is its own lazy chunk) |

Manual browser checks: profile edit → save/cancel, password validation +
strength, theme switching, density/font/contrast/motion applied to `<html>`,
toggle switches, sticky save bar reveal/hide, section navigation & deep links,
responsive layout, zero console errors.
