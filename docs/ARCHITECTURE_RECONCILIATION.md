# Architecture Reconciliation — Pre-Implementation Verification Pass

**Produced:** 2026-08-12 · **Repository:** `Fares-code0/smart-healthcare-assistant-system` @ `8d4f5af`
**Purpose:** the eight artifacts required before domain implementation begins. Nothing here is invented; every row traces to repository source, the API contract, the database dictionary, or an accepted ADR.

**Source-of-truth order used throughout** (from the project instruction, and consistent with `docs/DECISIONS.md`):

1. Frontend code and TypeScript types · 2. Mock services and mock data · 3. `BACKEND_API_CONTRACT.md` · 4. `DATABASE_SCHEMA_EXTRACTION.md` · 5. `FRONTEND_ARCHITECTURE.md` · 6. `UX_ARCHITECTURE.md` · 7. Master guide recommendations

---

## 1. Architecture reconciliation report

### 1.1 What the backend is replacing

The frontend is a complete two-role SPA whose data layer resolves against in-memory stores and `localStorage`. Every feature module already has an `api/` folder of TanStack Query hooks — that folder is the seam. `src/api/endpoints/` exists and is empty (`.gitkeep`), and `VITE_ENABLE_MOCKS` is parsed but read nowhere that matters. The swap mechanism is designed and unbuilt.

```
Component → feature api/use*Query.ts → [ SEAM ] → mock store          (today)
Component → feature api/use*Query.ts → [ SEAM ] → src/api/endpoints/  (target)
                                                        ↓
                                                  ApiClient → HTTP → backend
```

### 1.2 Non-negotiables the backend inherits

| Constraint | Source | Consequence |
|---|---|---|
| Envelope `{ data }`, `Paginated<T>`, `ApiError` union | `frontend/src/types/api/index.ts`, `api/errors.ts` | Implemented at M1.2 — done and tested |
| camelCase field names verbatim from DTO mirrors | MG §10.2, §18.5 | No renaming between layers, ever |
| Exact enum string literals | DB §6 + frontend unions | §3 below |
| Guards are UX only; server re-enforces everything | `FRONTEND_ARCHITECTURE.md` §5.2 | Every route carries a server-side check |
| Access token in memory, refresh in httpOnly cookie | FE arch §6.2 | ADR-011 fixes the cookie path |
| Permissions static per session | FE arch §6.5 | Changes apply at next issue, not live |
| 10–15 s polling on badges/queues | FE arch §10.3 | Count endpoints must be O(1)-cheap |
| Optimistic writes prohibited on safety paths | FE arch §10.3, MG §5.3 | Prescriptions, critical-lab review, permissions are pessimistic |
| Cache cleared on logout | FE arch §6.4 | No PHI survives a session |

### 1.3 Current build state

| Milestone | State |
|---|---|
| M0.1–M0.6 | Complete, each with Verified evidence |
| M0 exit gate | ADR-007's five retention categories **no longer block it** — closed by the project owner 2026-08-12 (ADR-007). The gate's other conditions are not re-assessed here |
| M1.1–M1.5, M1.7 | Complete and verified |
| M1.6 | Environment-blocked (Docker Hub 429), config validates |
| M1 exit gate | **Blocked** — M1.6 verification only; no known defects |
| M2 onward | Not started |

---

## 2. Contradiction list

Every conflict found across the seven sources, with its resolution and authority. **Resolved** means an accepted ADR settles it; **open** means it does not.

