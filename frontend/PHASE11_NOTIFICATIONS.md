# Phase 11 — Doctor Notifications & Communication Center

Frontend-only implementation of the complete Notifications & Communication
Center at `/doctor/notifications`: a notification inbox (summary cards,
URL-owned search/filters/sort/pagination, bulk actions, detail drawer), a
communication center (colleague chats, announcements, system alerts), per-user
notification preferences, and — the load-bearing integration — **live unread
badges across the entire shell** (navbar bell, sidebar, bottom tab bar) from
one polled TanStack Query cache. No backend; everything runs on a
deterministic mock service over localStorage.

## Routes

| Path | Page | Crumb |
| --- | --- | --- |
| `/doctor/notifications` | `NotificationsPage` (inbox + messages tabs, one lazy chunk) | Notifications |

**URL contract:** `?tab=messages` switches to the communication center;
`?conv=<id>` deep-links a conversation; `?q=&status=&category=&priority=&kind=
&from=&to=&sort=&page=&pageSize=` own the inbox list state (validated on read,
shareable/restorable). The Phase-0 placeholder was retired and
`notificationsRoutes` mounted in `src/app/router/index.tsx`.

## Folder structure

```
src/features/doctor/notifications/
├── api/
│   └── useNotificationsQuery.ts        # List/badges/conversations queries + action
│                                       #   mutations; ONE invalidation root so every
│                                       #   badge updates together
├── components/
│   ├── NotificationSummaryCards.tsx    # Total / Unread / Critical / Today / This week
│   ├── NotificationList.tsx            # Rows: selection, unread emphasis, pin/favorite
│   │                                   #   markers, per-row action menu, states
│   ├── NotificationCells.tsx           # Category icon, priority/kind badges
│   ├── NotificationFiltersDrawer.tsx   # Status/category/priority/type + date range
│   ├── NotificationDetailDrawer.tsx    # Full message, facts, related-entity links,
│   │                                   #   read/unread/archive/delete/pin/favorite
│   ├── NotificationPreferencesDrawer.tsx # Channels, quiet hours, categories
│   └── CommunicationCenter.tsx         # Conversation list + thread + composer
├── hooks/
│   ├── useNotificationListState.ts     # URL-owned q/filters/sort/page/tab/conv state
│   └── useNotificationPreferences.ts   # Per-user persisted preferences
├── mock/
│   └── mock-notification-service.ts    # The swappable "backend"
├── model/
│   ├── types.ts                        # Categories/priorities/kinds/preferences + P8 meta
│   ├── mock-data.ts                    # 64-notification seed + 5 conversations
│   ├── store.ts                        # localStorage boundary (seed + user actions)
│   ├── filters.ts                      # Filter contract + active-chip mapping
│   └── selectors.ts                    # Pure search/filter/sort/summary functions
├── pages/
│   └── NotificationsPage.tsx           # Orchestrator: tabs, bulk bar, dialogs
├── routes.tsx                          # Lazy route object with breadcrumb handle
└── index.ts                            # PUBLIC API: routes + badge/list queries + meta
```

**Touched outside the feature (integration):**

- `src/layouts/badge-context.ts` (new) — domain-free `ShellBadgesContext` +
  `useShellBadges()` with mock-preserving defaults.
- `src/app/router/ShellBadgesProvider.tsx` (new) — app-layer bridge that fills
  the context from the feature's public queries and wraps the doctor AppShell.
- `src/layouts/Navbar/NotificationButton.tsx` — bell count + feed now live
  (loading skeleton, empty state, "View all" link).
- `src/layouts/Sidebar/AppSidebar.tsx`, `src/layouts/BottomTabBar.tsx` — badge
  counts from the context instead of the mock table.
- `src/layouts/shell-mock.ts` — reduced to the admin-only `pendingRequests`
  count; the Phase-2 notification feed mock is gone.
- `src/layouts/index.ts`, `src/app/router/index.tsx` — exports + route mount.

## Architecture

- **The badge seam, done within the boundary rules.** FRONTEND_ARCHITECTURE §4
  reserved `badgeSource` for feature-provided TanStack Query counts, but §1.2
  forbids layouts importing features (lint-enforced). Resolution: layouts own a
  domain-free context (`ShellBadgesContext` — counts plus a presentational
  bell-feed shape); the **app layer** (allowed to import features) provides it
  via `ShellBadgesProvider`. All shell surfaces and the notifications page
  share one query cache, so marking a notification read, opening a
  conversation, or the polled delivery updates the bell, sidebar, and tab bar
  simultaneously.
- **"Realtime" simulation** — the badge query polls every 30 s (+ window
  focus); the mock service delivers one deterministic new notification ~45 s
  after first load (one-shot, flagged in storage), so the unread count visibly
  ticks up everywhere without user action.
- **Inbox** — list rows (not a DataTable: notifications are a feed, not a
  grid) with unread emphasis, pinned-first sorting (newest/oldest/priority),
  checkbox selection with a bulk bar (read/unread/archive/delete), per-row
  menus, "Clear read" (archives all read, with confirmation + toast), search,
  filter drawer with active chips, pagination, and loading/error/empty states.
