# Medora Frontend Architecture

**Version 1.0.0** · **Status:** Draft for approval · **Owners:** Frontend Platform Team
**Depends on:** `DESIGN_SYSTEM.md` v1.0.0 · `UX_ARCHITECTURE.md` v1.0.0
**Stack:** React 18 · TypeScript (strict) · Vite · TailwindCSS · React Router · TanStack Query · React Hook Form · Zod · Framer Motion · Lucide

This document defines *how* Medora's frontend is built — structure, boundaries, contracts, and order of work. It contains no application code; short type and configuration sketches appear only where they define an architectural contract. Nothing here redesigns anything from the two approved documents.

---

## Table of Contents

1. [Architectural Principles](#1-architectural-principles)
2. [Project Folder Structure](#2-project-folder-structure)
3. [Feature Architecture](#3-feature-architecture)
4. [Application Shell](#4-application-shell)
5. [Routing Architecture](#5-routing-architecture)
6. [Authentication Architecture](#6-authentication-architecture)
7. [State Management](#7-state-management)
8. [Component Architecture](#8-component-architecture)
9. [TypeScript Architecture](#9-typescript-architecture)
10. [API Layer](#10-api-layer)
11. [Theme Architecture](#11-theme-architecture)
12. [Security Considerations](#12-security-considerations)
13. [Development Workflow](#13-development-workflow)

---

# 1. Architectural Principles

1. **Feature modules own their domain; the platform owns everything cross-cutting.** A feature (e.g., `appointments`) contains its routes, queries, components, and types. Shell, design-system UI, auth, API client, and theming are platform layers features consume but never modify.
2. **Dependency direction is one-way:** `app → features → shared platform (components/lib/api/types)`. Features never import from other features (§3.3 defines the escape hatch). Shared layers never import from features. Enforced by ESLint (`import/no-restricted-paths`).
3. **The URL is the source of truth for view state.** Tabs, filters, pagination, and calendar ranges live in search params (contract already defined in UX 1.3). Server state lives in TanStack Query. Almost nothing lives in global stores (§7).
4. **Contracts before code.** Status machines, roles, permissions, and API shapes are typed once in shared contract files; badges, guards, filters, and services all derive from them. A status can't exist in the UI that doesn't exist in the type.
5. **Fail closed on safety paths.** Anything UX_ARCHITECTURE marks safety-critical (prescription interaction checks, AI context binding, critical-lab review) is implemented pessimistically: no optimistic UI, explicit blocked states, no silent fallbacks.
6. **Every screen is one of the UX patterns.** P1–P8 from UX 1.4 exist as reusable pattern components (§8.2); pages compose patterns rather than invent layouts.

---

# 2. Project Folder Structure

```
medora/
├── index.html
├── vite.config.ts
├── tsconfig.json                  # strict: true, path aliases (@/*)
├── tailwind.config.ts             # reads CSS variables (DS §12.2)
├── .env.example                   # documented env contract; never committed secrets
├── public/                        # favicons, manifest, robots
└── src/
    ├── app/                       # Application core — composition root
    │   ├── App.tsx                # provider stack + router mount
    │   ├── providers/             # QueryProvider, ThemeProvider, AuthProvider,
    │   │                          #   MotionProvider (reducedMotion="user"), ToastProvider
    │   ├── router/                # route tree assembly, guards, lazy boundaries (§5)
    │   └── error-boundary/        # root + route-level error boundaries (DS 8.33 pages)
    │
    ├── features/                  # Feature modules (§3) — the bulk of the codebase
    │   ├── auth/
    │   ├── doctor/                # doctor-only features (§3.1)
    │   ├── admin/                 # admin-only features (§3.2)
    │   └── shared-domain/         # cross-role domain features (§3.3)
    │
    ├── components/                # Design-system implementation — app-agnostic
    │   ├── ui/                    # atomic components: Button, Input, Modal, Table… (DS §8)
    │   ├── patterns/              # P1–P8 pattern components (DataTablePage, DetailPage,
    │   │                          #   RecordDrawer, ConfirmWithReason, KpiCard, ChartWidget…)
    │   ├── feedback/              # Toast host, Alert, EmptyState, ErrorState, Skeletons
    │   └── charts/                # chart primitives wrapping the chart lib w/ DS theming
    │
    ├── layouts/                   # App shell (§4): AppShell, Sidebar, Navbar, PageHeader,
    │                              #   SettingsLayout, AuthLayout, BottomTabBar
    │
    ├── routes/                    # Route path constants + typed path builders
    │                              #   (single source for every href in the app)
    │
    ├── hooks/                     # Generic reusable hooks only (useDebounce, useMediaQuery,
    │                              #   useUrlState, useIdleTimer, useDisclosure)
    │
    ├── services/                  # Frontend domain services that are not React:
    │                              #   audit dispatcher (§12), notification sound policy,
    │                              #   file download/export helpers, session lock service
    │
    ├── api/                       # API layer (§10): client, interceptors, error normalization,
    │   ├── client.ts              #   endpoints registry, query-key factory, mock adapter
    │   ├── query-keys.ts
    │   ├── errors.ts
    │   └── endpoints/             # per-domain endpoint definitions (no components here)
    │
    ├── types/                     # Global contracts (§9): domain models, enums/unions,
    │   ├── domain/                #   api envelope types, roles & permissions
    │   ├── api/
    │   └── auth/
    │
    ├── utils/                     # Pure functions: date/format/mask/validation helpers.
    │                              #   No React, no side effects, 100% unit-testable
    │
    ├── constants/                 # App constants: status metadata maps (status → badge
    │                              #   variant/label/icon), table page sizes, limits
    │
    ├── configs/                   # Runtime config: env parsing (Zod-validated), feature
    │                              #   flags, query-client defaults, idle-lock policy values
    │
    ├── assets/                    # Fonts (Inter variable, JetBrains Mono), logos,
    │                              #   illustrations for empty/error states
    │
    └── styles/                    # tokens.css (DS §12.1 verbatim), globals.css
                                   #   (reset, focus-visible rules, scrollbars)
```

**Responsibility rules per folder**

| Folder | Owns | Must never contain |
|---|---|---|
| `app/` | Provider composition, router mounting, global boundaries | Business logic, UI beyond boundaries |
| `features/` | Everything domain-specific: pages, feature components, queries, feature types | Direct imports from another feature |
| `components/` | Design-system and pattern components, fully prop-driven | API calls, route knowledge, domain imports |
| `layouts/` | Shell chrome and page scaffolding | Feature logic; menus are *configured*, not hardcoded per role here |
| `routes/` | Path strings + builders (`routes.doctor.patient(id)`) | Components |
| `hooks/` | Generic hooks usable by any feature | Domain-specific hooks (those live in their feature) |
| `services/` | Framework-free logic with side effects | React imports |
| `api/` | Transport, errors, caching infrastructure | Feature-specific data massaging (belongs in feature `api/` files) |
| `types/` | Cross-feature contracts only | Types used by a single feature |
| `utils/` | Pure helpers | Anything stateful |
| `constants/` | Enumerated UI metadata | Logic |
| `configs/` | Environment & tuning values | Hardcoded secrets (none exist client-side) |
| `styles/` | Token CSS + global CSS | Component styles (Tailwind classes live with components) |

---

# 3. Feature Architecture

## 3.1 Doctor Feature Modules

Mapping UX_ARCHITECTURE §2 one-to-one:

```
features/doctor/
├── dashboard/          # UX 2.1  Overview: KPI row, schedule timeline, action queue
├── patients/           # UX 2.2  Patient list & search
├── medical-records/    # UX 2.3  Patient profile + all record tabs (history, visits,
│                       #         imaging, documents, notes) — owns the record viewer
├── appointments/       # UX 2.4  Views, decision flows, emergency unavailability
├── ai-assistant/       # UX 2.5  Chat workspace, context binding, review-before-save
├── labs/               # UX 2.6  Inbox, results, trends, attach-to-record
├── pharmacy/           # UX 2.7  Prescriptions, safety-screened flow, med database
├── messages/           # UX 2.8  Inbox, threads, composer
├── notifications/      # UX 2.9  Feed page + bell popover data
├── reports/            # UX 2.10 Practice analytics
└── settings/           # UX 2.11 Six settings sections
```

## 3.2 Admin Feature Modules

Mapping UX_ARCHITECTURE §3:

```
features/admin/
├── dashboard/          # UX 3.1  Overview, security banner, system health
├── doctors/            # UX 3.2 + 3.3  Management table, verification, admin profile
├── patients/           # UX 3.4  Account governance, permissions grid
├── appointments/       # UX 3.5  Monitoring, nudge/reassign flows
├── communications/     # UX 3.6  Aggregates, metadata logs, gated content access, flags
├── system-logs/        # UX 3.7  Audit investigation surface
├── reports/            # UX 3.8  Platform analytics
└── settings/           # UX 3.9  Six admin settings sections
```

## 3.3 Shared Domain Modules

Some domain logic is used by both roles and by multiple doctor features. It lives in `features/shared-domain/` and may be imported by any feature (it is the *only* feature-level import exception):

```
features/shared-domain/
├── patient-identity/   # PatientHeader, AllergyStrip, masked-identity components + reveal flow
├── conversations/      # Conversation/ChatMessage/Contact model, seed, and the
│                       #   medora.messaging.v1 store — read by the doctor inbox (2.8)
│                       #   and admin communication monitoring (3.6)
├── audited-access/     # Expiring, justified, categorised access grants — the gate
│                       #   behind ADM-10 PHI reveals and ADM-06 content access
├── appointment-core/   # Appointment status machine, transition rules, status metadata
├── scheduling/         # Availability grid, slot picker (used by 2.4 flows and settings)
└── audit/              # useAuditedAction hook wrapping the audit dispatcher (§12)
```

## 3.4 Anatomy of a Feature Module

Every feature follows the same internal layout — discoverability across 19 modules matters more than per-module optimality:

```
features/doctor/appointments/
├── index.ts            # PUBLIC API: exports routes config + anything intentionally shared
├── routes.tsx          # feature route objects (lazy), consumed by app/router
├── pages/              # route-level components (compose patterns + feature components)
├── components/         # feature-specific components (AppointmentDecisionBar, SlotPicker…)
├── api/                # endpoint functions + TanStack Query hooks (useAppointmentsQuery,
│                       #   useAcceptAppointmentMutation) + query keys for this domain
├── model/              # feature types, Zod schemas, status machine, mappers (DTO → model)
├── hooks/              # feature hooks (useAppointmentFilters — URL state binding)
└── __tests__/
```

**Isolation rules (enforced by lint):**
1. Cross-feature imports go through `index.ts` public APIs only — and only from `shared-domain`. If two features need the same thing, it moves down to `shared-domain`, `components/`, or `types/`; features never reach into each other.
2. A feature's pages are reachable only via the router; no feature renders another feature's pages.
3. Feature state never leaks: no feature-owned context consumed outside the feature.
4. Deleting a feature folder must break nothing except its routes — the test for correct isolation.

---

# 4. Application Shell

Implements UX 1.2 exactly; all measurements/tokens from the Design System.

```
layouts/
├── AppShell.tsx        # grid: sidebar | (navbar / page outlet); owns responsive switching
├── Sidebar/            # nav sections from a role-based MENU CONFIG (not hardcoded JSX),
│                       #   collapse state (persisted per user), badge count subscriptions
├── Navbar/             # burger, breadcrumbs, GlobalSearch (⌘K), AI entry (doctor only),
│                       #   NotificationBell popover, AvatarMenu (theme toggle, sign out)
├── PageHeader.tsx      # h1 + caption + actions slot (max 1 primary + 2 secondary + ⋯)
├── PageContainer.tsx   # container-2xl | container-xl variants + responsive padding
├── BottomTabBar.tsx    # <md navigation: 5 role-configured slots + "More" sheet
├── SettingsLayout.tsx  # left section nav + container-md form area (UX 2.11 / 3.9)
└── AuthLayout.tsx      # centered container-sm card for public auth pages
```

**Key architectural decisions**

- **Menu as data.** Sidebar and BottomTabBar render from a `NavigationConfig` object per role (`label, icon, path, requiredPermission, badgeSource`). Adding a nav item is a config change; permissions filter items automatically (§6.5).
- **Breadcrumbs from route handles.** Each route object carries a `handle.crumb` (static label or resolver from loaded data, e.g. patient name). The Breadcrumb component walks `useMatches()` — no per-page breadcrumb code.
- **Badge counts** (Messages, Notifications, Pending) come from lightweight TanStack Query polling queries owned by their features and *exposed through their public API*; the shell subscribes via the menu config's `badgeSource`.
- **One shell instance.** Route transitions swap only the outlet (UX 4.1: shell never re-animates). The shell is rendered by the role layout route (§5), so doctor/admin differences are pure configuration.
- **Responsive behavior** per UX 5.1: `xl+` expanded sidebar · `lg` icon rail · `md` overlay drawer · `<md` bottom tab bar. Implemented centrally in `AppShell` with a `useBreakpoint` hook; features never write their own shell media queries.

---

# 5. Routing Architecture

## 5.1 Route Tree

React Router (data router, `createBrowserRouter`). Paths come exclusively from `routes/` constants — no string literals in components.

```
/                         → redirect by session: /doctor | /admin | /login
/login                    PUBLIC  (AuthLayout)
/forgot-password          PUBLIC
/reset-password           PUBLIC
/session-locked           PUBLIC-ish (re-auth screen, preserves location)

/doctor                   PROTECTED role="doctor"   (AppShell + doctor nav config)
  overview | patients | patients/:patientId | appointments | assistant |
  labs | labs/:reportId | pharmacy/* | messages/* | notifications |
  reports | settings/:section        # per UX 1.3, incl. all search-param contracts

/admin                    PROTECTED role="admin"    (AppShell + admin nav config)
  overview | doctors | doctors/:doctorId | patients | patients/:patientId |
  appointments | communications | logs | reports | settings/:section

*                         → 404 page (DS 8.33)
/403                      → unauthorized page
```

## 5.2 Guards

Three composable layers, implemented as layout routes (not per-page checks):

| Guard | Level | Behavior |
|---|---|---|
| `RequireAuth` | wraps both role trees | No valid session → redirect to `/login?returnTo=…`. Session expired mid-use → session-lock flow (§6.4). |
| `RequireRole(role)` | wraps `/doctor` and `/admin` | Authenticated but wrong role → `/403`. Users holding both roles pass both trees; role switcher in AvatarMenu. |
| `RequirePermission(cap)` | wraps sensitive leaf routes (e.g. `/admin/communications` content views) | Missing capability → `/403` with the specific missing capability named for support. |

Guards are UX only — the server re-enforces every rule (§12.1).

## 5.3 Lazy Loading Strategy

- **Split by feature, not by page.** Each feature's `routes.tsx` is a dynamic import boundary (`lazy` on the feature route object) → one chunk per feature, ~19 chunks + shell.
- The shell, design-system components, and auth load eagerly in the entry chunk; everything else streams in.
- **Prefetch on intent:** hovering/focusing a sidebar item triggers the chunk prefetch for that feature; the role's `overview` feature is preloaded immediately after login.
- Every lazy boundary renders the DS skeleton pattern for its page type (never a blank screen) and is wrapped by a route-level error boundary offering Retry (a failed chunk load — common on hospital networks after a deploy — must recover without a manual hard refresh; retry re-imports, and a version-mismatch triggers the "new version available" reload prompt).

---

# 6. Authentication Architecture

Frontend architecture only; the backend contract is described as requirements.

## 6.1 Flow

```
Login page → credentials (RHF + Zod) → POST /auth/login
  ├─ success + 2FA disabled → session established → redirect returnTo | role home
  ├─ 2FA required → TOTP step (same page, step 2) → POST /auth/2fa → session
  └─ failure → inline error (no user-existence disclosure), rate-limit message passthrough
```

Forgot/reset password follow standard token-link flows (public pages listed in §5.1).

## 6.2 Token Handling

- **Access token: in memory only** (module-scoped variable inside the auth service). Never in `localStorage`/`sessionStorage` — XSS must not be able to exfiltrate a credential at rest (§12.4).
- **Refresh token: `httpOnly; Secure; SameSite=Strict` cookie** set by the backend. JavaScript never sees it.
- On app boot: silent refresh (`POST /auth/refresh`) rehydrates the in-memory access token; until it resolves, the router shows the boot splash (DS 8.32 full-app bootstrap pattern).
- The API client attaches the access token via interceptor; a `401` triggers **one** queued refresh (concurrent requests wait on the same refresh promise), then replays; refresh failure → hard logout (§6.4).

## 6.3 Session Model

`AuthProvider` exposes exactly: `status ('booting' | 'authenticated' | 'unauthenticated' | 'locked')`, `user (id, name, role, permissions[])`, and actions (`login, verify2fa, logout, lock, unlock`). Consumers use `useAuth()` / `useCan()` — no component touches tokens.

## 6.4 Session Lifecycle & Logout

| Event | Behavior |
|---|---|
| Idle ≥ policy (default 10 min, admin-configurable — UX 1.5) | `useIdleTimer` → state `locked`: blur overlay + re-auth dialog; unsaved form state preserved in memory; unlock = password / passkey re-entry |
| Absolute session timeout | Forced logout with "Session ended" notice on the login page |
| Manual logout | `POST /auth/logout` (revokes refresh cookie server-side) → clear in-memory token → **clear TanStack Query cache completely** (PHI must not survive logout) → clear per-user UI prefs from storage → redirect `/login` |
| Refresh failure / revoked session (e.g. admin revoked in Settings → Security) | Same cache-clearing logout, with `returnTo` preserved |
| Multi-tab | BroadcastChannel syncs logout/lock across tabs instantly |

## 6.5 Permission Model

Two layers, matching UX 3.9 (roles & permissions matrix):

```ts
type Role = 'doctor' | 'admin';                      // coarse: route trees, shell config
type Permission =                                     // fine: capabilities from the matrix
  | 'appointments.reassign' | 'communications.viewContent'
  | 'patients.revealIdentity' | 'logs.export' | ...;

// usage contract:
const can = useCan();            // can('communications.viewContent') → boolean
<Guarded permission="logs.export"> …button… </Guarded>
```

Permissions arrive with the session payload and are static per session (re-login applies changes). UI hides or disables what the user cannot do — per UX: hide entire sections, disable-with-tooltip for contextual actions. Every permission string exists in one union type; guards, menus, and buttons all reference it.

---

# 7. State Management

**Principle: there is no general-purpose global store.** Each kind of state has exactly one designated home; adding Redux/Zustand requires an architecture decision record proving none of these fit.

| State kind | Home | Examples | Rules |
|---|---|---|---|
| **Server state** | TanStack Query | Patients, appointments, labs, logs, notifications | The only cache of backend data. No copying query data into local state; derive in render or `select`. |
| **URL state** | Search params (`useUrlState` hook wrapping `useSearchParams` + Zod param schema) | Tabs, filters, sort, page, calendar view/date, drawer-open record id | Anything a user would expect a shared link or Back button to restore. Feature hooks (e.g. `useAppointmentFilters`) own their param schema. |
| **Form state** | React Hook Form + Zod resolver | Settings forms, prescription stepper, reject-reason modals | Never mirrored elsewhere; multi-step flows keep one form instance across steps (2.7 stepper). Dirty state drives Save-enabled + unsaved-changes guards. |
| **Local UI state** | `useState` / `useReducer` | Open/closed disclosure, hover, composer draft, wizard step index | Default choice; lift only when a second component genuinely needs it. |
| **App-level cross-cutting state** | Context (few, purpose-built) | `AuthProvider`, `ThemeProvider`, `ToastProvider`, `BreakpointProvider` | Each context is small, stable-valued, and single-purpose. No "AppContext" grab-bag. |
| **Persisted UI prefs** | `localStorage` via a typed `preferences` service | Sidebar collapsed, theme choice, table density, saved views (P7) | Namespaced per user id; cleared on logout; **never PHI** (§12.5). |

**Real-time-ish data** (badge counts, active-users KPI, notification feed): TanStack Query polling with `refetchInterval`, upgraded to WebSocket/SSE invalidation later without changing consumers — components only know query hooks.

---

# 8. Component Architecture

## 8.1 Three Tiers

```
Tier 1  components/ui — ATOMIC (design system primitives)
        Button, Input, Textarea, Select, Checkbox, Radio, Switch, Badge, Chip,
        Avatar, Tooltip, Popover, DropdownMenu, Modal, Drawer, Card, Table,
        Tabs, Accordion, Alert, Toast, Progress, Skeleton, Pagination,
        Breadcrumb, SearchInput, DatePicker, Calendar   (DS §8, exact specs)
        → Know nothing about Medora. Prop-driven, token-styled, fully accessible.
        → Variants via a variant utility (cva-style) mapping to DS tokens only.

Tier 2  components/patterns — COMPOSITE (UX 1.4 patterns + recurring assemblies)
        DataTablePage (P1), DetailPage (P2), RecordDrawer (P3),
        ConfirmWithReasonModal (P4), KpiCard (P5), ChartWidget (P6),
        SavedViews (P7), StatusBadge (P8 vocabulary),
        EmptyState / ErrorState / LoadingState, FilterDrawer, BulkActionBar
        → Know UX patterns, not domains. Receive columns/config/data as props.

Tier 3  features/**/components — FEATURE components
        PatientCard, AppointmentCard, AppointmentDecisionBar, ScheduleTimeline,
        StatisticsWidget grids, MedicalRecordViewer, AllergyStrip*, LabTrendChart,
        PrescriptionSafetyPanel, AiMessageBubble, VerificationChecklist,
        AuditEventDetail…      (*shared-domain when multi-feature)
        → Know their domain. Compose Tiers 1–2. Fetch via their feature's hooks.
```

## 8.2 Ownership Rules

1. **Promotion by rule of three:** a component starts in its feature; the third feature needing it moves it to `shared-domain` (domain-aware) or `components/patterns` (domain-free, props-only). Never copy-paste a second variant.
2. **Tier 1–2 components are pure:** no data fetching, no router imports (patterns accept callbacks/links as props), no domain types — generic over row/entity types.
3. **Pages own composition:** a `pages/` file wires pattern + feature components + query hooks; it contains layout and orchestration, not reusable UI.
4. **One component, one file, colocated tests/stories.** PascalCase files; component workbench (Storybook/Ladle) stories are the acceptance artifact for Tier 1–2 (every DS state: hover/focus/disabled/loading/error, light+dark).
5. **Class-based domain models, functional UI.** OOP applies at the model layer (§9.3) — entities with status-machine methods (`appointment.canTransitionTo(s)`). React components remain functions; no class components.

---

# 9. TypeScript Architecture

## 9.1 Organization

```
types/
├── domain/        # Patient, Doctor, Appointment, Prescription, LabReport,
│                  #   Conversation, AuditEvent, Notification — cross-feature models
├── api/           # envelope & infra types: ApiResponse<T>, Paginated<T>,
│                  #   ApiError, QueryParams contracts
└── auth/          # Role, Permission, SessionUser
features/**/model/ # types used by exactly one feature live in the feature
```

`tsconfig` is `strict: true` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. No `any` (lint error); `unknown` + narrowing at boundaries.

## 9.2 Conventions

| Concern | Convention |
|---|---|
| Entity ids | Branded types: `type PatientId = string & { __brand: 'PatientId' }` — makes `attachReport(labId, patientId)` argument swaps a compile error (a real clinical-safety class of bug). |
| Statuses | **String-literal unions, not TS enums** (`type AppointmentStatus = 'requested' \| 'pending' \| 'confirmed' \| 'awaiting_patient' \| 'completed' \| 'cancelled' \| 'no_show'`). Serializable, narrowable, no enum runtime artifacts. Each union pairs with a `constants/` metadata map (label, badge variant, icon) — P8 vocabulary derives from it. |
| Status machines | Transition maps typed as `Record<Status, readonly Status[]>` in `shared-domain`; UI action availability derives from the map, so an illegal transition button cannot be rendered. |
| Interfaces vs types | `interface` for object shapes intended for extension (domain entities); `type` for unions, functions, and composition. |
| Discriminated unions for variant data | e.g. `Notification = { category: 'lab'; reportId } \| { category: 'appointment'; appointmentId } \| …` — exhaustive `switch` with `never` check. |
| API response types | DTO types (`api/`) are distinct from domain models; feature `model/mappers.ts` converts DTO → model in exactly one place. Backend field renames touch one file. |
| Form schemas | Zod schemas are the source of truth: `const rxSchema = z.object(…)`; `type RxFormValues = z.infer<typeof rxSchema>` — validation and types cannot drift. Runtime-validate at boundaries: API responses (dev-mode strict, prod log-and-tolerate), env config (fail fast), URL params (fallback to defaults). |
| Roles & permissions | `Role` and `Permission` unions in `types/auth` (§6.5); the permission matrix type in admin settings derives from the same union. |

## 9.3 Domain Model Layer (OOP boundary)

Where behavior clusters around an entity, a class wraps the plain data:

```ts
class AppointmentModel {
  constructor(readonly data: Appointment) {}
  canTransitionTo(s: AppointmentStatus): boolean { … }   // from the transition map
  get isActionableByDoctor(): boolean { … }
  get ageInState(): Duration { … }                        // UX 3.5 intervention signal
}
```

Rules: models are immutable wrappers created in query `select`/mappers; they contain domain logic only (no fetching, no React); plain `data` remains available for serialization. This is the "OOP where applicable" boundary — nowhere else.

---

# 10. API Layer

## 10.1 Structure

```
api/
├── client.ts        # fetch-based ApiClient class: baseURL from config, JSON handling,
│                    #   auth header injection, 401→single-flight refresh→replay,
│                    #   timeout + AbortController, correlation-id header per request
├── errors.ts        # error normalization → ApiError discriminated union
├── query-keys.ts    # global key factory conventions
├── endpoints/       # thin typed endpoint functions per domain, e.g.
│                    #   appointments.list(params): Promise<Paginated<AppointmentDto>>
└── mock/            # dev adapter: same endpoint signatures served from fixtures
                     #   (MSW) — enables full frontend build before any backend exists
```

Features consume endpoints only through their own `api/` query hooks; components never call the client.

## 10.2 Error Handling Contract

All failures normalize to one union before leaving the API layer:

```ts
type ApiError =
  | { kind: 'validation'; fieldErrors: Record<string, string[]> }  // → RHF setError
  | { kind: 'auth' }               // → session flow (§6.4), never rendered inline
  | { kind: 'forbidden' }          // → 403 pattern / disabled affordance
  | { kind: 'not_found' }
  | { kind: 'conflict'; detail }   // → merge dialogs (UX 3.9), stale-data refetch
  | { kind: 'rate_limited'; retryAfter }
  | { kind: 'network' }            // offline/timeout → retryable
  | { kind: 'server'; ref }        // ref = support reference shown per DS 8.33
```

Rendering rules map 1:1 to UX/DS error states: queries → section/widget `ErrorState` with Retry; mutations → persistent error toast + rollback; validation → field-level via RHF. A global `QueryCache.onError` handles `auth` and logs; everything else is handled where the UX spec says it surfaces.

## 10.3 TanStack Query Conventions

| Concern | Convention |
|---|---|
| Keys | Factory per domain: `keys.appointments.list(filters)`, `keys.appointments.detail(id)` — filters object serialized stably; keys mirror URL params (UX 1.3) so navigation == cache addressing. |
| Defaults | `staleTime` 30s reads; `retry`: 2 for `network`, 0 for 4xx; `refetchOnWindowFocus: true` (multi-tab clinical reality). |
| Per-domain tuning | Volatile (notifications, action queue, active-users): 10–15s polling. Stable (med database, settings): minutes. Audit logs: `staleTime 0`, keepPreviousData for pagination. |
| Optimistic updates | Only where UX explicitly specs rollback (accept/reject appointment, mark-read, message send). **Prohibited** on safety-critical writes: prescriptions, critical-lab review, permission changes — these are pessimistic with blocking loading states (UX fail-closed rules). |
| Invalidation | Mutations invalidate by key-factory prefix; cross-domain effects (appointment accept → dashboard action queue) via explicit invalidation lists in the mutation, not global events. |
| Loading states | Map DS 8.32: `isPending` → skeletons; `isFetching && !isPending` → 2px top bar (background refresh keeps stale data visible); mutation `isPending` → button spinner. |
| Cache & PHI | Cache lives in memory only — **no** query persistence plugin (PHI on disk is forbidden, §12.5); full `queryClient.clear()` on logout/lock. |

---

# 11. Theme Architecture

Implements DS §12 with zero new design decisions.

- **`styles/tokens.css`** contains the DS §12.1 CSS verbatim: semantic variables on `:root`, dark overrides under `.dark`. **`tailwind.config.ts`** maps utilities to those variables per DS §12.2. Components use only semantic classes (`bg-surface`, `text-text-secondary`); raw palette/arbitrary hex blocked by ESLint.
- **`ThemeProvider`** (in `app/providers`): state `'light' | 'dark' | 'system'`; resolves `system` via `matchMedia('(prefers-color-scheme: dark)')` with live listener; applies/removes `.dark` on `<html>`; persists choice per user via the preferences service; exposes `useTheme()` consumed by the AvatarMenu toggle and Settings → Appearance.
- **No-flash boot:** an inline `<head>` script reads the stored preference and sets `.dark` before first paint.
- **Charts and Framer Motion** read colors from CSS variables at render (chart theming wrapper in `components/charts`), so theme switching requires no JS re-theming beyond a re-render.
- Admin "default theme for new users" (UX 3.9) is a server-provided default consumed on first login; user override wins thereafter (when policy allows).

---

# 12. Security Considerations

Frontend controls complement — never replace — server enforcement.

1. **Permission enforcement in depth.** Route guards (§5.2) + `useCan()`/`<Guarded>` at the action level + menu filtering (§4). The client treats its own checks as UX; every request is re-authorized server-side. Sensitive UI (reveal identity, view message content) additionally requires the justification flows from UX 1.5/3.6 before the request is even made.
2. **Sensitive data handling.** Masked-by-default rendering for PHI in admin contexts via `patient-identity` components; reveal actions dispatch audit events (§12.6). No PHI in URLs (ids only, never names/MRNs in query strings), no PHI in error logs or telemetry, no PHI in document titles (generic titles on clinical routes).
3. **Session expiration.** Idle lock + absolute timeout + multi-tab sync per §6.4; query cache cleared on lock *and* logout so a walked-away workstation exposes nothing after the blur overlay.
4. **XSS prevention.** React escaping everywhere; `dangerouslySetInnerHTML` is lint-banned (the rich-text note viewer renders through a sanitizer whitelist — the single audited exception). Strict CSP (no `unsafe-inline` scripts; the theme boot script is nonce'd/hashed). All user/AI content rendered as text nodes. File uploads/downloads go through the files service (type/size validation, `Content-Disposition` respect, no blob-URL persistence).
5. **Secure storage rules.** Tokens: memory + httpOnly cookie only (§6.2). `localStorage` restricted to the typed preferences service: UI prefs only, per-user namespaced, wiped on logout. **Never stored client-side:** PHI, tokens, permissions, drafts containing clinical text (composer drafts are memory-only; explicit "Save draft" goes to the server).
6. **Auditability.** `services/audit` dispatcher (UX 1.5 / implementation note 6): every UX-flagged action (`reveal`, content access, safety-check acknowledgment, export) sends a structured audit event through one choke point; features call `useAuditedAction(action, meta)` rather than logging ad hoc.
7. **Supply chain & headers.** Dependency audit in CI, lockfile-only installs, SRI for any static third-party assets (goal: none — fonts self-hosted per DS). Recommended headers documented for deployment: CSP, `frame-ancestors 'none'`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` minimal.

---

# 13. Development Workflow

## 13.1 Implementation Order

Phases are strictly ordered; each has a verifiable exit criterion. This expands UX §7 note 7.

| Phase | Work | Exit criterion |
|---|---|---|
| **0. Project setup** | Vite + React + TS strict; path aliases; ESLint (incl. boundary + token rules) + Prettier; Vitest + Testing Library; CI (typecheck, lint, test, build); folder skeleton | `pnpm build` green in CI on the empty skeleton |
| **1. Tokens & theme** | `tokens.css` + Tailwind mapping (DS §12); ThemeProvider + no-flash boot; fonts self-hosted | Theme toggle flips a token test page correctly, both modes |
| **2. Design-system core (Tier 1)** | Build order: Button, Input, Card, Badge, Modal (DS governance §13 order), then remaining DS §8 atoms; workbench stories for every state, light+dark, axe checks | All Tier 1 components pass story + a11y review |
| **3. App shell & routing** | Layouts (§4), route tree + guards + lazy boundaries (§5), routes constants, 403/404/error boundaries, breadcrumb system | Navigable empty app: both role shells, responsive per UX 5.1 |
| **4. Auth** | AuthProvider, login/2FA/reset pages, token/refresh handling against MSW mocks, idle lock, logout cache-clearing, `useCan` | Full auth lifecycle works against mocks incl. lock + multi-tab |
| **5. Pattern components (Tier 2)** | P1–P8 + state components (§8.1 Tier 2) with URL-state hooks | A demo DataTablePage with filters/sort/pagination/saved views runs against mock data |
| **6. API layer** | Client, errors, query-key factory, MSW fixture suite for all domains | Contract tests: every endpoint mock validates against Zod DTO schemas |
| **7. Doctor features** | Order: appointments → patients + medical-records → labs → pharmacy → ai-assistant → messages → notifications → dashboard (composes others' queries) → reports → settings | Each feature: pages complete with all UX states (empty/loading/error), tests green |
| **8. Admin features** | Order: dashboard → doctors → system-logs → appointments → patients → communications → reports → settings | Same bar |
| **9. Hardening** | Route-level code-split audit, bundle budget, axe sweep across pages, 200% zoom pass, reduced-motion pass, security checklist (§12), performance profiling on low-end hardware | Release-candidate checklist signed off |
| **10. Backend integration** | Swap MSW base for real API per environment config; contract tests against staging; remove/flag mocks | E2E happy paths green against staging |

## 13.2 Working Agreements

- **Branch/PR flow:** trunk-based; feature branches `feat/<feature>-<slug>`; PRs require green CI + one review; features land behind flags (`configs/feature-flags`) when partially complete.
- **Definition of done for any page:** all UX states implemented (the §6 State Matrix is the checklist), both themes, keyboard + screen-reader pass, responsive per UX §5, no lint boundary violations.
- **Naming:** components PascalCase; hooks `useX`; query hooks `useXQuery`/`useXMutation`; endpoint fns verb-first; files match default export.
- **Testing pyramid:** utils/models unit-tested; Tier 1–2 components story + interaction tests; features integration-tested with MSW (happy + error paths); a thin E2E smoke per role (login → key flow) later.
- **Docs discipline:** any deviation from this document requires updating it in the same PR (architecture and code may not drift).

---

*Medora Frontend Architecture v1.0.0 — implementation begins at Phase 0 upon approval. No application pages are defined here; page construction starts in Phase 7 per the approved UX_ARCHITECTURE.md.*