| # | Contradiction | Sources | Resolution | Authority |
|---|---|---|---|---|
| C-01 | Appointment status: 7 coded values vs 5 in the patient profile vs `awaiting-patient` in the contract | `appointments/model/types.ts:24`, `profile-types.ts:137`, API §5 | **8-value enum**; the 5-value union is a frontend narrowing to widen at M39 | ADR-001 |
| C-02 | Prescription status lacks `draft`/`dispensed` though both are referenced | `pharmacy/model/types.ts:29,196`, API §7.6, DB §14.5-2 | **7-value enum**; `/cancel` and `/discontinue` both resolve to `discontinued` | ADR-002 |
| C-03 | Base path `/api` vs `/api/v1`; refresh cookie scoped `/api/v1/auth` | `.env.example`, `configs/env.ts:11`, API §0.1 | **`/api/v1`**; env default changes. `client.test.ts:12` already pins a versioned base | ADR-011 |
| C-04 | Error `code` required by contract, absent from `ApiError` | API §0.3, MG §10.4 vs `api/errors.ts` | Backend always sends it; frontend adds an optional field at M39.1 | ADR-012 |
| C-05 | 401 for token problems only (MG) vs 401 `invalid_credentials` (contract) | MG §10.3 vs API §1.2 | **Contract wins** (rank 2 > rank 4); frontend narrows the refresh trigger | ADR-013 |
| C-06 | `Idempotency-Key`, `X-Client-Type` specified, never sent | API §0.5, MG §15.2 vs `client.ts` | Backend accepts both from their owning milestones | ADR-014 |
| C-07 | Doctor references are free text; DB needs FKs | 6 field names across 5 modules, DB §14.5-3 | **Ids in, names out**; snapshots on history rows | ADR-003 |
| C-08 | Five diverging department arrays plus a `Department` entity | 5 files + `administration.types.ts:50` | One table, seeded with the 12-name union | ADR-004 |
| C-09 | Health payload: 4 keys (roadmap) vs 5 (contract) | RM M1.4 vs API §20.1 | **Five keys including `ai`** — the roadmap cites the contract as its source | ADR-016 |
| C-10 | Idle timeout 10 min vs 30 min | `configs/session.ts` vs settings seed | `platform_settings` is the single source; 10 is a pre-server fallback | DB §14.5-13, ADR-007 |
| C-11 | Billing flag-off: "404/flag-off alternate" vs "not 500" | API §12.1 vs RM M17.2 | **Alternate payload**; the frontend has no 404 branch | ADR-018 |
| C-12 | `POST /auth/2fa` vs `POST /auth/otp/verify` | FE arch §6.1 vs API §1.3 | Contract wins — `/auth/otp/verify` | rank 2 > rank 5 |
| C-13 | Appendix A named two paths that no longer exist | API Appendix A vs tree | Repointed to `features/admin/`; 3 shipped seams added | ADR-009 |
| C-14 | `ConversationKind` 3 values vs 4 | `shared-domain/conversations/types.ts:20` vs DB §6 | **DB §6 governs** (adds `group`); the frontend union is a narrowing | **Resolved — ADR-029.** Built: `enum ConversationKind` carries all four |
| C-15 | `NotificationChannel`: `inApp` vs `in-app`, `desktop` missing | `notifications/model/types.ts:190`, DB §6, `admin/appointments/oversight.types.ts:49` | **Not a conflict.** DB §6 and `notifications` already agree exactly (email, sms, push, desktop, inApp); the third is a feature-local delivery-receipt display type, same category as C-17 | **Resolved — ADR-029.** Built: five enum values, five `notification_preferences` columns |
| C-16 | Role vocabularies disagree (`pharmacy` vs `pharmacist`, `reception` vs `receptionist`) | `PLATFORM_ROLES`, `StaffRole`, `ContactRole` | One `roles` table keyed on `PLATFORM_ROLES`, the other two mapping onto it | **Resolved — ADR-029**, discharging ADR-017 §6's pending A-17. Built: six roles seeded (`nurse` with an empty bundle); `receptionist`, `pharmacist`, `patient` deliberately absent |
| C-17 | Three distinct `ChatMessage` types sharing a name | messaging, notifications, ai | **Do not unify.** Different shapes, deliberate feature locality | Resolved by inspection |
| C-18 | `saved_views` has a documented UX pattern, no contract endpoint | MG §5.4/§7.3 vs API | **Open** — contract gap, not a product gap | RA-010.1 → M33.2 |
| C-19 | Queue/waiting-room: action endpoints (contract) vs generic CRUD (mock) | API §18.9–18.10 vs `administration.api.ts` | Contract wins — action endpoints | rank 3 > rank 2 for *shape*; mock is pre-contract |
| C-20 | `broadcast_channels` (DB entity 59) has no contract endpoint | DB §1 domain G vs API §9 | **It is not a table.** DB §G8: announcement and system channels are `conversations` rows of that kind, kept as a logical entity | **Resolved — ADR-029.** No endpoint is owed because no table exists |

**Nineteen of twenty are resolved.** C-14, C-15, C-16 and C-20 closed under **ADR-029** against the schema as built — C-15 turned out not to be a conflict at all, and C-20 resolved the opposite way to the sweep's reading. **C-18 (`saved_views`) alone remains open**: a documented UX pattern with no contract endpoint, scoped out of v1 by ADR-010 and carried to M33.2's coverage diff, which is the check that exists to surface exactly this.

---

## 3. Canonical enums

Frozen for the Prisma schema. Values are **exact string literals** — kebab-case where the frontend uses it, never SCREAMING_CASE.

