# Architecture Decision Records — Medora Backend

**Milestone:** M0.2 of `backend/docs/BACKEND_IMPLEMENTATION_ROADMAP.md`
**Created:** 2026-08-12
**Repository:** `Fares-code0/smart-healthcare-assistant-system` @ `25777ec`

This file is the register of accepted architectural decisions for the Medora backend. Every deviation from the roadmap must be recorded here as a new ADR in the same pull request (roadmap working rule 6).

## Source-of-truth hierarchy

Applied whenever two documents disagree. Derived from the roadmap header, `PROJECT_BACKEND_MASTER_GUIDE.md` §4/§18.5, and `DATABASE_SCHEMA_EXTRACTION.md` §0.

| Rank | Source | Authority |
|---|---|---|
| 1 | **Frontend source code** (`frontend/src/**`) | The DTO mirrors *are* the contract. MG §18.5: "Field names/shapes in `features/**/model/types.ts` are the contract; breaking them forces frontend churn across 19 modules." MG §17-12: "Treat **code** as authoritative." |
| 2 | **`BACKEND_API_CONTRACT.md`** | The API contract — transport, routes, params, error codes |
| 3 | **`DATABASE_SCHEMA_EXTRACTION.md`** | The database source of truth — tables, columns, constraints, enum inventory |
| 4 | **`PROJECT_BACKEND_MASTER_GUIDE.md`** | Backend context and rationale |
| 5 | **`UX_ARCHITECTURE.md`** | Confirmed product scope not yet coded ([SPEC] items) |

**Claim-class qualifier.** MG's own preamble defines three labels. `[EXISTING]` is binding. `[DERIVED]` is required by frontend code or the UX blueprint. **`[RECOMMENDATION]` is "professional advice; not required by the frontend; adopt deliberately"** — a recommendation alone is *not* sufficient evidence to accept a decision that carries clinical, legal, or privacy consequence. This distinction determines the status of ADR-006 and part of ADR-007.

## Register

