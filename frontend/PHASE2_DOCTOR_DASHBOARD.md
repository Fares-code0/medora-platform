# Phase 2 — Doctor Dashboard Shell & Overview

**Status:** Complete · **Depends on:** `DESIGN_SYSTEM.md` v1.0.0 · `UX_ARCHITECTURE.md` v1.0.0 ·
`FRONTEND_ARCHITECTURE.md` v1.0.0 · `COMPONENT_LIBRARY.md` v1.0.0

This phase delivers the **Doctor Dashboard shell** (FRONTEND_ARCHITECTURE §4) and the
**Overview page** (UX 2.1) on mock frontend data. No other feature, no business logic, no API
integration, and no redesign of the approved documents. Verified: `npm run typecheck` (0 errors) ·
`npm run lint` (0 errors) · `npm run build` (success; Overview ships as its own lazy chunk).

---

## 1. What was built

### App shell — `src/layouts/`

| File | Responsibility |
|---|---|
| `AppShell.tsx` | One shell instance per role tree: sidebar \| (navbar / scrollable outlet). Owns all responsive switching (UX §5.1): `xl+` expanded sidebar (user-collapsible, persisted via the preferences service) · `lg` icon rail · `md` overlay drawer · `<md` bottom tab bar. Route transitions animate only the outlet (UX §4.1); Ctrl/⌘+B toggles the sidebar. |
| `navigation.ts` | **Menu as data**: `NavigationConfig` + `doctorNavigation` (UX §2 sidebar order). Items carry `requiredPermission` (filtered via `useCan`) and `badgeSource` (mock counts until Phase 7). Also defines the `RouteHandle` breadcrumb contract. |
| `Sidebar/AppSidebar.tsx` | Wraps the presentational `ui/Sidebar` with the config: active detection, badge counts, brand header, bottom-pinned Settings · Help · user card. |
| `Navbar/AppNavbar.tsx` | Burger · breadcrumb · global search (collapses to an icon + full-width row below `md`) · AI entry (doctor-only, behind the `aiAssistant` flag) · notification bell · avatar menu. Elevation shadow appears once content scrolls. |
| `Navbar/AppBreadcrumb.tsx` | Breadcrumbs from route handles (`useMatches` + `handle.crumb`) — no per-page breadcrumb code. |
| `Navbar/GlobalSearch.tsx` | Role-scoped search field; Ctrl/⌘+K focuses it. Query execution lands with the search backend. |
| `Navbar/NotificationButton.tsx` | Bell + count badge opening a right panel (Drawer) with the recent feed and "View all". |
| `Navbar/AvatarMenu.tsx` | Profile · Settings · theme switch (Light / Dark / System, persisted) · Sign out. |
| `BottomTabBar.tsx` | `<md` navigation: 4 role-configured slots + "More" (opens the full menu overlay). |
| `MobileNavDrawer.tsx` | `md`-and-below ☰ overlay: native `<dialog>` pinned to the **left** edge containing the full expanded sidebar. (The DS Drawer is right-pinned by spec, so this left-edge shell chrome lives with the shell per §4.) |
| `shell-mock.ts` | **Phase 2 mock** badge counts + bell feed. Phase 7 replaces it with feature-owned query subscriptions (`badgeSource` wiring). |

Supporting addition: `src/hooks/useInternalLinkNavigation.ts` — a document-level click
interceptor that turns the design system's router-agnostic `<a href>` links (SidebarItem,
KpiWidget, LinkButton, Breadcrumb…) into SPA navigations. Mounted once by `AppShell`.

### Overview page — `src/features/doctor/dashboard/`

Standard feature anatomy (§3.4): `index.ts` (public API: route config only) · `routes.tsx`
(lazy chunk + breadcrumb handle) · `pages/OverviewPage.tsx` · `components/` · `model/mock-data.ts`.

Page composition (UX 2.1 grid on `container-2xl`, widgets stagger in per UX §4.2):

1. **Welcome section** — `ContentHeader` with time-of-day greeting, date, and today's summary.
2. **KPI row** — 4× `KpiWidget` (P5): Today's Appointments · Pending Requests · Active Patients ·
   Completed This Week, with deltas, captions, sparklines, and whole-card links.
3. **Today's schedule** (upcoming-appointments placeholder) — `DashboardWidget` timeline rows
   (time · patient · visit type · status); next appointment highlighted `primary-subtle`.
4. **Notifications widget** (placeholder) — status-coded recent items (P8 vocabulary) + View all.
5. **Statistics cards** — 3× `StatisticCard` (consultation duration, response time, no-show rate).
6. **Charts placeholders** — 2× P6 `DashboardWidget` shells (Appointments trend, Patient
   satisfaction) rendering the standard empty pattern until `components/charts` lands.
7. **Recent activity** — reverse-chron feed, each row linking to its source section.
8. **Quick actions** — New Prescription · Open AI Assistant · Message a Patient · Block Time Off.
9. **AI Assistant widget** (placeholder) — accent AI container per the provenance rule (UX 1.5).

### Routing

The `/doctor` branch now renders `AppShell` as its layout route. `/doctor` redirects to
`/doctor/overview`; the dashboard mounts as a lazy feature chunk. Every other doctor section
(`patients`, `appointments`, `assistant`, `labs`, `pharmacy`, `messages`, `notifications`,
`reports`, `settings`) renders an in-shell `DoctorSectionPlaceholder` with a correct breadcrumb —
navigation is honest without building any Phase 7 feature. Admin/auth routes are unchanged.

---

## 2. Mocks & temporary decisions (tracked for later phases)

| Item | Where | Replaced in |
|---|---|---|
| **Mock doctor session** — `AuthProvider` boots authenticated as "Dr. Amira Hassan"; sign-out drops the session (guards then redirect to the login placeholder). Public interface unchanged. | `app/providers/AuthProvider.tsx` | Phase 4 (silent refresh, 2FA, idle lock) |
| Badge counts + bell feed | `layouts/shell-mock.ts` | Phase 7 (`badgeSource` query wiring) |
| Overview data fixtures | `features/doctor/dashboard/model/mock-data.ts` | Phase 7 (feature `api/` query hooks) |
| Doctor section placeholders | `app/router/placeholders.tsx` | Phase 7 feature routes |
| Chart bodies | `ChartPlaceholderWidget` | Phase 5+ (`components/charts` P6 wrappers) |
| Notification popover uses Drawer | `layouts/Navbar/NotificationButton.tsx` | When the DS Popover primitive lands (COMPONENT_LIBRARY §10) |
| Sidebar "Help" item is present but disabled | `layouts/Sidebar/AppSidebar.tsx` | Help center scope TBD |

**Type-level library fix (not a redesign):** `className` on `DashboardWidget`, `Breadcrumb`, and
`Sidebar` widened to `string | undefined` for `exactOptionalPropertyTypes` pass-through,
matching the convention already used across the library (e.g. Badge, SidebarItem). No visual or
behavioral change.

---

## 3. Explicitly not built (per phase scope)

Patients · Patient Profile · Appointments · Medical Records · Labs · Pharmacy · Messages ·
Reports · Settings · Admin Dashboard · Authentication · Backend · API integration · business
logic of any kind. The action-queue decision flows from UX 2.1 (inline accept/reject) are
Phase 7 appointments work and are deliberately absent from the Overview placeholders.
