# Phase 8 — Doctor Pharmacy Management

Frontend-only implementation of the complete Pharmacy Management module for the
Doctor dashboard: an enterprise prescription-management list at
`/doctor/pharmacy` and a full prescription-document detail page at
`/doctor/pharmacy/:prescriptionId`. Built entirely from the Phase 1 component
library over the shared patient domain — no new primitives, no backend, no AI
logic, read-only per scope.

## Routes

| Path | Page | Crumb |
| --- | --- | --- |
| `/doctor/pharmacy` | `PharmacyPage` (P1 list) | Pharmacy |
| `/doctor/pharmacy/:prescriptionId` | `PrescriptionDetailPage` (P2 detail) | Prescription |

Registered in `src/app/router/index.tsx` as a lazy feature chunk
(`pharmacyRoutes`, replacing the former `pharmacy` in-shell placeholder). The
`routes.doctor.prescription(id)` builder in `src/routes/index.ts` was aligned to
the spec URL shape (`/doctor/pharmacy/:prescriptionId`); it had no callers.

**Access points**

- **Sidebar** — the existing "Pharmacy" item (Pill icon, "Clinical" group) in
  `src/layouts/navigation.ts` now resolves to the real feature.
- **Patient Profile** — the identity-header overflow menu gains a
  "Prescriptions" entry navigating to `/doctor/pharmacy?patient=<patientId>`.
- **Medical Records** — the record-detail quick-actions overflow menu gains a
  "Prescriptions" entry (alongside the Phase 7 "Lab results" entry).
- **Labs** — the lab-result-detail quick-actions overflow menu gains a
  "Prescriptions" entry (the lab/clinical workflow hand-off).

All entry points deep-link via `?patient=<id>`, landing on the list pre-filtered
to that patient (removable "Patient: <name>" chip).

## Folder structure

```
src/features/doctor/pharmacy/
├── api/
│   └── usePrescriptionsQuery.ts       # TanStack Query over mock data (list + detail)
├── components/
│   ├── PharmacyCells.tsx              # Patient / medication / status / refill cells + warning marker
│   ├── PrescriptionRowActions.tsx     # Eye + ⋯ menu (view, patient, record, labs, placeholders)
│   ├── PrescriptionCardList.tsx       # <md stacked-card rendering of the list
│   ├── PharmacySummaryCards.tsx       # Total / active / pending-refills / expired / high-risk / new-today
│   ├── PharmacyFiltersDrawer.tsx      # Advanced filters (4 selects + date range + 2 toggles)
│   ├── prescription-table-columns.tsx # DataTable column factory (12 columns)
│   └── detail/
│       ├── PharmacySectionCard.tsx    # Card+Section wrapper (uniform h2 sections)
│       ├── PrescriptionQuickActions.tsx # View patient · Medical record · AI review · ⋯ (labs/print/export)
│       ├── SafetyWarningsSection.tsx  # Interaction/allergy/duplicate/dosage Alerts (healthcare-alert rules)
│       ├── PrescriptionPatientSummaryCard.tsx
│       ├── PrescriptionInfoCard.tsx   # Status, refills, lifecycle dates
│       ├── MedicationDetailsSection.tsx # Name/generic/category/strength/form/manufacturer
│       ├── DosageSection.tsx          # Dosage / frequency / route / duration / instructions
│       ├── PrescribingDoctorCard.tsx
│       ├── PrescriptionNotesSection.tsx
│       ├── MedicationHistorySection.tsx
│       └── PrescriptionTimelineSection.tsx
├── hooks/
│   └── usePharmacyListState.ts        # URL-owned q/filters/sort/page state
├── model/
│   ├── types.ts                       # Prescription + Medication + safety/notes/history/timeline + P8 meta maps
│   ├── catalogue.ts                   # 24-drug formulary reference data
│   ├── mock-data.ts                   # 520 seeded prescriptions from the shared roster
│   ├── filters.ts                     # Filter contract + active-chip mapping
│   └── selectors.ts                   # Pure search/filter/sort/summary functions
├── pages/
│   ├── PharmacyPage.tsx
│   └── PrescriptionDetailPage.tsx
├── routes.tsx                         # Lazy route objects with breadcrumb handles
└── index.ts                           # Public API: routes only
```

## Architecture

- **URL-owned list state** — search, all seven advanced filters, the two boolean
  toggles (high-risk / controlled), the `patient` deep-link filter, sort, page,
  and page size live in query params (validated on read, invalid → default), so
  every view is shareable and restorable. Filter changes reset pagination.
  Mirrors the Phase 6/7 pattern.
- **Pure model selectors** — `filterPrescriptions` / `sortPrescriptions` /
  `summarizePrescriptions` are pure functions over the dataset; they become
  server-side query params when the API lands without touching components.
- **Search** (debounced via `SearchBar`) matches patient name, MRN, prescription
  id, medication brand/generic name, and prescribing doctor.
- **List page** — six-card summary `StatisticCard` row (Total, Active, Pending
  refills, Expired, High-risk, New today); `FilterBar` with active chips +
  clear-all; refresh; Export placeholder; sticky-header sortable `DataTable`
  (12 columns) with row selection (bulk export placeholder), row-click
  navigation, and loading / empty / error / no-match states; `Pagination`;
  stacked `Card` list under `md`.
