# Stabilization Pass — Post Phase 16

A focused bug-fix and integration pass over the doctor app. No redesign, no new
phase — just making existing functionality behave like a production application.
Everything landed as one commit on `claude/doctor-lab-system-phase-7-c1f15a`.

---

## Fixed issues

### Bug 1 — Global profile synchronization (HIGH)
The doctor's identity is now a single source of truth. A new app-level
**`DoctorProfileProvider`** (`src/app/providers/DoctorProfileProvider.tsx`) owns
the profile (name, photo, title, specialty, department, biography, contact, …),
persisted per user (`medora.<userId>.doctorProfile`). The Settings profile editor
writes to it; the navbar avatar menu, sidebar user card, dashboard greeting, and
AI assistant all read from it. Editing the name/photo in Settings updates every
surface immediately. The `DoctorProfile` type moved out of the settings feature
to the provider (the shared source of truth) — no duplicated profile state.

### Bug 2 — Profile photo editor
The upload flow now opens a real **canvas image editor** (`ProfilePhotoField`):
move (drag), zoom (slider + buttons), center, reset, a circular crop guide, live
canvas preview, cancel, and save. On save it renders the chosen crop to a
circular 256×256 PNG data URL; the avatar then updates everywhere via the profile
store. No dependency — plain canvas + pointer events.

### Bug 3 — Report category focus
Selecting a category now focuses the page on **only that domain's analytics**.
A `CATEGORY_VIEW` map (`reports/model/types.ts`) declares each category's charts,
trend series, KPIs, and insight kinds. Laboratory shows only lab analytics,
Pharmacy only pharmacy, Appointments only appointments, etc. Overview remains the
single cross-practice summary. No mixed, unrelated charts.

### Bug 4 — Report filters
Removed the **Patient** and **Doctor** filters entirely (model, drawer, chips,
filter multiplier) — a doctor only sees their own analytics. Kept the meaningful
filters: Date range, Department, Status, Medication, Lab test, Age band, Gender,
Category.

### Bug 5 — Add Appointment
The button opens a real **modal** (`AddAppointmentDialog`): patient picker, date,
time, duration, visit type, department, priority, reason. Validated, persisted to
the appointments mock store (`useCreateAppointmentMutation`), instant list update
via query invalidation, and a success toast.

### Bug 6 — Add Patient
The button opens a full **registration modal** (`AddPatientDialog`): name, DOB,
gender, phone, email, address, blood type, insurance, medical notes. Validated
(required fields + email format), persisted to a new mutable patients store
(`useCreatePatientMutation`), instant list refresh, and a success toast. The
`Patient` model gained optional `email` / `address` / `insurance` / `medicalNotes`.

### Bug 7 — Export
A new dependency-free **export engine** (`src/utils/export.ts`) produces real
output: CSV (with BOM), Excel (`.xls`, Excel-readable), a hand-rolled valid PDF,
and Print (isolated iframe → browser print dialog). A shared **`ExportButton`**
pattern (CSV / Excel / PDF / Print dropdown) is wired into Patients, Appointments,
Labs, Pharmacy, Medical Records, "export selected" bulk actions, and the Reports
export dialog. No fake dialogs.

### Bug 8 — Global action buttons
The reported dead buttons (Add appointment, Add patient, Export) now perform real
actions. Dashboard quick actions navigate to their sections; the Patients "New
appointment" navigates to Appointments. Remaining not-yet-built actions (Block
time off, Import patients, some row-level actions) show a clear "coming in a later
phase" toast — marked Coming Soon, never silently dead.

### Bug 9 — Settings
Every settings control already updates real application state (Phase 15): theme,
density, font size, high contrast, reduce motion, focus/keyboard, notification
channels/categories, privacy toggles, workflow preferences, integrations,
security actions — all persisted and applied live. Verified; no fake controls.

### Bug 10 — Toasts
Every new create/save/export shows a success toast; validation errors render
inline on the fields; destructive actions (delete account, disconnect, revoke
sessions, cancel/reject appointment) go through confirmation dialogs.

---

## Files created
- `src/app/providers/DoctorProfileProvider.tsx` — the profile source of truth
- `src/features/doctor/settings/components/ProfilePhotoField.tsx` — canvas photo editor
- `src/features/doctor/appointments/components/AddAppointmentDialog.tsx`
- `src/features/doctor/patients/components/AddPatientDialog.tsx`
- `src/utils/export.ts` — CSV / Excel / PDF / Print engine
- `src/components/patterns/ExportButton.tsx` — shared export control
- `STABILIZATION_POST_PHASE16.md`

## Files modified (key)
- `src/app/providers/index.tsx` — mount + export the profile provider
- `src/layouts/Navbar/AvatarMenu.tsx`, `src/layouts/Sidebar/AppSidebar.tsx` — read profile
- `src/features/doctor/dashboard/pages/OverviewPage.tsx`, `.../ai/pages/AiAssistantPage.tsx` — read profile
- `src/features/doctor/settings/**` — profile moved to provider; `saveProfile` → `recordProfileUpdate`; ProfileSection uses the provider + new photo editor; PrivacySection export uses provider
- `src/features/doctor/reports/**` — `CATEGORY_VIEW` focus; removed Patient/Doctor filters; export dialog uses the real engine; messages/AI/records series added
- `src/features/doctor/appointments/**`, `.../patients/**` — create mutations + dialogs + real export wiring
- `src/features/doctor/{labs,pharmacy,medical-records}/pages/*` — real export
- `src/features/shared-domain/patient-identity/types.ts` — optional patient fields
- `src/components/patterns/index.ts` — export `ExportButton`

## Browser verification
- **Profile sync:** changed the name in Settings → navbar, sidebar, dashboard greeting, and localStorage all updated instantly.
- **Reports focus:** Laboratory renders only "Lab orders by status"; filters drawer shows no Patient/Doctor.
- **Add Appointment:** picked a patient, submitted → dialog closed, success toast, appointment persisted.
- **Add Patient:** filled name/DOB/phone, submitted → "Patient added" toast, new patient appears in the list.
- **Export:** captured a real CSV blob (`text/csv`, correct headers, 6 rows) and a valid PDF blob (`%PDF-1.4` … `%%EOF`); dropdown offers CSV / Excel / PDF / Print.
- **Zero console errors** throughout.

## Quality gates
| Gate | Result |
| --- | --- |
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 errors (19 accepted `react-refresh/only-export-components` warnings) |
| `npm run build` | success |

## Commit
Single commit: **Stabilize Profile Reports Actions and Global Integration**

## Branch / worktree confirmation
No new branch, no worktree, no clone, no merge — all work was committed on the
existing `claude/doctor-lab-system-phase-7-c1f15a`.
