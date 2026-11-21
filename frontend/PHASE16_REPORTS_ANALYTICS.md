# Phase 16 — Enterprise Reports & Analytics Center

A Power BI / Looker–style analytics dashboard for the doctor role, replacing the
`/doctor/reports` placeholder. Chart-first, filter-driven, and deliberately
unlike every list page in the app.

- **Route:** `/doctor/reports` (lazy) — category, date range, and every advanced
  filter are URL-owned query params, so any view is shareable and restorable.
- **Feature:** `src/features/doctor/reports/`
- **Branch:** `claude/doctor-lab-system-phase-7-c1f15a` (the canonical phase line;
  committed here, consistent with Phases 9–15).

---

## 1. What's on the page

| Area | Detail |
| --- | --- |
| **Executive KPIs** | Revenue, Patients, Appointments, Lab orders, Prescriptions, Growth — sparkline cards with deltas (reuses the platform `KpiWidget`). |
| **Sticky filter bar** | Category pills (9 domains), a date-range segmented control (Today/Week/Month/Quarter/Year/Custom), an advanced-filters button with an active count, and removable active-filter chips. |
| **Advanced filters** | Drawer with Doctor · Department · Patient · Status · Medication · Lab test · Age · Gender, plus the custom date range. |
| **Analytics grid** | **Category-driven**: each of the 9 categories features its most relevant chart first (large, beside the **AI insights** panel) and curates the supporting panels, so switching category genuinely reconfigures the view. Charts include line/area trend, department & lab-status donuts, weekday/pharmacy/records/messages bars, an AI-usage and age distribution, and an activity heatmap. |
| **Saved reports** | Favorites + Recent lists with create / rename / duplicate / favorite / delete; applying one restores its exact filters. |
| **Export** | Dialog for CSV · Excel · PDF · Print. CSV builds a real client-side file from the snapshot; Print calls `window.print()`; Excel/PDF are simulated. |
| **Scheduled reports** | Daily / weekly / monthly delivery with recipients, status, next-run, and send history; create / pause / resume / delete. |
| **Insights** | Auto-generated observations (highest workload, busiest day, critical patients, prescription & lab trends, revenue momentum), derived from the current snapshot. |

---

## 2. Chart library

No third-party chart dependency exists in the project, so the charts are
hand-rolled **token-styled SVG/CSS**, following the `KpiWidget` Sparkline
precedent. They live in `components/charts/` and are responsive (fixed viewBox,
`width:100%`), theme-aware (colors via `fill-*`/`stroke-*` design tokens), and
carry native `<title>` tooltips.

| Chart | Notes |
| --- | --- |
| `LineAreaChart` | Multi-series line **or** area; interactive legend toggles series. |
| `BarChart` | Single categorical series; optional per-bar tones (status colors). |
| `PieChart` | Pie **and** donut variants; interactive legend; donut shows the total. |
| `Heatmap` | Weekday × time-of-day intensity grid (CSS grid, opacity-encoded). |
| `DistributionBars` | Horizontal distribution with value + share. |
| `ChartLegend` | Shared interactive legend used by multi-series and pie/donut charts. |

The **analytics color system** (`model/palette.ts`) maps seven analytics tones to
token utility classes (`fill`/`stroke`/`text`/solid `bg`) with a categorical
ordering, so every series is theme-aware and consistent.

---

## 3. Architecture

Follows the existing feature conventions (TanStack Query · mock service · store ·
selectors · hooks · lazy routes · shared components).

```
src/features/doctor/reports/
  index.ts                       # public API: reportsRoutes
  routes.tsx                     # lazy /doctor/reports
  model/
    types.ts                     # categories, filters, KPIs, series, saved/scheduled
    palette.ts                   # analytics color system (token classes)
    mock-data.ts                 # base seeds (≤5 each) — reuses shared DOCTORS
    store.ts                     # per-user localStorage (medora.<userId>.reports.v1)
    selectors.ts                 # buildSnapshot(filters), deriveInsights, formatters
    format.ts                    # date/time formatters
  mock/mock-reports-service.ts   # analytics + saved/scheduled CRUD + export (mock)
  api/useReportsQueries.ts       # analytics query (keyed by filters) + doc mutations
  hooks/useReportFilters.ts      # URL-owned filter state + applyFilters
  components/
    charts/                      # the SVG chart library (above)
    KpiRow · InsightsPanel · ReportsFilterBar · ReportsFiltersDrawer
    AnalyticsGrid · SavedReportsRail · ExportDialog · ScheduledReportsPanel
  pages/ReportsPage.tsx          # the dashboard shell
```

### Data model & filtering

Analytics are **derived**, not stored: `buildSnapshot(filters)` reshapes a small
set of base seeds by the date range (which also changes the trend axis —
today→hours, week→days, month→weeks, quarter/year→months) and a deterministic
per-filter multiplier, so the whole dashboard visibly responds to any filter
while staying honest about being illustrative mock data. The analytics query is
keyed by the full filter object, so each distinct view is fetched and cached.

Saved and scheduled reports persist in a per-user localStorage document
(`medora.<userId>.reports.v1`), wiped on logout by the auth provider's
`clearUserPreferences`. Every mutation returns the full patched document, which
is written straight into the query cache (`setQueryData`) — no refetch,
StrictMode-safe.

### Mock data — ≤5 examples

5 doctors (shared roster) · 5 departments · 5 lab statuses · 5 drug classes ·
5 saved reports · 3 schedules. No massive generated datasets.

---

## 4. Integration

| Touch point | Change |
| --- | --- |
| `src/app/router/index.tsx` | Mounts `reportsRoutes`; removed the last section placeholder (`DoctorSectionPlaceholder` and the `doctorSectionPlaceholders` array). |

No other module was modified; the design system and existing architecture are
untouched.

---

## 5. UI & quality

- **Analytics dashboard feel:** sticky filters, KPI band, large charts, split
  analytics panels, minimal tables — chart-first, not another list page.
- **Interactive legends** (toggle series/slices), **responsive charts** (viewBox),
  **loading skeletons**, **empty states** (per chart via `DashboardWidget`), and
  an **error state** with retry on the analytics query.
- **Tokens only:** colors via `fill-*`/`stroke-*`/`bg-*` tokens; the only inline
  styles are computed bar/segment dimensions (the same dynamic-value exception the
  DS `Progress` component uses).

### Verification

| Gate | Result |
| --- | --- |
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 errors (16 accepted `react-refresh/only-export-components` warnings; the feature added none) |
| `npm run build` | success (ReportsPage is its own lazy chunk, ~49 kB) |

Browser-verified: dashboard renders all KPIs + 7 chart types + insights; date
range change rescales KPIs and reshapes the trend axis; advanced filters add
chips, a count badge, and narrow the data; export dialog opens with all four
formats; saved and scheduled report panels render; responsive; **zero console
errors**.
