# Phase 7 — Doctor Laboratory System

Frontend-only implementation of the complete Laboratory module for the Doctor
dashboard: an enterprise lab-management list at `/doctor/labs` and a full
clinical result-document detail page at `/doctor/labs/:labId`. Built entirely
from the Phase 1 component library over the shared patient domain — no new
primitives, no backend, no AI logic, read-only per scope.

## Routes

| Path | Page | Crumb |
| --- | --- | --- |
| `/doctor/labs` | `LabsPage` (P1 list) | Labs |
| `/doctor/labs/:labId` | `LabDetailPage` (P2 detail) | Result |

Registered in `src/app/router/index.tsx` as a lazy feature chunk (`labsRoutes`,
replacing the former `labs` in-shell placeholder), with path constants already
present in `src/routes/index.ts` (`routes.doctor.labs`,
`routes.doctor.labReport(id)`).

**Access points**

- **Sidebar** — the existing "Labs" item (FlaskConical icon, "Clinical" group)
  in `src/layouts/navigation.ts` now resolves to the real feature.
- **Patient Profile** — the "Lab results" tab's action ("Open in labs") now
  navigates to `/doctor/labs?patient=<patientId>`, landing on the list
  pre-filtered to that patient (removable "Patient: <name>" chip).
- **Medical Records** — the record-detail quick-actions overflow menu gains a
  "Lab results" entry navigating to `/doctor/labs?patient=<patientId>`.

## Folder structure

```
src/features/doctor/labs/
├── api/
│   └── useLabTestsQuery.ts          # TanStack Query over mock data (list + detail)
├── components/
│   ├── LabCells.tsx                 # Patient / test-name / category / status / priority cells
│   ├── LabRowActions.tsx            # Eye + ⋯ menu (view, patient, record, placeholders)
│   ├── LabCardList.tsx              # <md stacked-card rendering of the list
│   ├── LabSummaryCards.tsx          # Total / pending / in-progress / completed / critical / new-today
│   ├── LabFiltersDrawer.tsx         # Advanced filters (5 selects + date range + critical toggle)
│   ├── lab-table-columns.tsx        # DataTable column factory (11 columns)
│   └── detail/
│       ├── LabSectionCard.tsx       # Card+Section wrapper (uniform h2 sections)
│       ├── LabQuickActions.tsx      # View patient · Medical record · AI analysis · ⋯ (print/export)
│       ├── LabPatientSummaryCard.tsx
│       ├── LabTestInfoCard.tsx      # Identity + lifecycle dates + turnaround
│       ├── LabOrderedByCard.tsx     # Ordering doctor / department / indication
│       ├── LabSpecimenSection.tsx   # Specimen type / container / collection / receipt
│       ├── LabResultsSection.tsx    # Results table + reference ranges + critical-flag banner
│       ├── LabInterpretationSection.tsx
│       ├── LabAttachmentsSection.tsx
│       └── LabTimelineSection.tsx
├── hooks/
│   └── useLabListState.ts           # URL-owned q/filters/sort/page state
├── model/
│   ├── types.ts                     # LabTest + sub-documents + P8 meta maps
│   ├── catalogue.ts                 # Realistic test/analyte reference data
│   ├── mock-data.ts                 # 520 seeded lab tests from the shared roster
│   ├── filters.ts                   # Filter contract + active-chip mapping
│   └── selectors.ts                 # Pure search/filter/sort/summary functions
├── pages/
│   ├── LabsPage.tsx
│   └── LabDetailPage.tsx
├── routes.tsx                       # Lazy route objects with breadcrumb handles
└── index.ts                         # Public API: routes only
```

## Architecture

- **URL-owned list state** — search, all seven advanced filters, the critical
  toggle, the `patient` deep-link filter, sort, page, and page size live in
  query params (validated on read, invalid → default), so every view is
  shareable and restorable. Filter changes reset pagination. Mirrors the
  Phase 5/6 pattern.
- **Pure model selectors** — `filterLabTests` / `sortLabTests` /
  `summarizeLabTests` are pure functions over the dataset; they become
  server-side query params when the API lands without touching components.
- **Search** (debounced via `SearchBar`) matches patient name, MRN, lab ID,
  test name/code, and ordering doctor.
- **List page** — six-card summary `StatisticCard` row (Total, Pending,
  In progress, Completed, Critical results, New today); `FilterBar` with
  active chips + clear-all; refresh; Export placeholder; sticky-header
  sortable `DataTable` (11 columns) with row selection (bulk export
  placeholder), row-click navigation, and loading / empty / error / no-match
  states; `Pagination`; stacked `Card` list under `md` so no functionality is
  lost on mobile.
