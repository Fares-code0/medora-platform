# ADM-01 — Admin Overview (UX §3.1)

**Date:** 2026-08-12
**Checklist row:** ADM-01 · `frontend/FRONTEND_CHECKLIST.md` §4, Phase C item 13
**Spec of record:** `frontend/UX_ARCHITECTURE.md` §3.1 "Overview (Home)"
**Status before this work:** 🟡 P0 — a *clinic* overview sits at `/admin` and a
*platform* overview at `/admin/platform`; the security-alerts panel and the
admin action queue specified by §3.1 do not exist.

---

## 1. Purpose

§3.1 asks one question: *is the platform healthy, secure, and growing, and
what work is waiting for me?* The admin must be able to spot an anomaly and
reach it in one click.

Today the admin lands on a clinic-operations page instead. UX §1.3 says users
land on their role's Overview after sign-in, so the admin's Home has been the
wrong screen since the area moved to `/admin` in Phase B.

## 2. Placement and route changes

ADM-01 becomes the admin area index. Platform Overview is absorbed rather than
kept alongside: its System Health, audit feed and registrations panels *are*
§3.1 rows 3 and 4, so keeping both pages would duplicate three widgets on the
admin's two most-visited screens — the "bolted on" problem the checklist row
already names.

| Route | Before | After |
| --- | --- | --- |
| `/admin` (index) | `ClinicOverviewSection` | **`AdminOverviewSection`** (ADM-01), crumb "Overview" |
| `/admin/clinic` | — | `ClinicOverviewSection`, new `clinic` slug, stays in the sidebar |
| `/admin/platform` | `PlatformOverviewSection` | retired; redirects to `/admin` |

Consequences to handle:

- `AdminSectionSlug` (`src/routes/index.ts`) loses `platform` and gains
  `clinic`. `SECTION_META` (`administration.meta.ts`) follows: the `overview`
  entry is relabelled "Overview" with a §3.1 description, and a `clinic` entry
  carries the old "Clinic Overview" label and description.
- `adminNavigation` (`src/layouts/navigation.ts`) first group becomes
  **Overview** (`end: true`, `/admin`) then **Clinic Overview** (`/admin/clinic`).
  `bottomTabIds` keeps `overview` and is otherwise untouched — the §5 tab-bar
  assignment is ADM-11, out of scope here.
- The "default landing section" preference (`admin-profile.ts` `landingSection`,
  surfaced in Admin Profile and General Settings) stores a slug. A stored value
  that is no longer a known slug — `platform` — must resolve to `overview`
  rather than routing nowhere. The fallback lives with the resolver, not the
  caller.
- `PlatformOverviewSection.tsx` is deleted. Its licence/seats content moves into
  the Row-3 Storage & Usage card (§4.5), which carries a **Manage** link into
  `/admin/settings/integrations` rather than integration controls of its own —
  the integrations panel is already a settings tab, and reproducing it on the
  index would be the third place to edit one setting. Its System Health, audit
  feed and registrations content becomes §4.6, §4.8 and §4.9.

## 3. Module shape

New module `src/features/admin/overview/`, following the shape `appointments/`,
`doctors/` and `patients/` established in Phase C: pure rules, thin mock
service, query hooks, components.

```
src/features/admin/overview/
  overview.types.ts        domain types (alerts, queue rows, signals, signups)
  overview.ts              pure derivations + label/variant maps + formatters
  overview.test.ts         tests for the above
  overview.api.ts          thin mock service for what no store can produce
  overview.api.test.ts
  overview.queries.ts      TanStack Query hooks
  AdminOverviewSection.tsx the page
  AdminOverviewSection.test.tsx
  SecurityAlertsBanner.tsx
  ActionQueueCard.tsx
  PlatformActivityChart.tsx
  SystemHealthCard.tsx
  AppointmentFunnelCard.tsx
  StorageUsageCard.tsx
  ActivityFeeds.tsx        recent admin activity + recent signups
```

