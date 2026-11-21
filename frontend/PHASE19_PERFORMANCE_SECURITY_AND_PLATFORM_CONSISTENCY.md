# PHASE 19 — Performance, Authentication & Platform Consistency

## Summary

Phase 19 hardens the platform rather than extending it: the initial bundle
shrank by 23% (gzip), the Administration Center became strictly admin-only,
the login screen dropped its consumer OAuth placeholders, the admin header
and settings now reuse the doctor implementations verbatim, the notification
bell became fully functional in both shells, and a user-reported login bug
(admin walked through a 403 interstitial before reaching the panel) was
reproduced, fixed, and verified. All work landed on the existing unified
branch — no new branch, worktree, clone, or merge.

## Performance Audit (before any change)

Baseline production build (`vite build`, sourcemap attribution):

| Item | Baseline |
| --- | --- |
| Entry chunk | **517.19 kB (165.63 kB gzip)** |
| Largest entry contributors | framer-motion ~395 kB source (~30%), @remix-run/router 194 kB, react-dom 130 kB, @tanstack/query-core 81 kB, tailwind-merge 72 kB |
| Eager app code in entry | ~78 kB source of `features/doctor` — the notifications + messaging **mock datasets and services**, dragged in statically by the shell badge queries |
| Route splitting | Already healthy: every doctor feature route uses a `lazy:` boundary, auth pages use `React.lazy`, the administration area is its own chunk |

Findings: (1) framer-motion was bundled eagerly through `MotionConfig` +
`motion.*` components; (2) `ShellBadgesProvider` statically imported the
notifications/messaging data layers, which statically imported mock services
and seed datasets; (3) everything else was already route-split, so the win
had to come from the entry chunk itself.

## Lazy Loading Changes

- **framer-motion → LazyMotion**: `MotionProvider` now wraps the app in
  `<LazyMotion features={…} strict>`; the `domMax` feature bundle
  (animations + gestures + layout projection for the Tabs `layoutId`
  underline) lives in a new async module `src/app/providers/motion-features.ts`
  and ships as its own 96.38 kB (31.10 kB gzip) chunk loaded after first
  paint. All 10 consumer files switched from `motion.*` to the slim `m.*`
  components; `strict` guarantees no full `motion` component can regress in.
- **Mock services on demand**: the notifications and messaging data layers
  (`useNotificationsQuery.ts`, `useMessagingQueries.ts`) now dynamic-import
  their mock services inside each `queryFn`/`mutationFn`. The seed datasets
  left the entry chunk and ship as `mock-notification-service` /
  `mock-messaging-service` async chunks.
- **Admin "My Settings"** mounts the doctor Settings Center through a nested
  `React.lazy` boundary inside the (already lazy) administration chunk, with
  a Spinner fallback consistent with the existing loading system — no
  flashing, no duplicate settings code in the admin chunk.
- Existing route-level laziness (auth pages, dashboard, patients, patient
  profile, appointments, medical records, labs, pharmacy, AI, messaging,
  notifications, reports, settings, administration) was audited and kept.

## Bundle Improvements

| Metric | Before | After | Δ |
| --- | --- | --- | --- |
| Entry chunk (raw) | 517.19 kB | **400.59 kB** | −116.6 kB (−22.5%) |
| Entry chunk (gzip) | 165.63 kB | **127.77 kB** | −37.9 kB (−22.9%) |
| framer-motion in entry (source) | ~395 kB | ~80 kB (slim `m` runtime) | −315 kB, rest async |
| zod | own async chunk | own async chunk (guarded against a regression found mid-phase) | — |
| Mock notif/messaging data in entry | ~50 kB source | 0 (async chunks) | −100% |

The entry chunk now contains only the framework core (react-dom, router,
query), the design-system primitives, and the shell — no feature datasets,
no animation features, no report/AI/admin/settings code.

## Security Improvements

- **Administration is admin-only.** The `/doctor/administration/*` subtree
  moved inside `<RequireRole role="admin">`; a doctor deep-linking to any
  administration URL now renders the 403 Forbidden page (verified in
  browser). No client-side bypass: every administration section is a child
  of that single guarded mount.