### 3.1 Resolved by ADR

```
appointment_status   scheduled | confirmed | pending | completed | cancelled
                     | rescheduled | no-show | awaiting-patient        (ADR-001, 8)
prescription_status  draft | pending-approval | active | dispensed
                     | completed | discontinued | expired              (ADR-002, 7)
```

### 3.2 Transcribed verbatim from the frontend

| Enum | Values | Source |
|---|---|---|
| `role` | doctor, admin | `types/auth/index.ts` |
| `platform_role` | admin, doctor, reception, laboratory, pharmacy | `features/admin/permissions.ts:23` |
| `staff_role` | doctor, nurse, receptionist, laboratory, pharmacy | `administration.types.ts:15` |
| `patient_status` | active, under-treatment, critical, follow-up, discharged | `patient-identity/types.ts` |
| `risk_level` | low, medium, high, critical | ” |
| `gender` | female, male | ” |
| `blood_type` | A+, A-, B+, B-, AB+, AB-, O+, O- | ” |
| `allergy_severity` | mild, moderate, severe | `profile-types.ts:40` |
| `history_event_kind` | diagnosis, surgery, procedure, hospitalization, vaccination | `profile-types.ts:86` |
| `document_category` | referral, consent, external-record, insurance, report | `profile-types.ts:171` |
| `record_status` | draft, active, completed, archived | `medical-records/model/types.ts:25` |
| `record_priority` | low, normal, high, critical | ” :27 |
| `record_attachment_kind` | lab-result, imaging, referral, consent, external-report | ” :172 |
| `record_timeline_kind` | created, vitals-recorded, diagnosis-added, medication-prescribed, note-added, attachment-added, status-changed | ” :195 |
| `lab_status` | ordered, collected, processing, completed, cancelled | `labs/model/types.ts:25` |
| `lab_priority` | routine, urgent, stat | ” :47 |
| `lab_result_flag` | normal, low, high, critical-low, critical-high, abnormal | ” :96 |
| `lab_specimen_condition` | Acceptable, Hemolyzed, Clotted, Insufficient volume | ” :146 |
| `lab_timeline_kind` | ordered, collected, received, processing, resulted, verified, cancelled | ” :181 |
| `refill_status` | none, available, due, pending | `pharmacy/model/types.ts:53` |
| `safety_warning_kind` | interaction, allergy, duplicate, dosage | ” :148 |
| `safety_warning_severity` | info, warning, critical | ” :150 |
| `prescription_timeline_kind` | prescribed, dispensed, refill-requested, refill-approved, renewed, note-added, discontinued, expired | ” :196 |
| `message_status` | sending, sent, delivered, read, failed | `messaging/model/types.ts:32` |
| `messaging_folder` | inbox, unread, starred, sent, drafts, archived | ” :70 |
| `notification_category` | appointments, medical-records, laboratory, pharmacy, patients, ai, system, security | `notifications/model/types.ts:30` |
| `notification_priority` | normal, important, critical | ” :68 |
| `ai_context_mode` | general, patient, record, labs, pharmacy | `ai/model/types.ts:21` |
| `ai_message_status` | complete, stopped, error | ” :88 |
| `activity_kind` | profile, password, login, settings, security, integration, privacy | `settings/model/types.ts:259` |
| `room_kind` / `room_status` | consultation, lab, procedure, pharmacy, waiting / available, occupied, cleaning, maintenance | `administration.types.ts:19,21` |
| `queue_priority` | routine, priority, urgent | ” :27 |
| `audit_category` | authentication, security, user_action, admin_activity, system | DB §6 |
| `audit_severity` | info, warning, critical | DB §6 |

### 3.3 Resolved — ADR-029

All three are settled in the schema and recorded in **ADR-029**:

| Enum | Canonical value set |
|---|---|
| `notification_channel` | `email, sms, push, desktop, inApp` — DB §6 and `notifications/model/types.ts` already agreed |
| `conversation_kind` | `direct, group, announcement, system` — DB §6's four |
| `roles.code` | `admin, doctor, reception, laboratory, pharmacy` + `nurse` (empty bundle); `receptionist`→`reception` and `pharmacist`→`pharmacy` resolve as aliases and are not seeded |

---

## 4. Canonical state machines

Four, all server-enforced. Illegal transition → **409 `conflict`** with `detail`. Every transition writes an event row. Notifications fire only after commit, via the outbox.

### 4.1 Appointments (ADR-001)

