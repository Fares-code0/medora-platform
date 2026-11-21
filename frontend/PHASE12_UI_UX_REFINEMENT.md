# Phase 12 — UI/UX Refinement & Mock Data Optimization

Phase 12 is a polish pass, not a feature phase: the whole UI steps down one
more density notch, every module gets a layout composition of its own, and
the mock data layer shrinks from ~1,300 generated records to five canonical
entities per module — reused consistently across the entire application.
No feature, workflow, or interaction was removed.

---

## 1. Typography & scale changes

The token scale (13px body, 11px caption) set in the previous pass is kept;
this phase reduces the remaining oversized surfaces at the component level:

| Surface              | Before        | After         |
| -------------------- | ------------- | ------------- |
| Page title (h1)      | 15/18px       | 15/16px       |
| Card title           | 15px (h4)     | 14px (h5)     |
| KPI value            | 22px          | 20px          |
| Header identity chip | 36px, 18px icon | 32px, 16px icon |

## 2. Component density changes

| Component        | Before                     | After                     |
| ---------------- | -------------------------- | ------------------------- |
| Buttons          | 28 / 32 / 40px             | 28 / 32 / 36px            |
| Icon buttons     | 28 / 32 / 40px             | 28 / 32 / 36px            |
| Inputs           | 36px md / 40px lg          | 32px md / 36px lg         |
| Badges           | 20px, px-8                 | 18px, px-6                |
| Chips            | 32px, px-12                | 24px, px-10               |
| Card padding     | 20px (16px compact)        | 16px (14px compact)       |
| Table rows       | 44px (36px dense)          | 40px (32px dense)         |
| Table header row | 36px                       | 32px                      |
| Table cell pad   | py-8                       | py-6                      |
| Sidebar          | 232px, 36px items, 18px icons | 224px, 32px items, 16px icons |
| Top navbar       | 48 / 56px                  | 48 / 52px                 |

Everything remains ≥ 11px text and ≥ 24px interactive height, so the result
is dense-but-scannable rather than tiny.

## 3. Layout & module identity improvements

The "header → six identical cards → table" template is gone. Each module
now has its own composition on top of the shared tone system (Patients =
blue, Records = teal, Labs = cyan, Pharmacy = green, Appointments = amber,
Notifications = rose, AI = violet):

- **Dashboard** — executive overview (unchanged this phase): toned KPI row,
  schedule + action rail, Practice-pulse metric list, chart slots.
- **Patients** — *registry*: one horizontal `MetricStrip` band, then the
  filter bar and the roster table as the hero.
- **Medical Records** — *document workspace*: on xl the metrics stack in a
  right-hand metadata rail (1 column) beside the records table (3 columns).
- **Laboratory** — *analytics*: keeps the six-cell KPI band (single row on
  xl) above the results table — the only module with the full stat-card row.