## 4. Layout and widgets

§3.1's 12-column grid, `container-2xl`:

```
Row 0  Security Alerts banner (full width, only when unresolved alerts exist)
Row 1  KPI row (4×3): Total Doctors · Total Patients ·
       Appointments Today · Active Users Now
Row 2  Platform Activity chart (8)      |  Admin Action Queue (4)
Row 3  Storage & Usage (4) | Appointment Funnel (4) | System Health (4)
Row 4  Recent Admin Activity (6)        |  Recent Signups (6)
```

### 4.1 Security alerts banner (Row 0)

Rendered only when unresolved alerts exist. Error-toned, non-dismissible.
Each alert: severity badge, one-line summary, **Investigate**.

Derived from sources that exist today:

| Alert kind | Source | Rule |
| --- | --- | --- |
| Repeated failed sign-ins | `DoctorRecord.logins` via `failedSignInCount(doctor, 7, now)` | ≥ 5 failed or blocked attempts in 7 days · severity `warning` |
| Impossible travel | `hasImpossibleTravel(doctor)` | any login event flagged · severity `critical` |
| PHI reveal burst | `phiAccessLog` (`usePhiAccessLog`) | ≥ 6 reveals by one actor in 24h · severity `warning` |
| Critical audit event | `useAuditEvents()` where `severity === 'critical'` | within the last 7 days · severity `critical` |

Thresholds live as named constants in `overview.ts` (`FAILED_SIGN_IN_THRESHOLD`,
`PHI_BURST_THRESHOLD`, `ALERT_WINDOW_DAYS`) so the tests assert the boundary
rather than a magic number.

**Investigate** resolves through a single pure map, `alertDestination(alert)`,
because ADM-07 System Logs is not built (roadmap item 12; this is item 13). It
routes to the nearest place the alert can actually be investigated:

- sign-in alerts → `/admin/doctors/:id?tab=activity` — the sign-in history with
  impossible-travel flagging ADM-03 already ships
- PHI reveal bursts → `/admin/settings/audit`
- critical audit events → `/admin/settings/audit`

One map, one place for ADM-07 to repoint at `/admin/logs`.

Flagged communications, the fourth alert source §3.1 names, has no data source
until ADM-06 and is omitted rather than seeded (§7).

### 4.2 KPI row (Row 1)

P5 KPI cards with deltas.

| KPI | Value | Caption | Source |
| --- | --- | --- | --- |
| Total Doctors | verified doctors | `n pending verification` | doctors document; the pending count reuses ADM-02's `tabCounts`, so `docs-requested` stays out of it exactly as it does on the Doctors page |
| Total Patients | registered patients | active / dormant split | patients document |
| Appointments Today | `summarize().todayTotal` | utilization % | oversight document + roster load |
| Active Users Now | polled count | last updated | `overview.api.ts` |

Active Users transitions with a fade and **never counts up** (§3.1). Under
`prefers-reduced-motion` the value swaps without transition.

§3.1 asks for deltas on these cards. `MetricTile` has no delta affordance and
three of the four KPIs have no historical series to compute one from, so the
captions carry the secondary figure instead. Recorded as not-done rather than
faked.

The Doctors KPI caption and the action-queue verification row must be the same
number from the same helper. ADM-04 shipped a bug of exactly this kind (a
column and its ordering disagreeing until one shared `openWorkCount` helper
fixed it); the derivation here is written once and used twice by construction.

### 4.3 Platform activity chart (Row 2, 8 cols)

30-day multi-line chart — daily active users, appointments booked, messages
sent — on `LineAreaChart` with `ChartLegend`, legend entries toggling their
series. Range switch per §3.1's "range switch on charts". Served by
`overview.api.ts`; no store holds platform telemetry.

### 4.4 Admin Action Queue (Row 2, 4 cols)

Four rows, each a count that deep-links to the queue it came from **with the
filter already applied**, so the destination shows exactly the rows the count
promised:

