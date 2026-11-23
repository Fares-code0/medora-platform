# Medora Work Phases — Index

This folder is the single organized home for Medora's Work Phase documentation.
**Each phase has its own file.** This index only links them; it holds no phase
content of its own.

> **No phase file is a task register (2026-10-26).** Phases 00–19 and Frontend
> Phases A–F are labelled *historical record* at the top of each file. Phases
> 20–31 and 22A are plans: their Status lines and boxes describe the plan, not
> task state. Task status is kept only in the checklists —
> [`frontend/FRONTEND_CHECKLIST.md`](../../frontend/FRONTEND_CHECKLIST.md) §13
> for doctor/admin web,
> [`patient-app/PATIENT_FRONTEND_CHECKLIST.md`](../../patient-app/PATIENT_FRONTEND_CHECKLIST.md)
> for the patient app, and
> [`docs/multi-hospital/CLIENTS_CHECKLIST.md`](../multi-hospital/CLIENTS_CHECKLIST.md)
> for the multi-hospital WEB-* and PA-* deliverables Phases 22A and 25–27 list.
> Where a phase file disagrees with them, they win.

- **Audited:** 2026-10-07, against this checkout (local `frontend` @ `51cefbd`)
  and the remote integration branches (`origin/main` @ `033e1d8`,
  `origin/frontend` @ `c258d83`, `origin/backend` @ `b259708`,
  `origin/patient-app` @ `61ba9d3`, `origin/Database` @ `ed57b38`,
  `origin/Ai` @ `3f0436e`).
- **Reconciled:** 2026-10-07 with the owner's FINAL Multi-Hospital decisions
  (`docs/multi-hospital/OWNER_DECISIONS.md`, DR-01…DR-13 and OD-01…OD-14).
- **Checkout caveat:** this checkout is behind `origin/frontend`. That includes
  PR #41 (the 2026-10-06 organization realignment of the checklist), PR #44,
  PR #45 and PR #46. Evidence from them is cited as `origin/frontend:<path>`.
- **Original files are untouched.** No original phase file
  (`frontend/PHASE*.md`, `PROJECT_SETUP.md`, `COMPONENT_LIBRARY.md`,
  `STABILIZATION_POST_PHASE16.md`, `FRONTEND_CHECKLIST.md`,
  `docs/FE-10-INTEGRATION-STATUS.md`) was modified, renamed or deleted. Each
  phase file names its `Original Source`.

---

## Roadmap reconciliation — read this first (2026-10-07)

1. **Phases 00–19 are historical.** They record what was built, and their
   status is evidence-based (below). They are not re-planned. Their
   *Remaining Work* notes were realigned to the Hospital model and point at the
   future phases that now own the work.
2. **Frontend phases A–F and FE-10.1–10.10 are historical / ongoing integration
   tracks.** FE-10 left 27 rows connected, 22 still mock and 10 blocked. Those
   rows are owned by Phases 26, 28 and 29.