- **Pharmacy** — *medication safety*: two grouped panels ("Prescription
  volume" green-accented, "Medication safety" red-accented) with hairline
  metric rows instead of a KPI grid.
- **Appointments** — *schedule*: a compact `MetricStrip` band so the
  calendar/list switcher is the dominant surface.
- **Notifications** — *activity*: a compact `MetricStrip` band with the
  inbox immediately below.
- **AI Assistant** — conversational layout (unchanged), violet identity.

New shared pattern: `src/components/patterns/MetricStrip.tsx` — a single
bordered band of hairline-divided metric cells (icon + label + value) used
by the registry-style modules. `DataTable` selected rows keep the inset
primary bar; sticky headers now sit on a hairline border.

## 4. Mock data optimization

The generated datasets (120 patients, 520 labs, 520 prescriptions, 300
records, 320 appointments, 64 notifications) are replaced by **five
canonical entities per module**, reused consistently everywhere:

- **5 patients** (`shared-domain/patient-identity/roster.ts`, now
  hand-authored): Khaled Nassar, Mona Adel, Amira Saleh, Omar Farouk,
  Layla Mansour — the same five people the dashboard schedule, activity
  feed, and notifications already referenced.
- **5 doctors**: Dr. Amelia Chen (the signed-in demo doctor — generators
  that previously said "Dr. Amira Hassan" now attribute work to the actual
  logged-in user), plus four colleagues.
- **5 medications** (pharmacy catalogue): Amoxicillin, Metformin,
  Atorvastatin, Warfarin, Levothyroxine.
- **5 lab catalogue tests**: CBC, HbA1c, Basic Metabolic Panel, Lipid
  Panel, Thyroid Panel.
- **5 rows per list** (labs, prescriptions, medical records, appointments,
  notifications) — one per patient, driven by small `SEED_PLAN` tables so
  the tiny datasets still demonstrate every lifecycle state:
  - Labs: ordered / collected / processing / completed ×2, including
    **Omar Farouk's critical potassium 6.1 mmol/L** matching the dashboard
    alert and the "live" notification delivery.
  - Pharmacy: active, started-today, pending-refill, high-risk (Warfarin),
    and expired — **Mona Adel's Amoxicillin trips her recorded Penicillin
    allergy**, keeping the safety-warning demo alive.
  - Records: draft / active / completed / archived plus one critical case.
  - Appointments: exactly the dashboard's "Today's schedule" five.
- Dashboard KPIs/copy were re-pointed at the small practice (5 patients,
  1 pending request) and the localStorage notification store key was bumped
  (`medora.notifications.v2`) so stale 64-item snapshots are discarded.
- Patient-profile content is derived from each patient's own conditions
  and allergies, so it shrank automatically.

Functionality is identical: search, filters, sorting, pagination, bulk
selection, calendars, detail pages, safety warnings, deep links
(`?patient=<id>`), and the notification polling/live-delivery seam all
work against the reduced data.

## 5. Files changed

**Created**

- `src/components/patterns/MetricStrip.tsx`
- `PHASE12_UI_UX_REFINEMENT.md`

**Design system / patterns**

- `src/components/ui/internal/styles.ts`, `Card.tsx`, `Badge.tsx`,
  `Chip.tsx`, `DataTable.tsx`, `Sidebar.tsx`, `TopNavbar.tsx`
- `src/components/layout/ContentHeader.tsx`
- `src/components/patterns/StatisticCard.tsx`, `patterns/index.ts`

**Module layouts**

- `patients/components/PatientsSummaryCards.tsx`
- `notifications/components/NotificationSummaryCards.tsx`
- `appointments/components/AppointmentsSummaryCards.tsx`
- `pharmacy/components/PharmacySummaryCards.tsx`
- `medical-records/components/MedicalRecordsSummaryCards.tsx`
- `medical-records/pages/MedicalRecordsPage.tsx`

**Mock data**

- `shared-domain/patient-identity/roster.ts`
- `labs/model/catalogue.ts`, `labs/model/mock-data.ts`
- `pharmacy/model/catalogue.ts`, `pharmacy/model/mock-data.ts`
- `medical-records/model/mock-data.ts`
- `appointments/model/mock-data.ts`
- `notifications/model/mock-data.ts`, `notifications/model/store.ts`
- `dashboard/model/mock-data.ts`, `dashboard/pages/OverviewPage.tsx`

## 6. Verification & quality gates

- `npm run typecheck` — 0 errors
- `npm run lint` — 0 errors (14 pre-existing accepted react-refresh warnings)
- `npm run build` — clean production build
- Manual browser pass (signed in as `doctor@medora.health`): dashboard,
  patients, records (rail layout), labs (critical potassium on LAB-100004),
  pharmacy (allergy warning on RX-200002), appointments, notifications
  (5-item inbox + live delivery), AI. Screenshots are unavailable in this
  environment (browser-pane screenshots time out); verification was done
  via DOM/computed-style inspection.