```
                  ┌──────── propose-slots ────────┐
                  ▼                               │
  pending ──approve──▶ confirmed ◀──┐        awaiting-patient
     │                    │          │              │
     │                    │          └──confirm─────┤
     └──reject──▶ cancelled ◀────cancel─────────────┘
                                     ▲
  scheduled ──reschedule──▶ rescheduled
     │                          │
     └── complete | no-show ────┘   (only when slot date ≤ today)
                  ▼
              completed / no-show          [terminal: completed, cancelled, no-show]
```

Reason required (P4, audited) on reject, cancel, reschedule. Slot-date comparison uses the **clinic timezone**, not UTC — a UTC comparison lets a doctor complete an appointment a day early. Entry to `awaiting-patient` is via `POST …/propose-slots` only; **source states are unenumerated in the contract (RA-001.1)** — accept from `pending` until confirmed.

### 4.2 Prescriptions (ADR-002)

```
  ─▶ draft ──sign──▶ active ──▶ dispensed ──▶ completed
        │              │            │
        │              └── expired ─┘   (sweep past end_date)
        └──sign──▶ pending-approval ──approve──▶ active

  any non-terminal ──discontinue | cancel (reason, P4)──▶ discontinued
  [terminal: completed, discontinued, expired]
```

**Fail-closed rules at `sign`, re-run in-transaction:**

| Condition | Result |
|---|---|
| Allergy conflict | **409 `allergy_conflict`** — no override path exists in v1 |
| Severe interaction | requires `{ acknowledgedWarningIds, reason }`, else **409 `acknowledgment_required`**; ack audited |
| Safety source unavailable | **409 `safety_check_unavailable`** — stays `draft`, send impossible |

### 4.3 Laboratory

```
  ordered ──▶ collected ──▶ processing ──▶ completed
      └────────────┴─────────────┴──────▶ cancelled
```

Specimen condition ∈ {Hemolyzed, Clotted, Insufficient volume} **blocks** `processing` → 409. Reference ranges are snapshotted onto results at result time. `has_critical_result` is the one trigger-maintained denormalisation. **Critical results are reviewed individually** (`bulk:false`); bulk review is permitted only when every flag is normal. A failed review write must surface as 5xx — never a silent success.

### 4.4 Medical records

```
  draft ──▶ active ──▶ completed ──▶ archived
```

Never hard-deleted: no DELETE grant to the app role. Every update stores a before/after diff. Exactly one `isPrimary` diagnosis, enforced by partial unique index. Signing freezes note content; `aiAssisted` provenance is permanent.

---

## 5. Permission matrix

22 capabilities, extracted from `frontend/src/features/admin/permissions.ts` — the **editable** matrix behind ADM-09, which carries the lock rules the server must enforce at M7.4.

`●` held · `○` not held · `🔒●` locked on · `🔒○` locked off · **PHI** = touches protected health information

| Capability | Group | PHI | admin | doctor | reception | laboratory | pharmacy |
|---|---|---|---|---|---|---|---|
| `patients.view` | Clinical | | ● | ● | ○ | ○ | ○ |
| `patients.revealIdentity` | Clinical | ✔ | ● | ● | ○ | ○ | ○ |
| `records.view` | Clinical | ✔ | ○ | ● | ○ | ○ | ○ |
| `records.edit` | Clinical | | ○ | ● | 🔒○ | 🔒○ | 🔒○ |
| `prescriptions.create` | Clinical | | ○ | ● | 🔒○ | 🔒○ | 🔒○ |
| `labs.review` | Clinical | ✔ | ○ | ● | ○ | ○ | ○ |
| `appointments.manageOwn` | Scheduling | | ○ | ● | ○ | ○ | ○ |
| `appointments.reassign` | Scheduling | | ● | ○ | ○ | ○ | ○ |
| `appointments.cancelAdministratively` | Scheduling | | ● | ○ | ○ | ○ | ○ |
| `messages.send` | Communication | | ● | ● | ○ | ○ | ○ |
| `communications.viewMetadata` | Communication | | ● | ● | ○ | ○ | ○ |
| `communications.viewContent` | Communication | ✔ | ● | ○ | ○ | 🔒○ | 🔒○ |
| `communications.resolveFlags` | Communication | | ● | ○ | ○ | ○ | ○ |
| `doctors.manage` | Administration | | ● | ○ | ○ | ○ | ○ |
| `doctors.verify` | Administration | | ● | 🔒○ | ○ | ○ | ○ |
| `patients.manageAccounts` | Administration | | ● | ○ | ○ | ○ | ○ |
| `roles.manage` | Administration | | 🔒● | 🔒○ | 🔒○ | 🔒○ | 🔒○ |
| `settings.manageSystem` | Administration | | 🔒● | 🔒○ | 🔒○ | 🔒○ | 🔒○ |
| `integrations.manage` | Administration | | ● | 🔒○ | 🔒○ | 🔒○ | 🔒○ |
| `logs.view` | Audit | | 🔒● | ○ | ○ | ○ | ○ |
| `logs.export` | Audit | | ● | ○ | ○ | ○ | ○ |
| `ai.use` | AI | | ○ | ● | ○ | ○ | ○ |