- **Administration removed from every doctor surface**: the sidebar
  "Management" section is gone from `doctorNavigation` (which also feeds the
  mobile drawer and bottom tab bar); DOM audit as a doctor found **zero**
  administration links or labels anywhere, including search.
- **Open-redirect hardening**: login now rejects non-path `returnTo` values
  (must start with `/`, never `//`).
- **Role-aware returnTo (user-reported bug fix)**: a stored `returnTo`
  belonging to the other role (e.g. `/doctor/overview` left behind by an
  expired doctor session) used to walk an admin sign-in straight into the
  doctor guard's 403 page before they clicked through to the panel.
  Reproduced in the browser, then fixed: `LoginPage.resolveDestination`
  only follows a returnTo the signed-in role may visit and otherwise falls
  back to the role landing redirect. Re-tested: admin login now lands
  directly on the Administration Center.

## Authentication Audit

- Doctor and admin logins verified in browser (`doctor@` → Overview,
  `admin@` → Administration Center).
- `returnTo` round-trip verified (capture on guard redirect, role-checked on
  login — see bug fix above).
- Session persistence verified: reload keeps the session (localStorage or
  sessionStorage by Remember Me).
- **Mock token refresh added**: on boot the session store now re-issues the
  bearer token and slides the expiry window (`refreshSession()`), matching
  silent-refresh semantics; expired sessions are cleared and land on login.
- Logout verified from the shared avatar menu in both shells (session +
  per-user preferences cleared).
- Idle auto-lock and the lock screen remain armed only while authenticated.

## Role Guard Audit

| Route area | Guard |
| --- | --- |
| `/login`, `/signup`, recovery/verify | `RequireGuest` (authenticated users bounce to role landing) |
| `/lock-screen` | standalone, reachable only from a `locked` session |
| `/doctor/*` workspace (dashboard, patients, appointments, records, labs, pharmacy, AI, messages, notifications, reports, settings) | `RequireAuth` → `RequireRole doctor` |
| `/doctor/administration/*` (all sections incl. platform settings, preferences, profile) | `RequireAuth` → `RequireRole admin` **(changed this phase)** |
| `/admin/*` | `RequireAuth` → `RequireRole admin` → redirect into Administration Center |
| `/403`, `/404`, `*` | public error surfaces |

## Navigation Cleanup

- Doctor sidebar/mobile drawer/bottom tabs: Administration entry removed.
- Admin rail footer: dead "Exit to workspace" doctor branch removed (the
  area is admin-only now); sign out remains.
- Admin rail gains **My Settings** (`preferences`) in the Platform group;
  "Settings" renamed to "Platform Settings" to disambiguate.
- Admin global search: now indexes My Settings/My Profile and gained the
  same **Ctrl/⌘+K** focus shortcut as the doctor navbar search.

## Platform Consistency (Admin ↔ Doctor)

- **Header parity**: the AdminCommandBar now renders the SAME
  `NotificationButton` and `AvatarMenu` components as the doctor navbar
  (exported through the layouts public API). Notifications, theme toggle,
  profile dropdown (Profile / Settings / Light / Dark / System / Sign out),
  search shortcut, and sign-out behave identically; only the role-specific
  destinations differ.
- **Settings parity with zero duplication**: the doctor `SettingsPage` and
  `SettingsNav` accept an optional path-builder, and the admin mounts the
  identical page at `/doctor/administration/preferences/:section`
  (profile, account, security, privacy, notifications, appearance,
  preferences, accessibility, integrations, activity, about — same nav,
  sections, transitions, dark/light/theme/language switching, save flows).
  `AdministrationLayout` also mounts the shell's internal-link interception
  so the reused anchors stay SPA navigations.
- **Notifications are real, not placeholders** (both shells): the bell shows
  a live unread badge, opens the Drawer feed, row-click marks an item read,
  "Mark all as read" and "Clear read" work, state persists (localStorage +
  shared TanStack Query cache), and the footer "View all" link appears for
  the doctor (the admin manages everything in the panel). The former inert
  `<IconButton icon={Bell}/>` in the admin command bar is gone.