| ADR | Title | Status |
|---|---|---|
| [ADR-001](#adr-001--appointment-status-enum) | Appointment Status Enum | **Accepted** |
| [ADR-002](#adr-002--prescription-status-enum) | Prescription Status Enum | **Accepted** |
| [ADR-003](#adr-003--doctor-foreign-keys-vs-free-text-names) | Doctor Foreign Keys vs Free-Text Names | **Accepted** |
| [ADR-004](#adr-004--unified-departments) | Unified Departments | **Accepted** |
| [ADR-005](#adr-005--availability-model) | Availability Model | **Accepted** |
| [ADR-006](#adr-006--content-access-policy-default) | Content-Access Policy Default | **Accepted** — default supplied by the project owner 2026-08-12 |
| [ADR-007](#adr-007--data-retention-defaults) | Data Retention Defaults | **Accepted** — four from the seed, five supplied by the project owner 2026-08-12 |
| [ADR-008](#adr-008--repository-layout-and-specification-location) | Repository Layout and Specification Location | **Accepted** (M0.3) |
| [ADR-009](#adr-009--appendix-a-seam-map-correction) | Appendix A Seam Map Correction | **Accepted** (M0.4) |
| [ADR-010](#adr-010--scope-of-the-db-13-inferred-tables) | Scope of the DB §13 Inferred Tables | **Accepted** (M0.5) |
| [ADR-011](#adr-011--api-base-path-and-refresh-cookie-scope) | API Base Path and Refresh-Cookie Scope | **Accepted** (M0.6-1) |
| [ADR-012](#adr-012--machine-error-code-propagation) | Machine Error `code` Propagation | **Accepted** (M0.6-2) |
| [ADR-013](#adr-013--401-semantics-and-the-refresh-trigger) | 401 Semantics and the Refresh Trigger | **Accepted** (M0.6-3) |
| [ADR-014](#adr-014--idempotency-key-and-x-client-type-headers) | `Idempotency-Key` and `X-Client-Type` Headers | **Accepted** (M0.6-4) |
| [ADR-015](#adr-015--nestjs-10-retained-residual-advisory-deferred) | NestJS 10 Retained; Residual Advisory Deferred | **Accepted** (M1) |
| [ADR-016](#adr-016--health-response-carries-five-service-keys) | Health Response Carries Five Service Keys | **Accepted** (M1.4) |
| [ADR-017](#adr-017--administrator-model--one-seeded-many-supported) | Administrator Model — One Seeded, Many Supported | **Accepted** — owner decision |
| [ADR-018](#adr-018--v1-scope-boundaries--tenancy-billing-patient-identity) | v1 Scope Boundaries — Tenancy, Billing, Patient Identity | **Accepted** — owner decision · **§3 superseded by ADR-030** |
| [ADR-019](#adr-019--module-boundaries-are-ports-enforced-by-lint) | Module Boundaries Are Ports, Enforced by Lint | **Accepted** (M2) |
| [ADR-020](#adr-020--one-validated-environment-policy-layered-over-it) | One Validated Environment, Policy Layered Over It | **Accepted** (M3) |
| [ADR-021](#adr-021--database-platform-prisma-7-driver-adapters-and-the-test-harness) | Database Platform — Prisma 7, Driver Adapters and the Test Harness | **Accepted** (M4) |
| [ADR-022](#adr-022--care-relationship-scoping--service-layer-in-v1-rls-before-production) | Care-Relationship Scoping — Service Layer in v1, RLS Before Production | **Accepted** (M4.4) |
| [ADR-023](#adr-023--enum-mapping-and-the-limits-of-the-drift-check) | Enum Mapping and the Limits of the Drift Check | **Accepted** (M5) |
| [ADR-024](#adr-024--audit_events-is-partitioned-and-therefore-has-a-composite-key) | `audit_events` Is Partitioned, and Therefore Has a Composite Key | **Accepted** (M5.10) |
| [ADR-025](#adr-025--the-mail-kernel-and-the-auth-values-no-source-states) | The Mail Kernel, and the Auth Values No Source States | **Accepted** (M6) |
| [ADR-026](#adr-026--refresh-rotation-keeps-one-generation-and-the-row-is-the-family) | Refresh Rotation Keeps One Generation, and the Row Is the Family | **Accepted** (M6.3) |
| [ADR-027](#adr-027--the-authorization-core-is-built-ahead-of-its-schema) | The Authorization Core Is Built Ahead of Its Schema | **Accepted** (M7) |
| [ADR-028](#adr-028--scheduled_reportsrecipients-is-text-not-citext) | `scheduled_reports.recipients` Is `text[]`, Not `citext[]` | **Accepted** (M5.9, corrective) |
| [ADR-029](#adr-029--naming-vocabularies-conversation-kinds-notification-channels-roles-and-broadcast-channels) | Naming Vocabularies — Conversation Kinds, Notification Channels, Roles and Broadcast Channels | **Accepted** (M5.1/M5.9, retrospective) |
| [ADR-030](#adr-030--patient-identity-and-authentication) | Patient Identity and Authentication | **Accepted** — owner decision, 2026-09-02 (amends ADR-018 §3) |
| [ADR-031](#adr-031--results-release-policy-patient-visible-clinical-data) | Results Release Policy — Patient-Visible Clinical Data | 🟠 **Proposed — pending clinical/product approval** |
| [ADR-032](#adr-032--patient-app-is-the-fifth-integration-branch) | `patient-app` Is the Fifth Integration Branch | **Accepted** (audit AD-6) |
| [ADR-033](#adr-033--patient-appointment-action-policy-cancellation-and-rescheduling) | Patient Appointment Action Policy — Cancellation and Rescheduling | 🟠 **Proposed — pending product/clinical approval** |
| [ADR-034](#adr-034--the-token-in-body-auth-variant-is-issued-not-only-accepted) | The Token-in-Body Auth Variant Is Issued, Not Only Accepted | **Accepted** (M6.3, corrective) |
| [ADR-035](#adr-035--registration-is-split-by-role-administrators-are-invited) | Registration Is Split by Role; Administrators Are Invited | **Accepted** (2026-09-06) |
| [ADR-036](#adr-036--meprofile-is-one-route-owned-by-the-users-module) | `/me/profile` Is One Route, Owned by the Users Module | **Accepted** (M9.1–M9.2) |
| [ADR-037](#adr-037--billing-stays-deferred-and-the-revenue-slot-answers-with-an-alternate) | Billing Stays Deferred, and the Revenue Slot Answers With an Alternate | **Accepted** (M17.1) · **§2 enum values superseded by ADR-039** |
| [ADR-038](#adr-038--payments-stay-deferred-the-ledger-is-sketched-the-processing-is-not) | Payments Stay Deferred; the Ledger Is Sketched, the Processing Is Not | **Accepted** (M18.1) |
| [ADR-039](#adr-039--the-billing-vocabulary-is-decided-ra-0371-closes) | The Billing Vocabulary Is Decided; RA-037.1 Closes | **Accepted** — owner decision · closes RA-037.1 |
| [ADR-040](../backend/docs/PENDING_ADRS.md#adr-040--platform-settings-the-crypto-kernel-the-policy-delegate-and-the-three-conventions-m24-had-to-name) | Platform Settings — The Crypto Kernel, the Policy Delegate, and the Three Conventions M24 Had to Name | **Accepted** (M24) · text held in `backend/docs/PENDING_ADRS.md` |
| [ADR-041](../backend/docs/PENDING_ADRS.md#adr-041--background-jobs-one-registry-two-drivers-and-the-four-schedules-that-are-declared-rather-than-run) | Background Jobs — One Registry, Two Drivers, and the Four Schedules That Are Declared Rather Than Run | **Accepted** (M30) · text held in `backend/docs/PENDING_ADRS.md` |

| [ADR-042](#adr-042--hospital-is-the-isolation-boundary) | Hospital Is the Isolation Boundary | **Accepted** (2026-11-22) |
| [ADR-044](#adr-044--discarding-an-unsigned-prescription-draft-is-a-soft-delete) | Discarding an Unsigned Prescription Draft Is a Soft Delete | **Accepted** (BR-DEC-002) |

**Numbering notes (swept 2026-11-22).** ADR-042 is registered below. ADR-040 and ADR-041 remain
Accepted with their full text in [`backend/docs/PENDING_ADRS.md`](../backend/docs/PENDING_ADRS.md).
ADR-043 remains reserved by Phase 20 for a possible split of cross-hospital access and AI retention.
ADR-044 is registered. ADR-045 is already registered on current origin/main. The next unallocated number is **ADR-046**. Before using it, run the
`CLAUDE.md` register sweep and inspect all available `PENDING_ADRS.md` files.
**Schema-freeze note.** ADR-001 through ADR-005 are prerequisites of RM M5 (Prisma schema). MG §18.4 — "Freeze enums and status machines before the Prisma schema. Schema churn after data exists is the second-biggest risk."

**The repository contains no physical database schema.** Verified 2026-08-12: `git ls-files` returns no `.sql`, `.prisma`, `.dump`, `.ddl`, migration directory, seed script, or compose file, and `git grep` for `CREATE TYPE` / `CREATE TABLE` / `ALTER TYPE` matches nothing outside this document's own prose. **The source of truth for every decision below is therefore the frontend source, the API contract, and `DATABASE_SCHEMA_EXTRACTION.md`** — in the precedence order stated above. These ADRs are decisions, not transcriptions.

A database is reported to exist outside this repository (project owner, 2026-08-12) and has not been connected to anything. It is unverified: no dump, DDL, or connection has been provided. That does **not** make these ADRs provisional. It means the external database must be reconciled *against* them before RM M5, and any divergence is a change request that arrives as a new ADR — with evidence — rather than a silent override. Each enum ADR carries an **⚠ External database reconciliation** note describing what to check.

---

## ADR-001 — Appointment Status Enum

**Status:** Accepted

### Context

Three appointment-status vocabularies exist in the repository, and the API contract names a fourth value that exists in none of them. The scheduling engine (RM M11) enforces a transition matrix server-side, so an ambiguous enum makes the matrix unimplementable. DB §14.5-1 lists this as inconsistency #1 and requires it resolved before schema freeze.

### Evidence

| Source | Content |
|---|---|
| `frontend/src/features/doctor/appointments/model/types.ts:24-25` | `AppointmentStatus = 'scheduled' \| 'confirmed' \| 'pending' \| 'completed' \| 'cancelled' \| 'rescheduled' \| 'no-show'` — **7 values** |
| `frontend/src/features/doctor/patients/model/profile-types.ts:137-138` | `ProfileAppointmentStatus = 'completed' \| 'confirmed' \| 'pending' \| 'cancelled' \| 'no-show'` — **5 values**, no `scheduled`, no `rescheduled` |
| `frontend/src/features/admin/appointments/oversight.types.ts:13-20` | `OversightStatus` — the same **7 values**, a deliberate duplicate. The file comment states why: "§3.4 forbids one feature module importing another's types… **The status vocabulary is deliberately the same so a future API can serve both from one DTO.**" This is corroboration of the canonical set, not a competing vocabulary |
| `frontend/src/features/admin/appointments/oversight.types.ts:22-31` | `OversightEventKind` — includes **`requested`** and `cancelled-administratively`. These are *history event kinds*, not statuses |
| `frontend/src/features/admin/appointments/AppointmentOversightSection.tsx:80` | Inline filter array — the same **7 values** |
| `frontend/src/features/doctor/appointments/model/types.ts:124-138` | `availableActions()` — the coded status machine (transcribed below) |
| DB §6 *Appointments* | `appointment_status` — scheduled, confirmed, pending, completed, cancelled, rescheduled, no-show (**7**) |
| DB §4.1 | Transition rules; notes *Awaiting patient* is "UX; **not yet in the coded enum** — see §16" |
| DB §14.5-1 | "Unify before schema freeze; **recommend adding `awaiting-patient`**" |
| DB §S3 | `appointment_reschedule_proposals` — "up to 3 slots, status **Awaiting patient**"; columns `slot_1..slot_3`, `status` (pending/accepted/declined/expired), `chosen_slot` |
| API §5 header | "Statuses: `scheduled \| confirmed \| pending \| completed \| cancelled \| rescheduled \| no-show` (**+ `awaiting-patient` per ADR**)" |
| API §5.8 | `POST /appointments/{id}/propose-slots` — "Up to 3 alternative slots → `awaiting-patient` [SPEC]" |
| API §5 transition matrix | `pending→{confirmed,cancelled}`; `scheduled\|confirmed\|rescheduled→{rescheduled,cancelled}` always, `+{completed,no-show}` when slot ≤ today; `awaiting-patient→{confirmed,cancelled,rescheduled}`; terminal: completed/cancelled/no-show |
| RM M5.6 | "status enum includes `awaiting-patient` per ADR" |
| Repository grep | `awaiting-patient` appears **nowhere** in `frontend/src/**`. The only occurrence of the phrase is a doc comment at `components/patterns/StatusBadge.tsx:49`, and the P8 vocabulary already carries an `awaiting` `StatusKind` (used by `PATIENT_STATUS_META['follow-up']`) — so the value is renderable today |

**Coded status machine**, verbatim (`availableActions()`):

```
pending                            → ['approve', 'reject']
scheduled | confirmed | rescheduled → slot ≤ today ? ['complete','no-show','reschedule','cancel']
                                                    : ['reschedule','cancel']
completed | cancelled | no-show     → []           (terminal)
```

### Decision

**The server enum `appointment_status` has 8 values:**

```
scheduled | confirmed | pending | completed | cancelled | rescheduled | no-show | awaiting-patient
```

The seven coded values are preserved **verbatim**, including the hyphenated `no-show` and `awaiting-patient` spellings (kebab-case string literals, not `NO_SHOW`).

**1. `ProfileAppointmentStatus` is not a second vocabulary.** It is a narrower frontend-local union on the patient-profile appointments tab. There is one server enum; every appointment payload — including `GET /patients/{patientId}/appointments` (API §4.5) — carries a value from the 8-value enum. The 5-value union is a frontend type defect that will fail to compile or mis-render when the server returns `scheduled` or `rescheduled` on that tab. Per rule 2 this ADR does not change the frontend; the required widening is recorded as a consequence for RM M39.

**2. The server-enforced transition matrix** is the API §5 matrix, which is a strict superset of `availableActions()` plus the `awaiting-patient` state:

| From | To | Condition |
|---|---|---|
| `pending` | `confirmed` | approve |
| `pending` | `cancelled` | reject — reason required (P4) |
| `scheduled` \| `confirmed` \| `rescheduled` | `rescheduled` | reschedule — reason required |
| `scheduled` \| `confirmed` \| `rescheduled` | `cancelled` | cancel — reason required (P4) |
| `scheduled` \| `confirmed` \| `rescheduled` | `completed` \| `no-show` | **only when slot date ≤ today** |
| `awaiting-patient` | `confirmed` \| `cancelled` \| `rescheduled` | patient response or doctor override |
| `completed` \| `cancelled` \| `no-show` | — | **terminal** |

Any transition not in this table returns **409 `conflict`** with `detail` (API §0.3). Transitions are compare-and-set; every transition inserts an `appointment_events` row; notifications fire only after commit via the outbox.

**3. `awaiting-patient` is entered only through `POST /appointments/{id}/propose-slots`** (API §5.8), which also writes an `appointment_reschedule_proposals` row (DB §S3) holding up to three slots. The proposal row carries its own independent lifecycle (`pending/accepted/declined/expired`) — the appointment's status and the proposal's status are distinct fields and must not be conflated.

**4. Residual — the source states for `propose-slots` are not enumerated by any source.** API §5.8 names the destination but not the origin. This ADR does **not** invent them. See §Residual ambiguity below.

### ⚠ External database reconciliation

No `appointment_status` type exists in this repository (verified — see the schema-freeze note). This ADR stands on the frontend source, API §5 and DB §6.

If the externally reported database declares the type, compare it against this decision before RM M5.6:

- 8 values including `awaiting-patient` → agreement; nothing to do.
- 7 values → add one (`ALTER TYPE … ADD VALUE`; non-transactional in Postgres, so it must be its own migration step).
- Any other value set → a divergence from three ranked sources. Raise it as a new ADR with evidence; do not silently adopt it.

### Consequences

**API.** All appointment payloads emit one of 8 literals. `POST /appointments/{id}/propose-slots` becomes implementable. The transition matrix is enforced identically on every action endpoint (`/approve`, `/reject`, `/cancel`, `/reschedule`, `/complete`, `/no-show`), returning 409 on an illegal transition regardless of which endpoint was called.

**Database.** Native enum type with 8 values (DB §6 style). The DB §4.1 status-transition trigger must accept `awaiting-patient` as both target and source. `appointment_reschedule_proposals` (DB §S3) is in scope for RM M5.6.

**Backend services.** One `AppointmentStatusMachine` in `shared/` is the only place the matrix exists; controllers and services call it. Slot-date comparison (`slot ≤ today`) is evaluated in the clinic's configured timezone (platform localization slice), not UTC — a UTC comparison would let a doctor mark an appointment complete a day early or late.

**Frontend integration (RM M39/M40).** Four definition sites must gain the 8th value, none of which is touched here:

1. `appointments/model/types.ts:24` — `AppointmentStatus`, plus a case in `availableActions()` and an entry in `APPOINTMENT_STATUS_META` (which is what `APPOINTMENT_STATUSES` derives from)
2. `patients/model/profile-types.ts:137` — `ProfileAppointmentStatus` must widen to the full union, or the patients tab must map unknown values to a safe default
3. `admin/appointments/oversight.types.ts:13` — `OversightStatus`; the file's own comment anticipates one DTO serving both, so it must track the canonical set
4. `admin/appointments/AppointmentOversightSection.tsx:80` — the inline filter array, or the admin filter silently omits those rows

The duplication across four sites is deliberate module isolation (`FRONTEND_ARCHITECTURE.md` §3.4), not an accident — but it means adding an enum value is a four-file change on the frontend and a one-value change on the server.

**Testing.** RM M11.3 requires a full matrix test — every legal and illegal transition per status × slot-date. With 8 states that is 8 × 8 × 2 (before/after slot date) = 128 assertions, plus a concurrency test proving two simultaneous approves yield one 200 and one 409.

### Alternatives considered

| Alternative | Rejected because |
|---|---|
| Keep 7 values; model "awaiting patient" as a boolean flag or as the proposal row's existence | API §5, RM M5.6 and DB §14.5-1 all name it as a status value. A flag cannot participate in the transition matrix, and the UI renders status as a single badge (P8 vocabulary, one status → one colour) |
| Adopt the 5-value `ProfileAppointmentStatus` as canonical | Loses `scheduled` and `rescheduled`, which the primary appointments module and the whole status machine depend on. Rank-1 evidence (the appointments module) outranks a feature-local narrowing |
| Add UX §7's `requested` as a synonym for `pending` | It exists in code, but as an **event kind**, not a status: `OversightEventKind` (`oversight.types.ts:23`) lists `requested` alongside `nudged` and `reassigned`, none of which are states. The request *event* creates an appointment in status `pending`. Adding it as a status would give one state two names — precisely the ambiguity this ADR removes |

### Residual ambiguity

**RA-001.1 — Which statuses may transition *to* `awaiting-patient`?** API §5.8 defines the destination; no source enumerates the origin states. The plausible reading is that "propose another time" is offered wherever `reschedule` is offered (`pending`, `scheduled`, `confirmed`, `rescheduled`), but no document states it. **Not decided here.** Flagged for product confirmation before RM M11.4. Until confirmed, the safe implementation is to accept `propose-slots` only from `pending` — the one state where the contract's own example flow (a patient request the doctor cannot accommodate) is unambiguous — and to widen it after confirmation.

---

## ADR-002 — Prescription Status Enum

**Status:** Accepted

### Context

The coded prescription enum has no `draft`, yet the API contract's create endpoint creates a draft and the sign endpoint is what moves a prescription out of it. It has no `dispensed`, yet the prescription timeline emits a `dispensed` event. This is the highest-risk module in the platform (RM M13: "fail closed, 100% test coverage on the safety service"), and the fail-closed rule is expressed *as a status*: when the interaction source is unavailable, only draft-saving is permitted.

### Evidence

| Source | Content |
|---|---|
| `frontend/src/features/doctor/pharmacy/model/types.ts:29-34` | `PrescriptionStatus = 'active' \| 'completed' \| 'discontinued' \| 'pending-approval' \| 'expired'` — **5 values** |
| `frontend/src/features/doctor/pharmacy/model/types.ts:196-204` | `PrescriptionTimelineKind` includes **`dispensed`** — alongside prescribed, refill-requested, refill-approved, renewed, note-added, discontinued, expired |
| DB §6 *Pharmacy* | `prescription_status` — active, completed, discontinued, pending-approval, expired (**5**); `prescription_timeline_kind` includes `dispensed` |
| DB §14.5-2 | "UX §2.7 badges (**Draft, Sent, Dispensed**, Expired, Cancelled) vs coded enum … The coded enum has **no *draft* or *dispensed*** even though 'Save as draft' and dispensed timeline events exist" |
| `pharmacy/model/types.ts:42` | `PRESCRIPTION_STATUS_META.discontinued = { label: 'Discontinued', kind: **'cancelled'** }` — the coded metadata already maps the *discontinued* status onto the *cancelled* P8 status kind. This is direct evidence that the UX "Cancelled" badge is a presentation of `discontinued`, not a missing enum value |
| API §7 header | "Status: `pending-approval\|active\|completed\|discontinued\|expired` (**+ `draft`, `dispensed` per ADR**)" |
| API §7.6 | `POST /prescriptions` — "Create **draft**" |
| API §7.7 | `POST /prescriptions/{id}/sign` — "Sign & send… Success → status **active/pending-approval**" |
| API §7.7 | "safety source down ⇒ 409 `safety_check_unavailable` (**draft-only, fail closed**)" |
| RM M13.3 | "chaos test with the interaction source disabled proves send is impossible but **draft save works**" |
| MG §7.7 | "**Signing required before a prescription leaves draft**"; "Reconcile the status-vocabulary drift (add draft/dispensed — DB §14.5-2)" |
| API §7.9 | `POST /prescriptions/{id}/discontinue` · `/cancel` — two endpoints, `{ reason }` (P4/audited) |
| DB §9 | CHECK `refills_remaining BETWEEN 0 AND refills_allowed`; `end_date >= start_date` |

### Decision

**The server enum `prescription_status` has 7 values:**

```
draft | pending-approval | active | dispensed | completed | discontinued | expired
```

The five coded values are preserved **verbatim** (note `pending-approval` is hyphenated). Two are added.

**1. `draft` is load-bearing, not cosmetic.** It is the state that makes the fail-closed rule expressible. `POST /prescriptions` (API §7.6) creates a `draft`. A draft has not been prescribed: it does not appear in the patient's medication list, generates no notification, and produces no timeline `prescribed` event. Only `POST …/sign` moves it forward, and only after the safety check re-runs in-transaction.

**2. `dispensed` is a real state, evidenced by its own timeline event.** It is terminal-adjacent: a dispensed prescription may still expire or be discontinued, but cannot return to `active`.

**3. Lifecycle:**

| From | To | Trigger |
|---|---|---|
| — | `draft` | `POST /prescriptions` |
| `draft` | `active` | `POST …/sign` — no approval required |
| `draft` | `pending-approval` | `POST …/sign` — when the medication is controlled or the policy requires approval |
| `pending-approval` | `active` | approval granted |
| `active` | `dispensed` | dispense event |
| `active` \| `dispensed` | `completed` | course finished |
| `active` \| `dispensed` \| `pending-approval` | `expired` | expiry sweep past `end_date` (RM M13.5) |
| `draft` \| `pending-approval` \| `active` \| `dispensed` | `discontinued` | `POST …/discontinue` or `/cancel` — reason required (P4/audited) |
| `completed` \| `discontinued` \| `expired` | — | **terminal** |

**4. `/cancel` and `/discontinue` both resolve to `discontinued`.** API §7.9 exposes two endpoints; neither the coded enum nor `PrescriptionTimelineKind` contains a `cancelled` value, and DB §6 lists only `discontinued`. Inventing a `cancelled` status to match a UX badge label would contradict rank-1 and rank-3 evidence. The two endpoints are preserved as distinct routes (they carry different reason vocabularies and different audit semantics — cancelling an unsent draft is not clinically the same act as discontinuing an active therapy), but they write the same terminal status. The distinction is preserved in the audit event and the P4 reason, not in the status column.

**5. UX badge labels are display strings, not enum values.** DB §14.5-2's "Sent" is the badge for `active`; "Cancelled" is the badge for `discontinued`. Labels live in `PRESCRIPTION_STATUS_META`, which is frontend-owned.

**6. The safety rules are status rules** (API §7.7, unchanged by this ADR, restated because they constrain the machine): an allergy conflict returns **409 `allergy_conflict`** with **no override path**; a severe interaction requires `{ acknowledgedWarningIds, reason }` or returns **409 `acknowledgment_required`**; an unavailable safety source returns **409 `safety_check_unavailable`** and the prescription **stays in `draft`**. In all three cases the status does not advance.

### ⚠ External database reconciliation

No `prescription_status` type exists in this repository (verified — see the schema-freeze note). This ADR stands on the frontend source, API §7 and DB §6/§14.5-2.

If the externally reported database declares the type with 5 values, two must be added before RM M13. Enum ordering affects sort behaviour but not correctness; if ordering matters to an existing view, place `draft` before `pending-approval` and `dispensed` after `active`. A different value set is a divergence to raise as a new ADR, not to adopt silently.

### Consequences

**API.** `POST /prescriptions` returns a resource whose status is `draft` — the frontend's four-step prescribing stepper depends on this to allow save-and-return. `GET /prescriptions?status=` accepts all 7 values. The three 409 codes are unchanged.

**Database.** Enum gains 2 values. A partial index on `(status, end_date)` supports the expiry sweep (DB §8). `refills_remaining` CHECK is unaffected. Drafts must be excluded from the `patient_medications` materialisation (RM M13.6) — only signing adds a row.

**Backend services.** `PrescriptionStatusMachine` in `shared/`, structurally identical to the appointment machine. The safety service is a separate unit with its own 100% coverage requirement (RM M34.1) and is invoked twice: advisory at `POST /prescriptions/safety-check`, authoritative and in-transaction at `POST …/sign`.

**Frontend integration.** `PrescriptionStatus` must widen to 7 values, and `PRESCRIPTION_STATUS_META` must gain `draft` and `dispensed` entries with P8 status kinds, or those rows render without a badge. `PRESCRIPTION_STATUSES` is derived via `Object.keys(PRESCRIPTION_STATUS_META)`, so adding the meta entries is what widens the filter list. Recorded for RM M39; not done here.

**Testing.** RM M13.3 requires all three 409 branches plus a chaos test proving send is impossible while draft save succeeds — that test is only expressible because `draft` exists. Refill bounds and renew-copies-source are separate (RM M13.4).

### Alternatives considered

| Alternative | Rejected because |
|---|---|
| Keep 5 values; model draft as a nullable `signed_at` | The fail-closed rule (API §7.7) and RM M13.3's chaos test are both written in terms of a *draft state*. A null timestamp cannot be filtered on in `GET /prescriptions?status=draft`, which the contract exposes |
| Keep 5 values; treat `dispensed` as timeline-only | The timeline event already exists and would have no corresponding state, so the list view could never show a dispensed prescription as distinct from an active one — which UX §2.7 badges require |
| Add `cancelled` to match the UX badge list | Contradicts rank-1 (no coded value) and rank-3 (DB §6 has no such value). The badge label maps to `discontinued` |

---

## ADR-003 — Doctor Foreign Keys vs Free-Text Names

**Status:** Accepted

### Context

Doctor identity appears throughout the DTOs as free-text display names ("Dr. Amelia Chen"). The database requires referential integrity for scoping, filtering, statistics, and reassignment. But MG §18.5 makes the DTO field names binding, so the backend cannot simply replace `doctor: string` with `doctorId: string` — that would break nineteen delivered frontend modules. The two requirements are both real and must coexist.

### Evidence

| Source | Content |
|---|---|
| `appointments/model/types.ts:76` | `readonly doctor: string` |
| `patients/model/profile-types.ts:144` | `readonly doctor: string` (`AppointmentRecord`) |
| `medical-records/model/types.ts:244` | `readonly doctor: string`; `:221` `readonly actor: string` (timeline) |
| `labs/model/types.ts:231` | `readonly orderedBy: string`; `:152` `readonly collectedBy: string`; `:207` `readonly actor: string` |
| `pharmacy/model/types.ts:224` | `readonly actor: string` (timeline) |
| `shared-domain/patient-identity/types.ts` | `readonly assignedDoctor: string` |
| `*/model/filters.ts` | `readonly doctor: string \| null` — client-side filter state in appointments, records, labs, pharmacy |
| DB §14.5-3 | "Doctor references are free-text names (`assignedDoctor`, `doctor`, `orderedBy`, `prescribingDoctor`, `collectedBy`, timeline `actor`) — **must become FKs**; mock names double as the auth user display name" |
| DB §3 | `doctors` → appointments, medical_records, lab_orders (ordered_by), prescriptions, doctor_availability, doctor_time_off, doctor_verification_documents |
| DB §9 | FK policy: **RESTRICT** on clinical anchors (`patient_id`/`doctor_id` on appointments, records, lab_orders, prescriptions); **SET NULL** on optional links including "actor on audit/history rows — history must survive account removal" |
| MG §17-3 | "FKs in DB; **keep denormalized `doctorName` in list DTOs for compatibility**" |
| MG §10.2 | "camelCase JSON fields exactly matching the frontend model types … the DTO mirrors are the contract; **do not rename**" |
| API §5.10 | `POST /admin/appointments/{id}/reassign` `{ doctorId, reason }` — **input uses an id** |
| API §3.4/3.5 | `GET /doctors`, `GET /doctors/{doctorId}` — admin surfaces address doctors by id |
| API §0.4 | All clinical routes are care-scoped: "doctors access only patients assigned to them" |

### Decision

**Identity is a foreign key; display is a denormalised string. Ids go in, names come out.**

**1. Database — foreign keys only.** Every doctor reference is `doctor_id uuid` (or a role-specific column such as `ordered_by`, `prescribing_doctor_id`, `collected_by`, `actor_id`) referencing `doctors` or `users`, with the DB §9 cascade policy: RESTRICT on clinical anchors, SET NULL on history/actor columns. No table stores a doctor's name as its only reference.

**2. API responses — the existing field names, unchanged, carrying the display name.** `doctor`, `assignedDoctor`, `orderedBy`, `collectedBy`, `actor` remain `string` and remain spelled exactly as they are. This is not negotiable under MG §10.2 and §18.5.

**3. API inputs — ids.** Every write and every server-side filter identifies a doctor by id: `{ doctorId }` on reassign (API §5.10), `doctorId` as a list filter parameter. A display name is never accepted as an identifier — names are neither unique nor stable.

**4. Two resolution strategies, chosen per field by whether the value is current state or history:**

| Field kind | Examples | Strategy |
|---|---|---|
| **Current state** — must track renames | `Appointment.doctor`, `Patient.assignedDoctor`, `MedicalRecord.doctor`, `LabTest.orderedBy` | Resolve from the FK **at read time** (join or dataloader). A doctor who changes their name is renamed everywhere at once |
| **Historical fact** — must not change | timeline `actor` on records/labs/prescriptions, `LabSpecimen.collectedBy`, `appointment_events.actor` | Store **both** the FK and a `*_name_snapshot` column written at insert time. Serve the snapshot. The FK may become NULL when an account is removed (DB §9 SET NULL); the snapshot keeps the history readable |

The snapshot columns are additive storage the API never exposes as separate fields — they populate the existing `actor`/`collectedBy` strings.

**5. Response DTOs additionally carry the id** where a client needs to navigate or act — for example `GET /doctors` (API §3.4) returns `id` because the admin detail route is keyed on it. Adding an id field alongside an existing name field is **additive** and does not break the frontend (MG §8.5: additive changes do not require a version bump). It does not license renaming or removing the name field.

**6. The doctor's display name is the `users` record's name**, not a separate pharmacy or lab string. DB §14.5-3 observes that the mock names double as the auth display name; one source prevents "Dr. Amelia Chen" and "A. Chen" diverging across modules.

### ⚠ Built-database reconciliation

Confirm whether the built tables already carry `*_name_snapshot` columns on history rows. If they do not, and if history rows only have a nullable FK, then removing a user account silently blanks historical attribution — a compliance problem worth raising before RM M5. This ADR does not add columns; it records that they are required.

### Consequences

**API.** No response shape changes. Filter parameters that today are client-side name strings become `doctorId` server-side. `GET /appointments` remains scoped to the caller; `GET /admin/appointments` (API §5.10) accepts an explicit `doctorId`.

**Database.** FKs on appointments, medical_records, lab_orders, prescriptions, plus availability, time-off and verification tables. Snapshot columns on history/timeline tables. Indexes per DB §8 — `appointments (doctor_id, starts_at)`, `prescriptions (prescribing_doctor_id, created_at DESC)` — are keyed on the FK, which is precisely why free text cannot remain.

**Backend services.** `PatientScopeService` (RM M7.2) resolves the care relationship through `patient_doctor_assignments` (DB §13.1) keyed by `doctor_id`. Care-scoping by name would be a security defect, not merely untidy. A shared display-name resolver prevents N+1 lookups (RM M32.3).

**Frontend integration.** Nothing breaks. Client-side name filters in `*/model/filters.ts` become server params during RM M40; until then they keep filtering the payload they already receive.

**Testing.** Contract tests assert the name fields still arrive as strings with the same keys. A scoping test proves doctor A cannot reach doctor B's patient by supplying B's *name* anywhere. A rename test proves current-state fields change and historical snapshots do not.

### Alternatives considered

| Alternative | Rejected because |
|---|---|
| Replace `doctor: string` with `doctorId: string` in responses | Breaks the DTO contract across 19 modules. MG §18.5 identifies this as the change with the widest blast radius in the project |
| Add a nested `doctor: { id, name }` object | Changes the field's type from `string` to an object — a breaking change to every consumer that renders `{appointment.doctor}` |
| Keep free text and match on name | Names are not unique and not stable; care-scoping would become string comparison, and DB §14.5-3 explicitly requires FKs |
| Snapshot every field, including current state | A doctor's rename would never propagate, so the same person appears under two names depending on record age |

---

## ADR-004 — Unified Departments

**Status:** Accepted

### Context

Department is used as a filter, a grouping dimension in analytics, a routing target, and an administrable entity with a head and a staff count. It exists in the repository as **five** independent hard-coded string arrays plus one id-bearing entity — and the arrays do not agree with each other. Cross-module reporting (API §12) cannot aggregate by a dimension that has five definitions.

### Evidence

Five arrays, read directly:

| Location | Values |
|---|---|
| `appointments/model/types.ts:94` `DEPARTMENTS` | General Medicine, Cardiology, Endocrinology, Pulmonology, Orthopedics |
| `medical-records/model/types.ts:68` `RECORD_DEPARTMENTS` | *(identical to appointments)* |
| `labs/model/types.ts:84` `LAB_DEPARTMENTS` | General Medicine, Cardiology, Endocrinology, Pulmonology, **Nephrology, Oncology, Emergency** |
| `pharmacy/model/types.ts:119` `PRESCRIBER_DEPARTMENTS` | General Medicine, Cardiology, Endocrinology, Pulmonology, **Psychiatry**, Orthopedics |
| `reports/model/mock-data.ts:24` `DEPARTMENTS` | Cardiology, **Internal Medicine, Pediatrics**, Orthopedics, **Neurology** |

Plus the entity:

| Source | Content |
|---|---|
| `frontend/src/features/admin/administration.types.ts:50` | `Department { id, name, description, status: ActiveStatus, headStaffId, staffCount }` |
| DB §1 domain K | Entity 70 — `departments` |
| DB §14.5-4 | "Departments are three diverging string lists … *and* an id-bearing `Department` entity in administration — **normalize to one table**" |
| DB §14.2 phase 2 | `departments` created in the lookups phase, **before** staff, with `departments.head_staff_id` resolved by a deferred `ALTER` |
| DB §9 | FK policy: **RESTRICT** on lookup FKs including "departments on staff" |
| API §18.3 | Departments CRUD — "name, description, status active/inactive, headStaffId; **`staffCount` derived**" |
| API §12.1 | Analytics accept department as a filter dimension |
| MG §17-4 | "**Single `departments` table; seed the union**" |
| RM M5.1 | `departments` is created in the lookups migration |

Note: DB §14.5-4 says "three diverging string lists"; the actual count is **five** (reports adds a fifth with three otherwise-unseen values). The direction of the finding is unaffected.

### Decision

**One `departments` table is the single source. All modules reference it by FK. API responses keep the existing `department: string` field carrying the name.**

This is ADR-003's rule applied to a lookup: **ids in, names out.**

**1. The table** is DB entity 70 with the shape `administration.types.ts:50` already defines: `id`, `name`, `description`, `status` (`active | inactive`), `head_staff_id` (deferred FK to `staff_members`), plus audit columns. `staffCount` is **derived**, never stored (DB §14.5-6).

**2. Seed = the union of all five coded arrays**, twelve rows:

```
General Medicine · Cardiology · Endocrinology · Pulmonology · Orthopedics
Nephrology · Oncology · Emergency · Psychiatry
Internal Medicine · Pediatrics · Neurology
```

No name is dropped. Dropping one would remove values that seeded frontend data already displays.

**3. Every clinical and operational table references `department_id`**, nullable where the frontend treats it as optional, with **RESTRICT** on delete per DB §9 — a department with clinical history cannot be deleted, only set `inactive`.

**4. API responses keep `department: string` (the name).** Writes and server-side filters accept `departmentId`. Where a contract endpoint already sends a name (a list filter), the server resolves it case-insensitively against `departments.name` and returns **422** on no match rather than silently returning an empty page.

**5. The per-module arrays become presentation-layer subsets, not vocabularies.** `LAB_DEPARTMENTS` is "departments that order labs" — a legitimate UI narrowing over one canonical list. The backend does not model these subsets; if a subset must be enforced server-side, it becomes a flag on the department row, and that is a new ADR.

### Consequences

**API.** No response shape changes. `GET/POST/PATCH/DELETE /administration/departments` (API §18.3) is the only write surface. Analytics can finally group by a single dimension.

**Database.** `departments` created in phase 2 (DB §14.2) before staff, with `head_staff_id` added by deferred ALTER in phase 5 — the FK cycle DB §14.2 already flags and RM M5.3 already schedules.

**Backend services.** A cached reference-data lookup (RM M31.1, long TTL, explicit bust on edit). Name→id resolution is one shared helper, not per-module string matching.

**Frontend integration.** Nothing breaks now. During RM M40 the five arrays should be replaced by a fetch of the canonical list; until then they continue to work as filter vocabularies over data the server already sends by name.

**Testing.** A seed test asserts all twelve names load. A referential test asserts deleting a department that has appointments returns 409 rather than cascading.

### Alternatives considered

| Alternative | Rejected because |
|---|---|
| Keep department as free text with no table | Contradicts DB entity 70 and API §18.3, which give departments a head, a status and a derived staff count. Free text cannot carry those |
| Seed only the five-value intersection | Deletes Nephrology, Oncology, Emergency, Psychiatry, Internal Medicine, Pediatrics and Neurology — values seeded frontend data already renders |
| Model per-module subsets as separate tables | Five tables for one concept; reporting would still need a union. The subsets are UI narrowings, not distinct domains |
| Postgres enum instead of a table | Departments are user-administrable (API §18.3 has full CRUD). Enums require a migration to add a value |

### Residual ambiguity

**RA-004.1 — Are "General Medicine" and "Internal Medicine" the same department?** They are clinically near-synonymous, and no source states whether the reports module's "Internal Medicine" is a distinct department or a different label for the same one. This ADR **seeds both as distinct rows** — the conservative choice, because merging them silently changes what already-displayed data says. Flagged for product confirmation. Merging later is a data migration; splitting later is not, which is why the conservative direction is the reversible one.

---

## ADR-005 — Availability Model

**Status:** Accepted

### Context

RM M11.2 requires appointment creation to conflict-check against doctor availability, and RM M11.5 requires an emergency time-off flow that computes a blast radius over affected appointments. Neither is implementable without a defined availability model. Availability is [SPEC] — specified in UX §2.11 and the database dictionary, with no frontend code (MG §17-5: "Model per DB §S2 now — appointments depend on it").

### Evidence

| Source | Content |
|---|---|
| **DB §S2** (verbatim) | `doctor_availability`: `id uuid PK` · `doctor_id → doctors CASCADE` · `weekday weekday NOT NULL` · `start_time time` · `end_time time` · `is_break boolean DEFAULT false` · unique (`doctor_id`,`weekday`,`start_time`). Plus `doctor_time_off`: `id`, `doctor_id`, `starts_at`, `ends_at`, `kind` (vacation/emergency-block), `auto_behavior varchar(30)` (block-new/reschedule-existing), `created_at`. Doctor defaults: `default_duration_min smallint` (15/20/30/45/60), `buffer_min smallint` **on `doctors`** |
| DB §9 | CHECK: working days `end_time > start_time` |
| DB §6 | `weekday` — Mon…Sun |
| DB §14.2 phase 6 | `doctor_availability`, `doctor_time_off` created with patients, **before** appointments (phase 8) |
| API §3.8 | `GET/PUT /me/availability` — "Weekly grid (per-day toggles + ranges + breaks), `defaultDurationMin ∈ {15,20,30,45,60}`, `bufferMin`" |
| API §3.9 | `POST /me/time-off` — `{ from, to, mode }` → "returns impacted appointments for the emergency flow" |
| API §5.9 | `POST /me/time-off/{blockId}/resolve` — per-appointment/bulk `{ action: reschedule-proposal \| handover \| cancel-apology }`, requires prior blast-radius confirmation `{ confirmedCount }` |
| API §5.3 | `POST /appointments` — "conflict vs availability/overlap → **409**" |
| RM M9.4 | "grid round-trip; **overlapping ranges rejected 422**" |
| RM M11.5 | "mismatch in `confirmedCount` → 409; **nothing sent before confirmation** (outbox empty)" |
| DB §4.1 | "Emergency time-off: system lists all impacted appointments; per-appointment or bulk choice…; a blast-radius summary **must be confirmed before any notification fires**" |
| `administration.types.ts:79` | `WorkingDay` — the **clinic's** hours, a separate concept (API §18.6, DB entity 75 `clinic_working_days`) |

### Decision

**Adopt DB §S2 exactly as specified. No redesign.**

**1. Weekly availability is a row set, not a JSON blob.** Each row is one contiguous range on one weekday: `(doctor_id, weekday, start_time, end_time, is_break)`. A break is a row with `is_break = true` **inside** a working range. A weekday with no rows is a non-working day — there is no separate "enabled" boolean, because absence of rows already means unavailable.

**2. Per-doctor defaults live on `doctors`**, not per row: `default_duration_min ∈ {15,20,30,45,60}` (validated — the API contract fixes this set) and `buffer_min`.

**3. Time off is an absolute-time range**, separate from the weekly grid: `doctor_time_off (doctor_id, starts_at, ends_at, kind, auto_behavior)` where `kind ∈ vacation | emergency-block` and `auto_behavior ∈ block-new | reschedule-existing`. The grid is recurring civil time; time off is a specific interval. Conflating them is why the two are separate tables in DB §S2.

**4. Conflict checking — the definitive algorithm** for `POST /appointments` (API §5.3). A candidate slot `[start, start + durationMin)` is valid only if **all five** hold:

1. **Inside a working range** — a `doctor_availability` row exists for the slot's weekday with `is_break = false` where `start_time ≤ slot.start` and `slot.end ≤ end_time`
2. **Not inside a break** — no `is_break = true` row on that weekday overlaps the slot
3. **Not inside time off** — no `doctor_time_off` interval overlaps the slot
4. **No booking overlap** — no existing appointment for that doctor in a non-terminal status (`scheduled`, `confirmed`, `pending`, `rescheduled`, `awaiting-patient` per ADR-001) overlaps the slot **extended by `buffer_min` on both sides**
5. **Duration is positive** — `durationMin > 0` (DB §9 CHECK)

Any failure returns **409 `conflict`** with a `detail` naming which rule failed (API §0.3 requires `detail` on 409). Weekday and civil-time comparisons use the clinic timezone from the platform localization slice, not UTC.

**5. `PUT /me/availability` replaces the whole grid transactionally.** It is a grid round-trip (API §3.8), not a per-row CRUD. Server validation: `end_time > start_time` per row (DB §9); no two non-break ranges on one weekday may overlap → **422** (RM M9.4); every break must fall inside a working range on the same weekday → **422**; `defaultDurationMin` must be in the fixed set → **422**.

**6. Editing availability never retroactively invalidates booked appointments.** Existing bookings are checked at creation, not continuously. Narrowing the grid returns the affected-appointment list (the same projection API §3.9 returns for time off) so the doctor can act, but the server does not auto-cancel anything.

**7. The emergency flow is two-phase and fail-safe.** `POST /me/time-off` (API §3.9) creates the block and **returns** the impacted appointments — it sends nothing. `POST /me/time-off/{blockId}/resolve` (API §5.9) requires `{ confirmedCount }` matching the server's current impact count; a mismatch returns **409** and sends nothing. Only after a matching confirmation do notifications enter the outbox. RM M11.5's verify step tests exactly this: "nothing sent before confirmation (outbox empty)."

**8. `doctor_availability` is not `clinic_working_days`.** Entity 75 is the clinic's opening hours (API §18.6, admin-owned, seven fixed rows). A doctor's grid is personal and independent. This ADR does not decide whether a doctor's availability may exceed clinic hours — see residual.

### Consequences

**API.** §3.8, §3.9 and §5.9 become implementable as written. `POST /appointments` gains a deterministic 409 condition. No contract change.

**Database.** Two tables plus two columns on `doctors`, exactly as DB §S2 states — created in phase 6, before appointments in phase 8, so the FK order already works. Indexes: `doctor_availability (doctor_id, weekday)`, `doctor_time_off (doctor_id, starts_at, ends_at)`.

**Backend services.** One `AvailabilityService` owns rules 1–3 and 5; the appointments module owns rule 4 (it needs the appointment table). The impact projection is shared by `POST /me/time-off`, `PUT /me/availability` and the admin suspend preview (API §3.7 `affectedAppointments`) — one query, three callers.

**Frontend integration.** Availability has no frontend consumer today. RM M39 must build the grid editor before this can be verified through the UI; until then it is verified by contract test.

**Testing.** Boundary cases are the whole risk: a slot ending exactly at `end_time` is valid; one ending a minute later is not. Buffer overlap at both edges. A slot spanning a break. DST transitions in the clinic timezone. `confirmedCount` mismatch. Overlapping ranges on `PUT` → 422.

### Alternatives considered

| Alternative | Rejected because |
|---|---|
| Store the weekly grid as JSONB on `doctors` | Contradicts DB §S2, which specifies a table with a unique constraint. JSONB cannot be indexed for the "is this slot available" query that runs on every booking |
| Model breaks as columns on the working-range row (`break_start`, `break_end`) | Limits a day to one break. `is_break` rows allow any number, which is why DB §S2 uses a boolean discriminator |
| Merge time off into the weekly grid as dated overrides | Recurring civil time and absolute intervals need different queries and different indexes. DB §S2 separates them |
| Continuous revalidation of booked appointments against the current grid | Would let an availability edit silently invalidate a confirmed clinical appointment. The platform's rule is that destructive effects are explicit, confirmed, and reason-carrying (P4) |

### Residual ambiguity

**RA-005.1 — May a doctor's availability fall outside `clinic_working_days`?** No source states whether the clinic's hours bound a doctor's grid. This ADR does **not** enforce a bound — the two tables are independent as specified. Flagged for confirmation before RM M9.4.

**RA-005.2 — `auto_behavior = reschedule-existing` semantics.** DB §S2 names the value; API §5.9 defines resolution as an explicit doctor choice per appointment. Whether `reschedule-existing` means "pre-select the reschedule-proposal action in the resolve UI" or "act automatically" is not stated. Automatic action would contradict the mandatory blast-radius confirmation (rule 7), so this ADR reads it as a **default pre-selection only**. Flagged for confirmation.

---

## ADR-006 — Content-Access Policy Default

**Status:** **Accepted** — mechanism and default. The default was supplied by the project owner on 2026-08-12; the analysis that preceded it is retained below because it records why the question could not be answered from the documents alone.

### Context

Administrators can request access to the *content* of doctor–patient messages. This is the most privacy-sensitive capability in the platform: it exposes PHI written in confidence between a clinician and a patient. The project specifies the gate in detail — justification category, reason, optional second-admin approval, watermarked read-only view, audit event with a reference number — but does **not** establish whether second-admin approval is on or off by default.

### Evidence

| Source | Content |
|---|---|
| **MG §17-6** | "Second-admin approval for content access: policy exists as a setting; **default undecided**" — recommendation column: "*Default self-serve + audit; make policy-driven*" |
| MG preamble | `[RECOMMENDATION]` = "professional advice; **not required by the frontend; adopt deliberately**" |
| MG §6.4-3 | "Message **content** access for admins is gated: justification category + reason → **(policy)** second-admin approval → read-only watermarked view → audit event with reference number" |
| API §9.11 | `POST /admin/conversations/{id}/access-request` `{ justificationCategory ∈ complaint\|safety\|legal\|audit, reason }` → "grant **per policy** (**optional** second-admin `POST …/access-requests/{id}/approve`)"; `GET …/content` "requires active grant; **every access audit-logged with ref**" |
| **DB §S4** | `communication_access_requests`: `justification_category varchar(40)` (patient_complaint / safety_flag / legal_request / quality_audit) · `reason text NOT NULL` · `status varchar(20)` (pending/approved/denied/expired/terminated) · `approved_by uuid NULL` (**second-admin approval mode**) · `granted_at` · `expires_at` · `access_ref varchar(40) UNIQUE` · "Every grant/view lands in `audit_events`" |
| RM M20.7 | "content view without an active grant → 403; every granted view writes an audit row with a ref" |
| Repository grep | **No platform setting exists to hold this policy.** `SecurityPolicySettings` (`admin-settings.types.ts:249`) has only `twoFactorRequired`, `passwordExpiryDays`, `sessionTimeoutMinutes`, `loginAttemptLimit`, `singleSessionPerUser`. `PrivacyPlatformSettings` (`:286`) has only `productAnalytics`, `errorReporting`, `cookieBanner`, `dpaAccepted`. Neither carries a second-admin toggle, and no other slice does |
| Permissions | `communications.viewMetadata`, `communications.viewContent`, `communications.resolveFlags` are separate capabilities (`types/auth/index.ts`) — metadata and content are already distinct grants |

### Decision

**Accepted — the mechanism, in full.** All of the following are decided and implementable:

1. **Metadata and content are separate capabilities.** `communications.viewMetadata` never exposes message bodies. Content requires `communications.viewContent` **and** an active grant.
2. **A request is required before any content view.** `POST /admin/conversations/{id}/access-request` with `justificationCategory` and a non-empty `reason` (DB §S4 `reason text NOT NULL`).
3. **The justification vocabulary is DB §S4's four values** — `patient_complaint`, `safety_flag`, `legal_request`, `quality_audit` — which are the storage form of API §9.11's `complaint | safety | legal | audit`. The API contract's spelling is preserved on the wire (rule 3: the contract is not changed); the mapping to storage is internal.
4. **Grants expire.** `expires_at` is required; an expired or terminated grant is not an active grant.
5. **Every view is audited with a reference.** `access_ref` is generated per grant, returned to the client, rendered in the watermark, and written to `audit_events` on **every** content read — not once per grant. No code path returns message content without an audit write in the same transaction.
6. **Content is read-only and watermarked.** No edit, no export, no bulk retrieval through this surface.
7. **Access without an active grant returns 403** (RM M20.7).

**Decided by the project owner (2026-08-12): second-admin approval is NOT required in v1. The default is self-serve plus a complete audit trail, and the flow remains policy-driven so the requirement can be switched on later through the platform security/privacy policy.**

This overrides the interim fail-closed position recorded below. The reasoning that produced that interim position is left in place unedited — it is the record of why this needed an owner rather than an engineer, and the owner has now exercised that authority.

The open question was: whether `approved_by` (second-admin approval) is **required by default**.

The evidence permits both, and no source decides it:

- MG §17-6 states the default is **undecided** and offers "self-serve + audit" as a `[RECOMMENDATION]` — which MG's own preamble says is advice to be adopted deliberately, not a requirement.
- API §9.11 says "optional", and DB §S4 makes `approved_by` nullable — both accommodate either setting. Neither prescribes one.
- The platform's stated safety posture points the other way. MG §1.2 lists "guard clinical safety structurally" among the business goals, and the platform fails closed elsewhere on far less sensitive operations: a prescription cannot be sent when the interaction service is merely *unreachable* (API §7.7), and a patient identity reveal requires an atomic audit write (API §4.9). Reading a patient's private messages is a more consequential disclosure than either.

Choosing "self-serve" on the strength of a `[RECOMMENDATION]` would be exactly the silent invention rule 1 forbids, on the decision where being wrong is most costly.

**Implementation, as decided:**

- Build the flow **policy-driven**, as MG §17-6 directs and as the owner requires. Both modes are implemented; neither is hard-coded.
- The policy is read from platform settings through the M3.3 config service (env default layered under a DB value).
- **`requireSecondAdminApproval` defaults to `false`** — self-serve. Every request, grant and view is still audited, and the justification category and reason remain mandatory: the owner removed the second approver, not the accountability.
- Enabling the policy later is a settings change, not a migration. `communication_access_requests.approved_by` stays nullable (DB §S4) precisely so both modes share one schema.
- **The setting does not yet exist in the platform-settings contract.** Adding it changes `AdminSettingsDocument` and API §19.2. That contract addition is scheduled for RM M24.2 — see residual RA-006.2.

*(The superseded interim position — fail closed, `= true` — is preserved in the paragraph above for the record.)*

### Consequences

**API.** §9.11 is implementable now. When the policy requires approval, `POST …/access-request` returns a `pending` request and `GET …/content` returns 403 until `POST …/access-requests/{id}/approve` succeeds. When it does not, the grant is issued immediately. The response shape is identical in both modes — only `status` differs — so the frontend needs no branch.

**Database.** DB §S4 unchanged. `approved_by` stays nullable and carries the approving admin when the policy required one. A partial unique index prevents two active grants for one admin on one conversation.

**Backend services.** The grant check is a guard, not a controller concern. The audit write and the content read are in one transaction — if the audit write fails, no content is returned. A second admin may not approve their own request (self-approval defeats the control); this follows from the two-person purpose and is enforced regardless of which default is chosen.

**Frontend integration.** ADM-06 (`/admin/communications`) is unbuilt (`FRONTEND_CHECKLIST.md` §4). The gate is verified by contract test until RM M39.6.

**Testing.** Both policy modes tested. No-grant → 403. Expired grant → 403. Every granted view writes exactly one audit row carrying the ref. Self-approval rejected. A failed audit write yields no content.

### Alternatives considered

| Alternative | Rejected because |
|---|---|
| Accept "self-serve + audit" as the decision | Rests on a single `[RECOMMENDATION]`, which MG's preamble classifies as non-binding advice. MG §17-6 says the default is undecided — accepting it would overrule the source that raised the question |
| Hard-code second-admin approval as always required | Contradicts API §9.11's "optional" and MG §17-6's instruction to make it policy-driven. Removes a capability the contract exposes |
| Defer the whole ADR until product answers | Blocks RM M5.9 (the `communication_access_requests` table) and RM M20.7 for a decision that is one boolean. The mechanism is fully evidenced; only the default is not |
| Grant content access permanently once approved | DB §S4 has `expires_at` and a `terminated` status — a standing grant contradicts both |

### Residual ambiguity

**RA-006.1 — ~~The default value itself~~ — CLOSED 2026-08-12.** Project owner: self-serve + audit, policy-driven.

**RA-006.2 — No platform setting exists to hold the policy.** A field must be added to a settings slice (`security` is the natural home) plus `AdminSettingsDocument` and API §19.2. This is a contract change and is therefore **not made here**. Carried to RM M24.2.

**RA-006.3 — Grant TTL is unspecified.** DB §S4 has `expires_at` but no source gives a duration. Note the precedent: the frontend's PHI identity-reveal grant lapses after 15 minutes (`features/admin/phi/`, ADM-10). Whether the same window suits message content is a product question. Not decided.

---

## ADR-007 — Data Retention Defaults

**Status:** **Accepted** — four periods are established by the platform-settings seed; the remaining five were supplied by the project owner on 2026-08-12 and are recorded below. **Amended 2026-11-07:** the idle-lock row follows the role-specific limits of OD-005, and PD-5 records the enforced OTP lifetime (C-11). No other period changes.

### Context

RM M28.5 requires a retention job that drops out-of-window audit partitions, and RM M38.2 requires backup automation driven by platform settings. Retention in a healthcare system is a legal question before it is a technical one, so inventing a period is worse than admitting one is missing. MG §17-7 directs: "Take from platform settings seed; confirm with compliance."

### Evidence

The coded retention slice and its seeded defaults:

| Source | Content |
|---|---|
| `frontend/src/features/admin/admin-settings.types.ts:279` | `RetentionSettings { patientRecordYears: number; auditLogDays: number; messageDays: number; autoPurge: boolean }` — **exactly four fields** |
| `frontend/src/features/admin/admin-settings.api.ts` `DEFAULT_ADMIN_SETTINGS.retention` | `patientRecordYears: 10` · `auditLogDays: 365` · `messageDays: 180` · `autoPurge: false` |
| `admin-settings.api.ts` `DEFAULT_ADMIN_SETTINGS.backup` | `autoBackup: true` · `frequency: 'daily'` · `retainCount: 5` |
| `admin-settings.types.ts:273` | `BackupSettings { autoBackup, frequency: 'daily'\|'weekly'\|'monthly', retainCount }` |
| `admin-settings.types.ts:249` | `SecurityPolicySettings { twoFactorRequired: false, passwordExpiryDays: 180, sessionTimeoutMinutes: 30, loginAttemptLimit: 5, singleSessionPerUser: false }` (seeded values) |
| DB §10 | PHI: "retention `patientRecordYears`"; audit-sensitive: "retention `auditLogDays`" |
| DB §7 | `audit_events` — "immutable, INSERT-only … retention per `auditLogDays`" |
| API §1.1 | Verification token TTL — **24 h** |
| API §1.2 | Refresh cookie TTL — rememberMe **30 d**, otherwise **12 h**, sliding |
| `features/auth/mock/session-store.ts:13-14` | `REMEMBER_MS = 30 d`, `SESSION_MS = 12 h` — agrees with the contract |
| MG §17-7 | "Take from platform settings seed; **confirm with compliance**" |
| MG §14 | "RPO ≤ 24 h, RTO ≤ 4 h initial targets" |
| RM M28.5 | "retention job drops only out-of-window partitions (clock-controlled test)" |
| DB §14.5-13 | "Session policy split: mock session TTL 12 h/30 d + 10-min idle lock in `configs/session.ts`, while Phase 18 `sessionTimeoutMinutes` default differs — **make the platform_settings security slice the single source**, as the session.ts comment already intends" |

### Decision

#### Established — adopt the seeded platform-settings values as defaults

| Category | Default | Setting key | Source |
|---|---|---|---|
| **Clinical records** (PHI) | **10 years** | `retention.patientRecordYears` | Seed + DB §10 |
| **Audit events** | **365 days** | `retention.auditLogDays` | Seed + DB §7/§10 |
| **Messages** | **180 days** | `retention.messageDays` | Seed |
| **Auto-purge** | **disabled** | `retention.autoPurge` | Seed |
| **Backups** | keep **5**, **daily**, auto on | `backup.retainCount`, `backup.frequency`, `backup.autoBackup` | Seed |

Every one of these is **runtime-configurable**, never a constant in code. The M3.3 config service layers the DB value over an env default carrying the seeded number.

**Three rules that bind regardless of the numbers:**

**R1 — `autoPurge: false` means retention expiry does not delete anything by default.** The seed disables it. The retention job computes and reports what is out of window; it deletes only when an administrator has enabled auto-purge. This matters most for `patientRecordYears`: MG §7.5, DB §7 and UX §1.5.3 all state medical records are never hard-deleted, and RM M12.6 requires the application DB role to hold no DELETE grant on `medical_records`. **Retention expiry on clinical records therefore means archival/soft-delete, not deletion** — a purge that contradicts the immutability guarantee is not implemented.

**R2 — Audit retention is executed by dropping whole monthly partitions**, never by row deletion. `audit_events` is INSERT-only and the app role has no DELETE grant (DB §7/§9). RM M28.5 verifies that only out-of-window partitions are dropped.

**R3 — Message retention obeys the no-delete rule for patient threads.** DB §7 records "delete forbidden in patient threads; archive only", and API §9.5 returns **405** on a delete attempt. `messageDays` therefore governs archival and search visibility, not destruction.

#### Established from other sources — session and token lifetimes

These are not part of the retention slice but are retention questions and are established:

| Item | Value | Source |
|---|---|---|
| Refresh token (rememberMe) | 30 days, sliding | API §1.2, `session-store.ts:13` |
| Refresh token (default) | 12 hours, sliding | API §1.2, `session-store.ts:14` |
| Access token | ≤ 15 minutes | MG §11.1, API §1.2 (`expiresIn: 900`) |
| Email-verification token | 24 hours, single use | API §1.1 |
| Idle lock | Role-specific, backend-enforced (OD-005): **admin 30 · doctor 45 · reception 45 · laboratory 45 · pharmacy 45 · patient 90** minutes. Polling, automated requests and heartbeats never extend a session. **Decided, not yet enforced** | OD-005 (FINAL 2026-11-05); supersedes the single seeded `security.sessionTimeoutMinutes` = 30 as the policy value |
| Password expiry | `security.passwordExpiryDays` = **180** (seeded) | Seed |

**Contradiction resolved.** `frontend/src/configs/session.ts` sets `idleLockMs` to 10 minutes while the platform-settings seed sets `sessionTimeoutMinutes` to 30. DB §14.5-13 resolves it explicitly: **the platform_settings security slice is the single source**, and the file's own comment agrees ("admin-configurable server-side; these are the client defaults **used until the session payload overrides them**"). The 10-minute value is a pre-server fallback, not a competing policy. The client uses what the server sends.

**Amended 2026-11-07 (OD-005).** What the server sends is no longer one value. The owner fixed role-specific inactivity limits — admin 30; doctor, reception, laboratory and pharmacy 45; patient 90 minutes — and made them **backend-enforced**: an expired idle window is refused by the server, not merely locked by the client. Only user-initiated requests count as activity; polling, automated requests and heartbeats never extend a session. The precedence rule above is unchanged (server is the single source, client defaults are fallbacks). Not yet implemented: the session payload does not carry a per-role limit, the server does not enforce inactivity, and how the existing `security.sessionTimeoutMinutes` field relates to the per-role limits is not decided here — it is an implementation question for the task that enforces OD-005, not a policy this ADR sets.

#### Supplied by the project owner (2026-08-12)

No project document establishes these five, so they were not inferred. The owner chose to align each with the retention knob governing the data it relates to, rather than introduce five independent periods:

| # | Category | Period | Rationale as decided |
|---|---|---|---|
| **PD-1** | **Files / attachments** | **`patientRecordYears`** (10 y default) | An attachment's sensitivity is that of the record it hangs off, so it inherits that record's window rather than expiring independently. A lab report outliving or predeceasing its record would be incoherent |
| **PD-2** | **Notifications** | **`messageDays`** (180 d default) | Notifications are transient communication, not a clinical record. The underlying entity (record, order, prescription) is retained on its own schedule; the notification pointing at it is not |
| **PD-3** | **Login events** | **`auditLogDays`** (365 d default) | DB §10 already classes `login_events` as audit-sensitive. Sharing the audit window makes a security investigation reach as far back through authentication history as through the audit ledger |
| **PD-4** | **Sessions** | **90 days after expiry or revocation** | Long enough to investigate a reported compromise, short enough that dormant refresh-token families do not accumulate. Requires a new setting |
| **PD-5** | **OTP codes** | **10-minute TTL, purged on use** | A step-up code has no value past its verification window, and a spent code retained is a credential retained. Requires a new setting. **2026-11-07 (C-11):** the 10 minutes are absolute from issue — a resend replaces the code but does not extend the challenge |

**Rules that follow:**

- **PD-1 through PD-3 introduce no new settings fields.** They bind to `retention.patientRecordYears`, `retention.messageDays` and `retention.auditLogDays` respectively, so an administrator changing one of those three changes the bound category with it. This is deliberate — three knobs governing eight categories is comprehensible; eight knobs are not.
- **PD-4 and PD-5 need two new fields** (`retention.sessionDays`, `security.otpTtlMinutes`). That is an addition to `AdminSettingsDocument` and API §19.2, scheduled for **RM M24.2**. Until it lands, both use the values above as env defaults through the M3.3 config service. *(2026-11-07: until `security.otpTtlMinutes` lands, PD-5's lifetime is the code constant `OTP_CHALLENGE_TTL_SECONDS = 10 * 60`, not an env value.)*
- **R1 still governs all five.** `autoPurge` defaults to `false`, so retention expiry computes and reports rather than deletes until an administrator enables it.
- **PD-1 inherits R1's archival semantics.** A file bound to a medical record cannot be hard-deleted while the record cannot be (DB §7, RM M12.6); expiry means archival, not destruction.

#### Superseded — the analysis that preceded the owner's decision

| # | Category | Why it is open |
|---|---|---|
| **PD-1** | **Files / attachments** | The `files` table (DB §11) has `deleted_at` and RM M25.5 has an orphan-cleanup job, but **no retention period exists in any settings slice**. Whether an attachment follows `patientRecordYears`, follows its parent, or has its own window is unstated |
| **PD-2** | **Notifications** | DB §7 gives notifications an archive flag and no retention row. `RetentionSettings` has no notification field. A feed that grows without bound is an operational problem, but no source names a window |
| **PD-3** | **Login events** | DB §10 classes `login_events` as audit-sensitive, but retention there is stated only "per `auditLogDays`" for `audit_events`. Whether `login_events` shares that 365-day window or has its own is unstated. They are different tables with different volumes |
| **PD-4** | **Sessions** | Revoked and expired `sessions` rows are a security-forensics record. No source says how long they are kept after expiry |
| **PD-5** | **OTP codes** | `otp_codes` has an index on `(user_id, expires_at)` (DB §8) but **no TTL is stated anywhere** — unlike the verification token's documented 24 h. The bounded-attempts rule (API §1.3) implies a short window; no number is given |

*(The table above records why each of the five had no answer in the documents. The owner has now supplied one for each; the analysis is retained because it shows the gap was real rather than an oversight.)*

### Consequences

**API.** `PATCH /platform-settings/retention` (API §19.2) is a **risky slice requiring `confirm: true`** plus audited consequence text. `GET /audit-events` returns the retention window in its response meta (API §14.1).

**Database.** `audit_events` monthly partitions with BRIN (DB §8) — the partition scheme is what makes R2 possible. No DELETE grant on `medical_records`, patient-thread `messages`, or `audit_events` (DB §9).

**Backend services.** One retention job per category in the RM M30.2 scheduled-job registry, each reading its window from the config service at run time. The job logs what it would purge when `autoPurge` is false. Categories PD-1…PD-3 bind to the three existing knobs; PD-4 and PD-5 use the env defaults above until `retention.sessionDays` and `security.otpTtlMinutes` land at RM M24.2.

**Frontend integration.** The retention panel already exists and edits all four fields. No change.

**Testing.** RM M28.5's clock-controlled test proves only out-of-window partitions drop. A test proves `autoPurge: false` deletes nothing. A test proves the app role cannot DELETE from `medical_records` or `audit_events`.

### Alternatives considered

| Alternative | Rejected because |
|---|---|
| Adopt common healthcare defaults (7 years, HIPAA 6 years) for the missing five | Rule 1 — silent invention. Retention is a legal commitment; a plausible-looking number in a compliance document is worse than an acknowledged gap |
| Treat retention as fixed constants | The whole retention slice is administrable (API §19.2). Constants would make the panel non-functional |
| Purge clinical records at `patientRecordYears` | Contradicts the never-hard-deleted rule (DB §7, UX §1.5.3, RM M12.6) and the absent DELETE grant |
| Apply `auditLogDays` to every audit-adjacent table | Would silently assign a 365-day window to `login_events`, `communication_access_requests` and `message_flags`, none of which any source assigns it to |

---

## ADR-008 — Repository Layout and Specification Location

**Status:** Accepted · **Milestone:** M0.3

### Context

The roadmap's M1.1 says "Scaffold `medora-backend`", phrasing that reads as a separate repository. The project is a monorepo whose root README already promises sibling directories. Where the backend lives, and where its specifications live, determines every relative path in every document that follows — including this one. `DATABASE_SCHEMA_EXTRACTION.md` is a database document sitting inside `frontend/`, which is either a filing error to correct or a link dependency to leave alone.

### Evidence

| Source | Content |
|---|---|
| Root `README.md` (pre-existing, before any backend work) | "A backend and database will land as **sibling directories**. Their design is specified but not yet implemented." |
| `git ls-files` | 569 tracked files, all under `frontend/`, `.github/`, or the root. One workspace |
| `.github/workflows/ci.yml` | `defaults.run.working-directory: frontend` — a single frontend-scoped job |
| `frontend/DATABASE_SCHEMA_EXTRACTION.md` | 130 KB; linked from `frontend/FRONTEND_CHECKLIST.md`, the frontend README section, and cited throughout the backend specs |
| RM M0.3 | "Record the layout decision (backend lives at `backend/`, its specs at `backend/docs/`), commit the three backend specs there, and decide whether `DATABASE_SCHEMA_EXTRACTION.md` moves out of `frontend/`… **default is *leave it and reference it***" |

### Decision

1. **The backend service lives at `backend/`**, a sibling of `frontend/` — as the root README already promised. Not a separate repository.
2. **Backend specifications live at `backend/docs/`**: master guide, API contract, implementation roadmap, repository audit.
3. **Backend *working* documents live at `docs/`** at the repository root: this decision register and the M0.1 analysis. The distinction is deliberate — `backend/docs/` holds specifications that describe the system, `docs/` holds the records produced while building it. The roadmap's own references (`docs/DECISIONS.md`, `docs/CACHING.md`) already assume this location.
4. **`DATABASE_SCHEMA_EXTRACTION.md` stays at `frontend/`.** Moving it breaks live links in at least three frontend documents for no functional gain. Every backend document references it by relative path (`../../frontend/DATABASE_SCHEMA_EXTRACTION.md` from `backend/docs/`). Filing tidiness does not justify breaking working links.
5. **CI is split by path** — a backend job alongside the existing frontend job, each filtered to its own tree (RM M1.7). Neither runs on the other's commits.

### Consequences

**API.** None.

**Database.** None.

**Backend services.** `backend/` is the package root: `npm --prefix backend`. `backend/src/modules/**` per RM M2.1. Relative doc references from `backend/docs/` reach the frontend tree with `../../frontend/`.

**Frontend integration.** No frontend file moves or changes. Existing links keep working.

**Testing.** The backend CI job must be proven to run on a backend-only commit and to be skipped on a frontend-only one (RM M1.7 verify).

### Alternatives considered

| Alternative | Rejected because |
|---|---|
| A separate `medora-backend` repository | The root README commits to sibling directories, and a split repo makes the contract-conformance CI check (RM M33.2) cross-repo, which is materially harder |
| Move `DATABASE_SCHEMA_EXTRACTION.md` to `backend/docs/` | Breaks live links in three frontend documents. RM M0.3 names "leave it and reference it" as the default |
| Put working documents in `backend/docs/` too | The roadmap already writes `docs/DECISIONS.md` and `docs/CACHING.md` unqualified; honouring that keeps its instructions literal |

---

## ADR-009 — Appendix A Seam Map Correction

**Status:** Accepted · **Milestone:** M0.4

### Context

Appendix A of the API contract is the integration checklist: fifteen frontend swap points mapped to the contract modules that replace them. M0.1 verified it line by line and found two entries pointing at paths that no longer exist, plus three shipped seams with no entry at all. An integration checklist that names files which are not there will misdirect the module-by-module swap in RM M40.1.

### Evidence

| Source | Content |
|---|---|
| M0.1 verification (`docs/M0_REPOSITORY_ANALYSIS.md` §2.1) | 13 of 15 Appendix A paths resolve; 2 fail |
| Filesystem | `features/doctor/administration/` **does not exist**. `features/admin/administration.queries.ts` and `features/admin/admin-settings.queries.ts` **do** |
| `frontend/FRONTEND_CHECKLIST.md` D-28 | "The admin-only area lives at `routes.doctor.administration` under `features/doctor/administration/`. Nothing about it is the doctor's. **Rename to `features/admin/` + `/admin/*`**" — the rename is a completed, deliberate frontend decision |
| M0.1 §2.2 | Three shipped seams absent from Appendix A: `features/admin/appointments/oversight.queries.ts` (ADM-05 → API §5.10), `features/admin/phi/` + `administration.api.ts → phiAccess` (ADM-10 → API §4.9, §14), `features/admin/sections/settings/PermissionMatrixPanel.tsx` (ADM-09 → API §15.2–15.3) |
| RM M0.4 | "Re-verify all fifteen paths and **patch Appendix A in the same commit**" |

### Decision

**Appendix A is corrected in `backend/docs/BACKEND_API_CONTRACT.md`.** This is a documentation correction explicitly mandated by the milestone — not a silent contract change. No endpoint, field, status code, or shape is altered; only the frontend paths the table points at.

Two edits:

1. **Two stale paths repointed** — `features/doctor/administration/administration.queries.ts` → `features/admin/administration.queries.ts`, and `features/doctor/administration/admin-settings.queries.ts` → `features/admin/admin-settings.queries.ts`.
2. **Three rows added** for the seams that shipped after the contract was written (ADM-05, ADM-09, ADM-10). These are live consumers with behaviour the server must match, so leaving them off the integration checklist would drop them from the RM M40.1 swap.

Verification is a re-run of the line-by-line loop over the amended table; M0.4 is not complete until every path resolves.

### Consequences

**API.** No behavioural change. The integration checklist becomes accurate.

**Database.** None.

**Backend services.** The three added rows name obligations already accepted elsewhere: the nudge cooldown and per-party delivery receipts of ADM-05 (RM M11.6), the masking output and grant lifetime of ADM-10 (RM M7.3), the matrix merge dialog of ADM-09 (RM M7.4).

**Frontend integration.** RM M40.1 swaps against paths that exist.

**Testing.** The path-resolution loop is cheap enough to run as a CI docs check; not required by any milestone, so noted rather than adopted.

### Alternatives considered

| Alternative | Rejected because |
|---|---|
| Leave Appendix A stale and note the drift elsewhere | RM M0.4 explicitly requires patching it, and a checklist pointing at absent files is actively misleading |
| Repoint the two paths but do not add the three rows | The three seams are live consumers; omitting them from the integration checklist is how a shipped surface gets forgotten at M40 |
| Rename the frontend folders back to match the contract | Rule 2 forbids changing the frontend, and D-28 records the rename as a deliberate improvement |

---

## ADR-010 — Scope of the DB §13 Inferred Tables

**Status:** Accepted · **Milestone:** M0.5

### Context

`DATABASE_SCHEMA_EXTRACTION.md` §13 lists 17 recommended table groups, flagged "**Inferred Recommendation** (never mix with confirmed)". The roadmap's M5 silently includes some and never mentions the rest, yet several are hard prerequisites of milestones already planned. Each needs an explicit in/out decision with a reason.

**Decision rule applied, so this is not a matter of taste:** a group is **IN** when a contract endpoint or an accepted roadmap milestone cannot function without it. It is **OUT** when no contract endpoint consumes it and no milestone depends on it. "Out" means *not in v1*, never *rejected forever* — each carries the trigger that would bring it back.

### Evidence and decision — all 17

| # | Group | Decision | Reason |
|---|---|---|---|
| 1 | `patient_doctor_assignments` | **IN** | The care-scoping anchor. RM M7.2 (`PatientScopeService`) and M37.3 (RLS) are both unimplementable without it. API §0.4 makes every clinical route care-scoped. Already in RM M5.6 |
| 2 | `patient_access_grants` | **IN** | API §4.11 exposes "access-grant list/revoke/approve" on admin patient governance. The endpoint exists; the table backs it |
| 3 | `countries` / `cities` | **OUT** | No contract endpoint. Addresses are optional free-text strings in the `Patient` DTO. *Trigger:* address validation or geographic reporting becomes a requirement |
| 4 | `specialties` (+ `doctor_specialties`) | **IN** | API §3.4 filters doctors by `specialty`; API §5.10 requires reassignment to a **same-specialty** doctor, which free text cannot enforce. Already named in RM M5.1 |
| 5 | `insurance_providers` | **IN** | Already named in RM M5.1; `patient_insurance` (DB §B7) references a provider master |
| 6 | `invoices` / `invoice_lines` / `payments` | **OUT** | `featureFlags.billing = false`; RM M17/M18 are explicit deferral milestones. *Trigger:* billing turns on |
| 7 | `notification_deliveries` | **IN** | RM M19.5 requires per-channel delivery tracking, and ADM-05 already ships a `NotificationDelivery` type (`oversight.types.ts:53`) rendering per-party receipts. The UI exists |
| 8 | `drug_interactions` | **IN** | RM M13.2's severity-graded screen. Without it the safety check degrades to one canned string per drug. Already in RM M5.5 |
| 9 | `medication_monographs` | **IN** | API §7.2 has no other data source. Already in RM M5.5 |
| 10 | `radiology_orders` / `radiology_reports` / `dicom_studies` | **OUT** | MG §17-9 records imaging as future scope; `patient_studies` (DB entity 26) carries the placeholders the UI shows today. *Trigger:* a radiology module is commissioned |
| 11 | `immunizations` | **OUT** | Already representable: `HistoryEventKind` includes `vaccination` (`profile-types.ts:86`), and API §4.5 serves history events. A separate table would duplicate a working path. *Trigger:* immunization scheduling or registry reporting |
| 12 | `consents` | **OUT** | Two existing mechanisms cover current scope: registration consent is timestamped on the user (API §1.1 "consent timestamps"), and consent *documents* are files with `document_category = 'consent'` (API §4.7). *Trigger:* a consent register with revocation is required |
| 13 | `saved_views` | **OUT** | **Contract gap, not a product gap.** MG §5.4 lists P7 saved views as a UX pattern and MG §7.3 says the patients list has them, but **no contract endpoint exists** to read or write one. Building a table with no endpoint is speculative. Recorded as a contract gap — see residual |
| 14 | `incident_bookmarks` | **IN** | API §14.4 (`GET/POST/DELETE /me/incident-bookmarks`) and RM M28.4. The endpoint exists |
| 15 | `report_exports` | **IN** | API §12.5 async export → file → notification; RM M21.5 needs an addressable artefact row |
| 16 | `clinics` / `facilities` | **OUT** | MG §17-10: "single-clinic now; **keep clinic FK out of v1**, add via migration when needed" — an explicit documented deferral |
| 17 | `message_templates` / `snippets` | **OUT** | Admin document templates are `document_templates` (DB entity 81, **confirmed** not inferred, API §18.13). Composer snippets (MG §7.8) have no contract endpoint. *Trigger:* the contract adds one |

**IN — 9 groups:** 1, 2, 4, 5, 7, 8, 9, 14, 15.
**OUT — 8 groups:** 3, 6, 10, 11, 12, 13, 16, 17.

**No product decision was invented.** Every row is decided on whether a contract endpoint or an accepted milestone consumes it. Where the evidence is a documented deferral (6, 16) it is quoted. The one case where the decision rule and the documentation disagree — #13 — is recorded as an unresolved contract gap rather than resolved by preference.

### Consequences

**API.** None. No endpoint is added or removed.

**Database.** RM M5.11 builds the IN groups that no other M5 step creates: `patient_access_grants`, `incident_bookmarks`, `report_exports`, `notification_deliveries`. Groups 1, 4, 5, 8, 9 are already scheduled in M5.1/M5.5/M5.6. The OUT groups are absent from the schema, and their absence is now intentional and recorded.

**Backend services.** `PatientScopeService` (M7.2) has its anchor. The same-specialty reassignment rule (M11.6) becomes enforceable.

**Frontend integration.** Nothing changes now. The `saved_views` gap means P7 saved views cannot be server-backed at M40 — the frontend keeps whatever local behaviour it has.

**Testing.** RM M5.11's verify step becomes checkable in both directions: every IN group exists, every OUT group is absent.

### Alternatives considered

| Alternative | Rejected because |
|---|---|
| Build all 17 | Eight have no consumer. Tables without endpoints become schema debt that constrains migrations without ever being read |
| Build only the six the roadmap already names as prerequisites | Misses `patient_access_grants`, `specialties`, `insurance_providers` — all with live contract endpoints or explicit roadmap references |
| Defer the whole question to M5 | M5.1's lookup migration already needs `specialties` and `insurance_providers`; deciding at M5 means deciding mid-migration |

### Residual ambiguity

**RA-010.1 — `saved_views` has a documented UX pattern and no contract endpoint.** MG §5.4 (P7) and MG §7.3 describe saved views on P1 list pages; the API contract has none. Either the contract is incomplete or the pattern is not in v1 scope. **Not resolved here** — resolving it means either adding endpoints to the contract (forbidden by rule 3) or declaring a documented UX pattern out of scope (a product call). Carried to RM M33.2, whose contract-coverage diff is where a gap like this should surface.

---

## ADR-011 — API Base Path and Refresh-Cookie Scope

**Status:** Accepted · **Milestone:** M0.6-1

### Context

The API contract specifies base `/api/v1` and scopes the refresh cookie `Path=/api/v1/auth`. The frontend's env default is `http://localhost:3000/api` with no version segment. If both ship as written, the cookie's path never matches the request path, the browser never sends it, and silent refresh — the mechanism the entire session model rests on — cannot work.

### Evidence

| Source | Content |
|---|---|
| API §0.1 | "Base: `{VITE_API_BASE_URL}` → recommend `https://<host>/api/v1`"; "Server sets the refresh cookie: `medora_rt`; `httpOnly; Secure; SameSite=Strict; **Path=/api/v1/auth**`" |
| `frontend/.env.example` | `VITE_API_BASE_URL=http://localhost:3000/api` |
| `frontend/src/configs/env.ts:11` | `.default('http://localhost:3000/api')` |
| MG §8.5 | "Prefix `/api/v1` [RECOMMENDATION]. The frontend base URL is configurable (`VITE_API_BASE_URL`), so `http://localhost:3000/api/v1` is **a config change**" |
| MG §11.1 | Cookie `Path=/api/v1/auth` |
| MG §14 | Development API on `:3000` "to match the frontend default" |
| **`frontend/src/api/client.test.ts:12,55-61`** | `const BASE = 'https://api.test/v1'`; test *"resolves paths against the base URL **without dropping the base path segment**"* asserts `https://api.test/v1/patients`. **A versioned base path is already supported and regression-tested** |
| `frontend/src/api/client.ts:71` | `new URL(path.replace(/^\//, ''), \`${this.baseUrl.replace(/\/?$/, '/')}\`)` — the trailing-slash normalisation is what makes the above test pass |

### Decision

**The API is served at `/api/v1`. The refresh cookie keeps `Path=/api/v1/auth`. The frontend's default env value changes to match.**

1. `VITE_API_BASE_URL` default becomes `http://localhost:3000/api/v1`, in `.env.example` and the `configs/env.ts` Zod default.
2. **Owner: frontend.** It is a one-value change in two files.
3. **No `ApiClient` code change is required.** The client already preserves base path segments and has a test pinning it. This was the decisive evidence — had the client dropped the segment, the decision would have gone the other way.
4. The backend serves every route under `/api/v1`, including `/api/v1/health` (RM M1.4, already written that way).
5. Cookie attributes are unchanged from API §0.1: `httpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`.

**Why the contract wins over the env default:** the API contract is rank 2 and states the path twice, in the base URL and in the cookie scope. The env default is a development convenience with no dependent behaviour. Moving the cookie to `Path=/api` instead would widen its scope — the narrow path is a deliberate control that stops the refresh token being attached to every clinical request.

### Consequences

**API.** All routes under `/api/v1`. No shape change.

**Database.** None.

**Backend services.** A global prefix in the Nest bootstrap. Cookie options centralised in the auth module so `Path` is written once.

**Frontend integration.** Two-line change, recorded for RM M39.2. Verification is a real browser round-trip showing the cookie attached to `POST /api/v1/auth/refresh` — a unit test cannot prove cookie-path matching.

**Testing.** `client.test.ts:55` already guards the client side and must keep passing. Backend side: a supertest assertion that `Set-Cookie` carries the exact `Path`.

### Alternatives considered

| Alternative | Rejected because |
|---|---|
| Serve at `/api`, drop `/v1` | Contradicts API §0.1 and MG §8.5; discards versioning the mobile client depends on (MG §15.5, where clients cannot be force-refreshed) |
| Keep `/api/v1` but widen the cookie to `Path=/api` | Sends the refresh token on every clinical request. The narrow path is a security control, not an accident |
| Make the backend accept both `/api` and `/api/v1` | Two live base paths and a cookie that matches one of them — the ambiguity survives instead of being resolved |

---

## ADR-012 — Machine Error `code` Propagation

**Status:** Accepted · **Milestone:** M0.6-2

### Context

The most severe defect found in M0.1. The API contract and the master guide both require a machine `code` on error responses, and the auth pages branch on it — but the transport layer has no field to carry it. The codes reach the pages today only because the *mock* throws a bespoke error class. When mocks are switched off, every 401 collapses to `{ kind: 'auth' }`, which the client interprets as token expiry and turns into a logout. **A user typing a wrong password would be logged out instead of being told the password was wrong.**

### Evidence

| Source | Content |
|---|---|
| API §0.3 | Error body: `{ "message", "code": "machine_code", "fieldErrors", "detail", "ref" }` |
| API §1 | "**Error codes** used by this module (frontend branches on them): `invalid_credentials`, `email_unverified`, `otp_required`, `otp_invalid`, `email_taken`, `token_invalid`, `weak_password`, `rate_limited`" |
| MG §10.4 | "Add a machine `code` field (e.g. the auth error codes §7.1) — **additive and needed by the auth pages**" |
| `frontend/src/api/errors.ts` | `interface ErrorBody { message?; fieldErrors?; detail?; ref? }` — **no `code`**. `normalizeHttpError` never reads one |
| `frontend/src/types/api/index.ts` | The `ApiError` union has eight members; **none carries a `code`** |
| `frontend/src/features/auth/mock/types.ts` | `MockAuthError` carries `.code` typed as the eight-value `MockAuthErrorCode`. Its own comment: "When a real API arrives, **this file and the service are what get replaced**" |
| `frontend/src/features/auth/pages/LoginPage.tsx:46-56` | `if (isMockAuthError(error))` then branches on `error.code` for `email_unverified`, `otp_required`, `invalid_credentials` |
| `frontend/src/app/providers/AuthProvider.tsx:97-98` | Same pattern — `error instanceof MockAuthError && (error.code === 'otp_required' \|\| error.code === 'email_unverified')` |

### Decision

**The backend always sends `code`. The frontend must carry it through the transport layer. Both halves are required; neither alone fixes the defect.**

**Backend (RM M1.2, M6.2) — decided and in scope:**

1. The exception filter emits `code` on **every** error response it can name, and unconditionally on all eight auth codes.
2. Code values are exactly the strings in `MockAuthErrorCode` — that union is the contract, and the mock file states it is what gets replaced.
3. `code` is a stable machine identifier: `snake_case`, never localised, never reworded once shipped. `message` is the human string and may change freely.

**Frontend (RM M39.1) — recorded, not performed here:**

4. Add `code?: string` to `ErrorBody` in `errors.ts`.
5. Add `code?: string` to the relevant `ApiError` union members — at minimum `auth`, `validation`, `conflict`. **This is an additive optional field**, so no existing consumer breaks (MG §8.5).
6. Carry `code` through `normalizeHttpError`.
7. Retire `MockAuthError` in favour of the normalised error, so `LoginPage` and `AuthProvider` branch on one shape.

**This is not an API contract change.** API §0.3 already specifies `code`; the contract is correct and the frontend type is behind it. Recording it here satisfies M0.6's requirement that each contradiction gets a decided owner.

**Sequencing matters more than usual.** RM M6's exit gate is the frontend completing login → refresh → logout against the real API. That gate cannot pass until items 4–7 land. Either M39.1 is pulled forward ahead of M6's gate, or M6's gate is verified by contract test and re-verified at M40. **Recommended: pull M39.1 forward** — it is a small, isolated, additive change, and leaving it until M40 means every auth milestone in between is verified against a transport that cannot express its own error vocabulary.

### Consequences

**API.** No contract change. The backend implements what §0.3 already specifies.

**Database.** None.

**Backend services.** One error-code enum in `shared/`, mirroring `MockAuthErrorCode`. The exception filter is the only writer. A test asserts every thrown domain error maps to a code.

**Frontend integration.** Four small edits, all additive. Until they land, no page can distinguish a wrong password from an expired session.

**Testing.** RM M1.2's verify step is extended: the envelope test must assert a populated `code` on every auth error, not just the correct status. A regression test proves a 401 `invalid_credentials` does not trigger logout — which also depends on ADR-013.

### Alternatives considered

| Alternative | Rejected because |
|---|---|
| Backend-only: send `code`, leave the frontend alone | The field would be dropped by `normalizeHttpError` and never reach a component. The defect survives untouched |
| Keep `MockAuthError` and have the real client throw it | Ties production error handling to a class whose own comment says it is mock-only and gets replaced |
| Branch on `message` text | Message strings are human-facing and localisable. Branching on them breaks on the first copy edit or translation |
| Give each auth failure a distinct HTTP status | Contradicts API §1.2, which requires identical shape and timing for `invalid_credentials` as an anti-enumeration control |

---

## ADR-013 — 401 Semantics and the Refresh Trigger

**Status:** Accepted · **Milestone:** M0.6-3

### Context

`ApiClient` treats every 401 as "refresh once and replay". The API contract returns 401 `invalid_credentials` for a wrong password. The master guide says 401 is for token problems **only**. Two project documents disagree, and the client implements the permissive reading — so a failed login would trigger a spurious refresh round-trip and, combined with the ADR-012 defect, a logout.

### Evidence

| Source | Content |
|---|---|
| API §0.3 | 401 → client kind `auth` — "token only — triggers single-flight refresh then logout" |
| API §1.2 | Login: "unknown email or bad password → **401 `invalid_credentials`**" |
| MG §10.3 | "401 (triggers client refresh flow — **use only for token problems**)" |
| MG §10.4 | 401 → `auth`, "nothing (never rendered; drives refresh/logout)" |
| `frontend/src/api/client.ts:110` | `if (response.status === 401 && this.onUnauthorized && !isRetry)` — **no discrimination by route or by whether a token was sent** |
| **Repository grep** | `setUnauthorizedHandler` is called **only in `client.test.ts`** (lines 135, 146, 164). **No application code registers a handler.** The interceptor is dormant in the running app |
| `client.test.ts:119` | "throws an auth error on 401 when no refresh handler is registered" — the current app behaviour, pinned |
| `client.test.ts:125,142,152` | Refresh-once-and-replay, no-second-retry, and single-flight are all pinned tests |
| RM M40.2 | "Wire `setUnauthorizedHandler` single-flight refresh into `ApiClient`" — the handler gets registered at M40, **not before** |

### Decision

**The contract's 401 stands. The frontend narrows what triggers a refresh.**

1. **`POST /auth/login` returns 401 `invalid_credentials`**, exactly as API §1.2 specifies. The contract is rank 2 and the master guide rank 4; where they conflict, the contract governs. This also preserves the anti-enumeration property — identical status, shape and timing for unknown email and wrong password.

2. **The refresh interceptor fires only when the failed request carried an access token.** A 401 on a request that never sent an `Authorization` header cannot be a token-expiry problem, so there is nothing to refresh. This is the primary discriminator: it is general, needs no list of paths, and is exactly the condition MG §10.3 means by "token problems".

3. **Requests to `/auth/*` are additionally excluded**, as a second line of defence. This mirrors the refresh cookie's own scoping (`Path=/api/v1/auth`, ADR-011) — auth routes are already a distinguished group in the transport design.

4. **Owner: frontend** (RM M39.4). No backend change and no contract change.

5. **The existing tests stay green.** All four pinned 401 behaviours involve `GET /patients…` with a token set — none of them exercises a tokenless auth route, so the new condition does not alter any tested path. Two tests are added: a tokenless 401 must not call the refresh handler, and a 401 from `/auth/login` must surface with its `code` (ADR-012) rather than refreshing.

**A note on current risk.** Because no application code registers the handler, this defect is *latent* rather than live today: 401s currently surface as plain auth errors. It becomes live the moment RM M40.2 wires the handler. Fixing it before that point costs nothing; fixing it after means debugging a logout loop on the login page.

### Consequences

**API.** No change. 401 `invalid_credentials` as specified.

**Database.** None.

**Backend services.** 401 is reserved for authentication failures and token problems. Authorization failures are 403; validation is 422. A 401 without a `code` should never be emitted.

**Frontend integration.** One condition in `client.ts` plus the handler registration at M40.2. With ADR-012 in place, a wrong password shows an inline error and issues exactly one request.

**Testing.** Two added client tests as above. End-to-end at RM M40: expired token refreshes once and replays; wrong password does not refresh.

### Alternatives considered

| Alternative | Rejected because |
|---|---|
| Return 422 for `invalid_credentials` instead | Changes the API contract (rule 3) and would put credential failures in the `validation` kind, whose contract requires `fieldErrors` — implying which field was wrong, defeating anti-enumeration |
| Add a dedicated header, e.g. `X-Token-Expired`, to mark refreshable 401s | Invents transport not in the contract, when a condition already available on the client answers the question |
| Exclude `/auth/*` by path only | Works for the known case but misses any future tokenless endpoint. The token-presence rule is the general form |
| Leave it — the handler is unregistered anyway | Guarantees the bug appears at M40.2, when the surrounding code is new and the cause is least obvious |

---

## ADR-014 — `Idempotency-Key` and `X-Client-Type` Headers

**Status:** Accepted · **Milestone:** M0.6-4

### Context

Two headers are specified and never sent. `Idempotency-Key` makes retry-safe writes possible on unreliable networks — the contract names prescription send, appointment create and message send, all of which are unsafe to duplicate. `X-Client-Type: mobile` selects the token-in-body auth variant the mobile client needs.

### Evidence

| Source | Content |
|---|---|
| API §0.5 | "State-changing POSTs accept `Idempotency-Key`; **replays return the original result**" |
| MG §8.4 | "Idempotency: `POST` endpoints with side effects (**prescription send, appointment create, message send**) accept an `Idempotency-Key` header" |
| API §1.5 | "*Mobile variant:* with `X-Client-Type: mobile`, refresh token travels in **body instead of cookie**" |
| MG §15.2 | Same, plus "mobile stores it in Keychain/Keystore; same rotation + reuse detection" |
| MG §15.7 | "**idempotency keys make retry-safe writes possible on flaky networks**" |
| `frontend/src/api/client.ts:84-92` | Headers sent: `Accept`, `X-Correlation-Id`, `Content-Type` (conditional), `Authorization` (conditional). **Neither header is present**, and no method parameter can supply one |
| RM M41.1 | Mobile validation "exercised by a script client" — no browser involved |

### Decision

**Both headers are server-side obligations now and client-side capabilities later. They are separable, and they are separated.**

**Backend — in scope at their owning milestones:**

1. **`Idempotency-Key` is accepted on every state-changing POST with side effects**, from the milestone that builds each endpoint. Semantics: the first request with a given key executes and its response is stored against `(key, user, endpoint)`; a replay returns the stored response without re-executing. Keys are scoped per user — one user's key can never return another's result. TTL is 24 h, matching the only single-use token TTL the contract states (API §1.1); this is a mechanical retry window, not a product policy.
2. **`X-Client-Type: mobile` selects the token-in-body refresh variant**, implemented in the auth module and verified at RM M41.1 by a cookie-less script client. Rotation, reuse detection and family revocation are identical in both modes — only the transport of the refresh token differs.
3. **Absence of either header is the default path**, never an error. A browser client that sends neither behaves exactly as it does today.

**Frontend — recorded, not performed (RM M39.3):**

4. `ApiClient` gains optional per-request header support so mutation hooks can pass an `Idempotency-Key`.
5. `X-Client-Type` is **not needed by the web client at all** — it exists for the future mobile app. No frontend work is required for it, and RM M41.1's verification uses a script client precisely because no browser client sends it.

**Why the backend goes first.** Both are additive and backward-compatible: the server accepts what clients may not yet send. Building them into each endpoint as it is written is nearly free; retrofitting idempotency onto a prescription-send path afterwards means reopening the highest-risk module in the platform.

### Consequences

**API.** No contract change — both headers are already specified. The backend implements them.

**Database.** An idempotency-record store keyed on `(key, user_id, endpoint)` with the response payload and a TTL. Redis is the natural home (RM M31), with the caveat that a replay must survive a Redis restart if it is to be trusted; a durable store is the safer choice for prescription send specifically. **Flagged for M31, not decided here** — it is an infrastructure choice, not a contract one.

**Backend services.** One idempotency interceptor in `shared/`, applied by decorator to the endpoints MG §8.4 names. The auth module branches on `X-Client-Type` in exactly one place.

**Frontend integration.** Nothing breaks. The optional header parameter is additive.

**Testing.** A replayed POST with the same key returns the original result and does not create a second row. Two different users using the same key string get their own results. RM M41.1's script client completes login → refresh → logout with no cookie jar.

### Alternatives considered

| Alternative | Rejected because |
|---|---|
| Derive idempotency from the existing `X-Correlation-Id` | It is regenerated per request (`client.ts:87`), so a retry carries a *different* value — it identifies a request, not an intent |
| Skip idempotency until the mobile client exists | MG §8.4 names three web flows already at risk. A duplicate signed prescription is a clinical-safety event, not a nuisance |
| Implement idempotency for every POST | Unnecessary for reads-shaped or naturally idempotent writes, and the storage cost is real. MG §8.4's three flows plus other side-effecting sends are the scope |
| Add a `/auth/token` mobile endpoint instead of the header | API §1.5 specifies the header variant on the same endpoints. A parallel endpoint doubles the auth surface |


### Implementation (2026-11-05)

The store choice this ADR flagged for M31 is made: **durable**, a PostgreSQL table
`idempotency_records` keyed `UNIQUE (user_id, key)`, for the reason the Consequences give — a
replay must survive a Redis restart to be trusted. `shared/idempotency` adds one global
interceptor that acts only on routes marked `@Idempotent()`: appointment create, prescription
create, sign and renew, lab-order create, conversation create and message send. A different
request under a used key is 422 `idempotency_key_reused`, a key still executing is 409
`idempotency_request_in_progress` (the IETF `Idempotency-Key` draft's statuses), and a failed
request releases its key. Expired rows are deleted hourly by `idempotency.expiry-sweep`. No
decision above changes; RM M31.1 records the evidence.
---

## ADR-015 — NestJS 10 Retained; Residual Advisory Deferred

**Status:** Accepted · **Milestone:** M1 · **Decided by:** project owner, 2026-08-12

### Context

Installing the M1 dependency tree surfaced 27 advisories, 2 of them critical. Most were resolvable, but one is not: `@nestjs/core <= 11.1.17` carries [GHSA-36xv-jgw5-4q75](https://github.com/advisories/GHSA-36xv-jgw5-4q75), and the only upstream remedy is NestJS 11.1.18 or later. The roadmap fixes the stack at NestJS 10, and RM M37.1 requires a clean dependency audit before production. Those two requirements cannot both be satisfied today.

### Evidence

| Source | Content |
|---|---|
| RM header | "**Stack (fixed):** Node 20 · TypeScript strict · **NestJS 10** · Prisma · PostgreSQL 16 · Redis 7 · BullMQ · Zod · Argon2id · S3-compatible storage · Docker" |
| RM working rule 6 | "Any deviation from this roadmap → record it in `docs/DECISIONS.md` (ADR) in the same PR" |
| RM M37.1 | "Dependency audit clean; Helmet headers verified; JSON limits; CORS exact-origin + credentials" |
| `npm audit --omit=dev` after M1 | 2 moderate, both tracing to the one `@nestjs/core` advisory |
| `npm audit` before mitigation | 27 total — 2 critical, 7 high |
| Advisory metadata | Patched in `@nestjs/core@11.1.18`; no 10.x backport published |

### Decision

**NestJS 10 remains the selected version. The residual advisory is acknowledged and deferred to M37.1. NestJS 11 is not authorised at this milestone.**

1. **The stack line is binding.** Moving to NestJS 11 is a stack change, not a patch bump, and it is not made unilaterally by an implementing engineer.
2. **Transitive advisories were pinned forward** via `overrides` in `backend/package.json` — `qs`, `multer`, `express`, `body-parser`, `file-type` — which took production from 8 advisories (2 high) to 2 moderate, and criticals to zero, **without touching the framework version**.
3. **Dev-only tooling was upgraded on its merits**, not to flatter the audit: Vitest 2 → 4 cleared a genuine critical in the dev toolchain. `@nestjs/cli` stays on 10.x to match the framework.
4. **No unrelated dependency is upgraded to make the audit look clean.** The remaining advisory is reported honestly by `npm audit --omit=dev` and is documented in `backend/README.md` under Known issues.
5. **M37.1's clean-audit requirement is not weakened, reworded, or waived.** It stands exactly as written. This ADR defers a known item *to* that gate; it does not lower the gate.

### Consequences

**API.** None.

**Database.** None.

**Backend services.** The `overrides` block carries a comment explaining why it exists and instructing the next reader to drop entries that upstream has caught up with. Re-audit at M37.1 with three possible outcomes: NestJS 10 has a backport (adopt it), the advisory is assessed as not reachable from this application's usage (record the assessment), or NestJS 11 is authorised as a stack change under a new ADR.

**Frontend integration.** None.

**Testing.** `npm audit --omit=dev` should be run at M37.1 and its output attached to that milestone's evidence, not summarised.

### Alternatives considered

| Alternative | Rejected because |
|---|---|
| Upgrade to NestJS 11 now | Contradicts the fixed stack. Nest 10 → 11 changes Express 4 → 5 and the platform packages beneath it; absorbing that during M1 would put an unreviewed framework migration under every milestone that follows |
| Add an `overrides` entry forcing `@nestjs/core@11` | Same migration, with none of the visibility — a framework swap disguised as a version pin |
| Suppress the advisory with `npm audit --audit-level=high` in CI | Hides the finding rather than deciding it, and would quietly defeat M37.1 |
| Treat M37.1's requirement as satisfied by "no criticals" | Rewrites an acceptance criterion to fit the implementation. The criterion says clean |

---

## ADR-016 — Health Response Carries Five Service Keys

**Status:** Accepted · **Milestone:** M1.4 · **Confirmed by:** project owner, 2026-08-12

### Context

RM M1.4 describes the health payload as `{ status, services: { db, redis, storage, mail } }` — four keys — while citing API §20 as its source. API §20.1 lists five, including `ai`. The implementation must serve one shape, and the two documents disagree on what it is.

A second question sits alongside it: at M1 none of these dependencies is wired, and reporting an unwired dependency as `down` would light up an operations dashboard for something that is not broken.

### Evidence

| Source | Content |
|---|---|
| **API §20.1** | `GET /health` — "Liveness `{ status, services: { db, redis, storage, mail, **ai** } }` — feeds the System Health card" |
| RM M1.4 | "`GET /api/v1/health` + `/ready` returning `{ status, services: { db, redis, storage, mail } }` **(API §20)**" — cites the contract as its authority |
| API §18.15 | `GET /administration/platform-status` → `PlatformStatus` including `system` health `{status, uptimePercent, cpu/ram %, storage GB, apiResponseMs}` |
| Source-of-truth hierarchy (this file) | API contract is rank 2; the roadmap is build order, not response shape |

### Decision

**The health response carries five service keys: `db`, `redis`, `storage`, `mail`, `ai`.**

1. **The contract governs response shape.** RM M1.4 cites API §20 as its source, so where its shorthand omits a key the contract names, the contract is what it meant to point at. This is a wording gap in the roadmap, not a competing specification.
2. **`ai` is not removed to match the shorter wording.** The AI gateway is a real dependency with a real failure mode (M16), and the System Health card is where an administrator would learn it is down.
3. **Service status is a three-value union: `up | down | unconfigured`.** `unconfigured` means the dependency has no probe registered yet — it is not a failure, and it does not degrade the overall status. `down` means a registered probe failed. Collapsing the two would make "not built yet" indistinguishable from "outage" on an operations surface.
4. **Indicators are a pluggable array.** M4 registers the database probe, M25 storage, M31 Redis, M19 mail, M16 the AI gateway. The response shape does not change as they arrive.
5. **`/health` and `/ready` differ deliberately.** Liveness stays 200 when a dependency is down — restarting this process cannot fix someone else's outage. Readiness returns 503, so an orchestrator stops routing traffic here.

### Consequences

**API.** Conforms to API §20.1 exactly. No contract change was made; this ADR records that the roadmap's shorthand was read against its own cited source.

**Database.** None.

**Backend services.** Later milestones add an indicator rather than editing the controller, so the health surface cannot drift from what the application actually depends on.

**Frontend integration.** The admin System Health card receives all five keys.

**Testing.** M1.4's verification asserted the full five-key payload from a running server.

### Alternatives considered

| Alternative | Rejected because |
|---|---|
| Serve four keys to match RM M1.4 literally | Contradicts the contract the roadmap itself cites, and drops the AI dependency from the only surface that reports it |
| Report unconfigured dependencies as `down` | An unwired dependency would page an operator for a service that has not been built yet |
| Omit unconfigured services from the object entirely | A key appearing and disappearing across deployments is worse for a dashboard than a stable key with an explicit state |

---

## ADR-017 — Administrator Model — One Seeded, Many Supported

**Status:** Accepted · **Decided by:** project owner, 2026-08-12

### Context

The platform launches with a single administrator. The tempting simplification — a singleton admin row, a constant admin id, an `is_admin` boolean — would make that launch slightly easier and would make the second administrator a schema migration. The owner has ruled that out.

### Evidence

| Source | Content |
|---|---|
| Project owner, 2026-08-12 | "There is ONE Administrator initially. However, the backend MUST support multiple administrators in the future. Do NOT hard-code a single admin account. Do NOT create a singleton admin table. Do NOT make admin identity a system constant." |
| `frontend/src/types/auth/index.ts` | `Role = 'doctor' \| 'admin'` — a role value on a user, not an identity |
| DB §A1–A5 | `roles`, `permissions`, `role_permissions`, `users`, `user_permissions` — a general RBAC model with no admin special-casing |
| API §2.10 | `GET/POST/PATCH /admin/users` — the users panel, gated on can:`doctors.manage` or `roles.manage` |
| API §15 | Roles and permission-matrix management, gated on can:`roles.manage` |
| ADR-006 (as decided) | Self-serve content access — a policy that assumes admins are ordinary users carrying permissions |

### Decision

**Administrator is a role a user holds, never an identity the system knows about.**

1. **No singleton.** No admin table, no reserved id, no `is_admin` column, no constant compared against anywhere. An administrator is a row in `users` whose role bundle is the admin bundle (MG §6.3).
2. **Exactly one administrator is seeded** for production (RM M38.4's seed carries no demo credentials and no mock password). Dev and staging seeds may carry more.
3. **Admin #2 through Admin #N require no schema change** — creating one is `POST /admin/users` with the admin role, gated on the actor holding `roles.manage` (or `doctors.manage` per API §2.10).
4. **Authorization never asks "is this the admin".** It asks whether the actor holds the required permission, resolved from role bundle plus per-user overrides (RM M7.1). A capability check that special-cases an identity is a defect.
5. **Self-approval is still refused where two people are the point.** ADR-006's second-admin approval, when enabled, requires a *different* administrator; that constraint is about distinct actors, not about how many exist.
6. **The wider staff vocabulary stays data, not code.** `reception`, `laboratory`, `pharmacy`, `nurse` already exist in `PlatformRole` and `StaffRole`; they resolve through the same `roles` table (ADR pending under A-17). No dedicated UI workflow is invented for a role the frontend does not yet have.

### Consequences

**API.** API §2.10 and §15 are the only paths that mint or elevate an administrator, and both are permission-gated and audited.

**Database.** No admin-specific table. `users` + `roles` + `role_permissions` + `user_permissions` per DB §A. The production seed inserts one user with the admin bundle.

**Backend services.** Guards read permissions, never identities. A "last administrator" safeguard — refusing to remove the final account holding `roles.manage` — is a service-layer rule to add with M8.2, not a schema constraint; it is noted here so it is not forgotten.

**Frontend integration.** The existing users panel already models this: `PlatformUser` carries `role` and `active`, with no notion of a privileged singleton.

**Testing.** A test proves a second administrator can be created through the API and holds identical capabilities to the first. An authz test proves no code path grants privilege by matching a user id.

### Alternatives considered

| Alternative | Rejected because |
|---|---|
| Singleton admin row or constant id | Makes the second administrator a migration, and scatters identity comparisons through the authorization layer where permission checks belong |
| `is_admin` boolean on `users` | A second, parallel authorization vocabulary alongside the 22-permission union — two sources of truth for one question |
| Seed several administrators | The owner specified one. Extra privileged accounts in a production seed are an attack surface, not a convenience |

---

## ADR-018 — v1 Scope Boundaries — Tenancy, Billing, Patient Identity

**Status:** Accepted · **Decided by:** project owner, 2026-08-12

### Context

Three questions repeatedly tempt a backend toward speculative generality: multi-tenancy, billing, and whether patients authenticate. Each is expensive to build early and expensive to retrofit badly. The owner has drawn the v1 line on all three, and this ADR records where — and, as importantly, what must stay possible.

### Evidence

| Source | Content |
|---|---|
| Project owner, 2026-08-12 | "v1 is single-clinic. Do not implement full multi-tenant behavior now. Do not unnecessarily block future migration to multi-clinic." |
| Project owner, 2026-08-12 | "Billing is OFF in v1. Do not implement revenue/payment infrastructure unless required by an existing contract. Preserve feature-flag compatibility." |
| Project owner, 2026-08-12 | "Patients are records, not authenticated users, in the current v1 … keep the API architecture mobile-ready." |
| MG §17-10 | "Single-clinic now; **keep clinic FK out of v1**, add via migration when needed" |
| MG §2.3 | "Patients do not authenticate in the current scope" |
| `configs/feature-flags.ts` | `billing: false` |
| API §12.1 | `revenue` category "only when billing flag on (else 404/flag-off alternate)" — resolved by ADR-002's sibling decision in RM M17.2 to the alternate payload |
| ADR-010 | `clinics`/`facilities` and the billing trio already scoped **OUT** on the same evidence |
| MG §15 | Mobile readiness — token-in-body variant, device registration, versioning, idempotency |

### Decision

**Three boundaries, each drawn so that crossing it later is a migration rather than a rewrite.**

**1. Single clinic.** No `clinic_id` on any table, per MG §17-10. No tenant resolution, no row filtering by tenant, no tenant header. What is preserved: every table already uses surrogate UUID keys, so adding a nullable `clinic_id` with a backfill is a normal migration. What is avoided: writing tenant-scoping code that has exactly one tenant to scope to, which cannot be tested and will be wrong when it matters.

**2. Billing off.** No invoices, invoice lines, or payments (ADR-010, groups 6). The revenue analytics category returns the **flag-off alternate payload** rather than 404 or 500 (RM M17.2) — the frontend renders alternates and has no 404 branch there. RM M17 and M18 remain deferral milestones producing ADRs only. Feature-flag compatibility is preserved: the flag governs the response, and no billing table exists to drift.

**3. Patients are records, not users.** *(⚠ **SUPERSEDED 2026-09-02 by ADR-030**, by owner decision — this clause only. Patients now authenticate through the existing lifecycle and `patients.user_id` links a record to an account. §§1, 2 and 4 are unaffected and stand. The text below is retained as the record of what was decided on 2026-08-12 and why.)* No patient authentication, no patient portal, no patient role in the session model. `patients` is a clinical entity, not an account. What is preserved: DB §13.1–13.2's `patient_doctor_assignments` (already IN per ADR-010) is the care-relationship anchor a future patient login would scope against, and the appointment state machine already models patient-facing states (`awaiting-patient`, re-confirmation, ADR-001). What is avoided: an authentication surface with no consumer.

**4. Mobile readiness is not deferred with them.** MG §15 is orthogonal to all three, and its pieces are already decided: token-in-body refresh under `X-Client-Type` (ADR-014), device registration at RM M41.2, `/api/v1` versioning (ADR-011), idempotency keys (ADR-014), ISO-8601 UTC timestamps, stable string enums (ADR-001, ADR-002). None of that waits for a mobile app to exist.

### Consequences

**API.** No tenant parameter on any route. `revenue` analytics serve the alternate payload with the flag off. No patient-facing auth routes.

**Database.** No `clinic_id`, no billing tables, no patient credentials. `patient_doctor_assignments` exists regardless, because care scoping needs it now (RM M7.2).

**Backend services.** Care scoping is by care relationship, not by tenant. A future multi-clinic migration adds a column and a scope predicate; it does not restructure authorization, because the authorization anchor is already a relationship rather than a global namespace.

**Frontend integration.** Matches what the frontend already does — no tenant switcher, `billing: false`, no patient shell.

**Testing.** A test asserts `category=revenue` with the flag off returns the alternate payload and neither 404 nor 500 (RM M17.2). No test asserts tenant isolation, because there are no tenants to isolate.

### Alternatives considered

| Alternative | Rejected because |
|---|---|
| Add a nullable `clinic_id` now "just in case" | An unused column on ~105 tables, plus scoping code with one tenant that cannot be meaningfully tested. MG §17-10 says keep it out |
| Build billing behind the flag | Speculative work on a module with no product definition; RM M17/M18 exist precisely to defer it |
| Build patient auth now for the future mobile app | Mobile readiness is about API shape, not about who authenticates. The pieces that matter are already decided and cost nothing today |
| Defer mobile readiness alongside the other three | MG §18.6: "Design for the mobile client now — it is cheap today and expensive later" |

---

## ADR-019 — Module Boundaries Are Ports, Enforced by Lint

**Status:** Accepted · **Milestone:** M2 · **Date:** 2026-08-14

### Context

M2 creates nineteen empty domain modules. Nothing about them is load-bearing yet, which is precisely why the decisions about how they may talk to each other have to be made now: every one of those decisions gets cheaper to state and more expensive to change with each milestone that adds code.

Three questions arrive together.

1. **What does a module do when it needs another module?** Labs must raise an alert on a critical result (API §8.7). Appointments must notify a patient on confirmation (API §5/§10). The obvious answer — inject the other module's service — produces a dependency graph that is a mesh by M20, and couples each caller's transaction to the callee's.
2. **What do modules use for the concerns none of them owns?** Audit dispatch, outbox publishing and object storage are needed from M6 onward but implemented at M28, M30 and M25. Roadmap working rule 5 already answers the audit half — earlier milestones "stub through the same interface" M28 implements — without saying where that interface lives.
3. **Is a boundary a convention or a rule?** M2.2 answers this by asking for `import/no-restricted-paths`, but its verify step says the demonstrative violation is "committed, then removed".

### Evidence

| Source | Content |
|---|---|
| RM M2.2 | "modules import only `common/`, `config/`, their own folder, and `shared/` public APIs" · verify: "a demonstrative illegal cross-module import fails lint (test committed, then removed)" |
| RM M2.3 | "`src/shared/` kernel folder for cross-module services (audit dispatcher, outbox, files, status machines) with public-API index files" |
| RM working rule 5 | "audited mutations write audit events (from **M28**'s service; earlier milestones stub through the same interface)" |
| MG §11.11 | Lockfile-only installs, clean audit — the standard any new dependency has to meet |
| `frontend/FRONTEND_ARCHITECTURE.md` §6 | Feature isolation on the frontend: a feature imports `shared/`, never a sibling feature |
| ADR-001 / ADR-002 | Two status machines already frozen; API §8 and §9.11 imply two more |

### Decision

**1. `src/shared/` holds ports, not implementations.** Four kernels: `audit`, `outbox`, `files`, `status`. The first three export a DI token and an interface; the concrete provider behind each token is a stub that M25, M28 and M30 replace without touching a call site. `status` is pure functions and has no provider.

**2. The stubs behave differently by design.** Audit and outbox log and resolve — a missing log line breaks nothing, and blocking eighteen modules on M28 would be the larger harm. File storage **rejects with 503** on every call. A `put()` that resolved without writing would hand back a file id for bytes that do not exist, and the defect would surface later as a broken download instead of a failed upload. The 503 also agrees with what `/health` already reports for storage (`unconfigured`, ADR-016).

**3. `SharedKernelModule` is `@Global`.** A global provider is invisible in a module's import list, which is a real cost, and it is paid exactly once here. The alternative is nineteen identical `imports:` lines that can only ever say the same thing, where forgetting one produces a DI failure at boot rather than a useful signal. No other module in this codebase may be global.

**4. Cross-module effects go through `shared/outbox`.** A module that needs another module's *data* queries it through its own repository; a module that needs another module's *behaviour* publishes a message. Delivery is at-least-once, so consumers must be idempotent — this is stated in the port's own contract rather than left for M30 to discover.

**5. Boundaries are lint errors, in four zones.** Module → sibling module; module → `shared/` internals (index files only); `shared/` → module; `common/` → anything of ours. `common/` is the bottom of the stack: everything imports it, so anything it imports is imported by everything.

**6. The boundary fixtures stay in the tree.** This is the one deviation from a roadmap verify step, and it strengthens it. `import/no-restricted-paths` **silently skips imports it cannot resolve**, so a renamed `tsconfig.json` or a dropped resolver dependency turns all four zones into no-ops with zero lint errors to show for it. A demonstration that was deleted proves the rule worked once. Six fixtures live in `__boundary-fixtures__/` folders, excluded from `eslint .`, and `test/boundaries.e2e-spec.ts` lints them through the ESLint API against **the project's real config** and asserts five specific rejections and one acceptance.

**7. Two devDependencies are added:** `eslint-plugin-import` (the rule M2.2 names) and `eslint-import-resolver-typescript` (without which the rule cannot resolve `.ts` files or the `@/` alias, per point 6). Both are dev-only; `npm audit --omit=dev` is unchanged at the two moderate advisories of ADR-015.

### Consequences

**API.** None. No endpoint exists yet.

**Database.** None.

**Backend services.** Every module from M6 onward is written against `AUDIT_DISPATCHER`, `OUTBOX` and `FILE_STORAGE` from its first line. M25, M28 and M30 become provider swaps. A module that tries to import a sibling fails CI rather than review.

**Frontend integration.** The backend's isolation now mirrors the frontend's, so the two trees can be reasoned about the same way.

**Testing.** The status kernel is unit-tested (7 cases). The module graph and the kernel tokens are asserted from a booted application. The boundary rules are asserted against real fixtures — the rule cannot go inert unnoticed.

**Cost carried forward.** M28 must replace `LoggingAuditDispatcher` with a writer that enlists in the caller's transaction; the log-and-resolve stub is not durable and must not be mistaken for the finished thing. M30 owes the same for the outbox. Both stubs say so in their own file headers.

### Alternatives considered

| Alternative | Rejected because |
|---|---|
| Let modules inject each other's services directly | A mesh by M20, and it couples each caller's transaction to the callee's — the failure the outbox exists to prevent |
| Defer `shared/` until M25/M28/M30 need it | Eighteen modules would be written against nothing and then edited three times. Rule 5 already says the interface comes first |
| Have each module import `SharedKernelModule` explicitly | Nineteen lines that can only say one thing, and a boot-time DI error as the penalty for forgetting one |
| Stub file storage with an in-memory map | It would look like success in tests and lose everything on restart — the exact failure mode a storage port must not fake |
| Remove the boundary fixtures after demonstrating them, as M2.2 suggests | The rule's failure mode is silence. A deleted demonstration proves it worked on the day it was written and nothing after that |
| Enforce boundaries with `no-restricted-imports` per-directory overrides, avoiding the new plugin | Reimplements zone matching in nineteen config blocks; `import/no-restricted-paths` is the rule the roadmap names, and the plugin is dev-only |

---

## ADR-020 — One Validated Environment, Policy Layered Over It

**Status:** Accepted · **Milestone:** M3 · **Date:** 2026-08-14

### Context

M3 turns configuration from "whatever `process.env` happens to hold" into a contract. Three questions come with it.

1. **What is required, and what may default?** A default that is wrong in production is worse than a missing variable, because the missing one stops the boot and the wrong one does not.
2. **Where does the security policy come from?** Roadmap M3.3 says the runtime policy layers M24's database platform-settings over environment defaults — but M24 does not exist, and five of the six settings it names are already visible to an administrator in the frontend's security panel with seeded values.
3. **How do the tests boot?** Making the application refuse to start without a complete environment breaks every e2e spec that boots a real application, which at M2 is all of them.

### Evidence

| Source | Content |
|---|---|
| RM M3.1 | The variable list, and "fail-fast at boot" · verify: "boot with a missing var exits with a readable error naming the var" |
| RM M3.3 | "Policy config service layering DB platform-settings (once **M24** exists) over env defaults for: session TTLs, idle minutes, login attempt limit, password expiry, 2FA enforcement, single-session" |
| `frontend/.../admin-settings.types.ts:249` | `SecurityPolicySettings` — `twoFactorRequired`, `passwordExpiryDays`, `sessionTimeoutMinutes`, `loginAttemptLimit`, `singleSessionPerUser` |
| `frontend/.../admin-settings.api.ts:75` | Seeded: `false`, `180`, `30`, `5`, `false` |
| MG §11.1-1 | JWT access token **≤15 min** |
| MG §11.1-8 | "login attempt limiter per policy" |
| MG §17-12, source-of-truth hierarchy | Frontend code is rank 1 — the DTO mirrors *are* the contract |
| ADR-011 | Refresh cookie scope; a `localhost` cookie domain breaks silent refresh entirely |

### Decision

**1. One schema, one reader.** `src/config/env.schema.ts` declares every variable; `src/config/env.ts` is the only file in `src/` that touches `process.env`. An `import/no-restricted-paths` zone makes importing it from a module a lint error, so the typed accessors on `ConfigService` are the only route to configuration. This also removed the last stray read: `buildLoggerOptions` took its level from `process.env.LOG_LEVEL` and now receives it as an argument, because `common/` sits below `config/` and cannot import it.

**2. Defaults only where the value is safe everywhere.** Ports, TTLs and policy defaults have them; connection strings and secrets do not. A `DATABASE_URL` that quietly defaults to localhost is how a staging box ends up talking to nothing.

**3. Production tightens, never loosens.** Development ships working defaults on purpose — the alternative is a setup step everyone skips. The price is that those values must be undeployable, so a production boot rejects the example `JWT_SECRET`, the example S3 key, `COOKIE_DOMAIN=localhost`, a localhost CORS origin, and an unauthenticated SMTP relay. `JWT_ACCESS_TTL` is capped at 900 in **every** environment, because MG §11.1-1 is a ceiling and a 24-hour access token would defeat the refresh design without anything else noticing.

**4. The policy defaults are the frontend's seeded values, exactly.** `SECURITY_TWO_FACTOR_REQUIRED=false`, `SECURITY_PASSWORD_EXPIRY_DAYS=180`, `SECURITY_SESSION_TIMEOUT_MINUTES=30`, `SECURITY_LOGIN_ATTEMPT_LIMIT=5`, `SECURITY_SINGLE_SESSION_PER_USER=false`. These five variables are **not in M3.1's list** — they are added because M3.3 cannot layer over defaults that do not exist. Their values are copied rather than chosen: the panel already shows an administrator what the policy is, and a backend defaulting differently would make that display a lie.

**5. `PolicySettings` carries the frontend's field names verbatim.** Renaming between the panel that edits a setting and the code that enforces it is how a setting ends up saved but not applied.

**6. Session TTLs are layered through the same mechanism despite having no admin field.** There is no TTL input in the security panel, so nothing can override them until M24 adds one — the same shape of gap ADR-006 records as RA-006.2. Routing them through `PolicyService` anyway means the day that field appears, no enforcement code changes.

**7. Overrides are validated per key, and failure falls back to the defaults.** One nonsensical database column — a negative `loginAttemptLimit` that locks out every user on their first attempt — costs that one setting, not the whole policy. If the source itself throws, the environment defaults stand: they are a complete, valid policy, and refusing to answer would take login down for everyone because a settings row could not be read.

**8. The policy is not cached.** Caching a security policy needs an invalidation story, and that story belongs with M24's writes and M31's cache. Inventing one here would be a guess the admin panel's "save" button has to honour later.

**9. Tests supply a complete environment rather than relaxing the schema.** `test/setup-env.ts` sets every required variable with `??=`, so a shell value still wins. Relaxing the schema for tests would make the fail-fast contract untrue in exactly the place it is verified.

**10. `dotenv` is added as a dependency.** `.env.example` has told developers to "copy to .env" since M1, and nothing read it. `dotenv` has zero dependencies and no advisories, and it never overrides an already-set variable — so in a container the orchestrator still wins over a stale `.env` baked into an image.

### Consequences

**API.** None.

**Database.** None. M24 implements `PlatformPolicySource` against `platform_settings` and changes one `useClass`.

**Backend services.** M6's limiter, 2FA step-up and session handling read `PolicyService.current()`, not config. Configuration cannot be read except through `ConfigService`.

**Frontend integration.** The security panel's five fields become live at M24 with no backend rename.

**Operations.** A misconfigured deployment fails at boot with a message naming every bad variable at once, and exits 1 so an orchestrator reports a crash loop rather than a degraded service. **This is order-sensitive**: the environment must be validated before `AppModule` is imported, because a `@Module` decorator evaluates at import time — `LoggerModule.forRootAsync` exists for that reason, and switching it back to `forRoot` would turn the readable message into a raw stack trace.

**Testing.** 27 new cases: env contract, production hardening, `.env.example` validity, and the policy layering.

### Alternatives considered

| Alternative | Rejected because |
|---|---|
| `@nestjs/config` | Brings dotenv, dotenv-expand, lodash and uuid to provide a `ConfigService` this needs 40 lines to write, and its `get<T>()` is stringly-typed where the Zod output is not |
| Make everything optional so the app always boots | Defeats M3.1 entirely. A service that starts with no `DATABASE_URL` fails on the first request instead of at deploy time |
| Validate inside a Nest provider | A missing variable becomes a DI failure whose stack trace never names the variable |
| Choose our own policy defaults | The frontend already shows an administrator what the policy is; a different backend default makes that display wrong on day one |
| Read policy from config directly at each enforcement point | Every one of them would need editing at M24, and they would drift on what "the policy" means |
| Cache the resolved policy | Needs an invalidation story that belongs with M24's writes |
| Relax the schema for the test environment | Makes the fail-fast contract untrue exactly where it is tested |

---

## ADR-021 — Database Platform: Prisma 7, Driver Adapters and the Test Harness

**Status:** Accepted · **Milestone:** M4 · **Date:** 2026-08-14

### Context

The roadmap pins "Prisma" without a version. The current major is **Prisma 7**, and it is not a drop-in continuation of the 5.x the roadmap was written against: the Rust query engine is no longer the default transport, `$use` middleware is gone, and the generated client no longer lands in `node_modules` by default. Each of those changes something M4 has to decide.

M4.3 also asks for a "Testcontainers integration harness", verified by "CI job runs a trivial repository test against a containerized Postgres" — one names a tool, the other names an outcome.

### Evidence

| Source | Content |
|---|---|
| RM header | "Stack (fixed): … Prisma …" — no version |
| RM M4.1 | Raw migration for `pgcrypto`, `citext`, `pg_trgm`; snake_case DB / camelCase client |
| RM M4.2 | "soft-delete **middleware** (`deletedAt` filtered)" |
| RM M4.3 | "Migration workflow in CI (diff check, shadow DB) + seed skeleton + **Testcontainers** integration harness" · verify: "CI job runs a trivial repository test against a **containerized Postgres**" |
| Prisma 7 generated client | `PrismaClientOptions` requires `adapter` or `accelerateUrl`; `datasourceUrl` no longer exists |
| Prisma 5 release notes | `$use` middleware removed in favour of client extensions |
| MG §11.11 | Lockfile-only installs, clean audit |
| ADR-020 §1 | One validated environment, `process.env` read in exactly one place |

### Decision

**1. Prisma 7 with the `@prisma/adapter-pg` driver adapter.** Not a preference — Prisma 7 requires an adapter or Accelerate. The transport is an ordinary `pg` pool, which also means M31's pooling work tunes something standard rather than a Rust engine's opaque internals.

**2. The connection string comes from `ConfigService`, not from Prisma reading the environment.** `new PrismaPg({ connectionString: config.env.DATABASE_URL })`. This keeps ADR-020 §1 true and means a malformed URL fails at boot with a readable message rather than as a driver error on the first query.

**3. Soft delete is a client extension, because middleware no longer exists.** M4.2's wording predates its removal.

**4. Soft delete exposes two clients rather than a per-query flag.** `PrismaService.db` is filtered; `PrismaService` itself is not. A flag would have to be an explicit `deletedAt: undefined` in the `where`, and Prisma's generated input types reject an explicit `undefined` under `exactOptionalPropertyTypes`, which this project has on. The filter is applied when the caller has not mentioned `deletedAt`, tested by key presence rather than value — `findUnique` is deliberately excluded, since its `where` accepts only unique fields.

**5. Extensions live in their own migration, ordered first.** `CREATE EXTENSION` is not expressible in the schema language, and a table whose column type is `citext` or whose default is `gen_random_uuid()` cannot be created before the extension exists. **This was a real defect, caught and fixed during the milestone:** the hand-written extensions migration was first given a later timestamp than the generated model migration, so it applied correctly on the development database — where it already existed — and would have failed on the first fresh deploy. Migrations are applied in lexicographic filename order; a hand-written one must be named to sort where it needs to run. Proven by dropping the database and running `migrate deploy` from empty.

**6. The trigram index is declared in the schema, not left in raw SQL.** It began as raw SQL, which made `migrate diff` report drift permanently — the migration created an index the schema did not declare. A drift check with a known standing failure is a drift check nobody reads. Prisma expresses it as `@@index([label(ops: raw("gin_trgm_ops"))], type: Gin)`.

**7. The generated client is generated into `src/generated/prisma`, gitignored, and produced by `postinstall`.** It has to be under `src/` because `nest build` sets `rootDir: ./src` and refuses files outside it. It is gitignored because generated code in review diffs is noise, and `postinstall` runs `prisma generate` so a fresh `npm ci` can typecheck.

**8. CI uses a GitHub Actions `services:` Postgres, not Testcontainers.** The verify step asks for a containerized Postgres, and this is one — the same official image, with none of the in-test lifecycle code, no `testcontainers` dependency, and no dependency on a Docker socket being reachable from inside the test process. It starts once per job rather than once per suite. If a future milestone needs multiple isolated database instances per run, Testcontainers becomes worth its cost; nothing before M34 does.

**9. CI runs `migrate deploy`, never `migrate dev`.** Deploy applies committed migrations and cannot generate one. Migrations that only work when Prisma is allowed to rewrite them do not work.

**10. `npm test` now requires a database.** The M4 properties are the database's behaviour, not the client's — `gen_random_uuid()` is pgcrypto, case-insensitive matching is citext, the search index is pg_trgm — and none can be verified against a mock. `test/setup-env.ts` defaults `DATABASE_URL` to `medora_test`.

### Consequences

**API.** None yet.

**Database.** Two migrations exist: extensions, then the conventions reference model. Every M5 model copies that model's shape — uuid default, `timestamptz(3)`, `deletedAt`, audit columns, `@map`/`@@map` on everything.

**Backend services.** `PrismaService` is exported through the `@Global` shared kernel, so repositories inject it without an import. The database probe M1.4 left a slot for is now registered: `/health` reports `db: up`, and `down` when Postgres is stopped — verified by stopping it.

**Frontend integration.** None.

**Operations.** `npm run db:check` fails on schema/migration drift; `db:deploy`, `db:seed`, `db:status` and `db:reset` wrap the rest. The seed refuses to run when `APP_ENV=production`.

**Cost carried forward.** M31's connection pooling must be designed against a `pg` pool. M37's RLS work (ADR-022) needs `SET LOCAL` inside a per-request transaction, which interacts with that pooling — the two must be planned together.

### Alternatives considered

| Alternative | Rejected because |
|---|---|
| Pin Prisma 5 to match the roadmap's assumptions | Starting a greenfield schema two majors behind, to preserve a middleware API that was removed for good reasons |
| Prisma Accelerate instead of a driver adapter | A hosted dependency and a per-request cost for a self-hosted clinic deployment |
| Testcontainers, as M4.3 names it | Adds a dependency and a Docker-socket requirement to satisfy an outcome an Actions service already satisfies, at higher per-suite cost |
| Keep the trigram index as raw SQL | Permanent standing drift, which trains everyone to ignore the drift check |
| Generate the client into `node_modules` | Prisma 7 discourages it, and it silently disappears on a clean install without `postinstall` |
| Mock Prisma in tests | Would verify the client's behaviour, not the database's — and every property M4 establishes is the database's |

---

## ADR-022 — Care-Relationship Scoping: Service Layer in v1, RLS Before Production

**Status:** Accepted · **Milestone:** M4.4 · **Date:** 2026-08-14

### Context

The platform's central authorization question is not "may this user read charts" but "may this user read *this patient's* chart". That is the care relationship, and it is the control standing between an authenticated doctor and every patient record in the database.

Two places can enforce it. **Postgres row-level security** makes the database refuse rows the current actor may not see, so a forgotten `WHERE` clause returns nothing rather than everything. **Service-layer scoping** enforces it in application code, where every read passes through a repository that applies the actor's scope.

M4 is the moment to decide, because M5 designs ~110 tables and RLS changes what those tables need.

### Evidence

| Source | Content |
|---|---|
| RM M4.4 | "ADR: RLS vs service-layer scoping for the care relationship (recommended: service-layer in v1, RLS on PHI tables before production — **M37**)" |
| MG §11.6 | No PHI in logs, URLs or error messages |
| MG §11.3 | Authorization at guard level |
| ADR-006 | Content access is self-serve with audit, policy-driven — not a second-admin approval |
| ADR-017 | Many administrators supported; identity is a role on a user, not a constant |
| DB §10 | PHI classification per column |
| ADR-021 §1 | Transport is a `pg` connection pool |
| RM M28 | Audit logs — every PHI read is an audited event |

### Decision

**Service-layer scoping in v1. RLS on PHI tables before production, at M37, as defence in depth rather than as a replacement.**

**1. Every PHI read goes through a repository that takes the actor's scope explicitly.** No service composes its own ad-hoc query against a PHI table. The scope is a parameter, not an ambient value, so a call site that forgets it does not compile.

**2. The boundary rules already in place carry part of this.** A module cannot reach into another module's repository (ADR-019 §5), so "who may query the patients table" has one answer with one implementation, not nineteen.

**3. Every PHI read is audited through `shared/audit`.** Scoping decides whether a read is allowed; the audit log records that it happened. The second is what makes a scoping *bug* discoverable after the fact, which is the compensating control that makes v1's weaker enforcement acceptable.

**4. RLS is not merely deferred — it has a prerequisite this milestone establishes.** RLS needs the actor's identity inside the database session (`SET LOCAL app.current_user_id`), which requires every request to run in an explicit transaction on a dedicated connection. With the `pg` pool of ADR-021 that is achievable, but it interacts directly with M31's pooling: a transaction-pooled connection reused between requests would carry the previous actor's identity, which is a PHI leak rather than a performance bug. **M37 must land after M31, and the two must be designed together.**

**5. M5 must not make RLS harder.** Every PHI table carries the columns a policy would need — the owning patient id reachable without a join through more than one table. This is a schema constraint on M5, recorded here because M5 is where it gets honoured or lost.

### Consequences

**API.** None directly. The scope is a service concern; endpoints keep their shapes.

**Database.** M5 designs PHI tables so an RLS policy can be written against them without restructuring. No policies are created in v1.

**Backend services.** Repositories take scope explicitly. M9–M14 inherit this and cannot opt out.

**Frontend integration.** None.

**Testing.** M15's cross-module pass and M34's security suite must include negative scoping tests — a doctor without a care relationship receiving 404, not 403, so existence is not disclosed.

**Security posture, stated plainly.** In v1 a missing scope argument is a PHI disclosure, and only code review, types and tests prevent it. That is a real accepted risk, not a solved problem. RLS at M37 converts it from a class of bug into a database refusal. **The risk is accepted for v1 on the basis that every PHI read is audited, so a scoping failure is detectable rather than silent.**

### Alternatives considered

| Alternative | Rejected because |
|---|---|
| RLS from M5, as the primary control | Requires the session-identity and pooling design before a single endpoint exists, and would block M6–M14 on infrastructure that has no consumer yet. It also makes every migration a policy migration during the period the schema changes most |
| RLS only, no service-layer scoping | The database would enforce it but the application could not explain a refusal — an empty result set is indistinguishable from "no such patient", which is exactly the information the API must control deliberately (404 vs 403) |
| Service-layer only, permanently | Leaves a whole class of PHI disclosure one forgotten clause away, for the lifetime of the product. Acceptable for v1 with auditing; not acceptable as a final position |
| Enforce in a Prisma extension, transparently | Ambient scope hidden from call sites: the failure mode becomes a query that silently returns nothing, and nobody can tell scoping from a genuine empty result |

---

## Cross-ADR verification

Performed after writing, per the M0.2 verification requirement.

| Check | Result |
|---|---|
| **Against the API contract** | ADR-001 matches API §5's stated matrix and adds nothing to it. ADR-002 matches API §7's "+ draft, dispensed per ADR". ADR-003 preserves every response field name (API field-name law) and uses `doctorId` on inputs as API §5.10 already does. ADR-004 keeps `department: string` in responses. ADR-005 implements API §3.8/§3.9/§5.9 without altering their shapes. ADR-006 implements API §9.11 in both policy modes with one response shape. ADR-007 respects API §19.2's `confirm: true` requirement. **No ADR changes the contract.** |
| **Against the database extraction** | ADR-001 → DB §6 + §S3. ADR-002 → DB §6 + §14.5-2. ADR-003 → DB §9 cascade policy + §14.5-3. ADR-004 → entity 70, §14.2 phase 2, §14.5-4. ADR-005 → DB §S2 verbatim. ADR-006 → DB §S4 verbatim. ADR-007 → DB §7, §8, §9, §10. **No ADR modifies the schema**; two (001, 002) require enum values the dictionary already recommends adding. |
| **Against the roadmap** | Satisfies M0.2's requirement of one accepted ADR per MG §17 item 1–7. Feeds M5.6 (appointment enum), M5.8 (prescription enum), M5.1 (departments), M5.4 (availability), M5.9 (access requests), M28.5 (retention). Consistent with M3.3's config-layering model, which ADR-006 and ADR-007 both depend on. |
| **Enum-name search across the repository** | **Appointment status — 4 definition sites**, not the 3 first recorded: `AppointmentStatus` (7 values), `ProfileAppointmentStatus` (5, narrowed), `OversightStatus` (7, deliberate duplicate — found only on the verification sweep), and one inline array (7). All non-narrowed sites agree exactly; the ADR's evidence and consequences were corrected to include the fourth. `awaiting-patient` — absent from all source; only a doc comment at `StatusBadge.tsx:49`. `requested` — exists as an `OversightEventKind`, never as a status. `prescription_status` — 1 definition (5 values); `dispensed` only as a timeline kind; **no `cancelled` status anywhere**, and `PRESCRIPTION_STATUS_META.discontinued` already carries `kind: 'cancelled'`. Department arrays — **5**, one more than DB §14.5-4 reported. Doctor free-text fields — 6 distinct names across 5 modules, matching DB §14.5-3. |
| **Incidental drift noted, not resolved here** | `NotificationChannel` is defined twice with different spellings: `notifications/model/types.ts:190` uses `'inApp'`, `admin/appointments/oversight.types.ts:48` uses `'in-app'` (and omits `desktop`). DB §6 lists `notification_channel` as email, sms, push, desktop, **inApp**. The DB spelling governs. Outside M0.2's seven decisions; added to the M0.1 drift register alongside A-17…A-23 |
| **Exact enum spellings preserved** | Yes — kebab-case literals retained verbatim: `no-show`, `awaiting-patient`, `pending-approval`, `critical-low`, `critical-high`. No renaming to SCREAMING_CASE or camelCase anywhere. |

### Open items carried forward

| Ref | Item | Blocks |
|---|---|---|
| RA-001.1 | Source states for `propose-slots` → `awaiting-patient` | RM M11.4 |
| RA-004.1 | "General Medicine" vs "Internal Medicine" — same department? | RM M5.1 seed |
| RA-005.1 | May doctor availability exceed clinic working days? | RM M9.4 |
| RA-005.2 | `auto_behavior = reschedule-existing` — pre-selection or automatic? | RM M11.5 |
| ~~RA-006.1~~ | ~~Second-admin approval default~~ — **CLOSED** by the project owner: self-serve + audit, policy-driven | — |
| RA-006.2 | No platform setting exists to hold the content-access policy | RM M24.2 (contract addition) |
| RA-006.3 | Content-access grant TTL | RM M20.7 |
| ~~**PD-1…PD-5**~~ | ~~Retention for files, notifications, login events, sessions, OTP codes~~ — **CLOSED** by the project owner 2026-08-12: PD-1…PD-3 bind to `patientRecordYears` / `messageDays` / `auditLogDays`; PD-4 is 90 days after expiry, PD-5 a 10-minute TTL purged on use. The two new fields are scheduled at RM M24.2 | RM M30.2, RM M24.2 |
| V-15/V-16 | **The externally reported database is unverified.** It is not in this repository and no dump has been provided. It must be reconciled against ADR-001…ADR-005 before schema work; divergences arrive as new ADRs | RM M5 |
| **RA-028.1** | **Scheduled-report recipients must be stored lower-cased** — the normalisation that replaces the `citext[]` column type ADR-028 removed | RM M21.5 |
| **RA-027.1** | **Two role unions, and three roles with no shell.** `types/auth`'s `Role` is the coarse `'doctor' \| 'admin'` that selects the SPA's route tree; `PLATFORM_ROLES` has five members, and the permission matrix is indexed by those five. So `reception`, `laboratory` and `pharmacy` hold seeded bundles but have no frontend to log into. The authz kernel decides against the matrix and speaks `PlatformRole` only; how a session's platform role is projected onto the coarse `Role` that `SessionUser` carries is a session-issue concern, and is not resolvable without deciding whether those three roles get a shell — a product question, not a technical one | RM M6.2, M8 |

**Status notes, 2026-10-22 (documentation synchronization — the rows above are unchanged).**

- **RA-027.1 — still OPEN here.** Its product question was answered by the owner on `frontend`:
  DEC-006 (Option C, 2026-10-21) gives `reception`, `laboratory` and `pharmacy` minimal web
  workspaces, and DEC-006a (Option A) settles their scope (`frontend/FRONTEND_CHECKLIST.md` §14.1
  on `origin/frontend` at `a0142ea`; not on `main`). The backend already issues the full platform
  role in the session (`backend/src/modules/auth/services/session-user.service.ts:57`,
  `role: user.role.code`). Closing this item, and
  deciding whether anything in RM M6.2/M8 remains, is left to this register's owner. The backend
  workflows those workspaces still lack are **BR-DEC-006**, in
  [`backend/docs/FRONTEND_DECISION_REQUIREMENTS.md`](../backend/docs/FRONTEND_DECISION_REQUIREMENTS.md).
- **RA-005.1 — still OPEN.** DEC-005 built the doctor's weekly availability editor without
  inventing clinic hours, and its backend requirement **BR-DEC-005** (same page) depends on this
  item.

The ambiguities catalogued in `docs/M0_REPOSITORY_ANALYSIS.md` §11 that M0.2 does not cover — A-03 through A-10 (transport), A-17 through A-23 (naming and shape drift) — are assigned to RM M0.3–M0.6 and M39, not to this file.

---

---

## ADR-023 — Enum Mapping and the Limits of the Drift Check

**Status:** Accepted · **Milestone:** M5 · **Date:** 2026-08-26

### Context

Two questions surfaced on the first day of M5 and then governed every one
of its eleven steps.

**First, the enum spelling.** ADR-001 and ADR-002 fix the status literals
*verbatim*, hyphens included — `no-show`, `awaiting-patient`,
`pending-approval`, `critical-low`. Prisma identifiers cannot contain a
hyphen, a space or a leading digit, so for a large share of DB §6's 363
enum values the client-side member name and the stored value cannot be
the same string.

**Second, what `npm run db:check` actually protects.** ADR-021 §6 already
records the M4 lesson that an index a migration creates and the schema
does not declare shows up as permanent drift. M5 needed the rest of that
boundary, because DB §9 requires CHECK constraints, DB §8 requires partial
indexes, DB §4 requires triggers and DB §B11 requires a generated column
— none of which the Prisma schema language can express.

### Evidence

| Source | Content |
|---|---|
| ADR-001, ADR-002 | The literals are preserved "**verbatim**, including the hyphenated `no-show` and `awaiting-patient` spellings (kebab-case string literals, not `NO_SHOW`)" |
| DB §6 | The complete enum inventory — 80 vocabularies, 363 values |
| DB §14.3 | "native `ENUM` types for closed vocabularies" |
| DB §9 | CHECK constraints and partial unique indexes, by name |
| DB §8 | Partial indexes on `sessions`, `appointments`, `lab_orders`, `notifications` |
| DB §B11 | `bmi` — "Stored generated column" |
| ADR-021 §6 | The trigram index that reported drift permanently until it was declared |
| Measurement, M5.1–M5.10 | Probe migrations, run and reverted — see below |

### Decision

**1. Every enum member carries an explicit `@map`, even where the two
spellings coincide.** `ACTIVE @map("active")` as much as
`NO_SHOW @map("no-show")`. Mapping only where the compiler forces it would
leave a reader working out, per value, which spelling reaches the
database — precisely the ambiguity the verbatim rule exists to remove.
The DB value is the API vocabulary; the member name is an implementation
detail of one client.

**2. The consequence is owned by the API layer, not hidden.** The Prisma
client speaks `NO_SHOW`; the wire speaks `no-show`. Every module from M6
onward maps between them at its serialization boundary. This is a real
cost and it is paid deliberately: the alternative — modelling these
columns as `varchar` so the strings match — gives up type safety at every
call site and lets a typo reach the database.

**3. A test reads `pg_enum`, not the client.** A dropped `@map` is
invisible from TypeScript: the code still compiles and the client still
round-trips its own value. The M5.1 spec therefore asserts the stored
labels directly, including a sweep proving **no** label is
SCREAMING_SNAKE_CASE — the shape a missing `@map` leaves behind.

**4. The drift check's boundary, as measured rather than assumed.**
`prisma migrate diff` compares what the schema language can represent and
**skips what it cannot**:

| Not seen — safe in raw SQL, must be held by tests | Seen — must be declared, or it is drift |
|---|---|
| CHECK constraints | tables, columns, types |
| triggers and functions | ordinary indexes, including unique |
| **partial** indexes (`WHERE …`) | **BRIN**, GIN and other access methods |
| expression indexes | defaults — *including a generated column's expression* |
| table partitioning | |

Each row was established by probe, not by reading documentation. Two are
worth recording because they cost real work:

- **A generated column reads as a default.** `bmi` first reported drift on
  every run until the schema declared
  `@default(dbgenerated("round(…)"))` matching the expression Postgres
  normalizes to. Prisma also emits generated columns *wrongly* — it wrote
  `DEFAULT round(weight_kg / …)`, which Postgres rejects outright
  ("cannot use column reference in DEFAULT expression") and which would
  have been the wrong semantics anyway, since a default applies only when
  the caller omits the column.
- **BRIN is expressible, so raw SQL was wrong for it.** The
  `audit_events` BRIN index was first hand-written; `migrate dev`
  immediately generated a corrective migration dropping it. Both M5.10
  migrations were deleted and the step rebuilt with the index declared as
  `type: Brin`.

**5. Therefore: raw SQL is for what Prisma cannot represent, and nothing
else.** And because the drift check does not see those things, **each one
is covered by a failing-insert or behavioural test instead.** That is not
belt-and-braces — it is the only mechanism holding them. A CHECK dropped
by hand would never be reported by `db:check`.

### Consequences

**API.** Modules from M6 map client enum members to wire literals at the
serialization boundary. No contract change; the wire values are exactly
what ADR-001 and ADR-002 fixed.

**Database.** 80 native enum types, 363 values, every one mapped
explicitly.

**Backend services.** A shared mapping helper per enum is preferable to
per-module `switch` statements; M39's contract alignment is the natural
place to consolidate it.

**Testing.** Structural assertions read `information_schema` and
`pg_enum`. Constraint assertions are failing inserts. Neither can be
replaced by reading the schema file, which is the thing under test.

### Alternatives considered

| Alternative | Rejected because |
|---|---|
| `varchar` columns with CHECK constraints, so the strings match the client | Gives up the type safety of a closed vocabulary at every call site, and DB §14.3 specifies native enums |
| `@map` only where the compiler forces it | Leaves a reader deciding per value whether the member name is the stored value — the ambiguity the verbatim rule removes |
| Rename the wire values to SCREAMING_SNAKE_CASE so no mapping is needed | Contradicts ADR-001 and ADR-002 and breaks every frontend consumer of the existing literals |
| Trust the drift check to catch constraint regressions | Measured: it does not see them. Trusting it would have left ~125 CHECK constraints unprotected |

---

## ADR-024 — `audit_events` Is Partitioned, and Therefore Has a Composite Key

**Status:** Accepted · **Milestone:** M5.10 · **Date:** 2026-08-26

### Context

DB §M1 specifies two things about the audit ledger that PostgreSQL cannot
both honour: **`PK: id`** and **"partition by month"**. A partitioned
table's primary key must contain every partition-key column.

### Evidence

| Source | Content |
|---|---|
| DB §M1 | "**PK:** `id` — **INSERT-only; no UPDATE/DELETE grants; partition by month.**" |
| DB §8 | "monthly partitions; BRIN on occurred_at" |
| DB §7, §9 | `audit_events` is immutable and INSERT-only; the app role holds no DELETE grant |
| ADR-007 R2 | "Audit retention is executed by dropping whole monthly partitions, never by row deletion" |
| UX §3.7 | 100k+ rows; ms-precision timestamps; the ledger is "read-only for everyone including admins" |
| PostgreSQL | A partitioned table's PK must include the partition key |

### Decision

**1. Partitioning wins; the primary key becomes `(id, occurred_at)`.**
ADR-007 R2 makes partitioning load-bearing rather than an optimisation:
with no DELETE grant on the table, dropping a partition is the *only*
mechanism by which anything ever leaves it. A non-partitioned ledger
would make the retention policy unenforceable.

**2. The cost is close to nil.** `id` is a `gen_random_uuid()`, so it
remains unique in practice; nothing in the schema references
`audit_events` by foreign key; and the API addresses events by `id`
alone, which still resolves.

**3. Nothing references the ledger by foreign key — in either
direction.** `session_id` is a plain uuid rather than an FK to
`sessions`, because sessions are purged and an event whose session
vanished must keep the id it correlated on. And `incident_bookmarks`
holds `event_ids uuid[]` rather than a join table: an FK would now have
to carry both key columns, and an append-only ledger gains nothing from
referential integrity that an array does not.

**4. A DEFAULT partition exists, and it is not a formality.** Without
one, an insert whose timestamp falls outside every declared range fails —
and on the audit ledger a failed insert means an action that happened was
never recorded. Losing the event is strictly worse than filing it in a
catch-all. Twelve monthly partitions are created at migration time so a
fresh deployment has somewhere to write for a year; `create_audit_events_partition()`
is the function M30's job calls to stay ahead, and keeping the default
empty is that job's business.

**5. Both indexes on `occurred_at` are kept.** The B-tree serves
`ORDER BY occurred_at DESC`; the BRIN serves range scans at a fraction of
the size, which is the right shape for a table whose rows arrive in
timestamp order. They are complementary, not redundant.

### Consequences

**API.** None. Events are addressed by `id`.

**Database.** `audit_events` is `relkind = 'p'` with 12 monthly partitions
plus a DEFAULT. RM M28.5's retention test drops out-of-window partitions;
that test is now expressible.

**Backend services.** M28's audit writer must not assume a returning
single-column key. M30 owns partition creation.

**Testing.** The M5.10 spec asserts `relkind`, the partition set, that an
event routes into the partition for its month, that the BRIN index exists
with `amname = 'brin'`, and that no foreign key points at the table.

### Alternatives considered

| Alternative | Rejected because |
|---|---|
| Keep `PK: id` and drop partitioning | ADR-007 R2's retention mechanism becomes unimplementable — with no DELETE grant, nothing could ever leave the table |
| Partition, and make `id` a plain unique index instead of the PK | A unique index on a partitioned table has the same restriction: it must include the partition key |
| Partition by `id` instead, so the PK is unchanged | Retention is a *time* window. Dropping a hash partition would delete a random sample of every month |
| Omit the DEFAULT partition, so a gap fails loudly | On an audit ledger a failed insert loses the event. Loud failure is the right default almost everywhere else and the wrong one here |

---

## ADR-025 — The Mail Kernel, and the Auth Values No Source States

**Status:** Accepted · **Milestone:** M6 · **Date:** 2026-08-26 · **Amended:** 2026-11-10 — the OTP challenge window is 10 minutes, absolute from issue (owner decision A3 as clarified by C-11). No other value changes.

### Context

M6 implements the auth lifecycle against a contract that is unusually
complete: API §1 fixes eight error codes, two session TTLs, an attempt
limit, a 24-hour verification token and the exact `SessionUser` shape.
Almost every value the milestone needed was already written down.

Four were not, and one architectural gap had to be closed before the
first endpoint could send anything.

**The gap.** M6.1's verification email needs a sender. Auth is not the
only module that sends mail — notifications (M19) and reports (M21) do
too — and M2.2's zone 1 forbids any module importing another, so a
mailer inside `modules/auth` would be unreachable from either of them
without breaking the rule or duplicating the code.

**The four values.** MG §11.1-8 gives a lockout *count* and no duration.
API §1.3 bounds OTP *attempts* and does not say how long a step-up may
stay open. API §1.1 gives the verification token 24 hours and says
nothing about the reset token. DB §A9 has a `location` column and no
source names a geo-IP provider.

And one property of the contract is a disclosure, which is worth stating
rather than discovering later: API §1.2 asks for both "identical
timing/shape — no enumeration" *and* a lockout that answers 429. Only a
real account can be locked out.

### Evidence

| Source | Content |
|---|---|
| API §1.2 | "unknown email or bad password → 401 `invalid_credentials` (identical timing/shape — no enumeration)"; "lockout after `loginAttemptLimit` failures → 429 `rate_limited`" |
| MG §11.1-8 | The attempt limit. No duration anywhere in the guide |
| API §1.1 | Verification token, "TTL 24 h". No reset TTL stated |
| API §1.3–1.4 | "6-digit, bounded attempts", `/auth/otp/resend` "rate-limited". No window, no cooldown |
| `features/auth/pages/VerifyOtpPage.tsx`, `VerifyEmailPage.tsx` | `const RESEND_SECONDS = 30` in both, rendered as a countdown |
| ADR-019 §2 | The kernel is where a **port** lives when more than one module needs its implementation replaced later |
| DB §A9 | `login_events.location varchar(120)`; ADR-007 PD-5 already lists login events among the undecided retention categories |

### Decision

**1. `shared/mail` is the fifth kernel.** A `MAILER` token, a `Mailer`
interface of one method, and an SMTP implementation behind it. Unlike
the other four it ships working code rather than a stub, because an
account that cannot be verified cannot sign in — a stubbed mailer would
make M6.1 untestable and M6.6 pointless. `send()` **resolves on a
delivery failure**, matching `shared/audit` and deliberately unlike
`shared/files`: a registration that returns 500 because the relay is
down has turned a delivery dependency into an availability one, and the
account was created either way. API §1.10's resend is the user's
recovery path, which is why it exists.

**2. The resend cooldown is 30 seconds, transcribed.** Not chosen —
`RESEND_SECONDS = 30` is in both frontend pages and is rendered as a
countdown. A server that allowed a resend sooner would make that
countdown a lie; one that demanded longer would show an enabled button
that 429s. It is derived from the row's own timestamp rather than held
in memory, so it survives a restart and holds across instances.

**3. Four values are backend defaults, and are labelled as such.**

| Value | Default | Reasoning |
|---|---|---|
| Lockout duration | 15 minutes (`SECURITY_LOCKOUT_MINUTES`) | Long enough to make sustained guessing pointless, short enough that a locked-out clinician is not calling an administrator |
| OTP challenge window | ~~5 minutes~~ **10 minutes, absolute from issue** (amended 2026-11-10) | Long enough to open an authenticator and read a code that itself rotates every 30 seconds; short enough that a password-only compromise leaves no usable half-session lying around. **Amended 2026-11-10 (owner decision A3 / C-11):** the window is an owner decision, no longer a backend default. The deadline is fixed once, when the challenge is issued — written to `otp_codes.expires_at` and to the signed `otpToken`'s `exp` — and `/auth/otp/resend` replaces the code without extending it. After the deadline, verify, recovery-code redemption and resend answer `401 otp_invalid` and the user signs in again for a fresh challenge. The value is the code constant `OTP_CHALLENGE_TTL_SECONDS = 10 * 60` until `security.otpTtlMinutes` lands (ADR-007 PD-5, RM M24.2); the same constant bounds the Q7/R4 re-enrolment token |
| Password-reset TTL | 1 hour | Shorter than verification's 24 h **because the two links do different things**: one proves an address, the other *is* an account takeover in one click |
| OTP attempt bound | reuse `loginAttemptLimit` | The platform's existing answer to "how many tries". A second number would be a second thing an administrator has to find, and a second thing to get wrong |

All four are layered through `PolicyService` where they are policy, so
M24's panel can override them without touching an enforcement point.

**4. `login_events.location` stays null.** No source names a geo-IP
provider, and a guessed city on a security page is worse than a blank
one — it invites a clinician to dismiss a real alert because "that isn't
where I was". M19's provider decision is where it lands.

**5. The lockout 429 is an accepted disclosure.** An unknown address can
never produce one, so a 429 reveals that an account exists. The
alternative — per-address lockout state for addresses that do not exist
— is unbounded server state driven by an unauthenticated caller, which
is a denial-of-service surface traded for an enumeration one. The
contract asks for the lockout; we take it, and record the cost here
rather than leaving it unremarked. Everything *else* on that endpoint is
identical, including the decoy Argon2id verification that equalises the
timing of an unknown address.

### Consequences

**Architecture.** Five kernels, not four. `SharedKernelModule` and the
lint zone's `SHARED_PUBLIC_API` list both name mail; ADR-019 §3's
reasoning for `@Global` extends to it unchanged.

**Configuration.** Three new environment variables — `APP_PUBLIC_URL`
(the *frontend's* address; the API cannot derive the links in its own
emails), `DATA_ENCRYPTION_KEY` (M6.4's envelope key, separate from
`JWT_SECRET` so signing keys can rotate without making every stored
second factor undecryptable), and `SECURITY_LOCKOUT_MINUTES`.

**Later milestones.** M19 replaces the `MAILER` binding with the
templated, outbox-backed sender and decides the geo-IP question. M24
gains three policy fields it can surface. M31's Redis limiter
generalises the cooldowns; the auth resends did not need to wait for it.

### Residual items

- **RA-025.1** — Self-registration as an administrator is what the
  frontend's signup form offers (`signupSchema` lists `admin`), so it is
  what the endpoint accepts. Whether it should require an invitation
  belongs with M8.2, which owns the invite endpoint.
- **RA-025.2** — Recovery codes are generated, returned once and stored
  encrypted, and **no endpoint consumes one**. The contract has no route
  that accepts one and `/auth/otp/verify` is fixed at six digits.
  Carried to M8, which owns account recovery.

### Alternatives considered

| Alternative | Rejected because |
|---|---|
| Mailer inside `modules/auth` | Unreachable from notifications and reports without breaking zone 1 |
| Mailer as a stub, like `shared/files` | M6.1 and M6.6 would be untestable, and an unverifiable account cannot sign in |
| Throw on a delivery failure | A relay outage would fail registration for accounts that were created anyway |
| Invent a lockout duration silently | The next reader cannot tell a transcription from a guess. Labelling it costs one comment |
| A second `otpAttemptLimit` setting | Two numbers, one question, and an administrator who lowers one and not the other |
| Guess a location from the IP | A wrong city on a security page teaches users to ignore alerts |
| Pretend to lock out unknown addresses | Unbounded state driven by an unauthenticated caller — a worse hole than the one it closes |

---

## ADR-026 — Refresh Rotation Keeps One Generation, and the Row Is the Family

**Status:** Accepted · **Milestone:** M6 · **Date:** 2026-08-26

### Context

M6.3 requires that "reuse of a rotated token → 401 and the whole family
revoked". M5.2's `sessions` model was written with that in mind — its
comment says "M6.3 rotates the token on every refresh and detects reuse"
— but the columns it has cannot express it.

The problem is simple once stated. Rotation overwrites
`refresh_token_hash`. A replayed old token therefore matches no row and
is indistinguishable from a random string, so the very thing rotation
exists to make detectable is invisible.

Two shapes could fix it, and they differ in what a "family" means.

### Evidence

| Source | Content |
|---|---|
| RM M6.3 | "rotate; reuse detection revokes family; sliding expiry" |
| API §1.5 | "Rotates token (reuse of a rotated token revokes the whole session family); slides expiry" |
| `prisma/schema/03-identity.prisma` | "One row per refresh-token family… the stored value is a hash, so a database read cannot mint a session" |
| ADR-007 | Session retention is **90 days after expiry or revocation** (PD-4); the `retention.sessionDays` field that carries it lands at RM M24.2, so nothing prunes `sessions` yet |
| Measurement | A remembered session refreshing every 15 minutes for 30 days is ~2,880 refreshes |

### Decision

**One nullable column, `sessions.previous_token_hash`, and the row stays
the family.**

Rotation moves the presented hash into `previous_token_hash`, writes a
fresh one into `refresh_token_hash`, and slides `expires_at`. A token
that matches no live session is then looked up against the previous
hashes; a hit is a replay, and the session is revoked.

That covers the theft that actually happens. The attacker refreshes with
the stolen token, taking the new one; the real client's next refresh
presents the token it still holds; that presentation lands on the
previous hash. Either order works — whoever refreshes second is
detected, and revoking ends it for both, which is correct because by
then nothing distinguishes them.

**A token two or more rotations old is not detected.** That requires an
attacker who kept an older token, never used it, and waited through two
of the victim's refreshes. Catching it needs a chain, which needs a
second table for a case narrower than the one a single column already
covers.

**Rotation does not insert a row.** The alternative — a row per
rotation, linked by a family id — gives an exact family and costs ~2,880
rows per remembered user per month on a table nothing prunes. It also
makes "the user's active sessions" (API §2.4) a query over history
rather than a query over sessions.

The consequence is that "the family" is one login on one device. A
replay on the phone does not sign the user out of the workstation, which
is a narrower blast radius than the contract's wording implies and a
better outcome than the alternative reading, where one compromised
device ends every session the user has.

### Consequences

**Schema.** One migration on top of M5's eleven, adding a nullable,
uniquely-indexed `text` column. No table count change, no backfill —
a session that has never refreshed genuinely has no previous hash, and
NULL is the honest value. Postgres permits any number of NULLs under a
unique index, so the constraint costs nothing on rows that have not
rotated.

**Concurrency.** The rotation is conditional on the presented hash and
decided by the affected row count. Without that, two refreshes arriving
together would both read a live row and both rotate, leaving one client
holding a token overwritten a microsecond later — a spurious "reuse" on
its next refresh, and a logout for a user who did nothing wrong.

**Audit.** A detected replay writes an audit event with a **null actor**.
`shared/audit` defines that as "the system itself", which is right:
nobody is authenticated at that point, and attributing it to the account
whose session ended would read as though that user did it. The subject is
metadata.

**Later milestones.** M8.3's "revoke others" and M8.4's device list read
these rows unchanged. M30's retention sweep gains a table with bounded
growth.

### Alternatives considered

| Alternative | Rejected because |
|---|---|
| Insert a row per rotation, link by `family_id` | ~2,880 rows per user per month, and API §2.4's session list becomes a query over history |
| Keep a chain of previous hashes in a child table | A second table for a case one column already covers |
| Detect nothing; rely on the token's expiry | Discards the whole point of rotation — a stolen token would work for its full 30 days |
| Revoke every session for the user on a replay | One compromised device would sign a clinician out of every device mid-shift |
| Rotate in place with no history at all | The state M5.2's own comment promises would be undetectable |

---

## ADR-027 — The Authorization Core Is Built Ahead of Its Schema

**Status:** Accepted; implemented, premises overtaken · **Milestone:** M7 · **Date:** 2026-08-26

> **Note added 2026-08-30.** This ADR was written when M5 and M6 were unbuilt, and its
> Context describes that state accurately as of its date. Both have since landed, the four
> resulting collisions have been resolved, and the core it describes is now **switched on**:
> `AuthorizationGuard` runs globally after M6's `AccessTokenGuard`, every route carries a
> rule, and two of the three ports are bound to Prisma repositories against the real tables.
>
> The decision it records — build the decision core behind ports, ahead of its schema —
> stands, and the ports are what made switching on a matter of changing two `useClass` lines
> rather than a rewrite. Two of its consequences are stale: the adapters are no longer
> deferred, and M6 independently built a `@Public()` decorator, a request principal and a
> permission resolver whose overlap with this one had to be reconciled. What remains open is
> narrower than this ADR anticipated: a Redis cache, the audited reveal, and the §15 API.
>
> **This ADR is a dated record of a decision, not a description of the tree as it stands** —
> `backend/docs/BACKEND_IMPLEMENTATION_ROADMAP.md` §Milestone 7 is.

### Context

M7 is Authorization, and the roadmap is worked strictly in sequence. Its two predecessors are not built: M5 designs the ~110-table domain schema and M6 the authentication lifecycle, and at the branch point `backend/prisma/schema.prisma` is 80 lines of M4 conventions over two migrations. There is no `roles` table, no `users`, no `patient_doctor_assignments`, no `audit_events`, no JWT, and no Redis client in `package.json`.

So M7 as written cannot be finished. The question this ADR settles is what to do instead, and it is worth settling on paper because the answer decides the shape of the milestone rather than a detail inside it.

The observation that makes a third option available: **authorization has a pure decision core and an impure edge.** The core is a function — given a principal, a required capability and the current matrix, may this proceed? The edge is where those inputs come from. The core needs no database, and its inputs already exist in this repository in authoritative form, because the frontend shipped the entire authorization vocabulary at ADM-09 and the maskers at ADM-10.

### Evidence

| Source | Content |
|---|---|
| RM M7.1–M7.4 | Guards, permission resolution, `PatientScopeService`, masked projections, roles API |
| RM M5.1, M5.2, M5.6 | The tables M7 reads: role bundles, per-user overrides, care assignments |
| `frontend/src/types/auth/index.ts` | The 22-capability `Permission` union — the vocabulary itself |
| `frontend/src/features/admin/permissions.ts` | Platform roles, seeded bundles, lock rules, matrix repair |
| `frontend/src/utils/phi-mask.ts` | The five maskers M7.3 must match character-for-character |
| ARCHITECTURE_RECONCILIATION §5 | The five server rules M7 owes, already derived |
| `shared/audit/logging-audit.dispatcher.ts` | The precedent: a port with a placeholder, since M2.3 |
| `shared/files/unconfigured-file-storage.ts` | The same, for M25 |
| ADR-019 | Module boundaries are ports, enforced by lint |
| ADR-022 | Care scoping is service-layer in v1; RLS at M37 |
| ADR-013 | 401 is authentication only |

### Decision

**Build M7's decision core now, behind ports. Leave the adapters for M5 and M6. Do not close the milestone.**

**1. The core is built and tested.** The vocabulary, the matrix algebra and its locks, effective-permission resolution with per-user overrides, the cache contract and its invalidation, `@Can`/`@Roles`/`@Public` and the guard, `PatientScopeService`, and the PHI maskers with the masked projection.

**2. Three ports carry what does not exist yet**, each with a `Symbol` token and a placeholder implementation: `ROLE_REPOSITORY` (M5.1, M5.2), `PERMISSION_CACHE` (Redis, M6/M19), `PATIENT_ASSIGNMENT_REPOSITORY` (M5.6). This is not a new pattern — it is the pattern `src/shared/` exists for, and `AUDIT_DISPATCHER` has held the same contract since M2.3.

**3. No placeholder may widen access.** `SeededRoleRepository` serves exactly the bundles the frontend ships and reports no overrides, so nothing is reachable through it that would not be reachable from an unedited matrix. `UnassignedPatientAssignments` **denies every query**: a permissive assignments stub would make every scoping test pass while proving nothing, and would ship as an open door if the M5.6 swap were missed.

**4. The transcriptions are proven, not trusted.** The catalogue and the maskers are re-typed from frontend sources, and two parity specs load those sources across the tree boundary and compare. The backend CI job's trigger paths are extended to the three files, because a parity test that does not run on the change that breaks it is not a guard.

**5. The guard denies an unmarked route.** The common default admits it. In a system whose rows are medical records, that turns a forgotten decorator — the likeliest authorization mistake anyone will make here — into a disclosure no test fails on. `@Public()` is the deliberate, greppable opt-out.

**6. The kernel speaks `PlatformRole`, not `types/auth`'s coarse `Role`.** See RA-027.1 in the open-items table above.

**7. The milestone stays open.** Every M7.x checkbox remains `[ ]` and the roadmap carries a table of what is deferred and on what. A checked M7 would tell M8 that routes are guarded when none are.

### Consequences

**API.** None. No endpoint is added, and no existing response changes.

**Database.** None directly, but the ports fix the shape M5 must satisfy: `role_permissions` and `user_permissions` must support a two-sided override (grant and revoke) per user, and `patient_doctor_assignments` must answer "is this doctor assigned to this patient" by user id, not by name (ADR-003, ADR-022).

**Backend services.** M8 onward can write `@Can('…')` on a controller and have it mean something the moment M6 attaches a principal. The guard is provided but deliberately **not** registered as a global `APP_GUARD` yet: with deny-by-default and no `@Public()` annotations on the health module, doing so now would break M1's probes. M6 registers it globally in the same commit that supplies a principal.

**Frontend integration.** None yet. When it arrives, the server's answers already agree with `useCan()` by construction, because both read the same catalogue.

**Testing.** 368 tests green at the close of this milestone, up from 98. The exit-gate harness is table-driven so a new guarded route is one row.

**Security posture, stated plainly.** Nothing is enforced in production by this work, because nothing is served. What it buys is that the enforcement, when it is switched on at M6, is already correct and already tested — rather than being written under the time pressure of the milestone that needs it. The accepted risk is the ordinary one of building against an interface before its implementation: if M5's schema cannot satisfy a port, the adapter absorbs it, and if it cannot, this ADR is revisited.

### Alternatives considered

| Alternative | Rejected because |
|---|---|
| Do M5, then M6, then M7, in order | The correct answer if the roadmap's order were the only consideration, and it remains the plan for the *adapters*. But it makes "start M7" mean "start M5" — eleven sub-steps and ~110 tables before a line of authorization code exists — and M5 is the milestone most likely to be revised by the unverified external database of V-15/V-16 |
| Build all of M7 against a scratch schema invented now | A schema designed to make M7 compile would be designed twice and thrown away once, and the second design would land at M5 under pressure to match the first. The ports commit to far less |
| Write only the spec and the plan, implement nothing | Leaves the frontend's shipped vocabulary untranscribed and unproven for another two milestones, which is precisely the period in which it will drift unnoticed |
| Put the guard in `src/modules/auth/` | ADR-019's boundary rules forbid a module importing a sibling, and every module needs the guard. It would have to be the one module everybody imports, which is the cycle the shared kernel exists to break |
| Let the assignment placeholder permit | Would make the scoping suite green and vacuous, and would fail open rather than closed if the M5.6 swap were ever missed |

---

## ADR-028 — `scheduled_reports.recipients` Is `text[]`, Not `citext[]`

**Status:** Accepted · **Milestone:** M5.9 (corrective) · **Date:** 2026-09-01

### Context

DB §I2 types `scheduled_reports.recipients` as `citext[]`, and the column shipped that way. The intent is sound and consistent with the rest of the schema: recipients are email addresses, `users.email` is citext, and `Doctor@medora.health` and `doctor@medora.health` are one recipient rather than two deliveries.

The column as typed cannot be read.

### Evidence

Reproduced against the shipped column definition, at the versions this repository pins (`prisma` 7.9.1, `@prisma/client` 7.9.1, `@prisma/adapter-pg` 7.9.1), with a `text[]` control identical in every other respect:

```
READ  citext[] -> FAILED: TypeError: e.map is not a function
WRITE citext[] -> FAILED: TypeError: e.map is not a function
READ  text[]   -> OK [["doctor@medora.health"]]
WRITE text[]   -> OK ["ops@medora.health"]
```

| Fact | Detail |
|---|---|
| Where it throws | `@prisma/client-engine-runtime` `interpreter/data-mapper.ts`, mapping the result row |
| Cause | `node-postgres` parses an array only for OIDs it has a registered parser for. `citext[]` is an extension type with a dynamic OID, so the driver returns the raw literal `{a@b.com}` and the mapper calls `.map` on a string |
| It is the **read** path | A row inserted by raw SQL — never touched by Prisma's writer — fails identically. `create()` fails with it because it reads the row back |
| Scope | Scalar **lists** only. Every scalar `@db.Citext` works: `users.email`, `login_events.attempted_email`, `doctors.contact_email`, `staff_members.email`, `patients.email`, `_conventions_reference.label`. **`recipients` is the schema's only citext array** |
| Why CI was green | The only test touching this table asserted that an *empty* recipient list is rejected. It rejects at the CHECK, so no row is ever returned and the read path is never exercised |

### Decision

**`recipients` is `text[]`.** The case-insensitive comparison moves from the column type to a normalisation rule: recipients are stored lower-cased by the endpoint that writes them (RM M21.5).

Four things this deliberately does not do:

1. **It does not keep `citext[]` and mark the field `Unsupported`.** That yields a column Prisma can neither read nor write — a schedule the scheduler cannot read is not a schedule.
2. **It does not register a custom type parser on the driver adapter.** Resolving an extension type's OID at connection time and patching the shared adapter, for one column, would be the least legible dependency in the platform — and every future query would carry it.
3. **It does not normalise `recipients` into a child table.** That solves the comparison and costs a join on every read of a list the UI renders as chips. DB §I2 deliberately keeps it an array.
4. **It changes no other column.** The limitation is arrays; the six scalar citext columns are exercised by the identity suite and are unaffected.

### Consequences

**API.** None. §12.4's scheduled-report shapes carry `recipients: string[]` and are unchanged.

**Database.** The `NOT NULL` and the `scheduled_reports_has_recipients` CHECK are unchanged. The migration is a metadata-only `ALTER … SET DATA TYPE TEXT[]`: citext and text share a representation, and no row has ever been stored, so there is nothing to convert.

**Backend services.** RM M21.5 gains one obligation: lower-case each recipient on write. Recorded as RA-028.1 so it is not rediscovered as a duplicate delivery.

**Frontend integration.** None. The reports feature reads and writes plain strings.

**Testing.** The gap that let this ship is closed rather than the symptom patched. `test/schema-communication.e2e-spec.ts` now **stores a schedule and reads its recipients back** — the round trip, not just the insert — so a regression to `citext[]` fails immediately with the same `TypeError`. Verified in both directions: the new tests are red against the old column type and green against the new one. A second test pins the consequence, asserting that a recipient now matches case-sensitively, which is what makes M21.5's lower-casing load-bearing rather than cosmetic.

### Alternatives considered

| Alternative | Rejected because |
|---|---|
| Keep `citext[]`, mark the field `Unsupported()` | The column becomes unreadable *and* unwritable through the client |
| Keep `citext[]`, read the column through `$queryRaw` everywhere | One column with a bespoke access path forever, and every future join or `include` on `scheduled_reports` has to remember it |
| Register a `citext[]` parser on the pg adapter | Would work, and would hide a global driver mutation behind one column's type |
| A `scheduled_report_recipients` child table | A join on every read to recover a comparison the API can do at write time; a schema change DB §I2 does not ask for |
| Wait for a Prisma fix | The behaviour is in how the driver parses extension-typed arrays. There is no version to name and nothing to wait for |

### Residual ambiguity

**RA-028.1 — Recipient normalisation is owed by RM M21.5.** Storing addresses lower-cased is the whole of what replaces the column type. Until that endpoint exists nothing writes recipients, so there is no window in which duplicates can be created.

---

## ADR-029 — Naming Vocabularies: Conversation Kinds, Notification Channels, Roles and Broadcast Channels

**Status:** Accepted · **Milestone:** M5.1/M5.9 (retrospective) · **Date:** 2026-09-02

### Context

The reconciliation sweep (`docs/ARCHITECTURE_RECONCILIATION.md` §2) left four naming conflicts open: **C-14** conversation kinds, **C-15** notification channels, **C-16** role vocabularies, **C-20** `broadcast_channels`. All four land in M5.1's lookup migration or M5.9's communication tables, and the sweep said three of them had to close before schema work.

The schema then shipped, and all four were in fact settled — in the migrations, the enums and the seed. **None of the four was ever written down as a decision.** Two loose ends record that gap explicitly:

| Loose end | Where |
|---|---|
| "`reception`, `laboratory`, `pharmacy`, `nurse` … resolve through the same `roles` table (**ADR pending under A-17**)" | ADR-017 §6 |
| "`NotificationChannel` is defined twice with different spellings … The DB spelling governs. **Outside M0.2's seven decisions**; added to the M0.1 drift register" | ADR-022, incidental-drift row |

This ADR closes all four against the tree as built. It is retrospective: it records decisions the implementation already embodies, so the register stops disagreeing with the schema. Nothing here changes code. None of the four needed product authority; each resolves from documented sources.

### Evidence

Read from the current schema and seed rather than from the sweep's description of them:

| Claim | Verified against |
|---|---|
| `conversation_kind` carries four values | `prisma/schema/01-enums.prisma` — `DIRECT`, `GROUP`, `ANNOUNCEMENT`, `SYSTEM` |
| `notification_channel` carries five | same file — `EMAIL`, `SMS`, `PUSH`, `DESKTOP`, `IN_APP @map("inApp")` |
| The five channels are real columns | `NotificationPreference` — `channel_email`, `channel_sms`, `channel_push`, `channel_desktop`, `channel_in_app` |
| Six roles are seeded, `nurse` with an empty bundle | `prisma/seed/permissions.ts` — `ROLES`; asserted in `shared/authz/seed-parity.spec.ts` |
| Alias spellings are not roles | `seed-parity.spec.ts` — "does not seed the alias spellings as separate roles" (`receptionist`, `pharmacist`, `patient`) |
| `broadcast_channels` is not a table | `prisma/schema/10-communication.prisma` header comment, quoting DB §G8 |

### Decision

**1. `conversation_kind` is `direct | group | announcement | system`** (C-14). DB §6's four. The frontend's `ConversationKind` (`shared-domain/conversations/types.ts:20`) declares three, omitting `group`; that is a **narrowing, not a disagreement** — the same relationship ADR-001 established for `ProfileAppointmentStatus`. The messaging module distinguishes group threads by `conversation_participants` cardinality rather than by a kind discriminator, so the fourth value has no consumer in that view today. The DB is authority for the column, and the distinction is unrecoverable once conversations exist.

**2. `notification_channel` is `email | sms | push | desktop | inApp`** (C-15). Not a compromise: `notifications/model/types.ts` and DB §6 **already agreed exactly**, and the column follows them.

`admin/appointments/oversight.types.ts:49` declares a four-value `NotificationChannel` spelled `'in-app'` and omitting `desktop`. **It is not a competing definition of the same thing.** It is a feature-local display type labelling per-party delivery receipts in the ADM-05 drawer — the same category as the three same-named `ChatMessage` types that C-17 already decided *not* to unify. The backend models one channel enum; the drawer's label set maps onto it. No frontend change is required and none is requested. This discharges the drift ADR-022 logged and left open.

**3. One `roles` table, keyed on the `PLATFORM_ROLES` vocabulary, with aliases** (C-16). This discharges ADR-017 §6's pending A-17. `permissions.ts` is rank-1 code and carries the capabilities, so it is canonical. Three unions exist and only one of them is a role vocabulary:

| Source | Values | What it is |
|---|---|---|
| `PLATFORM_ROLES` | admin, doctor, reception, laboratory, pharmacy | **the permission-bearing vocabulary** — the ADM-09 matrix columns |
| `StaffRole` | doctor, nurse, receptionist, laboratory, pharmacy | clinic staffing roster |
| `ContactRole` | doctor, nurse, pharmacist, patient | messaging directory display |

The other two **map onto** the first rather than competing with it:

| Source value | Resolves to | Note |
|---|---|---|
| `StaffRole.receptionist` | `reception` | same role, staffing spelling |
| `ContactRole.pharmacist` | `pharmacy` | same role, directory spelling |
| `StaffRole.laboratory` / `pharmacy` | identical | — |
| `StaffRole.nurse` | `nurse`, seeded with **no** bundle | ADR-017 §6 puts it in `roles`; the ADM-09 matrix has no nurse column, so no source says what a nurse may do. An empty bundle is the fail-closed reading |
| `ContactRole.patient` | *not a user* | ADR-018 §3 — patients are records |

So **six roles are seeded, not five**: the five permission-bearing ones plus `nurse` holding nothing. `receptionist`, `pharmacist` and `patient` are deliberately absent — seeding any of them would create a second role holding nothing. `staff_members.role` and the messaging directory keep their own display values; only `users.role_id` references `roles`. **No frontend union changes.**

**4. `broadcast_channels` is not a table** (C-20). The sweep carried it as an entity with no contract endpoint, "surfaces at M20". The schema settled it the other way, and DB §G8 settles it in its own words: announcement and system channels are "physically representable as `conversations` rows with kind announcement/system; kept as a logical entity". A second table would be the same columns under a different name, and every message query would then have to union two of them. The entity stays logical; `ConversationKind`'s `announcement` and `system` are how it is served.

### Consequences

**API.** No contract change. No response shape changes. The absent `broadcast_channels` endpoint is not a gap to fill — there is no table to expose.

**Database.** Already built: `conversation_kind` four values, `notification_channel` five, `NotificationPreference`'s five boolean columns, six seeded roles. This ADR adds no migration.

**Backend services.** Alias resolution is a seed-time property rather than a runtime resolver: because `receptionist` and `pharmacist` are never seeded as roles, neither can reach an authorization check as a distinct principal. Nurse accounts exist as staff carrying no capability bundle until a product decision gives them one — that absence is deliberate, not an oversight.

**Frontend integration.** Nothing breaks. Two frontend unions are narrower than the server's and widen when a view needs it, matching the pattern ADR-001 established.

**Testing.** Already covered: `seed-parity.spec.ts` asserts the six role codes, the empty nurse bundle, and that the three alias spellings are not seeded. `schema-communication.e2e-spec.ts` exercises the conversation and notification-preference columns.

### Alternatives considered

| Alternative | Rejected because |
|---|---|
| Treat `oversight.types.ts:49` as a conflicting channel enum and reconcile all three | It is a display type in a feature module, not a DB column. C-17 already established that a shared type name across modules is deliberate locality, not drift |
| Drop `group` to match the frontend's three values | The DB is authority for the column, and losing the distinction is unrecoverable once conversations exist |
| Three separate role tables | Three authorization vocabularies for one question — exactly what DB §14.5-7 says to resolve |
| Seed `receptionist` and `pharmacist` as their own roles | Two more roles holding nothing, and two more spellings that could reach an authorization check |
| Give `nurse` a capability bundle now | Inventing a permission set for a role with no frontend workflow, which no source describes |
| Build `broadcast_channels` as a table | DB §G8 explicitly says not to, and every message query would have to union two identical shapes |
| Leave all four unrecorded, since the schema already implements them | The register would keep contradicting the tree, and ADR-017 §6's "ADR pending" would stay pending forever |

### Residual ambiguity

**RA-029.1 — the two frontend narrowings are unversioned.** `ConversationKind` (3 of 4) and the oversight channel label set (4 of 5) are correct today because neither view needs the missing value. Nothing fails if the server widens and the frontend does not follow; the value simply never renders. Owned by M39.

## ADR-030 — Patient Identity and Authentication

**Status:** **Accepted** — project owner, 2026-09-02. Implemented in the same pull request; see *Implementation* below.
**Supersedes in part:** ADR-018 §3 (and only §3 — §1 single-clinic, §2 billing-off and §4 mobile-readiness are untouched and remain Accepted).
**Raised by:** `patient-app/PATIENT_APP_AUDIT.md` §4.1/§15.4 as **AD-1**, the blocker named as blocking "everything".
**Milestone:** would open a Patient Mobile enablement sequence ahead of M8; see `backend/docs/PATIENT_MOBILE_ENABLEMENT.md`.

### Context

ADR-018 §3 records an owner decision of 2026-08-12: **"Patients are records, not authenticated users."** It is not a comment; it is load-bearing, and this ADR was written only after verifying every place it is enforced against the tree at `e14bd7f`:

| Enforcement point | Verified content |
|---|---|
| `backend/prisma/schema/03-identity.prisma:29` | `User` docblock — "Patients are not users — ADR-018 §3" |
| `backend/prisma/schema/05-patients.prisma:35` | `Patient` docblock — "no credential row, no session, and no role for this entity" |
| `backend/prisma/schema/05-patients.prisma` | **No `user_id` column exists.** Confirmed by column-by-column read |
| `backend/src/modules/auth/dto/register.schema.ts:45` | `role: z.enum(['doctor', 'admin'])` — a patient cannot register |
| `backend/prisma/seed/permissions.ts:143` | "`patient` — ADR-018 §3 … There is no patient role in the session model" |
| `backend/prisma/seed/permissions.ts:146` | `ROLES` seeds six codes; `patient` is not among them (seed run confirms `roles 6`) |
| `backend/src/shared/authz/seed-parity.spec.ts:104` | `expect(codes).not.toContain('patient')` — a **test asserts the absence** |
| `backend/test/schema-reference.e2e-spec.ts:181` | `it('has no patient role — patients are records, not users (ADR-018)')` |
| `backend/prisma/schema/10-communication.prisma:54` | `ConversationParticipant.userId → User` — a patient cannot join a thread |
| `backend/prisma/schema/10-communication.prisma:229` | `Notification` recipient is a `User` — a patient cannot receive one |
| `backend/prisma/schema/10-communication.prisma:313` | `AiConversation` owner is a `User` — a patient cannot hold an AI session |
| `docs/DECISIONS.md:2293` (ADR-029 §3) | "`ContactRole.patient` → *not a user* — ADR-018 §3" |

**Two things have changed since 2026-08-12.**

**First, the consumer now exists.** ADR-018 §3's own stated rationale for the boundary was: *"What is avoided: an authentication surface with no consumer."* The Patient Mobile Application is now an active workstream in this repository — `patient-app/` was merged to `main` at `e63e09a` (PR #85) carrying a 759-line audit and a 465-line delivery checklist. The premise the decision rested on has expired. ADR-018 §3 was not wrong; it is now out of date, which is a different thing and is what an amending ADR is for.

**Second, the repository already contradicts itself, and nobody has had to notice.** `UX_ARCHITECTURE.md` §3.4 and `BACKEND_API_CONTRACT.md` §4.11 both specify administrator governance of **patient accounts** — `POST …/unlock`, `POST …/reset-credentials` ("sends secure reset — admin never sets a password directly"), `POST …/deactivate`, all under `can:patients.manageAccounts`, which is a **seeded admin capability today** (`permissions.ts`, admin bundle). An account that can be *unlocked* and whose *credentials* can be *reset* is an account with credentials. ADR-018 §3 says patients have no credentials. Both statements are in the repository and they disagree. The contradiction has been dormant only because neither surface is built. The patient app is what forces it to be resolved, and this ADR resolves it in the direction the rest of the specification already assumes.

ADR-018 §3 also names, in its own "What is preserved" clause, the two anchors a patient login would use: `patient_doctor_assignments` as "the care-relationship anchor a future patient login would scope against", and the appointment state machine that "already models patient-facing states". **ADR-018 anticipated this migration. It did not forbid it.**

### Evidence

| Source | Content |
|---|---|
| ADR-018 §3 | "No patient authentication, no patient portal, no patient role in the session model" — the decision being amended |
| ADR-018 §3, *What is preserved* | Names `patient_doctor_assignments` as the anchor "a future patient login would scope against" |
| ADR-018 §4 | "Mobile readiness is not deferred with them" — the transport was built for this client |
| API §4.11 | Patient account `unlock` / `reset-credentials` / `deactivate` under `can:patients.manageAccounts` |
| UX §3.4 (line 518) | "unlock, reset credentials (sends secure reset — admin never sets a password directly), deactivate" for patient accounts |
| `PATIENT_APP_AUDIT.md` §4.1 | Options A / B / C, with A recommended |
| `PATIENT_APP_AUDIT.md` §15.4 AD-1 | "Amend ADR-018 §3 via a new ADR-030" |
| `10-communication.prisma:54,229,313` | Three FKs that already point at `User` and would need **no change** under Option A |
| `permission-catalogue.ts:20–36` | `PLATFORM_ROLES` is five roles and is **a transcription of the frontend** |
| `permission-catalogue.spec.ts` | Loads `frontend/src/features/admin/permissions.ts` and asserts equality |
| ADR-029 §3 | Six roles are seeded, not five: `nurse` holds a role code with **no matrix column** — the precedent this ADR reuses |
| `auth.controller.ts:285`, `auth-refresh.e2e-spec.ts:250` | `X-Client-Type: mobile` refresh-in-body — built and tested |

### Decision

**Adopt Option A of the audit: a nullable, unique `patients.user_id` foreign key, a `patient` role that carries no permission-matrix column, and authentication through the existing M6 lifecycle unchanged.**

Ten sub-decisions follow. They answer, in order, the twelve questions the enablement brief requires an ADR-030 to answer.

---

#### 1. The relationship is `User (role = patient) 1 ── 0..1 Patient`

```
users                                    patients
─────                                    ────────
id            ◀───────────────────────── user_id   (uuid, NULL, UNIQUE, FK)
role_id → roles.code = 'patient'         public_id "PT-…"
email  citext UNIQUE  ← the login        mrn
                                         email  ← a CONTACT field, never a login
```

One account maps to at most one clinical record; one clinical record maps to at most one account. `UNIQUE` on the FK column gives both halves in one constraint.

**`patients.email` is not touched and does not become a login.** It is nullable, non-unique and clinician-entered. `users.email` is `citext UNIQUE` and is the sole credential identifier. The two are never joined implicitly — see §6, which is the security core of this ADR.

#### 2. `patients.user_id` is NULLABLE, and that is the load-bearing choice

Three reasons, in decreasing order of importance:

1. **Clinical records legitimately have no account, and always will.** A patient is registered at the front desk by a clinician (`POST /patients`, API §4.2). That record must be complete and usable the moment it is created, before the person has ever downloaded an app — and for the many who never will. A `NOT NULL` column would make an account a precondition for receiving care, which is backwards.
2. **A `NOT NULL` column would force a backfill, and the backfill is the exact hazard.** Filling `user_id` for existing rows means inventing an account per patient or matching on `patients.email` — and matching on email is precisely the auto-link that §6 forbids, applied to every existing row at once. A nullable column has **no backfill step**, which is why this migration cannot mismatch a person to a record.
3. **Postgres `UNIQUE` permits unlimited NULLs.** So one nullable unique column expresses "every linked record is linked to a different account, and unlinked records are unconstrained" exactly, with no partial index and no trigger.

#### 3. Existing patient records without an account are entirely unaffected

They keep `user_id = NULL`. Nothing about them changes: not their id, not their satellites, not their care assignments, not a single doctor- or admin-facing response. They are simply not reachable through the patient API, because every `/me/*` route resolves the caller's `users.id` to a patient row **through `user_id` and through nothing else**. A record with no account has no `/me` view by construction, not by a filter someone has to remember to write.

#### 4. Registration creates an account, and deliberately does NOT create or link a clinical record

`role` in `register.schema.ts` widens from `doctor | admin` to `doctor | admin | patient`. A patient registration produces a `User` with `role = patient`, an unverified email, a verification mail, and **`patients.user_id` still NULL everywhere** — the new account is linked to nothing.

This is not an omission; it is the decision. **Account creation and record claiming are two different problems with two different risk profiles, and fusing them is how PHI gets disclosed to the wrong person.** Registration is a self-service form. Claiming asserts "I am the person in record PT-1042", and a wrong assertion discloses one person's medical history to another (audit R-2, severity Critical).

Consequently a freshly registered patient account is **authenticated but unlinked**: it can log in, refresh, change its password, manage 2FA and read its own (empty) profile. It cannot see appointments, records, labs or notifications, because it is not yet anybody's record. That is the correct and safe resting state, and it is enough for the mobile client to build and ship its entire authentication, navigation and profile surface.

**The claim/linking flow is explicitly deferred to its own decision** (recorded as **RA-030.1** below). This ADR neither designs nor authorises it. Options that must be weighed there — a clinic-issued claim code, staff-mediated linking at the desk, or MRN + date-of-birth + an OTP to the phone **already on the clinical record** — differ in identity-proofing strength, and none of them may be chosen by a backend engineer alone. Auto-linking on email alone is ruled out here and now.

#### 5. Login, refresh, logout and recovery are unchanged — nothing is added

Patients use `POST /auth/login`, `/auth/otp/verify`, `/auth/refresh`, `/auth/logout`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email` and `/me/password` exactly as doctors and admins do. **No second authentication mechanism is created**, which is the whole reason Option B was rejected. Argon2id, the lockout counter, the anti-enumeration timing, `login_events`, session rows, refresh rotation with reuse detection and family revocation (ADR-026), and the `X-Client-Type: mobile` token-in-body variant (ADR-014) all apply to patients on the day the role exists, because none of them inspects the role.

#### 6. Authorization: `patient` is a role WITHOUT a permission-matrix column

**This is the sub-decision that a reader should check most carefully, because the obvious implementation is wrong and the repository will not stop you.**

The obvious move — add `'patient'` to `PLATFORM_ROLES` and give it a capability bundle — is **not available**, for two independent reasons:

1. **`PLATFORM_ROLES` is not a definition. It is a transcription.** `permission-catalogue.ts:8–14` says so: *"This file is a transcription, not a definition. The source of truth is the frontend."* `permission-catalogue.spec.ts` loads `frontend/src/features/admin/permissions.ts` at runtime and asserts equality, and `.github/workflows/ci.yml` runs the **backend** suite when that frontend file changes, precisely so the agreement cannot rot. Adding a sixth role to the backend union fails that spec. Making it pass would require editing the frontend — which the patient-mobile enablement brief forbids, and which would be wrong anyway.
2. **The matrix is the ADM-09 *administrator* matrix.** Its five columns are the staff roles an administrator edits in the permissions panel (UX §3.9). A `patient` column would put every patient in the world into the clinic's staff-permission editor as a grantable principal — an administrator could then tick `records.edit` for "patients". The 22 capabilities are clinician capabilities; not one of them describes anything a patient does.

**The precedent already exists and is documented.** ADR-029 §3 established that the `roles` table and the permission matrix are different vocabularies of different sizes: *"six roles are seeded, not five"* — `nurse` holds a role code with no matrix column, and `bundleFor('nurse')` returns `[]`. `authz.types.ts` explains the design in its own words: `Principal.roleCode` is *"a plain string, not `PlatformRole`, and that is the point"*, with a fail-closed lookup behind it.

**So `patient` becomes the seventh row of `roles` and the sixth bundle-less role, and patient authorization is ownership-based rather than capability-based.** Three consequences, all of them good:

- **Every `@Can(...)` route in the platform is closed to patients on day one, for free.** A patient principal resolves to zero capabilities, so every existing and future clinician route denies them without a single line being written. Deny-by-default (ADR-027) does the work.
- **`@Roles()` stays typed to `PlatformRole`** and therefore *cannot name* `patient` — which is correct, because a route must never be authorised by "is a patient" alone. It is authorised by "is this patient, acting on their own row".
- **Ownership is a service, not a decorator argument.** A `PatientSelfScopeService` resolves `users.id → patients.id` through `user_id`, mirroring `PatientScopeService` (M7.2) — including its **404-never-403** discipline, so a patient walking `/me/appointments/APT-…` over ids learns nothing about which ids exist.

Patient routes are therefore marked `@Authenticated()` plus an explicit patient-self marker, and the ownership check is the authorization decision. `AuthorizationGuard`'s deny-by-default and `authz-matrix.e2e-spec.ts`'s walk of the route table both continue to apply unchanged.

#### 7. Notifications, messaging and AI need NO schema change at all

This is the decisive practical advantage of Option A over Option C and the reason the audit recommends it.

| Table | Column | Effect once the patient has a `User` row |
|---|---|---|
| `notifications` | `recipient_id → users.id` | A patient receives notifications. **No change** |
| `conversation_participants` | `user_id → users.id` (PK half) | A patient is a thread participant with real per-viewer state — unread, pinned, archived, `last_read_at`. **No change** |
| `messages` | `author_id → users.id?` | A patient authors messages. **No change** |
| `ai_conversations` | `user_id → users.id` | A patient owns an AI conversation. **No change** |
| `notification_preferences` | `user_id` PK | A patient has channel preferences. **No change** |

*(Correction, 2026-09-02: this table first named the notification recipient column `user_id`. It is `recipient_id`, verified at `10-communication.prisma:229`. The substance is unchanged — it references `users.id`, so a patient with an account is a valid recipient — but the column name was wrong and is fixed here rather than left for a reader to trip over.)*

The three `patient_id` columns on `conversations`, `notifications` and `ai_conversations` keep their existing meaning: **bound clinical context, not membership.** ADR-029 and the schema headers are explicit that `conversations.patient_id` is what makes a thread *about* a patient; it never was and does not become how a patient *joins* one. Membership is and remains `conversation_participants.user_id`.

Option C (guest/OTP booking, no account) cannot reach any row in that table, which is why it kills records, messaging, notifications and AI history — most of the product.

#### 8. The migration is additive, reversible and cannot destroy data

One migration, three statements in effect: add `user_id uuid NULL`, add the FK to `users(id)` with `ON DELETE SET NULL`, add a `UNIQUE` constraint. No backfill. No column drop. No type change. No data movement. No rewrite of an existing row.

`ON DELETE SET NULL` rather than `CASCADE` is deliberate and follows DB §7: **PHI is never hard-deleted.** Users are deactivated rather than deleted, but if a `users` row ever were removed, the clinical record must survive it and revert to unlinked. `CASCADE` there would delete a patient's entire medical history because their app account went away, which is the single worst outcome available in this file.

Rollback is `DROP CONSTRAINT` + `DROP COLUMN`, and it loses only the links themselves.

#### 9. Doctor and administrator behaviour does not change

No existing column, route, guard, DTO, seeded role or capability bundle is modified. The five matrix roles keep their exact bundles; `permission-catalogue.ts` is not edited, so the frontend parity spec keeps passing unchanged. Nothing that authorises a clinician consults `patients.user_id`.

**Two existing tests must change, and their change is the point rather than a casualty:** `seed-parity.spec.ts:104` (`expect(codes).not.toContain('patient')`) and `schema-reference.e2e-spec.ts:181` (`'has no patient role — patients are records, not users (ADR-018)'`) both assert the absence this ADR removes. They must be **inverted, not deleted** — rewritten to assert that the `patient` role exists, is seeded, and holds an empty bundle. Those two inversions are the visible, greppable signal that ADR-018 §3 was amended by a recorded decision rather than eroded by a commit, and a reviewer who sees them changed with no ADR reference should reject the change.

#### 10. Patients must never receive the internal Doctor entity

`doctors` carries `license_number`, `license_expires_on`, `employee_id`, `contact_email`, `contact_phone`, `emergency_contact_name`, `emergency_contact_phone` and `linkedin_url`. `GET /doctors` (API §3.4) is an **administrator roster** gated on `can:doctors.manage` and must not be reused as a patient-facing list.

A **separate server-side projection** is required, with a contract test that fails if any forbidden field appears in a patient response body. Hiding fields in a React Native screen is not a control — the data is on the wire either way. The projection additionally defaults to `verification_status = 'verified'` and an active practice status: showing an unverified or suspended practitioner to a patient is a **safety** property, not a filter preference.

### Consequences

**API.** `role` accepts `patient` at `POST /auth/register`. A `/me/*` patient surface becomes definable; its contract is specified ahead of implementation in `backend/docs/PATIENT_MOBILE_API_CONTRACT.md` so the mobile client can build against a stable shape. No existing route changes shape. `GET /auth/session` (API §1.11, M8.1) remains specified-and-absent and is needed by the mobile cold-start path.

**Database.** One additive migration. `patients` gains one nullable unique FK. 107 tables become 107 tables.

**Backend services.** One new scope service (`PatientSelfScopeService`), mirroring M7.2's care-scope service and its 404-not-403 rule. No change to `PermissionResolver`, `AuthorizationGuard`, `PatientScopeService`, or any auth service.

**Frontend integration.** The doctor/admin SPA is untouched: no frontend file changes, and `PLATFORM_ROLES` on both sides stays five. The patient mobile client gains a real authentication target.

**Security.** The claim flow is the residual risk and is deferred deliberately (RA-030.1). Rate limiting does not exist anywhere in the backend today and must land before any public or patient route ships (audit BE-17/R-9). `InMemoryPermissionCache` remains per-process (M7.1 unticked); a mobile population makes multi-instance deployment likelier and brings Redis forward.

**Testing.** Required before this ADR may be considered implemented: patient registration accepted; `patient` role seeded with an empty bundle; the `users ↔ patients` relation and its uniqueness; patient login, refresh (`X-Client-Type: mobile`), logout; an unauthenticated `/me/*` request → 401; a **patient reaching any `@Can(...)` clinician route → denied**; patient A reaching patient B's data → 404 (never 403); an unlinked account resolving to no clinical data rather than to someone else's; doctor and admin authorization proven unchanged against the pre-change baseline (804 tests, 44 files, green at `e14bd7f`); and a Doctor-DTO contract test asserting the eight internal fields above are absent from every patient-facing response.

### Alternatives considered

| Alternative | Rejected because |
|---|---|
| **B — a separate `patient_accounts` table** with its own credentials and sessions | Duplicates the whole of M6: two password policies, two lockout counters, two token families, two audit trails, two places to get Argon2id wrong. The enablement brief forbids a second auth system, and the three `user_id` FKs in §7 would still not accept a patient |
| **C — no patient login; guest/OTP booking only** | Smallest change and ADR-018 §3 would stand — but it cannot reach `notifications`, `conversation_participants` or `ai_conversations`, so it deletes health records, messaging, notifications and AI history from the product. It solves the ADR by deleting the requirement |
| Add `patient` to `PLATFORM_ROLES` with a capability bundle | Breaks `permission-catalogue.spec.ts` against the frontend source of truth, requires a forbidden frontend edit, and puts patients into the administrator's staff-permission matrix as grantable principals. §6 |
| `patients.user_id NOT NULL` | Makes an app account a precondition for receiving care, and forces a backfill that must guess which account belongs to which record — the exact identity-proofing hazard this ADR exists to avoid. §2 |
| Auto-link account to record on matching email | `patients.email` is a nullable, non-unique, clinician-typed contact field. One typo or one shared family address discloses a stranger's medical history. Ruled out explicitly. §4 |
| `ON DELETE CASCADE` on `patients.user_id` | Deleting an app account would delete a medical record. Violates DB §7 |
| Leave ADR-018 §3 as-is and build patient auth anyway | Ships code contradicting a signed decision, and two tests fail by design. Audit R-1, severity Critical |
| Amend ADR-018 in place | The register's convention is that decisions are superseded by new ADRs, not edited. ADR-018 §§1, 2, 4 remain correct and must keep standing |

### Residual ambiguity

**RA-030.1 — the account-to-record claim flow is NOT decided by this ADR.** How a registered patient account becomes linked to `PT-1042` is a separate decision with an identity-proofing requirement (audit R-2, Critical). Until it is taken, patient accounts are authenticated-but-unlinked and see no clinical data. **Auto-linking on email is ruled out; everything else remains open.** Whatever is chosen must be rate-limited and must write an audit row per attempt, successful or not.

**RA-030.2 — patient self-service authority (audit AD-2) is not decided here.** Which fields a patient may edit on their own record, and who wins when a clinician edits the same field, is a product decision. The audit recommends patient-owns-contact-and-preferences with clinical fields read-only and clinician-wins-with-an-audit-row; this ADR neither adopts nor rejects that.

**RA-030.3 — results release (audit AD-5) is not decided here.** See ADR-031, also proposed and also pending. Patient-readable clinical data cannot ship until it is decided.

**RA-030.4 — administrator governance of patient accounts** (API §4.11 `unlock` / `reset-credentials` / `deactivate`) becomes implementable once this ADR is accepted, and is scheduled with M8 rather than with the patient-identity foundation.

### Acceptance

This ADR carries a **product and privacy consequence**, so under the register's own claim-class rule it could not be accepted on engineering judgement. It was put to the project owner with the alternatives above, including the option of leaving ADR-018 §3 standing.

**Accepted by the project owner on 2026-09-02**, as proposed: ADR-018 §3 is amended in the manner described, and the deferral of RA-030.1 is accepted with it — patient accounts exist and hold no clinical data until the claim flow is separately decided.

**ADR-031 was put at the same time and deliberately left open**, so patient-readable clinical data remains blocked. Identity is settled; the clinical release policy is not.

### Implementation

Landed with this ADR, and no further:

| Change | File |
|---|---|
| `patients.user_id` — nullable, unique, FK `ON DELETE SET NULL` | `prisma/migrations/20260902190000_adr030_patient_user_link/` |
| `Patient.userId` + `User.patient` relation | `prisma/schema/05-patients.prisma`, `03-identity.prisma` |
| `patient` role, empty bundle, **no matrix column** | `prisma/seed/permissions.ts` |
| `role` accepts `patient` | `src/modules/auth/dto/register.schema.ts` |
| `PatientSelfScopeService` + `PATIENT_SELF_REPOSITORY` port and adapter | `src/shared/authz/` |
| The two absence assertions, inverted | `seed-parity.spec.ts`, `schema-reference.e2e-spec.ts` |
| 19 identity/authorization/ownership cases | `test/patient-identity.e2e-spec.ts` |

`permission-catalogue.ts` is **not** edited — `PLATFORM_ROLES` stays five, the frontend parity spec keeps passing, and no frontend file changed.

**One thing the implementation found that this ADR had assumed otherwise.** `X-Client-Type: mobile` is honoured on `POST /auth/refresh` **only**; `POST /auth/login` issues the refresh token as a `Set-Cookie` header for every client. A native client must read its first token from that header. This does not affect the decision — patient auth still runs entirely on the existing lifecycle — but it is a real mobile gap, now recorded in `PATIENT_MOBILE_API_CONTRACT.md` §0.2.1 and belonging to M41.

---

## ADR-031 — Results Release Policy (Patient-Visible Clinical Data)

**Status:** 🟠 **PROPOSED — PENDING CLINICAL/PRODUCT APPROVAL.** Not accepted. This ADR deliberately proposes **no clinical rule**; it records that one is missing, and asks a named owner for it.
**Raised by:** `PATIENT_APP_AUDIT.md` §15.4 as **AD-5**.
**Blocks:** every patient-readable clinical route — medical records, visit summaries, lab results, prescriptions.

### Context

The patient mobile brief asks for lab results and visit summaries in the patient's hands. **The backend has no concept of a result being released to a patient, and a search of the tree confirms it rather than assumes it.**

| Searched for | Result |
|---|---|
| `released` / `released_at` / `release_to_patient` | **No column, anywhere in 13 schema files** |
| `visible_to_patient` / `patient_visible` | **Nothing** |
| A patient-visibility flag on `lab_results`, `lab_orders`, `medical_records`, `prescriptions` | **None** |
| `reviewed_at` / `reviewed_by` on `lab_orders` | **Present** (`09-labs-pharmacy.prisma:46–48,60`) |

The only adjacent mechanism is `lab_orders.reviewed_at` / `reviewed_by`, and it is **not a release gate**. Its documented purpose is the clinician's own workflow — *"The 'Mark reviewed' workflow UX 2.6 requires for critical results"* — feeding the doctor dashboard's "Critical unreviewed: N" chip (roadmap M27.3, API §16.3). Reusing a clinician's read-receipt as a patient-disclosure control would be a silent reinterpretation of an existing column's meaning, and it would break the moment the two workflows needed to diverge.

**The question this ADR cannot answer:** may a patient see a `critical-high` lab result before any clinician has looked at it?

Both answers are defensible and neither is a backend engineer's to pick. Releasing immediately is patient-autonomy-respecting and is what several jurisdictions now mandate (information-blocking rules); it also means a person can read a result suggesting a serious diagnosis, alone, at 02:00, with nobody to ask. Holding until review is clinically safer and is what the audit recommends (R-7), but a held result is a result a patient is entitled to and cannot get, and an unbounded hold is indistinguishable from concealment.

**This is a clinical policy decision with a named owner, a regulatory dimension, and no default that is safe to assume.** Guessing it in a migration would encode a clinical policy in a schema by accident.

### Decision requested

The owner is asked to choose a release rule, and to name the clinician accountable for it. The infrastructure implied by each is sketched so the cost is visible, not to pre-empt the choice:

| Option | Rule | Infrastructure implied |
|---|---|---|
| **R-A** | Release everything on result entry | No new column. Highest clinical risk; the audit argues against it |
| **R-B** *(audit recommendation, R-7)* | Normal results release immediately; abnormal/critical hold until a clinician reviews | A release timestamp distinct from `reviewed_at`, plus a "pending review" patient-facing state and a contact route |
| **R-C** | Everything holds until explicit clinician release | An explicit release action, a release timestamp and an actor, plus a service-level guarantee on turnaround so "held" cannot mean "forgotten" |
| **R-D** | Time-delayed release — hold N hours, then auto-release unless a clinician intervenes | R-C's columns plus a scheduled job and a configured N |

### Interim engineering position (in force until the above is decided)

**No patient-readable clinical endpoint may ship.** Concretely: `GET /me/health/labs`, `/me/health/visits`, `/me/health/records` and `/me/health/prescriptions` are **BLOCKED BY AD-5** and are specified in `PATIENT_MOBILE_API_CONTRACT.md` as blocked rather than implemented.

The brief permits building infrastructure that does not assume the outcome. **Almost none exists here**, and this is stated plainly rather than worked around: R-A needs no column, R-B/C/D need a release timestamp whose *semantics differ between them*, so a column added now would be named for a policy nobody has chosen. The one thing that is genuinely policy-independent — and is therefore built as part of the patient identity foundation rather than deferred — is **patient-record ownership resolution** (`PatientSelfScopeService`, ADR-030 §6): "which patient is this caller" is a prerequisite of every option and is invariant across all four.

`/me/health/allergies` and `/me/health/medications` are **not obviously** covered by AD-5 — an allergy list is data a patient supplied and must carry on their person — but they are held with the rest until the owner confirms the boundary, because deciding which clinical tables sit outside a release policy is itself a clinical judgement.

### What each option would cost to build

Written so the decision can be taken on evidence rather than on a guess about implementation cost. **None of this is built.**

| | **R-A** release on entry | **R-B** hold abnormal/critical | **R-C** hold all until released | **R-D** timed auto-release |
|---|---|---|---|---|
| New column on `lab_results` | — | `released_at` | `released_at` + `released_by` | `released_at` + `release_due_at` |
| Migration | none | additive, nullable | additive, nullable | additive, nullable |
| Backfill of existing rows | — | **required**, and it is a clinical judgement per row | **required** | **required** |
| Clinician action needed | none | on abnormal only | on every result | none (intervention only) |
| Background job | no | no | no | **yes** — a scheduler that does not exist (M30) |
| "Pending review" patient state | no | **yes** | **yes** | **yes** |
| Risk if it goes wrong | a patient reads a critical result alone | an abnormal result is held and forgotten | every result can be forgotten | the timer releases something a clinician meant to hold |

**The backfill is the part to weigh carefully.** Under R-B, R-C and R-D, every `lab_results` row that exists when the migration runs has no release state, and there is no safe automatic default: treating them all as released discloses in bulk exactly what the policy is meant to gate, and treating them all as held makes a patient's entire history invisible with no clinician queue to work through it. Whoever takes this decision must also say what happens to the rows that already exist.

### What is decision-independent, and therefore already built

Two things are invariant across all four options, so they were built as part of the patient identity foundation rather than waiting:

1. **Ownership resolution** — `PatientSelfScopeService` answers "which patient record is this caller", which every option needs before it can ask whether a result is releasable. ADR-030 §6.
2. **The 404-never-403 discipline** on patient-scoped routes, which every option needs so that a held result is indistinguishable from a non-existent one.

Two more are decision-independent and **not** built, because they belong to the routes themselves: pagination over a patient's clinical history, and the `related` id projection on notifications that lets a patient be told a result exists without being shown it (built — see `NotificationView.related`).

**Nothing else may be built.** In particular no release column may be added: R-A needs none, and R-B/C/D need columns whose *semantics differ between them*, so a column added now would be named for a policy nobody has chosen and would have to be migrated again once one is.

### Consequences

**API.** Four patient clinical routes are specified and unimplemented. The mobile client builds those screens against fixtures behind its mock seam and swaps adapters when this unblocks — no rework of navigation, layout or transport.

**Database.** No migration is proposed. Adding a release column before the policy exists would name a column after a decision nobody has taken.

**Notifications are not a side door.** A patient may already receive a notification whose `related.labOrderId` names a result. The notification carries **ids only, never linked content** — following the id reaches a route that enforces its own authorization, and those routes do not exist. A future implementation must not treat "the patient was notified" as "the patient may read it".

**Testing.** When decided: a patient must not receive an unreleased result under any query parameter, page or filter, and the test must assert the **absence of the row**, not the masking of a field — a masked field in a payload is still a disclosure to anyone reading the network.

### Residual ambiguity

**RA-031.1 — the scope boundary is itself undecided.** Whether allergies, medications, immunisations and appointment-linked visit notes fall under the release policy, or sit outside it as patient-supplied or administrative data, is part of the decision requested above.

---

## ADR-032 — `patient-app` Is the Fifth Integration Branch

**Status:** Accepted · **Origin:** `patient-app/PATIENT_APP_AUDIT.md` §17 (AD-6), checklist A-06

### Context

`patient-app/` landed on `main` in PR #88 — 155 files, the Medora Patient Mobile client as a fourth top-level tree beside `frontend/`, `backend/` and `docs/`.

The working agreement in `CLAUDE.md` defines four integration branches, one per domain, and requires every task branch to be cut from one of them and merged back by pull request. None of the four covers a React Native client. While `patient-app/` held only the audit and the checklist, PR #85 and PR #88 cut from `main` as an interim — the precedent `backend/` set when it was created as specs-only.

That interim is no longer defensible. A tree with an application in it, its own CI job and its own quality gate needs a standing base and merge target, or every future task re-litigates the question. This ADR answers it once.

### Evidence

| Source | Content |
|---|---|
| `patient-app/PATIENT_APP_AUDIT.md` §17 (AD-6) | Assesses three placements and recommends "**New `patient-app` integration branch from `main`** — mirrors the existing per-domain model; task branches `claude/<task>` → PR → `patient-app` → later `main`" |
| Audit R-13 | "CI and branch model do not cover a fourth tree… a `patient-app/` commit runs **nothing** and reports green" |
| `.github/workflows/ci.yml` (PR #88) | The CI half is done: a `patient-app` job with a `^patient-app/` path filter, joined to the aggregate `CI` check. Verified green on run `33689572569` |
| `CLAUDE.md` "Pull request target" | "`main` receives completed, reviewed work from the integration branches, **never task branches directly**" — which the interim rule contradicted |
| `CLAUDE.md` "Quality gates" | `patient-app` has its own four-command gate, distinct from the frontend's and the backend's |
| Remote branch list, 2026-09-03 | `frontend`, `backend`, `Database`, `Ai` exist; no `patient-app`. `patient_mobile_app` exists at `e63e09a` — the audit-era branch, superseded and not an integration branch |

### Decision

1. **`patient-app` is created as an integration branch, cut from `main` at `5ed742e`.** Lower-case and hyphenated, matching the directory name — unlike `Database` and `Ai`, which carry a historical leading capital.

2. **Patient-app task branches are cut from `patient-app` and merged back into it by pull request**, exactly as the other four domains work:

   ```text
   patient-app → claude/add-patient-home → PR → patient-app
   ```

3. **`patient-app` reaches `main` by pull request**, like the other integration branches. `main` continues to receive no task branches directly.

4. **The interim "cut patient-app task branches from `main`" rule is retired.** It is removed from `CLAUDE.md` rather than left as an alternative, because two documented bases for one tree is the ambiguity this ADR exists to remove.

5. **Two exceptions stay with their own domain, and are named in `CLAUDE.md` so they are not mistaken for patient-app work:**
   - A change to `backend/prisma/schema/01-enums.prisma` or `backend/src/modules/auth/dto/` is **backend** work. It trips the patient-app CI suite because `patient-app/src/test/parity.test.ts` reads those files directly to prove the status vocabularies and password policy have not drifted — the same arrangement the frontend↔backend parity specs already have. Tripping another tree's suite does not make it that tree's change.
   - Work spanning `patient-app/` and another tree is cross-domain: decide the integration strategy first. `main` is a legitimate base there, and it is the only place it is.

6. **`patient_mobile_app` is not renamed or reused.** It is the audit-era branch at `e63e09a`, already merged through PR #85. Leave it.

### Consequences

**API.** None.

**Database.** None.

**Backend services.** None. The CI path filter that fires the patient-app suite on two backend paths was added in PR #88 and is unchanged here.

**Frontend integration.** None.

**Testing.** The patient-app suite runs on pushes to `patient-app` and on pull requests into it, via the existing `^patient-app/` filter — the filter compares against the pull request's base, so a task branch → `patient-app` pull request path-filters correctly without further change.

**Workflow.** One new remote branch. `CLAUDE.md` gains a fifth row in three tables and loses the interim paragraph. Checklist row A-06 closes.

### Alternatives considered

| Alternative | Rejected because |
|---|---|
| Keep cutting patient-app task branches from `main` | Works mechanically, but leaves the tree without the staging area every other domain has, and contradicts `CLAUDE.md`'s own rule that `main` never receives task branches directly. It also makes the base a per-task decision, which is what AD-6 was raised to end |
| Fold patient-app work into `frontend` | `frontend` means the doctor/admin SPA. A React Native tree there invites a pull request that touches both clients, and the two have different quality gates, different dependency trees and different reviewers |
| Name it `PatientApp` or `patient_app`, matching `Database`/`Ai` capitalisation or the old `patient_mobile_app` | The leading capitals are a historical accident the audit already flags as a footgun (branch names are case-sensitive). Matching the directory name is the least surprising choice for a branch created today |
| Defer until ADR-030 settles patient identity | Unrelated. ADR-030 decides whether patients authenticate; this decides where their client's code is staged. Blocking a workflow decision on a product decision would leave the tree without a base for the whole of that wait |

## ADR-033 — Patient Appointment Action Policy (Cancellation and Rescheduling)

**Status:** 🟠 **PROPOSED — PENDING PRODUCT/CLINICAL APPROVAL.** Not accepted. This ADR deliberately **chooses no policy**; it records that one is missing, establishes exactly what is already binding, and lays out the options with their costs so a decision can be taken on evidence.
**Raised by:** the Patient Mobile enablement workstream. `PATIENT_MOBILE_API_CONTRACT.md` §4 marks P4.3–P4.6 blocked on this.
**Blocks:** `POST /me/appointments/{id}/cancel`, `.../reschedule`, `.../confirm`, `GET /patient/doctors/{id}/slots`, `POST /me/appointments`, and the `availableActions` field on every patient appointment payload.
**Does not block:** `GET /me/appointments` and `GET /me/appointments/{id}`, which are implemented and shipped — every rule they need is already written down.

### Context

ADR-030 gave patients accounts. The Patient Mobile client can now read its own appointments. It cannot act on them, and the reason is not a missing endpoint.

> **ADR-001's transition matrix says which *statuses* may follow which. It does not say *who* may move between them.**

That is the whole gap, and it is precise. `pending → cancelled` is a legal transition; whether a *patient* may cause it is a different question, and no source in this repository answers it. The matrix was written for the doctor's book (API §5 is `doctor` auth throughout) and is silent on a patient actor everywhere except one row.

Every appointment write route for patients depends on the answer, so all of them are blocked together rather than one at a time.

### Evidence

Read from the tree at `0f5978c`, not from a description of it.

| Source | Content | Bearing |
|---|---|---|
| ADR-001 §2 matrix | `awaiting-patient → confirmed \| cancelled \| rescheduled` — *"patient response or doctor override"* | **The only place a patient actor appears in any transition rule** |
| ADR-001 §2 matrix | Every other row is unattributed | The actor question is genuinely open, not merely unwritten down |
| API §5 (all of it) | `5.4 approve`, `5.5 reject`, `5.6 reschedule`, `5.7 cancel/complete/no-show`, `5.8 propose-slots` — **auth `doctor`** on every row | There is no patient-actor endpoint in the contract at all |
| API §5.3 `POST /appointments` | Takes `patientId`, auth `doctor` | Even creation is modelled as a clinician act |
| API §5.6 | *"patient re-confirms unless within auto-accept window"* | Names a window… |
| UX §281 | *"patient must re-confirm unless within **doctor-set** auto-accept window"* | …and says it is **per doctor**… |
| `DATABASE_SCHEMA_EXTRACTION.md:1301` | *"unless within the doctor's auto-accept window"* | …in a third source. |
| **Repository grep** | `auto_accept`, `autoAccept` — **no column, no setting, no constant, anywhere** | **The window is named by three sources and exists nowhere.** No value, no unit, no default |
| `platform_settings` seed | 11 slices: general, organization, branding, localization, notifications, security, email, sms, backup, retention, privacy | **No scheduling slice** |
| `frontend/src/features/admin/admin-settings.types.ts` | 17 admin panels: general, organization, branding, localization, notifications, email, sms, security, users, roles, api-keys, audit, integrations, backup, retention, privacy, about | **No scheduling panel.** There is nowhere in the product for an administrator to set a window |
| **MG §546** | *"booking rules (approval-vs-auto-confirm) **already exist in scheduling policy settings**"* | ⚠ **Not supported by the tree.** No such slice and no such panel exists. Recorded below as D-1 |
| `appointments_cancelled_reason_required` (M5.6 migration:258) | `CHECK (status <> 'cancelled' OR cancelled_reason IS NOT NULL)` | **Binding on every option** — see "Already specified" |
| `enforce_appointment_transition()` (M5.10 migration:241) | DB trigger; terminal states and the legal-successor table | **Binding on every option** |
| `AppointmentEvent.actorId → users.id?` | Nullable FK to `users` | A patient actor is **already representable** — ADR-030 made patients users |
| `AuditEvent.actorRole` | Snapshotted role string | A `patient` actor role is already representable |
| `AuditCategory` | `authentication \| security \| user_action \| admin_activity \| system` | `user_action` fits a patient cancel; **no new enum value needed** |
| `AppointmentAction` | `approve \| reject \| cancel \| reschedule \| complete \| no-show \| created \| nudged \| reassigned` | `cancel` and `reschedule` already exist; **no new enum value needed** |
| UX §140 (P4) | *"Any action that affects another human (reject, cancel, revoke, suspend) … required reason … Reason is stored and audit-logged"* | Applies to a patient cancel **if** a patient cancel "affects another human" — an interpretation, not a statement |
| ADR-005 RA-005.2 | Reads `auto_behavior = reschedule-existing` as a **default pre-selection, never automatic action**, because automatic action would bypass a mandatory confirmation | **Precedent**: this repository has already declined once to read an "auto" setting as literally automatic |
| RM M11.3 / M11.4 | Action endpoints and *"re-confirmation semantics"* — **unticked** | The doctor-side half is also unbuilt, so nothing is being retrofitted around |
| Rate limiting | **None exists anywhere in the backend** (audit BE-17/R-9) | Bears on every option that lets a patient write |

### Already specified — binding on every option, no decision required

These are **not** open questions. Any option chosen must satisfy all of them, and an option that cannot is not implementable as stated.

**1. A cancellation without a reason is not representable.** `appointments_cancelled_reason_required` is a CHECK constraint, not a convention. Any patient cancel path must supply `cancelled_reason`, or the database rejects the row. *"Let patients cancel without giving a reason"* would therefore require a migration to drop or weaken a constraint that exists deliberately — it is not a UI choice.

**2. The legal successor states are fixed** by ADR-001 and enforced twice — `AppointmentStatusMachine` in `shared/status/` for the API's 409, and `enforce_appointment_transition()` as a database backstop so that no migration or psql session can walk a row into an illegal state. No option may introduce a transition outside that table without amending ADR-001.

**3. Terminal is terminal.** `completed`, `cancelled` and `no-show` accept nothing. A patient "un-cancelling" is not a policy option; it is a new appointment.

**4. Every transition writes an `appointment_events` row** with actor, from/to status, reason and timestamp (ADR-001 §2), and **notifications fire only after commit**, through the outbox.

**5. Transitions are compare-and-set; a lost race is 409 `conflict`** with a `detail` (API §0.5, §0.3). This is what makes two clients acting on one appointment safe, and it is already decided.

**6. Date comparisons use the clinic's configured timezone, not UTC** (ADR-001, Consequences). Established for the `slot ≤ today` rule and it binds any calendar-shaped window here. *(An hours-before-start window is a pure instant comparison and is timezone-free; a "same day" or "by midnight" window is not. That difference is an implementation trap and is priced per option below.)*

**7. The actor is already modelled.** `appointment_events.actor_id` and `audit_events.actor_id` both reference `users`, and `audit_events.actor_role` snapshots the role. Since ADR-030, a patient is a user. **No schema change is needed to record that a patient did something** — under any option.

**8. `awaiting-patient → confirmed` is the one transition ADR-001 already attributes to a patient** — *"patient response or doctor override"*. It is the closest thing to a settled patient action in the repository, and it is the reason the proposal-response question below is scoped separately from the rest.

### What requires a decision

Four questions. They are separable, and answering some without the others is a legitimate outcome — the proposal response (Q3) in particular can be decided independently.

**Q1 — May a patient cancel their own appointment at all, and from which statuses?**
**Q2 — May a patient initiate a reschedule, or only cancel and rebook?**
**Q3 — May a patient respond to a doctor's slot proposal (`awaiting-patient → confirmed`)?**
**Q4 — Is there a timing window on any of the above, and where does it live?**

Two further questions are **out of this ADR's scope** and are noted so nobody assumes they were covered: whether a patient may *create* an appointment at all (and in which status), and how far ahead slots may be offered. They are named in `PATIENT_MOBILE_API_CONTRACT.md` §4 and belong to a booking-policy decision. They interlock with this one — `availableActions` cannot be finalised until both are settled — but they are a different question about a different route.

---

### Q1 — Patient cancellation

| | **C-A** No patient cancel | **C-B** Cancel freely | **C-C** Clinic-wide window | **C-D** Per-doctor window |
|---|---|---|---|---|
| **Shape** | Patient contacts the clinic; the app shows the number | Any non-terminal status, any time before `starts_at` | Cancel allowed until *N* before start; inside *N*, blocked | As C-C, but *N* is set per doctor |
| **Statuses** | — | `pending`, `scheduled`, `confirmed`, `rescheduled`, `awaiting-patient` | Same, gated by time | Same, gated by time |
| **New storage** | none | none | **new `scheduling` settings slice** (JSON, no migration) | **new column(s) on `doctors`** (migration) |
| **Admin UI to set it** | — | — | a **new settings panel** (none of the 17 exists) | a field on the doctor profile editor (M9) |
| **Migration** | none | none | none — `platform_settings` is a JSON slice | **additive**, nullable + a default |
| **Backfill** | — | — | — | none if nullable-with-fallback; **required** if `NOT NULL` |
| **Timezone risk** | none | none | none if *N* is hours-before-start; **real** if expressed in calendar days | same |
| **Reason capture** | n/a | required by CHECK (§1) | required by CHECK | required by CHECK |
| **API surface** | none | `POST /me/appointments/{id}/cancel` | same + a `cancellableUntil` on the payload | same |
| **UI under it** | a contact affordance | a cancel button | a cancel button that **disables with an explanation**, plus a fallback path inside the window | same, and the explanation varies per doctor |
| **What the server must return** | — | 200 / 409 | the window boundary, or the client cannot explain the disabled button without recomputing the rule §4 forbids | same |
| **Failure mode if wrong** | patients call the desk for everything; no-shows rise | last-minute cancellations; an empty slot nobody can refill | a patient with a genuine emergency is told "no" by an app | inconsistent experience across doctors in one clinic |

**Notes that apply across C-B/C-C/C-D:**

- **`pending` may deserve a different answer from `confirmed`.** Cancelling a request the clinic has not yet accepted is a materially smaller act than cancelling a booked slot. Any option may be answered per-status rather than uniformly, and doing so is not a fifth option — it is a refinement of whichever is chosen.
- **A patient-supplied reason is free text from an unauthenticated-in-spirit source.** `cancelled_reason` is `VARCHAR(300)` and is shown to clinic staff. Whether patients pick from a closed list (as P4's clinician modal does) or type freely is part of this decision, and the closed-list form is the one that keeps the field useful for the cancellation-rate metrics ADM-05 already renders.
- **No rate limiting exists.** A cancel route is a write endpoint reachable by any authenticated patient. Under C-B in particular, cancel-and-rebook is an unbounded loop against `doctor_availability`. **BE-17 (M37) should land before any of these ships**, under every option.

---

### Q2 — Patient-initiated rescheduling

| | **R-A** No patient reschedule | **R-B** Reschedule as a request | **R-C** Direct reschedule in a window |
|---|---|---|---|
| **Shape** | Cancel + rebook only | Patient proposes a new time → clinic accepts/declines | Patient moves the appointment themselves |
| **Transition used** | — | `→ pending`, or a new proposal row authored by the patient | `→ rescheduled` |
| **Fits ADR-001 today?** | n/a | **`scheduled\|confirmed\|rescheduled → pending` is NOT in the matrix.** The trigger allows `pending → scheduled`, not the reverse | ✅ `scheduled\|confirmed\|rescheduled → rescheduled` is legal |
| **Amends ADR-001?** | no | **yes** — a new transition, and the DB trigger must change with it | no |
| **Reuses `appointment_reschedule_proposals`?** | — | Possibly — but `proposed_by` is a `users` FK, so a **patient-authored** proposal is representable today. Its `status` lifecycle (`pending/accepted/declined/expired`) would then need a patient-origin reading | no |
| **New storage** | none | none, if the proposal table is reused | none, unless a window is added (see Q4) |
| **Migration** | none | **only if** a new transition is added to the trigger | none |
| **Slot validation** | — | server must still verify the requested slot is real | server must verify **and hold** it |
| **API surface** | none | `POST /me/appointments/{id}/reschedule` → 202-ish semantics | same → 200 with the moved appointment |
| **UI under it** | "cancel, then book again" | a request flow with a pending state and a waiting screen | a slot picker that commits |
| **Interacts with** | — | the doctor-side `approve`/`reject` (API §5.4/5.5), unbuilt | `GET /doctors/{id}/slots`, unbuilt, and its own booking-horizon policy |

**The `expired` proposal status has no expiry mechanism.** `appointment_reschedule_proposals.status` includes `expired`, and nothing sets it — there is no `expires_at` column and no scheduler (M30 is unbuilt). Under R-B, whoever decides must also say whether a patient's request expires, and if so a column and a job are both new work.

---

### Q3 — Patient response to a doctor's proposal (`awaiting-patient`)

**This is the closest to already-decided, and it is why it is asked separately.**

ADR-001's matrix attributes this row to a patient in its own words — *"patient response or doctor override"* — and RM M11.4 names *"re-confirmation semantics"* as its deliverable. `appointment_reschedule_proposals` exists with `chosen_slot` for exactly this. The transition is legal in the matrix and in the trigger.

What is still unstated:

- **Does accepting slot *n* move the appointment to `confirmed` directly**, or to `rescheduled` and then `confirmed`? The matrix permits `awaiting-patient → confirmed`, so the direct move is available; no source says which is intended.
- **May the patient decline all three slots**, and what does the appointment become — back to `awaiting-patient`, to `cancelled`, or does it need the doctor? `awaiting-patient → cancelled` is legal, so declining-to-cancellation is representable.
- **Is there a deadline?** Same `expired`-with-no-mechanism gap as Q2.
- **The doctor-side half is unbuilt** (`propose-slots`, M11.4). A patient response route has nothing to respond to until it exists, so Q3 cannot ship first regardless of the answer.

Also relevant: **RA-001.1 is still open** — which statuses may transition *into* `awaiting-patient` was never settled, and ADR-001 explicitly declined to invent it. Q3's answer does not depend on RA-001.1, but any implementation reaches it.

---

### Q4 — Where a timing window would live, if there is one

Only C-C, C-D and R-C need one. The choice of *storage* is separable from the choice of *policy*, and it has its own costs.

| Location | Migration | Who sets it | Notes |
|---|---|---|---|
| **New `scheduling` slice in `platform_settings`** | none — it is a JSON column | an administrator, via a **new settings panel that does not exist** (17 panels, none scheduling) | The natural home. Requires reading the slice from the appointments module, which zone 1 forbids doing through the platform-settings module — the narrow-port pattern already used for `CLINIC_TIMEZONE` applies |
| **Column(s) on `doctors`** | additive, nullable | the doctor, via the M9 profile editor (unbuilt) | This is what UX §281 and `DATABASE_SCHEMA_EXTRACTION.md:1301` describe as the *"doctor-set auto-accept window"*. Nullable avoids a backfill; `NOT NULL` forces one |
| **Column on `visit_types`** | additive | an administrator | Lets a 15-minute follow-up and a procedure differ. No source suggests it; listed because it is the natural third axis |
| **Hardcoded constant** | none | nobody | Not a policy — it is a policy nobody can change without a deploy. Listed only to be ruled out explicitly |

**Two mechanical points that will otherwise be discovered late:**

1. **Express the window in hours-before-start, not in calendar days**, unless a calendar boundary is genuinely wanted. `starts_at - INTERVAL 'N hours'` is timezone-free; *"cancel by midnight the day before"* must be evaluated in the clinic's timezone (ADR-001 Consequences), and getting that wrong shifts the boundary by up to a day for a travelling patient.
2. **The server must return the boundary, not just enforce it.** `PATIENT_MOBILE_API_CONTRACT.md` §4 forbids the client computing whether an action is allowed. A disabled cancel button with no explanation is a support call; the payload therefore needs the window's *effect* — the `availableActions` list, and enough for the UI to say why — under C-C, C-D and R-C alike.

### Audit requirements — mostly already satisfied

| Requirement | State |
|---|---|
| An `appointment_events` row per transition, with actor | **Already required** by ADR-001; `actor_id` accepts a patient since ADR-030 |
| Reason stored on a cancellation | **Already enforced** by the CHECK constraint |
| The actor's role snapshotted | `audit_events.actor_role` exists; `AuditCategory.user_action` fits |
| A new enum value for a patient action | **Not needed** — `AppointmentAction.cancel`/`reschedule` already exist |
| Notification after commit, via outbox | **Already required** by ADR-001 |

**What is undecided:** whether a patient cancellation is a **P4 action** (UX §140 — *"any action that affects another human … required reason … stored and audit-logged"*). A patient cancelling a booked slot plainly affects the clinician whose time it was, so P4 reads as applicable — but P4 was written for the clinician-facing modal, and applying it to a patient means a closed reason list and an `audit_events` row in addition to the `appointment_events` row. **That is an interpretation this ADR declines to make.**

Also undecided: whether the patient-facing appointment history should show that the *patient* cancelled versus that the *clinic* did. The shipped detail route already collapses actors to `patient | clinic | system` (contract §4.2), so it can express this — but whether it should is a product question about how a clinic wants its own actions attributed.

### Implementation impact common to all options

Whatever is chosen:

- **`availableActions` becomes implementable and must ship with it.** It is currently omitted from the patient payloads *because* this decision is open — an empty array would assert "no action is available", which is a claim nobody has authority to make. It is not a separate piece of work; it is the shape of the answer.
- **One rule, one place.** The actor dimension belongs beside the status matrix in `shared/status/`, not in a controller. Two places to ask "may this actor do this" is how a button that renders becomes a request that 409s — the exact failure `shared/status/status-machine.ts` says it exists to prevent.
- **The DB trigger is a backstop, not the rule.** It enforces which statuses may follow which and deliberately holds no timezone-dependent or actor-dependent logic (M5.10 migration, §3 comment). An actor or window rule belongs in the service layer, where the timezone is already resolved; adding it to the trigger would repeat ADR-001's rejected approach.
- **Rate limiting (BE-17/M37) should precede any patient write route**, under every option.
- **`Idempotency-Key` is specified (ADR-014, API §0.5) and not yet enforced.** A cancel is exactly the state-changing POST a flaky mobile connection retries.

### Consequences of leaving this open

**API.** `POST /me/appointments`, `.../cancel`, `.../reschedule`, `.../confirm` and `GET /patient/doctors/{id}/slots` stay unimplemented, and `availableActions` stays absent from the two shipped read routes.

**Frontend.** The Patient Mobile appointment **list and detail screens are fully buildable today** against live endpoints; only the action affordances are blocked. This is the smallest possible blast radius for an open decision, and it is why the reads were shipped separately.

**Database.** No migration is proposed by this ADR. Under C-D or a `NOT NULL` window column one becomes necessary; under C-A, C-B, R-A and Q3 none does.

**Doctor/Admin.** Untouched. API §5's clinician endpoints are unbuilt (M11) and are not blocked by this decision — M11 can proceed on the doctor side without it, and should not assume an answer while doing so.

### Alternatives considered — to the *framing*, not to the policy

| Alternative | Rejected because |
|---|---|
| Decide it in code and document afterwards | It is clinical-operations policy: a cancellation window determines whether a patient with a genuine emergency is told "no" by an app. Not an engineering judgement |
| Ship `availableActions` computed from ADR-001 alone | ADR-001 is a *status* matrix. Deriving actor permission from it would silently assert that anyone may make any legal transition — which would let a patient mark their own appointment `completed` |
| Let the client decide and have the server accept anything legal | Directly contradicts contract §4 and API §5's server-enforced matrix. Also unenforceable: the client is not a trust boundary |
| Adopt the "auto-accept window" as though it existed | Three sources name it; **none gives it a value, a unit, a default or a column**. Adopting it would mean inventing all four and attributing them to a source that supplied none |
| Treat MG §546 as evidence the rules already exist | It says *"booking rules … already exist in scheduling policy settings"*. Verified against the tree: **no scheduling slice, no scheduling panel.** Recorded as D-1 below rather than relied on |
| Block the appointment reads too, until the whole module is decided | The reads need no undecided rule. Blocking them would have stalled the mobile client's largest screen for a decision it does not depend on |

### Discrepancies found while writing this ADR

**D-1 — MG §546 claims a scheduling policy settings slice that does not exist.** *"booking rules (approval-vs-auto-confirm) already exist in scheduling policy settings."* There is no `scheduling` slice among the 11 seeded `platform_settings` keys and no scheduling panel among the 17 in `admin-settings.types.ts`. The claim is forward-looking language in a guide written before the schema. **No action beyond recording it**, but it must not be cited as evidence that this decision is already made.

**D-2 — the "auto-accept window" is specified in three documents and exists in none of the code.** API §5.6, UX §281 and `DATABASE_SCHEMA_EXTRACTION.md:1301` all describe it, two of them as doctor-set. There is no column, setting, constant or default. Whoever answers Q4 is deciding it for the first time, not implementing something already decided.

**D-3 — `appointment_reschedule_proposals.status` includes `expired` with no expiry mechanism.** No `expires_at` column, no scheduler (M30 unbuilt). Any option that lets a patient hold a request open inherits this gap.

### Residual ambiguity

**RA-033.1 — patient booking is not decided here.** Whether a patient may create an appointment, in which status, how far ahead, and for which visit types, is a distinct decision that `availableActions` also depends on. Named in `PATIENT_MOBILE_API_CONTRACT.md` §4.

**RA-033.2 — RA-001.1 remains open.** Which statuses may transition *into* `awaiting-patient` was never settled. Q3 does not depend on it, but an implementation reaches it.

**RA-033.3 — no-show attribution is untouched.** `no-show` is a clinician judgement in ADR-001 (`slot ≤ today`). Whether a patient cancelling too late is recorded as `cancelled` or eventually as `no-show` is a metrics question ADM-05 already renders rates for, and no source addresses it.

### ⚠ What acceptance requires

Answers to **Q1, Q2, Q3 and Q4** — or to any subset, with the rest explicitly left open — from whoever owns clinic operations, together with the P4 question under *Audit requirements*. Under the register's claim-class rule a `[RECOMMENDATION]` is not sufficient evidence for a decision carrying clinical consequence, and **this ADR deliberately makes no recommendation.**

---

## ADR-034 — The Token-in-Body Auth Variant Is Issued, Not Only Accepted

**Status:** **Accepted** (M6.3, corrective) · **Date:** 2026-09-02
**Milestone:** closes a gap in M6.3; **does not** close RM M41.1, which owns the validation report.

### Renumbering note — this ADR was ADR-032 until 2026-09-03

It was written as **ADR-032** on the `backend` branch on 2026-09-02. On the
same day, and independently, `main` allocated **ADR-032** to *`patient-app`
Is the Fifth Integration Branch* (PR #89). Two different decisions, the same
number, on two branches that had not yet met — precisely the hazard
`CLAUDE.md` warns about under *"Check the register before allocating a new
ADR number on a long-lived branch."*

The collision was found by the branch reconciliation of 2026-09-03 and
resolved the way this register has resolved one before: **`main` keeps the
number, the branch renumbers.** That is the ADR-023 precedent — when
`backend` carried its own ADR-023 against `main`'s enum-mapping ADR-023, the
branch's authorization ADR became ADR-027 and `main`'s kept its number. The
rule behind it is that a number on `main` is published and may already be
cited elsewhere, while a number on an unmerged branch is not.

`main`'s register at the time also **reserved** ADR-030 for patient identity
and ADR-031 for "Patient↔Record Linking", both marked *not yet written*. The
reservations were made without sight of the `backend` branch, where both
numbers were already written and in use. ADR-030's reservation is fulfilled
exactly as intended. ADR-031's is not: the written ADR-031 is *Results
Release Policy* (audit AD-5), not linking. **Patient↔record linking is not
lost — it is `RA-030.1` inside ADR-030**, deferred there by name with
auto-linking on email explicitly ruled out. It needs a number of its own
only when someone writes it.

Any reference to "ADR-032" in the context of the mobile refresh token dated
before 2026-09-03 means this decision.

### Context

ADR-014 assigned `X-Client-Type` to the backend and M6.3 implemented it — on **one side of one route**. `presentedRefreshToken` in `auth.controller.ts` reads a body token on `POST /auth/refresh` when the header says `mobile`. Every route that *mints* a refresh token — `POST /auth/login`, `POST /auth/otp/verify`, `POST /auth/refresh` — delivered it exclusively through `Set-Cookie`.

The gap was found while implementing ADR-030's patient auth and writing `patient-identity.e2e-spec.ts`: a test that signs a patient in and then refreshes had to reach into the `Set-Cookie` header to get the token it was supposed to be holding in secure storage.

**A native client cannot use that.** React Native has no cookie jar scoped to a web origin. `Set-Cookie` has nothing to store the token in, `httpOnly` protects nothing, and the client cannot clear it on logout. So the mobile path was: obtain the first token by parsing a `Set-Cookie` header, then send it in a body, then parse `Set-Cookie` again for every rotation. That works, and it is not what any source describes.

### Evidence

| Source | Content |
|---|---|
| **MG §15.2** | "when `X-Client-Type: mobile` (or a `/auth/token` variant), **return the refresh token in the response body instead of a cookie**; mobile stores it in Keychain/Keystore; same rotation + reuse detection" |
| **RM M41.1** | "Token-in-body auth variant (`X-Client-Type: mobile`) … ✅ Verify: script completes **login→refresh→logout without cookies**" |
| API §1.5 | "*Mobile variant:* with `X-Client-Type: mobile`, refresh token travels in body instead of cookie" |
| ADR-014 | Assigns the header to the backend |
| ADR-018 §4 | "Mobile readiness is not deferred" |
| `auth.controller.ts` (before this ADR) | `setRefreshCookie` on all three minting routes; no body token anywhere |

MG §15.2 is the decisive line, and it is a **response-side** requirement: *return* the token *in the response body*. RM M41.1's verification — "without cookies" — was **not satisfiable** by the code as written, which is what identifies this as a defect rather than a deferral.

### Decision

**1. The header selects a delivery mode, applied identically on all three minting routes.**

| Client | Refresh token delivered as | Cookie set |
|---|---|---|
| Web (no header, or any other value) | *(not in the body)* | ✅ `medora_rt`, `httpOnly; Secure; SameSite=Strict; Path=/api/v1/auth` |
| `X-Client-Type: mobile` | `data.refreshToken` | ❌ none |

**2. Exactly one copy of the credential is issued.** Not both. Setting the cookie *as well* for a mobile client would leave a 12-hour-to-30-day credential in a jar the client never reads, cannot rotate, and cannot clear on logout — a live token nobody is managing, which is worse than either mechanism alone. MG §15.2 says "instead of a cookie", and this is what that means.

**3. All three routes, not just login.** Login, OTP verify and refresh each mint a token. Fixing only login would leave a client able to sign in but unable to read a rotated token; fixing only refresh leaves it unable to start. One helper serves all three so they cannot drift.

**4. The request side is unchanged.** `presentedRefreshToken` still prefers the cookie whenever one is present. The asymmetry is deliberate: on the **request** side the header is a *fallback selector*, so a browser cannot be talked into sending its token in a body by an attacker who controls a header; on the **response** side it is a *mode*, deciding where this client's token is delivered.

**5. Only the exact value `mobile`.** `Mobile`, `MOBILE` and anything else are web clients. A typo fails closed, into the safer mechanism.

### Consequences

**API.** `POST /auth/login`, `/auth/otp/verify` and `/auth/refresh` gain an optional `data.refreshToken`, present **only** under the header. Additive: no existing client sees a changed response, and no web behaviour changes at all.

**Security.** The body token is a longer-lived credential than the `accessToken` that has always been in this body, so it is gated on an explicit client declaration and issued to exactly one place. A cross-origin attacker cannot add a custom header to a form post, and a `fetch` carrying it triggers a preflight and still cannot read the response without CORS naming their origin — the same boundary that already protects `accessToken`. Rotation, reuse detection and family revocation (ADR-026) are untouched and are proven untouched under the variant.

**What this does not close.** RM **M41.1 remains open**: its deliverable is a *script client* exercising the path and, at the exit gate, a committed mobile-validation report. The behaviour now exists and is covered by `auth-mobile-client.e2e-spec.ts` (9 cases); the report is still M41's. **M41.2** — push-device registration, payload-size audit, deprecation headers — is untouched.

**Testing.** `auth-mobile-client.e2e-spec.ts`: the full cookie-free login→refresh→logout round trip; rotation through the body; **reuse detection still revoking the family**; the same treatment for a doctor account; and four web-path regressions — cookie set with all four attributes and *no* body token, no body token on a cookie refresh, an unrecognised header value falling through to web, and the cookie still winning over a body token on the request side.

### Alternatives considered

| Alternative | Rejected because |
|---|---|
| Leave it and let the client parse `Set-Cookie` | Works, but contradicts MG §15.2 and leaves RM M41.1's verification unsatisfiable. It also makes every mobile client reimplement cookie parsing to talk to an API that is not using cookies |
| Defer the whole thing to M41 | M41 is *validation*. Deferring the behaviour to the milestone that validates it means the milestone starts by building what it was meant to check — and the Patient Mobile client is being written now, against this contract |
| Issue the cookie **and** the body token for mobile | Two copies of a long-lived credential, one of them unmanaged and uncleanable by the client that holds it |
| A separate `/auth/token` endpoint | MG §15.2 offers it as an alternative ("or a `/auth/token` variant"), but it would duplicate three handlers' logic and split the lockout, rotation and reuse paths across two surfaces |
| Return the token in a custom response header | Neither source describes it, and it is no more readable than the body while being harder to type |
| Honour any `X-Client-Type` value | A typo would silently select the mechanism with weaker browser protections |

## ADR-035 — Registration Is Split by Role; Administrators Are Invited

**Status:** **Accepted** (corrective; closes RA-025.1) · **Date:** 2026-09-06 · **Amended:** 2026-11-07 — §7's doctor exemption is withdrawn by OD-004; RA-035.2 is resolved · 2026-11-10 — §7 records the owner's rules for invited administrators, the new-staff grace period and the last recovery code
**Milestone:** amends M6.1 (registration) and M6.2 (login); implements the invitation half of what RA-025.1 deferred to M8.2.

### Context

An audit of the whole registration and authentication surface found the M6
lifecycle sound in almost every respect — Argon2id, lockout before password
verification, anti-enumeration timing against a decoy hash, hashed
single-use tokens, refresh rotation with reuse detection, always-202 password
recovery, and a deny-by-default authorization guard. None of that needed
changing, and none of it was changed.

Four things were wrong, and three of them were known and written down.

**1. Anyone could register as an administrator.** `POST /auth/register`
accepted `role: 'admin'`, and `SignupPage` offered it as a radio button
beside "Doctor". `registration.service.ts` carried a comment naming the risk
and deferring it:

> *"This is worth naming as a risk rather than leaving implicit: anyone who
> can reach the endpoint can create an admin account, subject to email
> verification. ADR-017 §2 already contemplates many administrators, and M7
> is what makes the role mean anything — until then an admin account has no
> more reach than a doctor one. RA-025.1 carries the question of whether
> admin signup should require an invitation to M8.2, which owns the invite
> endpoint."*

The deferral was reasonable when written and is not any more, because its
premise expired. **M7 shipped.** The `admin` bundle now holds `roles.manage`,
`settings.manageSystem`, `patients.revealIdentity`, `patients.manageAccounts`,
`logs.view` and `logs.export`. A role that can rewrite the permission matrix
was obtainable by filling in a public form and clicking a link in one's own
inbox.

**2. `users.status` stopped nothing.** `LoginService` checked lockout, the
password, and email verification — and never read `status`. `findByEmail`
filters soft-deleted rows, so a *deactivated* account could not sign in, but
`UserStatus` has three other non-ACTIVE values. An administrator who
suspended a compromised account was writing a value no code read.

**3. Doctor professional data was optional, and professional verification
was unreachable.** `licenseNumber` was `z.string().max(40).optional()` for
every role, so a doctor could register holding no registration number at all.
Worse, registration created no `doctors` row — the same service comment
explains why: the form collected a bare licence number, and `doctors.specialty`
is NOT NULL, so the row could not be built without inventing clinical data.
The consequence was that `doctors.verification_status` — the column, the
index, the `PENDING → VERIFIED` vocabulary and the `doctors.verify`
capability, all of which existed — had no rows to describe for
self-registered clinicians. Verification was fully specified and structurally
unreachable.

**4. Patient registration was built on three sides and wired on none.**
ADR-030 accepted patient identity and widened the role enum; `patient-app`
had a complete `RegisterScreen` and a schema mirroring the backend field for
field. But the form sent no `role`, so the endpoint adapter threw
`EndpointNotImplementedError` rather than send a body it knew was malformed.
`parity.test.ts` asserted the gap so it stayed visible. It did.

### Evidence

| Source | Content |
|---|---|
| `backend/src/modules/auth/dto/register.schema.ts:66` (pre-change) | `role: z.enum(['doctor', 'admin', 'patient'])` — administrator, from an unauthenticated route |
| `backend/src/modules/auth/services/registration.service.ts:41-48` (pre-change) | The risk comment quoted above, deferring to RA-025.1 |
| `backend/prisma/seed/permissions.ts:160-183` | The `admin` bundle — 16 capabilities including `roles.manage` and `settings.manageSystem` |
| `frontend/src/features/auth/pages/SignupPage.tsx:163-168` (pre-change) | `<Radio value="admin" …>` on the public signup form |
| `backend/src/modules/auth/services/login.service.ts:120-172` (pre-change) | No read of `user.status` anywhere in the sign-in path |
| `backend/prisma/schema/01-enums.prisma:41-48` | `UserStatus = ACTIVE \| INACTIVE \| LOCKED \| SUSPENDED` — three values with no enforcement |
| `backend/prisma/schema/04-people.prisma` | `doctors.verification_status` (`DoctorVerificationStatus`), `verified_at`, `verified_by`, indexed — a verification model with no rows to hold |
| `backend/prisma/schema/01-enums.prisma:782-789` | `DoctorVerificationStatus = PENDING \| VERIFIED \| REJECTED \| DOCS_REQUESTED` |
| `patient-app/src/api/endpoints/auth.ts:142` (pre-change) | `register(): Promise<never>` — `EndpointNotImplementedError` |
| `patient-app/src/test/parity.test.ts:171-182` (pre-change) | *"this client does not yet send a role, because its signup flow is unbuilt"* |
| Repository-wide search | **No occurrence of "Medical Number", "medicalNumber" or "SCFHS" anywhere.** `LoginPage`, `loginSchema` and `login.schema.ts` are email + password + rememberMe, and always have been |

### Decision

#### §1 — Authentication, authorization and professional verification are three separate things

Stated because the code already obeyed it and the change must not erode it.
`users.email` + password is *authentication*. `roles` and `permissions` are
*authorization*. `doctors.verification_status` is *professional
verification*. No column serves two of those roles.

#### §2 — Login is unchanged

Email and password, one endpoint, for every role. The backend derives the
role from the authenticated account and never from the request. This ADR
changes nothing here and records it so that a future reading of the audit
that prompted it does not go looking for a change that was never needed.

#### §3 — A professional registration number is never a credential

It appears in registration and in the doctor's profile. It appears in no
login schema, and nothing in `modules/auth` resolves an account by it. The
column carries a comment saying so, because the property is invisible in the
schema and easy to erode.

#### §4 — Registration is a discriminated union over `patient` and `doctor`

One endpoint, two branches. A patient sends the account fields only; a doctor
must additionally send `professionalRegistrationNumber`, `professionalCategory`
and `specialty`, with an optional `registrationExpiresOn` that must be in the
future if present.

A doctor registration now creates the `doctors` row in the account
transaction, with `verification_status = PENDING`. That is the change that
makes professional verification reachable at all.

`professionalCategory` is a new nullable `varchar(40)` on `doctors`, not a
native enum. The category vocabulary belongs to whichever register a
jurisdiction runs — SCFHS names five classes, another regulator names a
different set — so an enum would freeze one country's list into the schema
and make every additional jurisdiction a migration. The validated vocabulary
lives in the DTO. **No jurisdiction discriminator is shipped**: one register
is configured, and a column that always holds the same value is not a
column. A second register adds one.

**Patient date of birth and gender are deliberately not collected at
registration.** They are attributes of a `patients` row, not of a sign-in
identity, and `users` has no column for either. Collecting them would either
duplicate `patients.date_of_birth` on a second table or create a clinical
record from self-asserted data — and ADR-030 §4 keeps account creation and
record-claiming apart precisely because asserting *"I am the person in
PT-1042"* wrongly discloses one person's medical history to another.
RA-030.1 still owns the claim flow.

#### §5 — `admin` is removed from public registration; administrators are invited

Not refused by a check — **absent from the union**, so the request does not
parse and no service needs a branch to reject it.

Provisioning is a new `admin_invitations` table and three routes:

| Route | Guard | Effect |
|---|---|---|
| `POST /auth/admin-invitations` | `@Can('roles.manage')` | Creates and mails an invitation. Returns no token |
| `POST /auth/admin-invitations/accept` | `@Public()` | Phase 1 — sets the password, creates the account **INACTIVE** with a TOTP secret provisioned, returns the enrolment material and **no session** |
| `POST /auth/admin-invitations/activate` | `@Public()` | Phase 2 — verifies a code from that secret, sets `two_factor_enabled` and `status = ACTIVE` |

A new table rather than a nullable `user_id` on `verification_tokens`: an
invitation is the authority to *create* an account and exists before one
does, which is not a shape that table can hold without weakening a NOT NULL
every existing consumer relies on.

One token spans both phases, guarded by `accepted_at` and `completed_at`
respectively, so neither replays. Every failure of either phase — unknown,
expired, revoked, used, wrong phase — answers `token_invalid`, on the same
reasoning `VerificationTokenService.consume` documents.

Invitable roles are `admin`, `reception`, `laboratory` and `pharmacy`.
**Not `doctor`**: this flow collects no registration number and must not
fabricate one.

The invitee's landing page is `/accept-invitation`, which the mail
template builds from `APP_PUBLIC_URL` — so that path is a contract with
`AuthMailService`, not a free choice. It is built rather than deferred:
the server-side flow being complete and tested is worth nothing if the
link in the mail lands on a 404, and a flow no invitee can finish is not
a flow. It renders both phases (password, then the setup key and
recovery codes with a six-digit challenge) and offers no control that
skips the second — the enrolment step has one button and it is
"Activate account".

The client half is a second seam beside the auth one (`InvitationService`,
mock + HTTP adapters, `selectService`) rather than two more methods on
`AuthService`: these calls mint no session and touch no refresh cookie,
and putting them on the session port would make every adapter of it —
the mock included — responsible for a flow that has nothing to do with
signing in.

#### §6 — `users.status` is enforced at login

Any non-ACTIVE status is `403 account_inactive`, checked **after** the
password for the same anti-enumeration reason `email_unverified` is —
otherwise the endpoint answers *"is this person suspended?"* to anyone.
One code for all three states: the holder learns which from their
administrator, not from a login form.

#### §7 — Administrator MFA is mandatory, and structurally so (amended 2026-11-07: every non-patient role, OD-004)

Two mechanisms, deliberately overlapping:

- The **only** code path that moves an invited account to ACTIVE is the one
  that has just verified a TOTP code. An administrator with no second factor
  is not a state the supported flow can produce.
- `POST /me/2fa/disable` refuses an administrator outright, so the factor
  cannot be taken back off.

Login also refuses an `admin` with `two_factor_enabled = false`
(`403 two_factor_required`). This is a **backstop**, not the mechanism — it
catches an account whose role was changed after the fact, or one seeded
directly. It is a refusal rather than a challenge because an unenrolled
account has no secret to challenge against, so a step-up would mint a code
nobody can produce.

**Amended 2026-11-07 — the doctor exemption is withdrawn (OD-004, FINAL
2026-11-05).** Two-factor authentication is mandatory for **every non-patient
role** and optional for patients. SMS is the primary factor; passkeys, TOTP and
recovery codes are supported alternatives. Existing eligible staff accounts get
a **14-day enrolment grace period**; after it, an unenrolled non-patient account
is refused a session with `403 two_factor_required`, with no exception or
bypass. The lock-out risk this paragraph previously cited is what the grace
period answers.

The administrator invitation flow above is unchanged: an invited administrator
still cannot reach ACTIVE without a verified second factor, and gets no grace
period. **Owner decision 2026-11-10:** this is policy, not only today's
mechanism — an invited administrator has **no 14-day grace period**, and MFA
must be completed before the account is activated.

**Decided, not implemented.** Today only administrators are enforced; doctors
and other staff remain opt-in until the OD-004 enforcement task lands, and only
TOTP and recovery codes exist (SMS and passkeys do not). For a *newly created*
staff account, the 14-day grace period **starts at account activation** (owner
decision 2026-11-10). The start point for *existing* staff is unchanged by that
decision: OD-004's "after the policy becomes effective for their account", whose
relation to O-12's "first verified login" is open clarification C-10. A lost
factor follows the Q7/R4 decision (FINAL, Option A): recovery codes are
single-use, and a fresh set is issued only through re-enrolment.

Implementation dependencies of the new-staff rule, recorded and not decided
here:

- the activation moment is not persisted today — non-administrator accounts are
  created `ACTIVE` and `users` has no activation timestamp — so measuring the
  14 days needs a recorded activation time, a future Prisma change that needs
  its own authorization;
- what counts as "activation" for an account with no separate INACTIVE → ACTIVE
  step (for example a self-registered doctor, whose sign-in is gated on
  `email_verified_at`) is not established and needs owner confirmation, as is
  whether an administrator's reactivation of a deactivated account restarts the
  14 days.

**Last recovery code (owner decision 2026-11-10).** Redeeming an account's last
remaining recovery code forces account recovery / re-enrolment: further access
is **blocked until recovery is completed**. This ADR does not design that
mechanism and introduces no recovery process beyond those already approved.
Decided, not implemented: today the sign-in that spends the last code
establishes a normal session, like any other code. Implementation depends on:

- the separately approved secure account-recovery process for a user whose
  current factor is unavailable (Q7/R4; `OWNER_DECISIONS.md` C-1), which is not
  yet defined;
- Q7/R4's re-enrolment order, whose step 2 (current second-factor
  verification) a user who has spent every code may be unable to meet — the
  recovery process above has to answer that, not this ADR;
- whether the sign-in that spends the last code yields no session or one
  restricted to completing recovery, and whether the account's existing
  sessions end — neither is decided;
- a durable record that the account is blocked pending recovery, which may need
  a Prisma change and its own authorization.

The R3 notification email and the strict `auth.recovery_code_used` audit event
already fire on every redemption, the last one included.

#### §8 — No verification is faked

Nothing in this change contacts a professional register, and no code path
writes `VERIFIED`. `PENDING` is a claim about Medora's state — *"nobody has
checked this number"* — which is true. Moving off it requires an
administrator holding `doctors.verify`. The signup form's copy says the
registration *will be* reviewed, never that it has been.

`DoctorVerificationStatus` already carried `PENDING | VERIFIED | REJECTED |
DOCS_REQUESTED`, so no new status vocabulary was introduced. An expired
registration is represented by `license_expires_on` rather than a fifth enum
value; the DTO refuses an already-expired date at registration so the state
cannot be created at signup.

### Consequences

- Public administrator self-registration is closed. **The first administrator
  of a deployment must be seeded**, because every route that creates one
  requires one. This is a real operational constraint and is stated rather
  than worked around — a bootstrap endpoint would be the hole this ADR
  closes, reopened under another name.
- The seeded demo administrator (`admin@medora.health`) has no credential row
  and has never been able to sign in, so §7 changes nothing for it.
- `users.license_number` is kept and still written for a doctor, so nothing
  that reads it regresses. `doctors.license_number` is authoritative: it
  carries the UNIQUE index and is what the verification queue reads.
- Three error codes are added to the shared vocabulary on both sides of the
  seam: `account_inactive`, `two_factor_required`, `professional_number_taken`.
- The migration is additive: one nullable column and one new table. No
  backfill, no type change, no row rewritten.

### Alternatives considered

| Alternative | Rejected because |
|---|---|
| Keep `role: 'admin'` and gate it behind an allow-list of email domains | A domain is not an authorization. Anyone who can receive mail at the domain gets `roles.manage` |
| Refuse `admin` with an explicit check in `RegistrationService` | Works, but leaves the value in the DTO where a later reader sees a supported role. Removing it from the union makes the refusal structural and unrepresentable in the type system |
| Separate `/auth/register/patient` and `/auth/register/doctor` endpoints | Duplicates the account-creation path across two handlers that must then agree on hashing, consent, tokens and audit. The union expresses the difference without splitting the code |
| A single `PENDING` value added to `UserStatus` for invited admins | A new enum value plus a migration to express what INACTIVE already means. `UserStatus` describes whether an account may be used; "has not finished enrolling" is exactly not-usable |
| Reuse `verification_tokens` with a nullable `user_id` | Weakens a NOT NULL that every existing consumer of that table depends on, to model a row that is not a token *about* a user |
| Return the invitation token in the 201 body | Lets anyone holding `roles.manage` provision an administrator at an address they control, removing the out-of-band step that makes the flow worth having |
| Issue a session at the end of invitation acceptance | Two code paths minting sessions, which must then agree on rotation, lockout and audit. The invitee signs in through `/auth/login` like everyone else |
| Make MFA mandatory for doctors too | ~~Locks out every already-registered clinician who has not enrolled. The global policy flag exists for an operator who wants this~~ **No longer rejected (2026-11-07):** adopted, widened to every non-patient role, by OD-004 — the 14-day grace period answers the lock-out objection. See §7 |
| Add a `jurisdiction` column alongside `professional_category` | One register is configured; a discriminator that always holds one value is not yet information |
| Collect date of birth and gender at patient registration | Duplicates `patients` columns on `users`, or creates a clinical record from self-asserted data — ADR-030 §4 |
| Integrate an external register to verify numbers at signup | No such integration exists. Building a fake one, or writing `VERIFIED` on an unchecked number, is the one thing this ADR most firmly refuses |

### Residual ambiguity

- **RA-035.1** — Whether an administrator can revoke an outstanding
  invitation through an endpoint. The column (`revoked_at`) and the
  supersede-on-reinvite behaviour exist; a `DELETE` route does not. It
  belongs with M8.2's administration surface.
- **RA-035.2** — ~~Recovery-code redemption at login.~~ **Resolved 2026-11-07.**
  `POST /auth/otp/recovery` spends one recovery code against the pending login
  challenge: single use under a row lock, inside the challenge's attempt bound,
  audited as `auth.recovery_code_used`, with a notification email that carries
  neither the code nor the remaining count. The count is read at `GET /me/2fa`.
  A fresh set comes only from re-enrolment (`/me/2fa/reenroll`, Q7/R4). Original
  text: codes were issued and stored encrypted at enrolment and at invitation
  acceptance, and there was no endpoint that spent one; an administrator who
  lost their authenticator needed another administrator. The last-code rule
  (§7, owner decision 2026-11-10) is decided and not implemented.
- **RA-035.3** — An invited administrator's `display_name` is the local part
  of their address until they edit it in Settings. The invitation carries no
  human name, and inventing one would be worse than an obviously provisional
  one.
- **RA-035.4** — `/accept-invitation` renders the enrolment secret as text
  for manual entry rather than as a QR code. Every authenticator accepts
  manual entry, and adding a QR library to the auth bundle for one screen a
  handful of people see once was not worth it — but scanning is what most
  people expect, so this is a convenience worth adding when someone asks.
- **RA-035.5** — There is no administrator-facing screen for *creating* an
  invitation. `POST /auth/admin-invitations` is built, guarded and tested;
  the panel that calls it belongs with M8.2's administration surface,
  alongside the revoke route of RA-035.1. Until then an invitation is
  issued by an authenticated API call.

---

## ADR-036 — `/me/profile` Is One Route, Owned by the Users Module

**Status:** Accepted · **Date:** 2026-09-11 · **Milestone:** M9.1–M9.2

### Context

Two contracts name the same path for two different documents.

`PATIENT_MOBILE_API_CONTRACT.md` §2.1 assigns `GET /me/profile` to the
patient's own record, and ADR-030 implemented it in `PatientsModule` as
`PatientProfileController`, returning `{ account, patient }` — with
`patient: null` the normal state for an account not yet linked to a
clinical record.

`BACKEND_API_CONTRACT.md` §3.1 assigns `GET /me/profile` to the **doctor
(or admin) profile document**, and §3.2 assigns `PATCH` to editing it.
M9.1 is that item.

These are not two routes that happen to collide. In NestJS they cannot
coexist at all: two controllers declaring the same method and path are
both registered, and Express serves whichever module loaded first.
`DoctorsModule` precedes `PatientsModule` in `modules/index.ts`, so
adding the doctor route in the obvious place would have **silently
shadowed the patient application's profile endpoint** — an outage
delivered as a feature, with no compiler error, no lint error and no
failing test in the module that caused it.

The composition also cannot live in either module. `PatientsModule`
cannot build the professional half and `DoctorsModule` cannot build the
clinical one without importing the other, which M2.2's zone 1 forbids
precisely to stop that kind of reach.

### Decision

**`/me/profile` is one route serving one concept — "the caller's own
profile" — and `UsersModule` owns it.**

The document is `{ account, patient, doctor }`, with each satellite
`null` when it does not apply:

| Caller | `patient` | `doctor` |
|---|---|---|
| A patient with a linked record | the record | `null` |
| A patient not yet linked | `null` | `null` |
| A practitioner | `null` | the professional profile |
| An administrator | `null` | `null` |

`UsersModule` is the owner because `/me/…` is the account surface it
already holds — `/me/account`, `/me/activity` — and because "who am I,
and what records are linked to me" is an identity question rather than a
clinical one. The patient projection and its clinical enum maps moved
there unchanged; `PatientsModule` returns to a skeleton until M10 builds
the care-scoped clinician surface of API §4, which is a different
authorization model (`PatientScopeService`, not `patients.user_id`) and
was never going to share a controller with a self-service route.

**`GET` serves every authenticated caller; `PATCH` and
`PUT /me/profile/photo` serve practitioners only.** API §3.2 is the
doctor profile document. A patient's profile *edit* is a different
question — which fields a patient may change, and who wins when a
clinician edits the same field — and ADR-030 RA-030.2 leaves it
deliberately open. A caller with no `doctors` row therefore reads the
document and gets 404 from the write routes.

### Consequences

**The change is additive for the patient client.** The payload gains a
`doctor` key that is always `null` for a patient. `test/patient-api.e2e-spec.ts`
passes unchanged, which is the evidence rather than the claim.

**The licence-edit rule has a home.** API §3.2 requires a licence-field
edit to flip `verificationStatus` back to `pending`. The reset happens in
the *same statement* as the edit, so "verified against a registration
number no longer on the row" is unreachable rather than unlikely — and it
is compared against the stored value rather than against the body, because
a settings screen sends the whole document back on every save and a
practitioner whose verification reset when they edited their biography
would learn to stop editing.

`fullName` is deliberately not a licence field: forcing re-verification
for a name correction is how a clinic ends up with knowingly wrong names
on file.

**Three projections of `doctors` now exist, and that is correct.**
`PatientDoctorSummary` (what a patient may see), `AdminDoctorDetail`
(what the clinic manages) and `DoctorProfileView` (what a practitioner
edits about themselves). Each is built column by column rather than
filtered from a shared shape, so a column added to `doctors` reaches none
of them by default — and `FORBIDDEN_DOCTOR_FIELDS` keeps the first one
honest under test.

**A module may read a table it does not own.** This was already true —
`AdminDoctorRepository` counts `appointments` and `patients`, and
`AvailabilityRepository` reads `appointments` — and this ADR makes it
explicit: M2.2's zones govern **imports between modules**, not which
tables a repository may select from. The rule that matters is that each
projection is written out deliberately in the module that serves it.

### Alternatives rejected

**Serve the doctor profile at a different path.** Deviating from API §3.1
silently would leave the contract and the implementation disagreeing, and
the frontend's settings centre is written against `/me/profile`.

**Keep the route in `PatientsModule` and grow the doctor half there.** It
works and it lies: a controller named for patients serving a
practitioner's professional edits, in a module whose remaining work is
the care-scoped clinician surface.

**One handler that branches on role.** The codebase already rejected this
shape for `GET /doctors` versus `/patient/doctors`, and the reason
applies here too — a single branch edited wrongly is how the wrong
document reaches the wrong audience. The difference is that there the two
audiences want *different* documents; here they want the same one with
different halves populated, which is a composition rather than a branch.

### Open items

- **RA-036.1** — A patient's own profile edit (`PATCH` for the `patient`
  half) is still undecided, exactly as ADR-030 RA-030.2 left it. The route
  exists and refuses; the product decision has no owner yet.
- **RA-036.2** — `PUT /me/profile/photo` answers **503** until M25.2 wires
  the object-storage adapter. The route, the multipart parsing and the
  type and size checks are real; `UnconfiguredFileStorage` rejects rather
  than pretending to store, which is the behaviour M9.2 anticipated
  ("stub storage acceptable until M25; same interface").
- **RA-036.3** — The re-opened-verification notification is published to
  `shared/outbox`, one message per active administrator, and nothing
  consumes it until M19. Administrators learn of a re-opened verification
  from the queue itself in the meantime.

### Postscript — the move broke a test in another tree, as designed

CI caught one failure and it was the right one:
`patient-app/src/test/parity.test.ts` reads the backend controller **by
file path** to prove the mobile client never names a route the backend
does not serve. Moving the controller broke the read, so the suite went
red — `ENOENT … patients/controllers/patient-profile.controller.ts`.

That is the parity spec working, not a defect in it. CLAUDE.md's quality
gates already record two cross-tree exceptions to CI's path filter for
exactly this reason, and this is a third instance of the same
relationship: a spec in one tree reads another tree's source, so a
refactor in the source tree is answerable to it.

The fix is one path. **What the test asserts is unchanged** — the backend
serves `GET /me/profile` — because the route never moved; only the file
behind it did. The assertion would have been wrong to relax, and the
spec's comment now names ADR-036 so the next reader does not have to
reconstruct why a *patients* route is served from the *users* module.

---

## ADR-037 — Billing Stays Deferred, and the Revenue Slot Answers With an Alternate

**Status:** Accepted · **Date:** 2026-09-16 · **Milestone:** M17.1 · ⚠ **§2's two enum vocabularies superseded 2026-09-18 by ADR-039** (owner decision, closing RA-037.1). §§1, 3, 4, 5 are unaffected and stand. The §2 text below is retained as the record of what was proposed and why.

### Context

RM M17 and M18 are deferral milestones. M17.1 asks for "an ADR documenting
the deferral + DB §13.6 table sketch (invoices, invoice_lines, payments)",
and M17's exit gate is "nothing built ahead of product need; contract slot
reserved".

Two earlier decisions already touch this and neither is sufficient on its
own. **ADR-010** scoped group 6 — `invoices`, `invoice_lines`, `payments` —
**OUT**, with the trigger recorded as "billing turns on". **ADR-018 §2**
picked the flag-off alternate over a 404 for the revenue analytics
category. What neither carries is the *sketch* M17.1 names, and neither
says what the alternate actually contains — so a reader knew billing was
deferred and still could not implement the endpoint that depends on it.

The evidence that billing is genuinely absent rather than merely unbuilt is
worth restating, because it is what makes the deferral a decision rather
than a delay:

- `frontend/src/configs/feature-flags.ts` declares `billing: false`, and its
  own header says the flag **has no consumer**: "flipping it to `true` today
  does nothing".
- DB §4.12: "No invoice/payment entity exists anywhere in code ⇒ billing
  tables are Inferred Recommendations (§13)."
- `StorageUsageCard.tsx` ships the admin overview's documented fallback for
  the revenue slot, and says why: "No billing flag exists anywhere in this
  app, so the fallback is what ships."

### Decision

**1. Billing remains out of scope, and no billing table is created.**
ADR-010 group 6 stands unchanged. M17 and M18 produce ADRs only.

**2. The table sketch is recorded here, and is a sketch — not a migration.**
Written down so the day billing turns on the shape is a decision already
taken rather than one made under delivery pressure. Types follow DB §14.3's
own note: `numeric(12,2)` for money, which that section names explicitly as
the type "if billing lands".

```text
invoices
  id              uuid        PK   gen_random_uuid()
  public_id       varchar(20) UNIQUE        -- INV-…, its own sequence
  patient_id      uuid        FK → patients            RESTRICT
  doctor_id       uuid        FK → doctors             RESTRICT
  appointment_id  uuid NULL   FK → appointments        SET NULL
  status          invoice_status  -- SUPERSEDED by ADR-039: the approved
                                  --   vocabulary is draft|issued|paid|cancelled.
                                  --   `partially-paid` and `void` are rejected.
  currency        char(3)     -- ISO 4217; the localization slice already
                              --   carries a clinic currency (`USD` seeded)
  subtotal        numeric(12,2)
  tax_total       numeric(12,2)
  total           numeric(12,2)
  amount_paid     numeric(12,2) DEFAULT 0
  issued_at       timestamptz NULL   -- null while draft
  due_at          date NULL
  voided_reason   varchar(300) NULL  -- P4: a void carries a reason
                                     -- ADR-039 §9: renamed `cancelled_reason`;
                                     --   the P4 intent is unchanged.
  -- ADR-039 §3 adds: paid_at timestamptz NULL (the derived-overdue predicate)
  created_at / updated_at / deleted_at / created_by / updated_by

invoice_lines
  id              uuid        PK
  invoice_id      uuid        FK → invoices            CASCADE
  description     varchar(200)
  quantity        numeric(12,2)
  unit_price      numeric(12,2)
  line_total      numeric(12,2)
  -- Provenance, all SET NULL: a line survives the thing it was raised for.
  appointment_id  uuid NULL   FK → appointments        SET NULL
  lab_order_id    uuid NULL   FK → lab_orders          SET NULL
  prescription_id uuid NULL   FK → prescriptions       SET NULL

payments
  id              uuid        PK
  invoice_id      uuid        FK → invoices            RESTRICT
  amount          numeric(12,2)
  method          payment_method  -- SUPERSEDED by ADR-039: the approved
                                  --   vocabulary is cash|card|insurance.
                                  --   `transfer` is rejected.
  received_at     timestamptz
  reference       varchar(120) NULL  -- processor/transaction handle
  created_at / created_by
```

Four properties of the sketch are decisions rather than defaults:

- **`payments.invoice_id` is RESTRICT, not CASCADE.** A received payment is a
  financial fact; deleting the invoice must not delete the record that money
  changed hands.
- **`invoice_lines` carries three nullable provenance FKs, all SET NULL.** A
  line raised for a lab order survives that order's deletion — the same
  reasoning M5.11 applied to `patient_medications.prescription_id`.
- **`amount_paid` is stored on the invoice** rather than summed from
  `payments` on every read. DB §14.5-6 forbids storing derived values except
  for index use; this is the second such exception and, like
  `lab_orders.has_critical_result`, it must be maintained by a trigger and
  never written by hand. (⚠ Its stated purpose — "so a partially-paid
  filter is indexable" — is superseded by **ADR-039 §9**, which rejects that
  status; the column itself stands.)
- **Voiding carries a reason.** (⚠ **ADR-039 §2** replaces `void` with
  `cancelled`; the rule below is unchanged and now reads "cancelling carries a
  reason".) Every other destructive act in this system is
  P4 (confirm-with-reason); an invoice cancelled with no record of why is the
  one a later audit cannot explain.

**3. The revenue analytics category answers the alternate, and the alternate
is named.** ADR-018 §2 chose the payload over a 404; this fixes its content.
`GET /reports/analytics?category=revenue` returns **200** with
`{ category, billingEnabled: false, alternate: 'top-visit-types', notice,
topVisitTypes[], range }`.

`top-visit-types` is not invented. UX §2.1 states the doctor Overview's
rule directly: the revenue card is "visible only when the clinic enables
per-doctor billing; otherwise the slot shows **'Top visit types'**
instead". The admin equivalent (UX §3.1's Storage & Usage) already ships on
the frontend.

`billingEnabled` is on the payload rather than implied by the absence of
figures, because a client inferring the flag from missing numbers would
render an empty chart on a deployment whose billing is *on* but whose month
was quiet.

**4. The flag is a constant with one reader, mirroring the frontend.**
`isBillingEnabled()` in `modules/reports/services/billing-flag.ts` returns a
build-time `false`. It is deliberately **not** a `platform_settings` row: a
switch in the admin panel with nothing behind it is worse than an honest
constant, because a setting that appears in a panel implies something
happens when it changes. M24 moves it to the settings slice when there is
something for it to govern.

**5. The other eight analytics categories answer 501 `not_implemented`.**
They need the full `AnalyticsSnapshot`, which is **M21**. A 404 would deny
the category is part of the API, a 422 would blame the client, and an empty
snapshot would show a doctor a dashboard of zeros as though it were their
practice.

### Consequences

- M17's exit gate is met on both halves: nothing is built ahead of product
  need, and the contract slot is reserved with a real answer behind it.
- M21 extends rather than replaces: it fills the eight 501s and keeps this
  alternate for `revenue` while the flag is off.
- The day billing turns on, three things change in order — M24 moves the
  flag to platform settings, the tables above land as a migration, and M21
  serves a real snapshot when the flag is true. The `isBillingEnabled()`
  indirection means step one is an edit to one function body.
- **Open item RA-037.1 — ✅ CLOSED 2026-09-18 by ADR-039**, which records the
  product owner's decision: `invoice_status` is `draft|issued|paid|cancelled`
  and `payment_method` is `cash|card|insurance`. The text below is retained as
  the record of why the values above were left open rather than invented.
- **Open item RA-037.1.** The sketch names `invoice_status` and
  `payment_method` as new enums. Per MG §18.4 — "freeze enums and status
  machines before the Prisma schema" — their vocabularies must be confirmed
  against a product owner before the tables are created, not while writing
  the migration. No source states them today; the values above are the
  sketch's proposal, not a transcription.


---

## ADR-038 — Payments Stay Deferred; the Ledger Is Sketched, the Processing Is Not

**Status:** Accepted · **Date:** 2026-09-16 · **Milestone:** M18.1

### Context

RM M18.1 reads "Same treatment as M17 — ADR only; re-plan when billing turns
on", and M18's exit gate is "documented deferral".

**"Same treatment" resolves to less code here, not the same amount, and the
reason is worth stating because it is the whole decision.** M17 produced an
ADR *and* a small endpoint, because API §12.1 already lets a client ask for
`category=revenue` — a contract slot existed, so something had to answer it,
and ADR-018 §2 had already chosen what. Payments has no such slot. Audited
2026-09-16:

| Surface | Payment/invoice mentions |
|---|---|
| `BACKEND_API_CONTRACT.md` | **none** — no endpoint, no §, no parameter |
| `frontend/UX_ARCHITECTURE.md` | **none** |
| `frontend/src/**` | **none** (the "Stripe" hits are settings-nav *layout* references; "refund policy" is a message-flagging keyword in `flag-rules.ts`) |
| `patient-app/**` | one row, explicitly excluding it — `PATIENT_APP_AUDIT.md` OOS-4: "Billing, payments, insurance claims — ADR-018 §2, `billing: false`, no tables" |
| `backend/src/**`, `backend/prisma/schema/**` | **none** beyond M17's own comments |

So there is no request a client can make that would go unanswered, and
nothing to reserve. Building a payments surface now would be speculative
architecture with no consumer — and M18's gate forbids exactly that.

Two existing decisions already bind and are not reopened here. **ADR-010**
group 6 scoped `invoices` / `invoice_lines` / `payments` **OUT**, trigger
"billing turns on". **`PROJECT_BACKEND_MASTER_GUIDE.md` §576 row 8** is an
instruction to defer in the same words this milestone uses: "Feature-flagged
off; tables are §13 recommendations; **design invoices/payments when
enabled**."

### Decision

**1. Payments remain deferred. M18 ships no code.** No table, no endpoint, no
DTO, no feature flag of its own — `isBillingEnabled()` (ADR-037 §4) already
governs the one place the question can be asked, and payments has no second
place. The deliverable of M18 is this record.

**2. The payments *ledger* is already sketched, in ADR-037, and is not
re-decided here.** That ADR carries the `payments` table — `invoice_id`
RESTRICT so a received payment survives its invoice, `amount numeric(12,2)`,
`method`, `received_at`, `reference` — as part of DB §13 group 6. Restating
it here would create two sketches that can drift. **This ADR does not amend
it.**

**3. What is *not* sketched, and deliberately: payment processing.** The
distinction is the substance of this ADR. ADR-037's table records **that
money was received**. Nothing anywhere records **how money is taken** — and
those are different systems with different regulators:

| Concern | Status |
|---|---|
| Processor / PSP | **Undecided.** No provider is named in any source. |
| PCI DSS scope | **Undecided.** Hosted-fields/redirect (SAQ A) versus taking card data on our own origin (SAQ D) is a security-posture decision with audit consequences, not an implementation detail. |
| Refunds and partial refunds | **Partly decided 2026-09-18.** **ADR-039 §7** fixes the *destination* rule (a refund returns to the patient and respects the original payment source; card to the same source, cash small-direct / large-by-transfer) and **§8** the storage prohibitions (no PAN, CVV or PIN). Still **undecided**: the authority model (who may refund, up to what, with what approval), the refund reason vocabulary, the cash threshold, and the ledger shape — RA-039.1 rows 1–3 and 7. |
| Webhook handling and idempotency | **Undecided.** Depends on the processor. |
| Settlement, payouts, reconciliation | **Undecided.** |
| Multi-currency | **Undecided.** The `localization` platform-settings slice carries one clinic currency (`USD` seeded); whether a payment may differ from it is unanswered. |

**A sketch of any of this would be invention, not transcription.** The
ledger could be sketched because DB §13 and §14.3 constrain it; processing
has no upstream source at all. ADR-037's `payments.reference` column
("processor/transaction handle") is the seam a processor would attach to,
and that is as far as the evidence reaches.

**4. Nothing in this ADR creates the billing enums.** (⚠ **Updated 2026-09-18:**
RA-037.1 is **closed** by **ADR-039** — the owner decided
`invoice_status = draft|issued|paid|cancelled` and
`payment_method = cash|card|insurance`. This clause was correct when written and
is retained; what it declined to promote has now been decided properly, and the
values it declined to promote are *not* the ones that were approved.)
`invoice_status` and
`payment_method` remain **RA-037.1 — open, awaiting the product owner**. The
values in ADR-037's sketch are a proposal and were labelled as such; this
ADR does not promote them, extend them, or add a third enum. MG §18.4
("freeze enums and status machines before the Prisma schema") is the reason
they must be confirmed rather than assumed.

**5. Re-planning is gated on a decision, not a date.** When billing turns
on, M18 is re-planned in this order: RA-037.1 is answered → the open items in
§3 are answered → the ADR-037 tables land as a migration → M21 serves real
revenue analytics → only then does a payments *surface* get designed. Any
other order builds on vocabulary that may change. **Step one is done as of
2026-09-18 (ADR-039); step two is not — RA-038.1 and RA-039.1 are both open,
so no migration may yet be written.**

### Consequences

- **M18's exit gate — "documented deferral" — is met by this record**, and by
  the absence of code rather than in spite of it. The verify step ("ADR
  accepted") is this document.
- **The deferral is now falsifiable.** §3 is a checklist: anyone proposing to
  build payments can be asked which of those six rows has been answered, and
  by whom.
- **Two open items are carried, neither of them M18's to close.**
  **RA-037.1** (the two enum vocabularies) and the six rows of §3 above,
  recorded here as **RA-038.1 — payment-processing decisions**. Both need the
  product owner; neither blocks any milestone before billing is enabled.
- **M17 and M18 now differ in the register in the way they differ in
  reality**: ADR-037 reserved a slot that existed, ADR-038 records that no
  slot exists. A future reader asking "why did one ship an endpoint and the
  other nothing?" has the answer without re-auditing.


---

## ADR-039 — The Billing Vocabulary Is Decided; RA-037.1 Closes

**Status:** **Accepted** — product owner, 2026-09-18. **Closes RA-037.1.**
**Supersedes in part:** ADR-037 §2 — the two enum vocabularies and the three
clauses that depended on them. ADR-037 §§1, 3, 4, 5 and the whole of ADR-038
are untouched and stand. · **Milestone:** M17.1 / M18.1 (corrective)

### Context

ADR-037 §2 sketched `invoices`, `invoice_lines` and `payments`, and left one
item open rather than invent it: **RA-037.1**, the vocabularies of the two
new enums `invoice_status` and `payment_method`. The values written into that
sketch were labelled, in the ADR itself, as "the sketch's proposal, not a
transcription" — MG §18.4 ("freeze enums and status machines before the
Prisma schema") requires them confirmed by a product owner before any table
is created. ADR-038 §4 deliberately declined to promote them.

**The product owner has now stated them.** This ADR records that decision.
It is the register's ordinary mechanism: per the convention recorded at
ADR-030 (*"decisions are superseded by new ADRs, not edited"*), ADR-037 keeps
its number and its text, and the parts the owner decided differently are
superseded here rather than rewritten there. A reader who arrives at
ADR-037's sketch must be able to see that its enum values were a proposal
that changed, and what it changed to.

**Nothing in this ADR builds billing.** No table, no migration, no enum in
`prisma/schema/01-enums.prisma`, no DTO, no endpoint, no flag. ADR-010
group 6 remains OUT, ADR-037 §1 and ADR-038 §1 stand, and `isBillingEnabled()`
still returns a build-time `false`. What changes is that the vocabulary the
migration will use is now decided rather than assumed.

### Decision

**1. `invoice_status` is exactly four values.**

```text
draft | issued | paid | cancelled
```

**2. Four proposed or adjacent values are rejected, each for a stated
reason.** These are owner decisions, not readings of evidence:

| Rejected | Why |
|---|---|
| `partially-paid` | An invoice must ultimately be **fully paid**. A partial settlement is a fact about the payments received against an invoice, not a lifecycle state the invoice rests in. |
| `void` | Rejected in favour of **`cancelled`**. One act, one word — two spellings for the same terminal state is how a status filter comes to disagree with a report. |
| `disputed` | The business rule is that the patient is **informed of the expected treatment cost before proceeding and accepts it before treatment**. A dispute state models a negotiation this clinic does not have. |
| `overdue` | Rejected **as a stored status** — see §3. It is derivable, and a derived fact that is also persisted is a fact that can be stale. |

ADR-037 §2's `status invoice_status -- draft|issued|paid|partially-paid|void`
is superseded by §1 above.

**3. Overdue is a derived condition, never a persisted state.** It is
computed, not stored:

```text
status = issued
AND     due_at < now()
AND     paid_at IS NULL
```

No `overdue` enum member, no boolean column, no separate lifecycle state, and
no trigger maintaining one. An invoice does not *become* overdue; it *is*
overdue, for as long as the predicate holds, and stops being so the moment it
is paid or cancelled without any write having to find it.

**Schema consequence, at sketch level only.** The predicate names `paid_at`,
and ADR-037 §2's `invoices` sketch has no such column. The sketch therefore
gains `paid_at timestamptz NULL` — this is transcription of the owner's own
rule, not an addition to it. `due_at date NULL` already exists and is
unchanged.

**4. Issuance has one source of truth.** ADR-037 §2's sketch carries both a
`status` member `issued` and an `issued_at timestamptz NULL` column, and did
not say how they relate. They are not two mechanisms; the invariant is:

```text
status is the lifecycle. issued_at is the timestamp OF the transition into it.
issued_at IS NULL  ⟺  status = draft
```

No independent `is_issued` flag, no second issuance mechanism, and nothing
that can report an invoice as issued while the other says it is not. The same
shape governs `paid_at` against `status = paid`. Which of the two a given
query reads is a matter of what it needs — the lifecycle or the moment — not
a choice between competing records.

**5. `payment_method` is exactly three values.**

```text
cash | card | insurance
```

`transfer` is **rejected**. ADR-037 §2's
`method payment_method -- cash|card|transfer|insurance` is superseded.

**6. Insurance is a payer category, and is not an immediate patient
payment.** It is on the `payment_method` vocabulary deliberately, but
settling a claim with an insurer and taking a card at the desk are different
events with different timing, different counterparties and different failure
modes. Documentation must not treat them as one.

**No coverage percentage is approved for Medora — not 80%, not 90%, not 95%,
not any other figure.** Coverage depends on the patient's policy and plan,
the covered service, provider and network rules, authorization, and the
applicable insurance terms. Any number in any document is an example, never
a rule.

The architecture must eventually be able to tell these apart, and they are
**future design concerns only** — none is decided here:

```text
invoice total · insurance responsibility · patient responsibility (copayment)
authorization · claim · insurance settlement
```

The workflow they sit in is likewise conceptual and is **not** to be turned
into backend code by this ADR:

```text
patient insurance → eligibility/coverage → authorization request
  → approved/rejected → treatment → claim → insurance settlement
```

A worked illustration, with **every figure arbitrary** and no percentage
implied — treatment cost 1000, insurance responsibility 950, patient
responsibility 50, patient pays 50, claim 950, settlement 950. It shows the
*shape* of the split. It is not a rate, a default, or a test fixture.
Emergency-care rules are outside this ADR's scope entirely.

**7. Refunds return to the patient, and respect the original payment
source.** The system must eventually verify that the refund destination
matches the information used for the original payment.

- **Card.** A card refund returns to the **same original payment
  source/account/card**, subject to the payment provider's capabilities.
  An arbitrary destination for a card refund is not a permitted design.
- **Cash.** Small refunds may be returned **directly to the patient in
  cash**. Large refunds go by **bank transfer to the patient's verified bank
  account**. The threshold between small and large is **TBD** and no number
  is invented here.
- **Reason-dependent.** Refund behaviour depends on the reason the
  appointment was cancelled. No refund percentage, cancellation window, or
  refund policy is decided by this ADR.

**8. Refund and payment data carry hard storage prohibitions.** The system
may retain the verified refund/account information a patient provides, and
may **never** store:

```text
full card numbers (PAN) · CVV · PINs
```

Payment-provider **references and tokens** plus non-sensitive metadata (brand,
last four, expiry month/year, a provider customer/mandate handle) are the
permitted representation. ADR-037 §2's `payments.reference` column
("processor/transaction handle") is exactly that seam, and ADR-038 §3's PCI
DSS scope row is the decision that fixes how far the prohibition reaches —
still open as RA-038.1.

**9. What ADR-037's dependent clauses become.** Three of its bullets cited
the superseded values and are corrected here rather than left to be read
literally:

- **"Voiding carries a reason"** → **cancelling** carries a reason. The
  intent is unchanged and is still P4: `voided_reason varchar(300) NULL`
  becomes **`cancelled_reason varchar(300) NULL`**. An invoice cancelled with
  no record of why is the one a later audit cannot explain.
- **`amount_paid`'s stated rationale** — "so a partially-paid filter is
  indexable" — no longer holds, because that status is rejected. The
  **column itself stands as ADR-037 decided it**: stored, trigger-maintained,
  never written by hand, the second of DB §14.5-6's permitted derived-value
  exceptions. Its rationale is now the `paid_at`/`due_at` predicates of §3
  and the reconciliation of received payments against an invoice total.
  Whether a partly-settled invoice needs any representation *beyond* that
  running total is **TBD** (RA-039.1).
- **`payments.invoice_id` RESTRICT** and **`invoice_lines`' three SET NULL
  provenance FKs** are unaffected and stand exactly as ADR-037 decided them.

### Design-readiness review

M17/M18 asked whether the backend can *later* carry billing. Audited
2026-09-18 against `backend/src/**`, `backend/prisma/schema/**`, the
migrations, the seeds and `BACKEND_API_CONTRACT.md`. **This is a readiness
review; it authorises no implementation.**

| Capability | Readiness | Evidence |
|---|---|---|
| Invoice lifecycle | **Ready** | §1 freezes the vocabulary; the enum-with-`@map` pattern and the drift check (ADR-023) already carry hyphenated labels. |
| Money representation | **Ready** | `numeric(12,2)` fixed by DB §14.3 and ADR-037; `@db.Decimal` is an established pattern in the schema today. |
| Audit trail | **Ready** | `shared/audit` fixes the `AuditEvent` contract ahead of M28, and `audit_events` is partitioned with a composite key (ADR-024). Financial acts are ordinary audited mutations. |
| Transaction boundaries | **Ready** | `$transaction` is in routine use across eight modules under the Prisma 7 driver adapters (ADR-021). |
| Provider references | **Ready** | `payments.reference` is the seam (ADR-037 §2, ADR-038 §3). |
| Soft delete / provenance | **Ready** | The `deleted_at`/`created_by`/`updated_by` convention is uniform, and RESTRICT on `payments.invoice_id` already protects the financial fact. |
| Patient & insurer identity | **Partly ready** | `patient_insurance` (policy number, plan, `valid_until`, `is_active`, at most one active by partial unique) and `insurance_providers` exist and are IN per ADR-010 group 5. They record **who the insurer is**, not what it owes: no benefit, responsibility-split, authorization or claim concept exists anywhere — by design, and left so. |
| Idempotent payment/refund operations | **Not ready — gap** | `BACKEND_API_CONTRACT.md` §0.5 promises "state-changing POSTs accept `Idempotency-Key`; replays return the original result", and **no implementation exists in `backend/src/**`** — ADR-014 assigns it per-endpoint to each owning milestone and no owning milestone has shipped one. A payment endpoint is the first place where a replayed POST charges twice, so this must be built **before**, not alongside, any payment write. |
| Concurrency-safe financial operations | **Not ready — gap** | No row-level locking, no explicit isolation level and no optimistic version column exists anywhere in `backend/src` or the schema. `amount_paid`'s trigger and any balance check are read-modify-write races under concurrent payments. The mechanism is undecided (RA-039.1). |
| Refund records | **Absent by design** | No refund table is sketched in ADR-037, ADR-038 or here. §7 decides refund *behaviour*, not its ledger; the shape is TBD. |

Nothing in the audit **contradicts** the decisions above: there is no
`partially-paid`, `void`, `disputed`, billing `transfer` or stored `overdue`
anywhere in backend source, schema, migrations, seeds, DTOs, services,
repositories, tests or the API contract, and no coverage percentage is
hard-coded anywhere. The only occurrences of the rejected vocabulary in the
repository were ADR-037 §2's own sketch — a proposal with no code behind it,
superseded by this ADR — and that is the whole of the remediation this
decision requires. (The `overdue` hits in
`dashboard/services/action-queue.ordering.ts` are the doctor action queue's
waiting-time prose, and the `transfer` hits are a MIME
`Content-Transfer-Encoding` header and the AI containment rule; neither is
billing.)

### Consequences

- **RA-037.1 is closed.** `invoice_status` and `payment_method` are frozen,
  satisfying MG §18.4 for the day the tables land.
- **Billing stays deferred.** M17's and M18's exit gates are unaffected —
  nothing was built ahead of product need, and this ADR ships no code.
- **The re-planning order of ADR-038 §5 advances by one step.** It read
  "RA-037.1 is answered → the open items in §3 are answered → the ADR-037
  tables land as a migration → M21 serves real revenue analytics → only then
  a payments surface". The first step is now done; **RA-038.1 and RA-039.1
  are both still open, so the second is not**, and no migration may be
  written until they are.
- **Two gaps are now named rather than latent** — `Idempotency-Key` has a
  contract promise with no implementation, and no concurrency control exists
  for financial writes. Both must close before a payment endpoint, not with
  it.
- **Open item RA-039.1 — the billing decisions that remain unresolved.**
  None blocks a milestone before billing is enabled; each blocks the
  migration.

| # | Unresolved decision | Status |
|---|---|---|
| 1 | **Refund approval authority** — who may approve a refund, up to what amount, with what second signature | **TBD.** No role is invented. Overlaps RA-038.1's refunds row. |
| 2 | **Refund reason vocabulary** — the closed set of reasons | **TBD.** Not invented; §7 records only that behaviour depends on the cancellation reason. |
| 3 | **Cash refund threshold** — the number separating "small, return cash" from "large, bank transfer" | **TBD.** No figure invented. |
| 4 | **Insurance coverage/benefit calculation rules** — how responsibility splits between insurer and patient | **TBD.** Explicitly no percentage (§6). |
| 5 | **Insurance authorization state machine** | **TBD.** The conceptual flow in §6 is not a state machine. |
| 6 | **Insurance claim state machine** | **TBD.** As above. |
| 7 | **Refund ledger shape** — whether refunds are negative `payments` rows or their own table, and how a refund binds to the payment it reverses | **TBD.** No table is sketched. |
| 8 | **Partial-settlement representation** — whether anything beyond `amount_paid` is needed, given `partially-paid` is rejected | **TBD** (§9). |
| 9 | **Concurrency control for financial writes** — row locks, serializable isolation, or an optimistic version column | **TBD.** None exists today. |
| 10 | **`Idempotency-Key` implementation** — the store, the key scope, the replay-response semantics | **TBD.** Contract §0.5 promises it; ADR-014 assigns it per-endpoint; nothing implements it. |
| 11 | **Payment processor / PSP** | **TBD** — RA-038.1 row 1, re-confirmed open. |
| 12 | **PCI DSS scope** — hosted fields/redirect (SAQ A) vs card data on our own origin (SAQ D) | **TBD** — RA-038.1 row 2, re-confirmed open. §8's prohibitions bind whichever is chosen. |
| 13 | **Refund webhook handling and idempotency mechanics** | **TBD** — RA-038.1 row 4, re-confirmed open; processor-dependent. |
| 14 | **Settlement, payouts, reconciliation** | **TBD** — RA-038.1 row 5, re-confirmed open. |
| 15 | **Multi-currency** — whether a payment may differ from the clinic currency (`USD` seeded) | **TBD** — RA-038.1 row 6, re-confirmed open. |

Rows 11–15 are **not restated** from RA-038.1 into a second checklist; they
are listed so that one table answers "what is left before billing?" and
their owner remains ADR-038 §3.


---

## ADR-042 — Hospital Is the Isolation Boundary

**Status:** **Accepted** · **Date:** 2026-11-22 · **Owner:** Fares Al-Almashharawi. The owner-approved
implementation safeguards below are part of this decision.
**Supersedes:**
- **ADR-018 §1** (single clinic, no `clinic_id`, no tenant isolation tests). ADR-018 §2 (billing off) and
  §4 (mobile readiness) remain Accepted; §3 is already superseded by ADR-030.
- **ADR-010**'s scope-out of `clinics`/`facilities` (and the assertion in
  `backend/test/schema-adr010.e2e-spec.ts`).

**Supersedes in part:** **ADR-022**, only its anchor ("a doctor reaches a patient iff a
`patient_doctor_assignments` row links them", RM M7.2). ADR-022's 404-not-403 rule and "RLS before
production" remain.
**Decided by:** project owner (Fares Al-Almashharawi), 2026-10-06 / 2026-10-07: DR-01…DR-13,
OD-01…OD-14, OQ-01. Additional safeguards were approved 2026-11-22.
**Open:** OQ-02, the record-claim identity-proofing method. Patient record claiming remains blocked until
identity-proofing is explicitly decided.
### Context

Medora was specified and built as a single clinic (ADR-018 §1, ADR-010). The owner has decided that
Medora is a multi-hospital platform. The repository audit (`docs/multi-hospital/AUDIT_FINDINGS.md`,
AF-01…AF-40) shows that:
- no hospital entity or hospital column exists;
- authorization is anchored on doctor–patient assignment;
- several routes are platform-wide;
- patient clinical data hangs off the global patient;
- AI messages are stored verbatim.

### Decision

1. **Hospital is the security, authorization, clinical-data and tenancy boundary.** Clinic is a separate
   entity inside a Hospital. A Hospital has one or more Locations. Neither Clinic nor Location is a
   boundary (DR-01, OD-06).
2. **Doctors:**
   - at most one active hospital employment, with history kept;
   - no hospital switcher; hospital context resolved server-side from the active employment;
   - employment end revokes access derived from that employment to that hospital immediately, with no grace period; unrelated access is not revoked.

   (DR-02, DR-08, OD-12)
3. **Patients:**
   - one global identity;
   - one Medical Record per hospital, created on the first real interaction;
   - clinical children structurally bound to the record's hospital.

   (DR-03, DR-04, OD-09)
4. **Default access:** active hospital + role + permissions. Assignment is hospital-scoped workflow data
   and never a bypass (DR-05, DR-07).
5. **Cross-hospital access has two paths:**
   - **Grant:** purpose, target Hospital Admin approval, admin-selected categories, valid only for the
     purpose (no fixed default), revocable, audited, no patient consent (DR-06, OD-01…OD-03).
   - **Break-Glass:** emergency reason, minimum necessary, time-limited, fully audited and attributable,
     revocable where applicable, never permanent, never bypassing employment (OD-04).
6. **Documentation:** a doctor may selectively document authorized cross-hospital information into the
   requesting hospital's record after explicit review and approval. It becomes that hospital's data with
   provenance. It creates no access to the source and is never a whole-record copy (OQ-01).
7. **Consultations** between hospitals are allowed. They never bypass grants, Break-Glass controls, audit,
   employment or revocation (OD-13).
8. **Administration:**
   - Platform Admin: platform and hospital lifecycle, no automatic clinical access;
   - Hospital Admin: one hospital;
   - existing admin accounts are mapped deliberately.

   (OD-07)
9. **Discovery and booking:**
   - discovery is authenticated (comparison by distance, ratings, next slot, insurance);
   - uninsured patients are unrestricted;
   - only doctor-published slots, capacity 1, with DB-level protection against double booking.

   (DR-09…DR-11, OD-08, OD-10, OD-14)
10. **AI:**
    - hospital-only by default;
    - cross-hospital data only under a valid grant or Break-Glass, within scope and lifetime;
    - raw cross-hospital data is never retained afterwards (C1/C2/C3 data classes);
    - provider-agnostic gateway; assistant governance; capabilities developed in parallel with stronger
      gates for high-risk ones.

    (DR-12, DR-13, OD-05, OD-11)

**Technical choices recorded here** (details in `docs/multi-hospital/`):
- **Enforcement:**
  - data-access-layer enforcement now, RLS on clinical tables as a production gate;
  - 404 for another hospital's ids; hospital stamped from context;
  - composite foreign keys `(hospital_id, parent_id)`.
- **Constraints:**
  - partial unique index for one active employment;
  - booked-slot uniqueness and per-doctor overlap exclusion.
- **Cross-hospital entities:**
  - grant, Break-Glass session, access-event and documentation-provenance entities;
  - extend or replace `PatientAccessGrant`, never with role-wide cross-hospital grants (AF-38).
- **AI:** `ai_messages` gains data-class tagging; C2 is purged or made inaccessible at authorization end.

### Implementation safeguards

- Preserve all existing data, identifiers, clinical history, soft-deleted records and migration history.
  Existing migrations are not modified or replayed as part of this architecture decision.
- Never assign legacy clinical records to a default Hospital without a verified ownership mapping.
  Any data backfill requires separate explicit approval.
- Patient record claiming remains blocked while OQ-02 is open.
- Cross-hospital grants, Break-Glass, consultations, AI C2 retention/purge and provenance are architectural
  targets only. Do not implement them until their technical specifications are reviewed and approved.
- RLS is not considered complete until tenant-context handling and cross-hospital negative tests pass.
- This ADR does not authorize production database access, destructive migration, data backfill, deployment,
  push or merge. Each requires separate explicit approval.
### Consequences

**Database.**
- New: Hospital, Clinic, Location, employment, admin scope, per-hospital Medical Record, grants,
  Break-Glass, provenance, published slots, insurance coverage.
- `hospital_id` on hospital-owned tables. Backfill only rows with verified ownership mappings and only after separate explicit approval; never assign unmapped records by default.
- Per-hospital uniques.

**API.**
- Hospital-scoped routes; no switch route; no `/public/*`.
- New families: grants, Break-Glass, documentation, consultations, published slots, `/hospital-admin`,
  `/platform`.

**Backend.**
- `PatientScopeService` redesigned.
- Session invalidation on employment end.
- The AI context requires the hospital context and re-checks cross-hospital authorization every turn.

**Frontend / Patient App.**
- Active hospital, no switcher.
- Admin consoles split.
- Authenticated discovery and comparison; slot booking.
- Per-hospital records.

**Testing.**
- Negative and lifecycle tests N-1…N-30.
- Gates G-1…G-8 (`docs/multi-hospital/SECURITY_AND_DATA_ISOLATION.md`). No second real hospital before they pass, including tenant-context handling and cross-hospital negative tests.

### Alternatives considered

| Alternative | Rejected because |
|---|---|
| Organization as the boundary with multiple memberships and a switcher (2026-10-06 realignment) | Owner decisions DR-01, DR-02, DR-08 |
| Public / signed-out discovery | DR-09 |
| One shared medical record across hospitals | DR-03 |
| Grants only, no emergency path | OD-04: Break-Glass exists |
| Forbid documenting any cross-hospital information into the requesting record | OQ-01 = A (selective, doctor-approved) |
| AI never uses cross-hospital data | OD-05 = B (authorization-bound use, no retention) |

---

## ADR-044 — Discarding an Unsigned Prescription Draft Is a Soft Delete

**Status:** Accepted · **Date:** 2026-10-24 · **Requirement:** BR-DEC-002 (owner decision DEC-002,
2026-10-22) · **Route:** `DELETE /prescriptions/{id}`

### Context

DEC-002 split withdrawal into `/cancel` (before therapy takes effect) and `/discontinue` (after).
Both refuse a **draft** with 409 `draft_not_discontinuable`. The reason is D-13.1: the M5.8 CHECK
`prescriptions_signed_at_matches_status` requires a signature on every status past `draft`, and a
withdrawn draft was signed by nobody. So a draft the prescriber abandoned could only be left in
their list. BR-DEC-002 asks for a route to discard one, and leaves open "whether a discarded draft
is deleted, soft-deleted or kept in a terminal state", to be recorded as an ADR (working rule 6).
This is that record.

### Options

1. **Hard delete.** It leaves nothing for the audit event that names the draft to point at, and
   it removes a row other modules may already reference (a renewal's `renewed_from`). Rejected.
2. **A new terminal status** (`discarded`). The status enum is frozen by ADR-002 and mirrored in
   the frontend and the patient app (the `01-enums.prisma` parity spec). The CHECK would also need
   a fifth exception for an unsigned terminal state. Both are migrations and contract changes for
   a state no reader needs to tell apart from "gone". Rejected.
3. **Soft delete.** `prescriptions` already carries `deleted_at`, and `prisma.db`'s M4.2 extension
   already removes soft-deleted rows from every read. **Chosen.**

### Decision

- `DELETE /prescriptions/{id}` sets `deleted_at` on the prescription. `status` stays `DRAFT` and
  `signed_at` stays null, so the CHECK is untouched and the row says truthfully what it was: an
  unsigned draft, withdrawn.
- **The predicate carries the state:** `status = DRAFT AND signed_at IS NULL AND deleted_at IS
  NULL`. A signature landing between the read and the write moves no row, and the caller gets
  **409 `prescription_not_draft`**. A signed prescription is never discarded; it is cancelled or
  discontinued, which keeps the record a pharmacist may already have acted on.
- **Prescriber only.** The lookup is `findForDoctor`, which scopes by `prescribing_doctor_id`, so
  anyone else's draft is the same 404 as a missing one. A second discard is 404, not a second 204.
- Audited as `prescription.discard` (`user_action`/`info`, summary "Prescription discarded"). No
  outbox event: no reader has been told about a draft, so nobody needs telling it is gone.
- No reason is required. A draft dispenses nothing and attests nothing, and DEC-002 asks for none.
  If one is wanted later, it is an optional body field and a column, as BR-DEC-004 did for records.

### Consequences

- No migration and no enum change. The frontend's Cancel/Discontinue split (DEC-002) is unchanged.
  The client gains a third action that is offered only on a draft.
- Soft-deleted drafts accumulate. They are bounded by how often prescribers abandon drafts, and
  any retention rule for them belongs with the M28.5 retention work, not here.

---

*End of decision register. Backend implementation is under way: M0–M8 complete, plus M7 (authorization, ADR-027) and M9 bar its exit gate. ADR-030 (patient identity) was accepted and implemented on 2026-09-02, and ADR-034 corrected the mobile refresh variant with it. The patient mobile client's Phase 1 foundation landed in PR #88; its branch model is ADR-032. **ADR-035 (2026-09-06) closed public administrator self-registration, enforced `users.status` and administrator MFA at login, made a doctor's professional block required so that verification is reachable, and wired patient registration end to end — closing RA-025.1.** **ADR-036 (2026-09-11) made `/me/profile` one route owned by the users module, which unblocked M9.1–M9.2.** **ADR-037 (2026-09-16) kept billing deferred, recorded the `invoices`/`invoice_lines`/`payments` sketch M17.1 asked for, and fixed the flag-off revenue alternate — leaving RA-037.1 open on the two new enums.** **ADR-038 (2026-09-16) kept payments deferred and shipped no code for them, because unlike the revenue slot there is no contract surface to reserve; it declines to sketch payment *processing* at all and records the six decisions that must precede it as RA-038.1.** **ADR-039 (2026-09-18, owner decision) closed RA-037.1: `invoice_status` is `draft|issued|paid|cancelled` and `payment_method` is `cash|card|insurance`; `partially-paid`, `void`, `disputed` and `transfer` are rejected, and overdue is a derived predicate rather than a stored status. It supersedes ADR-037 §2's proposed values, ships no code, and carries the fifteen decisions that remain before a billing migration as RA-039.1.** **ADR-031 (results release) and ADR-033 (patient appointment actions) remain proposed and awaiting a product/clinical owner.** No patient-readable clinical route may ship until ADR-031 is decided, and no patient appointment *write* route until ADR-033 is.*