- **Detail drawer** — full message, timestamp (absolute + relative), sender,
  category, priority, kind, and the related patient/record/lab/prescription/
  appointment. Related links navigate to the patient profile or the matching
  module deep-linked by patient (`?patient=<id>` — the established Phase 7–10
  convention). Opening an unread notification marks it read.
- **Communication center** — conversation list (3 colleagues + announcements +
  system alerts) with unread counts and last-message previews; thread view
  with date-stamped bubbles; composer (Enter to send). Announcement/system
  channels are read-only. Opening a conversation clears its unread count
  (feeding the Messages badge); direct messages get a deterministic auto-reply.
- **Preferences** — five delivery channels, quiet hours (toggle + from/to),
  and per-category opt-ins (security locked on). Persisted under
  `medora.<userId>.notificationPreferences`, which the auth provider's
  `clearUserPreferences` already wipes on logout — the Authentication
  integration falls out of the existing contract.
- **Statuses/priorities** map onto the sanctioned P8 StatusBadge vocabulary;
  category icons/colors are single-sourced in `NOTIFICATION_CATEGORY_META` and
  reused by the list, drawer, and navbar bell.

## Components used (existing only)

`StatisticCard`, `FilterBar`, `SearchBar`, `StatusBadge`, `Fact`/`FactGrid`,
`Badge`, `CountBadge`, `Avatar`, `Button`, `IconButton`, `LinkButton`,
`Checkbox`, `Select`, `Switch`, `Input`, `Textarea`, `Drawer`, `Dropdown`,
`ConfirmationDialog`, `Tabs`, `Pagination`, `Breadcrumb`, `Card`, `Tooltip`,
`Alert`, `EmptyState`, `ErrorState`, `Skeleton`, plus `ContentHeader` /
`PageContainer` / `Stack` / `Grid` / `Section`, the `useDisclosure` /
`useMediaQuery` hooks, and the `utils/dates` formatters. No new UI primitives,
no inline styles, no hardcoded colors.

## Mock service & data model

`mock/mock-notification-service.ts` is the swappable backend (async, ~120–450 ms
latency, over the localStorage store seeded on first run):

- **Notifications** — fetch, patch-by-ids (read/archive/favorite/pin — single
  and bulk share one endpoint shape), delete, archive-all-read.
- **Badges** — `fetchBadgeCounts` (notifications unread + messages unread),
  polled by the shell; both fetches run the one-shot delivery check.
- **Conversations** — fetch, mark-read, `sendMessage` with a deterministic
  auto-reply. **Failure simulation:** messages containing `[fail]` (and a
  stable ~8 % hash bucket) throw on the FIRST attempt only, so the error alert
  + Retry demonstrably succeeds.

Seed: 64 deterministic notifications (seeded PRNG over 12 templates across all
8 categories, related entities drawn from the shared patient roster with
module-coherent id formats; ~every 9th is minutes old so "Today" stays
populated at any wall-clock time) and 5 conversations. Strongly-typed models:
`DoctorNotification`, `NotificationRelated`, `Conversation`, `ChatMessage`,
`NotificationPreferences`, `NotificationBadgeCounts`.

## Future API integration points

| Seam | Today | Later phase |
| --- | --- | --- |
| `mock-notification-service.ts` | localStorage CRUD + canned chat | Notification/message endpoints; patch/bulk shapes map 1:1 |
| Badge polling (`refetchInterval`) | 30 s poll + one-shot demo delivery | WebSocket/SSE push invalidating the same query key |
| `model/store.ts` + seed | Browser persistence | Server-side storage; seed deleted |
| Related-entity links | `?patient=` deep links into modules | Canonical detail-page links once ids resolve server-side |
| Preferences | Per-user localStorage | User-preferences endpoint; same shape |

## Verification

`npm run typecheck`, `npm run lint` (0 errors; the 14 react-refresh warnings
are pre-existing and accepted), and `npm run build` all pass. Manually driven
in the browser on the running app: auth-guarded entry; all five summary cards
populated; the navbar bell showing the LIVE unread count (15, not the old mock
5) and dropping to 14 the moment a notification was opened (shared-cache
integration); detail drawer with sender/category/patient facts and the full
action set; Messages tab — opening a conversation cleared its unread count
(tab badge 4 → 2), sending produced the deterministic auto-reply, and a
`[fail]` message showed the error alert with a Retry that succeeded;
preferences drawer (14 switches) persisting to the per-user storage key; URL
state (`?tab=messages&conv=conv-omar`) restored on reload.

## Out of scope (per Phase 11 brief)

No backend, no real push/email/SMS delivery (preferences are honored by a
future server), no PHI in storage. `/doctor/messages` remains a placeholder
route — the communication center lives in this page's Messages tab; the nav
Messages badge already reflects its live unread count.