## Login Page

- Removed "Continue with Google", "Continue with Microsoft", the "or"
  divider, the SSO toast handler, the whole `SocialButtons` component, and
  the three related i18n keys.
- The card now ends at the primary Sign in action with the existing footer —
  no leftover gap; enterprise-appropriate for a hospital system.

## Files Created

- `src/app/providers/motion-features.ts` — async framer-motion feature bundle
- `src/features/doctor/administration/sections/AdminPreferencesSection.tsx` — admin mount of the shared Settings Center
- `PHASE19_PERFORMANCE_SECURITY_AND_PLATFORM_CONSISTENCY.md` — this document

## Files Modified

- Router/guards: `src/app/router/index.tsx`, `src/app/router/ShellBadgesProvider.tsx`
- Providers: `AuthProvider.tsx` (silent refresh, dead `useHasRole` removed), `MotionProvider.tsx` (LazyMotion), `ToastProvider.tsx` (`m.*`), `providers/index.tsx`
- Layouts: `navigation.ts` (admin entry removed), `badge-context.ts` (bell actions), `Navbar/NotificationButton.tsx`, `Navbar/AvatarMenu.tsx` (role-aware), `layouts/index.ts`, `AppShell.tsx`, `MobileNavDrawer.tsx` (`m.*`)
- UI: `Avatar.tsx` (admin ring), `Drawer.tsx`, `Dropdown.tsx`, `Modal.tsx`, `Tabs.tsx` (`m.*`)
- Auth: `pages/LoginPage.tsx` (OAuth removal + returnTo fix), `components/index.ts`, `i18n/dictionary.ts`, `mock/session-store.ts` (refresh); deleted `components/SocialButtons.tsx`
- Administration: `routes.tsx` (preferences routes), `AdministrationLayout.tsx`, `administration.meta.ts`, `components/AdminCommandBar.tsx`, `components/AdminRail.tsx`, `components/GlobalSearch.tsx`
- Settings: `pages/SettingsPage.tsx` + `components/SettingsNav.tsx` (path-builder), `components/StickySaveBar.tsx` (`m.*`), `settings/index.ts`
- Data layers: `notifications/api/useNotificationsQuery.ts`, `notifications/index.ts`, `messaging/api/useMessagingQueries.ts`
- Dashboard: `dashboard/pages/OverviewPage.tsx` (`m.*`)
- Routes: `src/routes/index.ts` (`preferences` slug)

## Browser Verification

Performed against the dev server in the embedded browser:

- Doctor login → Overview; **admin login → Administration Center directly
  (403 interstitial bug fixed and re-verified from the exact repro)**
- Doctor cannot access admin: `/doctor/administration` renders 403
- Admin sidebar/rail correct incl. My Settings; doctor DOM contains zero
  Administration links or text
- Notification panel (both roles): open, feed, unread badge, mark-one-read,
  mark-all-read, clear-read, doctor-only View-all link, state persisted
- Avatar menu (admin): Profile, Settings, Light/Dark/System with checkmark,
  Sign out → back to /login
- Admin My Settings: `/doctor/administration/preferences/profile` renders
  the identical Settings Center; deep link to `…/preferences/appearance`
  shows the same theme/accent/density cards
- Session persistence across reload; mobile (375×812) doctor shell with
  4-item bottom tab bar (no Administration); desktop and intermediate
  widths exercised during the session
- **Zero console errors** throughout

## Quality Gates

- `tsc -b --noEmit`: **0 errors**
- `eslint .`: **0 errors**, 17 warnings — all pre-existing
  `react-refresh/only-export-components` patterns (HEAD had 19; this phase
  removed two, added none)
- `npm run build`: success, 10.4 s

## Commit Summary

Single commit on `claude/doctor-lab-system-phase-7-c1f15a`:
`Build Phase 19 Performance, Security and Platform Consistency`