Doctor and admin columns are the seeded bundles from `features/auth/mock/users.ts`. The three deliberate asymmetries hold: **admin has no `ai.use`** (AI is a clinical tool), **no `records.edit`**, **no `prescriptions.create`**; **doctor has no log access**.

**Server rules this implies (M7):**

1. Effective permissions = role bundle ± `user_permissions` overrides, Redis-cached, invalidated on change.
2. Locked cells are server-enforced on `PUT /roles/matrix` — a request moving `roles.manage` off `admin` is rejected, not merely hidden in the UI.
3. `patients.revealIdentity` is **the right to elevate**, not standing access: identifiers stay masked until a categorised justification is given and the audit write succeeds (ADM-10).
4. Permission changes take effect at **next session issue**, matching FE arch §6.5.
5. Administrator is a role, never an identity — no code path grants privilege by user id (ADR-017).

---

## 6. Database dependency graph

Creation order from DB §14.2, annotated with the milestone that builds each phase and the ADR that unblocked it.

```
 1  extensions (pgcrypto, citext, pg_trgm) + all ENUM types          M4.1  ← §3
 2  lookups: roles, permissions, role_permissions, departments,      M5.1  ← ADR-004
    visit_types, chronic_conditions, icd_codes, insurance_providers,       ADR-010
    specialties
 3  files                                                            M5.1  ← DB §11
 4  users, user_credentials, user_permissions, sessions,             M5.2
    trusted_devices, login_events, verification_tokens, otp_codes,
    user_activity_log
 5  doctors, admin_profiles, staff_members, rooms, resources,        M5.3
    clinic_working_days, holidays, staff_shift_assignments
    └─ ALTER departments.head_staff_id → staff_members  (deferred FK)
 6  patients + 11 satellites; doctor_availability,                   M5.4  ← ADR-005
    doctor_time_off, doctor_verification_documents
 7  lab_test_catalogue, lab_analyte_specs, medications,              M5.5  ← ADR-010
    medication_strengths, drug_interactions,
    medication_monographs, ai_prompt_templates
 8  appointments, appointment_events,                                M5.6  ← ADR-001
    appointment_reschedule_proposals, satisfaction_surveys,                ADR-003
    queue_entries, waiting_room_entries,
    patient_doctor_assignments        ◀── care-scoping anchor
 9  medical_records + 7 children, record_issue_reports               M5.7
    └─ ALTER patient_vital_signs / patient_medications (record FKs)
10  lab_orders + 4 children; prescriptions + 4 children              M5.8  ← ADR-002
11  conversations, participants, messages, attachments, flags,       M5.9
    communication_access_requests; notifications, preferences;             ADR-006
    ai_*; saved/scheduled reports; user settings; announcements,
    policies, document_templates
12  platform_settings, platform_integrations, api_keys, backups;     M5.10
    audit_events (monthly partitions + BRIN); triggers; RLS
13  patient_access_grants, incident_bookmarks, report_exports,       M5.11 ← ADR-010
    notification_deliveries
```

**Cycle:** `departments.head_staff_id` ↔ `staff_members.department_id` — broken by a deferred ALTER at phase 5, as DB §14.2 prescribes.

**Two anchors everything else leans on:** `patient_doctor_assignments` (phase 8) is what makes care scoping and RLS possible; `audit_events` (phase 12) is what every flagged action writes through.

---

## 7. API module map

All 20 contract modules → backend module → owning milestone. **Every module has an owner** — the five that had none in roadmap revision 1 (AI, Settings, Administration, Platform Settings, Dashboard) were the R2 insertion.