3. **Phases 20–31 (plus 22A) are audit-derived work tracks.** Phase 21's
   database model is under review in the database-only pull request
   `fix/phase21-database-main-integration` (superseding the database part of
   PR #9). Phase 22 shadow context work is preserved on PR #9 / PR #12 and is
   not part of `main`. Neither status implies persistent migration
   application or tenant-enforcement readiness.
4. **Phase 20 is now based on the owner's decisions**
   (`docs/multi-hospital/OWNER_DECISIONS.md`). It formalizes them as
   **ADR-042**.
5. **Hospital is the isolation boundary.** "Organization" wording from the
   2026-10-06 realignment must not override it (DR-01). A **Clinic** is a
   separate entity inside a hospital. A hospital has **multiple Locations** in
   v1. Neither is a boundary (OD-06).
6. **Public discovery is replaced by authenticated discovery** (DR-09).
7. **Doctor hospital switching is removed** (DR-08).
8. **Simultaneous multi-hospital employment is removed.** A doctor has one
   active employment (DR-02).
9. **Hospital-specific Medical Records are required.** There is one per patient
   per hospital, and no shared universal record (DR-03, DR-04).
10. **AI cross-hospital isolation is required** (DR-12 = OD-05). AI uses the
    current hospital by default. It may use cross-hospital data **only** under a
    valid grant or valid Break-Glass, within its categories or scope, while it
    is valid. It retains **nothing** raw after either ends. *(An earlier revision
    said "a doctor's grant never extends to the AI"; that is superseded.)*
11. **Cross-hospital access has exactly two paths**, both audited and never
    permanent (DR-06, OD-01…OD-04):
    - a **normal grant**: purpose-limited, category-limited (categories selected
      by the target Hospital Admin), revocable, no fixed default duration, no
      patient consent required;
    - **emergency Break-Glass** (OD-04 = A): emergency reason, minimum-necessary
      scope, time-limited, fully audited and attributed, immediately revocable.
      It bypasses neither employment authorization nor hospital isolation.

    Selected, doctor-reviewed and doctor-approved information may be
    **documented into the requesting hospital's record** with provenance; it
    becomes that hospital's data and opens no access to the source (OQ-01 = A).
    Cross-hospital **consultations** are allowed and never bypass a grant or
    Break-Glass (OD-13). All of this lives in Phase **22A**.
12. **Administration** is Platform Admin + Hospital Admin. A Platform Admin has no
    automatic clinical access, and existing admin accounts are mapped
    deliberately (OD-07).
13. **Discovery** is authenticated comparison (distance, ratings, next slot,
    insurance). Uninsured patients are unrestricted (OD-10, OD-14). **Booking**
    is capacity-1 published slots (OD-08). The **Medical Record** is created on
    the first real interaction (OD-09). **Employment end** revokes access
    immediately (OD-12).
14. **All of OD-01…OD-14 and OQ-01 are FINAL** (2026-10-07). One owner question
    remains open and deferred: OQ-02 (record-claim identity proofing, linked to
    RA-030.1). It does not block the architecture.

Six Phase 22–28 files were renamed because their titles described the
superseded model. Each renamed file says so in its header:

| Old filename | New filename |
|---|---|
| `PHASE-22-ORGANIZATION-SCOPED-IDENTITY-AND-AUTHORIZATION.md` | `PHASE-22-HOSPITAL-CONTEXT-AND-AUTHORIZATION.md` |
| `PHASE-23-PUBLIC-DISCOVERY-API.md` | `PHASE-23-AUTHENTICATED-DISCOVERY-API.md` |
| `PHASE-24-AVAILABILITY-AND-MULTI-HOSPITAL-BOOKING.md` | `PHASE-24-PUBLISHED-SLOTS-AND-BOOKING.md` |
| `PHASE-25-DOCTOR-WORKSPACE-MULTI-HOSPITAL.md` | `PHASE-25-DOCTOR-WORKSPACE-HOSPITAL-SCOPED.md` |
| `PHASE-26-ORGANIZATION-AND-PLATFORM-ADMINISTRATION.md` | `PHASE-26-HOSPITAL-ADMIN-AND-PLATFORM-CONSOLES.md` |
| `PHASE-28-AI-CONTEXT-AND-ORGANIZATION-ISOLATION.md` | `PHASE-28-AI-CONTEXT-AND-HOSPITAL-ISOLATION.md` |

The old filenames were never committed, so nothing outside this folder referenced
them.

---

## How status was assigned

A historical phase's status describes **its own original objective as it stands
in the current repository**:

- **COMPLETED** — the objective was delivered and still holds.
- **PARTIALLY COMPLETED** — part of the objective is not delivered.
- **SUPERSEDED** — the objective was delivered and later overtaken.
- **OBSOLETE** — the feature no longer exists.

Work that the original phase explicitly excluded (usually "no backend") is **not**
counted against it. It is listed under *Remaining Work* and assigned to the new
phase that now owns it. Nothing is marked completed because a plan exists.

## Two numbering systems

`frontend/FRONTEND_ARCHITECTURE.md` §13.1 *planned* phases 0–10 (0 setup,
1 tokens, 2 design-system core, 3 shell, 4 auth … 10 backend integration). The
*executed* phase documents used a different numbering (2 = doctor dashboard,
9 = auth, 10 = AI…). This folder follows the **executed** numbering.

**FE-10** (`docs/FE-10-INTEGRATION-STATUS.md`) is *planned* Phase 10 "backend
integration", not executed Phase 10 (AI). After Phase 19, frontend work
continued as lettered **checklist phases A–F**, and Phase E was executed as
FE-10.

---

## Historical phases (migrated)

| Phase | Title | Status | Original Source |
|---|---|---|---|
| [00](PHASE-00-PROJECT-SETUP-AND-SCAFFOLDING.md) | Project Setup & Scaffolding | COMPLETED | `frontend/PROJECT_SETUP.md` |
| [01](PHASE-01-DESIGN-TOKENS-AND-COMPONENT-LIBRARY.md) | Design Tokens, Theme & Component Library | COMPLETED | `frontend/COMPONENT_LIBRARY.md` |
| [02](PHASE-02-DOCTOR-DASHBOARD-SHELL-AND-OVERVIEW.md) | Doctor Dashboard Shell & Overview | COMPLETED | `frontend/PHASE2_DOCTOR_DASHBOARD.md` |
| [03](PHASE-03-DOCTOR-PATIENTS-MODULE.md) | Doctor Patients Module | COMPLETED | `frontend/PHASE3_PATIENTS_MODULE.md` |
| [04](PHASE-04-DOCTOR-PATIENT-PROFILE.md) | Doctor Patient Profile | COMPLETED | `frontend/PHASE4_PATIENT_PROFILE.md` |
| [05](PHASE-05-DOCTOR-APPOINTMENTS.md) | Doctor Appointments | COMPLETED | `frontend/PHASE5_APPOINTMENTS.md` |
| [06](PHASE-06-DOCTOR-MEDICAL-RECORDS.md) | Doctor Medical Records | COMPLETED | `frontend/PHASE6_MEDICAL_RECORDS.md` |
| [07](PHASE-07-DOCTOR-LABORATORY.md) | Doctor Laboratory System | COMPLETED | `frontend/PHASE7_LAB_SYSTEM.md` |
| [08](PHASE-08-DOCTOR-PHARMACY.md) | Doctor Pharmacy Management | COMPLETED (medication database D-18 blocked) | `frontend/PHASE8_PHARMACY_SYSTEM.md` |
| [09](PHASE-09-AUTHENTICATION.md) | Authentication | COMPLETED | `frontend/PHASE9_AUTHENTICATION.md` |
| [10](PHASE-10-DOCTOR-AI-ASSISTANT.md) | Doctor AI Assistant | PARTIALLY COMPLETED | `frontend/PHASE10_AI_ASSISTANT.md` |
| [11](PHASE-11-NOTIFICATIONS-AND-COMMUNICATION-CENTER.md) | Notifications & Communication Center | PARTIALLY COMPLETED | `frontend/PHASE11_NOTIFICATIONS.md` |
| [12](PHASE-12-UI-UX-REFINEMENT-AND-MOCK-DATA.md) | UI/UX Refinement & Mock Data Optimization | SUPERSEDED | `frontend/PHASE12_UI_UX_REFINEMENT.md` |
| [13](PHASE-13-ENTERPRISE-UI-POLISH.md) | Enterprise UI Polish | SUPERSEDED | `frontend/PHASE13_ENTERPRISE_UI_POLISH.md` |
| [14](PHASE-14-DOCTOR-MESSAGING-CENTER.md) | Doctor Messaging Center | PARTIALLY COMPLETED | `frontend/PHASE14_MESSAGING_CENTER.md` |
| [15](PHASE-15-DOCTOR-SETTINGS-AND-PROFILE.md) | Doctor Settings & Profile Center | PARTIALLY COMPLETED | `frontend/PHASE15_DOCTOR_SETTINGS_PROFILE.md` |
| [16](PHASE-16-REPORTS-AND-ANALYTICS.md) | Reports & Analytics Center | PARTIALLY COMPLETED | `frontend/PHASE16_REPORTS_ANALYTICS.md` |
| [16A](PHASE-16A-STABILIZATION-POST-PHASE-16.md) | Stabilization Pass (Post Phase 16) | COMPLETED | `frontend/STABILIZATION_POST_PHASE16.md` |
| [17A](PHASE-17A-DOCTOR-ADMINISTRATION-CENTER.md) | Doctor Administration Center | SUPERSEDED | `frontend/PHASE17_DOCTOR_ADMINISTRATION_CENTER.md` |
| [17B](PHASE-17B-STABILIZATION-AND-SETTINGS-COMPLETION.md) | Stabilization & Settings Completion | COMPLETED | `frontend/PHASE17_STABILIZATION_AND_SETTINGS_COMPLETION.md` |
| [18](PHASE-18-ADMIN-PLATFORM-COMPLETION.md) | Admin Panel Completion & Platform Parity | PARTIALLY COMPLETED | `frontend/PHASE18_ADMIN_PLATFORM_COMPLETION.md` |
| [19](PHASE-19-PERFORMANCE-SECURITY-AND-PLATFORM-CONSISTENCY.md) | Performance, Authentication & Platform Consistency | COMPLETED (authorization assumptions require Multi-Hospital review) | `frontend/PHASE19_PERFORMANCE_SECURITY_AND_PLATFORM_CONSISTENCY.md` |

Two source files both call themselves "Phase 17", so they are recorded as
**17A** and **17B**. The post-16 stabilization pass declares itself "no new
phase"; it is recorded as **16A** so it is not lost.

## Post-19 frontend tracks

| File | Title | Status | Original Source |
|---|---|---|---|
| [FE-A](FE-PHASE-A-STOP-SHIPPING-BLIND.md) | Stop Shipping Blind (tests, CI, a11y basics) | COMPLETED | `frontend/FRONTEND_CHECKLIST.md` §7 |
| [FE-B](FE-PHASE-B-ADMIN-AREA-HONESTY.md) | Make the Admin Area Honest | COMPLETED (frontend); clinic-operations data still mock on `main` | `frontend/FRONTEND_CHECKLIST.md` §5, §7 |
| [FE-C](FE-PHASE-C-ADMIN-DASHBOARD.md) | Build the Real Admin Dashboard | COMPLETED (frontend); server enforcement owed; partly blocked (F33) | `frontend/FRONTEND_CHECKLIST.md` §4, §7 |
| [FE-D](FE-PHASE-D-DOCTOR-CLINICAL-LOOP.md) | Close the Doctor's Clinical Loop | PARTIALLY COMPLETED | `frontend/FRONTEND_CHECKLIST.md` §3, §7 |
| [FE-E](FE-PHASE-E-LIVE-API-INTEGRATION-FE-10.md) | Leave the Mocks Behind / FE-10.1–10.10 | PARTIALLY COMPLETED (27 connected · 22 mock · 10 blocked) | `frontend/FRONTEND_CHECKLIST.md` §7 + `docs/FE-10-INTEGRATION-STATUS.md` |
| [FE-F](FE-PHASE-F-DASHBOARD-EXPERIENCE-UPGRADE.md) | Dashboard Experience Upgrade | COMPLETED (F1, F4) · OBSOLETE (F2, F3: Anatomy removed) | `frontend/FRONTEND_CHECKLIST.md` §10 |

FE-10 sub-phases, from commits recorded in `docs/FE-10-INTEGRATION-STATUS.md`:

| Sub-phase | What it connected | Status |
|---|---|---|
| 10.1 | Live transport | COMPLETED |
| 10.2 | Patients | COMPLETED |
| 10.3 | Appointments | COMPLETED |
| 10.4 | Overview and time off | COMPLETED, 4 widgets mock |
| 10.5 | Records | COMPLETED |
| 10.6 | Prescribing | COMPLETED |
| 10.7 | Labs | COMPLETED |
| 10.8 | Notifications | COMPLETED, preferences and inbox actions mock |
| 10.9 | Settings | PARTIALLY COMPLETED (privacy, integrations and preferences mock) |
| 10.10 | Admin | Wired but **BLOCKED** (F33) |
| 10.V | Validation | COMPLETED in mock mode only (F39) |

## Future phases (audit-derived, reconciled with owner decisions)

| Phase | Title | Primary Area | Status | Owner decisions | Depends On |
|---|---|---|---|---|---|
| [20](PHASE-20-MULTI-HOSPITAL-ARCHITECTURE-DECISION.md) | Multi-Hospital Architecture Decision (ADR-042) | Architecture | IN PROGRESS (ADR-042 accepted and registered 2026-11-22; remaining review sign-offs open) | DR-01…13 | — |
| [21](PHASE-21-MULTI-HOSPITAL-DATA-MODEL-AND-MIGRATION.md) | Data Model & Migration | Database + Backend | UNDER REVIEW (database-only PR from `fix/phase21-database-main-integration`); migration application in persistent environments remains unknown | DR-01…04, 06, 07, 10, 11 · OD-06, 09, 12 | 20 |
| [22](PHASE-22-HOSPITAL-CONTEXT-AND-AUTHORIZATION.md) | Hospital Context, Session & Authorization | Backend + Security | IN PROGRESS on PR #9 / PR #12 (shadow only; not in `main`; backend handoff in `docs/multi-hospital/PHASE22_BACKEND_HANDOFF.md`) | DR-01, 02, 04, 05, 07, 08 · OD-07, 12 | 20, 21 |
| [22A](PHASE-22A-CROSS-HOSPITAL-ACCESS-WORKFLOW.md) | Cross-Hospital Access: Grants, Break-Glass, Documentation & Consultations | Backend + Security + Frontend | NOT STARTED | DR-06, 07 · OD-01…05, 07, 12, 13 · OQ-01 | 21, 22 |
| [23](PHASE-23-AUTHENTICATED-DISCOVERY-API.md) | Authenticated Hospital & Doctor Discovery API | Backend | NOT STARTED | DR-09, 02 · OD-06, 10, 14 | 21, 22 |
| [24](PHASE-24-PUBLISHED-SLOTS-AND-BOOKING.md) | Doctor-Published Slots & Hospital-Scoped Booking | Backend + Database | NOT STARTED | DR-10, 11 · OD-08, 09 | 21, 22, 23 |
| [25](PHASE-25-DOCTOR-WORKSPACE-HOSPITAL-SCOPED.md) | Doctor Workspace: Current-Hospital Scope | Frontend | NOT STARTED | DR-02, 04, 05, 06, 08, 10 | 22, 22A, 24 |
| [26](PHASE-26-HOSPITAL-ADMIN-AND-PLATFORM-CONSOLES.md) | Hospital Administration & Platform Administration | Frontend + Backend | NOT STARTED | DR-01, 02, 06 · OD-07, 08, 12 | 21, 22, 22A |
| [27](PHASE-27-PATIENT-APP-DISCOVERY-AND-BOOKING.md) | Patient App: Authenticated Discovery, Booking & Per-Hospital Records | Patient App | NOT STARTED | DR-03, 09, 10, 11, 12 · OD-08, 09, 10 | 22, 23, 24 |
| [28](PHASE-28-AI-CONTEXT-AND-HOSPITAL-ISOLATION.md) | AI Integration, Hospital Isolation & Authorization-Bound Retention | AI + Backend + Frontend | NOT STARTED | DR-12, 13 · OD-05, 11, 12, 13 | 10, 22, 22A, 25, 27 |
| [29](PHASE-29-CROSS-LAYER-INTEGRATION-CLOSURE.md) | Cross-Layer Integration Closure | Integration | NOT STARTED | DR-01, 04, 07 · OD-13 | 22, 25, 26, 27 |
| [30](PHASE-30-SECURITY-AND-DATA-ISOLATION-VERIFICATION.md) | Cross-Hospital Security & Isolation Verification (**critical gate**) | Security + Testing | NOT STARTED | DR-01…12 | 21–29 |
| [31](PHASE-31-FULL-SYSTEM-QA-AND-PRODUCTION-READINESS.md) | Full-System QA & Second-Hospital Readiness Gate | Testing + Integration | NOT STARTED | all | 30 |

### Dependency graph

```text
Owner Decisions DR-01…DR-13 + OD-01…OD-14 (FINAL, 2026-10-07)
      ↓
Phase 20  Hospital Architecture / ADR-042 (supersedes ADR-018 §1, ADR-010 clause, ADR-022 anchor)
      ↓
Phase 21  Data Model  ──▶  Migration (default hospital backfill)           [gate G-1]
      ↓
Phase 22  Hospital Authorization / Context (no switcher)                    [G-2, G-4]
      ├──────────────▶ Phase 22A Grants + Break-Glass + documentation + consultations [G-3]
      ↓
Hospital-Scoped APIs (22 scopes existing routes; 26 and 29 add scoped modules)
      ↓
Phase 23  Authenticated Discovery
      ↓
Phase 24  Doctor-Published Slots / Booking                                  [G-6]
      ↓
Phases 25 (doctor web) · 26 (admin web) · 27 (patient app) · 29 (closure)   [G-4, G-7]
      ↓
Phase 28  AI isolation, grant/Break-Glass-bound, no raw retention (provider after G-5) [G-5]
      ↓
Phase 30  Cross-Hospital Security Tests (critical gate)                     [G-1…G-8]
      ↓
Phase 31  Full-System QA ──▶ Second-Hospital Readiness Gate
```

Gates G-1…G-8 are defined in `docs/multi-hospital/SECURITY_AND_DATA_ISOLATION.md`
§8. The step order is in `docs/multi-hospital/IMPLEMENTATION_ORDER.md`.

### Where existing tracks fit

| Existing track | Where it lands |
|---|---|
| Phases 00–19, FE-A…FE-F | Historical base; their remaining multi-hospital items go to 21, 22, 22A, 25, 26, 28, 29 |
| FE-10.1–10.10 | Base adapters for 25/26/27; Still Mock / Blocked rows close in 22 (F33), 26, 28, 29 |
| Backend M0–M15 (incl. M7 authorization) | Done on `main`; M7's assignment anchor is replaced in **22** |
| M16 AI | **28** |
| M17/M18 billing, payments | Out of scope (ADR-037/038/039) |
| M19 notifications, M20 messaging, M21 reports, M25 files, M26 search, M27 composites | **29** (hospital-scoped; messaging after the AF-16 fix) |
| M22 settings | 22, 25 |
| M23 administration, M24 platform settings, M28/M29 audit and activity logs | **26** (audit hospital column in 21) |
| M30–M36 jobs, caching, performance, API docs, testing, Docker, CI/CD | Cross-cutting; caching isolation in 22 / 30 |
| M37 security hardening | **30** |
| M38–M43 readiness, contract alignment, integration, mobile validation, QA, release | **31** |
| Backend phase groups A–E (`docs/ARCHITECTURE_RECONCILIATION.md`) | Groupings of the milestones above |
| Patient-app Phases E, G, H, I, J, O, P | **27** (signed-out items dropped, DR-09) |
| Patient-app K, L (AI, imaging) | **28** |
| Patient-app M (messaging) | **29** |
| Patient-app T, U (security, testing) | **30** |
| Patient-app V, W (integration, release) | **31** |
| Patient mobile enablement Phases 1–4 (ADR-030) | Done; global patient identity is compatible with DR-03 |
| DX tranches F1–F4 | FE-F (historical) |

---

## Other phase schemes discovered (not migrated as PHASE files)

These are living checklists owned by other teams, with their own IDs. Copying
them here would fork their source of truth.

| Scheme | Where |
|---|---|
| Planned frontend phases 0–10 | `frontend/FRONTEND_ARCHITECTURE.md` §13.1 |
| Backend milestones M0–M43 | `backend/docs/BACKEND_IMPLEMENTATION_ROADMAP.md` |
| Backend phase groups A–E | `docs/ARCHITECTURE_RECONCILIATION.md` |
| Patient-app phases A–W | `patient-app/PATIENT_FRONTEND_CHECKLIST.md` (2026-10-06 realignment on `origin/patient-app` is partly superseded, see `docs/multi-hospital/AUDIT_FINDINGS.md` AF-32) |
| Patient mobile enablement phases 1–4 | `backend/docs/PATIENT_MOBILE_ENABLEMENT.md` |
| DX tranches F1–F4 | `frontend/FRONTEND_CHECKLIST.md` §10 |
| M0.1 / M0.2 analysis | `docs/M0_REPOSITORY_ANALYSIS.md` |
| Superpowers specs/plans (ADM-01, ADM-06a/b, ADM-07, DX-F1, DX-F2, M7) | `docs/superpowers/` |

## Multi-hospital documentation

`docs/multi-hospital/` was created on 2026-10-07. The phases reference it as
follows:

| Phase | Documents |
|---|---|
| 20 | OWNER_DECISIONS, MASTER_PLAN, MIGRATION_AND_COMPATIBILITY, DATA_MODEL_CHANGES, SECURITY_AND_DATA_ISOLATION |
| 21 | DATA_MODEL_CHANGES, DATABASE_CHECKLIST, MIGRATION_AND_COMPATIBILITY |
| 22 | BACKEND_CHECKLIST, API_CONTRACT_CHANGES, SECURITY_AND_DATA_ISOLATION |
| 22A | OWNER_DECISIONS (DR-06), API_CONTRACT_CHANGES §3, SECURITY_AND_DATA_ISOLATION §3, CLIENTS_CHECKLIST |
| 23 | DISCOVERY_AND_BOOKING, API_CONTRACT_CHANGES §4 |
| 24 | DISCOVERY_AND_BOOKING, API_CONTRACT_CHANGES §5, DATA_MODEL_CHANGES §4 |
| 25 | CLIENTS_CHECKLIST, API_CONTRACT_CHANGES |
| 26 | CLIENTS_CHECKLIST, BACKEND_CHECKLIST, OWNER_DECISIONS (OD-07) |
| 27 | CLIENTS_CHECKLIST, DISCOVERY_AND_BOOKING, API_CONTRACT_CHANGES |
| 28 | AI_CHECKLIST, SECURITY_AND_DATA_ISOLATION |
| 29 | BACKEND_CHECKLIST, API_CONTRACT_CHANGES |
| 30 | SECURITY_AND_DATA_ISOLATION |
| 31 | IMPLEMENTATION_ORDER, MIGRATION_AND_COMPATIBILITY |

## Decisions

- **Owner-approved:** DR-01…DR-13 in `docs/multi-hospital/OWNER_DECISIONS.md`.
- **OD-01…OD-14:** all **FINAL** (2026-10-07), in the same file.
- **OQ-01:** **FINAL = A** — doctor-approved, selective documentation into the
  requesting hospital's record, with provenance.
- **OD-04:** **FINAL = A** — Break-Glass emergency access exists.
- **Remaining owner question:** OQ-02 only (record-claim identity proofing,
  RA-030.1) — open and deferred to implementation; it does not block the
  architecture.
- **Unscheduled items outside 20–31:**
  - D-18 drug reference data source
  - D-22 sharing policy
  - whether axe failures in Storybook block CI (F-09)
