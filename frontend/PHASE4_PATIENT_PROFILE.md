# Phase 4 — Doctor Patient Profile

**Status:** Complete · **Depends on:** the four FINAL docs (v1.0.0) · Phases 0–3

Implements the **Patient Profile** (UX 2.3, pattern P2) at `/doctor/patients/:patientId` on
deterministic mock data. Read-only by scope: no record editing, no labs logic, no AI logic.
Verified: `npm run typecheck` (0 errors) · `npm run lint` (0 errors) · `npm run build` (success —
`PatientProfilePage` is its own ~41 kB lazy chunk).

---

## 1. Architecture

The profile extends the existing `features/doctor/patients` module (the Phase 3 list feature) as
a second lazy route. FRONTEND_ARCHITECTURE §3.1 ultimately assigns the record *viewer/editor* to
`features/doctor/medical-records`; since Phase 4 is a read-only profile with placeholder record
surfaces, it stays with the patient domain that owns its data. When medical-records lands
(Phase 7), the record-centric tab panels migrate there and the shared patient identity pieces
move to `shared-domain/patient-identity` per §3.3 — documented here so the split is deliberate,
not drift.

```
src/features/doctor/patients/
├── routes.tsx                          # now exports [list, profile] lazy routes
├── api/
│   └── usePatientProfileQuery.ts       # TanStack Query detail(id) over a mock fetcher
├── model/
│   ├── rng.ts                          # seeded PRNG helpers (shared by both generators)
│   ├── profile-types.ts                # full profile domain model + P8 metadata maps
│   └── profile-mock-data.ts            # deterministic per-patient profile generator
├── pages/
│   └── PatientProfilePage.tsx          # P2 composition: header · sidebar · 9 tabs
└── components/
    ├── FactList.tsx                    # shared label/value pattern (also refactored into
    │                                   #   PatientCardList — one implementation)
    └── profile/
        ├── PatientIdentityHeader.tsx   # photo, h1, key facts, badges, quick actions,
        │                               #   FIXED non-dismissible allergy strip (UX 1.5)
        ├── PatientSummarySidebar.tsx   # persistent summary column (sticky lg+)
        ├── ProfileSummaryCards.tsx     # Allergies / Medications / Emergency / Insurance /
        │                               #   Upcoming cards — shared by sidebar & Overview
        ├── OverviewTab.tsx             # alerts-first clinical snapshot
        ├── HistoryTab.tsx              # timeline (diagnoses/surgeries/procedures/
        │                               #   hospitalizations/vaccinations)
        ├── MedicationsTab.tsx          # DataTable: name/dosage/frequency/dates/prescriber/status
        ├── AllergiesTab.tsx            # critical Alert + DataTable
        ├── StudyCategoriesTab.tsx      # ONE component for Labs & Imaging placeholder cards
        ├── AppointmentsTab.tsx         # Upcoming + Previous DataTables
        ├── NotesTab.tsx                # authored/signed note timeline
        └── DocumentsTab.tsx            # files table with View/Download placeholders
```

**Layout & routing.** The identity header renders the page `h1` with status/risk badges and the
allergy strip (severe → non-dismissible error Alert — visible from every tab, per the UX 1.5
"critical information cannot be missed" rule, reinforced by a second critical Alert inside the
Allergies tab). On `lg+` the summary sidebar is a sticky 4-column rail beside the 8-column tab
area; below `lg` content stacks tabs-first with the summary after (UX §5.2). The active tab lives
in `?tab=` (validated; invalid → overview), so the Phase 3 row action "Open medical record"
(`?tab=history`) deep-links correctly. "View Profile" from the patients list navigates here via
`routes.doctor.patient(id)` — already wired in Phase 3, now landing on the real page.

## 2. Components used (all existing — nothing new in the design system)

`PageContainer` · `Stack` · `Grid` · `Section` · `Card` · `Avatar` · `Badge` · `StatusBadge` ·
`Breadcrumb` · `Tabs` (line variant, 9 items, overflow scroll, only the active panel renders) ·
`DataTable` (medications, allergies, appointments ×2, documents) · `Button` / `IconButton` /
`LinkButton` / `Dropdown` / `Tooltip` · `Alert` (critical, non-dismissible) · `EmptyState` /
`ErrorState` / `Skeleton` · `Divider` · toasts via `useToast`. States: full-page skeleton while
loading, "Patient not found" empty state for unknown ids, section `ErrorState` + Retry for load
failures (identity is required context — no partial header rendering).

## 3. Mock data structure

`PatientProfile` (in `profile-types.ts`) bundles: `summary` (generated clinical one-liner) ·
`vitals` (BP/HR/temp/RR/SpO₂/weight/height/BMI + recordedAt) · `allergies` (severity, reaction,
notes) · `medications` · `history` events · `labCategories` + `imagingCategories` (4 fixed
categories each, per the Phase 4 spec) · `appointments` · `notes` · `documents` ·
`emergencyContact` · `insurance` · `alerts`. All statuses map onto the P8 StatusBadge vocabulary
via metadata maps (`ALLERGY_SEVERITY_META`, `MEDICATION_STATUS_META`, `STUDY_STATUS_META`,
`APPOINTMENT_STATUS_META`); no new color-status pairing exists.

The generator (`profile-mock-data.ts`) is **seeded from the patient id** (FNV-1a hash →
mulberry32), so a profile is identical on every visit and clinically coherent with the Phase 3
roster row: medications derive from the patient's chronic conditions (diabetes → Metformin…),
severe allergies produce the critical alert, critical-risk patients get hospitalization events
and possible critical lab flags, and the upcoming appointment matches the list's
`nextAppointment`. Shared PRNG helpers were extracted to `model/rng.ts` (the Phase 3 roster
generator now imports them — no duplication).

## 4. Future API integration points

| Seam | Today | Later |
|---|---|---|
| `usePatientProfileQuery` | `patientKeys.detail(id)` + mock fetcher (450 ms, `PATIENT_NOT_FOUND` rejection) | Swap fetcher for the profile endpoints + DTO→model mappers; per-tab queries can split out under the same key family for lazy per-tab fetching (UX 2.3) |
| `profile-mock-data.ts` / `rng.ts` | Deterministic fixtures | Deleted (or moved into the Phase 6 MSW fixture suite) |
| Lab / imaging "View result/report" | Info toast | P3 record drawer from the labs feature |
| Document View/Download | Info toast | Files service (§12.4 rules) |
| Header quick actions | Navigate to section placeholders / `?patientId=` deep links | Fully functional as appointments/messages/assistant land |
| More-menu (Print, Export PDF, Report record issue) | Info toasts | Export service + admin flag pipeline (UX 2.3) |

Known placeholders beyond the table above: AI summary panel (UX 2.3 Overview "✦ Summarize") is
deliberately absent until the AI feature phase; note editing/signing, record editing, uploads,
and the imaging viewer are Phase 7 medical-records scope.
