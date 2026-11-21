# Phase 6 — Doctor Medical Records Module

Frontend-only implementation of the complete Medical Records module for the
Doctor dashboard: an enterprise records-management list at
`/doctor/medical-records` and a full clinical-document detail page at
`/doctor/medical-records/:recordId`. Built entirely from the Phase 1
component library over the shared patient domain — no new primitives, no
backend, no editing (read-only per scope).

## Routes

| Path | Page | Crumb |
| --- | --- | --- |
| `/doctor/medical-records` | `MedicalRecordsPage` (P1 list) | Medical records |
| `/doctor/medical-records/:recordId` | `MedicalRecordDetailPage` (P2 detail) | Record |

Registered in `src/app/router/index.tsx` as a lazy feature chunk
(`medicalRecordsRoutes`), with path constants in `src/routes/index.ts`
(`routes.doctor.medicalRecords`, `routes.doctor.medicalRecord(id)`).

**Access points**

- Sidebar: "Medical Records" item (FolderHeart icon, per the DS §icon table)
  after Appointments in `src/layouts/navigation.ts` — a config change only.
- Patient Profile: the identity-header "Medical record" button now navigates
  to `/doctor/medical-records?patient=<patientId>`, landing on the list
  pre-filtered to that patient (removable "Patient: <name>" chip).

## Folder structure

```
src/features/doctor/medical-records/
├── api/
│   └── useMedicalRecordsQuery.ts     # TanStack Query over mock data (list + detail)
├── components/
│   ├── MedicalRecordCells.tsx        # Patient / diagnosis / status / priority cells
│   ├── MedicalRecordRowActions.tsx   # Eye + ⋯ menu (view, patient, placeholders)
│   ├── MedicalRecordCardList.tsx     # <md stacked-card rendering of the list
│   ├── MedicalRecordsSummaryCards.tsx# Total / open / closed / critical / created-today
│   ├── MedicalRecordFiltersDrawer.tsx# Advanced filters (7 controls + date range)
│   ├── medical-record-table-columns.tsx # DataTable column factory (11 columns)
│   └── detail/
│       ├── RecordSectionCard.tsx     # Card+Section wrapper (uniform h2 sections)
│       ├── RecordQuickActions.tsx    # View patient · AI review · ⋯ (print/export/share)
│       ├── RecordPatientSummaryCard.tsx
│       ├── RecordVisitInfoCard.tsx
│       ├── RecordVitalsSection.tsx
│       ├── RecordDiagnosesSection.tsx
│       ├── RecordMedicationsSection.tsx
│       ├── RecordAllergiesSection.tsx
│       ├── RecordNotesSection.tsx
│       ├── RecordAttachmentsSection.tsx
│       └── RecordTimelineSection.tsx
├── hooks/
│   └── useMedicalRecordListState.ts  # URL-owned q/filters/sort/page state
├── model/
│   ├── types.ts                      # MedicalRecord + sub-documents + P8 meta maps
│   ├── mock-data.ts                  # 300 seeded records from the shared roster
│   ├── filters.ts                    # Filter contract + active-chip mapping
│   └── selectors.ts                  # Pure search/filter/sort/summary functions
├── pages/
│   ├── MedicalRecordsPage.tsx
│   └── MedicalRecordDetailPage.tsx
├── routes.tsx                        # Lazy route objects with breadcrumb handles
└── index.ts                          # Public API: routes only
```

## Architecture

- **URL-owned list state** — search, all seven advanced filters, the
  `patient` deep-link filter, sort, page, and page size live in query params
  (validated on read, invalid → default), so every view is shareable and
  restorable. Filter changes reset pagination. Mirrors the Phase 5 pattern.
- **Pure model selectors** — `filterRecords` / `sortRecords` /
  `summarizeRecords` are pure functions over the dataset; they become
  server-side query params when the API lands without touching components.
- **Search** (debounced via `SearchBar`) matches patient name, MRN,
  record ID, diagnosis label/ICD-10 code, and doctor.
- **List page** — summary `StatisticCard` row; `FilterBar` with active
  chips + clear-all; refresh; Export placeholder; sticky-header sortable
  `DataTable` with row selection (bulk export placeholder), row-click
  navigation, and loading / empty / error / no-match states; `Pagination`;
  stacked `Card` list under `md` so no functionality is lost on mobile.
- **Detail page** — P2 layout: clinical document (chief complaint, HPI,
  physical examination, vital signs, diagnoses, treatment plan, medications,
  allergies, clinical notes, attachments) in the main column; patient
  summary, visit information, and the record timeline in a sticky summary
  column. Allergies also render as the fixed non-dismissible `Alert` strip
  under the header (UX 1.5 rule 4). Loading skeleton, not-found, and error
  states mirror the Patient Profile page.
- **Statuses** — Draft / Active / Completed / Archived and priorities
  Low / Normal / High / Critical map onto the sanctioned P8 `StatusBadge`
  vocabulary (`RECORD_STATUS_META`, `RECORD_PRIORITY_META`); no new
  color-status pairings.

## Components used (existing only)

`DataTable`, `Pagination`, `Breadcrumb`, `Button`, `LinkButton`,
`IconButton`, `Dropdown`, `Tooltip`, `Drawer`, `Select`, `Input`, `Card`,
`Avatar`, `Badge`, `StatusBadge`, `StatisticCard`, `FilterBar`, `SearchBar`,
`Fact`/`FactGrid`, `ContentHeader`, `PageContainer`, `Stack`, `Grid`,
`Section`, `Alert`, `EmptyState`, `ErrorState`, `Skeleton`, plus the
`useDisclosure` / `useMediaQuery` hooks and `utils/dates` formatters.

## Mock data model

`model/mock-data.ts` generates **300 deterministic records** with the shared
seeded PRNG (`mulberry32`), drawing patients from
`shared-domain/patient-identity` so names, MRNs, and ids stay coherent with
the Patients and Appointments modules. Clinical coherence rules:

- Visit dates spread across the past two years; every ~20th record is
  created today (drives the "Created today" card).
- Status is time-coherent: today's visits are mostly draft/active, recent
  visits active/completed, old visits completed/archived; `updatedAt` never
  precedes `createdAt` nor lands in the future.
- 1–3 ICD-10 diagnoses per record (first is primary) from a canonical
  vocabulary shared with the diagnosis filter; chief complaints are keyed to
  the primary diagnosis.
- Allergies derive from the patient's roster allergens; the timeline is
  synthesized from the record's actual content (creation, vitals, diagnosis,
  medications, notes, attachments, status changes).

## Future API integration points

| Seam | Today | Phase 7+ |
| --- | --- | --- |
| `api/useMedicalRecordsQuery.ts` | `fetchRecordsMock` / `fetchRecordMock` over `MOCK_MEDICAL_RECORDS` | Records list/detail endpoints + DTO→model mappers; keys (`medicalRecordKeys`) unchanged |
| `model/selectors.ts` | Client-side filtering/sorting/summary | Server-side query params; components unaffected |
| `model/types.ts` | Mirrors the future list/detail DTOs | Replace with generated API types if desired |
| Row/detail placeholder actions | Info toasts (Print, Export PDF, Share, AI review, attachment view/download) | Files service + AI assistant integration |

## Out of scope (per Phase 6 brief)

No editing, no backend, no AI logic. Print/Export/Share/AI-review and the
list Export are placeholder toasts. Quality gates: `npm run typecheck`,
`npm run lint`, and `npm run build` all pass with zero errors (the 12
react-refresh warnings are pre-existing and accepted).
