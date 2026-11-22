# Medora — Project Backend Master Guide

**Document type:** Backend source of truth — complete project understanding for backend engineers and AI assistants
**Source:** Full repository audit of the unified frontend branch (Phases 0–19, 522 tracked files) at commit `16757a2`
**Audience:** A senior backend engineer (or AI assistant) who has never seen this repository
**Date:** 2026-08-06
**Status:** Authoritative. Companion documents: `BACKEND_IMPLEMENTATION_ROADMAP.md` (build order) and `BACKEND_API_CONTRACT.md` (endpoint specification). The database dictionary lives in `DATABASE_SCHEMA_EXTRACTION.md` and is **not duplicated here** — this guide references it by section.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Project Status](#2-project-status)
3. [Technology Stack](#3-technology-stack)
4. [Repository Structure](#4-repository-structure)
5. [Frontend Architecture (what the backend must serve)](#5-frontend-architecture)
6. [User Roles & Permissions](#6-user-roles--permissions)
7. [Complete Feature Analysis (module by module)](#7-complete-feature-analysis)
8. [Backend Requirements](#8-backend-requirements)
9. [Database Design](#9-database-design)
10. [API Design Recommendations](#10-api-design-recommendations)
11. [Security Requirements](#11-security-requirements)
12. [Performance Recommendations](#12-performance-recommendations)
13. [Testing Strategy](#13-testing-strategy)
14. [Deployment](#14-deployment)
15. [Mobile Readiness](#15-mobile-readiness)
16. [AI Readiness](#16-ai-readiness)
17. [Known Gaps & Assumptions](#17-known-gaps--assumptions)
18. [Final Recommendations](#18-final-recommendations)

Throughout this document, three labels distinguish claim types (a binding convention from the project's own docs):

- **[EXISTING]** — implemented in the frontend today; the backend must match it.
- **[DERIVED]** — not implemented, but directly required by frontend code/UX blueprint; the backend must provide it.
- **[RECOMMENDATION]** — professional advice; not required by the frontend; adopt deliberately.

---

# 1. Executive Summary

## 1.1 Project purpose

**Medora** is an AI-powered healthcare management platform for clinics and hospitals. The current repository contains the **complete website frontend** — a React 18 + TypeScript single-page application covering two staff roles (Doctor, Administrator) across 19 delivered build phases. There is **no backend**: every feature runs against deterministic mock services and seed datasets that were deliberately shaped to mirror future API DTOs. The backend described by this guide is the system that replaces those mocks.

## 1.2 Business goals

- Give attending physicians a **speed-to-context** clinical workspace: full patient context in <5 seconds, every frequent action ≤2 clicks (UX persona: Dr. Amira Hassan, 18–30 patients/day, 30–90-second interaction bursts).
- Give platform administrators an **oversight-and-traceability** console: doctor verification, platform health, security investigation with a complete audit trail (persona: Karim Nasser).
- Guard clinical safety structurally: fail-closed prescription screening, mandatory critical-lab review, non-dismissible allergy surfacing, AI output that never enters a record without doctor review.
- Prepare for a **patient/receptionist mobile application** and deeper AI integration on the same backend.

## 1.3 Healthcare workflow (as built)

A doctor signs in → lands on an Overview dashboard (today's schedule, action queue, KPIs, critical alerts) → manages patients (list → full profile with history/visits/meds/labs/documents/notes) → decides on appointment requests (approve/reject/reschedule status machine) → documents encounters as medical records (diagnoses, vitals, treatment plan, signed notes) → orders and reviews lab work (specimen pipeline, flagged results, critical-review discipline) → prescribes through a safety-screened flow (allergy conflicts block; severe interactions require acknowledged override) → communicates via internal messaging → is assisted by a context-bound AI assistant → reviews practice analytics → self-manages settings (profile, security incl. 2FA and sessions, notification preferences, integrations).

An administrator signs in → lands on the **Administration Center** (a separate full-screen shell at `/doctor/administration/*`, admin-only since Phase 19) → manages clinic operations (staff, departments, rooms, resources, schedules, holidays, shifts, live queue, waiting room, announcements, policies, document templates) → monitors platform status (system health, license, registrations, audit events) → configures the platform (16 settings panels: identity, branding, localization, notifications, email/SMS, security policy, users & roles, API keys, audit, integrations, backup, retention, privacy) → reuses the doctor Settings Center for personal settings.

## 1.4 Target users

| Role | Status | Notes |
|---|---|---|
| Doctor | **[EXISTING]** — complete workspace | Primary clinical user |
| Administrator | **[EXISTING]** — Administration Center | Operations + platform governance |
| Reception / Laboratory / Pharmacy / Nurse | **[DERIVED]** — appear in `PlatformRole`/`StaffRole` unions, staff records, and the roles editor | Accounts exist as data; no dedicated UI shells yet |
| Patient | **[DERIVED — future]** — explicitly out of scope for the current dashboards; patients are *records*, not users | Mobile app / portal target |

## 1.5 Current progress & future vision

Frontend: 19 phases complete, production-grade quality gates green (`tsc` 0 errors, ESLint 0 errors, Vite build passing; entry bundle 400 kB / 128 kB gzip after the Phase 19 performance pass). Future vision per the product docs: real backend (this effort), patient & receptionist experiences, mobile application, real AI clinical assistant, billing (currently feature-flagged off), multi-clinic support.

---

# 2. Project Status

## 2.1 Completed frontend features [EXISTING]

| Phase | Delivered |
|---|---|
| 0–1 | Vite/TS-strict scaffold, design tokens, theming (light/dark/system, no-flash boot), component library (Tier 1 atoms, Tier 2 patterns, charts) |
| 2 | Doctor dashboard (KPIs, schedule, action queue, charts, activity, quick actions) |
| 3–4 | Patients list + full patient profile (8 tabs, allergy strip, vitals, meds, documents, notes) |
| 5 | Appointments (list/day/week/month calendar, status machine, decision flows) |
| 6 | Medical records (list + full clinical document detail) |
| 7 | Laboratory (orders, specimen pipeline, results with flags, timelines, attachments) |
| 8 | Pharmacy (prescriptions, safety warnings, refills, medication catalogue) |
| 9 | Authentication (login, signup, forgot/reset, verify email, OTP 2FA, lock screen, i18n en/ar on auth surface) |
| 10 | AI Assistant (conversations, context binding, streaming mock, settings) |
| 11 | Notifications (feed, preferences, communication center, shell bell) |
| 12–13 | UI/UX refinement & enterprise polish passes |
| 14 | Messaging center (folders, threads, composer, attachments-as-metadata) |
| 15 | Doctor Settings & Profile Center (11 sections) |
| 16 | Reports & analytics (9 report categories, saved & scheduled reports, insights) |
| 17 | Doctor Administration Center (clinic ops, 14 sections) + stabilization |
| 18 | Admin Platform Completion (16 platform-settings panels, users/API keys/backups) |
| 19 | Performance (LazyMotion, on-demand mocks), security (admin-only administration, open-redirect fix, role-aware returnTo), platform consistency (shared header/settings/notifications), mock silent refresh |

## 2.2 Incomplete / not built [DERIVED unless noted]

- **Everything server-side.** All data is mock: in-memory `Map` stores, localStorage persistence, deterministic seeds (5-patient canonical roster, ~5 records per admin dataset).
- The original **UX §3 “Admin Dashboard”** (doctors management/verification, patients governance, appointment oversight, communication monitoring, system logs investigation, admin reports) was **superseded** in implementation by the Administration Center — but its capabilities (verification queue, PHI masking/reveal, content-access gate, immutable log investigation) remain confirmed product scope the backend must support (they are SPEC entities in the DB dictionary).
- Files/uploads: every attachment is metadata-only (“Null until the files service exists”).
- Real-time: badge counts and presence are polled mocks; no WebSocket/SSE.
- Billing: feature-flagged off (`featureFlags.billing = false`); revenue widgets exist but render alternates.
- AI: canned deterministic responses (`AI_MODEL_NAME = 'Medora Clinical Assistant (mock)'`).
- Planned mobile application: not started; backend must be API-first for it (§15).

## 2.3 Known assumptions

- Single clinic / single tenant today (multi-clinic hinted for later). ⚠ *Superseded as a direction (2026-10-07):* the owner decided a multi-**hospital** platform with **Hospital** as the isolation boundary; Clinic and Location are entities inside a hospital, never boundaries. Plan: `docs/multi-hospital/` (accepted ADR-042, registered in docs/DECISIONS.md).
- English UI (auth surface also Arabic); localization slice exists in platform settings.
- Patients do not authenticate in the current scope.
- Demo credentials (`Medora123!`, OTP `123456`) are mock-only and must never seed any real environment.

## 2.4 Missing information (needs product decision)

See §17 for the consolidated list (appointment/prescription enum unification, availability model, second-admin approval policy default, retention defaults, deployment target).

---

# 3. Technology Stack

## 3.1 Existing frontend stack [EXISTING — do not change]

| Concern | Choice |
|---|---|
| Framework | React 18.3, TypeScript 5.7 `strict` (+ `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) |
| Build | Vite 6, npm (package-lock.json), Node ≥ 20 |
| Routing | React Router 6.28 (`createBrowserRouter`, layout-route guards, lazy feature chunks) |
| Server state | TanStack Query 5 (query-key factory, invalidation by prefix) |
| Forms/validation | React Hook Form 7 + Zod 3.24 (`@hookform/resolvers`) |
| Styling | Tailwind 3.4 over CSS-variable design tokens; Framer Motion 11 via LazyMotion |
| Icons/fonts | Lucide; self-hosted Inter/Open Sans/JetBrains Mono |
| Lint/format | ESLint 9 flat config (boundary rules), Prettier |
| Env contract | `VITE_API_BASE_URL` (default `http://localhost:3000/api`), `VITE_APP_ENV`, `VITE_ENABLE_MOCKS` — Zod-validated at boot |

## 3.2 Recommended backend stack [RECOMMENDATION — aligned with existing decisions]

Chosen to preserve the project's TypeScript-first, Zod-validated, strict-typing culture and the transport contract already coded into `src/api/`:

| Concern | Recommendation | Rationale |
|---|---|---|
| Runtime | Node.js 20 LTS, TypeScript strict | One language across the platform; shared validation vocabulary |
| Framework | **NestJS 10** (Express adapter) | Module system mirrors the frontend's feature-module isolation; DI, guards, interceptors map 1:1 onto the required cross-cutting concerns (auth, RBAC, audit, correlation IDs) |
| ORM | **Prisma** | Named in the project's own roadmap template; typed client matches the DTO-mirror philosophy |
| Database | **PostgreSQL 16+** | Target engine declared in `DATABASE_SCHEMA_EXTRACTION.md`; needs `pgcrypto`, `citext`, `pg_trgm`; RLS for PHI scoping |
| Validation | **Zod** (nestjs-zod or pipes) | The frontend already treats Zod schemas as the source of truth; sharing schema conventions prevents drift |
| AuthN | Short-lived **JWT access token** (Bearer, in-memory client-side) + **opaque rotating refresh token** in `httpOnly; Secure; SameSite=Strict` cookie | This exact split is hardcoded into the frontend architecture (§6.2) and `ApiClient` |
| Password hashing | **Argon2id** | DB spec §10 |
| Cache / queues | **Redis 7** + **BullMQ** | Sessions/rate limits/badge caching; background jobs (notifications, scheduled reports, expiry sweeps) |
| Object storage | S3-compatible (MinIO dev / S3 prod) | Central `files` table (DB spec §11) with storage keys, checksums, malware-scan gate |
| Realtime | **SSE first** (AI streaming + notification invalidation), WebSocket later | Frontend consumes polling today and was designed to upgrade "without changing consumers" |
| API docs | OpenAPI 3.1 via Nest Swagger, generated from code | Contract-first parity with `BACKEND_API_CONTRACT.md` |
| Testing | Vitest/Jest + Supertest + Testcontainers (Postgres) | Mirrors frontend testing pyramid |
| Logging | pino (JSON), correlation-id aware | Client already sends `X-Correlation-Id` per request |
| Monitoring | OpenTelemetry + Prometheus/Grafana; Sentry for errors | System-health card and admin reports expect uptime/latency/error-rate data |
| Container/deploy | Docker + docker-compose (dev), CI via GitHub Actions | §14 |

**Explicitly rejected alternatives:** session-cookie-only auth (contradicts coded Bearer flow), MongoDB (schema is deeply relational), GraphQL (frontend endpoint layer is REST-shaped).

---

# 4. Repository Structure

Complete map of the frontend repository. The backend engineer needs this to know *where every contract lives*.

```
Medora_System/
├── index.html, vite.config.ts, tsconfig*.json, tailwind.config.ts,
│   postcss.config.js, eslint.config.js, .prettierrc, .env.example
├── package.json                      # scripts: dev/build/typecheck/lint/format
│
├── *.md                              # Project documentation set:
│   ├── DESIGN_SYSTEM.md              # tokens, components, motion, a11y rules
│   ├── UX_ARCHITECTURE.md            # binding UX blueprint: personas, route map,
│   │                                 #   patterns P1–P8, PHI safety rules §1.5,
│   │                                 #   per-screen specs, admin scope §3
│   ├── FRONTEND_ARCHITECTURE.md      # structure, auth/token contract, API layer,
│   │                                 #   state rules, security §12
│   ├── COMPONENT_LIBRARY.md, PROJECT_SETUP.md, UX/PHASE2…PHASE19 docs
│   └── DATABASE_SCHEMA_EXTRACTION.md # ★ full reverse-engineered DB dictionary
│
└── src/
    ├── main.tsx, app/
    │   ├── App.tsx                   # provider stack + router mount
    │   ├── providers/                # Auth, Query, Theme, Motion(Lazy), Toast,
    │   │   │                         #   DoctorProfile, InterfaceSettings
    │   │   └── AuthProvider.tsx      # session lifecycle; consumes mock auth today
    │   ├── router/                   # route tree, guards (RequireAuth/Role/
    │   │   │                         #   Permission/Guest), RootRedirect,
    │   │   └── ShellBadgesProvider   # badge-count queries for both shells
    │   └── error-boundary/           # 403/404/route error pages
    │
    ├── api/                          # ★ transport contract the backend must honor
    │   ├── client.ts                 # fetch ApiClient: Bearer injection,
    │   │                             #   credentials:'include', X-Correlation-Id,
    │   │                             #   30s timeout, 401→single-flight refresh→replay
    │   ├── errors.ts                 # status→ApiError mapping (see §10.4)
    │   ├── query-keys.ts             # key-factory convention
    │   └── endpoints/                # (empty — real endpoint fns land with backend)
    │
    ├── types/
    │   ├── api/index.ts              # ApiResponse<T>{data}, Paginated<T>, ListParams, ApiError
    │   ├── auth/index.ts             # Role, 22-Permission union, SessionUser, AuthStatus
    │   └── common.ts                 # branded ids (PatientId…), IsoDateTime/IsoDate
    │
    ├── configs/                      # env (Zod), feature-flags (billing, aiAssistant),
    │                                 #   query-client defaults, session idle policy
    ├── routes/index.ts               # every path + typed builders + section slugs
    ├── layouts/                      # AppShell, Sidebar/Navbar (menu-as-data,
    │                                 #   role NavigationConfig), BottomTabBar
    ├── components/                   # ui/ (28 atoms) · patterns/ (P1–P8 pieces)
    │                                 #   · feedback/ · charts/ · layout/
    ├── hooks/, utils/, services/preferences.ts, styles/, shared/components/branding/
    │
    └── features/                     # ★ one folder per domain; uniform anatomy:
        │                             #   index.ts (public API) · routes.tsx (lazy)
        │                             #   · pages/ · components/ · api/ (Query hooks
        │                             #   over mock stores — the API seam) · model/
        │                             #   (types.ts = DTO mirrors, mock-data.ts,
        │                             #   selectors.ts, filters.ts) · hooks/
        ├── auth/                     # pages, Zod schemas, i18n, mock/ (auth service,
        │                             #   session-store, seeded users) — §7.1
        ├── shared-domain/patient-identity/  # canonical Patient type + 5-person roster
        └── doctor/
            ├── dashboard/ patients/ appointments/ medical-records/ labs/
            ├── pharmacy/ ai/ messaging/ notifications/ reports/ settings/
            └── administration/       # admin-only center: 14 sections,
                                      #   administration.api.ts (clinic ops),
                                      #   admin-settings.* (16 platform panels),
                                      #   admin-profile.ts
```

**Why it matters to the backend:** every `features/**/model/types.ts` header states it "mirrors the future DTOs so API integration swaps the data source without touching components." Those files, plus each feature's `api/use*Query.ts` hooks (which name the operations and their inputs), **are the API contract** — transcribed into `BACKEND_API_CONTRACT.md`.

---

# 5. Frontend Architecture

What the backend must interoperate with. (Full detail: `FRONTEND_ARCHITECTURE.md`.)

## 5.1 Routing & guards [EXISTING]

- Public: `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/verify-email`, `/verify-otp`, `/lock-screen`, `/403`, `/404` (guest pages behind `RequireGuest`).
- `/doctor/*` → `RequireAuth` → `RequireRole('doctor')` → AppShell with 11 feature modules.
- `/doctor/administration/*` → `RequireAuth` → `RequireRole('admin')` → full-screen Administration Center (**changed in Phase 19**; a doctor deep-linking gets 403).
- `/admin/*` → admin guard → redirect into the Administration Center.
- Guards are UX only — **the server re-enforces every rule on every request** (frontend doc §12.1, verbatim).
- `returnTo` is validated client-side (must start with `/`, never `//`; role-checked) — backend must apply equivalent open-redirect rules anywhere it emits redirects (email links).

## 5.2 Auth/token contract [EXISTING — binding]

- Access token: **memory only**, attached as `Authorization: Bearer` by `ApiClient`. Never in storage.
- Refresh token: **httpOnly cookie**; client always sends `credentials: 'include'`.
- Boot: silent refresh (`POST /auth/refresh`) rehydrates the access token; splash until resolved.
- On any 401 the client performs **one** single-flight refresh and replays the request once; refresh failure → hard logout, full TanStack-Query cache clear (PHI must not survive logout), per-user preferences cleared.
- Session TTLs (mock, to be made policy-driven): rememberMe 30 d, otherwise 12 h; idle lock 10 min with 60 s warning (client-side; admin-configurable via `SecurityPolicySettings.sessionTimeoutMinutes`).
- Permissions arrive **inside the session payload** and are static per session (re-login applies changes).

## 5.3 State & data conventions [EXISTING]

- Server state lives only in TanStack Query; list state (filters/sort/page/tabs) mirrors URL search params — so **server-side list endpoints must accept exactly those params** (see contract doc, per-module).
- `staleTime` 30 s default; volatile data (badges, queues) polls at 10–15 s — backend list/count endpoints must be cheap.
- Optimistic updates only where UX specs rollback (appointment accept/reject, mark-read, message send). **Pessimistic, blocking writes** for safety-critical paths: prescriptions, critical-lab review, permission changes.
- Query keys mirror endpoints (`['doctor-appointments','list',params]`) — stable filter serialization matters for caching.

## 5.4 Design system / UX patterns

P1 data-table pages (search/filter/sort/paginate/export/saved views), P2 detail pages (tabbed, lazy per-tab fetch), P3 record drawers, P4 confirm-with-reason (reason is **stored and audit-logged**), P5 KPI cards (delta vs previous period), P6 chart widgets (range + compare + view-as-table + export), P7 saved views, P8 single status→color vocabulary. Every list/detail/analytics endpoint in the contract exists to feed one of these patterns.

---

# 6. User Roles & Permissions

## 6.1 Coarse roles [EXISTING]

`Role = 'doctor' | 'admin'` selects the route tree and shell. Wider vocabularies already in data: `PlatformRole` (admin, doctor, reception, laboratory, pharmacy — the users panel), `StaffRole` (+ nurse, receptionist), `ContactRole` (+ patient). The DB unifies these in one `roles` table (DB spec A1, inconsistency §14.5-7).

## 6.2 Permission union [EXISTING — 22 capabilities, verbatim from `types/auth`]

| Domain | Permissions |
|---|---|
| Clinical data | `patients.view`, `patients.revealIdentity`, `records.view`, `records.edit`, `prescriptions.create`, `labs.review` |
| Scheduling | `appointments.manageOwn`, `appointments.reassign`, `appointments.cancelAdministratively` |
| Communication | `messages.send`, `communications.viewMetadata`, `communications.viewContent`, `communications.resolveFlags` |
| Administration | `doctors.manage`, `doctors.verify`, `patients.manageAccounts`, `roles.manage`, `settings.manageSystem`, `integrations.manage` |
| Audit | `logs.view`, `logs.export` |
| AI | `ai.use` |

## 6.3 Role bundles [EXISTING — seeded in `mock/users.ts`]

- **Doctor:** patients.view, patients.revealIdentity, records.view, records.edit, prescriptions.create, labs.review, appointments.manageOwn, messages.send, communications.viewMetadata, ai.use.
- **Admin:** patients.view, patients.manageAccounts, appointments.reassign, appointments.cancelAdministratively, messages.send, communications.viewMetadata, communications.viewContent, communications.resolveFlags, doctors.manage, doctors.verify, roles.manage, settings.manageSystem, integrations.manage, logs.view, logs.export.

Note the deliberate asymmetries: admin has **no** `ai.use` (AI is a clinical tool), no `records.edit`, no `prescriptions.create`; doctor has **no** log access. Per-user overrides exist (`user_permissions`).

## 6.4 Access-control rules [EXISTING/DERIVED — binding, UX §1.5]

1. Doctors see clinical data **only for patients under their care** (care-relationship scoping; the natural anchor is the recommended `patient_doctor_assignments` table + Postgres RLS).
2. Admins see demographics/operational metadata by default; **masked identifiers** (`Kh••• N•••`, MRN last-4); per-row reveal requires `patients.revealIdentity` and is audit-logged.
3. Message **content** access for admins is gated: justification category + reason → (policy) second-admin approval → read-only watermarked view → audit event with reference number.
4. Role-matrix edits preview affected-user counts, require confirmation, are audited; concurrent edits surface a 409 merge flow.
5. Every UX-flagged action (reveal, content access, severe-interaction acknowledgment, exports, verification decisions, suspensions…) writes to the immutable audit log.

---

# 7. Complete Feature Analysis

For each module: what exists, the data involved, and what the backend must do. Endpoint-level detail (routes, params, validation, examples) lives in `BACKEND_API_CONTRACT.md`; DB tables cited as `DB §…` refer to `DATABASE_SCHEMA_EXTRACTION.md`.

## 7.1 Authentication [EXISTING mock → DERIVED backend]

**Frontend:** login (email+password+rememberMe, demo-account hints), signup (first/last name, email, phone, password policy ≥8 with upper+lower+digit+symbol, role, optional license number, terms+privacy consent), forgot/reset password, verify email, 6-digit OTP with resend countdown, lock screen re-auth, silent refresh on boot, multi-tab logout sync.
**Coded error vocabulary** (the pages branch on these): `invalid_credentials`, `email_unverified`, `otp_required`, `otp_invalid`, `email_taken`, `token_invalid`, `weak_password`, `rate_limited`.
**Backend must:** issue access+refresh tokens per §5.2; enforce email verification before login; run the 2FA step-up; hash passwords (Argon2id); single-use expiring tokens for verification/reset; **anti-enumeration** on forgot-password (always 200); lockout counter vs `loginAttemptLimit`; record `login_events` with device/IP/location/result/anomaly flags; honor platform security policy (2FA enforcement, password expiry, single-session). Tables: DB §A1–A12.

## 7.2 Users, Doctor Profile & Admin Profile

**Frontend:** `DoctorProfileProvider` is “the single source of truth for the signed-in doctor's identity” (photo, name, title, specialty, license + expiry, department, hospital, experience, languages, bio, education/certifications/skills, socials, emergency contact, contact info, office). `admin-profile.ts` mirrors it for admins (+ landing section, weekly digest). Settings→Account edits username/phone; license edits trigger admin **re-verification** (UX 2.11).
**Backend must:** serve/update profile documents with validation identical to `settings/schemas.ts` + `profileSchema`; flip `verification_status` to pending on license changes; store photos via files service. Tables: DB §A4, B1, B2.

## 7.3 Patients

**Frontend:** P1 list (search auto-detecting name/ID/phone/MRN, filters: status/gender/age/last-visit/condition/upcoming, saved views, CSV export, card grid), AddPatientDialog (demographics + contacts + insurance + notes), full profile bundle: identity header with fixed allergy strip, sticky summary (latest vitals, top meds, conditions, next appointment, emergency contact), tabs Overview/History/Appointments/Medications/Allergies/Documents/Notes/Study-categories.
**Backend must:** paginated/filterable patient list scoped to the doctor's care relationships; profile bundle endpoint(s) per tab; CRUD for allergies (severity mild/moderate/severe, reaction), chronic conditions (canonical vocabulary), history events (5 kinds), vitals snapshots (split BP into systolic/diastolic — DB §16.14), documents (5 categories, via files service), clinical notes (signed flag; unsigned feeds the action queue), emergency contacts, insurance; compute derived fields (`age`, `hasSevereAllergy`, `nextAppointment`) server-side. Tables: DB §B3–B14.

## 7.4 Appointments

**Frontend:** list + day/week/month calendar, summary cards, filters (status/type/date), detail drawer with full event history, dialogs: add, reschedule (date+time+reason), reason-required reject/cancel (P4), status machine in `availableActions()`:
`pending → approve|reject`; `scheduled/confirmed/rescheduled → reschedule|cancel` (+ `complete|no-show` only once the slot date ≤ today); `completed/cancelled/no-show` terminal.
**Backend must:** enforce that exact transition matrix server-side (reject illegal transitions with 409/422); require reasons on destructive actions; write `appointment_events` for every transition (actor, timestamps, old/new); notify patients on decisions (only after commit succeeds); support admin nudge/reassign/administrative-cancel (UX 3.5, permission-gated); conflict-check against doctor availability; **UX-specified but not yet coded**: “Awaiting patient” status + up-to-3 proposed slots + emergency time-off blast flow — model them now (DB §S2, S3; inconsistency §14.5-1). Tables: DB §C1–C2.

## 7.5 Medical Records

**Frontend:** P1 list (status draft/active/completed/archived, priority, primary ICD-10 diagnosis shown), detail: patient card, visit info, diagnoses (exactly one primary), vitals, treatment plan items, medications, allergies, notes (signed), attachments (5 kinds), full timeline (7 event kinds), record export.
**Backend must:** never hard-delete (soft delete + row versioning + before/after diffs — UX 1.5.3 binding); attribute and timeline every mutation; enforce one-primary-diagnosis; ICD-10 lookup (14 seeded codes; full import recommended); note-signing workflow with AI-provenance flags. Tables: DB §D1–D9.

## 7.6 Laboratory

**Frontend:** P1 list + summary cards, filters (status/category/priority/flag), “Critical unreviewed” signal, detail: test info, ordered-by, specimen (type/container/site/collector/condition — Hemolyzed/Clotted/Insufficient gate processing), results table (analyte, value, unit, reference range, flag: normal/low/high/critical-low/critical-high/abnormal), interpretation, attachments, 7-step timeline, export.
**Backend must:** pipeline `ordered → collected → processing → completed` (+cancel), timeline events including received/resulted/verified; snapshot reference ranges onto results at result time; compute `hasCriticalResult`; **critical results must be individually marked reviewed** (bulk only for normals) and a failed review write must fail loudly; trend queries per analyte/patient. Tables: DB §E1–E7.

## 7.7 Pharmacy / Prescriptions

**Frontend:** P1 list (status active/completed/discontinued/pending-approval/expired; refill state none/available/due/pending), detail: medication document, dosage, safety warnings (interaction/allergy/duplicate/dosage × info/warning/critical), notes, history, timeline; medication catalogue (generic/brand, strength, form, route, controlled/high-risk flags, allergy class, interaction note).
**Backend must (fail-closed, binding UX 2.7):** run the safety screen server-side — allergy conflict = **blocking, no override in v1**; severe interaction requires explicit acknowledgment + reason (audit-logged); duplicate-therapy notice; **if the interaction service is unavailable, only save-as-draft is allowed, never send**. Signing required before a prescription leaves draft; renew pre-fills from a prior Rx; cancel/discontinue require reasons; refill accounting `0 ≤ remaining ≤ allowed`; expiry sweep job. Reconcile the status-vocabulary drift (add draft/dispensed — DB §14.5-2). Tables: DB §F1–F7 (+ recommended `drug_interactions`, `medication_monographs`).

## 7.8 Messaging

**Frontend:** folders (inbox/unread/starred/sent/drafts/archived), direct + care-team threads, markdown-lite bodies, delivery states sending→sent→delivered→read (+failed with inline retry), attachments metadata, presence, per-conversation pin/star/archive/mute/draft, shared links panel, new-message contact picker.
**Backend must:** conversations + participants + messages with per-participant read state; patient-thread rules (no delete; 5-minute edit window with visible “edited”; full history retained; “not for emergencies” banner context); attachment scan-before-download; unread badge counts; full-text search within own threads. Tables: DB §G1–G5 (+ flags/access-gate S4–S5 for admin oversight).

## 7.9 Notifications

**Frontend:** feed with 8 categories × 3 priorities × 3 kinds, read/archive/favorite/pinned, related-entity deep links, summary cards, preferences (5 channels, quiet hours, per-category opt-in — **security cannot be disabled**), navbar bell (unread badge, mark-one/mark-all/clear-read) shared by both shells.
**Backend must:** fan out notifications on domain events (appointment transitions, lab results incl. critical pinning, prescription/refill events, messages, AI completions, system/security); respect preferences + quiet hours (critical lab alerts exempt); serve cheap unread counts; per-channel delivery via jobs (email/SMS/push) with delivery tracking (recommended `notification_deliveries`). Tables: DB §G6–G8.

## 7.10 AI Assistant (doctor-only)

**Frontend:** conversation list (search, favorites), chat with streaming + stop, context binding (general | patient | record | labs | pharmacy — one patient max, always visible, never cross-patient), prompt templates, settings (temperature, response length, language en/ar, auto-context, streaming), action-result cards → “Review & save to record” as the **only** path into a record, permanent AI-assisted provenance.
**Backend must:** persist conversations/messages/settings; enforce `ai.use`; context binding resolved server-side (fetch only the bound entities; refuse partial context — fail closed); stream via SSE; record provenance on saved artifacts; never let AI output mutate clinical data without an explicit doctor-confirmed save. Tables: DB §H1–H4. Full integration architecture: §16.

## 7.11 Reports & Analytics (doctor)

**Frontend:** 9 categories (overview, revenue*, patients, appointments, laboratory, records, pharmacy, messages, ai), global filters (range presets + custom, doctor scope, gender, age band, compare), KPI grids + chart widgets + insights panel, saved reports (persist filter snapshots), scheduled reports (frequency daily/weekly/monthly, run history sent/failed), export csv/excel/pdf/print. (*revenue behind billing flag.)
**Backend must:** aggregate analytics endpoints per category honoring filters + compare-period deltas; saved-report CRUD (filters as JSONB snapshot); scheduler job executing scheduled reports and recording runs; export generation via files service. Doctor scope: own data only. Tables: DB §I1–I3.

## 7.12 Doctor Settings Center (11 sections; reused verbatim by admins as “My Settings”)

Profile · Account (username/phone/email, password change with current-password check) · Security (2FA TOTP wizard + recovery codes, trusted devices, active sessions with revoke/revoke-others, login history) · Privacy (directory visibility, survey participation, data-export request) · Notifications (channel×category matrix) · Appearance (theme/density/accent policy) · Preferences (landing page, default tabs, date/time formats) · Accessibility · Integrations (google-calendar/outlook/zoom/teams connect state) · Activity (account activity feed, 7 kinds) · About.
**Backend must:** a settings document per user (slice-updatable), session/device management endpoints, activity log feed, integration OAuth stubs. Tables: DB §J1–J3, A7–A9, A12.

## 7.13 Administration Center (admin-only)

**Clinic operations [EXISTING]:** overview KPIs (today's patients/appointments/waiting/completed/cancelled, utilization, avg wait, occupancy, hourly activity), staff (roles, presence, permissions), departments, rooms (4 kinds × 4 statuses), resources (stock with reorder levels), working schedule (per-weekday hours + breaks), holidays, shifts (7-day masks), live queue (tickets, priorities, delays), waiting room (waiting→called→in-room), announcements (priority/pinned/expiry), policies (versioned), document templates (6 kinds), audit events feed, platform status (revenue, actives, system health, license, registrations), global search across sections.
**Platform settings [EXISTING — 16 panels]:** general (maintenance mode), organization, branding, localization, notifications, email (SMTP), SMS, security policy (2FA required, password expiry, session timeout, attempt limit, single-session), users & permissions (PlatformUser list), API keys (prefix-only display, revoke), audit, integrations, backup (auto frequency/retain + manual), retention (records years / audit days / messages days, auto-purge), privacy, about.
**Backend must:** CRUD for all clinic entities; overview aggregates; the platform-settings document with per-slice updates (validated, audited, consequence-aware); API-key issuance (show once, store hash); backup orchestration hooks; retention enforcement jobs; maintenance-mode flag honored by middleware. Tables: DB §K1–K12, L1–L4.

## 7.14 Audit & System Logs

**Frontend:** audit feed in the Administration overview; the full investigation surface (UX 3.7) is confirmed scope: free-text + structured filters (actor/type/severity/time/IP), saved views, detail with payload + before/after diff + correlated events, CSV/JSON export (itself logged), **read-only for everyone including admins**, retention displayed.
**Backend must:** append-only `audit_events` (category authentication/security/user_action/admin_activity/system × severity info/warning/critical), written through one internal choke point used by every module; partitioned + indexed for 100k+ rows; export endpoint that logs its own use. Tables: DB §M1; taxonomy UX §3.7.

## 7.15 Dashboard (doctor overview) & Shell badges

KPIs (today's appointments + next-at, pending requests, total patients, completed-this-week + delta), today's schedule timeline, unified action queue (pending appointment requests, unreviewed critical labs, unsigned notes, stale messages), trend charts, satisfaction widget, recent activity, notifications widget, AI teaser. Badge counts (messages, notifications) polled by both shells.
**Backend must:** one composite overview endpoint (or cheap parallel widget endpoints — the UX loads widgets independently with per-widget errors) + a badge-counts endpoint designed for 10–15 s polling.

## 7.16 Search

Doctor navbar global search (patients/appointments/records scope) and admin command-bar search (sections + settings panels + entities) → a role-scoped `/search` endpoint with grouped results.

## 7.17 Files & Media

Every upload surface (profile photos with crop, patient documents, record/lab attachments, message attachments, verification documents, branding assets, exports, backups) flows through one files service: metadata row + object storage + checksum + malware scan gate + signed download URLs, `Content-Disposition` respected. Tables: DB §11.

---

# 8. Backend Requirements

## 8.1 Response format [EXISTING — binding]

- Success: `{ "data": <payload> }` (`ApiResponse<T>`). 204 for bodyless success (client returns `undefined`).
- Lists: `data` is `Paginated<T>`: `{ items, page, pageSize, totalItems, totalPages }`.
- Error body: `{ message, code?, fieldErrors?, detail?, ref? }` — see §10.4 for the exact status mapping the client already implements.

## 8.2 Pagination, sorting, filtering, search [EXISTING conventions]

- Query params: `q`, `sort` (e.g. `sort=lastVisit:desc`), `page` (1-based), `pageSize` (default 20, cap 100), plus per-module filters mirroring the URL contracts in UX §1.3 (documented per endpoint in the contract).
- Sorting whitelist per endpoint; unknown params ignored, invalid values → 422.
- Search: identifier auto-detection on patients (name/MRN/phone/ID), trigram indexes (DB §8).

## 8.3 Business rules

The complete extracted rule set — appointment lifecycle, record immutability, prescription fail-closed safety, lab review discipline, auth/session, permissions, communication governance, notifications, clinic ops, platform admin, billing flag, emergency rules — is authoritative in **DB spec §4.1–4.13** and must be enforced server-side (the frontend re-implements them only as UX).

## 8.4 Transactions, concurrency, idempotency [DERIVED + RECOMMENDATION]

- Multi-row clinical writes (record + children, prescription + warnings, transition + event + notification outbox) are single DB transactions.
- Status transitions guard with `WHERE status = :expected` (or version column) → 409 `conflict` on races; the client maps 409 to refetch/merge flows (admin settings concurrent-edit merge is specced).
- Optimistic concurrency (`updatedAt`/version) on settings documents and the permission matrix.
- Idempotency: `POST` endpoints with side effects (prescription send, appointment create, message send) accept an `Idempotency-Key` header (client `X-Correlation-Id` already provides a unique per-request id to build on).
- Notifications/emails fire **only after commit** (outbox pattern) — UX explicitly requires "notifications fire only on confirmed server success".

## 8.5 Versioning

Prefix `/api/v1` [RECOMMENDATION]. The frontend base URL is configurable (`VITE_API_BASE_URL`), so `http://localhost:3000/api/v1` is a config change. Breaking changes require a new version; additive changes don't.

---

# 9. Database Design

**The authoritative dictionary is `DATABASE_SCHEMA_EXTRACTION.md`** — 93 confirmed/spec entities in 13 domains (§1–§2), relationships (§3), business rules (§4), lookups & full enum inventory (§5–§6), audit/soft-delete matrix (§7), indexes (§8), constraints & cascade policy (§9), security classification (§10), files (§11), 17 recommended additions (§13), ERD narrative + 12-phase creation order + type palette (§14). Production estimate ~105–110 tables.

Non-negotiables to carry into the Prisma schema:

1. Surrogate `uuid` PKs + unique business codes (`PT-1001`, `APT-3001`, `MR-10001`, `LAB-100001`, `RX-200001`, MRN).
2. `timestamptz` everywhere; audit cols (`created_at/updated_at/created_by/updated_by`) per §7 matrix; soft delete for PHI; **no DELETE grant** on medical_records, patient-thread messages, audit_events.
3. Native enums per §6; status-transition triggers or service-layer guards implementing §4.1.
4. RLS (or rigorous service-layer scoping) anchored on the care relationship for `patients.view`.
5. Compute derived values (age, hasSevereAllergy, nextAppointment, staffCount, waitingMinutes) — don't double-store, except trigger-maintained `has_critical_result`.
6. Resolve the §14.5 inconsistencies **before schema freeze** (esp. #1 appointment statuses, #2 prescription statuses, #3 doctor FKs replacing free-text names, #4 unified departments).

---

# 10. API Design Recommendations

## 10.1 REST architecture

Resource-oriented, plural nouns, kebab-case paths, verbs only for state actions expressed as sub-resources: `POST /appointments/{id}/approve`, `/reject`, `/reschedule`, `/complete`, `/no-show` (mirrors the coded `AppointmentAction` union — better than free-form PATCH for auditability and per-action validation).

## 10.2 Naming

camelCase JSON fields exactly matching the frontend model types (e.g. `dateTime`, `durationMin`, `isNewPatient`, `hasSevereAllergy`, `refillsRemaining`) — the DTO mirrors are the contract; do not rename.

## 10.3 Status codes

200 read/action success · 201 create · 204 delete/bodyless · 400/422 validation → `fieldErrors` · 401 (triggers client refresh flow — use **only** for token problems) · 403 authorization · 404 · 409 conflict/illegal transition · 429 + `Retry-After` header · 5xx with support `ref`.

## 10.4 Error contract [EXISTING — the client mapping in `api/errors.ts`, verbatim]

| HTTP | Client `ApiError.kind` | Server must supply |
|---|---|---|
| 400, 422 | `validation` | `fieldErrors: Record<string, string[]>` keyed by field path |
| 401 | `auth` | nothing (never rendered; drives refresh/logout) |
| 403 | `forbidden` | — |
| 404 | `not_found` | — |
| 409 | `conflict` | `detail` (human-readable) |
| 429 | `rate_limited` | `Retry-After` header (seconds) |
| other | `server` | `ref` (correlation/support reference) |
| network/timeout | `network` | (client-side; keep responses < 30 s or stream) |

Add a machine `code` field (e.g. the auth error codes §7.1) — additive and needed by the auth pages.

## 10.5 Cross-cutting

- Accept and echo `X-Correlation-Id`; include it as `ref` on errors and in logs.
- Rate limiting: strict on auth (per-IP + per-account), moderate globally, generous on polling endpoints; always with `Retry-After`.
- Validation: Zod schemas mirroring the frontend's (`features/auth/schemas`, `settings/schemas.ts` are the source); validate params/query/body; strip unknown fields.
- OpenAPI generated from code; contract tests assert parity with `BACKEND_API_CONTRACT.md`.

---

# 11. Security Requirements

1. **Tokens:** JWT access (≤15 min, `sub`/`role`/`permissions`/`sid`), opaque rotating refresh (hashed at rest, family-revocation on reuse), cookie `httpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`. Mobile: same endpoints, refresh in body + secure device storage (§15).
2. **Passwords:** Argon2id; policy ≥8 + upper/lower/digit/symbol (`utils/password.ts` checks), reject weak (`weak_password`), current-password required to change, expiry per `passwordExpiryDays`, history reuse check [RECOMMENDATION].
3. **Email verification & reset:** single-use hashed tokens with TTL; resend endpoints rate-limited; anti-enumeration everywhere.
4. **2FA:** TOTP (QR provisioning, encrypted secret, recovery codes), enforced per role when `twoFactorRequired`; OTP attempts bounded → `rate_limited`.
5. **RBAC:** guard = role + permission checks server-side on every route (the 22-capability union is the vocabulary); per-user overrides honored; permission changes take effect at next session issue (matches frontend contract).
6. **PHI protection:** care-relationship scoping (RLS), masked admin projections by default, reveal/content-access endpoints that atomically write audit events; no PHI in URLs, logs, or error messages; encrypted columns for secrets and high-sensitivity PII (DB §10).
7. **Web hardening:** Helmet-equivalent headers, strict CORS (exact origins + `credentials: true` — required by cookie flow), CSRF: SameSite=Strict + Origin check on auth routes (Bearer-authenticated JSON API is not form-postable); parameterized queries only (Prisma); JSON body limits; file-type/size validation + malware scan gate before download activation.
8. **Rate limiting & lockout:** login attempt limiter per policy; anomaly flags (bursts, new location, impossible travel) recorded on `login_events` and surfaced as security alerts.
9. **Audit trail:** every flagged action through one audit service; INSERT-only; log exports logged; retention per `auditLogDays`.
10. **Secrets management:** env-injected (12-factor), never in the repo (repo already models this: client env carries no secrets; SMTP/SMS/API-key material is write-only in the UI and hash/encrypted at rest).
11. **OWASP:** ASVS L2 target; dependency audit + lockfile-only installs in CI (mirrors frontend working agreement).

---

# 12. Performance Recommendations

- **Hot paths first:** badge counts, action queue, today's schedule, lab critical-count — polled at 10–15 s by every open client; back with the partial indexes in DB §8 and short-TTL Redis caches.
- Server-side pagination everywhere (the current mocks return whole datasets; the real API must not, especially audit logs at 100k+ rows — keyset pagination there).
- Redis: session/permission lookup cache, rate-limit counters, badge counters, reference-data cache (formulary, ICD, catalogues with long TTL + explicit bust).
- BullMQ jobs: notification fan-out + channel delivery, scheduled reports, prescription-expiry and license-expiry sweeps, retention purges, backup runs, malware scans, satisfaction-survey dispatch.
- Compression (gzip/br), ETags on reference data; keep responses within the client's 30 s timeout — stream (SSE) anything longer (AI, big exports as async job + notification).
- Aggregates for reports: SQL with proper indexes first; materialized views for the admin platform charts if needed later. **No count-up animations client-side means values must be final — no eventually-consistent KPI flicker.**

---

# 13. Testing Strategy

| Layer | Tooling | Scope & gates |
|---|---|---|
| Unit | Vitest/Jest | Domain services: status machines (every legal/illegal transition), safety screen (allergy block, severe-ack path, service-down ⇒ draft-only), password/token policies, maskers |
| Integration | Testcontainers Postgres + Prisma | Repositories, RLS/scoping, soft-delete + versioning, audit hooks, transaction rollback |
| API | Supertest against the app | Every endpoint in `BACKEND_API_CONTRACT.md`: happy path + each error kind; envelope/pagination/error-shape conformance (schema-validated) |
| Security | dedicated suite | authz matrix (role × permission × endpoint), anti-enumeration, rate limits, lockout, token reuse detection, masked-vs-revealed projections |
| Performance | k6/autocannon | list endpoints under load, badge polling herd, audit-log pagination |
| E2E | Playwright (frontend) against staging backend | login → key flow per role (matches frontend Phase 10 plan) |
| Coverage | 80% overall, **100% on safety-critical services** (prescription safety, lab review, appointment transitions, auth) | CI-enforced |

---

# 14. Deployment

- **Environments:** development (docker-compose: api + postgres + redis + minio + mailhog; API on `:3000` to match the frontend default), staging (production-shaped, seeded demo data), production.
- **Docker:** multi-stage Node 20 build, non-root user, healthcheck endpoint (`/api/v1/health` — the System Health card expects service statuses).
- **Reverse proxy:** nginx/Caddy — TLS termination, HTTP/2, compression, security headers, SPA static hosting + `/api` proxy.
- **Config:** 12-factor env vars, validated at boot with Zod (mirror of `configs/env.ts` fail-fast philosophy).
- **CI/CD:** GitHub Actions — typecheck, lint, unit/integration/API tests, prisma migrate diff check, docker build, deploy gate; migrations run as a release step, backward-compatible (expand→migrate→contract).
- **Backups & DR:** automated Postgres backups per the platform Backup settings (daily/weekly/monthly, retain N) + WAL/PITR [RECOMMENDATION]; object-storage versioning; restore runbook tested; RPO ≤ 24 h, RTO ≤ 4 h initial targets.
- **Monitoring:** health/readiness probes, OTel traces keyed by correlation id, error tracking, uptime/latency/error-rate metrics — these literally feed the admin System-Health/Performance widgets.

---

# 15. Mobile Readiness

The backend must serve a future patient/receptionist (and doctor) mobile app **unchanged**:

1. **API-first:** every capability is a REST endpoint; nothing web-only; no server-rendered flows. The web app is just the first client.
2. **Auth for mobile:** same endpoints; when `X-Client-Type: mobile` (or a `/auth/token` variant), return the refresh token in the response body instead of a cookie; mobile stores it in Keychain/Keystore; same rotation + reuse detection. Access token handling identical.
3. **Push:** device-token registration endpoint (`/me/devices`) + FCM/APNs delivery channel behind the existing `push` notification channel preference.
4. **Payload discipline:** paginated lists, sparse list DTOs vs full detail DTOs (already the frontend's list/detail split), ISO-8601 UTC timestamps (client formats), stable enums as strings.
5. **Versioning:** `/api/v1` + additive evolution; deprecation headers; mobile clients can't be force-refreshed like the SPA.
6. **Patient-role groundwork:** patients become users (DB §13.1–2 recommendations: care-team assignments, access grants); booking rules (approval-vs-auto-confirm) already exist in scheduling policy settings; the appointment status machine already models patient-facing states (awaiting-patient, re-confirmation).
7. **Offline tolerance:** ETag/If-None-Match on reference data; idempotency keys make retry-safe writes possible on flaky networks.

---

# 16. AI Readiness

1. **Isolation:** an `AiGateway` service module owns all LLM-provider calls (provider-agnostic adapter; models/keys server-side only). The rest of the backend calls it; clients never talk to providers.
2. **Context binding is server-authoritative:** the client sends only `{ mode, patientId?, refId? }`; the backend resolves the bound entities (patient summary / record / lab order / prescription), enforces the doctor's care-relationship scope, and refuses to generate on partial context (fail closed — mirrors the UI rule).
3. **Streaming:** SSE endpoint for message generation (`status: complete | stopped | error` matches the coded message states); cancellable.
4. **Provenance & containment:** AI output is stored as assistant messages; transfer into a clinical record happens **only** through the existing note/record endpoints with `aiAssisted: true` provenance, doctor-reviewed and signed — the AI service itself has no write access to clinical tables.
5. **Safety:** dosage/treatment responses carry caution metadata; emergency-triage refusal is a server-side policy; per-response feedback (thumbs) is captured for quality telemetry; all AI usage is auditable (`ai` audit/notification categories exist).
6. **PHI minimization:** send the provider only the minimum bound context; no cross-patient context in one thread (hard rule from UX 2.5); log prompts/completions under PHI handling rules with retention limits.
7. **Config:** the platform Integrations panel already models an “AI service” integration slot (status, config, test-connection).

---

# 17. Known Gaps & Assumptions

Consolidated from the audit (details: DB spec §14.5 and §16 above):

| # | Gap / decision needed | Recommendation |
|---|---|---|
| 1 | Appointment status vocabularies diverge (module 7-value enum vs profile 5-value vs UX “Awaiting patient”/“requested”) | Adopt the 7-value enum + `awaiting-patient`; freeze before Prisma schema |
| 2 | Prescription statuses lack `draft`/`dispensed` though flows reference both | Extend enum; map UX badge names |
| 3 | Doctor references are free-text names throughout DTOs | FKs in DB; keep denormalized `doctorName` in list DTOs for compatibility |
| 4 | Three diverging department string lists + one Department entity | Single `departments` table; seed the union |
| 5 | Availability model (weekly grid, buffers, vacation mode) is UX-specced, not coded | Model per DB §S2 now — appointments depend on it |
| 6 | Second-admin approval for content access: policy exists as a setting; default undecided | Default self-serve + audit; make policy-driven |
| 7 | Retention defaults (records years / audit days / messages days) | Take from platform settings seed; confirm with compliance |
| 8 | Billing module | Feature-flagged off; tables are §13 recommendations; design invoices/payments when enabled |
| 9 | Radiology/imaging | Placeholder studies only; full DICOM module is future scope |
| 10 | Multi-clinic / tenancy | Single-clinic now; keep clinic FK out of v1, add via migration when needed ⚠ **Decided 2026-10-07:** Hospital is the isolation boundary with `hospital_id` on hospital-owned data, composite constraints and RLS before production (`docs/multi-hospital/DATA_MODEL_CHANGES.md`, `MIGRATION_AND_COMPATIBILITY.md`) |
| 11 | Deployment target (cloud/on-prem) unknown | Docker-first keeps both open |
| 12 | Stale artifacts: `featureFlags.aiAssistant=false` comment, `AdminSettingsSection` route union (6 vs 16 panels), UX §1.3 route drift (`/doctor/pharmacy/prescriptions/:rxId` vs coded `/doctor/pharmacy/:prescriptionId`; medical-records module absent from UX map) | Treat **code** as authoritative; clean up in a frontend housekeeping PR |

---

# 18. Final Recommendations

1. **Treat the mock layer as a executable spec.** Each `mock-*-service.ts` / `use*Query.ts` names the exact operations, inputs, latencies and error codes the UI expects; parity with them is the integration acceptance test.
2. **Build safety paths pessimistically first.** Prescription screening, lab review, appointment transitions and audit logging are the medical-grade core; everything else is conventional CRUD around them.
3. **One audit choke point, day one.** Retrofitting auditability is the biggest technical-debt risk in this domain; the frontend already funnels flagged actions through a single dispatcher — mirror that server-side.
4. **Freeze enums and status machines before the Prisma schema** (§17 items 1–4). Schema churn after data exists is the second-biggest risk.
5. **Keep the DTO mirrors sacred.** Field names/shapes in `features/**/model/types.ts` are the contract; breaking them forces frontend churn across 19 modules.
6. **Design for the mobile client now** (token-in-body variant, push registration, versioning) — it is cheap today and expensive later.
7. **Scale path:** modular monolith (NestJS modules per domain) → extract AI gateway and notification delivery first if load demands; Postgres + Redis carries this platform far beyond first production.
8. **Maintainability:** the frontend's discipline (strict TS, boundary lint rules, docs updated in the same PR) should be replicated verbatim in the backend repo; `BACKEND_API_CONTRACT.md` and the OpenAPI output must never drift (CI contract check).

---

*End of master guide. Read next: `BACKEND_IMPLEMENTATION_ROADMAP.md` for the build order, then `BACKEND_API_CONTRACT.md` for endpoint-level specifications.*
