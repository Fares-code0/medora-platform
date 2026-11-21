# Phase 5 — Doctor Appointments Module

**Status:** Complete · **Depends on:** the four FINAL docs (v1.0.0) · Phases 0–4

Implements the **Appointments module** (UX 2.4) at `/doctor/appointments`: list + Day/Week/Month
calendar views, details drawer with deep links, and the full frontend action set (approve /
reject / cancel / reschedule / complete / no-show) over a mutable in-memory mock store. Frontend
only — no backend, no real scheduling logic. Verified: `npm run typecheck` (0 errors) ·
`npm run lint` (0 errors) · `npm run build` (success — `AppointmentsPage` is its own ~43 kB lazy
chunk).

---

## 1. Architecture

### shared-domain promotion (the Phase 5 refactor)

Appointments needs the same patient identities as the Patients module, and features may only
share through `shared-domain` (FRONTEND_ARCHITECTURE §3.3). The patient identity model therefore
moved to its sanctioned home:

```
src/features/shared-domain/patient-identity/
├── index.ts        # PUBLIC API — the only cross-feature import point
├── types.ts        # Patient, PatientStatus, RiskLevel, BloodType + P8 metadata maps
├── roster.ts       # MOCK_PATIENTS (120 seeded), name pools, DOCTORS
└── rng.ts          # mulberry32 / hashString / pick / weighted / isoDaysFromNow
```

The patients feature now imports from this public API (16 import rewrites, no behavior change).
`Fact`/`FactGrid` was likewise promoted to `@/components/patterns` when appointments became its
third consumer (§8.2 rule of three).

### Feature module

```
src/features/doctor/appointments/
├── index.ts / routes.tsx           # lazy routes: /doctor/appointments and
│                                   #   /doctor/appointments/:appointmentId (drawer deep link)
├── pages/AppointmentsPage.tsx      # one URL-driven surface, four views
├── api/useAppointmentsQuery.ts     # TanStack Query + mutation over a session-lifetime
│                                   #   in-memory store (actions genuinely mutate state)
├── model/
│   ├── types.ts                    # Appointment, status/priority/action metadata,
│   │                               #   availableActions() — the typed status machine (§9.2)
│   ├── mock-data.ts                # 320 seeded, time-coherent appointments
│   ├── calendar.ts                 # pure date math: date keys, week/month grids, slot mock
│   ├── filters.ts                  # filter contract + active-chip labels
│   └── selectors.ts                # search / filter / sort / summary derivations
├── hooks/useAppointmentListState.ts# URL params: view, date, q, 9 filters, sort, page
└── components/
    ├── AppointmentsSummaryCards    # 6 StatisticCards (today/upcoming/completed/…)
    ├── appointment-table-columns   # 12-column DataTable config (factory over callbacks)
    ├── AppointmentCells / AppointmentRowActions / AppointmentCardList (<md cards)
    ├── AppointmentFiltersDrawer    # 8 filters + New-patient / Follow-up checkboxes
    ├── AppointmentDetailsDrawer    # P3 drawer: patient block, facts, reason, notes,
    │                               #   attachments placeholder, status-machine action footer
    ├── ReasonDialog                # P4 confirm-with-reason (Modal + Select + Textarea)
    ├── RescheduleDialog            # date input → mock slot grid → ConfirmationDialog
    └── calendar/                   # DateNavigator + Day / Week / Month views + card
```

**Views.** `?view=list|day|week|month` (UX §1.3). List is the P1 table (sortable, selectable,
sticky header, pagination, loading/empty/error; stacked cards below `md`). Day = 30-minute
timeline 08:00–18:00; Week = Monday-first 7-column card grid (today highlighted, horizontal
scroll below `lg`); Month = density grid with up to 3 chips per cell + "+N more" jumping to the
day view. All views render the same filtered dataset; the ‹ Today › navigator + native date
input anchor the calendar and are shareable via `?date=`.

**Actions.** `availableActions(appointment)` is the single status machine — pending → approve /
reject; scheduled/confirmed/rescheduled → reschedule / cancel (+ complete / no-show once the slot
has started); terminal states offer nothing. Reject and cancel use the P4 reason dialog; complete
and no-show use `ConfirmationDialog`; approve is one-click (UX 2.4). Mutations run pessimistically
against the mock store, invalidate the query, and toast success/failure.

**Reschedule flow.** Date picker (native input via the DS `Input`) → mock availability grid
(16 half-hour Chips; slots holding a real appointment that day are blocked — genuine conflict
detection against the dataset — plus a seeded pseudo-busy pattern) → summary → explicit
`ConfirmationDialog` → mutation sets `status: 'rescheduled'` + the new `dateTime`.

## 2. Mock data model

`Appointment`: id (`APT-3001`+), **denormalized patient snapshot** (id/name/MRN/phone/age/gender —
exactly as a list DTO would carry it, drawn from the shared roster so "View patient" lands on the
matching profile), dateTime, durationMin, visitType, department, doctor, status, priority,
isNewPatient, isFollowUp, reason, notes. 320 appointments spread −60…+45 days with today
over-represented; statuses are **time-coherent** (past → completed/cancelled/no-show, today →
live mix, future → scheduled/confirmed/pending/rescheduled). Status → P8: scheduled=info,
confirmed=success, pending=warning, completed=neutral, cancelled=error, rescheduled=warning,
no-show=error. Priority → P8: low=neutral, normal=success, high=warning, urgent=error.

## 3. Future API integration points

| Seam | Today | Later |
|---|---|---|
| `fetchAppointmentsMock` / `updateAppointmentMock` | In-memory Map with 400 ms latency | `api/endpoints/appointments.*` + DTO mappers; list params join the query key for server-side filtering |
| `slotAvailabilityFor` | Real same-day conflicts + seeded pseudo-busy | Availability endpoint from the doctor's working-hours settings |
| Optimistic updates | Deliberately pessimistic | Accept/reject gain the UX-specced optimistic + rollback behavior once the server contract exists |
| Reason capture | Stored into `notes` on the mock record | Dedicated reason field + audit dispatcher (`useAuditedAction`) |
| Export / New appointment / Block time off | Info toasts | Export service; booking flow; UX 2.4 emergency-unavailability flow |

Known placeholders: attachments section in the drawer (files service), drag-to-reschedule
(replaced by the tap → Reschedule flow, which UX §5.2 mandates for touch anyway), the DS
`Calendar` primitive (DS §8.30) — these calendar views are feature components; the reusable
primitive remains a DS-governance item for Phase 5+ consumers to extract.