| API § | Module | Backend module | Milestone | Notes |
|---|---|---|---|---|
| §1 | Authentication | `auth` | **M6** | 11 routes; 8 error codes |
| §2 | Users & Account | `users` | **M8** | sessions, devices, activity, 2FA |
| §3 | Doctors | `doctors` | **M9** | profile, verification, availability |
| §4 | Patients | `patients` | **M10** | list, profile bundle, 10 tabs, reveal |
| §5 | Appointments | `appointments` | **M11** | state machine, admin oversight |
| §6 | Medical Records | `medical-records` | **M12** | versioned, never deleted |
| §7 | Pharmacy | `pharmacy` | **M13** | fail-closed safety; 100% coverage |
| §8 | Laboratory | `labs` | **M14** | pipeline, critical review |
| §9 | Messaging | `messaging` | **M20** | content-access gate (ADR-006) |
| §10 | Notifications | `notifications` | **M19** | outbox → BullMQ |
| §11 | AI Assistant | `ai` | **M16** | SSE, context fail-closed |
| §12 | Reports | `reports` | **M21** | revenue → alternate payload |
| §13 | Settings Center | `settings` | **M22** | slice updates |
| §14 | Audit | `audit` | **M28** | INSERT-only choke point |
| §15 | Roles & Permissions | `auth`/`users` | **M7** | matrix + locks (§5) |
| §16.1 | Search | `search` | **M26** | role-scoped |
| §16.2–3 | Dashboard | `dashboard` | **M27** | composite + fail-loud alerts |
| §17 | Files | `files` | **M25** | scan gate, signed URLs |
| §18 | Administration | `administration` | **M23** | 16 resource groups |
| §19 | Platform Settings | `platform-settings` | **M24** | 16 panels; unblocks M3.3 |
| §20 | Health & Meta | `health` | **M1.4 ✅** | done |

**Cross-cutting, in `shared/` (M2.3):** `AuditService` · outbox dispatcher · `PatientScopeService` · status machines · `AiGateway` · files interface.

---

## 8. Implementation plan

Roadmap order is authoritative. This is that order with dependencies and gates made explicit.

### Phase A — foundations (M2–M5)

| # | Milestone | Depends on | Gate |
|---|---|---|---|
| M2 | Module skeletons, ESLint boundaries, `shared/` kernel | M1 | boots with all modules; illegal import fails lint |
| M3 | Zod env contract, policy config service | M2 | fail-fast proven; DB-over-env layering tested |
| M4 | Prisma init, extensions, conventions, Testcontainers | M3 | migration + harness green in CI |
| M5 | Full schema in 11 steps, DB §14.2 order | **§3 enums frozen**, ADR-001…005, 010 | `migrate reset` from zero; constraint suite green |

**M5 is where the open contradictions bite.** C-15 and C-16 must be decided before M5.1's lookup migration.

### Phase B — identity and safety core (M6–M15)

M6 auth → M7 authz (`PatientScopeService` + the §5 matrix) → M8 users → M9 doctors → M10 patients → M11 appointments → M12 records → M13 prescriptions → M14 labs → M15 cross-module.

**M13 and M14 are the medical-grade core.** 100% coverage on the safety service; no milestone proceeds past a failing safety test.

### Phase C — platform surfaces (M16–M24)

M16 AI → M17/M18 billing deferrals (ADR only) → M19 notifications → M20 messaging → M21 reports → M22 settings → M23 administration → M24 platform settings.

**M24 retroactively completes M3.3**, whose policy layering has no DB source until then.

### Phase D — infrastructure (M25–M33)

M25 files → M26 search → M27 dashboard → M28 audit (retro-verifies M6–M27 coverage) → M29 activity → M30 jobs → M31 caching → M32 performance → M33 OpenAPI + drift guard.

### Phase E — hardening and integration (M34–M43)

M34 testing → M35 Docker → M36 CI/CD → M37 security (**where ADR-015's advisory returns**) → M38 production readiness → M39 frontend alignment → M40 integration → M41 mobile → M42 QA → M43 release.

### Standing gates, every milestone

`tsc --noEmit` 0 · ESLint 0 · new behaviour tested · no secrets · Zod-validated input · authz at guard level · no PHI in logs/errors/URLs · audited mutations through `AuditService` · roadmap checkbox + `Verified:` evidence in the same commit.

### Critical path

```
§3 enums → M5 schema → M7 scoping → M10 patients → M13 safety → M40 integration
```

Everything else can slip without blocking; these cannot.

---

## 9. Blockers

| Blocker | Blocks | Owner |
|---|---|---|
| M1.6 — `docker compose up -d` unverified (Docker Hub 429) | M1 exit gate | Environment |
| C-18 `saved_views` contract gap | M33.2 | Product |

---

*Produced before any domain implementation. No code was written for this document.*