| Row | Derivation | Link |
| --- | --- | --- |
| Doctor verifications pending | `tabCounts(doctors).pending` | `/admin/doctors?tab=pending` |
| Licences expiring < 30 days | `licenceExpiringSoon` — medical licences only, 30-day horizon, expired included | `/admin/doctors?expiring=soon` |
| Accounts with open issues | `openWorkCount(patient) > 0` | `/admin/patients?flag=open` |
| Appointments stuck pending > 24h | `summarize().pendingOverThreshold` | `/admin/appointments?flag=stuck-pending` |

Two of these four destinations have no matching filter today and none of the
three list pages read the URL, so implementation adds `DoctorFilters.expiring`,
`PatientFilters.openWork` and URL seeding on all three — the URL seeds the view
without owning it, the contract `?doctor=` already has on ADM-05.

The patient row reuses ADM-04's own `openWorkCount` rather than narrowing to
`data-correction` and `complaint` flag kinds. A second predicate here would let
the count and the page it links to describe two different sets of accounts,
which is the disagreement the row exists to prevent — and `openWorkCount` is
already the number ADM-04's "open issues" column shows and its ordering ranks
on. The licence rule is deliberately narrower than ADM-02's `isExpiringSoon`
(60 days, every document kind): this row is about practising credentials.

§3.1 allows "direct approve/open on verification queue items". The queue offers
**open**, not approve: ADM-03 refuses a verification until all three per-document
checks are ticked, and a one-click approve from Home would either bypass that
rule or fail confusingly. Opening the profile is the honest affordance.

### 4.5 Storage & Usage (Row 3, 4 cols)

§3.1 renders Revenue only when billing is enabled for the deployment and
specifies **Storage & Usage** as the slot's fallback otherwise. No billing flag
exists anywhere in the app, so the fallback is what ships: storage used/total,
licence plan and renewal, and the seats progress bar absorbed from Platform
Overview, with **Manage** into `/admin/settings/integrations`.

All four figures are read from the one `PlatformStatus` record
(`usePlatformStatus()` → `administration.api.ts`), the record Settings → About
already renders — not from a licence seed of this module's own. A second seed
is what Platform Overview's retirement was supposed to remove, and it would put
two different seat counts on two admin screens. `overview.api.ts` therefore
serves no storage or licence at all.

### 4.6 Appointment funnel (Row 3, 4 cols)

requested → confirmed → completed for the period, plus cancellation and
no-show rates. Both rates come from `summarize()`, which computes them over a
single 7-day denominator and exposes `window7dTotal` — so the two percentages
can be read together, and an empty window says why it is empty rather than
showing two zeros.

### 4.7 System health (Row 3, 4 cols)

Service status list — API, notifications, AI service, storage — each with a
status dot (success / warning / error), last-checked time and uptime %. Served
by `overview.api.ts`, extending the existing `SystemHealth` shape from
`administration.types.ts`.

**Decision — the incident note is printed inline, not linked to.** §3.1 asks a
degraded service to *link to* its incident note; the card renders the note
underneath the service row instead. A coloured dot tells an administrator that
something is wrong and not what is wrong, and this card is usually the first
place they see it, so the note is the widget's point rather than a detail
behind a click. There is also nowhere to link: no incident page exists, so the
link would be the dead end AC-20 was raised about. Inline ships; §3.1's wording
is superseded here.

### 4.8 Recent Admin Activity (Row 4, 6 cols)

The existing `useAuditEvents()` feed: who did what, newest first, with a
severity dot and **View all** into `/admin/settings/audit`.

### 4.9 Recent Signups (Row 4, 6 cols)

Doctors (`joinedAt`) and patients (`registeredAt`) merged newest-first, each
with its verification / account state.

**Patient names render through `MaskedIdentifier`** (ADM-10). ADM-10 made
`MaskedIdentifier` the only sanctioned way to print a patient identifier in the
admin area; the Home page is not going to be the one screen that opts out.
Doctor names are not PHI and render plainly.

