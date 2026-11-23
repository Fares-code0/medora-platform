# Pending ADRs — written under a backend-only scope rule

**Why this file exists.** Roadmap working rule 6 puts every architectural
decision in `docs/DECISIONS.md` at the repository root. The M24–M29 work was
commissioned under an explicit hard scope rule — *"Every changed file must be
under `backend/`. If anything outside `backend/` appears, stop and fix it before
committing."* — so the register entries below could not be written to the
register itself.

They are held here in the register's exact format, numbered from the register's
current tail (**ADR-039**), ready to be appended to `docs/DECISIONS.md` verbatim
the moment a change outside `backend/` is authorised.

**ADR-041 (M30) joined them on 2026-09-21.** The register sweep was re-run first,
across `main` and all five integration branches plus the two live task branches:
the highest published number is **ADR-039** (on `backend`), ADR-040 is this file's,
so ADR-041 is the next free number. Nothing else is deferred:
the decisions are implemented, tested and described under their milestones in
`BACKEND_IMPLEMENTATION_ROADMAP.md`.

**Register rows to add** (the table under `## Register`):

> **2026-10-22 — the two rows below are now in the `docs/DECISIONS.md` register**, linking here,
> on `backend` only. **The ADR text was not moved:** this file stays its only copy, so do not
> append it to the register as well, and do not add the rows a second time. The register also now
> records ADR-042 (Accepted; full text in `docs/DECISIONS.md`) and ADR-043 (reserved) as allocated.

