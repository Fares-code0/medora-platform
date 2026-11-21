# Phase 3 — Doctor Patients Module

**Status:** Complete · **Depends on:** `DESIGN_SYSTEM.md` v1.0.0 · `UX_ARCHITECTURE.md` v1.0.0 ·
`FRONTEND_ARCHITECTURE.md` v1.0.0 · `COMPONENT_LIBRARY.md` v1.0.0 · Phase 2 shell

Implements the **Patients list** (UX 2.2, pattern P1) at `/doctor/patients` on realistic mock
data. No backend, no API integration, no Patient Profile (still a placeholder). Verified:
`npm run typecheck` (0 errors) · `npm run lint` (0 errors) · `npm run build` (success —
`PatientsPage` ships as its own ~48 kB lazy chunk).

---

## 1. Folder structure

```
src/features/doctor/patients/         # standard feature anatomy (§3.4)
├── index.ts                          # PUBLIC API — exports patientsRoutes only
├── routes.tsx                        # lazy route + breadcrumb handle
├── pages/
│   └── PatientsPage.tsx              # composition & orchestration only
├── components/
│   ├── PatientsSummaryCards.tsx      # 5 practice-wide StatisticCards
│   ├── patient-table-columns.tsx     # DataTableColumn<Patient>[] (config only)
│   ├── PatientNameCell.tsx           # avatar + name + severe-allergy indicator
│   ├── PatientDateCells.tsx          # absolute+relative dates; "Today HH:mm" badge
│   ├── PatientRowActions.tsx         # inline message/schedule + ⋯ full action menu
│   ├── PatientFiltersDrawer.tsx      # 8-filter advanced-filter drawer
│   └── PatientCardList.tsx           # <md stacked-card rendering (UX §5.2)
├── hooks/
│   └── usePatientListState.ts        # URL-param schema: q/filters/sort/page/pageSize
├── model/
│   ├── types.ts                      # Patient, PatientStatus, RiskLevel + P8 metadata maps
│   ├── filters.ts                    # filter contract + active-chip labels
│   ├── selectors.ts                  # pure search/filter/sort/summary functions
│   └── mock-data.ts                  # 120 seeded deterministic patients
└── api/
    └── usePatientsQuery.ts           # TanStack Query over a mock fetcher (450ms latency)
```

Supporting addition: `src/utils/dates.ts` (pure Intl-based `formatDate`, `formatTime`,
`dayDiffFromToday`, `relativeDayLabel`). Router: `patientsRoutes` mounted in the doctor shell;
`/doctor/patients/:patientId` remains an in-shell "Patient profile" placeholder.

## 2. Components used (no new primitives, zero duplication)

- **Layout:** `PageContainer` (2xl) · `ContentHeader` (title, caption, breadcrumb slot, quick
  actions) · `Stack` · `Grid`
- **Patterns:** `SearchBar` (300 ms debounce + result-count live region) · `FilterBar` (active
  chips, Clear all) · `StatisticCard` · `StatusBadge` (the only status→color mapping)
- **UI:** `DataTable` (sortable columns with `aria-sort`, sticky header, selection column with
  select-all/indeterminate, skeleton loading, in-body ErrorState + Retry, custom empty states) ·
  `Pagination` (page numbers + page-size Select) · `Drawer` (filters) · `Select` · `Breadcrumb` ·
  `Button` / `IconButton` / `Dropdown` / `Tooltip` / `Avatar` / `Card` / `Checkbox`
- **Feedback:** `EmptyState` (first-use and no-results flavors) · `ErrorState` · `Skeleton` ·
  toasts via `useToast`

## 3. State model — URL is the source of truth

`usePatientListState` owns the UX §1.3 param contract for `/doctor/patients`:
`?q=&gender=&ageRange=&bloodType=&status=&lastVisit=&upcoming=&condition=&allergy=&sort=name.asc&page=2&pageSize=25`.
Every param is validated on read (invalid values fall back to defaults, never crash); any filter
change resets `page`. Search commits are debounced and use history `replace` so typing doesn't
flood the back stack. Filtered views are therefore shareable, restorable, and Back-button-safe.

## 4. Mock data model

`Patient` mirrors the future list DTO: id (`PT-1001`), MRN, name, DOB + age, gender, blood type,
phone, `photoUrl` (null until the files service; Avatar falls back to initials), lastVisit /
nextAppointment / registeredAt (ISO, nullable where clinically meaningful), assignedDoctor,
status, riskLevel, chronicConditions[], allergies[] + hasSevereAllergy.

120 patients are generated from a **seeded PRNG** (`mulberry32`) — the dataset is identical on
every load (stable ids, reproducible sorting/filtering) while remaining realistic: weighted
status/risk distributions, critical patients never low-risk, ~1 in 8 scheduled today (drives the
"Today's visits" card), ~1 in 9 never visited (drives the "Never visited" filter).

**Status → P8 mapping** (`PATIENT_STATUS_META`): Active→success · Under treatment→info ·
Critical→error · Follow-up→warning · Discharged→neutral. **Risk → P8** (`RISK_LEVEL_META`):
Low→success · Medium→warning · High/Critical→error (labels differentiate the two error levels;
no new color-status pairing was invented).

## 5. Future API integration points

| Seam | Today | Later |
|---|---|---|
| `api/usePatientsQuery.ts` | TanStack Query + `fetchPatientsMock` | Swap the fetcher for `api/endpoints/patients.list()` + DTO→model mapper; add list params to the query key (`patientKeys.list(params)`) to move filtering/sorting/pagination server-side |
| `model/selectors.ts` | Client-side filter/sort/slice | Shrinks to the summary mapper once the server filters |
| `model/mock-data.ts` | Seeded fixtures | Deleted (or moved to MSW fixtures in the Phase 6 mock adapter) |
| Row-action deep links | Point at placeholder section pages | Already use the UX §1.3 param contracts (`?patientId=`, `?tab=`), so they light up as features land |

## 6. Known placeholders

- **Patient profile** (`/doctor/patients/:patientId`) — in-shell placeholder; row click and
  "View profile" navigate there.
- **Add patient · New appointment · Import · Export (incl. "Export selected")** — fire an info
  toast; no data changes.
- **Refresh** is real (refetches the mock query; spinner in the button while fetching).
- **Error state** is fully wired through `DataTable`/`PatientCardList` (ErrorState + Retry →
  `refetch`) but unreachable with the always-succeeding mock fetcher by design.
- Saved views (P7), bulk actions beyond selection+export, CSV generation, and the card/table
  view toggle from UX 2.2 land with later phases.
- DataTable's sticky-first-column tablet refinement (UX §5.2) is a DS-governance item; at `md`
  the table horizontally scrolls inside its container, and below `md` the stacked-card list
  takes over with full functionality (selection, actions, states).