## 5. Data flow — hybrid

**Derived, in `overview.ts` (pure):** KPIs, the action queue, security alerts,
the funnel, and the signups feed — computed from the documents ADM-02, ADM-04
and ADM-05 already hold in the query cache (`useDoctorsDocument`,
`usePatientsDocument`, `useOversightDocument`), plus `useAuditEvents` and
`usePhiAccessLog`.

This is the property worth having: those mutations resolve to a full patched
document written straight into the cache, so completing a verification on
ADM-03 or cancelling an appointment on ADM-05 changes the Home counts with no
refetch and no stale badge — the same cross-store honesty ADM-02 ↔ ADM-05
already has. A precomputed overview document could not do that.

**Served, in `overview.api.ts` (thin):** only what no store can produce — the
30-day activity series, the system-health service list, and the polled
active-user count. Storage and licence are pointedly *not* here: they are on
the `PlatformStatus` record `usePlatformStatus()` already serves (§4.5). Two
hooks in `overview.queries.ts`:
`useOverviewSignals()` (30s stale time, matching the other admin modules) and
`useActiveUsers()` (short refetch interval, the only polling on the page).

Every function in `overview.ts` takes `now: number` rather than reading the
clock, the convention `doctors.ts`, `patients.ts` and `oversight.ts` all follow,
which is what makes the age- and window-based rules testable.

## 6. States

- **Loading:** widget-level skeletons. §3.1 requires the security banner and
  action queue to fetch first; both derive from the three documents, so they
  render as soon as those resolve rather than waiting on `overview.api.ts`.
- **Error:** per-widget error with Retry. If the alert sources fail, the banner
  slot shows a warning — **"Security status unavailable — Retry"** — and is
  never silently absent. That is an explicit §3.1 requirement and gets its own
  test.
- **Empty (fresh deployment):** KPIs at zero with the onboarding checklist card
  ("Invite your first doctor" → the ADM-02 invite dialog).

## 7. Out of scope, and why

- **Flagged conversations queue row** — needs ADM-06 Communication Monitoring
  (§3.6, not built). Omitted rather than seeded: an invented count that links
  nowhere would contradict ADM-06 when it lands.
- **Revenue widget** — no billing flag exists for any deployment; §3.1's own
  Storage & Usage fallback ships instead (§4.5).
- **Investigate → System Logs** — ADM-07 is roadmap item 12 and is not built.
  `alertDestination` routes to real destinations today and is the single point
  ADM-07 repoints.
- **Live telemetry** — the activity series and system health are mock-served.
  No telemetry backend exists; this is frontend-only work by project scope.
- **ADM-11 tab bar** — the §5 admin bottom-tab assignment is its own row.

## 8. Tests

- `overview.test.ts` — derivations: the queue count for each row equals what
  its linked page shows for the same filter; `docs-requested` is excluded from
  the pending count; alert rules fire at their thresholds and not below;
  `alertDestination` returns a real route for every alert kind; funnel rates
  share one denominator; the signups feed masks patients and not doctors.
- `overview.api.test.ts` — signals shape, activity series length, active-user
  polling.
- `AdminOverviewSection.test.tsx` — render, empty/fresh-deployment state,
  per-widget error and retry, the security-fetch-failure warning, and that each
  queue row navigates to its filtered destination.
- Route/nav regression: `/admin` renders the overview, `/admin/clinic` renders
  the clinic overview, `/admin/platform` redirects, and a stored
  `landingSection` of `platform` falls back to `overview`.
- A browser pass over the real page — the check that caught the ADM-04
  disagreement.

## 9. Documentation

`frontend/FRONTEND_CHECKLIST.md`: ADM-01 row → ✅ DONE (Phase C) with what
shipped and what did not; §4 intro sentence updated; Phase C roadmap item 13
split so ADM-01 is marked done and ADM-06 / ADM-08 remain; the §7 gaps folded
into "Known gaps carried into the rest of Phase C".
