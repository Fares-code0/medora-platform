# Phase 17 — Doctor Administration Center

The **Doctor Administration Center** is the doctor's own clinic-management area
(distinct from the System Admin Panel). It lives at **`/doctor/administration`**
and gives the doctor a single, self-contained environment to run the clinic:
staff, departments, rooms, resources, schedules, shifts, the live queue and
waiting room, announcements, policies and document templates.

It is built entirely on the existing Medora design system, TanStack Query and
the existing routing/auth architecture — no new dependencies, no hardcoded
colors, no inline styling, and no duplication of platform components.

---

## 1. A distinct experience (by design)

The brief required a layout unlike any other page and explicitly said **not** to
reuse the platform Header, Card, Table or dashboard Patterns. The Administration
Center therefore ships its **own chrome and visual language**, composed only from
design-system tokens and Tier-1 atoms (Button, Badge, Avatar, Input, Select,
Switch, Drawer, Spinner, Progress…):

- **`AdministrationLayout`** — a two-pane shell with a persistent left rail on
  large screens and a slide-over rail on smaller ones. It does **not** reuse a
  global AppShell.
- **`AdminRail`** — a grouped, icon-led navigation rail with an active-item
  accent bar (Command · Live operations · People & time · Facility · Governance).
- **`AdminCommandBar`** — a sticky top bar centred on **global search**, with a
  live clinic-status pill, a clock, notifications and a theme toggle.
- **Feature-local primitives** (`Panel`, `MetricTile`, `IconTile`, `Overline`,
  `SectionShell`, `DataGrid`, `AsyncSection`) — a "console" aesthetic
  (uppercase overlines, icon tiles, tabular numerals, whisper-thin separators)
  that is deliberately different from `Card` / `StatisticCard` / `DataTable`.

## 2. Sections

| Slug | Section | Highlights |
| --- | --- | --- |
| `overview` | Clinic Overview (dashboard) | Metric row, utilization/occupancy gauges, hourly activity strip, quick actions, queue & announcement peeks |
| `queue` | Queue Management | Next patient, delayed & priority flags, per-patient estimated wait, priority filter |
| `waiting-room` | Waiting Room | Checked-in / waiting / in-room tally, longest wait, status filter |
| `staff` | Staff Management | Roster (doctor, nurse, receptionist, laboratory, pharmacy), search + role/department/status filters, details drawer with contact, hours and **read-only permissions** |
| `departments` | Departments | Card grid: head, staffing, active status, search + status filter |
| `shifts` | Shift Management | Staff × weekday planner (morning/evening/on-call/vacation/leave), legend, type filter |
| `schedule` | Working Schedule | Seven-day opening-hours strip with breaks |
| `holidays` | Holidays | Public/clinic closures, recurring flag, type filter + search |
| `rooms` | Room Management | Status board (consultation/lab/procedure/pharmacy/waiting), status tally, kind + status filters |
| `resources` | Resources | Equipment/consumables stock table, reorder levels, category + status filters |
| `announcements` | Announcements | **Create / edit / pin / archive / restore**, priority + expiry, filters, toasts |
| `policies` | Clinic Policies | Category filter + search, read-only viewer drawer |
| `templates` | Document Templates | Six named templates, **view / duplicate / archive**, status filter, toasts |

Every table/list has meaningful filters, and the command bar provides **global
search** across staff, departments, rooms, resources, announcements, policies and
templates.

## 3. Data layer

- **`administration.types.ts`** — domain types for every dataset.
- **`administration.api.ts`** — mock data source (max five seeded records per
  dataset; the six named document templates are the enumerated deliverables),
  with latency-simulated async fetchers so loading/error paths are real.
- **`administration.queries.ts`** — one **TanStack Query** hook per dataset under
  a shared `['administration', …]` key namespace (invalidate-by-prefix ready).
- **`administration.meta.ts`** — nav groups, section metadata, and the single
  status → label / status → badge-variant maps.

Create/edit/pin/archive/duplicate actions run against local component state
(the mock layer has no write endpoint) and confirm with the design-system toast.

## 4. Routing & navigation (canonical integration)

The Administration Center is reached like any other doctor area — sign in with
the seeded doctor account (`doctor@medora.health` / `Medora123!`), then open
**Administration** from the sidebar (Management group) or the mobile "More"
menu. Because it renders its **own** full-screen environment (rail + command
bar), the feature route is mounted as a lazy chunk **sibling to — and outside —
the AppShell layout route**, still behind `RequireAuth` + `RequireRole('doctor')`
(`src/app/router/index.tsx`). The rail's "Exit to workspace" link returns to the
AppShell at `/doctor/overview`. No auth changes were needed: the real Phase-9
auth is used as-is.

## 5. Responsive

- **Desktop** — persistent rail + multi-column grids.
- **Tablet** — rail collapses to the command-bar menu button; grids reflow to
  two columns.
- **Mobile** — slide-over rail; single-column stacks; tables scroll inside their
  own container so the page body never scrolls sideways.

## 6. Files

### Created
```
src/features/doctor/administration/
  administration.types.ts
  administration.api.ts
  administration.queries.ts
  administration.meta.ts
  AdministrationLayout.tsx
  routes.tsx
  index.ts
  components/
    primitives.tsx        (Panel, MetricTile, IconTile, Overline, AsyncSection)
    DataGrid.tsx
    SectionShell.tsx
    AdminRail.tsx
    AdminCommandBar.tsx
    GlobalSearch.tsx
  sections/
    OverviewSection.tsx
    QueueSection.tsx
    WaitingRoomSection.tsx
    StaffSection.tsx
    DepartmentsSection.tsx
    ShiftsSection.tsx
    ScheduleSection.tsx
    HolidaysSection.tsx
    RoomsSection.tsx
    ResourcesSection.tsx
    AnnouncementsSection.tsx
    PoliciesSection.tsx
    TemplatesSection.tsx
PHASE17_DOCTOR_ADMINISTRATION_CENTER.md
```

### Modified (canonical integration only — no existing feature touched)
```
src/routes/index.ts        — AdministrationSectionSlug type + routes.doctor.administration() href helper
src/app/router/index.tsx   — lazy /doctor/administration/* mounted as a sibling outside AppShell, under the doctor guard
src/layouts/navigation.ts  — "Administration" sidebar item (Management group), reachable in the mobile More menu
```

## 7. Verification

- `npm run typecheck` — clean.
- `npm run lint` — 0 errors (feature code is warning-free; remaining warnings are
  pre-existing `react-refresh` notices in platform providers).
- `npm run build` — succeeds; the Administration Center ships as its own lazy chunk.
- **Browser** — all 13 sections render with data; rail navigation, command bar,
  global search, filters, drawers and the responsive mobile menu all work; no
  console errors.

## 8. Quality gates

- Existing architecture, routing, providers and design system — reused, not rebuilt.
- TanStack Query for all reads.
- No new dependencies. No hardcoded colors. No inline styles. No duplicated
  platform components. Feature isolation boundaries respected.