- **Detail page** — P2 layout: clinical document (results table, interpretation,
  specimen information, attachments) in the main column; patient summary, test
  information, ordered-by, and the order timeline in a sticky summary column.
  Critical results surface at the top of the results section as a
  non-dismissible `Alert` banner and as red flag badges on the affected rows
  (never color-alone). Loading skeleton, not-found, and error states mirror the
  Medical Record detail page.
- **Statuses** — Ordered / Collected / Processing / Completed / Cancelled and
  priorities Routine / Urgent / STAT map onto the sanctioned P8 `StatusBadge`
  vocabulary (`LAB_STATUS_META`, `LAB_PRIORITY_META`); result flags
  (`LAB_RESULT_FLAG_META`) reuse the same map. No new color-status pairings.
  The summary "Pending" card groups Ordered + Collected; "In progress" is
  Processing.

## Components used (existing only)

`DataTable`, `Pagination`, `Breadcrumb`, `Button`, `LinkButton`, `IconButton`,
`Dropdown`, `Tooltip`, `Drawer`, `Select`, `Input`, `Switch`, `Card`, `Avatar`,
`Badge`, `StatusBadge`, `StatisticCard`, `FilterBar`, `SearchBar`,
`Fact`/`FactGrid`, `ContentHeader`, `PageContainer`, `Stack`, `Grid`, `Section`,
`Alert`, `EmptyState`, `ErrorState`, `Skeleton`, plus the `useDisclosure` /
`useMediaQuery` hooks and `utils/dates` formatters. The results table is a
plain semantic `<table>` styled with design tokens (the DS has no dedicated
results-grid primitive); no new component was introduced.

## Mock data model

`model/mock-data.ts` generates **520 deterministic lab tests** with the shared
seeded PRNG (`mulberry32`), drawing patients from
`shared-domain/patient-identity` so names, MRNs, and ids stay coherent with the
Patients, Appointments, and Medical Records modules. Test definitions come from
`model/catalogue.ts` — 25 realistic tests across all eight categories
(Hematology, Chemistry, Microbiology, Immunology, Pathology, Urinalysis,
Hormones, Blood Bank), each with a LOINC-style code, specimen type, container,
and its analytes with reference ranges and critical thresholds.

The `LabTest` model mirrors the future list/detail DTO:

- **Order** — id, denormalized patient snapshot, test name/code, category,
  department, ordering doctor, clinical indication, status, priority,
  requested/collected/completed dates.
- **Specimen** — type, container, collection site, collected-by, collected-at,
  received-at, condition, volume (null until collected).
- **Results** — per-analyte value, unit, reference range, and flag
  (normal / low / high / critical-low / critical-high / abnormal); qualitative
  analytes (cultures, pathology) report categorical values. `hasCriticalResult`
  is derived. Interpretation text is keyed to the abnormal/critical state.
- **Attachments & timeline** — a report PDF (plus occasional addendum) once
  completed; the timeline is synthesized from the order's actual lifecycle
  (ordered → collected → received → processing → resulted → verified, or
  cancelled).

Clinical coherence rules: every ~16th test is requested today (drives the
"New today" card); the rest spread over the past ~180 days. Status is
time-coherent (today's orders are mostly ordered/collected, recent ones
processing/completed, old ones completed/cancelled); results, specimen, and
completion date only exist for the stages that logically produce them, and no
date lands in the future.

## Future API integration points

| Seam | Today | Later phase |
| --- | --- | --- |
| `api/useLabTestsQuery.ts` | `fetchLabTestsMock` / `fetchLabTestMock` over `MOCK_LAB_TESTS` | Lab list/detail endpoints + DTO→model mappers; keys (`labKeys`) unchanged |
| `model/selectors.ts` | Client-side filtering/sorting/summary | Server-side query params; components unaffected |
| `model/types.ts` | Mirrors the future list/detail DTOs | Replace with generated API types if desired |
| `model/catalogue.ts` | Static test/analyte reference data | Lab catalogue endpoint |
| Row/detail placeholder actions | Info toasts (Print report, Export PDF, AI analysis, attachment view/download) | Files service + AI assistant integration |

## Out of scope (per Phase 7 brief)

No editing, no backend, no AI logic. Print report / Export PDF / AI analysis and
the list Export are placeholder toasts. Quality gates: `npm run typecheck`,
`npm run lint`, and `npm run build` all pass with zero errors (the 12
react-refresh warnings are pre-existing and accepted). Verified in-app: the
list renders all 520 tests with populated summary cards, working search /
filters / critical toggle, and the detail page renders every required section
(patient summary, test information, ordered-by, specimen, results with
reference ranges and critical flags, interpretation, attachments, timeline).