| ADR | Title | Status |
|---|---|---|
| [ADR-040](#adr-040--platform-settings-the-crypto-kernel-the-policy-delegate-and-the-three-conventions-m24-had-to-name) | Platform Settings — The Crypto Kernel, the Policy Delegate, and the Three Conventions M24 Had to Name | **Accepted** (M24) |
| [ADR-041](#adr-041--background-jobs-one-registry-two-drivers-and-the-four-schedules-that-are-declared-rather-than-run) | Background Jobs — One Registry, Two Drivers, and the Four Schedules That Are Declared Rather Than Run | **Accepted** (M30) |

⚠️ **Check the register before this number is used.** ADR numbers have collided
twice in this repository (`CLAUDE.md` records both), and the rule is settled:
`main` keeps the number, the unmerged branch renumbers. `backend` is the
unmerged branch here. Re-run the register sweep before appending:

```bash
git grep -h '^## ADR-' origin/main origin/frontend origin/backend \
    origin/Database origin/Ai origin/patient-app -- docs/DECISIONS.md | sort -u
```

**ADR-042 was allocated to the Multi-Hospital architecture and accepted on 2026-11-22.** Its full text
is now registered in `docs/DECISIONS.md`; the original proposal file remains at
[`docs/multi-hospital/ADR-042-DRAFT.md`](../../docs/multi-hospital/ADR-042-DRAFT.md) for traceability.
**ADR-043 remains reserved** by Phase 20 for a possible split covering cross-hospital access and AI
retention. ADR-044 and ADR-045 are registered; the next unallocated number is ADR-046. Re-run the full register and
pending-ADR sweep before allocating another number.
---

## ADR-040 — Platform Settings: The Crypto Kernel, the Policy Delegate, and the Three Conventions M24 Had to Name

**Status:** **Accepted** (M24) · **Milestone:** M24.1–M24.6
**Relates to:** ADR-019 (module boundaries are ports), ADR-020 (one validated
environment, policy layered over it), ADR-025 (the mail kernel), ADR-021.

### Context

M24 builds API §19 over `platform_settings`, `platform_integrations`,
`api_keys` and `backups` (DB §L1–L4). Four decisions had no precedent in the
register and two of them move code that four earlier milestones depend on, so
they are recorded rather than left to be inferred from a diff.

### Decision

**1. `EnvelopeService` moves from `modules/auth/` to `shared/crypto/`.**

`platform_integrations.config_enc` is write-only encrypted credentials (§19.5)
and `user_credentials`' TOTP secret is the same problem in another table. M2.2's
zone 1 forbids `platform-settings` importing `auth`, so the cipher had to sit
below both — the identical argument ADR-025 made for the mail kernel at M6, and
the one the shared kernel's own header records for `ActivityKernelModule` and
`AiKernelModule`.

Unlike every other kernel it is exported as a **class, not behind a token**.
There is nothing to swap: AES-256-GCM over `DATA_ENCRYPTION_KEY` is the
decision, and a second implementation behind a token would be a second way to
encrypt the same column. Call sites changed by one import line; the cipher, the
format and the key are untouched.

**2. The database policy layer is registered through a delegate token that
`config/` owns.**

M3.3 promised "DB platform-settings over env defaults, once M24 exists". M24
exists, and the implementation needs `PrismaService` — which lint **zone 6**
forbids `config/` from importing, precisely so configuration does not depend on
the things it configures.

So `config/policy.types.ts` declares a second token, `PLATFORM_POLICY_DELEGATE`,
and `ConfigModule` binds `PLATFORM_POLICY_SOURCE` to a factory that resolves it
**optionally**, falling back to `EnvOnlyPolicySource`. The implementation,
`PrismaPlatformPolicySource`, lives in `shared/platform-policy/` and is bound to
that token by a kernel module.

The rejected alternative was a second `@Global` module exporting
`PLATFORM_POLICY_SOURCE` directly. It works today and breaks silently the day
somebody reorders `app.module.ts`'s `imports` array, because which of two global
providers wins is a property of registration order. Which layer of a security
policy applies must not be decided by a list's order.

Consequence: `ConfigModule` in isolation — every unit test, any boot without the
shared kernel — still answers from the environment, and that is now a tested
property rather than an assumption.

**3. `maintenanceMode` and `maintenanceMessage` join `PolicySettings`, with new
environment defaults under them.**

M24.6 requires the maintenance flag to be "readable by the config service".
ADR-020 §4 already settled the shape of this move: the five `SECURITY_*`
variables were added at M3.3 "because M3.3 cannot layer over defaults that do
not exist". `MAINTENANCE_MODE` and `MAINTENANCE_MESSAGE` are added on the same
reasoning and documented in `.env.example` like the rest. They come from the
`general` slice rather than `security`, so they form their own group in the
policy schema.

The middleware that turns the flag into a 503 for non-admin requests is
**M38.3** and is deliberately not built here.

**4. Optimistic concurrency is per slice, and the token is a `revisions` map
beside the document.**

§19.2 requires optimistic concurrency; `AdminSettingsDocument` carries no
version field, because the mock persisted to localStorage where there is one
writer by construction. `GET /platform-settings` therefore carries a `revisions`
map — one ISO timestamp per slice — alongside the eleven slices, which keeps
each slice's shape identical to the frontend interface.

Per slice rather than per document: the eleven are separate rows, and a
document-wide version would 409 a branding edit because somebody else saved the
SMS panel. Two administrators editing different panels are not in conflict.

The revision is enforced in the `WHERE` clause of the update, not only checked
before it. The check produces the *useful* 409 — §19.2's "both change sets" —
but two saves in the same instant both read the same revision and both pass it;
only the compare-and-set separates them.

**5. `config.baseUrl` is the one key this platform reads out of an integration's
configuration.**

Nothing in the frontend model, API §19.5 or DB §L2 states what an integration's
configuration contains, so the map is validated for size and type only and
encrypted whole. But §19.5 specifies a `test-connection` endpoint, and a probe
must have somewhere to connect to. `baseUrl` is named here rather than left
implicit; a configuration without one makes the probe a 422 naming the missing
key instead of a silent success.

This is the minimum convention required to make a specified endpoint
implementable. It is **not** a per-provider configuration schema, which would be
inventing product rules.

**6. API keys are hashed with SHA-256, not Argon2id.**

Passwords get a memory-hard KDF because a human chooses them and the slowness
buys back missing entropy. An API key is 32 bytes from `randomBytes`; there is
nothing to buy back, and a memory-hard KDF on the verification path would make
every authenticated API call a deliberate CPU burn. The comparison is
constant-time, and the prefix — a separate unique column — makes verification
one indexed read rather than a scan.

**7. `test-connection`'s "result trail" is the audit ledger, not a new table.**

DB §L2 defines no trail relation, and every probe an administrator runs is
already an audited administrative action. M28's query surface is what makes it
readable as a trail. A dedicated table would be a second, narrower ledger over
the same events.

### Consequences

- Four milestones' call sites moved by one import line each (M6.4, M6.5,
  ADR-035's invitations). No cipher behaviour changed.
- `PolicyService.current()` now costs one indexed read of two rows on every
  enforcement point. That is M3.3's specified behaviour; **M31.1** owns the
  cache and the invalidation story a cached security policy needs.
- `platform_settings` became editable, which made one existing assertion in
  `schema-platform.e2e-spec.ts` wrong: it asserted the live rows still held the
  seeded numbers, which the panel is designed to change and the seed's own
  `update: {}` deliberately preserves. It now asserts the seed's numbers and the
  stored slices' field names — the parts no administrator edit can break.


---

## ADR-041 — Background Jobs: One Registry, Two Drivers, and the Four Schedules That Are Declared Rather Than Run

**Status:** **Accepted** (M30) · **Milestone:** M30.1–M30.2
**Relates to:** ADR-019 (module boundaries are ports), ADR-025 (the mail kernel),
ADR-007 (retention), ADR-021.

### Context

M30 consolidates every periodic behaviour in the platform. Five services were
already written for it and said so in their own headers — `OrphanSweepService`,
`PrescriptionSweepService`, `AuditRetentionService`, `NotificationDispatchService`
and `NotificationDeliveryService` each do the work and each deliberately start no
timer, because M30's exit gate is "all periodic behavior runs from the registry,
none ad hoc".

Four decisions had no precedent in the register, and two of them change what an
operator sees.

### Decision

**1. The registry is the eleventh shared kernel, and it had to be.**

Nine of the eleven schedules M30.2 names belong to a different domain module, and
M2.2's zone 1 forbids any module importing a sibling. A scheduler living inside
one module could reach the other eight only by breaking that rule — so the
registry sits below all of them and each module registers *into* it from its own
`onModuleInit`. Every arrow points module → kernel.

This is the same argument ADR-025 made for the mail kernel and the shared kernel's
header records for `ActivityKernelModule`, in its strongest form yet: there, three
modules needed one sender; here, the *gate itself* forbids the alternative.

The registry is **sealed** at `onApplicationBootstrap` — the first moment every
module's `onModuleInit` has run. A later registration throws, because a schedule
added after boot appears in no boot log and on no screen.

**2. `JOB_QUEUE` is a port with two implementations, and `inline` is the default.**

MG §17 fixes BullMQ as the stack and it is implemented: `BullmqJobQueue` registers
each schedule as a Redis job scheduler, so N replicas fire each one **once**. But
binding it unconditionally would mean the platform could not boot — or run its own
test suite — without a broker, and every registered job is an idempotent sweep:
the broker buys single-firing, not correctness.

So `JOBS_DRIVER` chooses, exactly as `FILE_STORAGE` and `MAILER` are chosen, and
no caller can tell which is bound. `GET /administration/jobs` reports the driver,
so the choice is never invisible.

Two consequences are worth stating because they were not obvious:

- **One retry policy, two enforcers.** The in-process driver walks the attempts
  itself; the broker owns its own loop. The worker therefore registers a *custom*
  BullMQ backoff strategy that calls `backoffDelayMs`, because BullMQ's built-in
  `exponential` has no ceiling and `RetryPolicy` does. Approximating one with the
  other would make the delays a job actually sees differ from the ones the unit
  test asserts.
- **Both drivers fire on the same grid.** `nextRunAfter` anchors an interval at
  the Unix epoch, and the broker's schedulers are given a matching `startDate`.
  Without it BullMQ fires an `every` scheduler the instant it is upserted, so
  every deploy would run all six interval sweeps at once and a rolling restart
  would do it again per replica.

**3. Bull Board is not mounted; the same data is served by a guarded route.**

M30.1 names "Bull Board (admin-only)". The board is not the part that was
declined — the *admin-only* part is:

- It is an Express application mounted beside this one, and its authorization is
  a middleware the host supplies. The platform would have two independent answers
  to "is this caller an administrator", and a healthcare platform with two auth
  paths has the weaker one.
- It shows only what is in Redis, so under the default driver it would show
  nothing while eleven schedules ran.
- It cannot show a **blocked** schedule, because that is this registry's concept
  and never reaches a broker — and four of the eleven are blocked, which is the
  most useful thing on the screen.

`GET /administration/jobs` therefore serves the registry, the next firing, the
counters and the dead letters behind this repository's own `AuthorizationGuard`,
with `POST …/{name}/run` and `POST …/dead-letters/{id}/replay` beside it. An
operator who wants the broker's own view runs Bull Board against the same Redis
out of band, where it is a read of infrastructure rather than a second door into
the API.

Both mutations audit as `admin_activity` / **`warning`** — not `info`, because the
registry includes a sweep whose day job is to `DROP TABLE`.

**4. A schedule with no work behind it is registered `blocked`, not omitted.**

M30.2's verify step is "each schedule **registered and visible**", and four of the
nine have nothing to run. Omitting them would make the registry look complete;
giving them a handler that does nothing would make the screen lie. `JobDefinition`
is therefore a union — a job has a handler or it has a `blocked` reason — so the
type makes running one impossible, and `POST …/run` answers 409 `job_blocked`
with the reason rather than 404.

The four, each with the evidence rather than an opinion:

| Schedule | Why it cannot run | What unblocks it |
|---|---|---|
| `reports.scheduled-run` | `run_status` is `sent \| failed` (DB §I2) and nothing can deliver the document: `MailMessage` carries no attachments by construction (ADR-025) and a link is held closed by the M25.3 gate | Attachments on the mail port, or a bound scan engine |
| `platform-settings.backup-run` | Nothing produces a backup artefact — a run could only write a `backups` row for a recovery point that does not exist | The backup artefact pipeline |
| `appointments.satisfaction-survey-dispatch` | No route accepts a survey on either contract; a notification is "a pointer, not a record" | A submission endpoint, and a reader for API §13.2's `privacy.surveyParticipation` |
| `ai.usage-log-retention` | Nothing to purge: M16.1 logs shape and cost to the log stream where the *pipeline* expires them, and the transcript is `ai_messages` under ADR-007, whose `autoPurge` is off | A log-pipeline rule, or ADR-007 enabling auto-purge |

**5. The malware scanner is a three-valued port, and the third value writes
nothing.**

M25.3 built the download gate and recorded that the scanner is M30.2's.
`MalwareScannerPort` answers `clean`, `infected` or **`unavailable`** — the last
meaning no engine is bound, and the file keeps its `pending` state.

A boolean port would have forced a lie either way: a scanner returning "clean"
without having run opens the gate on the one file it exists to stop (the exact
defect M25.3 fixed on the message-attachment surface), and one that threw would
make every upload look like an outage. It is the same shape
`NotificationDeliveryService` already uses for a channel with no provider.

`FileStoragePort` gained `get(key)` for this and only this: an engine must be
handed the object, and cannot be sent a signed URL it would then fetch as an
anonymous client. Every client read still signs.

**6. The licence-expiry warning goes to the practitioner alone.**

No source names a recipient. The holder is the only party who can renew, which
needs no source; adding the administrators would be defensible by analogy with
`doctor.verification_reopened` and would still be an invented recipient — the one
thing `NOTIFICATION_RULES` refuses. Recorded as RA-M30.3; it is one word in
`audiences` the day a product owner says so.

### Consequences

- `JOBS_ENABLED` and `JOBS_DRIVER` join the environment contract, both with
  defaults, so no deployment breaks. `JOBS_ENABLED` suppresses *firing* and never
  registration — a replica with it off still builds, seals, prints and serves the
  registry, which is what stops an idle replica reading as a broken one.
- CI's backend job gains a Redis service container, because the BullMQ driver is
  tested against a real broker rather than a mock: the three things it exists to
  get right are all BullMQ's semantics, and a mocked `Queue` would assert this
  repository's spelling instead. `REDIS_URL` was already required and
  `docker-compose.yml` already ran one.
- **RA-M30.1** — the metrics and the dead-letter list are process-local, and
  `JobsView.processLocal` says so on the wire. Moving both behind a shared store
  is M31.1's, which already owns the Redis layer.
- **RA-M30.2** — no scan engine is reachable from this environment (the same
  egress policy RA-M25.1 records), so the gate stays shut. Everything either side
  of the engine is verified.
- **RA-M30.3** — whether an administrator hears the licence warning is a product
  question, recorded rather than answered.
- Two existing specs were corrected rather than worked around, both for asserting
  on shared state that a parallel run can change underneath them — the class
  `CLAUDE.md` already records at `claude/fix-patient-spec-row-contention`, and the
  lesson `notification-fanout.e2e-spec.ts` had already written into its own header.
  - `doctor-action-queue.e2e-spec.ts` picked "any other user" out of the table for
    its message-thread counterpart, and could hit a foreign-key violation when
    another suite's teardown removed that account between the read and the insert.
    It now seeds its own counterpart inside its harness's email domain.
  - `notification-delivery.e2e-spec.ts` asserted a **global** `claimed === 5`, and
    read `sink.messages[0]` unfiltered. `run()` claims every pending delivery in
    the table by design, so both measured the rest of the suite; adding a twelfth
    fan-out topic was enough to break them. The per-channel outcomes now come from
    the notification's own rows and the mail assertions filter the sink by
    recipient. Nothing was weakened — the exclusivity property the concurrency
    test exists for is asserted more precisely than before (five rows, one
    attempt each, one email).