- **Detail page** — P2 layout: safety checks, medication details, dosage &
  administration, notes, and medication history in the main column; patient
  summary, prescription information, prescribing doctor, and the lifecycle
  timeline in a sticky summary column. Critical safety warnings surface as
  non-dismissible `Alert` banners under the header **and** in the safety
  section (DS §8.22 healthcare-alert rules). Loading skeleton, not-found, and
  error states mirror the Labs / Medical Record detail pages.
- **Statuses** — Active / Completed / Discontinued / Pending approval / Expired
  and the refill states (No refills / Available / Due / Pending) map onto the
  sanctioned P8 `StatusBadge` vocabulary (`PRESCRIPTION_STATUS_META`,
  `REFILL_STATUS_META`); no new color-status pairings. High-risk and controlled
  flags render as `Badge`s.

## Safety features UI

Frontend placeholders only — no clinical logic. Each prescription carries a
`warnings: SafetyWarning[]` array covering four kinds — **drug interaction**,
**allergy conflict**, **duplicate therapy**, and **dosage alert** — each with an
`info | warning | critical` severity. Allergy warnings are generated
deterministically when a medication's `allergyClass` matches the patient's real
allergy list from the shared roster (critical when the patient has a severe
allergy on record); the others are canned placeholders gated by probability. The
`SafetyWarningsSection` renders every warning as an inline `Alert`; critical
warnings additionally surface as non-dismissible error banners at the top of the
detail page, per the Design System healthcare-alert rules.

## Components used (existing only)

`DataTable`, `Pagination`, `Breadcrumb`, `Button`, `LinkButton`, `IconButton`,
`Dropdown`, `Tooltip`, `Drawer`, `Select`, `Input`, `Switch`, `Card`, `Avatar`,
`Badge`, `StatusBadge`, `StatisticCard`, `FilterBar`, `SearchBar`,
`Fact`/`FactGrid`, `ContentHeader`, `PageContainer`, `Stack`, `Grid`, `Section`,
`Alert`, `EmptyState`, `ErrorState`, `Skeleton`, plus the `useDisclosure` /
`useMediaQuery` hooks and `utils/dates` formatters. No new component was
introduced.

## Mock data model

`model/mock-data.ts` generates **520 deterministic prescriptions** with the
shared seeded PRNG (`mulberry32`), drawing patients from
`shared-domain/patient-identity` so names, MRNs, ids, and **allergies** stay
coherent with the Patients, Appointments, Medical Records, and Labs modules
(allergy warnings fire against the patient's real allergy list). Medications come
from `model/catalogue.ts` — 24 drugs across all twelve categories with generic
name, form, route, strengths, manufacturer, controlled/high-risk flags, and a
canned interaction note and allergy class.

The `Prescription` model mirrors the future list/detail DTO:

- **Order** — id, denormalized patient snapshot (incl. allergies), medication
  sub-object, dosage, frequency, route, duration, quantity, instructions,
  prescribing doctor, department, status, start/end dates, refills allowed /
  remaining, refill status.
- **Safety** — a `warnings` array (see above).
- **Notes, history, timeline** — prescriber/pharmacist notes, prior medication
  history entries, and a synthesized lifecycle timeline (prescribed → dispensed
  → refill events → discontinued/expired).

Clinical coherence rules: every ~16th prescription starts today (drives the "New
today" card); the rest spread over the past year. Status is date-coherent
(today's orders are active/pending-approval, ongoing courses active, ended
courses completed/expired/discontinued); controlled substances carry no refills;
refill status is only meaningful for active prescriptions; no date lands in the
future.

## Future API integration points

| Seam | Today | Later phase |
| --- | --- | --- |
| `api/usePrescriptionsQuery.ts` | `fetchPrescriptionsMock` / `fetchPrescriptionMock` over `MOCK_PRESCRIPTIONS` | Prescription list/detail endpoints + DTO→model mappers; keys (`prescriptionKeys`) unchanged |
| `model/selectors.ts` | Client-side filtering/sorting/summary | Server-side query params; components unaffected |
| `model/types.ts` | Mirrors the future list/detail DTOs | Replace with generated API types if desired |
| `model/catalogue.ts` | Static formulary reference data | Formulary endpoint |
| `SafetyWarning[]` | Canned frontend placeholders | Real interaction/allergy/duplicate/dosage screening service |
| Quick / row placeholder actions | Info toasts (AI medication review, Print prescription, Export PDF) | AI assistant + files service integration |

## Out of scope (per Phase 8 brief)

No prescribing/editing, no backend, no AI logic. AI medication review / Print
prescription / Export PDF and the list Export are placeholder toasts; the safety
checks are frontend placeholders. Quality gates: `npm run typecheck`,
`npm run lint`, and `npm run build` all pass with zero errors (the 12
react-refresh warnings are pre-existing and accepted). Verified in-app: the list
renders all 520 prescriptions with populated summary cards, working search /
filters / deep-links; the detail page renders every required section; and
critical safety warnings render as non-dismissible alert banners.
