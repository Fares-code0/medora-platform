# Medora UX Architecture — Doctor & Administrator Dashboards

**Version 1.0.0** · **Status:** Draft for approval · **Owners:** Product Design Team
**Scope:** Doctor Dashboard and Administrator Dashboard only. Patient and Receptionist experiences are explicitly out of scope for this document.
**Depends on:** `DESIGN_SYSTEM.md` v1.0.0 (all components, tokens, motion, and accessibility rules referenced here are defined there).

---

## Table of Contents

1. [Foundations](#1-foundations)
   - 1.1 Personas & Jobs-to-be-Done
   - 1.2 Shared Application Shell
   - 1.3 Route Map
   - 1.4 Cross-Cutting Patterns
   - 1.5 Medical Data Safety Principles
2. [Doctor Dashboard](#2-doctor-dashboard)
   - 2.1 Overview (Home)
   - 2.2 Patients
   - 2.3 Patient Profile
   - 2.4 Appointments
   - 2.5 AI Medical Assistant
   - 2.6 Lab Systems
   - 2.7 Pharmacy
   - 2.8 Messages
   - 2.9 Notifications
   - 2.10 Reports & Analytics
   - 2.11 Doctor Settings
3. [Administrator Dashboard](#3-administrator-dashboard)
   - 3.1 Overview (Home)
   - 3.2 Doctors Management
   - 3.3 Doctor Profile (Admin View)
   - 3.4 Patients Management
   - 3.5 Appointment Management
   - 3.6 Communication Monitoring
   - 3.7 System Logs
   - 3.8 Reports
   - 3.9 Admin Settings
4. [Motion & Interaction](#4-motion--interaction)
5. [Responsive Design](#5-responsive-design)
6. [State Matrix Summary](#6-state-matrix-summary)
7. [Implementation Notes](#7-implementation-notes)

Every functional section in Parts 2 and 3 follows the same specification template: **Purpose · User goal · Layout · Components · Data displayed · User actions · Empty / Loading / Error states.**

---

# 1. Foundations

## 1.1 Personas & Jobs-to-be-Done

### Dr. Amira Hassan — Attending Physician (Doctor Dashboard)
- Sees 18–30 patients/day; interacts with the platform in 30–90 second bursts between consultations.
- **Top jobs:** "Show me my day at a glance" · "Get me to this patient's full context in under 5 seconds" · "Let me act on requests (accept / reschedule) without leaving my flow" · "Draft my documentation faster without compromising accuracy."
- **Design consequences:** the Doctor Dashboard optimizes for *speed-to-context* and *low interaction cost*. Every frequent action is reachable in ≤ 2 clicks from Overview. Dense but calm layouts; keyboard-first affordances (`Ctrl+K` everywhere).

### Karim Nasser — Platform Administrator (Admin Dashboard)
- Manages doctor onboarding/verification, monitors platform health and security, handles escalations. Sessions are longer (15–60 min) and audit-oriented.
- **Top jobs:** "Is the platform healthy and secure right now?" · "Process the doctor verification queue" · "Investigate an incident with a complete audit trail" · "Report growth and utilization to leadership."
- **Design consequences:** the Admin Dashboard optimizes for *oversight and traceability*: tables, filters, logs, exports. Admin sees operational metadata by default, and clinical content only through permission-gated, audit-logged elevation (see 1.5).

## 1.2 Shared Application Shell

Both dashboards share one shell so users who hold both roles experience a single product. All measurements come from the Design System.

```
┌────────────────────────────────────────────────────────────────┐
│ Navbar (64px): [☰] [Breadcrumb]      [Global Search ⌘K]        │
│                              [AI ✦] [🔔 badge] [Avatar menu]   │
├──────────┬─────────────────────────────────────────────────────┤
│ Sidebar  │ Page Header: H1 · subtitle · [page-level actions]   │
│ 264px    ├─────────────────────────────────────────────────────┤
│ (64px    │                                                     │
│ rail     │ Content Area                                        │
│ when     │ container-2xl (1440px max) for data-dense pages     │
│ collapsed│ container-xl (1280px) for forms/settings            │
│ )        │ padding: 32px desktop / 24px tablet / 16px mobile   │
├──────────┤                                                     │
│ Settings │                                                     │
│ Help     │                                                     │
│ UserCard │                                                     │
└──────────┴─────────────────────────────────────────────────────┘
```

**Shell rules**

| Region | Behavior |
|---|---|
| Sidebar | Role-specific menu (2.x vs 3.x below), identical structure and interaction. Active item: `primary-subtle` bg + 3px left bar. Collapse state persists per user. Badge counts (Messages, Notifications, Pending) render as count badges, max display "99+". |
| Navbar | Global search is scoped by role (doctor: patients/appointments/records; admin: doctors/patients/logs). AI entry point (✦, accent violet) appears **only** in the Doctor shell — AI assistant is a clinical tool, not an admin tool. Notification bell opens a 400px popover (recent 10) with "View all" to the Notifications page. Avatar menu: profile, theme toggle (light/dark/system), settings, sign out. |
| Page header | One `h1` per page, optional caption below, page actions right-aligned (max 1 primary + 2 secondary; overflow into a `⋯` dropdown). Breadcrumb appears for any page deeper than one level. |
| Theme | Light/dark per Design System semantic tokens. Toggle lives in Avatar menu and Settings → Appearance; choice persists per user and syncs `prefers-color-scheme` when set to "System". |

## 1.3 Route Map

Routes are the implementation contract for React Router. Deep-linkable state (tabs, filters, pagination) is encoded in URL params so every view is shareable and restorable.

```
/doctor
  /doctor/overview                     (alias: /doctor)
  /doctor/patients                     ?q=&status=&sort=&page=
  /doctor/patients/:patientId          ?tab=overview|history|visits|prescriptions|labs|imaging|documents|notes
  /doctor/appointments                 ?view=list|day|week|month&date=&status=
  /doctor/appointments/:appointmentId
  /doctor/assistant                    ?conversationId=&patientId=
  /doctor/labs                         ?q=&patientId=&type=&from=&to=&flag=
  /doctor/labs/:reportId
  /doctor/pharmacy                     ?tab=prescriptions|new|database&status=
  /doctor/pharmacy/prescriptions/:rxId
  /doctor/messages                     /doctor/messages/:conversationId
  /doctor/notifications                ?category=&unread=
  /doctor/reports                      ?range=&compare=
  /doctor/settings/:section            profile|appearance|availability|security|notifications|privacy

/admin
  /admin/overview                      (alias: /admin)
  /admin/doctors                       ?q=&specialty=&verification=&status=&page=
  /admin/doctors/:doctorId             ?tab=profile|documents|activity|appointments|statistics
  /admin/patients                      ?q=&status=&page=
  /admin/patients/:patientId           ?tab=profile|activity|permissions
  /admin/appointments                  ?status=&doctorId=&from=&to=&flag=
  /admin/communications                ?tab=overview|logs|flags
  /admin/logs                          ?actor=&type=&severity=&from=&to=&q=
  /admin/reports                       ?report=&range=
  /admin/settings/:section             system|roles|security|notifications|appearance|integrations
```

Guards: routes under `/doctor` require the `doctor` role; `/admin` requires `admin`. Unauthorized access renders the 403 page pattern (DS 8.33). Unknown routes render 404. After login, users land on their role's Overview.

## 1.4 Cross-Cutting Patterns

These patterns are defined once and reused by every section; individual sections reference them instead of re-specifying.

**P1 — Data Table page.** Page header + toolbar row (search input · filter chips · filter button opening a filter drawer · optional view switch · primary action) + DS Table (8.19) + Pagination (8.26). Filters materialize as removable Chips under the toolbar; "Clear all" appears with ≥ 2 active filters. Column sort state in URL. Bulk selection reveals a contextual action bar that slides up from the table footer.

**P2 — Detail page.** Breadcrumb + identity header (avatar/icon, title, status badges, key facts, actions) + Tabs (8.20) with lazy-loaded panels. Left summary column (4 cols) + tabbed content (8 cols) on `lg+`; stacked below.

**P3 — Record drawer.** Clicking a row where the user likely needs list context (labs, appointments, log entries) opens a right Drawer (8.15, md 480px) with the record's detail and a "Open full page" link. Full navigation happens only on explicit intent.

**P4 — Confirm-with-reason modal.** Any action that affects another human (reject, cancel, revoke, suspend) uses a `sm/md` Modal: consequence-stating title, required reason (Select of common reasons + optional Textarea), consequence summary line ("The patient will be notified immediately"), verb-labeled destructive button. Reason is stored and audit-logged.

**P5 — KPI card.** DS metric card variant: overline label · 30px/700 value (`tabular-nums`, **no count-up animation** per DS 9.4) · delta badge vs previous period with ▲/▼ + accessible text ("up 12% vs last week") · optional 32px sparkline · whole card links to its detail page.

**P6 — Chart widget.** Card with header (h4 title + range select + `⋯` menu: export PNG/CSV, view data as table). Charts follow DS color semantics (primary series = Medora Blue, comparisons = teal, alerts = status colors only for status meaning). Every chart offers a "View as table" toggle — the accessibility fallback and the clinical verification path. Tooltips on hover/focus; keyboard-navigable data points.

**P7 — Saved views.** Any P1 table lets users save the current filter+sort+column state as a named view (e.g., "Diabetics overdue for follow-up"). Views appear as tabs above the toolbar. Stored per user.

**P8 — Status vocabulary.** One platform-wide mapping (from DS 8.8): Confirmed/Active/Normal = success · Pending/Awaiting = warning · Cancelled/Rejected/Critical = error · Scheduled/Info = info · Completed/Archived = neutral slate · AI-generated = accent violet. No section may invent a new color-status pairing.

## 1.5 Medical Data Safety Principles

These are binding product rules, not suggestions.

1. **Least-privilege PHI.** Doctors see clinical data only for patients under their care. Admins see demographics and operational metadata by default; clinical content (record bodies, message text) requires an explicit permission grant and per-access justification (see 3.6), and every such access is written to the audit log visible in 3.7.
2. **Provenance is always visible.** Three authorship classes are visually distinct everywhere: doctor-entered (default styling), patient-reported (info-tinted label "Patient-reported"), AI-generated (accent violet border/label per DS — never persisted without explicit doctor review and confirmation).
3. **No silent clinical mutations.** Every action that changes clinical or scheduling reality (prescribe, cancel, reschedule, edit record) requires explicit confirmation, is attributed, timestamped, and reversible where medically sensible (soft-delete + versioning; records are never hard-deleted).
4. **Critical information cannot be missed.** Allergy and critical-alert data renders in fixed, non-dismissible positions (patient header, prescription flow). Critical alerts never appear *only* as toasts.
5. **Session safety.** Auto-lock after 10 min idle (configurable by admin policy): screen blurs behind a re-authentication dialog; unsaved work is preserved. "Active sessions" management in both settings areas.
6. **Masked by default in shared contexts.** Any admin table showing patient identifiers supports masked display (e.g., "Ah••• M•••", MRN last-4) with reveal-on-click that is audit-logged.

---

# 2. Doctor Dashboard

**Sidebar (top → bottom):** Overview · Patients · Appointments · AI Assistant `✦` · Labs · Pharmacy · Messages `(badge)` · Notifications `(badge)` · Reports — pinned bottom: Settings · Help · User card.

## 2.1 Overview (Home)

**Purpose.** The doctor's mission control: the state of *today* plus anything requiring action, absorbable in under 10 seconds.

**User goal.** "Orient me, surface what needs my decision, and get me into my first task in one click."

**Layout** (12-col grid, `container-2xl`):

```
Row 0  Critical Alerts banner (full width, only when present)
Row 1  KPI row — 4 cards (3 cols each): Today's Appointments ·
       Pending Requests · Total Patients · Completed This Week
Row 2  Today's Schedule (8 cols, timeline)  |  Action Queue (4 cols)
Row 3  Appointments Trend chart (5 cols) | Patient Satisfaction (3) |
       Consultations & Revenue summary (4)
Row 4  Recent Activity feed (8 cols)  |  Quick Actions (4 cols)
```

**Components.** Alert (error variant, non-dismissible) · 4× P5 KPI cards · Schedule timeline widget · Action-queue list card · P6 chart widgets (line, gauge/donut, stat list) · activity feed card · quick-action button grid.

**Data displayed.**
- *Critical Alerts:* abnormal lab results awaiting review, allergy conflicts flagged on today's patients, urgent reschedule situations. Each alert: icon, one-line summary, patient name, single resolving action ("Review result").
- *KPIs:* today's appointment count (with next-at time), pending appointment requests, total active patients, consultations completed this week (delta vs last week). Cancelled-today appears as a caption under Today's Appointments rather than consuming a card.
- *Today's Schedule:* vertical timeline of today's appointments — time, patient (avatar + name + age), visit type chip, status badge, current-time indicator line; the next upcoming appointment is highlighted with `primary-subtle`.
- *Action Queue:* unified "needs your decision" list — appointment requests (Accept / Propose time / Reject inline), unread lab flags, unsigned consultation notes, unanswered patient messages > 24h. Sorted by urgency then age.
- *Charts:* appointments per day (14-day line, completed vs cancelled), patient satisfaction (average rating donut + trend caption, sourced from post-visit surveys), monthly consultations + revenue figure (revenue card visible only when the clinic enables per-doctor billing; otherwise the slot shows "Top visit types" instead).
- *Recent Activity:* reverse-chron feed (record updated, prescription issued, lab attached, message received), each row linking to its object.

**User actions.** Click-through on every card/row · inline accept/reject on requests (P4 for reject) · "Start consultation" on the highlighted next appointment · quick actions: New Prescription, Open AI Assistant, Message a Patient, Block Time Off.

**States.**
| State | Behavior |
|---|---|
| Empty | New doctor: KPI cards render zeros with caption "No data yet"; schedule shows first-use empty state ("No appointments today — your schedule will appear here") + "Set availability" CTA; charts show empty pattern. |
| Loading | Full skeleton mirroring the grid (KPI skeletons, timeline skeleton rows). Widgets load independently — schedule and action queue are priority-fetched first. |
| Error | Per-widget error cards with Retry (DS 8.33); page never fails as a whole. Critical-alert fetch failure shows a warning banner "Couldn't check for alerts — Retry" (fail loud, not silent). |

## 2.2 Patients

**Purpose.** Fast retrieval of any patient under the doctor's care.

**User goal.** "Find this patient in under 5 seconds, by whatever identifier I happen to have."

**Layout.** P1 Data Table page. Toolbar: search field (auto-detects identifier type — name, patient ID, phone, MRN — with a scope dropdown to force a field) · filter chips · Filters drawer (status, gender, age range, last-visit range, condition tag, has-upcoming-appointment) · view toggle (table / card grid) · saved views (P7, e.g. "Recent", "Chronic care").

**Components.** Search input (DS 8.28 contextual) · Table 8.19 / card grid alternative · filter Drawer · Pagination · Avatar, Badges.

**Data displayed (table columns).** Avatar + full name (+ masked-MRN caption) · Age · Gender · Last visit (relative + absolute on hover) · Medical status badge (Stable = success, Monitoring = warning, Critical = error, New = info — per P8) · Next appointment (date or "—") · row action `⋯` (View profile, Book appointment, Message, Add note). Allergy indicator icon appears beside the name when severe allergies exist.

**User actions.** Search (debounced 300ms, result count announced) · filter · sort (name, last visit, next appointment) · open profile (row click) · row quick-actions · export list (CSV, respecting current filters).

**States.** Empty first-use: "No patients yet — patients are assigned when they book with you." No-results: echoes query, "Clear search". Loading: 8 skeleton rows. Error: table-body error card with Retry; search errors show inline "Search unavailable — Retry" without clearing the last good results.

## 2.3 Patient Profile

**Purpose.** The complete clinical picture of one patient — the doctor's most important screen.

**User goal.** "Give me trustworthy full context instantly, and let me act (prescribe, note, order) from right here."

**Layout.** P2 Detail page:

```
Breadcrumb: Patients / Amira Saleh
┌ Identity header ──────────────────────────────────────────────┐
│ [Avatar 64] Amira Saleh · 34 F · MRN 4482-19                  │
│ ⚠ ALLERGIES: Penicillin (severe) · Latex     ← fixed, always  │
│ Status: Monitoring · Blood type O+ · Primary: Dr. Hassan      │
│ [Book appointment] [New prescription] [Message] [✦ Summarize] │
└───────────────────────────────────────────────────────────────┘
Left column (4 cols, sticky)        Tabs (8 cols)
- Vitals snapshot (latest, dated)   Overview | History | Visits |
- Current medications (top 5)       Prescriptions | Labs | Imaging |
- Active conditions                 Documents | Notes
- Next appointment card
- Emergency contact
```

**Tab contents.**
- **Overview:** timeline of recent clinical events (visits, results, prescriptions) + AI summary panel (only after doctor invokes "✦ Summarize" — renders in the accent-violet AI container with "AI-generated — verify before relying on it" label and a "Refresh summary" action).
- **History:** structured medical history — chronic conditions, surgical history, family history, social history, immunizations. Accordion sections (DS 8.21, multi-open). Each entry: value, recorded-by, date. Edit inline with attribution.
- **Visits:** table of previous consultations (date, type, chief complaint, diagnosis, note status signed/unsigned) → row opens the visit record in a P3 drawer.
- **Prescriptions:** table of all prescriptions (drug, dose, prescriber, date, status badge) + "New prescription" (jumps to 2.7 flow pre-filled with this patient).
- **Labs:** results grouped by panel with flag badges (Normal/Abnormal/Critical per P8); "View trends" opens the trend view (2.6) scoped to this patient.
- **Imaging:** radiology reports list (modality icon, study, date, status) with report viewer drawer; images open in a full-screen viewer with zoom.
- **Documents:** uploaded files (referrals, consents, external records) — name, type icon, size, uploader, date; upload with drag-and-drop; preview in drawer.
- **Notes:** doctor's clinical notes, reverse-chron; rich-text editor for new notes; unsigned notes carry a warning badge; AI-drafted notes (from 2.5) arrive here as clearly-labeled drafts requiring review + sign.

**Components.** Identity header (custom composite) · sticky summary cards · Tabs · Tables · Accordions · Drawers · file uploader · rich-text note editor · AI container (accent-styled Card).

**User actions.** All header quick-actions · per-tab CRUD as above · print/export patient summary (PDF) · flag data error ("Report an issue with this record" → routed to admin).

**States.** Tabs lazy-load with per-tab skeletons. Empty per tab ("No lab results for this patient yet"). Error per tab with Retry — one failed tab never blocks the others. If the *header* fails, the page shows the full-page section error (identity is non-negotiable context). Unsaved note navigation triggers a confirm dialog.

## 2.4 Appointments

**Purpose.** Complete control of the doctor's schedule: review, decide, and document.

**User goal.** "Manage my time with minimal clicks, and never lose a patient in a scheduling change."

**Layout.** Page header with view switcher (Tabs, enclosed style): **List · Day · Week · Month** + date navigator (‹ Today ›, date picker) + filters (status, visit type) + page actions: "Block time off" (secondary), "New appointment" (primary).

- **List view:** P1 table — time, patient (avatar+name), type chip, duration, status badge, decision buttons inline for `Pending` rows, `⋯` menu. Grouped by day with sticky day headers. Saved sub-tabs: All · Today · Upcoming · Pending requests `(badge)` · Past.
- **Day/Week views:** DS Calendar (8.30) time grid, 30-min slots, current-time line, drag-to-reschedule (always ends in a confirmation modal). Availability blocks render `surface-sunken`; time-off renders hatched.
- **Month view:** density overview; day cells show up to 3 event chips + "+N more" popover.

**Appointment detail** (P3 drawer from any view): patient identity block (with allergy strip), requested time, visit type, patient's stated reason, history of this appointment (requested → accepted → rescheduled…, actor + timestamp per step), linked consultation note.

**User actions & flows.**

| Action | Flow |
|---|---|
| Accept | One click on a Pending request → status Confirmed → success toast "Confirmed — patient notified". |
| Reject | P4 modal: reason (Select: schedule conflict, outside specialty, needs in-person triage, other + textarea) → patient notified with reason. |
| Propose another time | Drawer flow: doctor picks up to 3 alternative slots from their live availability grid → sent to patient as options → appointment status "Awaiting patient" (warning badge). |
| Reschedule (confirmed appt) | Same slot-picker + required reason; patient must re-confirm unless within doctor-set auto-accept window. |
| Cancel | P4 modal with reason; shows consequence line; offers "propose alternative instead?" secondary path before final cancel. |
| Add consultation note | From a Completed appointment: opens note editor (template: chief complaint, findings, diagnosis, plan) with "✦ Draft with AI" option (output arrives as labeled AI draft). Note must be signed; unsigned notes appear in the Overview action queue. |
| **Emergency unavailability** | "Block time off" → Emergency mode: doctor selects the affected range → system lists every impacted appointment → doctor chooses per appointment (or bulk): *send reschedule request with proposed slots* / *offer colleague handover (if clinic enables)* / *cancel with apology template*. A summary modal confirms the blast radius ("6 patients will be notified") before anything sends. Progress toast tracks notification delivery. |

**States.** Empty (no appointments in range): calendar renders with "No appointments this week" empty pattern in situ. Loading: calendar grid skeleton / table skeleton rows. Error: in-place error card + Retry; a failed *action* (e.g., accept) shows a persistent error toast with Retry and the row returns to its prior state (optimistic update rolled back).

## 2.5 AI Medical Assistant

**Purpose.** A dedicated clinical AI workspace that accelerates documentation and information work while keeping the doctor unambiguously in charge.

**User goal.** "Reduce my cognitive and typing load — but never let AI content masquerade as my clinical judgment."

**Layout.**

```
┌ Page header: AI Medical Assistant ✦    [Patient context: none ▾] ┐
├───────────────┬──────────────────────────────┬──────────────────┤
│ Conversations │  Chat thread                 │ Context panel    │
│ (240px list)  │  - messages                  │ (320px)          │
│ + New chat    │  - streaming AI responses    │ - bound patient  │
│ search        │  - action-result cards       │   summary        │
│               │  Composer + attach + tools   │ - sources used   │
└───────────────┴──────────────────────────────┴──────────────────┘
```

- **Patient context binding:** a conversation is either *general* (medical information assistance) or *bound to one patient* (selected via the header patient picker). Binding is explicit and always visible — a persistent context bar ("Context: Amira Saleh, MRN 4482-19 ✕") sits above the composer. Unbinding is one click. AI never has cross-patient context in a single thread.
- **Capability cards** (shown in a new empty chat): Summarize patient history · Draft consultation note · Interpret lab results · Analyze uploaded report · Suggest considerations for symptoms · Organize records. Clicking one starts a structured flow (e.g., "Interpret labs" asks which result set).
- **AI output containment (binding rules):** every AI message renders in the accent-violet AI container with the ✦ icon and an "AI-generated" label; anything transferable to the record renders as an **action-result card** with explicit buttons: *Review & save to record* (opens an editable diff-style review modal — the only path into a patient record), *Copy*, *Discard*. Saved artifacts keep a permanent "AI-assisted, reviewed by Dr. Hassan on {date}" provenance line. A fixed disclaimer footer states: "Medora AI supports, but never replaces, clinical judgment. Verify all output."
- **Safety behaviors:** dosage or treatment-adjacent responses always carry an inline caution strip; the assistant declines emergency-triage questions with a directive to clinical protocols; uploads (PDF/image reports) are analyzed with the extraction shown side-by-side with the source for verification.

**Components.** Three-pane layout · chat message list with streaming text (accent shimmer while generating, cancellable — DS 8.32) · composer (auto-grow Textarea, attach button, patient-context bar) · capability cards · action-result cards · review-before-save Modal · conversation list with search.

**Data displayed.** Conversation history (retained per doctor, searchable) · bound-patient snapshot in the context panel (same summary block as 2.3 left column) · source attributions on answers that used record data ("Based on: Lab report 12 Mar, Visit note 28 Feb" — each linked).

**User actions.** New/rename/delete conversation · bind/unbind patient · send/stop generation · upload report · invoke capability flows · review-and-save to record · copy · thumbs up/down feedback per response (feeds quality telemetry) · full-text search across own conversations.

**States.** Empty: capability-card welcome screen. Loading: streaming pattern; history list skeleton. Error: generation failure renders an in-thread error bubble with Retry (thread never lost); patient-context fetch failure blocks binding with an inline error (never proceeds with partial context — safety rule); offline: composer disabled with "AI Assistant requires a connection" alert.

## 2.6 Lab Systems

**Purpose.** Review, track, and act on laboratory results across all of the doctor's patients.

**User goal.** "Show me what's abnormal first, let me see any value in temporal context, and attach everything to the right record."

**Layout.** Two tabs: **Inbox** (results needing review) and **All results** (P1 table). Toolbar: search (patient, test name, report ID) · filters (patient, date range, test type/panel, flag: Normal/Abnormal/Critical, review status). A persistent "Critical unreviewed: N" alert chip pins to the header when N > 0.

**Row → P3 drawer:** full report — panel table (analyte, value, unit, reference range, flag badge; abnormal values bolded with directional ▲▼), specimen and lab metadata, ordering context, previous value column for instant comparison, actions.

**Trends view:** from any analyte, "View trend" opens a line chart of that analyte over time for that patient (reference range as a shaded band, results as points, hoverable, view-as-table toggle per P6). Multiple analytes can be overlaid (max 3) with distinct series colors.

**Components.** Tabs · P1 table · drawer report viewer · P6 trend charts · flag badges · "Mark reviewed" control · attach-to-record confirmation.

**Data displayed.** Columns: flag badge · patient · test/panel name · result summary ("3 of 24 abnormal") · collected date · received date · review status · `⋯`. Critical rows tint `error-subtle` and always sort to top of the Inbox.

**User actions.** Review (mark reviewed — required for critical results; bulk allowed only for Normal) · view trend · attach report to patient record (confirmation with patient-identity check: "Attach to Amira Saleh, MRN 4482-19?") · annotate result · forward to AI Assistant for interpretation (opens 2.5 bound to that patient with the report pre-loaded) · print/export report PDF.

**States.** Empty Inbox: cleared-flavor empty state "All results reviewed ✓". Loading: skeleton rows; drawer content skeleton. Error: standard; a failed "mark reviewed" rolls back with error toast (a critical result must never *appear* reviewed when the write failed).

## 2.7 Pharmacy

**Purpose.** Safe prescription authoring and lifecycle tracking, plus a reference medication database.

**User goal.** "Prescribe quickly, with the system guarding me against interactions and allergies."

**Layout.** Three tabs: **Prescriptions** (P1 table) · **New prescription** (flow) · **Medication database** (reference search).

- **Prescriptions table:** patient · medication (name, strength, form) · dose/frequency summary · prescribed date · duration · status badge (Draft = slate, Sent = info, Dispensed = success, Expired = neutral, Cancelled = error) · `⋯` (view, renew, cancel with reason P4). Filters: status, patient, date range, medication.
- **New prescription flow** (stepper, DS 8.24 steps — also launchable pre-filled from Patient Profile):
  1. **Patient** — search/select; selected patient's allergy strip and current-medication list render immediately and stay pinned for the rest of the flow.
  2. **Medication** — typeahead against the database (generic + brand, strength, form). On selection, **automatic safety screen** runs: allergy conflicts (blocking error alert — cannot proceed without changing medication; no override in v1), drug–drug interactions vs current medications (severity-graded warning alert; proceeding past a *severe* interaction requires an explicit acknowledgment checkbox + reason, which is audit-logged), duplicate-therapy notice.
  3. **Dosage & instructions** — dose, route, frequency, duration, quantity, refills, patient instructions (plain language); template shortcuts for the doctor's frequent regimens.
  4. **Review & sign** — full summary including the safety-screen outcome; "Sign & send" (primary) or "Save as draft".
- **Medication database:** search + monograph drawer (indications, contraindications, standard dosing, interactions, pregnancy category). Reference only — labeled as such.

**Components.** Tabs · tables · stepper flow · typeahead select · safety Alert stack · summary review card · monograph drawer.

**User actions.** Create/sign/send prescription · save draft · renew (pre-fills flow from a previous prescription) · cancel with reason · track status · search database · print prescription.

**States.** Empty: "No prescriptions yet" first-use. Loading: table skeletons; safety screen shows an explicit blocking spinner with "Checking interactions…" — **the flow hard-blocks until the check completes or fails**. Safety-check failure = error alert "Interaction check unavailable — prescription cannot be sent right now" with Retry and Save-as-draft only (fail closed, never fail open). Send failure: persistent error toast + prescription retained as draft.

## 2.8 Messages

**Purpose.** Asynchronous, auditable communication with patients and colleagues.

**User goal.** "Triage and answer conversations quickly, with full patient context one click away."

**Layout.** Two-pane inbox: conversation list (360px: search, filter tabs All · Patients · Internal · Unread) + thread view (header: participant identity + "View profile" + `⋯`; message stream; composer). On `lg+` an optional third pane shows the bound patient's summary.

**Components.** Conversation list items (avatar, name, preview, timestamp, unread dot, status badge) · message bubbles (own = primary-subtle right-aligned; other = surface left; internal-colleague threads get a distinct "Internal" header chip) · composer (auto-grow textarea, attach, template snippets) · read/delivery indicators (sent ✓, delivered ✓✓, read — shown subtly, caption-level).

**Data displayed.** Threads sorted by latest activity; per-message timestamp, author, attachment chips; conversation-level tags ("Follow-up", "Rx question").

**Safety rules.** A permanent banner in patient threads: "Messaging is not for emergencies." Patient-thread messages cannot be deleted (edit within 5 min with visible "edited" mark; full history is retained for audit). Attachments are scanned before download links activate.

**User actions.** Search messages (full-text within own threads) · reply · attach (images/PDFs) · insert snippet templates · mark unread · tag conversation · mute thread notifications · start new message (patient picker limited to own patients; colleague picker for internal) · escalate thread to appointment ("Convert to appointment" pre-fills 2.4 booking with this patient).

**States.** Empty: first-use "No messages yet." Thread pane with nothing selected: neutral "Select a conversation." Loading: list + thread skeletons. Error: send failure marks the message with a red retry affordance inline (message preserved in composer history); list failure shows section error + Retry.

## 2.9 Notifications

**Purpose.** A complete, filterable record of everything the platform told the doctor.

**User goal.** "Catch up after time away and clear my backlog with confidence."

**Layout.** Single list page. Header actions: "Mark all as read", link to notification settings. Filter tabs: All · Appointments · Patients · Lab results · Messages · AI · System, plus an Unread-only switch.

**Components.** Grouped list (Today / Yesterday / Earlier), notification rows: category icon (colored per P8 semantics) · title · one-line detail · timestamp · unread dot · inline action when applicable ("Review result", "Respond"). Bell popover in the navbar shows the latest 10 of this same feed.

**Data displayed.** Appointment alerts (requests, confirmations, cancellations), patient updates, lab result arrivals (critical ones styled error and pinned until acted on), system alerts (maintenance, policy), AI notifications (completed analyses, saved drafts pending review).

**User actions.** Click-through to the source object · mark read/unread · mark all read · per-category mute (links to Settings → Notifications).

**States.** Empty: cleared-flavor "You're all caught up." Loading: row skeletons. Error: section error + Retry. Real-time arrivals slide in at top (DS toast-in motion) and are announced politely.

## 2.10 Reports & Analytics

**Purpose.** The doctor's own practice analytics — patterns, workload, and outcomes over time.

**User goal.** "Understand my practice at a glance and pull numbers for reviews."

**Layout.** Header: date-range picker (presets: 7d / 30d / 90d / 12m / custom) + compare-to-previous toggle + Export (PDF/CSV). Grid of P6 chart widgets:

| Widget | Visualization |
|---|---|
| Patient statistics | KPI trio (active, new in range, returning %) + new-patients area chart |
| Appointment statistics | Stacked bar by status (completed/cancelled/no-show) per week + completion-rate KPI |
| Treatment statistics | Top diagnoses (horizontal bar) · Top prescribed medications (table) |
| Monthly activity | Calendar heatmap of consultations per day |
| Performance | Avg consultation duration, avg patient wait, response time to requests — KPI row with trend sparklines |
| Satisfaction | Rating trend line + distribution histogram (when surveys enabled) |

**Data & rules.** All charts respect the global range; deltas always name the comparison period in accessible text. Data is the doctor's own only — no cross-doctor comparison in the doctor role (that lives in Admin Reports).

**User actions.** Change range/compare · drill down (click a bar → filtered appointment list) · export per-widget (CSV/PNG) or full report (PDF) · view any chart as table.

**States.** Empty (new doctor / empty range): per-widget empty pattern "No data for this period." Loading: chart-shaped skeletons. Error: per-widget error + Retry.

## 2.11 Doctor Settings

**Purpose.** Self-service control over identity, availability, security, and preferences.

**Layout.** Settings shell: left vertical section nav (240px, persists on `lg+`; collapses to a select on mobile) + `container-md` content forms. Every form: explicit Save (primary, disabled until dirty) + Cancel; unsaved-changes guard on navigation; success toast on save.

| Section | Contents |
|---|---|
| **Profile** | Personal info (photo upload with crop, name, contacts) · Professional info (title, bio, languages) · Medical specialty (primary + subspecialties, taxonomy select) · License information (number, authority, expiry — expiry within 60 days shows a warning alert; edits to license fields go to admin re-verification and show a "Pending verification" badge). |
| **Appearance** | Theme: Light / Dark / System (radio cards with mini previews) · density (comfortable/compact tables) · language. |
| **Availability** | Weekly working-hours grid editor (per-day toggles + time ranges, copy-day, add breaks) · default appointment duration (15/20/30/45/60) + buffer time · Vacation mode: date-range + auto-behavior for the range (block new bookings; existing appointments trigger the 2.4 emergency rebooking flow with a preview of affected appointments before enabling). |
| **Security** | Change password (current + new with strength meter + policy checklist) · Two-factor authentication (TOTP setup wizard with QR + recovery codes; status badge) · Active sessions (device, location approximation, last active, "Revoke" per row + "Sign out all other sessions") · Login history (read-only table: time, IP, device, result — failures highlighted). |
| **Notifications** | Matrix: channels (In-app / Email / Push) × categories (Appointments, Requests, Lab results, Messages, AI, System) as switch grid · quiet hours (time range; critical lab alerts are exempt and say so) · email digest frequency. |
| **Privacy** | Data-sharing preferences (profile visibility in clinic directory, satisfaction-survey participation) · Medical record permissions (view which colleagues/roles can access records the doctor authors; request restriction) · data-export request (own activity data). |

**States.** Loading: form skeletons. Save error: inline alert atop the form, fields preserved. 2FA/QR failures include regenerate. Session-revoke is optimistic with rollback toast on failure.

---

# 3. Administrator Dashboard

**Sidebar (top → bottom):** Overview · Doctors · Patients · Appointments · Communications · System Logs · Reports — pinned bottom: Settings · Help · User card.

The Admin experience is oversight-first: primarily P1 tables, P2 detail pages, and P6 analytics, with heavy use of filters, exports, and the audit trail. Admin **does not** get the AI Assistant entry point, and all PHI exposure follows 1.5 (masked-by-default, permission-gated elevation, always audit-logged).

## 3.1 Overview (Home)

**Purpose.** Instant answer to "is the platform healthy, secure, and growing?" plus the admin's work queue.

**User goal.** "Spot anomalies and pending work in seconds; drill into anything in one click."

**Layout** (12-col, `container-2xl`):

```
Row 0  Security Alerts banner (full width, only when unresolved alerts exist)
Row 1  KPI row (4×3 cols): Total Doctors · Total Patients ·
       Appointments Today · Active Users Now
Row 2  Platform Activity chart (8 cols)   |  Admin Action Queue (4)
Row 3  Revenue Overview (4) | Appointment Funnel (4) | System Health (4)
Row 4  Recent Admin Activity (6)          |  Recent Signups (6)
```

**Components.** Alert (error, non-dismissible, links to 3.7 filtered to open security events) · P5 KPI cards (with deltas) · P6 charts · action-queue card · System Health status card · activity feeds.

**Data displayed.**
- *Security alerts:* unresolved events — repeated failed logins, new-location admin sign-ins, permission escalations, flagged communications. Each: severity badge, summary, "Investigate" → 3.7.
- *KPIs:* total verified doctors (+pending count caption), total registered patients, appointments today (with utilization %), concurrent active users (live, updates via polling — value transitions with a fade, never a count-up).
- *Platform activity:* 30-day multi-line chart — daily active users, appointments booked, messages sent (legend toggles per series).
- *Admin Action Queue:* doctor verifications pending `(n)`, reported record issues (from 2.3 flag action), flagged conversations awaiting review, license expiries in < 30 days. Each row deep-links to its queue.
- *Revenue overview:* MRR/period revenue KPI + 6-month bar chart (rendered only when billing is enabled for the deployment; otherwise the slot shows Storage & Usage stats).
- *Appointment funnel:* requested → confirmed → completed conversion funnel for the period, with cancellation/no-show rates.
- *System health:* service status list (API, notifications, AI service, storage) with status dots (success/warning/error) + last-checked time + uptime %; degraded services link to an incident note.
- *Feeds:* recent admin actions (who did what — from the audit log) and latest registrations (doctors & patients, with verification state).

**User actions.** Everything click-through · "Investigate" on alerts · direct approve/open on verification queue items · range switch on charts.

**States.** Empty (fresh deployment): KPIs at zero with onboarding checklist card ("Invite your first doctor"). Loading: widget-level skeletons; security banner and action queue fetch first. Error: per-widget error + Retry; if the *security alerts* fetch fails the banner slot shows a warning "Security status unavailable — Retry" (never silently absent).

## 3.2 Doctors Management

**Purpose.** Lifecycle management of every doctor on the platform: onboarding, verification, monitoring, intervention.

**User goal.** "Process verifications quickly and find any doctor with full operational context."

**Layout.** P1 Data Table page. Sub-tabs above toolbar: **All · Pending verification `(badge)` · Active · Suspended**. Toolbar: search (name, email, license number) · filters (specialty, verification status, availability status, joined-date range) · export CSV · primary action "Invite doctor".

**Data displayed (columns).** Avatar + name (+ title caption) · Specialty · Verification badge (Verified = success, Pending = warning, Rejected = error, Docs requested = info) · Status (Active / Suspended / Vacation) · Patients count · Appointments (30d) · Rating · Last active · `⋯` (View profile, Verify, Suspend, Reset access).

**User actions.** Invite doctor (modal: email + specialty + role template → sends onboarding invite) · open profile · verify / request more documents / reject (P4, reason required, communicated to the doctor) · suspend / reactivate (P4; suspension consequence line: "Their appointments will require reassignment — 14 upcoming appointments affected", linking into the affected list first) · bulk export.

**States.** Empty (Pending tab): cleared-flavor "No pending verifications ✓." Loading/Error: standard P1 patterns. A failed verify/suspend action rolls back the row's optimistic badge with an error toast.

## 3.3 Doctor Profile (Admin View)

**Purpose.** The complete administrative file on one doctor.

**User goal.** "See who this doctor is, prove their credentials, and audit their platform activity."

**Layout.** P2 Detail page. Identity header: avatar, name, specialty, verification + status badges, key facts (joined date, license expiry), actions (Verify / Suspend / Reset password / Message). Tabs:

| Tab | Contents |
|---|---|
| **Profile** | Personal information (contacts, demographics) · Professional information (specialties, bio, languages, clinic assignment) — read-only to admin except administrative fields (role template, clinic), which are editable with audit attribution. |
| **Documents** | Registration documents gallery: medical license, degree certificates, ID — each with preview drawer, uploaded date, verification checklist (authentic ✓ / current ✓ / matches identity ✓), per-document Approve/Reject, and an overall "Complete verification" action enabled only when all required docs are approved. Expiring documents flagged with warning badges. |
| **Activity** | Login activity table (time, IP, device, location approx., result — failures highlighted, impossible-travel events auto-flagged) + platform actions summary (records edited, prescriptions issued *as counts, not content*). |
| **Appointments** | This doctor's appointment statistics: volume trend, completion/cancellation/no-show rates, utilization vs published availability; table of recent appointments (operational fields only — patient shown masked per 1.5). |
| **Statistics** | Performance dashboard: patients served, avg rating + review distribution, response time to requests, revenue contribution (if billing enabled) — P6 widgets. |

**States.** Tab-level lazy loading and errors as in P2. Document preview failure: in-drawer error with re-request-document action. Header failure = section error (identity is required context).

## 3.4 Patients Management

**Purpose.** Administrative oversight of patient accounts — support, access governance, and lifecycle — **not** clinical review.

**User goal.** "Resolve account issues and control who can access what, without unnecessary PHI exposure."

**Layout.** P1 table. Toolbar: search (name, patient ID, phone, email — results masked per 1.5 until row-level reveal) · filters (account status, registration range, assigned doctor, activity). Columns: masked name + MRN-last-4 · account status badge (Active / Inactive / Locked) · registered date · assigned doctors count · last activity · open issues count · `⋯`.

**Patient profile (admin view)** — P2 with tabs:
- **Profile:** demographics and account data (email/phone for support verification); *no clinical content*. Account controls: unlock, reset credentials (sends secure reset — admin never sets a password directly), deactivate (P4).
- **Activity:** account event timeline (logins, bookings made/cancelled, messages sent *as counts*, consent changes).
- **Permissions:** medical-access grid — which doctors/roles hold access to this patient's record, granted-by, date, scope; admin can revoke access (P4, logged) or approve pending access requests. Every historical access grant/revoke is listed (feeds from audit log).

**User actions.** Search/filter/export · row reveal (audit-logged) · account controls · permission grants/revocations · view patient's open support flags.

**States.** Standard P1/P2 patterns. Reveal-identity failure keeps the row masked with an error tooltip. Empty permissions tab: "No active access grants."

## 3.5 Appointment Management

**Purpose.** Platform-wide appointment monitoring — volumes, conflicts, and stuck states across all doctors.

**User goal.** "See scheduling health globally and intervene on problem cases."

**Layout.** P1 table + a summary strip above it (KPI mini-cards: Today total · Pending > 24h · Cancellation rate 7d · No-show rate 7d). Toolbar: filters (status, doctor, department/specialty, date range, flag: *stuck pending*, *repeated reschedules*, *complaint attached*). Optional heatmap toggle: hour × weekday utilization matrix for capacity planning.

**Data displayed (columns).** Date/time · Doctor · Patient (masked) · Type · Status badge · Age-in-state (how long Pending/Awaiting-patient — the intervention signal) · Flags · `⋯` (View detail, Nudge doctor, Reassign, Cancel administratively).

**Detail drawer (P3).** Full appointment event history (every transition with actor + timestamp), linked complaint if any, notification delivery status per party.

**User actions.** Monitor/filter/export · **Nudge**: send a reminder to a doctor sitting on a Pending request (templated, logged) · **Reassign**: move an appointment to another available doctor of the same specialty (picker shows live availability; both patient and doctors notified; P4 with reason) · administrative cancel (P4, requires reason category "administrative", patient notified with apology template) · bulk operations limited to nudges (destructive bulk actions are deliberately unsupported).

**States.** Standard patterns. Heatmap empty: "Not enough data for this range." Failed reassign rolls back with error toast and no notifications sent (notifications fire only on confirmed server success).

## 3.6 Communication Monitoring

**Purpose.** Governance of the messaging system: aggregate health, policy enforcement, and — only under strict controls — content review.

**User goal.** "Ensure communication is safe and compliant without routinely reading anyone's messages."

**Layout.** Three tabs:

- **Overview:** aggregate analytics only — message volume trend, median doctor response time, unanswered-over-48h count, active conversation count, flag rate. P6 widgets. No message content anywhere on this tab.
- **Conversation logs:** P1 table of conversation *metadata*: participants (doctor named, patient masked), started, last activity, message count, status, flags. **Content access is gated:** "Request content access" per conversation → modal requiring a justification category (patient complaint, safety flag, legal request, quality audit) + free-text reason → access granted per admin policy (self-serve for permitted roles or second-admin approval if configured) → conversation opens **read-only**, watermarked with the admin's name, with a persistent banner "You are viewing private communication — access logged (ref #)". Every access lands in 3.7 and, where policy requires, in participant-visible transparency logs. |
- **Safety flags:** queue of automatically- and user-flagged messages (categories: emergency language, harassment/abuse, PHI-in-wrong-channel, prescription solicitation). Each flag: excerpt (minimum necessary context), category, confidence source (auto/user), status. Workflow: Open → Under review → Resolved (dismiss with note / warn user / escalate to suspension via 3.2/3.4 — each a P4 with reason).

**Components.** Tabs · P6 analytics · P1 metadata table · justification modal · watermarked read-only thread viewer · flag review queue with status workflow.

**User actions.** Monitor aggregates · filter logs · request/execute content access (per gate) · process safety flags · export aggregate reports (content export requires elevated permission and produces a logged, watermarked artifact).

**States.** Flags queue empty: "No open flags ✓." Access-request denial renders an info alert with the policy reason. Loading/error: standard. A content-access session that errors mid-view is terminated and logged as incomplete.

## 3.7 System Logs

**Purpose.** The platform's complete, immutable audit system — the source of truth for every security investigation.

**User goal.** "Reconstruct exactly what happened, who did it, and when — fast."

**Layout.** P1 table optimized for investigation. Toolbar: free-text search · structured filters (actor role: Doctor/Admin/System · actor identity · event type · severity: Info/Warning/Critical · date-time range with time precision · IP) · saved views (P7 — e.g. "Failed logins 7d", "Admin PHI access") · export (CSV/JSON, respecting filters, export action itself logged).

**Event taxonomy displayed:**

| Category | Examples |
|---|---|
| Authentication | Login success/failure, logout, session timeout, password change, 2FA events |
| Security | Failed-attempt bursts, lockouts, new-device sign-ins, permission changes, PHI reveals (1.5), communication content access (3.6) |
| User actions | Record created/edited/viewed, prescription signed, appointment transitions, exports |
| Admin activities | Verification decisions, suspensions, reassignments, settings changes, role edits |
| System | Service degradations, integration failures, job results |

**Columns.** Timestamp (ms precision, mono font) · Severity dot+badge · Actor (name + role chip) · Event type · Summary · IP/device · `⋯` (View detail). Critical rows tint `error-subtle`.

**Detail drawer (P3).** Full structured payload (key-value grid + raw JSON toggle), before/after diff for mutations, correlated events ("same session", "same actor ±5 min") as linked list, "Copy incident reference".

**User actions.** Search/filter/export · open detail · pivot on any value (click an IP → filter by it) · create incident bookmark (named saved selection of events for a case) · configure alert rules (link to 3.9 Security).

**Rules.** Logs are **read-only for everyone including admins** — no edit or delete affordance exists in the UI. Retention policy is displayed in the page caption.

**States.** Empty (over-filtered): "No events match — widen the time range." Loading: virtualized table with skeleton rows (this table expects 100k+ rows; virtual scrolling + server pagination). Error: section error + Retry; export failure toasts with retry.

## 3.8 Reports

**Purpose.** Leadership-grade analytics on growth, utilization, and performance.

**User goal.** "Answer 'how is the platform doing?' with exportable evidence."

**Layout.** Header: report selector tabs (Growth · Utilization · Clinical operations · System performance) + global range picker + compare toggle + Export (PDF deck / CSV per widget) + Schedule report (email recurrence).

| Report | Widgets |
|---|---|
| **Growth** | User growth lines (doctors, patients, cumulative + net-new) · activation rate · retention cohort grid · geographic distribution (if multi-clinic) |
| **Utilization** | Appointment trends (volume, by specialty stacked area) · booking funnel · peak-hours heatmap · capacity vs demand by specialty |
| **Clinical operations** | Avg response time to requests · completion/cancellation/no-show rates by specialty · prescription volume · lab turnaround time |
| **System performance** | API uptime & latency percentiles · error-rate trend · notification delivery success · AI service usage & latency · storage growth |

All widgets are P6 (range-aware, view-as-table, per-widget export). Drill-downs land on filtered management pages (e.g., no-show bar → 3.5 filtered).

**States.** Empty range: per-widget empty. Loading: chart skeletons. Error: per-widget with Retry. Scheduled-report failures notify the admin via 2.9-equivalent system notification.

## 3.9 Admin Settings

**Purpose.** Platform-wide configuration. Every change here is high-blast-radius: all writes are confirmed, attributed, and audit-logged; risky changes show consequence summaries.

**Layout.** Same settings shell as 2.11.

| Section | Contents |
|---|---|
| **System configuration** | Platform identity (name, logo, locale defaults, timezone) · scheduling policy (min notice, max advance booking, default durations, cancellation window) · patient booking rules (approval required vs auto-confirm) · data retention windows (read-mostly; edits require typed confirmation of the setting name). |
| **Roles & permissions** | Role list (Admin, Doctor, Receptionist*, Patient* — starred roles configured now, surfaced in later scopes) + permission matrix editor (capabilities × roles as switch grid, grouped: Clinical data / Scheduling / Communication / Administration / Audit) · custom role creation from a base template · per-role member list. Changes preview affected-user count before save and require confirmation. |
| **Security settings** | Password policy (length, complexity, rotation) · 2FA enforcement (per role) · session policy (idle lock minutes, absolute timeout, concurrent session limit) · IP allowlist for admin accounts · login-anomaly alert rules (thresholds for failed attempts, new-location alerts) · communication-monitoring access policy (self-serve vs second-admin approval — feeds 3.6 gate). |
| **Notification settings** | Platform-level templates (appointment lifecycle emails/pushes, verification emails) with preview · delivery channel configuration · quiet-hour defaults · critical-alert routing (which admin group receives security alerts). |
| **Theme settings** | Default theme for new users (Light/Dark/System) · allow user override toggle · accent configuration is deliberately **not** exposed (brand integrity — DS governance). |
| **Integration settings** | Connected services list (email provider, SMS gateway, lab-system interface, AI service, storage): per-integration status dot, config drawer (credentials as write-only secrets, endpoint, test-connection button with result trail), enable/disable (P4 with consequence summary: "Disabling SMS affects appointment reminders for all users"). |

**States.** Form patterns per 2.11 (dirty-state save, unsaved guard). Permission-matrix save conflicts (edited concurrently by another admin) surface a merge dialog showing both change sets. Integration test-connection renders inline success/error with response detail.

---

# 4. Motion & Interaction

All motion uses Design System Section 9 tokens (`duration-*`, `ease-*`) and honors `prefers-reduced-motion` globally via `MotionConfig reducedMotion="user"`. Healthcare rule of thumb: motion confirms and orients; it never entertains.

## 4.1 Page & Route Transitions

- Route change within a dashboard: outgoing content fades 100ms `ease-in`; incoming fades + translateY(8px→0) 200ms `ease-out`. Shell (sidebar/navbar) never re-animates.
- Tab panel switch: crossfade 150ms; the tab indicator slides 200ms `ease-in-out`.
- Focus lands on the new page `h1` (DS 11.4) — motion must never delay focus availability.

## 4.2 Card & Widget Animations

- Dashboard widgets enter once per load: opacity + translateY(12px→0), 200ms `ease-out`, staggered 30ms per widget, capped at 8 staggers (later widgets appear together). No re-animation on data refresh — values swap with a 100ms crossfade. **Numbers never count up** (DS 9.4).
- Interactive cards hover: `shadow-sm → shadow-md` + translateY(-1px), 150ms. Non-interactive cards: no hover response.
- KPI delta badges fade in 100ms after their value renders.

## 4.3 Hover & Micro-interactions

- Buttons/rows/menu items: background transitions 100ms `ease-out`; pressed state is instant (0ms).
- Table row hover: background only — rows never lift or scale.
- Sidebar collapse/expand: width 200ms `ease-in-out`; labels fade 100ms (out before collapse, in after expand).
- Status badge changes (e.g., Pending → Confirmed after accept): the badge crossfades 150ms and emits a single 300ms `primary-subtle` background pulse on the row to confirm the mutation landed.
- Drag-to-reschedule (2.4): the dragged chip lifts to `shadow-lg` at 98% opacity; valid drop slots highlight `primary-subtle`; invalid slots show a not-allowed cursor and no highlight. Drop animates the chip settling 150ms; the confirmation modal then owns the commit.

## 4.4 Loading Animations

Per DS 8.32 decision table: skeletons (1.6s shimmer) for initial loads > 300ms; button spinners for user-triggered actions; 2px top progress bar for background refreshes of visible data; accent shimmer + streaming text for AI generation (always cancellable). Charts draw in once: line paths trace 400ms `ease-out`, bars grow from baseline 300ms staggered 20ms — skipped entirely under reduced motion and on data refreshes.

## 4.5 Modal, Drawer & Popover Behavior

Per DS 8.12–8.15 recipes: modal scale 0.96→1 + fade 250ms with 200ms scrim; drawer translateX 250ms; popovers/dropdowns 200ms in / 150ms out. Confirmation modals (P4) intentionally have **no** entrance delay-chaining — the safety context must be readable immediately. Exit animations never block navigation (interruptible).

## 4.6 Notification & Toast Animations

Toasts: translateY(-8px) + fade in 200ms, stack pushes existing toasts down 150ms `ease-in-out`; exit fade + height collapse 150ms. Bell badge increments with a single 150ms scale pulse (1→1.15→1) — never a shake, never looping. Critical lab / security alerts do not rely on animation to be noticed: they occupy fixed banner positions (1.5 rule 4).

---

# 5. Responsive Design

Breakpoints per DS Section 10 (`base <640 · sm 640 · md 768 · lg 1024 · xl 1280 · 2xl 1536`). Reference design at `xl`. Both dashboards are desktop-first in usage but must be fully operable on mobile — doctors triage on phones between rounds; admins respond to security alerts anywhere.

## 5.1 Shell Behavior

| Region | Desktop (`xl+`) | Laptop (`lg`) | Tablet (`md`) | Mobile (`<md`) |
|---|---|---|---|---|
| Sidebar | Expanded 264px, user-collapsible | Collapsed 64px icon rail, expandable | Hidden; overlay drawer via ☰ | Hidden; bottom tab bar (5 slots) + "More" sheet for the rest |
| Navbar | 64px, full search bar | 64px, full search | 64px, search collapses to icon → full-width overlay | 56px; search icon → full-screen search |
| Page header | Title + inline actions | Same | Actions may collapse to `⋯` | Title + single primary action; rest in `⋯` |

**Bottom tab bar assignments** — Doctor: Overview · Patients · Appointments · Messages · More (AI, Labs, Pharmacy, Notifications, Reports, Settings). Admin: Overview · Doctors · Appointments · Logs · More.

## 5.2 Content Adaptation

| Pattern | `lg+` | `md` | `<md` |
|---|---|---|---|
| KPI rows | 4-up | 2×2 | Horizontal snap-scroll row (peek of next card) |
| Dashboard grids | 12-col as specified | 2-col; side widgets move below main | Single column, priority order: alerts → action queue → schedule/KPIs → charts → feeds |
| P1 tables | Full table | Horizontal scroll, sticky first column | Stacked key-value cards (>4 cols) with primary fact as card title; filters move into a full-screen sheet |
| P2 detail pages | 4+8 side-by-side, sticky summary | Stacked; summary becomes a collapsed accordion above tabs | Same; tabs scroll horizontally with edge fade |
| P3 drawers | 480px right drawer | Same | Full-screen sheet (bottom, radius top 16px) |
| Modals | Centered per size | Same | Full-width bottom sheets |
| Charts | Full widgets | Full width, stacked | Simplified: sparkline/KPI-first rendering, "View detail" opens full chart; heatmaps become scrollable |
| Calendar (2.4) | Week default | Day default, week available | Day view only + agenda list toggle; drag-reschedule replaced by tap → "Move appointment" flow (DS: dragging alternatives, WCAG 2.2) |
| Messages (2.8) | Two/three-pane | Two-pane | Single-pane push navigation (list → thread) with back |
| AI Assistant (2.5) | Three-pane | Chat + context panel toggle | Full-screen chat; conversations and context behind header buttons |
| Settings | Left nav + form | Same | Section select dropdown + form |

## 5.3 Touch & Input Rules

Touch targets ≥ 44px below `lg`; hover-revealed affordances become always-visible; row actions render as explicit buttons on cards. Keyboard shortcuts remain available for hardware keyboards regardless of viewport. All flows verified at 200% zoom / 320px reflow (DS 10.4).

---

# 6. State Matrix Summary

Cross-reference of the non-happy-path behavior every section must implement (patterns from DS 8.31–8.33):

| Section | Empty (first-use / cleared / no-results) | Loading | Error |
|---|---|---|---|
| 2.1 / 3.1 Overviews | Zero-state KPIs + onboarding CTA | Per-widget skeletons, priority fetch for alerts/queues | Per-widget retry; alert-fetch failure fails loud |
| P1 tables (2.2, 2.6, 2.7, 3.2, 3.4, 3.5, 3.7) | All three flavors; no-results echoes query | 8 skeleton rows (virtualized for 3.7) | Body error card + Retry; action failures roll back optimistic state |
| P2 profiles (2.3, 3.3, 3.4) | Per-tab empties | Per-tab skeletons, header first | Per-tab retry; header failure = section error |
| 2.4 / 3.5 scheduling | In-grid empty message | Grid skeleton | In-place retry; failed transitions roll back + persistent toast |
| 2.5 AI | Capability-card welcome | Streaming + cancellable | In-thread retry bubble; context failure blocks binding (fail closed) |
| 2.7 prescription flow | — | Blocking "Checking interactions…" | Safety-check failure = draft-only (fail closed) |
| 2.8 Messages | First-use + none-selected | Pane skeletons | Inline per-message retry; composer content never lost |
| 2.9 Notifications | "All caught up" | Row skeletons | Section retry |
| 2.10 / 3.8 Reports | Per-widget "No data for period" | Chart skeletons | Per-widget retry |
| Settings (2.11, 3.9) | — | Form skeletons | Inline form alert, values preserved; concurrent-edit merge dialog (3.9 roles) |

---

# 7. Implementation Notes

Guidance for the React + TypeScript build phase (no code yet — architecture intent only):

1. **Feature-module structure.** Organize by domain (`features/patients`, `features/appointments`, `features/ai-assistant`, `features/admin-logs`…), each owning its routes, queries, and view components; shared primitives live in the design-system package. Class-based domain models (Patient, Appointment, Prescription with status machines) where OOP clarifies state transitions; UI remains functional React.
2. **Server state via TanStack Query.** Query keys mirror the route/filter params in 1.3 (URL is the source of truth for list state). Optimistic updates only where this document specifies rollback behavior; safety-critical writes (prescriptions, reviews of critical labs) are pessimistic by design.
3. **Forms:** React Hook Form + Zod schemas per settings section and per flow step (2.7 stepper validates per-step, submits once).
4. **Status machines are contracts.** Appointment (`requested → pending → confirmed → completed/cancelled/awaiting-patient…`), prescription, verification, and flag lifecycles defined in this document should be encoded as typed unions/state machines shared between features — badges, filters, and permissions all derive from them.
5. **Access control is declarative.** Route guards + a capability hook (`can("appointments.reassign")`) driven by the 3.9 permission matrix; UI hides what the role cannot do, server enforces it regardless.
6. **Audit hooks.** Every action marked "audit-logged" in this document goes through one client-side action dispatcher so logging is structural, not per-callsite.
7. **Build order recommendation.** Shell + routing + theme → P1/P2/P3 pattern components → Doctor: Appointments + Patients (highest value) → Labs/Pharmacy → AI Assistant → Messages/Notifications → Doctor Reports/Settings → Admin in section order 3.1 → 3.9.

---

*Medora UX Architecture v1.0.0 — Doctor & Administrator dashboards only. Implementation must not begin until this blueprint is approved. Patient and Receptionist experiences will be specified in a subsequent document.*
